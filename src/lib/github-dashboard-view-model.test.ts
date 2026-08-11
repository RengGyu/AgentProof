import { describe, expect, it } from "vitest";
import {
  buildGitHubPullUrl,
  isPreviewDemoEnabled,
  toRequirementCoverageLabel,
  toQuickSummary,
  toRepositoryWorkspaceRows
} from "./github-dashboard-view-model";

describe("github dashboard view model", () => {
  it("enables sample data only for an explicitly requested Preview demo", () => {
    expect(isPreviewDemoEnabled(true, "1")).toBe(true);
    expect(isPreviewDemoEnabled(false, "1")).toBe(false);
    expect(isPreviewDemoEnabled(true, undefined)).toBe(false);
  });

  it("translates stored requirement states into reviewer-facing language", () => {
    expect(toRequirementCoverageLabel("met")).toBe("Supported");
    expect(toRequirementCoverageLabel("partial")).toBe("Partially supported");
    expect(toRequirementCoverageLabel("missing")).toBe("Evidence missing");
    expect(toRequirementCoverageLabel("unclear")).toBe("Unclear");
  });

  it("builds a GitHub pull URL only from a safe repository name and PR number", () => {
    expect(buildGitHubPullUrl("RengGyu/dongo", 14)).toBe("https://github.com/RengGyu/dongo/pull/14");
    expect(buildGitHubPullUrl("bad repo/name", 14)).toBeUndefined();
    expect(buildGitHubPullUrl("RengGyu/dongo", 0)).toBeUndefined();
  });

  it("maps a stale stored report to a bounded quick summary", () => {
    expect(toQuickSummary({
      repositoryFullName: "RengGyu/dongo",
      pullRequestNumber: 14,
      headSha: "a".repeat(40),
      createdAt: "2026-08-06T00:00:00.000Z",
      staleAt: "2026-08-06T00:05:00.000Z",
      priority: "high",
      report: {
        requirements: [{ requirementId: "req_1", status: "partial", evidenceRefs: ["ev_1"], gaps: ["Evidence gap recorded."] }],
        testing: { ciStatus: "failed", lintStatus: "passed", typecheckStatus: "unknown" },
        reviewPriority: [{ path: "src/auth.ts", priority: "high" }],
        evidenceIndex: [{ id: "ev_1", locator: "src/auth.ts" }],
        reprompt: { prompt: "Address missing or unclear verification evidence, then rerun the relevant checks." }
      }
    })).toMatchObject({
      freshness: "STALE",
      checkState: "Check failed",
      primaryEvidenceState: "Evidence missing",
      inspectFirst: "src/auth.ts",
      githubUrl: "https://github.com/RengGyu/dongo/pull/14"
    });
  });

  it("uses bounded server-resolved freshness instead of treating a saved report as current", () => {
    expect(toQuickSummary({
      repositoryFullName: "RengGyu/dongo",
      pullRequestNumber: 14,
      freshness: "refresh_failed",
      copyEligible: false,
      report: { requirements: [] }
    }).freshness).toBe("REFRESH FAILED");
    expect(toQuickSummary({
      repositoryFullName: "RengGyu/dongo",
      pullRequestNumber: 14,
      freshness: "superseded",
      copyEligible: false,
      report: { requirements: [] }
    }).freshness).toBe("SUPERSEDED");
  });

  it("keeps explicit current freshness ahead of an out-of-order legacy stale marker and fails closed without a state", () => {
    expect(toQuickSummary({ freshness: "current", copyEligible: true, staleAt: "2026-08-06T00:00:00.000Z", report: { requirements: [] } }).freshness).toBe("CURRENT");
    expect(toQuickSummary({ report: { requirements: [] } }).freshness).toBe("UNKNOWN");
  });

  it("uses the deterministic evidence gap as the quick-summary explanation when semantic prose differs", () => {
    const summary = toQuickSummary({
      repositoryFullName: "RengGyu/dongo",
      pullRequestNumber: 14,
      priority: "high",
      report: {
        requirements: [{ requirementId: "req_1", status: "partial", evidenceRefs: ["ev_1"], gaps: ["Evidence gap recorded."] }],
        testing: { ciStatus: "passed", lintStatus: "passed", typecheckStatus: "passed" },
        reviewPriority: [{ path: "src/auth.ts", priority: "high" }],
        evidenceIndex: [{ id: "ev_1", locator: "src/auth.ts" }],
        reprompt: { prompt: "Address missing or unclear verification evidence, then rerun the relevant checks." },
        semantic: {
          requirement_evidence_relations: [],
          requirement_assessments: [],
          evidence_gaps: [{
            requirement_id: "req_1",
            gap_type: "missing_test_evidence",
            priority: "high",
            description: "A focused test for the exceptional input path is not available.",
            review_impact: "The reviewer cannot trace that path from the supplied evidence.",
            needed_evidence: "A focused test or execution reference.",
            evidence_ids: ["ev_1"],
            uncertainty: "medium"
          }],
          review_targets: [],
          remediation_requests: [],
          uncertainties: []
        }
      }
    });

    expect(summary.primaryEvidenceDetail).toBe("Evidence gap recorded.");
  });

  it("never exposes an internal requirement ID as the quick-summary gap", () => {
    const summary = toQuickSummary({
      repositoryFullName: "RengGyu/dongo",
      pullRequestNumber: 18,
      report: {
        requirements: [{ requirementId: "req_3", requirementText: "Add focused tests.", status: "partial", evidenceRefs: ["ev_1"], gaps: [] }]
      }
    });

    expect(summary.primaryEvidenceDetail).toBe("Some evidence is linked, but coverage is incomplete.");
    expect(summary.primaryEvidenceDetail).not.toContain("req_3");
  });

  it("marks an exhausted enhanced-analysis retry as unavailable without changing grounded evidence", () => {
    const summary = toQuickSummary({
      repositoryFullName: "RengGyu/dongo",
      pullRequestNumber: 16,
      priority: "high",
      report: {
        requirements: [{ requirementId: "req_1", status: "partial", evidenceRefs: ["ev_1"], gaps: ["Evidence gap recorded."] }],
        testing: { ciStatus: "unknown", lintStatus: "unknown", typecheckStatus: "unknown" },
        reviewPriority: [{ path: "agentproof-smoke/session-expiry.js", priority: "high" }],
        evidenceIndex: [{ id: "ev_1", locator: "agentproof-smoke/session-expiry.js" }],
        reprompt: { prompt: "Address missing or unclear verification evidence, then rerun the relevant checks." },
        semanticAnalysis: { status: "unavailable", attempts: 2 }
      }
    });

    expect(summary.primaryEvidenceState).toBe("Evidence missing");
    expect(summary.aiEvidenceState).toBe("Unavailable");
  });

  it("groups saved reports under connected repositories without inventing a repository", () => {
    expect(toRepositoryWorkspaceRows(
      [{ installationId: 1, repositoryId: 10, repositoryFullName: "RengGyu/dongo", enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false }],
      [{ id: "report_1", repositoryId: 10, pullRequestNumber: 14, priority: "medium", createdAt: "2026-08-06T00:00:00.000Z" }, { id: "report_unknown", repositoryId: 99, pullRequestNumber: 2, priority: "high", createdAt: "2026-08-06T00:00:00.000Z" }]
    )).toEqual([
      expect.objectContaining({ repositoryFullName: "RengGyu/dongo", reportCount: 1, commentsEnabled: false })
    ]);
  });
});
