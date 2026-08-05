import { describe, expect, it } from "vitest";
import { githubOnboardingStartFailureMessage } from "./github-onboarding-client";

describe("github onboarding client errors", () => {
  it("shows a recognized safe onboarding failure code", () => {
    expect(githubOnboardingStartFailureMessage("github_onboarding_state_store_unavailable"))
      .toBe("GitHub App installation could not start (github_onboarding_state_store_unavailable).");
  });

  it("does not render an arbitrary server error code", () => {
    expect(githubOnboardingStartFailureMessage("token=private-value"))
      .toBe("GitHub App installation could not start.");
  });
});
