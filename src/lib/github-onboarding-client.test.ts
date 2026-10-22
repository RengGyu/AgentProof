import { describe, expect, it } from "vitest";
import {
  createRepositorySelectionGate,
  dashboardRepositoryLoadFailureMessage,
  githubOnboardingStartFailureMessage,
  githubRepositoryConnectionFailureMessage
} from "./github-onboarding-client";

describe("github onboarding client errors", () => {
  it("maps recognized onboarding failures to actions without internal codes", () => {
    expect(githubOnboardingStartFailureMessage("github_onboarding_state_store_unavailable"))
      .toBe("GitHub installation is temporarily unavailable. Try again later.");
  });

  it("keeps safe next actions for invalid and unavailable onboarding", () => {
    expect(githubOnboardingStartFailureMessage("github_onboarding_request_invalid")).toBe("Start again from Add repositories.");
    expect(githubOnboardingStartFailureMessage("github_onboarding_not_configured")).toBe("GitHub installation is temporarily unavailable. Try again later.");
  });

  it("does not render an arbitrary server error code", () => {
    expect(githubOnboardingStartFailureMessage("token=private-value"))
      .toBe("GitHub App installation could not start.");
  });

  it("keeps a completed repository selection from issuing a second request", () => {
    const gate = createRepositorySelectionGate();

    expect(gate.tryStart()).toBe(true);
    expect(gate.tryStart()).toBe(false);
  });

  it("explains safe repository connection failures without rendering arbitrary server data", () => {
    expect(githubRepositoryConnectionFailureMessage("github_onboarding_activation_invalid"))
      .toBe("Repository selection expired. Reconnect GitHub, then choose the repository again.");
    expect(githubRepositoryConnectionFailureMessage("token=private-value"))
      .toBe("Repository could not be connected.");
  });

  it("distinguishes repository loading failures from an empty connection list", () => {
    expect(dashboardRepositoryLoadFailureMessage(401, "dashboard_repositories_unauthorized"))
      .toBe("Your sign-in session has expired. Continue with GitHub again to load connected repositories.");
    expect(dashboardRepositoryLoadFailureMessage(503, "dashboard_repositories_unavailable"))
      .toBe("Connected repositories are temporarily unavailable. Try again shortly.");
    expect(dashboardRepositoryLoadFailureMessage(500, "token=private-value"))
      .toBe("Connected repositories could not be loaded. Try again.");
  });
});
