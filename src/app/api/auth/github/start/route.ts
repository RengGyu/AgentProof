import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";
import { beginGitHubOAuth, clearGitHubOAuthInstallCookie, getGitHubOAuthConfig, GitHubOAuthError } from "@/lib/public-github-auth";
import { noStoreJson } from "@/lib/http";

export async function POST(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) return csrfFailureResponse();
  try {
    const config = getGitHubOAuthConfig();
    if (!config) return oauthUnavailable();
    if (new URL(request.url).origin !== new URL(config.callbackUrl).origin) {
      return oauthCallbackOriginMismatch(config.callbackUrl);
    }
    const started = beginGitHubOAuth(config);
    return noStoreJson({ ok: true, authorizationUrl: started.authorizationUrl, privacy: "state-and-pkce-cookie-only", next: "github_login" }, {
      headers: cookieHeaders(started.stateCookie, clearGitHubOAuthInstallCookie())
    });
  } catch (error) {
    if (error instanceof GitHubOAuthError) return oauthUnavailable();
    throw error;
  }
}

function oauthUnavailable() {
  return noStoreJson({ error: "GitHub public OAuth is not configured.", code: "github_oauth_not_configured" }, {
    status: 501,
    headers: cookieHeaders(clearGitHubOAuthInstallCookie())
  });
}

function oauthCallbackOriginMismatch(callbackUrl: string) {
  return noStoreJson({
    error: "GitHub sign-in must start from the configured AgentProof address.",
    code: "github_oauth_callback_origin_mismatch",
    dashboardUrl: new URL("/dashboard", callbackUrl).toString()
  }, {
    status: 409,
    headers: cookieHeaders(clearGitHubOAuthInstallCookie())
  });
}

function cookieHeaders(...cookies: string[]) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return headers;
}
