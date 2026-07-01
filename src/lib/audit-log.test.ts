import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAuditEventIsPrivate,
  AuditLogError,
  AuditPrivacyError,
  clearAuditEventsForTests,
  getAuditEventsForTests,
  getAuditLogStoreStatus,
  listTenantAuditEvents,
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
      },
      slack: {
        action: "sent",
        privacy: "summary-only"
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
      },
      slack: {
        action: "sent",
        privacy: "summary-only"
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

  it("records lifecycle audit metadata without raw webhook payload fields", async () => {
    const row = await recordAuditEvent({
      action: "github_app_installation_disabled",
      result: "completed",
      actor: "github_app",
      installationId: 321,
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174200",
      webhookAction: "deleted",
      statusCode: 200,
      code: "github_app_installation_disabled"
    });
    const serialized = JSON.stringify(row);

    expect(row).toMatchObject({
      action: "github_app_installation_disabled",
      result: "completed",
      installation_id: 321,
      request_id: "123e4567-e89b-12d3-a456-426614174200",
      metadata: {
        webhookAction: "deleted",
        code: "github_app_installation_disabled"
      }
    });
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("lists bounded tenant audit activity summaries without raw metadata fields", async () => {
    await recordAuditEvent({
      action: "github_app_analysis_completed",
      result: "completed",
      tenantId: "tenant_a",
      repositoryFullName: "RengGyu/AgentProof",
      installationId: 123,
      pullRequestNumber: 27,
      headSha: "3e3703f63a07abcd",
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174100",
      webhookAction: "synchronize",
      statusCode: 200,
      priority: "medium",
      evidenceCoverage: 42,
      savedReport: { privacy: "summary-only", durability: "summary-only-supabase" },
      comment: { action: "updated" },
      slack: { action: "sent", privacy: "summary-only" }
    });
    await recordAuditEvent({
      action: "github_app_quota_blocked",
      result: "blocked",
      tenantId: "tenant_b",
      repositoryFullName: "Other/Private",
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174101",
      code: "github_app_tenant_quota_blocked"
    });

    const rows = await listTenantAuditEvents({ tenantId: "tenant_a", limit: 50 });
    const serialized = JSON.stringify(rows);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
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
      evidenceCoverage: 42,
      savedReport: {
        privacy: "summary-only",
        durability: "summary-only-supabase"
      },
      comment: {
        action: "updated"
      },
      slack: {
        action: "sent",
        privacy: "summary-only"
      }
    }));
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Other/Private");
    expect(serialized).not.toContain("requestId");
    expect(serialized).not.toContain("123e4567-e89b-12d3-a456-426614174100");
    expect(serialized).not.toContain("\"metadata\"");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("token");
  });

  it("lists tenant session failure audit summaries without raw credentials", async () => {
    await recordAuditEvent({
      action: "tenant_session_failed",
      result: "failed",
      actor: "system",
      tenantId: "tenant_a",
      statusCode: 401,
      code: "invite_invalid"
    });
    await recordAuditEvent({
      action: "tenant_auth_session_failed",
      result: "failed",
      actor: "system",
      tenantId: "tenant_a",
      statusCode: 401,
      code: "bootstrap_or_member_invalid"
    });

    const rows = await listTenantAuditEvents({ tenantId: "tenant_a", limit: 10 });
    const serialized = JSON.stringify(rows);

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actor: "system",
        action: "tenant_session_failed",
        result: "failed",
        statusCode: 401,
        code: "invite_invalid"
      }),
      expect.objectContaining({
        actor: "system",
        action: "tenant_auth_session_failed",
        result: "failed",
        statusCode: 401,
        code: "bootstrap_or_member_invalid"
      })
    ]));
    expect(rows).toHaveLength(2);
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("sessionHash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("\"metadata\"");
  });

  it("lists Supabase audit summaries with server-only credentials and filters unsafe rows", async () => {
    const env = {
      AGENTPROOF_AUDIT_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_AUDIT_EVENTS_TABLE: "audit_events_test"
    } as unknown as NodeJS.ProcessEnv;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json([
        {
          id: "audit-safe",
          created_at: "2026-06-30T00:00:00.000Z",
          actor: "github_app",
          action: "github_app_quota_blocked",
          result: "blocked",
          tenant_id: "tenant_a",
          repository_full_name: "RengGyu/AgentProof",
          installation_id: 123,
          pull_request_number: 27,
          head_sha_prefix: "3e3703f63a07",
          request_id: "123e4567-e89b-12d3-a456-426614174102",
          status_code: 200,
          metadata: { code: "github_app_tenant_quota_blocked" }
        },
        {
          id: "audit-unsafe",
          created_at: "2026-06-30T00:00:01.000Z",
          actor: "github_app",
          action: "github_app_analysis_failed",
          result: "failed",
          tenant_id: "tenant_a",
          metadata: { rawDiff: "Patch excerpt" }
        }
      ])
    );
    global.fetch = fetchMock as typeof fetch;

    const rows = await listTenantAuditEvents({ tenantId: "tenant_a", limit: 100 }, env);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const serialized = JSON.stringify(rows);

    expect(rows).toEqual([
      expect.objectContaining({
        id: "audit-safe",
        action: "github_app_quota_blocked",
        result: "blocked",
        code: "github_app_tenant_quota_blocked"
      })
    ]);
    expect(String(url)).toContain("https://agentproof-test.supabase.co/rest/v1/audit_events_test?");
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).toContain("limit=100");
    expect(String(url)).not.toContain("service-role-secret");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("\"metadata\"");
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
