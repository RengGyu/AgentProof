import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, validateTenantPersistedReport } from "./tenant-report-validation";
import type { PullRequestInput, RequirementFinding, VerificationReport } from "./types";
import { generateVerificationReportV2FromInput } from "./verifier";

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
  metrics: { unexpectedFailure: boolean; durationMs: number };
}

export interface ReleaseCandidateResultCorpusV1 {
  version: 1;
  cases: ReleaseCandidateResultV1[];
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

function runCandidateCase(candidate: ReleaseCandidateCaseV1, nextReceiptHandle: () => string): ReleaseCandidateResultV1 {
  const startedAt = performance.now();
  try {
    const report = generateReceiptValidatedReport(candidate.input);
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

    return {
      version: 1,
      caseId: candidate.caseId,
      actual: {
        sourceKind: report.analysisContext ?? "provided_requirement",
        authority: report.requirements[0]?.sourceAuthority ?? "authoritative",
        requirements,
        projection: { privateReceiptLeakCount: projectionPrivateReceiptLeakCount(report) }
      },
      metrics: { unexpectedFailure: false, durationMs: performance.now() - startedAt }
    };
  } catch {
    return failedCandidateCase(candidate, performance.now() - startedAt);
  }
}

function generateReceiptValidatedReport(input: PullRequestInput): VerificationReport {
  const report = generateVerificationReportV2FromInput(input, {
    requirementLocalPromotionMode: "receipt_v2"
  });
  const validation = validateRuntimeReportBoundary({
    boundary: "generated_private_full",
    input,
    report,
    requireV2: true,
    requirementLocalPromotionMode: "receipt_v2"
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
    if (axis.subject === "implementation" || axis.subject === "targeted_test" || axis.subject === "execution") {
      states[axis.subject] = axis.state;
    }
  }
  if (testReceiptCount === 0 && states.targeted_test === "satisfied") states.targeted_test = "incomplete";
  if (executionReceiptCount === 0 && states.execution === "satisfied") states.execution = "incomplete";
  return states;
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

function failedCandidateCase(candidate: ReleaseCandidateCaseV1, durationMs: number): ReleaseCandidateResultV1 {
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
    metrics: { unexpectedFailure: true, durationMs }
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
