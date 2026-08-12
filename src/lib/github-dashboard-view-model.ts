import type { LlmSemanticOutput } from "./llm-semantic-output";
import type { HybridPlannerProvenance, RequirementProofAxis } from "./types";

export interface DashboardRepositoryGrant {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
  llmAnalysisMode?: "essential" | "enhanced";
  hybridPlannerConsentVersion?: "2026-08-12.v1" | null;
  repositoryPrivate?: boolean;
}

export interface DashboardSavedReport {
  id: string;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  priority: string;
  createdAt: string;
  staleAt?: string;
  freshness?: DashboardReportFreshness;
  copyEligible?: boolean;
  availability?: "available" | "unavailable";
}

export type DashboardReportFreshness = "current" | "refreshing" | "refresh_failed" | "superseded" | "stale" | "unknown";

export interface DashboardReportDetail extends Omit<DashboardSavedReport, "id" | "priority" | "createdAt"> {
  id?: string;
  createdAt?: string;
  priority?: string;
  evidenceCapturedAt?: string;
  analysisContext?: "linked_issue" | "unlinked_pr" | "provided_requirement";
  report?: {
    requirements?: Array<{ requirementId: string; requirementText?: string; status: string; evidenceRefs: string[]; gaps: string[]; proofAxes?: RequirementProofAxis[] }>;
    testing?: { ciStatus: string; lintStatus: string; typecheckStatus: string };
    reviewPriority?: Array<{ path: string; priority: string }>;
    evidenceIndex?: Array<{ id: string; locator?: string }>;
    reprompt?: { prompt: string };
    semantic?: LlmSemanticOutput;
    semanticAnalysis?: { status: "included" | "unavailable"; attempts: 1 | 2 };
    planner?: HybridPlannerProvenance;
  };
}

export interface RepositoryWorkspaceRow extends DashboardRepositoryGrant {
  reportCount: number;
  currentReportCount: number;
  latestReport?: DashboardSavedReport;
  commentsEnabled: boolean;
}

export interface QuickSummary {
  freshness: "CURRENT" | "REFRESHING" | "REFRESH FAILED" | "SUPERSEDED" | "STALE" | "UNKNOWN";
  checkState: "Success" | "Check failed" | "Pending" | "Unknown" | "Unavailable";
  primaryEvidenceState: "Evidence found" | "Evidence missing" | "Needs attention" | "Unknown" | "Unavailable";
  primaryEvidenceDetail?: string;
  aiEvidenceState: "Available" | "Unavailable" | "Not requested";
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
      currentReportCount: scoped.filter((report) => report.copyEligible === true && report.freshness === "current").length,
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
  const primaryEvidenceDetail = firstRequirement?.gaps[0] ??
    (firstRequirement?.status === "partial"
      ? "Some evidence is linked, but coverage is incomplete."
      : firstRequirement
        ? "Review the linked evidence for this requirement."
        : "No explicit requirement or PR objective was found.");

  return {
    freshness: freshnessLabel(detail.freshness, detail.staleAt),
    checkState: toCheckState(detail.report?.testing),
    primaryEvidenceState: toEvidenceState(firstRequirement?.status, firstRequirement?.gaps.length ?? 0),
    primaryEvidenceDetail,
    aiEvidenceState: toAiEvidenceState(detail.report),
    inspectFirst: firstPriorityPath ?? firstEvidencePath ?? "Unavailable",
    githubUrl: buildGitHubPullUrl(detail.repositoryFullName, detail.pullRequestNumber)
  };
}

function freshnessLabel(freshness: DashboardReportFreshness | undefined, staleAt: string | undefined): QuickSummary["freshness"] {
  if (freshness === "current") return "CURRENT";
  if (freshness === "refreshing") return "REFRESHING";
  if (freshness === "refresh_failed") return "REFRESH FAILED";
  if (freshness === "superseded") return "SUPERSEDED";
  if (freshness === "stale") return "STALE";
  if (freshness === "unknown") return "UNKNOWN";
  if (staleAt) return "STALE";
  return "UNKNOWN";
}

function toAiEvidenceState(report: DashboardReportDetail["report"]): QuickSummary["aiEvidenceState"] {
  if (report?.semantic) return "Available";
  if (report?.semanticAnalysis?.status === "unavailable") return "Unavailable";
  return "Not requested";
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
