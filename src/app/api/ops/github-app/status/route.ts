import {
  getAnalysisJobQueueStatus,
  getAnalysisJobQueueSummary,
  type AnalysisJobQueueStatus,
  type AnalysisJobQueueSummary
} from "@/lib/analysis-jobs";
import { ANALYSIS_QUEUE_ALERT_BASIS, toAnalysisQueueAlerts } from "@/lib/analysis-job-alerts";
import {
  getGitHubAppReadinessStatus,
  getGitHubWebhookIdempotencyStoreStatus,
  type GitHubAppReadinessStatus,
  type GitHubWebhookIdempotencyStoreStatus
} from "@/lib/github-app";
import {
  getGitHubInstallationMetadataStoreStatus,
  type GitHubInstallationMetadataStoreStatus
} from "@/lib/github-installations";
import { getGitHubOnboardingConfigStatus } from "@/lib/github-onboarding";
import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";
import { getTenantControlPlaneSettings } from "@/lib/tenant-control-plane";

type OpsReadinessValue = "ready" | "not-ready" | "not-configured";
type OpsToggleValue = "enabled" | "disabled";
type OpsRepoScopeValue = "configured" | "all-installed" | "missing";
type OpsIdempotencyValue = "durable-supabase" | "memory-only" | "config-incomplete";
type OpsQueueValue = "disabled" | "durable-supabase" | "memory-only" | "config-incomplete";
type OpsInstallationMetadataValue = "disabled" | "durable-supabase" | "memory-only" | "config-incomplete";

interface OpsTenantControlStatus {
  onboardingConfigured: boolean;
  tenantControlEnabled: boolean;
}

export async function GET(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  const readiness = getGitHubAppReadinessStatus();
  const idempotency = getGitHubWebhookIdempotencyStoreStatus();
  const installationMetadata = getGitHubInstallationMetadataStoreStatus();
  const tenantControl = {
    onboardingConfigured: getGitHubOnboardingConfigStatus().configured,
    tenantControlEnabled: getTenantControlPlaneSettings().enabled
  };
  const analysisQueue = getAnalysisJobQueueStatus();
  const analysisQueueSummary = await safeAnalysisQueueSummary(analysisQueue);

  return noStoreJson({
    githubApp: toOperatorGitHubAppStatus(readiness, idempotency, installationMetadata, tenantControl, analysisQueue, analysisQueueSummary)
  });
}

function toOperatorGitHubAppStatus(
  readiness: GitHubAppReadinessStatus,
  idempotency: GitHubWebhookIdempotencyStoreStatus,
  installationMetadata: GitHubInstallationMetadataStoreStatus,
  tenantControl: OpsTenantControlStatus,
  analysisQueue: AnalysisJobQueueStatus,
  analysisQueueSummary: AnalysisJobQueueSummary | null
) {
  return {
    mode: readiness.mode,
    signedIntake: signedIntakeStatus(readiness),
    appCredentials: appCredentialsStatus(readiness),
    automation: toggleStatus(readiness.automationEnabled),
    repoScope: repoScope(readiness),
    commentOptIn: toggleStatus(readiness.commentEnabled),
    savedReportOptIn: toggleStatus(readiness.saveReportsEnabled),
    idempotency: idempotencyMode(idempotency),
    installationMetadata: installationMetadataMode(installationMetadata),
    analysisQueue: analysisQueueMode(analysisQueue),
    analysisQueueSummary: toPublicAnalysisQueueSummary(analysisQueueSummary),
    analysisQueueAlertBasis: analysisQueueSummary ? ANALYSIS_QUEUE_ALERT_BASIS : undefined,
    analysisQueueAlerts: toPublicAnalysisQueueAlerts(analysisQueueSummary),
    cautions: operatorCautions(readiness, idempotency, installationMetadata, tenantControl, analysisQueue)
  };
}

function signedIntakeStatus(readiness: GitHubAppReadinessStatus): OpsReadinessValue {
  return readiness.signedIntakeReady ? "ready" : "not-configured";
}

function appCredentialsStatus(readiness: GitHubAppReadinessStatus): OpsReadinessValue {
  return readiness.appCredentialsReady ? "ready" : "not-ready";
}

function toggleStatus(enabled: boolean): OpsToggleValue {
  return enabled ? "enabled" : "disabled";
}

function repoScope(readiness: GitHubAppReadinessStatus): OpsRepoScopeValue {
  if (readiness.allowAllRepos) return "all-installed";
  if (readiness.allowedRepoCount > 0) return "configured";
  return "missing";
}

function idempotencyMode(status: GitHubWebhookIdempotencyStoreStatus): OpsIdempotencyValue {
  if (status.missingEnv.length > 0) return "config-incomplete";
  if (status.durable) return "durable-supabase";
  return "memory-only";
}

function installationMetadataMode(status: GitHubInstallationMetadataStoreStatus): OpsInstallationMetadataValue {
  if (status.missingEnv.length > 0) return "config-incomplete";
  if (!status.configured) return "disabled";
  if (status.durable) return "durable-supabase";
  return "memory-only";
}

function analysisQueueMode(status: AnalysisJobQueueStatus): OpsQueueValue {
  if (!status.enabled) return "disabled";
  if (!status.configured) return "config-incomplete";
  if (status.durable) return "durable-supabase";
  return "memory-only";
}

function operatorCautions(
  readiness: GitHubAppReadinessStatus,
  idempotency: GitHubWebhookIdempotencyStoreStatus,
  installationMetadata: GitHubInstallationMetadataStoreStatus,
  tenantControl: OpsTenantControlStatus,
  analysisQueue: AnalysisJobQueueStatus
): string[] {
  const cautions: string[] = [];
  const scope = repoScope(readiness);
  const duplicateStore = idempotencyMode(idempotency);
  const installationStore = installationMetadataMode(installationMetadata);
  const queueStore = analysisQueueMode(analysisQueue);

  if (!readiness.signedIntakeReady) {
    cautions.push("Signed webhook intake is not ready.");
  }

  if (readiness.automationEnabled && !readiness.appCredentialsReady) {
    cautions.push("Automation is enabled but App credentials are not ready.");
  }

  if (readiness.automationEnabled && scope === "missing") {
    cautions.push("Automation is enabled without a repository scope.");
  }

  if (scope === "all-installed") {
    cautions.push("Repository scope covers all installed repositories; restrict before production automation.");
  }

  if (readiness.commentEnabled) {
    cautions.push("Automatic marker comments are enabled.");
  }

  if (readiness.saveReportsEnabled) {
    cautions.push("Saved report links are enabled; stored reports must remain summary-only.");
  }

  if (readiness.canAnalyzePullRequests && duplicateStore !== "durable-supabase") {
    cautions.push("PR event analysis is ready without durable duplicate suppression.");
  }

  if (duplicateStore === "config-incomplete") {
    cautions.push("Durable duplicate suppression is partially configured and should fail closed.");
  }

  if (installationStore === "config-incomplete") {
    cautions.push("GitHub installation metadata storage is partially configured and should fail closed.");
  }

  if (installationStore === "disabled" && (tenantControl.onboardingConfigured || tenantControl.tenantControlEnabled)) {
    cautions.push("GitHub installation metadata storage is disabled while tenant onboarding or control-plane mode is configured.");
  }

  if (installationStore === "memory-only") {
    cautions.push("GitHub installation metadata is using memory-only storage; use durable storage for beta/SaaS onboarding.");
  }

  if (queueStore === "config-incomplete") {
    cautions.push("Analysis job queue is enabled but storage is not fully configured.");
  }

  if (queueStore === "memory-only") {
    cautions.push("Analysis job queue is using memory-only storage; use durable storage for beta/SaaS automation.");
  }

  return cautions;
}

async function safeAnalysisQueueSummary(
  status: AnalysisJobQueueStatus
): Promise<AnalysisJobQueueSummary | null> {
  if (!status.enabled || !status.configured) return null;

  try {
    return await getAnalysisJobQueueSummary();
  } catch {
    return null;
  }
}

function toPublicAnalysisQueueSummary(summary: AnalysisJobQueueSummary | null) {
  if (!summary) return undefined;

  return {
    privacy: summary.privacy,
    sampled: summary.sampled,
    truncated: summary.truncated,
    counts: summary.counts,
    due: summary.due,
    delayedRetry: summary.delayedRetry,
    staleProcessing: summary.staleProcessing,
    oldestQueuedAgeSeconds: summary.oldestQueuedAgeSeconds,
    oldestRetryAgeSeconds: summary.oldestRetryAgeSeconds
  };
}

function toPublicAnalysisQueueAlerts(summary: AnalysisJobQueueSummary | null) {
  const alerts = toAnalysisQueueAlerts(summary);
  return alerts.length > 0 ? alerts : undefined;
}
