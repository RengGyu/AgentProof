import type { LlmSemanticOutput } from "./llm-semantic-output";
import type { EvidenceItem, EvidenceKind, GeneralPrAssessmentSummaryV1, HybridPlannerProvenance, RequirementAuthority, RequirementProofAxis, RequirementStatus } from "./types";
import type { VerificationContractStateV2 } from "./verification-contract-v2";

export interface DashboardRepositoryGrant {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
  llmAnalysisMode?: "essential" | "enhanced";
  reportLanguage?: import("./tenant-report-language").ReportLanguage;
  hybridPlannerConsentVersion?: "2026-08-12.v1" | null;
  privateAnalysisConsentVersion?: "2026-09-24.v1" | null;
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
  availability?: "available" | "unavailable" | "analysis_failed";
  verificationOutcome?: DashboardVerificationOutcome;
  failure?: {
    code?: string;
    summary?: string;
  };
}

export type DashboardVerificationOutcome =
  | "supported"
  | "partial"
  | "contract_missing"
  | "contract_invalid"
  | "unclear";

export type DashboardReportFreshness = "current" | "refreshing" | "refresh_failed" | "superseded" | "stale" | "unknown";

export interface DashboardReportDetail extends Omit<DashboardSavedReport, "id" | "priority" | "createdAt"> {
  id?: string;
  createdAt?: string;
  priority?: string;
  evidenceCapturedAt?: string;
  analysisContext?: "linked_issue" | "unlinked_pr" | "provided_requirement";
  report?: {
    requirements?: Array<{ requirementId: string; requirementText?: string; status: string; evidenceStatus?: RequirementStatus; sourceAuthority?: RequirementAuthority; evidenceRefs: string[]; gaps: string[]; proofAxes?: RequirementProofAxis[] }>;
    testing?: { ciStatus: string; lintStatus: string; typecheckStatus: string };
    reviewPriority?: Array<{ path: string; priority: string }>;
    evidenceIndex?: Array<{ id: string; kind?: EvidenceKind; locator?: string; codeLocation?: EvidenceItem["codeLocation"] }>;
    reprompt?: { prompt: string };
    semantic?: LlmSemanticOutput;
    semanticAnalysis?: { status: "included" | "unavailable"; attempts: 1 | 2 };
    planner?: HybridPlannerProvenance;
    reportSchemaVersion?: "verification-report.v2";
    verificationContract?: { state: VerificationContractStateV2 };
    generalPrAssessmentSummary?: GeneralPrAssessmentSummaryV1;
    authenticity?: import("./types").ReportAuthenticity;
    reviewCandidates?: import("./review-candidates").ReviewCandidatesV1;
    ordinaryDocumentationSummary?: import("./general-pr-documentation-presentation").OrdinaryDocumentationSummary;
    purposeReview?: import("./purpose-contract").PurposeReview;
  purposeAssessmentSummary?: import("./purpose-contract").PurposeAssessmentSummary;
    ordinaryStaticSummary?: import("./general-pr-static-types-presentation").OrdinaryStaticSummary;
  };
}

export interface RepositoryWorkspaceRow extends DashboardRepositoryGrant {
  reportCount: number;
  currentReportCount: number;
  latestReport?: DashboardSavedReport;
  commentsEnabled: boolean;
}

export interface QuickSummary {
  freshness: "CURRENT" | "REFRESHING" | "REFRESH FAILED" | "SUPERSEDED" | "STALE" | "SAVED";
  checkState: string;
  primaryEvidenceState: "Evidence found" | "Evidence missing" | "Some evidence linked" | "No verified evidence conclusion" | "Unavailable";
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
  if (status === "partial") return "Some evidence linked";
  if (status === "missing") return "Evidence missing";
  return "No verified evidence conclusion";
}

export function verificationOutcomeLabel(outcome: DashboardVerificationOutcome | undefined): string {
  if (outcome === "supported") return "SUPPORTED";
  if (outcome === "partial") return "PARTIALLY SUPPORTED";
  if (outcome === "contract_missing") return "CONTRACT MISSING";
  if (outcome === "contract_invalid") return "CONTRACT INVALID";
  return "UNCLEAR";
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

export function isActiveRepositoryGrant(repository: DashboardRepositoryGrant): boolean {
  return repository.enabled && repository.analysisEnabled &&
    (repository.repositoryPrivate !== true || repository.privateAnalysisConsentVersion === "2026-09-24.v1");
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
  if (freshness === "unknown") return "SAVED";
  if (staleAt) return "STALE";
  return "SAVED";
}

function toAiEvidenceState(report: DashboardReportDetail["report"]): QuickSummary["aiEvidenceState"] {
  if (report?.semantic) return "Available";
  if (report?.semanticAnalysis?.status === "unavailable") return "Unavailable";
  return "Not requested";
}

export function observedCheckResults(testing: NonNullable<DashboardReportDetail["report"]>["testing"]): Array<{ label: "CI" | "Lint" | "Typecheck"; status: "passed" | "failed" | "pending" }> {
  if (!testing) return [];
  const entries = [
    { label: "CI" as const, status: testing.ciStatus },
    { label: "Lint" as const, status: testing.lintStatus },
    { label: "Typecheck" as const, status: testing.typecheckStatus }
  ];
  return entries.filter((entry): entry is { label: "CI" | "Lint" | "Typecheck"; status: "passed" | "failed" | "pending" } =>
    entry.status === "passed" || entry.status === "failed" || entry.status === "pending");
}

function toCheckState(testing: NonNullable<DashboardReportDetail["report"]>["testing"]): QuickSummary["checkState"] {
  const observed = observedCheckResults(testing);
  const primary = observed.find((entry) => entry.status === "failed") ?? observed.find((entry) => entry.status === "pending") ?? observed[0];
  return primary ? `${primary.label} ${primary.status}` : "No check results collected";
}

function toEvidenceState(status: string | undefined, gapCount: number): QuickSummary["primaryEvidenceState"] {
  if (!status) return "Unavailable";
  if (status === "missing") return "Evidence missing";
  if (status === "partial") return "Some evidence linked";
  if (status === "unclear") return "No verified evidence conclusion";
  if (gapCount > 0) return "Evidence missing";
  return "Evidence found";
}

function safeLocator(value: string | undefined): string | undefined {
  return value && SAFE_LOCATOR.test(value) && !value.startsWith("/") && !value.includes("..") ? value : undefined;
}

// Keep private job codes/summaries in their existing store, not in reviewer-facing prose.
const ANALYSIS_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  "private-consent-required": "Private repository analysis is off until its code-analysis notice is accepted. Open repository settings to continue.",
  github_private_consent_required: "Private repository analysis is off until its code-analysis notice is accepted. Open repository settings to continue.",
  "analysis-disabled": "Analysis is off for this repository. Open repository settings to enable it.",
  "grant-disabled": "Repository access is off. Check the repository connection in Settings.",
  github_save_reports_disabled: "Saved reports are off for this repository. Open repository settings before generating a saved report.",
  github_connection_required: "Check the repository connection in Settings before generating a saved report.",
  github_install_required: "Connect this repository in Settings before generating a saved report.",
  github_private_denied: "Private repository access is unavailable. Check repository access in Settings.",
  github_reauth_required: "Sign in again before generating a saved report.",
  workspace_connection_required: "Check the repository connection in Settings before generating a saved report.",
  github_app_pr_head_changed: "The PR changed during analysis. Start a new analysis for its current version.",
  github_fetch_failed: "GitHub could not be reached. Try again shortly.",
  github_rate_limited: "GitHub is temporarily limiting requests. Wait before trying again.",
  github_secondary_rate_limited: "GitHub is temporarily limiting requests. Wait before trying again.",
  soft_stop: "The paid analysis limit has been reached. Wait before starting another analysis.",
  hard_pause: "Paid analysis is temporarily paused. Existing saved reports remain available.",
  duplicate: "Analysis is already in progress. Check saved reports before starting another.",
  workspace_session_changed: "Sign in again before generating a saved report."
};
const ANALYSIS_FAILURE_DEFAULT = "Analysis did not finish. Existing saved reports remain available.";

export function dashboardAnalysisFailureMessage(failure?: { code?: string; summary?: string }): string {
  if (typeof failure?.code === "string" && Object.hasOwn(ANALYSIS_FAILURE_MESSAGES, failure.code)) return ANALYSIS_FAILURE_MESSAGES[failure.code];
  // A projected DTO has no code; accept only exact messages produced here, including legacy reads.
  if (!failure?.code && typeof failure?.summary === "string" && Object.values(ANALYSIS_FAILURE_MESSAGES).includes(failure.summary)) return failure.summary;
  return ANALYSIS_FAILURE_DEFAULT;
}

/** Safe queue acknowledgement/status; no provider payload or internal error is public. */
export interface DashboardAnalysisJob {
  id: string; revision: number; updatedAt: string;
  repositoryId: number; pullRequestNumber: number; headSha: string;
  status: 'queued' | 'running' | 'saved' | 'failed' | 'unknown' | 'superseded';
  reportId?: string;
}
export function isDashboardAnalysisJob(value: unknown): value is DashboardAnalysisJob {
  if(!value || typeof value!=='object')return false;
  const v=value as DashboardAnalysisJob;
  return typeof v.id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.id) &&
    Number.isSafeInteger(v.revision) && v.revision>0 && Number.isSafeInteger(v.repositoryId) && v.repositoryId>0 &&
    Number.isSafeInteger(v.pullRequestNumber) && v.pullRequestNumber>0 && /^[a-f0-9]{40}$/i.test(v.headSha) &&
    typeof v.updatedAt==='string' && Number.isFinite(Date.parse(v.updatedAt)) &&
    ['queued','running','saved','failed','unknown','superseded'].includes(v.status) &&
    (v.reportId===undefined || typeof v.reportId==='string' && /^[a-zA-Z0-9_-]{1,180}$/.test(v.reportId));
}
