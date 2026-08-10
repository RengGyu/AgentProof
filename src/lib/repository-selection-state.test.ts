import { describe, expect, it } from "vitest";
import { resolveRepositorySelectionLoad } from "./repository-selection-state";

describe("repository selection loading", () => {
  it("keeps a successful non-empty GitHub response ready for selection", () => {
    expect(resolveRepositorySelectionLoad({
      status: 200,
      payload: {
        repositories: [
          { id: 11, fullName: "sample-org/api", private: true, defaultBranch: "main" },
          { id: 12, fullName: "sample-org/web", private: false }
        ]
      }
    })).toEqual({
      status: "ready",
      repositories: [
        { id: 11, fullName: "sample-org/api", private: true, defaultBranch: "main" },
        { id: 12, fullName: "sample-org/web", private: false }
      ],
      message: "Choose a repository. Reports retain no raw diffs, logs, or tokens."
    });
  });

  it("shows an empty installation separately from a loading selection", () => {
    expect(resolveRepositorySelectionLoad({ status: 200, payload: { repositories: [] } }))
      .toEqual({
        status: "empty",
        repositories: [],
        message: "This GitHub App installation has no accessible repositories. Update the App repository access, then try again."
      });
  });

  it("does not expose an arbitrary repository API error", () => {
    expect(resolveRepositorySelectionLoad({ status: 502, payload: { code: "token=private-value" } }))
      .toEqual({
        status: "error",
        repositories: [],
        message: "Repositories could not be loaded. Try again."
      });
  });
});
