import { createGitHubInstallationAccessToken, GitHubAppTokenError } from "@/lib/github-app";
import {
  consumeGitHubActivationSession,
  GitHubOnboardingStoreError,
  normalizeGitHubInstallationRepositories,
  normalizeInstallationId,
  normalizeRepositoryId,
  verifyGitHubActivationSession
} from "@/lib/github-onboarding";
import { noStoreJson, parseJsonSafely } from "@/lib/http";
import { createTenantRepositoryGrant, getTenantControlPlaneSettings, TenantControlPlaneStoreError } from "@/lib/tenant-control-plane";
import { assertTenantDeletionNotActiveAsync, TenantDeletionStateError } from "@/lib/tenant-deletion-state";
import { canUsePrivilegedTenantAccess, verifyTenantAccess } from "@/lib/tenant-admin-access";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = normalizeInstallationId(url.searchParams.get("installationId") ?? url.searchParams.get("installation_id"));

  if (!installationId) {
    return noStoreJson({
      error: "GitHub App installation id is required.",
      code: "github_onboarding_installation_required"
    }, { status: 422 });
  }

  let activation;
  try {
    activation = await verifyGitHubActivationSession({
      cookieHeader: request.headers.get("cookie"),
      installationId
    });
  } catch (error) {
    if (error instanceof GitHubOnboardingStoreError) {
      return noStoreJson({
        error: "GitHub App onboarding state store is unavailable.",
        code: "github_onboarding_state_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
  if (!activation.valid) {
    return noStoreJson({
      error: "GitHub App activation session is invalid or expired.",
      code: "github_onboarding_activation_invalid"
    }, { status: 401 });
  }
  const access = await verifyTenantAccess({
    tenantId: activation.tenantId,
    inviteToken: request.headers.get("x-agentproof-beta-invite-token") ?? undefined,
    cookieHeader: request.headers.get("cookie")
  });
  if (!access.authorized || !access.tenantId || !canUsePrivilegedTenantAccess(access)) {
    return noStoreJson({
      error: "GitHub App repository setup requires an owner or admin role.",
      code: "github_onboarding_role_required"
    }, { status: 403 });
  }
  try {
    await assertTenantDeletionNotActiveAsync({ tenantId: activation.tenantId });
  } catch (error) {
    if (error instanceof TenantDeletionStateError) {
      return tenantRepositorySetupUnavailableResponse(error);
    }

    throw error;
  }

  let repositories;
  try {
    repositories = await fetchInstallationRepositories(installationId);
  } catch (error) {
    if (error instanceof GitHubOnboardingRepositoryFetchError || error instanceof GitHubAppTokenError) {
      return noStoreJson({
        error: "GitHub App installation repositories could not be fetched.",
        code: "github_onboarding_repository_fetch_failed"
      }, { status: 502 });
    }

    throw error;
  }

  return noStoreJson({
    ok: true,
    tenantId: activation.tenantId,
    installationId,
    repositories,
    next: "choose_one_repository"
  });
}

export async function POST(request: Request) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Tenant control plane must be enabled before repository grants can be created.",
      code: "github_onboarding_tenant_control_required"
    }, { status: 409 });
  }

  const body = parseJsonSafely<{
    state?: unknown;
    installationId?: unknown;
    repositoryId?: unknown;
    repositoryFullName?: unknown;
    saveReportsEnabled?: unknown;
    commentEnabled?: unknown;
  }>(await request.text());

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStoreJson({
      error: "Repository selection request must be a JSON object.",
      code: "github_onboarding_payload_invalid"
    }, { status: 400 });
  }

  const installationId = normalizeInstallationId(body.installationId);
  const repositoryId = normalizeRepositoryId(body.repositoryId);

  if (!installationId || !repositoryId) {
    return noStoreJson({
      error: "A valid installation id and repository id are required.",
      code: "github_onboarding_repository_required"
    }, { status: 422 });
  }

  let activation;
  try {
    activation = await verifyGitHubActivationSession({
      cookieHeader: request.headers.get("cookie"),
      installationId
    });
  } catch (error) {
    if (error instanceof GitHubOnboardingStoreError) {
      return noStoreJson({
        error: "GitHub App onboarding state store is unavailable.",
        code: "github_onboarding_state_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
  if (!activation.valid) {
    return noStoreJson({
      error: "GitHub App activation session is invalid or expired.",
      code: "github_onboarding_activation_invalid"
    }, { status: 401 });
  }
  const access = await verifyTenantAccess({
    tenantId: activation.tenantId,
    inviteToken: request.headers.get("x-agentproof-beta-invite-token") ?? undefined,
    cookieHeader: request.headers.get("cookie")
  });
  if (!access.authorized || !access.tenantId || !canUsePrivilegedTenantAccess(access)) {
    return noStoreJson({
      error: "GitHub App repository setup requires an owner or admin role.",
      code: "github_onboarding_role_required"
    }, { status: 403 });
  }
  try {
    await assertTenantDeletionNotActiveAsync({ tenantId: activation.tenantId });
  } catch (error) {
    if (error instanceof TenantDeletionStateError) {
      return tenantRepositorySetupUnavailableResponse(error);
    }

    throw error;
  }

  let repositories;
  try {
    repositories = await fetchInstallationRepositories(installationId);
  } catch (error) {
    if (error instanceof GitHubOnboardingRepositoryFetchError || error instanceof GitHubAppTokenError) {
      return noStoreJson({
        error: "GitHub App installation repositories could not be fetched.",
        code: "github_onboarding_repository_fetch_failed"
      }, { status: 502 });
    }

    throw error;
  }
  const selected = repositories.find((repo) => repo.id === repositoryId);
  if (!selected) {
    return noStoreJson({
      error: "Selected repository is not available to this GitHub App installation.",
      code: "github_onboarding_repository_not_installed"
    }, { status: 422 });
  }

  try {
    activation = await consumeGitHubActivationSession({
      cookieHeader: request.headers.get("cookie"),
      installationId
    });
  } catch (error) {
    if (error instanceof GitHubOnboardingStoreError) {
      return noStoreJson({
        error: "GitHub App onboarding state store is unavailable.",
        code: "github_onboarding_state_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
  if (!activation.valid) {
    return noStoreJson({
      error: "GitHub App activation session is invalid or expired.",
      code: "github_onboarding_activation_invalid"
    }, { status: 401 });
  }

  try {
    const grant = await createTenantRepositoryGrant({
      tenantId: activation.tenantId,
      installationId,
      repositoryId: selected.id,
      repositoryFullName: selected.fullName,
      enabled: true,
      analysisEnabled: true,
      saveReportsEnabled: body.saveReportsEnabled === true,
      commentEnabled: body.commentEnabled === true
    });

    return noStoreJson({
      ok: true,
      tenantId: grant.tenantId,
      installationId: grant.installationId,
      repositoryId: grant.repositoryId,
      repositoryFullName: grant.repositoryFullName,
      settings: {
        analysisEnabled: grant.analysisEnabled,
        saveReportsEnabled: grant.saveReportsEnabled,
        commentEnabled: grant.commentEnabled
      },
      privacy: "grant-metadata-only",
      next: "webhook_analysis_enabled_for_repository"
    });
  } catch (error) {
    if (error instanceof TenantDeletionStateError) {
      return tenantRepositorySetupUnavailableResponse(error);
    }

    if (error instanceof TenantControlPlaneStoreError) {
      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "github_onboarding_grant_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

async function fetchInstallationRepositories(installationId: number) {
  const token = await createGitHubInstallationAccessToken(installationId);
  const repositories = [];

  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });

    if (!response.ok) {
      throw new GitHubOnboardingRepositoryFetchError();
    }

    const pageRepositories = normalizeGitHubInstallationRepositories(await response.json());
    repositories.push(...pageRepositories);

    if (pageRepositories.length < 100) {
      break;
    }
  }

  return repositories.slice(0, 500);
}

class GitHubOnboardingRepositoryFetchError extends Error {
  constructor() {
    super("GitHub App installation repositories could not be fetched.");
    this.name = "GitHubOnboardingRepositoryFetchError";
  }
}

function tenantRepositorySetupUnavailableResponse(error: TenantDeletionStateError) {
  const status = error.message.includes("Supabase") || error.message.includes("HTTP") || error.message.includes("invalid")
    ? 503
    : 409;

  return noStoreJson({
    error: "Tenant repository setup is unavailable.",
    code: "github_onboarding_tenant_unavailable"
  }, { status });
}
