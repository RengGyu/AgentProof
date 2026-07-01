import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantRepositoryGrant, clearTenantRepositoryGrantsForTests } from "./tenant-control-plane";
import { clearUsageQuotaForTests, reserveUsageQuota } from "./usage-quota";
import { readTenantEntitlementSummary } from "./tenant-entitlements";

describe("tenant plan entitlement summary boundary", () => {
  afterEach(() => {
    clearTenantRepositoryGrantsForTests();
    clearUsageQuotaForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("composes account, quota, and repository grant signals without exposing ids or provider data", async () => {
    stubAccountEnv("team", "active");
    stubQuotaEnv({ limit: 5, plan: "team" });
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "delivery-one"
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 123,
      repositoryId: 456,
      repositoryFullName: "RengGyu/AgentProof",
      enabled: true,
      analysisEnabled: true,
      saveReportsEnabled: true,
      commentEnabled: false,
      slackNotificationsEnabled: true
    });

    const result = await readTenantEntitlementSummary({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      privacy: "plan-entitlement-summary-only",
      tenantId: "tenant_a",
      plan: "team",
      account: {
        status: "active",
        configured: true,
        source: "tenant_account_summary"
      },
      quota: {
        state: "available",
        configured: true,
        enforced: true,
        limit: 5,
        used: 1,
        remaining: 4,
        plan: "team",
        planMatchesAccount: true
      },
      repositories: {
        state: "configured",
        connectedRepositoryCount: 1,
        analysisEnabledCount: 1,
        saveReportsEnabledCount: 1,
        commentEnabledCount: 0,
        slackNotificationsEnabledCount: 1
      }
    });
    expect(result.features.find((feature) => feature.key === "github_app_analysis")).toMatchObject({
      state: "enabled",
      enabled: true
    });
    expect(result.features.find((feature) => feature.key === "saved_summary_links")).toMatchObject({
      state: "enabled",
      enabled: true
    });
    expect(result.features.find((feature) => feature.key === "marker_comments")).toMatchObject({
      state: "disabled",
      enabled: false,
      reason: "repo_setting_disabled"
    });
    expect(result.features.find((feature) => feature.key === "slack_summaries")).toMatchObject({
      state: "enabled",
      enabled: true
    });
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("installation");
    expect(serialized).not.toContain("repositoryId");
    expect(serialized).not.toContain("delivery-one");
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("subscription");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("uses bounded plan capability flags to downgrade repository side-effect features", async () => {
    stubAccountEnv("team", "active");
    stubQuotaEnv({
      limit: 5,
      plan: "team",
      connectedRepositoryLimit: 0,
      savedSummaryLinksEnabled: false,
      markerCommentsEnabled: false,
      slackSummariesEnabled: false,
      structuredLlmVerifierEnabled: false
    });
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 123,
      repositoryId: 456,
      repositoryFullName: "RengGyu/AgentProof",
      enabled: true,
      analysisEnabled: true,
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    });

    const result = await readTenantEntitlementSummary({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(result);

    expect(result.quota).toMatchObject({
      state: "available",
      plan: "team"
    });
    expect(result.repositories).toMatchObject({
      state: "configured",
      connectedRepositoryCount: 1,
      connectedRepositoryLimit: 0,
      saveReportsEnabledCount: 1,
      commentEnabledCount: 1,
      slackNotificationsEnabledCount: 1
    });
    for (const key of [
      "connected_repository_verification",
      "saved_summary_links",
      "marker_comments",
      "slack_summaries",
      "structured_llm_verifier"
    ] as const) {
      expect(result.features.find((feature) => feature.key === key)).toMatchObject({
        state: "disabled",
        enabled: false,
        reason: "plan_feature_disabled"
      });
    }
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("installation");
    expect(serialized).not.toContain("repositoryId");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("subscription");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("reports missing quota and missing repo grants as not configured instead of guessing", async () => {
    stubAccountEnv("team", "active");

    const result = await readTenantEntitlementSummary({ tenantId: "tenant_a" });

    expect(result.quota).toMatchObject({
      state: "not_enforced",
      configured: false,
      enforced: false
    });
    expect(result.repositories).toMatchObject({
      state: "not_configured",
      connectedRepositoryCount: 0
    });
    expect(result.features.find((feature) => feature.key === "github_app_analysis")).toMatchObject({
      state: "not_configured",
      reason: "quota_not_configured"
    });
    expect(result.features.find((feature) => feature.key === "connected_repository_verification")).toMatchObject({
      state: "not_configured",
      reason: "no_connected_repositories"
    });
  });

  it("surfaces plan mismatch between account metadata and quota without treating it as billing truth", async () => {
    stubAccountEnv("team", "active");
    stubQuotaEnv({ limit: 5, plan: "pro" });
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        installationId: 123,
        repositoryId: 456,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true
      }
    ]));

    const result = await readTenantEntitlementSummary({ tenantId: "tenant_a" });

    expect(result.plan).toBe("team");
    expect(result.quota).toMatchObject({
      plan: "pro",
      planMatchesAccount: false
    });
    expect(result.features.find((feature) => feature.key === "github_app_analysis")).toMatchObject({
      state: "enabled"
    });
  });

  it("marks account or repository store failures as unavailable", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", "not-json");
    stubQuotaEnv({ limit: 5, plan: "team" });
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", "not-json");

    const result = await readTenantEntitlementSummary({ tenantId: "tenant_a" });

    expect(result.account).toEqual({
      status: "unknown",
      configured: false,
      source: "unavailable"
    });
    expect(result.repositories).toEqual({ state: "unavailable" });
    expect(result.features.find((feature) => feature.key === "github_app_analysis")).toMatchObject({
      state: "unavailable",
      reason: "account_unavailable"
    });
  });

  it("disables feature access for suspended tenants", async () => {
    stubAccountEnv("team", "suspended");
    stubQuotaEnv({ limit: 5, plan: "team" });
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        installationId: 123,
        repositoryId: 456,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        saveReportsEnabled: true,
        commentEnabled: true,
        slackNotificationsEnabled: true
      }
    ]));

    const result = await readTenantEntitlementSummary({ tenantId: "tenant_a" });

    expect(result.features.find((feature) => feature.key === "github_app_analysis")).toMatchObject({
      state: "disabled",
      enabled: false,
      reason: "tenant_not_active"
    });
    expect(result.features.find((feature) => feature.key === "marker_comments")).toMatchObject({
      state: "disabled",
      enabled: false,
      reason: "tenant_not_active"
    });
    expect(result.features.find((feature) => feature.key === "slack_summaries")).toMatchObject({
      state: "disabled",
      enabled: false,
      reason: "tenant_not_active"
    });
  });
});

function stubAccountEnv(plan: string, status: string) {
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "AgentProof Team",
      status,
      plan,
      providerCustomerId: "cus_secret_should_not_leak",
      subscriptionId: "sub_secret_should_not_leak",
      email: "owner@example.com"
    }
  ]));
}

function stubQuotaEnv(input: {
  limit: number;
  plan: string;
  connectedRepositoryLimit?: number;
  savedSummaryLinksEnabled?: boolean;
  markerCommentsEnabled?: boolean;
  slackSummariesEnabled?: boolean;
  structuredLlmVerifierEnabled?: boolean;
}) {
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
    {
      tenantId: "tenant_a",
      monthlyAnalysisLimit: input.limit,
      enabled: true,
      plan: input.plan,
      connectedRepositoryLimit: input.connectedRepositoryLimit,
      savedSummaryLinksEnabled: input.savedSummaryLinksEnabled,
      markerCommentsEnabled: input.markerCommentsEnabled,
      slackSummariesEnabled: input.slackSummariesEnabled,
      structuredLlmVerifierEnabled: input.structuredLlmVerifierEnabled
    }
  ]));
}
