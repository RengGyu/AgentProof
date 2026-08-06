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
    expect(source).toContain("Repository reports");
    expect(source).toContain("disabled={repositorySelectionPending}");
    expect(source).toContain('"/api/dashboard/repositories"');
  });

  it("renders only the agreed sanitized detail categories", () => {
    expect(source).toContain(">Requirements<");
    expect(source).toContain("Reference IDs:");
    expect(source).toContain(">Priority files<");
    expect(source).toContain(">Suggested next step<");
    expect(source).not.toContain(">Limitations<");
    expect(source).not.toContain("rawDiff");
    expect(source).not.toContain("rawLog");
    expect(source).not.toContain("pullRequestBody");
    expect(source).not.toContain("issueBody");
  });

  it("renders the evidence workspace without inventing issue grouping", () => {
    expect(source).toContain("Repository reports");
    expect(source).toContain("No reports yet");
    expect(source).toContain("Quick Summary");
    expect(source).toContain("View detailed evidence");
    expect(source).toContain("STALE");
    expect(source).not.toContain("Unlinked PRs");
  });

  it("uses the tenant-safe activity endpoint for Inbox events and opens linked reports", () => {
    expect(source).toContain('"/api/dashboard/activity"');
    expect(source).toContain("Inbox");
    expect(source).toContain("Recent activity");
    expect(source).toContain("openActivity");
    expect(source).not.toContain("Issue grouping and inbox are unavailable");
  });

  it("keeps repository summary comments opt-in through the existing tenant settings endpoint", () => {
    expect(source).toContain("Summary comments");
    expect(source).toContain('"/api/tenants/repositories"');
    expect(source).toContain('method: "PATCH"');
    expect(source).toContain("Comments are off");
  });
});
