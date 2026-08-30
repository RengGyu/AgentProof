import {
  completeAnalysisJob,
  bindAnalysisJobPlannerSeed,
  fenceAnalysisJobSemanticRetryFinalization,
  claimNextAnalysisJob,
  DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS,
  DEFAULT_ANALYSIS_JOB_RETRY_AFTER_MS,
  failAnalysisJob,
  fenceAnalysisJobRevision,
  markAnalysisJobProviderSubmission,
  markAnalysisJobSemanticRetrySubmission,
  parkAnalysisJobForProvider,
  resolveHybridPlannerJobBinding,
  sealAnalysisJobRevision,
  type AnalysisJobResultSummary,
  type AnalysisJobClaimOptions,
  type AnalysisJobRow
} from "./analysis-jobs";
import {
  getAuditLogStoreStatus,
  recordAuditEvent,
  recordHybridPlannerTelemetry,
  AuditLogError,
  type AuditSemanticDiagnostics
} from "./audit-log";
import {
  buildGitHubPullRequestInput,
  fetchGitHubPullRequestAnchor,
  GitHubFetchError,
  GitHubPullRequestHeadChangedError
} from "./github";
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
import { resolveRuntimeReportValidation } from "./report-runtime-validation";
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
  billingBetaPublicReason,
  BillingBetaStoreError,
  evaluateBillingBetaGate
} from "./billing-beta";
import {
  assertTenantPlanAllowsGitHubAppAnalysis,
  clampTenantPlanSideEffects,
  readUsageQuotaPlanCapabilities,
  UsageQuotaStoreError
} from "./usage-quota";
import { generateVerificationReportV2FromInput } from "./verifier";
import * as generalPrObservationService from "./general-pr-observation-service";
import {
  OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS,
  OpenAISemanticError,
  retrieveHybridPlannerWithOpenAI,
  retrieveMissingSemanticsWithOpenAIBackground,
  retrieveSemanticsWithOpenAIBackground,
  submitGeneralPrSemanticObservationWithOpenAI,
  submitHybridPlannerWithOpenAI,
  submitMissingSemanticsWithOpenAIBackground,
  submitSemanticsWithOpenAIBackground
} from "./openai-semantic";
import type { LlmSemanticValidationResult } from "./llm-semantic-output";
import { isGitHubRepositoryPublic, readGitHubRepositoryPrivate } from "./github-repository-visibility";
import { createHybridPlannerGateReader } from "./hybrid-planner-runtime";
import { runHybridPlannerAnalysis } from "./hybrid-orchestrator";
import { resolveHybridWorkerProtocol } from "./hybrid-worker-routing";
import type { PullRequestInput, VerificationReport } from "./types";

export const DEFAULT_ANALYSIS_WORKER_BATCH_LIMIT = 1;
export const MAX_ANALYSIS_WORKER_BATCH_LIMIT = 5;
const TENANT_DELETION_ACTIVE_ERROR = "Tenant deletion is in progress.";
const OPENAI_BACKGROUND_POLL_DELAY_MS = 15_000;
const OPENAI_BACKGROUND_TTL_MS = 8 * 60_000;
const OPENAI_BACKGROUND_RETRY_MIN_REMAINING_MS =
  OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS + OPENAI_BACKGROUND_POLL_DELAY_MS;

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
  llmAnalysisMode?: "essential" | "enhanced";
  hybridPilotControlled?: boolean;
}

export interface RunAnalysisJobOptions extends AnalysisJobClaimOptions {
  requestUrl: string;
  clock?: () => Date;
}

export interface RunAnalysisJobBatchOptions extends RunAnalysisJobOptions {
  limit?: number;
}

export interface AnalysisWorkerRunResult {
  status: AnalysisWorkerPreflightStatus | "waiting_provider" | "completed";
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
  | "systemic_retryable_failure";

export interface AnalysisWorkerBatchResult {
  requestedLimit: number;
  processed: number;
  completed: number;
  waitingProvider?: number;
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

class AnalysisWorkerLeaseLostError extends Error {
  constructor() {
    super("Analysis job claim ownership changed before the worker transition completed.");
    this.name = "AnalysisWorkerLeaseLostError";
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

  return preflightClaimedAnalysisJob(claim.job, options, env);
}

export async function preflightClaimedAnalysisJob(
  job: AnalysisJobRow,
  options: AnalysisJobClaimOptions = {},
  env = process.env
): Promise<AnalysisWorkerPreflightResult> {
  const appStatus = getGitHubAppConfigStatus(env);
  if (!appStatus.ready) {
    await failAnalysisJob({
      id: job.id,
      claimGeneration: job.claim_generation ?? undefined,
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
        claimGeneration: job.claim_generation ?? undefined,
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
        claimGeneration: job.claim_generation ?? undefined,
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
        claimGeneration: job.claim_generation ?? undefined,
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
      const quotaPlan = readUsageQuotaPlanCapabilities({ tenantId: grant.grant.tenantId }, env).plan;
      const billing = evaluateBillingBetaGate({ tenantId: grant.grant.tenantId, quotaPlan }, env);
      if (!billing.allowed) {
        await failAnalysisJob({
          id: job.id,
          claimGeneration: job.claim_generation ?? undefined,
          retryable: false,
          code: "github_app_billing_subscription_blocked",
          summary: billingBetaPublicReason(billing.reason),
          now: options.now
        }, env);

        return {
          status: "failed_terminal",
          reason: "github_app_billing_subscription_blocked"
        };
      }

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
        sideEffects,
        llmAnalysisMode: grant.grant.llmAnalysisMode,
        hybridPilotControlled: true
      };
    }
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      await failAnalysisJob({
        id: job.id,
        claimGeneration: job.claim_generation ?? undefined,
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
        claimGeneration: job.claim_generation ?? undefined,
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

    if (error instanceof BillingBetaStoreError) {
      await failAnalysisJob({
        id: job.id,
        claimGeneration: job.claim_generation ?? undefined,
        retryable: true,
        code: "github_app_billing_gate_unavailable",
        summary: "Tenant billing gate is unavailable during analysis worker preflight.",
        now: options.now
      }, env);

      return {
        status: "failed_retryable",
        reason: "github_app_billing_gate_unavailable"
      };
    }

    throw error;
  }

  const settings = getGitHubAppAutomationSettings(env);
  if (!settings.enabled || !isGitHubAppRepoAllowed(job.repository_full_name, settings)) {
    await failAnalysisJob({
      id: job.id,
      claimGeneration: job.claim_generation ?? undefined,
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
    },
    llmAnalysisMode: undefined,
    hybridPilotControlled: false
  };
}

export async function runNextAnalysisJob(
  options: RunAnalysisJobOptions,
  env = process.env
): Promise<AnalysisWorkerRunResult> {
  const preflight = await preflightNextAnalysisJob(options, env);
  return runPreflightedAnalysisJob(preflight, options, env);
}

export async function runClaimedAnalysisJob(
  job: AnalysisJobRow,
  options: RunAnalysisJobOptions,
  env = process.env
): Promise<AnalysisWorkerRunResult> {
  const preflight = await preflightClaimedAnalysisJob(job, options, env);
  return runPreflightedAnalysisJob(preflight, options, env);
}

async function runPreflightedAnalysisJob(
  preflight: AnalysisWorkerPreflightResult,
  options: RunAnalysisJobOptions,
  env: NodeJS.ProcessEnv
): Promise<AnalysisWorkerRunResult> {
  if (preflight.status !== "ready" || !preflight.job) {
    return preflight;
  }

  const job = preflight.job;
  const sideEffects = preflight.sideEffects ?? { saveReport: false, comment: false };

  try {
    await prepareWorkerSideEffects(job, sideEffects, env);
    await assertWorkerTenantDeletionNotActive(job, env);

    const token = await createGitHubInstallationAccessToken(job.installation_id, env);
    const llmAnalysisMode = preflight.llmAnalysisMode
      ?? (await isGitHubRepositoryPublic(job.repository_full_name, token) ? "enhanced" : "essential");
    const input = await buildGitHubPullRequestInput(job.pull_request_url, token, "", undefined, {
      expectedHeadSha: job.head_sha,
      now: () => options.now ?? new Date()
    });

    if (!input) {
      throw new AnalysisWorkerRetryableError(
        "github_app_pr_input_unavailable",
        "GitHub App worker could not build a pull request input."
      );
    }

    const generalPrObservationMode = generalPrObservationService.resolveGeneralPrObservationModeV2(
      env.AGENTPROOF_GENERAL_PR_OBSERVATION_MODE
    );
    const generalPrObserverApiKey = env.OPENAI_API_KEY?.trim();
    const generalPrObserverModel = env.OPENAI_MODEL?.trim();
    const publicShadowObserver = generalPrObservationMode === "shadow" &&
      input.repositoryPrivate === false &&
      input.sourceProvenance?.origin === "github_snapshot" &&
      Boolean(generalPrObserverApiKey && generalPrObserverModel);
    const generalPrObservation = await generalPrObservationService.runGeneralPrObservationNowV2({
      mode: generalPrObservationMode,
      input,
      generateReport: generateVerificationReportV2FromInput,
      // The generated/semantic report still crosses the existing worker
      // runtime boundary below; this only keeps observation collection off
      // when deterministic generation is invalid.
      validateDeterministicReport: (candidateInput, candidateReport) =>
        resolveRuntimeReportValidation({
          input: candidateInput,
          report: candidateReport,
          requireV2: true,
          requireSourceProvenance: true
        }).valid,
      ...(publicShadowObserver && generalPrObserverApiKey && generalPrObserverModel ? {
        semantic: {
          provider: {
            observe: (semanticPackage) => submitGeneralPrSemanticObservationWithOpenAI(semanticPackage, {
              apiKey: generalPrObserverApiKey
            })
          },
          providerAvailable: true,
          privateRepository: false,
          readCurrentInput: async () => {
            try {
              return await buildGitHubPullRequestInput(job.pull_request_url, token, "", undefined, {
                expectedHeadSha: input.sourceProvenance?.headSha,
                expectedBaseSha: input.sourceProvenance?.baseSha
              });
            } catch {
              return null;
            }
          },
          modelProfile: {
            model: generalPrObserverModel,
            promptVersion: "general-pr-observer.v2",
            inputFieldPolicyVersion: "general-pr-observer-fields.v1"
          }
        }
      } : {})
    });
    const deterministicReport = generalPrObservation.report;
    const protocol = resolveHybridWorkerProtocol(job, preflight.hybridPilotControlled === true);
    const semanticResult = protocol === "legacy"
      ? await advanceQueuedSemanticAnalysis(
        job,
        input,
        deterministicReport,
        llmAnalysisMode,
        options.now ?? new Date(),
        options.clock ?? (() => options.now ?? new Date()),
        env
      )
      : await advanceQueuedHybridPlanning(
        job,
        input,
        protocol,
        token,
        options.now ?? new Date(),
        options.clock ?? (() => options.now ?? new Date()),
        env
      );
    if (semanticResult.status === "waiting_provider") {
      return {
        status: "waiting_provider",
        job,
        sideEffects
      };
    }
    if (
      job.semantic_retry_attempts === 1 &&
      job.provider_response_id == null &&
      (job.provider_status === "submitting" || job.provider_status === "in_progress")
    ) {
      const finalizationClaim = await fenceAnalysisJobSemanticRetryFinalization({
        id: job.id,
        claimGeneration: job.claim_generation ?? "",
        now: options.now
      }, env);
      if (!finalizationClaim) throw new AnalysisWorkerLeaseLostError();
      job.updated_at = finalizationClaim.updated_at;
      job.locked_at = finalizationClaim.locked_at;
      job.provider_status = finalizationClaim.provider_status;
      job.provider_submitted_at = finalizationClaim.provider_submitted_at;
      job.provider_expires_at = finalizationClaim.provider_expires_at;
    }
    const runtimeReport = resolveRuntimeReportValidation({
      input,
      report: semanticResult.report,
      requireV2: true,
      requireSourceProvenance: true
    });

    if (!runtimeReport.valid) {
      throw new AnalysisWorkerTerminalError(
        "generated_report_validation_failed",
        `Generated report failed runtime validation: ${runtimeReport.errors.join("; ")}`
      );
    }
    let report = runtimeReport.report;

    const finalAnchor = await fetchGitHubPullRequestAnchor(job.pull_request_url, token);
    if (!finalAnchor) {
      throw new AnalysisWorkerRetryableError(
        "github_app_pr_snapshot_unavailable",
        "GitHub App worker could not recheck the pull request anchors before publishing evidence."
      );
    }
    if (finalAnchor.headSha !== job.head_sha || finalAnchor.headSha !== input.sourceProvenance?.headSha) {
      throw new GitHubPullRequestHeadChangedError(job.head_sha, finalAnchor.headSha, "final");
    }
    if (finalAnchor.baseSha !== input.sourceProvenance?.baseSha) {
      throw new GitHubPullRequestHeadChangedError(
        input.sourceProvenance?.baseSha ?? "missing",
        finalAnchor.baseSha,
        "final",
        "base"
      );
    }

    const publishableSideEffects = "publicationSuppressed" in semanticResult && semanticResult.publicationSuppressed === true
      ? { saveReport: false, comment: false, slackSummary: false }
      : sideEffects;
    const sideEffectsBeforeSave = await revalidateWorkerSideEffects(job, publishableSideEffects, env);
    await sealCurrentAnalysisJobRevision(job, env, options.now);
    let saved: Awaited<ReturnType<typeof createAutomationSavedReport>> | undefined;
    if (sideEffectsBeforeSave.saveReport) {
      await assertWorkerTenantDeletionNotActive(job, env);
      report = requirePublishableGeneratedReport(input, report);
      saved = await createAutomationSavedReport(report, {
        requestUrl: options.requestUrl,
        validationInput: input,
        ...(job.tenant_id && job.installation_id && job.repository_id ? {
          tenantId: job.tenant_id,
          installationId: job.installation_id,
          repositoryId: job.repository_id,
          pullRequestNumber: job.pull_request_number,
          headSha: job.head_sha
        } : {})
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
      report = requirePublishableGeneratedReport(input, report);
      comment = await postGitHubAppMarkerComment({
        repositoryFullName: job.repository_full_name,
        pullRequestNumber: job.pull_request_number,
        pullRequestUrl: job.pull_request_url
      }, token, report);
    }
    let slack: Awaited<ReturnType<typeof sendSlackReportSummary>> | undefined;
    if (completedSideEffects.slackSummary) {
      await assertWorkerTenantDeletionNotActive(job, env);
      report = requirePublishableGeneratedReport(input, report);
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

    const completed = await completeAnalysisJob({
      id: job.id,
      resultSummary,
      claimGeneration: job.claim_generation ?? undefined,
      now: options.now
    }, env);
    if (!completed) throw new AnalysisWorkerLeaseLostError();

    await recordWorkerAudit("github_app_analysis_completed", "completed", job, {
      statusCode: 200,
      priority: resultSummary.priority,
      evidenceCoverage: resultSummary.evidenceCoverage,
      savedReport: resultSummary.savedReport,
      comment: resultSummary.comment,
      slack: resultSummary.slack,
      semanticDiagnostics: semanticResult.semanticDiagnostics
    }, env);

    return {
      status: "completed",
      job,
      resultSummary,
      sideEffects: completedSideEffects
    };
  } catch (error) {
    const failure = classifyWorkerFailure(error);
    if (error instanceof AnalysisWorkerLeaseLostError) {
      return {
        status: "failed_retryable",
        job,
        reason: failure.code,
        sideEffects
      };
    }
    const failed = await failAnalysisJob({
      id: job.id,
      claimGeneration: job.claim_generation ?? undefined,
      retryable: failure.retryable,
      code: failure.code,
      summary: failure.summary,
      now: options.now
    }, env);
    if (!failed) {
      return {
        status: "failed_retryable",
        job,
        reason: "analysis_job_claim_lost",
        sideEffects
      };
    }
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

function requirePublishableGeneratedReport(
  input: PullRequestInput,
  report: VerificationReport
): VerificationReport {
  const validation = resolveRuntimeReportValidation({
    boundary: "generated_private_full",
    input,
    report,
    requireV2: true,
    requireSourceProvenance: true
  });
  if (!validation.valid) {
    throw new AnalysisWorkerTerminalError(
      "generated_report_publication_validation_failed",
      `Generated report failed publication validation: ${validation.errors.join("; ")}`
    );
  }
  return validation.report;
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

    if (result.status === "failed_retryable" && isSystemicRetryableFailure(result.reason)) {
      stoppedReason = "systemic_retryable_failure";
      break;
    }
  }

  return {
    requestedLimit,
    processed: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    waitingProvider: items.filter((item) => item.status === "waiting_provider").length,
    failedRetryable: items.filter((item) => item.status === "failed_retryable").length,
    failedTerminal: items.filter((item) => item.status === "failed_terminal").length,
    idle,
    stoppedReason,
    items
  };
}

async function advanceQueuedHybridPlanning(
  job: AnalysisJobRow,
  input: PullRequestInput,
  protocol: "hybrid_submit" | "hybrid_retrieve" | "hybrid_fallback",
  installationToken: string,
  now: Date,
  clock: () => Date,
  env: NodeJS.ProcessEnv
): Promise<
  | {
      status: "ready";
      report: VerificationReport;
      semanticDiagnostics?: AuditSemanticDiagnostics;
      publicationSuppressed?: true;
    }
  | { status: "waiting_provider" }
> {
  const providerOptions = { apiKey: env.OPENAI_API_KEY ?? "" };
  const readGate = createHybridPlannerGateReader({
    env,
    readRepositoryPrivate: () => readGitHubRepositoryPrivate(job.repository_full_name, installationToken),
    readGrant: async () => {
      try {
        const decision = await authorizeTenantRepositoryGrantAsync({
          installationId: job.installation_id,
          repositoryId: job.repository_id ?? undefined,
          repositoryFullName: job.repository_full_name
        }, env);
        return decision.grant;
      } catch {
        return undefined;
      }
    }
  });
  const submittedAt = parseProviderTime(job.provider_submitted_at) ?? now;
  const expiresAt = parseProviderTime(job.provider_expires_at) ??
    new Date(submittedAt.getTime() + OPENAI_BACKGROUND_TTL_MS);
  const result = await runHybridPlannerAnalysis({
    phase: protocol === "hybrid_submit" ? "background_submit" : "background_retrieve",
    ...(job.provider_response_id ? { responseId: job.provider_response_id } : {}),
    input,
    readCurrentInput: () => buildGitHubPullRequestInput(
      job.pull_request_url,
      installationToken,
      "",
      undefined,
      {
        expectedHeadSha: job.head_sha,
        now: clock
      }
    ),
    readGate: async () => env.OPENAI_API_KEY
      ? readGate()
      : { enabled: false, reason: "pilot-disabled" },
    bindBeforeSubmit: async (binding) => {
      if (!job.claim_generation) return false;
      const bound = await bindAnalysisJobPlannerSeed({
        id: job.id,
        claimGeneration: job.claim_generation,
        contractVersion: binding.contractVersion,
        inputHash: binding.inputHash,
        now
      }, env);
      if (!bound) return false;
      Object.assign(job, bound);
      return true;
    },
    beforePost: async () => {
      if (!job.claim_generation) return false;
      const marked = await markAnalysisJobProviderSubmission({
        id: job.id,
        claimGeneration: job.claim_generation,
        submittedAt,
        expiresAt,
        now
      }, env);
      if (!marked) return false;
      Object.assign(job, marked);
      return true;
    },
    checkBinding: (binding) => resolveHybridPlannerJobBinding(job, binding),
    transport: {
      submit: (request) => submitHybridPlannerWithOpenAI(request, providerOptions),
      retrieve: (responseId, request) => retrieveHybridPlannerWithOpenAI(responseId, request, providerOptions)
    },
    telemetry: (value) => recordHybridPlannerTelemetry(value, env).then(() => undefined).catch(() => undefined),
    clock
  });
  if (result.status === "pending") {
    await parkSemanticResponse(
      job,
      result,
      submittedAt,
      expiresAt,
      clock(),
      env,
      false
    );
    return { status: "waiting_provider" };
  }
  return {
    status: "ready",
    report: result.report,
    ...(result.publicationSuppressed === true ? { publicationSuppressed: true as const } : {})
  };
}

async function advanceQueuedSemanticAnalysis(
  job: AnalysisJobRow,
  input: PullRequestInput,
  deterministicReport: VerificationReport,
  mode: "essential" | "enhanced",
  now: Date,
  clock: () => Date,
  env: NodeJS.ProcessEnv
): Promise<
  | { status: "ready"; report: VerificationReport; semanticDiagnostics?: AuditSemanticDiagnostics }
  | { status: "waiting_provider" }
> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey || env.AGENTPROOF_LLM_SEMANTIC_ENABLED !== "true" || mode !== "enhanced") {
    return { status: "ready", report: deterministicReport };
  }

  const providerOptions = {
    apiKey,
    ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {})
  };
  const retryAttempts = job.semantic_retry_attempts ?? 0;
  const existingSubmittedAt = parseProviderTime(job.provider_submitted_at);
  const existingExpiresAt = parseProviderTime(job.provider_expires_at);
  const priorSubmittedAt = parseProviderTime(job.prior_provider_submitted_at);
  const priorExpiresAt = parseProviderTime(job.prior_provider_expires_at);

  if (retryAttempts === 1) {
    return advanceSubmittedSemanticRetry({
      job,
      input,
      deterministicReport,
      now,
      env,
      providerOptions,
      existingSubmittedAt,
      existingExpiresAt,
      priorSubmittedAt,
      priorExpiresAt
    });
  }
  if (retryAttempts !== 0 || job.prior_provider_response_id || priorSubmittedAt || priorExpiresAt) {
    throw new OpenAISemanticError(
      "openai_response_invalid",
      false,
      "OpenAI background retry continuation metadata was invalid."
    );
  }
  if (!job.provider_response_id && job.provider_status === "submitting") {
    return unavailableSemanticFallback(deterministicReport);
  }
  if (job.provider_response_id && (!existingSubmittedAt || !existingExpiresAt)) {
    throw new OpenAISemanticError(
      "openai_response_invalid",
      false,
      "OpenAI background continuation metadata was invalid."
    );
  }
  const submittedAt = existingSubmittedAt ?? now;
  const expiresAt = existingExpiresAt ?? new Date(submittedAt.getTime() + OPENAI_BACKGROUND_TTL_MS);
  if (job.provider_response_id && expiresAt.getTime() <= now.getTime()) {
    return unavailableSemanticFallback(deterministicReport);
  }

  let result;
  if (job.provider_response_id) {
    result = await retrieveSemanticsWithOpenAIBackground(
      job.provider_response_id,
      input,
      deterministicReport,
      providerOptions
    );
  } else {
    const claimGeneration = job.claim_generation;
    if (!claimGeneration) throw new AnalysisWorkerLeaseLostError();
    const marked = await markAnalysisJobProviderSubmission({
      id: job.id,
      claimGeneration,
      submittedAt,
      expiresAt,
      now
    }, env);
    if (!marked) throw new AnalysisWorkerLeaseLostError();
    job.updated_at = marked.updated_at;
    job.provider_status = "submitting";
    job.provider_submitted_at = marked.provider_submitted_at;
    job.provider_expires_at = marked.provider_expires_at;
    try {
      result = await submitSemanticsWithOpenAIBackground(input, deterministicReport, providerOptions);
    } catch (error) {
      if (error instanceof OpenAISemanticError && error.retryable) {
        return unavailableSemanticFallback(deterministicReport);
      }
      throw error;
    }
  }

  if (result.status === "pending") {
    await parkSemanticResponse(job, result, submittedAt, expiresAt, now, env, false);
    return { status: "waiting_provider" };
  }

  if (result.validation.missing_requirement_ids.length > 0) {
    return startSemanticCoverageRetry({
      job,
      input,
      deterministicReport,
      firstResult: result,
      firstSubmittedAt: submittedAt,
      firstExpiresAt: expiresAt,
      now,
      clock,
      env,
      providerOptions
    });
  }

  return {
    status: "ready",
    report: includedSemanticReport(deterministicReport, result.output, 1),
    semanticDiagnostics: semanticAuditDiagnostics(result.validation, "not_needed")
  };
}

async function startSemanticCoverageRetry(input: {
  job: AnalysisJobRow;
  input: PullRequestInput;
  deterministicReport: VerificationReport;
  firstResult: Extract<Awaited<ReturnType<typeof retrieveSemanticsWithOpenAIBackground>>, { status: "completed" }>;
  firstSubmittedAt: Date;
  firstExpiresAt: Date;
  now: Date;
  clock: () => Date;
  env: NodeJS.ProcessEnv;
  providerOptions: { apiKey: string; model?: string };
}): Promise<
  | { status: "ready"; report: VerificationReport; semanticDiagnostics: AuditSemanticDiagnostics }
  | { status: "waiting_provider" }
> {
  const retrySubmittedAt = input.clock();
  const retryExpiresAt = new Date(Math.min(
    input.firstExpiresAt.getTime(),
    retrySubmittedAt.getTime() + OPENAI_BACKGROUND_TTL_MS
  ));
  if (
    retryExpiresAt.getTime() - retrySubmittedAt.getTime() <=
      OPENAI_BACKGROUND_RETRY_MIN_REMAINING_MS
  ) {
    return firstSemanticFallback(
      input.deterministicReport,
      input.firstResult.validation,
      "expired_before_retry",
      1
    );
  }

  const claimGeneration = input.job.claim_generation;
  if (!claimGeneration) throw new AnalysisWorkerLeaseLostError();
  const marked = await markAnalysisJobSemanticRetrySubmission({
    id: input.job.id,
    claimGeneration,
    priorResponseId: input.firstResult.responseId,
    priorSubmittedAt: input.firstSubmittedAt,
    priorExpiresAt: input.firstExpiresAt,
    submittedAt: retrySubmittedAt,
    expiresAt: retryExpiresAt,
    now: retrySubmittedAt
  }, input.env);
  if (!marked) throw new AnalysisWorkerLeaseLostError();
  Object.assign(input.job, marked);

  let retryResult;
  try {
    retryResult = await submitMissingSemanticsWithOpenAIBackground(
      input.input,
      input.deterministicReport,
      input.firstResult.validation,
      input.providerOptions
    );
  } catch (error) {
    return firstSemanticFallback(
      input.deterministicReport,
      input.firstResult.validation,
      error instanceof OpenAISemanticError && error.retryable ? "submission_uncertain" : "provider_failed"
    );
  }

  if (retryResult.status === "pending") {
    const parkNow = input.clock();
    const nextPollAt = parkNow.getTime() + OPENAI_BACKGROUND_POLL_DELAY_MS;
    if (nextPollAt >= Math.min(input.firstExpiresAt.getTime(), retryExpiresAt.getTime())) {
      return firstSemanticFallback(
        input.deterministicReport,
        input.firstResult.validation,
        "provider_failed"
      );
    }
    await parkSemanticResponse(
      { ...input.job, claim_generation: claimGeneration },
      retryResult,
      retrySubmittedAt,
      retryExpiresAt,
      parkNow,
      input.env,
      true
    );
    return { status: "waiting_provider" };
  }

  const outcome = retryResult.validation.missing_requirement_ids.length > 0 ? "incomplete" : "completed";
  return {
    status: "ready",
    report: includedSemanticReport(input.deterministicReport, retryResult.output, 2),
    semanticDiagnostics: semanticAuditDiagnostics(retryResult.validation, outcome)
  };
}

async function advanceSubmittedSemanticRetry(input: {
  job: AnalysisJobRow;
  input: PullRequestInput;
  deterministicReport: VerificationReport;
  now: Date;
  env: NodeJS.ProcessEnv;
  providerOptions: { apiKey: string; model?: string };
  existingSubmittedAt: Date | null;
  existingExpiresAt: Date | null;
  priorSubmittedAt: Date | null;
  priorExpiresAt: Date | null;
}): Promise<
  | { status: "ready"; report: VerificationReport; semanticDiagnostics?: AuditSemanticDiagnostics }
  | { status: "waiting_provider" }
> {
  if (
    !input.job.prior_provider_response_id ||
    !input.priorSubmittedAt ||
    !input.priorExpiresAt ||
    input.priorExpiresAt.getTime() <= input.now.getTime()
  ) {
    return unavailableSemanticFallback(input.deterministicReport);
  }

  let firstResult;
  try {
    firstResult = await retrieveSemanticsWithOpenAIBackground(
      input.job.prior_provider_response_id,
      input.input,
      input.deterministicReport,
      input.providerOptions
    );
  } catch (error) {
    if (
      error instanceof OpenAISemanticError &&
      error.retryable &&
      input.job.attempts < DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS
    ) {
      throw error;
    }
    return unavailableSemanticFallback(input.deterministicReport);
  }
  if (firstResult.status !== "completed") {
    return unavailableSemanticFallback(input.deterministicReport);
  }

  if (
    !input.job.provider_response_id &&
    (input.job.provider_status === "submitting" || input.job.provider_status === "in_progress")
  ) {
    return firstSemanticFallback(input.deterministicReport, firstResult.validation, "submission_uncertain");
  }
  if (
    !input.job.provider_response_id ||
    !input.existingSubmittedAt ||
    !input.existingExpiresAt ||
    input.existingExpiresAt.getTime() <= input.now.getTime()
  ) {
    return firstSemanticFallback(input.deterministicReport, firstResult.validation, "provider_failed");
  }

  let retryResult;
  try {
    retryResult = await retrieveMissingSemanticsWithOpenAIBackground(
      input.job.provider_response_id,
      input.input,
      input.deterministicReport,
      firstResult.validation,
      input.providerOptions
    );
  } catch (error) {
    if (
      error instanceof OpenAISemanticError &&
      error.retryable &&
      input.job.attempts < DEFAULT_ANALYSIS_JOB_MAX_ATTEMPTS &&
      retryBackoffFitsContinuationWindow(
        input.now,
        input.priorExpiresAt,
        input.existingExpiresAt
      )
    ) {
      throw error;
    }
    return firstSemanticFallback(input.deterministicReport, firstResult.validation, "provider_failed");
  }

  if (retryResult.status === "pending") {
    await parkSemanticResponse(
      input.job,
      retryResult,
      input.existingSubmittedAt,
      input.existingExpiresAt,
      input.now,
      input.env,
      true
    );
    return { status: "waiting_provider" };
  }

  const outcome = retryResult.validation.missing_requirement_ids.length > 0 ? "incomplete" : "completed";
  return {
    status: "ready",
    report: includedSemanticReport(input.deterministicReport, retryResult.output, 2),
    semanticDiagnostics: semanticAuditDiagnostics(retryResult.validation, outcome)
  };
}

async function parkSemanticResponse(
  job: AnalysisJobRow,
  result: { status: "pending"; responseId: string; providerStatus: "queued" | "in_progress" },
  submittedAt: Date,
  expiresAt: Date,
  now: Date,
  env: NodeJS.ProcessEnv,
  retry: boolean
): Promise<void> {
  let parked: boolean;
  try {
    parked = await parkAnalysisJobForProvider({
      id: job.id,
      claimGeneration: job.claim_generation ?? "",
      responseId: result.responseId,
      providerStatus: result.providerStatus,
      submittedAt,
      expiresAt,
      runAfter: new Date(Math.min(expiresAt.getTime(), now.getTime() + OPENAI_BACKGROUND_POLL_DELAY_MS)),
      now
    }, env);
  } catch {
    if (retry) throw new AnalysisWorkerLeaseLostError();
    throw new AnalysisWorkerTerminalError(
      "openai_submission_uncertain",
      "OpenAI background submission could not be reconciled safely."
    );
  }
  if (!parked) {
    if (job.claim_generation && job.running_revision) {
      await fenceAnalysisJobRevision({
        id: job.id,
        claimGeneration: job.claim_generation,
        runningRevision: job.running_revision,
        now
      }, env).catch(() => false);
    }
    throw new AnalysisWorkerLeaseLostError();
  }
}

function includedSemanticReport(
  deterministicReport: VerificationReport,
  output: NonNullable<VerificationReport["semantic"]>,
  attempts: 1 | 2
): VerificationReport {
  if (!hasUsableSemanticAnalysis(output)) {
    return {
      ...deterministicReport,
      semanticAnalysis: { status: "unavailable", attempts }
    };
  }
  return {
    ...deterministicReport,
    semantic: output,
    semanticAnalysis: { status: "included", attempts }
  };
}

function hasUsableSemanticAnalysis(output: NonNullable<VerificationReport["semantic"]>): boolean {
  return Object.values(output).some((section) => section.length > 0);
}

function firstSemanticFallback(
  deterministicReport: VerificationReport,
  validation: LlmSemanticValidationResult,
  retryOutcome: AuditSemanticDiagnostics["retryOutcome"],
  attempts: 1 | 2 = 2
) {
  return {
    status: "ready" as const,
    report: includedSemanticReport(deterministicReport, validation.candidate!, attempts),
    semanticDiagnostics: semanticAuditDiagnostics(validation, retryOutcome)
  };
}

function unavailableSemanticFallback(deterministicReport: VerificationReport) {
  return {
    status: "ready" as const,
    report: {
      ...deterministicReport,
      semanticAnalysis: { status: "unavailable" as const, attempts: 2 as const }
    }
  };
}

function semanticAuditDiagnostics(
  validation: LlmSemanticValidationResult,
  retryOutcome: AuditSemanticDiagnostics["retryOutcome"]
): AuditSemanticDiagnostics {
  const discardReasonCodeCounts: AuditSemanticDiagnostics["discardReasonCodeCounts"] = {
    root_schema_invalid: 0,
    secret_detected: 0,
    raw_content_detected: 0,
    untrusted_instruction_influence: 0,
    empty_usable_analysis: 0
  };
  for (const reason of validation.diagnostics.discard_reason_codes) {
    discardReasonCodeCounts[reason] += 1;
  }

  return {
    disposition: validation.disposition,
    inputRequirementCount: validation.diagnostics.input_requirement_count,
    assessedRequirementCount: validation.diagnostics.assessed_requirement_count,
    missingRequirementCount: validation.diagnostics.missing_requirement_count,
    rawSectionCounts: validation.diagnostics.raw_section_counts,
    acceptedSectionCounts: validation.diagnostics.accepted_section_counts,
    rejectedSectionCounts: validation.diagnostics.rejected_section_counts,
    rejectedReasonCodeCounts: validation.diagnostics.rejected_reason_code_counts,
    discardReasonCodeCounts,
    retryAttempted: retryOutcome !== "not_needed" && retryOutcome !== "expired_before_retry",
    retryOutcome
  };
}

function retryBackoffFitsContinuationWindow(
  now: Date,
  priorExpiresAt: Date,
  activeExpiresAt: Date
): boolean {
  const nextRetryAt = now.getTime() + DEFAULT_ANALYSIS_JOB_RETRY_AFTER_MS;
  return nextRetryAt < Math.min(priorExpiresAt.getTime(), activeExpiresAt.getTime());
}

function parseProviderTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isSystemicRetryableFailure(reason: string | undefined): boolean {
  return reason === "github_fetch_failed" ||
    reason === "openai_timeout" ||
    reason === "openai_network_error" ||
    reason === "openai_rate_limited" ||
    reason === "openai_provider_unavailable" ||
    reason === "github_app_not_ready" ||
    reason === "github_app_tenant_grant_store_unavailable" ||
    reason === "github_app_plan_gate_unavailable" ||
    reason === "github_app_durable_audit_required";
}

async function sealCurrentAnalysisJobRevision(
  job: AnalysisJobRow,
  env: NodeJS.ProcessEnv,
  now?: Date
): Promise<void> {
  const runningRevision = job.running_revision;
  if (!job.claim_generation || !runningRevision) throw new AnalysisWorkerLeaseLostError();
  const current = await sealAnalysisJobRevision({
    id: job.id,
    claimGeneration: job.claim_generation,
    runningRevision,
    now
  }, env);
  if (!current) throw new AnalysisWorkerLeaseLostError();
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
      const quotaPlan = readUsageQuotaPlanCapabilities({ tenantId: grant.grant.tenantId }, env).plan;
      const billing = evaluateBillingBetaGate({ tenantId: grant.grant.tenantId, quotaPlan }, env);
      if (!billing.allowed) {
        throw new AnalysisWorkerTerminalError(
          "github_app_billing_subscription_blocked",
          billingBetaPublicReason(billing.reason)
        );
      }

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

    if (error instanceof BillingBetaStoreError) {
      throw new AnalysisWorkerRetryableError(
        "github_app_billing_gate_unavailable",
        "Tenant billing side-effect gate is unavailable before GitHub App worker side effects."
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
    semanticDiagnostics?: AuditSemanticDiagnostics;
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
    slack: metadata.slack,
    semanticDiagnostics: metadata.semanticDiagnostics
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

  if (error instanceof AnalysisWorkerLeaseLostError) {
    return {
      retryable: true,
      code: "analysis_job_claim_lost",
      summary: "Analysis job claim ownership changed before completion."
    };
  }

  if (error instanceof OpenAISemanticError) {
    return {
      retryable: error.retryable,
      code: error.code,
      summary: safeOpenAISemanticSummary(error.code)
    };
  }

  if (error instanceof GitHubPullRequestHeadChangedError) {
    return {
      retryable: false,
      code: "github_app_pr_head_changed",
      summary: "GitHub pull request head or base changed during evidence collection; AgentProof did not save or publish a report."
    };
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

function safeOpenAISemanticSummary(code: string): string {
  if (["openai_timeout", "openai_network_error", "openai_rate_limited", "openai_provider_unavailable"].includes(code)) {
    return "OpenAI semantic analysis is temporarily unavailable and may be retried.";
  }
  if (code === "openai_output_rejected" || code === "openai_output_invalid") {
    return "OpenAI semantic output did not pass AgentProof validation.";
  }
  return "OpenAI background semantic analysis could not be completed.";
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
