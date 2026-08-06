export interface DashboardRepositoryGrant {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
}

export interface DashboardSavedReport {
  id: string;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  priority: string;
  createdAt: string;
  staleAt?: string;
}

export interface DashboardReportDetail extends Omit<DashboardSavedReport, "id" | "priority" | "createdAt"> {
  createdAt?: string;
  priority?: string;
  report?: {
    requirements?: Array<{ requirementId: string; status: string; evidenceRefs: string[]; gaps: string[] }>;
    testing?: { ciStatus: string; lintStatus: string; typecheckStatus: string };
    reviewPriority?: Array<{ path: string; priority: string }>;
    evidenceIndex?: Array<{ id: string; locator?: string }>;
    reprompt?: { prompt: string };
  };
}

export interface RepositoryWorkspaceRow extends DashboardRepositoryGrant {
  reportCount: number;
  currentReportCount: number;
  latestReport?: DashboardSavedReport;
  commentsEnabled: boolean;
}

export interface QuickSummary {
  freshness: "CURRENT" | "STALE";
  checkState: "Success" | "Check failed" | "Pending" | "Unknown" | "Unavailable";
  primaryEvidenceState: "Evidence found" | "Evidence missing" | "Needs attention" | "Unknown" | "Unavailable";
  inspectFirst: string;
  githubUrl?: string;
}

const SAFE_REPOSITORY = /^[-.A-Za-z0-9_]+\/[-.A-Za-z0-9_]+$/;
const SAFE_LOCATOR = /^[A-Za-z0-9_.:@#/-]{1,240}$/;

export function isPreviewDemoEnabled(previewDemoAvailable: boolean, demo: string | undefined): boolean {
  return previewDemoAvailable && demo === "1";
}

export function toRequirementCoverageLabel(status: string): string {
  if (status === "met") return "Supported";
  if (status === "partial") return "Partially supported";
  if (status === "missing") return "Evidence missing";
  return "Unclear";
}

export function buildGitHubPullUrl(repositoryFullName: string | undefined, pullRequestNumber: number | undefined): string | undefined {
  if (!repositoryFullName || !SAFE_REPOSITORY.test(repositoryFullName) || typeof pullRequestNumber !== "number" || !Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1) return undefined;
  return `https://github.com/${repositoryFullName}/pull/${pullRequestNumber}`;
}

export function findCurrentReportForActivity(
  activity: Pick<DashboardSavedReport, "repositoryId" | "pullRequestNumber">,
  cachedReports: DashboardSavedReport[],
  refreshedReports: DashboardSavedReport[] = []
): DashboardSavedReport | undefined {
  return [...cachedReports, ...refreshedReports].find((report) =>
    report.repositoryId === activity.repositoryId &&
    report.pullRequestNumber === activity.pullRequestNumber &&
    !report.staleAt
  );
}

export function toRepositoryWorkspaceRows(
  repositories: DashboardRepositoryGrant[],
  reports: DashboardSavedReport[]
): RepositoryWorkspaceRow[] {
  return repositories.map((repository) => {
    const scoped = reports
      .filter((report) => report.repositoryId === repository.repositoryId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return {
      ...repository,
      reportCount: scoped.length,
      currentReportCount: scoped.filter((report) => !report.staleAt).length,
      ...(scoped[0] ? { latestReport: scoped[0] } : {}),
      commentsEnabled: repository.commentEnabled
    };
  });
}

export function toQuickSummary(detail: DashboardReportDetail & { repositoryFullName?: string }): QuickSummary {
  const requirements = detail.report?.requirements ?? [];
  const firstRequirement = requirements.find((item) => item.gaps.length > 0) ?? requirements[0];
  const firstPriorityPath = detail.report?.reviewPriority?.map((item) => safeLocator(item.path)).find(Boolean);
  const firstEvidencePath = detail.report?.evidenceIndex?.map((item) => safeLocator(item.locator)).find(Boolean);

  return {
    freshness: detail.staleAt ? "STALE" : "CURRENT",
    checkState: toCheckState(detail.report?.testing),
    primaryEvidenceState: toEvidenceState(firstRequirement?.status, firstRequirement?.gaps.length ?? 0),
    inspectFirst: firstPriorityPath ?? firstEvidencePath ?? "Unavailable",
    githubUrl: buildGitHubPullUrl(detail.repositoryFullName, detail.pullRequestNumber)
  };
}

function toCheckState(testing: NonNullable<DashboardReportDetail["report"]>["testing"]): QuickSummary["checkState"] {
  if (!testing) return "Unavailable";
  const statuses = [testing.ciStatus, testing.lintStatus, testing.typecheckStatus];
  if (statuses.includes("failed")) return "Check failed";
  if (statuses.includes("pending")) return "Pending";
  if (statuses.every((status) => status === "passed")) return "Success";
  return "Unknown";
}

function toEvidenceState(status: string | undefined, gapCount: number): QuickSummary["primaryEvidenceState"] {
  if (!status) return "Unavailable";
  if (gapCount > 0 || status === "missing") return "Evidence missing";
  if (status === "partial") return "Needs attention";
  if (status === "unclear") return "Unknown";
  return "Evidence found";
}

function safeLocator(value: string | undefined): string | undefined {
  return value && SAFE_LOCATOR.test(value) && !value.startsWith("/") && !value.includes("..") ? value : undefined;
}
