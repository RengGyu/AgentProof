import { describe, expect, it } from "vitest";
import { buildTenantSetupWarningRollup } from "./tenant-dashboard-warnings";

describe("tenant dashboard setup warnings", () => {
  it("builds summary-only warning rollups from loaded dashboard summaries", () => {
    const rollup = buildTenantSetupWarningRollup({
      account: {
        account: { status: "active", configured: true },
        roleCounts: { owner: 1, admin: 0, member: 2 }
      },
      entitlements: {
        quota: { state: "available", configured: true, enforced: true },
        repositories: { state: "configured", connectedRepositoryCount: 2, analysisEnabledCount: 1 },
        features: [
          { key: "github_app_analysis", state: "enabled", enabled: true },
          { key: "saved_summary_links", state: "enabled", enabled: true }
        ]
      },
      repositoryHealth: [
        { status: "github-accessible", githubAccess: "accessible" },
        { status: "github-not-checked", githubAccess: "not-checked" }
      ],
      usage: [{ state: "available" }],
      analysisJobs: { counts: { failed: 0, terminal: 0, active: 1 } }
    });

    expect(rollup).toEqual({
      privacy: "tenant-setup-warning-rollup-summary-only",
      basis: "loaded_dashboard_summaries",
      counts: { critical: 0, warning: 0, info: 1, total: 1 },
      warnings: [
        {
          key: "repository_health_not_checked",
          severity: "info",
          label: "Live repository access not checked",
          detail: "1 repositories have metadata-only health status.",
          action: "Probe Access"
        }
      ],
      next: "load_setup_summaries"
    });
  });

  it("surfaces blocking setup issues without repository names, ids, or raw internals", () => {
    const rollup = buildTenantSetupWarningRollup({
      account: {
        account: { status: "active", configured: true },
        roleCounts: { owner: 0, admin: 1, member: 0 }
      },
      entitlements: {
        quota: { state: "exhausted", configured: true, enforced: true },
        repositories: { state: "configured", connectedRepositoryCount: 2, analysisEnabledCount: 0 },
        features: [
          { key: "github_app_analysis", state: "disabled", enabled: false },
          { key: "structured_llm_verifier", state: "unavailable", enabled: false },
          { key: "slack_summaries", state: "disabled", enabled: false }
        ]
      },
      repositoryHealth: [
        { status: "disabled", githubAccess: "not-checked" },
        { status: "github-inaccessible", githubAccess: "inaccessible" },
        { status: "github-rate-limited", githubAccess: "rate-limited" }
      ],
      usage: [{ state: "exhausted" }],
      analysisJobs: { counts: { failed: 2, terminal: 1, active: 0 } }
    });
    const serialized = JSON.stringify(rollup);

    expect(rollup.counts.critical).toBeGreaterThan(0);
    expect(rollup.counts.warning).toBeGreaterThan(0);
    expect(rollup.next).toBe("fix_blocking_setup");
    expect(rollup.warnings.map((item) => item.key)).toEqual(expect.arrayContaining([
      "owner_missing",
      "repository_analysis_disabled",
      "quota_exhausted",
      "feature_gates_blocked",
      "repository_health_blocking",
      "repository_health_provider_warning",
      "usage_exhausted",
      "analysis_jobs_terminal"
    ]));
    expect(serialized).not.toContain("installationId");
    expect(serialized).not.toContain("repositoryId");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("service-role");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("reprompt");
  });

  it("marks the dashboard ready only when loaded summaries have no warnings", () => {
    const rollup = buildTenantSetupWarningRollup({
      account: {
        account: { status: "trialing", configured: true },
        roleCounts: { owner: 1, admin: 1, member: 3 }
      },
      entitlements: {
        quota: { state: "available", configured: true, enforced: true },
        repositories: { state: "configured", connectedRepositoryCount: 1, analysisEnabledCount: 1 },
        features: [
          { key: "github_app_analysis", state: "enabled", enabled: true },
          { key: "connected_repository_verification", state: "enabled", enabled: true }
        ]
      },
      repositoryHealth: [{ status: "ready", githubAccess: "not-checked" }],
      usage: [{ state: "available" }],
      analysisJobs: { counts: { failed: 0, terminal: 0, active: 0 } }
    });

    expect(rollup.counts).toEqual({ critical: 0, warning: 0, info: 0, total: 0 });
    expect(rollup.warnings).toEqual([]);
    expect(rollup.next).toBe("ready_for_first_report");
  });
});
