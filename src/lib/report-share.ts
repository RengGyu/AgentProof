import type { VerificationReport } from "./types";
import { redactSecrets } from "./redact";

export const MAX_SHARE_PAYLOAD_LENGTH = 18_000;
export const SUMMARY_ONLY_LIMITATION =
  "Shared report omits raw evidence, patch/log excerpts, claims, proof-graph evidence refs, and re-prompt text.";
const SUMMARY_PROOF_RAW_TEXT_PATTERN = /\b(Patch excerpt|raw_details|raw diff|raw log|full log|raw patch|raw annotation|BEGIN PRIVATE KEY)\b/i;

interface ShareableReport {
  version: 1;
  createdAt: string;
  source: VerificationReport["source"];
  summary: VerificationReport["summary"];
  requirements: Array<Pick<VerificationReport["requirements"][number], "requirementId" | "requirementText" | "status" | "gaps" | "reviewerNote" | "confidence">>;
  testing: VerificationReport["testing"];
  reviewPriority: VerificationReport["reviewPriority"];
  proofGraph: VerificationReport["proofGraph"];
  limitations: string[];
}

export function encodeReportForShare(report: VerificationReport): string {
  return encodeBase64Url(JSON.stringify(toShareableReport(report)));
}

export function decodeSharedReport(payload: string): VerificationReport {
  return shareableToReport(JSON.parse(decodeBase64Url(payload)) as ShareableReport);
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

function toShareableReport(report: VerificationReport): ShareableReport {
  return {
    version: 1,
    createdAt: redactSecrets(report.createdAt),
    source: {
      title: redactSecrets(report.source.title),
      url: report.source.url ? redactSecrets(report.source.url) : undefined,
      author: report.source.author ? redactSecrets(report.source.author) : undefined,
      baseBranch: report.source.baseBranch ? redactSecrets(report.source.baseBranch) : undefined,
      headBranch: report.source.headBranch ? redactSecrets(report.source.headBranch) : undefined
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
      gaps: requirement.gaps.map(redactSecrets),
      reviewerNote: redactSecrets(requirement.reviewerNote),
      confidence: requirement.confidence
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
    limitations: appendSummaryOnlyLimitation(report.limitations.map(redactSecrets))
  };
}

function shareableToReport(shared: ShareableReport): VerificationReport {
  return {
    analysisId: `shared_${shared.createdAt}`,
    createdAt: shared.createdAt,
    source: shared.source,
    summary: shared.summary,
    requirements: shared.requirements.map((requirement) => ({
      ...requirement,
      evidenceRefs: []
    })),
    claims: [],
    scope: {
      suspected: shared.summary.topRisks.some((risk) => /scope/i.test(risk)),
      outOfScopeFiles: [],
      reasons: shared.summary.topRisks.filter((risk) => /scope/i.test(risk))
    },
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
    limitations: shared.limitations
  };
}

function sanitizeProofGraphForShare(proofGraph: VerificationReport["proofGraph"] | undefined): VerificationReport["proofGraph"] {
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
    firstFiles: node.firstFiles.map((path) => summaryProofText(path, "redacted-path")).slice(0, 5)
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
