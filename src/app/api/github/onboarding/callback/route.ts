import {
  requestGitHubInstallationClaim,
  GitHubOnboardingError,
  GitHubOnboardingStoreError,
  normalizeInstallationId
} from "@/lib/github-onboarding";
import { GitHubInstallationStoreError } from "@/lib/github-installations";
import { GitHubInstallationClaimStoreError } from "@/lib/github-installation-claims";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = normalizeInstallationId(url.searchParams.get("installation_id"));
  const setupAction = normalizeSetupAction(url.searchParams.get("setup_action"));

  if (!installationId || !setupAction) {
    return noStoreJson({
      error: "GitHub App callback is missing installation metadata.",
      code: "github_onboarding_callback_invalid"
    }, { status: 422 });
  }

  try {
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
      }, { status: 503 });
    }

    if (error instanceof GitHubOnboardingStoreError) {
      return noStoreJson({
        error: "GitHub App onboarding state store is unavailable.",
        code: "github_onboarding_state_store_unavailable"
      }, { status: 503 });
    }

    if (error instanceof GitHubInstallationClaimStoreError) {
      return noStoreJson({
        error: "GitHub App installation approval storage is unavailable.",
        code: "github_installation_claim_store_unavailable"
      }, { status: 503 });
    }

    if (error instanceof GitHubOnboardingError) {
      return noStoreJson({
        error: "GitHub App onboarding state is invalid or expired.",
        code: "github_onboarding_state_invalid"
      }, { status: 401 });
    }

    throw error;
  }
}

function normalizeSetupAction(value: string | null): "install" | "update" | null {
  return value === "install" || value === "update" ? value : null;
}

function prefersBrowserRedirect(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";

  return accept.includes("text/html");
}
