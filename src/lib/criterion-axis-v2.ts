import { criterionAxisIdV2, type MaterializedVerificationContractV2, type VerificationCriterionEvaluationV2 } from "./verification-contract-v2";
import type { RequirementProofAxis, RequirementProofState } from "./types";

export interface V2CriterionAxisBuildInput {
  materialized: MaterializedVerificationContractV2;
  observations: ReadonlyMap<string, readonly RequirementProofAxis[]>;
  evaluations: readonly VerificationCriterionEvaluationV2[];
}

export interface V2CriterionAxisBuildResult {
  axesByRequirement: Map<string, RequirementProofAxis[]>;
  evaluations: VerificationCriterionEvaluationV2[];
}

export function stableV2ObservationAxes(requirementId: string, axes: readonly RequirementProofAxis[]): RequirementProofAxis[] {
  return stableObservationAxes(requirementId, axes);
}

/**
 * Typed criterion proof and legacy observation proof have deliberately
 * different owners. This builder does not infer either from objective prose.
 */
export function buildV2CriterionOwnedAxes(input: V2CriterionAxisBuildInput): V2CriterionAxisBuildResult {
  const evaluationsById = new Map(input.evaluations.map((evaluation) => [evaluation.criterionId, evaluation]));
  const axesByRequirement = new Map<string, RequirementProofAxis[]>();
  const evaluations: VerificationCriterionEvaluationV2[] = [];

  for (const objective of input.materialized.objectives) {
    const observationAxes = stableObservationAxes(objective.requirementId, input.observations.get(objective.requirementId) ?? []);
    const criterionAxes: RequirementProofAxis[] = [];
    for (const criterion of objective.criteria) {
      const evaluation = evaluationsById.get(criterion.criterionId) ?? unavailableEvaluation(criterion.criterionId);
      const proofAxisRefs = criterion.requiredEvidence.map((subject) => criterionAxisIdV2(
        criterion.requirementId,
        criterion.criterionId,
        subject,
        "present"
      ));
      criterionAxes.push(...criterion.requiredEvidence.map((subject, index) => ({
        axisId: proofAxisRefs[index]!,
        role: "criterion" as const,
        criterionId: criterion.criterionId,
        subject,
        polarity: "present" as const,
        state: criterionAxisState(evaluation.state),
        evidenceRefs: [...evaluation.evidenceRefs],
        ...criterionCollectionBasis(criterion.source.type, criterion.source.type === "artifact" ? criterion.source.artifact.kind : undefined, subject, evaluation.state)
      })));
      evaluations.push({ ...evaluation, proofAxisRefs });
    }
    axesByRequirement.set(objective.requirementId, [...observationAxes, ...criterionAxes]);
  }
  return { axesByRequirement, evaluations };
}

function stableObservationAxes(requirementId: string, axes: readonly RequirementProofAxis[]): RequirementProofAxis[] {
  const sorted = [...axes].sort((left, right) => observationSortKey(left).localeCompare(observationSortKey(right)));
  const counts = new Map<string, number>();
  return sorted.map((axis) => {
    const ordinal = (counts.get(axis.subject) ?? 0) + 1;
    counts.set(axis.subject, ordinal);
    return {
      ...axis,
      axisId: `obs_${requirementId}_${axis.subject}_${ordinal}`,
      role: "observation" as const,
      criterionId: undefined
    };
  });
}

function observationSortKey(axis: RequirementProofAxis): string {
  return [axis.subject, axis.polarity, axis.collectionBasis ?? "", [...axis.evidenceRefs].sort().join(",")].join("\0");
}

function criterionAxisState(state: VerificationCriterionEvaluationV2["state"]): RequirementProofState {
  if (state === "satisfied") return "satisfied";
  if (state === "violated") return "violated";
  return "incomplete";
}

function criterionCollectionBasis(
  type: "return_value" | "artifact" | "absence",
  artifactKind: "documentation_literal" | "workflow_job" | "test_case" | undefined,
  subject: RequirementProofAxis["subject"],
  state: VerificationCriterionEvaluationV2["state"]
): Pick<RequirementProofAxis, "collectionBasis"> {
  if (state !== "satisfied" && state !== "violated") return {};
  if (type === "absence") return { collectionBasis: "complete_changed_file_inventory" };
  if (artifactKind === "documentation_literal" && subject === "documentation") return { collectionBasis: "matching_artifact_evidence" };
  if (artifactKind === "workflow_job" && subject === "ci_configuration") return { collectionBasis: "matching_artifact_evidence" };
  return {};
}

function unavailableEvaluation(criterionId: string): VerificationCriterionEvaluationV2 {
  return {
    criterionId,
    state: "unavailable",
    proofAxisRefs: [],
    evidenceRefs: [],
    gapKinds: ["evidence_unavailable"]
  };
}
