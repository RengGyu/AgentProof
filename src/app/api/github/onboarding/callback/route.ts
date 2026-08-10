import {
  activateExistingVerifiedGitHubInstallation,
  activateVerifiedGitHubInstallation,
  requestGitHubInstallationClaim,
  GitHubOnboardingError,
  GitHubOnboardingStoreError,
  normalizeInstallationId
} from "@/lib/github-onboarding";
import { GitHubInstallationStoreError } from "@/lib/github-installations";
import { GitHubInstallationClaimStoreError } from "@/lib/github-installation-claims";
import { noStoreJson } from "@/lib/http";
import {
  clearGitHubOAuthInstallCookie,
  findGitHubInstallationAccess,
  getGitHubInstallationAuthorizationIdentity,
  getGitHubOAuthConfig,
  verifyGitHubInstallationAccess
} from "@/lib/public-github-auth";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("existing") === "1") return activateExistingInstallation(request);
  const installationId = normalizeInstallationId(url.searchParams.get("installation_id"));
  const setupAction = normalizeSetupAction(url.searchParams.get("setup_action"));

  if (!installationId || !setupAction) {
    return noStoreJson({
      error: "GitHub App callback is missing installation metadata.",
      code: "github_onboarding_callback_invalid"
    }, { status: 422, headers: terminalCookieHeaders() });
  }

  try {
    const oauthConfig = getGitHubOAuthConfig();
    if (oauthConfig && hasInstallAuthorization(request.headers.get("cookie"))) {
      const installAuthorization = request.headers.get("cookie");
      // The browser's short-lived OAuth credential is used only to establish
      // that this account can access the installation returned by GitHub.
      // It is cleared immediately after that check and never persisted.
      const identity = await publicSessionIdentity(installAuthorization, oauthConfig);
      if (!identity || !await verifyGitHubInstallationAccess({
        cookieHeader: installAuthorization,
        tenantId: identity.tenantId,
        installationId
      }, oauthConfig)) {
        return noStoreJson({
          error: "GitHub account cannot access this App installation.",
          code: "github_installation_access_denied"
        }, { status: 403, headers: terminalCookieHeaders() });
      }
      {
        const activation = await activateVerifiedGitHubInstallation({
          state: url.searchParams.get("state"),
          nonceCookieHeader: installAuthorization,
          installationId,
          tenantId: identity.tenantId
        });
        if (prefersBrowserRedirect(request)) {
          const redirectUrl = new URL("/dashboard", request.url);
          redirectUrl.searchParams.set("installation", String(installationId));
          const headers = privateHeadersWithCookies(activation.activationCookie, clearGitHubOAuthInstallCookie());
          headers.set("Location", redirectUrl.toString());
          return new Response(null, { status: 303, headers });
        }
        return noStoreJson({ ok: true, installationId, next: "choose_repository", privacy: "installation-ownership-verified" }, { headers: privateHeadersWithCookies(activation.activationCookie, clearGitHubOAuthInstallCookie()) });
      }
    }
    const claim = await requestGitHubInstallationClaim({
      state: url.searchParams.get("state"),
      nonceCookieHeader: request.headers.get("cookie"),
      installationId
    });
    if (prefersBrowserRedirect(request)) {
      const redirectUrl = new URL("/tenant", request.url);
      redirectUrl.searchParams.set("githubApp", "pending");
      // A URL fragment stays client-side. The one-time operator code is not
      // sent to the server or included in referrers/logs.
      redirectUrl.hash = `operatorRequestCode=${encodeURIComponent(claim.operatorRequestCode)}`;

      return new Response(null, {
        status: 303,
        headers: {
          Location: redirectUrl.toString(),
          "Set-Cookie": claim.claimCookie,
          "Cache-Control": "private, no-store",
          "Referrer-Policy": "no-referrer"
        }
      });
    }

    return noStoreJson({
      ok: true,
      claimExpiresAt: claim.expiresAt,
      operatorRequestCode: claim.operatorRequestCode,
      next: "operator_approval_required"
    }, {
      status: 202,
      headers: {
        "Set-Cookie": claim.claimCookie
      }
    });
  } catch (error) {
    if (error instanceof GitHubInstallationStoreError) {
      return noStoreJson({
        error: "GitHub App installation metadata store is unavailable.",
        code: "github_installation_metadata_store_unavailable"
      }, { status: 503, headers: terminalCookieHeaders() });
    }

    if (error instanceof GitHubOnboardingStoreError) {
      return noStoreJson({
        error: "GitHub App onboarding state store is unavailable.",
        code: "github_onboarding_state_store_unavailable"
      }, { status: 503, headers: terminalCookieHeaders() });
    }

    if (error instanceof GitHubInstallationClaimStoreError) {
      return noStoreJson({
        error: "GitHub App installation approval storage is unavailable.",
        code: "github_installation_claim_store_unavailable"
      }, { status: 503, headers: terminalCookieHeaders() });
    }

    if (error instanceof GitHubOnboardingError) {
      return noStoreJson({
        error: "GitHub App onboarding state is invalid or expired.",
        code: "github_onboarding_state_invalid"
      }, { status: 401, headers: terminalCookieHeaders() });
    }

    throw error;
  }
}

async function activateExistingInstallation(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) return csrfFailureResponse();
  try {
    const config = getGitHubOAuthConfig();
    const cookieHeader = request.headers.get("cookie");
    const identity = config ? await publicSessionIdentity(cookieHeader, config) : null;
    const appId = normalizeInstallationId(process.env.GITHUB_APP_ID);
    if (!config || !identity || !appId) return noStoreJson({
      error: "GitHub installation recognition requires a fresh GitHub login.",
      code: "github_existing_installation_reauth_required"
    }, { status: 401 });
    const installations = await findGitHubInstallationAccess({
      cookieHeader,
      tenantId: identity.tenantId,
      appId
    }, config);
    if (installations === null) return noStoreJson({
      error: "GitHub installation recognition requires a fresh GitHub login.",
      code: "github_existing_installation_reauth_required"
    }, { status: 401 });
    if (installations.length === 0) return noStoreJson({ ok: true, found: false, next: "install_github_app" });
    const requestedInstallationId = normalizeInstallationId(new URL(request.url).searchParams.get("installationId"));
    const selected = requestedInstallationId
      ? installations.find((installation) => installation.installationId === requestedInstallationId)
      : installations.length === 1 ? installations[0] : undefined;
    if (!selected) {
      if (requestedInstallationId) return noStoreJson({
        error: "Selected GitHub App installation is not accessible to this account.",
        code: "github_existing_installation_access_denied"
      }, { status: 403 });
      return noStoreJson({
        ok: true,
        next: "choose_installation",
        installations: installations.map(({ installationId: id, accountLogin }) => ({
          installationId: id,
          accountLogin
        }))
      });
    }
    if (selected.accountType !== "User" || String(selected.accountId) !== identity.githubUserId) {
      return noStoreJson({
        error: "Existing installations require matching personal owner proof.",
        code: "github_existing_installation_owner_proof_required"
      }, { status: 403, headers: terminalCookieHeaders() });
    }
    const activation = await activateExistingVerifiedGitHubInstallation({
      tenantId: identity.tenantId,
      installationId: selected.installationId,
      accountId: selected.accountId,
      accountLogin: selected.accountLogin,
      accountType: selected.accountType
    });
    return noStoreJson({ ok: true, installationId: activation.installationId, next: "select_repository" }, {
      headers: privateHeadersWithCookies(activation.activationCookie, clearGitHubOAuthInstallCookie())
    });
  } catch (error) {
    if (error instanceof GitHubInstallationStoreError || error instanceof GitHubOnboardingStoreError) {
      console.warn("github_existing_installation_activation_failed", {
        store: error instanceof GitHubInstallationStoreError ? "installation" : "onboarding",
        reason: error instanceof GitHubInstallationStoreError
          ? classifyGitHubInstallationStoreFailure(error)
          : "store_unavailable"
      });
      return noStoreJson({
        error: "GitHub App installation storage is unavailable.",
        code: "github_existing_installation_store_unavailable"
      }, { status: 503, headers: terminalCookieHeaders() });
    }
    if (error instanceof GitHubOnboardingError) {
      return noStoreJson({
        error: "GitHub App installation recognition is invalid.",
        code: "github_existing_installation_invalid"
      }, { status: 401, headers: terminalCookieHeaders() });
    }
    throw error;
  }
}

function hasInstallAuthorization(cookieHeader: string | null): boolean {
  return Boolean(cookieHeader?.split(";").some((part) =>
    part.trim().startsWith("agentproof_github_oauth_install=")
  ));
}

async function publicSessionIdentity(
  cookieHeader: string | null,
  config: NonNullable<ReturnType<typeof getGitHubOAuthConfig>>
): Promise<{ tenantId: string; githubUserId: string } | null> {
  const { resolveTenantAuthAccess } = await import("@/lib/tenant-auth");
  const access = await resolveTenantAuthAccess({ cookieHeader });
  if (!access.authorized || !access.tenantId || !access.memberId) return null;
  const githubUserId = getGitHubInstallationAuthorizationIdentity({
    cookieHeader,
    tenantId: access.tenantId
  }, config);
  if (!githubUserId || access.memberId !== `github:${githubUserId}`) return null;
  return { tenantId: access.tenantId, githubUserId };
}

function normalizeSetupAction(value: string | null): "install" | "update" | null {
  return value === "install" || value === "update" ? value : null;
}

function prefersBrowserRedirect(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";

  return accept.includes("text/html");
}

function privateHeadersWithCookies(...cookies: string[]) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}

function terminalCookieHeaders() {
  return privateHeadersWithCookies(clearGitHubOAuthInstallCookie());
}

function classifyGitHubInstallationStoreFailure(error: GitHubInstallationStoreError): string {
  if (error.message === "GitHub installation ownership storage is required for public onboarding.") {
    return "not_configured";
  }
  if (error.message === "GitHub installation metadata input is invalid.") {
    return "input_invalid";
  }
  if (error.message === "GitHub installation metadata Supabase env is incomplete.") {
    return "config_incomplete";
  }
  if (error.message === "GitHub installation metadata is already assigned to another tenant.") {
    return "tenant_conflict";
  }

  const tenantLookupStatus = error.message.match(/^GitHub installation metadata tenant lookup failed with HTTP (\d{3})\.$/)?.[1];
  if (tenantLookupStatus) return `tenant_lookup_http_${tenantLookupStatus}`;

  const storeStatus = error.message.match(/^GitHub installation metadata store failed with HTTP (\d{3})\.$/)?.[1];
  if (storeStatus) return `store_http_${storeStatus}`;

  return "unknown";
}
