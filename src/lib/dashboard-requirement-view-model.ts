import type { LlmSemanticOutput } from "./llm-semantic-output";
import { toRequirementCoverageLabel } from "./github-dashboard-view-model";
import { proofAxisEvidenceLabel } from "./proof-contract";
import type { RequirementAuthority, RequirementProofAxis, RequirementStatus } from "./types";
import type { VerificationContractStateV2 } from "./verification-contract-v2";
import { tenantRemediationTextForGap } from "./tenant-report-language";
import { isProhibitedEvidenceRequestText } from "./semantic-text-policy";
import { deriveRequirementPresentationV2, isVerificationReportV2 } from "./requirement-presentation-v2";

export type RequirementExplanationState = "assessment" | "guidance" | "unavailable" | "none";

export interface DashboardRequirementViewModel {
  requirementId: string;
  objectiveText?: string;
  status: string;
  /** Evidence-only state for the coverage badge; defaults to the report status for legacy reports. */
  coverageStatus?: string;
  /** `Observed evidence` for strict-contract reports; `Evidence coverage` for legacy reports. */
  coverageHeading?: string;
  coverageLabel: string;
  coverageMeaning: string;
  /** Strict-contract reports separately state whether the objective outcome was assessed. */
  outcomeLabel?: string;
  outcomeMeaning?: string;
  sourceAuthorityLabel?: string;
  sourceAuthorityMeaning?: string;
  evidenceRefs: string[];
  proofEvidence?: string[];
  deterministicGaps: string[];
  explanation: { state: RequirementExplanationState; text: string };
  primaryGap?: string;
  nextAction?: string;
  inspectFirst?: string;
  actionIncluded: boolean;
  semanticEvidenceIds: string[];
  uncertainties: string[];
}

interface RequirementInput {
  requirementId: string;
  requirementText?: string;
  status: string;
  evidenceStatus?: RequirementStatus;
  sourceAuthority?: RequirementAuthority;
  evidenceRefs: string[];
  gaps: string[];
  proofAxes?: RequirementProofAxis[];
}

interface RequirementViewModelInput {
  /** Dashboard detail is intentionally a bounded projection; runtime v2 shape is checked before use. */
  report?: unknown;
  requirements?: RequirementInput[];
  semantic?: LlmSemanticOutput;
  semanticAnalysis?: { status: "included" | "unavailable"; attempts: 1 | 2 };
  verificationContract?: { state: VerificationContractStateV2; gaps?: unknown[] };
}

export function toDashboardRequirementViewModels({ report, requirements = [], semantic, semanticAnalysis, verificationContract }: RequirementViewModelInput): DashboardRequirementViewModel[] {
  const v2Report = report && isVerificationReportV2(report) ? report : undefined;
  return requirements.map((requirement) => {
    const presentation = v2Report ? deriveRequirementPresentationV2(v2Report, requirement.requirementId) : undefined;
    const assessments = semantic?.requirement_assessments.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const gaps = semantic?.evidence_gaps.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const remediation = semantic?.remediation_requests.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const targets = semantic?.review_targets.filter((item) => item.requirement_ids.includes(requirement.requirementId)) ?? [];
    const relations = semantic?.requirement_evidence_relations.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const uncertainties = semantic?.uncertainties.filter((item) => item.requirement_ids.includes(requirement.requirementId)) ?? [];
    const assessment = assessments.find((item) => usableCompactText(item.summary));
    const reportGap = requirement.gaps.map((gap) => usableCompactText(gap)).find((gap): gap is string => Boolean(gap));
    const deterministicGap = reportGap;
    const target = targets.find((item) => usableCompactText(item.inspection_goal));
    const deterministicNextAction = deterministicGap
      ? tenantRemediationTextForGap(deterministicGap)
      : undefined;
    const explanation = assessment
      ? { state: "assessment" as const, text: usableCompactText(assessment.summary)! }
      : semanticAnalysis?.status === "unavailable"
        ? { state: "unavailable" as const, text: "Some supporting details are unavailable. Available evidence is still shown." }
        : deterministicGap
          ? { state: "guidance" as const, text: "Review the key evidence gap and next action." }
            : { state: "none" as const, text: "No additional supporting details are available for this requirement." };
    const primaryGap = deterministicGap && !hasSameNormalizedText(explanation.text, deterministicGap)
      ? deterministicGap
      : undefined;
    const actionIncluded = Boolean(deterministicNextAction && (
      hasSameNormalizedText(explanation.text, deterministicNextAction) ||
      hasSameNormalizedText(primaryGap ?? "", deterministicNextAction)
    ));
    const nextAction = deterministicNextAction && !actionIncluded
      ? deterministicNextAction
      : undefined;

    return {
      requirementId: requirement.requirementId,
      objectiveText: boundedObjectiveText(assessment?.requirement_summary ?? requirement.requirementText, requirement.requirementId),
      status: requirement.status,
      coverageStatus: requirement.evidenceStatus ?? requirement.status,
      coverageHeading: presentation || verificationContract ? "Observed evidence" : "Evidence coverage",
      coverageLabel: presentation?.observationLabel ?? toRequirementCoverageLabel(requirement.evidenceStatus ?? requirement.status),
      coverageMeaning: toCoverageMeaning(presentation?.observedEvidence ?? requirement.evidenceStatus ?? requirement.status),
      ...(presentation
        ? { outcomeLabel: presentation.outcomeLabel, outcomeMeaning: presentation.outcomeBasis }
        : strictContractOutcomePresentation(requirement.status, verificationContract)),
      ...(requirement.sourceAuthority === "pr_description" ? {
        sourceAuthorityLabel: "PR description",
        sourceAuthorityMeaning: "Evidence is supported, but the objective comes from the PR description and needs reviewer confirmation."
      } : {}),
      evidenceRefs: requirement.evidenceRefs,
      proofEvidence: unique(requirement.proofAxes?.flatMap((axis) => {
        const label = proofAxisEvidenceLabel(axis);
        return label ? [label] : [];
      }) ?? []),
      deterministicGaps: requirement.gaps.flatMap((gap) => usableCompactText(gap) ?? []),
      explanation,
      ...(primaryGap ? { primaryGap } : {}),
      ...(nextAction ? { nextAction } : {}),
      ...(!nextAction && usableCompactText(target?.inspection_goal) ? { inspectFirst: usableCompactText(target!.inspection_goal)! } : {}),
      actionIncluded,
      semanticEvidenceIds: unique([
        ...assessments.flatMap((item) => item.evidence_ids),
        ...gaps.flatMap((item) => item.evidence_ids),
        ...remediation.flatMap((item) => item.evidence_ids),
        ...targets.flatMap((item) => item.evidence_ids),
        ...relations.map((item) => item.evidence_id),
        ...uncertainties.flatMap((item) => item.evidence_ids)
      ]),
      uncertainties: unique([
        ...assessments.map((item) => item.uncertainty),
        ...gaps.map((item) => item.uncertainty),
        ...remediation.map((item) => item.uncertainty),
        ...targets.map((item) => item.uncertainty),
        ...relations.map((item) => item.uncertainty),
        ...uncertainties.map((item) => item.impact)
      ])
    };
  });
}

function strictContractOutcomePresentation(
  status: string,
  contract: RequirementViewModelInput["verificationContract"]
): Pick<DashboardRequirementViewModel, "outcomeLabel" | "outcomeMeaning"> {
  if (!contract) return {};
  if (contract.state === "absent") {
    return {
      outcomeLabel: "Unclear",
      outcomeMeaning: "No approved verification contract defined how this objective should be evaluated."
    };
  }
  if (contract.state === "invalid") {
    return {
      outcomeLabel: "Unclear",
      outcomeMeaning: "The supplied verification contract was invalid, so this objective was not evaluated."
    };
  }
  return {
    outcomeLabel: strictContractOutcomeLabel(status, contract.state),
    outcomeMeaning: contract.state === "author_claim"
      ? "This outcome uses a PR-description verification contract and needs reviewer confirmation."
      : "This outcome is evaluated against an approved verification contract."
  };
}

function strictContractOutcomeLabel(status: string, state: VerificationContractStateV2): string {
  const coverage = toRequirementCoverageLabel(status);
  if (state === "authoritative" && status === "met") return "Supported against approved contract";
  if (state === "authoritative" && status === "partial") return "Partially supported against approved contract";
  if (state === "author_claim" && status === "partial") return "Partially supported against PR-description contract";
  return coverage;
}

function boundedObjectiveText(value: string | undefined, requirementId: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized !== `Requirement ${requirementId}` ? usableCompactText(normalized, 160) : undefined;
}

function usableCompactText(value: string | undefined, maxLength = 220): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized || /^(?:unavailable|unknown|none|n\/a)$/i.test(normalized)) return undefined;
  if (normalized.length > maxLength) return undefined;
  if (/(?:…|\.\.\.)\s*$/.test(normalized)) return undefined;
  if (isProhibitedEvidenceRequestText(normalized)) return undefined;
  return normalized;
}

function toCoverageMeaning(status: string): string {
  if (status === "met") return "Deterministic evidence references support this requirement.";
  if (status === "partial") return "Deterministic evidence references only partially support this requirement.";
  if (status === "missing") return "No deterministic evidence references support this requirement.";
  return "The captured deterministic evidence is insufficient to determine coverage for this requirement.";
}

function hasSameNormalizedText(left: string, right: string): boolean {
  return normalizeText(left) === normalizeText(right);
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
