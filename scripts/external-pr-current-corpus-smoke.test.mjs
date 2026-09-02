import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertAggregateOnlyRunArtifact,
  assertCurrentExternalPrSemanticBoundaryHealth,
  runCurrentExternalPrCorpusSemanticBoundaryDiagnostic,
  runCurrentExternalPrCorpusSmoke
} from "./external-pr-current-corpus-smoke.mjs";

describe("external-pr-current-corpus-smoke", () => {
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
      omissionReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 25 }
    });
    expect(runAnalyze).toHaveBeenCalledWith(expect.objectContaining({ operatorDiagnosticsToken }));
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

  it("release guard rejects packaging hazards but permits unclear findings", async () => {
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
    for (const [name, mutate] of [
      ["incomplete", (value) => { value.publicRun.status = "incomplete"; value.publicRun.incompleteCount = 1; value.publicRun.completedCount = 24; }],
      ["failed quality gate", (value) => { value.publicRun.qualityGateSummary.checks = [{ id: "requirements_present", label: "Requirement extraction present", count: 25, failedCount: 1 }]; }],
      ["strict authority promotion", (value) => { value.publicRun.requirementStatusSummary.met = 1; }],
      ["supported evidence authority promotion", (value) => { value.publicRun.requirementEvidenceStatusSummary.met = 1; }],
      ["evidence authority promotion", (value) => { value.publicRun.generalPrAssessmentSummary.assessmentCountTotals.evidence_supported = 1; }],
      ["count-limit recurrence", (value) => { value.operatorDiagnostic.omissionReasonCounts.spanBudget = 1; }],
      ["evidence count-limit recurrence", (value) => { value.operatorDiagnostic.omissionReasonCounts.evidenceBudget = 1; }],
      ["third or later provider call", (value) => { value.operatorDiagnostic.providerCallCountCounts = { "3_plus": 25 }; }],
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
    savedReportDeleted: true
  };
}

function validOperatorDiagnostics() {
  return {
    claimState: "valid",
    evidenceState: "not_run",
    sourceCoverage: "sampled",
    evidenceCoverage: null,
    providerCallCount: 1,
    selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "0" },
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
