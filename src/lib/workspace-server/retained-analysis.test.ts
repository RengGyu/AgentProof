import {POST as receiveClientDiagnostic} from './analysis-client-diagnostics';
import {purposeRuntimeFetch} from '../test-support/purpose-runtime-fixture';
import { createHash, generateKeyPairSync } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { POST } from "./analyze";
import { GET } from "./reports";
import { createTenantAuthSessionForMember, clearTenantAuthSessionsForTests, revokeTenantAuthSession } from "../tenant-auth";
import { upsertTenantGitHubInstallation, clearTenantGitHubInstallationsForTests } from "../github-installations";
import { getSavedReport } from "../server-report-store";
import { createTenantRepositoryGrant, clearTenantRepositoryGrantsForTests, PRIVATE_ANALYSIS_CONSENT_VERSION } from "../tenant-control-plane";



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
let privateFixture: boolean;
let grantRevoked: boolean;
let saveDisabled: boolean;
let reportLanguage: "en"|"ko";
let sessionSource: "github"|"mobile";
const request = (body: unknown = { prUrl: url }, headers: Record<string, string> = {}) => new Request("http://localhost/api/dashboard/analyze", {
  method: "POST", headers: { origin: "http://localhost", cookie, "content-type": "application/json", ...headers }, body: JSON.stringify(body)
});
const generate = (req = request()) => POST(req, "web", { retainReport: true });

beforeEach(async () => {
  sessionSource = "github"; reportLanguage = "en"; rows = []; failSave = false; failGitHub = false; beforeSave = undefined; calls = []; privateFixture = false; grantRevoked = false; saveDisabled = false;
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
    if (target === "https://api.github.com/repos/owner/repo") return Response.json({ id: 9, private: privateFixture });
    if (target.endsWith("/pulls/7")) {
      if (failGitHub) return Response.json({}, { status: 503 });
      await beforeSave?.();
      return Response.json({ number: 7, url: "https://api.github.com/repos/owner/repo/pulls/7", title: "Fixture PR", body: "Internal maintenance", html_url: url, base: { ref: "main", sha: "b".repeat(40), repo: { private: privateFixture } }, head: { ref: "work", sha: head } });
    }
    if (target.includes("/pulls/7/files")) return Response.json([]);
    if (target.includes("/check-runs")) return Response.json({ check_runs: [], total_count: 0 });
    if (target.endsWith("/status")) return Response.json({ statuses: [] });
    throw new Error(`Unexpected mocked network URL: ${target}`);
  }));
});
function enablePurposeBudgetFixture(){
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture-ledger-secret');
 const original=fetch;vi.stubGlobal('fetch',async(target:RequestInfo|URL,init?:RequestInit)=>{
  const u=String(target);
  if(u.startsWith('https://budget.fixture/rest/v1/')&&!u.includes('/rpc/')){
   if(u.includes('tenant_auth_sessions')){const hash=new URL(u).searchParams.get('token_hash')?.slice(3);const expected=createHash('sha256').update(decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='))).digest('hex');return Response.json(hash===expected?[{id:'fixture-session-id-long',token_hash:hash,tenant_id:tenantId,member_id:'github:123',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*86400000).toISOString(),auth_source:sessionSource,revoked_at:null}]:[]);}
   if(u.includes('tenant_repository_grants'))return Response.json([{report_language:reportLanguage,tenant_id:tenantId,installation_id:42,repository_id:9,repository_full_name:'owner/repo',enabled:!grantRevoked,analysis_enabled:!grantRevoked,save_reports_enabled:!saveDisabled,comment_enabled:false,repository_is_private:privateFixture,private_analysis_consent_version:privateFixture?PRIVATE_ANALYSIS_CONSENT_VERSION:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]);
   if(u.includes('agentproof_tenant_members'))return Response.json([{tenant_id:tenantId,member_id:'github:123',role:'owner',status:'active'}]);
   if(u.includes('agentproof_tenants'))return Response.json([{tenant_id:tenantId,name:'Fixture',status:'active',plan:'beta'}]);
   if(u.includes('github_installations'))return Response.json([{tenant_id:tenantId,installation_id:42,status:'active',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]);
   return Response.json([]);
  }
  return original(target,init);
 });
}
afterEach(() => { clearTenantAuthSessionsForTests(); clearTenantGitHubInstallationsForTests(); clearTenantRepositoryGrantsForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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
it.each([false, true])('recovers operator-only measurements before completing dashboard save (failure=%s)', async failed => {
  vi.stubEnv('AGENTPROOF_OPS_TOKEN', 'fixture-operator-secret');
  failSave = failed;
  const body = await (await generate(request(undefined, {
    'x-agentproof-observation-diagnostics': 'semantic-boundary-v1', 'x-agentproof-ops-token': 'fixture-operator-secret'
  }))).json();
  expect(body.persistence.status).toBe(failed ? 'failed' : 'saved');
  expect(body.operatorMeasurements.spans.map((s: any) => s.phase)).toEqual(expect.arrayContaining([
    'initial_evidence', 'report', 'runtime_validation', 'session_recheck', 'response_projection', 'storage', 'display_projection'
  ]));
  expect(body.operatorMeasurements.spans.find((s: any) => s.phase === 'storage').outcome).toBe(failed ? 'error' : 'ok');
  expect(JSON.stringify(body.operatorMeasurements)).not.toMatch(/fixture-operator-secret|Internal maintenance|owner\/repo|fixture-installation-token/);
  expect(JSON.stringify(body.report)).not.toMatch(/operatorMeasurements|spans|droppedEvidence/);
  expect(JSON.stringify(rows)).not.toMatch(/operatorMeasurements|droppedEvidence|provider_transport/);
});
it('keeps diagnostics out of ordinary dashboard responses and rejects an unauthenticated opt-in before work', async () => {
  vi.stubEnv('AGENTPROOF_OPS_TOKEN', 'fixture-operator-secret');
  const ordinary = await (await generate()).json();
  expect(ordinary.operatorMeasurements).toBeUndefined();
  expect(ordinary.operatorNavigationDiagnostics).toBeUndefined();
  calls = [];
  const rejected = await generate(request(undefined, { 'x-agentproof-observation-diagnostics': 'semantic-boundary-v1' }));
  expect(rejected.status).toBe(401);
  expect(calls).toHaveLength(0);
});
it('does not widen detailed operator diagnostics to a consented private dashboard report', async () => {
  privateFixture = true;
  clearTenantRepositoryGrantsForTests();
  await createTenantRepositoryGrant({ tenantId, installationId: 42, repositoryId: 9, repositoryFullName: 'owner/repo', enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false, repositoryPrivate: true, privateAnalysisConsentVersion: PRIVATE_ANALYSIS_CONSENT_VERSION });
  vi.stubEnv('AGENTPROOF_OPS_TOKEN', 'fixture-operator-secret');
  const response = await generate(request(undefined, { 'x-agentproof-observation-diagnostics': 'semantic-boundary-v1', 'x-agentproof-ops-token': 'fixture-operator-secret' }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.persistence.status).toBe('saved');
  expect(body.operatorMeasurements).toBeUndefined();
  expect(body.operatorNavigationDiagnostics).toBeUndefined();
  expect(JSON.stringify(rows)).not.toMatch(/operatorMeasurements|provider_transport/);
});

it('runs mandatory DeepSeek purpose from the real entry with no per-call budget RPC, and reopens the same safe explanation in the authenticated API/UI',async()=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');vi.stubEnv('OPENAI_MODEL','unrelated-legacy-model');
 enablePurposeBudgetFixture();
 const requests:any[]=[],actions:any[]=[];vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p)}));
 const response=await generate();const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);expect(body.persistence.status).toBe('saved');
 const generations=requests.filter(r=>!r.count);expect(generations.map(r=>JSON.parse(r.body.input[1].content).stage)).toEqual(['purpose','locate','locate','assess']);
 expect(generations.map(r=>r.body.reasoning.effort)).toEqual(['high','high','high','high']);expect(generations.every(r=>r.body.model==='deepseek-flash')).toBe(true);
 expect(requests.every(r=>!r.count)).toBe(true);expect(requests.every(r=>r.body.text.format.type==='json_schema')).toBe(true);
 expect(actions).toHaveLength(0);
 const reopened=await (await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}))).json();expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);
 const {buildDashboardPrEvidenceReview}=await import('../pr-evidence-review');const {PrEvidenceReview}=await import('../../components/PrEvidenceReview');const {renderToStaticMarkup}=await import('react-dom/server');const {createElement}=await import('react');
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildDashboardPrEvidenceReview(reopened)!}));expect(html).toContain('Retain pending work');expect(html).toContain('The changed source retains pending work.');expect(JSON.stringify(reopened.report.purposeReview)).toContain(head);expect(html).not.toContain('pending = retain()');expect(html).not.toContain('Only the saved summary');
 expect(JSON.stringify(rows)).not.toMatch(/pending = retain|fixture-model-secret|fixture-ledger-secret|"facts"|readOutcomes/);
 expect((await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`))).status).toBe(401);
});
it.each(['model','quote','usage','sha','locate'] as const)('does not persist a blank success or retry when purpose %s fails',async failure=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
 const diagnostic=vi.spyOn(console,'warn').mockImplementation(()=>{});
 const requests:any[]=[];vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{failure,onRequest:(body,count)=>requests.push({body,count})}));const response=await generate();const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(503);expect(rows).toHaveLength(0);expect(body.persistence).toBeUndefined();
 const event=JSON.parse(diagnostic.mock.calls.find(x=>x[0]==='agentproof_purpose_failure')![1] as string);
 expect(Object.keys(event).filter(k=>k!=='counts').sort()).toEqual(['code','phase','providerHTTPStatus','pullRequestNumber','repositoryHash','requestCorrelation','stage']);expect(event.code).not.toBe('unknown');expect(event.repositoryHash).toMatch(/^[a-f0-9]{64}$/);expect(event.pullRequestNumber).toBe(7);
 expect(JSON.stringify(event)).not.toMatch(/fixture-model-secret|queue.py|pending = retain|cookie/);
 if(failure==='locate')expect(event).toMatchObject({stage:'locate',phase:'validation',code:'localization_scope_expansion'});
 if(failure==='quote')expect(event).toMatchObject({stage:'assess',phase:'validation',code:'purpose_final_quote'});
 expect(body).not.toHaveProperty('cause');expect(body).not.toHaveProperty('diagnostic');
 expect(requests.filter(r=>!r.count).map(r=>JSON.parse(r.body.input[1].content).stage).filter(s=>s==='assess').length).toBeLessThanOrEqual(1);
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
it('fails the production advisory entry before saving when mandatory DeepSeek purpose is unavailable', async()=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');
 const response=await generate(); const body=await response.json();
 expect(response.status).toBe(503);expect(body.code).toBe('purpose_unavailable');expect(rows).toHaveLength(0);
});

it.each(['implicit','partial'] as const)('completes normal DeepSeek entry with retained-source %s finish, once and persists the same safe purpose',async finish=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
 const requests:any[]=[],actions:any[]=[];vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{finish,onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p)}));
 const response=await generate(),body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);expect(body.persistence.status).toBe('saved');expect(body.report.purposeReview.clauses[0].changeDescriptions[0].text).toBe('The changed source retains pending work.');
 expect(body.report.purposeAssessmentSummary.limitations).toContain(finish==='implicit'?'localization_finish_implicit':'localization_selection_partial');
 expect(requests.filter(r=>!r.count).map(r=>JSON.parse(r.body.input[1].content).stage)).toEqual(['purpose','locate','locate','assess']);
 expect(requests.every(r=>!r.count)).toBe(true);expect(requests.every(r=>r.body.text.format.type==='json_schema')).toBe(true);
 expect(actions).toHaveLength(0);
 const reopened=await(await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}))).json();expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);expect(JSON.stringify(rows)).not.toMatch(/pending = retain|fixture-model-secret|"facts"/);
});

it.each(['test_only','quote_only','ref_only','observation_refs','partial_hunk'] as const)('round-trips common %s content through actual POST/compiler/source/store/authAPI/UI/export',async variant=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
 const requests:any[]=[],actions:any[]=[];vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{variant,onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p)}));
 const response=await generate(),body=await response.json();expect(response.status).toBe(200);expect(body.persistence.status).toBe('saved');
 const reopened=await(await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}))).json();expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);
 const {buildDashboardPrEvidenceReview}=await import('../pr-evidence-review'),{PrEvidenceReview}=await import('../../components/PrEvidenceReview'),{ReportTopSummary}=await import('../../components/ReportTopSummary'),{renderToStaticMarkup}=await import('react-dom/server'),{createElement}=await import('react'),{selectedReportToText,dashboardReportToMarkdown,dashboardReportToJson}=await import('../dashboard-report-export');
 const detail={...reopened,repositoryFullName:'owner/repo',copyEligible:true,freshness:'current' as const},view=buildDashboardPrEvidenceReview(detail)!;
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:view})),top=renderToStaticMarkup(createElement(ReportTopSummary,{report:detail.report,review:view})),copied=selectedReportToText(detail),markdown=dashboardReportToMarkdown(detail),json=JSON.parse(dashboardReportToJson(detail));
 expect(html).toContain('open on GitHub');expect(html).toContain(`https://github.com/owner/repo/blob/${head}/queue.py#L1`);expect(json.purposeReview).toEqual(body.report.purposeReview);
 if(variant==='quote_only'||variant==='ref_only'){expect(body.report.purposeReview.clauses[0].implementation).toBe('unknown');expect(html+copied+markdown).toContain('purpose fit was not interpreted');expect(top).toContain('Selected change locations');expect(top).not.toContain('>Fits<');}
 if(variant==='test_only'){for(const text of [html,copied,markdown])expect(text).toContain('The static assertion checks retained work; execution is not established.');expect(body.report.purposeReview.clauses[0].changeDescriptions).toEqual([]);}
 if(variant==='observation_refs')expect(body.report.purposeAssessmentSummary.goals[0].implementation).toBe('supports');
 if(variant==='partial_hunk')expect(body.report.purposeAssessmentSummary.limitations).toContain('patch_hunk_partial');
 for(const text of [JSON.stringify(rows),html,copied,markdown,JSON.stringify(json)])expect(text).not.toMatch(/pending = retain|fixture-model-secret|"facts"|"rawHash"/);
 expect(requests.filter(r=>!r.count).map(r=>JSON.parse(r.body.input[1].content).stage)).toEqual(['purpose','locate','locate','assess']);expect(actions).toHaveLength(0);
 expect(requests.every(r=>!r.count)).toBe(true);expect(requests.every(r=>r.body.text.format.type==='json_schema')).toBe(true);
 expect((await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`))).status).toBe(401);
});
it('stores and reopens model execution prose without turning it into a server execution receipt',async()=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
 const requests:any[]=[],actions:any[]=[];vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{failure:'execution',onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p)}));
 const response=await generate(),body=await response.json();expect(response.status).toBe(200);expect(body.persistence.status).toBe('saved');
 const reopened=await(await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}))).json();
 expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);expect(reopened.report.purposeReview.clauses[0].changeDescriptions[0].text).toBe('Tests passed.');
 expect(reopened.report.purposeAssessmentSummary.goals[0]).toMatchObject({execution:'not_required',achievement:'partial',assurance:'evidence_assessed'});expect(reopened.report.testing.ciStatus).toBe('unknown');
 expect(JSON.stringify(rows)).not.toMatch(/pending = retain|fixture-model-secret|"source_text"|"facts"/);
 const {buildDashboardPrEvidenceReview}=await import('../pr-evidence-review'),{PrEvidenceReview}=await import('../../components/PrEvidenceReview'),{renderToStaticMarkup}=await import('react-dom/server'),{createElement}=await import('react');
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildDashboardPrEvidenceReview({...reopened,repositoryFullName:'owner/repo'})!}));
 expect(html).toContain('Model interpretation');expect(html).toContain('Tests passed.');expect(html).toContain('Execution records');expect(html).toContain('Checks not recorded'); const {formatPurposeReview}=await import('../shared-report-copy');expect(formatPurposeReview(reopened.report.purposeReview)).toContain('not verified behavior or test execution');
 expect(actions).toHaveLength(0);
 expect(requests.every(r=>!r.count)).toBe(true);expect(requests.every(r=>r.body.text.format.type==='json_schema')).toBe(true);
 expect((await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`))).status).toBe(401);
});
it.each(['ci','body'] as const)('static freshness distinguishes %s changes without changing execution records',async freshness=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{freshness}));
 const response=await generate();expect(response.status).toBe(freshness==='ci'?200:503);expect(rows.length).toBe(freshness==='ci'?1:0);if(freshness==='ci')expect((await response.json()).report.testing.ciStatus).toBe('unknown');
});
it('never saves a purpose-free deterministic fallback after final runtime validation',async()=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py'));
 const validation=await import('../report-runtime-validation'),original=validation.resolveRuntimeReportValidation;
 vi.spyOn(validation,'resolveRuntimeReportValidation').mockImplementation((input:any)=>{if(input.report?.purposeReview){const {purposeReview:_r,purposeAssessment:_a,purposeAssessmentSummary:_s,...base}=input.report;return {valid:true,report:base,usedDeterministicFallback:true};}return original(input);});
 const response=await generate();expect(response.status).toBe(503);expect((await response.json()).code).toBe('purpose_unavailable');expect(rows).toHaveLength(0);
});
it('preserves valid non-ASCII source locations with encoded exact-SHA links and rejects forged location/authority',async()=>{
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();const path='src/한글 test.py';vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo',path));
 const response=await generate(),body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);const reopened=await(await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}))).json();expect(reopened.report.purposeReview.references[0].path).toBe(path);
 const {buildDashboardPrEvidenceReview,purposeReferenceUrl}=await import('../pr-evidence-review'),{isPurposeReviewForSummary}=await import('../purpose-summary'),view=buildDashboardPrEvidenceReview({...reopened,repositoryFullName:'owner/repo'})!;
 expect(purposeReferenceUrl(view,view.purposeReview!.references[0])).toBe(`https://github.com/owner/repo/blob/${head}/src/${encodeURIComponent('한글 test.py')}#L1`);
 const typed={...reopened,report:{...reopened.report,verificationContract:{state:'authoritative'},generalPrAssessmentSummary:{mode:'typed_contract_companion'}}};const typedView=buildDashboardPrEvidenceReview(typed);expect(typedView?.purposeReview).toEqual(reopened.report.purposeReview);expect(buildDashboardPrEvidenceReview({...typed,report:{...typed.report,purposeReview:undefined}})).toBeUndefined();
 for(const mutate of [(r:any)=>r.references[0].path='../private.py',(r:any)=>r.references[0].revision='f'.repeat(40),(r:any)=>r.clauses[0].evidenceRefs=['pe_'+'f'.repeat(24)],(r:any)=>r.clauses[0].goalId='pg_'+'f'.repeat(24)]){const changed=structuredClone(body.report.purposeReview);mutate(changed);expect(isPurposeReviewForSummary(changed,body.report.purposeAssessmentSummary)).toBe(false);}
});

async function enablePrivatePurposeFixture(){
 privateFixture=true;clearTenantRepositoryGrantsForTests();
 await createTenantRepositoryGrant({tenantId,installationId:42,repositoryId:9,repositoryFullName:'owner/repo',enabled:true,analysisEnabled:true,saveReportsEnabled:true,commentEnabled:false,repositoryPrivate:true,privateAnalysisConsentVersion:PRIVATE_ANALYSIS_CONSENT_VERSION});
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
}
it('reuses persisted private consent for two purpose analyses and owner-only stored API/UI with no raw source/share prose',async()=>{
 await enablePrivatePurposeFixture();const requests:any[]=[],actions:any[]=[];
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true,onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p)}));
 for(let n=0;n<2;n++){
  const response=await generate();const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);expect(body.persistence.status).toBe('saved');
  const detail=await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}));const reopened=await detail.json();expect(detail.status).toBe(200);expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);
  const {buildDashboardPrEvidenceReview}=await import('../pr-evidence-review'),{PrEvidenceReview}=await import('../../components/PrEvidenceReview'),{renderToStaticMarkup}=await import('react-dom/server'),{createElement}=await import('react');
  const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildDashboardPrEvidenceReview(reopened)!}));expect(html).toContain('The changed source retains pending work.');expect(html).not.toContain('pending = retain()');
  const {sanitizeReportForShare}=await import('../report-share');expect(JSON.stringify(sanitizeReportForShare(reopened.report))).not.toMatch(/purposeReview|The changed source retains pending work/);
  expect(await getSavedReport(body.persistence.id,{tenantId:'other'})).toBeNull();
 }
 expect(requests.filter(r=>!r.count).map(r=>JSON.parse(r.body.input[1].content).stage)).toEqual(['purpose','locate','locate','assess','purpose','locate','locate','assess']);
 expect(actions).toHaveLength(0);
 expect(JSON.stringify(rows)).not.toMatch(/pending = retain|fixture-model-secret|fixture-installation-token|"facts"|readOutcomes/);
});
it.each(['admission','final','save'] as const)('denies private grant revocation at %s without retry or saving',async point=>{
 await enablePrivatePurposeFixture();const requests:any[]=[],actions:any[]=[];vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true,onRequest:(body,count)=>{requests.push({body,count});const q=JSON.parse(body.input[1].content);if(point==='final'&&q.stage==='assess'&&!count)grantRevoked=true;if(point==='admission'&&q.stage==='purpose'&&!count)grantRevoked=true;},onBudget:p=>actions.push(p),afterFinal:()=>{if(point==='save')saveDisabled=true;}}));
 const response=await generate();expect(response.status,JSON.stringify(await response.json())).toBe(503);expect(rows).toHaveLength(0);
 expect(actions).toHaveLength(0);
 // Revoked during the first model call: the post-call check rejects its result before any further call.
 if(point==='admission')expect(requests.filter(r=>!r.count)).toHaveLength(1);
 else expect(requests.filter(r=>!r.count)).toHaveLength(4);
});
it('does not use request consent booleans as server authority for unconsented private purpose',async()=>{
 privateFixture=true;clearTenantRepositoryGrantsForTests();await createTenantRepositoryGrant({tenantId,installationId:42,repositoryId:9,repositoryFullName:'owner/repo',enabled:true,analysisEnabled:false,saveReportsEnabled:true,commentEnabled:false,repositoryPrivate:true});
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');
 const response=await generate(request({prUrl:url,privateConsent:true,providerRetentionApproved:true}));expect(response.status).not.toBe(200);expect(calls.some(u=>u.startsWith('https://api.openai.com/'))).toBe(false);expect(rows).toHaveLength(0);
});

it.each([false,true])('freezes the server language through purpose/final, signed save and auth GET (private=%s)',async privateRepo=>{
 if(privateRepo){privateFixture=true;clearTenantRepositoryGrantsForTests();await createTenantRepositoryGrant({tenantId,installationId:42,repositoryId:9,repositoryFullName:'owner/repo',enabled:true,analysisEnabled:true,saveReportsEnabled:true,commentEnabled:false,repositoryPrivate:true,privateAnalysisConsentVersion:PRIVATE_ANALYSIS_CONSENT_VERSION});}
 const {PATCH}=await import('./repository-settings'),{listTenantRepositoryGrants}=await import('../tenant-control-plane');
 const setting=await PATCH(new Request('http://localhost/api/tenants/repositories',{method:'PATCH',headers:{origin:'http://localhost',cookie,'content-type':'application/json'},body:JSON.stringify({installationId:42,repositoryId:9,settings:{reportLanguage:'ko'}})}));
 expect(setting.status).toBe(200);expect((await setting.json()).repository.reportLanguage).toBe('ko');
 reportLanguage=(await listTenantRepositoryGrants({tenantId}))[0].reportLanguage!;
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
 const requests:any[]=[];
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:privateRepo,onRequest:(body,count)=>{requests.push({body,count});if(!count)reportLanguage='en';}}));
 const response=await generate();const body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);
 expect(body.report.purposeReview.locale).toBe('ko');expect(body.report.purposeReview.clauses[0].purpose).toBe('대기 중인 작업 유지');
 expect(body.report.purposeReview.clauses[0].changeDescriptions[0].text).toBe('변경된 소스는 대기 중인 작업을 유지합니다.');
 const detail=await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}));const reopened=await detail.json();expect(detail.status).toBe(200);expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);
 const generations=requests.filter(r=>!r.count);expect(generations.map(r=>JSON.parse(r.body.input[1].content).stage)).toEqual(['purpose','locate','locate','assess']);
 expect(generations.every(r=>JSON.parse(r.body.input[1].content).reportLanguage==='ko')).toBe(true);
 expect(requests.every(r=>!r.count&&r.body.model==='deepseek-flash'&&r.body.reasoning.effort==='high')).toBe(true);
 const {validateTenantPersistedReport,projectTenantPersistedReport,decodeTenantPersistedReport}=await import('../tenant-report-validation');
 const secret=process.env.AGENTPROOF_REPORT_SIGNING_SECRET!;expect(validateTenantPersistedReport(rows[0].report,secret).valid).toBe(true);
 const tampered=structuredClone(rows[0].report);tampered.purposeReview.locale='en';expect(validateTenantPersistedReport(tampered,secret).valid).toBe(false);
 const legacy=structuredClone(reopened.report);delete legacy.purposeReview.locale;const persistedLegacy=projectTenantPersistedReport(legacy,secret);const decoded=decodeTenantPersistedReport(persistedLegacy,{signingSecret:secret,createdAt:reopened.createdAt});expect(decoded.status).toBe('valid');if(decoded.status==='valid')expect((decoded.report as any).purposeReview.locale).toBeUndefined();
 const {resolveReportLanguage}=await import('../tenant-report-language');expect(resolveReportLanguage(legacy.purposeReview.locale)).toBe('en');
 const {isPurposeReview}=await import('../purpose-summary');const unsupported=structuredClone(body.report.purposeReview);unsupported.locale='ja';expect(isPurposeReview(unsupported)).toBe(false);
 expect(JSON.stringify(rows)).not.toContain('pending = retain()');
 const {buildDashboardPrEvidenceReview}=await import('../pr-evidence-review'),{QuickSummaryPanel}=await import('../../components/PublicGitHubDashboard'),{toQuickSummary}=await import('../github-dashboard-view-model'),{renderToStaticMarkup}=await import('react-dom/server'),{createElement}=await import('react');
 const view=buildDashboardPrEvidenceReview(reopened);expect(view!.purposeReview!.locale).toBe('ko');
 const html=renderToStaticMarkup(createElement(QuickSummaryPanel,{detail:reopened,quickSummary:toQuickSummary(reopened),demoMode:false,showDetailedEvidence:false,onShowDetail:()=>{}}));expect(html).toContain('보고서 요약');expect(html).toContain('대기 중인 작업 유지');expect(html).toContain('변경된 소스는 대기 중인 작업을 유지합니다.');expect(html).not.toContain('pending = retain()');
 const {selectedReportToText,dashboardReportToJson}=await import('../dashboard-report-export');expect(selectedReportToText(reopened)).toContain('목적 근거');expect(selectedReportToText(reopened)).toContain('변경된 소스는 대기 중인 작업을 유지합니다.');expect(JSON.parse(dashboardReportToJson(reopened)).purposeReview).toEqual(body.report.purposeReview);
 const {sanitizeReportForShare}=await import('../report-share');expect(JSON.stringify(sanitizeReportForShare(reopened.report))).not.toContain('대기 중인 작업');
});

it('uses the same server repository language for mobile analysis without a client locale override',async()=>{
 const {createTenantAuthSessionForMobileMember}=await import('../tenant-auth');cookie=(await createTenantAuthSessionForMobileMember({tenantId,memberId:'github:123'})).sessionCookie;sessionSource='mobile';
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();reportLanguage='ko';const requests:any[]=[];
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{onRequest:(body,count)=>requests.push({body,count})}));
 const token=decodeURIComponent(cookie.split(';')[0].split('=').slice(1).join('='));
 const response=await POST(new Request('http://localhost/api/mobile/analyze',{method:'POST',headers:{authorization:`Bearer apm_${token}`,'content-type':'application/json'},body:JSON.stringify({prUrl:url})}),'mobile');const body=await response.json();
 expect(response.status,JSON.stringify(body)).toBe(200);expect(body.report.purposeReview.locale).toBe('ko');expect(body.report.purposeReview.clauses[0].purpose).toBe('대기 중인 작업 유지');expect(requests.filter(r=>!r.count).map(r=>JSON.parse(r.body.input[1].content).reportLanguage)).toEqual(['ko','ko','ko','ko']);
});

// Developer diagnostics must traverse the real private provider/compiler/store entry.
it('diagnostic flag connects private analysis to store without logging source or changing admitted/generated input',async()=>{
 await enablePrivatePurposeFixture();vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});const requests:any[]=[];
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','private-canary-path.py',{privateRepository:true,onRequest:(body,count)=>requests.push({body,count})}));
 const response=await generate(),body=await response.json();expect(response.status).toBe(200);expect(body.persistence.status).toBe('saved');
 expect(response.headers.get('x-agentproof-diagnostic-request')).toMatch(/^[a-f0-9-]{36}$/);
 const events=info.mock.calls.filter(c=>c[0]==='agentproof_analysis_diagnostic').map(c=>JSON.parse(String(c[1])));
 for(const stage of ['request','input','settings','purpose','read','selection','final','projection','store','response'])expect(events.some(e=>e.stage===stage),stage).toBe(true);
 expect(events.find(e=>e.stage==='store'&&e.outcome==='success').hashes.report).toHaveLength(64);
 expect(events.find(e=>e.stage==='response').counts.status).toBe(200);
 expect(events.find(e=>e.stage==='input').hashes.tenant).toBe(createHash('sha256').update(JSON.stringify(tenantId)).digest('hex'));
 const correlation=response.headers.get('x-agentproof-diagnostic-request')!;
 const received=await receiveClientDiagnostic(new Request('http://localhost/api/dashboard/analysis-diagnostics',{method:'POST',headers:{origin:'http://localhost',cookie,'content-type':'application/json'},body:JSON.stringify({events:[{version:1,client:correlation,correlation,sequence:1,operation:'analysis',phase:'network_error',errorKind:'type_error',at:new Date().toISOString(),elapsedMs:100}]})}));
 expect(received.status).toBe(202);
 const clientLog=info.mock.calls.filter(c=>c[0]==='agentproof_analysis_client_diagnostic').map(c=>JSON.parse(String(c[1]))).at(-1);
 expect(clientLog.client).toBe(correlation);expect(clientLog.tenantHash).toBe(events.find(e=>e.stage==='input').hashes.tenant);

 expect(events.find(e=>e.stage==='response'&&e.outcome==='start').counts.bytes).toBeGreaterThan(0);
 expect(response.headers.get('x-agentproof-diagnostic-bytes')).toBe(String(Buffer.byteLength(JSON.stringify(body))));
 expect(new Set(events.map(e=>e.correlation)).size).toBe(1);
 expect(events.filter(e=>e.stage==='provider_count')).toHaveLength(0);expect(events.filter(e=>e.stage==='provider_budget'&&e.outcome==='start')).toHaveLength(0);for(const gen of events.filter(e=>e.stage==='provider_generate'&&e.outcome==='start')){expect(gen.hashes.common).toMatch(/^[a-f0-9]{64}$/);expect(gen.hashes.schema).toMatch(/^[a-f0-9]{64}$/);expect(gen.model).toBe('deepseek-flash');expect(gen.effort).toBe('high');}
 expect(JSON.stringify(events)).not.toMatch(/private-canary-path|pending = retain|Internal maintenance|fixture-model-secret|fixture-installation-token|fixture-ledger-secret|Tests passed/);
 expect(requests.every(r=>!r.count)).toBe(true);expect(requests.every(r=>r.body.text.format.type==='json_schema')).toBe(true);
});
it('private diagnostic OFF preserves saved payload and emits no developer trace',async()=>{
 await enablePrivatePurposeFixture();vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','0');const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true}));
 const response=await generate(),body=await response.json();expect(body.persistence.status).toBe('saved');expect(body.report.purposeReview).toBeDefined();expect(response.headers.get('x-agentproof-diagnostic-request')).toBeNull();expect(info).not.toHaveBeenCalled();
});
it.each(['quote','usage'] as const)('closed diagnostic preserves %s failure and never reports store success',async failure=>{
 await enablePrivatePurposeFixture();vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true,failure}));
 const response=await generate();expect(response.status).toBe(503);expect((await response.json()).code).toBe(failure==='usage'?'purpose_usage_unconfirmed':'purpose_unavailable');expect(rows).toHaveLength(0);
 const events=info.mock.calls.filter(c=>c[0]==='agentproof_analysis_diagnostic').map(c=>JSON.parse(String(c[1])));
 expect(events.some(e=>e.stage==='store')).toBe(false);expect(events.some(e=>e.outcome==='failure'&&e.failure?.code!=='unknown')).toBe(true);
});
it('records store failure distinctly from HTTP200 and its response payload',async()=>{
 await enablePrivatePurposeFixture();vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');failSave=true;const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true}));
 const response=await generate();expect(response.status).toBe(200);expect((await response.json()).persistence.status).toBe('failed');
 const events=info.mock.calls.filter(c=>c[0]==='agentproof_analysis_diagnostic').map(c=>JSON.parse(String(c[1])));
 expect(events.some(e=>e.stage==='store'&&e.outcome==='failure')).toBe(true);expect(events.some(e=>e.stage==='store'&&e.outcome==='success')).toBe(false);
});
it('actual repeated source reads record cache reuse without another blob download',async()=>{
 await enablePrivatePurposeFixture();vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});let blobs=0;
 const fixture=purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true});
 vi.stubGlobal('fetch',async(target:RequestInfo|URL,init?:RequestInit)=>{
  if(String(target).includes('/git/blobs/'))blobs++;
  const response=await fixture(target,init);
  if(String(target)==='https://api.deepseek.com/responses'){
   const q=JSON.parse(JSON.parse(String(init?.body)).input[1].content);
   if(q.stage==='locate'&&q.localization.round===0){const body=await response.json();const p=JSON.parse(body.output[0].content[0].text);p.actions.push({...p.actions[0]});body.output[0].content[0].text=JSON.stringify(p);return Response.json(body);}
  }return response;
 });
 expect((await generate()).status).toBe(200);expect(blobs).toBe(1);
 const events=info.mock.calls.filter(c=>c[0]==='agentproof_analysis_diagnostic').map(c=>JSON.parse(String(c[1])));
 expect(events.filter(e=>e.stage==='read'&&e.outcome==='start')).toHaveLength(2);expect(events.filter(e=>e.stage==='cache'&&e.outcome==='reused')).toHaveLength(1);
 const reads=events.filter(e=>e.stage==='read'&&e.outcome==='success');expect(reads[0].parts[0].idHash).toBe(reads[1].parts[0].idHash);
});

it('correlates two same-PR saves and authenticated reread by stored DTO hash while retaining original createdAt',async()=>{
 await enablePrivatePurposeFixture();vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});vi.useFakeTimers({toFake:['Date']});
 try{
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:true}));
 vi.setSystemTime(new Date('2026-10-15T02:46:21.347Z'));const first=await(await generate()).json();
 vi.setSystemTime(new Date('2026-10-15T02:50:54.946Z'));const second=await(await generate()).json();
 expect(first.persistence.createdAt).not.toBe(second.persistence.createdAt);expect(first.persistence.id).not.toBe(second.persistence.id);
 const reopened=await(await GET(new Request(`http://localhost/api/dashboard/reports?id=${first.persistence.id}`,{headers:{cookie}}))).json();expect(reopened.createdAt).toBe(first.persistence.createdAt);
 const events=info.mock.calls.filter(c=>c[0]==='agentproof_analysis_diagnostic').map(c=>JSON.parse(String(c[1]))),stores=events.filter(e=>e.stage==='store'&&e.outcome==='success'),read=events.find(e=>e.stage==='store'&&e.outcome==='reused');
 expect(stores.map(e=>e.reportCreatedAt)).toEqual(['2026-10-15T02:46:21.347Z','2026-10-15T02:50:54.946Z']);expect(read.hashes.report).toBe(stores[0].hashes.report);expect(read.hashes.projection).toBe(stores[0].hashes.projection);expect(read.reportCreatedAt).toBe(stores[0].reportCreatedAt);expect(new Set(events.map(e=>e.correlation)).size).toBe(3);
 }finally{vi.useRealTimers();}
});

it.each([false,true])('rejects retained Saved reports OFF before count/model/budget work (private=%s)',async privateRepo=>{
 if(privateRepo)await enablePrivatePurposeFixture();
 else{vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();}
 saveDisabled=true;const requests:any[]=[],actions:any[]=[];
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:privateRepo,onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p)}));
 const response=await generate(),body=await response.json();
 expect(response.status).toBe(409);expect(body.code).toBe('github_save_reports_disabled');expect(body.report).toBeUndefined();
 expect(requests).toHaveLength(0);expect(actions).toHaveLength(0);expect(rows).toHaveLength(0);
});
it.each([[false,'save_off'],[false,'revoked'],[true,'save_off'],[true,'revoked']] as const)('rechecks retained grant after generation and never saves after %s/%s',async(privateRepo,change)=>{
 if(privateRepo)await enablePrivatePurposeFixture();
 else{vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();}
 const requests:any[]=[],actions:any[]=[];vi.spyOn(console,'warn').mockImplementation(()=>{});
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:privateRepo,onRequest:(body,count)=>requests.push({body,count}),onBudget:p=>actions.push(p),afterFinal:()=>{if(change==='save_off')saveDisabled=true;else grantRevoked=true;}}));
 const response=await generate(),body=await response.json();
 expect(response.status).toBe(privateRepo?503:409);expect(body.report).toBeUndefined();expect(rows).toHaveLength(0);
 expect(requests.filter(r=>!r.count)).toHaveLength(4);expect(actions).toHaveLength(0);
 expect(calls.some(u=>u.includes('/rpc/agentproof_store_tenant_report'))).toBe(false);
});
it.each([false,true])('keeps non-retained purpose analysis separate from Saved reports OFF (private=%s)',async privateRepo=>{
 if(privateRepo)await enablePrivatePurposeFixture();
 else{vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();}
 saveDisabled=true;const requests:any[]=[];
 vi.stubGlobal('fetch',purposeRuntimeFetch(fetch,'owner/repo','queue.py',{privateRepository:privateRepo,onRequest:(body,count)=>requests.push({body,count})}));
 const response=await POST(request()),body=await response.json();
 expect(response.status,JSON.stringify(body)).toBe(200);expect(body.report.purposeReview.clauses).toHaveLength(1);expect(body.persistence).toBeUndefined();
 expect(requests.filter(r=>!r.count)).toHaveLength(4);expect(rows).toHaveLength(0);
});

it.each(['en','ko'] as const)('retains cited hierarchy from actual entry to signed store/auth GET and all owner exports in %s',async locale=>{
 reportLanguage=locale;
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','advisory');vi.stubEnv('OPENAI_API_KEY','fixture-model-secret');vi.stubEnv('DEEPSEEK_API_KEY','fixture-deepseek-secret');enablePurposeBudgetFixture();
 const requests:any[]=[],model=purposeRuntimeFetch(fetch,'owner/repo','queue.py',{onRequest:(body,count)=>requests.push({body,count})});
 vi.stubGlobal('fetch',async(u:any,init:any)=>{
  const response=await model(u,init);
  if(!String(u).endsWith('/responses'))return response;
  const request=JSON.parse(init.body),q=JSON.parse(request.input[1].content);
  if(q.stage!=='assess')return response;
  const body=await response.json(),text=body.output[0].content[0],proposal=JSON.parse(text.text);
  for(const c of proposal.units??proposal.clauses){c.changeSummary={text:locale==='ko'?'대기 작업 보존':'Retain pending work',evidenceRefs:[q.evidence[0].id]};c.scopeNotes=[{text:locale==='ko'?'인용된 변경 범위의 해석입니다.':'This interpretation covers the cited change.',evidenceRefs:[q.evidence[0].id]}];}
  text.text=JSON.stringify(proposal);return Response.json(body);
 });
 const response=await generate(),body=await response.json();expect(response.status,JSON.stringify(body)).toBe(200);expect(body.persistence.status).toBe('saved');
 const reopened=await(await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`,{headers:{cookie}}))).json();
 expect(reopened.report.purposeReview).toEqual(body.report.purposeReview);expect(reopened.report.purposeReview.locale).toBe(locale);
 const clause=reopened.report.purposeReview.clauses[0];expect(clause.changeSummary).toBeDefined();expect(clause.scopeNotes).toHaveLength(1);
 const {selectedReportToText,dashboardReportToMarkdown,dashboardReportToJson}=await import('../dashboard-report-export');const detail={...reopened,repositoryFullName:'owner/repo',freshness:'current',copyEligible:true};
 for(const text of [selectedReportToText(detail,'DOM_DUPLICATE_SENTINEL'),dashboardReportToMarkdown(detail),dashboardReportToJson(detail)]){expect(text).toContain(clause.changeSummary.text);expect(text).toContain(clause.scopeNotes[0].text);expect(text).not.toContain('DOM_DUPLICATE_SENTINEL');expect(text).not.toMatch(/pending = retain|fixture-model-secret|"source_text"|"facts"/);}
 const generations=requests.filter(r=>!r.count);expect(generations.map(r=>JSON.parse(r.body.input[1].content).stage)).toEqual(['purpose','locate','locate','assess']);
 expect(requests.every(r=>!r.count)).toBe(true);expect(requests.every(r=>r.body.text.format.type==='json_schema')).toBe(true);
 expect((await GET(new Request(`http://localhost/api/dashboard/reports?id=${body.persistence.id}`))).status).toBe(401);
});
