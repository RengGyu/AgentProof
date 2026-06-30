import { buildGitHubPullRequestInput } from "@/lib/github";
import {
  AnalysisJobQueueError,
  enqueueAnalysisJob,
  getAnalysisJobQueueStatus
} from "@/lib/analysis-jobs";
import { getAuditLogStoreStatus, recordAuditEvent, type AuditEventAction, type AuditEventResult } from "@/lib/audit-log";
import {
  completeGitHubWebhookDelivery,
  createGitHubInstallationAccessToken,
  failGitHubWebhookDelivery,
  GitHubWebhookIdempotencyError,
  getGitHubAppAutomationSettings,
  getGitHubAppConfigStatus,
  isGitHubAppRepoAllowed,
  normalizeGitHubWebhookEvent,
  reserveGitHubWebhookDelivery,
  shouldHandlePullRequestAction,
  verifyGitHubWebhookSignature
} from "@/lib/github-app";
import {
  GitHubInstallationStoreError,
  markTenantGitHubInstallationStatus
} from "@/lib/github-installations";
import {
  createAutomationSavedReport,
  postGitHubAppMarkerComment
} from "@/lib/github-app-side-effects";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { redactSecrets } from "@/lib/redact";
import { validateVerificationReport } from "@/lib/report-validation";
import { SavedReportStoreError } from "@/lib/server-report-store";
import {
  authorizeTenantRepositoryGrantAsync,
  disableTenantRepositoryGrantsForInstallation,
  disableTenantRepositoryGrantsForRepositories,
  getTenantControlPlaneSettings,
  tenantGrantPublicReason,
  TenantControlPlaneStoreError
} from "@/lib/tenant-control-plane";
import { TenantDeletionStateError } from "@/lib/tenant-deletion-state";
import { reserveUsageQuota, usageQuotaPublicReason, UsageQuotaStoreError, type UsageQuotaReservation } from "@/lib/usage-quota";
import { generateVerificationReport } from "@/lib/verifier";

const ALLOWED_EVENTS = new Set(["pull_request", "check_run", "check_suite", "status", "ping", "installation", "installation_repositories"]);
const MAX_WEBHOOK_BODY_BYTES = 400_000;

export async function POST(request: Request) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

  if (!webhookSecret.trim()) {
    return noStoreJson({
      error: "GitHub App webhook is not configured.",
      code: "github_webhook_not_configured"
    }, { status: 501 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  const rawBody = await request.text();

  if (utf8ByteLength(rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), webhookSecret)) {
    return noStoreJson({ error: "Invalid GitHub webhook signature." }, { status: 401 });
  }

  const meta = normalizeGitHubWebhookEvent(request.headers);
  if (!ALLOWED_EVENTS.has(meta.event)) {
    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: true,
      event: safeWebhookString(meta.event),
      delivery: safeWebhookString(meta.delivery),
      automationEnabled: false,
      note: "Event ignored. Automated GitHub App actions are disabled."
    });
  }

  const payload = parseJsonSafely<Record<string, unknown>>(rawBody);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return noStoreJson({ error: "GitHub webhook payload must be a JSON object." }, { status: 400 });
  }

  const settings = getGitHubAppAutomationSettings();
  const action = safeWebhookString(typeof payload?.action === "string" ? payload.action : undefined);
  const smokeControls = getGitHubAppSmokeControls(payload);

  if (isInstallationLifecycleEvent(meta.event)) {
    return handleInstallationLifecycle(payload, {
      delivery: meta.delivery,
      event: meta.event,
      action
    });
  }

  if (meta.event !== "pull_request" || !settings.enabled) {
    return noStoreJson({
      ok: true,
      accepted: true,
      dryRun: true,
      event: safeWebhookString(meta.event),
      delivery: safeWebhookString(meta.delivery),
      action,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      summary: buildWebhookDryRunSummary(payload),
      note: "Webhook verified. Automated GitHub App actions stay disabled until automation is explicitly enabled for an allowed repository."
    });
  }

  return handlePullRequestAutomation(payload, {
    requestUrl: request.url,
    delivery: meta.delivery,
    event: meta.event,
    action,
    commentEnabled: settings.commentEnabled && !smokeControls.suppressComment,
    saveReportsEnabled: settings.saveReportsEnabled && !smokeControls.suppressSavedReport,
    legacyRepoAllowed: isGitHubAppRepoAllowed(getString(getNestedRecord(payload, "repository"), "full_name"), settings)
  });
}

async function handleInstallationLifecycle(
  payload: Record<string, unknown>,
  context: {
    delivery: string;
    event: string;
    action: string | undefined;
  }
) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      ok: true,
      accepted: true,
      dryRun: true,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      note: "GitHub App lifecycle webhook verified. Tenant control is disabled, so repository grants were not changed."
    });
  }

  const lifecycle = parseInstallationLifecyclePayload(payload, context.event, context.action);
  if (!lifecycle) {
    return noStoreJson({
      error: "GitHub App lifecycle webhook payload is missing required installation metadata.",
      code: "github_app_lifecycle_payload_invalid",
      willAnalyze: false,
      willComment: false
    }, { status: 422 });
  }

  if (!lifecycle.shouldDisable) {
    await recordInstallationLifecycleAuditEvent(lifecycle.auditAction, "skipped", lifecycle, context, {
      statusCode: 200,
      code: "github_app_lifecycle_no_grant_change"
    });

    return noStoreJson({
      ok: true,
      accepted: true,
      ignored: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      disabledGrantCount: 0,
      note: "GitHub App lifecycle event did not require repository grant changes."
    });
  }

  try {
    const result = lifecycle.repositoryIds
      ? await disableTenantRepositoryGrantsForRepositories({
        installationId: lifecycle.installationId,
        repositoryIds: lifecycle.repositoryIds
      })
      : await disableTenantRepositoryGrantsForInstallation({
        installationId: lifecycle.installationId
      });
    const tenantId = uniqueTenantId(result.grants);

    if (tenantId && lifecycle.installationStatus) {
      await markTenantGitHubInstallationStatus({
        tenantId,
        installationId: lifecycle.installationId,
        accountId: lifecycle.accountId,
        accountLogin: lifecycle.accountLogin,
        accountType: lifecycle.accountType,
        status: lifecycle.installationStatus
      });
    }

    await recordInstallationLifecycleAuditEvent(lifecycle.auditAction, "completed", lifecycle, context, {
      statusCode: 200,
      code: lifecycle.code,
      tenantId
    });

    return noStoreJson({
      ok: true,
      accepted: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      installationId: lifecycle.installationId,
      disabledGrantCount: result.updatedCount,
      privacy: "grant-metadata-only",
      note: lifecycle.repositoryIds
        ? "Removed GitHub App repository access disabled matching AgentProof repository grants."
        : "GitHub App installation lifecycle disabled matching AgentProof repository grants."
    });
  } catch (error) {
    if (error instanceof GitHubInstallationStoreError) {
      await recordInstallationLifecycleAuditEvent("github_app_lifecycle_store_unavailable", "failed", lifecycle, context, {
        statusCode: 503,
        code: "github_app_installation_metadata_store_unavailable"
      });

      return noStoreJson({
        error: "GitHub App installation metadata store is unavailable.",
        code: "github_app_installation_metadata_store_unavailable",
        willAnalyze: false,
        willComment: false
      }, { status: 503 });
    }

    if (error instanceof TenantControlPlaneStoreError) {
      await recordInstallationLifecycleAuditEvent("github_app_lifecycle_store_unavailable", "failed", lifecycle, context, {
        statusCode: 503,
        code: "github_app_tenant_grant_store_unavailable"
      });

      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "github_app_tenant_grant_store_unavailable",
        willAnalyze: false,
        willComment: false
      }, { status: 503 });
    }

    throw error;
  }
}

async function handlePullRequestAutomation(
  payload: Record<string, unknown>,
  context: {
    requestUrl: string;
    delivery: string;
    event: string;
    action: string | undefined;
    commentEnabled: boolean;
    saveReportsEnabled: boolean;
    legacyRepoAllowed: boolean;
  }
) {
  if (!shouldHandlePullRequestAction(context.action)) {
    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      note: "Pull request action ignored by AgentProof automation."
    });
  }

  const automation = parsePullRequestAutomationPayload(payload);
  if (!automation) {
    return noStoreJson({
      error: "GitHub pull_request webhook payload is missing required automation fields or has mismatched repository metadata.",
      code: "github_app_payload_invalid",
      willAnalyze: false,
      willComment: false
    }, { status: 422 });
  }

  let tenantGrant;
  try {
    tenantGrant = await authorizeTenantRepositoryGrantAsync({
      installationId: automation.installationId,
      repositoryFullName: automation.repositoryFullName,
      repositoryId: automation.repositoryId
    });
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      await recordWebhookAuditEvent("github_app_grant_store_unavailable", "failed", automation, context, {
        statusCode: 503,
        code: "github_app_tenant_grant_store_unavailable"
      });

      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "github_app_tenant_grant_store_unavailable",
        willAnalyze: false,
        willComment: false
      }, { status: 503 });
    }

    if (error instanceof TenantDeletionStateError) {
      await recordWebhookAuditEvent("github_app_grant_store_unavailable", "failed", automation, context, {
        statusCode: 503,
        code: "github_app_tenant_guard_unavailable"
      });

      return noStoreJson({
        error: "Tenant repository guard is unavailable.",
        code: "github_app_tenant_guard_unavailable",
        willAnalyze: false,
        willComment: false
      }, { status: 503 });
    }

    throw error;
  }

  if (tenantGrant.enabled && tenantGrant.reason) {
    const status = tenantGrant.reason === "invalid-grants" ? 503 : 200;
    const body = {
      ok: tenantGrant.reason !== "invalid-grants",
      ignored: tenantGrant.reason !== "invalid-grants" ? true : undefined,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      code: tenantGrant.reason === "invalid-grants"
        ? "github_app_tenant_grants_invalid"
        : "github_app_tenant_grant_required",
      note: tenantGrantPublicReason(tenantGrant.reason)
    };

    await recordWebhookAuditEvent("github_app_grant_denied", status === 503 ? "failed" : "blocked", automation, context, {
      tenantId: tenantGrant.grant?.tenantId,
      statusCode: status,
      code: body.code
    });

    return noStoreJson(body, { status });
  }

  if (!tenantGrant.enabled && !context.legacyRepoAllowed) {
    await recordWebhookAuditEvent("github_app_grant_denied", "blocked", automation, context, {
      statusCode: 200,
      code: "github_app_repo_not_allowed"
    });

    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      note: "Repository is not in AGENTPROOF_GITHUB_APP_ALLOWED_REPOS."
    });
  }

  const appStatus = getGitHubAppConfigStatus();
  if (!appStatus.ready) {
    await recordWebhookAuditEvent("github_app_not_ready", "blocked", automation, context, {
      tenantId: tenantGrant.grant?.tenantId,
      statusCode: 503,
      code: "github_app_not_ready"
    });

    return noStoreJson({
      error: "GitHub App automation is enabled, but App credentials are incomplete or invalid.",
      code: "github_app_not_ready",
      willAnalyze: false,
      willComment: false
    }, { status: 503 });
  }

  const idempotencyKey = [
    tenantGrant.grant?.tenantId ?? "operator",
    automation.installationId,
    automation.repositoryFullName.toLowerCase(),
    automation.pullRequestNumber,
    automation.headSha,
    context.action
  ].join(":");
  const queueStatus = getAnalysisJobQueueStatus();
  if (queueStatus.enabled && !queueStatus.configured) {
    await recordWebhookAuditEvent("github_app_analysis_queue_unavailable", "failed", automation, context, {
      tenantId: tenantGrant.grant?.tenantId,
      statusCode: 503,
      code: "github_app_analysis_queue_unavailable"
    });

    return noStoreJson({
      error: "Analysis job queue is unavailable.",
      code: "github_app_analysis_queue_unavailable",
      willAnalyze: false,
      willComment: false
    }, { status: 503 });
  }

  if (tenantGrant.enabled) {
    let quota: UsageQuotaReservation;
    try {
      quota = await reserveUsageQuota({
        tenantId: tenantGrant.grant?.tenantId,
        feature: "github_app_analysis",
        idempotencyKey
      });
    } catch (error) {
      if (error instanceof UsageQuotaStoreError) {
        await recordWebhookAuditEvent("github_app_quota_unavailable", "failed", automation, context, {
          tenantId: tenantGrant.grant?.tenantId,
          statusCode: 503,
          code: "usage_quota_unavailable"
        });

        return noStoreJson({
          error: "Usage quota store is unavailable.",
          code: "usage_quota_unavailable",
          willAnalyze: false,
          willComment: false
        }, { status: 503 });
      }

      throw error;
    }

    if (!quota.allowed) {
      const invalidQuota = quota.reason === "quota-limits-invalid";
      const status = invalidQuota ? 503 : 200;
      const code = invalidQuota
        ? "github_app_tenant_quota_invalid"
        : "github_app_tenant_quota_blocked";

      await recordWebhookAuditEvent("github_app_quota_blocked", invalidQuota ? "failed" : "blocked", automation, context, {
        tenantId: tenantGrant.grant?.tenantId,
        statusCode: status,
        code
      });

      return noStoreJson({
        ok: !invalidQuota,
        ignored: !invalidQuota ? true : undefined,
        dryRun: false,
        event: safeWebhookString(context.event),
        delivery: safeWebhookString(context.delivery),
        action: context.action,
        automationEnabled: true,
        willAnalyze: false,
        willComment: false,
        code,
        note: usageQuotaPublicReason(quota.reason)
      }, { status });
    }
  }

  let reservation;
  try {
    reservation = await reserveGitHubWebhookDelivery({
      key: idempotencyKey,
      tenantId: tenantGrant.grant?.tenantId,
      event: context.event,
      delivery: context.delivery,
      installationId: automation.installationId,
      repositoryFullName: automation.repositoryFullName,
      pullRequestNumber: automation.pullRequestNumber,
      headSha: automation.headSha,
      action: context.action ?? "unknown"
    });
  } catch (error) {
    if (error instanceof GitHubWebhookIdempotencyError) {
      await recordWebhookAuditEvent("github_app_idempotency_unavailable", "failed", automation, context, {
        tenantId: tenantGrant.grant?.tenantId,
        statusCode: 503,
        code: "github_app_idempotency_unavailable"
      });

      return noStoreJson({
        error: "GitHub App idempotency store is unavailable.",
        code: "github_app_idempotency_unavailable",
        willAnalyze: false,
        willComment: false
      }, { status: 503 });
    }

    throw error;
  }

  if (!reservation.accepted) {
    await recordWebhookAuditEvent("github_app_duplicate_skipped", "skipped", automation, context, {
      tenantId: tenantGrant.grant?.tenantId,
      statusCode: 200,
      code: reservation.duplicateStatus === "processing" ? "duplicate_processing" : "duplicate_completed"
    });

    return noStoreJson({
      ok: true,
      accepted: true,
      duplicate: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      analysis: {
        status: "skipped",
        repository: automation.repositoryFullName,
        pullRequestNumber: automation.pullRequestNumber,
        headSha: automation.headSha,
        reason: reservation.duplicateStatus === "processing"
          ? "Analysis is already in progress for this PR head SHA and action."
          : "Duplicate delivery for this PR head SHA and action."
      }
    });
  }

  const plannedSideEffects = {
    saveReport: context.saveReportsEnabled
      && (!tenantGrant.enabled || tenantGrant.grant?.saveReportsEnabled === true),
    comment: context.commentEnabled
      && (!tenantGrant.enabled || tenantGrant.grant?.commentEnabled === true)
  };
  const sideEffectGateResponse = await requireDurableAuditForSideEffects(
    automation,
    context,
    tenantGrant.grant?.tenantId,
    plannedSideEffects
  );
  if (sideEffectGateResponse) {
    await failGitHubWebhookDelivery({
      key: idempotencyKey
    }, {
      code: "github_app_durable_audit_required",
      summary: "Durable audit storage is required before GitHub App side effects."
    }).catch(() => undefined);

    return sideEffectGateResponse;
  }

  if (queueStatus.enabled) {
    try {
      const job = await enqueueAnalysisJob({
        tenantId: tenantGrant.grant?.tenantId,
        idempotencyKey,
        deliveryId: context.delivery,
        event: context.event,
        action: context.action,
        installationId: automation.installationId,
        repositoryId: automation.repositoryId,
        repositoryFullName: automation.repositoryFullName,
        pullRequestNumber: automation.pullRequestNumber,
        pullRequestUrl: automation.pullRequestUrl,
        headSha: automation.headSha,
        saveReport: plannedSideEffects.saveReport,
        comment: plannedSideEffects.comment
      });

      await recordWebhookAuditEvent("github_app_analysis_queued", "completed", automation, context, {
        tenantId: tenantGrant.grant?.tenantId,
        statusCode: 202,
        code: job.durable ? "github_app_analysis_queued_durable" : "github_app_analysis_queued_memory"
      });

      return noStoreJson({
        ok: true,
        accepted: true,
        queued: true,
        dryRun: false,
        event: safeWebhookString(context.event),
        delivery: safeWebhookString(context.delivery),
        action: context.action,
        automationEnabled: true,
        willAnalyze: true,
        willComment: plannedSideEffects.comment,
        analysis: {
          status: "queued",
          jobId: job.id,
          repository: automation.repositoryFullName,
          pullRequestNumber: automation.pullRequestNumber,
          headSha: automation.headSha,
          queue: {
            store: job.store,
            durable: job.durable
          }
        }
      }, { status: 202 });
    } catch (error) {
      const errorMessage = redactSecrets(error instanceof Error ? error.message : "Analysis job queue is unavailable.");
      await failGitHubWebhookDelivery({
        key: idempotencyKey
      }, {
        code: "github_app_analysis_queue_unavailable",
        summary: errorMessage
      }).catch(() => undefined);
      await recordWebhookAuditEvent("github_app_analysis_queue_unavailable", "failed", automation, context, {
        tenantId: tenantGrant.grant?.tenantId,
        statusCode: 503,
        code: "github_app_analysis_queue_unavailable"
      });

      return noStoreJson({
        error: error instanceof AnalysisJobQueueError
          ? "Analysis job queue is unavailable."
          : "Analysis job queue could not accept the webhook.",
        code: "github_app_analysis_queue_unavailable",
        willAnalyze: false,
        willComment: false
      }, { status: 503 });
    }
  }

  try {
    const token = await createGitHubInstallationAccessToken(automation.installationId);
    const input = await buildGitHubPullRequestInput(automation.pullRequestUrl, token, "");

    if (!input) {
      throw new Error("GitHub App PR analysis could not build a pull request input.");
    }

    input.limitations = [
      ...(input.limitations ?? []),
      "GitHub App automation v1 does not fetch linked issue/task text; requirements are extracted from the PR description unless the original request is included there."
    ];

    const report = generateVerificationReport(input);
    const validation = validateVerificationReport(report, { mode: "full" });

    if (!validation.valid) {
      throw new Error(`Generated report failed runtime validation: ${validation.errors.join("; ")}`);
    }

    const canSaveReport = plannedSideEffects.saveReport;
    const canPostComment = plannedSideEffects.comment;
    const saved = canSaveReport
      ? await createAutomationSavedReport(report, {
        requestUrl: context.requestUrl,
        tenantId: tenantGrant.grant?.tenantId
      })
      : undefined;
    const comment = canPostComment
      ? await postGitHubAppMarkerComment(automation, token, report)
      : undefined;
    const analysis = {
      status: "completed",
      repository: automation.repositoryFullName,
      pullRequestNumber: automation.pullRequestNumber,
      headSha: automation.headSha,
      priority: report.summary.priority,
      evidenceCoverage: report.summary.evidenceCoverage,
      savedReport: saved,
      comment
    };

    await completeGitHubWebhookDelivery({ key: idempotencyKey }, {
      status: "completed",
      repository: analysis.repository,
      pullRequestNumber: analysis.pullRequestNumber,
      headSha: analysis.headSha,
      priority: analysis.priority,
      evidenceCoverage: analysis.evidenceCoverage,
      savedReport: saved ? {
        privacy: saved.privacy,
        durability: saved.durability
      } : undefined,
      comment: comment ? {
        action: comment.action
      } : undefined
    }).catch(() => undefined);

    await recordWebhookAuditEvent("github_app_analysis_completed", "completed", automation, context, {
      tenantId: tenantGrant.grant?.tenantId,
      statusCode: 200,
      priority: report.summary.priority,
      evidenceCoverage: report.summary.evidenceCoverage,
      savedReport: saved ? {
        privacy: saved.privacy,
        durability: saved.durability
      } : undefined,
      comment: comment ? {
        action: comment.action
      } : undefined
    });

    return noStoreJson({
      ok: true,
      accepted: true,
      dryRun: false,
      event: safeWebhookString(context.event),
      delivery: safeWebhookString(context.delivery),
      action: context.action,
      automationEnabled: true,
      willAnalyze: true,
      willComment: Boolean(comment),
      analysis
    });
  } catch (error) {
    const errorMessage = redactSecrets(error instanceof Error ? error.message : "GitHub App automation failed.");
    const status = error instanceof SavedReportStoreError ? 503 : 502;
    await failGitHubWebhookDelivery({
      key: idempotencyKey
    }, {
      code: error instanceof SavedReportStoreError ? "saved_report_store_error" : "github_app_automation_failed",
      summary: errorMessage
    }).catch(() => undefined);
    await recordWebhookAuditEvent("github_app_analysis_failed", "failed", automation, context, {
      tenantId: tenantGrant.grant?.tenantId,
      statusCode: status,
      code: error instanceof SavedReportStoreError ? "saved_report_store_error" : "github_app_automation_failed"
    });

    return noStoreJson({
      error: errorMessage,
      code: "github_app_automation_failed"
    }, { status });
  }
}

async function recordWebhookAuditEvent(
  action: AuditEventAction,
  result: AuditEventResult,
  automation: NonNullable<ReturnType<typeof parsePullRequestAutomationPayload>>,
  context: {
    delivery: string;
    action: string | undefined;
  },
  options: {
    tenantId?: string;
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
  } = {}
) {
  await recordAuditEvent({
    action,
    result,
    actor: "github_app",
    tenantId: options.tenantId,
    repositoryFullName: automation.repositoryFullName,
    installationId: automation.installationId,
    pullRequestNumber: automation.pullRequestNumber,
    headSha: automation.headSha,
    githubDeliveryId: context.delivery,
    webhookAction: context.action,
    statusCode: options.statusCode,
    code: options.code,
    priority: options.priority,
    evidenceCoverage: options.evidenceCoverage,
    savedReport: options.savedReport,
    comment: options.comment
  }).catch(() => undefined);
}

async function requireDurableAuditForSideEffects(
  automation: NonNullable<ReturnType<typeof parsePullRequestAutomationPayload>>,
  context: {
    delivery: string;
    action: string | undefined;
  },
  tenantId: string | undefined,
  sideEffects: {
    saveReport: boolean;
    comment: boolean;
  }
): Promise<Response | null> {
  if (!requiresDurableAuditForSideEffects() || (!sideEffects.saveReport && !sideEffects.comment)) {
    return null;
  }

  const status = getAuditLogStoreStatus();
  if (!status.durable) {
    return durableAuditRequiredResponse();
  }

  try {
    await recordAuditEvent({
      action: "github_app_side_effects_ready",
      result: "completed",
      actor: "github_app",
      tenantId,
      repositoryFullName: automation.repositoryFullName,
      installationId: automation.installationId,
      pullRequestNumber: automation.pullRequestNumber,
      headSha: automation.headSha,
      githubDeliveryId: context.delivery,
      webhookAction: context.action,
      statusCode: 200,
      code: sideEffectAuditCode(sideEffects),
      savedReport: sideEffects.saveReport ? {
        privacy: "summary-only"
      } : undefined,
      comment: sideEffects.comment ? {
        action: "planned"
      } : undefined
    });
  } catch {
    return durableAuditRequiredResponse();
  }

  return null;
}

function requiresDurableAuditForSideEffects(): boolean {
  return /^(1|true|yes)$/i.test(process.env.AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS ?? "");
}

function durableAuditRequiredResponse(): Response {
  return noStoreJson({
    error: "Durable audit storage is required before GitHub App side effects.",
    code: "github_app_durable_audit_required",
    willAnalyze: false,
    willComment: false
  }, { status: 503 });
}

function sideEffectAuditCode(sideEffects: { saveReport: boolean; comment: boolean }): string {
  if (sideEffects.saveReport && sideEffects.comment) return "github_app_side_effects_ready";
  if (sideEffects.saveReport) return "github_app_saved_report_ready";
  return "github_app_comment_ready";
}

async function recordInstallationLifecycleAuditEvent(
  action: AuditEventAction,
  result: AuditEventResult,
  lifecycle: NonNullable<ReturnType<typeof parseInstallationLifecyclePayload>>,
  context: {
    delivery: string;
    action: string | undefined;
  },
  options: {
    tenantId?: string;
    statusCode?: number;
    code?: string;
  } = {}
) {
  await recordAuditEvent({
    action,
    result,
    actor: "github_app",
    tenantId: options.tenantId,
    installationId: lifecycle.installationId,
    githubDeliveryId: context.delivery,
    webhookAction: context.action,
    statusCode: options.statusCode,
    code: options.code
  }).catch(() => undefined);
}

function buildWebhookDryRunSummary(payload: Record<string, unknown>) {
  const repository = getNestedRecord(payload, "repository");
  const pullRequest = getNestedRecord(payload, "pull_request");
  const checkRun = getNestedRecord(payload, "check_run");
  const statusContext = safeWebhookString(typeof payload.context === "string" ? payload.context : undefined);

  return {
    repository: getString(repository, "full_name"),
    pullRequestNumber: getNumber(pullRequest, "number"),
    pullRequestUrl: getString(pullRequest, "html_url"),
    checkRunName: getString(checkRun, "name"),
    statusContext
  };
}

function isInstallationLifecycleEvent(event: string): boolean {
  return event === "installation" || event === "installation_repositories";
}

function parseInstallationLifecyclePayload(
  payload: Record<string, unknown>,
  event: string,
  action: string | undefined
) {
  const installation = getNestedRecord(payload, "installation");
  const installationId = getNumber(installation, "id");
  if (!installationId) return null;

  if (event === "installation") {
    const shouldDisable = action === "deleted" || action === "suspend" || action === "suspended";
    const account = getNestedRecord(installation ?? {}, "account");

    return {
      installationId,
      shouldDisable,
      installationStatus: action === "deleted"
        ? "deleted" as const
        : shouldDisable
          ? "suspended" as const
          : undefined,
      accountId: getNumber(account, "id"),
      accountLogin: getString(account, "login"),
      accountType: getString(account, "type"),
      auditAction: "github_app_installation_disabled" as const,
      code: shouldDisable ? "github_app_installation_disabled" : "github_app_installation_no_change"
    };
  }

  if (event === "installation_repositories") {
    const repositoryIds = getRepositoryIds(payload.repositories_removed);
    const shouldDisable = action === "removed" && repositoryIds.length > 0;

    return {
      installationId,
      repositoryIds,
      shouldDisable,
      installationStatus: undefined,
      accountId: undefined,
      accountLogin: undefined,
      accountType: undefined,
      auditAction: "github_app_repository_access_removed" as const,
      code: shouldDisable ? "github_app_repository_access_removed" : "github_app_repository_access_no_change"
    };
  }

  return null;
}

function getRepositoryIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const ids = value
    .map((item) => getNumber(item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined, "id"))
    .filter((id): id is number => Boolean(id));

  return Array.from(new Set(ids)).slice(0, 500);
}

function uniqueTenantId(grants: Array<{ tenantId?: string }>): string | undefined {
  const tenants = new Set(grants.map((grant) => grant.tenantId).filter((tenantId): tenantId is string => Boolean(tenantId)));

  return tenants.size === 1 ? Array.from(tenants)[0] : undefined;
}

function getNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = parent[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];

  return safeWebhookString(typeof value === "string" ? value : undefined);
}

function getNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getGitHubAppSmokeControls(payload: Record<string, unknown>) {
  const smoke = getNestedRecord(payload, "agentproofSmoke");
  const enabled = smoke?.mode === "live-analysis";

  return {
    suppressComment: enabled && smoke.suppressComment === true,
    suppressSavedReport: enabled && smoke.suppressSavedReport === true
  };
}

function parsePullRequestAutomationPayload(payload: Record<string, unknown>) {
  const repository = getNestedRecord(payload, "repository");
  const pullRequest = getNestedRecord(payload, "pull_request");
  const installation = getNestedRecord(payload, "installation");
  const repositoryFullName = getString(repository, "full_name");
  const repositoryId = getNumber(repository, "id");
  const pullRequestNumber = getNumber(pullRequest, "number");
  const pullRequestUrl = getString(pullRequest, "html_url");
  const head = getNestedRecord(pullRequest ?? {}, "head");
  const headSha = getString(head, "sha");
  const installationId = getNumber(installation, "id");

  if (!repositoryFullName || !pullRequestNumber || !pullRequestUrl || !headSha || !isGitHubSha(headSha) || !installationId) {
    return null;
  }

  const parsedPrUrl = parseGitHubPullRequestUrl(pullRequestUrl);
  if (
    !parsedPrUrl ||
    parsedPrUrl.fullName.toLowerCase() !== repositoryFullName.toLowerCase() ||
    parsedPrUrl.number !== pullRequestNumber
  ) {
    return null;
  }

  return {
    repositoryFullName,
    repositoryId,
    pullRequestNumber,
    pullRequestUrl,
    headSha,
    installationId
  };
}

function parseGitHubPullRequestUrl(value: string) {
  try {
    const url = new URL(value);
    const [, owner, repo, pull, number] = url.pathname.split("/");
    const prNumber = Number(number);

    if (url.hostname !== "github.com" || !owner || !repo || pull !== "pull" || !Number.isInteger(prNumber) || prNumber <= 0) {
      return null;
    }

    return {
      fullName: `${owner}/${repo}`,
      number: prNumber
    };
  } catch {
    return null;
  }
}

function isGitHubSha(value: string): boolean {
  return /^[a-f0-9]{6,64}$/i.test(value);
}

function safeWebhookString(value: string | undefined): string | undefined {
  return value ? redactSecrets(value).slice(0, 500) : undefined;
}
