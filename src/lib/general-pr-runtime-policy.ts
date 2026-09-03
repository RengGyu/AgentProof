export interface GeneralPrAssessmentRuntimePolicyV1 {
  version: 1;
  releasePhase: "disabled" | "shadow" | "advisory";
  semanticObservation: "disabled" | "eligible_public_pr";
  assessmentProjection: "hidden" | "advisory";
}

export function resolveGeneralPrAssessmentRuntimePolicyV1(
  value: string | undefined
): GeneralPrAssessmentRuntimePolicyV1 {
  if (value === "shadow") {
    return { version: 1, releasePhase: "shadow", semanticObservation: "eligible_public_pr", assessmentProjection: "hidden" };
  }
  if (value === "advisory") {
    return { version: 1, releasePhase: "advisory", semanticObservation: "eligible_public_pr", assessmentProjection: "advisory" };
  }
  return { version: 1, releasePhase: "disabled", semanticObservation: "disabled", assessmentProjection: "hidden" };
}
