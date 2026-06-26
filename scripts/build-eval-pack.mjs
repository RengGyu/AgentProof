import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const DEFAULT_DATASET = "princeton-nlp/SWE-bench_Verified";
const DEFAULT_CONFIG = "default";
const DEFAULT_SPLIT = "test";
const DEFAULT_LENGTH = 10;
const DEFAULT_OUTPUT = "eval/generated/swebench-verified.cases.jsonl";

if (isCliEntryPoint()) {
  await buildEvalPackFromCli(process.argv.slice(2));
}

export async function buildEvalPackFromCli(args, dependencies = {}) {
  const options = parseArgs(args);

  return buildEvalPack({
    dataset: options.dataset,
    config: options.config,
    split: options.split,
    offset: options.offset,
    length: options.length,
    output: options.output
  }, dependencies);
}

export async function buildEvalPack(options = {}, dependencies = {}) {
  const fetchRows = dependencies.fetchRows ?? ((request) => fetchSweBenchRows(request, dependencies));
  const mkdirImpl = dependencies.mkdir ?? mkdir;
  const writeFileImpl = dependencies.writeFile ?? writeFile;
  const logger = dependencies.logger ?? console;
  const dataset = options.dataset ?? DEFAULT_DATASET;
  const config = options.config ?? DEFAULT_CONFIG;
  const split = options.split ?? DEFAULT_SPLIT;
  const offset = numberOption(options.offset, 0);
  const length = numberOption(options.length, DEFAULT_LENGTH);
  const output = resolve(options.output ?? DEFAULT_OUTPUT);

  assertGeneratedOutputPath(output);

  const rows = await fetchRows({ dataset, config, split, offset, length });

  if (rows.length === 0) {
    throw new Error(`No rows returned for ${dataset}/${config}/${split}.`);
  }

  const cases = rows.map(sweBenchRowToEvaluationCase);

  await mkdirImpl(dirname(output), { recursive: true });
  await writeFileImpl(
    output,
    cases.map((testCase) => JSON.stringify(testCase)).join("\n") + "\n",
    "utf8"
  );

  logger.log(`Wrote ${cases.length} normalized evaluation case(s) to ${output}`);
  logger.log("Generated files under eval/generated are ignored by git; fetch logs omit raw rows, oracle values, and secret-looking text.");

  return {
    caseCount: cases.length,
    output
  };
}

async function fetchSweBenchRows({ dataset, config, split, offset, length }, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", dataset);
  url.searchParams.set("config", config);
  url.searchParams.set("split", split);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));

  const response = await fetchImpl(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${dataset}: HTTP ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();

  return Array.isArray(payload.rows) ? payload.rows.map((item) => item.row).filter(Boolean) : [];
}

function sweBenchRowToEvaluationCase(row) {
  const repo = stringValue(row.repo, "unknown/repo");
  const instanceId = stringValue(row.instance_id, `swebench_${hashText(JSON.stringify(row)).slice(0, 10)}`);
  const problemStatement = stringValue(row.problem_statement, "");
  const hintsText = stringValue(row.hints_text, "");
  const baseCommit = stringValue(row.base_commit, "");
  const implementationFiles = parseUnifiedDiff(stringValue(row.patch, ""));
  const testFiles = parseUnifiedDiff(stringValue(row.test_patch, ""));
  const changedFiles = mergeChangedFiles([...implementationFiles, ...testFiles]);
  const failToPassTests = normalizeStringList(row.FAIL_TO_PASS);
  const passToPassTests = normalizeStringList(row.PASS_TO_PASS);
  const visibleText = [
    problemStatement,
    hintsText,
    ...changedFiles.map((file) => `${file.path}\n${file.patch ?? ""}`)
  ].join("\n");
  const hiddenValues = Array.from(new Set([...failToPassTests, ...passToPassTests]))
    .filter((label) => label.length > 4 && !visibleText.includes(label));
  const visibleImplementationFiles = changedFiles
    .filter((file) => !isLikelyTestPath(file.path))
    .map((file) => file.path);
  const visibleTestFiles = changedFiles.filter((file) => isLikelyTestPath(file.path)).map((file) => file.path);

  return {
    id: instanceId,
    source: {
      id: "swebench-verified",
      name: "SWE-bench Verified",
      url: "https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified",
      licenseNote: "Public Hugging Face dataset; verify current dataset card before redistribution.",
      oracleType: "test_transition",
      oracleStrength: "strong"
    },
    input: {
      title: `Issue-linked PR ${instanceId}`,
      url: `https://github.com/${repo}`,
      description: hintsText
        ? `PR discussion context: ${redactSecrets(hintsText)}`
        : "PR discussion context was not provided; evaluation uses the issue text and visible patch metadata only.",
      baseBranch: baseCommit ? `base:${baseCommit.slice(0, 12)}` : undefined,
      headBranch: "candidate-fix",
      taskText: redactSecrets(problemStatement),
      changedFiles,
      checks: [],
      logs: [],
      limitations: [
        "No live CI log was provided; passing behavior must stay unclear unless visible evidence proves it."
      ]
    },
    oracle: {
      description: "SWE-bench provides issue text, a developer patch, a test patch, and fail-to-pass/pass-to-pass test labels.",
      hiddenLabels: ["FAIL_TO_PASS", "PASS_TO_PASS"],
      hiddenValues,
      deniedReportTerms: [
        "SWE-bench",
        "SWEbench",
        "benchmark dataset",
        "benchmark oracle",
        "gold-patch",
        "gold patch",
        "FAIL_TO_PASS",
        "PASS_TO_PASS",
        "princeton-nlp/SWE-bench",
        "huggingface.co/datasets/princeton-nlp/SWE-bench_Verified"
      ],
      visibleImplementationFiles,
      visibleChangedFiles: changedFiles.map((file) => file.path),
      visibleTestFiles,
      failToPassTests,
      passToPassTests
    }
  };
}

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? args[index + 1];
    parsed[key] = value;

    if (inlineValue === undefined && value !== undefined) {
      index += 1;
    }
  }

  return parsed;
}

function numberOption(value, fallback) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function assertGeneratedOutputPath(output) {
  const generatedDir = resolve("eval/generated");
  const outputRelativePath = relative(generatedDir, output);

  if (outputRelativePath.startsWith("..") || outputRelativePath === "" || isAbsolute(outputRelativePath)) {
    throw new Error("Evaluation fetch output must be written under ignored eval/generated.");
  }
}

function parseUnifiedDiff(diffText) {
  const normalized = redactSecrets(diffText).trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?=^diff --git\s+)/m)
    .map((section) => section.trim())
    .filter(Boolean)
    .flatMap((section) => {
      const lines = section.split(/\r?\n/);
      const header = lines.find((line) => line.startsWith("diff --git "));
      const path = pathFromDiffHeader(header) ?? pathFromPatchHeaders(lines);

      if (!path) {
        return [];
      }

      let additions = 0;
      let deletions = 0;

      for (const line of lines) {
        if (line.startsWith("+++") || line.startsWith("---")) {
          continue;
        }
        if (line.startsWith("+")) {
          additions += 1;
        } else if (line.startsWith("-")) {
          deletions += 1;
        }
      }

      return [{
        path,
        additions,
        deletions,
        status: statusFromDiff(lines),
        patch: compactPatch(lines)
      }];
    });
}

function pathFromDiffHeader(header) {
  if (!header) {
    return null;
  }

  const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
  const path = match?.[2] || match?.[1];

  return path && path !== "/dev/null" ? path : null;
}

function pathFromPatchHeaders(lines) {
  const newPath = lines.find((line) => line.startsWith("+++ b/"))?.replace(/^\+\+\+ b\//, "");
  const oldPath = lines.find((line) => line.startsWith("--- a/"))?.replace(/^--- a\//, "");
  const path = newPath || oldPath;

  return path && path !== "/dev/null" ? path : null;
}

function statusFromDiff(lines) {
  if (lines.some((line) => line.startsWith("new file mode"))) {
    return "added";
  }
  if (lines.some((line) => line.startsWith("deleted file mode"))) {
    return "removed";
  }
  if (lines.some((line) => line.startsWith("rename from") || line.startsWith("rename to"))) {
    return "renamed";
  }

  return "modified";
}

function compactPatch(lines) {
  return lines
    .filter((line) =>
      line.startsWith("@@") ||
      (line.startsWith("+") && !line.startsWith("+++")) ||
      (line.startsWith("-") && !line.startsWith("---"))
    )
    .slice(0, 80)
    .join("\n");
}

function mergeChangedFiles(files) {
  const byPath = new Map();

  for (const file of files) {
    const existing = byPath.get(file.path);

    if (!existing) {
      byPath.set(file.path, file);
      continue;
    }

    byPath.set(file.path, {
      ...existing,
      additions: (existing.additions ?? 0) + (file.additions ?? 0),
      deletions: (existing.deletions ?? 0) + (file.deletions ?? 0),
      patch: [existing.patch, file.patch].filter(Boolean).join("\n")
    });
  }

  return Array.from(byPath.values());
}

function normalizeStringList(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === "string");
    }
  } catch {
    // SWE-bench mirrors may serialize Python-style lists; fall through to a safe best effort.
  }

  return trimmed
    .replace(/^\[|\]$/g, "")
    .split(/,\s*/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function isLikelyTestPath(path) {
  return /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|test_|_test\.|spec_)/i.test(path);
}

function stringValue(value, fallback) {
  return typeof value === "string" ? value : fallback;
}

function redactSecrets(value) {
  return String(value)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED_SECRET]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_SECRET]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_SECRET]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g, "[REDACTED_SECRET]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_SECRET]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_SECRET]");
}

function hashText(value) {
  let hash = 5381;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
}

function isCliEntryPoint() {
  return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
}
