import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { selectCanonicalRequirements } from "./extractors";
import { createUnverifiedAuthenticity } from "./report-authenticity";
import { createVerificationValidationContextV2, validateVerificationReport, type VerificationValidationContextV2 } from "./report-validation";
import { decodeSharedReport, encodeReportForShare, sanitizeReportForShare } from "./report-share";
import { demoScenarios } from "./sample-data";
import { projectTenantPersistedReport } from "./tenant-report-validation";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";
import { generateVerificationReportV2 } from "./verifier";
import { deriveGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { finalizeDeterministicGeneralPrObservationsV2 } from "./general-pr-observation-service";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { expectNoSelectionSentinels, transientSelectionFixture } from "./general-pr-selection-sentinels.test-fixture";
import type { PullRequestInput, TestRelationReceiptV2, VerificationReportV2 } from "./types";

const HYBRID_PLANNER_PROVENANCE = {
  version: 1,
  contractVersion: "hybrid_requirement_planner.v1",
  schemaVersion: "agentproof_requirement_span_plan_v1",
  promptVersion: "2026-08-12.v1",
  model: "gpt-5-mini",
  inputHash: "a".repeat(64)
} as const;

describe("validateVerificationReport", () => {
  it("accepts a closed ordinary-PR assessment while rejecting injected private target fields", () => {
    const input: PullRequestInput = {
      title: "Return the repository label",
      description: "",
      taskText: "",
      changedFiles: [{ path: "src/repository-label.ts", status: "modified" }],
      checks: [],
      logs: [],
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        changedFileInventory: { version: 1, completeness: "complete", headSha: "b".repeat(40) },
        evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
      }
    };
    const report = generateVerificationReportV2FromInput(input);
    const seed = buildGeneralPrObservationSeedV2(input);
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);
    Object.assign(bundle as unknown as Record<string, unknown>, { transientObserver: transientSelectionFixture() });
    const assessment = deriveGeneralPrAssessmentV1({ seed, bundle, report });
    report.generalPrAssessment = assessment;

    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
    expectNoSelectionSentinels(report);

    const invalidObservations = structuredClone(report) as unknown as { generalPrAssessment: { observations: { links: Record<string, unknown> } } };
    invalidObservations.generalPrAssessment.observations.links = { state: "proposed", linkedObjectives: 0, supports: 1, tests: 0, implements: 0, contradicts: 0 };
    expect(validateVerificationReport(invalidObservations, { mode: "v2_full" }).valid).toBe(false);
    invalidObservations.generalPrAssessment.observations.links = { state: "proposed", linkedObjectives: 2, supports: 1, tests: 0, implements: 0, contradicts: 0 };
    expect(validateVerificationReport(invalidObservations, { mode: "v2_full" }).valid).toBe(false);

    const twoPartialTargets = structuredClone(report) as unknown as {
      generalPrAssessment: {
        counts: { evidence_partial: number };
        targets: Array<Record<string, unknown>>;
        observations: { links: { state: string; linkedObjectives: number; supports: number } };
      };
    };
    twoPartialTargets.generalPrAssessment.targets.push({ ...assessment.targets[0] });
    twoPartialTargets.generalPrAssessment.counts.evidence_partial = 2;
    twoPartialTargets.generalPrAssessment.observations.links.state = "proposed";
    twoPartialTargets.generalPrAssessment.observations.links.linkedObjectives = 2;
    twoPartialTargets.generalPrAssessment.observations.links.supports = 2;
    expect(validateVerificationReport(twoPartialTargets, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });

    twoPartialTargets.generalPrAssessment.observations.links.supports = 1;
    expect(validateVerificationReport(twoPartialTargets, { mode: "v2_full" }).errors).toContain(
      "generalPrAssessment.observations.links.linkedObjectives must not exceed relations."
    );

    const forgedConclusion = structuredClone(report) as unknown as {
      generalPrAssessment: { overallConclusion: string };
    };
    forgedConclusion.generalPrAssessment.overallConclusion = "mixed_evidence";
    expect(validateVerificationReport(forgedConclusion, { mode: "v2_full" }).errors).toContain(
      "generalPrAssessment.overallConclusion does not match targets."
    );

    const forgedCounts = structuredClone(report) as unknown as {
      generalPrAssessment: { counts: { evidence_partial: number } };
    };
    forgedCounts.generalPrAssessment.counts.evidence_partial = 2;
    expect(validateVerificationReport(forgedCounts, { mode: "v2_full" }).errors).toContain(
      "generalPrAssessment.counts.evidence_partial does not match targets."
    );

    const injected = structuredClone(report) as unknown as {
      generalPrAssessment: { targets: Array<Record<string, unknown>> };
    };
    injected.generalPrAssessment.targets = [
      { ...assessment.targets[0], rawSource: "must not enter a report" }
    ];
    expect(validateVerificationReport(injected, { mode: "v2_full" }).valid).toBe(false);
  });

  it("rejects a target-free summary that attempts an unsupported positive promotion", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean) as VerificationReportV2;
    report.generalPrAssessmentSummary = {
      version: 1,
      mode: "ordinary_pr",
      sourceState: "linked_issue",
      overallConclusion: "evidence_supports_stated_change",
      counts: {
        evidence_supported: 1,
        evidence_partial: 0,
        not_demonstrated: 0,
        contradicted: 0,
        blocked: 0,
        not_assessable: 0
      },
      reasonCodes: ["implementation_evidence_observed"]
    };

    expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(false);
  });

  it("derives every target-free summary conclusion from its aggregate counts", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean) as VerificationReportV2;
    const counts = {
      evidence_supported: 0,
      evidence_partial: 1,
      not_demonstrated: 0,
      contradicted: 0,
      blocked: 0,
      not_assessable: 0
    };
    report.generalPrAssessmentSummary = {
      version: 1,
      mode: "ordinary_pr",
      sourceState: "linked_issue",
      overallConclusion: "evidence_partial",
      counts,
      reasonCodes: []
    };

    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });

    for (const [forgedCounts, overallConclusion] of [
      [{ ...counts, evidence_partial: 0 }, "evidence_partial"],
      [counts, "evidence_supports_stated_change"],
      [counts, "mixed_evidence"],
      [counts, "attention_required"],
      [counts, "collection_blocked"],
      [counts, "no_assessable_claims"]
    ] as const) {
      const forged = structuredClone(report);
      const summary = forged.generalPrAssessmentSummary!;
      summary.counts = forgedCounts;
      summary.overallConclusion = overallConclusion as typeof summary.overallConclusion;
      expect(validateVerificationReport(forged, { mode: "v2_full" }).errors).toContain(
        "generalPrAssessmentSummary.overallConclusion does not match counts."
      );
    }

    for (const [validCounts, overallConclusion] of [
      [{ ...counts, evidence_partial: 0 }, "no_assessable_claims"],
      [counts, "evidence_partial"],
      [{ ...counts, not_demonstrated: 1 }, "mixed_evidence"],
      [{ ...counts, evidence_partial: 0, blocked: 1 }, "collection_blocked"]
    ] as const) {
      const valid = structuredClone(report);
      valid.generalPrAssessmentSummary!.counts = validCounts;
      valid.generalPrAssessmentSummary!.overallConclusion = overallConclusion;
      expect(validateVerificationReport(valid, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
    }
  });
  it("admits a structurally valid private v2 receipt bundle only for a full report", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);
    const requirementId = report.requirements[0]!.requirementId;
    const executionBindingReceipts = [{
      id: "execution_private_v2",
      version: 2 as const,
      kind: "execution_binding" as const,
      requirementId,
      testEvidenceRef: "ev_private_test",
      executionEvidenceRef: "ev_private_execution",
      headBindingDigest: "a".repeat(64),
      scope: "exact_test" as const
    }];
    report.proofGraph.privateReceiptBundleV2 = {
      sourceBindings: [{
        version: 1,
        kind: "requirement_source_binding",
        id: "binding_private_v2",
        requirementId,
        spanId: "sp_1_1",
        seedId: "b".repeat(64),
        groupId: "grp_1",
        source: "issue",
        ordinal: 1
      }],
      exactHeadTargetReceipts: [],
      testRelationReceipts: [{
        id: "relation_private_v2",
        version: 2,
        kind: "targeted_test_relation",
        requirementId,
        subjectSource: "current_requirement",
        targetMode: "changed_target",
        implementationEvidenceRef: "ev_private_implementation",
        testEvidenceRef: "ev_private_test",
        subjectDigest: "c".repeat(64),
        importBindingDigest: "d".repeat(64),
        assertionShape: "direct_argument",
        directAssertionCount: 1,
        executionReceiptRef: "execution_private_v2"
      }],
      executionBindingReceipts,
      failedCheckAssociations: []
    };
    report.proofGraph.executionBindingReceipts = structuredClone(executionBindingReceipts);

    expect(validateVerificationReport(report, { mode: "v2_full" }).errors).toContain("v2 private receipt validation requires transient validation context.");
    const tenantProjection = JSON.stringify(projectTenantPersistedReport(report, "task-4c-test-signing-secret"));
    expect(tenantProjection).not.toContain("privateReceiptBundleV2");
    expect(tenantProjection).not.toContain("executionBindingReceipts");
    expect(tenantProjection).not.toContain("execution_private_v2");
    for (const mode of ["v2_summary", "v2_tenant"] as const) {
      const result = validateVerificationReport(report, { mode });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(`${mode === "v2_summary" ? "summary-only" : "tenant"} reports must omit proofGraph.privateReceiptBundleV2.`);
      expect(result.errors).toContain(`${mode === "v2_summary" ? "summary-only" : "tenant"} reports must omit proofGraph.executionBindingReceipts.`);
    }

    const malformed = structuredClone(report);
    const malformedRelation = malformed.proofGraph.privateReceiptBundleV2!.testRelationReceipts[0]!;
    if (malformedRelation.version !== 2) throw new Error("fixture must contain a v2 test relation receipt");
    (malformedRelation as unknown as Record<string, unknown>).rawAssertion = "private source";
    malformedRelation.executionReceiptRef = "missing_execution";
    malformed.proofGraph.privateReceiptBundleV2!.executionBindingReceipts[0]!.version = 1 as never;
    const malformedResult = validateVerificationReport(malformed, { mode: "v2_full" });
    expect(malformedResult.valid).toBe(false);
    expect(malformedResult.errors.join("\n")).toContain("test relation receipt.rawAssertion is not allowed");
    expect(malformedResult.errors.join("\n")).toContain("test relation receipts cite a missing execution binding receipt");
    expect(malformedResult.errors.join("\n")).toContain("execution binding receipt version or kind is invalid");
  });

  it("closes satisfied v2 targeted-test and execution axes from a changed-target private bundle", () => {
    const report = fullPrivateReceiptReport("receipt_v2");
    const requirement = report.requirements[1]!;
    const targetedAxis = requirement.proofAxes!.find((axis) => axis.subject === "targeted_test")!;
    const executionAxis = requirement.proofAxes!.find((axis) => axis.subject === "execution")!;
    expect(targetedAxis.state).toBe("satisfied");
    expect(executionAxis.state).toBe("satisfied");
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toEqual([
      expect.objectContaining({ version: 2, requirementId: requirement.requirementId, targetMode: "exact_head_target" })
    ]);
    expect(validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: v2ReceiptValidationContext(report) })).toEqual({ valid: true, errors: [] });
    const missing = structuredClone(report);
    missing.proofGraph.privateReceiptBundleV2!.testRelationReceipts = [];
    expect(validateVerificationReport(missing, { mode: "v2_full" }).valid).toBe(false);
  });

  it("closes every private receipt collection in full mode and rejects it in summary mode", () => {
    const report = fullPrivateReceiptReport("receipt_v2");

    expect(report.proofGraph.sourceBindings).toHaveLength(2);
    expect(report.proofGraph.exactHeadTargetReceipts).toHaveLength(1);
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(report.proofGraph.privateReceiptBundleV2?.executionBindingReceipts).toHaveLength(1);
    expect(report.proofGraph.failedCheckAssociations?.length).toBeGreaterThan(0);
    expect(validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: v2ReceiptValidationContext(report) })).toEqual({ valid: true, errors: [] });

    const summaryResult = validateVerificationReport(report, { mode: "v2_summary" });
    for (const collection of [
      "sourceBindings",
      "exactHeadTargetReceipts",
      "privateReceiptBundleV2",
      "failedCheckAssociations"
    ]) {
      expect(summaryResult.errors).toContain(`summary-only reports must omit proofGraph.${collection}.`);
    }
  });

  it("rejects a receipt-less satisfied v2 observation axis", () => {
    const report = fullPrivateReceiptReport("receipt_v2");
    const subject = report.requirements[1]!;
    expect(subject.proofAxes?.find((axis) => axis.subject === "targeted_test")?.state).toBe("satisfied");
    expect(subject.proofAxes?.find((axis) => axis.subject === "execution")?.state).toBe("satisfied");
    report.proofGraph.privateReceiptBundleV2!.testRelationReceipts = [];

    expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(false);
  });

  it.each(["targeted_test", "execution"] as const)("rejects a receipt-less satisfied %s axis when its counterpart is incomplete", (subject) => {
    const report = fullPrivateReceiptReport("receipt_v2");
    const requirement = report.requirements[1]!;
    const counterpart = subject === "targeted_test" ? "execution" : "targeted_test";
    requirement.proofAxes!.find((axis) => axis.subject === counterpart)!.state = "incomplete";
    requirement.evidenceStatus = "partial";
    report.proofGraph.privateReceiptBundleV2!.testRelationReceipts = [];

    expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(false);
  });

  it("rejects receipt-less satisfied local execution even when the targeted-test axis is absent", () => {
    const report = fullPrivateReceiptReport("receipt_v2");
    const requirement = report.requirements[1]!;
    requirement.proofAxes = requirement.proofAxes!.filter((axis) => axis.subject !== "targeted_test");
    report.proofGraph.privateReceiptBundleV2!.testRelationReceipts = [];
    report.proofGraph.privateReceiptBundleV2!.executionBindingReceipts = [];

    const result = validateVerificationReport(report, { mode: "v2_full" });

    expect(result.errors.join("\n")).toContain(
      "satisfied requirement-local targeted-test or execution observation requires a closed test-relation receipt"
    );
  });

  it("keeps receipt evidence but downgrades local positive axes while the default-off kill switch is active", () => {
    const report = fullPrivateReceiptReport("off");
    const subject = report.requirements[1]!;

    expect(subject.proofAxes?.find((axis) => axis.subject === "targeted_test")?.state).toBe("incomplete");
    expect(subject.proofAxes?.find((axis) => axis.subject === "execution")?.state).toBe("incomplete");
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
  });

  it("keeps receipt-complete absent and invalid v2 observations distinct from the unclear outcome", () => {
    const absent = fullPrivateReceiptReport("receipt_v2");
    const absentRequirement = absent.requirements[1]!;
    const absentNode = absent.proofGraph.nodes.find((node) => node.requirementId === absentRequirement.requirementId)!;
    expect(absentRequirement.proofAxes?.every((axis) => axis.state === "satisfied")).toBe(true);
    expect(absentRequirement.evidenceStatus).toBe("met");
    expect(absentRequirement.status).toBe("unclear");
    expect(absentNode.status).toBe("met");
    const context = v2ReceiptValidationContext(absent);
    expect(validateVerificationReport(absent, { mode: "v2_full", receiptValidationContext: context })).toEqual({ valid: true, errors: [] });

    const invalid = structuredClone(absent);
    invalid.verificationContract.state = "invalid";
    invalid.verificationContract.gaps = [{
      kind: "verification_contract_invalid",
      message: "The supplied verification contract was invalid."
    }];
    expect(validateVerificationReport(invalid, { mode: "v2_full", receiptValidationContext: context })).toEqual({ valid: true, errors: [] });

    for (const report of [absent, invalid]) {
      report.requirements[1]!.status = "partial";
      expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(false);
    }
  });

  it("emits the closed test-relation subject, source, basis, and assertion count", () => {
    const report = fullPrivateReceiptReport();
    const receipt = report.proofGraph.privateReceiptBundleV2?.testRelationReceipts[0];

    expect(receipt).toMatchObject({
      version: 2,
      kind: "targeted_test_relation",
      requirementId: report.requirements[1]?.requirementId,
      subjectSource: "current_requirement",
      targetMode: "exact_head_target",
      assertionShape: "direct_argument",
      directAssertionCount: 1
    });
    expect(Object.keys(receipt ?? {}).sort()).toEqual([
      "assertionShape",
      "directAssertionCount",
      "exactHeadTargetReceiptRef",
      "executionReceiptRef",
      "id",
      "importBindingDigest",
      "kind",
      "requirementId",
      "subjectDigest",
      "subjectSource",
      "targetMode",
      "testEvidenceRef",
      "version"
    ]);
  });

  it("rejects v2 private-bundle receipt mutations against the independent transient context", () => {
    const mutations: Array<{ name: string; mutate: (report: ReturnType<typeof fullPrivateReceiptReport>) => void }> = [
      { name: "requirement owner", mutate: (report) => { v2Receipt(report).requirementId = report.requirements[0]!.requirementId; } },
      { name: "test evidence", mutate: (report) => { v2Receipt(report).testEvidenceRef = "ev_other_test"; } },
      { name: "subject digest", mutate: (report) => { v2Receipt(report).subjectDigest = "f".repeat(64); } },
      { name: "import digest", mutate: (report) => { v2Receipt(report).importBindingDigest = "e".repeat(64); } },
      { name: "assertion count", mutate: (report) => { v2Receipt(report).directAssertionCount = 2; } },
      { name: "implementation target", mutate: (report) => {
        const receipt = v2Receipt(report);
        receipt.targetMode = "changed_target";
        receipt.implementationEvidenceRef = "ev_other_implementation";
        delete receipt.exactHeadTargetReceiptRef;
      } },
      { name: "execution head digest", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.executionBindingReceipts[0]!.headBindingDigest = "d".repeat(64); } },
      { name: "source relation binding", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.sourceBindings[1]!.seedId = "c".repeat(64); } },
      { name: "source binding id", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.sourceBindings[1]!.id = "rsb_forged"; } },
      { name: "source binding group", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.sourceBindings[1]!.groupId = "grp_99"; } },
      { name: "source binding ordinal", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.sourceBindings[1]!.ordinal = 99; } },
      { name: "source binding authority", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.sourceBindings[1]!.source = "pr_description"; } },
      { name: "exact-head target binding", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.exactHeadTargetReceipts[0]!.canonicalBindingDigest = "b".repeat(64); } },
      { name: "exact-head target id", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.exactHeadTargetReceipts[0]!.id = "exact_head_forged"; } },
      { name: "exact-head target path", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.exactHeadTargetReceipts[0]!.targetPathDigest = "1".repeat(64); } },
      { name: "exact-head target blob", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.exactHeadTargetReceipts[0]!.targetBlobSha = "2".repeat(40); } },
      { name: "exact-head target export", mutate: (report) => { report.proofGraph.privateReceiptBundleV2!.exactHeadTargetReceipts[0]!.exportKind = "default"; } }
    ];

    for (const mutation of mutations) {
      const report = fullPrivateReceiptReport();
      const context = v2ReceiptValidationContext(report);
      mutation.mutate(report);
      const result = validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: context } as never);
      expect(result.valid, mutation.name).toBe(false);
      expect(result.errors.join("\n"), mutation.name).toContain("private v2 receipt does not match transient validation context");
    }
  });

  it.each(["test", "execution"] as const)("rejects a coherent %s evidence-identity rename", (identity) => {
    const report = fullPrivateReceiptReport();
    const context = v2ReceiptValidationContext(report);

    coherentlyRenameReceiptEvidence(report, identity);

    expect(validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: context }).errors.join("\n"))
      .toContain("private v2 receipt does not match transient validation context");
  });

  it.each([
    {
      name: "canonical digest",
      mutate: (context: VerificationValidationContextV2) => { context.canonicalRequirementDigest = "f".repeat(64); }
    },
    {
      name: "changed canonical source",
      mutate: (context: VerificationValidationContextV2) => { context.selectedRequirementSource!.taskText += "\n- Add an unrelated objective."; }
    },
    {
      name: "incomplete changed-file inventory",
      mutate: (context: VerificationValidationContextV2) => { context.changedFileInventory.completeness = "incomplete"; }
    },
    {
      name: "stale inventory head",
      mutate: (context: VerificationValidationContextV2) => { context.changedFileInventory.headSha = "f".repeat(40); }
    },
    {
      name: "missing changed test",
      mutate: (context: VerificationValidationContextV2) => { context.changedFileInventory.files = []; }
    },
    {
      name: "stale exact-head module",
      mutate: (context: VerificationValidationContextV2) => { context.resolvedHeadModules = []; }
    },
    {
      name: "unbound execution suite",
      mutate: (context: VerificationValidationContextV2) => { context.executionBindings = []; }
    }
  ])("rejects a receipt bundle against $name context", ({ mutate }) => {
    const report = fullPrivateReceiptReport();
    const context = structuredClone(v2ReceiptValidationContext(report));
    mutate(context);

    expect(validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: context }).errors.join("\n"))
      .toContain("private v2 receipt does not match transient validation context");
  });

  it("rejects a v2 receipt cloned across requirement owners", () => {
    const report = fullPrivateReceiptReport();
    const original = v2Receipt(report);
    report.proofGraph.privateReceiptBundleV2!.testRelationReceipts.push({
      ...structuredClone(original),
      id: "cross_owner_clone",
      requirementId: report.requirements[0]!.requirementId
    });

    const result = validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: v2ReceiptValidationContext(report) } as never);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("private v2 receipt does not match transient validation context");
  });

  it("does not let a v1 relation receipt close satisfied v2 observation axes", () => {
    const report = fullPrivateReceiptReport();
    const relation = v2Receipt(report);
    const execution = report.proofGraph.privateReceiptBundleV2!.executionBindingReceipts[0]!;
    const context = v2ReceiptValidationContext(report);
    report.proofGraph.privateReceiptBundleV2!.testRelationReceipts = [{
      id: "legacy_relation",
      version: 1,
      kind: "targeted_test_relation",
      subjectRequirementId: relation.requirementId,
      subjectSource: "current_requirement",
      exactHeadTargetReceiptRef: relation.exactHeadTargetReceiptRef!,
      testEvidenceRef: relation.testEvidenceRef,
      relationBasis: "direct_static_import",
      directAssertionCaseCount: relation.directAssertionCount,
      executionEvidenceRef: execution.executionEvidenceRef
    }];

    const result = validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: context });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("satisfied requirement-local targeted-test or execution observation requires a closed test-relation receipt");
  });

  it("never echoes attacker-controlled private receipt IDs or refs in validation errors", () => {
    const attacks: Array<(report: ReturnType<typeof fullPrivateReceiptReport>, token: string) => void> = [
      (report, token) => { report.proofGraph.privateReceiptBundleV2!.sourceBindings[0]!.id = token; },
      (report, token) => { report.proofGraph.privateReceiptBundleV2!.exactHeadTargetReceipts[0]!.id = token; },
      (report, token) => { v2Receipt(report).id = token; },
      (report, token) => { v2Receipt(report).requirementId = token; },
      (report, token) => { v2Receipt(report).exactHeadTargetReceiptRef = token; },
      (report, token) => { v2Receipt(report).testEvidenceRef = token; },
      (report, token) => { v2Receipt(report).executionReceiptRef = token; },
      (report, token) => { report.proofGraph.privateReceiptBundleV2!.executionBindingReceipts[0]!.executionEvidenceRef = token; }
    ];

    attacks.forEach((attack, index) => {
      const token = `PRIVATE_ATTACKER_RECEIPT_${index}`;
      const report = fullPrivateReceiptReport();
      const context = v2ReceiptValidationContext(report);
      attack(report, token);

      const errors = validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: context } as never).errors.join("\n");
      expect(errors.length).toBeGreaterThan(0);
      expect(errors).not.toContain(token);
    });
  });

  it.each([41, 63])("rejects an exact-head receipt and report head with %i hex characters", (length) => {
    const report = fullPrivateReceiptReport();
    const headSha = "a".repeat(length);
    report.source.provenance!.headSha = headSha;
    report.source.provenance!.changedFileInventory!.headSha = headSha;
    report.source.provenance!.executionSuites![0]!.headSha = headSha;
    report.proofGraph.exactHeadTargetReceipts![0]!.headSha = headSha;

    const result = validateVerificationReport(report, { mode: "v2_full" });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "proofGraph.exactHeadTargetReceipts[0].headSha must be exactly 40 or 64 lowercase hexadecimal characters."
    );
  });

  it("accepts an exact-head receipt with a 64-character report head", () => {
    const headSha = "a".repeat(64);
    const report = fullPrivateReceiptReport("receipt_v2", headSha);

    expect(validateVerificationReport(report, { mode: "v2_full", receiptValidationContext: v2ReceiptValidationContext(report) })).toEqual({ valid: true, errors: [] });
  });

  it("rejects duplicate source-binding requirement, span, and identity tuples", () => {
    const cases: Array<{ name: string; mutate: (report: ReturnType<typeof fullPrivateReceiptReport>) => void; expected: string }> = [
      {
        name: "requirement",
        mutate: (report) => { report.proofGraph.sourceBindings![1]!.requirementId = report.proofGraph.sourceBindings![0]!.requirementId; },
        expected: "proofGraph.sourceBindings[1] duplicates a requirement binding."
      },
      {
        name: "span",
        mutate: (report) => { report.proofGraph.sourceBindings![1]!.spanId = report.proofGraph.sourceBindings![0]!.spanId; },
        expected: "proofGraph.sourceBindings[1] duplicates a source span binding."
      },
      {
        name: "identity",
        mutate: (report) => {
          const first = report.proofGraph.sourceBindings![0]!;
          const second = report.proofGraph.sourceBindings![1]!;
          second.seedId = first.seedId;
          second.groupId = first.groupId;
          second.source = first.source;
          second.ordinal = first.ordinal;
        },
        expected: "proofGraph.sourceBindings[1] duplicates a source identity tuple."
      }
    ];

    for (const item of cases) {
      const report = fullPrivateReceiptReport();
      item.mutate(report);
      const result = validateVerificationReport(report, { mode: "v2_full" });
      expect(result.valid, item.name).toBe(false);
      expect(result.errors, item.name).toContain(item.expected);
    }
  });

  it("validates closed failed Check associations, references, pairings, uniqueness, and cap", () => {
    const report = generateVerificationReport({
      title: "Add settings panel behavior",
      description: "Adds settings panel behavior.",
      taskText: "Acceptance criteria: implement settings panel behavior and add targeted tests.",
      taskSource: "issue",
      changedFiles: [
        { path: "src/settings/panel.ts", status: "modified", patch: "+ export const settingsPanel = true;" },
        { path: "src/settings/panel.test.ts", status: "modified", patch: "+ test('settings panel', () => expect(true).toBe(true));" }
      ],
      checks: [{ name: "unrelated matrix", status: "failed", summary: "An unrelated matrix job failed." }],
      logs: []
    });
    const requirementId = report.requirements[0]!.requirementId;
    const checkEvidenceRef = report.evidenceIndex.find((item) => item.kind === "check")!.id;
    const association = {
      version: 1,
      kind: "failed_check_association",
      requirementId,
      checkEvidenceRef,
      state: "unknown",
      basis: "identity_incomplete"
    } as const;
    const withAssociations = report as typeof report & {
      proofGraph: typeof report.proofGraph & { failedCheckAssociations: Array<Record<string, unknown>> };
    };
    withAssociations.proofGraph.failedCheckAssociations = [association];

    expect(validateVerificationReport(withAssociations, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const unknownKey = structuredClone(withAssociations);
    unknownKey.proofGraph.failedCheckAssociations[0]!.summary = "raw Check output must not be retained";
    expect(validateVerificationReport(unknownKey, { mode: "full" }).errors.join("\n"))
      .toContain("proofGraph.failedCheckAssociations[0].summary is not allowed");

    const invalidRef = structuredClone(withAssociations);
    invalidRef.proofGraph.failedCheckAssociations[0]!.checkEvidenceRef = "ev_missing";
    expect(validateVerificationReport(invalidRef, { mode: "full" }).errors.join("\n"))
      .toContain("proofGraph.failedCheckAssociations[0].checkEvidenceRef cites missing evidence");

    const invalidPairing = structuredClone(withAssociations);
    invalidPairing.proofGraph.failedCheckAssociations[0]!.state = "linked";
    expect(validateVerificationReport(invalidPairing, { mode: "full" }).errors.join("\n"))
      .toContain("proofGraph.failedCheckAssociations[0] has an incompatible state and basis");

    const invalidState = structuredClone(withAssociations);
    invalidState.proofGraph.failedCheckAssociations[0]!.state = "maybe" as never;
    expect(validateVerificationReport(invalidState, { mode: "full" }).errors.join("\n"))
      .toContain("proofGraph.failedCheckAssociations[0].state is invalid");

    const duplicate = structuredClone(withAssociations);
    duplicate.proofGraph.failedCheckAssociations.push(structuredClone(duplicate.proofGraph.failedCheckAssociations[0]!));
    expect(validateVerificationReport(duplicate, { mode: "full" }).errors.join("\n"))
      .toContain("proofGraph.failedCheckAssociations[1] duplicates requirement/check association");

    const overCap = structuredClone(withAssociations);
    overCap.proofGraph.failedCheckAssociations = Array.from({ length: 51 }, () => structuredClone(association));
    expect(validateVerificationReport(overCap, { mode: "full" }).errors.join("\n"))
      .toContain("proofGraph.failedCheckAssociations must contain at most 50 items");
  });

  it("rejects more than eight failed Check associations for one requirement", () => {
    const report = generateVerificationReport({
      title: "Add repository settings behavior",
      description: "Adds repository settings behavior.",
      taskText: "Acceptance criteria: implement repository settings behavior.",
      taskSource: "issue",
      changedFiles: [{
        path: "src/settings/repository-settings.ts",
        status: "modified",
        patch: "+ export const repositorySettings = true;"
      }],
      checks: Array.from({ length: 9 }, (_, index) => ({
        name: `Unrelated failed matrix ${index + 1}`,
        status: "failed" as const,
        summary: "An unrelated matrix job failed."
      })),
      logs: []
    });
    const requirementId = report.requirements[0]!.requirementId;
    const failedCheckRefs = report.evidenceIndex
      .filter((evidence) => evidence.kind === "check")
      .map((evidence) => evidence.id);
    report.proofGraph.failedCheckAssociations = failedCheckRefs.map((checkEvidenceRef) => ({
      version: 1,
      kind: "failed_check_association",
      requirementId,
      checkEvidenceRef,
      state: "unknown",
      basis: "identity_incomplete"
    }));

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "proofGraph.failedCheckAssociations must contain at most 8 items per requirement"
    );
  });

  it("rejects private receipts at the tenant validation boundary and omits them from tenant persistence", () => {
    const report = fullPrivateReceiptReport();
    const tenantValidation = validateVerificationReport(report, { mode: "v2_tenant" });

    for (const collection of [
      "sourceBindings",
      "exactHeadTargetReceipts",
      "privateReceiptBundleV2",
      "failedCheckAssociations"
    ]) {
      expect(tenantValidation.errors).toContain(`tenant reports must omit proofGraph.${collection}.`);
    }

    const serialized = JSON.stringify(projectTenantPersistedReport(report, "task-4-tenant-projection-secret"));
    expect(serialized).not.toContain("sourceBindings");
    expect(serialized).not.toContain("exactHeadTargetReceipts");
    expect(serialized).not.toContain("testRelationReceipts");
    expect(serialized).not.toContain("failedCheckAssociations");
    expect(serialized).not.toContain("targetBlobSha");
    expect(serialized).not.toContain("An unrelated matrix job failed");
  });

  it.each([
    { state: "unknown", basis: "identity_incomplete", location: "requirement" },
    { state: "unknown", basis: "identity_incomplete", location: "proof_axis" },
    { state: "unknown", basis: "identity_incomplete", location: "proof_node_execution" },
    { state: "unknown", basis: "identity_incomplete", location: "local_gap" },
    { state: "not_linked", basis: "deterministic_non_match", location: "requirement" },
    { state: "not_linked", basis: "deterministic_non_match", location: "proof_axis" },
    { state: "not_linked", basis: "deterministic_non_match", location: "proof_node_execution" },
    { state: "not_linked", basis: "deterministic_non_match", location: "local_gap" }
  ] as const)("rejects $state failed Check evidence in $location proof", ({ state, basis, location }) => {
    const report = generateVerificationReport({
      title: "Add settings panel behavior",
      description: "Adds settings panel behavior.",
      taskText: "Acceptance criteria: implement settings panel behavior and add targeted tests.",
      taskSource: "issue",
      changedFiles: [
        { path: "src/settings/panel.ts", status: "modified", patch: "+ export const settingsPanel = true;" },
        { path: "src/settings/panel.test.ts", status: "modified", patch: "+ test('settings panel', () => expect(true).toBe(true));" }
      ],
      checks: [{ name: "unrelated matrix", status: "failed", summary: "An unrelated matrix job failed." }],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;
    const failedCheckRef = report.evidenceIndex.find((item) => item.kind === "check")!.id;
    const association = report.proofGraph.failedCheckAssociations![0]!;
    association.state = state;
    association.basis = basis;

    if (location === "requirement") {
      requirement.evidenceRefs.push(failedCheckRef);
    } else if (location === "proof_axis") {
      requirement.proofAxes!.find((axis) => axis.subject === "execution")!.evidenceRefs.push(failedCheckRef);
    } else if (location === "proof_node_execution") {
      node.executionEvidenceRefs.push(failedCheckRef);
      report.proofGraph.summary.requirementsWithExecution = 1;
    } else {
      node.gapSignals[0]!.evidenceRefs.push(failedCheckRef);
    }

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(
      `proofGraph.failedCheckAssociations[0] ${state} Check evidence cannot enter ${location} proof`
    );
  });

  it("rejects direct assertion case coverage when its receipt is missing or inconsistent", () => {
    const headSha = "d".repeat(40);
    const testPath = "test/customer-display-name.test.js";
    const secondaryTestPath = "test/customer-display-name-secondary.test.js";
    const report = generateVerificationReport({
      title: "Cover both customer display-name paths",
      description: "Adds focused customer display-name tests.",
      taskText: "Acceptance criteria: add focused tests for both paths of customer display-name formatting.",
      taskSource: "issue",
      changedFiles: [
        {
          path: "src/customers/display-name.js",
          status: "modified",
          patch: "+export function customerDisplayName(includeFamilyName) { return includeFamilyName ? 'Ada Lovelace' : 'Ada'; }"
        },
        {
          path: testPath,
          status: "modified",
          patch: [
            "+import assert from 'node:assert/strict';",
            "+import { customerDisplayName } from '../src/customers/display-name.js';",
            "+test('short name', () => { assert.equal(customerDisplayName(false), 'Ada'); });",
            "+test('full name', () => { assert.equal(customerDisplayName(true), 'Ada Lovelace'); });"
          ].join("\n")
        },
        {
          path: secondaryTestPath,
          status: "modified",
          patch: [
            "+import assert from 'node:assert/strict';",
            "+import { customerDisplayName } from '../src/customers/display-name.js';",
            "+test('short name smoke', () => { assert.equal(customerDisplayName(false), 'Ada'); });"
          ].join("\n")
        }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "npm test passed." }],
      sourceProvenance: { ...githubInventoryProvenance(), headSha, changedFileInventory: { version: 1, completeness: "complete", headSha } },
      executionSuites: [{
        headSha,
        status: "passed",
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    });
    const legitimateNode = report.proofGraph.nodes[0] as typeof report.proofGraph.nodes[number] & {
      caseCoverageReceipt?: {
        version: 1;
        implementationEvidenceRef: string;
        testEvidenceRef: string;
        distinctLiteralCaseCount: number;
      };
    };

    // This test targets the axis validator itself, so make the pre-policy
    // candidate explicit rather than relying on a receipt-less promotion.
    for (const axis of report.requirements[0]!.proofAxes ?? []) {
      if (axis.subject === "targeted_test" || axis.subject === "execution") axis.state = "satisfied";
    }
    report.requirements[0]!.status = "met";
    report.requirements[0]!.gaps = [];
    report.proofGraph.nodes[0]!.status = "met";
    report.proofGraph.nodes[0]!.gapSignals = [];
    report.proofGraph.summary.requirementsWithGaps = 0;
    report.proofGraph.summary.gapCount = 0;

    expect(legitimateNode.caseCoverageReceipt).toBeDefined();
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(sanitizeReportForShare(report))).not.toContain("caseCoverageReceipt");
    expect(JSON.stringify(projectTenantPersistedReport(report, "task-3-test-signing-secret"))).not.toContain("caseCoverageReceipt");

    const mismatchedSuite = structuredClone(report);
    mismatchedSuite.source.provenance!.executionSuites![0]!.testPaths = [secondaryTestPath];
    const mismatchedSuiteResult = validateVerificationReport(mismatchedSuite, { mode: "full" });
    expect(mismatchedSuiteResult.valid).toBe(false);
    expect(mismatchedSuiteResult.errors.join("\n")).toContain("cites incompatible evidence or collection basis");

    const missing = structuredClone(report);
    delete (missing.proofGraph.nodes[0] as typeof legitimateNode).caseCoverageReceipt;
    const missingResult = validateVerificationReport(missing, { mode: "full" });
    expect(missingResult.valid).toBe(false);
    expect(missingResult.errors.join("\n")).toContain("case coverage receipt is required");

    const inconsistent = structuredClone(report);
    const inconsistentNode = inconsistent.proofGraph.nodes[0] as typeof legitimateNode;
    (inconsistentNode as unknown as { caseCoverageReceipt: Record<string, unknown> }).caseCoverageReceipt = {
      version: 1,
      implementationEvidenceRef: legitimateNode.implementationEvidenceRefs[0]!,
      testEvidenceRef: legitimateNode.implementationEvidenceRefs[0]!,
      distinctLiteralCaseCount: 1
    };
    const inconsistentResult = validateVerificationReport(inconsistent, { mode: "full" });
    expect(inconsistentResult.valid).toBe(false);
    expect(inconsistentResult.errors.join("\n")).toContain("caseCoverageReceipt.testEvidenceRef must match targeted test evidence");
    expect(inconsistentResult.errors.join("\n")).toContain("caseCoverageReceipt.distinctLiteralCaseCount must be 2");
  });

  it("requires CI plus execution instead of fallback implementation for a resolved workflow continuation", () => {
    const report = generateVerificationReport({
      title: "Pin the validation workflow runtime",
      description: "Updates the validation workflow.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      taskSource: "issue",
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }, {
        path: "test/validation-workflow.test.js",
        status: "modified",
        patch: "+ test('validation workflow command', () => { expect('npm test').toBe('npm test'); });"
      }],
      checks: [{ name: "Validation CI", status: "passed", summary: "Node.js 22 npm test passed." }],
      logs: [],
      sourceProvenance: githubInventoryProvenance(),
      executionSuites: [{
        headSha: "a".repeat(40),
        status: "passed",
        executionSource: "Validation CI",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/validation-workflow.test.js"]
      }]
    });

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(report.proofGraph.nodes[1]?.deterministicRelation).toEqual({
      version: 1,
      kind: "workflow_antecedent",
      antecedentRequirementId: report.requirements[0]!.requirementId
    });

    for (const collectionBasis of ["passing_execution", "passing_suite_execution"] as const) {
      const forgedExecution = structuredClone(report);
      const forgedAxis = forgedExecution.requirements[1]!.proofAxes!.find((axis) => axis.subject === "execution")!;
      const passingRef = forgedExecution.evidenceIndex.find((evidence) => evidence.kind === "check")!.id;
      forgedAxis.state = "satisfied";
      forgedAxis.evidenceRefs = [passingRef];
      forgedAxis.collectionBasis = collectionBasis;
      forgedExecution.proofGraph.nodes[1]!.executionEvidenceRefs = [passingRef];
      if (collectionBasis === "passing_suite_execution") {
        const testRef = forgedExecution.evidenceIndex.find((evidence) => evidence.kind === "test")!.id;
        forgedExecution.proofGraph.nodes[1]!.targetedTestEvidenceRefs = [testRef];
      }
      forgedExecution.proofGraph.summary.requirementsWithExecution = forgedExecution.proofGraph.nodes
        .filter((node) => node.executionEvidenceRefs.length > 0).length;
      forgedExecution.proofGraph.summary.requirementsWithTargetedTests = forgedExecution.proofGraph.nodes
        .filter((node) => node.targetedTestEvidenceRefs.length > 0).length;

      const forged = validateVerificationReport(forgedExecution, { mode: "full" });
      expect(forged.valid).toBe(false);
      expect(forged.errors).toContain(
        "requirements[1].proofAxes[1] satisfied workflow antecedent execution requires a complete workflow/job identity tuple."
      );
    }

    const fallback = structuredClone(report);
    const continuation = fallback.requirements[1]!;
    const ciAxis = continuation.proofAxes!.find((axis) => axis.subject === "ci_configuration")!;
    ciAxis.subject = "implementation";
    fallback.proofGraph.nodes[1]!.sourceSection = "tampered-section";

    const invalid = validateVerificationReport(fallback, { mode: "full" });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join("\n")).toContain("complete required proof axis set");
  });

  it("does not let duplicate requirement-text tampering neutralize a closed workflow receipt", () => {
    const report = generateVerificationReport({
      title: "Pin the validation workflow runtime",
      description: "Updates the validation workflow.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      taskSource: "issue",
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{ name: "Validation CI", status: "passed", summary: "Node.js 22 npm test passed." }],
      logs: []
    });
    const tampered = structuredClone(report);
    tampered.requirements[0]!.requirementText = "Add the validation runner configuration.";
    tampered.proofGraph.nodes[0]!.requirementText = "Add the validation runner configuration.";
    tampered.requirements[1]!.requirementText = "The runner must use Node.js 22 and run npm test.";
    tampered.proofGraph.nodes[1]!.requirementText = "The runner must use Node.js 22 and run npm test.";
    for (const requirement of tampered.requirements) {
      const ciAxis = requirement.proofAxes!.find((axis) => axis.subject === "ci_configuration")!;
      ciAxis.subject = "implementation";
    }

    const result = validateVerificationReport(tampered, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("complete required proof axis set");
  });

  it("accepts a v2 no-contract report only through the v2 full validator and rejects a deleted contract", () => {
    const report = generateVerificationReportV2({
      input: {
        title: "Improve repository overview",
        description: "Adds a helper.",
        taskText: "The repository overview should be more useful for reviewers.",
        taskSource: "issue",
        changedFiles: [{ path: "src/repositories/OverviewAction.js", status: "modified", patch: "+ export const overviewActionLabel = () => 'Review repository';" }],
        checks: [{ name: "repository overview tests", status: "passed", summary: "Repository overview tests passed." }],
        logs: []
      },
      contractSource: {
        kind: "linked_issue",
        title: "The repository overview should be more useful for reviewers.",
        body: ""
      },
      binding: {
        sourceKind: "linked_issue",
        sourceIdentity: "github:repository:42:issue:23",
        sourceContent: "The repository overview should be more useful for reviewers.",
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      }
    });

    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });

    const forged = { ...report } as Record<string, unknown>;
    delete forged.verificationContract;
    expect(validateVerificationReport(forged, { mode: "v2_full" }).valid).toBe(false);
  });
  it("allows hashless planner provenance only on public summaries", () => {
    const fullReport = generateVerificationReport(demoScenarios.clean);
    fullReport.planner = { ...HYBRID_PLANNER_PROVENANCE };
    for (const requirement of fullReport.requirements) requirement.classificationBasis = "enhanced_plan";
    for (const node of fullReport.proofGraph.nodes) node.classificationBasis = "enhanced_plan";
    const report = sanitizeReportForShare(fullReport) as unknown as Record<string, unknown>;
    delete (report.planner as Record<string, unknown>).inputHash;
    report.authenticity = createUnverifiedAuthenticity("portable_unverified");

    expect(validateVerificationReport(report, { mode: "summary" })).toEqual({ valid: true, errors: [] });

    const full = validateVerificationReport(report, { mode: "full" });
    expect(full.valid).toBe(false);
    expect(full.errors.join("\n")).toContain("planner.inputHash");

    const hashfulPortable = structuredClone(report) as Record<string, unknown>;
    (hashfulPortable.planner as Record<string, unknown>).inputHash = "a".repeat(64);
    const leaked = validateVerificationReport(hashfulPortable, { mode: "summary" });
    expect(leaked.valid).toBe(false);
    expect(leaked.errors.join("\n")).toContain("public summary planner provenance must omit planner.inputHash");

    const verified = structuredClone(report) as Record<string, unknown>;
    verified.authenticity = {
      version: 1,
      trust: "verified_agentproof",
      generator: {
        reportSchemaVersion: "verification-report.v1",
        deterministicEngineVersion: "agentproof-deterministic.v1"
      },
      canonicalDigest: "b".repeat(64),
      signingKeyId: "agentproof-report-hmac-v1",
      signature: "c".repeat(64)
    };
    expect(validateVerificationReport(verified, { mode: "summary" })).toEqual({ valid: true, errors: [] });

    const unsigned = structuredClone(report) as Record<string, unknown>;
    delete unsigned.authenticity;
    const untrusted = validateVerificationReport(unsigned, { mode: "summary" });
    expect(untrusted.valid).toBe(false);
    expect(untrusted.errors.join("\n")).toContain("hashless planner provenance requires public-summary authenticity");
  });

  it("accepts only neutral enhanced-planning provenance and matching axis subjects", () => {
    const report = generateVerificationReport(demoScenarios.clean) as unknown as Record<string, unknown>;
    const requirements = report.requirements as Array<Record<string, unknown>>;
    const nodes = (report.proofGraph as { nodes: Array<Record<string, unknown>> }).nodes;
    report.planner = { ...HYBRID_PLANNER_PROVENANCE };
    for (const requirement of requirements) requirement.classificationBasis = "enhanced_plan";
    requirements[0]!.plannerAxisSubjects = ["documentation"];
    requirements[0]!.proofAxes = [{ subject: "documentation", polarity: "present", state: "incomplete", evidenceRefs: [] }];
    for (const node of nodes) node.classificationBasis = "enhanced_plan";

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });

    (report.planner as Record<string, unknown>).inputHash = "UPPER";
    requirements[0]!.plannerAxisSubjects = ["implementation", "implementation"];
    nodes[0]!.classificationBasis = "deterministic";
    const invalid = validateVerificationReport(report);
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.join("\n")).toContain("planner.inputHash");
    expect(invalid.errors.join("\n")).toContain("plannerAxisSubjects");
    expect(invalid.errors.join("\n")).toContain("classificationBasis must match");
  });

  it("requires a complete planner provenance tuple for enhanced findings and proof nodes", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    for (const requirement of report.requirements) requirement.classificationBasis = "enhanced_plan";
    report.requirements[0]!.plannerAxisSubjects = ["documentation"];
    report.requirements[0]!.proofAxes = [{ subject: "documentation", polarity: "present", state: "incomplete", evidenceRefs: [] }];
    for (const node of report.proofGraph.nodes) node.classificationBasis = "enhanced_plan";

    expect(validateVerificationReport(report).valid).toBe(false);
    report.planner = { ...HYBRID_PLANNER_PROVENANCE };
    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });

    delete report.requirements[0]!.classificationBasis;
    expect(validateVerificationReport(report).valid).toBe(false);
    report.requirements[0]!.classificationBasis = "enhanced_plan";
    delete report.proofGraph.nodes[0]!.classificationBasis;
    expect(validateVerificationReport(report).valid).toBe(false);
    delete report.requirements[0]!.plannerAxisSubjects;
    delete report.requirements[0]!.classificationBasis;
    report.proofGraph.nodes[0]!.classificationBasis = "deterministic";
    expect(validateVerificationReport(report).valid).toBe(false);
  });

  it("rejects a mixed four-requirement planner tuple instead of accepting one enhanced pair", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const originalRequirement = report.requirements[0]!;
    const originalNode = report.proofGraph.nodes[0]!;
    report.requirements = Array.from({ length: 4 }, (_, index) => ({
      ...structuredClone(originalRequirement),
      requirementId: `mixed_requirement_${index}`,
      classificationBasis: index === 0 ? "enhanced_plan" as const : "deterministic" as const
    }));
    report.proofGraph.nodes = Array.from({ length: 4 }, (_, index) => ({
      ...structuredClone(originalNode),
      requirementId: `mixed_requirement_${index}`,
      classificationBasis: index === 0 ? "enhanced_plan" as const : "deterministic" as const
    }));
    report.proofGraph.summary = {
      requirementCount: 4,
      requirementsWithImplementation: report.proofGraph.nodes.filter((node) => node.implementationEvidenceRefs.length > 0).length,
      requirementsWithTargetedTests: report.proofGraph.nodes.filter((node) => node.targetedTestEvidenceRefs.length > 0).length,
      requirementsWithExecution: report.proofGraph.nodes.filter((node) => node.executionEvidenceRefs.length > 0).length,
      requirementsWithGaps: report.proofGraph.nodes.filter((node) => node.gapSignals.length > 0).length,
      gapCount: report.proofGraph.nodes.reduce((count, node) => count + node.gapSignals.length, 0)
    };
    report.planner = { ...HYBRID_PLANNER_PROVENANCE };

    const result = validateVerificationReport(report);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("planner provenance requires every materialized requirement");
  });
  it("accepts a generated deterministic report", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("keeps suite execution requirement-local only when a receipt can bind the changed test path", () => {
    const headSha = "c".repeat(40);
    const report = generateVerificationReport({
      title: "Add repository search empty state",
      description: "Adds repository search behavior.",
      taskText: "Search results must show an empty-state message when no repositories match.",
      changedFiles: [
        { path: "src/repositories/RepositorySearch.js", additions: 8, deletions: 0, status: "added", patch: "+ export function emptyStateMessage() {}" },
        {
          path: "test/repository-search.test.js",
          additions: 8,
          deletions: 0,
          status: "added",
          patch: "+ import { emptyStateMessage } from '../src/repositories/RepositorySearch.js';\n+ test('empty state', () => { emptyStateMessage(); })"
        }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "Steps: Run npm test: passed." }],
      executionSuites: [{
        headSha,
        status: "passed",
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/repository-search.test.js"]
      }],
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        headSha,
        baseSha: "b".repeat(40),
        changedFileInventory: { version: 1, completeness: "complete", headSha },
        evidenceCapturedAt: "2026-08-11T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "a".repeat(64), coverage: "github_metadata" }
      }
    });

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(report.requirements[0]?.proofAxes?.find((axis) => axis.subject === "execution")?.state).toBe("incomplete");

    report.source.provenance!.executionSuites![0]!.testPaths = ["test/unrelated.test.js"];
    const forged = validateVerificationReport(report, { mode: "full" });
    expect(forged).toEqual({ valid: true, errors: [] });
  });

  it("validates every no-secret demo report in full and summary modes", () => {
    for (const [scenarioId, input] of Object.entries(demoScenarios)) {
      const report = generateVerificationReport(input);
      const shared = decodeSharedReport(encodeReportForShare(report));

      expect(validateVerificationReport(report, { mode: "full" }), scenarioId).toEqual({ valid: true, errors: [] });
      expect(validateVerificationReport(shared, { mode: "summary" }), scenarioId).toEqual({ valid: true, errors: [] });
      expect(JSON.stringify(shared), scenarioId).not.toContain("provenance");
      expect(shared.evidenceIndex, scenarioId).toEqual([]);
      expect(shared.claims, scenarioId).toEqual([]);
    }
  });

  it("rejects forged PR-description authority on an authoritative requirement", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.requirements[0]!.evidenceStatus = "met";
    report.requirements[0]!.sourceAuthority = "pr_description";

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("sourceAuthority must match an author-claim proof node");
  });

  it("rejects missing evidence references and invalid confidence", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.requirements[0].evidenceRefs = ["ev_missing"];
    report.summary.confidence = 2;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("ev_missing");
    expect(result.errors.join("\n")).toContain("summary.confidence");
  });

  it("rejects missing scope and review-priority evidence references", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.scope.evidenceRefs = ["ev_missing_scope"];
    report.reviewPriority[0].evidenceRefs = ["ev_missing_priority"];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs cites missing evidence ev_missing_scope");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs cites missing evidence ev_missing_priority");
  });

  it("rejects malformed finding provenance", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.scope.provenance = [
      {
        evidenceRef: "ev_missing_provenance",
        sourceType: "diff",
        locator: "src/server/auth/sessionExpiry.ts",
        confidence: 0.7,
        evidenceText: "Missing provenance should fail."
      }
    ];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.provenance[0].evidenceRef cites missing evidence ev_missing_provenance");
  });

  it("keeps default validation backward-compatible for optional provenance", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("accepts auditable GitHub source provenance with exact head and base anchors", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.provenance = {
      version: 1,
      origin: "github_snapshot",
      evidenceCapturedAt: "2026-06-30T00:00:00.000Z",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        coverage: "github_metadata"
      }
    };

    expect(validateVerificationReport(report, {
      mode: "full",
      requireSourceProvenance: true
    })).toEqual({ valid: true, errors: [] });
  });

  it("rejects strict GitHub source provenance without a full base anchor", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.provenance = {
      version: 1,
      origin: "github_snapshot",
      evidenceCapturedAt: "2026-06-30T00:00:00.000Z",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        coverage: "github_metadata"
      }
    };

    const result = validateVerificationReport(report, {
      mode: "full",
      requireSourceProvenance: true
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "source.provenance.baseSha must be a full lowercase Git commit SHA for github_snapshot"
    );
  });

  it("requires full-report provenance when strict mode is enabled", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("separates full-report validation from summary-only validation", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(shared.evidenceIndex).toHaveLength(0);
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });

    const result = validateVerificationReport(shared, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("evidenceIndex must contain evidence items for full reports");
  });

  it("rejects finding provenance on summary-only reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const shared = decodeSharedReport(encodeReportForShare(report));
    shared.scope.provenance = [];
    shared.testing.missingTests[0].provenance = [];

    const result = validateVerificationReport(shared, { mode: "summary" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary-only reports must omit finding provenance");
    expect(result.errors.join("\n")).toContain("summary-only reports must omit testing.missingTests[0].provenance");
  });

  it("accepts nullable optional fields produced by strict structured-output schemas", () => {
    const report = generateVerificationReport(demoScenarios.clean) as unknown as Record<string, unknown>;
    const source = report.source as Record<string, unknown>;
    const evidenceIndex = report.evidenceIndex as Array<Record<string, unknown>>;
    const scope = report.scope as Record<string, unknown>;

    source.url = null;
    source.author = null;
    source.baseBranch = null;
    source.headBranch = null;
    evidenceIndex[0].locator = null;
    scope.provenance = [
      {
        evidenceRef: evidenceIndex[0].id,
        sourceType: evidenceIndex[0].kind,
        locator: null,
        confidence: 0.7,
        evidenceText: "Short structured-output provenance."
      }
    ];

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("allows strict validation when missing provenance is explained at the item level", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.scope.reasons = ["Scope evidence was unavailable from the imported report source."];
    report.reviewPriority[0].reason = "File-level priority evidence was unavailable from the imported report source.";

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not let a global limitation bypass full-report provenance checks", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.limitations.push("File-level priority evidence was unavailable from the imported report source.");

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("rejects semantically overconfident full reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.summary.confidence = 1;

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.confidence must be capped");
  });

  it("rejects met test requirements without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    const testRequirement = report.requirements.find((requirement) => /\btests?\b/i.test(requirement.requirementText))!;
    testRequirement.status = "met";
    testRequirement.gaps = [];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");
  });

  it("rejects met non-test requirements without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.requirements[0].status = "met";
    report.requirements[0].gaps = [];
    report.requirements[0].evidenceRefs = report.evidenceIndex.filter((item) => item.kind === "diff").map((item) => item.id).slice(0, 1);

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");
  });

  it("validates full reports from proof axes while retaining conservative legacy behavior", () => {
    const report = generateVerificationReport({
      title: "Keep implementation unchanged",
      description: "Changes documentation only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry guide" }],
      checks: [],
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    });

    expect(report.requirements[0]?.status).toBe("met");
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const legacy = structuredClone(report);
    delete legacy.requirements[0].proofAxes;
    const legacyValidation = validateVerificationReport(legacy, { mode: "full" });
    expect(legacyValidation.valid).toBe(false);
    expect(legacyValidation.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");

    const legacyPassing = generateVerificationReport(demoScenarios.clean);
    for (const requirement of legacyPassing.requirements) delete requirement.proofAxes;
    expect(validateVerificationReport(legacyPassing, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("rejects invented, incomplete, incompatible, or proof-node-divergent axes", () => {
    const invented = generateVerificationReport(demoScenarios["missing-tests"]);
    const target = invented.requirements[0]!;
    target.status = "met";
    target.gaps = [];
    target.proofAxes = [{
      subject: "documentation",
      polarity: "present",
      state: "satisfied",
      evidenceRefs: [],
      collectionBasis: "matching_artifact_evidence"
    }];
    invented.proofGraph.nodes.find((node) => node.requirementId === target.requirementId)!.status = "met";
    const inventedResult = validateVerificationReport(invented, { mode: "full" });
    expect(inventedResult.valid).toBe(false);
    expect(inventedResult.errors.join("\n")).toContain("required proof axis set");

    const incomplete = generateVerificationReport(demoScenarios.clean);
    const incompleteRequirement = incomplete.requirements.find((item) =>
      item.proofAxes?.some((axis) => axis.subject === "execution")
    )!;
    incompleteRequirement.proofAxes = incompleteRequirement.proofAxes!.filter((axis) => axis.subject !== "execution");
    const incompleteResult = validateVerificationReport(incomplete, { mode: "full" });
    expect(incompleteResult.valid).toBe(false);
    expect(incompleteResult.errors.join("\n")).toContain("required proof axis set");

    const unsupported = generateVerificationReport(demoScenarios.clean);
    const unsupportedAxis = unsupported.requirements[0]!.proofAxes!.find((axis) =>
      axis.subject === "implementation" && axis.polarity === "present"
    )!;
    unsupportedAxis.collectionBasis = "passing_execution";
    const unsupportedResult = validateVerificationReport(unsupported, { mode: "full" });
    expect(unsupportedResult.valid).toBe(false);
    expect(unsupportedResult.errors.join("\n")).toContain("incompatible evidence or collection basis");

    const empty = generateVerificationReport(demoScenarios.clean);
    const emptyAxis = empty.requirements[0]!.proofAxes!.find((axis) =>
      axis.subject === "implementation" && axis.polarity === "present"
    )!;
    emptyAxis.evidenceRefs = [];
    const emptyResult = validateVerificationReport(empty, { mode: "full" });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.join("\n")).toContain("satisfied present axis must cite evidence");

    const incompatible = generateVerificationReport(demoScenarios.clean);
    const requirement = incompatible.requirements[0]!;
    const implementationAxis = requirement.proofAxes!.find((axis) => axis.subject === "implementation" && axis.polarity === "present")!;
    implementationAxis.evidenceRefs = [incompatible.evidenceIndex.find((item) => item.kind === "test")!.id];
    const incompatibleResult = validateVerificationReport(incompatible, { mode: "full" });
    expect(incompatibleResult.valid).toBe(false);
    expect(incompatibleResult.errors.join("\n")).toContain("incompatible evidence");

    const nodeMismatch = generateVerificationReport(demoScenarios.clean);
    nodeMismatch.proofGraph.nodes[0]!.status = nodeMismatch.requirements[0]!.status === "partial" ? "met" : "partial";
    const mismatchResult = validateVerificationReport(nodeMismatch, { mode: "full" });
    expect(mismatchResult.valid).toBe(false);
    expect(mismatchResult.errors.join("\n")).toContain("must match proofGraph node status");

    const unrelatedExecution = generateVerificationReport(demoScenarios.clean);
    const executionRequirement = unrelatedExecution.requirements.find((item) =>
      item.proofAxes?.some((axis) => axis.subject === "execution")
    )!;
    const executionAxis = executionRequirement.proofAxes!.find((axis) => axis.subject === "execution")!;
    const executionNode = unrelatedExecution.proofGraph.nodes.find((node) =>
      node.requirementId === executionRequirement.requirementId
    )!;
    unrelatedExecution.evidenceIndex.push({
      id: "ev_unrelated_global_execution",
      kind: "check",
      label: "Payments service tests",
      summary: "Status: passed. Payments service tests completed successfully.",
      locator: "ci://payments",
      confidence: 0.99
    });
    executionAxis.state = "satisfied";
    executionAxis.evidenceRefs = ["ev_unrelated_global_execution"];
    executionNode.executionEvidenceRefs = ["ev_unrelated_global_execution"];
    const unrelatedResult = validateVerificationReport(unrelatedExecution, { mode: "full" });
    expect(unrelatedResult.valid).toBe(false);
    expect(unrelatedResult.errors.join("\n")).toContain("incompatible evidence");

    const pairedForgery = generateVerificationReport({
      title: "Add retry queue tests",
      description: "Adds retry queue synchronization tests.",
      taskText: "Acceptance criteria: add regression tests for retry queue synchronization.",
      taskSource: "issue",
      changedFiles: [
        { path: "test/retry-queue.test.ts", status: "added", patch: "+ test('retry queue synchronization', () => {})" },
        { path: "test/customer-export.test.ts", status: "added", patch: "+ test('customer export', () => {})" }
      ],
      checks: [
        { name: "retry queue tests", status: "passed", summary: "Retry queue synchronization tests passed." },
        { name: "customer export tests", status: "passed", summary: "Customer export tests passed." }
      ],
      logs: []
    });
    const pairedRequirement = pairedForgery.requirements[0]!;
    const pairedNode = pairedForgery.proofGraph.nodes[0]!;
    const unrelatedTestRef = pairedForgery.evidenceIndex.find((item) =>
      item.kind === "test" && item.locator === "test/customer-export.test.ts"
    )!.id;
    const unrelatedCheckRef = pairedForgery.evidenceIndex.find((item) =>
      item.kind === "check" && item.label === "customer export tests"
    )!.id;
    pairedRequirement.status = "met";
    pairedRequirement.gaps = [];
    pairedRequirement.proofAxes = pairedRequirement.proofAxes!.map((axis) =>
      axis.subject === "targeted_test"
        ? { ...axis, state: "satisfied", evidenceRefs: [unrelatedTestRef], collectionBasis: "matching_artifact_evidence" }
        : axis.subject === "execution"
          ? { ...axis, state: "satisfied", evidenceRefs: [unrelatedCheckRef], collectionBasis: "passing_execution" }
          : axis
    );
    pairedNode.status = "met";
    pairedNode.targetedTestEvidenceRefs = [unrelatedTestRef];
    pairedNode.executionEvidenceRefs = [unrelatedCheckRef];
    pairedNode.gapSignals = [];

    const pairedForgeryResult = validateVerificationReport(pairedForgery, { mode: "full" });
    expect(pairedForgeryResult.valid).toBe(false);
    expect(pairedForgeryResult.errors.join("\n")).toContain("incompatible evidence");
  });

  it("rejects a forged manual-check ambiguity on an all-satisfied authoritative requirement", () => {
    const report = generateVerificationReport({
      title: "Retry report",
      description: "Adds retry behavior and reports the test result.",
      taskText: "Add retry handling.",
      taskSource: "issue",
      changedFiles: [
        { path: "src/retry.ts", status: "modified", patch: "+ export function retryRequest() {}" },
        { path: "src/retry.test.ts", status: "modified", patch: "+ test retry request" }
      ],
      checks: [{ name: "retry tests", status: "passed", summary: "Retry request tests passed." }],
      logs: [{ source: "retry tests", status: "passed", text: "npm test retry: passed" }]
    });
    const finding = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;
    finding.proofAxes!.find((axis) => axis.subject === "execution")!.state = "satisfied";
    finding.status = "met";
    finding.gaps = [];
    node.status = "met";
    node.gapSignals = node.gapSignals.filter((gap) => gap.kind !== "missing_execution");
    report.proofGraph.summary.requirementsWithGaps = node.gapSignals.length > 0 ? 1 : 0;
    report.proofGraph.summary.gapCount = node.gapSignals.length;
    expect(finding.status).toBe("met");
    expect(finding.proofAxes?.every((axis) => axis.state === "satisfied")).toBe(true);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });

    finding.status = "unclear";
    finding.gaps = ["Requirement needs human interpretation before trusting the report."];
    node.status = "unclear";
    node.sourceQuality = "manual_check";
    node.gapSignals = [{
      kind: "ambiguous_requirement",
      severity: "medium",
      message: "Requirement needs human interpretation before trusting the report.",
      evidenceRefs: finding.evidenceRefs.slice(0, 1)
    }];
    report.proofGraph.summary.requirementsWithGaps = 1;
    report.proofGraph.summary.gapCount = 1;

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("every satisfied authoritative axis requires met");
  });

  it("rejects axes derived from proof-node text that diverges from the matched requirement", () => {
    const report = generateVerificationReport({
      title: "Implement retry queue behavior",
      description: "Implements retry queue behavior and adds documentation.",
      taskText: "Acceptance criteria: implement retry queue behavior.",
      changedFiles: [
        { path: "src/retry-queue.ts", status: "modified", patch: "+ export function retryQueue() {}" },
        { path: "docs/retry-queue.md", status: "modified", patch: "+ # Retry queue" }
      ],
      checks: [{ name: "Retry queue tests", status: "passed", summary: "Retry queue tests passed." }],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;
    const documentationRef = report.evidenceIndex.find((item) =>
      item.kind === "diff" && item.locator === "docs/retry-queue.md"
    )!.id;

    requirement.status = "met";
    requirement.gaps = [];
    requirement.evidenceRefs = [documentationRef];
    requirement.proofAxes = [{
      subject: "documentation",
      polarity: "present",
      state: "satisfied",
      evidenceRefs: [documentationRef],
      collectionBasis: "matching_artifact_evidence"
    }];
    node.requirementText = "Document retry queue";
    node.status = "met";
    node.implementationEvidenceRefs = [documentationRef];
    node.targetedTestEvidenceRefs = [];
    node.executionEvidenceRefs = [];
    node.gapSignals = [];
    node.firstFiles = ["docs/retry-queue.md"];
    report.proofGraph.summary = {
      requirementCount: 1,
      requirementsWithImplementation: 1,
      requirementsWithTargetedTests: 0,
      requirementsWithExecution: 0,
      requirementsWithGaps: 0,
      gapCount: 0
    };

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("requirementText must match requirements[0].requirementText");
  });

  it("rejects context-only evidence when a satisfied execution or visual axis is revalidated", () => {
    const report = generateVerificationReport({
      title: "Keep settings panel readable with regression coverage",
      description: "Adds settings-panel coverage.",
      taskText: "Acceptance criteria: keep the settings panel readable at 375px and add settings panel regression tests.",
      changedFiles: [
        { path: "src/settings/Panel.tsx", status: "modified", patch: "+ return <section>settings panel</section>" },
        { path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }
      ],
      checks: [
        { name: "Settings panel regression tests", status: "passed", summary: "Settings panel regression tests passed." },
        { name: "Browser QA settings panel", status: "passed", summary: "Status: passed. Settings panel visual viewport check passed." }
      ],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;
    const execution = requirement.proofAxes!.find((axis) => axis.subject === "execution")!;
    const visual = requirement.proofAxes!.find((axis) => axis.subject === "visual")!;
    report.evidenceIndex.push(
      { id: "ev_context_only_execution", kind: "check", label: "Payments regression tests", summary: "Status: passed. Payments regression tests passed.", locator: "ci://payments", confidence: 0.9 },
      { id: "ev_context_only_visual", kind: "check", label: "Browser QA billing card", summary: "Status: passed. Billing card visual viewport check passed.", locator: "ci://billing", confidence: 0.9 }
    );
    execution.evidenceRefs = ["ev_context_only_execution"];
    visual.evidenceRefs = ["ev_context_only_visual"];
    node.executionEvidenceRefs = ["ev_context_only_execution"];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("incompatible evidence");
  });

  it("rejects forged violated execution axes while accepting a linked failed workflow receipt", () => {
    const canonical = generateVerificationReport({
      title: "Configure validation workflow",
      description: "Updates validation CI.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must configure the validation CI workflow to use Node.js 22 and run npm test."
      ].join("\n"),
      taskSource: "issue",
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{
        name: "Validation CI",
        status: "failed",
        summary: "Status: failed. npm test failed.",
        workflowExecutionIdentity: {
          version: 1,
          kind: "workflow_execution_identity",
          workflowPath: ".github/workflows/validation.yml",
          workflowName: "Validation CI",
          workflowId: 101,
          runId: 202,
          runAttempt: 1,
          jobId: 303,
          jobName: "test",
          headSha: "a".repeat(40),
          checkEvidenceRef: "ev_4"
        }
      }],
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    });
    const executionAxis = canonical.requirements[1]!.proofAxes!.find((axis) => axis.subject === "execution")!;
    const executionNode = canonical.proofGraph.nodes[1]!;
    const failedRef = executionAxis.evidenceRefs[0]!;

    expect(executionAxis).toMatchObject({ state: "violated", collectionBasis: "failed_execution" });
    expect(validateVerificationReport(canonical, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const wrongStatus = structuredClone(canonical);
    wrongStatus.evidenceIndex.find((item) => item.id === failedRef)!.summary = "Status: passed. Settings panel tests passed.";
    expect(validateVerificationReport(wrongStatus, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const wrongBasis = structuredClone(canonical);
    wrongBasis.requirements[1]!.proofAxes!.find((axis) => axis.subject === "execution")!.collectionBasis = "passing_execution";
    expect(validateVerificationReport(wrongBasis, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const missingNodeRef = structuredClone(canonical);
    missingNodeRef.proofGraph.nodes[1]!.executionEvidenceRefs = [];
    expect(validateVerificationReport(missingNodeRef, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const missingAssociation = structuredClone(canonical);
    delete missingAssociation.proofGraph.failedCheckAssociations;
    expect(validateVerificationReport(missingAssociation, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const wrongAssociationState = structuredClone(canonical);
    wrongAssociationState.proofGraph.failedCheckAssociations!.find((association) =>
      association.requirementId === executionNode.requirementId && association.checkEvidenceRef === failedRef
    )!.state = "unknown";
    expect(validateVerificationReport(wrongAssociationState, { mode: "full" }).errors.join("\n"))
      .toContain("has an incompatible state and basis");
    expect(executionNode.executionEvidenceRefs).toEqual([failedRef]);
  });

  it("allows fully evidenced author-claim axes to remain partial when duplicate text and status match", () => {
    const report = generateVerificationReport({
      title: "Preserve URL params",
      description: "### Acceptance criteria\nThe widget should preserve search params.",
      taskText: "",
      changedFiles: [{
        path: "src/widget/url-params.ts",
        additions: 4,
        deletions: 1,
        status: "modified",
        patch: "+ preserveSearchParams(params)"
      }],
      checks: [{
        name: "Widget search params tests",
        status: "passed",
        summary: "Widget search params tests passed."
      }],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;

    expect(node.sourceQuality).toBe("author_claim");
    expect(node.requirementText).toBe(requirement.requirementText);
    expect(node.status).toBe("partial");
    expect(requirement.status).toBe("partial");
    expect(requirement.proofAxes?.find((axis) => axis.subject === "execution")?.state).toBe("incomplete");
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const statusMismatch = structuredClone(report);
    statusMismatch.proofGraph.nodes[0]!.status = "met";
    const statusResult = validateVerificationReport(statusMismatch, { mode: "full" });
    expect(statusResult.valid).toBe(false);
    expect(statusResult.errors.join("\n")).toContain("status must match proofGraph node status");

    const textMismatch = structuredClone(report);
    textMismatch.proofGraph.nodes[0]!.requirementText = "Preserve unrelated author claim";
    const textResult = validateVerificationReport(textMismatch, { mode: "full" });
    expect(textResult.valid).toBe(false);
    expect(textResult.errors.join("\n")).toContain("requirementText must match requirements[0].requirementText");
  });

  it("rejects a satisfied absence axis without matching authoritative GitHub inventory provenance", () => {
    const report = generateVerificationReport({
      title: "Keep implementation unchanged",
      description: "Changes documentation only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry guide" }],
      checks: [],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const axis = requirement.proofAxes![0]!;
    requirement.status = "met";
    requirement.gaps = [];
    axis.state = "satisfied";
    axis.collectionBasis = "complete_changed_file_inventory";
    report.proofGraph.nodes[0]!.status = "met";

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("head-anchored authoritative GitHub inventory");
  });

  it("rejects pasted provenance that retains a GitHub execution-suite receipt", () => {
    const report = generateVerificationReport({
      title: "Pasted checks replace GitHub checks",
      description: "Pasted test result.",
      taskText: "Acceptance criteria: run the focused test.",
      changedFiles: [{ path: "test/pasted.test.js", status: "added", patch: "+ test('pasted', () => {})" }],
      checks: [{ name: "pasted unit tests", status: "passed", summary: "passed" }],
      logs: [],
      sourceProvenance: {
        version: 1,
        origin: "pasted_evidence",
        changedFileInventory: { version: 1, completeness: "incomplete" },
        executionSuites: [{
          headSha: "a".repeat(40),
          status: "passed",
          executionSource: "GitHub Actions job: unit-tests",
          runner: "node_test",
          scope: "repository_discovery",
          testPaths: ["test/pasted.test.js"]
        }],
        evidenceCapturedAt: "2026-08-11T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "pasted_metadata" }
      }
    });

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("must be anchored to the GitHub snapshot head");
  });

  it.each([
    {
      name: "pasted provenance",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.source.provenance = {
          ...githubInventoryProvenance(),
          origin: "pasted_evidence",
          headSha: undefined,
          baseSha: undefined,
          inputFingerprint: { ...githubInventoryProvenance().inputFingerprint, coverage: "pasted_metadata" }
        };
      }
    },
    {
      name: "wrong inventory head",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.source.provenance!.changedFileInventory!.headSha = "d".repeat(40);
      }
    },
    {
      name: "capped inventory",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.limitations.push("GitHub changed-file evidence was capped at 120 files.");
      }
    },
    {
      name: "unavailable inventory",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.limitations.push("GitHub changed-file evidence unavailable: request timed out or network failed.");
      }
    }
  ])("rejects a forged satisfied absence axis with $name", ({ mutate }) => {
    const report = generateVerificationReport({
      title: "Keep implementation unchanged",
      description: "Changes documentation only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry guide" }],
      checks: [],
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    });
    mutate(report);

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("head-anchored authoritative GitHub inventory");
  });

  it("rejects malformed axes and disagreement between axes and requirement status", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const requirement = report.requirements[0];
    expect(requirement?.proofAxes?.length).toBeGreaterThan(0);
    requirement!.status = "met";
    report.proofGraph.nodes.find((node) => node.requirementId === requirement!.requirementId)!.status = "met";

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("status must agree with proofAxes");

    const satisfied = generateVerificationReport({
      title: "Document retry setup",
      description: "",
      taskText: "Acceptance criteria: document retry setup.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry setup" }],
      checks: [],
      logs: []
    });
    expect(satisfied.requirements[0]!.status).toBe("met");
    satisfied.requirements[0]!.status = "partial";
    const reverseResult = validateVerificationReport(satisfied, { mode: "full" });
    expect(reverseResult.valid).toBe(false);
    expect(reverseResult.errors.join("\n")).toContain("every satisfied authoritative axis requires met");
  });

  it("rejects supported execution claims without passing check or log evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.claims = [
      {
        id: "claim_1",
        text: "Tested password reset validation",
        evidenceRefs: report.evidenceIndex.filter((item) => item.kind === "test").map((item) => item.id),
        supported: true
      }
    ];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("execution claim cannot be supported without passing test or CI execution evidence");
  });

  it("rejects passed CI status without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.testing.ciStatus = "passed";
    report.evidenceIndex.push({
      id: "ev_security_check",
      kind: "check",
      label: "Socket Security coverage tests report",
      summary: "Status: passed. Socket Security coverage tests report - policy checks passed",
      confidence: 0.9
    });

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing.ciStatus cannot be passed without passing test, build, or CI execution evidence");
  });

  it("rejects passed CI status when passed appears only in unstructured summary text", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.testing.ciStatus = "passed";
    report.evidenceIndex.push({
      id: "ev_unit_tests_unknown",
      kind: "check",
      label: "unit tests: passed",
      summary: "unit tests: passed on a previous branch, but current status is unknown",
      confidence: 0.45
    });

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing.ciStatus cannot be passed without passing test, build, or CI execution evidence");
  });

  it("rejects proofGraph summaries that do not match their nodes", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.proofGraph.summary.requirementCount += 1;
    report.proofGraph.summary.requirementsWithGaps += 1;
    report.proofGraph.summary.gapCount += 1;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("proofGraph.summary.requirementCount must match proofGraph.nodes");
    expect(result.errors.join("\n")).toContain("proofGraph.summary.requirementsWithGaps must match proofGraph.nodes");
    expect(result.errors.join("\n")).toContain("proofGraph.summary.gapCount must match proofGraph.nodes");
  });

  it("rejects proofGraph nodes that do not map to report requirements", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.proofGraph.nodes[0].requirementId = "req_missing";

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].requirementId must match a report requirement");
  });

  it("rejects proofGraph nodes that omit or duplicate report requirements", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const duplicatedRequirementId = report.proofGraph.nodes[0].requirementId;
    const omittedRequirementId = report.proofGraph.nodes[1]?.requirementId;

    expect(omittedRequirementId).toBeTruthy();
    report.proofGraph.nodes[1].requirementId = duplicatedRequirementId;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(`proofGraph.nodes[1].requirementId duplicates proofGraph node for ${duplicatedRequirementId}`);
    expect(result.errors.join("\n")).toContain(`proofGraph.nodes must include requirement ${omittedRequirementId}`);
  });

  it("rejects proofGraph evidence refs assigned to incompatible proof classes", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const diffRef = report.evidenceIndex.find((item) => item.kind === "diff" || item.kind === "changed_file")?.id;
    const testRef = report.evidenceIndex.find((item) => item.kind === "test")?.id;
    const executionRef = report.evidenceIndex.find((item) => item.kind === "check" || item.kind === "log")?.id;

    expect(diffRef).toBeTruthy();
    expect(testRef).toBeTruthy();
    expect(executionRef).toBeTruthy();

    report.proofGraph.nodes[0].implementationEvidenceRefs = [testRef as string];
    report.proofGraph.nodes[0].targetedTestEvidenceRefs = [diffRef as string];
    report.proofGraph.nodes[0].executionEvidenceRefs = [diffRef as string];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].implementationEvidenceRefs cites incompatible evidence");
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].targetedTestEvidenceRefs cites incompatible evidence");
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].executionEvidenceRefs cites incompatible evidence");
  });

  it("rejects missing nested fields and unknown report properties", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    delete (report.summary as Partial<typeof report.summary>).oneLine;
    (report as unknown as Record<string, unknown>).rawDiff = "hidden raw diff";

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.oneLine is required");
    expect(result.errors.join("\n")).toContain("report.rawDiff is not allowed");
  });

  it("rejects non-object array items and invalid enum values", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.requirements = ["not a requirement"] as never;
    report.testing.ciStatus = "green" as never;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("requirements[0] must be an object");
    expect(result.errors.join("\n")).toContain("testing.ciStatus is invalid");
  });

  it("rejects oversized strings and arrays", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.summary.topRisks = Array.from({ length: 21 }, (_, index) => `risk ${index}`);
    report.evidenceIndex[0].summary = "x".repeat(3001);

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.topRisks must contain at most 20 items");
    expect(result.errors.join("\n")).toContain("evidenceIndex[0].summary must be at most 3000 characters");
  });

  it("rejects malformed nested objects without throwing", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    (report as unknown as Record<string, unknown>).testing = "failed";
    (report as unknown as Record<string, unknown>).reprompt = null;
    (report as unknown as Record<string, unknown>).evidenceIndex = [null];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing must be an object");
    expect(result.errors.join("\n")).toContain("reprompt must be an object");
    expect(result.errors.join("\n")).toContain("evidenceIndex[0] must be an object");
  });
});

function githubInventoryProvenance(): NonNullable<ReturnType<typeof generateVerificationReport>["source"]["provenance"]> {
  return {
    version: 1,
    origin: "github_snapshot",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    evidenceCapturedAt: "2026-08-11T00:00:00.000Z",
    changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
    inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
  };
}

const privateReceiptInputs = new WeakMap<object, PullRequestInput>();

function fullPrivateReceiptInput(headSha = "a".repeat(40)): PullRequestInput {
  const moduleSource = "export function repositoryName(value) { return String(value).toLowerCase(); }";
  const targetBlobSha = createHash("sha1")
    .update(`blob ${Buffer.byteLength(moduleSource, "utf8")}\0`)
    .update(moduleSource)
    .digest("hex");
  const testPath = "test/repository-name-regression.test.js";

  return {
    title: "Add repository name behavior and regression coverage",
    description: "Adds deterministic repository-name evidence.",
    taskText: [
      "Acceptance criteria:",
      "- Add repositoryName(value) formatting.",
      "- Add focused regression tests for repositoryName(value)."
    ].join("\n"),
    taskSource: "issue",
    changedFiles: [{
      path: testPath,
      status: "added",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        "+test('formats repository names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
      ].join("\n")
    }],
    checks: [
      { name: "unit-tests", status: "passed", summary: "Unit tests passed." },
      { name: "unrelated matrix", status: "failed", summary: "An unrelated matrix job failed." }
    ],
    logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "npm test passed." }],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha: "b".repeat(40),
      evidenceCapturedAt: "2026-08-17T00:00:00.000Z",
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    executionSuites: [{
      headSha,
      status: "passed",
      executionSource: "GitHub Actions job: unit-tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [testPath]
    }],
    resolvedHeadModules: [{
      version: 1,
      kind: "resolved_head_module",
      headSha,
      path: "src/repositories/name.js",
      blobSha: targetBlobSha,
      source: moduleSource
    }]
  };
}

function fullPrivateReceiptReport(mode: "off" | "receipt_v2" = "receipt_v2", headSha = "a".repeat(40)) {
  const input = fullPrivateReceiptInput(headSha);
  const previous = process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
  if (mode === "receipt_v2") process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = "receipt_v2";
  else delete process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
  try {
    const report = generateVerificationReportV2FromInput(input);
    privateReceiptInputs.set(report, input);
    return report;
  } finally {
    if (previous === undefined) delete process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
    else process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = previous;
  }
}

function v2Receipt(report: ReturnType<typeof fullPrivateReceiptReport>): TestRelationReceiptV2 {
  const receipt = report.proofGraph.privateReceiptBundleV2!.testRelationReceipts[0];
  if (!receipt || receipt.version !== 2) throw new Error("fixture must contain a v2 test relation receipt");
  return receipt;
}

function v2ReceiptValidationContext(report: ReturnType<typeof fullPrivateReceiptReport>): VerificationValidationContextV2 {
  const input = privateReceiptInputs.get(report);
  if (!input) throw new Error("fixture input is unavailable");
  const canonical = selectCanonicalRequirements({ kind: "selected_source", input });
  return createVerificationValidationContextV2(input, canonical);
}

function coherentlyRenameReceiptEvidence(
  report: ReturnType<typeof fullPrivateReceiptReport>,
  identity: "test" | "execution"
): void {
  const relation = v2Receipt(report);
  const execution = report.proofGraph.privateReceiptBundleV2!.executionBindingReceipts[0]!;
  const oldEvidenceRef = identity === "test" ? relation.testEvidenceRef : execution.executionEvidenceRef;
  const newEvidenceRef = identity === "test" ? "ev_forged_test" : "ev_forged_execution";
  replaceExactStringValues(report, oldEvidenceRef, newEvidenceRef);

  const headSha = report.source.provenance!.headSha!;
  execution.headBindingDigest = receiptHash(["v2", headSha, execution.testEvidenceRef, execution.executionEvidenceRef]);
  const oldExecutionId = execution.id;
  const newExecutionId = `execution_binding_${receiptHash([
    execution.requirementId,
    execution.testEvidenceRef,
    execution.executionEvidenceRef,
    execution.headBindingDigest
  ]).slice(0, 24)}`;
  replaceExactStringValues(report, oldExecutionId, newExecutionId);

  const targetRef = relation.targetMode === "changed_target"
    ? relation.implementationEvidenceRef!
    : relation.exactHeadTargetReceiptRef!;
  relation.id = `test_relation_v2_${receiptHash([
    relation.requirementId,
    relation.targetMode,
    targetRef,
    relation.testEvidenceRef,
    relation.subjectDigest,
    relation.importBindingDigest,
    relation.executionReceiptRef!
  ]).slice(0, 24)}`;
}

function replaceExactStringValues(value: unknown, from: string, to: string): void {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (item === from) (value as Record<string, unknown>)[key] = to;
    else replaceExactStringValues(item, from, to);
  }
}

function receiptHash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}
