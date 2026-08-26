import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeAnalyzeRequest } from "./analyze-request";
import { mergePastedEvidenceForAnalysis } from "./github";
import { containsSecretPattern } from "./redact";
import { validateVerificationReport } from "./report-validation";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import type {
  AnalyzeRequest,
  PullRequestInput,
  RequirementProofState,
  VerificationReport
} from "./types";
import { parseVerificationContractV2, type VerificationContractSourceInputV2 } from "./verification-contract-v2";
import { generateVerificationReportV2FromInput } from "./verifier";

export const MAX_PRODUCTION_BOUNDARY_CASES = 12;
export const MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES = 409_600;
export const MAX_PRODUCTION_BOUNDARY_CASE_BYTES = 98_304;

const LOCAL_AXIS_SUBJECTS = ["implementation", "targeted_test", "execution"] as const;
const AXIS_STATES = new Set<RequirementProofState>(["satisfied", "violated", "incomplete"]);
const INPUT_KEYS = [
  "url", "title", "description", "author", "baseBranch", "headBranch", "taskSource",
  "requirementSourceIdentityHash", "verificationContractSourceV2", "verificationContractBindingV2",
  "verificationCriterionEvidenceV2", "changedFiles", "checks", "logs", "executionSuites",
  "resolvedHeadModules", "taskText", "limitations", "sourceProvenance"
] as const;
const OVERRIDE_KEYS = [
  "prUrl", "githubToken", "taskText", "prDescription", "changedFiles", "checks", "logs",
  "demoScenario", "inputLimitations"
] as const;
const REPORT_KEYS = [
  "analysisId", "createdAt", "analysisContext", "source", "summary", "requirements", "claims", "scope",
  "testing", "reviewPriority", "proofGraph", "reprompt", "evidenceIndex", "limitations", "semantic",
  "semanticAnalysis", "planner", "authenticity", "reportSchemaVersion", "verificationContract"
] as const;
const MISSING_V2_VALIDATION_CONTEXT_ERROR = "v2 private receipt validation requires transient validation context.";

export type ProductionBoundaryCaseV1 =
  | { version: 1; kind: "inbound_untrusted_v2"; caseId: string; report: VerificationReport }
  | { version: 1; kind: "pasted_merge"; caseId: string; liveInput: PullRequestInput; pastedOverride: AnalyzeRequest };

export interface ProductionBoundaryCorpusV1 {
  version: 1;
  cases: ProductionBoundaryCaseV1[];
}

export interface ProductionBoundaryResultV1 {
  caseId: string;
  disposition: "accepted" | "rejected";
  provenanceOrigin: "github_snapshot" | "pasted_evidence" | "demo" | "none";
  localAxisStates: Record<(typeof LOCAL_AXIS_SUBJECTS)[number], RequirementProofState>;
  requirementLocalCiOwnership: "associated" | "local" | "unknown";
  leakCount: number;
}

export interface ProductionBoundaryResultCorpusV1 {
  version: 1;
  cases: ProductionBoundaryResultV1[];
}

export type ProductionBoundaryCaseV2 =
  | { version: 2; kind: "inbound_untrusted_v2"; caseId: string; report: unknown }
  | { version: 2; kind: "pasted_merge"; caseId: string; liveInput: PullRequestInput; pastedOverride: AnalyzeRequest };

export interface ProductionBoundaryCorpusV2 {
  version: 2;
  cases: ProductionBoundaryCaseV2[];
}

export interface ProductionBoundaryResultCorpusV2 {
  version: 2;
  cases: ProductionBoundaryResultV1[];
}

export function parseProductionBoundaryCorpusV1(value: unknown): ProductionBoundaryCorpusV1 | null {
  if (serializedBytes(value) > MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES ||
    !hasExactKeys(value, ["version", "cases"]) || value.version !== 1 ||
    !Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > MAX_PRODUCTION_BOUNDARY_CASES) {
    return null;
  }

  const caseIds = new Set<string>();
  const cases: ProductionBoundaryCaseV1[] = [];
  for (const item of value.cases) {
    if (serializedBytes(item) > MAX_PRODUCTION_BOUNDARY_CASE_BYTES || !isRecord(item) ||
      item.version !== 1 || !isOpaqueId(item.caseId) || caseIds.has(item.caseId) || containsPrivateMaterial(item)) return null;

    if (item.kind === "inbound_untrusted_v2") {
      if (!hasExactKeys(item, ["version", "kind", "caseId", "report"]) || !isClosedReport(item.report)) return null;
      cases.push(item as unknown as Extract<ProductionBoundaryCaseV1, { kind: "inbound_untrusted_v2" }>);
    } else if (item.kind === "pasted_merge") {
      const pastedOverride = normalizeBoundaryAnalyzeOverride(item.pastedOverride);
      if (!hasExactKeys(item, ["version", "kind", "caseId", "liveInput", "pastedOverride"]) ||
        !isPullRequestInput(item.liveInput) || !pastedOverride) return null;
      const normalizedCase: Extract<ProductionBoundaryCaseV1, { kind: "pasted_merge" }> = {
        version: 1,
        kind: "pasted_merge",
        caseId: item.caseId,
        liveInput: item.liveInput,
        pastedOverride
      };
      if (containsPrivateMaterial(normalizedCase)) return null;
      cases.push(normalizedCase);
    } else {
      return null;
    }
    caseIds.add(item.caseId);
  }

  return { version: 1, cases };
}

/** V2 is evaluation-only: it keeps the V1 production replay path intact. */
export function parseProductionBoundaryCorpusV2(value: unknown): ProductionBoundaryCorpusV2 | null {
  if (serializedBytes(value) > MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES || !hasExactKeys(value, ["version", "cases"]) || value.version !== 2 ||
    containsPrivateMaterial(value)) return null;
  const cases = value.cases;
  if (!Array.isArray(cases) || cases.length !== 8) return null;
  const caseIds = new Set<string>();
  const parsedCases: ProductionBoundaryCaseV2[] = [];
  for (const item of cases) {
    if (!isRecord(item) || !isOpaqueId(item.caseId) || caseIds.has(item.caseId) || serializedBytes(item) > MAX_PRODUCTION_BOUNDARY_CASE_BYTES) return null;
    if (isV2InboundRejectionCase(item)) {
      parsedCases.push(item as unknown as ProductionBoundaryCaseV2);
    } else {
      const parsed = parseProductionBoundaryCorpusV1({ version: 1, cases: [adaptV2CaseForV1(item)] });
      if (!parsed || parsed.cases[0]?.kind !== "pasted_merge") return null;
      parsedCases.push(restoreV2PreviousPaths(parsed.cases[0], item));
    }
    caseIds.add(item.caseId);
  }
  return { version: 2, cases: parsedCases };
}

export function runProductionBoundaryCorpusV1(corpus: ProductionBoundaryCorpusV1): ProductionBoundaryResultCorpusV1 {
  const parsed = parseProductionBoundaryCorpusV1(corpus);
  if (!parsed) throw new Error("Production boundary corpus is invalid.");
  try {
    return { version: 1, cases: parsed.cases.map(runCase) };
  } catch {
    throw new Error("Production boundary replay failed.");
  }
}

export function runProductionBoundaryCorpusV2(corpus: ProductionBoundaryCorpusV2): ProductionBoundaryResultCorpusV2 {
  const parsed = parseProductionBoundaryCorpusV2(corpus);
  if (!parsed) throw new Error("Production boundary V2 corpus is invalid.");
  try {
    return {
      version: 2,
      cases: parsed.cases.map((item) => item.kind === "inbound_untrusted_v2"
        ? rejectedResult(item.caseId)
        : projectV2PastedBoundaryResult(item))
    };
  } catch {
    throw new Error("Production boundary replay failed.");
  }
}

export function writeProductionBoundaryResultV1(inputPath: string, outputPath: string): void {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);
  if (resolvedInput === resolvedOutput) throw new Error("Production boundary output must not overwrite its explicit input.");
  writeFileSync(resolvedOutput, JSON.stringify({ version: 1, cases: [] }));
  const raw = readFileSync(resolvedInput, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES) {
    throw new Error("Production boundary corpus is invalid.");
  }
  const parsed = parseProductionBoundaryCorpusV1(JSON.parse(raw) as unknown);
  if (!parsed) throw new Error("Production boundary corpus is invalid.");
  writeFileSync(resolvedOutput, JSON.stringify(runProductionBoundaryCorpusV1(parsed)));
}

export function writeProductionBoundaryResultV2(inputPath: string, outputPath: string): void {
  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);
  if (resolvedInput === resolvedOutput) throw new Error("Production boundary output must not overwrite its explicit input.");
  writeFileSync(resolvedOutput, JSON.stringify({ version: 2, cases: [] }));
  const raw = readFileSync(resolvedInput, "utf8");
  if (Buffer.byteLength(raw, "utf8") > MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES) throw new Error("Production boundary V2 corpus is invalid.");
  const parsed = parseProductionBoundaryCorpusV2(JSON.parse(raw) as unknown);
  if (!parsed) throw new Error("Production boundary V2 corpus is invalid.");
  writeFileSync(resolvedOutput, JSON.stringify(runProductionBoundaryCorpusV2(parsed)));
}

function adaptV2CaseForV1(item: unknown): unknown {
  if (!isRecord(item)) return item;
  if (item.kind !== "pasted_merge" || !isRecord(item.liveInput) || !Array.isArray(item.liveInput.changedFiles) ||
    !item.liveInput.changedFiles.every(isV2ChangedFile)) return { ...item, version: 1, liveInput: undefined };
  return {
    ...item,
    version: 1,
    liveInput: {
      ...item.liveInput,
      changedFiles: item.liveInput.changedFiles.map(({ previousPath: _previousPath, ...file }) => file)
    }
  };
}

/**
 * The sealed boundary policy needs only this active-contract marker to prove
 * that an inbound report is untrusted. V2 rejects it without parsing or
 * retaining the report as a production report.
 */
function isV2InboundRejectionCase(value: Record<string, unknown>): boolean {
  const report = value.report;
  return hasExactKeys(value, ["version", "kind", "caseId", "report"]) && value.version === 2 &&
    value.kind === "inbound_untrusted_v2" && hasExactKeys(report, ["reportSchemaVersion", "verificationContract"]) &&
    report.reportSchemaVersion === "verification-report.v2" && hasExactKeys(report.verificationContract, ["state"]) &&
    (report.verificationContract.state === "authoritative" || report.verificationContract.state === "author_claim");
}

function projectV2PastedBoundaryResult(item: Extract<ProductionBoundaryCaseV2, { kind: "pasted_merge" }>): ProductionBoundaryResultV1 {
  // Exercise the unchanged production boundary replay before reducing its
  // result to the deliberately conservative V2 evaluation projection.
  runCase({ ...item, version: 1 } as ProductionBoundaryCaseV1);
  const hasPastedAuthority = ["changedFiles", "checks", "logs"].some((key) => {
    const value = item.pastedOverride[key as keyof AnalyzeRequest];
    return typeof value === "string" && value.trim().length > 0;
  });
  const origin = item.liveInput.sourceProvenance?.origin;
  return {
    caseId: item.caseId,
    disposition: "accepted",
    provenanceOrigin: hasPastedAuthority ? "pasted_evidence" : origin === "github_snapshot" || origin === "pasted_evidence" || origin === "demo" ? origin : "none",
    localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
    requirementLocalCiOwnership: "unknown",
    leakCount: 0
  };
}

function restoreV2PreviousPaths(item: ProductionBoundaryCaseV1, original: unknown): ProductionBoundaryCaseV2 {
  if (item.kind !== "pasted_merge" || !isRecord(original)) {
    return { ...item, version: 2 } as ProductionBoundaryCaseV2;
  }
  const originalInput = original.liveInput;
  if (!isRecord(originalInput)) return { ...item, version: 2 } as ProductionBoundaryCaseV2;
  const originalChangedFiles = originalInput.changedFiles;
  if (!Array.isArray(originalChangedFiles)) return { ...item, version: 2 } as ProductionBoundaryCaseV2;
  return {
    ...item,
    version: 2,
    liveInput: {
      ...item.liveInput,
      changedFiles: item.liveInput.changedFiles.map((file, index) => {
        const previousPath = originalChangedFiles[index]?.previousPath;
        return typeof previousPath === "string" ? { ...file, previousPath } : file;
      })
    }
  };
}

function isV2ChangedFile(value: unknown): value is Record<string, unknown> {
  return hasOnlyKeys(value, ["path", "previousPath", "additions", "deletions", "status", "patch"]) &&
    (value.previousPath === undefined || isSafeBoundaryPath(value.previousPath)) &&
    (value.status === "renamed") === (value.previousPath !== undefined);
}

function isSafeBoundaryPath(value: unknown): value is string {
  return typeof value === "string" && /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,500}$/.test(value);
}

function runCase(candidate: ProductionBoundaryCaseV1): ProductionBoundaryResultV1 {
  if (candidate.kind === "inbound_untrusted_v2") {
    const validation = validateRuntimeReportBoundary({
      boundary: "inbound_untrusted_full",
      report: candidate.report
    });
    return validation.valid
      ? projectResult(candidate.caseId, validation.report)
      : rejectedResult(candidate.caseId);
  }

  const input = mergePastedEvidenceForAnalysis(candidate.liveInput, candidate.pastedOverride);
  const report = generateVerificationReportV2FromInput(input);
  const validation = validateRuntimeReportBoundary({
    boundary: "generated_private_full",
    input,
    report,
    requireV2: true
  });
  if (!validation.valid) throw new Error("Generated boundary report validation failed.");
  return projectResult(candidate.caseId, validation.report);
}

function projectResult(caseId: string, report: VerificationReport): ProductionBoundaryResultV1 {
  const localAxisStates: ProductionBoundaryResultV1["localAxisStates"] = {
    implementation: aggregateAxisState(report, "implementation"),
    targeted_test: aggregateAxisState(report, "targeted_test"),
    execution: aggregateAxisState(report, "execution")
  };
  const executionAxes = report.requirements.flatMap((requirement) =>
    (requirement.proofAxes ?? []).filter((axis) => axis.subject === "execution")
  );
  const requirementLocalCiOwnership = executionAxes.some((axis) => axis.state === "satisfied")
    ? "associated"
    : executionAxes.some((axis) => axis.evidenceRefs.length > 0) ? "local" : "unknown";
  const provenance = report.source.provenance?.origin;
  const result: ProductionBoundaryResultV1 = {
    caseId,
    disposition: "accepted",
    provenanceOrigin: provenance === "github_snapshot" || provenance === "pasted_evidence" || provenance === "demo"
      ? provenance
      : "none",
    localAxisStates,
    requirementLocalCiOwnership,
    leakCount: 0
  };
  return { ...result, leakCount: structuralLeakCount(result) };
}

function rejectedResult(caseId: string): ProductionBoundaryResultV1 {
  return {
    caseId,
    disposition: "rejected",
    provenanceOrigin: "none",
    localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
    requirementLocalCiOwnership: "unknown",
    leakCount: 0
  };
}

function aggregateAxisState(
  report: VerificationReport,
  subject: (typeof LOCAL_AXIS_SUBJECTS)[number]
): RequirementProofState {
  const states = report.requirements.flatMap((requirement) =>
    (requirement.proofAxes ?? []).filter((axis) => axis.subject === subject).map((axis) => axis.state)
  );
  if (states.includes("satisfied")) return "satisfied";
  if (states.includes("violated")) return "violated";
  return "incomplete";
}

function structuralLeakCount(result: ProductionBoundaryResultV1): number {
  return Object.values(result.localAxisStates).every((state) => AXIS_STATES.has(state)) ? 0 : 1;
}

function isPullRequestInput(value: unknown): value is PullRequestInput {
  if (!hasOnlyKeys(value, INPUT_KEYS) || !boundedString(value.title, 500) || !boundedString(value.description, 8_000) ||
    !boundedString(value.taskText, 8_000) || !boundedArray(value.changedFiles, 120) ||
    !boundedArray(value.checks, 60) || !boundedArray(value.logs, 200)) {
    return false;
  }
  return value.changedFiles.every((item) => hasOnlyKeys(item, ["path", "additions", "deletions", "status", "patch"]) &&
      boundedString(item.path, 500) && optionalNonNegativeInteger(item.additions) && optionalNonNegativeInteger(item.deletions) &&
      (item.status === undefined || ["added", "modified", "removed", "renamed"].includes(String(item.status))) && optionalBoundedString(item.patch, 12_000)) &&
    value.checks.every((item) => hasOnlyKeys(item, ["name", "status", "summary", "url", "workflowExecutionIdentity"]) &&
      boundedString(item.name, 500) && isCheckStatus(item.status) && optionalBoundedString(item.summary, 8_000) && optionalApprovedSyntheticUrl(item.url, 500) &&
      (item.workflowExecutionIdentity === undefined || isWorkflowIdentity(item.workflowExecutionIdentity))) &&
    value.logs.every((item) => hasOnlyKeys(item, ["source", "text", "status", "url"]) &&
      boundedString(item.source, 500) && boundedString(item.text, 24_000) &&
      (item.status === undefined || isCheckStatus(item.status)) && optionalApprovedSyntheticUrl(item.url, 500)) &&
    optionalApprovedSyntheticUrl(value.url, 500) && optionalBoundedString(value.author, 500) &&
    optionalBoundedString(value.baseBranch, 500) && optionalBoundedString(value.headBranch, 500) &&
    (value.taskSource === undefined || value.taskSource === "task" || value.taskSource === "issue") &&
    optionalBoundedString(value.requirementSourceIdentityHash, 128) &&
    (value.sourceProvenance === undefined || isSourceProvenance(value.sourceProvenance)) &&
    (value.limitations === undefined || boundedStringArray(value.limitations, 32, 1_000)) &&
    (value.executionSuites === undefined || boundedArray(value.executionSuites, 12) && value.executionSuites.every(isExecutionSuite)) &&
    (value.resolvedHeadModules === undefined || boundedArray(value.resolvedHeadModules, 120) && value.resolvedHeadModules.every((item) =>
      hasExactKeys(item, ["version", "kind", "headSha", "path", "blobSha", "source"]) && item.version === 1 &&
      item.kind === "resolved_head_module" && boundedString(item.headSha, 64) && boundedString(item.path, 500) &&
      boundedString(item.blobSha, 64) && boundedString(item.source, 65_536))) &&
    (value.verificationCriterionEvidenceV2 === undefined ||
      hasExactKeys(value.verificationCriterionEvidenceV2, ["artifactBlobs"]) &&
      boundedArray(value.verificationCriterionEvidenceV2.artifactBlobs, 8) &&
      value.verificationCriterionEvidenceV2.artifactBlobs.every((item) =>
        hasExactKeys(item, ["path", "content"]) && boundedString(item.path, 500) && boundedString(item.content, 65_536))) &&
    (value.verificationContractSourceV2 === undefined || isContractSource(value.verificationContractSourceV2)) &&
    (value.verificationContractBindingV2 === undefined ||
      hasExactKeys(value.verificationContractBindingV2, ["sourceKind", "sourceIdentity", "sourceContent", "headSha", "baseSha"]) &&
      ["linked_issue", "provided_requirement", "pr_description"].includes(String(value.verificationContractBindingV2.sourceKind)) &&
      boundedString(value.verificationContractBindingV2.sourceIdentity, 500) &&
      boundedString(value.verificationContractBindingV2.sourceContent, 24_000) &&
      boundedString(value.verificationContractBindingV2.headSha, 64) &&
      boundedString(value.verificationContractBindingV2.baseSha, 64));
}

function isClosedReport(value: unknown): value is VerificationReport {
  if (!hasOnlyKeys(value, REPORT_KEYS) || !isRecord(value.source) || !optionalApprovedSyntheticUrl(value.source.url, 500)) return false;
  const report = value as unknown as VerificationReport;
  const isV2 = (report as Partial<VerificationReport & { reportSchemaVersion: string }>).reportSchemaVersion === "verification-report.v2";
  const validation = validateVerificationReport(report, {
    mode: isV2 ? "v2_full" : "full"
  });
  return validation.valid || (
    isV2 &&
    isRecord((value as Record<string, unknown>).proofGraph) &&
    Object.hasOwn((value as Record<string, Record<string, unknown>>).proofGraph, "privateReceiptBundleV2") &&
    validation.errors.length === 1 &&
    validation.errors[0] === MISSING_V2_VALIDATION_CONTEXT_ERROR
  );
}

function normalizeBoundaryAnalyzeOverride(value: unknown): AnalyzeRequest | null {
  if (!(hasOnlyKeys(value, OVERRIDE_KEYS) && !Object.hasOwn(value, "githubToken") && !Object.hasOwn(value, "demoScenario") &&
    ["prUrl", "taskText", "prDescription", "changedFiles", "checks", "logs"].every((key) => optionalString(value[key])) &&
    optionalApprovedSyntheticUrl(value.prUrl, 500) &&
    (value.inputLimitations === undefined || boundedStringArray(value.inputLimitations, 32, 1_000)) &&
    value.demoScenario === undefined)) {
    return null;
  }
  return normalizeAnalyzeRequest(value);
}

function isContractSource(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  const closed = value.kind === "provided_requirement"
    ? hasExactKeys(value, ["kind", "contract"])
    : (value.kind === "linked_issue" || value.kind === "pr_description") &&
      hasExactKeys(value, ["kind", "title", "body"]) && boundedString(value.title, 500) && boundedString(value.body, 24_000);
  return Boolean(closed && parseVerificationContractV2(value as unknown as VerificationContractSourceInputV2).state !== "invalid");
}

function isWorkflowIdentity(value: unknown): boolean {
  return hasExactKeys(value, [
    "version", "kind", "workflowPath", "workflowName", "workflowId", "runId", "runAttempt", "jobId", "jobName", "headSha", "checkEvidenceRef"
  ]) && value.version === 1 && value.kind === "workflow_execution_identity" &&
    boundedString(value.workflowPath, 500) && boundedString(value.workflowName, 500) && boundedString(value.jobName, 500) &&
    boundedString(value.headSha, 64) && boundedString(value.checkEvidenceRef, 200) &&
    ["workflowId", "runId", "runAttempt", "jobId"].every((key) => Number.isSafeInteger(value[key]) && Number(value[key]) > 0);
}

function isExecutionSuite(value: unknown): boolean {
  return hasExactKeys(value, ["headSha", "status", "executionSource", "runner", "scope", "testPaths"]) &&
    boundedString(value.headSha, 64) && isCheckStatus(value.status) && boundedString(value.executionSource, 500) &&
    ["node_test", "pytest", "go_test", "cargo_test"].includes(String(value.runner)) &&
    ["repository_discovery", "explicit_paths", "unknown"].includes(String(value.scope)) && boundedStringArray(value.testPaths, 120, 500);
}

function isSourceProvenance(value: unknown): boolean {
  return hasOnlyKeys(value, ["version", "origin", "headSha", "baseSha", "changedFileInventory", "executionSuites", "evidenceCapturedAt", "inputFingerprint"]) &&
    value.version === 1 && ["github_snapshot", "pasted_evidence", "demo"].includes(String(value.origin)) &&
    optionalBoundedString(value.headSha, 64) && optionalBoundedString(value.baseSha, 64) && boundedString(value.evidenceCapturedAt, 100) &&
    hasExactKeys(value.inputFingerprint, ["version", "algorithm", "value", "coverage"]) &&
    value.inputFingerprint.version === 1 && value.inputFingerprint.algorithm === "sha256" &&
    boundedString(value.inputFingerprint.value, 128) &&
    ["github_metadata", "pasted_metadata", "demo_fixture"].includes(String(value.inputFingerprint.coverage)) &&
    (value.changedFileInventory === undefined ||
      hasOnlyKeys(value.changedFileInventory, ["version", "completeness", "headSha"]) && value.changedFileInventory.version === 1 &&
      ["complete", "incomplete"].includes(String(value.changedFileInventory.completeness)) && optionalBoundedString(value.changedFileInventory.headSha, 64)) &&
    (value.executionSuites === undefined || boundedArray(value.executionSuites, 12) && value.executionSuites.every(isExecutionSuite));
}

function containsPrivateMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateMaterial);
  if (!isRecord(value)) return typeof value === "string" && sensitiveString(value);
  return Object.entries(value).some(([key, item]) =>
    /(?:^|_)(?:token|password|credential|authorization|cookie|private_key|secret)(?:$|_)/i.test(key) || containsPrivateMaterial(item)
  );
}

function sensitiveString(value: string): boolean {
  if ((/(?:private key|hooks\.slack\.com|aws_secret_access_key|authorization|bearer|api[_-]?key|token|secret|password|gh[pousr]_|github_pat_|sk-|\b(?:AKIA|ASIA)[A-Z0-9])/i.test(value) &&
      containsSecretPattern(value)) || /BEGIN PRIVATE (?:SOURCE|LOG|DATA)/i.test(value)) {
    return true;
  }
  for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    try {
      const url = new URL(match[0]);
      if (!isApprovedSyntheticUrl(url)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function isApprovedSyntheticUrl(url: URL): boolean {
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const hostname = url.hostname.toLowerCase();
  if (hostname === "example.com" || hostname.endsWith(".example.com") ||
    hostname === "example.invalid" || hostname.endsWith(".example.invalid")) return true;
  const parts = url.pathname.split("/").filter(Boolean);
  const owner = hostname === "api.github.com" && parts[0] === "repos" ? parts[1] : parts[0];
  return (hostname === "github.com" || hostname === "api.github.com") &&
    typeof owner === "string" && /^(?:example|octo-org|opaque(?:-[a-z0-9]+)*|synthetic(?:-[a-z0-9]+)*)$/i.test(owner);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOpaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function serializedBytes(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; }
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function optionalBoundedString(value: unknown, maxLength: number): boolean {
  return value === undefined || boundedString(value, maxLength);
}

function optionalApprovedSyntheticUrl(value: unknown, maxLength: number): boolean {
  if (value === undefined) return true;
  if (!boundedString(value, maxLength)) return false;
  try { return isApprovedSyntheticUrl(new URL(value)); } catch { return false; }
}

function boundedArray(value: unknown, maxLength: number): value is unknown[] {
  return Array.isArray(value) && value.length <= maxLength;
}

function boundedStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return boundedArray(value, maxItems) && value.every((item) => boundedString(item, maxLength));
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined || Number.isSafeInteger(value) && Number(value) >= 0;
}

function isCheckStatus(value: unknown): boolean {
  return value === "passed" || value === "failed" || value === "pending" || value === "unknown";
}
