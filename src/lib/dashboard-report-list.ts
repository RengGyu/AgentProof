import type { DashboardReportFreshness, DashboardSavedReport } from "./github-dashboard-view-model";

type ReportListItem = Pick<DashboardSavedReport, "repositoryId" | "createdAt" | "freshness" | "availability">;

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

export function partitionVisibleRepositoryReports<T extends ReportListItem>(reports: readonly T[], repositoryId?: number): {
  primary: T[];
  unavailableHistory: T[];
} {
  const visible = visibleRepositoryReports(reports, repositoryId);
  return {
    primary: visible.filter((report) => report.availability !== "unavailable"),
    unavailableHistory: visible.filter((report) => report.availability === "unavailable")
  };
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
