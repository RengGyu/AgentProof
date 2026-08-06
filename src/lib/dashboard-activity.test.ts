import { describe, expect, it } from "vitest";
import { buildDashboardActivity } from "./dashboard-activity";

describe("dashboard activity", () => {
  it("creates tenant-safe events from saved-report and job metadata without duplicate completion events", () => {
    const activity = buildDashboardActivity({
      repositories: [{ repositoryId: 42, repositoryFullName: "RengGyu/dongo" }],
      reports: [
        {
          id: "report_current",
          repositoryId: 42,
          pullRequestNumber: 14,
          headSha: "a".repeat(40),
          priority: "high",
          createdAt: "2026-08-06T01:00:00.000Z"
        },
        {
          id: "report_stale",
          repositoryId: 42,
          pullRequestNumber: 14,
          headSha: "b".repeat(40),
          priority: "medium",
          createdAt: "2026-08-05T22:00:00.000Z",
          staleAt: "2026-08-06T01:00:00.000Z"
        }
      ],
      jobs: [
        {
          id: "job_completed",
          status: "completed",
          createdAt: "2026-08-06T00:55:00.000Z",
          updatedAt: "2026-08-06T01:00:00.000Z",
          repositoryFullName: "RengGyu/dongo",
          pullRequestNumber: 14,
          headShaPrefix: "aaaaaaaaaaaa",
          attempts: 1,
          sideEffects: { saveReport: true, comment: false },
          privacy: "analysis-job-summary-only"
        },
        {
          id: "job_failed",
          status: "failed_retryable",
          createdAt: "2026-08-06T01:03:00.000Z",
          updatedAt: "2026-08-06T01:04:00.000Z",
          repositoryFullName: "RengGyu/dongo",
          pullRequestNumber: 15,
          headShaPrefix: "cccccccccccc",
          attempts: 2,
          errorCode: "github_fetch_failed",
          sideEffects: { saveReport: true, comment: false },
          privacy: "analysis-job-summary-only"
        }
      ]
    });

    expect(activity).toEqual([
      expect.objectContaining({
        id: "job:job_failed",
        kind: "analysis_needs_attention",
        repositoryFullName: "RengGyu/dongo",
        pullRequestNumber: 15,
        state: "Needs attention"
      }),
      expect.objectContaining({
        id: "report:report_current",
        kind: "report_ready",
        repositoryId: 42,
        pullRequestNumber: 14,
        reportId: "report_current",
        state: "Analysis ready"
      }),
      expect.objectContaining({
        id: "report:report_stale",
        kind: "report_stale",
        repositoryId: 42,
        pullRequestNumber: 14,
        reportId: "report_stale",
        state: "Report stale"
      })
    ]);

    const serialized = JSON.stringify(activity);
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("raw");
  });

  it("keeps queued analysis visible when no report exists yet", () => {
    expect(buildDashboardActivity({
      reports: [],
      jobs: [{
        id: "job_queued",
        status: "queued",
        createdAt: "2026-08-06T02:00:00.000Z",
        updatedAt: "2026-08-06T02:00:00.000Z",
        repositoryFullName: "RengGyu/dongo",
        pullRequestNumber: 16,
        headShaPrefix: "dddddddddddd",
        attempts: 0,
        sideEffects: { saveReport: true, comment: false },
        privacy: "analysis-job-summary-only"
      }]
    })).toEqual([
      expect.objectContaining({
        id: "job:job_queued",
        kind: "analysis_pending",
        state: "Analysis pending"
      })
    ]);
  });

  it("does not merge activity from different repositories that share a PR number and head prefix", () => {
    const activity = buildDashboardActivity({
      repositories: [
        { repositoryId: 42, repositoryFullName: "RengGyu/dongo" },
        { repositoryId: 43, repositoryFullName: "RengGyu/other" }
      ],
      reports: [{
        id: "report_dongo",
        repositoryId: 42,
        pullRequestNumber: 14,
        headSha: "a".repeat(40),
        priority: "medium",
        createdAt: "2026-08-06T01:00:00.000Z"
      }],
      jobs: [{
        id: "job_other",
        status: "completed",
        createdAt: "2026-08-06T01:00:00.000Z",
        updatedAt: "2026-08-06T01:01:00.000Z",
        repositoryFullName: "RengGyu/other",
        pullRequestNumber: 14,
        headShaPrefix: "aaaaaaaaaaaa",
        attempts: 1,
        sideEffects: { saveReport: false, comment: false },
        privacy: "analysis-job-summary-only"
      }]
    });

    expect(activity.map((event) => event.id)).toEqual(["job:job_other", "report:report_dongo"]);
  });
});
