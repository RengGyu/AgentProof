import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAssignmentPreflightV2,
  buildFreezeManifestV2,
  buildLabelJournalV2,
  buildLabelRowV2,
  deriveFreezeBlockersV2,
  HUMAN_AB_V2_HOLDOUT_RECEIPT_VERSION,
  HUMAN_AB_V2_PREFLIGHT_VERSION,
  HUMAN_AB_V2_PROTOCOL_VERSION,
  importHumanAbV2,
  prepareHumanAbV2,
  sha256,
  stableJson,
  validateAssignmentPlanV2,
  validateFreezeManifestV2,
  validateHoldoutReceiptV2,
  validateLabelJournalV2,
  validateLabelRowV2,
  validateRaterPacketV2,
  writeAtomicJson
} from "./llm-proof-planner-human-ab-v2-core.mjs";
import { acquireJournalLockV2, clearStaleJournalLockV2, loadRunnerStateV2, recoverActiveAssignmentV2 } from "./llm-proof-planner-human-ab-v2-runner.mjs";
import { importFilesV2, prepareFilesV2, writeArtifactSetAtomically } from "./llm-proof-planner-human-ab-v2.mjs";


const temporaryDirectories = [];
afterEach(() => temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function fixture() {
  const receipt = {
    receiptVersion: HUMAN_AB_V2_HOLDOUT_RECEIPT_VERSION,
    status: "sealed",
    holdoutId: "holdout-001",
    experimentId: "experiment-001",
    policyVersion: "selection-v1",
    caseCount: 1,
    sealedAt: "2026-07-11T00:00:00.000Z",
    privateManifestSha256: "1".repeat(64),
    sealedCaseSetSha256: "2".repeat(64),
    normalizerVersion: "normalizer-v1",
    sourceCommit: "3".repeat(40)
  };
  const roster = ["rater-1", "rater-2", "rater-3", "rater-4"];
  const assignments = roster.map((rater, index) => ({
    assignmentId: `assign-${index + 1}`,
    raterPseudonym: rater,
    opaqueCaseId: "case-001",
    blindedArmId: index < 2 ? "A" : "B",
    assignmentIndex: 1
  }));
  const plan = {
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    preflightVersion: HUMAN_AB_V2_PREFLIGHT_VERSION,
    experimentId: receipt.experimentId,
    sealedHoldoutReceiptSha256: sha256(stableJson(receipt)),
    sealedCaseSetSha256: receipt.sealedCaseSetSha256,
    reviewerRosterSha256: sha256(stableJson(roster)),
    minReviewersPerCaseArm: 2,
    assignments
  };
  const preflight = buildAssignmentPreflightV2(plan);
  const blindedCases = [{
    opaqueCaseId: "case-001",
    sourcePacket: "Bounded deterministic evidence with a missing targeted test.",
    deterministicReportText: "Requirement is partial because the targeted regression test is missing.",
    arms: {
      A: { semanticAppendix: "" },
      B: { semanticAppendix: "Consider checking the focused regression path before accepting the change." }
    }
  }];
  const raterWorkbookHashes = Object.fromEntries(roster.map((rater, index) => [rater, String(index + 5).repeat(64)]));
  const manifest = buildFreezeManifestV2({
    generatedAt: "2026-07-11T00:01:00.000Z",
    source: { commit: receipt.sourceCommit, workingTreeDirty: false, changedPathCount: 0, stagedPathCount: 0, reproducibleFromCommit: true },
    planner: {
      requestedModel: "gpt-5.6-luna",
      resolvedModelIdentifier: "gpt-5.6-luna-2026-07-11",
      modelSnapshotStatus: "single",
      resolvedIdentifierIsDatedSnapshot: true,
      promptVersion: "llm-proof-planner-v2-semantic-integrity",
      plannerInputSchemaVersion: 1,
      plannerOutputSchemaVersion: "2.1",
      evaluationArtifactSchemaVersion: "llm-proof-planner-evaluation.v2.1"
    },
    workbooks: {
      coordinatorSummarySha256: "4".repeat(64),
      raterWorkbookHashes,
      raterWorkbookQa: Object.fromEntries(roster.map((rater) => [rater, {
        workbookSha256: raterWorkbookHashes[rater],
        labelsHeaderSha256: "9".repeat(64),
        serializedFreezePaneVerified: true,
        macrosAbsent: true,
        externalLinksAbsent: true,
        formulasAbsent: true,
        verifierSha256: "7".repeat(64)
      }])),
      labelsHeaderSha256: "9".repeat(64),
      labelsHeaderFreezeVerified: true
    },
    assignment: {
      experimentId: receipt.experimentId,
      planSha256: sha256(stableJson(plan)),
      preflightSha256: sha256(stableJson(preflight)),
      preflightPassed: true,
      minReviewersPerCaseArm: 2,
      caseCount: 1,
      sealedCaseSetSha256: receipt.sealedCaseSetSha256,
      blindedCasesSha256: sha256(stableJson(blindedCases)),
      reviewerRosterSha256: plan.reviewerRosterSha256,
      raterPseudonyms: roster
    },
    holdout: { receipt, receiptSha256: sha256(stableJson(receipt)) },
    hashes: {
      algorithm: "sha256",
      protocolSha256: "a".repeat(64),
      plannerSourceSha256: "b".repeat(64),
      promptSha256: "c".repeat(64),
      plannerSchemaSha256: "d".repeat(64),
      evaluationHarnessSha256: "e".repeat(64),
      baselineSourceSha256: "f".repeat(64),
      automaticTimerRunnerSha256: "0".repeat(64)
    }
  });
  return { receipt, roster, plan, preflight, manifest, blindedCases };
}

function completedValues(overrides = {}) {
  return {
    reviewDecision: "not_enough",
    requirementAccuracy: 5,
    requirementEvidenceNote: "The partial status is preserved.",
    proofPlanUsefulness: 4,
    proofPlanEvidenceNote: "The next proof is bounded and actionable.",
    warningAccuracy: 5,
    warningEvidenceNote: "The missing proof warning matches the source.",
    reviewDecisionTimeSeconds: 12.5,
    notScorableReason: null,
    startedAt: "2026-07-11T00:02:00.000Z",
    submittedAt: "2026-07-11T00:02:12.500Z",
    timingIntegrity: "runner_monotonic_complete",
    ...overrides
  };
}

function buildCompletedArtifacts() {
  const base = fixture();
  const prepared = prepareHumanAbV2({ freezeManifest: base.manifest, assignmentPlan: base.plan, blindedCases: base.blindedCases });
  const journals = prepared.packets.map(({ text, sha256: packetSha256 }) => {
    const packet = JSON.parse(text);
    const rows = packet.assignments.map((assignment) => buildLabelRowV2({ packet, packetSha256, assignment, values: completedValues() }));
    return stableJson(buildLabelJournalV2({ packet, packetSha256, rows, status: "completed" }));
  });
  return { ...base, prepared, journals };
}

describe("Human A/B v2 fail-closed freeze", () => {
  it("accepts only a fully cross-bound ready manifest", () => {
    const { receipt, manifest } = fixture();
    expect(validateHoldoutReceiptV2(receipt)).toEqual({ valid: true, errors: [] });
    expect(manifest.blockers).toEqual([]);
    expect(manifest.status).toBe("ready_to_freeze");
    expect(validateFreezeManifestV2(manifest)).toMatchObject({ valid: true, derivedBlockers: [] });
  });

  it("never treats v1 freeze or holdout artifacts as executable v2 inputs", () => {
    const { receipt, manifest } = fixture();
    expect(validateHoldoutReceiptV2({ ...receipt, receiptVersion: "agentproof-sealed-holdout-receipt.v1" }).valid).toBe(false);
    expect(validateFreezeManifestV2({ ...manifest, manifestVersion: "agentproof-human-ab-freeze.v1", protocolVersion: "agentproof-human-ab.v1" }).valid).toBe(false);
  });

  it("recomputes blockers and rejects false-ready deletion, addition, duplication, ordering, and status tampering", () => {
    const { manifest } = fixture();
    const dirty = structuredClone(manifest);
    dirty.source.workingTreeDirty = true;
    dirty.source.changedPathCount = 1;
    dirty.blockers = [];
    dirty.status = "ready_to_freeze";
    expect(validateFreezeManifestV2(dirty).valid).toBe(false);
    expect(deriveFreezeBlockersV2(dirty)).toContain("source_not_clean_and_reproducible");

    for (const blockers of [["unexpected"], ["unexpected", "unexpected"], ["workbook_freeze_not_verified", "source_not_clean_and_reproducible"]]) {
      const tampered = structuredClone(dirty);
      tampered.blockers = blockers;
      expect(validateFreezeManifestV2(tampered).valid).toBe(false);
    }
    const wrongStatus = structuredClone(manifest);
    wrongStatus.status = "prepared_not_frozen";
    expect(validateFreezeManifestV2(wrongStatus).valid).toBe(false);

    const forgedSnapshotFlag = structuredClone(manifest);
    forgedSnapshotFlag.planner.resolvedModelIdentifier = "gpt-5.6-luna";
    forgedSnapshotFlag.planner.resolvedIdentifierIsDatedSnapshot = true;
    forgedSnapshotFlag.blockers = [];
    forgedSnapshotFlag.status = "ready_to_freeze";
    expect(validateFreezeManifestV2(forgedSnapshotFlag).valid).toBe(false);
    expect(deriveFreezeBlockersV2(forgedSnapshotFlag)).toContain("resolved_model_identifier_not_dated_snapshot");
  });

  it("rejects source, holdout, case-set, roster, workbook, and required digest drift", () => {
    const { manifest } = fixture();
    const mutations = [
      [(value) => { value.holdout.receipt.sourceCommit = "4".repeat(40); }, true],
      [(value) => { value.holdout.receipt.caseCount = 2; }, true],
      [(value) => { value.assignment.sealedCaseSetSha256 = "8".repeat(64); }, true],
      [(value) => { delete value.workbooks.raterWorkbookHashes["rater-4"]; }, true],
      [(value) => { value.workbooks.raterWorkbookHashes["extra-rater"] = "7".repeat(64); }, true],
      [(value) => { value.workbooks.raterWorkbookQa["rater-1"].serializedFreezePaneVerified = false; }, true],
      [(value) => { value.workbooks.labelsHeaderFreezeVerified = false; }, true],
      [(value) => { delete value.hashes.promptSha256; }, false]
    ];
    for (const [mutate, structurallyValid] of mutations) {
      const value = structuredClone(manifest);
      mutate(value);
      value.blockers = deriveFreezeBlockersV2(value);
      value.status = value.blockers.length ? "prepared_not_frozen" : "ready_to_freeze";
      expect(value.status).toBe("prepared_not_frozen");
      const validation = validateFreezeManifestV2(value);
      expect(validation.valid, validation.errors.join("\n")).toBe(structurallyValid);
    }
  });
});

describe("Human A/B v2 prepare and packet privacy", () => {
  it("accepts a balanced multi-case plan with repeated reviewers", () => {
    const { plan } = fixture();
    const secondCase = plan.assignments.map((row, index) => ({
      ...row,
      assignmentId: `${row.assignmentId}-case-2`,
      opaqueCaseId: "case-002",
      blindedArmId: index < 2 ? "B" : "A",
      assignmentIndex: 2
    }));
    plan.assignments.push(...secondCase);
    expect(validateAssignmentPlanV2(plan)).toMatchObject({ valid: true, reviewerPseudonyms: ["rater-1", "rater-2", "rater-3", "rater-4"] });
    expect(buildAssignmentPreflightV2(plan)).toMatchObject({ passed: true, caseCount: 2, reviewerCount: 4, assignmentCount: 8 });
  });

  it("rejects actual plan experiment and case-count drift from the frozen holdout", () => {
    const base = fixture();
    const experimentPlan = structuredClone(base.plan);
    experimentPlan.experimentId = "experiment-other";
    const experimentManifest = structuredClone(base.manifest);
    experimentManifest.assignment.planSha256 = sha256(stableJson(experimentPlan));
    experimentManifest.assignment.preflightSha256 = sha256(stableJson(buildAssignmentPreflightV2(experimentPlan)));
    expect(() => prepareHumanAbV2({ freezeManifest: experimentManifest, assignmentPlan: experimentPlan, blindedCases: base.blindedCases })).toThrow("Experiment binding");

    const multiPlan = structuredClone(base.plan);
    multiPlan.assignments.push(...multiPlan.assignments.map((row, index) => ({
      ...row,
      assignmentId: `${row.assignmentId}-case-2`,
      opaqueCaseId: "case-002",
      blindedArmId: index < 2 ? "B" : "A",
      assignmentIndex: 2
    })));
    const multiCases = [...base.blindedCases, { opaqueCaseId: "case-002", sourcePacket: "A second bounded deterministic evidence source.", deterministicReportText: "A second deterministic report.", arms: { A: { semanticAppendix: "" }, B: { semanticAppendix: "Consider the bounded evidence before making a decision." } } }];
    const multiManifest = structuredClone(base.manifest);
    multiManifest.assignment.planSha256 = sha256(stableJson(multiPlan));
    multiManifest.assignment.preflightSha256 = sha256(stableJson(buildAssignmentPreflightV2(multiPlan)));
    multiManifest.assignment.blindedCasesSha256 = sha256(stableJson(multiCases));
    expect(() => prepareHumanAbV2({ freezeManifest: multiManifest, assignmentPlan: multiPlan, blindedCases: multiCases })).toThrow("Case count");
  });


  it("builds exact hash-bound packets and rejects plan/content tampering", () => {
    const { manifest, plan, blindedCases } = fixture();
    const prepared = prepareHumanAbV2({ freezeManifest: manifest, assignmentPlan: plan, blindedCases });
    expect(prepared.packets).toHaveLength(4);
    for (const item of prepared.packets) {
      const packet = JSON.parse(item.text);
      expect(validateRaterPacketV2(packet, { assignmentPlan: plan, preflight: JSON.parse(prepared.preflightText) }).valid).toBe(true);
      expect(item.sha256).toBe(sha256(item.text));
      expect(item.text).not.toMatch(/gpt-|promptVersion|requestedModel|resolvedModel|repository|prUrl|armMapping/i);
      expect(packet.assignments[0].reportText).toMatch(/^Requirement is partial because the targeted regression test is missing\./);
    }
    const packet = JSON.parse(prepared.packets[0].text);
    packet.assignments[0].opaqueCaseId = "case-tampered";
    expect(validateRaterPacketV2(packet, { assignmentPlan: plan, preflight: JSON.parse(prepared.preflightText) }).valid).toBe(false);

    const safeContentDrift = structuredClone(blindedCases);
    safeContentDrift[0].arms.A.semanticAppendix = "Use a different bounded proof step.";
    expect(() => prepareHumanAbV2({ freezeManifest: manifest, assignmentPlan: plan, blindedCases: safeContentDrift })).toThrow("does not bind");

    const unsafe = structuredClone(blindedCases);
    unsafe[0].arms.A.semanticAppendix = "diff --git a/private b/private";
    const unsafeManifest = structuredClone(manifest);
    unsafeManifest.assignment.blindedCasesSha256 = sha256(stableJson(unsafe));
    expect(() => prepareHumanAbV2({ freezeManifest: unsafeManifest, assignmentPlan: plan, blindedCases: unsafe })).toThrow("unsafe");
    const modelLeak = structuredClone(blindedCases);
    modelLeak[0].sourcePacket = "Resolved model gpt-5.6-luna produced this report.";
    const modelManifest = structuredClone(manifest);
    modelManifest.assignment.blindedCasesSha256 = sha256(stableJson(modelLeak));
    expect(() => prepareHumanAbV2({ freezeManifest: modelManifest, assignmentPlan: plan, blindedCases: modelLeak })).toThrow("unsafe");
    for (const unsafeText of ["stdout: private output", "stderr: private stack", "console output: private line", "workflow trace: private step", "--- src/a.ts\n+++ src/a.ts", "    --- src/a.ts\n    +++ src/a.ts", "2026-07-11T12:00:00Z INFO user_email=private@example.test", "claude-3-7-sonnet produced this report", "OPENAI_API_KEY=plaintext-value"]) {
      const caseValue = structuredClone(blindedCases);
      caseValue[0].sourcePacket = unsafeText;
      const caseManifest = structuredClone(manifest);
      caseManifest.assignment.blindedCasesSha256 = sha256(stableJson(caseValue));
      expect(() => prepareHumanAbV2({ freezeManifest: caseManifest, assignmentPlan: plan, blindedCases: caseValue }), unsafeText).toThrow("unsafe");
    }
    const extra = structuredClone(blindedCases);
    extra[0].model = "hidden";
    const extraManifest = structuredClone(manifest);
    extraManifest.assignment.blindedCasesSha256 = sha256(stableJson(extra));
    expect(() => prepareHumanAbV2({ freezeManifest: extraManifest, assignmentPlan: plan, blindedCases: extra })).toThrow("unexpected field");

    const armReplacement = structuredClone(blindedCases);
    armReplacement[0].arms.A = { reportText: "A manipulated deterministic report." };
    const replacementManifest = structuredClone(manifest);
    replacementManifest.assignment.blindedCasesSha256 = sha256(stableJson(armReplacement));
    expect(() => prepareHumanAbV2({ freezeManifest: replacementManifest, assignmentPlan: plan, blindedCases: armReplacement })).toThrow("unexpected field");

    for (const treatmentLeak of ["This was written by an LLM.", "OpenAI model guidance.", "Use deterministic-only output.", "semantic assistance is enabled."]) {
      const leakingCase = structuredClone(blindedCases);
      leakingCase[0].arms.B.semanticAppendix = treatmentLeak;
      const leakingManifest = structuredClone(manifest);
      leakingManifest.assignment.blindedCasesSha256 = sha256(stableJson(leakingCase));
      expect(() => prepareHumanAbV2({ freezeManifest: leakingManifest, assignmentPlan: plan, blindedCases: leakingCase }), treatmentLeak).toThrow("unsafe");
    }
  });
});

describe("Human A/B v2 label journal and exact import", () => {
  it("binds decisions, assignment IDs, hashes, completed journals, and blinded summary", () => {
    const { plan, prepared, journals } = buildCompletedArtifacts();
    const imported = importHumanAbV2({
      freezeManifestText: prepared.freezeManifestText,
      blindedCasesText: prepared.blindedCasesText,
      preparedReceiptText: prepared.receiptText,
      assignmentPlanText: prepared.planText,
      assignmentPreflightText: prepared.preflightText,
      packetTexts: prepared.packets.map((item) => item.text),
      labelJournalTexts: journals
    });
    expect(imported.summary).toMatchObject({
      status: "labels_frozen_blinded_not_adjudicated",
      labelRowCount: plan.assignments.length,
      eligibleRowCount: plan.assignments.length,
      armMappingStored: false,
      byArm: {
        A: { scorableRowCount: 2, reviewerDecisionCounts: { enough: 0, not_enough: 2, unclear: 0 }, requirementAccuracyMedian: 5 },
        B: { scorableRowCount: 2, reviewerDecisionCounts: { enough: 0, not_enough: 2, unclear: 0 }, requirementAccuracyMedian: 5 }
      }
    });
    expect(imported.importReceipt.labelRowCount).toBe(4);
    expect(imported.importReceipt.armMappingStored).toBe(false);
  });

  it("rejects unknown fields, row substitution, missing/duplicate journals, hash drift, and identity-free NotScorable", () => {
    const { prepared, journals } = buildCompletedArtifacts();
    const packet = JSON.parse(prepared.packets[0].text);
    const journal = JSON.parse(journals[0]);
    const row = journal.rows[0];
    expect(validateLabelRowV2(row, { packet, packetSha256: prepared.packets[0].sha256, assignment: packet.assignments[0] }).valid).toBe(true);
    const unknown = structuredClone(row);
    unknown.model = "hidden";
    expect(validateLabelRowV2(unknown).valid).toBe(false);
    const identityFree = {
      notScorableReason: "operational_failure",
      timingIntegrity: "runner_monotonic_not_scorable"
    };
    expect(validateLabelRowV2(identityFree).valid).toBe(false);
    for (const unsafeNote of ["-1+WEBSERVICE(\"https://x\")", "stdout: private output", "--- src/a.ts\n+++ src/a.ts"]) {
      const unsafeRow = structuredClone(row);
      unsafeRow.requirementEvidenceNote = unsafeNote;
      unsafeRow.rowSha256 = logicalHash(unsafeRow);
      expect(validateLabelRowV2(unsafeRow).valid, unsafeNote).toBe(false);
    }

    const missing = journals.slice(1);
    expect(() => importHumanAbV2({ freezeManifestText: prepared.freezeManifestText, blindedCasesText: prepared.blindedCasesText, preparedReceiptText: prepared.receiptText, assignmentPlanText: prepared.planText, assignmentPreflightText: prepared.preflightText, packetTexts: prepared.packets.map((item) => item.text), labelJournalTexts: missing })).toThrow("rater set");
    expect(() => importHumanAbV2({ freezeManifestText: prepared.freezeManifestText, blindedCasesText: prepared.blindedCasesText, preparedReceiptText: prepared.receiptText, assignmentPlanText: prepared.planText, assignmentPreflightText: prepared.preflightText, packetTexts: prepared.packets.map((item) => item.text), labelJournalTexts: [...journals, journals[0]] })).toThrow("Duplicate label journal");

    const substituted = JSON.parse(journals[0]);
    substituted.rows[0].opaqueCaseId = "case-other";
    substituted.rows[0].rowSha256 = logicalHash(substituted.rows[0]);
    substituted.rowsSha256 = sha256(stableJson(substituted.rows.map((item) => item.rowSha256)));
    expect(validateLabelJournalV2(substituted, { packet, packetSha256: prepared.packets[0].sha256 }).valid).toBe(false);
  });

  it("rejects self-consistent prepared receipt metadata and descriptor tampering", () => {
    const { prepared, journals } = buildCompletedArtifacts();
    const baseArgs = {
      freezeManifestText: prepared.freezeManifestText,
      blindedCasesText: prepared.blindedCasesText,
      assignmentPlanText: prepared.planText,
      assignmentPreflightText: prepared.preflightText,
      packetTexts: prepared.packets.map((item) => item.text),
      labelJournalTexts: journals
    };
    const mutations = [
      (receipt) => { receipt.experimentId = "experiment-other"; },
      (receipt) => { receipt.freezeManifestSha256 = "8".repeat(64); },
      (receipt) => { receipt.sealedHoldoutReceiptSha256 = "8".repeat(64); },
      (receipt) => { receipt.sealedCaseSetSha256 = "8".repeat(64); },
      (receipt) => { receipt.blindedCasesSha256 = "8".repeat(64); },
      (receipt) => { receipt.assignmentSetSha256 = "8".repeat(64); },
      (receipt) => { receipt.reviewerRosterSha256 = "8".repeat(64); },
      (receipt) => { receipt.assignmentCount += 1; },
      (receipt) => { receipt.packets[0].assignmentCount += 1; }
    ];
    for (const mutate of mutations) {
      const receipt = JSON.parse(prepared.receiptText);
      mutate(receipt);
      expect(() => importHumanAbV2({ ...baseArgs, preparedReceiptText: stableJson(receipt) })).toThrow("import failed");
    }
  });

  it("requires full NotScorable identity and excludes it from score/time aggregates", () => {
    const { plan, prepared } = buildCompletedArtifacts();
    const journals = prepared.packets.map(({ text, sha256: packetSha256 }, packetIndex) => {
      const packet = JSON.parse(text);
      const rows = packet.assignments.map((assignment) => buildLabelRowV2({
        packet,
        packetSha256,
        assignment,
        values: packetIndex === 0 ? completedValues({
          reviewDecision: null,
          requirementAccuracy: null,
          proofPlanUsefulness: null,
          warningAccuracy: null,
          requirementEvidenceNote: "",
          proofPlanEvidenceNote: "",
          warningEvidenceNote: "",
          reviewDecisionTimeSeconds: null,
          notScorableReason: "operational_failure",
          timingIntegrity: "runner_monotonic_not_scorable"
        }) : completedValues()
      }));
      return stableJson(buildLabelJournalV2({ packet, packetSha256, rows, status: "completed" }));
    });
    const imported = importHumanAbV2({ freezeManifestText: prepared.freezeManifestText, blindedCasesText: prepared.blindedCasesText, preparedReceiptText: prepared.receiptText, assignmentPlanText: stableJson(plan), assignmentPreflightText: prepared.preflightText, packetTexts: prepared.packets.map((item) => item.text), labelJournalTexts: journals });
    expect(imported.summary.eligibleRowCount).toBe(3);
    expect(imported.summary.excludedRowCount).toBe(1);
  });
});

describe("Human A/B v2 atomic journal persistence", () => {
  it("recovers a revealed assignment exactly once as an operational failure", () => {
    const { prepared } = buildCompletedArtifacts();
    const packet = JSON.parse(prepared.packets[0].text);
    const packetSha256 = prepared.packets[0].sha256;
    const active = buildLabelJournalV2({
      packet,
      packetSha256,
      rows: [],
      status: "in_progress",
      activeAssignment: { assignmentId: packet.assignments[0].assignmentId, assignmentIndex: 1, state: "revealed", startedAt: "2026-07-11T00:02:00.000Z" }
    });
    const recovered = recoverActiveAssignmentV2({ packet, packetSha256, journal: active, submittedAt: "2026-07-11T00:02:01.000Z" });
    expect(recovered).toMatchObject({ status: "in_progress", completedAssignmentCount: 1, activeAssignment: null });
    expect(recovered.rows[0]).toMatchObject({ assignmentId: packet.assignments[0].assignmentId, notScorableReason: "operational_failure", reviewDecision: null });
    expect(recoverActiveAssignmentV2({ packet, packetSha256, journal: recovered })).toEqual(recovered);
  });

  it("writes mode-0600 atomically and refuses no-clobber overwrite", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentproof-human-ab-v2-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "journal.json");
    writeAtomicJson(path, { status: "in_progress" }, { noClobber: true });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ status: "in_progress" });
    expect(() => writeAtomicJson(path, { status: "completed" }, { noClobber: true })).toThrow("no-clobber");
    writeAtomicJson(path, { status: "completed" });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ status: "completed" });
  });

  it("requires an external launch descriptor before creating a journal and locks concurrent sessions", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentproof-human-ab-v2-launch-"));
    temporaryDirectories.push(directory);
    const base = fixture();
    const workbookPath = join(directory, "rater.xlsx");
    writeFileSync(workbookPath, "bounded workbook bytes");
    const workbookSha256 = sha256("bounded workbook bytes");
    base.manifest.workbooks.raterWorkbookHashes["rater-1"] = workbookSha256;
    base.manifest.workbooks.raterWorkbookQa["rater-1"].workbookSha256 = workbookSha256;
    const prepared = prepareHumanAbV2({ freezeManifest: base.manifest, assignmentPlan: base.plan, blindedCases: base.blindedCases });
    const packetItem = prepared.packets.find((item) => item.raterPseudonym === "rater-1");
    const packetPath = join(directory, "packet.json");
    const launchPath = join(directory, "launch.json");
    const journalPath = join(directory, "labels.json");
    writeFileSync(packetPath, packetItem.text);
    writeFileSync(launchPath, stableJson({
      launchDescriptorVersion: "agentproof-human-ab-runner-launch.v2",
      protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
      experimentId: base.plan.experimentId,
      raterPseudonym: "rater-1",
      preparedReceiptSha256: sha256(prepared.receiptText),
      raterPacketSha256: packetItem.sha256,
      raterWorkbookSha256: workbookSha256
    }));
    const expectedLaunchDescriptorSha256 = sha256(readFileSync(launchPath, "utf8"));
    expect(loadRunnerStateV2({ expectedLaunchDescriptorSha256, launchDescriptorPath: launchPath, packetPath, workbookPath, journalPath, resume: false }).journal).toMatchObject({ status: "in_progress", completedAssignmentCount: 0 });
    writeFileSync(packetPath, `${packetItem.text}\n`);
    expect(() => loadRunnerStateV2({ expectedLaunchDescriptorSha256, launchDescriptorPath: launchPath, packetPath, workbookPath, journalPath: join(directory, "other.json"), resume: false })).toThrow("launch descriptor");

    const first = acquireJournalLockV2(join(directory, "locked.json"), { pid: 101, isProcessAlive: () => true });
    expect(() => acquireJournalLockV2(join(directory, "locked.json"), { pid: 202, isProcessAlive: () => true })).toThrow("holds");
    first.release();

    const ownership = acquireJournalLockV2(join(directory, "ownership.json"), { pid: 303 });
    writeFileSync(ownership.lockPath, `${JSON.stringify({ pid: 404, token: "different-owner" })}\n`);
    expect(() => ownership.release()).toThrow("ownership changed");
    expect(() => clearStaleJournalLockV2(join(directory, "ownership.json"), "wrong")).toThrow("confirmation");
    clearStaleJournalLockV2(join(directory, "ownership.json"), "I_CONFIRMED_NO_RUNNER_IS_ACTIVE");
  });
});

describe("Human A/B v2 file coordinator", () => {
  it("never replaces a pre-existing empty output directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentproof-human-ab-v2-no-replace-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "reserved");
    mkdirSync(output);
    expect(() => writeArtifactSetAtomically(output, new Map([["receipt.json", "{}\n"]]))).toThrow("no-clobber");
    expect(lstatSync(output).isDirectory()).toBe(true);
  });

  it("runs prepare to completed-journal import with exact file sets and no-clobber", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentproof-human-ab-v2-files-"));
    temporaryDirectories.push(directory);
    const { manifest, plan, blindedCases } = fixture();
    const manifestPath = join(directory, "manifest.json");
    const planPath = join(directory, "plan.json");
    const casesPath = join(directory, "cases.json");
    const preparedDirectory = join(directory, "prepared");
    const labelsDirectory = join(directory, "labels");
    const summaryDirectory = join(directory, "summary");
    writeFileSync(manifestPath, stableJson(manifest));
    writeFileSync(planPath, stableJson(plan));
    writeFileSync(casesPath, stableJson(blindedCases));
    expect(prepareFilesV2({ freezeManifestPath: manifestPath, assignmentPlanPath: planPath, blindedCasesPath: casesPath, outputDirectory: preparedDirectory })).toMatchObject({ packetCount: 4, assignmentCount: 4 });
    expect(() => prepareFilesV2({ freezeManifestPath: manifestPath, assignmentPlanPath: planPath, blindedCasesPath: casesPath, outputDirectory: preparedDirectory })).toThrow("no-clobber");
    const preparedReceipt = JSON.parse(readFileSync(join(preparedDirectory, "prepared-receipt.json"), "utf8"));
    mkdirSync(labelsDirectory);
    for (const descriptor of preparedReceipt.packets) {
      const text = readFileSync(join(preparedDirectory, descriptor.fileName), "utf8");
      const packet = JSON.parse(text);
      const packetSha256 = sha256(text);
      const rows = packet.assignments.map((assignment) => buildLabelRowV2({ packet, packetSha256, assignment, values: completedValues() }));
      const journal = buildLabelJournalV2({ packet, packetSha256, rows, status: "completed" });
      writeFileSync(join(labelsDirectory, `${packet.raterPseudonym}.labels.json`), stableJson(journal));
    }
    expect(importFilesV2({ preparedDirectory, labelsDirectory, outputDirectory: summaryDirectory })).toMatchObject({ labelRowCount: 4 });
    expect(JSON.parse(readFileSync(join(summaryDirectory, "blinded-summary.json"), "utf8"))).toMatchObject({ eligibleRowCount: 4, armMappingStored: false });
    expect(() => importFilesV2({ preparedDirectory, labelsDirectory, outputDirectory: summaryDirectory })).toThrow("no-clobber");
  });
});

function logicalHash(row) {
  return sha256(stableJson({ ...row, rowSha256: "" }));
}
