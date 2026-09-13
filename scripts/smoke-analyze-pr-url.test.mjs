import { describe, expect, it, vi } from "vitest";
import { buildGeneralPrSemanticOperatorDiagnosticsV1 } from "../src/lib/general-pr-observation-telemetry.ts";
import {
  assertSummaryOnlyReport,
  assertReportExpectations,
  failedCheckAnnotationLocations,
  passingExecutionEvidence,
  evaluateReportQualityGate,
  analyzeTimingFromResponse,
  githubEvidenceTimingFromResponse,
  isValidGeneralPrAssessmentSummary,
  parseGitHubEvidenceTimingHeader,
  parseAnalyzeTimingHeader,
  runAnalyzePrSmoke,
  projectSmokeReportDetails,
  readOperatorSemanticDiagnostics,
  readOperatorTargetDiagnostics,
  readOrdinaryStaticSummary
} from "./smoke-analyze-pr-url.mjs";

describe("smoke-analyze-pr-url", () => {
  it("copies only strict ordinary static summary counts", () => {
    const summary = { version: 1, scope: "direct_union_membership_only", interpretation: "hypothesis", lookupScope: "changed_files_only", lookupIncomplete: false, predicates: [{ sourceKind: "pr_body", sourceOrdinal: 1, artifactCounts: { present: 1, absent: 0, unavailable: 0 } }] };
    expect(readOrdinaryStaticSummary(summary)).toEqual(summary);
    expect(readOrdinaryStaticSummary({ ...summary, aliasName: "PrivateName" })).toBeNull();
    expect(readOrdinaryStaticSummary({ ...summary, predicates: new Array(1) })).toBeNull();
    expect(readOrdinaryStaticSummary({ ...summary, predicates: [{ ...summary.predicates[0], artifactCounts: { present: 9, absent: 0, unavailable: 0 } }] })).toBeNull();
  });
  it("projects only the exact bounded documentation summary and returns a defensive copy", () => {
    const summary = documentationSummary();
    const projected = projectSmokeReportDetails({ ...reportFixture(), ordinaryDocumentationSummary: summary });
    expect(projected.ordinaryDocumentationSummary).toEqual(summary);
    summary.predicates[0].state = "contradicted";
    expect(projected.ordinaryDocumentationSummary.predicates[0].state).toBe("supported");
    for (const invalid of [null, { ...summary, rawSource: "PRIVATE_SOURCE" }, { ...summary, predicates: Array(9).fill(summary.predicates[0]) }, { ...summary, predicates: new Array(1) }, { ...summary, predicates: [{ ...summary.predicates[0], path: "PRIVATE_PATH.md" }] }, { ...summary, predicates: [{ ...summary.predicates[0], state: "met" }] }, { ...summary, predicates: [{ ...summary.predicates[0], sourceKind: new String("pr_body") }] }]) {
      expect(projectSmokeReportDetails({ ...reportFixture(), ordinaryDocumentationSummary: invalid }).ordinaryDocumentationSummary ?? null).toBeNull();
    }
  });
  it("accepts a safe saved documentation summary but rejects private or malformed additions", () => {
    const saved = summaryOnlyReportFixture(reportFixture());
    saved.ordinaryDocumentationSummary = documentationSummary();
    expect(() => assertSummaryOnlyReport(saved)).not.toThrow();
    saved.ordinaryDocumentationSummary.predicates[0].literal = "PRIVATE_LITERAL";
    expect(() => assertSummaryOnlyReport(saved)).toThrow("documentation");
  });
  it("rejects unknown nested operator target fields and requires target diagnostics", () => {
    const value = { version: 1, targetCount: 1, omittedTargetCount: 0, rejectedProviderProposalCount: 0, projectionOmissionCounts: { targetLimit: 0, sourceRefLimit: 0, changeClusterRefLimit: 0, evidenceRefLimit: 0, proposalLimit: 0 }, targets: [{ targetRef: "target_1", selectedSourceSpanRefs: ["span_1"], selectedChangeClusterRefs: ["cluster_1"], selectedEvidenceRefs: ["evidence_1"], sourceObligation: "author_claim_confirmation", currentAssessmentEligibility: "eligible", objectiveState: "semantic_candidate", admissionDisposition: "admitted", nonAdmissionReason: "not_applicable", proposedRelations: [{ kind: "scope_mapping", proposal: "plausibly_mapped", referenceRef: "cluster_1", validatorDisposition: "accepted", finalizerDisposition: "used" }], validator: { scope: "global_stage", claimState: "valid", evidenceState: "valid", claimInvalidReason: null, evidenceInvalidReason: null, capability: "semantic_relation_validation_only" }, currentAssessmentCeiling: "evidence_partial", missingProofReasons: ["author_claim_confirmation_required", "verified_objective_change_relation_not_evaluated", "targeted_test_requirement_not_evaluated", "exact_head_execution_not_evaluated"] }] };
    expect(readOperatorTargetDiagnostics(value)).toEqual(value);
    expect(() => readOperatorTargetDiagnostics(undefined)).toThrow("bounded operator target diagnostics");
    expect(readOperatorTargetDiagnostics(value, false)).toBeNull();
    const malformed = structuredClone(value);
    malformed.targets[0].selectedSourceSpanRefs = ["span_2"];
    expect(() => readOperatorTargetDiagnostics(malformed)).toThrow();
    malformed.targets[0].selectedSourceSpanRefs = ["span_1"];
    malformed.targets[0].admissionDisposition = "not_admitted";
    expect(() => readOperatorTargetDiagnostics(malformed)).toThrow();
    malformed.targets[0].admissionDisposition = "admitted";
    malformed.targets[0].validator.evidenceState = "invalid";
    expect(() => readOperatorTargetDiagnostics(malformed)).toThrow();
    malformed.targets[0].validator.evidenceState = "valid";
    malformed.targets[0].missingProofReasons = [];
    expect(() => readOperatorTargetDiagnostics(malformed)).toThrow();
    malformed.targets = new Array(1);
    expect(() => readOperatorTargetDiagnostics(malformed)).toThrow();
    for (const mutate of [
      (v) => { v.targets[0].validator.claimState = "invalid"; },
      (v) => { v.targets[0].validator.claimInvalidReason = "PRIVATE_PROVIDER_DETAIL"; },
      (v) => { v.targets[0].validator.evidenceInvalidReason = "PRIVATE_EVIDENCE_DETAIL"; },
      (v) => { v.targets[0].validator.claimState = "invalid"; v.targets[0].validator.claimInvalidReason = "span_binding_invalid"; v.targets[0].validator.evidenceState = "valid"; },
      (v) => { v.targets[0].validator.capability = "collection_only"; },
      (v) => { v.targets[0].proposedRelations[0].finalizerDisposition = "not_applicable"; },
      (v) => { v.targets[0].validator.evidenceState = "invalid"; v.targets[0].validator.evidenceInvalidReason = "root_shape_invalid"; v.targets[0].proposedRelations[0].validatorDisposition = "rejected"; v.targets[0].proposedRelations[0].finalizerDisposition = "not_used"; },
      (v) => { v.targets[0].admissionDisposition = "not_admitted"; v.targets[0].nonAdmissionReason = "finalizer_not_admitted"; v.targets[0].currentAssessmentCeiling = "not_assessable"; v.targets[0].missingProofReasons.push("candidate_not_admitted"); },
      (v) => { v.targets[0].currentAssessmentCeiling = "not_assessable"; },
      (v) => { v.targets[0].missingProofReasons = v.targets[0].missingProofReasons.filter((x) => x !== "author_claim_confirmation_required"); },
      (v) => { v.targets[0].missingProofReasons.push("candidate_not_admitted"); },
      (v) => { v.targets[0].sourceObligation = "unavailable"; },
      (v) => { v.targets[0].currentAssessmentEligibility = "unavailable"; },
      (v) => { v.targets[0].sourceObligation = "authoritative_requirement"; v.targets[0].currentAssessmentEligibility = "unavailable"; },
      (v) => { v.targets = []; v.targetCount = 0; v.omittedTargetCount = 100; v.projectionOmissionCounts.targetLimit = 100; }
    ]) { const candidate = structuredClone(value); mutate(candidate); expect(() => readOperatorTargetDiagnostics(candidate)).toThrow(); }
    const cross = structuredClone(value);
    cross.targets.push({ ...cross.targets[0], targetRef: "target_2", selectedSourceSpanRefs: ["span_2"] });
    cross.targetCount = 2;
    cross.targets[1].validator.capability = "collection_incomplete";
    expect(() => readOperatorTargetDiagnostics(cross)).toThrow();
    cross.targets[1].validator.capability = cross.targets[0].validator.capability;
    cross.targets[1].missingProofReasons.push("exact_head_subject_required");
    expect(() => readOperatorTargetDiagnostics(cross)).toThrow();
    cross.targets[1].missingProofReasons = [...cross.targets[0].missingProofReasons];
    cross.targets[1].currentAssessmentEligibility = "ineligible_provided_requirement";
    expect(() => readOperatorTargetDiagnostics(cross)).toThrow();
    const ownership = structuredClone(value);
    ownership.targets.push({ ...ownership.targets[0], targetRef: "target_2", selectedSourceSpanRefs: ["span_1"] }); ownership.targetCount = 2;
    expect(() => readOperatorTargetDiagnostics(ownership)).toThrow();
    ownership.targets[1].selectedSourceSpanRefs = ["span_2"];
    expect(() => readOperatorTargetDiagnostics(ownership)).toThrow();
    const encounter = structuredClone(value);
    encounter.targets[0].selectedSourceSpanRefs = ["span_2", "span_1"];
    expect(() => readOperatorTargetDiagnostics(encounter)).toThrow();
    expect(() => readOperatorTargetDiagnostics({ ...value, rawProviderOutput: "secret" })).toThrow();
    expect(() => readOperatorTargetDiagnostics({ ...value, targets: [{ ...value.targets[0], validator: { ...value.targets[0].validator, sourceText: "secret" } }] })).toThrow();
  });
  it("accepts the deployed diagnostic builder and rejects unknown reason fields", () => {
    const diagnostic = buildGeneralPrSemanticOperatorDiagnosticsV1(null);
    expect(readOperatorSemanticDiagnostics(diagnostic)).toEqual(diagnostic);
    for (const reason of ["root_shape_invalid", "span_decision_invalid", "span_binding_invalid", "role_ceiling_violation", "output_limit_exceeded"]) {
      expect(readOperatorSemanticDiagnostics({ ...diagnostic, claimInvalidReason: reason }).claimInvalidReason).toBe(reason);
    }
    expect(readOperatorSemanticDiagnostics({ ...diagnostic, evidenceState: "invalid", evidenceInvalidReason: "reference_binding_invalid" }).evidenceInvalidReason).toBe("reference_binding_invalid");
    expect(readOperatorSemanticDiagnostics({ ...diagnostic, freshnessFailure: { phase: "after_evidence", state: "stale", reason: "seed_changed" } }).freshnessFailure).toEqual({ phase: "after_evidence", state: "stale", reason: "seed_changed" });
    expect(() => readOperatorSemanticDiagnostics({ ...diagnostic, freshnessFailure: { phase: "after_evidence", state: "stale", reason: "PRIVATE_REASON" } })).toThrow();
    expect(() => readOperatorSemanticDiagnostics({ ...diagnostic, evidenceState: "invalid", evidenceInvalidReason: null })).toThrow("valid operator staged diagnostic");
    expect(() => readOperatorSemanticDiagnostics({ ...diagnostic, evidenceState: "valid", evidenceInvalidReason: "reference_binding_invalid" })).toThrow("valid operator staged diagnostic");
    expect(() => readOperatorSemanticDiagnostics({ ...diagnostic, claimInvalidReason: "private response" })).toThrow();
    expect(() => readOperatorSemanticDiagnostics({ ...diagnostic, rawProviderResponse: "private" })).toThrow();
  });

  it("accepts optional closed provider failure metadata but rejects raw provider fields", () => {
    const diagnostic = buildGeneralPrSemanticOperatorDiagnosticsV1(null);
    expect(readOperatorSemanticDiagnostics({
      ...diagnostic,
      providerFailure: { phase: "evidence_linking", category: "rate_limited", httpStatus: 429 }
    })).toMatchObject({ providerFailure: { phase: "evidence_linking", category: "rate_limited", httpStatus: 429 } });
    expect(() => readOperatorSemanticDiagnostics({
      ...diagnostic,
      providerFailure: { phase: "evidence_linking", category: "rate_limited", httpStatus: 429, message: "PROVIDER_SECRET" }
    })).toThrow();
  });

  it("preserves PR findings and evidence links without retaining raw evidence or secrets", () => {
    const report = reportFixture();
    report.requirements[0].reviewerNote = "opaque-ops-value and github_pat_1234567890123456789012345";
    report.generalPrAssessment = { targets: [{ claimRole: "test_claim", conclusion: "evidence_partial", sourceBindingRef: "PRIVATE_BINDING", sourceSpanRefs: ["PRIVATE_SPAN"], evidenceRefs: ["ev_2"], reasonCodes: ["target_relation_unresolved"] }] };
    report.privateReceipt = { raw: "PRIVATE_RECEIPT" };
    const detail = projectSmokeReportDetails(report, ["opaque-ops-value"]);
    expect(detail.requirements[0].requirementText).toBe("add invoice export and tests");
    expect(detail.requirements[0].evidenceRefs).toEqual(["ev_1", "ev_2"]);
    expect(detail.evidence[1]).toMatchObject({ id: "ev_2", kind: "check", label: "Socket Security" });
    expect(detail.targets[0].reasonCodes).toEqual(["target_relation_unresolved"]);
    expect(JSON.stringify(detail)).not.toMatch(/opaque-ops-value|github_pat_|PRIVATE_|Patch excerpt|export function|Add tests and provide/);
  });

  it("keeps the analyzed details when later summary storage fails", async () => {
    const diagnostic = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: reportFixture(), operatorDiagnostics: buildGeneralPrSemanticOperatorDiagnosticsV1(null) }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "secret-storage-error" }), { status: 503, headers: { "cache-control": "no-store" } }));
    await expect(runAnalyzePrSmoke({ baseUrl: "https://agentproof.example", prUrl: "https://github.com/org/repo/pull/1", operatorDiagnosticsToken: "opaque-ops-value", onDiagnostic: diagnostic, fetchImpl: fetchMock })).rejects.toThrow();
    expect(diagnostic).toHaveBeenCalledOnce();
    expect(diagnostic.mock.calls[0][0]).toMatchObject({ status: "failed", stage: "summary_save", httpStatus: 503, report: { requirements: [expect.objectContaining({ requirementId: "req_1" })] }, operator: { claimInvalidReason: null } });
    expect(JSON.stringify(diagnostic.mock.calls)).not.toMatch(/secret-storage-error|opaque-ops-value|Patch excerpt/);
  });
  it("requests and returns only closed staged operator diagnostics", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        report: fullReport,
        operatorDiagnostics: {
          claimState: "valid",
          evidenceState: "not_run",
          sourceCoverage: "sampled",
          evidenceCoverage: null,
          providerCallCount: 1,
          selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" },
          semanticPackageFailureReasons: [],
          omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 1 }
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      operatorDiagnosticsToken: "ops-secret-value",
      fetchImpl: fetchMock
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://agentproof.example/api/analyze", expect.objectContaining({
      headers: {
        "content-type": "application/json",
        "x-agentproof-observation-diagnostics": "semantic-boundary-v1",
        "x-agentproof-ops-token": "ops-secret-value"
      }
    }));
    expect(result.operatorSemanticDiagnostics).toEqual({
      claimState: "valid",
      evidenceState: "not_run",
      sourceCoverage: "sampled",
      evidenceCoverage: null,
      providerCallCount: 1,
      selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" },
      semanticPackageFailureReasons: [],
      omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 1 }
    });
    expect(JSON.stringify(result.operatorSemanticDiagnostics)).not.toMatch(/token|path|prompt|output|hash|text/i);
  });

  it("rejects operator diagnostics with private fields, invalid stage values, or raw call counts", async () => {
    for (const operatorDiagnostics of [
      { claimState: "valid", evidenceState: "not_run", sourceCoverage: "sampled", evidenceCoverage: null, providerCallCount: 1, selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 }, sourceText: "private" },
      { claimState: "selected", evidenceState: "not_run", sourceCoverage: "sampled", evidenceCoverage: null, providerCallCount: 1, selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } },
      { claimState: "valid", evidenceState: "not_run", sourceCoverage: "sampled", evidenceCoverage: null, providerCallCount: 3, selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } },
      { claimState: "valid", evidenceState: "not_run", sourceCoverage: "sampled", evidenceCoverage: null, providerCallCount: 1, selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" }, semanticPackageFailureReasons: ["private failure payload"], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } }
    ]) {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ report: reportFixture(), operatorDiagnostics }));
      await expect(runAnalyzePrSmoke({
        baseUrl: "https://agentproof.example",
        prUrl: "https://github.com/org/repo/pull/1",
        operatorDiagnosticsToken: "ops-secret-value",
        fetchImpl: fetchMock
      })).rejects.toThrow("valid operator staged diagnostic");
    }
  });

  it("accepts only the closed 3_plus provider-call safety bucket", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const operatorDiagnostics = { claimState: "valid", evidenceState: "valid", sourceCoverage: "complete", evidenceCoverage: "complete", providerCallCount: "3_plus", selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "1_16" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport, operatorDiagnostics }))
      .mockResolvedValueOnce(jsonResponse({ id: "saved_123", url: "https://agentproof.example/reports/saved_123", expiresAt: "2026-06-27T00:00:00.000Z", privacy: "summary-only", durability: "short-lived-in-memory", durabilityWarning: "Saved reports are short-lived." }))
      .mockResolvedValueOnce(jsonResponse({ report: savedReport, privacy: "summary-only", durability: "short-lived-in-memory", durabilityWarning: "Saved reports are short-lived." }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    await expect(runAnalyzePrSmoke({ baseUrl: "https://agentproof.example", prUrl: "https://github.com/org/repo/pull/1", operatorDiagnosticsToken: "ops-secret-value", fetchImpl: fetchMock }))
      .resolves.toEqual(expect.objectContaining({ operatorSemanticDiagnostics: operatorDiagnostics }));
  });

  it.each([
    ["valid claim with no evidence packet", { claimState: "valid", evidenceState: "not_run", sourceCoverage: "complete", evidenceCoverage: null, providerCallCount: 1, selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 1 } }],
    ["valid two-stage result", { claimState: "valid", evidenceState: "valid", sourceCoverage: "complete", evidenceCoverage: "complete", providerCallCount: 2, selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "1_16" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } }],
    ["evidence timeout with claims preserved", { claimState: "valid", evidenceState: "timeout", sourceCoverage: "sampled", evidenceCoverage: "sampled", providerCallCount: 2, selectedCountBuckets: { sourceSpans: "5_8", evidenceCandidates: "17_32" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } }],
    ["selection unavailable", { claimState: "unavailable", evidenceState: "not_run", sourceCoverage: null, evidenceCoverage: null, providerCallCount: 0, selectedCountBuckets: { sourceSpans: "0", evidenceCandidates: "0" }, semanticPackageFailureReasons: [], omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 } }]
  ])("parses closed %s diagnostics", async (_name, operatorDiagnostics) => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport, operatorDiagnostics }))
      .mockResolvedValueOnce(jsonResponse({ id: "saved_123", url: "https://agentproof.example/reports/saved_123", expiresAt: "2026-06-27T00:00:00.000Z", privacy: "summary-only", durability: "short-lived-in-memory", durabilityWarning: "Saved reports are short-lived." }))
      .mockResolvedValueOnce(jsonResponse({ report: savedReport, privacy: "summary-only", durability: "short-lived-in-memory", durabilityWarning: "Saved reports are short-lived." }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      operatorDiagnosticsToken: "ops-secret-value",
      fetchImpl: fetchMock
    })).resolves.toEqual(expect.objectContaining({ operatorSemanticDiagnostics: operatorDiagnostics }));
  });

  it("verifies analyze metadata and summary-only saved report privacy", async () => {
    const fullReport = reportFixture();
    fullReport.generalPrAssessmentSummary = assessmentSummary();
    fullReport.ordinaryDocumentationSummary = documentationSummary();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      taskText: "Acceptance criteria: add invoice export and tests.",
      githubToken: "github_pat_secret_should_not_leak_123",
      requireGeneralPrAssessmentSummary: true,
      fetchImpl: fetchMock
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 200,
      savedReportPrivacy: "summary-only",
      savedReportDurability: "short-lived-in-memory",
      savedReportDurabilityWarning: true,
      savedEvidenceCount: 0,
      savedClaimCount: 0,
      savedRepromptOmitted: true,
      savedEvidenceRefsCleared: true,
      savedReportDeleted: true,
      requirementStatusCounts: { partial: 1 },
      requirementEvidenceStatusCounts: { partial: 1 },
      generalPrAssessmentSummary: assessmentSummary(),
      ordinaryDocumentationSummary: documentationSummary()
    }));
    expect(result.analyzeTiming).toEqual({
      input: 3,
      evidence: 120,
      report: 14,
      validation: 2,
      total: 139
    });
    expect(result.githubEvidenceTiming).toEqual({
      github_pr: 20,
      github_files: 40,
      github_checks: 50,
      github_statuses: 10,
      github_annotations: 0,
      github_jobs: 0
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://agentproof.example/api/reports", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://agentproof.example/api/reports/saved_123");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "https://agentproof.example/api/reports/saved_123", { method: "DELETE" });
  });

  it("rejects a live external PR result when advisory assessment is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ report: reportFixture() }));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      requireGeneralPrAssessmentSummary: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("General PR assessment summary was unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a live external PR result when its assessment summary is not a closed target-free projection", async () => {
    const report = reportFixture();
    report.generalPrAssessmentSummary = {
      ...assessmentSummary(),
      sourceState: "unbounded_source_state",
      targets: [{ sourceText: "private source text" }]
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ report }));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      requireGeneralPrAssessmentSummary: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("General PR assessment summary was unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("requires the assessment conclusion to match its aggregate count states", () => {
    expect(isValidGeneralPrAssessmentSummary(assessmentSummary())).toBe(true);
    expect(isValidGeneralPrAssessmentSummary({
      ...assessmentSummary(),
      overallConclusion: "mixed_evidence"
    })).toBe(false);

    const allBlocked = {
      ...assessmentSummary(),
      overallConclusion: "collection_blocked",
      counts: {
        evidence_supported: 0,
        evidence_partial: 0,
        not_demonstrated: 0,
        contradicted: 0,
        blocked: 2,
        not_assessable: 0
      }
    };
    expect(isValidGeneralPrAssessmentSummary(allBlocked)).toBe(true);
    expect(isValidGeneralPrAssessmentSummary({ ...allBlocked, overallConclusion: "evidence_partial" })).toBe(false);

    const observations = { version: 1, inventory: { state: "complete", changedArtifacts: 2, changedTestCandidates: 1 }, links: { state: "proposed", linkedObjectives: 1, supports: 1, tests: 0, implements: 0, contradicts: 0 }, coverage: { source: "complete", evidence: "sampled" } };
    expect(isValidGeneralPrAssessmentSummary({ ...assessmentSummary(), observations })).toBe(true);
    expect(isValidGeneralPrAssessmentSummary({ ...assessmentSummary(), observations: { ...observations, links: { ...observations.links, tests: -1 } } })).toBe(false);
    const twoTargets = { ...assessmentSummary(), counts: { ...assessmentSummary().counts, evidence_partial: 2 } };
    expect(isValidGeneralPrAssessmentSummary({ ...twoTargets, observations: { ...observations, links: { ...observations.links, linkedObjectives: 2 } } })).toBe(false);
    expect(isValidGeneralPrAssessmentSummary({ ...assessmentSummary(), observations: { ...observations, links: { ...observations.links, supports: 2, tests: -1 } } })).toBe(false);
    expect(isValidGeneralPrAssessmentSummary({ ...assessmentSummary(), observations: { ...observations, inventory: { ...observations.inventory, state: "current" } } })).toBe(false);
    expect(isValidGeneralPrAssessmentSummary({ ...assessmentSummary(), observations: { ...observations, inventory: { ...observations.inventory, changedArtifacts: Number.MAX_SAFE_INTEGER + 1 } } })).toBe(false);
    expect(isValidGeneralPrAssessmentSummary({ ...assessmentSummary(), observations: { ...observations, coverage: { ...observations.coverage, privateHash: "private" } } })).toBe(false);

    const supported = {
      ...assessmentSummary(),
      overallConclusion: "evidence_supports_stated_change",
      counts: {
        evidence_supported: 1,
        evidence_partial: 0,
        not_demonstrated: 0,
        contradicted: 0,
        blocked: 0,
        not_assessable: 0
      }
    };
    expect(isValidGeneralPrAssessmentSummary(supported)).toBe(true);
    expect(isValidGeneralPrAssessmentSummary({
      ...supported,
      overallConclusion: "attention_required",
      counts: { ...supported.counts, evidence_supported: 0, contradicted: 1 }
    })).toBe(true);
  });

  it("accepts durable Supabase saved-report metadata while keeping summary-only checks", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "summary-only-supabase",
        durabilityWarning: "Saved reports are summary-only and durable."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "summary-only-supabase",
        durabilityWarning: "Saved reports are summary-only and durable."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      taskText: "Acceptance criteria: add invoice export and tests.",
      fetchImpl: fetchMock
    });

    expect(result.savedReportDurability).toBe("summary-only-supabase");
    expect(result.savedReportPrivacy).toBe("summary-only");
    expect(result.savedEvidenceCount).toBe(0);
    expect(result.savedClaimCount).toBe(0);
    expect(result.savedEvidenceRefsCleared).toBe(true);
  });

  it("rejects saved reports that retain raw evidence or re-prompt data", () => {
    const fullReport = reportFixture();

    expect(() => assertSummaryOnlyReport(fullReport, {
      originalReprompt: fullReport.reprompt.prompt,
      githubToken: "github_pat_secret_should_not_leak_123"
    })).toThrow("Saved report retained raw evidenceIndex items");
  });

  it("rejects saved reports that retain a private general PR assessment target", () => {
    const savedReport = summaryOnlyReportFixture(reportFixture());
    savedReport.generalPrAssessmentSummary = {
      ...assessmentSummary(),
      targets: [{ targetId: "gpa_private_target" }]
    };

    expect(() => assertSummaryOnlyReport(savedReport))
      .toThrow("Saved report retained private general PR assessment data");
  });

  it("rejects a live report when its GitHub source anchor differs from the frozen sample", async () => {
    const report = reportFixture();
    report.source.provenance = {
      origin: "github_snapshot",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40)
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ report }));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      expectedSourceAnchor: {
        headSha: "c".repeat(40),
        baseSha: "b".repeat(40)
      },
      fetchImpl: fetchMock
    })).rejects.toThrow("Analyze report source anchor did not match the frozen external PR sample");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows URL-only external PR evaluation to have no extracted requirements", () => {
    const report = reportFixture();
    report.requirements = [];
    report.claims = [];
    const savedReport = summaryOnlyReportFixture(report);

    const strictResult = evaluateReportQualityGate(report, { savedReport });
    const urlOnlyResult = evaluateReportQualityGate(report, {
      savedReport,
      requireRequirementFindings: false
    });

    expect(strictResult.checks.find((check) => check.id === "requirements_present")).toEqual(expect.objectContaining({
      ok: false
    }));
    expect(urlOnlyResult).toEqual(expect.objectContaining({ ok: true }));
    expect(urlOnlyResult.checks.find((check) => check.id === "requirements_present")).toEqual(expect.objectContaining({
      ok: true,
      detail: "No acceptance contract is required for this evaluation; zero requirement findings are allowed."
    }));
  });

  it("parses only bounded analyze timing metrics", () => {
    expect(parseAnalyzeTimingHeader("ap_input;dur=1, ap_evidence;dur=23, ap_report;dur=4, ap_validation;dur=2, ap_total;dur=30")).toEqual({
      input: 1,
      evidence: 23,
      report: 4,
      validation: 2,
      total: 30
    });

    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_total;dur=2"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1;desc=github_pat_secret_should_not_leak, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_input;dur=2, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_input;dur=2, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4"))
      .toThrow("Analyze timing header contained duplicate phases");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_foo;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, src/private/file.ts;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1.5, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=-1, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1e3, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=9007199254740992, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was missing a required phase");

    try {
      parseAnalyzeTimingHeader("ap_input;dur=1;desc=src/private/file.ts?token=sk-secret, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5");
    } catch (error) {
      expect(error.message).not.toContain("src/private/file.ts");
      expect(error.message).not.toContain("sk-secret");
    }
  });

  it("parses analyze timing from either timing header without exposing raw header values", () => {
    const header = "ap_input;dur=1, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5";

    expect(analyzeTimingFromResponse(new Response("{}", {
      headers: { "x-agentproof-timing": header }
    }))).toEqual({ input: 1, evidence: 2, report: 3, validation: 4, total: 5 });
    expect(analyzeTimingFromResponse(new Response("{}", {
      headers: { "server-timing": header }
    }))).toEqual({ input: 1, evidence: 2, report: 3, validation: 4, total: 5 });
    expect(analyzeTimingFromResponse(new Response("{}", {
      headers: {
        "x-agentproof-timing": header,
        "server-timing": header
      }
    }))).toEqual({ input: 1, evidence: 2, report: 3, validation: 4, total: 5 });

    expect(() => analyzeTimingFromResponse(new Response("{}", {
      headers: {
        "x-agentproof-timing": header,
        "server-timing": "ap_input;dur=1;desc=github_pat_secret_should_not_leak, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"
      }
    }))).toThrow("Analyze timing headers disagreed");
    try {
      analyzeTimingFromResponse(new Response("{}", {
        headers: {
          "x-agentproof-timing": header,
          "server-timing": "ap_input;dur=1;desc=github_pat_secret_should_not_leak, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"
        }
      }));
    } catch (error) {
      expect(error.message).not.toContain("github_pat_secret_should_not_leak");
    }

    expect(() => analyzeTimingFromResponse(new Response("{}")))
      .toThrow("Analyze response did not include timing evidence");
  });

  it("parses partial GitHub evidence timing without requiring unavailable subphases", () => {
    expect(parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12, ap_github_files;dur=34, ap_github_checks;dur=56")).toEqual({
      github_pr: 12,
      github_files: 34,
      github_checks: 56
    });

    expect(githubEvidenceTimingFromResponse(new Response("{}", {
      headers: {
        "x-agentproof-evidence-timing": "ap_github_pr;dur=12, ap_github_files;dur=34"
      }
    }))).toEqual({
      github_pr: 12,
      github_files: 34
    });

    expect(() => parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12, ap_github_foo;dur=34"))
      .toThrow("GitHub evidence timing header was malformed");
    expect(() => parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12;desc=src/private/file.ts?token=sk-secret"))
      .toThrow("GitHub evidence timing header was malformed");
    expect(() => parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12, ap_github_pr;dur=34"))
      .toThrow("GitHub evidence timing header contained duplicate phases");
    expect(() => githubEvidenceTimingFromResponse(new Response("{}")))
      .toThrow("Analyze response did not include GitHub evidence timing");
  });

  it("preserves analyze API errors when error responses have partial timing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ error: "bounded github access error" }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-agentproof-timing": "ap_input;dur=1, ap_total;dur=2"
        }
      }
    ));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      fetchImpl: fetchMock
    })).rejects.toThrow("bounded github access error");
  });

  it("rejects saved reports that keep evidence refs after evidenceIndex is stripped", () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    savedReport.requirements[0].evidenceRefs = ["ev_1"];

    expect(() => assertSummaryOnlyReport(savedReport)).toThrow("Saved report retained evidenceRefs");
  });

  it("rejects saved reports that retain failed check annotation locations", () => {
    const fullReport = reportFixture();
    fullReport.evidenceIndex.push({
      id: "ev_failed_annotation",
      kind: "check",
      label: "unit tests",
      summary:
        "Status: failed. unit tests - Vitest failed. Check annotations: failure at src/app/api/analyze/route.test.ts:42. Raw annotation messages and raw annotation details omitted.",
      confidence: 0.9
    });
    const savedReport = summaryOnlyReportFixture(fullReport);
    savedReport.limitations.push("Debug note: src/app/api/analyze/route.test.ts:42");

    expect(failedCheckAnnotationLocations(fullReport)).toEqual(["src/app/api/analyze/route.test.ts:42"]);
    expect(() => assertSummaryOnlyReport(savedReport, {
      failedCheckLocations: failedCheckAnnotationLocations(fullReport)
    })).toThrow("Saved report retained failed check annotation location");
  });

  it("blocks GitHub tokens from remote production-like smoke URLs unless explicitly allowed", async () => {
    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof-pearl.vercel.app",
      prUrl: "https://github.com/org/repo/pull/1",
      githubToken: "github_pat_secret_should_not_leak_123",
      fetchImpl: vi.fn()
    })).rejects.toThrow("Forwarding a GitHub token to a remote AgentProof base URL requires");
  });

  it("reports explicit production token forwarding when allowed", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof-pearl.vercel.app/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof-pearl.vercel.app",
      prUrl: "https://github.com/org/repo/pull/1",
      githubToken: "github_pat_secret_should_not_leak_123",
      allowProductionGithubToken: true,
      fetchImpl: fetchMock
    });

    expect(result.githubTokenForwarded).toBe(true);
    expect(result.productionTokenForwarded).toBe(true);
  });

  it("rejects passed CI smoke reports without status-prefixed passing execution evidence", async () => {
    const report = reportFixture();
    report.testing.ciStatus = "passed";
    report.evidenceIndex = [
      {
        id: "ev_1",
        kind: "check",
        label: "unit tests: passed",
        summary: "unit tests: passed on a previous branch, but current status is unknown",
        confidence: 0.45
      }
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ report }));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      fetchImpl: fetchMock
    })).rejects.toThrow("Report claimed passed CI without passing check/log evidence");
  });

  it("treats saved-report cleanup as best-effort after summary-only validation", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: false }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      fetchImpl: fetchMock
    });

    expect(result.savedReportDeleted).toBe(false);
    expect(result.savedReportDeleteWarning).toContain("best-effort");
    expect(result.savedEvidenceCount).toBe(0);
    expect(result.savedClaimCount).toBe(0);
    expect(result.savedRepromptOmitted).toBe(true);
    expect(result.savedEvidenceRefsCleared).toBe(true);
  });

  it("does not count preview or security checks as passing execution evidence even with test words", () => {
    const report = reportFixture();
    report.evidenceIndex = [
      {
        id: "ev_preview",
        kind: "check",
        label: "Vercel Preview tests",
        summary: "Status: passed. Vercel Preview tests completed",
        confidence: 0.9
      },
      {
        id: "ev_security",
        kind: "check",
        label: "Socket Security coverage tests report",
        summary: "Status: passed. security coverage tests completed",
        confidence: 0.9
      },
      {
        id: "ev_generic_preview",
        kind: "check",
        label: "CI",
        summary: "Status: passed. Vercel Preview tests passed after deployment",
        confidence: 0.9
      },
      {
        id: "ev_security_command",
        kind: "check",
        label: "CI",
        summary: "Status: passed. Security report annotation: pnpm test src/app/api/analyze/route.test.ts passed",
        confidence: 0.9
      },
      {
        id: "ev_actual_step",
        kind: "log",
        label: "GitHub Actions job: CI",
        summary: "Status: passed. GitHub Actions job CI: passed. Steps: pnpm test: passed",
        confidence: 0.75
      },
      {
        id: "ev_unit",
        kind: "check",
        label: "unit tests",
        summary: "Status: passed. unit tests completed",
        confidence: 0.9
      }
    ];

    expect(passingExecutionEvidence(report).map((item) => item.id)).toEqual(["ev_actual_step", "ev_unit"]);
  });

  it("keeps visual requirements unverified without browser or screenshot evidence", () => {
    const report = reportFixture();
    report.requirements = [
      {
        requirementId: "req_visual",
        requirementText: "improve mobile layout without overlapping text/buttons",
        status: "partial",
        evidenceRefs: ["ev_1"],
        gaps: ["No browser, screenshot, or visual QA artifact verifies this UX criterion."],
        reviewerNote: "Visual evidence was not present.",
        confidence: 0.55
      }
    ];

    expect(assertReportExpectations(report, { requireVisualUnverified: true }).checks).toEqual([
      { name: "visualRequirementsUnverifiedWithoutVisualEvidence", expected: true }
    ]);

    report.requirements[0].status = "met";
    expect(() => assertReportExpectations(report, { requireVisualUnverified: true }))
      .toThrow("Visual/mobile requirements were marked met without browser, screenshot, or visual QA evidence");
  });

  it("requires the declared source context before accepting smoke expectations", () => {
    const report = {
      ...reportFixture(),
      analysisContext: "linked_issue"
    };

    expect(assertReportExpectations(report, {
      analysisContext: "linked_issue",
      minRequirementCount: 1
    }).checks).toEqual([
      { name: "analysisContext", expected: "linked_issue" },
      { name: "minRequirementCount", expected: 1 }
    ]);

    const fallbackReport = {
      ...report,
      analysisContext: "unlinked_pr"
    };

    expect(assertReportExpectations(fallbackReport, {
      analysisContext: "unlinked_pr",
      minRequirementCount: 1
    }).checks).toEqual([
      { name: "analysisContext", expected: "unlinked_pr" },
      { name: "minRequirementCount", expected: 1 }
    ]);

    expect(() => assertReportExpectations(fallbackReport, {
      analysisContext: "linked_issue",
      minRequirementCount: 1
    })).toThrow("Expected analysisContext linked_issue, received unlinked_pr.");
  });
});

function jsonResponse(payload, status = 200) {
  if (payload?.operatorDiagnostics && payload.operatorTargetDiagnostics === undefined) payload.operatorTargetDiagnostics = { version: 1, targetCount: 0, omittedTargetCount: 0, rejectedProviderProposalCount: 0, projectionOmissionCounts: { targetLimit: 0, sourceRefLimit: 0, changeClusterRefLimit: 0, evidenceRefLimit: 0, proposalLimit: 0 }, targets: [] };
  const headers = {
    "content-type": "application/json",
    "cache-control": "private, no-store"
  };

  if (payload && typeof payload === "object" && payload.report) {
    headers["x-agentproof-timing"] = "ap_input;dur=3, ap_evidence;dur=120, ap_report;dur=14, ap_validation;dur=2, ap_total;dur=139";
    headers["x-agentproof-evidence-timing"] = "ap_github_pr;dur=20, ap_github_files;dur=40, ap_github_checks;dur=50, ap_github_statuses;dur=10, ap_github_annotations;dur=0, ap_github_jobs;dur=0";
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers
  });
}

function documentationSummary() {
  return { version: 1, scope: "literal_presence_only", predicates: [{ sourceKind: "pr_body", sourceOrdinal: 1, legacyRequirementId: "req_1", state: "supported" }] };
}

function reportFixture() {
  return {
    analysisId: "ap_test",
    createdAt: "2026-06-26T00:00:00.000Z",
    source: {
      title: "Add invoice export",
      url: "https://github.com/org/repo/pull/1"
    },
    summary: {
      oneLine: "Evidence looks mostly aligned.",
      confidence: 0.82,
      priority: "medium",
      evidenceCoverage: 74,
      topRisks: ["Some requirements have only partial evidence."]
    },
    requirements: [
      {
        requirementId: "req_1",
        requirementText: "add invoice export and tests",
        status: "partial",
        evidenceRefs: ["ev_1", "ev_2"],
        gaps: ["Review exact test command."],
        reviewerNote: "Evidence is partial.",
        confidence: 0.62
      }
    ],
    claims: [
      {
        id: "claim_1",
        text: "Implemented invoice export",
        evidenceRefs: ["ev_1"],
        supported: true
      }
    ],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: [],
      evidenceRefs: []
    },
    testing: {
      ciStatus: "unknown",
      lintStatus: "unknown",
      typecheckStatus: "unknown",
      missingTests: [
        {
          path: "src/billing/invoiceExport.ts",
          why: "No passing test command was provided.",
          evidenceRefs: ["ev_1", "ev_2"],
          provenance: [
            {
              evidenceRef: "ev_1",
              sourceType: "diff",
              locator: "src/billing/invoiceExport.ts",
              confidence: 0.8,
              evidenceText: "src/billing/invoiceExport.ts changed without a passing related test command."
            }
          ]
        }
      ]
    },
    reviewPriority: [
      {
        path: "src/billing/invoiceExport.ts",
        reason: "Implementation needs test proof.",
        priority: "medium",
        evidenceRefs: ["ev_1", "ev_2"]
      }
    ],
    reprompt: {
      targetAgent: "codex",
      prompt: "Add tests and provide the exact command output."
    },
    evidenceIndex: [
      {
        id: "ev_1",
        kind: "diff",
        label: "src/billing/invoiceExport.ts",
        summary: "Patch excerpt: + export function invoiceExport() {}",
        confidence: 0.8
      },
      {
        id: "ev_2",
        kind: "check",
        label: "Socket Security",
        summary: "Socket Security: passed",
        confidence: 0.9
      }
    ],
    limitations: ["No CI or test logs were available."]
  };
}

function assessmentSummary() {
  return {
    version: 1,
    mode: "ordinary_pr",
    sourceState: "pr_author_claim",
    overallConclusion: "evidence_partial",
    counts: {
      evidence_supported: 0,
      evidence_partial: 1,
      not_demonstrated: 0,
      contradicted: 0,
      blocked: 0,
      not_assessable: 0
    },
    reasonCodes: ["verified_relation_missing", "author_claim_requires_confirmation"]
  };
}

function summaryOnlyReportFixture(fullReport) {
  return {
    ...fullReport,
    requirements: fullReport.requirements.map((requirement) => ({
      ...requirement,
      evidenceRefs: []
    })),
    claims: [],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: []
    },
    testing: {
      ...fullReport.testing,
      missingTests: fullReport.testing.missingTests.map(({ provenance: _provenance, ...missingTest }) => ({
        ...missingTest,
        evidenceRefs: []
      }))
    },
    reviewPriority: fullReport.reviewPriority.map(({ evidenceRefs: _evidenceRefs, ...item }) => item),
    reprompt: {
      targetAgent: "codex",
      prompt: "Shared summary links omit re-prompt text. Open the original report owner session or copy the full report for re-prompt details."
    },
    evidenceIndex: [],
    limitations: [
      ...fullReport.limitations,
      "Shared report omits raw evidence, patch/log excerpts, claims, proof-graph evidence refs, and re-prompt text."
    ]
  };
}
