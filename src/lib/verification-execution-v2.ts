import { createPublicKey, verify } from "node:crypto";
import type { ReturnValueCaseV2, ReturnValueCriterionV2 } from "./verification-contract-v2";

const MAX_RESULT_BYTES = 64 * 1024;
const HASH = /^[a-f0-9]{64}$/;

type Scalar = string | number | boolean | null;
type TargetErrorCodeV2 = "symbol_missing" | "syntax_error" | "threw" | "timeout" | "process_exit" | "non_scalar";
type EnvironmentUnavailableCodeV2 = "dependency_missing" | "loader_incompatible" | "executor_runtime_missing";

export interface VerificationExecutionRequestV2 {
  version: 1;
  bindingDigest: string;
  criteria: Array<{
    criterionId: string;
    adapter: ReturnValueCriterionV2["adapter"];
    cases: ReturnValueCaseV2[];
  }>;
}

/**
 * The executor returns observations only. It never decides whether an approved
 * expected value was satisfied.
 */
export type ReturnValueObservationV2 =
  | { kind: "returned"; actual: Scalar }
  | { kind: "target_error"; code: TargetErrorCodeV2 }
  | { kind: "environment_unavailable"; code: EnvironmentUnavailableCodeV2 };

export interface AttestedVerificationExecutionResultV2 {
  version: 1;
  bindingDigest: string;
  results: Array<{
    criterionId: string;
    adapterId: ReturnValueCriterionV2["adapter"]["id"];
    cases: Array<{ id: string; outcome: ReturnValueObservationV2 }>;
  }>;
  signature: string;
}

export function buildVerificationExecutionRequestV2(
  bindingDigest: string,
  criterion: ReturnValueCriterionV2
): VerificationExecutionRequestV2 {
  if (!HASH.test(bindingDigest)) throw new Error("verification execution binding must be a SHA-256 digest");
  return {
    version: 1,
    bindingDigest,
    criteria: [{
      criterionId: criterion.id,
      adapter: criterion.adapter,
      cases: criterion.cases.map((testCase) => ({ ...testCase }))
    }]
  };
}

export function validateAttestedExecutionResultV2(
  value: unknown,
  request: VerificationExecutionRequestV2,
  publicKeyPem: string | undefined
): { ok: true; result: AttestedVerificationExecutionResultV2 } | { ok: false } {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "bindingDigest", "results", "signature"]) ||
    value.version !== 1 || value.bindingDigest !== request.bindingDigest || !Array.isArray(value.results) || typeof value.signature !== "string") {
    return { ok: false };
  }
  if (Buffer.byteLength(stableJson(value), "utf8") > MAX_RESULT_BYTES || value.results.length !== request.criteria.length) return { ok: false };

  const normalized: AttestedVerificationExecutionResultV2["results"] = [];
  for (let index = 0; index < request.criteria.length; index += 1) {
    const expected = request.criteria[index]!;
    const received = value.results[index];
    if (!isRecord(received) || !hasExactKeys(received, ["criterionId", "adapterId", "cases"]) ||
      received.criterionId !== expected.criterionId || received.adapterId !== expected.adapter.id || !Array.isArray(received.cases) ||
      received.cases.length !== expected.cases.length) return { ok: false };

    const cases: Array<{ id: string; outcome: ReturnValueObservationV2 }> = [];
    for (let caseIndex = 0; caseIndex < expected.cases.length; caseIndex += 1) {
      const expectedCase = expected.cases[caseIndex]!;
      const receivedCase = received.cases[caseIndex];
      if (!isRecord(receivedCase) || !hasExactKeys(receivedCase, ["id", "outcome"]) || receivedCase.id !== expectedCase.id ||
        !isReturnValueObservation(receivedCase.outcome)) {
        return { ok: false };
      }
      cases.push({ id: receivedCase.id, outcome: receivedCase.outcome });
    }
    normalized.push({ criterionId: expected.criterionId, adapterId: expected.adapter.id, cases });
  }

  if (!verifyAttestation({ version: 1, bindingDigest: value.bindingDigest, results: normalized }, value.signature, publicKeyPem)) return { ok: false };
  return {
    ok: true,
    result: { version: 1, bindingDigest: value.bindingDigest, results: normalized, signature: value.signature }
  };
}

/** Server-owned comparison of signed actual observations to approved cases. */
export function evaluateReturnValueCriterionV2(
  criterion: ReturnValueCriterionV2,
  result: AttestedVerificationExecutionResultV2 | undefined
): { state: "satisfied" | "violated" | "unavailable"; evidenceRefs: string[]; gapKinds: string[] } {
  const observed = result?.results.find((item) => item.criterionId === criterion.id && item.adapterId === criterion.adapter.id);
  if (!observed || observed.cases.length !== criterion.cases.length) {
    return { state: "unavailable", evidenceRefs: [], gapKinds: ["evidence_unavailable"] };
  }

  if (observed.cases.some((testCase) => testCase.outcome.kind === "environment_unavailable")) {
    return { state: "unavailable", evidenceRefs: [], gapKinds: ["evidence_unavailable"] };
  }

  const everyExpectedScalarReturned = criterion.cases.every((expectedCase, index) => {
    const observedCase = observed.cases[index];
    return observedCase?.id === expectedCase.id &&
      observedCase.outcome.kind === "returned" &&
      Object.is(observedCase.outcome.actual, expectedCase.expected);
  });

  if (everyExpectedScalarReturned) {
    return { state: "satisfied", evidenceRefs: [], gapKinds: [] };
  }

  return { state: "violated", evidenceRefs: [], gapKinds: ["missing_execution"] };
}

function isReturnValueObservation(value: unknown): value is ReturnValueObservationV2 {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "returned") return hasExactKeys(value, ["kind", "actual"]) && isScalar(value.actual);
  if (value.kind === "target_error") {
    return hasExactKeys(value, ["kind", "code"]) &&
      (value.code === "symbol_missing" || value.code === "syntax_error" || value.code === "threw" ||
        value.code === "timeout" || value.code === "process_exit" || value.code === "non_scalar");
  }
  if (value.kind === "environment_unavailable") {
    return hasExactKeys(value, ["kind", "code"]) &&
      (value.code === "dependency_missing" || value.code === "loader_incompatible" || value.code === "executor_runtime_missing");
  }
  return false;
}

function isScalar(value: unknown): value is Scalar {
  return value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function verifyAttestation(payload: Omit<AttestedVerificationExecutionResultV2, "signature">, signature: string, publicKeyPem: string | undefined): boolean {
  if (!publicKeyPem || signature.length === 0) return false;
  try {
    return verify(null, Buffer.from(stableJson(payload), "utf8"), createPublicKey(publicKeyPem), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (isRecord(value)) {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
