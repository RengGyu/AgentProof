const SAFE_ONBOARDING_FAILURE_CODES = new Set([
  "github_onboarding_not_configured",
  "github_onboarding_state_store_unavailable",
  "github_onboarding_request_invalid"
]);

const SAFE_REPOSITORY_CONNECTION_FAILURE_CODES = new Map<string, string>([
  ["github_onboarding_activation_invalid", "Repository selection expired. Reconnect GitHub, then choose the repository again."],
  ["github_onboarding_repository_not_installed", "This repository is no longer available to the AgentProof App. Update the App repository access, then reconnect."],
  ["github_onboarding_repository_fetch_failed", "AgentProof could not load repositories from GitHub. Reconnect GitHub and try again."],
  ["github_onboarding_grant_store_unavailable", "Repository connection storage is temporarily unavailable. Try again shortly."],
  ["github_onboarding_state_store_unavailable", "Repository selection storage is temporarily unavailable. Reconnect GitHub and try again."]
]);

export function githubOnboardingStartFailureMessage(code: unknown): string {
  if (typeof code === "string" && SAFE_ONBOARDING_FAILURE_CODES.has(code)) {
    return `GitHub App installation could not start (${code}).`;
  }
  return "GitHub App installation could not start.";
}

export function githubRepositoryConnectionFailureMessage(code: unknown): string {
  return typeof code === "string"
    ? SAFE_REPOSITORY_CONNECTION_FAILURE_CODES.get(code) ?? "Repository could not be connected."
    : "Repository could not be connected.";
}

export function createRepositorySelectionGate() {
  let started = false;

  return {
    tryStart() {
      if (started) return false;
      started = true;
      return true;
    },
    reset() {
      started = false;
    }
  };
}
