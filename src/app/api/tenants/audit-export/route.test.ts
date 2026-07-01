import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuditEventsForTests, recordAuditEvent } from "@/lib/audit-log";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { GET } from "./route";

describe("GET /api/tenants/audit-export", () => {
  afterEach(() => {
    clearAuditEventsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires tenant-bound auth before reading audit storage", async () => {
    stubInviteEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/audit-export?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" }
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant audit export requires a valid tenant-bound invite token.",
      code: "tenant_audit_export_unauthorized"
    });
  });

  it("returns a summary-only attachment envelope with required success headers", async () => {
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
      savedReport: { privacy: "summary-only", durability: "summary-only-supabase" },
      comment: { action: "updated" }
    });

    const response = await GET(new Request("http://localhost/api/tenants/audit-export?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"agentproof-audit-tenant_a.json\"");
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      schemaVersion: "2026-07-01",
      privacy: "tenant-audit-export-summary-only",
      count: 1,
      limit: 100,
      truncated: false,
      events: [
        expect.objectContaining({
          actor: "github_app",
          action: "github_app_analysis_completed",
          result: "completed",
          repositoryFullName: "RengGyu/AgentProof",
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
          },
          comment: {
            action: "updated"
          }
        })
      ]
    });
    expect(typeof json.generatedAt).toBe("string");
    expect(serialized).not.toContain("installationId");
    expect(serialized).not.toContain("tenant_id");
    expect(serialized).not.toContain("123e4567-e89b-12d3-a456-426614174300");
    expect(serialized).not.toContain("\"metadata\"");
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("logs");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("savedReportUrl");
    expect(serialized).not.toContain("commentBody");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("signature");
  });

  it("accepts the tenant admin session cookie", async () => {
    stubInviteEnv();
    await recordAuditEvent({
      action: "github_app_analysis_failed",
      result: "failed",
      tenantId: "tenant_a",
      code: "github_app_analysis_failed"
    });
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/audit-export?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "tenant-audit-export-summary-only",
      count: 1
    });
  });

  it("fetches limit plus one from Supabase and reports truncation", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
    const fetchMock = vi.fn(async () => Response.json(
      Array.from({ length: 251 }, (_, index) => ({
        id: `audit-${index}`,
        created_at: `2026-07-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
        actor: "github_app",
        action: "github_app_analysis_failed",
        result: "failed",
        tenant_id: "tenant_a",
        metadata: { code: "github_app_analysis_failed" }
      }))
    ));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/audit-export?tenantId=tenant_a&limit=999", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL | Request, RequestInit | undefined];

    expect(response.status).toBe(200);
    expect(json.count).toBe(250);
    expect(json.limit).toBe(250);
    expect(json.truncated).toBe(true);
    expect(json.events).toHaveLength(250);
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).toContain("limit=251");
    expect(String(url)).not.toContain("service-role-secret");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
  });

  it("fails closed with a generic 503 when audit storage is unavailable", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");

    const response = await GET(new Request("http://localhost/api/tenants/audit-export?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant audit export is unavailable.",
      code: "tenant_audit_export_unavailable"
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
