import { describe, expect, it } from "vitest";
import {
  assertDevTenSmokeExecutionAllowed,
  buildDevTenSmokePlan,
  buildPreparedFreezeManifest,
  classifyLabelRow,
  createDecisionTimer,
  HUMAN_AB_HOLDOUT_RECEIPT_VERSION,
  HUMAN_AB_PREFLIGHT_VERSION,
  HUMAN_AB_PROTOCOL_VERSION,
  summarizeCompletedRows,
  validateAssignmentPlan,
  validateCoordinatorImportRow,
  validateHoldoutReceipt,
  validatePreparedFreezeManifest,
  validateRaterPacket
} from "./llm-proof-planner-human-ab-core.mjs";

function assignment(reviewer, caseId, arm, index) {
  return {
    assignmentId: `assign-${reviewer}-${caseId}-${arm}`,
    raterPseudonym: reviewer,
    opaqueCaseId: caseId,
    blindedArmId: arm,
    assignmentIndex: index
  };
}

function validPlan() {
  return {
    protocolVersion: HUMAN_AB_PROTOCOL_VERSION,
    preflightVersion: HUMAN_AB_PREFLIGHT_VERSION,
    minReviewersPerCaseArm: 2,
    experimentId: "exp-001",
    assignments: [
      assignment("rater-1", "case-1", "A", 1),
      assignment("rater-2", "case-1", "A", 1),
      assignment("rater-3", "case-1", "B", 1),
      assignment("rater-4", "case-1", "B", 1)
    ]
  };
}

function completedRow(overrides = {}) {
  return {
    protocolVersion: HUMAN_AB_PROTOCOL_VERSION,
    experimentId: "exp-001",
    sealedHoldoutReceiptSha256: "a".repeat(64),
    raterPseudonym: "rater-1",
    opaqueCaseId: "case-1",
    blindedArmId: "A",
    assignmentIndex: 1,
    requirementAccuracy: 4,
    proofPlanUsefulness: 5,
    warningAccuracy: 3,
    reviewDecisionTimeSeconds: 12,
    notScorableReason: null,
    startedAt: "2026-07-10T00:00:00.000Z",
    submittedAt: "2026-07-10T00:00:12.000Z",
    timingIntegrity: "runner_monotonic_complete",
    ...overrides
  };
}

describe("Human A/B assignment preflight", () => {
  it("accepts balanced independent assignments", () => {
    expect(validateAssignmentPlan(validPlan())).toMatchObject({ valid: true, errors: [] });
  });

  it("rejects the same reviewer seeing A and B for one normalized case", () => {
    const plan = validPlan();
    plan.assignments.push(assignment(" RATER-1 ", "ＣＡＳＥ-１", "B", 2));
    const preflight = validateAssignmentPlan(plan);
    expect(preflight.valid).toBe(false);
    expect(preflight.errors.join("\n")).toContain("same reviewer/case");
  });

  it("rejects duplicate same-arm exposure and non-contiguous reviewer indexes", () => {
    const plan = validPlan();
    plan.assignments.push({ ...assignment("rater-1", "case-1", "A", 3), assignmentId: "extra" });
    const preflight = validateAssignmentPlan(plan);
    expect(preflight.valid).toBe(false);
    expect(preflight.errors.join("\n")).toContain("same reviewer/case");
    expect(preflight.errors.join("\n")).toContain("contiguous");
  });

  it("rejects insufficient independent reviewers and unblinding fields", () => {
    const plan = validPlan();
    plan.assignments = [assignment("rater-1", "case-1", "A", 1), { ...assignment("rater-2", "case-1", "B", 1), armSource: "llm" }];
    const preflight = validateAssignmentPlan(plan);
    expect(preflight.valid).toBe(false);
    expect(preflight.errors.join("\n")).toContain("independent reviewers");
    expect(preflight.errors.join("\n")).toContain("unblinding");
  });

  it("rejects a rater packet containing duplicate cases or coordinator-only metadata", () => {
    const packet = {
      protocolVersion: HUMAN_AB_PROTOCOL_VERSION,
      experimentId: "exp-001",
      sealedHoldoutReceiptSha256: "a".repeat(64),
      assignmentPlanSha256: "b".repeat(64),
      assignmentPreflightSha256: "c".repeat(64),
      globalAssignmentPreflightPassed: true,
      raterPseudonym: "rater-1",
      assignments: [
        { assignmentId: "a1", assignmentIndex: 1, opaqueCaseId: "case-1", blindedArmId: "A", sourcePacket: "bounded", reportText: "report", privacyPolicy: { summaryOnly: true } },
        { assignmentId: "a2", assignmentIndex: 2, opaqueCaseId: " CASE-1 ", blindedArmId: "B", sourcePacket: "bounded", reportText: "report", privacyPolicy: { summaryOnly: true }, resolvedModel: "hidden" }
      ]
    };
    const preflight = validateRaterPacket(packet);
    expect(preflight.valid).toBe(false);
    expect(preflight.errors.join("\n")).toContain("repeats a case");
    expect(preflight.errors.join("\n")).toContain("unblinding");
  });

  it("rejects rater packets without experiment, receipt, and passed global-plan bindings", () => {
    const packet = {
      protocolVersion: HUMAN_AB_PROTOCOL_VERSION,
      raterPseudonym: "rater-1",
      assignments: [
        { assignmentId: "a1", assignmentIndex: 1, opaqueCaseId: "case-1", blindedArmId: "A", sourcePacket: "bounded", reportText: "report", privacyPolicy: { summaryOnly: true } }
      ]
    };
    const preflight = validateRaterPacket(packet);
    expect(preflight.valid).toBe(false);
    expect(preflight.errors.join("\n")).toContain("experimentId");
    expect(preflight.errors.join("\n")).toContain("sealedHoldoutReceiptSha256");
    expect(preflight.errors.join("\n")).toContain("globalAssignmentPreflightPassed");
  });

  it("rejects underscore variants of coordinator-only fields", () => {
    const plan = validPlan();
    plan.assignments[0].arm_mapping = "hidden";
    expect(validateAssignmentPlan(plan).errors.join("\n")).toContain("unblinding");
  });
});

describe("Human A/B completed-row summaries", () => {
  it("includes only fully completed scorable rows", () => {
    const rows = [
      completedRow({ requirementAccuracy: 5, reviewDecisionTimeSeconds: 10 }),
      completedRow({ raterPseudonym: "rater-2", opaqueCaseId: "case-2", blindedArmId: "B", requirementAccuracy: 3, proofPlanUsefulness: 2, warningAccuracy: 4, reviewDecisionTimeSeconds: 20 }),
      completedRow({ raterPseudonym: "rater-3", opaqueCaseId: "case-3", requirementAccuracy: null }),
      completedRow({ raterPseudonym: "rater-4", opaqueCaseId: "case-4", notScorableReason: "operational_failure" })
    ];
    expect(classifyLabelRow(rows[2])).toBe("partial");
    expect(classifyLabelRow(rows[3])).toBe("not_scorable");
    expect(summarizeCompletedRows(rows)).toEqual({
      eligibleRowCount: 2,
      excludedRowCount: 2,
      byArm: {
        A: {
          completedRowCount: 1,
          requirementAccuracyMedian: 5,
          proofPlanUsefulnessMedian: 5,
          warningAccuracyMedian: 3,
          reviewDecisionTimeMedianSeconds: 10,
          reviewDecisionTimeP75Seconds: 10
        },
        B: {
          completedRowCount: 1,
          requirementAccuracyMedian: 3,
          proofPlanUsefulnessMedian: 2,
          warningAccuracyMedian: 4,
          reviewDecisionTimeMedianSeconds: 20,
          reviewDecisionTimeP75Seconds: 20
        }
      }
    });
  });

  it("requires valid runner timestamps in chronological order", () => {
    expect(classifyLabelRow(completedRow({ submittedAt: "2026-07-09T23:59:59.000Z" }))).toBe("partial");
    expect(classifyLabelRow(completedRow({ startedAt: null }))).toBe("partial");
    expect(classifyLabelRow(completedRow({ timingIntegrity: "manual" }))).toBe("partial");
  });

  it("accepts only scalar coordinator imports with runner timing provenance", () => {
    expect(validateCoordinatorImportRow(completedRow())).toMatchObject({ valid: true, state: "completed" });
    expect(validateCoordinatorImportRow(completedRow({ requirementEvidenceNote: "=WEBSERVICE(\"x\")" })).valid).toBe(false);
    expect(validateCoordinatorImportRow(completedRow({ timingIntegrity: "manual" })).valid).toBe(false);
  });
});

describe("Human A/B automatic timing and freeze gates", () => {
  it("records monotonic decision time and prevents restart", () => {
    const monotonic = [1000, 4250];
    const wall = ["2026-07-10T00:00:00.000Z", "2026-07-10T00:00:03.250Z"];
    const timer = createDecisionTimer({ monotonicNow: () => monotonic.shift(), wallNow: () => wall.shift() });
    expect(timer.reveal()).toEqual({ startedAt: "2026-07-10T00:00:00.000Z" });
    expect(() => timer.reveal()).toThrow("exactly once");
    expect(timer.complete()).toMatchObject({ reviewDecisionTimeSeconds: 3.25, timingIntegrity: "runner_monotonic_complete" });
  });

  it("fails closed when the exact API key variable is missing or execution is not explicitly authorized", () => {
    const missingKey = buildDevTenSmokePlan({ apiKeyConfigured: false });
    expect(() => assertDevTenSmokeExecutionAllowed(missingKey, { explicitExecutionAuthorized: true })).toThrow("OPENAI_API_KEY");
    const ready = buildDevTenSmokePlan({ apiKeyConfigured: true });
    expect(() => assertDevTenSmokeExecutionAllowed(ready)).toThrow("not explicitly authorized");
    expect(assertDevTenSmokeExecutionAllowed(ready, { explicitExecutionAuthorized: true })).toBe(true);
  });

  it("rejects wrong dev IDs, baseline hash, and output paths", () => {
    const wrongIds = buildDevTenSmokePlan({ apiKeyConfigured: true });
    wrongIds.candidateIds = Array.from({ length: 10 }, (_, index) => `wrong-${index}`);
    expect(() => assertDevTenSmokeExecutionAllowed(wrongIds, { explicitExecutionAuthorized: true })).toThrow("fixed ordered 10 dev cases");
    const wrongHash = buildDevTenSmokePlan({ apiKeyConfigured: true });
    wrongHash.baselineSourceSha256 = "0".repeat(64);
    expect(() => assertDevTenSmokeExecutionAllowed(wrongHash, { explicitExecutionAuthorized: true })).toThrow("baseline hash");
    const wrongPath = buildDevTenSmokePlan({ apiKeyConfigured: true });
    wrongPath.resultsPath = "eval/llm-proof-planner-semantic-integrity-results.json";
    expect(() => assertDevTenSmokeExecutionAllowed(wrongPath, { explicitExecutionAuthorized: true })).toThrow("isolated dev10-smoke");
  });

  it("keeps the prepared manifest blocked until source, snapshot, workbooks, assignments, and holdout are frozen", () => {
    const manifest = buildPreparedFreezeManifest({
      generatedAt: "2026-07-10T00:00:00.000Z",
      source: { commit: "0".repeat(40), workingTreeDirty: true, changedPathCount: 97 },
      planner: { requestedModel: "gpt-5.6-luna", resolvedModelSnapshot: null, modelSnapshotStatus: "unavailable", plannerInputSchemaVersion: 1, plannerOutputSchemaVersion: "2.1" },
      workbooks: { raterWorkbookHashes: {}, coordinatorSummarySha256: null },
      assignmentPreflight: { version: HUMAN_AB_PREFLIGHT_VERSION, passed: false },
      devSmoke: buildDevTenSmokePlan({ apiKeyConfigured: false }),
      hashes: { algorithm: "sha256", baseline: "a".repeat(64) }
    });
    expect(manifest.status).toBe("prepared_not_frozen");
    expect(manifest.blockers).toEqual([
      "source_tree_not_clean",
      "resolved_model_snapshot_not_frozen",
      "per_rater_workbook_hashes_missing",
      "coordinator_summary_hash_missing",
      "labels_header_freeze_not_verified",
      "assignment_preflight_not_passed",
      "openai_api_key_not_configured",
      "sealed_holdout_receipt_not_bound"
    ]);
  });

  it("validates holdout receipts and refuses malformed ready manifests", () => {
    const receipt = {
      receiptVersion: HUMAN_AB_HOLDOUT_RECEIPT_VERSION,
      holdoutId: "holdout-001",
      policyVersion: "policy-v1",
      caseCount: 20,
      sealedAt: "2026-07-11T00:00:00.000Z",
      privateManifestSha256: "a".repeat(64),
      normalizerVersion: "normalizer-v1",
      sourceCommit: "b".repeat(40)
    };
    expect(validateHoldoutReceipt(receipt)).toEqual({ valid: true, errors: [] });
    expect(validateHoldoutReceipt({ ...receipt, privateManifestSha256: "bad" }).valid).toBe(false);

    const malformed = {
      manifestVersion: "agentproof-human-ab-freeze.v1",
      protocolVersion: HUMAN_AB_PROTOCOL_VERSION,
      status: "ready_to_freeze",
      generatedAt: "not-a-date",
      source: { commit: "bad", workingTreeDirty: false, changedPathCount: 0 },
      planner: { requestedModel: "gpt-5.6-luna", resolvedModelSnapshot: "snapshot", modelSnapshotStatus: "single", plannerInputSchemaVersion: 1, plannerOutputSchemaVersion: "2.1" },
      workbooks: { raterWorkbookHashes: { r1: "bad" }, coordinatorSummarySha256: "bad", labelsHeaderFreezeVerified: true },
      assignmentPreflight: { version: HUMAN_AB_PREFLIGHT_VERSION, passed: true },
      devSmoke: buildDevTenSmokePlan({ apiKeyConfigured: true }),
      holdoutReceipt: receipt,
      hashes: { baseline: "bad" },
      blockers: []
    };
    expect(validatePreparedFreezeManifest(malformed).valid).toBe(false);
  });
});
