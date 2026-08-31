import { createUnverifiedAuthenticity } from "./report-authenticity";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import type { GeneralPrAssessmentSummaryV1, HybridPlannerProvenance, PortableHybridPlannerProvenance, PublicProofGraph, SourceProvenance, VerificationReport, VerificationReportV2 } from "./types";
import type { VerificationContractReportV2 } from "./verification-contract-v2";
import { redactSecrets } from "./redact";

export const MAX_SHARE_PAYLOAD_LENGTH = 18_000;
export const SUMMARY_ONLY_LIMITATION =
  "Shared report omits raw evidence, patch/log excerpts, claims, proof-graph evidence refs, and re-prompt text.";
const SUMMARY_PROOF_RAW_TEXT_PATTERN = /\b(Patch excerpt|raw_details|raw diff|raw log|full log|raw patch|raw annotation|BEGIN PRIVATE KEY)\b/i;

interface ShareableReportV1 {
  version: 1;
  createdAt: string;
  source: VerificationReport["source"];
  summary: VerificationReport["summary"];
  requirements: Array<Pick<VerificationReport["requirements"][number], "requirementId" | "requirementText" | "status" | "evidenceStatus" | "sourceAuthority" | "gaps" | "reviewerNote" | "confidence" | "proofAxes" | "classificationBasis" | "plannerAxisSubjects">>;
  testing: VerificationReport["testing"];
  reviewPriority: VerificationReport["reviewPriority"];
  proofGraph: PublicProofGraph;
  limitations: string[];
}

interface ShareableReportV2 extends Omit<ShareableReportV1, "version" | "source"> {
  version: 2;
  source: {
    title: string;
    url?: string;
    author?: string;
    baseBranch?: string;
    headBranch?: string;
    provenance?: SourceProvenance;
  };
  scope: Pick<VerificationReport["scope"], "suspected" | "outOfScopeFiles" | "reasons">;
  planner?: HybridPlannerProvenance;
}

interface ShareableReportV3 extends Omit<ShareableReportV2, "version" | "planner"> {
  version: 3;
  planner?: PortableHybridPlannerProvenance;
}

interface ShareableReportV4 extends Omit<ShareableReportV3, "version"> {
  version: 4;
  reportSchemaVersion: "verification-report.v2";
  verificationContract: Omit<VerificationContractReportV2, "integrity" | "gaps">;
  generalPrAssessmentSummary?: GeneralPrAssessmentSummaryV1;
}

type ShareableReport = ShareableReportV1 | ShareableReportV2 | ShareableReportV3 | ShareableReportV4;

export function encodeReportForShare(report: VerificationReport): string {
  return encodeBase64Url(JSON.stringify(toShareableReport(report)));
}

export function decodeSharedReport(payload: string): VerificationReport {
  const shared = parseShareableReport(JSON.parse(decodeBase64Url(payload)) as unknown);
  const report = shareableToReport(shared);
  const validation = validateRuntimeReportBoundary({ boundary: "signed_summary_read", report });
  if (!validation.valid) {
    throw new Error("Shared report payload failed summary validation.");
  }
  return report;
}

export function sanitizeReportForShare(report: VerificationReport): VerificationReport {
  return shareableToReport(toShareableReport(report));
}

export function buildShareUrl(report: VerificationReport, origin: string): string {
  const payload = encodeReportForShare(report);

  if (payload.length > MAX_SHARE_PAYLOAD_LENGTH) {
    throw new Error("Report is too large for a portable share link. Use Copy Report or Download instead.");
  }

  return `${origin}/reports/share#report=${payload}`;
}

function toShareableReport(report: VerificationReport): ShareableReportV3 | ShareableReportV4 {
  const base: ShareableReportV3 = {
    version: 3,
    createdAt: redactSecrets(report.createdAt),
    source: {
      title: redactSecrets(report.source.title),
      url: report.source.url ? redactSecrets(report.source.url) : undefined,
      author: report.source.author ? redactSecrets(report.source.author) : undefined,
      baseBranch: report.source.baseBranch ? redactSecrets(report.source.baseBranch) : undefined,
      headBranch: report.source.headBranch ? redactSecrets(report.source.headBranch) : undefined,
      provenance: sanitizeSourceProvenance(report.source.provenance)
    },
    summary: {
      oneLine: redactSecrets(report.summary.oneLine),
      confidence: report.summary.confidence,
      priority: report.summary.priority,
      evidenceCoverage: report.summary.evidenceCoverage,
      topRisks: report.summary.topRisks.map(redactSecrets)
    },
    requirements: report.requirements.map((requirement) => ({
      requirementId: redactSecrets(requirement.requirementId),
      requirementText: redactSecrets(requirement.requirementText),
      status: requirement.status,
      ...(requirement.evidenceStatus ? { evidenceStatus: requirement.evidenceStatus } : {}),
      ...(requirement.sourceAuthority ? { sourceAuthority: requirement.sourceAuthority } : {}),
      gaps: requirement.gaps.map(redactSecrets),
      reviewerNote: redactSecrets(requirement.reviewerNote),
      confidence: requirement.confidence,
      ...(requirement.classificationBasis ? { classificationBasis: requirement.classificationBasis } : {}),
      ...(requirement.plannerAxisSubjects ? { plannerAxisSubjects: [...requirement.plannerAxisSubjects] } : {}),
      ...(requirement.proofAxes ? {
        proofAxes: requirement.proofAxes.map((axis) => ({
          ...(axis.axisId ? { axisId: axis.axisId } : {}),
          ...(axis.role ? { role: axis.role } : {}),
          ...(axis.criterionId ? { criterionId: axis.criterionId } : {}),
          subject: axis.subject,
          polarity: axis.polarity,
          state: axis.state,
          evidenceRefs: [],
          ...(axis.collectionBasis ? { collectionBasis: axis.collectionBasis } : {})
        }))
      } : {})
    })),
    testing: {
      ...report.testing,
      missingTests: report.testing.missingTests.map((item) => ({
        path: redactSecrets(item.path),
        why: redactSecrets(item.why),
        evidenceRefs: []
      }))
    },
    reviewPriority: report.reviewPriority.map((item) => ({
      path: redactSecrets(item.path),
      reason: redactSecrets(item.reason),
      priority: item.priority
    })),
    proofGraph: sanitizeProofGraphForShare(report.proofGraph),
    scope: {
      suspected: report.scope.suspected,
      outOfScopeFiles: report.scope.outOfScopeFiles.map(redactSecrets),
      reasons: report.scope.reasons.map(redactSecrets)
    },
    ...(report.planner ? { planner: copyPortablePlannerProvenance(report.planner) } : {}),
    limitations: appendSummaryOnlyLimitation(report.limitations.map(redactSecrets))
  };
  if (!isVerificationReportV2(report)) return base;
  return {
    ...base,
    version: 4,
    reportSchemaVersion: "verification-report.v2",
    verificationContract: portableVerificationContract(report.verificationContract),
    ...(report.generalPrAssessmentSummary ? {
      generalPrAssessmentSummary: copyGeneralPrAssessmentSummary(report.generalPrAssessmentSummary)
    } : {})
  };
}

function shareableToReport(shared: ShareableReport): VerificationReport {
  const scope = shared.version !== 1
    ? shared.scope
    : {
      // Version 1 links omitted the deterministic field. Keep only a clearly
      // labelled legacy approximation; never present it as a verified report.
      suspected: shared.summary.topRisks.some((risk) => /scope/i.test(risk)),
      outOfScopeFiles: [],
      reasons: shared.summary.topRisks.filter((risk) => /scope/i.test(risk))
    };
  const report: VerificationReport = {
    analysisId: `shared_${shared.createdAt}`,
    createdAt: shared.createdAt,
    source: shared.source,
    summary: shared.summary,
    requirements: shared.requirements.map((requirement) => ({
      ...requirement,
      evidenceRefs: []
    })),
    claims: [],
    scope,
    testing: {
      ...shared.testing,
      missingTests: shared.testing.missingTests.map((item) => ({
        ...item,
        evidenceRefs: []
      }))
    },
    reviewPriority: shared.reviewPriority,
    proofGraph: sanitizeProofGraphForShare(shared.proofGraph),
    reprompt: {
      targetAgent: "codex",
      prompt: "Shared summary links omit re-prompt text. Open the original report owner session or copy the full report for re-prompt details."
    },
    evidenceIndex: [],
    limitations: appendPortableTrustLimitation(shared.limitations, shared.version === 4 ? 3 : shared.version),
    ...(shared.version !== 1 && shared.planner ? {
      // VerificationReport intentionally keeps the private planner tuple strict.
      // Runtime summary validation is the boundary that admits this hashless
      // portable projection only under portable_unverified authenticity.
      planner: copyPortablePlannerProvenance(shared.planner) as HybridPlannerProvenance
    } : {}),
    authenticity: createUnverifiedAuthenticity(
      shared.version === 1 ? "legacy_unverified" : "portable_unverified",
      shared.version === 4 ? "verification-report.v2" : "verification-report.v1"
    )
  };
  if (shared.version !== 4) return report;
  return {
    ...report,
    reportSchemaVersion: "verification-report.v2",
    verificationContract: {
      ...shared.verificationContract,
      gaps: portableVerificationContractGaps(shared.verificationContract.state)
    },
    ...(shared.generalPrAssessmentSummary ? {
      generalPrAssessmentSummary: copyGeneralPrAssessmentSummary(shared.generalPrAssessmentSummary)
    } : {})
  } as VerificationReportV2;
}

function parseShareableReport(value: unknown): ShareableReport {
  if (!isPlainRecord(value)) throw new Error("Shared report payload is invalid.");
  const version = value.version;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4) throw new Error("Shared report version is not supported.");
  assertOnlyShareableKeys(value, version === 4
    ? ["version", "createdAt", "source", "summary", "requirements", "testing", "reviewPriority", "proofGraph", "scope", "planner", "limitations", "reportSchemaVersion", "verificationContract", "generalPrAssessmentSummary"]
    : version === 2 || version === 3
    ? ["version", "createdAt", "source", "summary", "requirements", "testing", "reviewPriority", "proofGraph", "scope", "planner", "limitations"]
    : ["version", "createdAt", "source", "summary", "requirements", "testing", "reviewPriority", "proofGraph", "limitations"], "report");
  if (!Array.isArray(value.requirements) || !isPlainRecord(value.proofGraph) || !Array.isArray(value.reviewPriority) ||
      !isPlainRecord(value.testing) || !Array.isArray(value.testing.missingTests) || !Array.isArray(value.limitations) ||
      !isPlainRecord(value.source) || !isPlainRecord(value.summary)) {
    throw new Error("Shared report payload is invalid.");
  }
  if ((version === 2 || version === 3 || version === 4) && !isPlainRecord(value.scope)) throw new Error("Shared report is missing deterministic scope state.");
  for (const requirement of value.requirements) validateShareableRequirement(requirement);
  validateShareableProofGraph(value.proofGraph);
  if (value.planner !== undefined) validateShareablePlanner(value.planner, version === 4 ? 3 : version);
  if (version === 4) validateShareableVerificationContract(value);
  if (version === 4 && value.generalPrAssessmentSummary !== undefined) validateShareableGeneralPrAssessmentSummary(value.generalPrAssessmentSummary);
  return value as unknown as ShareableReport;
}

function portableVerificationContract(contract: VerificationContractReportV2): Omit<VerificationContractReportV2, "integrity" | "gaps"> {
  const { integrity: _integrity, gaps: _gaps, ...portable } = contract;
  return {
    ...structuredClone(portable),
    objectives: portable.objectives.map((objective) => ({
      ...objective,
      criteria: objective.criteria.map((criterion) => ({
        ...criterion,
        label: redactSecrets(criterion.label)
      })),
      criterionResults: objective.criterionResults.map((result) => ({
        ...result,
        proofAxisRefs: [...result.proofAxisRefs],
        evidenceRefs: [],
        gapKinds: [...result.gapKinds]
      }))
    }))
  };
}

function portableVerificationContractGaps(state: VerificationContractReportV2["state"]): VerificationContractReportV2["gaps"] {
  if (state === "absent") return [{ kind: "verification_contract_missing", message: "Approved verification contract is missing." }];
  if (state === "invalid") return [{ kind: "verification_contract_invalid", message: "Verification contract could not be validated." }];
  return [];
}

function isVerificationReportV2(report: VerificationReport): report is VerificationReportV2 {
  return (report as Partial<VerificationReportV2>).reportSchemaVersion === "verification-report.v2";
}

function validateShareableVerificationContract(value: Record<string, unknown>): void {
  if (value.reportSchemaVersion !== "verification-report.v2" || !isPlainRecord(value.verificationContract)) {
    throw new Error("Shared v2 report contract is invalid.");
  }
  assertOnlyShareableKeys(value.verificationContract, ["version", "policy", "state", "source", "objectives"], "verificationContract");
  if (value.verificationContract.version !== 2 || value.verificationContract.policy !== "strict_typed_contract" ||
    !Array.isArray(value.verificationContract.objectives)) {
    throw new Error("Shared v2 report contract is invalid.");
  }
}

function validateShareableGeneralPrAssessmentSummary(value: unknown): void {
  if (!isPlainRecord(value)) throw new Error("Shared report assessment is invalid.");
  assertOnlyShareableKeys(value, ["version", "mode", "sourceState", "overallConclusion", "counts", "reasonCodes"], "assessment");
  if (!isPlainRecord(value.counts) || !Array.isArray(value.reasonCodes)) {
    throw new Error("Shared report assessment is invalid.");
  }
}

function copyGeneralPrAssessmentSummary(assessment: GeneralPrAssessmentSummaryV1): GeneralPrAssessmentSummaryV1 {
  return {
    version: assessment.version,
    mode: assessment.mode,
    sourceState: assessment.sourceState,
    overallConclusion: assessment.overallConclusion,
    counts: { ...assessment.counts },
    reasonCodes: [...assessment.reasonCodes]
  };
}

function validateShareableRequirement(value: unknown) {
  if (!isPlainRecord(value)) throw new Error("Shared report requirement is invalid.");
  assertOnlyShareableKeys(value, ["requirementId", "requirementText", "status", "evidenceStatus", "sourceAuthority", "gaps", "reviewerNote", "confidence", "proofAxes", "classificationBasis", "plannerAxisSubjects"], "requirement");
}

function validateShareableProofGraph(value: Record<string, unknown>) {
  assertOnlyShareableKeys(value, ["version", "nodes", "context", "summary"], "proofGraph");
  if (!Array.isArray(value.nodes) || !Array.isArray(value.context) || !isPlainRecord(value.summary)) {
    throw new Error("Shared report proofGraph is invalid.");
  }
  for (const node of value.nodes) {
    if (!isPlainRecord(node)) throw new Error("Shared report proof node is invalid.");
    assertOnlyShareableKeys(node, ["requirementId", "requirementText", "sourceRole", "sourceQuality", "sourceSection", "contextRoles", "status", "confidence", "implementationEvidenceRefs", "targetedTestEvidenceRefs", "executionEvidenceRefs", "gapSignals", "firstFiles", "classificationBasis"], "proofGraph node");
    if (!Array.isArray(node.contextRoles) || !Array.isArray(node.implementationEvidenceRefs) ||
        !Array.isArray(node.targetedTestEvidenceRefs) || !Array.isArray(node.executionEvidenceRefs) ||
        !Array.isArray(node.gapSignals) || !Array.isArray(node.firstFiles)) {
      throw new Error("Shared report proof node is invalid.");
    }
  }
}

function validateShareablePlanner(value: unknown, version: 1 | 2 | 3) {
  if (!isPlainRecord(value)) throw new Error("Shared report planner is invalid.");
  if (version === 1) throw new Error("Shared report planner is invalid.");
  const requiredKeys = version === 2
    ? ["version", "contractVersion", "schemaVersion", "promptVersion", "model", "inputHash"]
    : ["version", "contractVersion", "schemaVersion", "promptVersion", "model"];
  assertOnlyShareableKeys(value, requiredKeys, "planner");
  if (requiredKeys.some((key) => !(key in value)) ||
      value.version !== 1 ||
      value.contractVersion !== "hybrid_requirement_planner.v1" ||
      value.schemaVersion !== "agentproof_requirement_span_plan_v1" ||
      value.promptVersion !== "2026-08-12.v1" ||
      value.model !== "gpt-5-mini" ||
      (version === 2 && (typeof value.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(value.inputHash)))) {
    throw new Error("Shared report planner is invalid.");
  }
}

function assertOnlyShareableKeys(value: Record<string, unknown>, allowed: readonly string[], context: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`Shared report ${context} has unknown fields.`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeSourceProvenance(provenance: SourceProvenance | undefined): SourceProvenance | undefined {
  if (!provenance) return undefined;
  return {
    version: provenance.version,
    origin: provenance.origin,
    ...(provenance.headSha ? { headSha: redactSecrets(provenance.headSha) } : {}),
    ...(provenance.baseSha ? { baseSha: redactSecrets(provenance.baseSha) } : {}),
    ...(provenance.changedFileInventory ? {
      changedFileInventory: {
        version: provenance.changedFileInventory.version,
        completeness: provenance.changedFileInventory.completeness,
        ...(provenance.changedFileInventory.headSha ? { headSha: redactSecrets(provenance.changedFileInventory.headSha) } : {})
      }
    } : {}),
    evidenceCapturedAt: redactSecrets(provenance.evidenceCapturedAt),
    inputFingerprint: {
      ...provenance.inputFingerprint,
      value: redactSecrets(provenance.inputFingerprint.value)
    }
  };
}

function copyPortablePlannerProvenance(planner: PortableHybridPlannerProvenance): PortableHybridPlannerProvenance {
  return {
    version: planner.version,
    contractVersion: planner.contractVersion,
    schemaVersion: planner.schemaVersion,
    promptVersion: planner.promptVersion,
    model: planner.model
  };
}

function appendPortableTrustLimitation(limitations: string[], version: 1 | 2 | 3): string[] {
  const limitation = version === 1
    ? "Legacy portable share links are unverified summaries; deterministic scope state was not preserved by the legacy envelope."
    : "Portable share links are imported, unverified summaries. Do not treat them as server-verified AgentProof artifacts.";
  return limitations.includes(limitation) ? limitations : [...limitations, limitation];
}

function sanitizeProofGraphForShare(proofGraph: VerificationReport["proofGraph"] | undefined): PublicProofGraph {
  const nodes = (proofGraph?.nodes ?? []).map((node) => ({
    requirementId: redactSecrets(node.requirementId),
    requirementText: summaryProofText(node.requirementText, "Requirement proof text omitted from summary view."),
    sourceRole: node.sourceRole,
    sourceQuality: node.sourceQuality,
    sourceSection: node.sourceSection ? summaryProofText(node.sourceSection, "source-section") : null,
    contextRoles: node.contextRoles,
    status: node.status,
    confidence: node.confidence,
    implementationEvidenceRefs: [],
    targetedTestEvidenceRefs: [],
    executionEvidenceRefs: [],
    gapSignals: node.gapSignals.map((gap) => ({
      kind: gap.kind,
      severity: gap.severity,
      message: summaryProofText(gap.message, "Proof gap detail omitted from summary view."),
      evidenceRefs: []
    })),
    firstFiles: node.firstFiles.map((path) => summaryProofText(path, "redacted-path")).slice(0, 5),
    ...(node.classificationBasis ? { classificationBasis: node.classificationBasis } : {})
  }));

  return {
    version: 1,
    nodes,
    context: (proofGraph?.context ?? []).map((context) => ({
      id: redactSecrets(context.id),
      source: context.source,
      role: context.role,
      sourceQuality: context.sourceQuality,
      sourceSection: context.sourceSection ? summaryProofText(context.sourceSection, "source-section") : null,
      text: summaryProofText(context.text, "Context text omitted from summary view.")
    })),
    summary: {
      requirementCount: nodes.length,
      requirementsWithImplementation: nodes.filter((node) => node.implementationEvidenceRefs.length > 0).length,
      requirementsWithTargetedTests: nodes.filter((node) => node.targetedTestEvidenceRefs.length > 0).length,
      requirementsWithExecution: nodes.filter((node) => node.executionEvidenceRefs.length > 0).length,
      requirementsWithGaps: nodes.filter((node) => node.gapSignals.length > 0).length,
      gapCount: nodes.reduce((count, node) => count + node.gapSignals.length, 0)
    }
  };
}

function summaryProofText(value: string, fallback: string): string {
  const redacted = redactSecrets(value);
  return SUMMARY_PROOF_RAW_TEXT_PATTERN.test(redacted) ? fallback : redacted;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return base64Encode(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = base64Decode(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function base64Encode(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value);
  }

  return Buffer.from(value, "binary").toString("base64");
}

function base64Decode(value: string): string {
  if (typeof atob === "function") {
    return atob(value);
  }

  return Buffer.from(value, "base64").toString("binary");
}

function appendSummaryOnlyLimitation(limitations: string[]): string[] {
  return limitations.some((limitation) => limitation === SUMMARY_ONLY_LIMITATION)
    ? limitations
    : [...limitations, SUMMARY_ONLY_LIMITATION];
}
