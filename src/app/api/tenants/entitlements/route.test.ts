import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearTenantRepositoryGrantsForTests, createTenantRepositoryGrant } from "@/lib/tenant-control-plane";
import { clearUsageQuotaForTests, reserveUsageQuota } from "@/lib/usage-quota";
import { GET } from "./route";

describe("GET /api/tenants/entitlements", () => {
  afterEach(() => {
    clearTenantRepositoryGrantsForTests();
    clearUsageQuotaForTests();
    vi.unstubAllEnvs();
  });

  it("requires tenant admin access before reading plan access", async () => {
    stubSessionEnv();

    const response = await GET(new Request("http://localhost/api/tenants/entitlements?tenantId=tenant_a"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Tenant plan access requires a valid tenant-bound invite token.",
      code: "tenant_entitlements_unauthorized"
    });
  });

  it("returns aggregate-only plan access from tenant-bound invites", async () => {
    stubSessionEnv();
    stubAccountEnv();
    stubQuotaEnv();
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

    const response = await GET(new Request("http://localhost/api/tenants/entitlements?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
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
      },
      privacy: "plan-entitlement-summary-only",
      next: "review_plan_access"
    });
    expect(json.features).toEqual(expect.arrayContaining([
      {
        key: "github_app_analysis",
        label: "PR evidence reports",
        state: "enabled",
        enabled: true
      },
      {
        key: "slack_summaries",
        label: "Slack summaries",
        state: "enabled",
        enabled: true
      },
      {
        key: "marker_comments",
        label: "Marker PR comments",
        state: "disabled",
        enabled: false,
        reason: "repo_setting_disabled"
      }
    ]));
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("tenant-session-secret");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("installationId");
    expect(serialized).not.toContain("repositoryId");
    expect(serialized).not.toContain("delivery-one");
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("owner@example.com");
  });

  it("accepts a tenant admin session cookie without an invite header", async () => {
    stubSessionEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/entitlements?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "plan-entitlement-summary-only"
    });
  });

  it("rejects a wrong-tenant admin session cookie before reading plan access", async () => {
    stubSessionEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_b",
      inviteToken: "tenant-b-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/entitlements?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(401);
  });

  it("reports unavailable evidence sources without leaking store internals", async () => {
    stubSessionEnv();
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", "not-json");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", "not-json");

    const response = await GET(new Request("http://localhost/api/tenants/entitlements?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      plan: "unknown",
      account: {
        status: "unknown",
        configured: false,
        source: "unavailable"
      },
      repositories: {
        state: "unavailable"
      },
      privacy: "plan-entitlement-summary-only",
      next: "configure_plan_access"
    });
    expect(serialized).not.toContain("not-json");
    expect(serialized).not.toContain("AGENTPROOF");
    expect(serialized).not.toContain("service-role");
  });
});

function stubSessionEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" },
    { tenantId: "tenant_b", token: "tenant-b-invite-token" }
  ]));
}

function stubAccountEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "AgentProof Team",
      status: "active",
      plan: "team",
      providerCustomerId: "cus_secret_should_not_leak",
      subscriptionId: "sub_secret_should_not_leak",
      email: "owner@example.com"
    }
  ]));
}

function stubQuotaEnv() {
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
    {
      tenantId: "tenant_a",
      monthlyAnalysisLimit: 5,
      enabled: true,
      plan: "team"
    }
  ]));
}
