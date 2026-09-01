import { describe, expect, it } from "vitest";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";

describe("resolveGeneralPrAssessmentRuntimePolicyV1", () => {
  it.each([
    [undefined, "disabled", "disabled", "hidden"],
    ["unknown", "disabled", "disabled", "hidden"],
    ["disabled", "disabled", "disabled", "hidden"],
    ["shadow", "shadow", "eligible_public_pr", "hidden"],
    ["advisory", "advisory", "eligible_public_pr", "advisory"]
  ])("maps %s without exposing a user choice", (value, releasePhase, semanticObservation, assessmentProjection) => {
    expect(resolveGeneralPrAssessmentRuntimePolicyV1(value)).toEqual({
      version: 1,
      releasePhase,
      semanticObservation,
      assessmentProjection
    });
  });
});
