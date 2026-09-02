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

  it("rejects calibration and holdout cases from the same repository or task family", () => {
    const corpus = {
      version: 1 as const,
      cases: [
        caseRecord(),
        caseRecord({
          caseId: hash("holdout-repository"),
          cohort: "holdout",
          taskFamilyHash: hash("other-task"),
          timeWindowHash: hash("other-time")
        }),
        caseRecord({
          caseId: hash("holdout-task"),
          cohort: "holdout",
          repositoryFamilyHash: hash("other-repository"),
          timeWindowHash: hash("third-time")
        })
      ]
    };

    expect(validateGeneralPrObservationGoldCorpusV1(corpus, new Set())).toEqual({
      valid: false,
      errors: expect.arrayContaining([
        "calibration and holdout repository families must be disjoint",
        "calibration and holdout task families must be disjoint"
      ])
    });
  });

  it("keeps the live smoke corpus out of both labelled cohorts", () => {
    const calibrationId = hash("live-25-calibration");
    const holdoutId = hash("live-25-holdout");
    const corpus = { version: 1 as const, cases: [caseRecord({ caseId: calibrationId })] };
    const holdout = { version: 1 as const, cases: [caseRecord({ caseId: holdoutId, cohort: "holdout" })] };
    const liveSmokeCaseIds = new Set([calibrationId, holdoutId]);

    expect(validateGeneralPrObservationGoldCorpusV1(corpus, new Set(), liveSmokeCaseIds)).toEqual({
      valid: false,
      errors: ["live smoke cases cannot enter the labelled corpus"]
    });
    expect(validateGeneralPrObservationGoldCorpusV1(holdout, new Set(), liveSmokeCaseIds)).toEqual({
      valid: false,
      errors: ["live smoke cases cannot enter the labelled corpus"]
    });
    expect(evaluateGeneralPrObservationLabelsV1({
      corpus,
      visibleRegressionCaseIds: new Set(),
      liveSmokeCaseIds,
      goldSealHash: hash("s"),
      importedGoldSealHash: hash("s")
    })).toEqual({ status: "unavailable" });
  });
});
