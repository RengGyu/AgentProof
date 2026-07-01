import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuditEventsForTests, recordAuditEvent } from "./audit-log";
import {
  buildTenantAuditExport,
  DEFAULT_TENANT_AUDIT_EXPORT_LIMIT,
  MAX_TENANT_AUDIT_EXPORT_LIMIT,
  normalizeTenantAuditExportLimit
} from "./audit-export";

describe("tenant audit export", () => {
  afterEach(() => {
    clearAuditEventsForTests();
    vi.unstubAllGlobals();
  });

  it("projects bounded customer-facing audit events without tenant, provider, or raw evidence internals", async () => {
    await recordAuditEvent({
      action: "github_app_analysis_completed",
      result: "completed",
      tenantId: "tenant_a",
      repositoryFullName: "RengGyu/AgentProof",
      installationId: 123,
      pullRequestNumber: 27,
      headSha: "3e3703f63a07abcd",
      githubDeliveryId: "123e4567-e89b-12d3-a456-426614174200",
      webhookAction: "synchronize",
      statusCode: 200,
      priority: "medium",
      evidenceCoverage: 64,
      savedReport: { privacy: "summary-only", durability: "summary-only-supabase" },
      comment: { action: "updated" },
      slack: { action: "sent", privacy: "summary-only" }
    });

    const exportJson = await buildTenantAuditExport({
      tenantId: "tenant_a",
      now: new Date("2026-07-01T00:00:00.000Z")
    });
    const serialized = JSON.stringify(exportJson);

    expect(exportJson).toEqual({
      ok: true,
      tenantId: "tenant_a",
      generatedAt: "2026-07-01T00:00:00.000Z",
      schemaVersion: "2026-07-01",
      privacy: "tenant-audit-export-summary-only",
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
          },
          slack: {
            action: "sent",
            privacy: "summary-only"
          }
        })
      ],
      count: 1,
      limit: DEFAULT_TENANT_AUDIT_EXPORT_LIMIT,
      truncated: false
    });
    expect(Object.keys(exportJson.events[0])).toEqual([
      "id",
      "createdAt",
      "actor",
      "action",
      "result",
      "repositoryFullName",
      "pullRequestNumber",
      "headShaPrefix",
      "deliveryIdPrefix",
      "statusCode",
      "webhookAction",
      "priority",
      "evidenceCoverage",
      "savedReport",
      "comment",
      "slack"
    ]);
    expect(serialized).not.toContain("tenant_id");
    expect(serialized).not.toContain("tenantId\":\"tenant_a\",\"createdAt");
    expect(serialized).not.toContain("installationId");
    expect(serialized).not.toContain("123e4567-e89b-12d3-a456-426614174200");
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

  it("defaults to 100, clamps to 250, fetches one extra row, and marks truncation", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(
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
    const env = {
      AGENTPROOF_AUDIT_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_AUDIT_EVENTS_TABLE: "audit_events_test"
    } as unknown as NodeJS.ProcessEnv;

    const exportJson = await buildTenantAuditExport({ tenantId: "tenant_a", limit: 999 }, env);
    const [url] = fetchMock.mock.calls[0] ?? [];

    expect(exportJson.limit).toBe(MAX_TENANT_AUDIT_EXPORT_LIMIT);
    expect(exportJson.count).toBe(MAX_TENANT_AUDIT_EXPORT_LIMIT);
    expect(exportJson.truncated).toBe(true);
    expect(exportJson.events).toHaveLength(MAX_TENANT_AUDIT_EXPORT_LIMIT);
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).toContain("limit=251");
    expect(String(url)).not.toContain("service-role-secret");
  });

  it("filters unsafe Supabase rows from export without leaking their contents", async () => {
    const fetchMock = vi.fn(async () => Response.json([
      {
        id: "audit-safe",
        created_at: "2026-07-01T00:00:00.000Z",
        actor: "github_app",
        action: "github_app_quota_blocked",
        result: "blocked",
        tenant_id: "tenant_a",
        metadata: { code: "github_app_quota_blocked" }
      },
      {
        id: "audit-unsafe",
        created_at: "2026-07-01T00:00:01.000Z",
        actor: "github_app",
        action: "github_app_analysis_failed",
        result: "failed",
        tenant_id: "tenant_a",
        metadata: { rawDiff: "Patch excerpt with SECRET_TOKEN" }
      }
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_AUDIT_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_AUDIT_EVENTS_TABLE: "audit_events_test"
    } as unknown as NodeJS.ProcessEnv;

    const exportJson = await buildTenantAuditExport({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(exportJson);

    expect(exportJson.events).toEqual([
      expect.objectContaining({
        id: "audit-safe",
        action: "github_app_quota_blocked",
        code: "github_app_quota_blocked"
      })
    ]);
    expect(serialized).not.toContain("audit-unsafe");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("SECRET_TOKEN");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("\"metadata\"");
  });

  it("normalizes malformed export limits to the default summary bound", () => {
    expect(normalizeTenantAuditExportLimit(undefined)).toBe(DEFAULT_TENANT_AUDIT_EXPORT_LIMIT);
    expect(normalizeTenantAuditExportLimit(0)).toBe(DEFAULT_TENANT_AUDIT_EXPORT_LIMIT);
    expect(normalizeTenantAuditExportLimit(25.5)).toBe(DEFAULT_TENANT_AUDIT_EXPORT_LIMIT);
    expect(normalizeTenantAuditExportLimit(1)).toBe(1);
    expect(normalizeTenantAuditExportLimit(999)).toBe(MAX_TENANT_AUDIT_EXPORT_LIMIT);
  });
});
