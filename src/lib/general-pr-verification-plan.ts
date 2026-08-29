import type { GeneralPrClaimClassificationV1 } from "./general-pr-claim-classifier";
import type { MaterializedVerificationContractV2 } from "./verification-contract-v2";
import { isGeneralPrExecutableCapabilityV2 } from "./verification-capability-policy-v2";

/** Private reviewer guidance; it cannot request evidence or change report outcomes. */
export interface GeneralPrAdvisoryPlanV1 {
  version: 1;
  classificationRef: string;
  suggestionCode:
    | "confirm_acceptance_criterion"
    | "collect_external_execution_evidence"
    | "clarify_scope";
  resultCeiling: "none";
}

/** A frozen, source-owned plan for a currently released typed-contract evaluator. */
export interface TypedExecutablePlanV1 {
  version: 1;
  criterionId: string;
  capabilityId: "documentation_literal.v1";
  sourceBindingDigest: string;
}

export function deriveGeneralPrAdvisoryPlansV1(
  classifications: readonly GeneralPrClaimClassificationV1[]
): GeneralPrAdvisoryPlanV1[] {
  return classifications.flatMap((classification) => {
    const suggestionCode = suggestionForRole(classification.role);
    return suggestionCode ? [{
      version: 1 as const,
      classificationRef: `gpc_${classification.structuralSpanId}`,
      suggestionCode,
      resultCeiling: "none" as const
    }] : [];
  });
}

export function materializeTypedExecutablePlansV1(
  materialized: MaterializedVerificationContractV2
): TypedExecutablePlanV1[] {
  if (materialized.state !== "authoritative" || !isGeneralPrExecutableCapabilityV2("documentation_literal")) return [];
  return materialized.objectives.flatMap((objective) => objective.criteria.flatMap((criterion) => {
    if (criterion.source.type !== "artifact" || criterion.source.artifact.kind !== "documentation_literal") return [];
    return [{
      version: 1 as const,
      criterionId: criterion.criterionId,
      capabilityId: "documentation_literal.v1" as const,
      sourceBindingDigest: materialized.bindingDigest
    }];
  }));
}

function suggestionForRole(role: GeneralPrClaimClassificationV1["role"]): GeneralPrAdvisoryPlanV1["suggestionCode"] | null {
  if (role === "objective_candidate") return "confirm_acceptance_criterion";
  if (role === "test_or_validation_claim") return "collect_external_execution_evidence";
  if (role === "scope_or_follow_up") return "clarify_scope";
  return null;
}
