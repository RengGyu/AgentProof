import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearUsageQuotaForTests, reserveUsageQuota } from "@/lib/usage-quota";
import { GET } from "./route";

describe("GET /api/tenants/usage", () => {
  afterEach(() => {
    clearUsageQuotaForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires a tenant-bound invite token before reading usage status", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/usage?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" }
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant usage status requires valid tenant authorization.",
      code: "tenant_usage_unauthorized"
    });
  });

  it("returns bounded metadata-only quota status for an authorized tenant", async () => {
    stubUsageEnv();
    await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "delivery-one",
      now: new Date("2026-06-30T00:00:00Z")
    });

    const response = await GET(new Request("http://localhost/api/tenants/usage?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      period: expect.stringMatching(/^\d{4}-\d{2}$/),
      usage: [
        {
          feature: "github_app_analysis",
          label: "PR evidence reports",
          enforced: true,
          configured: true,
          plan: "team",
          limit: 5,
          used: expect.any(Number),
          remaining: expect.any(Number),
          state: "available"
        }
      ],
      privacy: "usage-summary-only",
      next: "monitor_quota"
    });
    expect(json.usage[0].used).toBeGreaterThanOrEqual(0);
    expect(serialized).not.toContain("delivery-one");
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("memory");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("service-role");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("logs");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("accepts a tenant admin session cookie without an invite header", async () => {
    stubInviteEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/usage?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "usage-summary-only"
    });
  });

  it("rejects a wrong-tenant admin session cookie before reading usage status", async () => {
    stubInviteEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_b",
      inviteToken: "tenant-b-invite-token"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/usage?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports disabled quota as configure_quota without failing the dashboard", async () => {
    stubInviteEnv();

    const response = await GET(new Request("http://localhost/api/tenants/usage?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      tenantId: "tenant_a",
      period: expect.stringMatching(/^\d{4}-\d{2}$/),
      usage: [
        {
          feature: "github_app_analysis",
          label: "PR evidence reports",
          enforced: false,
          configured: false,
          state: "not-enforced",
          note: "Usage quota enforcement is disabled."
        }
      ],
      privacy: "usage-summary-only",
      next: "configure_quota"
    });
  });

  it("fails closed when the quota status store is unavailable", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      { tenantId: "tenant_a", monthlyAnalysisLimit: 5, enabled: true, plan: "team" }
    ]));

    const response = await GET(new Request("http://localhost/api/tenants/usage?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant usage quota status is unavailable.",
      code: "tenant_usage_quota_unavailable"
    });
  });
});

function stubUsageEnv() {
  stubInviteEnv();
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
    { tenantId: "tenant_a", monthlyAnalysisLimit: 5, enabled: true, plan: "team" }
  ]));
}

function stubInviteEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" },
    { tenantId: "tenant_b", token: "tenant-b-invite-token" }
  ]));
}
