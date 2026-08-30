import { describe, expect, it } from "vitest";
import { evaluateTestCoverageObservationV2 } from "./test-coverage-observation";

const base = {
  objectiveId: "objective_a",
  changeClusterId: "cluster_a",
  applicability: "required_by_contract" as const,
  relation: "unresolved" as const,
  execution: "not_observed" as const,
  changedFileInventoryComplete: true,
  applicableTestInventoryComplete: true,
  requiredEvidenceAvailable: true
};

describe("evaluateTestCoverageObservationV2", () => {
  it("reports missing targeted tests only for an authoritative requirement with complete inventories", () => {
    expect(evaluateTestCoverageObservationV2(base)).toMatchObject({ summaryState: "missing_targeted_test" });
    expect(evaluateTestCoverageObservationV2({ ...base, changedFileInventoryComplete: false })).toMatchObject({ summaryState: "collection_unavailable" });
  });

  it("keeps relation and execution as separate states", () => {
    expect(evaluateTestCoverageObservationV2({ ...base, relation: "observed" })).toMatchObject({ summaryState: "related_test_observed" });
    expect(evaluateTestCoverageObservationV2({ ...base, relation: "verified", execution: "reported_pass" })).toMatchObject({ summaryState: "execution_unresolved" });
    expect(evaluateTestCoverageObservationV2({ ...base, relation: "verified", execution: "verified_pass" })).toMatchObject({ summaryState: "covered_by_verified_relation" });
    expect(evaluateTestCoverageObservationV2({ ...base, relation: "verified", execution: "verified_fail" })).toMatchObject({ summaryState: "verified_test_failed" });
  });

  it("does not let semantic hypotheses or global CI status create missing or N/A outcomes", () => {
    expect(evaluateTestCoverageObservationV2({ ...base, applicability: "hypothesized_required", relation: "hypothesis" })).toMatchObject({ summaryState: "relation_unresolved" });
    expect(evaluateTestCoverageObservationV2({ ...base, applicability: "hypothesized_not_applicable", relation: "hypothesis" })).toMatchObject({ summaryState: "relation_unresolved" });
    expect(evaluateTestCoverageObservationV2({ ...base, execution: "reported_pass" })).toMatchObject({ summaryState: "missing_targeted_test" });
  });

  it("uses explicit authoritative N/A only and does not assert a requirement outcome", () => {
    const result = evaluateTestCoverageObservationV2({ ...base, applicability: "not_applicable_by_contract" });

    expect(result).toMatchObject({ summaryState: "test_not_applicable" });
    expect(JSON.stringify(result)).not.toContain("requirementOutcome");
  });
});
