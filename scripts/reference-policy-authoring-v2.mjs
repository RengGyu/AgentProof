import Ajv from "ajv";
import { closeSync, existsSync, fstatSync, fsyncSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReferencePolicySealV2, inspectReferencePolicyInputsV2 } from "./evidence-release-reference-policy-v2.mjs";

const schema = JSON.parse(readFileSync(new URL("../schemas/reference-policy/holdout-authoring-v2.schema.json", import.meta.url)));
const ajv = new Ajv({ allErrors: true, jsonPointers: true, strictDefaults: true });
ajv.addSchema(schema);
const validateEvidence = ajv.getSchema(`${schema.$id}#/definitions/evidenceCorpusV2`);
const validateBoundary = ajv.getSchema(`${schema.$id}#/definitions/boundaryCorpusV2`);
const KEYWORD_CODES = Object.freeze({ required: "required_field", additionalProperties: "unknown_field", type: "wrong_type", const: "wrong_constant", enum: "wrong_constant", minItems: "out_of_bounds", maxItems: "out_of_bounds", minLength: "out_of_bounds", maxLength: "out_of_bounds", minimum: "out_of_bounds", maximum: "out_of_bounds", oneOf: "wrong_type" });
const AUTHORING_JSON_FORMATTING_ALLOWANCE_BYTES = 1_048_576;
const MAX_EVIDENCE_AUTHORING_FILE_BYTES = 4_808_192 + AUTHORING_JSON_FORMATTING_ALLOWANCE_BYTES;
const MAX_BOUNDARY_AUTHORING_FILE_BYTES = 819_200 + AUTHORING_JSON_FORMATTING_ALLOWANCE_BYTES;

export function validateReferencePolicySchemaV2({ evidenceCorpus, boundaryCorpus }) {
  const errors = [...schemaErrors("evidence", validateEvidence, evidenceCorpus), ...schemaErrors("boundary", validateBoundary, boundaryCorpus)];
  return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, ...boundedErrors(errors) };
}

export function validateReferencePolicyAuthoringV2(value) {
  const structural = validateReferencePolicySchemaV2(value);
  if (!structural.valid) return invalidDiagnostic("schema", structural.errors, structural.truncated);
  try {
    const semantic = inspectReferencePolicyInputsV2(value);
    if (!semantic.ok) return invalidDiagnostic(semantic.stage, semantic.errors);
    return { version: 2, status: "valid", stage: "complete", errors: [], truncated: false };
  } catch {
    return internalDiagnosticV2();
  }
}

export function internalDiagnosticV2() {
  return { version: 2, status: "invalid", stage: "internal", errors: [{ code: "internal_validation_failure" }], truncated: false };
}

export function createReferencePolicyDraftValuesV2() {
  const evidenceSlot = { version: 2, caseId: "", input: null };
  const boundarySlot = { version: 2, kind: null, caseId: "" };
  return { evidenceCorpus: { version: 2, cases: Array.from({ length: 12 }, () => ({ ...evidenceSlot })) }, boundaryCorpus: { version: 2, cases: Array.from({ length: 8 }, () => ({ ...boundarySlot })) } };
}

export function initReferencePolicyDraftsV2({ evidencePath, boundaryPath }) {
  if (existsSync(evidencePath) || existsSync(boundaryPath)) throw new Error("init_failed");
  const drafts = createReferencePolicyDraftValuesV2();
  const created = [];
  try {
    writeExclusiveDraft(evidencePath, `${JSON.stringify(drafts.evidenceCorpus, null, 2)}\n`, created);
    writeExclusiveDraft(boundaryPath, `${JSON.stringify(drafts.boundaryCorpus, null, 2)}\n`, created);
    return { evidenceCaseCount: 12, boundaryCaseCount: 8 };
  } catch (error) {
    for (const path of created) {
      try { unlinkSync(path); } catch {}
    }
    throw error;
  }
}

export function validateReferencePolicyFilesV2({ evidencePath, boundaryPath }, { validator = validateReferencePolicyAuthoringV2 } = {}) {
  const loaded = loadReferencePolicyFilesV2({ evidencePath, boundaryPath });
  if (!loaded.corpora) return loaded;
  try {
    const diagnostic = validator(loaded.corpora);
    if (diagnostic?.stage === "internal") return { exitCode: 3, diagnostic: internalDiagnosticV2() };
    return { exitCode: diagnostic.status === "valid" ? 0 : 1, diagnostic };
  } catch { return { exitCode: 3, diagnostic: internalDiagnosticV2() }; }
}

function loadReferencePolicyFilesV2({ evidencePath, boundaryPath }) {
  let texts;
  try {
    texts = [
      readBoundedAuthoringFile(evidencePath, MAX_EVIDENCE_AUTHORING_FILE_BYTES),
      readBoundedAuthoringFile(boundaryPath, MAX_BOUNDARY_AUTHORING_FILE_BYTES)
    ];
  } catch { return { exitCode: 2 }; }
  const corpora = {};
  for (const [document, text, key] of [["evidence", texts[0], "evidenceCorpus"], ["boundary", texts[1], "boundaryCorpus"]]) {
    try { corpora[key] = JSON.parse(text); } catch (error) {
      if (error instanceof SyntaxError) return { exitCode: 1, diagnostic: syntaxDiagnostic(document) };
      return { exitCode: 3, diagnostic: internalDiagnosticV2() };
    }
  }
  return { corpora };
}

function writeExclusiveDraft(path, content, created) {
  const descriptor = openSync(path, "wx", 0o600);
  created.push(path);
  try { writeFileSync(descriptor, content, "utf8"); } finally { closeSync(descriptor); }
}

function readBoundedAuthoringFile(path, maxBytes) {
  const descriptor = openSync(path, "r");
  try {
    const { size } = fstatSync(descriptor);
    if (!Number.isSafeInteger(size) || size < 0 || size > maxBytes) throw new Error("read_failed");
    const bytes = Buffer.allocUnsafe(size);
    for (let offset = 0; offset < size;) {
      const read = readSync(descriptor, bytes, offset, size - offset, offset);
      if (read === 0) throw new Error("read_failed");
      offset += read;
    }
    return bytes.toString("utf8");
  } finally { closeSync(descriptor); }
}

export function writeNewJsonExclusive(path, value, { markCreated }) {
  const descriptor = openSync(path, "wx", 0o600);
  try {
    markCreated();
    writeFileSync(descriptor, JSON.stringify(value), "utf8");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}

export function sealReferencePolicyFilesV2(
  { evidencePath, boundaryPath, outputPath },
  {
    validator = validateReferencePolicyAuthoringV2,
    builder = buildReferencePolicySealV2,
    writer = writeNewJsonExclusive,
    remover = unlinkSync
  } = {}
) {
  const loaded = loadReferencePolicyFilesV2({ evidencePath, boundaryPath });
  if (!loaded.corpora) return loaded;

  let seal;
  try {
    const diagnostic = validator(loaded.corpora);
    if (diagnostic.status !== "valid") return diagnostic.stage === "internal"
      ? { exitCode: 3, diagnostic: internalDiagnosticV2() }
      : { exitCode: 1, diagnostic };
    seal = builder(loaded.corpora);
    if (!seal) return { exitCode: 3, diagnostic: internalDiagnosticV2() };
  } catch { return { exitCode: 3, diagnostic: internalDiagnosticV2() }; }

  let outputOwnedByInvocation = false;
  try {
    writer(outputPath, seal, { markCreated() { outputOwnedByInvocation = true; } });
  } catch {
    if (outputOwnedByInvocation) {
      try { remover(outputPath); } catch {}
    }
    return { exitCode: 2 };
  }
  return { exitCode: 0, diagnostic: { version: 2, status: "sealed" } };
}

export function runReferencePolicyAuthoringCliV2(command, args, { stdout = process.stdout, stderr = process.stderr, validator = validateReferencePolicyAuthoringV2 } = {}) {
  const paths = parseAuthoringArgs(args);
  if (!paths) {
    stderr.write(`REFERENCE_POLICY_${command === "init" ? "INIT" : "VALIDATE"}_FAILED\n`);
    return 2;
  }
  if (command === "init") {
    try {
      const counts = initReferencePolicyDraftsV2(paths);
      stdout.write(`${JSON.stringify({ version: 2, status: "initialized", ...counts })}\n`);
      return 0;
    } catch {
      stderr.write("REFERENCE_POLICY_INIT_FAILED\n");
      return 2;
    }
  }
  if (command !== "validate") {
    stderr.write("REFERENCE_POLICY_VALIDATE_FAILED\n");
    return 2;
  }
  const result = validateReferencePolicyFilesV2(paths, { validator });
  if (result.exitCode === 2) {
    stderr.write("REFERENCE_POLICY_VALIDATE_FAILED\n");
  } else {
    stdout.write(`${JSON.stringify(result.diagnostic)}\n`);
  }
  return result.exitCode;
}

export function runReferencePolicySealCliV2(
  args,
  {
    stdout = process.stdout,
    stderr = process.stderr,
    validator = validateReferencePolicyAuthoringV2,
    builder = buildReferencePolicySealV2,
    writer = writeNewJsonExclusive,
    remover = unlinkSync
  } = {}
) {
  const paths = parseSealArgs(args);
  if (!paths) {
    stderr.write("REFERENCE_POLICY_SEAL_FAILED\n");
    return 2;
  }
  const result = sealReferencePolicyFilesV2(paths, { validator, builder, writer, remover });
  if (result.exitCode === 2) stderr.write("REFERENCE_POLICY_SEAL_FAILED\n");
  else stdout.write(`${JSON.stringify(result.diagnostic)}\n`);
  return result.exitCode;
}

function parseAuthoringArgs(args) {
  if (args.length !== 4 || args[0] !== "--evidence-cases" || args[2] !== "--boundary-cases") return null;
  const evidencePath = resolve(args[1]);
  const boundaryPath = resolve(args[3]);
  return evidencePath === boundaryPath ? null : { evidencePath, boundaryPath };
}

function parseSealArgs(args) {
  if (args.length !== 6 || args[0] !== "--evidence-cases" || args[2] !== "--boundary-cases" || args[4] !== "--output") return null;
  const evidencePath = resolve(args[1]);
  const boundaryPath = resolve(args[3]);
  const outputPath = resolve(args[5]);
  return new Set([evidencePath, boundaryPath, outputPath]).size === 3 ? { evidencePath, boundaryPath, outputPath } : null;
}

function syntaxDiagnostic(document) {
  return { version: 2, status: "invalid", stage: "syntax", errors: [{ document, path: "", code: "syntax_invalid" }], truncated: false };
}

function schemaErrors(document, validate, value) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => {
    const pointer = error.keyword === "required" ? `${error.dataPath}/${error.params.missingProperty}` : error.dataPath;
    return { document, caseIndex: caseIndex(pointer), pointer: pointer.slice(0, 256), code: errorCode(error) };
  }).filter((error) => !isDraftBoundaryBranchError(document, value, error));
}

function isDraftBoundaryBranchError(document, value, error) {
  if (document !== "boundary" || value?.cases?.[error.caseIndex]?.kind !== null) return false;
  return error.code === "wrong_type" && error.pointer === `/cases/${error.caseIndex}` || /\/(report|liveInput|pastedOverride)$/.test(error.pointer);
}

function errorCode(error) {
  if (error.keyword !== "pattern") return KEYWORD_CODES[error.keyword] ?? "wrong_constant";
  if (error.params.pattern === "^[a-f0-9]{64}$" || error.params.pattern === "^[a-f0-9]{40,64}$") return "invalid_sha";
  if (error.params.pattern === "^[a-z][a-z0-9_]{0,31}$") return "invalid_identifier";
  if (error.params.pattern === "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]{1,200}$" || error.params.pattern === ".*/$") return "invalid_safe_path";
  if (error.schemaPath.includes("/sha256/")) return "invalid_sha";
  if (error.schemaPath.includes("/identifier/")) return "invalid_identifier";
  if (error.schemaPath.includes("/safePath/") || error.schemaPath.includes("/prefixScopeV2/")) return "invalid_safe_path";
  return "wrong_constant";
}

function caseIndex(pointer) { const match = pointer.match(/^\/cases\/(\d+)/); return match ? Number(match[1]) : -1; }
function invalidDiagnostic(stage, errors, truncated = errors.length > 50) {
  return {
    version: 2,
    status: "invalid",
    stage,
    errors: errors.slice(0, 50).map(({ document, caseIndex: index, pointer, path, code, coverageName }) => ({
      ...(document ? { document } : {}),
      ...(Number.isInteger(index) && index >= 0 ? { caseIndex: index } : {}),
      ...(pointer !== undefined || path !== undefined ? { path: (pointer ?? path).slice(0, 256) } : {}),
      code,
      ...(coverageName ? { coverageName } : {})
    })),
    truncated
  };
}
function boundedErrors(errors) {
  const seen = new Map();
  for (const error of errors) seen.set(`${error.document}\u0000${error.caseIndex}\u0000${error.pointer}\u0000${error.code}`, error);
  const ordered = [...seen.values()].sort((left, right) => left.document.localeCompare(right.document) || left.caseIndex - right.caseIndex || left.pointer.localeCompare(right.pointer) || left.code.localeCompare(right.code));
  return { errors: ordered.slice(0, 50), truncated: ordered.length > 50 };
}
