export interface TestCoverageObservationInputV2 {
  objectiveId: string;
  changeClusterId: string;
  applicability: "required_by_contract" | "not_applicable_by_contract" | "hypothesized_required" | "hypothesized_not_applicable" | "unknown";
  relation: "verified" | "observed" | "hypothesis" | "unresolved" | "unavailable";
  execution: "verified_pass" | "verified_fail" | "reported_pass" | "reported_fail" | "not_observed" | "unavailable";
  changedFileInventoryComplete: boolean;
  applicableTestInventoryComplete: boolean;
  requiredEvidenceAvailable: boolean;
}

export interface TestCoverageObservationV2 {
  version: 2;
  objectiveId: string;
  changeClusterId: string;
  applicability: TestCoverageObservationInputV2["applicability"];
  relation: TestCoverageObservationInputV2["relation"];
  execution: TestCoverageObservationInputV2["execution"];
  summaryState: "covered_by_verified_relation" | "verified_test_failed" | "related_test_observed" | "missing_targeted_test" | "test_not_applicable" | "relation_unresolved" | "execution_unresolved" | "collection_unavailable";
}

/**
 * The evaluator is deliberately unable to change a requirement's contract
 * outcome. It only describes evidence connection state for one change group.
 */
export function evaluateTestCoverageObservationV2(input: TestCoverageObservationInputV2): TestCoverageObservationV2 {
  const summaryState = summaryStateFor(input);
  return {
    version: 2,
    objectiveId: input.objectiveId,
    changeClusterId: input.changeClusterId,
    applicability: input.applicability,
    relation: input.relation,
    execution: input.execution,
    summaryState
  };
}

function summaryStateFor(input: TestCoverageObservationInputV2): TestCoverageObservationV2["summaryState"] {
  if (input.applicability === "not_applicable_by_contract") return "test_not_applicable";
  if (!input.changedFileInventoryComplete || !input.applicableTestInventoryComplete || !input.requiredEvidenceAvailable || input.relation === "unavailable" || input.execution === "unavailable") return "collection_unavailable";
  if (input.relation === "verified" && input.execution === "verified_pass") return "covered_by_verified_relation";
  if (input.relation === "verified" && input.execution === "verified_fail") return "verified_test_failed";
  if (input.relation === "observed") return "related_test_observed";
  if (input.relation === "verified") return "execution_unresolved";
  if (input.applicability === "required_by_contract" && input.relation === "unresolved") return "missing_targeted_test";
  return "relation_unresolved";
}
