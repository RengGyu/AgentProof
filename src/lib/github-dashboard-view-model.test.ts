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

  it("groups saved reports under connected repositories without inventing a repository", () => {
    expect(toRepositoryWorkspaceRows(
      [{ installationId: 1, repositoryId: 10, repositoryFullName: "RengGyu/dongo", enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false }],
      [{ id: "report_1", repositoryId: 10, pullRequestNumber: 14, priority: "medium", createdAt: "2026-08-06T00:00:00.000Z" }, { id: "report_unknown", repositoryId: 99, pullRequestNumber: 2, priority: "high", createdAt: "2026-08-06T00:00:00.000Z" }]
    )).toEqual([
      expect.objectContaining({ repositoryFullName: "RengGyu/dongo", reportCount: 1, commentsEnabled: false })
    ]);
  });
});
