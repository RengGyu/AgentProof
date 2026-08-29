import { describe, expect, it } from "vitest";
import {
  evaluateGeneralPrEvaluationV1,
  generalPrEvaluationCanAuthorizeReleaseV1,
  type GeneralPrAxisMetricsV1
} from "./general-pr-evaluation";

const measuredAxes: GeneralPrAxisMetricsV1[] = [
  { axis: "goal_extraction", falseGoalCount: 0, wrongHeadCount: 0, authorityElevationCount: 0, privacyLeakCount: 0 },
  { axis: "evidence_linking", falseDecisiveLinkCount: 0, wrongHeadCount: 0, authorityElevationCount: 0, privacyLeakCount: 0 },
  { axis: "contract_outcome", falseSupportedCount: 0, falseMetCount: 0, wrongHeadCount: 0, authorityElevationCount: 0, privacyLeakCount: 0 }
];

describe("general PR evaluation", () => {
  it("keeps goal extraction, evidence linking, and contract outcome measurements separate", () => {
    const result = evaluateGeneralPrEvaluationV1({ axes: measuredAxes });

    expect(result.axes).toEqual([
      { axis: "goal_extraction", state: "measured", blockingCount: 0 },
      { axis: "evidence_linking", state: "measured", blockingCount: 0 },
      { axis: "contract_outcome", state: "measured", blockingCount: 0 }
    ]);
    expect(result.releaseState).toBe("no_go");
    expect(generalPrEvaluationCanAuthorizeReleaseV1(result)).toBe(false);
  });

  it("marks an axis unknown when its gold-dependent counter is absent instead of treating it as a pass", () => {
    const result = evaluateGeneralPrEvaluationV1({
      axes: measuredAxes.map((axis) => axis.axis === "evidence_linking"
        ? { ...axis, falseDecisiveLinkCount: undefined }
        : axis)
    });

    expect(result.axes.find((axis) => axis.axis === "evidence_linking")).toEqual({
      axis: "evidence_linking",
      state: "unknown",
      blockingCount: null
    });
    expect(result.reasonCodes).toContain("gold_measurement_missing");
  });

  it("counts false met separately from false supported", () => {
    const result = evaluateGeneralPrEvaluationV1({
      axes: measuredAxes.map((axis) => axis.axis === "contract_outcome"
        ? { ...axis, falseMetCount: 1 }
        : axis)
    });

    expect(result.axes.find((axis) => axis.axis === "contract_outcome")).toEqual({
      axis: "contract_outcome",
      state: "measured",
      blockingCount: 1
    });
    expect(result.falseSupportedCount).toBe(0);
    expect(result.falseMetCount).toBe(1);
  });

  it("fails closed when any hard-safety counter is nonzero", () => {
    const result = evaluateGeneralPrEvaluationV1({
      axes: measuredAxes.map((axis) => axis.axis === "evidence_linking"
        ? { ...axis, wrongHeadCount: 1 }
        : axis)
    });

    expect(result.hardSafetyFailureCount).toBe(1);
    expect(result.reasonCodes).toContain("hard_safety_failure");
    expect(generalPrEvaluationCanAuthorizeReleaseV1(result)).toBe(false);
  });
});
