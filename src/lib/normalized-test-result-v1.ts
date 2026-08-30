export const AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_BYTES = 4_194_304;
export const AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_DEPTH = 12;
export const AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_NODES = 50_000;
export const AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_ARRAY_ENTRIES = 10_000;
export const AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_STRING_BYTES = 4_096;

export interface AgentProofNormalizedTestResultV1 {
  version: 1;
  subjectDigest: string;
  declaredTestCount: number;
  tests: Array<{ id: string; outcome: "passed" | "failed" | "skipped" }>;
  /** Parsing is evidence observation only; it never becomes execution proof. */
  observationLevel: "observed";
}

export type NormalizedTestResultParseResultV1 =
  | { valid: true; manifest: AgentProofNormalizedTestResultV1; reason: null }
  | { valid: false; manifest: null; reason: "input_rejected" | "json_invalid" | "limits_exceeded" | "schema_invalid" | "subject_mismatch" };

export function parseAgentProofNormalizedTestResultV1(
  input: string | Uint8Array,
  options: { expectedSubjectDigest: string; mimeType?: string }
): NormalizedTestResultParseResultV1 {
  if (!isHash(options.expectedSubjectDigest) || !isAcceptedMimeType(options.mimeType)) return rejected("input_rejected");
  const bytes = toUtf8Bytes(input);
  if (!bytes || bytes.byteLength > AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_BYTES || isArchiveSignature(bytes) || looksLikeLocator(input)) return rejected("input_rejected");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return rejected("json_invalid");
  }
  const limits = inspectJsonLimits(value);
  if (!limits.valid) return rejected("limits_exceeded");
  if (!isRecord(value) || !hasExactKeys(value, ["version", "subjectDigest", "declaredTestCount", "tests"])) return rejected("schema_invalid");
  const declaredTestCount = value.declaredTestCount;
  if (value.version !== 1 || !isHash(value.subjectDigest) || typeof declaredTestCount !== "number" || !Number.isSafeInteger(declaredTestCount) || declaredTestCount < 0 || !Array.isArray(value.tests)) return rejected("schema_invalid");
  const declaredCount = declaredTestCount;
  if (value.subjectDigest !== options.expectedSubjectDigest) return rejected("subject_mismatch");
  if (value.tests.length !== declaredCount || value.tests.length > AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_ARRAY_ENTRIES || !hasNoArrayHoles(value.tests)) return rejected("schema_invalid");
  const testIds = new Set<string>();
  const tests: AgentProofNormalizedTestResultV1["tests"] = [];
  for (const test of value.tests) {
    if (!isRecord(test) || !hasExactKeys(test, ["id", "outcome"]) || typeof test.id !== "string" || utf8Bytes(test.id) > AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_STRING_BYTES || !isOutcome(test.outcome) || testIds.has(test.id)) return rejected("schema_invalid");
    testIds.add(test.id);
    tests.push({ id: test.id, outcome: test.outcome });
  }
  return {
    valid: true,
    manifest: { version: 1, subjectDigest: value.subjectDigest, declaredTestCount: declaredCount, tests, observationLevel: "observed" },
    reason: null
  };
}

function inspectJsonLimits(value: unknown): { valid: boolean } {
  let nodes = 0;
  const visit = (item: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_NODES || depth > AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_DEPTH) return false;
    if (typeof item === "string") return utf8Bytes(item) <= AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_STRING_BYTES;
    if (typeof item === "number") return Number.isFinite(item);
    if (item === null || typeof item === "boolean") return true;
    if (Array.isArray(item)) return item.length <= AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_ARRAY_ENTRIES && hasNoArrayHoles(item) && item.every((child) => visit(child, depth + 1));
    if (isRecord(item)) return Object.entries(item).every(([key, child]) => utf8Bytes(key) <= AGENTPROOF_NORMALIZED_TEST_RESULT_V1_MAX_STRING_BYTES && visit(child, depth + 1));
    return false;
  };
  return { valid: visit(value, 0) };
}

function toUtf8Bytes(input: string | Uint8Array): Uint8Array | null {
  if (typeof input === "string") return new TextEncoder().encode(input);
  return input instanceof Uint8Array ? input : null;
}

function looksLikeLocator(input: string | Uint8Array): boolean {
  if (typeof input !== "string") return false;
  const value = input.trim();
  if (value.startsWith("{") || value.startsWith("[")) return false;
  return /^(?:https?:|file:|\/|\\)|\.(?:zip|gz|tgz|tar|exe|dll|so|dylib)$/i.test(value) || /\.(?:zip|gz|tgz|tar|exe|dll|so|dylib)$/i.test(value);
}

function isArchiveSignature(bytes: Uint8Array): boolean {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return true;
  if (bytes.length >= 3 && bytes[0] === 0x1f && bytes[1] === 0x8b && bytes[2] === 0x08) return true;
  return bytes.length >= 262 && new TextDecoder().decode(bytes.slice(257, 262)) === "ustar";
}

function isAcceptedMimeType(value: string | undefined): boolean { return value === undefined || value === "application/json" || value === "application/vnd.agentproof.normalized-test-result+json"; }
function isRecord(value: unknown): value is Record<string, unknown> { const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null; return Boolean(value) && !Array.isArray(value) && (prototype === Object.prototype || prototype === null); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function hasNoArrayHoles(value: readonly unknown[]): boolean { return Object.keys(value).length === value.length; }
function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function isOutcome(value: unknown): value is "passed" | "failed" | "skipped" { return value === "passed" || value === "failed" || value === "skipped"; }
function utf8Bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }
function rejected(reason: Extract<NormalizedTestResultParseResultV1, { valid: false }> ["reason"]): NormalizedTestResultParseResultV1 { return { valid: false, manifest: null, reason }; }
