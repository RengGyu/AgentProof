import { describe, expect, it } from "vitest";
import {
  createRepositorySelectionGate,
  githubOnboardingStartFailureMessage,
  githubRepositoryConnectionFailureMessage
} from "./github-onboarding-client";

describe("github onboarding client errors", () => {
  it("shows a recognized safe onboarding failure code", () => {
    expect(githubOnboardingStartFailureMessage("github_onboarding_state_store_unavailable"))
      .toBe("GitHub App installation could not start (github_onboarding_state_store_unavailable).");
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
});
