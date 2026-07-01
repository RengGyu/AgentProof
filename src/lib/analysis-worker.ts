import {
  completeAnalysisJob,
  claimNextAnalysisJob,
  failAnalysisJob,
  type AnalysisJobResultSummary,
  type AnalysisJobClaimOptions,
  type AnalysisJobRow
} from "./analysis-jobs";
import { getAuditLogStoreStatus, recordAuditEvent, AuditLogError } from "./audit-log";
import { buildGitHubPullRequestInput, GitHubFetchError } from "./github";
import {
  createGitHubInstallationAccessToken,
  getGitHubAppAutomationSettings,
  getGitHubAppConfigStatus,
  GitHubAppTokenError,
  isGitHubAppRepoAllowed
} from "./github-app";
import {
  createAutomationSavedReport,
  GitHubAppCommentError,
  postGitHubAppMarkerComment
} from "./github-app-side-effects";
import { redactSecrets } from "./redact";
import { validateVerificationReport } from "./report-validation";
import { SavedReportStoreError } from "./server-report-store";
import {
  assertSlackReportNotificationConfigured,
  sendSlackReportSummary,
  SlackNotificationError
} from "./slack";
import {
  authorizeTenantRepositoryGrantAsync,
  tenantGrantPublicReason,
  TenantControlPlaneStoreError
} from "./tenant-control-plane";
import {
  assertTenantDeletionNotActiveAsync,
  TenantDeletionStateError
} from "./tenant-deletion-state";
import {
  assertTenantPlanAllowsGitHubAppAnalysis,
  clampTenantPlanSideEffects,
  UsageQuotaStoreError
} from "./usage-quota";
import { generateVerificationReport } from "./verifier";

export const DEFAULT_ANALYSIS_WORKER_BATCH_LIMIT = 1;
export const MAX_ANALYSIS_WORKER_BATCH_LIMIT = 5;
const TENANT_DELETION_ACTIVE_ERROR = "Tenant deletion is in progress.";

export type AnalysisWorkerPreflightStatus =
  | "idle"
  | "ready"
  | "failed_retryable"
  | "failed_terminal";

export interface AnalysisWorkerPreflightResult {
  status: AnalysisWorkerPreflightStatus;
  job?: AnalysisJobRow;
  reason?: string;
  sideEffects?: {
    saveReport: boolean;
    comment: boolean;
    slackSummary?: boolean;
  };
}

export interface RunAnalysisJobOptions extends AnalysisJobClaimOptions {
  requestUrl: string;
}

export interface RunAnalysisJobBatchOptions extends RunAnalysisJobOptions {
  limit?: number;
}

export interface AnalysisWorkerRunResult {
  status: AnalysisWorkerPreflightStatus | "completed";
  job?: AnalysisJobRow;
  reason?: string;
  resultSummary?: AnalysisJobResultSummary;
  sideEffects?: {
    saveReport: boolean;
    comment: boolean;
    slackSummary?: boolean;
  };
}

export type AnalysisWorkerBatchStopReason =
  | "idle"
  | "limit_reached"
  | "retryable_failure";

export interface AnalysisWorkerBatchResult {
  requestedLimit: number;
  processed: number;
  completed: number;
  failedRetryable: number;
  failedTerminal: number;
  idle: boolean;
  stoppedReason: AnalysisWorkerBatchStopReason;
  items: AnalysisWorkerRunResult[];
}

class AnalysisWorkerTerminalError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AnalysisWorkerTerminalError";
  }
}

class AnalysisWorkerRetryableError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AnalysisWorkerRetryableError";
  }
}

type WorkerSideEffects = {
  saveReport: boolean;
  comment: boolean;
  slackSummary?: boolean;
};

export async function preflightNextAnalysisJob(
  options: AnalysisJobClaimOptions = {},
  env = process.env
): Promise<AnalysisWorkerPreflightResult> {
  const claim = await claimNextAnalysisJob(options, env);
  if (!claim.job) {
    return { status: "idle" };
  }

  const job = claim.job;
  const appStatus = getGitHubAppConfigStatus(env);
  if (!appStatus.ready) {
    await failAnalysisJob({
      id: job.id,
      retryable: true,
      code: "github_app_not_ready",
      summary: "GitHub App credentials are not ready for analysis worker execution.",
      now: options.now
    }, env);

    return {
      status: "failed_retryable",
      reason: "github_app_not_ready"
    };
  }

  try {
    await assertWorkerTenantDeletionNotActive(job, env);
  } catch (error) {
    if (error instanceof AnalysisWorkerTerminalError || error instanceof AnalysisWorkerRetryableError) {
      await failAnalysisJob({
        id: job.id,
        retryable: error instanceof AnalysisWorkerRetryableError,
        code: error.code,
        summary: error.message,
        now: options.now
      }, env);

      return {
        status: error instanceof AnalysisWorkerRetryableError ? "failed_retryable" : "failed_terminal",
        reason: error.code
      };
    }

    throw error;
  }

  try {
    const grant = await authorizeTenantRepositoryGrantAsync({
      installationId: job.installation_id,
      repositoryId: job.repository_id ?? undefined,
      repositoryFullName: job.repository_full_name
    }, env);

    if (grant.required && !grant.grant) {
      const reason = tenantGrantPublicReason(grant.reason);
      await failAnalysisJob({
        id: job.id,
        retryable: false,
        code: grant.reason ?? "github_app_grant_denied",
        summary: reason,
        now: options.now
      }, env);

      return {
        status: "failed_terminal",
        reason: grant.reason ?? "github_app_grant_denied"
      };
    }

    if (grant.required && grant.reason) {
      const reason = tenantGrantPublicReason(grant.reason);
      await failAnalysisJob({
        id: job.id,
        retryable: false,
        code: grant.reason,
        summary: reason,
        now: options.now
      }, env);

      return {
        status: "failed_terminal",
        reason: grant.reason
      };
    }

    if (grant.required && grant.grant) {
      assertTenantPlanAllowsGitHubAppAnalysis({ tenantId: grant.grant.tenantId }, env);

      const sideEffects = clampTenantPlanSideEffects({
        tenantId: grant.grant.tenantId,
        saveReport: job.save_report && grant.grant.saveReportsEnabled,
        comment: job.comment && grant.grant.commentEnabled,
        slackSummary: job.slack_summary === true && grant.grant.slackNotificationsEnabled ? true : undefined
      }, env);

      return {
        status: "ready",
        job,
        sideEffects
      };
    }
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      await failAnalysisJob({
        id: job.id,
        retryable: true,
        code: "github_app_tenant_grant_store_unavailable",
        summary: "Tenant repository grant store is unavailable during analysis worker preflight.",
        now: options.now
      }, env);

      return {
        status: "failed_retryable",
        reason: "github_app_tenant_grant_store_unavailable"
      };
    }

    if (error instanceof UsageQuotaStoreError) {
      await failAnalysisJob({
        id: job.id,
        retryable: true,
        code: "github_app_plan_gate_unavailable",
        summary: "Tenant plan side-effect gate is unavailable during analysis worker preflight.",
        now: options.now
      }, env);

      return {
        status: "failed_retryable",
        reason: "github_app_plan_gate_unavailable"
      };
    }

    throw error;
  }

  const settings = getGitHubAppAutomationSettings(env);
  if (!settings.enabled || !isGitHubAppRepoAllowed(job.repository_full_name, settings)) {
    await failAnalysisJob({
      id: job.id,
      retryable: false,
      code: "github_app_repo_not_allowed",
      summary: "Repository is not allowed for GitHub App analysis worker execution.",
      now: options.now
    }, env);

    return {
      status: "failed_terminal",
      reason: "github_app_repo_not_allowed"
    };
  }

  return {
    status: "ready",
    job,
    sideEffects: {
      saveReport: job.save_report && settings.saveReportsEnabled,
      comment: job.comment && settings.commentEnabled
    }
  };
}

export async function runNextAnalysisJob(
  options: RunAnalysisJobOptions,
  env = process.env
): Promise<AnalysisWorkerRunResult> {
  const preflight = await preflightNextAnalysisJob(options, env);
  if (preflight.status !== "ready" || !preflight.job) {
    return preflight;
  }

  const job = preflight.job;
  const sideEffects = preflight.sideEffects ?? { saveReport: false, comment: false };

  try {
    await prepareWorkerSideEffects(job, sideEffects, env);
    await assertWorkerTenantDeletionNotActive(job, env);

    const token = await createGitHubInstallationAccessToken(job.installation_id, env);
    const input = await buildGitHubPullRequestInput(job.pull_request_url, token, "");

    if (!input) {
      throw new AnalysisWorkerRetryableError(
        "github_app_pr_input_unavailable",
        "GitHub App worker could not build a pull request input."
      );
    }

    input.limitations = [
      ...(input.limitations ?? []),
      "GitHub App queued worker v1 does not fetch linked issue/task text; requirements are extracted from the PR description unless the original request is included there."
    ];

    const report = generateVerificationReport(input);
    const validation = validateVerificationReport(report, { mode: "full" });

    if (!validation.valid) {
      throw new AnalysisWorkerTerminalError(
        "generated_report_validation_failed",
        `Generated report failed runtime validation: ${validation.errors.join("; ")}`
      );
    }

    const sideEffectsBeforeSave = await revalidateWorkerSideEffects(job, sideEffects, env);
    let saved: Awaited<ReturnType<typeof createAutomationSavedReport>> | undefined;
    if (sideEffectsBeforeSave.saveReport) {
      await assertWorkerTenantDeletionNotActive(job, env);
      saved = await createAutomationSavedReport(report, {
        requestUrl: options.requestUrl,
        tenantId: job.tenant_id ?? undefined
      });
    }

    const sideEffectsBeforeRemaining = (sideEffectsBeforeSave.comment || sideEffectsBeforeSave.slackSummary)
      ? await revalidateWorkerSideEffects(job, {
        saveReport: false,
        comment: sideEffectsBeforeSave.comment,
        ...(sideEffectsBeforeSave.slackSummary ? { slackSummary: true } : {})
      }, env)
      : sideEffectsBeforeSave;
    const sideEffectsBeforeSlack = sideEffectsBeforeRemaining.slackSummary
      ? await revalidateWorkerSideEffects(job, {
        saveReport: false,
        comment: false,
        slackSummary: true
      }, env)
      : sideEffectsBeforeRemaining;
    const completedSideEffects = {
      saveReport: sideEffectsBeforeSave.saveReport,
      comment: sideEffectsBeforeRemaining.comment,
      ...(sideEffectsBeforeSlack.slackSummary ? { slackSummary: true } : {})
    };
    let comment: Awaited<ReturnType<typeof postGitHubAppMarkerComment>> | undefined;
    if (completedSideEffects.comment) {
      await assertWorkerTenantDeletionNotActive(job, env);
      comment = await postGitHubAppMarkerComment({
        repositoryFullName: job.repository_full_name,
        pullRequestNumber: job.pull_request_number,
        pullRequestUrl: job.pull_request_url
      }, token, report);
    }
    let slack: Awaited<ReturnType<typeof sendSlackReportSummary>> | undefined;
    if (completedSideEffects.slackSummary) {
      await assertWorkerTenantDeletionNotActive(job, env);
      slack = await sendSlackReportSummary(report, {}, env);
    }

    const resultSummary: AnalysisJobResultSummary = {
      status: "completed",
      repository: job.repository_full_name,
      pullRequestNumber: job.pull_request_number,
      headSha: job.head_sha,
      priority: report.summary.priority,
      evidenceCoverage: report.summary.evidenceCoverage,
      savedReport: saved ? {
        privacy: saved.privacy,
        durability: saved.durability
      } : undefined,
      comment: comment ? {
        action: comment.action
      } : undefined,
      slack: slack ? {
        action: slack.action,
        privacy: slack.privacy
      } : undefined
    };

    await completeAnalysisJob({
      id: job.id,
      resultSummary,
      now: options.now
    }, env);

    await recordWorkerAudit("github_app_analysis_completed", "completed", job, {
      statusCode: 200,
      priority: resultSummary.priority,
      evidenceCoverage: resultSummary.evidenceCoverage,
      savedReport: resultSummary.savedReport,
      comment: resultSummary.comment,
      slack: resultSummary.slack
    }, env);

    return {
      status: "completed",
      job,
      resultSummary,
      sideEffects: completedSideEffects
    };
  } catch (error) {
    const failure = classifyWorkerFailure(error);
    await failAnalysisJob({
      id: job.id,
      retryable: failure.retryable,
      code: failure.code,
      summary: failure.summary,
      now: options.now
    }, env);
    await recordWorkerAudit("github_app_analysis_failed", "failed", job, {
      statusCode: failure.retryable ? 503 : 422,
      code: failure.code
    }, env);

    return {
      status: failure.retryable ? "failed_retryable" : "failed_terminal",
      job,
      reason: failure.code,
      sideEffects
    };
  }
}

export async function runAnalysisJobBatch(
  options: RunAnalysisJobBatchOptions,
  env = process.env
): Promise<AnalysisWorkerBatchResult> {
  const requestedLimit = normalizeBatchLimit(options.limit);
  const items: AnalysisWorkerRunResult[] = [];
  let idle = false;
  let stoppedReason: AnalysisWorkerBatchStopReason = "limit_reached";

  for (let index = 0; index < requestedLimit; index += 1) {
    const result = await runNextAnalysisJob({
      requestUrl: options.requestUrl,
      now: options.now,
      leaseMs: options.leaseMs
    }, env);

    if (result.status === "idle") {
      idle = true;
      stoppedReason = "idle";
      break;
    }

    items.push(result);

    if (result.status === "failed_retryable") {
      stoppedReason = "retryable_failure";
      break;
    }
  }

  return {
    requestedLimit,
    processed: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    failedRetryable: items.filter((item) => item.status === "failed_retryable").length,
    failedTerminal: items.filter((item) => item.status === "failed_terminal").length,
    idle,
    stoppedReason,
    items
  };
}

async function prepareWorkerSideEffects(
  job: AnalysisJobRow,
  sideEffects: WorkerSideEffects,
  env: NodeJS.ProcessEnv
): Promise<void> {
  if (!hasWorkerSideEffects(sideEffects)) return;
  if (sideEffects.slackSummary) {
    assertSlackReportNotificationConfigured(env);
  }

  if (!requiresDurableAuditForSideEffects(env)) return;

  const status = getAuditLogStoreStatus(env);
  if (!status.durable) {
    throw new AnalysisWorkerRetryableError(
      "github_app_durable_audit_required",
      "Durable audit storage is required before GitHub App worker side effects."
    );
  }

  try {
    await recordWorkerAudit("github_app_side_effects_ready", "completed", job, {
      statusCode: 200,
      code: sideEffectAuditCode(sideEffects),
      savedReport: sideEffects.saveReport ? {
        privacy: "summary-only"
      } : undefined,
      comment: sideEffects.comment ? {
        action: "planned"
      } : undefined,
      slack: sideEffects.slackSummary ? {
        action: "planned",
        privacy: "summary-only"
      } : undefined
    }, env, { swallowErrors: false });
  } catch (error) {
    if (error instanceof AuditLogError) {
      throw new AnalysisWorkerRetryableError(
        "github_app_durable_audit_required",
        "Durable audit storage is unavailable before GitHub App worker side effects."
      );
    }

    throw error;
  }
}

async function revalidateWorkerSideEffects(
  job: AnalysisJobRow,
  sideEffects: WorkerSideEffects,
  env: NodeJS.ProcessEnv
): Promise<WorkerSideEffects> {
  if (!hasWorkerSideEffects(sideEffects)) return sideEffects;

  try {
    const grant = await authorizeTenantRepositoryGrantAsync({
      installationId: job.installation_id,
      repositoryId: job.repository_id ?? undefined,
      repositoryFullName: job.repository_full_name
    }, env);

    if (grant.required && !grant.grant) {
      const code = grant.reason ?? "github_app_grant_denied";
      throw new AnalysisWorkerTerminalError(code, tenantGrantPublicReason(grant.reason));
    }

    if (grant.required && grant.reason) {
      throw new AnalysisWorkerTerminalError(grant.reason, tenantGrantPublicReason(grant.reason));
    }

    if (grant.required && grant.grant) {
      const grantedSideEffects = {
        saveReport: sideEffects.saveReport && grant.grant.saveReportsEnabled,
        comment: sideEffects.comment && grant.grant.commentEnabled,
        ...(sideEffects.slackSummary && grant.grant.slackNotificationsEnabled ? { slackSummary: true } : {})
      };

      return clampTenantPlanSideEffects({
        tenantId: grant.grant.tenantId,
        saveReport: grantedSideEffects.saveReport,
        comment: grantedSideEffects.comment,
        slackSummary: grantedSideEffects.slackSummary
      }, env);
    }
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      throw new AnalysisWorkerRetryableError(
        "github_app_tenant_grant_store_unavailable",
        "Tenant repository grant store is unavailable before GitHub App worker side effects."
      );
    }

    if (error instanceof UsageQuotaStoreError) {
      throw new AnalysisWorkerRetryableError(
        "github_app_plan_gate_unavailable",
        "Tenant plan side-effect gate is unavailable before GitHub App worker side effects."
      );
    }

    throw error;
  }

  const settings = getGitHubAppAutomationSettings(env);
  if (!settings.enabled || !isGitHubAppRepoAllowed(job.repository_full_name, settings)) {
    throw new AnalysisWorkerTerminalError(
      "github_app_repo_not_allowed",
      "Repository is not allowed for GitHub App analysis worker side effects."
    );
  }

  return {
    saveReport: sideEffects.saveReport && settings.saveReportsEnabled,
    comment: sideEffects.comment && settings.commentEnabled
  };
}

async function recordWorkerAudit(
  action: "github_app_analysis_completed" | "github_app_analysis_failed" | "github_app_side_effects_ready",
  result: "completed" | "failed",
  job: AnalysisJobRow,
  metadata: {
    statusCode?: number;
    code?: string;
    priority?: string;
    evidenceCoverage?: number;
    savedReport?: {
      privacy?: string;
      durability?: string;
    };
    comment?: {
      action?: string;
    };
    slack?: {
      action?: string;
      privacy?: string;
    };
  },
  env: NodeJS.ProcessEnv,
  options: { swallowErrors?: boolean } = {}
) {
  const write = recordAuditEvent({
    action,
    result,
    actor: "github_app",
    tenantId: job.tenant_id ?? undefined,
    repositoryFullName: job.repository_full_name,
    installationId: job.installation_id,
    pullRequestNumber: job.pull_request_number,
    headSha: job.head_sha,
    githubDeliveryId: job.delivery_id ?? undefined,
    webhookAction: job.action ?? undefined,
    statusCode: metadata.statusCode,
    code: metadata.code,
    priority: metadata.priority,
    evidenceCoverage: metadata.evidenceCoverage,
    savedReport: metadata.savedReport,
    comment: metadata.comment,
    slack: metadata.slack
  }, env);

  if (options.swallowErrors === false) {
    await write;
    return;
  }

  await write.catch(() => undefined);
}

function classifyWorkerFailure(error: unknown): { retryable: boolean; code: string; summary: string } {
  const summary = redactSecrets(error instanceof Error ? error.message : "Analysis worker failed.");

  if (error instanceof AnalysisWorkerTerminalError) {
    return { retryable: false, code: error.code, summary };
  }

  if (error instanceof AnalysisWorkerRetryableError) {
    return { retryable: true, code: error.code, summary };
  }

  if (error instanceof GitHubFetchError) {
    return {
      retryable: ["github_rate_limited", "github_secondary_rate_limited", "github_fetch_failed"].includes(error.code),
      code: error.code,
      summary
    };
  }

  if (error instanceof GitHubAppCommentError) {
    return {
      retryable: error.status === 429 || error.status >= 500,
      code: "github_app_comment_failed",
      summary
    };
  }

  if (error instanceof SavedReportStoreError) {
    return { retryable: true, code: "saved_report_store_error", summary };
  }

  if (error instanceof GitHubAppTokenError) {
    return { retryable: true, code: "github_app_token_failed", summary };
  }

  if (error instanceof SlackNotificationError) {
    return {
      retryable: error.status === undefined || error.status === 429 || error.status >= 500,
      code: error.code,
      summary
    };
  }

  return { retryable: true, code: "analysis_worker_failed", summary };
}

async function assertWorkerTenantDeletionNotActive(job: AnalysisJobRow, env: NodeJS.ProcessEnv): Promise<void> {
  try {
    await assertTenantDeletionNotActiveAsync({ tenantId: job.tenant_id ?? undefined }, env);
  } catch (error) {
    if (error instanceof TenantDeletionStateError) {
      if (error.message === TENANT_DELETION_ACTIVE_ERROR) {
        throw new AnalysisWorkerTerminalError("tenant-deletion-active", TENANT_DELETION_ACTIVE_ERROR);
      }

      throw new AnalysisWorkerRetryableError(
        "tenant_deletion_state_unavailable",
        "Tenant deletion state is unavailable during analysis worker execution."
      );
    }

    throw error;
  }
}

function requiresDurableAuditForSideEffects(env: NodeJS.ProcessEnv): boolean {
  return /^(1|true|yes|on)$/i.test(env.AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS ?? "");
}

function hasWorkerSideEffects(sideEffects: WorkerSideEffects): boolean {
  return sideEffects.saveReport || sideEffects.comment || sideEffects.slackSummary === true;
}

function sideEffectAuditCode(sideEffects: WorkerSideEffects): string {
  const plannedCount = [sideEffects.saveReport, sideEffects.comment, sideEffects.slackSummary === true]
    .filter(Boolean).length;
  if (plannedCount > 1) return "github_app_side_effects_ready";
  if (sideEffects.saveReport) return "github_app_saved_report_ready";
  if (sideEffects.slackSummary) return "github_app_slack_summary_ready";
  return "github_app_comment_ready";
}

function normalizeBatchLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return DEFAULT_ANALYSIS_WORKER_BATCH_LIMIT;
  }

  return Math.min(value, MAX_ANALYSIS_WORKER_BATCH_LIMIT);
}
