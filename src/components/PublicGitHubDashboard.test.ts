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

  it("shows only current reports in the default list and keeps stale state in Inbox", () => {
    expect(source).toContain("Repository #");
    expect(source).toContain("PR #");
    expect(source).toContain("formatCreatedAt(report.createdAt)");
    expect(source).toContain("headPrefix(report.headSha)");
    expect(source).toContain("!report.staleAt");
    expect(source).toContain('event.kind === "report_stale"');
    expect(source).toContain("Previous result");
    expect(source).toContain("Priority:");
  });

  it("separates connected repositories from previously saved reports and disables a pending selection", () => {
    expect(source).toContain("Connected repositories");
    expect(source).toContain("Repository reports");
    expect(source).toContain("disabled={repositorySelectionPending}");
    expect(source).toContain('"/api/dashboard/repositories"');
  });

  it("renders only the agreed sanitized detail categories", () => {
    expect(source).toContain(">Requirements and PR objectives<");
    expect(source).toContain("RequirementEvidenceList");
    expect(source).toContain("toDashboardRequirementViewModels");
    expect(source).toContain(">Priority files<");
    expect(source).toContain(">Suggested next step<");
    expect(source).not.toContain(">Limitations<");
    expect(source).not.toContain("rawDiff");
    expect(source).not.toContain("rawLog");
    expect(source).not.toContain("pullRequestBody");
    expect(source).not.toContain("issueBody");
  });

  it("uses AgentProof analysis language without exposing provider details", () => {
    expect(source).toContain('label="Analysis"');
    expect(source).toContain("Some supporting details are unavailable. Available evidence is still shown.");
    expect(source).not.toContain("AI explanation");
    expect(source).not.toContain("AI guidance");
    expect(source).not.toContain("provider response must not persist");
  });

  it("renders the evidence workspace without inventing issue grouping", () => {
    expect(source).toContain("Repository reports");
    expect(source).toContain("No reports yet");
    expect(source).toContain("Quick Summary");
    expect(source).toContain("View detailed evidence");
    expect(source).toContain("report_stale");
    expect(source).toContain("Current analysis reports");
    expect(source).not.toContain("Unlinked PRs");
  });

  it("uses the tenant-safe activity endpoint for Inbox events and opens linked reports", () => {
    expect(source).toContain('"/api/dashboard/activity"');
    expect(source).toContain("Inbox");
    expect(source).toContain("Recent activity");
    expect(source).toContain("openActivity");
    expect(source).not.toContain("Issue grouping and inbox are unavailable");
  });

  it("opens the saved previous report when a stale Inbox item is selected", () => {
    expect(source).toMatch(/if \(event\.kind === "report_stale"\) \{\s*if \(event\.reportId\) \{\s*setMessage\("Showing this previous result\."\);\s*await openReport\(event\.reportId\);/);
  });

  it("refreshes visible signed-in workspaces and gives the owner a session-only logout", () => {
    expect(source).toContain("DASHBOARD_REFRESH_INTERVAL_MS");
    expect(source).toContain("document.visibilityState === \"visible\"");
    expect(source).toContain("window.setInterval");
    expect(source).toContain("window.clearInterval");
    expect(source).toContain('"/api/tenants/auth/session"');
    expect(source).toContain('method: "DELETE"');
    expect(source).toContain("Log out");
  });

  it("moves an ephemeral preview to the configured OAuth host before starting sign-in", () => {
    expect(source).toContain("github_oauth_callback_origin_mismatch");
    expect(source).toContain("Opening the configured AgentProof address for secure GitHub sign-in.");
  });

  it("keeps repository summary comments opt-in through the existing tenant settings endpoint", () => {
    expect(source).toContain("Summary comments");
    expect(source).toContain('"/api/tenants/repositories"');
    expect(source).toContain('method: "PATCH"');
    expect(source).toContain("Comments are off");
  });

  it("asks for a concise enhanced-analysis choice only when a private repository is selected", () => {
    expect(source).toContain("Use essential analysis");
    expect(source).toContain("Enable enhanced analysis");
    expect(source).toContain("selected changed-code excerpts and evidence summaries");
    expect(source).toContain("repository.private ?");
  });
});
