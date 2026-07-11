export const HUMAN_AB_PROTOCOL_VERSION = "agentproof-human-ab.v1";
export const HUMAN_AB_PREFLIGHT_VERSION = "agentproof-human-ab-preflight.v1";
export const HUMAN_AB_SMOKE_PLAN_VERSION = "agentproof-llm-planner-dev10-smoke.v1";
export const HUMAN_AB_FREEZE_MANIFEST_VERSION = "agentproof-human-ab-freeze.v1";
export const HUMAN_AB_HOLDOUT_RECEIPT_VERSION = "agentproof-sealed-holdout-receipt.v1";
export const HUMAN_AB_BASELINE_SHA256 = "0af4c4b528cc155c7916686f6c6f97119b24f134d42cc8e62103908738e960cf";
export const HUMAN_AB_DEV_TEN_IDS = Object.freeze(
  Array.from({ length: 10 }, (_, index) => `roleproof-blind-${String(index + 1).padStart(3, "0")}`)
);

const ALLOWED_ARMS = new Set(["A", "B"]);
const ALLOWED_NOT_SCORABLE_REASONS = new Set([
  "insufficient_source_evidence",
  "operational_failure"
]);
const FORBIDDEN_RATER_KEYS = new Set([
  "armsource",
  "armmapping",
  "resolvedmodel",
  "resolvedmodelsnapshot",
  "requestedmodel",
  "promptversion",
  "schemaversion",
  "selectionreason",
  "expectedstressors",
  "oracle",
  "otherreviewer",
  "summary"
]);

export function validateAssignmentPlan(value, { minReviewersPerCaseArm = 2 } = {}) {
  const errors = [];
  if (!isRecord(value)) return invalid("Assignment plan must be an object.");
  if (value.protocolVersion !== HUMAN_AB_PROTOCOL_VERSION) errors.push(`protocolVersion must equal ${HUMAN_AB_PROTOCOL_VERSION}.`);
  if (value.preflightVersion !== HUMAN_AB_PREFLIGHT_VERSION) errors.push(`preflightVersion must equal ${HUMAN_AB_PREFLIGHT_VERSION}.`);
  if (value.minReviewersPerCaseArm !== minReviewersPerCaseArm) errors.push("minReviewersPerCaseArm must match the preflight configuration.");
  if (!validId(value.experimentId)) errors.push("experimentId must be a bounded opaque ID.");
  if (!Array.isArray(value.assignments) || value.assignments.length === 0) {
    errors.push("assignments must contain at least one row.");
    return result(errors, { assignmentCount: 0, reviewerCount: 0, caseCount: 0 });
  }
  if (value.assignments.length > 2000) errors.push("assignments must contain at most 2000 rows.");

  const assignmentIds = new Set();
  const reviewerCase = new Map();
  const reviewerIndexes = new Map();
  const reviewerArms = new Map();
  const caseArmReviewers = new Map();
  const caseArms = new Map();
  const reviewers = new Set();
  const cases = new Set();

  value.assignments.forEach((assignment, index) => {
    const path = `assignments[${index}]`;
    if (!isRecord(assignment)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    if (containsForbiddenRaterKey(assignment)) errors.push(`${path} contains coordinator-only or unblinding fields.`);
    const assignmentId = canonicalId(assignment.assignmentId);
    const reviewer = canonicalId(assignment.raterPseudonym);
    const caseId = canonicalId(assignment.opaqueCaseId);
    const arm = typeof assignment.blindedArmId === "string" ? assignment.blindedArmId.trim().toUpperCase() : "";
    const assignmentIndex = assignment.assignmentIndex;

    if (!assignmentId) errors.push(`${path}.assignmentId must be a bounded opaque ID.`);
    if (!reviewer) errors.push(`${path}.raterPseudonym must be a bounded opaque ID.`);
    if (!caseId) errors.push(`${path}.opaqueCaseId must be a bounded opaque ID.`);
    if (!ALLOWED_ARMS.has(arm)) errors.push(`${path}.blindedArmId must be opaque A or B.`);
    if (!Number.isInteger(assignmentIndex) || assignmentIndex < 1) errors.push(`${path}.assignmentIndex must be a positive integer.`);

    if (assignmentId && assignmentIds.has(assignmentId)) errors.push(`${path}.assignmentId duplicates another assignment after canonicalization.`);
    if (assignmentId) assignmentIds.add(assignmentId);
    if (!reviewer || !caseId || !ALLOWED_ARMS.has(arm) || !Number.isInteger(assignmentIndex) || assignmentIndex < 1) return;

    reviewers.add(reviewer);
    cases.add(caseId);
    const reviewerCaseKey = `${reviewer}::${caseId}`;
    if (reviewerCase.has(reviewerCaseKey)) {
      errors.push(`${path} repeats the same reviewer/case; one reviewer must never see both arms or a duplicate arm.`);
    } else {
      reviewerCase.set(reviewerCaseKey, arm);
    }

    const indexes = reviewerIndexes.get(reviewer) ?? [];
    if (indexes.includes(assignmentIndex)) errors.push(`${path}.assignmentIndex duplicates another index for this reviewer.`);
    indexes.push(assignmentIndex);
    reviewerIndexes.set(reviewer, indexes);
    const reviewerArmCounts = reviewerArms.get(reviewer) ?? { A: 0, B: 0 };
    reviewerArmCounts[arm] += 1;
    reviewerArms.set(reviewer, reviewerArmCounts);

    const caseArmKey = `${caseId}::${arm}`;
    const armReviewers = caseArmReviewers.get(caseArmKey) ?? new Set();
    armReviewers.add(reviewer);
    caseArmReviewers.set(caseArmKey, armReviewers);
    const arms = caseArms.get(caseId) ?? new Set();
    arms.add(arm);
    caseArms.set(caseId, arms);
  });

  for (const [reviewer, indexes] of reviewerIndexes) {
    const sorted = [...indexes].sort((a, b) => a - b);
    const contiguous = sorted.every((valueAtIndex, index) => valueAtIndex === index + 1);
    if (!contiguous) errors.push(`Reviewer ${reviewer} assignmentIndex values must be unique and contiguous from 1.`);
    const armCounts = reviewerArms.get(reviewer) ?? { A: 0, B: 0 };
    if (Math.abs(armCounts.A - armCounts.B) > 1) errors.push(`Reviewer ${reviewer} must have balanced opaque arm counts.`);
  }

  for (const caseId of cases) {
    const arms = caseArms.get(caseId) ?? new Set();
    if (!(arms.has("A") && arms.has("B"))) errors.push(`Case ${caseId} must have both opaque arms A and B.`);
    for (const arm of ["A", "B"]) {
      const count = caseArmReviewers.get(`${caseId}::${arm}`)?.size ?? 0;
      if (count < minReviewersPerCaseArm) {
        errors.push(`Case ${caseId} arm ${arm} requires at least ${minReviewersPerCaseArm} independent reviewers.`);
      }
    }
    const aCount = caseArmReviewers.get(`${caseId}::A`)?.size ?? 0;
    const bCount = caseArmReviewers.get(`${caseId}::B`)?.size ?? 0;
    if (aCount !== bCount) errors.push(`Case ${caseId} must have equal independent reviewer counts for A and B.`);
  }

  return result(errors, {
    assignmentCount: value.assignments.length,
    reviewerCount: reviewers.size,
    caseCount: cases.size,
    minReviewersPerCaseArm
  });
}

export function validateRaterPacket(value) {
  const errors = [];
  if (!isRecord(value)) return invalid("Rater packet must be an object.");
  if (containsForbiddenRaterKey(value)) errors.push("Rater packet contains coordinator-only or unblinding fields.");
  if (value.protocolVersion !== HUMAN_AB_PROTOCOL_VERSION) errors.push(`protocolVersion must equal ${HUMAN_AB_PROTOCOL_VERSION}.`);
  if (!validId(value.experimentId)) errors.push("experimentId must be a bounded opaque ID.");
  if (!isSha256(value.sealedHoldoutReceiptSha256)) errors.push("sealedHoldoutReceiptSha256 must be 64 lowercase hex characters.");
  if (!isSha256(value.assignmentPlanSha256)) errors.push("assignmentPlanSha256 must be 64 lowercase hex characters.");
  if (!isSha256(value.assignmentPreflightSha256)) errors.push("assignmentPreflightSha256 must be 64 lowercase hex characters.");
  if (value.globalAssignmentPreflightPassed !== true) errors.push("globalAssignmentPreflightPassed must be true.");
  const reviewer = canonicalId(value.raterPseudonym);
  if (!reviewer) errors.push("raterPseudonym must be a bounded opaque ID.");
  if (!Array.isArray(value.assignments) || value.assignments.length === 0) errors.push("assignments must contain at least one row.");
  const cases = new Set();
  const assignmentIds = new Set();
  const indexes = [];
  for (const [index, assignment] of (Array.isArray(value.assignments) ? value.assignments : []).entries()) {
    const path = `assignments[${index}]`;
    if (!isRecord(assignment)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (containsForbiddenRaterKey(assignment)) errors.push(`${path} contains coordinator-only or unblinding fields.`);
    const caseId = canonicalId(assignment.opaqueCaseId);
    const arm = typeof assignment.blindedArmId === "string" ? assignment.blindedArmId.trim().toUpperCase() : "";
    const assignmentId = canonicalId(assignment.assignmentId);
    if (!assignmentId) errors.push(`${path}.assignmentId must be a bounded opaque ID.`);
    if (assignmentId && assignmentIds.has(assignmentId)) errors.push(`${path}.assignmentId duplicates another assignment.`);
    if (assignmentId) assignmentIds.add(assignmentId);
    if (!caseId) errors.push(`${path}.opaqueCaseId must be a bounded opaque ID.`);
    if (!ALLOWED_ARMS.has(arm)) errors.push(`${path}.blindedArmId must be opaque A or B.`);
    if (caseId && cases.has(caseId)) errors.push(`${path} repeats a case in one rater packet.`);
    if (caseId) cases.add(caseId);
    if (!Number.isInteger(assignment.assignmentIndex) || assignment.assignmentIndex < 1) errors.push(`${path}.assignmentIndex must be positive.`);
    else indexes.push(assignment.assignmentIndex);
    if (!isRecord(assignment.privacyPolicy) || assignment.privacyPolicy.summaryOnly !== true) errors.push(`${path}.privacyPolicy.summaryOnly must be true.`);
    if (typeof assignment.sourcePacket !== "string" || !assignment.sourcePacket.trim() || assignment.sourcePacket.length > 20_000) errors.push(`${path}.sourcePacket must be non-empty bounded text.`);
    if (typeof assignment.reportText !== "string" || !assignment.reportText.trim() || assignment.reportText.length > 20_000) errors.push(`${path}.reportText must be non-empty bounded text.`);
  }
  const sorted = [...indexes].sort((a, b) => a - b);
  if (!sorted.every((valueAtIndex, index) => valueAtIndex === index + 1)) errors.push("assignmentIndex values must be unique and contiguous from 1.");
  return result(errors, { reviewer: reviewer ?? null, assignmentCount: Array.isArray(value.assignments) ? value.assignments.length : 0 });
}

export function classifyLabelRow(row) {
  if (!isRecord(row) || Object.values(row).every(blank)) return "empty";
  const reason = nullableText(row.notScorableReason);
  if (reason && !ALLOWED_NOT_SCORABLE_REASONS.has(reason)) return "invalid";
  if (reason) return "not_scorable";
  const startedAt = validIsoTime(row.startedAt);
  const submittedAt = validIsoTime(row.submittedAt);
  const complete = [
    row.protocolVersion === HUMAN_AB_PROTOCOL_VERSION,
    validId(row.experimentId),
    typeof row.sealedHoldoutReceiptSha256 === "string" && /^[0-9a-f]{64}$/i.test(row.sealedHoldoutReceiptSha256),
    validId(row.raterPseudonym),
    validId(row.opaqueCaseId),
    ALLOWED_ARMS.has(typeof row.blindedArmId === "string" ? row.blindedArmId.trim().toUpperCase() : ""),
    Number.isInteger(row.assignmentIndex) && row.assignmentIndex >= 1,
    validScore(row.requirementAccuracy),
    validScore(row.proofPlanUsefulness),
    validScore(row.warningAccuracy),
    typeof row.reviewDecisionTimeSeconds === "number" && Number.isFinite(row.reviewDecisionTimeSeconds) && row.reviewDecisionTimeSeconds >= 0,
    row.timingIntegrity === "runner_monotonic_complete",
    startedAt !== null,
    submittedAt !== null,
    startedAt !== null && submittedAt !== null && submittedAt >= startedAt
  ].every(Boolean);
  return complete ? "completed" : "partial";
}

export function summarizeCompletedRows(rows) {
  const completed = (Array.isArray(rows) ? rows : []).filter((row) => classifyLabelRow(row) === "completed");
  const byArm = {};
  for (const arm of ["A", "B"]) {
    const armRows = completed.filter((row) => row.blindedArmId.trim().toUpperCase() === arm);
    byArm[arm] = {
      completedRowCount: armRows.length,
      requirementAccuracyMedian: median(armRows.map((row) => row.requirementAccuracy)),
      proofPlanUsefulnessMedian: median(armRows.map((row) => row.proofPlanUsefulness)),
      warningAccuracyMedian: median(armRows.map((row) => row.warningAccuracy)),
      reviewDecisionTimeMedianSeconds: median(armRows.map((row) => row.reviewDecisionTimeSeconds)),
      reviewDecisionTimeP75Seconds: percentileInc(armRows.map((row) => row.reviewDecisionTimeSeconds), 0.75)
    };
  }
  return { eligibleRowCount: completed.length, excludedRowCount: (Array.isArray(rows) ? rows.length : 0) - completed.length, byArm };
}

export function validateCoordinatorImportRow(row) {
  const errors = [];
  if (!isRecord(row)) return { valid: false, errors: ["Imported row must be an object."], state: "invalid" };
  const allowedKeys = new Set([
    "protocolVersion", "experimentId", "sealedHoldoutReceiptSha256", "raterPseudonym", "opaqueCaseId", "blindedArmId",
    "assignmentIndex", "requirementAccuracy", "requirementEvidenceNote", "proofPlanUsefulness", "proofPlanEvidenceNote",
    "warningAccuracy", "warningEvidenceNote", "reviewDecisionTimeSeconds", "notScorableReason", "startedAt", "submittedAt", "timingIntegrity"
  ]);
  for (const [key, value] of Object.entries(row)) {
    if (!allowedKeys.has(key)) errors.push(`Imported row contains unexpected field: ${key}.`);
    if (!isScalar(value)) errors.push(`Imported field ${key} must be scalar.`);
    if (typeof value === "string" && /^[=+@]/.test(value.trimStart())) errors.push(`Imported field ${key} contains formula-like text.`);
  }
  const state = classifyLabelRow(row);
  if (!["completed", "not_scorable"].includes(state)) errors.push(`Imported row state ${state} is not eligible for coordinator import.`);
  if (state === "not_scorable" && row.timingIntegrity !== "runner_monotonic_not_scorable") {
    errors.push("NotScorable rows must carry runner_monotonic_not_scorable timing provenance.");
  }
  return { valid: errors.length === 0, errors, state };
}

export function createDecisionTimer({ monotonicNow = () => globalThis.performance.now(), wallNow = () => new Date().toISOString() } = {}) {
  let state = "idle";
  let startedMonotonic = null;
  let startedAt = null;
  return {
    reveal() {
      if (state !== "idle") throw new Error("Decision timer can start exactly once.");
      startedMonotonic = monotonicNow();
      startedAt = wallNow();
      if (!Number.isFinite(startedMonotonic) || validIsoTime(startedAt) === null) throw new Error("Decision timer failed to capture a valid start.");
      state = "running";
      return { startedAt };
    },
    complete() {
      if (state !== "running") throw new Error("Decision timer must be running before completion.");
      const stoppedMonotonic = monotonicNow();
      const submittedAt = wallNow();
      const elapsedMs = stoppedMonotonic - startedMonotonic;
      state = "completed";
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !validIsoTime(submittedAt)) throw new Error("Decision timer produced invalid elapsed time.");
      return {
        startedAt,
        submittedAt,
        reviewDecisionTimeSeconds: Math.round((elapsedMs / 1000) * 1000) / 1000,
        timingIntegrity: "runner_monotonic_complete"
      };
    },
    status() {
      return state;
    }
  };
}

export function buildDevTenSmokePlan({ apiKeyConfigured, requestedModel = "gpt-5.6-luna" } = {}) {
  const validModel = requestedModel === "gpt-5.6-luna";
  return {
    planVersion: HUMAN_AB_SMOKE_PLAN_VERSION,
    status: "planned_not_run",
    baselineRole: "regression_dev_set_not_holdout",
    baselineSourceSha256: HUMAN_AB_BASELINE_SHA256,
    candidateIds: [...HUMAN_AB_DEV_TEN_IDS],
    candidateCount: 10,
    repeatCount: 1,
    requestedModel,
    apiKeyRequired: true,
    apiKeyConfiguredAtPreparation: apiKeyConfigured === true,
    isolatedOutputRequired: true,
    resultsPath: "outputs/controlled-human-ab-v1/dev10-smoke/gpt-5.6-luna-dev10-once-results.json",
    reportPath: "outputs/controlled-human-ab-v1/dev10-smoke/gpt-5.6-luna-dev10-once-report.md",
    existingEvaluationArtifactOverwriteAllowed: false,
    executionAuthorized: false,
    readyForExplicitExecutionRequest: apiKeyConfigured === true && validModel,
    resolvedModelSnapshot: null,
    note: "Preparation only. This plan must not be used as holdout evidence or executed without a separate explicit request."
  };
}

export function assertDevTenSmokeExecutionAllowed(plan, { explicitExecutionAuthorized = false } = {}) {
  if (!isRecord(plan) || plan.planVersion !== HUMAN_AB_SMOKE_PLAN_VERSION) throw new Error("Unknown dev smoke plan.");
  if (plan.apiKeyConfiguredAtPreparation !== true) throw new Error("OPENAI_API_KEY is required before any dev smoke network call or output write.");
  if (plan.requestedModel !== "gpt-5.6-luna") throw new Error("Dev smoke model must equal gpt-5.6-luna.");
  if (plan.baselineSourceSha256 !== HUMAN_AB_BASELINE_SHA256) throw new Error("Dev smoke baseline hash is invalid.");
  if (plan.candidateCount !== 10 || plan.repeatCount !== 1 || !sameStrings(plan.candidateIds, HUMAN_AB_DEV_TEN_IDS)) throw new Error("Dev smoke must use the fixed ordered 10 dev cases exactly once.");
  if (plan.existingEvaluationArtifactOverwriteAllowed !== false || plan.isolatedOutputRequired !== true) throw new Error("Dev smoke must use isolated no-clobber outputs.");
  if (![plan.resultsPath, plan.reportPath].every(validSmokeOutputPath)) throw new Error("Dev smoke output paths must stay inside the isolated dev10-smoke directory.");
  if (explicitExecutionAuthorized !== true) throw new Error("Dev smoke execution was not explicitly authorized.");
  return true;
}

export function buildPreparedFreezeManifest({ generatedAt, source, planner, workbooks, assignmentPreflight, devSmoke, holdoutReceipt = null, hashes = {} }) {
  const evidenceErrors = validateFreezeEvidence({ generatedAt, source, planner, workbooks, assignmentPreflight, devSmoke, holdoutReceipt, hashes });
  const blockers = [
    ...evidenceErrors.map((error) => `invalid_freeze_evidence:${error}`),
    ...(source?.workingTreeDirty === false && source?.changedPathCount === 0 ? [] : ["source_tree_not_clean"]),
    ...(planner?.resolvedModelSnapshot && planner?.modelSnapshotStatus === "single" ? [] : ["resolved_model_snapshot_not_frozen"]),
    ...(workbooks?.raterWorkbookHashes && Object.keys(workbooks.raterWorkbookHashes).length > 0 ? [] : ["per_rater_workbook_hashes_missing"]),
    ...(workbooks?.coordinatorSummarySha256 ? [] : ["coordinator_summary_hash_missing"]),
    ...(workbooks?.labelsHeaderFreezeVerified === true ? [] : ["labels_header_freeze_not_verified"]),
    ...(assignmentPreflight?.passed === true ? [] : ["assignment_preflight_not_passed"]),
    ...(devSmoke?.apiKeyConfiguredAtPreparation === true ? [] : ["openai_api_key_not_configured"]),
    ...(holdoutReceipt ? [] : ["sealed_holdout_receipt_not_bound"])
  ];
  return {
    manifestVersion: HUMAN_AB_FREEZE_MANIFEST_VERSION,
    status: blockers.length === 0 ? "ready_to_freeze" : "prepared_not_frozen",
    generatedAt,
    protocolVersion: HUMAN_AB_PROTOCOL_VERSION,
    privacy: "human-ab-coordinator-metadata-only",
    source,
    planner,
    workbooks,
    assignmentPreflight,
    devSmoke,
    holdoutReceipt,
    hashes,
    blockers,
    productDefaultChanged: false,
    existingEvaluationArtifactsChanged: false
  };
}

export function validateHoldoutReceipt(value) {
  const errors = [];
  if (!isRecord(value)) return { valid: false, errors: ["Holdout receipt must be an object."] };
  if (value.receiptVersion !== HUMAN_AB_HOLDOUT_RECEIPT_VERSION) errors.push(`receiptVersion must equal ${HUMAN_AB_HOLDOUT_RECEIPT_VERSION}.`);
  if (!validId(value.holdoutId)) errors.push("holdoutId must be a bounded opaque ID.");
  if (!validId(value.policyVersion)) errors.push("policyVersion must be a bounded version ID.");
  if (!Number.isInteger(value.caseCount) || value.caseCount < 1) errors.push("caseCount must be a positive integer.");
  if (validIsoTime(value.sealedAt) === null) errors.push("sealedAt must be an ISO timestamp.");
  if (!isSha256(value.privateManifestSha256)) errors.push("privateManifestSha256 must be SHA-256.");
  if (!validId(value.normalizerVersion)) errors.push("normalizerVersion must be a bounded version ID.");
  if (typeof value.sourceCommit !== "string" || !/^[0-9a-f]{40}$/.test(value.sourceCommit)) errors.push("sourceCommit must be a lowercase 40-hex commit.");
  return { valid: errors.length === 0, errors };
}

export function validatePreparedFreezeManifest(value) {
  if (!isRecord(value)) return { valid: false, errors: ["Freeze manifest must be an object."] };
  const errors = validateFreezeEvidence(value);
  if (value.manifestVersion !== HUMAN_AB_FREEZE_MANIFEST_VERSION) errors.push(`manifestVersion must equal ${HUMAN_AB_FREEZE_MANIFEST_VERSION}.`);
  if (value.protocolVersion !== HUMAN_AB_PROTOCOL_VERSION) errors.push(`protocolVersion must equal ${HUMAN_AB_PROTOCOL_VERSION}.`);
  if (!Array.isArray(value.blockers)) errors.push("blockers must be an array.");
  const expectedStatus = Array.isArray(value.blockers) && value.blockers.length === 0 ? "ready_to_freeze" : "prepared_not_frozen";
  if (value.status !== expectedStatus) errors.push(`status must equal ${expectedStatus}.`);
  return { valid: errors.length === 0, errors };
}

function containsForbiddenRaterKey(value) {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (Array.isArray(value)) return value.some(containsForbiddenRaterKey);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_RATER_KEYS.has(normalizeKey(key)) || containsForbiddenRaterKey(child));
}

function validateFreezeEvidence({ generatedAt, source, planner, workbooks, assignmentPreflight, devSmoke, holdoutReceipt, hashes } = {}) {
  const errors = [];
  if (validIsoTime(generatedAt) === null) errors.push("generated_at_invalid");
  if (!isRecord(source) || typeof source.commit !== "string" || !/^[0-9a-f]{40}$/.test(source.commit)) errors.push("source_commit_invalid");
  if (!isRecord(planner) || planner.requestedModel !== "gpt-5.6-luna" || planner.plannerInputSchemaVersion !== 1 || planner.plannerOutputSchemaVersion !== "2.1") errors.push("planner_contract_invalid");
  if (planner?.modelSnapshotStatus === "single" && !validId(planner.resolvedModelSnapshot)) errors.push("resolved_snapshot_invalid");
  if (!isRecord(workbooks) || (workbooks.coordinatorSummarySha256 && !isSha256(workbooks.coordinatorSummarySha256))) errors.push("workbook_hash_invalid");
  if (isRecord(workbooks?.raterWorkbookHashes) && Object.values(workbooks.raterWorkbookHashes).some((hash) => !isSha256(hash))) errors.push("rater_workbook_hash_invalid");
  if (!isRecord(assignmentPreflight) || assignmentPreflight.version !== HUMAN_AB_PREFLIGHT_VERSION) errors.push("assignment_preflight_version_invalid");
  if (!isRecord(devSmoke) || devSmoke.planVersion !== HUMAN_AB_SMOKE_PLAN_VERSION || devSmoke.candidateCount !== 10 || devSmoke.repeatCount !== 1) errors.push("dev_smoke_plan_invalid");
  if (holdoutReceipt !== null && validateHoldoutReceipt(holdoutReceipt).valid !== true) errors.push("holdout_receipt_invalid");
  if (!isRecord(hashes) || hashes.algorithm !== "sha256" || Object.entries(hashes).some(([key, hash]) => key !== "algorithm" && !isSha256(hash))) errors.push("freeze_hash_invalid");
  return uniqueStrings(errors);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentileInc(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function validScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function validSmokeOutputPath(value) {
  return typeof value === "string" && value.startsWith("outputs/controlled-human-ab-v1/dev10-smoke/") && !value.includes("..") && !value.endsWith("/");
}

function sameStrings(left, right) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSha256(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function validIsoTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validId(value) {
  return canonicalId(value) !== null;
}

function canonicalId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return normalized && normalized.length <= 120 && /^[a-z0-9][a-z0-9._:-]*$/.test(normalized) ? normalized : null;
}

function nullableText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function blank(value) {
  return value === null || value === undefined || value === "";
}

function result(errors, summary) {
  return { valid: errors.length === 0, errors, summary, preflightVersion: HUMAN_AB_PREFLIGHT_VERSION };
}

function invalid(error) {
  return result([error], {});
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
