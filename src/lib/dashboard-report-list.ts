import type { DashboardReportFreshness, DashboardSavedReport } from "./github-dashboard-view-model";

type ReportListItem = Pick<DashboardSavedReport, "repositoryId" | "createdAt" | "freshness">;

/**
 * Keeps the newest saved report reachable while its replacement is running.
 * Historical heads remain available through Inbox, rather than crowding the
 * repository's working list.
 */
export function visibleRepositoryReports<T extends ReportListItem>(reports: readonly T[], repositoryId?: number): T[] {
  if (!repositoryId) return [];

  return reports
    .filter((report) => report.repositoryId === repositoryId && report.freshness !== "superseded" && report.freshness !== "stale")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function reportWorkspaceStatusLabel(freshness?: DashboardReportFreshness): string {
  if (freshness === "refreshing") return "UPDATING";
  if (freshness === "refresh_failed") return "NEEDS ATTENTION";
  if (freshness === "unknown") return "STATUS UNAVAILABLE";
  return "CURRENT";
}

export function isCopyEligibleReport(report: Pick<DashboardSavedReport, "freshness" | "copyEligible">): boolean {
  return report.freshness === "current" && report.copyEligible === true;
}
