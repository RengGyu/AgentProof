import type { LlmSemanticOutput } from "./llm-semantic-output";
import { toRequirementCoverageLabel } from "./github-dashboard-view-model";

export type RequirementExplanationState = "assessment" | "guidance" | "unavailable" | "none";

export interface DashboardRequirementViewModel {
  requirementId: string;
  objectiveText?: string;
  status: string;
  coverageLabel: string;
  coverageMeaning: string;
  evidenceRefs: string[];
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
    const assessment = assessments.find((item) => usableCompactText(item.summary));
    const action = remediation.find((item) => usableCompactText(item.instruction));
    const guidance = gaps.find((item) => usableCompactText(item.description));
    const target = targets.find((item) => usableCompactText(item.inspection_goal));
    const guidanceNextAction = usableCompactText(guidance?.needed_evidence);
    const explanation = assessment
      ? { state: "assessment" as const, text: compactReadingText(assessment.summary) }
      : action
        ? { state: "guidance" as const, text: "A next action is available from the evidence." }
        : guidance
          ? { state: "guidance" as const, text: "Available evidence needs the listed next action." }
          : semanticAnalysis?.status === "unavailable"
            ? { state: "unavailable" as const, text: "Some supporting details are unavailable. Available evidence is still shown." }
            : requirement.gaps[0]
              ? { state: "none" as const, text: "Available deterministic evidence is summarized in coverage. Review the key gap below." }
              : { state: "none" as const, text: "No additional supporting details are available for this requirement." };
    const primaryGap = requirement.gaps.find((gap) => !hasSameNormalizedText(explanation.text, gap)) ??
      (guidance?.description && !hasSameNormalizedText(explanation.text, guidance.description)
        ? guidance.description
        : undefined);
    const candidateNextAction = usableCompactText(action?.instruction) ?? guidanceNextAction;
    const actionIncluded = Boolean(candidateNextAction && (
      hasSameNormalizedText(explanation.text, candidateNextAction) ||
      hasSameNormalizedText(primaryGap ?? "", candidateNextAction)
    ));
    const nextAction = candidateNextAction && !actionIncluded
      ? candidateNextAction
      : undefined;

    return {
      requirementId: requirement.requirementId,
      objectiveText: boundedObjectiveText(assessment?.requirement_summary ?? requirement.requirementText, requirement.requirementId),
      status: requirement.status,
      coverageLabel: toRequirementCoverageLabel(requirement.status),
      coverageMeaning: toCoverageMeaning(requirement.status),
      evidenceRefs: requirement.evidenceRefs,
      deterministicGaps: requirement.gaps.map((gap) => compactReadingText(gap)),
      explanation,
      ...(primaryGap ? { primaryGap: compactReadingText(primaryGap) } : {}),
      ...(nextAction ? { nextAction: compactReadingText(nextAction) } : {}),
      ...(!nextAction && usableCompactText(target?.inspection_goal) ? { inspectFirst: compactReadingText(target!.inspection_goal) } : {}),
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

function boundedObjectiveText(value: string | undefined, requirementId: string): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized && normalized !== `Requirement ${requirementId}` ? compactReadingText(normalized, 160) : undefined;
}

function compactReadingText(value: string, maxLength = 220): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? normalized;
  if (sentence.length <= maxLength) return sentence;
  const prefix = sentence.slice(0, Math.max(1, maxLength - 1));
  const wholeWords = prefix.replace(/\s+\S*$/, "").trimEnd();
  return `${(wholeWords || prefix).replace(/[,:;\-–—]+$/, "")}.`;
}

function usableCompactText(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, " ");
  if (!normalized || /^(?:unavailable|unknown|none|n\/a)$/i.test(normalized)) return undefined;
  if (/(?:…|\.\.\.)\s*$/.test(normalized)) return undefined;
  if (/\b(?:raw|full|complete)\s+(?:(?:CI|test|job|check)(?:[-\s](?:run|step))?\s+)?(?:logs?|output|artifacts?)\b|\b(?:CI|test(?:[-\s]run)?|job(?:[-\s](?:run|step))?|check)\s+(?:logs?|output|artifacts?|metadata)\b|\bartifact[-\s]level\s+evidence\b/i.test(normalized)) return undefined;
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
