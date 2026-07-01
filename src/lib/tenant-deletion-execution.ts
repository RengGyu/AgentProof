import {
  countTenantActiveAnalysisJobsForDeletion,
  purgeTenantAnalysisJobsForDeletion,
  type TenantActiveAnalysisJobDeletionCount
} from "./analysis-jobs";
import { purgeTenantSavedReportsForDeletion } from "./server-report-store";
import { disableTenantRepositoryGrantsForTenantDeletion } from "./tenant-control-plane";
import {
  isTenantDeletionActiveAsync,
  markTenantDeletionStartedIfConfiguredAsync
} from "./tenant-deletion-state";
import {
  buildTenantDeletionPreview,
  type TenantDeletionPreview,
  type TenantDeletionPreviewCategory,
  type TenantDeletionPreviewCategoryKey
} from "./tenant-deletion-preview";

export type TenantDeletionExecutionActionKey =
  | "review_retention_policy"
  | "block_new_work"
  | "purge_saved_reports"
  | "drain_analysis_jobs"
  | "purge_analysis_jobs";

export type TenantDeletionExecutionActionStatus =
  | "ready"
  | "completed"
  | "blocked"
  | "manual_review_required"
  | "unavailable"
  | "skipped";

export type TenantDeletionExecutionReason =
  | "draft_retention_policy"
  | "manual_store_review_required"
  | "store_unavailable"
  | "store_disabled"
  | "block_new_work_first"
  | "active_analysis_jobs_present"
  | "analysis_job_rollup_truncated"
  | "no_active_analysis_jobs"
  | "saved_reports_ready"
  | "saved_report_purge_completed"
  | "tenant_repository_grants_disabled"
  | "analysis_job_purge_completed"
  | "analysis_job_store_disabled";

export interface TenantDeletionExecutionAction {
  key: TenantDeletionExecutionActionKey;
  status: TenantDeletionExecutionActionStatus;
  reason: TenantDeletionExecutionReason;
  count?: number;
  counts?: {
    activeJobs?: number;
    queuedJobs?: number;
    processingJobs?: number;
    retryingJobs?: number;
    deletedJobs?: number;
    deletedReports?: number;
  };
}

export interface TenantDeletionExecutionPlan {
  ok: true;
  privacy: "tenant-deletion-execution-plan-metadata-only";
  mode: "internal-execution-plan";
  destructiveDataDeletion: false;
  actions: TenantDeletionExecutionAction[];
  totals: {
    knownCount: number;
    unavailableCategories: number;
  };
  guardrails: {
    returnsMetadataOnly: true;
    requiresNewWorkBlockedBeforePurge: true;
    requiresDeletionStateBeforePurge: true;
    requiresActiveJobsDrainedBeforePurge: true;
    requiresRetentionPolicyReview: true;
  };
  next:
    | "review_retention_policy_before_delete"
    | "block_new_work_before_deletion"
    | "purge_saved_reports"
    | "drain_analysis_jobs_before_purge"
    | "purge_analysis_jobs";
}

export interface TenantDeletionNewWorkBlockResult {
  ok: true;
  privacy: "tenant-deletion-new-work-block-metadata-only";
  phase: "block_new_work";
  destructiveDataDeletion: false;
  status: "completed" | "manual_review_required" | "unavailable";
  reason:
    | "tenant_repository_grants_disabled"
    | "manual_store_review_required"
    | "store_unavailable";
  grantDisable: {
    matchedCount: number;
    disabledCount: number;
  };
  next:
    | "drain_analysis_jobs_before_purge"
    | "manual_review_repository_grants_before_deletion"
    | "fix_repository_grant_store_before_deletion";
}

export interface TenantDeletionSavedReportPurgeResult {
  ok: true;
  privacy: "tenant-deletion-saved-report-purge-metadata-only";
  phase: "purge_saved_reports";
  destructiveDataDeletion: true;
  status: "completed" | "blocked" | "unavailable";
  reason:
    | "saved_report_purge_completed"
    | "block_new_work_first"
    | "store_unavailable";
  deletedCount: number;
  countBasis?: "exact-delete-count" | "pre-delete-count";
  next:
    | "continue_deletion_workflow"
    | "block_new_work_before_purge"
    | "fix_saved_report_store_before_purge";
}

export interface TenantDeletionAnalysisJobPurgeResult {
  ok: true;
  privacy: "tenant-deletion-analysis-job-purge-metadata-only";
  phase: "purge_analysis_jobs";
  destructiveDataDeletion: true;
  status: "completed" | "blocked" | "unavailable" | "skipped";
  reason:
    | "analysis_job_purge_completed"
    | "block_new_work_first"
    | "active_analysis_jobs_present"
    | "analysis_job_rollup_truncated"
    | "analysis_job_store_disabled"
    | "store_unavailable";
  deletedCount: number;
  countBasis?: "disabled-store-count" | "exact-delete-count" | "pre-delete-count";
  counts?: {
    activeJobs?: number;
    retryingJobs?: number;
    sampledJobs?: number;
  };
  next:
    | "continue_deletion_workflow"
    | "block_new_work_before_purge"
    | "drain_analysis_jobs_before_purge"
    | "fix_analysis_job_store_before_purge";
}

export type TenantDeletionGuardedStepResult =
  | TenantDeletionNewWorkBlockResult
  | TenantDeletionSavedReportPurgeResult
  | TenantDeletionAnalysisJobPurgeResult;

export class TenantDeletionExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantDeletionExecutionError";
  }
}

export async function buildTenantDeletionExecutionPlan(
  input: { tenantId?: unknown; newWorkBlocked?: boolean },
  env = process.env
): Promise<TenantDeletionExecutionPlan> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionExecutionError("Tenant id is invalid.");
  }

  const preview = await buildTenantDeletionPreview({ tenantId }, env);
  const newWorkBlocked = input.newWorkBlocked === true
    || await getTenantDeletionStateActiveOrNull(tenantId, env) === true;
  const activeJobs = await getActiveAnalysisJobCountOrNull(tenantId, env);
  const repositoryGrants = findCategory(preview, "repository_grants");
  const savedReports = findCategory(preview, "saved_reports");
  const analysisJobs = findCategory(preview, "analysis_jobs");
  const blockNewWorkAction = buildBlockNewWorkPlanAction(repositoryGrants, newWorkBlocked);
  const savedReportPurgeAction = buildPurgeSavedReportsPlanAction({
    category: savedReports,
    newWorkBlocked
  });
  const drainAction = buildDrainAnalysisJobsPlanAction(activeJobs);
  const purgeAction = buildPurgeAnalysisJobsPlanAction({
    category: analysisJobs,
    activeJobs,
    newWorkBlocked
  });

  return {
    ok: true,
    privacy: "tenant-deletion-execution-plan-metadata-only",
    mode: "internal-execution-plan",
    destructiveDataDeletion: false,
    actions: [
      {
        key: "review_retention_policy",
        status: "manual_review_required",
        reason: "draft_retention_policy"
      },
      blockNewWorkAction,
      savedReportPurgeAction,
      drainAction,
      purgeAction
    ],
    totals: {
      knownCount: preview.totals.knownCount,
      unavailableCategories: preview.totals.unavailableCategories
    },
    guardrails: {
      returnsMetadataOnly: true,
      requiresNewWorkBlockedBeforePurge: true,
      requiresDeletionStateBeforePurge: true,
      requiresActiveJobsDrainedBeforePurge: true,
      requiresRetentionPolicyReview: true
    },
    next: nextExecutionStep(blockNewWorkAction, savedReportPurgeAction, drainAction, purgeAction)
  };
}

export async function blockTenantDeletionNewWork(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantDeletionNewWorkBlockResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionExecutionError("Tenant id is invalid.");
  }

  try {
    await markTenantDeletionStartedIfConfiguredAsync({ tenantId }, env);
    const result = await disableTenantRepositoryGrantsForTenantDeletion({ tenantId }, env);
    if (result.manualReviewRequired) {
      return {
        ok: true,
        privacy: "tenant-deletion-new-work-block-metadata-only",
        phase: "block_new_work",
        destructiveDataDeletion: false,
        status: "manual_review_required",
        reason: "manual_store_review_required",
        grantDisable: {
          matchedCount: result.matchedCount,
          disabledCount: result.disabledCount
        },
        next: "manual_review_repository_grants_before_deletion"
      };
    }

    return {
      ok: true,
      privacy: "tenant-deletion-new-work-block-metadata-only",
      phase: "block_new_work",
      destructiveDataDeletion: false,
      status: "completed",
      reason: "tenant_repository_grants_disabled",
      grantDisable: {
        matchedCount: result.matchedCount,
        disabledCount: result.disabledCount
      },
      next: "drain_analysis_jobs_before_purge"
    };
  } catch {
    return {
      ok: true,
      privacy: "tenant-deletion-new-work-block-metadata-only",
      phase: "block_new_work",
      destructiveDataDeletion: false,
      status: "unavailable",
      reason: "store_unavailable",
      grantDisable: {
        matchedCount: 0,
        disabledCount: 0
      },
      next: "fix_repository_grant_store_before_deletion"
    };
  }
}

export async function purgeTenantDeletionSavedReportsWhenSafe(
  input: { tenantId?: unknown; newWorkBlocked?: boolean },
  env = process.env
): Promise<TenantDeletionSavedReportPurgeResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionExecutionError("Tenant id is invalid.");
  }

  if (input.newWorkBlocked !== true) {
    return {
      ok: true,
      privacy: "tenant-deletion-saved-report-purge-metadata-only",
      phase: "purge_saved_reports",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "block_new_work_first",
      deletedCount: 0,
      next: "block_new_work_before_purge"
    };
  }

  const deletionStateActive = await getTenantDeletionStateActiveOrNull(tenantId, env);
  if (deletionStateActive !== true) {
    return deletionStateActive === null
      ? unavailableSavedReportPurgeResult()
      : {
          ok: true,
          privacy: "tenant-deletion-saved-report-purge-metadata-only",
          phase: "purge_saved_reports",
          destructiveDataDeletion: true,
          status: "blocked",
          reason: "block_new_work_first",
          deletedCount: 0,
          next: "block_new_work_before_purge"
        };
  }

  try {
    const result = await purgeTenantSavedReportsForDeletion({ tenantId });

    return {
      ok: true,
      privacy: "tenant-deletion-saved-report-purge-metadata-only",
      phase: "purge_saved_reports",
      destructiveDataDeletion: true,
      status: "completed",
      reason: "saved_report_purge_completed",
      deletedCount: result.deletedCount,
      countBasis: publicSavedReportPurgeCountBasis(result.countBasis),
      next: "continue_deletion_workflow"
    };
  } catch {
    return unavailableSavedReportPurgeResult();
  }
}

export async function purgeTenantDeletionAnalysisJobsWhenSafe(
  input: { tenantId?: unknown; newWorkBlocked?: boolean },
  env = process.env
): Promise<TenantDeletionAnalysisJobPurgeResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionExecutionError("Tenant id is invalid.");
  }

  if (input.newWorkBlocked !== true) {
    return {
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "block_new_work_first",
      deletedCount: 0,
      next: "block_new_work_before_purge"
    };
  }

  const deletionStateActive = await getTenantDeletionStateActiveOrNull(tenantId, env);
  if (deletionStateActive !== true) {
    return deletionStateActive === null
      ? unavailableAnalysisJobPurgeResult()
      : {
          ok: true,
          privacy: "tenant-deletion-analysis-job-purge-metadata-only",
          phase: "purge_analysis_jobs",
          destructiveDataDeletion: true,
          status: "blocked",
          reason: "block_new_work_first",
          deletedCount: 0,
          next: "block_new_work_before_purge"
        };
  }

  const activeJobs = await getActiveAnalysisJobCountOrNull(tenantId, env);
  if (!activeJobs) {
    return unavailableAnalysisJobPurgeResult();
  }

  if (activeJobs.disabled) {
    return {
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "skipped",
      reason: "analysis_job_store_disabled",
      deletedCount: 0,
      countBasis: "disabled-store-count",
      next: "continue_deletion_workflow"
    };
  }

  if (activeJobs.count > 0) {
    return {
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "active_analysis_jobs_present",
      deletedCount: 0,
      counts: activeJobCounts(activeJobs),
      next: "drain_analysis_jobs_before_purge"
    };
  }

  try {
    const result = await purgeTenantAnalysisJobsForDeletion({ tenantId }, env);
    if (result.disabled) {
      return {
        ok: true,
        privacy: "tenant-deletion-analysis-job-purge-metadata-only",
        phase: "purge_analysis_jobs",
        destructiveDataDeletion: true,
        status: "skipped",
        reason: "analysis_job_store_disabled",
        deletedCount: 0,
        countBasis: "disabled-store-count",
        next: "continue_deletion_workflow"
      };
    }

    return {
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "completed",
      reason: "analysis_job_purge_completed",
      deletedCount: result.deletedCount,
      countBasis: publicPurgeCountBasis(result.countBasis),
      next: "continue_deletion_workflow"
    };
  } catch {
    return unavailableAnalysisJobPurgeResult();
  }
}

export async function runTenantDeletionGuardedStep(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantDeletionGuardedStepResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionExecutionError("Tenant id is invalid.");
  }

  const plan = await buildTenantDeletionExecutionPlan({ tenantId }, env);
  if (plan.next === "block_new_work_before_deletion") {
    return blockTenantDeletionNewWork({ tenantId }, env);
  }

  const block = await blockTenantDeletionNewWork({ tenantId }, env);
  if (block.status !== "completed") {
    return block;
  }

  if (plan.next === "purge_saved_reports") {
    return purgeTenantDeletionSavedReportsWhenSafe({
      tenantId,
      newWorkBlocked: true
    }, env);
  }

  const savedReports = await purgeTenantDeletionSavedReportsWhenSafe({
    tenantId,
    newWorkBlocked: true
  }, env);
  if (savedReports.status !== "completed" || savedReports.deletedCount > 0) {
    return savedReports;
  }

  return purgeTenantDeletionAnalysisJobsWhenSafe({
    tenantId,
    newWorkBlocked: true
  }, env);
}

function buildBlockNewWorkPlanAction(
  category: TenantDeletionPreviewCategory | null,
  newWorkBlocked: boolean
): TenantDeletionExecutionAction {
  if (!category || category.status === "unavailable") {
    return {
      key: "block_new_work",
      status: "unavailable",
      reason: "store_unavailable"
    };
  }

  if (newWorkBlocked) {
    return {
      key: "block_new_work",
      status: "completed",
      reason: "tenant_repository_grants_disabled",
      count: category.count
    };
  }

  if (category.status === "manual_review_required") {
    return {
      key: "block_new_work",
      status: "manual_review_required",
      reason: "manual_store_review_required",
      count: category.count
    };
  }

  if (category.status === "disabled") {
    return {
      key: "block_new_work",
      status: "skipped",
      reason: "store_disabled",
      count: category.count
    };
  }

  return {
    key: "block_new_work",
    status: "ready",
    reason: "tenant_repository_grants_disabled",
    count: category.count
  };
}

function buildDrainAnalysisJobsPlanAction(
  activeJobs: TenantActiveAnalysisJobDeletionCount | null
): TenantDeletionExecutionAction {
  if (!activeJobs) {
    return {
      key: "drain_analysis_jobs",
      status: "unavailable",
      reason: "store_unavailable"
    };
  }

  if (activeJobs.disabled) {
    return {
      key: "drain_analysis_jobs",
      status: "skipped",
      reason: "analysis_job_store_disabled",
      counts: activeJobCounts(activeJobs)
    };
  }

  if (activeJobs.count > 0) {
    return {
      key: "drain_analysis_jobs",
      status: "blocked",
      reason: "active_analysis_jobs_present",
      counts: activeJobCounts(activeJobs)
    };
  }

  return {
    key: "drain_analysis_jobs",
    status: "completed",
    reason: "no_active_analysis_jobs",
    counts: activeJobCounts(activeJobs)
  };
}

function buildPurgeSavedReportsPlanAction(input: {
  category: TenantDeletionPreviewCategory | null;
  newWorkBlocked: boolean;
}): TenantDeletionExecutionAction {
  if (!input.category || input.category.status === "unavailable") {
    return {
      key: "purge_saved_reports",
      status: "unavailable",
      reason: "store_unavailable"
    };
  }

  if (!input.newWorkBlocked) {
    return {
      key: "purge_saved_reports",
      status: "blocked",
      reason: "block_new_work_first",
      count: input.category.count
    };
  }

  if (input.category.count === 0) {
    return {
      key: "purge_saved_reports",
      status: "completed",
      reason: "saved_report_purge_completed",
      count: 0
    };
  }

  return {
    key: "purge_saved_reports",
    status: "ready",
    reason: "saved_reports_ready",
    count: input.category.count
  };
}

function buildPurgeAnalysisJobsPlanAction(input: {
  category: TenantDeletionPreviewCategory | null;
  activeJobs: TenantActiveAnalysisJobDeletionCount | null;
  newWorkBlocked: boolean;
}): TenantDeletionExecutionAction {
  if (!input.category || input.category.status === "unavailable" || !input.activeJobs) {
    return {
      key: "purge_analysis_jobs",
      status: "unavailable",
      reason: "store_unavailable"
    };
  }

  if (input.category.status === "disabled" || input.activeJobs.disabled) {
    return {
      key: "purge_analysis_jobs",
      status: "skipped",
      reason: "analysis_job_store_disabled",
      count: input.category.count
    };
  }

  if (!input.newWorkBlocked) {
    return {
      key: "purge_analysis_jobs",
      status: "blocked",
      reason: "block_new_work_first",
      count: input.category.count
    };
  }

  if (input.activeJobs.count > 0) {
    return {
      key: "purge_analysis_jobs",
      status: "blocked",
      reason: "active_analysis_jobs_present",
      count: input.category.count,
      counts: activeJobCounts(input.activeJobs)
    };
  }

  return {
    key: "purge_analysis_jobs",
    status: "ready",
    reason: "no_active_analysis_jobs",
    count: input.category.count,
    counts: activeJobCounts(input.activeJobs)
  };
}

function nextExecutionStep(
  blockNewWorkAction: TenantDeletionExecutionAction,
  savedReportPurgeAction: TenantDeletionExecutionAction,
  drainAction: TenantDeletionExecutionAction,
  purgeAction: TenantDeletionExecutionAction
): TenantDeletionExecutionPlan["next"] {
  if (blockNewWorkAction.status === "ready" || blockNewWorkAction.status === "manual_review_required") {
    return "block_new_work_before_deletion";
  }

  if (savedReportPurgeAction.status === "ready") {
    return "purge_saved_reports";
  }

  if (drainAction.status === "blocked" || drainAction.status === "unavailable") {
    return "drain_analysis_jobs_before_purge";
  }

  if (purgeAction.status === "ready") {
    return "purge_analysis_jobs";
  }

  return "review_retention_policy_before_delete";
}

function activeJobCounts(activeJobs: TenantActiveAnalysisJobDeletionCount): TenantDeletionExecutionAction["counts"] {
  return {
    activeJobs: activeJobs.count,
    queuedJobs: activeJobs.statusCounts.queued,
    processingJobs: activeJobs.statusCounts.processing,
    retryingJobs: activeJobs.statusCounts.failed_retryable
  };
}

async function getActiveAnalysisJobCountOrNull(
  tenantId: string,
  env: NodeJS.ProcessEnv
): Promise<TenantActiveAnalysisJobDeletionCount | null> {
  try {
    return await countTenantActiveAnalysisJobsForDeletion({ tenantId }, env);
  } catch {
    return null;
  }
}

async function getTenantDeletionStateActiveOrNull(
  tenantId: string,
  env: NodeJS.ProcessEnv
): Promise<boolean | null> {
  try {
    return await isTenantDeletionActiveAsync({ tenantId }, env);
  } catch {
    return null;
  }
}

function findCategory(
  preview: TenantDeletionPreview,
  key: TenantDeletionPreviewCategoryKey
): TenantDeletionPreviewCategory | null {
  return preview.categories.find((category) => category.key === key) ?? null;
}

function publicPurgeCountBasis(
  countBasis: "disabled-store-count" | "exact-memory-delete-count" | "pre-delete-supabase-count"
): TenantDeletionAnalysisJobPurgeResult["countBasis"] {
  if (countBasis === "exact-memory-delete-count") return "exact-delete-count";
  if (countBasis === "pre-delete-supabase-count") return "pre-delete-count";
  return countBasis;
}

function publicSavedReportPurgeCountBasis(
  countBasis: "exact-memory-delete-count" | "pre-delete-supabase-count"
): TenantDeletionSavedReportPurgeResult["countBasis"] {
  if (countBasis === "exact-memory-delete-count") return "exact-delete-count";
  return "pre-delete-count";
}

function unavailableSavedReportPurgeResult(): TenantDeletionSavedReportPurgeResult {
  return {
    ok: true,
    privacy: "tenant-deletion-saved-report-purge-metadata-only",
    phase: "purge_saved_reports",
    destructiveDataDeletion: true,
    status: "unavailable",
    reason: "store_unavailable",
    deletedCount: 0,
    next: "fix_saved_report_store_before_purge"
  };
}

function unavailableAnalysisJobPurgeResult(): TenantDeletionAnalysisJobPurgeResult {
  return {
    ok: true,
    privacy: "tenant-deletion-analysis-job-purge-metadata-only",
    phase: "purge_analysis_jobs",
    destructiveDataDeletion: true,
    status: "unavailable",
    reason: "store_unavailable",
    deletedCount: 0,
    next: "fix_analysis_job_store_before_purge"
  };
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}
