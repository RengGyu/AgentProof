import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAuditEventIsPrivate,
  AuditLogError,
  AuditPrivacyError,
  clearAuditEventsForTests,
  getAuditEventsForTests,
  getAuditLogStoreStatus,
  recordAuditEvent
} from "./audit-log";

describe("audit log", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    clearAuditEventsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("records bounded in-memory audit metadata without raw evidence fields", async () => {
    const row = await recordAuditEvent({
      action: "github_app_analysis_completed",
      result: "completed",
      tenantId: "tenant_a",
      repositoryFullName: "RengGyu/AgentProof",
      installationId: 123,
      pullRequestNumber: 27,
      headSha: "3e3703f63a07abcd",
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174000",
      webhookAction: "synchronize",
      statusCode: 200,
      priority: "medium",
      evidenceCoverage: 42,
      savedReport: {
        privacy: "summary-only",
        durability: "summary-only-supabase"
      },
      comment: {
        action: "updated"
      }
    });
    const serialized = JSON.stringify(row);

    expect(getAuditEventsForTests()).toHaveLength(1);
    expect(row).toEqual(expect.objectContaining({
      actor: "github_app",
      action: "github_app_analysis_completed",
      result: "completed",
      tenant_id: "tenant_a",
      repository_full_name: "RengGyu/AgentProof",
      installation_id: 123,
      pull_request_number: 27,
      head_sha_prefix: "3e3703f63a07",
      request_id: "123e4567-e89b-12d3-a456-426614174000",
      status_code: 200
    }));
    expect(row.metadata).toEqual({
      webhookAction: "synchronize",
      priority: "medium",
      evidenceCoverage: 42,
      savedReport: {
        privacy: "summary-only",
        durability: "summary-only-supabase"
      },
      comment: {
        action: "updated"
      }
    });
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("token");
  });

  it("stores Supabase audit rows through server-only credentials without exposing the key in the row", async () => {
    const env = {
      AGENTPROOF_AUDIT_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_AUDIT_EVENTS_TABLE: "audit_events_test"
    } as unknown as NodeJS.ProcessEnv;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 201 })
    );
    global.fetch = fetchMock as typeof fetch;

    const row = await recordAuditEvent({
      action: "github_app_quota_blocked",
      result: "blocked",
      tenantId: "tenant_a",
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 27,
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174000",
      webhookAction: "opened",
      statusCode: 200,
      code: "github_app_tenant_quota_blocked"
    }, env);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body));
    const serializedBody = JSON.stringify(body);

    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/audit_events_test");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(body).toEqual(row);
    expect(serializedBody).not.toContain("service-role-secret");
    expect(serializedBody).not.toContain("evidenceIndex");
    expect(serializedBody).not.toContain("claims");
    expect(serializedBody).not.toContain("reprompt");
    expect(serializedBody).not.toContain("Patch excerpt");
  });

  it("rejects audit rows with forbidden raw evidence fields or secret-looking values before storage", () => {
    const unsafeRawField = {
      action: "github_app_analysis_failed",
      result: "failed",
      tenant_id: "tenant_a",
      metadata: {
        rawDiff: "Patch excerpt"
      }
    };
    const unsafeSecret = {
      action: "github_app_analysis_failed",
      result: "failed",
      tenant_id: "tenant_a",
      metadata: {
        code: "token=github_pat_secret_should_not_leak_1234567890"
      }
    };

    expect(() => assertAuditEventIsPrivate(unsafeRawField)).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate(unsafeSecret)).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate({ metadata: { rawBody: "{}" } })).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate({ metadata: { accessToken: "[redacted]" } })).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate({ metadata: { privateKey: "[redacted]" } })).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate({ metadata: { evidenceIndex: [] } })).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate({ metadata: { commentBody: "body" } })).toThrow(AuditPrivacyError);
    expect(() => assertAuditEventIsPrivate({
      metadata: {
        savedReportUrl: "https://agentproof.example/reports/r_123?key=secret"
      }
    })).toThrow(AuditPrivacyError);
    expect(getAuditEventsForTests()).toEqual([]);
  });

  it("reports audit storage status without exposing env values and fails closed for partial Supabase env", async () => {
    const partialEnv = {
      AGENTPROOF_AUDIT_SUPABASE_URL: "https://agentproof-test.supabase.co"
    } as unknown as NodeJS.ProcessEnv;

    expect(getAuditLogStoreStatus(partialEnv)).toEqual({
      mode: "memory",
      configured: false,
      durable: false,
      table: "agentproof_audit_events",
      missingEnv: ["AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY"]
    });
    await expect(recordAuditEvent({
      action: "github_app_not_ready",
      result: "blocked",
      repositoryFullName: "owner/repo"
    }, partialEnv)).rejects.toThrow(AuditLogError);
  });

  it("throws a bounded error when Supabase audit storage is unavailable", async () => {
    const env = {
      AGENTPROOF_AUDIT_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    } as unknown as NodeJS.ProcessEnv;
    global.fetch = vi.fn(async () => new Response("down", { status: 500 })) as typeof fetch;

    await expect(recordAuditEvent({
      action: "github_app_quota_unavailable",
      result: "failed",
      tenantId: "tenant_a",
      repositoryFullName: "owner/repo",
      code: "usage_quota_unavailable"
    }, env)).rejects.toThrow(AuditLogError);
  });
});
