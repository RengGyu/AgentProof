import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./report-code";
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember, revokeTenantAuthSession } from "@/lib/tenant-auth";
import { clearTenantRepositoryGrantsForTests, createTenantRepositoryGrant, PRIVATE_ANALYSIS_CONSENT_VERSION } from "@/lib/tenant-control-plane";
import { clearTenantGitHubInstallationsForTests, upsertTenantGitHubInstallation } from "@/lib/github-installations";
import { clearSavedReportsForTests, createSavedReport, createVerifiedSavedReport } from "@/lib/server-report-store";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "@/lib/verifier";
import { demoScenarios } from "@/lib/sample-data";

const head = "a".repeat(40), base = "b".repeat(40), path = "src/reset.ts";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const tenant = "code_reader", member = "github:123";
let cookie: string, id: string, report: ReturnType<typeof generateVerificationReport>;
let contents: Record<string, unknown>, repo: Record<string, unknown>, requests: string[], beforeRead: (() => Promise<unknown>) | undefined;
let tokenCount: number;
const grant = { tenantId: tenant, installationId: 42, repositoryId: 9, repositoryFullName: "owner/repo", enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false, repositoryPrivate: true, privateAnalysisConsentVersion: PRIVATE_ANALYSIS_CONSENT_VERSION };
const identity = { tenantId: tenant, installationId: 42, repositoryId: 9, pullRequestNumber: 7, headSha: head };
function request(query = `reportId=${id}&reference=code:25`, session = cookie) { return GET(new Request(`http://localhost/api/dashboard/report-code?${query}`, { headers: { cookie: session } })); }
async function save() { id = (await createVerifiedSavedReport(report, identity)).id; }
beforeEach(async () => {
  clearSavedReportsForTests(); clearTenantAuthSessionsForTests(); clearTenantRepositoryGrantsForTests(); clearTenantGitHubInstallationsForTests();
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([tenant, "other"].map(tenantId => ({ tenantId, name: "Fixture", status: "active", plan: "beta", members: [{ memberId: member, role: "owner", status: "active" }] }))));
  vi.stubEnv("GITHUB_APP_ID", "42"); vi.stubEnv("GITHUB_PRIVATE_KEY", key);
  await createTenantRepositoryGrant(grant);
  await upsertTenantGitHubInstallation({ tenantId: tenant, installationId: 42, status: "active" });
  cookie = (await createTenantAuthSessionForMember({ tenantId: tenant, memberId: member })).sessionCookie;
  report = generateVerificationReport(demoScenarios.clean);
  report.evidenceIndex.unshift({ id: "code", kind: "diff", label: path, locator: path, confidence: 1, summary: "Changed file.", codeLocation: { path, side: "head", revisionSha: head, line: 25 } });
  await save();
  const source = Array.from({ length: 100 }, (_, n) => n === 24 ? 'const api_key = "secret-private-value";' : `const line${n + 1} = ${n + 1};`).join("\n");
  contents = { type: "file", encoding: "base64", path, size: Buffer.byteLength(source), content: Buffer.from(source).toString("base64") };
  repo = { id: 9, full_name: "owner/repo", private: true };
  requests = []; tokenCount = 0; beforeRead = undefined;
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input); requests.push(url);
    if (url.endsWith("/access_tokens")) { tokenCount++; return Response.json({ token: "test-installation-token" }); }
    if (url === "https://api.github.com/repositories/9") return Response.json(repo);
    if (url.startsWith("https://api.github.com/repos/owner/repo/contents/")) { await beforeRead?.(); return Response.json(contents); }
    throw new Error("Unexpected test network request");
  }));
});
afterEach(() => { clearSavedReportsForTests(); clearTenantAuthSessionsForTests(); clearTenantRepositoryGrantsForTests(); clearTenantGitHubInstallationsForTests(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("reads only the saved exact revision and returns a bounded, line-preserving, redacted code excerpt", async () => {
  const response = await request(); const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(body).toMatchObject({ path, revision: head, reference: "code:25", focusLine: 25, totalLines: 100 });
  expect(body.lines.length).toBeLessThanOrEqual(80);
  expect(body.lines.find((line: { number: number }) => line.number === 25).text).toContain("[redacted]");
  expect(JSON.stringify(body)).not.toMatch(/secret-private-value|test-installation-token|base64/);
  expect(requests).toContain(`https://api.github.com/repos/owner/repo/contents/src/reset.ts?ref=${head}`);
  expect(requests.some(url => /pulls|compare|\/main(?:\?|$)/.test(url))).toBe(false);
});
it("keeps explicit removed-file references pinned to their recorded base revision", async () => {
  report.evidenceIndex[0].codeLocation = { path, side: "base", revisionSha: base, line: 25 }; await save();
  expect((await request()).status).toBe(200);
  expect(requests).toContain(`https://api.github.com/repos/owner/repo/contents/src/reset.ts?ref=${base}`);
});
it.each(["src/reset.ts", "src/app/(auth)/reports/[id]/page.tsx"])("resolves a saved ordinary-PR navigation artifact at its exact revision: %s", async artifactPath => {
  const ordinary = generateVerificationReportV2FromInput(demoScenarios.clean);
  const artifactId = `read_${"c".repeat(24)}`;
  ordinary.reviewCandidates = { version: 1, requirements: ordinary.requirements.map(row => ({ requirementId: row.requirementId, sourceHash: "d".repeat(64), candidates: [] })), navigation: {
    version: 1, model: "fixture", state: "ranked", repository: "owner/repo", headSha: head, baseSha: base,
    sources: [{ id: "description", authority: "pr_author_claim", hash: "d".repeat(64), length: 30, processedLength: 30, url: null }],
    goals: [{ id: "goal_1", summary: "Handle expired links", emphasis: "primary", authority: "pr_author_claim", sourceRefs: [{ sourceId: "description", start: 0, end: 20, hash: "e".repeat(64) }], facets: [], openQuestions: [], uncertainty: [], firstInspection: artifactId, candidates: [{ artifactId, relevance: "relevant", whyInspect: "Inspect the expiry branch.", reviewQuestion: "Does it reject expiry?", uncertainty: "Behavior is not verified." }] }],
    artifacts: [{ id: artifactId, path: artifactPath, revision: head, side: "head", startLine: 25, endLine: 26, hash: "f".repeat(64), kind: "code", origin: "diff" }],
    unprocessed: [], limitations: []
  } };
  report = ordinary; await save(); contents.path = artifactPath;
  const response = await request(`reportId=${id}&reference=${artifactId}:25`);
  expect(response.status, await response.clone().text()).toBe(200);
  expect(await response.json()).toMatchObject({ path: artifactPath, revision: head, focusLine: 25 });
});
it("never uses imported tenant reports as code-reading authority", async () => {
  id = (await createSavedReport(report, identity)).id;
  expect((await request()).status).toBe(404); expect(requests).toEqual([]);
});
it("rejects caller-selected paths, URLs, revisions and unrecorded lines before GitHub", async () => {
  for (const query of [`reportId=${id}&reference=code:26`, `reportId=${id}&reference=unknown:25`, `reportId=${id}&reference=code:25&path=private.env`, `reportId=${id}&reference=code:25&url=https://evil.invalid`, `reportId=${id}&reference=code:25&revision=${base}`]) {
    expect((await request(query)).status).toBeGreaterThanOrEqual(400);
  }
  expect(requests).toEqual([]);
});
it("denies unsigned, other-tenant, and public/share-token reads before GitHub", async () => {
  expect((await request(undefined, "")).status).toBe(401);
  const other = (await createTenantAuthSessionForMember({ tenantId: "other", memberId: member })).sessionCookie;
  expect((await request(undefined, other)).status).toBe(404);
  const shared = await createSavedReport(report);
  expect((await request(`reportId=${shared.id}&reference=code:25&key=${shared.accessToken}`, "")).status).toBeGreaterThanOrEqual(400);
  expect((await request(`reportId=${shared.id}&reference=code:25`)).status).toBe(404);
  expect(requests).toEqual([]);
});
it("rejects missing or conflicting immutable location metadata", async () => {
  report.evidenceIndex[0].codeLocation!.revisionSha = base; await save();
  expect((await request()).status).toBe(404);
  delete report.evidenceIndex[0].codeLocation; await save();
  expect((await request()).status).toBe(404);
  expect(requests).toEqual([]);
});
it.each(["disabled", "no-consent", "analysis-off", "suspended"])("denies %s access before reading code", async state => {
  if (state === "suspended") await upsertTenantGitHubInstallation({ tenantId: tenant, installationId: 42, status: "suspended" });
  else await createTenantRepositoryGrant({ ...grant, ...(state === "disabled" ? { enabled: false } : state === "analysis-off" ? { analysisEnabled: false } : { privateAnalysisConsentVersion: null }) });
  expect((await request()).status).toBe(403);
  expect(tokenCount).toBe(0);
});
it.each([{ id: 99 }, { full_name: "other/repo" }, { private: false }, { private: undefined }])("denies changed repository identity or visibility %j", async change => {
  repo = { ...repo, ...change };
  expect((await request()).status).toBe(403);
  expect(requests.some(url => url.includes("/contents/"))).toBe(false);
});
it("does not release code if the session or grant is revoked during the read", async () => {
  beforeRead = () => revokeTenantAuthSession({ cookieHeader: cookie });
  expect((await request()).status).toBe(401);
  cookie = (await createTenantAuthSessionForMember({ tenantId: tenant, memberId: member })).sessionCookie;
  beforeRead = () => createTenantRepositoryGrant({ ...grant, enabled: false });
  const response = await request(); expect(response.status).toBe(403); expect(await response.text()).not.toContain("const line");
});
it.each([
  { type: "symlink" }, { submodule_git_url: "https://elsewhere.invalid" }, { size: 200_000 },
  { path: "different.ts" }, { content: Buffer.from([0, 255, 0]).toString("base64"), size: 3 },
  { content: "a".repeat(500_000) }
])("handles unavailable, binary and oversized content honestly (case %#)", async change => {
  contents = { ...contents, ...change };
  const response = await request(); expect(response.status).toBeGreaterThanOrEqual(400);
  expect(await response.text()).not.toMatch(/not implemented|secret-private-value/);
});
it("reports an empty referenced file without inventing missing implementation", async () => {
  contents = { ...contents, content: "", size: 0 };
  const response = await request(); const body = await response.json();
  expect(response.status).toBe(200); expect(body.lines).toEqual([]); expect(body.totalLines).toBe(0);
});
