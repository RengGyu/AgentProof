const SAFE_ONBOARDING_FAILURE_CODES = new Set([
  "github_onboarding_not_configured",
  "github_onboarding_state_store_unavailable",
  "github_onboarding_request_invalid"
]);

export function githubOnboardingStartFailureMessage(code: unknown): string {
  if (typeof code === "string" && SAFE_ONBOARDING_FAILURE_CODES.has(code)) {
    return `GitHub App installation could not start (${code}).`;
  }
  return "GitHub App installation could not start.";
}
