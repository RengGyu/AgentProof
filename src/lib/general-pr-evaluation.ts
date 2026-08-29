/**
 * Aggregate-only evaluation plumbing for the general-PR shadow pipeline.
 * It deliberately cannot authorize release: sealed gold, endpoint replay,
 * and production-smoke evidence are owned by later release stages.
 */
export type GeneralPrEvaluationAxisV1 = "goal_extraction" | "evidence_linking" | "contract_outcome";

export interface GeneralPrAxisMetricsV1 {
  axis: GeneralPrEvaluationAxisV1;
  falseGoalCount?: number;
  falseDecisiveLinkCount?: number;
  falseSupportedCount?: number;
  falseMetCount?: number;
  wrongHeadCount: number;
  authorityElevationCount: number;
  privacyLeakCount: number;
}

export interface GeneralPrEvaluationAxisResultV1 {
  axis: GeneralPrEvaluationAxisV1;
  state: "measured" | "unknown";
  blockingCount: number | null;
}

export interface GeneralPrEvaluationResultV1 {
  version: 1;
  axes: GeneralPrEvaluationAxisResultV1[];
  falseSupportedCount: number | null;
  falseMetCount: number | null;
  hardSafetyFailureCount: number | null;
  /** This stage intentionally cannot produce a release authorization. */
  releaseState: "no_go";
  reasonCodes: Array<"gold_measurement_missing" | "hard_safety_failure" | "release_evidence_not_collected">;
}

const AXES: readonly GeneralPrEvaluationAxisV1[] = ["goal_extraction", "evidence_linking", "contract_outcome"];

export function evaluateGeneralPrEvaluationV1(input: { axes: readonly GeneralPrAxisMetricsV1[] }): GeneralPrEvaluationResultV1 {
  const metricsByAxis = new Map(input.axes.map((metrics) => [metrics.axis, metrics]));
  const unknown = AXES.some((axis) => !hasRequiredCounters(metricsByAxis.get(axis)));
  const axes = AXES.map((axis) => axisResult(axis, metricsByAxis.get(axis)));
  const outcomeMetrics = metricsByAxis.get("contract_outcome");
  const falseSupportedCount = isNonNegativeCount(outcomeMetrics?.falseSupportedCount) ? outcomeMetrics.falseSupportedCount : null;
  const falseMetCount = isNonNegativeCount(outcomeMetrics?.falseMetCount) ? outcomeMetrics.falseMetCount : null;
  const hardSafetyFailureCount = sumOptional(input.axes.flatMap((metrics) => [
    metrics.wrongHeadCount,
    metrics.authorityElevationCount,
    metrics.privacyLeakCount
  ]));
  const reasonCodes: GeneralPrEvaluationResultV1["reasonCodes"] = [];
  if (unknown) reasonCodes.push("gold_measurement_missing");
  if ((hardSafetyFailureCount ?? 0) > 0) reasonCodes.push("hard_safety_failure");
  reasonCodes.push("release_evidence_not_collected");

  return {
    version: 1,
    axes,
    falseSupportedCount,
    falseMetCount,
    hardSafetyFailureCount,
    releaseState: "no_go",
    reasonCodes
  };
}

/**
 * Prevent accidental reuse of pre-release metrics as an authorization signal.
 * A later sealed release gate owns the only possible authorization decision.
 */
export function generalPrEvaluationCanAuthorizeReleaseV1(_result: GeneralPrEvaluationResultV1): false {
  return false;
}

function axisResult(axis: GeneralPrEvaluationAxisV1, metrics: GeneralPrAxisMetricsV1 | undefined): GeneralPrEvaluationAxisResultV1 {
  if (!hasRequiredCounters(metrics)) return { axis, state: "unknown", blockingCount: null };
  return { axis, state: "measured", blockingCount: axisBlockingCount(axis, metrics) };
}

function hasRequiredCounters(metrics: GeneralPrAxisMetricsV1 | undefined): metrics is GeneralPrAxisMetricsV1 {
  if (!metrics || !hasNonNegativeCounts(metrics.wrongHeadCount, metrics.authorityElevationCount, metrics.privacyLeakCount)) return false;
  if (metrics.axis === "goal_extraction") return hasNonNegativeCounts(metrics.falseGoalCount);
  if (metrics.axis === "evidence_linking") return hasNonNegativeCounts(metrics.falseDecisiveLinkCount);
  return hasNonNegativeCounts(metrics.falseSupportedCount, metrics.falseMetCount);
}

function axisBlockingCount(axis: GeneralPrEvaluationAxisV1, metrics: GeneralPrAxisMetricsV1): number {
  const safety = metrics.wrongHeadCount + metrics.authorityElevationCount + metrics.privacyLeakCount;
  if (axis === "goal_extraction") return safety + metrics.falseGoalCount!;
  if (axis === "evidence_linking") return safety + metrics.falseDecisiveLinkCount!;
  return safety + metrics.falseSupportedCount! + metrics.falseMetCount!;
}

function sumOptional(values: Array<number | undefined>): number | null {
  return values.every(isNonNegativeCount) ? values.reduce((total, value) => total + value, 0) : null;
}

function hasNonNegativeCounts(...values: Array<number | undefined>): boolean {
  return values.every(isNonNegativeCount);
}

function isNonNegativeCount(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0;
}
