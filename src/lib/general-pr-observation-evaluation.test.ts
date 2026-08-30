import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  evaluateGeneralPrObservationLabelsV1,
  validateGeneralPrObservationGoldCorpusV1
} from "./general-pr-observation-evaluation";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function label(reviewerId: string, decision: "positive" | "negative" | "abstain") {
  return { version: 1 as const, reviewerId: hash(reviewerId), decision, rubricHash: hash("r") };
}

function caseRecord(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    caseId: hash("c"),
    cohort: "calibration" as const,
    repositoryFamilyHash: hash("a"),
    taskFamilyHash: hash("b"),
    timeWindowHash: hash("d"),
    sourceHash: hash("e"),
    contentHash: hash("f"),
    headHash: hash("g"),
    inventoryHash: hash("h"),
    normalizerHash: hash("i"),
    axis: "span_role" as const,
    labels: [label("1", "abstain"), label("2", "abstain")],
    ...overrides
  };
}

describe("general PR observation evaluation", () => {
  it("accepts two independent matching labels and preserves genuine ambiguity", () => {
    const corpus = { version: 1 as const, cases: [caseRecord()] };

    expect(validateGeneralPrObservationGoldCorpusV1(corpus, new Set())).toEqual({ valid: true, errors: [] });
    expect(evaluateGeneralPrObservationLabelsV1({ corpus, visibleRegressionCaseIds: new Set(), goldSealHash: hash("s"), importedGoldSealHash: hash("s") })).toMatchObject({
      status: "ready",
      totals: { abstain: 1, adjudicated: 0 }
    });
  });

  it("requires third-party adjudication for a disagreement and rejects contaminated or duplicated holdout selection", () => {
    const disagreement = caseRecord({ labels: [label("1", "positive"), label("2", "negative")] });
    const visibleHoldout = caseRecord({ caseId: hash("v"), cohort: "holdout" });
    const duplicateFamily = caseRecord({ caseId: hash("z"), taskFamilyHash: hash("b"), timeWindowHash: hash("d") });
    const corpus = { version: 1 as const, cases: [disagreement, visibleHoldout, duplicateFamily] };

    const result = validateGeneralPrObservationGoldCorpusV1(corpus, new Set([hash("v")]));

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      "label disagreement requires an independent adjudication",
      "visible regression cases cannot enter protected holdout",
      "duplicate task/time family is not allowed"
    ]));
  });

  it("does not score a candidate before the exact gold seal is frozen", () => {
    const corpus = { version: 1 as const, cases: [caseRecord()] };

    expect(evaluateGeneralPrObservationLabelsV1({ corpus, visibleRegressionCaseIds: new Set(), goldSealHash: null, importedGoldSealHash: hash("s") })).toEqual({ status: "unavailable" });
    expect(evaluateGeneralPrObservationLabelsV1({ corpus, visibleRegressionCaseIds: new Set(), goldSealHash: hash("s"), importedGoldSealHash: hash("x") })).toEqual({ status: "unavailable" });
  });

  it("requires independent state labels for test and scope observations", () => {
    const corpus = {
      version: 1 as const,
      cases: [caseRecord({
        axis: "observation",
        labels: [
          { version: 1, reviewerId: hash("one"), rubricHash: hash("r"), observationKind: "test_coverage", state: "related_test_observed" },
          { version: 1, reviewerId: hash("two"), rubricHash: hash("r"), observationKind: "test_coverage", state: "related_test_observed" }
        ]
      })]
    };

    expect(validateGeneralPrObservationGoldCorpusV1(corpus, new Set())).toEqual({ valid: true, errors: [] });
  });
});
