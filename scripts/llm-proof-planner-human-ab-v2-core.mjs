import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  openSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { validateAssignmentPlan } from "./llm-proof-planner-human-ab-core.mjs";


export const HUMAN_AB_V2_PROTOCOL_VERSION = "agentproof-human-ab.v2";
export const HUMAN_AB_V2_PREFLIGHT_VERSION = "agentproof-human-ab-preflight.v2";
export const HUMAN_AB_V2_FREEZE_VERSION = "agentproof-human-ab-freeze.v2";
export const HUMAN_AB_V2_HOLDOUT_RECEIPT_VERSION = "agentproof-sealed-holdout-receipt.v2";
export const HUMAN_AB_V2_PACKET_VERSION = "agentproof-human-ab-rater-packet.v2";
export const HUMAN_AB_V2_PREPARED_RECEIPT_VERSION = "agentproof-human-ab-prepared-receipt.v2";
export const HUMAN_AB_V2_LABEL_JOURNAL_VERSION = "agentproof-human-ab-label-journal.v2";
export const HUMAN_AB_V2_IMPORT_RECEIPT_VERSION = "agentproof-human-ab-import-receipt.v2";

const SHA_KEYS = Object.freeze([
  "protocolSha256",
  "plannerSourceSha256",
  "promptSha256",
  "plannerSchemaSha256",
  "evaluationHarnessSha256",
  "baselineSourceSha256",
  "automaticTimerRunnerSha256"
]);
const DECISIONS = new Set(["enough", "not_enough", "unclear"]);
const NOT_SCORABLE = new Set(["insufficient_source_evidence", "operational_failure"]);
const ARMS = new Set(["A", "B"]);
const FORBIDDEN_KEY = /(?:^|_)(?:arm_?mapping|arm_?source|model|model_?id|provider|prompt|reasoning|raw_?(?:diff|log|prompt|reasoning)|oracle|reference_?label|selection_?reason|expected_?stressor|repository|pr_?url|pr_?number|token|secret)(?:$|_)/i;
const UNSAFE_TEXT = /(?:\bsk-[A-Za-z0-9_-]{12,}|\bgithub_pat_[A-Za-z0-9_]{12,}|\bghp_[A-Za-z0-9]{12,}|\bOPENAI_API_KEY\s*=|-----BEGIN [A-Z ]*PRIVATE KEY-----|authorization\s*:\s*bearer|diff --git|^\s*@@\s+-\d|^\s*---\s+\S|^\s*\+\+\+\s+\S|raw\s+(?:prompt|reasoning|diff|logs?)|(?:full\s+)?(?:stdout|stderr|console output|workflow trace)|^\s*\d{4}-\d{2}-\d{2}(?:T\S+)?\s+(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:gpt|claude|gemini)-[A-Za-z0-9._-]+|\b(?:openai|anthropic|language model|large language model|llm|ai-generated|deterministic-only|semantic assistance)\b|resolved\s+model|prompt\s+version|planner\s+(?:input|output)\s+schema|selection\s+reason|expected\s+stressor|oracle\s+label|reference\s+label)/im;

const HOLDOUT_KEYS = new Set([
  "receiptVersion", "status", "holdoutId", "experimentId", "policyVersion", "caseCount", "sealedAt",
  "privateManifestSha256", "sealedCaseSetSha256", "normalizerVersion", "sourceCommit"
]);
const SOURCE_KEYS = new Set(["commit", "workingTreeDirty", "changedPathCount", "stagedPathCount", "reproducibleFromCommit"]);
const PLANNER_KEYS = new Set(["requestedModel", "resolvedModelIdentifier", "modelSnapshotStatus", "resolvedIdentifierIsDatedSnapshot", "promptVersion", "plannerInputSchemaVersion", "plannerOutputSchemaVersion", "evaluationArtifactSchemaVersion"]);
const WORKBOOK_KEYS = new Set(["coordinatorSummarySha256", "raterWorkbookHashes", "raterWorkbookQa", "labelsHeaderSha256", "labelsHeaderFreezeVerified"]);
const WORKBOOK_QA_KEYS = new Set(["workbookSha256", "labelsHeaderSha256", "serializedFreezePaneVerified", "macrosAbsent", "externalLinksAbsent", "formulasAbsent", "verifierSha256"]);
const ASSIGNMENT_META_KEYS = new Set(["experimentId", "planSha256", "preflightSha256", "preflightPassed", "minReviewersPerCaseArm", "caseCount", "sealedCaseSetSha256", "blindedCasesSha256", "reviewerRosterSha256", "raterPseudonyms"]);
const HOLDOUT_BINDING_KEYS = new Set(["receipt", "receiptSha256"]);
const PLAN_KEYS = new Set([
  "protocolVersion", "preflightVersion", "experimentId", "sealedHoldoutReceiptSha256", "sealedCaseSetSha256",
  "reviewerRosterSha256", "minReviewersPerCaseArm", "assignments"
]);
const ASSIGNMENT_KEYS = new Set(["assignmentId", "raterPseudonym", "opaqueCaseId", "blindedArmId", "assignmentIndex"]);
const PACKET_KEYS = new Set([
  "packetVersion", "protocolVersion", "status", "experimentId", "sealedHoldoutReceiptSha256", "sealedCaseSetSha256",
  "assignmentPlanSha256", "assignmentPreflightSha256", "raterPseudonym", "raterWorkbookSha256", "assignments"
]);
const PACKET_ASSIGNMENT_KEYS = new Set([
  "assignmentId", "assignmentIndex", "opaqueCaseId", "blindedArmId", "sourcePacket", "sourcePacketSha256",
  "reportText", "reportTextSha256", "privacyPolicy"
]);
const PRIVACY_KEYS = new Set([
  "summaryOnly", "rawPromptsIncluded", "rawReasoningIncluded", "rawDiffsIncluded", "rawLogsIncluded", "secretsIncluded"
]);
const ROW_KEYS = new Set([
  "protocolVersion", "experimentId", "sealedHoldoutReceiptSha256", "assignmentPlanSha256", "assignmentPreflightSha256",
  "raterPacketSha256", "raterWorkbookSha256", "assignmentId", "raterPseudonym", "opaqueCaseId", "blindedArmId",
  "assignmentIndex", "reviewDecision", "requirementAccuracy", "requirementEvidenceNote", "proofPlanUsefulness",
  "proofPlanEvidenceNote", "warningAccuracy", "warningEvidenceNote", "reviewDecisionTimeSeconds", "notScorableReason",
  "startedAt", "submittedAt", "timingIntegrity", "rowSha256"
]);
const JOURNAL_KEYS = new Set([
  "journalVersion", "protocolVersion", "experimentId", "sealedHoldoutReceiptSha256", "assignmentPlanSha256",
  "assignmentPreflightSha256", "raterPacketSha256", "raterWorkbookSha256", "raterPseudonym", "status",
  "expectedAssignmentCount", "completedAssignmentCount", "activeAssignment", "rowsSha256", "rows"
]);
const PREPARED_RECEIPT_KEYS = new Set([
  "receiptVersion", "protocolVersion", "status", "experimentId", "freezeManifestSha256", "sealedHoldoutReceiptSha256",
  "sealedCaseSetSha256", "blindedCasesSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "assignmentSetSha256",
  "reviewerRosterSha256", "packetCount", "assignmentCount", "packets", "liveLlmCalled", "armMappingStored",
  "rawMaterialStored", "secretsStored"
]);
const PACKET_DESCRIPTOR_KEYS = new Set(["raterPseudonym", "fileName", "packetSha256", "assignmentCount"]);

export function validateHoldoutReceiptV2(value) {
  const errors = [];
  if (!isRecord(value)) return invalid("Holdout receipt must be an object.");
  exactKeys(value, HOLDOUT_KEYS, errors, "holdoutReceipt");
  if (value.receiptVersion !== HUMAN_AB_V2_HOLDOUT_RECEIPT_VERSION) errors.push("holdoutReceipt.receiptVersion is invalid.");
  if (value.status !== "sealed") errors.push("holdoutReceipt.status must equal sealed.");
  for (const key of ["holdoutId", "experimentId", "policyVersion", "normalizerVersion"]) if (!validId(value[key])) errors.push(`holdoutReceipt.${key} is invalid.`);
  if (!Number.isInteger(value.caseCount) || value.caseCount < 1 || value.caseCount > 500) errors.push("holdoutReceipt.caseCount is invalid.");
  if (!validIso(value.sealedAt)) errors.push("holdoutReceipt.sealedAt is invalid.");
  for (const key of ["privateManifestSha256", "sealedCaseSetSha256"]) if (!isSha256(value[key])) errors.push(`holdoutReceipt.${key} is invalid.`);
  if (!isCommit(value.sourceCommit)) errors.push("holdoutReceipt.sourceCommit is invalid.");
  return { valid: errors.length === 0, errors };
}

export function deriveFreezeBlockersV2(value) {
  const blockers = [];
  const source = value?.source;
  const planner = value?.planner;
  const workbooks = value?.workbooks;
  const assignment = value?.assignment;
  const holdout = value?.holdout;
  const hashes = value?.hashes;
  if (!isRecord(source) || !isCommit(source.commit) || source.workingTreeDirty !== false || source.changedPathCount !== 0 || source.stagedPathCount !== 0 || source.reproducibleFromCommit !== true) blockers.push("source_not_clean_and_reproducible");
  if (!isRecord(planner) || planner.requestedModel !== "gpt-5.6-luna" || planner.modelSnapshotStatus !== "single" || !validId(planner.resolvedModelIdentifier)) blockers.push("resolved_model_identifier_not_single");
  if (planner?.resolvedIdentifierIsDatedSnapshot !== true || typeof planner?.resolvedModelIdentifier !== "string" || !/\d{4}-\d{2}-\d{2}/.test(planner.resolvedModelIdentifier) || planner.resolvedModelIdentifier === planner.requestedModel) blockers.push("resolved_model_identifier_not_dated_snapshot");
  if (!isRecord(planner) || !validId(planner.promptVersion) || planner.plannerInputSchemaVersion !== 1 || planner.plannerOutputSchemaVersion !== "2.1" || planner.evaluationArtifactSchemaVersion !== "llm-proof-planner-evaluation.v2.1") blockers.push("planner_contract_not_frozen");
  if (!isRecord(assignment) || assignment.preflightPassed !== true || !validId(assignment.experimentId) || !isSha256(assignment.planSha256) || !isSha256(assignment.preflightSha256) || !isSha256(assignment.sealedCaseSetSha256) || !isSha256(assignment.blindedCasesSha256) || !isSha256(assignment.reviewerRosterSha256) || !Array.isArray(assignment.raterPseudonyms) || assignment.raterPseudonyms.length === 0 || !Number.isInteger(assignment.caseCount) || assignment.caseCount < 1 || !Number.isInteger(assignment.minReviewersPerCaseArm) || assignment.minReviewersPerCaseArm < 2) blockers.push("assignment_preflight_not_frozen");
  const roster = canonicalUnique(assignment?.raterPseudonyms);
  const workbookKeys = isRecord(workbooks?.raterWorkbookHashes) ? canonicalUnique(Object.keys(workbooks.raterWorkbookHashes)) : [];
  const qaKeys = isRecord(workbooks?.raterWorkbookQa) ? canonicalUnique(Object.keys(workbooks.raterWorkbookQa)) : [];
  if (!isRecord(workbooks) || !isSha256(workbooks.coordinatorSummarySha256) || !isSha256(workbooks.labelsHeaderSha256) || workbooks.labelsHeaderFreezeVerified !== true) blockers.push("workbook_freeze_not_verified");
  if (roster === null || sha256(stableJson(roster ?? [])) !== assignment?.reviewerRosterSha256) blockers.push("reviewer_roster_hash_mismatch");
  if (roster === null || workbookKeys === null || !sameStrings(roster ?? [], workbookKeys ?? []) || !sameStrings(roster ?? [], Object.keys(workbooks?.raterWorkbookHashes ?? {}).sort()) || Object.values(workbooks?.raterWorkbookHashes ?? {}).some((hash) => !isSha256(hash))) blockers.push("rater_workbook_roster_hash_mismatch");
  if (roster === null || qaKeys === null || !sameStrings(roster ?? [], qaKeys ?? []) || !sameStrings(roster ?? [], Object.keys(workbooks?.raterWorkbookQa ?? {}).sort()) || (roster ?? []).some((reviewer) => {
    const qa = workbooks?.raterWorkbookQa?.[reviewer];
    return !isRecord(qa) || !sameStrings(Object.keys(qa).sort(), [...WORKBOOK_QA_KEYS].sort()) || qa.workbookSha256 !== workbooks?.raterWorkbookHashes?.[reviewer] || qa.labelsHeaderSha256 !== workbooks?.labelsHeaderSha256 || qa.serializedFreezePaneVerified !== true || qa.macrosAbsent !== true || qa.externalLinksAbsent !== true || qa.formulasAbsent !== true || !isSha256(qa.verifierSha256);
  })) blockers.push("rater_workbook_qa_binding_mismatch");
  const holdoutValid = validateHoldoutReceiptV2(holdout?.receipt).valid === true && isSha256(holdout?.receiptSha256);
  if (!holdoutValid) blockers.push("sealed_holdout_receipt_not_frozen");
  if (holdoutValid && sha256(stableJson(holdout.receipt)) !== holdout.receiptSha256) blockers.push("sealed_holdout_receipt_hash_mismatch");
  if (holdoutValid && isRecord(source) && holdout.receipt.sourceCommit !== source.commit) blockers.push("holdout_source_commit_mismatch");
  if (holdoutValid && isRecord(assignment) && (holdout.receipt.experimentId !== assignment.experimentId || holdout.receipt.caseCount !== assignment.caseCount || holdout.receipt.sealedCaseSetSha256 !== assignment.sealedCaseSetSha256)) blockers.push("holdout_assignment_binding_mismatch");
  if (!isRecord(hashes) || hashes.algorithm !== "sha256" || !SHA_KEYS.every((key) => isSha256(hashes[key])) || Object.keys(hashes).length !== SHA_KEYS.length + 1) blockers.push("required_freeze_hashes_missing_or_invalid");
  if (value?.productDefaultChanged !== false) blockers.push("product_default_changed");
  if (value?.existingEvaluationArtifactsChanged !== false) blockers.push("existing_evaluation_artifacts_changed");
  return [...new Set(blockers)];
}

export function buildFreezeManifestV2(input) {
  const manifest = {
    manifestVersion: HUMAN_AB_V2_FREEZE_VERSION,
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    status: "prepared_not_frozen",
    generatedAt: input.generatedAt,
    privacy: "human-ab-v2-coordinator-metadata-only",
    source: input.source,
    planner: input.planner,
    workbooks: input.workbooks,
    assignment: input.assignment,
    holdout: input.holdout,
    hashes: input.hashes,
    blockers: [],
    productDefaultChanged: false,
    existingEvaluationArtifactsChanged: false
  };
  manifest.blockers = deriveFreezeBlockersV2(manifest);
  manifest.status = manifest.blockers.length === 0 ? "ready_to_freeze" : "prepared_not_frozen";
  return manifest;
}

export function validateFreezeManifestV2(value) {
  const errors = [];
  if (!isRecord(value)) return invalid("Freeze manifest must be an object.");
  exactKeys(value, new Set(["manifestVersion", "protocolVersion", "status", "generatedAt", "privacy", "source", "planner", "workbooks", "assignment", "holdout", "hashes", "blockers", "productDefaultChanged", "existingEvaluationArtifactsChanged"]), errors, "manifest");
  exactKeys(value.source, SOURCE_KEYS, errors, "manifest.source");
  exactKeys(value.planner, PLANNER_KEYS, errors, "manifest.planner");
  exactKeys(value.workbooks, WORKBOOK_KEYS, errors, "manifest.workbooks");
  exactKeys(value.assignment, ASSIGNMENT_META_KEYS, errors, "manifest.assignment");
  exactKeys(value.holdout, HOLDOUT_BINDING_KEYS, errors, "manifest.holdout");
  exactKeys(value.hashes, new Set(["algorithm", ...SHA_KEYS]), errors, "manifest.hashes");
  if (value.manifestVersion !== HUMAN_AB_V2_FREEZE_VERSION) errors.push("manifestVersion is invalid.");
  if (value.protocolVersion !== HUMAN_AB_V2_PROTOCOL_VERSION) errors.push("protocolVersion is invalid.");
  if (!validIso(value.generatedAt)) errors.push("generatedAt is invalid.");
  if (value.privacy !== "human-ab-v2-coordinator-metadata-only") errors.push("privacy boundary is invalid.");
  const derived = deriveFreezeBlockersV2(value);
  if (!Array.isArray(value.blockers) || !sameStrings(value.blockers, derived)) errors.push("blockers must exactly equal the recomputed fail-closed blocker list.");
  const expectedStatus = derived.length === 0 ? "ready_to_freeze" : "prepared_not_frozen";
  if (value.status !== expectedStatus) errors.push(`status must equal ${expectedStatus}.`);
  if (value.status === "ready_to_freeze" && derived.length !== 0) errors.push("ready_to_freeze requires zero derived blockers.");
  return { valid: errors.length === 0, errors, derivedBlockers: derived };
}

export function validateAssignmentPlanV2(value) {
  const errors = [];
  if (!isRecord(value)) return invalid("Assignment plan must be an object.");
  exactKeys(value, PLAN_KEYS, errors, "assignmentPlan");
  if (value.protocolVersion !== HUMAN_AB_V2_PROTOCOL_VERSION) errors.push("assignmentPlan.protocolVersion is invalid.");
  if (value.preflightVersion !== HUMAN_AB_V2_PREFLIGHT_VERSION) errors.push("assignmentPlan.preflightVersion is invalid.");
  if (!validId(value.experimentId)) errors.push("assignmentPlan.experimentId is invalid.");
  for (const key of ["sealedHoldoutReceiptSha256", "sealedCaseSetSha256", "reviewerRosterSha256"]) if (!isSha256(value[key])) errors.push(`assignmentPlan.${key} is invalid.`);
  if (!Array.isArray(value.assignments)) errors.push("assignmentPlan.assignments must be an array.");
  for (const [index, row] of (Array.isArray(value.assignments) ? value.assignments : []).entries()) exactKeys(row, ASSIGNMENT_KEYS, errors, `assignments[${index}]`);
  const legacy = validateAssignmentPlan({
    protocolVersion: "agentproof-human-ab.v1",
    preflightVersion: "agentproof-human-ab-preflight.v1",
    experimentId: value.experimentId,
    minReviewersPerCaseArm: value.minReviewersPerCaseArm,
    assignments: value.assignments
  }, { minReviewersPerCaseArm: value.minReviewersPerCaseArm });
  errors.push(...legacy.errors.map((error) => `assignmentPlan:${error}`));
  const roster = canonicalRosterFromAssignments((value.assignments ?? []).map((row) => row?.raterPseudonym));
  if (roster === null || sha256(stableJson(roster)) !== value.reviewerRosterSha256) errors.push("assignmentPlan.reviewerRosterSha256 does not bind the canonical reviewer roster.");
  return { valid: errors.length === 0, errors, summary: legacy.summary, reviewerPseudonyms: roster ?? [] };
}

export function buildAssignmentPreflightV2(plan) {
  const validation = validateAssignmentPlanV2(plan);
  const planSha256 = sha256(stableJson(plan));
  const assignmentSet = (plan.assignments ?? []).map(canonicalAssignment).sort(compareAssignment);
  return {
    preflightVersion: HUMAN_AB_V2_PREFLIGHT_VERSION,
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    experimentId: plan.experimentId,
    passed: validation.valid,
    sealedHoldoutReceiptSha256: plan.sealedHoldoutReceiptSha256,
    sealedCaseSetSha256: plan.sealedCaseSetSha256,
    assignmentPlanSha256: planSha256,
    assignmentSetSha256: sha256(stableJson(assignmentSet)),
    reviewerRosterSha256: plan.reviewerRosterSha256,
    reviewerPseudonyms: validation.reviewerPseudonyms,
    assignmentCount: assignmentSet.length,
    reviewerCount: validation.reviewerPseudonyms.length,
    caseCount: new Set(assignmentSet.map((row) => row.opaqueCaseId)).size,
    errors: validation.errors
  };
}

export function prepareHumanAbV2({ freezeManifest, assignmentPlan, blindedCases }) {
  const freezeValidation = validateFreezeManifestV2(freezeManifest);
  if (!freezeValidation.valid || freezeManifest.status !== "ready_to_freeze") throw new Error(`Freeze manifest is not executable: ${freezeValidation.errors.join(" ")}`);
  const planValidation = validateAssignmentPlanV2(assignmentPlan);
  if (!planValidation.valid) throw new Error(`Assignment plan failed: ${planValidation.errors.join(" ")}`);
  const planText = stableJson(assignmentPlan);
  const planSha256 = sha256(planText);
  const preflight = buildAssignmentPreflightV2(assignmentPlan);
  if (!preflight.passed) throw new Error("Assignment preflight did not pass.");
  const preflightText = stableJson(preflight);
  const preflightSha256 = sha256(preflightText);
  const freezeManifestText = stableJson(freezeManifest);
  const blindedCasesText = stableJson(blindedCases);
  const manifestSha256 = sha256(freezeManifestText);
  const blindedCasesSha256 = sha256(blindedCasesText);
  if (freezeManifest.assignment.planSha256 !== planSha256 || freezeManifest.assignment.preflightSha256 !== preflightSha256) throw new Error("Freeze manifest assignment hashes do not bind the actual plan and preflight.");
  if (freezeManifest.holdout.receiptSha256 !== assignmentPlan.sealedHoldoutReceiptSha256 || freezeManifest.assignment.sealedCaseSetSha256 !== assignmentPlan.sealedCaseSetSha256 || freezeManifest.assignment.reviewerRosterSha256 !== assignmentPlan.reviewerRosterSha256) throw new Error("Freeze, holdout, and assignment bindings are inconsistent.");
  if (freezeManifest.assignment.blindedCasesSha256 !== blindedCasesSha256) throw new Error("Freeze manifest does not bind the actual blinded case artifact.");
  if (freezeManifest.assignment.experimentId !== assignmentPlan.experimentId || freezeManifest.holdout.receipt.experimentId !== assignmentPlan.experimentId || preflight.experimentId !== assignmentPlan.experimentId) throw new Error("Experiment binding is inconsistent across freeze, holdout, plan, and preflight.");
  if (freezeManifest.assignment.caseCount !== preflight.caseCount || freezeManifest.holdout.receipt.caseCount !== preflight.caseCount || freezeManifest.assignment.minReviewersPerCaseArm !== assignmentPlan.minReviewersPerCaseArm || preflight.assignmentCount !== assignmentPlan.assignments.length || !sameStrings(freezeManifest.assignment.raterPseudonyms, preflight.reviewerPseudonyms)) throw new Error("Case count, assignment count, reviewer roster, or preflight configuration drifted.");
  const cases = validateBlindedCases(blindedCases);
  const planCases = [...new Set(assignmentPlan.assignments.map((row) => canonicalId(row.opaqueCaseId)))].sort();
  if (!sameStrings(planCases, [...cases.keys()].sort())) throw new Error("Blinded case set must exactly match the assignment plan case set.");
  const packets = [];
  for (const reviewer of preflight.reviewerPseudonyms) {
    const workbookSha256 = freezeManifest.workbooks.raterWorkbookHashes[reviewer];
    const assignments = assignmentPlan.assignments.filter((row) => canonicalId(row.raterPseudonym) === reviewer).sort((a, b) => a.assignmentIndex - b.assignmentIndex).map((row) => {
      const item = cases.get(canonicalId(row.opaqueCaseId));
      const arm = row.blindedArmId.trim().toUpperCase();
      return {
        assignmentId: canonicalId(row.assignmentId),
        assignmentIndex: row.assignmentIndex,
        opaqueCaseId: canonicalId(row.opaqueCaseId),
        blindedArmId: arm,
        sourcePacket: item.sourcePacket,
        sourcePacketSha256: sha256(item.sourcePacket),
        reportText: composeBlindedReport(item.deterministicReportText, item.arms[arm].semanticAppendix),
        reportTextSha256: sha256(composeBlindedReport(item.deterministicReportText, item.arms[arm].semanticAppendix)),
        privacyPolicy: fixedPrivacyPolicy()
      };
    });
    const packet = {
      packetVersion: HUMAN_AB_V2_PACKET_VERSION,
      protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
      status: "prepared_blinded_rater_packet",
      experimentId: assignmentPlan.experimentId,
      sealedHoldoutReceiptSha256: assignmentPlan.sealedHoldoutReceiptSha256,
      sealedCaseSetSha256: assignmentPlan.sealedCaseSetSha256,
      assignmentPlanSha256: planSha256,
      assignmentPreflightSha256: preflightSha256,
      raterPseudonym: reviewer,
      raterWorkbookSha256: workbookSha256,
      assignments
    };
    const validation = validateRaterPacketV2(packet, { assignmentPlan, preflight });
    if (!validation.valid) throw new Error(`Generated packet failed: ${validation.errors.join(" ")}`);
    const text = stableJson(packet);
    packets.push({ raterPseudonym: reviewer, fileName: `${reviewer}.packet.json`, text, sha256: sha256(text), assignmentCount: assignments.length });
  }
  const receipt = {
    receiptVersion: HUMAN_AB_V2_PREPARED_RECEIPT_VERSION,
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    status: "prepared_blinded_packets",
    experimentId: assignmentPlan.experimentId,
    freezeManifestSha256: manifestSha256,
    sealedHoldoutReceiptSha256: assignmentPlan.sealedHoldoutReceiptSha256,
    sealedCaseSetSha256: assignmentPlan.sealedCaseSetSha256,
    blindedCasesSha256,
    assignmentPlanSha256: planSha256,
    assignmentPreflightSha256: preflightSha256,
    assignmentSetSha256: preflight.assignmentSetSha256,
    reviewerRosterSha256: preflight.reviewerRosterSha256,
    packetCount: packets.length,
    assignmentCount: assignmentPlan.assignments.length,
    packets: packets.map(({ raterPseudonym, fileName, sha256: packetSha256, assignmentCount }) => ({ raterPseudonym, fileName, packetSha256, assignmentCount })),
    liveLlmCalled: false,
    armMappingStored: false,
    rawMaterialStored: false,
    secretsStored: false
  };
  return { freezeManifestText, blindedCasesText, planText, preflightText, preflightSha256, packets, receiptText: stableJson(receipt), receipt };
}

export function validateRaterPacketV2(packet, { assignmentPlan, preflight } = {}) {
  const errors = [];
  if (!isRecord(packet)) return invalid("Rater packet must be an object.");
  exactKeys(packet, PACKET_KEYS, errors, "packet");
  if (packet.packetVersion !== HUMAN_AB_V2_PACKET_VERSION || packet.protocolVersion !== HUMAN_AB_V2_PROTOCOL_VERSION || packet.status !== "prepared_blinded_rater_packet") errors.push("packet version/status is invalid.");
  for (const key of ["sealedHoldoutReceiptSha256", "sealedCaseSetSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "raterWorkbookSha256"]) if (!isSha256(packet[key])) errors.push(`packet.${key} is invalid.`);
  if (!validId(packet.experimentId) || !validId(packet.raterPseudonym)) errors.push("packet identity is invalid.");
  if (!Array.isArray(packet.assignments) || packet.assignments.length === 0) errors.push("packet.assignments is invalid.");
  const seenCases = new Set();
  const seenIds = new Set();
  for (const [index, row] of (packet.assignments ?? []).entries()) {
    exactKeys(row, PACKET_ASSIGNMENT_KEYS, errors, `packet.assignments[${index}]`);
    if (!validId(row.assignmentId) || seenIds.has(canonicalId(row.assignmentId))) errors.push(`packet.assignments[${index}].assignmentId is invalid or duplicated.`);
    seenIds.add(canonicalId(row.assignmentId));
    if (!validId(row.opaqueCaseId) || seenCases.has(canonicalId(row.opaqueCaseId))) errors.push(`packet.assignments[${index}].opaqueCaseId is invalid or duplicated.`);
    seenCases.add(canonicalId(row.opaqueCaseId));
    if (!ARMS.has(row.blindedArmId) || !Number.isInteger(row.assignmentIndex) || row.assignmentIndex !== index + 1) errors.push(`packet.assignments[${index}] arm/index is invalid.`);
    if (!safeBoundedText(row.sourcePacket, 20_000) || sha256(row.sourcePacket) !== row.sourcePacketSha256) errors.push(`packet.assignments[${index}] source packet is unsafe or hash-mismatched.`);
    if (!safeBoundedText(row.reportText, 20_000) || sha256(row.reportText) !== row.reportTextSha256) errors.push(`packet.assignments[${index}] report text is unsafe or hash-mismatched.`);
    if (!exactPrivacy(row.privacyPolicy)) errors.push(`packet.assignments[${index}] privacy policy is invalid.`);
  }
  if (containsForbiddenKey(packet)) errors.push("packet contains coordinator, model, raw-material, or secret fields.");
  if (assignmentPlan && preflight) {
    const expected = assignmentPlan.assignments.filter((row) => canonicalId(row.raterPseudonym) === canonicalId(packet.raterPseudonym)).sort((a, b) => a.assignmentIndex - b.assignmentIndex);
    if (sha256(stableJson(assignmentPlan)) !== packet.assignmentPlanSha256 || sha256(stableJson(preflight)) !== packet.assignmentPreflightSha256) errors.push("packet plan/preflight hashes do not match actual artifacts.");
    if (packet.experimentId !== assignmentPlan.experimentId || packet.sealedHoldoutReceiptSha256 !== assignmentPlan.sealedHoldoutReceiptSha256 || packet.sealedCaseSetSha256 !== assignmentPlan.sealedCaseSetSha256 || preflight.passed !== true) errors.push("packet experiment, holdout, case-set, or preflight binding is invalid.");
    if (expected.length !== (packet.assignments ?? []).length) errors.push("packet assignment count does not match the plan.");
    expected.forEach((row, index) => {
      const actual = packet.assignments?.[index];
      if (!actual || canonicalId(row.assignmentId) !== actual.assignmentId || canonicalId(row.opaqueCaseId) !== actual.opaqueCaseId || row.blindedArmId.trim().toUpperCase() !== actual.blindedArmId || row.assignmentIndex !== actual.assignmentIndex) errors.push(`packet assignment ${index} does not exactly match the plan.`);
    });
  }
  return { valid: errors.length === 0, errors };
}

export function buildLabelRowV2({ packet, packetSha256, assignment, values }) {
  const row = {
    protocolVersion: packet.protocolVersion,
    experimentId: packet.experimentId,
    sealedHoldoutReceiptSha256: packet.sealedHoldoutReceiptSha256,
    assignmentPlanSha256: packet.assignmentPlanSha256,
    assignmentPreflightSha256: packet.assignmentPreflightSha256,
    raterPacketSha256: packetSha256,
    raterWorkbookSha256: packet.raterWorkbookSha256,
    assignmentId: assignment.assignmentId,
    raterPseudonym: packet.raterPseudonym,
    opaqueCaseId: assignment.opaqueCaseId,
    blindedArmId: assignment.blindedArmId,
    assignmentIndex: assignment.assignmentIndex,
    reviewDecision: values.reviewDecision ?? null,
    requirementAccuracy: values.requirementAccuracy ?? null,
    requirementEvidenceNote: values.requirementEvidenceNote ?? "",
    proofPlanUsefulness: values.proofPlanUsefulness ?? null,
    proofPlanEvidenceNote: values.proofPlanEvidenceNote ?? "",
    warningAccuracy: values.warningAccuracy ?? null,
    warningEvidenceNote: values.warningEvidenceNote ?? "",
    reviewDecisionTimeSeconds: values.reviewDecisionTimeSeconds ?? null,
    notScorableReason: values.notScorableReason ?? null,
    startedAt: values.startedAt,
    submittedAt: values.submittedAt,
    timingIntegrity: values.timingIntegrity,
    rowSha256: ""
  };
  row.rowSha256 = logicalRowSha256(row);
  const validation = validateLabelRowV2(row, { packet, packetSha256, assignment });
  if (!validation.valid) throw new Error(`Invalid label row: ${validation.errors.join(" ")}`);
  return row;
}

export function validateLabelRowV2(row, { packet, packetSha256, assignment } = {}) {
  const errors = [];
  if (!isRecord(row)) return invalid("Label row must be an object.");
  exactKeys(row, ROW_KEYS, errors, "labelRow");
  for (const key of ["sealedHoldoutReceiptSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "raterPacketSha256", "raterWorkbookSha256", "rowSha256"]) if (!isSha256(row[key])) errors.push(`labelRow.${key} is invalid.`);
  if (row.protocolVersion !== HUMAN_AB_V2_PROTOCOL_VERSION || !validId(row.experimentId) || !validId(row.assignmentId) || !validId(row.raterPseudonym) || !validId(row.opaqueCaseId) || !ARMS.has(row.blindedArmId) || !Number.isInteger(row.assignmentIndex) || row.assignmentIndex < 1) errors.push("labelRow identity is invalid.");
  for (const key of ["requirementEvidenceNote", "proofPlanEvidenceNote", "warningEvidenceNote"]) if (!isSafeHumanAbNoteV2(row[key])) errors.push(`labelRow.${key} is unsafe.`);
  if (!validIso(row.startedAt) || !validIso(row.submittedAt) || Date.parse(row.submittedAt) < Date.parse(row.startedAt)) errors.push("labelRow timestamps are invalid.");
  const reason = row.notScorableReason;
  if (reason === null) {
    if (!DECISIONS.has(row.reviewDecision)) errors.push("labelRow.reviewDecision is required for scorable rows.");
    for (const key of ["requirementAccuracy", "proofPlanUsefulness", "warningAccuracy"]) if (!validScore(row[key])) errors.push(`labelRow.${key} is invalid.`);
    if (!Number.isFinite(row.reviewDecisionTimeSeconds) || row.reviewDecisionTimeSeconds < 0 || row.timingIntegrity !== "runner_monotonic_complete") errors.push("labelRow timing is invalid for a scorable row.");
  } else {
    if (!NOT_SCORABLE.has(reason)) errors.push("labelRow.notScorableReason is invalid.");
    if (row.reviewDecision !== null || row.requirementAccuracy !== null || row.proofPlanUsefulness !== null || row.warningAccuracy !== null || row.reviewDecisionTimeSeconds !== null || row.timingIntegrity !== "runner_monotonic_not_scorable" || row.requirementEvidenceNote !== "" || row.proofPlanEvidenceNote !== "" || row.warningEvidenceNote !== "") errors.push("NotScorable row must keep decision, scores, time, and notes empty with runner provenance.");
  }
  if (logicalRowSha256(row) !== row.rowSha256) errors.push("labelRow.rowSha256 does not bind the logical row.");
  if (containsForbiddenKey(row)) errors.push("labelRow contains prohibited fields.");
  if (packet && assignment) {
    const expected = {
      protocolVersion: packet.protocolVersion,
      experimentId: packet.experimentId,
      sealedHoldoutReceiptSha256: packet.sealedHoldoutReceiptSha256,
      assignmentPlanSha256: packet.assignmentPlanSha256,
      assignmentPreflightSha256: packet.assignmentPreflightSha256,
      raterPacketSha256: packetSha256,
      raterWorkbookSha256: packet.raterWorkbookSha256,
      assignmentId: assignment.assignmentId,
      raterPseudonym: packet.raterPseudonym,
      opaqueCaseId: assignment.opaqueCaseId,
      blindedArmId: assignment.blindedArmId,
      assignmentIndex: assignment.assignmentIndex
    };
    for (const [key, expectedValue] of Object.entries(expected)) if (row[key] !== expectedValue) errors.push(`labelRow.${key} does not match its packet assignment.`);
  }
  return { valid: errors.length === 0, errors, state: reason === null ? "completed" : "not_scorable" };
}

export function buildLabelJournalV2({ packet, packetSha256, rows = [], status = "in_progress", activeAssignment = null }) {
  const journal = {
    journalVersion: HUMAN_AB_V2_LABEL_JOURNAL_VERSION,
    protocolVersion: packet.protocolVersion,
    experimentId: packet.experimentId,
    sealedHoldoutReceiptSha256: packet.sealedHoldoutReceiptSha256,
    assignmentPlanSha256: packet.assignmentPlanSha256,
    assignmentPreflightSha256: packet.assignmentPreflightSha256,
    raterPacketSha256: packetSha256,
    raterWorkbookSha256: packet.raterWorkbookSha256,
    raterPseudonym: packet.raterPseudonym,
    status,
    expectedAssignmentCount: packet.assignments.length,
    completedAssignmentCount: rows.length,
    activeAssignment,
    rowsSha256: sha256(stableJson(rows.map((row) => row.rowSha256))),
    rows
  };
  const validation = validateLabelJournalV2(journal, { packet, packetSha256 });
  if (!validation.valid) throw new Error(`Invalid label journal: ${validation.errors.join(" ")}`);
  return journal;
}

export function validateLabelJournalV2(journal, { packet, packetSha256 } = {}) {
  const errors = [];
  if (!isRecord(journal)) return invalid("Label journal must be an object.");
  exactKeys(journal, JOURNAL_KEYS, errors, "journal");
  if (journal.journalVersion !== HUMAN_AB_V2_LABEL_JOURNAL_VERSION || journal.protocolVersion !== HUMAN_AB_V2_PROTOCOL_VERSION || !["in_progress", "completed"].includes(journal.status)) errors.push("journal version/status is invalid.");
  for (const key of ["sealedHoldoutReceiptSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "raterPacketSha256", "raterWorkbookSha256", "rowsSha256"]) if (!isSha256(journal[key])) errors.push(`journal.${key} is invalid.`);
  if (!validId(journal.experimentId) || !validId(journal.raterPseudonym) || !Number.isInteger(journal.expectedAssignmentCount) || !Number.isInteger(journal.completedAssignmentCount) || !Array.isArray(journal.rows) || journal.completedAssignmentCount !== journal.rows.length || journal.completedAssignmentCount > journal.expectedAssignmentCount) errors.push("journal counts or identity are invalid.");
  if (sha256(stableJson((journal.rows ?? []).map((row) => row.rowSha256))) !== journal.rowsSha256) errors.push("journal.rowsSha256 is invalid.");
  if (journal.status === "completed" && (journal.completedAssignmentCount !== journal.expectedAssignmentCount || journal.activeAssignment !== null)) errors.push("completed journal must contain the exact assignment count and no active assignment.");
  if (journal.activeAssignment !== null) {
    const allowed = new Set(["assignmentId", "assignmentIndex", "state", "startedAt"]);
    exactKeys(journal.activeAssignment, allowed, errors, "journal.activeAssignment");
    if (!validId(journal.activeAssignment.assignmentId) || !Number.isInteger(journal.activeAssignment.assignmentIndex) || journal.activeAssignment.state !== "revealed" || !validIso(journal.activeAssignment.startedAt)) errors.push("journal.activeAssignment is invalid.");
  }
  if (packet) {
    if (packetSha256 !== journal.raterPacketSha256 || packet.assignments.length !== journal.expectedAssignmentCount) errors.push("journal packet binding is invalid.");
    const immutable = ["protocolVersion", "experimentId", "sealedHoldoutReceiptSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "raterWorkbookSha256", "raterPseudonym"];
    for (const key of immutable) if (journal[key] !== packet[key]) errors.push(`journal.${key} does not match packet.`);
    for (const [index, row] of (journal.rows ?? []).entries()) errors.push(...validateLabelRowV2(row, { packet, packetSha256, assignment: packet.assignments[index] }).errors);
    if (journal.activeAssignment !== null) {
      const expectedActive = packet.assignments[journal.rows.length];
      if (!expectedActive || journal.status !== "in_progress" || journal.activeAssignment.assignmentId !== expectedActive.assignmentId || journal.activeAssignment.assignmentIndex !== expectedActive.assignmentIndex) {
        errors.push("journal.activeAssignment does not bind the next unrecoverable packet assignment.");
      }
    }
  }
  if (containsForbiddenKey(journal)) errors.push("journal contains prohibited fields.");
  return { valid: errors.length === 0, errors };
}

export function importHumanAbV2({ freezeManifestText, blindedCasesText, preparedReceiptText, assignmentPlanText, assignmentPreflightText, packetTexts, labelJournalTexts }) {
  const errors = [];
  const receipt = parseJson(preparedReceiptText, "prepared receipt");
  const freezeManifest = parseJson(freezeManifestText, "freeze manifest");
  const blindedCases = parseJson(blindedCasesText, "blinded cases");
  const plan = parseJson(assignmentPlanText, "assignment plan");
  const preflight = parseJson(assignmentPreflightText, "assignment preflight");
  exactKeys(receipt, PREPARED_RECEIPT_KEYS, errors, "preparedReceipt");
  if (receipt.receiptVersion !== HUMAN_AB_V2_PREPARED_RECEIPT_VERSION || receipt.protocolVersion !== HUMAN_AB_V2_PROTOCOL_VERSION || receipt.status !== "prepared_blinded_packets") errors.push("Prepared receipt version/status is invalid.");
  if (!validId(receipt.experimentId) || ["freezeManifestSha256", "sealedHoldoutReceiptSha256", "sealedCaseSetSha256", "blindedCasesSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "assignmentSetSha256", "reviewerRosterSha256"].some((key) => !isSha256(receipt[key]))) errors.push("Prepared receipt identity or artifact hashes are invalid.");
  if (receipt.liveLlmCalled !== false || receipt.armMappingStored !== false || receipt.rawMaterialStored !== false || receipt.secretsStored !== false) errors.push("Prepared receipt privacy declarations are invalid.");
  if (!Array.isArray(receipt.packets) || receipt.packetCount !== receipt.packets.length || !Number.isInteger(receipt.assignmentCount) || receipt.assignmentCount < 1) errors.push("Prepared receipt counts are invalid.");
  for (const [index, descriptor] of (receipt.packets ?? []).entries()) {
    exactKeys(descriptor, PACKET_DESCRIPTOR_KEYS, errors, `preparedReceipt.packets[${index}]`);
    if (!validId(descriptor?.raterPseudonym) || descriptor?.fileName !== `${descriptor?.raterPseudonym}.packet.json` || !isSha256(descriptor?.packetSha256) || !Number.isInteger(descriptor?.assignmentCount) || descriptor.assignmentCount < 1) errors.push(`Prepared packet descriptor ${index} is invalid.`);
  }
  if (sha256(assignmentPlanText) !== receipt.assignmentPlanSha256 || sha256(assignmentPreflightText) !== receipt.assignmentPreflightSha256) errors.push("Prepared receipt does not bind actual plan/preflight bytes.");
  const freezeValidation = validateFreezeManifestV2(freezeManifest);
  if (!freezeValidation.valid || freezeManifest.status !== "ready_to_freeze" || sha256(freezeManifestText) !== receipt.freezeManifestSha256) errors.push("Prepared receipt does not bind an executable freeze manifest.");
  const planValidation = validateAssignmentPlanV2(plan);
  if (!planValidation.valid) errors.push(...planValidation.errors);
  if (stableJson(buildAssignmentPreflightV2(plan)) !== assignmentPreflightText) errors.push("Assignment preflight is not the canonical deterministic result for the plan.");
  if (receipt.experimentId !== plan.experimentId || receipt.experimentId !== preflight.experimentId || receipt.sealedHoldoutReceiptSha256 !== plan.sealedHoldoutReceiptSha256 || receipt.sealedCaseSetSha256 !== plan.sealedCaseSetSha256 || receipt.assignmentSetSha256 !== preflight.assignmentSetSha256 || receipt.reviewerRosterSha256 !== preflight.reviewerRosterSha256 || receipt.assignmentCount !== preflight.assignmentCount || receipt.packetCount !== preflight.reviewerCount) errors.push("Prepared receipt metadata does not exactly match the plan and preflight.");
  if (freezeManifest.assignment.planSha256 !== receipt.assignmentPlanSha256 || freezeManifest.assignment.preflightSha256 !== receipt.assignmentPreflightSha256 || freezeManifest.assignment.blindedCasesSha256 !== receipt.blindedCasesSha256 || freezeManifest.holdout.receiptSha256 !== receipt.sealedHoldoutReceiptSha256) errors.push("Prepared receipt metadata does not exactly match the freeze manifest.");
  if (sha256(blindedCasesText) !== receipt.blindedCasesSha256 || stableJson(blindedCases) !== blindedCasesText) errors.push("Prepared receipt does not bind canonical blinded-case bytes.");
  try {
    const reproduced = prepareHumanAbV2({ freezeManifest, assignmentPlan: plan, blindedCases });
    if (reproduced.receiptText !== preparedReceiptText || reproduced.preflightText !== assignmentPreflightText || !sameStrings(reproduced.packets.map((item) => item.text).sort(), [...(packetTexts ?? [])].sort())) errors.push("Prepared artifacts do not reproduce exactly from the frozen inputs.");
  } catch (error) {
    errors.push(`Frozen prepared-artifact reproduction failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const packetMap = new Map();
  for (const text of packetTexts ?? []) {
    const packet = parseJson(text, "packet");
    const hash = sha256(text);
    const descriptor = receipt.packets?.find((item) => item.raterPseudonym === packet.raterPseudonym);
    if (!descriptor || descriptor.packetSha256 !== hash || descriptor.assignmentCount !== packet.assignments?.length) errors.push("Packet bytes or assignment count do not match the prepared receipt.");
    const validation = validateRaterPacketV2(packet, { assignmentPlan: plan, preflight });
    if (!validation.valid) errors.push(...validation.errors);
    if (packetMap.has(packet.raterPseudonym)) errors.push("Duplicate rater packet.");
    packetMap.set(packet.raterPseudonym, { packet, hash, text });
  }
  const expectedRaters = [...(receipt.packets ?? []).map((item) => item.raterPseudonym)].sort();
  if (!sameStrings([...packetMap.keys()].sort(), expectedRaters)) errors.push("Packet rater set does not exactly match the prepared receipt.");
  const journalMap = new Map();
  const labelJournalSha256 = {};
  const rows = [];
  for (const text of labelJournalTexts ?? []) {
    const journal = parseJson(text, "label journal");
    const bound = packetMap.get(journal.raterPseudonym);
    if (!bound) errors.push("Label journal has no prepared rater packet.");
    else {
      const validation = validateLabelJournalV2(journal, { packet: bound.packet, packetSha256: bound.hash });
      if (!validation.valid) errors.push(...validation.errors);
    }
    if (journal.status !== "completed") errors.push("Every imported label journal must be completed.");
    if (journalMap.has(journal.raterPseudonym)) errors.push("Duplicate label journal for one rater.");
    journalMap.set(journal.raterPseudonym, journal);
    labelJournalSha256[journal.raterPseudonym] = sha256(text);
    rows.push(...(journal.rows ?? []));
  }
  if (!sameStrings([...journalMap.keys()].sort(), expectedRaters)) errors.push("Label journal rater set does not exactly match the prepared receipt.");
  const expectedAssignments = new Map(plan.assignments.map((row) => [canonicalId(row.assignmentId), canonicalAssignment(row)]));
  const seen = new Set();
  for (const row of rows) {
    const id = canonicalId(row.assignmentId);
    if (!id || seen.has(id)) errors.push("Imported labels contain a missing or duplicate assignment ID.");
    seen.add(id);
    const expected = expectedAssignments.get(id);
    if (!expected || expected.raterPseudonym !== canonicalId(row.raterPseudonym) || expected.opaqueCaseId !== canonicalId(row.opaqueCaseId) || expected.blindedArmId !== row.blindedArmId || expected.assignmentIndex !== row.assignmentIndex) errors.push("Imported label assignment identity does not match the frozen plan.");
  }
  if (seen.size !== expectedAssignments.size || [...expectedAssignments.keys()].some((id) => !seen.has(id))) errors.push("Imported labels do not cover the exact frozen assignment set.");
  if (errors.length > 0) throw new Error(`Human A/B v2 import failed: ${[...new Set(errors)].join(" ")}`);
  const summary = summarizeRows(rows);
  const summaryText = stableJson(summary);
  const importReceipt = {
    receiptVersion: HUMAN_AB_V2_IMPORT_RECEIPT_VERSION,
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    status: "labels_frozen_blinded_summary_prepared",
    experimentId: plan.experimentId,
    preparedReceiptSha256: sha256(preparedReceiptText),
    assignmentPlanSha256: sha256(assignmentPlanText),
    assignmentPreflightSha256: sha256(assignmentPreflightText),
    assignmentSetSha256: preflight.assignmentSetSha256,
    labelJournalSha256,
    labelRowCount: rows.length,
    summarySha256: sha256(summaryText),
    armMappingStored: false,
    humanEvaluationEvidenceStatus: "labels_frozen_not_yet_adjudicated",
    rawMaterialStored: false,
    secretsStored: false
  };
  return { summary, summaryText, importReceipt, importReceiptText: stableJson(importReceipt) };
}

export function writeAtomicJson(path, value, { noClobber = false } = {}) {
  if (noClobber && existsSync(path)) throw new Error("Atomic journal no-clobber refused an existing path.");
  const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);
  let fd = null;
  try {
    fd = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(fd, stableJson(value), "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    if (noClobber) {
      try {
        linkSync(temporaryPath, path);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") throw new Error("Atomic journal no-clobber race detected.");
        throw error;
      }
      unlinkSync(temporaryPath);
    } else {
      renameSync(temporaryPath, path);
    }
    const dirFd = openSync(dirname(path), "r");
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function stableJson(value) {
  return `${JSON.stringify(sortValue(value), null, 2)}\n`;
}

export function sha256(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function isSafeHumanAbNoteV2(value) {
  return typeof value === "string" && value.length <= 500 && !UNSAFE_TEXT.test(value) && !/^[=+@-]/.test(value.trimStart()) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function validateBlindedCases(blindedCases) {
  if (!Array.isArray(blindedCases) || blindedCases.length === 0 || blindedCases.length > 500) throw new Error("blindedCases must contain 1 to 500 cases.");
  const map = new Map();
  for (const [index, item] of blindedCases.entries()) {
    const errors = [];
    exactKeys(item, new Set(["opaqueCaseId", "sourcePacket", "deterministicReportText", "arms"]), errors, `blindedCases[${index}]`);
    if (!validId(item?.opaqueCaseId) || map.has(canonicalId(item?.opaqueCaseId))) errors.push("opaqueCaseId is invalid or duplicated.");
    if (!safeBoundedText(item?.sourcePacket, 20_000)) errors.push("sourcePacket is unsafe.");
    if (!safeBoundedText(item?.deterministicReportText, 20_000)) errors.push("deterministicReportText is unsafe.");
    exactKeys(item?.arms, new Set(["A", "B"]), errors, `blindedCases[${index}].arms`);
    for (const arm of ["A", "B"]) {
      exactKeys(item?.arms?.[arm], new Set(["semanticAppendix"]), errors, `blindedCases[${index}].arms.${arm}`);
      if (!safeOptionalHumanAbText(item?.arms?.[arm]?.semanticAppendix, 4_000)) errors.push(`arm ${arm} semantic appendix is unsafe.`);
      if (!safeBoundedText(composeBlindedReport(item?.deterministicReportText, item?.arms?.[arm]?.semanticAppendix), 20_000)) errors.push(`arm ${arm} composed report is unsafe.`);
    }
    if (containsForbiddenKey(item)) errors.push("case contains prohibited fields.");
    if (errors.length) throw new Error(`Invalid blinded case: ${errors.join(" ")}`);
    map.set(canonicalId(item.opaqueCaseId), { sourcePacket: item.sourcePacket, deterministicReportText: item.deterministicReportText, arms: item.arms });
  }
  return map;
}

export function composeBlindedReport(deterministicReportText, semanticAppendix) {
  if (typeof deterministicReportText !== "string" || typeof semanticAppendix !== "string") return "";
  // Both arms begin with byte-identical deterministic evidence. Any semantic
  // assistance is an append-only reviewer note and cannot replace that record.
  return semanticAppendix.trim()
    ? `${deterministicReportText}\n\nAdditional review context:\n${semanticAppendix}`
    : `${deterministicReportText}\n\nAdditional review context:\nNone.`;
}

function summarizeRows(rows) {
  const scorable = rows.filter((row) => row.notScorableReason === null);
  const byArm = {};
  for (const arm of ["A", "B"]) {
    const armRows = scorable.filter((row) => row.blindedArmId === arm);
    byArm[arm] = {
      assignedRowCount: rows.filter((row) => row.blindedArmId === arm).length,
      scorableRowCount: armRows.length,
      notScorableRowCount: rows.filter((row) => row.blindedArmId === arm && row.notScorableReason !== null).length,
      reviewerDecisionCounts: Object.fromEntries([...DECISIONS].map((decision) => [decision, armRows.filter((row) => row.reviewDecision === decision).length])),
      requirementAccuracyMedian: median(armRows.map((row) => row.requirementAccuracy)),
      proofPlanUsefulnessMedian: median(armRows.map((row) => row.proofPlanUsefulness)),
      warningAccuracyMedian: median(armRows.map((row) => row.warningAccuracy)),
      reviewDecisionTimeMedianSeconds: median(armRows.map((row) => row.reviewDecisionTimeSeconds)),
      reviewDecisionTimeP75Seconds: percentile(armRows.map((row) => row.reviewDecisionTimeSeconds), 0.75)
    };
  }
  return {
    summaryVersion: "agentproof-human-ab-blinded-summary.v2",
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    status: "labels_frozen_blinded_not_adjudicated",
    humanEvaluationEvidenceStatus: "pilot_labels_only_not_correctness_or_generalization_evidence",
    labelRowCount: rows.length,
    eligibleRowCount: scorable.length,
    excludedRowCount: rows.length - scorable.length,
    armMappingStored: false,
    byArm
  };
}

function logicalRowSha256(row) {
  const copy = { ...row, rowSha256: "" };
  return sha256(stableJson(copy));
}

function canonicalAssignment(row) {
  return {
    assignmentId: canonicalId(row.assignmentId),
    raterPseudonym: canonicalId(row.raterPseudonym),
    opaqueCaseId: canonicalId(row.opaqueCaseId),
    blindedArmId: String(row.blindedArmId).trim().toUpperCase(),
    assignmentIndex: row.assignmentIndex
  };
}

function compareAssignment(left, right) {
  return left.raterPseudonym.localeCompare(right.raterPseudonym) || left.assignmentIndex - right.assignmentIndex || left.assignmentId.localeCompare(right.assignmentId);
}

function exactPrivacy(value) {
  if (!isRecord(value) || !sameStrings(Object.keys(value).sort(), [...PRIVACY_KEYS].sort())) return false;
  return value.summaryOnly === true && [...PRIVACY_KEYS].filter((key) => key !== "summaryOnly").every((key) => value[key] === false);
}

function fixedPrivacyPolicy() {
  return { summaryOnly: true, rawPromptsIncluded: false, rawReasoningIncluded: false, rawDiffsIncluded: false, rawLogsIncluded: false, secretsIncluded: false };
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    const allowedNegativePrivacyDeclaration = PRIVACY_KEYS.has(key) && (child === false || (key === "summaryOnly" && child === true));
    return (!allowedNegativePrivacyDeclaration && FORBIDDEN_KEY.test(key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase())) || containsForbiddenKey(child);
  });
}

function exactKeys(value, allowed, errors, label) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  const keys = Object.keys(value);
  for (const key of keys) if (!allowed.has(key)) errors.push(`${label} contains unexpected field: ${key}.`);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${label} is missing field: ${key}.`);
}

function canonicalUnique(values) {
  if (!Array.isArray(values)) return null;
  const canonical = values.map(canonicalId);
  if (canonical.some((value) => value === null) || new Set(canonical).size !== canonical.length) return null;
  return canonical.sort();
}

function canonicalRosterFromAssignments(values) {
  if (!Array.isArray(values)) return null;
  const canonical = values.map(canonicalId);
  if (canonical.some((value) => value === null)) return null;
  return [...new Set(canonical)].sort();
}

function canonicalId(value) {
  if (typeof value !== "string") return null;
  const result = value.normalize("NFKC").trim().toLowerCase();
  return result && result.length <= 120 && /^[a-z0-9][a-z0-9._:-]*$/.test(result) ? result : null;
}

function validId(value) { return canonicalId(value) !== null; }
function isSha256(value) { return typeof value === "string" && /^[0-9a-f]{64}$/.test(value); }
function isCommit(value) { return typeof value === "string" && /^[0-9a-f]{40}$/.test(value); }
function validIso(value) { return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value)); }
function validScore(value) { return Number.isInteger(value) && value >= 1 && value <= 5; }
function safeBoundedText(value, max) { return typeof value === "string" && value.trim() !== "" && value.length <= max && !UNSAFE_TEXT.test(value) && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value); }
function safeOptionalHumanAbText(value, max) { return typeof value === "string" && value.length <= max && (value === "" || safeBoundedText(value, max)); }
function isRecord(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function sameStrings(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]); }
function invalid(message) { return { valid: false, errors: [message] }; }
function parseJson(text, label) { try { return JSON.parse(text); } catch { throw new Error(`${label} is not valid JSON.`); } }
function sortValue(value) { if (Array.isArray(value)) return value.map(sortValue); if (!isRecord(value)) return value; return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])])); }
function median(values) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; }
function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); const position = (sorted.length - 1) * p; const lower = Math.floor(position); const upper = Math.ceil(position); return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower); }
