import { describe, expect, it } from "vitest";
import {
  reportWorkspaceStatusLabel,
  visibleRepositoryReports
} from "./dashboard-report-list";

const reports = [
  { id: "current", repositoryId: 7, freshness: "current", copyEligible: true, createdAt: "2026-08-12T00:00:00.000Z" },
  { id: "refreshing", repositoryId: 7, freshness: "refreshing", copyEligible: false, createdAt: "2026-08-12T00:01:00.000Z" },
  { id: "failed", repositoryId: 7, freshness: "refresh_failed", copyEligible: false, createdAt: "2026-08-12T00:02:00.000Z" },
  { id: "old", repositoryId: 7, freshness: "superseded", copyEligible: false, createdAt: "2026-08-11T00:00:00.000Z" },
  { id: "other", repositoryId: 8, freshness: "current", copyEligible: true, createdAt: "2026-08-12T00:00:00.000Z" }
] as const;

describe("dashboard report list", () => {
  it("keeps a report visible while its newer analysis is running", () => {
    expect(visibleRepositoryReports(reports, 7).map((report) => report.id)).toEqual(["failed", "refreshing", "current"]);
  });

  it("uses user-facing state labels without making an updating report copyable", () => {
    expect(reportWorkspaceStatusLabel("current")).toBe("CURRENT");
    expect(reportWorkspaceStatusLabel("refreshing")).toBe("UPDATING");
    expect(reportWorkspaceStatusLabel("refresh_failed")).toBe("NEEDS ATTENTION");
  });
});
