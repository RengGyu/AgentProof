import { NextResponse } from "next/server";
import { startConciergeGitHubOAuth, conciergeGitHubAuthErrorResponse, type ConciergeGitHubAuthReason } from "@/lib/concierge-github-auth";

export async function GET(request: Request) {
  try {
    const start = await startConciergeGitHubOAuth(process.env, undefined, request.headers.get("cookie"));
    return NextResponse.redirect(start.redirectUrl, { status: 303, headers: { "Set-Cookie": start.cookie, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    const code = reason(error);
    return conciergeGitHubAuthErrorResponse(code, code === "session_already_active" ? 409 : 503);
  }
}

function reason(error: unknown): ConciergeGitHubAuthReason {
  const candidate = error && typeof error === "object" && "reason" in error && typeof (error as { reason?: unknown }).reason === "string" ? (error as { reason: string }).reason : null;
  return candidate === "oauth_provider_unavailable" || candidate === "durable_store_mismatch" || candidate === "session_already_active" ? candidate : "oauth_not_configured";
}
