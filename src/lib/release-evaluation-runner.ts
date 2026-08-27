import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, validateTenantPersistedReport } from "./tenant-report-validation";
import type { PullRequestInput, RequirementFinding, VerificationReport, VerificationReportV2 } from "./types";
import { generateVerificationReportV2FromInput } from "./verifier";
import {
  RELEASE_ELIGIBLE_VERIFICATION_CAPABILITIES_V2,
  type VerificationCapabilityV2
} from "./verification-capability-policy-v2";
import { parseVerificationContractV2 } from "./verification-contract-v2";

const PRIVATE_RECEIPT_COLLECTION_KEYS = new Set([
  "sourceBindings",
  "exactHeadTargetReceipts",
  "testRelationReceipts",
  "privateReceiptBundleV2",
  "executionBindingReceipts",
  "failedCheckAssociations"
]);
const MAX_RELEASE_CANDIDATE_REQUIREMENTS = 12;
export const MAX_RELEASE_CANDIDATE_INPUT_BYTES = 400_000;
const MAX_RELEASE_CANDIDATE_ARTIFACT_BYTES = 65_536;
const RELEASE_CANDIDATE_V2_INPUT_KEYS = [
  "url", "title", "description", "author", "baseBranch", "headBranch", "taskSource", "requirementSourceIdentityHash",
  "verificationContractSourceV2", "verificationContractBindingV2", "verificationCriterionEvidenceV2", "changedFiles", "checks", "logs",
  "executionSuites", "resolvedHeadModules", "taskText", "limitations", "sourceProvenance"
] as const;
export const RELEASE_CANDIDATE_FAILURE_STAGES = [
  "report_generation",
  "requirement_projection",
  "privacy_projection"
] as const;
export type ReleaseCandidateFailureStage = (typeof RELEASE_CANDIDATE_FAILURE_STAGES)[number];
const RELEASE_CAPABILITIES = new Set<VerificationCapabilityV2>(RELEASE_ELIGIBLE_VERIFICATION_CAPABILITIES_V2);

export interface ReleaseCandidateCaseV1 {
  version: 1;
  caseId: string;
  input: PullRequestInput;
  requirementOrdinals: number[];
}

export interface ReleaseCandidateCorpusV1 {
  version: 1;
  cases: ReleaseCandidateCaseV1[];
}

export interface ReleaseCandidateRequirementResultV1 {
  stableOracleId: string;
  ordinal: number;
  axisStates: Record<"implementation" | "targeted_test" | "execution", "satisfied" | "violated" | "incomplete">;
  testReceiptIds: string[];
  executionReceiptIds: string[];
  localCiAssociation: "associated" | "local" | "unknown";
  outcome: string;
}

export interface ReleaseCandidateResultV1 {
  version: 1;
  caseId: string;
  actual: {
    sourceKind: string;
    authority: string;
    requirements: ReleaseCandidateRequirementResultV1[];
    projection: { privateReceiptLeakCount: number };
  };
  metrics: {
    unexpectedFailure: boolean;
    durationMs: number;
    github: { requests: number; pages: number; retries: number };
    providerCallCount: number;
    failureStage?: ReleaseCandidateFailureStage;
  };
}

export interface ReleaseCandidateResultCorpusV1 {
  version: 1;
  cases: ReleaseCandidateResultV1[];
}

export interface ReleaseCandidateCaseV2 {
  version: 2;
  caseId: string;
  input: PullRequestInput;
}

export interface ReleaseCandidateCorpusV2 {
  version: 2;
  cases: ReleaseCandidateCaseV2[];
}

export type CandidateCriterionCapabilityV2 = "documentation_literal" | "path_change_absence" | "test_case" | "workflow_job" | "return_value";
export type CandidateCriterionStateV2 = "satisfied" | "violated" | "unavailable";

export interface CandidateSemanticProjectionV2 {
  contract: { sourceKind: "linked_issue" | "provided_requirement" | "pr_description"; state: "authoritative" | "author_claim" };
  objectives: Array<{ requirementId: string; outcome: "met" | "partial" | "missing" | "unclear"; criteria: Array<{
    criterionId: string;
    capability: CandidateCriterionCapabilityV2;
    requiredEvidence: string[];
    state: CandidateCriterionStateV2;
  }> }>;
  axes: Array<{ requirementId: string; criterionId?: string; role: "criterion" | "observation"; subject: string; state: "satisfied" | "violated" | "incomplete" }>;
  receipts: Array<{ id: string; requirementId: string; criterionId?: string; kind: "test" | "execution" }>;
  criterionLocalCi: Array<{ requirementId: string; criterionId: string; association: "local" | "associated" }>;
  projection: { privateReceiptLeakCount: number };
}

export interface ReleaseCandidateResultV2 {
  version: 2;
  caseId: string;
  actual: CandidateSemanticProjectionV2;
  metrics: ReleaseCandidateResultV1["metrics"];
}

export interface ReleaseCandidateResultCorpusV2 {
  version: 2;
  cases: ReleaseCandidateResultV2[];
}

export function parseReleaseCandidateCorpusV1(value: unknown): ReleaseCandidateCorpusV1 | null {
  if (!hasExactKeys(value, ["version", "cases"]) || value.version !== 1 || !Array.isArray(value.cases) ||
    value.cases.length < 1 || value.cases.length > 12) return null;

  const caseIds = new Set<string>();
  const cases: ReleaseCandidateCaseV1[] = [];
  for (const item of value.cases) {
    if (!hasExactKeys(item, ["version", "caseId", "input", "requirementOrdinals"]) || item.version !== 1 ||
      !isOpaqueId(item.caseId) || !isPullRequestInput(item.input) || !Array.isArray(item.requirementOrdinals)) return null;
    if (caseIds.has(item.caseId)) return null;
    if (item.requirementOrdinals.length < 1 || item.requirementOrdinals.some((ordinal) =>
      !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= MAX_RELEASE_CANDIDATE_REQUIREMENTS) ||
      serializedBytes(item.input) > MAX_RELEASE_CANDIDATE_INPUT_BYTES ||
      new Set(item.requirementOrdinals).size !== item.requirementOrdinals.length) return null;
    caseIds.add(item.caseId);
    cases.push({
      version: 1,
      caseId: item.caseId,
      input: item.input,
      requirementOrdinals: [...item.requirementOrdinals]
    });
  }
  return { version: 1, cases };
}

export function runReleaseCandidateCorpusV1(corpus: ReleaseCandidateCorpusV1): ReleaseCandidateResultCorpusV1 {
  const parsed = parseReleaseCandidateCorpusV1(corpus);
  if (!parsed) throw new Error("Release candidate corpus is invalid.");

  const nextReceiptHandle = opaqueReceiptHandleAllocator();
  return {
    version: 1,
    cases: parsed.cases.map((candidate) => runCandidateCase(candidate, nextReceiptHandle))
  };
}

export function writeReleaseCandidateResultV1(inputPath: string, outputPath: string): void {
  const resolvedInputPath = resolve(inputPath);
  const resolvedOutputPath = resolve(outputPath);
  if (resolvedInputPath === resolvedOutputPath) {
    throw new Error("Release candidate output path must not overwrite the explicit input.");
  }
  const corpus = parseReleaseCandidateCorpusV1(JSON.parse(readFileSync(resolvedInputPath, "utf8")) as unknown);
  if (!corpus) throw new Error("Release candidate input is invalid.");
  writeFileSync(resolvedOutputPath, JSON.stringify(runReleaseCandidateCorpusV1(corpus)));
}

export function parseReleaseCandidateCorpusV2(value: unknown): ReleaseCandidateCorpusV2 | null {
  if (!hasExactKeys(value, ["version", "cases"]) || value.version !== 2 || !Array.isArray(value.cases) ||
    value.cases.length < 1 || value.cases.length > 12) return null;
  const caseIds = new Set<string>();
  const cases: ReleaseCandidateCaseV2[] = [];
  for (const item of value.cases) {
    if (!hasExactKeys(item, ["version", "caseId", "input"]) || item.version !== 2 || !isV2CaseId(item.caseId) ||
      !isReleaseCandidateInputV2(item.input) ||
      !hasActiveV2Contract(item.input) || caseIds.has(item.caseId)) return null;
    caseIds.add(item.caseId);
    cases.push({ version: 2, caseId: item.caseId, input: item.input });
  }
  return { version: 2, cases };
}

export function runReleaseCandidateCorpusV2(corpus: ReleaseCandidateCorpusV2): ReleaseCandidateResultCorpusV2 {
  const parsed = parseReleaseCandidateCorpusV2(corpus);
  if (!parsed) throw new Error("Release candidate corpus is invalid.");
  const nextReceiptHandle = opaqueReceiptHandleAllocator();
  return { version: 2, cases: parsed.cases.map((candidate) => runCandidateCaseV2(candidate, nextReceiptHandle)) };
}

export function writeReleaseCandidateResultV2(inputPath: string, outputPath: string): void {
  const resolvedInputPath = resolve(inputPath);
  const resolvedOutputPath = resolve(outputPath);
  if (resolvedInputPath === resolvedOutputPath) throw new Error("Release candidate output path must not overwrite the explicit input.");
  const corpus = parseReleaseCandidateCorpusV2(JSON.parse(readFileSync(resolvedInputPath, "utf8")) as unknown);
  if (!corpus) throw new Error("Release candidate input is invalid.");
  writeFileSync(resolvedOutputPath, JSON.stringify(runReleaseCandidateCorpusV2(corpus)));
}

function runCandidateCaseV2(candidate: ReleaseCandidateCaseV2, nextReceiptHandle: () => string): ReleaseCandidateResultV2 {
  const startedAt = performance.now();
  let failureStage: ReleaseCandidateFailureStage = "report_generation";
  try {
    const report = generateReceiptValidatedReport(candidate.input) as VerificationReportV2;
    failureStage = "requirement_projection";
    const actual = projectCandidateSemanticProjectionV2(report, nextReceiptHandle);
    failureStage = "privacy_projection";
    actual.projection.privateReceiptLeakCount = projectionPrivateReceiptLeakCount(report);
    return successfulCandidateCaseV2(candidate.caseId, actual, performance.now() - startedAt);
  } catch {
    return failedCandidateCaseV2(candidate, performance.now() - startedAt, failureStage);
  }
}

export function projectCandidateSemanticProjectionV2(
  report: VerificationReportV2,
  nextReceiptHandle = opaqueReceiptHandleAllocator()
): CandidateSemanticProjectionV2 {
  const contract = report.verificationContract;
  if (!contract || !contract.source || (contract.state !== "authoritative" && contract.state !== "author_claim")) throw new Error("Active V2 contract is unavailable.");
  const findingById = new Map(report.requirements.map((finding) => [finding.requirementId, finding]));
  const objectives = contract.objectives.map((objective) => {
    const finding = findingById.get(objective.requirementId);
    if (!finding || objective.criteria.length !== objective.criterionResults.length) throw new Error("V2 objective closure is unavailable.");
    const results = new Map(objective.criterionResults.map((result) => [result.criterionId, result]));
    return {
      requirementId: objective.requirementId,
      outcome: candidateOutcomeV2(finding.status),
      criteria: objective.criteria.map((criterion) => {
        const result = results.get(criterion.criterionId);
        if (!result) throw new Error("V2 criterion result is unavailable.");
        return {
          criterionId: criterion.criterionId,
          capability: candidateCapabilityV2(criterion),
          requiredEvidence: [...criterion.requiredEvidence],
          state: candidateCriterionStateV2(result.state)
        };
      })
    };
  });
  const criterionIds = new Set(objectives.flatMap((objective) => objective.criteria.map((criterion) => criterion.criterionId)));
  const axes = report.requirements.flatMap((finding) => (finding.proofAxes ?? []).map((axis) => {
    const role = axis.role ?? "observation";
    if (role === "criterion" && (!axis.criterionId || !criterionIds.has(axis.criterionId))) throw new Error("V2 criterion axis ownership is unavailable.");
    if (role === "observation" && axis.criterionId !== undefined) throw new Error("V2 observation axis ownership is unavailable.");
    return {
      requirementId: finding.requirementId,
      ...(role === "criterion" ? { criterionId: axis.criterionId! } : {}),
      role,
      subject: axis.subject,
      state: axis.state
    };
  }));
  const receipts = projectOpaqueReceiptsV2(report, nextReceiptHandle);
  const criterionLocalCi = axes.flatMap((axis) => axis.role === "criterion" && axis.subject === "execution" && axis.state !== "incomplete"
    ? [{ requirementId: axis.requirementId, criterionId: axis.criterionId!, association: axis.state === "satisfied" ? "associated" as const : "local" as const }]
    : []);
  return { contract: { sourceKind: contract.source.kind, state: contract.state }, objectives, axes, receipts, criterionLocalCi, projection: { privateReceiptLeakCount: 1 } };
}

function projectOpaqueReceiptsV2(report: VerificationReport, nextReceiptHandle: () => string): CandidateSemanticProjectionV2["receipts"] {
  const bundle = report.proofGraph.privateReceiptBundleV2;
  return [
    ...(bundle?.testRelationReceipts ?? []).map((receipt) => ({ id: nextReceiptHandle(), requirementId: receipt.version === 2 ? receipt.requirementId : receipt.subjectRequirementId, kind: "test" as const })),
    ...(bundle?.executionBindingReceipts ?? []).map((receipt) => ({ id: nextReceiptHandle(), requirementId: receipt.requirementId, kind: "execution" as const }))
  ];
}

function successfulCandidateCaseV2(caseId: string, actual: CandidateSemanticProjectionV2, durationMs: number): ReleaseCandidateResultV2 {
  return { version: 2, caseId, actual, metrics: { unexpectedFailure: false, durationMs, github: { requests: 0, pages: 0, retries: 0 }, providerCallCount: 0 } };
}

function failedCandidateCaseV2(candidate: ReleaseCandidateCaseV2, durationMs: number, failureStage: ReleaseCandidateFailureStage): ReleaseCandidateResultV2 {
  const source = candidate.input.verificationContractSourceV2!;
  const parsed = parseVerificationContractV2(source);
  const state = parsed.state === "author_claim" ? "author_claim" : "authoritative";
  return {
    version: 2,
    caseId: candidate.caseId,
    actual: { contract: { sourceKind: source.kind, state }, objectives: [], axes: [], receipts: [], criterionLocalCi: [], projection: { privateReceiptLeakCount: 1 } },
    metrics: { unexpectedFailure: true, durationMs, github: { requests: 0, pages: 0, retries: 0 }, providerCallCount: 0, failureStage }
  };
}

function hasActiveV2Contract(input: PullRequestInput): boolean {
  const source = input.verificationContractSourceV2;
  const binding = input.verificationContractBindingV2;
  if (!source || !binding || !hasExactContractSourceV2(source) || !hasExactContractBindingV2(binding) || source.kind !== binding.sourceKind) return false;
  const parsed = parseVerificationContractV2(source);
  return parsed.state === "authoritative" || parsed.state === "author_claim";
}

function isReleaseCandidateInputV2(value: unknown): value is PullRequestInput {
  if (!hasOnlyKeys(value, RELEASE_CANDIDATE_V2_INPUT_KEYS) || serializedBytes(value) > MAX_RELEASE_CANDIDATE_INPUT_BYTES ||
    !boundedUtf8Text(value.title, 500) || !boundedUtf8Text(value.description, 8_000) || !boundedUtf8Text(value.taskText, 8_000) ||
    !boundedArray(value.changedFiles, 120) || !boundedArray(value.checks, 60) || !boundedArray(value.logs, 200) ||
    !isV2SourceProvenance(value.sourceProvenance) || !hasActiveV2Contract(value as unknown as PullRequestInput)) return false;
  return value.changedFiles.every(isV2ChangedFile) && value.checks.every(isV2Check) && value.logs.every(isV2Log) &&
    optionalBoundedUtf8Text(value.url, 500) && optionalBoundedUtf8Text(value.author, 500) && optionalBoundedUtf8Text(value.baseBranch, 500) &&
    optionalBoundedUtf8Text(value.headBranch, 500) && (value.taskSource === undefined || value.taskSource === "task" || value.taskSource === "issue") &&
    optionalDigest(value.requirementSourceIdentityHash) && optionalStringArray(value.limitations, 32, 1_000) &&
    (value.executionSuites === undefined || boundedArray(value.executionSuites, 12) && value.executionSuites.every(isV2ExecutionSuite)) &&
    (value.resolvedHeadModules === undefined || boundedArray(value.resolvedHeadModules, 120) && value.resolvedHeadModules.every(isV2ResolvedHeadModule)) &&
    isV2ArtifactEvidence(value.verificationCriterionEvidenceV2);
}

function isV2ChangedFile(value: unknown): boolean {
  return hasOnlyKeys(value, ["path", "previousPath", "additions", "deletions", "status", "patch"]) && isSafePath(value.path) &&
    optionalSafePath(value.previousPath) && optionalNonNegativeInteger(value.additions) && optionalNonNegativeInteger(value.deletions) &&
    (value.status === undefined || ["added", "modified", "removed", "renamed"].includes(String(value.status))) && optionalBoundedUtf8Text(value.patch, 12_000);
}

function isV2ArtifactEvidence(value: unknown): boolean {
  if (!hasExactKeys(value, ["artifactBlobs"]) || !boundedArray(value.artifactBlobs, 8)) return false;
  const paths = new Set<string>();
  return value.artifactBlobs.every((blob) => {
    if (!hasOnlyKeys(blob, ["path", "headSha", "content"]) || !isSafePath(blob.path) || !optionalGitSha(blob.headSha) ||
      !boundedUtf8Text(blob.content, MAX_RELEASE_CANDIDATE_ARTIFACT_BYTES) || paths.has(blob.path)) return false;
    paths.add(blob.path);
    return true;
  });
}

function isV2Check(value: unknown): boolean {
  return hasOnlyKeys(value, ["name", "status", "summary", "url", "workflowExecutionIdentity"]) && boundedUtf8Text(value.name, 500) &&
    isCheckStatus(value.status) && optionalBoundedUtf8Text(value.summary, 8_000) && optionalBoundedUtf8Text(value.url, 500) &&
    (value.workflowExecutionIdentity === undefined || isV2WorkflowIdentity(value.workflowExecutionIdentity));
}

function isV2Log(value: unknown): boolean {
  return hasOnlyKeys(value, ["source", "text", "status", "url"]) && boundedUtf8Text(value.source, 500) && boundedUtf8Text(value.text, 24_000) &&
    (value.status === undefined || isCheckStatus(value.status)) && optionalBoundedUtf8Text(value.url, 500);
}

function isV2WorkflowIdentity(value: unknown): boolean {
  return hasExactKeys(value, ["version", "kind", "workflowPath", "workflowName", "workflowId", "runId", "runAttempt", "jobId", "jobName", "headSha", "checkEvidenceRef"]) &&
    value.version === 1 && value.kind === "workflow_execution_identity" && isSafePath(value.workflowPath) && boundedUtf8Text(value.workflowName, 500) &&
    boundedUtf8Text(value.jobName, 500) && isGitSha(value.headSha) && boundedUtf8Text(value.checkEvidenceRef, 200) &&
    [value.workflowId, value.runId, value.runAttempt, value.jobId].every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
}

function isV2ExecutionSuite(value: unknown): boolean {
  return hasExactKeys(value, ["headSha", "status", "executionSource", "runner", "scope", "testPaths"]) && isGitSha(value.headSha) &&
    isCheckStatus(value.status) && boundedUtf8Text(value.executionSource, 500) && ["node_test", "pytest", "go_test", "cargo_test"].includes(String(value.runner)) &&
    ["repository_discovery", "explicit_paths", "unknown"].includes(String(value.scope)) && boundedArray(value.testPaths, 120) && value.testPaths.every(isSafePath);
}

function isV2ResolvedHeadModule(value: unknown): boolean {
  return hasExactKeys(value, ["version", "kind", "headSha", "path", "blobSha", "source"]) && value.version === 1 && value.kind === "resolved_head_module" &&
    isGitSha(value.headSha) && isSafePath(value.path) && isGitSha(value.blobSha) && boundedUtf8Text(value.source, MAX_RELEASE_CANDIDATE_ARTIFACT_BYTES);
}

function isV2SourceProvenance(value: unknown): boolean {
  if (!hasOnlyKeys(value, ["version", "origin", "headSha", "baseSha", "changedFileInventory", "executionSuites", "evidenceCapturedAt", "inputFingerprint"]) ||
    value.version !== 1 || !["github_snapshot", "pasted_evidence", "demo"].includes(String(value.origin)) || !optionalGitSha(value.headSha) ||
    !optionalGitSha(value.baseSha) || !boundedUtf8Text(value.evidenceCapturedAt, 100) || !hasExactKeys(value.inputFingerprint, ["version", "algorithm", "value", "coverage"]) ||
    value.inputFingerprint.version !== 1 || value.inputFingerprint.algorithm !== "sha256" || !isDigest(value.inputFingerprint.value) ||
    !["github_metadata", "pasted_metadata", "demo_fixture"].includes(String(value.inputFingerprint.coverage))) return false;
  return (value.changedFileInventory === undefined || hasOnlyKeys(value.changedFileInventory, ["version", "completeness", "headSha"]) &&
    value.changedFileInventory.version === 1 && ["complete", "incomplete"].includes(String(value.changedFileInventory.completeness)) && optionalGitSha(value.changedFileInventory.headSha)) &&
    (value.executionSuites === undefined || boundedArray(value.executionSuites, 12) && value.executionSuites.every(isV2ExecutionSuite));
}

function hasExactContractSourceV2(value: NonNullable<PullRequestInput["verificationContractSourceV2"]>): boolean {
  return value.kind === "provided_requirement"
    ? hasExactKeys(value, ["kind", "contract"])
    : hasExactKeys(value, ["kind", "title", "body"]) && boundedUtf8Text(value.title, 500) && boundedUtf8Text(value.body, 24_000);
}

function hasExactContractBindingV2(value: NonNullable<PullRequestInput["verificationContractBindingV2"]>): boolean {
  return hasExactKeys(value, ["sourceKind", "sourceIdentity", "sourceContent", "headSha", "baseSha"]) &&
    ["linked_issue", "provided_requirement", "pr_description"].includes(value.sourceKind) &&
    boundedUtf8Text(value.sourceIdentity, 500) && boundedUtf8Text(value.sourceContent, 24_000) &&
    /^[a-f0-9]{40}$/.test(value.headSha) && /^[a-f0-9]{40}$/.test(value.baseSha);
}

function candidateCapabilityV2(criterion: VerificationReportV2["verificationContract"]["objectives"][number]["criteria"][number]): CandidateCriterionCapabilityV2 {
  if (criterion.type === "absence") return "path_change_absence";
  if (criterion.type === "return_value") return "return_value";
  if (criterion.artifactKind === "documentation_literal") return "documentation_literal";
  if (criterion.artifactKind === "workflow_job") return "workflow_job";
  if (criterion.artifactKind === "test_case") return "test_case";
  throw new Error("V2 criterion capability is unavailable.");
}

function candidateCriterionStateV2(state: string): CandidateCriterionStateV2 {
  return state === "satisfied" || state === "violated" ? state : "unavailable";
}

function candidateOutcomeV2(status: string): "met" | "partial" | "missing" | "unclear" {
  return status === "met" || status === "partial" || status === "missing" ? status : "unclear";
}

function runCandidateCase(candidate: ReleaseCandidateCaseV1, nextReceiptHandle: () => string): ReleaseCandidateResultV1 {
  const startedAt = performance.now();
  let failureStage: ReleaseCandidateFailureStage = "report_generation";
  try {
    const report = generateReceiptValidatedReport(candidate.input);
    failureStage = "requirement_projection";
    const privateReceipts = report.proofGraph.privateReceiptBundleV2;
    const testReceiptCounts = countReceipts(privateReceipts?.testRelationReceipts ?? []);
    const executionReceiptCounts = countReceipts(privateReceipts?.executionBindingReceipts ?? []);
    const requirements = candidate.requirementOrdinals.map((ordinal) => {
      const finding = report.requirements[ordinal];
      if (!finding) throw new Error("Release candidate requirement ordinal is unavailable.");
      const stableOracleId = `case:${candidate.caseId}:ordinal:${ordinal}`;
      const testCount = testReceiptCounts.get(finding.requirementId) ?? 0;
      const executionCount = executionReceiptCounts.get(finding.requirementId) ?? 0;
      return {
        stableOracleId,
        ordinal,
        axisStates: safeAxisStates(finding, testCount, executionCount),
        testReceiptIds: opaqueHandles(testCount, nextReceiptHandle),
        executionReceiptIds: opaqueHandles(executionCount, nextReceiptHandle),
        localCiAssociation: localCiAssociation(finding),
        outcome: finding.status
      };
    });

    failureStage = "privacy_projection";
    const privateReceiptLeakCount = projectionPrivateReceiptLeakCount(report);
    return {
      version: 1,
      caseId: candidate.caseId,
      actual: {
        sourceKind: releaseSourceKind(report),
        authority: report.requirements[0]?.sourceAuthority ?? "authoritative",
        requirements,
        projection: { privateReceiptLeakCount }
      },
      metrics: {
        unexpectedFailure: false,
        durationMs: performance.now() - startedAt,
        github: { requests: 0, pages: 0, retries: 0 },
        providerCallCount: 0
      }
    };
  } catch {
    return failedCandidateCase(candidate, performance.now() - startedAt, failureStage);
  }
}

function generateReceiptValidatedReport(input: PullRequestInput): VerificationReport {
  const report = generateVerificationReportV2FromInput(input, {
    requirementLocalPromotionMode: "receipt_v2",
    verificationCapabilitiesV2: RELEASE_CAPABILITIES
  });
  const validation = validateRuntimeReportBoundary({
    boundary: "generated_private_full",
    input,
    report,
    requireV2: true,
    requirementLocalPromotionMode: "receipt_v2",
    verificationCapabilitiesV2: RELEASE_CAPABILITIES
  });
  if (!validation.valid) throw new Error("Release candidate report failed generated-private validation.");
  return validation.report;
}

function safeAxisStates(
  requirement: RequirementFinding,
  testReceiptCount: number,
  executionReceiptCount: number
): ReleaseCandidateRequirementResultV1["axisStates"] {
  const states: ReleaseCandidateRequirementResultV1["axisStates"] = {
    implementation: "incomplete",
    targeted_test: "incomplete",
    execution: "incomplete"
  };
  for (const axis of requirement.proofAxes ?? []) {
    if (axis.role === "criterion" && axis.subject === "implementation") continue;
    if (axis.subject === "implementation" || axis.subject === "targeted_test" || axis.subject === "execution") {
      states[axis.subject] = axis.state;
    }
  }
  if (testReceiptCount === 0 && states.targeted_test === "satisfied") states.targeted_test = "incomplete";
  if (executionReceiptCount === 0 && states.execution === "satisfied") states.execution = "incomplete";
  return states;
}

function releaseSourceKind(report: VerificationReport): string {
  const contract = (report as Partial<VerificationReportV2>).verificationContract;
  if (contract?.state === "authoritative" && contract.source) return contract.source.kind;
  return report.analysisContext ?? "provided_requirement";
}

function localCiAssociation(requirement: RequirementFinding): "associated" | "local" | "unknown" {
  const execution = requirement.proofAxes?.find((axis) => axis.subject === "execution");
  if (execution?.state === "satisfied") return "associated";
  return execution?.evidenceRefs.length ? "local" : "unknown";
}

function projectionPrivateReceiptLeakCount(report: VerificationReport): number {
  const signingSecret = randomBytes(32).toString("hex");
  const privateHandles = privateReceiptHandleSet(report.proofGraph.privateReceiptBundleV2);
  const sharePayload = encodeReportForShare(report);
  const tenantReport = prepareTenantDetailReportForStorage(report, "verified_agentproof", signingSecret);
  const tenantJson = JSON.stringify(projectTenantPersistedReport(tenantReport, signingSecret));
  return countSerializedProjectionLeaksV1(sharePayload, tenantJson, signingSecret, privateHandles);
}

export function countSerializedProjectionLeaksV1(
  sharePayload: string,
  tenantJson: string,
  signingSecret: string,
  privateHandles: ReadonlySet<string>
): number {
  let count = 0;
  let shareProjection: unknown;
  let tenantProjection: unknown;
  try {
    shareProjection = JSON.parse(Buffer.from(sharePayload, "base64url").toString("utf8")) as unknown;
    decodeSharedReport(sharePayload);
  } catch {
    count += 1;
  }
  try {
    tenantProjection = JSON.parse(tenantJson) as unknown;
    if (!validateTenantPersistedReport(tenantProjection, signingSecret).valid) count += 1;
  } catch {
    count += 1;
  }
  return count + countPrivateProjectionLeaks(shareProjection, privateHandles) +
    countPrivateProjectionLeaks(tenantProjection, privateHandles);
}

function privateReceiptHandleSet(bundle: VerificationReport["proofGraph"]["privateReceiptBundleV2"]): Set<string> {
  const ids = new Set<string>();
  for (const collection of Object.values(bundle ?? {})) {
    if (!Array.isArray(collection)) continue;
    for (const receipt of collection) {
      if (isRecord(receipt) && typeof receipt.id === "string") ids.add(receipt.id);
    }
  }
  return ids;
}

function countPrivateProjectionLeaks(value: unknown, privateHandles: ReadonlySet<string>): number {
  if (Array.isArray(value)) return value.reduce((count, item) => count + countPrivateProjectionLeaks(item, privateHandles), 0);
  if (!isRecord(value)) {
    if (typeof value !== "string") return 0;
    return [...privateHandles].filter((handle) => value.includes(handle)).length;
  }
  return Object.entries(value).reduce((count, [key, item]) =>
    count + (PRIVATE_RECEIPT_COLLECTION_KEYS.has(key) ? 1 : 0) + countPrivateProjectionLeaks(item, privateHandles), 0);
}

function countReceipts(receipts: Array<{ requirementId?: string; subjectRequirementId?: string }>): Map<string, number> {
  return receipts.reduce((counts, receipt) => {
    const requirementId = receipt.requirementId ?? receipt.subjectRequirementId;
    return requirementId ? counts.set(requirementId, (counts.get(requirementId) ?? 0) + 1) : counts;
  }, new Map<string, number>());
}

function opaqueReceiptHandleAllocator(): () => string {
  let index = 0;
  return () => `receipt_${(++index).toString(36).padStart(8, "0")}`;
}

function opaqueHandles(count: number, nextReceiptHandle: () => string): string[] {
  return Array.from({ length: count }, nextReceiptHandle);
}

function failedCandidateCase(
  candidate: ReleaseCandidateCaseV1,
  durationMs: number,
  failureStage: ReleaseCandidateFailureStage
): ReleaseCandidateResultV1 {
  return {
    version: 1,
    caseId: candidate.caseId,
    actual: {
      sourceKind: "unknown",
      authority: "unknown",
      requirements: candidate.requirementOrdinals.map((ordinal) => ({
        stableOracleId: `case:${candidate.caseId}:ordinal:${ordinal}`,
        ordinal,
        axisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
        testReceiptIds: [],
        executionReceiptIds: [],
        localCiAssociation: "unknown",
        outcome: "unclear"
      })),
      projection: { privateReceiptLeakCount: 1 }
    },
    metrics: {
      unexpectedFailure: true,
      durationMs,
      github: { requests: 0, pages: 0, retries: 0 },
      providerCallCount: 0,
      failureStage
    }
  };
}

function hasExactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isPullRequestInput(value: unknown): value is PullRequestInput {
  return isRecord(value) && typeof value.title === "string" && typeof value.description === "string" &&
    typeof value.taskText === "string" && Array.isArray(value.changedFiles) && Array.isArray(value.checks) && Array.isArray(value.logs);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,160}$/.test(value);
}

function isV2CaseId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function boundedUtf8Text(value: unknown, maxBytes: number): value is string {
  return typeof value === "string" && !value.includes("\0") && Buffer.byteLength(value, "utf8") <= maxBytes;
}

function optionalBoundedUtf8Text(value: unknown, maxBytes: number): boolean {
  return value === undefined || boundedUtf8Text(value, maxBytes);
}

function boundedArray(value: unknown, maxItems: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maxItems;
}

function optionalArray(value: unknown, maxItems: number): boolean {
  return value === undefined || boundedArray(value, maxItems);
}

function optionalStringArray(value: unknown, maxItems: number, maxBytes: number): boolean {
  return value === undefined || boundedArray(value, maxItems) && value.every((item) => boundedUtf8Text(item, maxBytes));
}

function isV2BoundedRecord(value: unknown): boolean {
  return isRecord(value) && serializedBytes(value) <= 24_000;
}

function isSafePath(value: unknown): value is string {
  return typeof value === "string" && /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,200}$/.test(value);
}

function optionalSafePath(value: unknown): boolean {
  return value === undefined || isSafePath(value);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function optionalDigest(value: unknown): boolean {
  return value === undefined || isDigest(value);
}

function isGitSha(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
}

function optionalGitSha(value: unknown): boolean {
  return value === undefined || isGitSha(value);
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isCheckStatus(value: unknown): boolean {
  return value === "passed" || value === "failed" || value === "pending" || value === "unknown";
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
