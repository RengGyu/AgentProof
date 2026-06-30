import {
  createGitHubInstallationAccessToken,
  getGitHubAppConfigStatus,
  GitHubAppTokenError
} from "@/lib/github-app";
import { verifyTenantAdminAccess } from "@/lib/github-onboarding";
import { noStoreJson } from "@/lib/http";
import {
  getTenantControlPlaneSettings,
  listTenantRepositoryGrants,
  TenantControlPlaneStoreError,
  type TenantRepositoryGrant
} from "@/lib/tenant-control-plane";

const MAX_HEALTH_REPOSITORIES = 50;
const MAX_GITHUB_PROBE_REPOSITORIES = 10;
const GITHUB_REPOSITORY_PROBE_TIMEOUT_MS = 6000;

type GrantHealthStatus =
  | "ready"
  | "disabled"
  | "analysis-disabled"
  | "app-credentials-not-ready"
  | "github-accessible"
  | "github-inaccessible"
  | "github-rate-limited"
  | "github-unavailable"
  | "github-not-checked";

type GitHubAccessStatus =
  | "not-checked"
  | "accessible"
  | "inaccessible"
  | "rate-limited"
  | "unavailable"
  | "credentials-not-ready";

interface RepositoryHealth {
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  saveReportsEnabled: boolean;
  commentEnabled: boolean;
  status: GrantHealthStatus;
  githubAccess: GitHubAccessStatus;
  checks: {
    grantActive: boolean;
    analysisEnabled: boolean;
    appCredentialsReady: boolean;
    githubAccess: GitHubAccessStatus;
  };
  nextAction: string;
}

export async function GET(request: Request) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Tenant control plane must be enabled before repository health can be read.",
      code: "tenant_repository_health_control_required"
    }, { status: 409 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const probeGitHub = url.searchParams.get("probe") === "github";
  const requestedRepositoryId = normalizeRepositoryId(url.searchParams.get("repositoryId"));
  const access = verifyTenantAdminAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant repository health requires a valid tenant-bound invite token.",
      code: "tenant_repository_health_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  if (url.searchParams.has("repositoryId") && !requestedRepositoryId) {
    return noStoreJson({
      error: "Repository health probe repositoryId must be a positive integer.",
      code: "tenant_repository_health_repository_id_invalid"
    }, { status: 422 });
  }

  let repositories: TenantRepositoryGrant[];
  try {
    repositories = await listTenantRepositoryGrants({ tenantId: authorizedTenantId });
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "tenant_repository_grant_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }

  const appStatus = getGitHubAppConfigStatus();
  const boundedRepositories = repositories.slice(0, MAX_HEALTH_REPOSITORIES);
  const probeCandidates = probeGitHub && appStatus.ready
    ? selectProbeCandidates(boundedRepositories, requestedRepositoryId)
    : [];
  const accessByRepository = probeCandidates.length > 0
    ? await probeRepositoryAccess(probeCandidates)
    : new Map<string, GitHubAccessStatus>();
  const health = boundedRepositories.map((grant) =>
    toRepositoryHealth(grant, {
      appCredentialsReady: appStatus.ready,
      githubAccess: probeGitHub
        ? accessByRepository.get(repositoryHealthKey(grant)) ?? (appStatus.ready ? "not-checked" : "credentials-not-ready")
        : "not-checked"
    })
  );

  return noStoreJson({
    ok: true,
    tenantId: authorizedTenantId,
    repositories: health,
    truncated: repositories.length > boundedRepositories.length,
    probe: probeGitHub ? "github" : "metadata-only",
    githubProbe: probeGitHub ? {
      checkedRepositories: probeCandidates.length,
      maxRepositories: MAX_GITHUB_PROBE_REPOSITORIES,
      requestedRepositoryId
    } : undefined,
    privacy: "grant-metadata-only",
    next: "fix_repository_setup"
  });
}

function selectProbeCandidates(
  grants: TenantRepositoryGrant[],
  requestedRepositoryId?: number
): TenantRepositoryGrant[] {
  const withRepositoryIds = grants.filter((grant) => Number.isInteger(grant.repositoryId));

  if (requestedRepositoryId) {
    return withRepositoryIds.filter((grant) => grant.repositoryId === requestedRepositoryId).slice(0, 1);
  }

  return withRepositoryIds.slice(0, MAX_GITHUB_PROBE_REPOSITORIES);
}

async function probeRepositoryAccess(grants: TenantRepositoryGrant[]): Promise<Map<string, GitHubAccessStatus>> {
  const results = new Map<string, GitHubAccessStatus>();
  const tokenByInstallation = new Map<number, string | null>();

  for (const grant of grants) {
    const key = repositoryHealthKey(grant);
    if (!grant.repositoryId) {
      results.set(key, "inaccessible");
      continue;
    }

    let token = tokenByInstallation.get(grant.installationId);
    if (token === undefined) {
      try {
        token = await createGitHubInstallationAccessToken(grant.installationId);
      } catch (error) {
        if (error instanceof GitHubAppTokenError) {
          token = null;
        } else {
          throw error;
        }
      }
      tokenByInstallation.set(grant.installationId, token);
    }

    if (!token) {
      results.set(key, "credentials-not-ready");
      continue;
    }

    results.set(key, await fetchRepositoryAccess(grant.repositoryId, token));
  }

  return results;
}

async function fetchRepositoryAccess(repositoryId: number, token: string): Promise<GitHubAccessStatus> {
  try {
    const response = await fetch(`https://api.github.com/repositories/${repositoryId}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store",
      signal: AbortSignal.timeout(GITHUB_REPOSITORY_PROBE_TIMEOUT_MS)
    });

    if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0") return "rate-limited";
    if (response.ok) return "accessible";
    if (response.status === 404 || response.status === 403) return "inaccessible";

    return "unavailable";
  } catch {
    return "unavailable";
  }
}

function toRepositoryHealth(
  grant: TenantRepositoryGrant,
  options: { appCredentialsReady: boolean; githubAccess: GitHubAccessStatus }
): RepositoryHealth {
  const grantActive = grant.enabled;
  const analysisEnabled = grant.analysisEnabled;
  const status = healthStatus({
    grantActive,
    analysisEnabled,
    appCredentialsReady: options.appCredentialsReady,
    githubAccess: options.githubAccess
  });

  return {
    installationId: grant.installationId,
    repositoryId: grant.repositoryId,
    repositoryFullName: grant.repositoryFullName,
    enabled: grant.enabled,
    analysisEnabled: grant.analysisEnabled,
    saveReportsEnabled: grant.saveReportsEnabled,
    commentEnabled: grant.commentEnabled,
    status,
    githubAccess: options.githubAccess,
    checks: {
      grantActive,
      analysisEnabled,
      appCredentialsReady: options.appCredentialsReady,
      githubAccess: options.githubAccess
    },
    nextAction: nextActionForStatus(status)
  };
}

function healthStatus(input: {
  grantActive: boolean;
  analysisEnabled: boolean;
  appCredentialsReady: boolean;
  githubAccess: GitHubAccessStatus;
}): GrantHealthStatus {
  if (!input.grantActive) return "disabled";
  if (!input.analysisEnabled) return "analysis-disabled";
  if (!input.appCredentialsReady) return "app-credentials-not-ready";
  if (input.githubAccess === "credentials-not-ready") return "app-credentials-not-ready";
  if (input.githubAccess === "accessible") return "github-accessible";
  if (input.githubAccess === "inaccessible") return "github-inaccessible";
  if (input.githubAccess === "rate-limited") return "github-rate-limited";
  if (input.githubAccess === "unavailable") return "github-unavailable";
  if (input.githubAccess === "not-checked") return "github-not-checked";

  return "ready";
}

function nextActionForStatus(status: GrantHealthStatus): string {
  if (status === "disabled") return "Enable this repository grant before AgentProof can verify PRs.";
  if (status === "analysis-disabled") return "Enable evidence report analysis for this repository.";
  if (status === "app-credentials-not-ready") return "Configure GitHub App credentials before running repository health probes.";
  if (status === "github-inaccessible") return "Check GitHub App installation access for this repository.";
  if (status === "github-rate-limited") return "Wait for GitHub rate limits to recover, then rerun the health probe.";
  if (status === "github-unavailable") return "Retry the GitHub access probe or check provider status.";
  if (status === "github-not-checked") return "Run a GitHub access probe when you need live installation verification.";

  return "Repository is ready for AgentProof evidence reports.";
}

function repositoryHealthKey(grant: TenantRepositoryGrant): string {
  return `${grant.installationId}:${grant.repositoryId ?? grant.repositoryFullName.toLowerCase()}`;
}

function normalizeRepositoryId(value: string | null): number | undefined {
  if (!value) return undefined;
  if (!/^\d{1,12}$/.test(value)) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined;

  return parsed;
}
