import { ensureGitHubOwnerTenant, TenantAccountStoreError } from "@/lib/tenant-accounts";
import { createTenantAuthSessionForMember, TenantAuthError, TenantAuthStoreError } from "@/lib/tenant-auth";
import { bindGitHubInstallationAuthorization, clearGitHubOAuthInstallCookie, clearGitHubOAuthStateCookie, finishGitHubOAuth, getGitHubOAuthConfig, GitHubOAuthError } from "@/lib/public-github-auth";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const config = getGitHubOAuthConfig();
    if (!config) return oauthFailure("github_oauth_not_configured", 501);
    // The identity is read before creating any tenant row. It is used only for
    // the immutable numeric mapping, never returned to the browser.
    const provisional = await finishGitHubOAuth({ code: url.searchParams.get("code"), state: url.searchParams.get("state"), cookieHeader: request.headers.get("cookie"), tenantId: "pending" }, config);
    const owner = await ensureGitHubOwnerTenant({ githubUserId: provisional.githubUserId });
    const installCookie = bindGitHubInstallationAuthorization({ cookieHeader: provisional.installCookie, tenantId: owner.tenantId }, config);
    if (!installCookie) throw new GitHubOAuthError("GitHub install authorization could not be bound.");
    const session = await createTenantAuthSessionForMember(owner);
    const headers = privateHeadersWithCookies(clearGitHubOAuthStateCookie(), installCookie, session.sessionCookie);
    if ((request.headers.get("accept") ?? "").includes("text/html")) {
      headers.set("Location", new URL("/dashboard", request.url).toString());
      return new Response(null, { status: 303, headers });
    }
    return noStoreJson({ ok: true, next: "install_github_app", privacy: "github-id-mapping-and-session-only" }, { headers });
  } catch (error) {
    if (error instanceof GitHubOAuthError || error instanceof TenantAccountStoreError || error instanceof TenantAuthError || error instanceof TenantAuthStoreError) return oauthFailure("github_oauth_callback_failed", 401);
    throw error;
  }
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
