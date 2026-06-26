import { existsSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_INPUT = "eval/generated/swebench-verified.cases.jsonl";
const DEFAULT_DATASET = "princeton-nlp/SWE-bench_Verified";
const DEFAULT_DATASET_REVISION = "c104f840cc67f8b6eec6f759ebc8b2693d585d4a";
const DEFAULT_CONFIG = "default";
const DEFAULT_SPLIT = "test";
const DEFAULT_SOURCE = "https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified";
const DEFAULT_NORMALIZER_VERSION = "evaluation-pack-v1";
const DEFAULT_MAX_FILE_PATCH_BYTES = 900;
const DEFAULT_MAX_CASE_PATCH_BYTES = 1_500;
const DEFAULT_MAX_PATCH_LINES = 80;
const RAW_DATASET_ROW_KEYS = new Set([
  "repo",
  "base_commit",
  "patch",
  "test_patch",
  "problem_statement",
  "hints_text",
  "FAIL_TO_PASS",
  "PASS_TO_PASS",
  "difficulty"
]);
const ORACLE_DENIED_TERMS = [
  "SWE-bench",
  "SWEbench",
  "benchmark dataset",
  "benchmark oracle",
  "gold-patch",
  "gold patch",
  "fail-to-pass",
  "pass-to-pass",
  "fail to pass",
  "pass to pass",
  "FAIL_TO_PASS",
  "PASS_TO_PASS",
  "princeton-nlp/SWE-bench",
  "huggingface.co/datasets/princeton-nlp/SWE-bench_Verified"
];

if (isCliEntryPoint()) {
  await promoteEvalFixtureFromCli(process.argv.slice(2));
}

export async function promoteEvalFixtureFromCli(args, dependencies = {}) {
  return promoteEvalFixture(parseArgs(args), dependencies);
}

export async function promoteEvalFixture(options = {}, dependencies = {}) {
  const readFileImpl = dependencies.readFile ?? readFile;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const renameImpl = dependencies.rename ?? rename;
  const unlinkImpl = dependencies.unlink ?? unlink;
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const existsImpl = dependencies.exists ?? existsSync;
  const logger = dependencies.logger ?? console;
  const input = resolve(options.input ?? DEFAULT_INPUT);
  const output = resolve(requiredString(options.output, "Provide --output eval/fixtures/<name>.jsonl."));
  const manifestOutput = manifestPathForFixture(output);
  const caseIds = normalizeCaseIds(options.caseIds);

  assertGeneratedInputPath(input);
  assertFixtureOutputPath(output);

  if (caseIds.length === 0) {
    throw new Error("Provide at least one --case or --case-ids value.");
  }

  if (!options.force && (existsImpl(output) || existsImpl(manifestOutput))) {
    throw new Error("Fixture output already exists. Pass --force to overwrite.");
  }

  const inputText = await readFileImpl(input, "utf8");
  const records = parseNormalizedEvaluationRecords(String(inputText), input);
  const selected = selectCases(records, caseIds);
  const sourceLength = numberOption(options.sourceLength, records.length);
  const sourceOffset = numberOption(options.sourceOffset, 0);
  const maxFilePatchBytes = numberOption(options.maxFilePatchBytes, DEFAULT_MAX_FILE_PATCH_BYTES);
  const maxCasePatchBytes = numberOption(options.maxCasePatchBytes, DEFAULT_MAX_CASE_PATCH_BYTES);
  const maxPatchLines = numberOption(options.maxPatchLines, DEFAULT_MAX_PATCH_LINES);
  const fixtureRecords = selected.map((record) =>
    sanitizeEvaluationCase(record, { maxFilePatchBytes, maxCasePatchBytes, maxPatchLines })
  );
  const fixtureText = fixtureRecords.map((record) => JSON.stringify(record)).join("\n") + "\n";
  const oracleValueHashes = selected.flatMap(hashedOracleValues).sort();
  const manifest = {
    schemaVersion: 1,
    dataset: options.dataset ?? DEFAULT_DATASET,
    datasetRevision: options.datasetRevision ?? DEFAULT_DATASET_REVISION,
    config: options.config ?? DEFAULT_CONFIG,
    split: options.split ?? DEFAULT_SPLIT,
    source: options.source ?? DEFAULT_SOURCE,
    generatedFrom: "normalized eval/generated case JSONL promoted into privacy-trimmed committed fixture",
    rowsApiUrl: options.rowsApiUrl ?? rowsApiUrl({
      dataset: options.dataset ?? DEFAULT_DATASET,
      config: options.config ?? DEFAULT_CONFIG,
      split: options.split ?? DEFAULT_SPLIT,
      offset: sourceOffset,
      length: sourceLength
    }),
    rowsApiETag: options.rowsApiETag ?? null,
    sourceOffset,
    sourceLength,
    sourceRowSha256: sha256(JSON.stringify(selected.map(sourceFingerprintRecord))),
    normalizerVersion: options.normalizerVersion ?? DEFAULT_NORMALIZER_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    caseCount: fixtureRecords.length,
    caseIds: fixtureRecords.map((record) => record.id),
    fixtureFile: relative(resolve("eval/fixtures"), output),
    sha256: sha256(fixtureText),
    privacy: "Normalized evaluation cases with bounded patch excerpts; raw hidden oracle labels are not committed.",
    oracleLabelCount: oracleValueHashes.length,
    oracleLabelSha256: sha256(JSON.stringify([...new Set(oracleValueHashes)])),
    oracleLabelHashAlgorithm: "sha256 over sorted unique hidden label values, then sha256 over JSON array of label hashes",
    selectionCriteria: normalizeSelectionCriteria(options.selectionCriteria),
    patchExcerptPolicy: `Patch excerpts are compacted to at most ${maxFilePatchBytes} bytes per file, ${maxPatchLines} lines per file, and ${maxCasePatchBytes} bytes per case.`
  };

  await mkdirImpl(dirname(output), { recursive: true });
  await writeFixturePair({
    output,
    manifestOutput,
    fixtureText,
    manifestText: JSON.stringify(manifest, null, 2) + "\n",
    writeFileImpl,
    renameImpl,
    unlinkImpl
  });

  logger.log(
    `Promoted ${fixtureRecords.length} normalized evaluation case(s) to ${output}. ` +
    `hiddenOracleLabelCount=${manifest.oracleLabelCount}; ` +
    `oracleLabelSha256=${manifest.oracleLabelSha256.slice(0, 12)}...`
  );

  return {
    caseCount: manifest.caseCount,
    caseIds: manifest.caseIds,
    output,
    manifestOutput,
    fixtureSha256: manifest.sha256,
    oracleLabelCount: manifest.oracleLabelCount,
    oracleLabelSha256: manifest.oracleLabelSha256
  };
}

function parseNormalizedEvaluationRecords(text, sourceLabel) {
  return text
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line);

      if (!isNormalizedEvaluationCase(parsed)) {
        throw new Error(`${sourceLabel} line ${index + 1} must contain normalized EvaluationCase records, not raw dataset rows.`);
      }

      return parsed;
    });
}

function isNormalizedEvaluationCase(value) {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.input) || !isRecord(value.oracle)) {
    return false;
  }

  if (Object.keys(value).some((key) => RAW_DATASET_ROW_KEYS.has(key))) {
    return false;
  }

  return typeof value.id === "string" &&
    typeof value.source.id === "string" &&
    Array.isArray(value.input.changedFiles) &&
    Array.isArray(value.oracle.hiddenLabels) &&
    Array.isArray(value.oracle.hiddenValues) &&
    Array.isArray(value.oracle.deniedReportTerms) &&
    Array.isArray(value.oracle.visibleChangedFiles);
}

function selectCases(records, caseIds) {
  const byId = new Map(records.map((record) => [record.id, record]));

  return caseIds.map((caseId) => {
    const record = byId.get(caseId);

    if (!record) {
      throw new Error(`Evaluation case not found: ${caseId}`);
    }

    return record;
  });
}

function sanitizeEvaluationCase(record, options) {
  const safeRecord = JSON.parse(JSON.stringify(record));
  const changedFiles = Array.isArray(safeRecord.input.changedFiles) ? safeRecord.input.changedFiles : [];
  const compactedFiles = compactCasePatches(changedFiles.map(sanitizeChangedFile), options);

  safeRecord.input = {
    ...safeRecord.input,
    title: redactSecrets(safeRecord.input.title ?? ""),
    description: redactSecrets(safeRecord.input.description ?? ""),
    taskText: redactSecrets(safeRecord.input.taskText ?? ""),
    changedFiles: compactedFiles
  };
  safeRecord.oracle = {
    ...safeRecord.oracle,
    description: "Source benchmark oracle labels are represented by counts and hashes in the fixture manifest; raw hidden test labels are not committed.",
    hiddenValues: [],
    deniedReportTerms: Array.from(new Set([
      ...(Array.isArray(safeRecord.oracle.deniedReportTerms) ? safeRecord.oracle.deniedReportTerms : []),
      ...ORACLE_DENIED_TERMS
    ])),
    failToPassTests: [],
    passToPassTests: []
  };

  return safeRecord;
}

function sanitizeChangedFile(file) {
  return {
    path: redactSecrets(String(file.path ?? "")),
    additions: Number.isInteger(file.additions) ? file.additions : 0,
    deletions: Number.isInteger(file.deletions) ? file.deletions : 0,
    status: typeof file.status === "string" ? file.status : "modified",
    patch: redactSecrets(file.patch ?? "")
  };
}

function compactCasePatches(changedFiles, options) {
  let compacted = changedFiles.map((file) => ({
    ...file,
    patch: compactPatch(file.patch ?? "", {
      maxBytes: options.maxFilePatchBytes,
      maxLines: options.maxPatchLines
    })
  }));

  if (casePatchBytes(compacted) <= options.maxCasePatchBytes) {
    return compacted;
  }

  const perFileBudget = Math.max(120, Math.floor(options.maxCasePatchBytes / Math.max(compacted.length, 1)));
  compacted = compacted.map((file) => ({
    ...file,
    patch: compactPatch(file.patch ?? "", {
      maxBytes: perFileBudget,
      maxLines: Math.min(options.maxPatchLines, 20)
    })
  }));

  if (casePatchBytes(compacted) <= options.maxCasePatchBytes) {
    return compacted;
  }

  return compacted.map((file) => ({
    ...file,
    patch: compactPatch(file.patch ?? "", {
      maxBytes: Math.max(80, Math.floor(options.maxCasePatchBytes / Math.max(compacted.length, 1)) - 20),
      maxLines: 6
    })
  }));
}

function compactPatch(patch, { maxBytes, maxLines }) {
  const normalized = String(patch).trim().replace(/\r\n/g, "\n");

  if (!normalized) {
    return "";
  }

  const lines = normalized.split("\n").filter(Boolean);
  const marker = "... [fixture excerpt truncated]";
  let kept = lines.slice(0, maxLines);
  let truncated = kept.length < lines.length || Buffer.byteLength(kept.join("\n"), "utf8") > maxBytes;

  while (kept.length > 1) {
    const candidate = `${kept.join("\n")}${truncated ? `\n${marker}` : ""}`;
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      return candidate;
    }
    truncated = true;
    kept = kept.slice(0, -1);
  }

  const fallback = kept[0] ?? marker;
  const candidate = `${fallback}\n${marker}`;

  return Buffer.byteLength(candidate, "utf8") <= maxBytes ? candidate : marker;
}

function casePatchBytes(changedFiles) {
  return changedFiles.reduce((total, file) => total + Buffer.byteLength(file.patch ?? "", "utf8"), 0);
}

function hashedOracleValues(record) {
  const failToPass = Array.isArray(record.oracle.failToPassTests) ? record.oracle.failToPassTests : [];
  const passToPass = Array.isArray(record.oracle.passToPassTests) ? record.oracle.passToPassTests : [];
  const hiddenValues = Array.isArray(record.oracle.hiddenValues) ? record.oracle.hiddenValues : [];
  const values = failToPass.length + passToPass.length > 0
    ? [...failToPass, ...passToPass]
    : hiddenValues;

  return values
    .filter((value) => typeof value === "string" && value.length > 0)
    .map((value) => sha256(value));
}

function sourceFingerprintRecord(record) {
  return {
    id: record.id,
    source: record.source,
    input: record.input,
    oracleValueHashes: hashedOracleValues(record).sort()
  };
}

function parseArgs(args) {
  const parsed = {
    caseIds: [],
    selectionCriteria: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = camelize(rawKey);

    if (key === "force") {
      parsed.force = true;
      continue;
    }

    const value = inlineValue ?? args[index + 1];

    if (inlineValue === undefined && value !== undefined) {
      index += 1;
    }

    if (key === "case" || key === "caseId") {
      parsed.caseIds.push(value);
    } else if (key === "caseIds" || key === "cases") {
      parsed.caseIds.push(...String(value ?? "").split(","));
    } else if (key === "selection" || key === "selectionCriteria") {
      parsed.selectionCriteria.push(value);
    } else {
      parsed[key] = value;
    }
  }

  return parsed;
}

function normalizeCaseIds(value) {
  return (Array.isArray(value) ? value : [])
    .flatMap((item) => String(item ?? "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSelectionCriteria(value) {
  const items = (Array.isArray(value) ? value : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);

  return items.length > 0 ? items : ["Selected from normalized generated evaluation cases for deterministic fixture coverage."];
}

function rowsApiUrl({ dataset, config, split, offset, length }) {
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", config);
  url.searchParams.set("split", split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));

  return url.toString();
}

function manifestPathForFixture(output) {
  if (!output.endsWith(".jsonl")) {
    throw new Error("Fixture output must end with .jsonl.");
  }

  return output.replace(/\.jsonl$/, ".manifest.json");
}

async function writeFixturePair({
  output,
  manifestOutput,
  fixtureText,
  manifestText,
  writeFileImpl,
  renameImpl,
  unlinkImpl
}) {
  const suffix = `.tmp-${process.pid}-${Date.now()}`;
  const tempOutput = `${output}${suffix}`;
  const tempManifestOutput = `${manifestOutput}${suffix}`;

  try {
    await writeFileImpl(tempOutput, fixtureText, "utf8");
    await writeFileImpl(tempManifestOutput, manifestText, "utf8");
    await renameImpl(tempOutput, output);
    await renameImpl(tempManifestOutput, manifestOutput);
  } catch (error) {
    await Promise.all([
      safeUnlink(unlinkImpl, tempOutput),
      safeUnlink(unlinkImpl, tempManifestOutput),
      safeUnlink(unlinkImpl, output),
      safeUnlink(unlinkImpl, manifestOutput)
    ]);
    throw error;
  }
}

async function safeUnlink(unlinkImpl, path) {
  try {
    await unlinkImpl(path);
  } catch {
    // Best-effort cleanup; the original write/rename error is more useful.
  }
}

function assertGeneratedInputPath(input) {
  const generatedDir = resolve("eval/generated");
  const inputRelativePath = relative(generatedDir, input);

  if (inputRelativePath.startsWith("..") || inputRelativePath === "" || isAbsolute(inputRelativePath)) {
    throw new Error("Promotion input must be a normalized JSONL file under eval/generated.");
  }

  if (!input.endsWith(".jsonl")) {
    throw new Error("Promotion input must end with .jsonl.");
  }
}

function assertFixtureOutputPath(output) {
  const fixturesDir = resolve("eval/fixtures");
  const outputRelativePath = relative(fixturesDir, output);

  if (outputRelativePath.startsWith("..") || outputRelativePath === "" || isAbsolute(outputRelativePath)) {
    throw new Error("Promoted evaluation fixtures must be written under eval/fixtures.");
  }

  if (!output.endsWith(".jsonl")) {
    throw new Error("Fixture output must end with .jsonl.");
  }
}

function requiredString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }

  return value;
}

function numberOption(value, fallback) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function camelize(value) {
  return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function redactSecrets(value) {
  return String(value)
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_SECRET]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, "[REDACTED_SECRET]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_SECRET]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g, "[REDACTED_SECRET]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[REDACTED_SECRET]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_SECRET]")
    .replace(/authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_SECRET]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, "[REDACTED_SECRET]");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCliEntryPoint() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}
