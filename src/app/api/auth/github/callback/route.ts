import { ensureGitHubOwnerTenant, TenantAccountStoreError } from "@/lib/tenant-accounts";
import { createTenantAuthSessionForMember, TenantAuthError, TenantAuthStoreError } from "@/lib/tenant-auth";
import { bindGitHubInstallationAuthorization, clearGitHubOAuthInstallCookie, clearGitHubOAuthStateCookie, finishGitHubOAuth, getGitHubOAuthConfig, GitHubOAuthError } from "@/lib/public-github-auth";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let stage = "config";
  try {
    const config = getGitHubOAuthConfig();
    if (!config) return oauthFailure("github_oauth_not_configured", 501);
    // The identity is read before creating any tenant row. It is used only for
    // the immutable numeric mapping, never returned to the browser.
    stage = "oauth";
    const provisional = await finishGitHubOAuth({ code: url.searchParams.get("code"), state: url.searchParams.get("state"), cookieHeader: request.headers.get("cookie"), tenantId: "pending" }, config);
    stage = "tenant";
    const owner = await ensureGitHubOwnerTenant({ githubUserId: provisional.githubUserId });
    stage = "installation";
    const installCookie = bindGitHubInstallationAuthorization({ cookieHeader: provisional.installCookie, tenantId: owner.tenantId }, config);
    if (!installCookie) throw new GitHubOAuthError("GitHub install authorization could not be bound.");
    stage = "session";
    const session = await createTenantAuthSessionForMember(owner);
    const headers = privateHeadersWithCookies(clearGitHubOAuthStateCookie(), installCookie, session.sessionCookie);
    if (isDocumentNavigation(request)) {
      return dashboardNavigationResponse(headers);
    }
    return noStoreJson({ ok: true, next: "install_github_app", privacy: "github-id-mapping-and-session-only" }, { headers });
  } catch (error) {
    if (error instanceof GitHubOAuthError || error instanceof TenantAccountStoreError || error instanceof TenantAuthError || error instanceof TenantAuthStoreError) {
      console.warn("github_oauth_callback_failed", { stage, error: error.name });
      return oauthFailure("github_oauth_callback_failed", 401);
    }
    throw error;
  }
}

function isDocumentNavigation(request: Request) {
  return (request.headers.get("accept") ?? "").includes("text/html")
    || request.headers.get("sec-fetch-dest") === "document";
}

function dashboardNavigationResponse(headers: Headers) {
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/dashboard"><title>Continuing to AgentProof</title></head><body><p>Continuing to <a href="/dashboard">AgentProof Dashboard</a>…</p></body></html>', { headers });
}

function oauthFailure(code: string, status: number) {
  return noStoreJson({ error: "GitHub login could not be completed.", code }, {
    status,
    headers: privateHeadersWithCookies(clearGitHubOAuthStateCookie(), clearGitHubOAuthInstallCookie())
  });
}

function privateHeadersWithCookies(...cookies: string[]) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}
