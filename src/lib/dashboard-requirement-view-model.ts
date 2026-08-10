import type { LlmSemanticOutput } from "./llm-semantic-output";
import { toRequirementCoverageLabel } from "./github-dashboard-view-model";

export type RequirementExplanationState = "assessment" | "guidance" | "unavailable" | "none";

export interface DashboardRequirementViewModel {
  requirementId: string;
  status: string;
  coverageLabel: string;
  coverageMeaning: string;
  evidenceRefs: string[];
  deterministicGaps: string[];
  explanation: { state: RequirementExplanationState; text: string };
  nextAction?: string;
  actionIncluded: boolean;
  semanticEvidenceIds: string[];
  uncertainties: string[];
}

interface RequirementInput {
  requirementId: string;
  status: string;
  evidenceRefs: string[];
  gaps: string[];
}

interface RequirementViewModelInput {
  requirements?: RequirementInput[];
  semantic?: LlmSemanticOutput;
  semanticAnalysis?: { status: "included" | "unavailable"; attempts: 1 | 2 };
}

export function toDashboardRequirementViewModels({ requirements = [], semantic, semanticAnalysis }: RequirementViewModelInput): DashboardRequirementViewModel[] {
  return requirements.map((requirement) => {
    const assessments = semantic?.requirement_assessments.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const gaps = semantic?.evidence_gaps.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const remediation = semantic?.remediation_requests.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const targets = semantic?.review_targets.filter((item) => item.requirement_ids.includes(requirement.requirementId)) ?? [];
    const relations = semantic?.requirement_evidence_relations.filter((item) => item.requirement_id === requirement.requirementId) ?? [];
    const uncertainties = semantic?.uncertainties.filter((item) => item.requirement_ids.includes(requirement.requirementId)) ?? [];
    const assessment = assessments.find((item) => item.summary.trim());
    const action = remediation.find((item) => item.instruction.trim());
    const guidance = gaps.find((item) => item.description.trim());
    const guidanceNextAction = guidance?.needed_evidence.trim();
    const explanation = assessment
      ? { state: "assessment" as const, text: assessment.summary }
      : action
        ? { state: "guidance" as const, text: "AI guidance is available. Follow the next action." }
        : guidance
          ? { state: "guidance" as const, text: guidance.description }
          : semanticAnalysis?.status === "unavailable"
            ? { state: "unavailable" as const, text: "AI explanation is unavailable. Deterministic evidence is shown below." }
            : requirement.gaps[0]
              ? { state: "none" as const, text: `Evidence gap: ${requirement.gaps[0]}` }
              : { state: "none" as const, text: "No additional AI explanation is available for this requirement." };
    const candidateNextAction = action?.instruction ?? guidanceNextAction;
    const actionIncluded = Boolean(candidateNextAction && hasSameNormalizedText(explanation.text, candidateNextAction));
    const nextAction = candidateNextAction && !actionIncluded
      ? candidateNextAction
      : undefined;

    return {
      requirementId: requirement.requirementId,
      status: requirement.status,
      coverageLabel: toRequirementCoverageLabel(requirement.status),
      coverageMeaning: toCoverageMeaning(requirement.status),
      evidenceRefs: requirement.evidenceRefs,
      deterministicGaps: requirement.gaps,
      explanation,
      ...(nextAction ? { nextAction } : {}),
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
