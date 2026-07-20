import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob
} from "@/lib/analysis-jobs";
import { clearAuditEventsForTests, recordAuditEvent } from "@/lib/audit-log";
import { markGitHubWebhookDelivery } from "@/lib/github-app";
import {
  clearTenantGitHubInstallationsForTests,
  upsertTenantGitHubInstallation
} from "@/lib/github-installations";
import { clearSavedReportsForTests, createSavedReport } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { clearTenantRepositoryGrantsForTests, createTenantRepositoryGrant } from "@/lib/tenant-control-plane";
import { getTenantRetentionDeletionPlan, TENANT_DATA_RETENTION_POLICY } from "@/lib/tenant-retention-policy";
import { clearUsageQuotaForTests, reserveUsageQuota } from "@/lib/usage-quota";
import { GET } from "./route";

describe("GET /api/tenants/deletion-preview", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearAuditEventsForTests();
    clearSavedReportsForTests();
    clearTenantGitHubInstallationsForTests();
    clearTenantRepositoryGrantsForTests();
    clearUsageQuotaForTests();
  });

  it("requires tenant-bound access before reading deletion preview counts", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toEqual({
      error: "Tenant deletion preview requires valid tenant authorization.",
      code: "tenant_deletion_preview_unauthorized"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns summary-only tenant deletion preview counts for memory stores", async () => {
    stubTenantAccess();
    stubMemoryStores();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await seedTenantData("tenant_a");
    await seedTenantData("tenant_b");
    await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "usage-a-2"
    });

    const response = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "tenant-deletion-preview-counts-only",
      mode: "dry-run",
      destructive: false,
      tenantId: "tenant_a",
      categories: [
        readyCategory("saved_reports", 1),
        policyReviewCategory("repository_grants", 1),
        policyReviewCategory("github_installations", 1),
        readyCategory("webhook_deliveries", 1),
        policyReviewCategory("analysis_jobs", 1),
        policyReviewCategory("audit_events", 1),
        policyReviewCategory("usage_records", 2)
      ],
      totals: {
        knownCount: 8,
        unavailableCategories: 0
      },
      retentionPolicy: expectedRetentionPolicy(),
      next: "review_retention_policy_before_delete"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("https://github.com");
    expect(serialized).not.toContain("raw-idempotency-key");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("memory");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("durable");
    expect(serialized).not.toContain("configured");
  });

  it("accepts a tenant admin session cookie and rejects wrong-tenant sessions", async () => {
    stubTenantAccess();
    stubMemoryStores();
    await seedTenantData("tenant_a");
    const validSession = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });
    const wrongTenantSession = createTenantAdminSession({
      tenantId: "tenant_b",
      inviteToken: "tenant-b-invite-token"
    });

    const valid = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { cookie: validSession.sessionCookie }
    }));
    const wrong = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { cookie: wrongTenantSession.sessionCookie }
    }));

    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toMatchObject({
      ok: true,
      privacy: "tenant-deletion-preview-counts-only",
      tenantId: "tenant_a"
    });
    expect(wrong.status).toBe(401);
    await expect(wrong.json()).resolves.toEqual({
      error: "Tenant deletion preview requires valid tenant authorization.",
      code: "tenant_deletion_preview_unauthorized"
    });
  });

  it("does not clean up expired memory saved reports while counting deletion preview", async () => {
    stubTenantAccess();
    stubMemoryStores();
    const expiredReport = generateVerificationReport(demoScenarios.clean);
    await createSavedReport(expiredReport, { tenantId: "tenant_a", ttlMs: -1 });

    const first = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const second = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    await expect(first.json()).resolves.toMatchObject({
      categories: expect.arrayContaining([readyCategory("saved_reports", 1)])
    });
    await expect(second.json()).resolves.toMatchObject({
      categories: expect.arrayContaining([readyCategory("saved_reports", 1)])
    });
  });

  it("reports unavailable categories without leaking store internals", async () => {
    stubTenantAccess();
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      { tenantId: "tenant_a", monthlyAnalysisLimit: 10, enabled: true, plan: "team" }
    ]));

    const response = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.privacy).toBe("tenant-deletion-preview-counts-only");
    expect(json.retentionPolicy).toMatchObject({
      status: "draft",
      version: TENANT_DATA_RETENTION_POLICY.version
    });
    expect(json.totals.unavailableCategories).toBeGreaterThan(0);
    expect(json.categories).toEqual(expect.arrayContaining([
      {
        key: "analysis_jobs",
        status: "unavailable",
        reason: "store-unavailable"
      }
    ]));
    expect(serialized).not.toContain("AGENTPROOF_REPORTS_SUPABASE_URL");
    expect(serialized).not.toContain("agentproof-test.supabase.co");
    expect(serialized).not.toContain("SERVICE_ROLE");
    expect(serialized).not.toContain("memory");
    expect(serialized).not.toContain("supabase");
  });

  it("uses narrow Supabase HEAD count queries for durable preview counts", async () => {
    stubTenantAccess();
    stubSupabaseStores();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("agentproof_tenants")) {
        return Response.json([{ tenant_id: "tenant_a", name: "Tenant A", status: "active", plan: "team" }]);
      }
      if (href.includes("agentproof_tenant_members")) {
        return Response.json([]);
      }
      const count = href.includes("saved_reports_test")
        ? 2
        : href.includes("tenant_grants_test")
          ? 3
          : href.includes("github_installations_test")
            ? 4
            : href.includes("webhook_deliveries_test")
              ? 5
              : href.includes("analysis_jobs_test")
                ? 6
                : href.includes("audit_events_test")
                  ? 7
                  : href.includes("usage_records_test")
                    ? 8
                  : 0;

      return new Response(null, {
        status: 200,
        headers: { "content-range": `0-0/${count}` }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "tenant-deletion-preview-counts-only",
      mode: "dry-run",
      destructive: false,
      totals: {
        knownCount: 35,
        unavailableCategories: 0
      }
    });
    expect(json.categories).toEqual([
      readyCategory("saved_reports", 2),
      policyReviewCategory("repository_grants", 3),
      policyReviewCategory("github_installations", 4),
      readyCategory("webhook_deliveries", 5),
      policyReviewCategory("analysis_jobs", 6),
      policyReviewCategory("audit_events", 7),
      policyReviewCategory("usage_records", 8)
    ]);
    const countCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "HEAD");
    expect(countCalls).toHaveLength(7);
    for (const [, init] of countCalls) {
      expect(init?.method).toBe("HEAD");
      expect(new Headers(init?.headers).get("Prefer")).toBe("count=exact");
      expect(new Headers(init?.headers).get("Range")).toBe("0-0");
      expect(init?.body).toBeUndefined();
    }
    expect(urls.join("\n")).toContain("tenant_id=eq.tenant_a");
    for (const href of urls) {
      const selected = new URL(href).searchParams.get("select") ?? "";
      expect(selected).not.toContain("report");
      expect(selected).not.toContain("metadata");
      expect(selected).not.toContain("repository_full_name");
      expect(selected).not.toContain("installation_id");
      expect(selected).not.toContain("account_login");
      expect(selected).not.toContain("account_id");
      expect(selected).not.toContain("pull_request_url");
      expect(selected).not.toContain("error_summary");
      expect(selected).not.toContain("delivery_id");
      expect(selected).not.toContain("idempotency_key_hash");
    }
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("saved_reports_test");
    expect(serialized).not.toContain("tenant_grants_test");
    expect(serialized).not.toContain("github_installations_test");
    expect(serialized).not.toContain("webhook_deliveries_test");
    expect(serialized).not.toContain("analysis_jobs_test");
    expect(serialized).not.toContain("audit_events_test");
    expect(serialized).not.toContain("usage_records_test");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("durable");
    expect(serialized).not.toContain("configured");
  });

  it("marks env-backed repository grants for manual review", async () => {
    stubTenantAccess();
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true
      }
    ]));

    const response = await GET(new Request("http://localhost/api/tenants/deletion-preview?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.categories).toEqual(expect.arrayContaining([
      {
        key: "repository_grants",
        status: "manual_review_required",
        count: 1,
        reason: "manual-removal-required"
      }
    ]));
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("env");
  });
});

function readyCategory(key: string, count: number) {
  return {
    key,
    status: "ready",
    count
  };
}

function policyReviewCategory(key: string, count: number) {
  return {
    key,
    status: "manual_review_required",
    count,
    reason: "policy-review-required"
  };
}

function policyBlockedCategory(key: string, count: number) {
  return {
    key,
    status: "manual_review_required",
    count,
    reason: "policy-blocked"
  };
}

function expectedRetentionPolicy() {
  return {
    status: "draft",
    version: TENANT_DATA_RETENTION_POLICY.version,
    note: "Review the documented retention policy before destructive deletion.",
      coverage: {
      countedCategories: [
        "saved_reports",
        "repository_grants",
        "github_installations",
        "webhook_deliveries",
        "analysis_jobs",
        "audit_events",
        "usage_records"
      ],
      uncountedCategories: [
        { key: "transient_pr_evidence", reason: "not-stored" },
        { key: "onboarding_states", reason: "not-yet-counted" },
        { key: "concierge_analysis_runs", reason: "not-yet-counted" },
        { key: "concierge_feedback", reason: "not-yet-counted" },
        { key: "account_member_records", reason: "not-yet-counted" },
        { key: "billing_account_records", reason: "not-yet-counted" },
        { key: "backups", reason: "not-yet-counted" },
        { key: "tenant_tombstones", reason: "not-yet-counted" }
      ],
      totalCategories: TENANT_DATA_RETENTION_POLICY.categories.length
    },
    deletionPlan: getTenantRetentionDeletionPlan()
  };
}

function stubTenantAccess() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" },
    { tenantId: "tenant_b", token: "tenant-b-invite-token" }
  ]));
}

function stubMemoryStores() {
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
    { tenantId: "tenant_a", monthlyAnalysisLimit: 10, enabled: true, plan: "team" },
    { tenantId: "tenant_b", monthlyAnalysisLimit: 10, enabled: true, plan: "team" }
  ]));
}

function stubSupabaseStores() {
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://reports.supabase.co");
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_REPORTS_TABLE", "saved_reports_test");
  vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL", "https://webhook.supabase.co");
  vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE", "webhook_deliveries_test");
  vi.stubEnv("AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "https://grants.supabase.co");
  vi.stubEnv("AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE", "tenant_grants_test");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://installations.supabase.co");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_TABLE", "github_installations_test");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://jobs.supabase.co");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
  vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://audit.supabase.co");
  vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
  vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_USAGE_SUPABASE_URL", "https://usage.supabase.co");
  vi.stubEnv("AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_USAGE_RECORDS_TABLE", "usage_records_test");
}

async function seedTenantData(tenantId: string) {
  const report = generateVerificationReport(demoScenarios["scope-creep"]);
  report.source.url = `https://github.com/RengGyu/AgentProof/pull/${tenantId === "tenant_a" ? 7 : 8}`;
  report.summary.topRisks.push("Patch excerpt with github_pat_secret_should_not_leak_1234567890");
  await createSavedReport(report, { tenantId });
  await createTenantRepositoryGrant({
    tenantId,
    installationId: tenantId === "tenant_a" ? 321 : 654,
    repositoryId: tenantId === "tenant_a" ? 100 : 200,
    repositoryFullName: tenantId === "tenant_a" ? "RengGyu/AgentProof" : "RengGyu/OtherRepo",
    enabled: true,
    analysisEnabled: true
  });
  await upsertTenantGitHubInstallation({
    tenantId,
    installationId: tenantId === "tenant_a" ? 321 : 654,
    accountId: tenantId === "tenant_a" ? 1001 : 1002,
    accountLogin: tenantId === "tenant_a" ? "RengGyu" : "OtherOwner",
    accountType: "User"
  });
  await enqueueAnalysisJob({
    tenantId,
    idempotencyKey: `raw-idempotency-key-${tenantId}`,
    deliveryId: tenantId === "tenant_a"
      ? "123e4567-e89b-12d3-a456-426614174300"
      : "123e4567-e89b-12d3-a456-426614174399",
    event: "pull_request",
    action: "synchronize",
    installationId: tenantId === "tenant_a" ? 321 : 654,
    repositoryId: tenantId === "tenant_a" ? 100 : 200,
    repositoryFullName: tenantId === "tenant_a" ? "RengGyu/AgentProof" : "RengGyu/OtherRepo",
    pullRequestNumber: tenantId === "tenant_a" ? 7 : 8,
    pullRequestUrl: tenantId === "tenant_a"
      ? "https://github.com/RengGyu/AgentProof/pull/7"
      : "https://github.com/RengGyu/OtherRepo/pull/8",
    headSha: tenantId === "tenant_a" ? "abc123" : "def456",
    saveReport: true,
    comment: false,
    now: new Date("2026-06-30T00:00:00Z")
  });
  markGitHubWebhookDelivery(`webhook-${tenantId}`, Date.parse("2026-06-30T00:00:00Z"), tenantId);
  await recordAuditEvent({
    action: "github_app_analysis_completed",
    result: "completed",
    tenantId,
    repositoryFullName: tenantId === "tenant_a" ? "RengGyu/AgentProof" : "RengGyu/OtherRepo",
    installationId: tenantId === "tenant_a" ? 321 : 654,
    pullRequestNumber: tenantId === "tenant_a" ? 7 : 8,
    headSha: tenantId === "tenant_a" ? "abc123" : "def456",
    githubDeliveryId: tenantId === "tenant_a"
      ? "123e4567-e89b-12d3-a456-426614174300"
      : "123e4567-e89b-12d3-a456-426614174399",
    statusCode: 200,
    priority: "medium",
    evidenceCoverage: 50
  });
  await reserveUsageQuota({
    tenantId,
    feature: "github_app_analysis",
    idempotencyKey: `usage-${tenantId}`
  });
}
