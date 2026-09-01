import type { GeneralPrObservationBundleV2 } from "./general-pr-observation-service";

const TEST_STATES = ["covered_by_verified_relation", "verified_test_failed", "related_test_observed", "missing_targeted_test", "test_not_applicable", "relation_unresolved", "execution_unresolved", "collection_unavailable"] as const;
const SCOPE_STATES = ["mapped_by_verified_relation", "plausibly_mapped", "unmapped", "out_of_scope_by_contract", "collection_unavailable"] as const;

export interface GeneralPrObservationTelemetryV1 {
  version: 1;
  mode: "disabled" | "shadow" | "advisory";
  eligibility: "disabled" | "ineligible" | "eligible";
  semanticState: GeneralPrObservationBundleV2["semanticState"] | null;
  semanticFailureStage: GeneralPrObservationBundleV2["semanticFailureStage"] | null;
  diagnostics: GeneralPrObservationBundleV2["diagnostics"] | null;
  durationBucket: "lt_1s" | "1_3s" | "3_8s" | "gte_8s" | "unknown";
  objectiveCounts: { observed: number; hypothesis: number };
  relationLevelCounts: GeneralPrObservationBundleV2["relationLevelCounts"];
  testSummaryCounts: Record<(typeof TEST_STATES)[number], number>;
  scopeStateCounts: Record<(typeof SCOPE_STATES)[number], number>;
}

/** Creates an aggregate-only record; source, path, PR, and receipt IDs are omitted. */
export function buildGeneralPrObservationTelemetryV1(input: {
  mode: "disabled" | "shadow" | "advisory";
  bundle: GeneralPrObservationBundleV2 | null;
  elapsedMs: number;
}): GeneralPrObservationTelemetryV1 {
  const bundle = input.bundle;
  return {
    version: 1,
    mode: input.mode,
    eligibility: input.mode === "disabled" ? "disabled" : bundle === null ? "ineligible" : "eligible",
    semanticState: bundle?.semanticState ?? null,
    semanticFailureStage: bundle?.semanticFailureStage ?? null,
    diagnostics: bundle?.diagnostics ?? null,
    durationBucket: durationBucket(input.elapsedMs),
    objectiveCounts: {
      observed: bundle?.objectives.filter((objective) => objective.state === "observed").length ?? 0,
      hypothesis: bundle?.objectives.filter((objective) => objective.state === "hypothesis").length ?? 0
    },
    relationLevelCounts: bundle?.relationLevelCounts ?? { verified: 0, observed: 0, hypothesis: 0, unresolved: 0, unavailable: 0 },
    testSummaryCounts: countBy(bundle?.testCoverage.map((item) => item.summaryState) ?? [], TEST_STATES),
    scopeStateCounts: countBy(bundle?.scopeMappings.map((item) => item.state) ?? [], SCOPE_STATES)
  };
}

function countBy<T extends string>(values: readonly string[], states: readonly T[]): Record<T, number> {
  return Object.fromEntries(states.map((state) => [state, values.filter((value) => value === state).length])) as Record<T, number>;
}

function durationBucket(value: number): GeneralPrObservationTelemetryV1["durationBucket"] {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  if (value < 1_000) return "lt_1s";
  if (value < 3_000) return "1_3s";
  if (value < 8_000) return "3_8s";
  return "gte_8s";
}
