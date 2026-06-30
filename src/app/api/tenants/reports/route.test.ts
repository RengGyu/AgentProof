import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearSavedReportsForTests, createSavedReport } from "@/lib/server-report-store";
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
      truncated: false,
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
    expect(json.truncated).toBe(true);
    expect(json.reports).toHaveLength(2);
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
