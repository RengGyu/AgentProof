import { activateApprovedGitHubInstallationClaim, GitHubOnboardingError, GitHubOnboardingStoreError } from "@/lib/github-onboarding";
import { GitHubInstallationClaimStoreError } from "@/lib/github-installation-claims";
import { GitHubInstallationStoreError } from "@/lib/github-installations";
import { noStoreJson } from "@/lib/http";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";

export async function POST(request: Request) {
  const csrf = verifySameOriginMutationRequest(request);
  if (!csrf.ok) return csrfFailureResponse();
  try {
    const activation = await activateApprovedGitHubInstallationClaim({ claimCookieHeader: request.headers.get("cookie") });
    if (!activation) return noStoreJson({ error: "Installation approval is pending or unavailable.", code: "github_installation_claim_pending" }, { status: 409 });
    return noStoreJson({ ok: true, installationId: activation.installationId, next: "select_repository" }, { headers: { "Set-Cookie": activation.activationCookie } });
  } catch (error) {
    if (error instanceof GitHubInstallationClaimStoreError || error instanceof GitHubInstallationStoreError || error instanceof GitHubOnboardingStoreError) return noStoreJson({ error: "Installation activation is unavailable.", code: "github_installation_claim_store_unavailable" }, { status: 503 });
    if (error instanceof GitHubOnboardingError) return noStoreJson({ error: "Installation activation is invalid.", code: "github_installation_claim_invalid" }, { status: 401 });
    throw error;
  }
}
