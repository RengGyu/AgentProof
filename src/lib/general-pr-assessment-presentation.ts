import type { GeneralPrAssessmentSummaryV1 } from "./types";

export interface GeneralPrAssessmentPresentationV1 {
  heading: "Ordinary PR evidence assessment";
  conclusionLabel: string;
  sourceLabel: string;
  countsLabel: string;
  reasonLabels: string[];
}

/**
 * Converts the target-free summary into fixed reviewer copy. This module
 * deliberately has no access to targets, paths, source spans, or raw text.
 */
export function presentGeneralPrAssessmentSummary(
  assessment: GeneralPrAssessmentSummaryV1
): GeneralPrAssessmentPresentationV1 {
  return {
    heading: "Ordinary PR evidence assessment",
    conclusionLabel: conclusionLabel(assessment.overallConclusion),
    sourceLabel: sourceLabel(assessment.sourceState),
    countsLabel: countLabel(assessment),
    reasonLabels: assessment.reasonCodes.map(reasonLabel)
  };
}

function conclusionLabel(
  conclusion: GeneralPrAssessmentSummaryV1["overallConclusion"]
): string {
  if (conclusion === "evidence_supports_stated_change") return "Evidence supports the stated change";
  if (conclusion === "evidence_partial") return "Evidence partially supports the stated change";
  if (conclusion === "attention_required") return "Evidence needs attention";
  if (conclusion === "collection_blocked") return "Evidence collection was incomplete";
  if (conclusion === "no_assessable_claims") return "No assessable objective was found";
  return "Evidence is partially connected";
}

function sourceLabel(sourceState: GeneralPrAssessmentSummaryV1["sourceState"]): string {
  if (sourceState === "linked_issue") return "Linked issue objective";
  if (sourceState === "pr_author_claim") return "PR description claim — reviewer confirmation needed";
  if (sourceState === "mixed") return "Mixed linked-issue and PR-description sources";
  if (sourceState === "missing") return "No objective source was available";
  return "Objective source could not be used safely";
}

function countLabel(assessment: GeneralPrAssessmentSummaryV1): string {
  const labels: Array<[keyof GeneralPrAssessmentSummaryV1["counts"], string]> = [
    ["evidence_supported", "Supported"],
    ["evidence_partial", "Partial evidence"],
    ["not_demonstrated", "Not demonstrated"],
    ["contradicted", "Contradicted"],
    ["blocked", "Collection blocked"],
    ["not_assessable", "Not assessable"]
  ];
  return labels
    .filter(([key]) => assessment.counts[key] > 0)
    .map(([key, label]) => `${label}: ${assessment.counts[key]}`)
    .join(" · ") || "No assessable objectives";
}

function reasonLabel(reason: GeneralPrAssessmentSummaryV1["reasonCodes"][number]): string {
  const labels: Record<GeneralPrAssessmentSummaryV1["reasonCodes"][number], string> = {
    implementation_evidence_observed: "Changed implementation evidence was observed.",
    test_artifact_observed: "A changed test artifact was observed.",
    exact_execution_passed: "An exact execution result passed.",
    exact_execution_failed: "An exact execution result failed.",
    verified_relation_missing: "A requirement-to-evidence relation was not independently verified.",
    execution_not_observed: "No exact execution result was observed.",
    claimed_artifact_not_observed: "A stated artifact was not observed at the analyzed head.",
    unsupported_claim_type: "This claim type is outside the current evidence capability.",
    source_missing: "No objective source was available.",
    source_ambiguous: "The objective source could not be used safely.",
    source_unavailable: "The objective source was unavailable.",
    collection_incomplete: "Evidence collection was incomplete for the analyzed head.",
    head_mismatch: "Collected evidence did not match the analyzed head.",
    evidence_identity_incomplete: "Evidence identity was incomplete.",
    semantic_relation_only: "Only a semantic relation was available, not deterministic proof.",
    author_claim_requires_confirmation: "The PR description is an author claim and needs reviewer confirmation.",
    deterministic_candidate_missing: "No deterministic assessment candidate was identified.",
    semantic_observer_disabled: "Semantic assessment was not enabled for this analysis.",
    semantic_observer_ineligible: "The objective was not eligible for semantic assessment.",
    semantic_observer_unavailable: "Semantic assessment was unavailable.",
    semantic_observer_timeout: "Semantic assessment did not finish in time.",
    semantic_proposal_invalid: "A semantic proposal could not be used safely.",
    semantic_candidate_missing: "No semantic assessment candidate was identified.",
    semantic_candidate_rejected: "A semantic assessment candidate could not be admitted safely.",
    target_relation_unresolved: "The target-to-evidence relation remains unresolved."
  };
  return labels[reason];
}
