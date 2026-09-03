import { createHash } from "node:crypto";

export interface GeneralPrExecutionEnvelopeV2 {
  version: 2;
  repositoryIdentityHash: string;
  prNumber: number;
  subjectKind: "head" | "test_merge" | "merge_group" | "unknown";
  subjectSha: string | null;
  subjectContextDigest: string | null;
  baseSha: string | null;
  headSha: string | null;
  workflowPathHash: string | null;
  workflowRefHash: string | null;
  workflowBlobDigest: string | null;
  runId: string | null;
  runAttempt: number | null;
  jobId: string | null;
  producerAppIdHash: string | null;
  event: string | null;
  resultManifestDigest: string | null;
  testInventoryDigest: string | null;
  attestation: {
    predicateType: string;
    bundleDigest: string;
    signingIdentityDigest: string;
    reporterActionDigest: string;
    nativeReportDigest: string;
    completeness: "complete" | "incomplete";
  } | null;
  completeness: "complete" | "incomplete";
}

export interface GeneralPrExecutionEnvelopeInputV2 {
  repositoryIdentityHash: string;
  prNumber: number;
  subjectKind: GeneralPrExecutionEnvelopeV2["subjectKind"];
  subjectSha: string | null;
  baseSha: string | null;
  headSha: string | null;
  subjectParents: string[];
  workflowPath: string | null;
  workflowRef: string | null;
  workflowBlobDigest: string | null;
  workflowBlobSourceSha: string | null;
  runId: string | null;
  runAttempt: number | null;
  jobId: string | null;
  producerAppId: string | null;
  event: string | null;
  resultManifestDigest?: string | null;
  testInventoryDigest?: string | null;
  attestation?: Omit<NonNullable<GeneralPrExecutionEnvelopeV2["attestation"]>, "completeness"> & { completeness: "complete" | "incomplete" };
  collectionComplete: boolean;
  jobPaginationComplete: boolean;
  /** Observation metadata only; never copied into the envelope. */
  jobDisplayName?: string | null;
  resultStatus?: "passed" | "failed" | "unknown";
}

export function deriveGeneralPrSubjectContextDigestV2(
  subjectKind: GeneralPrExecutionEnvelopeV2["subjectKind"],
  orderedParents: readonly string[]
): string | null {
  if (!isSubjectKind(subjectKind) || subjectKind === "unknown" || !orderedParents.every(isGitSha)) return null;
  const expectedCount = subjectKind === "head" ? 1 : 2;
  if (orderedParents.length !== expectedCount) return null;
  return digest({ domain: "agentproof.general-pr.execution-subject-context.v2", subjectKind, orderedParents: [...orderedParents] });
}

export function buildGeneralPrExecutionEnvelopeV2(input: GeneralPrExecutionEnvelopeInputV2): { envelope: GeneralPrExecutionEnvelopeV2 } {
  const subjectContextDigest = deriveGeneralPrSubjectContextDigestV2(input.subjectKind, input.subjectParents);
  const complete = hasCompleteEnvelopeIdentity(input, subjectContextDigest);
  const envelope: GeneralPrExecutionEnvelopeV2 = {
    version: 2,
    repositoryIdentityHash: isHash(input.repositoryIdentityHash) ? input.repositoryIdentityHash : "0".repeat(64),
    prNumber: Number.isSafeInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : 0,
    subjectKind: isSubjectKind(input.subjectKind) ? input.subjectKind : "unknown",
    subjectSha: isGitSha(input.subjectSha) ? input.subjectSha : null,
    subjectContextDigest,
    baseSha: isGitSha(input.baseSha) ? input.baseSha : null,
    headSha: isGitSha(input.headSha) ? input.headSha : null,
    workflowPathHash: input.workflowPath ? sha(input.workflowPath) : null,
    workflowRefHash: input.workflowRef ? sha(input.workflowRef) : null,
    workflowBlobDigest: isHash(input.workflowBlobDigest) ? input.workflowBlobDigest : null,
    runId: nonEmpty(input.runId),
    runAttempt: positiveInteger(input.runAttempt),
    jobId: nonEmpty(input.jobId),
    producerAppIdHash: input.producerAppId ? sha(input.producerAppId) : null,
    event: isClosedEvent(input.event) ? input.event : null,
    resultManifestDigest: isHash(input.resultManifestDigest) ? input.resultManifestDigest : null,
    testInventoryDigest: isHash(input.testInventoryDigest) ? input.testInventoryDigest : null,
    // An artifact or signature controlled by the PR is still an observed claim.
    attestation: normalizeAttestation(input.attestation),
    completeness: complete ? "complete" : "incomplete"
  };
  return { envelope };
}

export function assessGeneralPrExecutionEnvelopeV2(
  _envelope: GeneralPrExecutionEnvelopeV2,
  status: "passed" | "failed" | "unknown"
): "reported_pass" | "reported_fail" | "not_observed" {
  if (status === "passed") return "reported_pass";
  if (status === "failed") return "reported_fail";
  return "not_observed";
}

function hasCompleteEnvelopeIdentity(input: GeneralPrExecutionEnvelopeInputV2, subjectContextDigest: string | null): boolean {
  if (!isHash(input.repositoryIdentityHash) || !Number.isSafeInteger(input.prNumber) || input.prNumber <= 0 || !isGitSha(input.subjectSha) || !subjectContextDigest || !isGitSha(input.baseSha) || !isGitSha(input.headSha) || !nonEmpty(input.workflowPath) || !nonEmpty(input.workflowRef) || !isHash(input.workflowBlobDigest) || !isGitSha(input.runId) && !nonEmpty(input.runId) || !positiveInteger(input.runAttempt) || !nonEmpty(input.jobId) || !nonEmpty(input.producerAppId) || !input.collectionComplete || !input.jobPaginationComplete) return false;
  if (input.subjectKind === "test_merge") {
    return input.event === "pull_request" && input.workflowBlobSourceSha === input.subjectSha && sameParents(input.subjectParents, [input.baseSha, input.headSha]);
  }
  if (input.subjectKind === "merge_group") {
    return input.event === "merge_group" && input.workflowBlobSourceSha === input.subjectSha;
  }
  if (input.subjectKind === "head") {
    return input.event === "pull_request_target" && input.workflowBlobSourceSha === input.baseSha && sameParents(input.subjectParents, [input.headSha]);
  }
  return false;
}

function normalizeAttestation(value: GeneralPrExecutionEnvelopeInputV2["attestation"]): GeneralPrExecutionEnvelopeV2["attestation"] {
  if (!value || !isHash(value.bundleDigest) || !isHash(value.signingIdentityDigest) || !isHash(value.reporterActionDigest) || !isHash(value.nativeReportDigest) || typeof value.predicateType !== "string" || value.predicateType.length === 0) return null;
  return {
    predicateType: value.predicateType,
    bundleDigest: value.bundleDigest,
    signingIdentityDigest: value.signingIdentityDigest,
    reporterActionDigest: value.reporterActionDigest,
    nativeReportDigest: value.nativeReportDigest,
    completeness: "incomplete"
  };
}

function sameParents(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function isSubjectKind(value: unknown): value is GeneralPrExecutionEnvelopeV2["subjectKind"] { return value === "head" || value === "test_merge" || value === "merge_group" || value === "unknown"; }
function isClosedEvent(value: unknown): value is "pull_request" | "pull_request_target" | "merge_group" { return value === "pull_request" || value === "pull_request_target" || value === "merge_group"; }
function isGitSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value); }
function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function nonEmpty(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function positiveInteger(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null; }
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
