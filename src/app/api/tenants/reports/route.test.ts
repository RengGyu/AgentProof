import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearSavedReportsForTests, createSavedReport } from "@/lib/server-report-store";
import { sanitizeReportForShare } from "@/lib/report-share";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { GET } from "./route";

describe("GET /api/tenants/reports", () => {
  afterEach(() => {
    clearSavedReportsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires a tenant-bound invite token before reading saved report summaries", async () => {
    stubInviteEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" }
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant saved reports require a valid tenant-bound invite token.",
      code: "tenant_reports_unauthorized"
    });
  });

  it("returns summary-only saved reports for the authorized tenant only", async () => {
    stubInviteEnv();
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.url = "https://github.com/RengGyu/AgentProof/pull/27?key=secret_should_not_leak";
    await createSavedReport(report, { tenantId: "tenant_a" });
    const otherTenantReport = generateVerificationReport(demoScenarios.clean);
    otherTenantReport.source.title = "Tenant B private report should not leak";
    otherTenantReport.source.url = "https://github.com/RengGyu/OtherRepo/pull/99";
    await createSavedReport(otherTenantReport, { tenantId: "tenant_b" });

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a&limit=100", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      reports: [
        expect.objectContaining({
          sourceUrl: "https://github.com/RengGyu/AgentProof/pull/27",
          privacy: "summary-only",
          priority: expect.any(String),
          evidenceCoverage: expect.any(Number),
          requirementCounts: expect.objectContaining({
            met: expect.any(Number),
            partial: expect.any(Number),
            missing: expect.any(Number),
            unclear: expect.any(Number)
          })
        })
      ],
      count: 1,
      limit: 25,
      truncated: false,
      filters: {
        priority: "all",
        status: "all"
      },
      filterBasis: "tenant_recent_summary",
      privacy: "saved-report-summary-only",
      next: "review_recent_reports"
    });
    expect(serialized).not.toContain("Tenant B private report should not leak");
    expect(serialized).not.toContain("OtherRepo");
    expect(serialized).not.toContain("tenant_id");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("?key=");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("access_token_hash");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("returns summary-only saved reports with a tenant admin session cookie", async () => {
    stubInviteEnv();
    await createSavedReport(generateVerificationReport(demoScenarios.clean), { tenantId: "tenant_a" });
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "saved-report-summary-only",
      count: 1
    });
  });

  it("marks saved report summaries as truncated when more rows exist than the requested limit", async () => {
    stubInviteEnv();
    for (let index = 0; index < 3; index += 1) {
      await createSavedReport(generateVerificationReport(demoScenarios.clean), { tenantId: "tenant_a" });
    }

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a&limit=2", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.count).toBe(2);
    expect(json.limit).toBe(2);
    expect(json.truncated).toBe(true);
    expect(json.reports).toHaveLength(2);
  });

  it("filters saved reports over summary-only fields without exposing report bodies", async () => {
    stubInviteEnv();
    const matchingReport = generateVerificationReport(demoScenarios["scope-creep"]);
    matchingReport.source.title = "AgentProof payment setup verification";
    matchingReport.source.url = "https://github.com/RengGyu/AgentProof/pull/27?key=secret_should_not_leak";
    matchingReport.summary.priority = "high";
    matchingReport.summary.evidenceCoverage = 42;
    matchingReport.testing.missingTests = [{ path: "src/app/api/billing/route.ts", why: "No quota test", evidenceRefs: [] }];
    const otherReport = generateVerificationReport(demoScenarios.clean);
    otherReport.source.title = "Unrelated summary should not match";
    otherReport.source.url = "https://github.com/RengGyu/OtherRepo/pull/99";
    otherReport.summary.priority = "low";
    otherReport.summary.evidenceCoverage = 95;
    otherReport.testing.missingTests = [];
    await createSavedReport(matchingReport, { tenantId: "tenant_a" });
    await createSavedReport(otherReport, { tenantId: "tenant_a" });

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a&priority=high&status=missing_tests&query=AgentProof%20key%3Dsecret_should_not_leak", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      count: 1,
      limit: 10,
      truncated: false,
      filters: {
        priority: "high",
        status: "missing_tests",
        query: "AgentProof redacted"
      },
      filterBasis: "tenant_recent_summary_sample",
      privacy: "saved-report-summary-only"
    });
    expect(json.reports).toEqual([
      expect.objectContaining({
        sourceTitle: "AgentProof payment setup verification",
        sourceUrl: "https://github.com/RengGyu/AgentProof/pull/27",
        priority: "high",
        testing: expect.objectContaining({
          missingTestCount: 1
        })
      })
    ]);
    expect(serialized).not.toContain("Unrelated summary should not match");
    expect(serialized).not.toContain("OtherRepo");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("?key=");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("src/app/api/billing/route.ts");
  });

  it("uses a bounded Supabase candidate window for filtered summary report search", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_REPORTS_TABLE", "saved_reports_test");
    const report = sanitizeReportForShare(generateVerificationReport(demoScenarios.clean));
    report.source.title = "AgentProof saved summary";
    report.summary.priority = "high";
    const row = {
      id: "tenant_report",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      tenant_id: "tenant_a",
      access_token_hash: "a".repeat(64),
      report
    };
    const fetchMock = vi.fn(async () => Response.json([row]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a&priority=high&query=AgentProof", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string | URL | Request, RequestInit | undefined];
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.count).toBe(1);
    expect(json.filterBasis).toBe("tenant_recent_summary_sample");
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).toContain("expires_at=gt.");
    expect(String(url)).toContain("select=id%2Ccreated_at%2Cexpires_at%2Creport%2Ctenant_id");
    expect(String(url)).toContain("limit=101");
    expect(String(url)).not.toContain("service-role-secret");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("saved_reports_test");
    expect(serialized).not.toContain("access_token_hash");
  });

  it("fails closed when saved report storage is unavailable", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));

    const response = await GET(new Request("http://localhost/api/tenants/reports?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant saved reports are unavailable.",
      code: "tenant_reports_unavailable"
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
