import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET, POST } from "./activity";
import { createTenantAuthSessionForMember, clearTenantAuthSessionsForTests } from "@/lib/tenant-auth";
import { createVerifiedSavedReport, getSavedReport, clearSavedReportsForTests } from "@/lib/server-report-store";
import { generateVerificationReport } from "@/lib/verifier";
import { demoScenarios } from "@/lib/sample-data";
import { enqueueAnalysisJob, listTenantAnalysisJobs, clearAnalysisJobsForTests } from "@/lib/analysis-jobs";

const now = new Date("2026-10-02T00:00:00.000Z");
let cutoff: Map<string, string>, calls: Array<{ url: string; method: string }>, cookie: string, otherCookie: string, memberCookie: string, failWrite: boolean;
const report = generateVerificationReport(demoScenarios.clean);
const identity = { tenantId: "tenant_a", installationId: 42, repositoryId: 9, pullRequestNumber: 7, headSha: "a".repeat(40) };
function request(method = "GET", body = "{}", session = cookie, origin = "http://localhost") {
  return new Request("http://localhost/api/dashboard/activity", { method, headers: { cookie: session, origin, "x-agentproof-csrf": "same-origin" }, ...(method === "POST" ? { body } : {}) });
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  cutoff = new Map(); calls = []; failWrite = false;
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true"); vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL", "https://accounts.invalid");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY", "test-account-key");
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input); const method = init?.method ?? "GET"; calls.push({ url: String(url), method });
    if (url.pathname.endsWith("/rpc/agentproof_dismiss_inbox")) {
      if (failWrite) return Response.json({}, { status: 503 });
      const body = JSON.parse(String(init?.body));
      const key = `${body.p_tenant_id}:${body.p_member_id}`;
      cutoff.set(key, new Date().toISOString());
      return Response.json([{ dismissed_through: cutoff.get(key) }]);
    }
    const tenant = url.searchParams.get("tenant_id")?.slice(3);
    if (url.pathname.endsWith("/agentproof_tenants")) return Response.json([{ tenant_id: tenant, name: "Fixture", status: "active", plan: "beta" }]);
    if (url.pathname.endsWith("/agentproof_tenant_members")) {
      const members = ["github:1", "github:2"];
      const selected = url.searchParams.get("member_id")?.slice(3);
      return Response.json(members.filter(m => !selected || m === selected).map(member => ({ tenant_id: tenant, member_id: member, role: "owner", status: "active", inbox_dismissed_through: cutoff.get(`${tenant}:${member}`) ?? null })));
    }
    throw new Error("Unexpected test network URL");
  }));
  cookie = (await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" })).sessionCookie;
  otherCookie = (await createTenantAuthSessionForMember({ tenantId: "tenant_b", memberId: "github:1" })).sessionCookie;
  memberCookie = (await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:2" })).sessionCookie;
});
afterEach(() => { clearTenantAuthSessionsForTests(); clearSavedReportsForTests(); clearAnalysisJobsForTests(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("clears account inbox metadata across sessions without deleting reports/jobs, while retaining future events", async () => {
  const saved = await createVerifiedSavedReport(report, identity);
  const queued = await enqueueAnalysisJob({ ...identity, idempotencyKey: "inbox-job", deliveryId: "123e4567-e89b-12d3-a456-426614174000", event: "pull_request", action: "opened", repositoryFullName: "owner/repo", pullRequestUrl: "https://github.com/owner/repo/pull/8", pullRequestNumber: 8, saveReport: true, comment: false });
  expect((await (await GET(request())).json()).activity.length).toBeGreaterThan(0);
  const response = await POST(request("POST"));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ dismissedThrough: now.toISOString() });
  const secondSession = (await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" })).sessionCookie;
  expect((await (await GET(request("GET", "", secondSession))).json()).activity).toEqual([]);
  expect(await getSavedReport(saved.id, { tenantId: "tenant_a" })).not.toBeNull();
  expect((await listTenantAnalysisJobs({ tenantId: "tenant_a" })).some(job => job.id === queued.id)).toBe(true);
  vi.setSystemTime(new Date(now.getTime() + 1000));
  const newer = await createVerifiedSavedReport(report, { ...identity, pullRequestNumber: 9 });
  const fresh = await (await GET(request())).json();
  expect(fresh.activity).toEqual([expect.objectContaining({ reportId: newer.id })]);
  expect(calls.some(call => call.method === "DELETE")).toBe(false);
});
it("isolates dismissal by both account member and tenant", async () => {
  await createVerifiedSavedReport(report, identity);
  await createVerifiedSavedReport(report, { ...identity, tenantId: "tenant_b" });
  expect((await POST(request("POST"))).status).toBe(200);
  expect((await (await GET(request("GET", "", memberCookie))).json()).activity).toHaveLength(1);
  expect((await (await GET(request("GET", "", otherCookie))).json()).activity).toHaveLength(1);
});
it("does not accept caller-selected tenants, members or future cutoff timestamps", async () => {
  for (const body of [{ tenantId: "tenant_b" }, { memberId: "github:2" }, { dismissedThrough: "2099-01-01T00:00:00Z" }]) expect((await POST(request("POST", JSON.stringify(body)))).status).toBe(400);
  expect(cutoff.size).toBe(0);
});
it("requires authentication and same-origin mutation protection", async () => {
  expect((await POST(request("POST", "{}", ""))).status).toBe(401);
  expect((await POST(request("POST", "{}", cookie, "https://evil.invalid"))).status).toBe(403);
  expect(cutoff.size).toBe(0);
});
it("preserves visible activity after a persistence failure and permits retry", async () => {
  await createVerifiedSavedReport(report, identity); failWrite = true;
  expect((await POST(request("POST"))).status).toBe(503);
  expect((await (await GET(request())).json()).activity).toHaveLength(1);
  failWrite = false; expect((await POST(request("POST"))).status).toBe(200);
  expect((await (await GET(request())).json()).activity).toEqual([]);
});
it("fails the inbox read honestly when persisted dismissal state cannot be read", async () => {
  const fetch = vi.mocked(globalThis.fetch);
  const normal = fetch.getMockImplementation()!;
  fetch.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.searchParams.get("select") === "inbox_dismissed_through") throw new Error("private upstream diagnostics");
    return normal(input, init);
  });
  const response = await GET(request());
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("private upstream diagnostics");
});
