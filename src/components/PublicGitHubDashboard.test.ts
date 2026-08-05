import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PublicGitHubDashboard.tsx", import.meta.url), "utf8");

describe("PublicGitHubDashboard saved reports", () => {
  it("checks for an existing verified App installation before opening GitHub installation", () => {
    expect(source).toContain('"/api/github/onboarding/callback?existing=1"');
    expect(source).toContain('existing?.next === "select_repository"');
    expect(source).toContain('existing?.next === "choose_installation"');
    expect(source).toContain('"/api/github/onboarding/start"');
    expect(source).toContain('signedIn && !activeInstallationId');
  });

  it("renders enough metadata to distinguish reports and labels stale heads", () => {
    expect(source).toContain("Repository #");
    expect(source).toContain("PR #");
    expect(source).toContain("formatCreatedAt(report.createdAt)");
    expect(source).toContain("headPrefix(report.headSha)");
    expect(source).toContain("STALE (older head)");
    expect(source).toContain("Priority:");
  });

  it("separates connected repositories from previously saved reports and disables a pending selection", () => {
    expect(source).toContain("Connected repositories");
    expect(source).toContain("Previous analysis reports");
    expect(source).toContain("disabled={repositorySelectionPending}");
    expect(source).toContain('"/api/dashboard/repositories"');
  });

  it("renders only the agreed sanitized detail categories", () => {
    expect(source).toContain("Requirements:");
    expect(source).toContain("Evidence locations:");
    expect(source).toContain("Priority files:");
    expect(source).toContain("Repair prompt:");
    expect(source).not.toContain("rawDiff");
    expect(source).not.toContain("rawLog");
    expect(source).not.toContain("pullRequestBody");
    expect(source).not.toContain("issueBody");
  });
});
