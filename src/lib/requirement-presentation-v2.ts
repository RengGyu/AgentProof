import type { RequirementStatus, VerificationReport, VerificationReportV2 } from "./types";
import type { VerificationContractStateV2 } from "./verification-contract-v2";

export interface RequirementPresentationV2 {
  requirementId: string;
  outcome: RequirementStatus;
  observedEvidence: RequirementStatus;
  authority: VerificationContractStateV2;
  outcomeLabel: string;
  outcomeBasis: string;
  observationLabel: string;
  primaryGap: string | null;
}

export function isVerificationReportV2(report: unknown): report is VerificationReportV2 {
  if (!report || typeof report !== "object") return false;
  const candidate = report as Partial<VerificationReportV2>;
  return candidate.reportSchemaVersion === "verification-report.v2" &&
    Array.isArray(candidate.verificationContract?.gaps) &&
    Array.isArray(candidate.verificationContract?.objectives);
}

export function deriveRequirementPresentationV2(
  report: VerificationReportV2,
  requirementId: string
): RequirementPresentationV2 {
  const requirement = report.requirements.find((item) => item.requirementId === requirementId);
  if (!requirement) throw new Error(`Unknown requirement presentation: ${requirementId}`);

  const authority = report.verificationContract.state;
  const outcome = safeOutcome(authority, requirement.status);
  const observedEvidence = requirement.evidenceStatus ?? requirement.status;

  return {
    requirementId,
    outcome,
    observedEvidence,
    authority,
    outcomeLabel: outcomeLabel(authority, outcome),
    outcomeBasis: outcomeBasis(authority, outcome),
    observationLabel: observationLabel(observedEvidence),
    primaryGap: primaryGap(report, requirementId)
  };
}

function safeOutcome(authority: VerificationContractStateV2, outcome: RequirementStatus): RequirementStatus {
  if (authority === "absent" || authority === "invalid") return "unclear";
  if (authority === "author_claim" && outcome === "met") return "partial";
  return outcome;
}

function outcomeLabel(authority: VerificationContractStateV2, outcome: RequirementStatus): string {
  if (authority === "absent") return "Unclear — approved verification contract missing";
  if (authority === "invalid") return "Unclear — verification contract invalid";
  if (authority === "author_claim" && outcome === "partial") return "Partially supported against PR-description contract";
  if (authority === "authoritative" && outcome === "met") return "Supported against approved contract";
  if (authority === "authoritative" && outcome === "partial") return "Partially supported against approved contract";
  if (authority === "authoritative" && outcome === "missing") return "Not supported against approved contract";
  if (authority === "author_claim" && outcome === "missing") return "Not supported against PR-description contract";
  if (authority === "author_claim" && outcome === "unclear") return "Unclear against PR-description contract";
  return "Unclear against approved contract";
}

function outcomeBasis(authority: VerificationContractStateV2, outcome: RequirementStatus): string {
  if (authority === "absent") return "No approved verification contract defined the requirement outcome.";
  if (authority === "invalid") return "The supplied verification contract could not be validated.";
  if (authority === "author_claim" && outcome === "partial") return "This result uses a PR-description contract and requires reviewer confirmation.";
  if (authority === "author_claim" && outcome === "missing") return "All required criteria were violated, but the contract source remains an author claim.";
  if (authority === "author_claim") return "The PR-description contract could not be decided from the available evidence.";
  if (outcome === "met") return "All required criteria were satisfied by approved evidence.";
  if (outcome === "partial") return "At least one required criterion was satisfied and at least one was not satisfied.";
  if (outcome === "missing") return "All required criteria were violated by the collected approved evidence.";
  return "Required criterion evidence was incomplete or unavailable.";
}

function observationLabel(status: RequirementStatus): string {
  if (status === "met") return "Supported";
  if (status === "partial") return "Partially supported";
  if (status === "missing") return "Not supported";
  return "Unclear";
}

function primaryGap(report: VerificationReportV2, requirementId: string): string | null {
  const reportGap = report.verificationContract.gaps[0]?.kind;
  if (reportGap) return reportGap;

  const objective = report.verificationContract.objectives.find((item) => item.requirementId === requirementId);
  const criterion = objective?.criterionResults.find((item) => item.state !== "satisfied");
  return criterion?.gapKinds[0] ?? fallbackGap(criterion?.state);
}

function fallbackGap(state: "satisfied" | "violated" | "incomplete" | "unavailable" | undefined): string | null {
  if (state === "violated") return "criterion_violated";
  if (state === "incomplete") return "evidence_incomplete";
  if (state === "unavailable") return "evidence_unavailable";
  return null;
}
