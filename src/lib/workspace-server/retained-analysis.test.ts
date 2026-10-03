import { generateKeyPairSync } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { POST } from "./analyze";
import { GET } from "./reports";
import { createTenantAuthSessionForMember, clearTenantAuthSessionsForTests, revokeTenantAuthSession } from "../tenant-auth";
import { upsertTenantGitHubInstallation, clearTenantGitHubInstallationsForTests } from "../github-installations";
import { getSavedReport } from "../server-report-store";
import { createTenantRepositoryGrant, clearTenantRepositoryGrantsForTests } from "../tenant-control-plane";

const tenantId = "tenant_workspace";
const url = "https://github.com/owner/repo/pull/7";
const head = "a".repeat(40);
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
let cookie: string;
let rows: any[];
let failSave: boolean;
let failGitHub: boolean;
let beforeSave: (() => Promise<void>) | undefined;
let calls: string[];
const request = (body: unknown = { prUrl: url }, headers: Record<string, string> = {}) => new Request("http://localhost/api/dashboard/analyze", {
  method: "POST", headers: { origin: "http://localhost", cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(body)
});
const generate = (req = request()) => POST(req, "web", { retainReport: true });

beforeEach(async () => {
  rows = []; failSave = false; failGitHub = false; beforeSave = undefined; calls = [];
  for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_ONBOARDING_SUPABASE_URL", "AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY"]) vi.stubEnv(name, "");
  vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", "disabled");
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://store.invalid");
  vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "test-key");
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{ tenantId, name: "Fixture", status: "active", plan: "beta", members: [{ memberId: "github:123", role: "owner", status: "active" }] }]));
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  await createTenantRepositoryGrant({ tenantId, installationId: 42, repositoryId: 9, repositoryFullName: "owner/repo", enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false, repositoryPrivate: false });
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
  vi.stubEnv("GITHUB_APP_ID", "42"); vi.stubEnv("GITHUB_PRIVATE_KEY", key);
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "false");
  await upsertTenantGitHubInstallation({ tenantId, installationId: 42, status: "active" });
  cookie = (await createTenantAuthSessionForMember({ tenantId, memberId: "github:123" })).sessionCookie;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const target = String(input); calls.push(target);
    if (target.includes("/rpc/agentproof_store_tenant_report")) {
      if (failSave) return Response.json({}, { status: 503 });
      const p = JSON.parse(String(init?.body));
      const row = Object.fromEntries(Object.entries(p).map(([k,v])=>[k.slice(2),v]));
      rows = [{ ...row, stale_at: null }, ...rows.map(old=>({ ...old, stale_at: p.p_created_at }))];
      return Response.json([rows[0]]);
    }
    if (target.startsWith("https://store.invalid/rest/v1/agentproof_saved_reports")) {
      const params = new URL(target).searchParams;
      const found = rows.filter(row=>["id", "tenant_id", "repository_id", "pull_request_number"].every(k=>!params.has(k)||params.get(k)===`eq.${row[k]}`));
      return Response.json(found.slice(Number(params.get("offset")??0), Number(params.get("offset")??0)+Number(params.get("limit")??100)));
    }
    if (target.endsWith("/access_tokens")) return Response.json({ token: "fixture-installation-token" });
    if (target === "https://api.github.com/repos/owner/repo") return Response.json({ id: 9, private: false });
    if (target.endsWith("/pulls/7")) {
      if (failGitHub) return Response.json({}, { status: 503 });
      await beforeSave?.();
      return Response.json({ number: 7, title: "Fixture PR", body: "Internal maintenance", html_url: url, base: { ref: "main", sha: "b".repeat(40), repo: { private: false } }, head: { ref: "work", sha: head } });
    }
    if (target.includes("/pulls/7/files")) return Response.json([]);
    if (target.includes("/check-runs")) return Response.json({ check_runs: [], total_count: 0 });
    if (target.endsWith("/status")) return Response.json({ statuses: [] });
    throw new Error(`Unexpected mocked network URL: ${target}`);
  }));
});
afterEach(() => { clearTenantAuthSessionsForTests(); clearTenantGitHubInstallationsForTests(); clearTenantRepositoryGrantsForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("automatically fetches the URL's current head, saves a sanitized version, and reopens it through the tenant API", async () => {
  const response = await generate();
  const body = await response.json();
  expect(response.status, JSON.stringify({ body, calls })).toBe(200);
  expect(body.persistence).toMatchObject({ status: "saved", id: expect.any(String) });
  expect(body.target).toEqual({ repositoryId: 9, pullRequestNumber: 7, headSha: head });
  expect(rows[0]).toMatchObject({ tenant_id: tenantId, repository_id: 9, pull_request_number: 7, head_sha: head, expires_at: null });
  expect(JSON.stringify(rows)).not.toContain("fixture-installation-token");
  expect(JSON.stringify(rows)).not.toContain("Internal maintenance");
  const detail = await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`, { headers: { cookie } }));
  const reopened = await detail.json();
  expect(reopened).toMatchObject({ report: { reportSchemaVersion: "verification-report.v2", testing: body.report.testing }, repositoryId: 9, pullRequestNumber: 7, headSha: head });
  expect(body.report.source.url).toBeUndefined();
  expect(body.report.source.provenance).toMatchObject({ origin: "github_snapshot", headSha: head });
  expect(await getSavedReport(body.persistence.id, { tenantId: "other" })).toBeNull();
  const again = await generate();
  expect((await again.json()).persistence.id).not.toBe(body.persistence.id);
  expect(rows).toHaveLength(2);
});
it("does not label a storage failure Saved and leaves the previous version readable", async () => {
  const first = await generate(); const saved = (await first.json()).persistence;
  failSave = true;
  const response = await generate(); const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.report).toBeTruthy();
  expect(body.persistence).toMatchObject({ status: "failed" });
  expect(body.persistence.id).toBeUndefined();
  expect(rows).toHaveLength(1);
  expect(await getSavedReport(saved.id, { tenantId })).not.toBeNull();
  failSave = false;
  expect((await (await generate()).json()).persistence.status).toBe("saved");
});
it("retains the previous report on GitHub failure and permits retry", async () => {
  await generate(); failGitHub = true;
  expect((await generate()).status).toBe(400);
  expect(rows).toHaveLength(1);
  failGitHub = false;
  expect((await (await generate()).json()).persistence.status).toBe("saved");
});
it.each([{}, { prUrl: url, demoScenario: "clean" }, { prUrl: url, logs: "invented" }])("rejects nonautomatic workspace input %j", async body => {
  expect((await generate(request(body))).status).toBe(400);
  expect(rows).toHaveLength(0);
  expect(calls).toHaveLength(0);
});
it("keeps session and CSRF gates before network or saving", async () => {
  expect((await generate(request(undefined, { cookie: "" }))).status).toBe(401);
  expect((await generate(request(undefined, { origin: "https://attacker.invalid" }))).status).toBe(403);
  expect(calls).toHaveLength(0);
});
it("rechecks the session after analysis before retaining a report", async () => {
  beforeSave = async () => { await revokeTenantAuthSession({ cookieHeader: cookie }); };
  const body = await (await generate()).json();
  expect(body.persistence?.status).not.toBe("saved");
  expect(rows).toHaveLength(0);
});
it("lists PR history including prior versions with explicit pagination rather than a current-only filter", async () => {
  await generate(); await generate();
  const response = await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=9&scope=history", { headers: { cookie } }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.reports).toHaveLength(2);
  expect(body.hasMore).toBe(false);
  expect(body.reports.every((r: any) => r.availability === "available")).toBe(true);
  expect(body.reports.some((r: any) => r.freshness === "stale")).toBe(true);
});
