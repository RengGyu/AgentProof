import { describe, expect, it, vi } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildGeneralPrSemanticOperatorDiagnosticsV1 } from "../src/lib/general-pr-observation-telemetry.ts";
import {
  assertAggregateOnlyRunArtifact,
  assertCurrentExternalPrSemanticBoundaryHealth,
  runCurrentExternalPrCorpusSemanticBoundaryDiagnostic,
  runCurrentExternalPrCorpusSmoke,
  writeCurrentExternalPrCaseDetails
} from "./external-pr-current-corpus-smoke.mjs";

describe("external-pr-current-corpus-smoke", () => {
  it("runs help for a relative CLI entry path without reading a snapshot or contacting a service", () => {
    const relative = "scripts/external-pr-current-corpus-smoke.mjs";
    for (const args of [[relative, "--help"], ["--input-type=module", "--eval", `process.argv = [process.execPath, ${JSON.stringify(relative)}, "--help"]; await import(${JSON.stringify(`./${relative}`)});`]]) {
      const child = spawnSync(process.execPath, args, { cwd: process.cwd(), encoding: "utf8" });
      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain("Usage: pnpm smoke:external-pr-current-corpus");
    }
  });

  it("counts only validated documentation predicates from completed reports and keeps public case rows opaque", async () => {
    const summary = { version: 1, scope: "literal_presence_only", predicates: [
      { sourceKind: "pr_body", sourceOrdinal: 1, legacyRequirementId: "req_1", state: "supported" },
      { sourceKind: "linked_issue", sourceOrdinal: 2, legacyRequirementId: null, state: "contradicted" },
      { sourceKind: "pr_body", sourceOrdinal: 3, legacyRequirementId: null, state: "unavailable" }
    ] };
    let count = 0;
    const result = await runCurrentExternalPrCorpusSmoke({ snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", runAnalyze: async () => {
      count += 1;
      if (count === 25) throw new Error("analysis unavailable");
      return { ...validAnalyzeResult(), ...(count < 3 ? { ordinaryDocumentationSummary: summary } : count === 3 ? { ordinaryDocumentationSummary: { ...summary, rawSource: "PRIVATE_SOURCE" } } : {}) };
    } });
    expect(result.ordinaryDocumentationSummary).toEqual({ completedWithSummaryCount: 2, completedWithoutSummaryCount: 22, predicateCount: 6, stateCounts: { supported: 2, contradicted: 2, unavailable: 2 } });
    expect(result.completedCount).toBe(24);
    expect(result.results[0]).toEqual({ id: "case_01", analysisStatus: "completed" });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_SOURCE|sourceOrdinal|legacyRequirementId|prUrl|https:\/\/github|literal_presence_only|rawSource/);
    for (const patch of [{ completedWithoutSummaryCount: 23 }, { predicateCount: 7 }, { stateCounts: { supported: 2, contradicted: 2, unavailable: 2, raw: 0 } }]) {
      expect(() => assertAggregateOnlyRunArtifact({ ...result, ordinaryDocumentationSummary: { ...result.ordinaryDocumentationSummary, ...patch } })).toThrow();
    }
  });
  it("restores owner-only permissions even when a stale checkpoint already exists", () => {
    const directory = mkdtempSync(join(tmpdir(), "agentproof-detail-test-"));
    try {
      const path = join(directory, "details.json");
      writeFileSync(`${path}.tmp`, "stale");
      chmodSync(`${path}.tmp`, 0o644);
      writeCurrentExternalPrCaseDetails({ cases: [{ id: "case_01" }] }, path);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(path, "utf8")).cases).toEqual([{ id: "case_01" }]);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("checkpoints per-PR detail and current operator diagnostics outside the public aggregate", async () => {
    const diagnostics = buildGeneralPrSemanticOperatorDiagnosticsV1(null);
    const targetDiagnostics = validTargetDiagnostics();
    targetDiagnostics.targets[0].objectiveState = "observed_objective";
    targetDiagnostics.targets[0].validator.claimState = "not_run";
    targetDiagnostics.targets[0].validator.capability = "collection_only";
    const rows = [];
    const runAnalyze = vi.fn(async (input) => {
      await input.onDiagnostic({ status: "completed", operator: diagnostics, operatorTargetDiagnostics: targetDiagnostics });
      return { ...validAnalyzeResult(), operatorSemanticDiagnostics: diagnostics, operatorTargetDiagnostics: targetDiagnostics };
    });
    const result = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", operatorDiagnosticsToken: "opaque-ops-value",
      runAnalyze, onCaseDetail: (row) => rows.push(row)
    });
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ id: "case_01", prUrl: "https://github.com/public/repo/pull/1", expectedAnchor: { headSha: "a".repeat(40) }, diagnostic: { operator: { claimInvalidReason: null }, operatorTargetDiagnostics: targetDiagnostics } });
    expect(result.publicRun.completedCount).toBe(25);
    expect(JSON.stringify(result.publicRun)).not.toMatch(/github.com|operator|claimInvalidReason|opaque-ops-value/);
  });

  it("checkpoints failed cases and propagates local checkpoint failures", async () => {
    const rows = [];
    const result = await runCurrentExternalPrCorpusSmoke({ snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z",
      runAnalyze: vi.fn().mockRejectedValue(Object.assign(new Error("private body"), { status: 503 })),
      onCaseDetail: (row) => rows.push(row)
    });
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({ analysisStatus: "incomplete", failureKind: "unexpected_server_error" });
    expect(JSON.stringify(rows)).not.toContain("private body");
    expect(result.incompleteCount).toBe(25);
    const runAnalyze = vi.fn().mockResolvedValue(validAnalyzeResult());
    await expect(runCurrentExternalPrCorpusSmoke({ snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", runAnalyze,
      onCaseDetail: () => { throw new Error("checkpoint_failed"); }
    })).rejects.toThrow("checkpoint_failed");
    expect(runAnalyze).toHaveBeenCalledOnce();
  });
  it("requires a complete, recursively valid target diagnostic before completing a corpus case", async () => {
    const diagnostics = validOperatorDiagnostics();
    const missing = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", operatorDiagnosticsToken: "opaque-ops-value",
      runAnalyze: vi.fn().mockResolvedValue({ ...validAnalyzeResult(), operatorSemanticDiagnostics: diagnostics, operatorTargetDiagnostics: undefined })
    });
    expect(missing.publicRun.completedCount).toBe(0);
    const malformed = structuredClone(validTargetDiagnostics());
    malformed.targets[0].validator.extra = "not-allowed";
    const bad = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", operatorDiagnosticsToken: "opaque-ops-value",
      runAnalyze: vi.fn().mockResolvedValue({ ...validAnalyzeResult(), operatorSemanticDiagnostics: diagnostics, operatorTargetDiagnostics: malformed })
    });
    expect(bad.publicRun.completedCount).toBe(0);
  });
  it("does not complete corpus cases with inconsistent aggregate and target stage states", async () => {
    const result = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", operatorDiagnosticsToken: "opaque-ops-value",
      runAnalyze: vi.fn().mockResolvedValue({ ...validAnalyzeResult(), operatorSemanticDiagnostics: { ...validOperatorDiagnostics(), evidenceState: "valid" } })
    });
    expect(result.publicRun.completedCount).toBe(0);
    expect(result.publicRun.incompleteCount).toBe(25);
  });
  it("runs each ready current-state sample with its frozen anchor and URL-only input", async () => {
    const runAnalyze = vi.fn().mockResolvedValue({
      priority: "medium",
      confidence: 0.4,
      evidenceCoverage: 25,
      ciStatus: "unknown",
      requirementCount: 0,
      evidenceCount: 4,
      limitationCount: 2,
      requirementStatusCounts: { unclear: 1 },
      requirementEvidenceStatusCounts: { partial: 1 },
      generalPrAssessmentSummary: assessmentSummary(),
      qualityGate: { ok: true, checks: [] },
      savedReportPrivacy: "summary-only",
      savedReportDeleted: true
    });

    const result = await runCurrentExternalPrCorpusSmoke({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      runAnalyze
    });

    expect(result).toEqual(expect.objectContaining({
      version: 1,
      privacy: "external-pr-current-corpus-run-summary-only",
      status: "completed",
      caseCount: 25,
      completedCount: 25,
      incompleteCount: 0,
      requirementStatusSummary: { unclear: 25 },
      requirementEvidenceStatusSummary: { partial: 25 },
      generalPrAssessmentSummary: {
        presentCount: 25,
        overallConclusionCounts: { evidence_partial: 25 },
        sourceStateCounts: { pr_author_claim: 25 },
        reasonCodeCounts: {
          verified_relation_missing: 25,
          author_claim_requires_confirmation: 25
        },
        assessmentCountTotals: {
          evidence_supported: 0,
          evidence_partial: 25,
          not_demonstrated: 0,
          contradicted: 0,
          blocked: 0,
          not_assessable: 0
        },
        observationSummary: {
          absentCount: 25,
          inventoryStateCounts: {},
          changedArtifactsTotal: 0,
          changedTestCandidatesTotal: 0,
          linksStateCounts: {},
          linkedObjectivesTotal: 0,
          relationProposalTotals: { supports: 0, tests: 0, implements: 0, contradicts: 0 },
          sourceCoverageCounts: {},
          evidenceCoverageCounts: {}
        }
      }
    }));
    expect(runAnalyze).toHaveBeenCalledTimes(25);
    expect(runAnalyze).toHaveBeenCalledWith(expect.objectContaining({
      prUrl: "https://github.com/public/repo/pull/1",
      requireRequirementFindings: false,
      requireGeneralPrAssessmentSummary: true,
      expectedSourceAnchor: {
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      }
    }));
    expect(JSON.stringify(runAnalyze.mock.calls)).not.toContain("taskText");
    expect(result.results[0]).toEqual({ id: "case_01", analysisStatus: "completed" });
    expect(JSON.stringify(result)).not.toMatch(/title|body|path|log|token|manual|prUrl|anchorFingerprint|target|sourceText|provider|diagnostic/i);
  });

  it("forwards an optional GitHub token only to each analysis request", async () => {
    const githubToken = "github_pat_test_token";
    const allowProductionGithubToken = true;
    const runAnalyze = vi.fn().mockResolvedValue(validAnalyzeResult());

    const result = await runCurrentExternalPrCorpusSmoke({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      githubToken,
      allowProductionGithubToken,
      runAnalyze
    });

    expect(runAnalyze).toHaveBeenCalledTimes(25);
    expect(runAnalyze).toHaveBeenCalledWith(expect.objectContaining({ githubToken, allowProductionGithubToken }));
    expect(JSON.stringify(result)).not.toContain(githubToken);
  });

  it("summarizes only closed staged packaging diagnostics outside the public artifact", async () => {
    const operatorDiagnosticsToken = "ops-secret-value";
    const runAnalyze = vi.fn().mockResolvedValue({
      ...validAnalyzeResult(),
      operatorSemanticDiagnostics: {
        claimState: "valid",
        evidenceState: "not_run",
        sourceCoverage: "sampled",
        evidenceCoverage: null,
        providerCallCount: 1,
        selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" },
        semanticPackageFailureReasons: ["span_limit_exceeded"],
        omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 1 }
      }
    });

    const result = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      operatorDiagnosticsToken,
      runAnalyze
    });

    expect(result.publicRun.status).toBe("completed");
    expect(JSON.stringify(result.publicRun)).not.toMatch(/provider|diagnostic|ops-secret-value/i);
    expect(result.operatorDiagnostic).toEqual({
      version: 1,
      privacy: "operator-only-aggregate",
      caseCount: 25,
      claimStageStateCounts: { valid: 25 },
      evidenceStageStateCounts: { not_run: 25 },
      sourceCoverageCounts: { sampled: 25 },
      evidenceCoverageCounts: {},
      providerCallCountCounts: { "1": 25 },
      selectedCountBucketCounts: { sourceSpans: { "1_4": 25 }, evidenceCandidates: { "0": 25 } },
      packageReadyCount: 25,
      semanticPackageFailureReasonCounts: { span_limit_exceeded: 25 },
      evidenceInvalidReasonCounts: { absent: 25 },
      freshnessFailureCounts: { absent: 25 },
      omissionReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 25 }
    });
    expect(runAnalyze).toHaveBeenCalledWith(expect.objectContaining({ operatorDiagnosticsToken }));
  });

  it("keeps optional safe diagnostic and observation fields in closed aggregates without backfilling legacy absence", async () => {
    const observations = {
      version: 1,
      inventory: { state: "complete", changedArtifacts: 2, changedTestCandidates: 1 },
      links: { state: "proposed", linkedObjectives: 1, supports: 1, tests: 0, implements: 0, contradicts: 0 },
      coverage: { source: "complete", evidence: "sampled" }
    };
    const runAnalyze = vi.fn()
      .mockResolvedValueOnce({
        ...validAnalyzeResult(),
        generalPrAssessmentSummary: { ...assessmentSummary(), observations },
        operatorSemanticDiagnostics: {
          ...validOperatorDiagnostics(),
          evidenceInvalidReason: null,
          freshnessFailure: { phase: "after_evidence", state: "stale", reason: "seed_changed" }
        }
      })
      .mockResolvedValue({ ...validAnalyzeResult(), operatorSemanticDiagnostics: validOperatorDiagnostics() });

    const result = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", operatorDiagnosticsToken: "ops-secret-value", runAnalyze
    });

    expect(result.operatorDiagnostic.evidenceInvalidReasonCounts).toEqual({ none: 1, absent: 24 });
    expect(result.operatorDiagnostic.freshnessFailureCounts).toEqual({ "after_evidence:stale:seed_changed": 1, absent: 24 });
    expect(result.publicRun.generalPrAssessmentSummary.observationSummary).toEqual({
      absentCount: 24,
      inventoryStateCounts: { complete: 1 },
      changedArtifactsTotal: 2,
      changedTestCandidatesTotal: 1,
      linksStateCounts: { proposed: 1 },
      linkedObjectivesTotal: 1,
      relationProposalTotals: { supports: 1, tests: 0, implements: 0, contradicts: 0 },
      sourceCoverageCounts: { complete: 1 },
      evidenceCoverageCounts: { sampled: 1 }
    });
    expect(JSON.stringify(result.publicRun)).not.toMatch(/seed_changed|operator|ops-secret-value/i);
  });

  it("continues to accept legacy v1 aggregate artifacts without optional diagnostic distributions", async () => {
    const publicRun = await runCurrentExternalPrCorpusSmoke({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", runAnalyze: vi.fn().mockResolvedValue(validAnalyzeResult())
    });
    delete publicRun.generalPrAssessmentSummary.observationSummary;
    expect(() => assertAggregateOnlyRunArtifact(publicRun)).not.toThrow();

    const semanticRun = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(), now: "2026-08-31T00:10:00.000Z", operatorDiagnosticsToken: "ops-secret-value",
      runAnalyze: vi.fn().mockResolvedValue({ ...validAnalyzeResult(), operatorSemanticDiagnostics: validOperatorDiagnostics() })
    });
    delete semanticRun.operatorDiagnostic.evidenceInvalidReasonCounts;
    delete semanticRun.operatorDiagnostic.freshnessFailureCounts;
    expect(() => assertCurrentExternalPrSemanticBoundaryHealth(semanticRun)).not.toThrow();
  });

  it("marks missing or invalid assessment summaries as analysis_unavailable", async () => {
    const runAnalyze = vi.fn().mockResolvedValue({
      generalPrAssessmentSummary: {
        ...assessmentSummary(),
        reasonCodes: ["unbounded_reason"]
      }
    });

    const result = await runCurrentExternalPrCorpusSmoke({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      runAnalyze
    });

    expect(result).toEqual(expect.objectContaining({
      status: "incomplete",
      completedCount: 0,
      incompleteCount: 25,
      generalPrAssessmentSummary: expect.objectContaining({ presentCount: 0 })
    }));
    expect(result.results).toEqual(Array.from({ length: 25 }, (_, index) => ({
      id: `case_${String(index + 1).padStart(2, "0")}`,
      analysisStatus: "incomplete",
      failureKind: "analysis_unavailable"
    })));
  });

  it("rejects unknown URL, source, provider, and diagnostic fields anywhere in a run artifact", async () => {
    const result = await runCurrentExternalPrCorpusSmoke({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      runAnalyze: vi.fn().mockResolvedValue(validAnalyzeResult())
    });

    for (const [path, mutate] of [
      ["url", (artifact) => { artifact.url = "https://private.example"; }],
      ["sourceDetail", (artifact) => { artifact.generalPrAssessmentSummary.sourceDetail = "private source"; }],
      ["providerMetadata", (artifact) => { artifact.results[0].providerMetadata = { model: "private" }; }],
      ["diagnosticNotes", (artifact) => { artifact.timingSummary.diagnosticNotes = "private"; }]
    ]) {
      const artifact = structuredClone(result);
      mutate(artifact);
      expect(() => assertAggregateOnlyRunArtifact(artifact), path).toThrow("Current external PR run artifact was invalid");
    }
  });

  it("allows only closed quality-gate id and label pairs plus opaque ordinal case IDs", async () => {
    const result = await runCurrentExternalPrCorpusSmoke({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      runAnalyze: vi.fn().mockResolvedValue(validAnalyzeResult())
    });
    const validCheck = {
      id: "requirements_present",
      label: "Requirement extraction present",
      count: 25,
      failedCount: 0
    };
    const withValidCheck = structuredClone(result);
    withValidCheck.qualityGateSummary.checks = [validCheck];

    expect(() => assertAggregateOnlyRunArtifact(withValidCheck)).not.toThrow();
    expect(() => assertAggregateOnlyRunArtifact({
      ...withValidCheck,
      qualityGateSummary: {
        ...withValidCheck.qualityGateSummary,
        checks: [{ ...validCheck, label: "https://private.example/?token=github_pat_secret" }]
      }
    })).toThrow("Current external PR run artifact was invalid");
    expect(() => assertAggregateOnlyRunArtifact({
      ...withValidCheck,
      qualityGateSummary: {
        ...withValidCheck.qualityGateSummary,
        checks: [{ ...validCheck, label: "Saved report remains summary-only" }]
      }
    })).toThrow("Current external PR run artifact was invalid");
    expect(() => assertAggregateOnlyRunArtifact({
      ...withValidCheck,
      results: [{ ...withValidCheck.results[0], id: "public-org/repo#123" }, ...withValidCheck.results.slice(1)]
    })).toThrow("Current external PR run artifact was invalid");
  });

  it("release guard permits sampled budget omissions and partial package readiness, but rejects legacy limit package failures", async () => {
    const result = await runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
      snapshot: readySnapshot(),
      now: "2026-08-31T00:10:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      operatorDiagnosticsToken: "ops-secret-value",
      runAnalyze: vi.fn().mockResolvedValue({
        ...validAnalyzeResult(),
        operatorSemanticDiagnostics: validOperatorDiagnostics()
      })
    });

    expect(() => assertCurrentExternalPrSemanticBoundaryHealth(result)).not.toThrow();
    const sampledOmissions = structuredClone(result);
    sampledOmissions.operatorDiagnostic.omissionReasonCounts.spanBudget = 1;
    sampledOmissions.operatorDiagnostic.omissionReasonCounts.evidenceBudget = 1;
    sampledOmissions.operatorDiagnostic.packageReadyCount = 24;
    expect(() => assertCurrentExternalPrSemanticBoundaryHealth(sampledOmissions)).not.toThrow();
    for (const [name, mutate] of [
      ["incomplete", (value) => { value.publicRun.status = "incomplete"; value.publicRun.incompleteCount = 1; value.publicRun.completedCount = 24; }],
      ["failed quality gate", (value) => { value.publicRun.qualityGateSummary.checks = [{ id: "requirements_present", label: "Requirement extraction present", count: 25, failedCount: 1 }]; }],
      ["strict authority promotion", (value) => { value.publicRun.requirementStatusSummary.met = 1; }],
      ["supported evidence authority promotion", (value) => { value.publicRun.requirementEvidenceStatusSummary.met = 1; }],
      ["evidence authority promotion", (value) => { value.publicRun.generalPrAssessmentSummary.assessmentCountTotals.evidence_supported = 1; }],
      ["legacy span-limit package failure", (value) => { value.operatorDiagnostic.semanticPackageFailureReasonCounts.span_limit_exceeded = 1; }],
      ["legacy change-cluster-limit package failure", (value) => { value.operatorDiagnostic.semanticPackageFailureReasonCounts.change_cluster_limit_exceeded = 1; }],
      ["legacy evidence-limit package failure", (value) => { value.operatorDiagnostic.semanticPackageFailureReasonCounts.evidence_atom_limit_exceeded = 1; }],
      ["third or later provider call", (value) => { value.operatorDiagnostic.providerCallCountCounts = { "3_plus": 25 }; }],
      ["incomplete optional diagnostic aggregate", (value) => { value.operatorDiagnostic.evidenceInvalidReasonCounts = { absent: 24 }; }],
      ["private operator field", (value) => { value.operatorDiagnostic.sourceText = "private"; }],
      ["private nested operator field", (value) => { value.operatorDiagnostic.selectedCountBucketCounts.sourceText = "private"; }],
      ["unexpected server error", (value) => { value.publicRun.results[0] = { id: "case_01", analysisStatus: "incomplete", failureKind: "unexpected_server_error" }; value.publicRun.status = "incomplete"; value.publicRun.completedCount = 24; value.publicRun.incompleteCount = 1; }]
    ]) {
      const mutated = structuredClone(result);
      mutate(mutated);
      expect(() => assertCurrentExternalPrSemanticBoundaryHealth(mutated), name).toThrow();
    }
  });

  it("enables the bounded general PR assessment in Vercel deployments", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

    expect(config.env?.AGENTPROOF_GENERAL_PR_OBSERVATION_MODE).toBe("advisory");
  });

  it("refuses a stale or incomplete source snapshot before analyzing any PR", async () => {
    const staleSnapshot = readySnapshot({ observedAt: "2026-08-31T00:00:00.000Z" });
    const runAnalyze = vi.fn();

    await expect(runCurrentExternalPrCorpusSmoke({
      snapshot: staleSnapshot,
      now: "2026-08-31T01:00:00.000Z",
      maxSnapshotAgeMs: 30 * 60 * 1000,
      runAnalyze
    })).rejects.toThrow("must be refreshed before analysis");
    expect(runAnalyze).not.toHaveBeenCalled();

    await expect(runCurrentExternalPrCorpusSmoke({
      snapshot: { ...readySnapshot(), status: "incomplete" },
      now: "2026-08-31T00:10:00.000Z",
      runAnalyze
    })).rejects.toThrow("requires a ready snapshot");

    const duplicate = readySnapshot();
    duplicate.cases[1].prUrl = "https://github.com/PUBLIC/REPO/pull/1";
    await expect(runCurrentExternalPrCorpusSmoke({
      snapshot: duplicate,
      now: "2026-08-31T00:10:00.000Z",
      runAnalyze
    })).rejects.toThrow("snapshot is invalid");
    expect(runAnalyze).not.toHaveBeenCalled();
  });

});

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

function validAnalyzeResult() {
  return {
    priority: "medium",
    confidence: 0.4,
    evidenceCoverage: 25,
    ciStatus: "unknown",
    requirementCount: 0,
    evidenceCount: 4,
    limitationCount: 2,
    requirementStatusCounts: { unclear: 1 },
    requirementEvidenceStatusCounts: { partial: 1 },
    generalPrAssessmentSummary: assessmentSummary(),
    qualityGate: { ok: true, checks: [] },
    savedReportPrivacy: "summary-only",
    savedReportDeleted: true,
    operatorTargetDiagnostics: validTargetDiagnostics()
  };
}

function validTargetDiagnostics() {
  return { version: 1, targetCount: 1, omittedTargetCount: 0, rejectedProviderProposalCount: 0, projectionOmissionCounts: { targetLimit: 0, sourceRefLimit: 0, changeClusterRefLimit: 0, evidenceRefLimit: 0, proposalLimit: 0 }, targets: [{ targetRef: "target_1", selectedSourceSpanRefs: ["span_1"], selectedChangeClusterRefs: [], selectedEvidenceRefs: [], sourceObligation: "author_claim_confirmation", currentAssessmentEligibility: "eligible", objectiveState: "semantic_candidate", admissionDisposition: "admitted", nonAdmissionReason: "not_applicable", validator: { scope: "global_stage", claimState: "valid", evidenceState: "not_run", claimInvalidReason: null, evidenceInvalidReason: null, capability: "collection_incomplete" }, proposedRelations: [], currentAssessmentCeiling: "evidence_partial", missingProofReasons: ["author_claim_confirmation_required", "verified_objective_change_relation_not_evaluated", "targeted_test_requirement_not_evaluated", "exact_head_execution_not_evaluated"] }] };
}

function validOperatorDiagnostics() {
  return {
    claimState: "valid",
    evidenceState: "not_run",
    sourceCoverage: "sampled",
    evidenceCoverage: null,
    providerCallCount: 1,
    selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" },
    semanticPackageFailureReasons: [],
    omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 }
  };
}

function readySnapshot({ observedAt = "2026-08-31T00:00:00.000Z" } = {}) {
  return {
    version: 1,
    privacy: "external-pr-live-corpus-anchor-summary-only",
    status: "ready",
    observedAt,
    candidateCount: 25,
    corpusFingerprint: "c".repeat(64),
    cases: Array.from({ length: 25 }, (_, index) => ({
      id: `case-${index + 1}`,
      cohort: index < 5 ? "pilot" : index < 15 ? "blind" : "roleproof",
      repository: "public/repo",
      prNumber: index + 1,
      prUrl: `https://github.com/public/repo/pull/${index + 1}`,
      captureStatus: "captured",
      anchor: {
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      },
      pullRequest: {
        state: "closed",
        draft: false,
        mergedAt: null,
        updatedAt: "2026-08-31T00:00:00.000Z",
        changedFileCount: 1
      },
      anchorFingerprint: "d".repeat(64)
    }))
  };
}
