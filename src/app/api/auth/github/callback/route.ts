import { NextResponse } from "next/server";
import { clearConciergeGitHubOAuthCookie, completeConciergeGitHubOAuth, conciergeGitHubAuthErrorResponse, conciergeGitHubLandingUrl, type ConciergeGitHubOAuthStateStage } from "@/lib/concierge-github-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const completed = await completeConciergeGitHubOAuth({ state: url.searchParams.get("state"), code: url.searchParams.get("code"), cookieHeader: request.headers.get("cookie") });
    const landingUrl = conciergeGitHubLandingUrl();
    if (!landingUrl) throw new Error("oauth_not_configured");
    const response = NextResponse.redirect(landingUrl, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    // A completed durable create revokes the prior same-user session in the
    // transaction. The browser receives only the new cookie; a failed callback
    // must never delete a previously valid Concierge session.
    response.headers.append("Set-Cookie", clearConciergeGitHubOAuthCookie());
    response.headers.append("Set-Cookie", completed.sessionCookie);
    return response;
  } catch (error) {
    const landingUrl = conciergeGitHubLandingUrl();
    if (!landingUrl) return conciergeGitHubAuthErrorResponse("oauth_not_configured", 503);
    const redirect = new URL(landingUrl);
    redirect.searchParams.set("auth", reason(error));
    const stateStage = process.env.VERCEL_ENV === "preview" ? oauthStateStage(error, url) : null;
    if (stateStage) redirect.searchParams.set("oauth_stage", stateStage);
    const response = NextResponse.redirect(redirect, { status: 303, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    response.headers.append("Set-Cookie", clearConciergeGitHubOAuthCookie());
    return response;
  }
}
function reason(error: unknown) {
  const candidate = error && typeof error === "object" && "reason" in error && typeof (error as { reason?: unknown }).reason === "string" ? (error as { reason: string }).reason : null;
  return candidate && CALLBACK_REASONS.has(candidate) ? candidate : "oauth_state_invalid";
}
const CALLBACK_REASONS = new Set(["oauth_not_configured", "oauth_state_invalid", "oauth_state_replayed", "oauth_provider_unavailable", "oauth_identity_unavailable", "personal_installation_required", "organization_installation_unsupported", "repository_access_unavailable", "private_repository_required", "installation_inventory_too_large", "repository_inventory_too_large", "durable_store_mismatch"]);
const OAUTH_STATE_STAGES = new Set<ConciergeGitHubOAuthStateStage>(["query_invalid", "state_missing", "state_invalid_shape", "code_missing", "code_invalid_shape", "provider_redirect_uri_mismatch", "provider_access_denied", "provider_error", "installation_app_missing", "installation_identity_mismatch", "installation_multiple", "cookie_missing", "cookie_invalid", "state_mismatch"]);
function oauthStateStage(error: unknown, url: URL): ConciergeGitHubOAuthStateStage | null {
  const providerError = url.searchParams.get("error");
  if (providerError === "redirect_uri_mismatch") return "provider_redirect_uri_mismatch";
  if (providerError === "access_denied") return "provider_access_denied";
  if (providerError) return "provider_error";
  if (!error || typeof error !== "object" || !("oauthStateStage" in error)) return null;
  const value = (error as { oauthStateStage?: unknown }).oauthStateStage;
  return typeof value === "string" && OAUTH_STATE_STAGES.has(value as ConciergeGitHubOAuthStateStage) ? value as ConciergeGitHubOAuthStateStage : null;
}
