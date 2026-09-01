import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runCurrentExternalPrCorpusSmoke } from "./external-pr-current-corpus-smoke.mjs";

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
        overallConclusionCounts: { mixed_evidence: 25 },
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
    expect(result.results[0]).toEqual({ id: "case-1", analysisStatus: "completed" });
    expect(JSON.stringify(result)).not.toMatch(/title|body|path|log|token|manual|prUrl|anchorFingerprint|target|sourceText|provider|diagnostic/i);
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
      id: `case-${index + 1}`,
      analysisStatus: "incomplete",
      failureKind: "analysis_unavailable"
    })));
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
    overallConclusion: "mixed_evidence",
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
