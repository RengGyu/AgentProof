import type { TenantAnalysisJobSummary } from "./analysis-jobs";
import type { DashboardSavedReport } from "./github-dashboard-view-model";

export type DashboardActivityKind =
  | "report_ready"
  | "report_stale"
  | "analysis_pending"
  | "analysis_needs_attention"
  | "analysis_completed";

export interface DashboardActivityEvent {
  id: string;
  kind: DashboardActivityKind;
  occurredAt: string;
  state: "Analysis ready" | "Report stale" | "Analysis pending" | "Needs attention" | "Analysis completed";
  repositoryId?: number;
  repositoryFullName?: string;
  pullRequestNumber?: number;
  headShaPrefix?: string;
  reportId?: string;
}

export function buildDashboardActivity(input: {
  reports: DashboardSavedReport[];
  jobs: TenantAnalysisJobSummary[];
  repositories?: Array<{ repositoryId?: number; repositoryFullName: string }>;
  limit?: number;
}): DashboardActivityEvent[] {
  const repositoryNames = new Map((input.repositories ?? [])
    .filter((repository) => typeof repository.repositoryId === "number")
    .map((repository) => [repository.repositoryId!, repository.repositoryFullName]));
  const reportKeys = new Set(input.reports.map((report) => reportKey(report, repositoryNames)));
  const events = [
    ...input.reports.map((report) => reportEvent(report, repositoryNames)),
    ...input.jobs.flatMap((job) => jobEvents(job, reportKeys))
  ];

  return events
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, normalizeLimit(input.limit));
}

function reportEvent(report: DashboardSavedReport, repositoryNames: Map<number, string>): DashboardActivityEvent {
  const stale = Boolean(report.staleAt);
  return {
    id: `report:${report.id}`,
    kind: stale ? "report_stale" : "report_ready",
    occurredAt: stale ? report.staleAt! : report.createdAt,
    state: stale ? "Report stale" : "Analysis ready",
    repositoryId: report.repositoryId,
    repositoryFullName: report.repositoryId ? repositoryNames.get(report.repositoryId) : undefined,
    pullRequestNumber: report.pullRequestNumber,
    headShaPrefix: safeHeadPrefix(report.headSha),
    reportId: report.id
  };
}

function jobEvents(job: TenantAnalysisJobSummary, reportKeys: Set<string>): DashboardActivityEvent[] {
  if (job.status === "completed" && reportKeys.has(jobKey(job))) return [];

  if (job.status === "queued" || job.status === "processing") {
    return [jobEvent(job, "analysis_pending", "Analysis pending")];
  }

  if (job.status === "failed_retryable" || job.status === "failed_terminal") {
    return [jobEvent(job, "analysis_needs_attention", "Needs attention")];
  }

  return [jobEvent(job, "analysis_completed", "Analysis completed")];
}

function jobEvent(
  job: TenantAnalysisJobSummary,
  kind: DashboardActivityKind,
  state: DashboardActivityEvent["state"]
): DashboardActivityEvent {
  return {
    id: `job:${job.id}`,
    kind,
    occurredAt: job.completedAt ?? job.updatedAt,
    state,
    repositoryFullName: job.repositoryFullName,
    pullRequestNumber: job.pullRequestNumber,
    headShaPrefix: safeHeadPrefix(job.headShaPrefix)
  };
}

function reportKey(report: DashboardSavedReport, repositoryNames: Map<number, string>): string {
  const repositoryName = report.repositoryId ? repositoryNames.get(report.repositoryId) : undefined;
  return `${repositoryName ?? `repository:${report.repositoryId ?? "unknown"}`}:${report.pullRequestNumber ?? "unknown"}:${safeHeadPrefix(report.headSha) ?? "unknown"}`;
}

function jobKey(job: TenantAnalysisJobSummary): string {
  return `${job.repositoryFullName}:${job.pullRequestNumber}:${safeHeadPrefix(job.headShaPrefix) ?? "unknown"}`;
}

function safeHeadPrefix(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]{6,64}$/.test(normalized) ? normalized.slice(0, 12) : undefined;
}

function normalizeLimit(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value!), 1), 25) : 12;
}
