import {
  createGitHubAppInstallSession,
  getGitHubOnboardingConfigStatus,
  GitHubOnboardingStoreError
} from "@/lib/github-onboarding";
import { canUsePrivilegedTenantAccess, verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson, parseJsonSafely } from "@/lib/http";

export async function POST(request: Request) {
  const status = getGitHubOnboardingConfigStatus();
  if (!status.configured) {
    return noStoreJson({
      error: "GitHub App onboarding is not configured.",
      code: "github_onboarding_not_configured"
    }, { status: 501 });
  }

  const body = parseJsonSafely<{ tenantId?: unknown }>(await request.text());
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStoreJson({
      error: "GitHub App onboarding request must be a JSON object.",
      code: "github_onboarding_payload_invalid"
    }, { status: 400 });
  }

  if (typeof body.tenantId !== "string") {
    return noStoreJson({
      error: "A tenant id is required before GitHub App onboarding can start.",
      code: "github_onboarding_tenant_required"
    }, { status: 422 });
  }

  const access = await verifyTenantAccess({
    tenantId: body.tenantId,
    inviteToken: request.headers.get("x-agentproof-beta-invite-token") ?? undefined,
    cookieHeader: request.headers.get("cookie")
  });
  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "GitHub App onboarding requires valid tenant authorization.",
      code: "github_onboarding_invite_required"
    }, { status: 401 });
  }
  if (!canUsePrivilegedTenantAccess(access)) {
    return noStoreJson({
      error: "GitHub App onboarding requires an owner or admin role.",
      code: "github_onboarding_role_required"
    }, { status: 403 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const install = await createGitHubAppInstallSession({ tenantId: authorizedTenantId });

    return noStoreJson({
      ok: true,
      installUrl: install.installUrl,
      stateExpiresAt: install.expiresAt,
      privacy: "state-only-no-tokens-stored",
      next: "install_github_app"
    }, {
      headers: {
        "Set-Cookie": install.nonceCookie
      }
    });
  } catch (error) {
    if (error instanceof GitHubOnboardingStoreError) {
      return noStoreJson({
        error: "GitHub App onboarding state store is unavailable.",
        code: "github_onboarding_state_store_unavailable"
      }, { status: 503 });
    }

    return noStoreJson({
      error: "GitHub App onboarding request is invalid.",
      code: "github_onboarding_request_invalid"
    }, { status: 422 });
  }
}
