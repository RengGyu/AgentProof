import {
  getGitHubAppReadinessStatus,
  getGitHubWebhookIdempotencyStoreStatus,
  type GitHubAppReadinessStatus,
  type GitHubWebhookIdempotencyStoreStatus
} from "@/lib/github-app";
import { noStoreJson } from "@/lib/http";

type OpsReadinessValue = "ready" | "not-ready" | "not-configured";
type OpsToggleValue = "enabled" | "disabled";
type OpsRepoScopeValue = "configured" | "all-installed" | "missing";
type OpsIdempotencyValue = "durable-supabase" | "memory-only" | "config-incomplete";

export async function GET(request: Request) {
  const opsToken = process.env.AGENTPROOF_OPS_TOKEN;

  if (!opsToken?.trim()) {
    return noStoreJson({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    }, { status: 501 });
  }

  if (request.headers.get("x-agentproof-ops-token") !== opsToken) {
    return noStoreJson({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    }, { status: 401 });
  }

  const readiness = getGitHubAppReadinessStatus();
  const idempotency = getGitHubWebhookIdempotencyStoreStatus();

  return noStoreJson({
    githubApp: toOperatorGitHubAppStatus(readiness, idempotency)
  });
}

function toOperatorGitHubAppStatus(
  readiness: GitHubAppReadinessStatus,
  idempotency: GitHubWebhookIdempotencyStoreStatus
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
    cautions: operatorCautions(readiness, idempotency)
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

function operatorCautions(
  readiness: GitHubAppReadinessStatus,
  idempotency: GitHubWebhookIdempotencyStoreStatus
): string[] {
  const cautions: string[] = [];
  const scope = repoScope(readiness);
  const duplicateStore = idempotencyMode(idempotency);

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

  return cautions;
}
