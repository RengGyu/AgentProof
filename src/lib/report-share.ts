import type { VerificationReport } from "./types";

export const MAX_SHARE_PAYLOAD_LENGTH = 18_000;

interface ShareableReport {
  version: 1;
  createdAt: string;
  source: VerificationReport["source"];
  summary: VerificationReport["summary"];
  requirements: Array<Pick<VerificationReport["requirements"][number], "requirementId" | "requirementText" | "status" | "gaps" | "reviewerNote" | "confidence">>;
  testing: VerificationReport["testing"];
  reviewPriority: VerificationReport["reviewPriority"];
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
    createdAt: report.createdAt,
    source: report.source,
    summary: report.summary,
    requirements: report.requirements.map((requirement) => ({
      requirementId: requirement.requirementId,
      requirementText: requirement.requirementText,
      status: requirement.status,
      gaps: requirement.gaps,
      reviewerNote: requirement.reviewerNote,
      confidence: requirement.confidence
    })),
    testing: report.testing,
    reviewPriority: report.reviewPriority,
    limitations: [
      ...report.limitations,
      "Shared report omits raw evidence, patch/log excerpts, claims, and re-prompt text."
    ]
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
    testing: shared.testing,
    reviewPriority: shared.reviewPriority,
    reprompt: {
      targetAgent: "codex",
      prompt: "Shared summary links omit re-prompt text. Open the original report owner session or copy the full report for re-prompt details."
    },
    evidenceIndex: [],
    limitations: shared.limitations
  };
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
