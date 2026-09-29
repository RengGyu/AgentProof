import { ensureGitHubOwnerTenant, TenantAccountStoreError } from "@/lib/tenant-accounts";
import { TenantAuthError, TenantAuthStoreError } from "@/lib/tenant-auth";
import { createMobileHandoff, MobileAuthStoreError } from "@/lib/mobile-auth";
import { getGitHubOAuthConfig, GitHubOAuthError } from "@/lib/public-github-auth";
import { openMobileOAuthCookie } from "../start/route";

const DEEP_LINK = "agentproof://auth/callback";

export async function GET(request: Request) {
  const headers = new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "Content-Type": "text/html; charset=utf-8" });
  headers.append("Set-Cookie", "agentproof_mobile_oauth=deleted; Path=/api/mobile/auth/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  try {
    const config = getGitHubOAuthConfig();
    if (!config) return failure(headers);
    const url = new URL(request.url);
    const saved = openMobileOAuthCookie(request.headers.get("cookie"), config.secret);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!saved || !code || !state || state !== saved.state) return failure(headers);
    const callbackUrl = new URL("/api/mobile/auth/callback", url.origin).toString();
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callbackUrl, code_verifier: saved.verifier })
    });
    const token = await tokenResponse.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; refresh_token_expires_in?: unknown } | null;
    if (!tokenResponse.ok || typeof token?.access_token !== "string") return failure(headers);
    const identityResponse = await fetch("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token.access_token}`, "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store"
    });
    const identity = await identityResponse.json().catch(() => null) as { id?: unknown } | null;
    if (!identityResponse.ok || !/^\d{1,20}$/.test(String(identity?.id ?? ""))) return failure(headers);
    const githubUserId = String(identity!.id);
    const owner = await ensureGitHubOwnerTenant({ githubUserId });
    const handoff = await createMobileHandoff({ verifierChallenge: saved.challenge, tenantId: owner.tenantId, memberId: owner.memberId });
    return navigation(headers, `${DEEP_LINK}?code=${encodeURIComponent(handoff)}`);
  } catch (error) {
    if (error instanceof GitHubOAuthError || error instanceof TenantAccountStoreError || error instanceof TenantAuthError || error instanceof TenantAuthStoreError || error instanceof MobileAuthStoreError) return failure(headers);
    throw error;
  }
}

function failure(headers: Headers) { return new Response("<!doctype html><title>Sign-in failed</title><p>Sign-in could not be completed. Return to AgentProof and try again.</p>", { status: 401, headers }); }
function navigation(headers: Headers, url: string) { return new Response(`<!doctype html><title>Return to AgentProof</title><meta name="referrer" content="no-referrer"><a href="${url}">Return to AgentProof</a>`, { headers }); }
