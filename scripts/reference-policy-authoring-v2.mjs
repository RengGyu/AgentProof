import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { inspectReferencePolicyInputsV2 } from "./evidence-release-reference-policy-v2.mjs";

const schema = JSON.parse(readFileSync(new URL("../schemas/reference-policy/holdout-authoring-v2.schema.json", import.meta.url)));
const ajv = new Ajv({ allErrors: true, jsonPointers: true, strictDefaults: true });
ajv.addSchema(schema);
const validateEvidence = ajv.getSchema(`${schema.$id}#/definitions/evidenceCorpusV2`);
const validateBoundary = ajv.getSchema(`${schema.$id}#/definitions/boundaryCorpusV2`);
const KEYWORD_CODES = Object.freeze({ required: "required_field", additionalProperties: "unknown_field", type: "wrong_type", const: "wrong_constant", enum: "wrong_constant", minItems: "out_of_bounds", maxItems: "out_of_bounds", minLength: "out_of_bounds", maxLength: "out_of_bounds", minimum: "out_of_bounds", maximum: "out_of_bounds", oneOf: "wrong_type" });

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
