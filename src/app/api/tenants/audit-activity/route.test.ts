import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuditEventsForTests, recordAuditEvent } from "@/lib/audit-log";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { GET } from "./route";

describe("GET /api/tenants/audit-activity", () => {
  afterEach(() => {
    clearAuditEventsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires a tenant-bound invite token before reading audit activity", async () => {
    stubInviteEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/audit-activity?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" }
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant audit activity requires a valid tenant-bound invite token.",
      code: "tenant_audit_unauthorized"
    });
  });

  it("returns bounded activity summaries for the authorized tenant only", async () => {
    stubInviteEnv();
    await recordAuditEvent({
      action: "github_app_analysis_completed",
      result: "completed",
      tenantId: "tenant_a",
      repositoryFullName: "RengGyu/AgentProof",
      installationId: 123,
      pullRequestNumber: 27,
      headSha: "3e3703f63a07abcd",
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174300",
      webhookAction: "synchronize",
      statusCode: 200,
      priority: "medium",
      evidenceCoverage: 64,
      savedReport: { privacy: "summary-only", durability: "summary-only-supabase" }
    });
    await recordAuditEvent({
      action: "github_app_grant_denied",
      result: "blocked",
      tenantId: "tenant_b",
      repositoryFullName: "Other/Private",
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174301",
      code: "github_app_tenant_grant_missing"
    });

    const response = await GET(new Request("http://localhost/api/tenants/audit-activity?tenantId=tenant_a&limit=100", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      activity: [
        expect.objectContaining({
          actor: "github_app",
          action: "github_app_analysis_completed",
          result: "completed",
          repositoryFullName: "RengGyu/AgentProof",
          installationId: 123,
          pullRequestNumber: 27,
          headShaPrefix: "3e3703f63a07",
          deliveryIdPrefix: "123e4567-e89",
          statusCode: 200,
          webhookAction: "synchronize",
          priority: "medium",
          evidenceCoverage: 64,
          savedReport: {
            privacy: "summary-only",
            durability: "summary-only-supabase"
          }
        })
      ],
      count: 1,
      truncated: false,
      privacy: "audit-activity-summary-only",
      next: "monitor_activity"
    });
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Other/Private");
    expect(serialized).not.toContain("123e4567-e89b-12d3-a456-426614174300");
    expect(serialized).not.toContain("requestId");
    expect(serialized).not.toContain("\"metadata\"");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("token");
  });

  it("returns bounded activity summaries with a tenant admin session cookie", async () => {
    stubInviteEnv();
    await recordAuditEvent({
      action: "github_app_analysis_completed",
      result: "completed",
      tenantId: "tenant_a",
      repositoryFullName: "RengGyu/AgentProof"
    });
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/audit-activity?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "audit-activity-summary-only",
      count: 1
    });
  });

  it("marks activity as truncated when more rows exist than the requested limit", async () => {
    stubInviteEnv();
    for (let index = 0; index < 3; index += 1) {
      await recordAuditEvent({
        action: "github_app_analysis_failed",
        result: "failed",
        tenantId: "tenant_a",
        githubDeliveryId: `123e4567-e89b-12d3-a456-42661417430${index}`,
        code: "github_app_analysis_failed"
      });
    }

    const response = await GET(new Request("http://localhost/api/tenants/audit-activity?tenantId=tenant_a&limit=2", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.count).toBe(2);
    expect(json.truncated).toBe(true);
    expect(json.activity).toHaveLength(2);
  });

  it("fails closed when audit storage is unavailable", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");

    const response = await GET(new Request("http://localhost/api/tenants/audit-activity?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant audit activity is unavailable.",
      code: "tenant_audit_unavailable"
    });
  });
});

function stubInviteEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" },
    { tenantId: "tenant_b", token: "tenant-b-invite-token" }
  ]));
}
