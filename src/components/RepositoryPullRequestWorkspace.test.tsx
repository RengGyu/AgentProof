import {readAnalysisClientDiagnostics,clearAnalysisClientDiagnostics} from '@/lib/analysis-client-diagnostics';
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RepositoryPullRequestWorkspace } from "./RepositoryCommitBrowser";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";
import { prepareTenantDetailReportForStorage } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";

// Same lightweight hook host used by the existing dashboard behavior tests.
// Analysis, persistence and auth are exercised separately through real server
// code; this host drives the actual component handlers and async transitions.
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => void> }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState(initial: any) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }];
  },
  useRef(initial: any) { const index = hooks.index++; return hooks.slots[index] ??= { current: initial }; },
  useEffect(work: () => any, deps: any[]) {
    const index = hooks.index++; const old = hooks.slots[index];
    if (!old || deps.some((v,i)=>v !== old.deps[i])) hooks.effects.push(() => { old?.cleanup?.(); hooks.slots[index] = { deps, cleanup: work() }; });
  }
}));
const head = "a".repeat(40), oldHead = "b".repeat(40), fetchedHead = "c".repeat(40);
const saved = { id: "saved-7", repositoryId: 9, pullRequestNumber: 7, headSha: head, availability: "available", freshness: "current", createdAt: "2026-10-01T00:00:00Z", priority: "low" };
let tree: any, repositoryId: number, reports: any[], runtime: any, canGenerate: boolean, resumeKey: number;
let reportLanguage: "en" | "ko";
let cache: import("./RepositoryCommitBrowser").PullRequestWorkspaceCache | undefined;
let fetchMock: ReturnType<typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>>;
let onOpenReport: ReturnType<typeof vi.fn<(id: string) => void>>;
let onGeneratedReport: ReturnType<typeof vi.fn<(detail: import("@/lib/github-dashboard-view-model").DashboardReportDetail) => void>>;
function nodes(value: any = tree): any[] { return Array.isArray(value) ? value.flatMap(n=>nodes(n)) : value?.props ? [value, ...nodes(value.props.children ?? null)] : []; }
function text(value: any = tree): string { return Array.isArray(value) ? value.map(v=>text(v)).join(" ") : value?.props ? text(value.props.children ?? null) : typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function render() {
  hooks.index = 0;
  tree = RepositoryPullRequestWorkspace({ repositoryId, repositoryFullName: repositoryId === 9 ? "owner/repo" : "owner/second", runtime, onOpenReport, onGeneratedReport, cache, canGenerate, reportLanguage, resumeKey });
  hooks.effects.splice(0).forEach(work=>work());
}
// Flush effect-driven metadata recovery as React would after the initial async update.
async function settle() { for(let round=0;round<3;round++) { for(let i=0;i<24;i++) await Promise.resolve(); render(); } }
function action(label: string) { const node = nodes().find(n=>n.type === "button" && n.props["aria-label"] === label); expect(node, label).toBeTruthy(); return node!; }
function click(label: string) { action(label).props.onClick(); render(); }
/** An unchanged head needs explicit confirmation without opening another saved version. */
function regenerateSameHead(number: number) { click(`Regenerate report for PR #${number}`); if(nodes().some(n=>n.props["aria-label"]===`Regenerate anyway for PR #${number}`)) click(`Regenerate anyway for PR #${number}`); }
function generated(persistence: any = { status: "saved", id: "saved-new", createdAt: "2026-10-01T01:00:00Z" }, target = { repositoryId: 9, pullRequestNumber: 7, headSha: fetchedHead }) {
  const report = prepareTenantDetailReportForStorage(generateVerificationReportV2FromInput({ ...demoScenarios.clean,
    url: "https://github.com/owner/repo/pull/7", sourceProvenance: {
      version: 1, origin: "github_snapshot", headSha: target.headSha, baseSha: oldHead,
      evidenceCapturedAt: "2026-10-01T01:00:00Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "d".repeat(64), coverage: "github_metadata" }
    }
  }), "verified_agentproof", "test-report-signing-secret-that-is-long-enough");
  return Response.json({ target, persistence, report });
}
beforeEach(() => {
  hooks.slots = []; hooks.index = 0; hooks.effects = []; repositoryId = 9; reports = [saved]; canGenerate = true; resumeKey = 0; cache = undefined; reportLanguage = "en";
  onOpenReport = vi.fn(); onGeneratedReport = vi.fn();
  vi.stubGlobal("window", { location: { assign: vi.fn() }, localStorage: { getItem: ()=>null }, sessionStorage: { setItem: vi.fn() } });
  fetchMock = vi.fn(async (path: string) => {
    if (path.includes("pull-requests")) return Response.json({ pullRequests: [{ number: 7, title: "Make PR reports readable", state: "open", headSha: head }, { number: 8, title: "Older PR", state: "closed", headSha: oldHead }] });
    if (path.includes("/reports?")) return Response.json({ reports, hasMore: false, nextOffset: null });
    if (path === "/api/dashboard/analyze") return generated();
    throw new Error(`Unexpected test request ${path}`);
  });
  runtime = { request: fetchMock };
});
afterEach(()=>{ hooks.slots.forEach(s=>s?.cleanup?.()); vi.unstubAllGlobals(); });

it("selects a PR without rendering or requesting a commit listing", async () => {
  render(); await settle(); click("Select PR #7"); await settle();
  expect(nodes().some(node => typeof node.type === "function" && node.type.name === "RepositoryPrCommits")).toBe(false);
  expect(text()).not.toContain("Commits on GitHub");
  expect(fetchMock.mock.calls.some(([path]) => path.includes("pullRequestNumber="))).toBe(false);
});
it("uses the requested short PR guide without implementation instructions", async () => {
  render(); await settle();
  expect(text()).toContain("최근 PR 20개");
  expect(text()).not.toMatch(/The 20 most recently updated PRs|Generate from the current GitHub head|saved versions stay with their PR/);
});
it("shows readable PR rows and actual available-report badges, without a repository or PR select", async () => {
  render(); await settle();
  expect(nodes().filter(n=>n.type === "select")).toHaveLength(0);
  expect(text()).toContain("Make PR reports readable"); expect(text()).toContain("open"); expect(text()).toContain("closed");
  expect(text()).toContain("Report available");
  action("View report for PR #7"); action("Regenerate report for PR #7");
  click("Select PR #8"); action("Generate report for PR #8");
});
it("puts the selected PR's saved versions on a shelf, opening the latest and marking the one being read", async () => {
  reports = [saved, { ...saved, id: "previous", headSha: oldHead, createdAt: "2026-09-30T00:00:00Z", staleAt: "2026-10-01T00:00:00Z" }];
  render(); await settle();
  expect(text()).toMatch(/PR #\s*7\s*·\s*2\s*saved/);
  expect(text()).not.toMatch(/If generation fails|Saved report\b/);
  click("Select PR #7"); expect(onOpenReport).toHaveBeenLastCalledWith("saved-7");
  expect(action("View report for PR #7").props["aria-current"]).toBeUndefined();
  hooks.index = 0;
  tree = RepositoryPullRequestWorkspace({ repositoryId, repositoryFullName: "owner/repo", runtime, onOpenReport, onGeneratedReport, activeReportId: "previous" });
  expect(action("View report version previous").props["aria-current"]).toBe("true");
  expect(text()).toMatch(/v1[\s\S]*Viewing/);
  click("Select PR #8"); expect(onOpenReport).toHaveBeenCalledTimes(1);
  expect(text()).toContain("Generate report");
});
it("only claims report presence from an available saved record, and labels an older head previous", async () => {
  reports = [{ ...saved, headSha: oldHead }, { ...saved, id: "failed", pullRequestNumber: 8, availability: "analysis_failed" }];
  render(); await settle();
  expect(text()).toContain("Previous head");
  action("View report for PR #7");
  click("Select PR #8"); action("Generate report for PR #8");
  expect(nodes().some(n=>n.props["aria-label"] === "View report for PR #8")).toBe(false);
});
it("sends only the PR URL, stays on screen, blocks duplicates and displays the real fetched head", async () => {
  let finish!: (value: Response)=>void;
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, init)=>path === "/api/dashboard/analyze" ? new Promise(resolve=>{ finish=resolve; }) : normal(path, init));
  render(); await settle();
  click("Regenerate report for PR #7");
  const button = action("Regenerate anyway for PR #7"); button.props.onClick(); button.props.onClick(); render();
  expect(action("Regenerate report for PR #7").props.disabled).toBe(true);
  expect(text()).toContain("Generating");
  const requests = fetchMock.mock.calls.filter(([path])=>path === "/api/dashboard/analyze");
  expect(requests).toHaveLength(1);
  expect(JSON.parse(String(requests[0][1]!.body))).toEqual({ prUrl: "https://github.com/owner/repo/pull/7" });
  expect(new Headers(requests[0][1]!.headers).get("x-agentproof-csrf")).toBe("same-origin");
  expect(new Headers(requests[0][1]!.headers).get("x-agentproof-analysis-key")).toEqual(expect.any(String));
  finish(generated()); await settle();
  expect(text()).toContain("Saved"); expect(text()).toContain(fetchedHead.slice(0, 12));
  expect(onGeneratedReport).toHaveBeenCalledWith(expect.objectContaining({ id: "saved-new", repositoryId: 9, pullRequestNumber: 7, headSha: fetchedHead, report: expect.any(Object) }));
  expect(window.location.assign).not.toHaveBeenCalled(); expect(window.sessionStorage.setItem).not.toHaveBeenCalled();
});
it("keeps an existing report accessible on failure and retries from the same row", async () => {
  render(); await settle();
  fetchMock.mockResolvedValueOnce(Response.json({ error: "GitHub unavailable" }, { status: 503 }));
  regenerateSameHead(7); await settle();
  expect(text()).toContain("Analysis did not finish."); expect(text()).not.toContain("GitHub unavailable"); expect(onGeneratedReport).not.toHaveBeenCalled();
  click("View report for PR #7"); expect(onOpenReport).toHaveBeenCalledWith("saved-7");
  regenerateSameHead(7); await settle();
  expect(onGeneratedReport).toHaveBeenCalledTimes(1);
});
it("shows a generated but unsaved result honestly and retains the old saved version", async () => {
  render(); await settle();
  fetchMock.mockResolvedValueOnce(generated({ status: "failed", message: "Report generated, but it could not be saved." }));
  regenerateSameHead(7); await settle();
  expect(text()).toContain("could not be saved");
  expect(onGeneratedReport).toHaveBeenCalledWith(expect.objectContaining({ id: undefined, headSha: fetchedHead, copyEligible: false }));
  click("View report for PR #7"); expect(onOpenReport).toHaveBeenCalledWith("saved-7");
});
it("rejects a result belonging to another PR rather than displaying or marking it saved", async () => {
  render(); await settle();
  fetchMock.mockResolvedValueOnce(generated(undefined, { repositoryId: 9, pullRequestNumber: 8, headSha: fetchedHead }));
  regenerateSameHead(7); await settle();
  expect(onGeneratedReport).not.toHaveBeenCalled(); expect(text()).toContain("could not be matched");
});
it("does not replace a newly selected PR with a late generation result", async () => {
  let finish!: (value:Response)=>void;
  render(); await settle();
  fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  regenerateSameHead(7);
  click("Select PR #8");
  finish(generated()); await settle();
  expect(onGeneratedReport).not.toHaveBeenCalled();
});
it("ignores late PR/history/generation responses when the repository changes", async () => {
  let finish!: (value:Response)=>void;
  render(); await settle();
  fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  regenerateSameHead(7);
  repositoryId = 10; reports = []; render(); await settle();
  finish(generated()); await settle();
  expect(onGeneratedReport).not.toHaveBeenCalled();
  expect(text()).not.toContain("Report available");
  expect(fetchMock.mock.calls.some(([path])=>path.includes("repositoryId=10"))).toBe(true);
});
it("reopens retained versions after reload from the server, including older pages", async () => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (path, init) => {
    if (path.includes("scope=history")) return path.includes("offset=50")
      ? Response.json({ reports: [{...saved,id:"previous",headSha:oldHead,staleAt:"2026-10-01T00:00:00Z"}], hasMore:false, nextOffset:null })
      : Response.json({reports:[saved],hasMore:true,nextOffset:50});
    return normal(path,init);
  });
  render(); await settle(); await settle();
  click("Select PR #7");
  click("View report version previous"); expect(onOpenReport).toHaveBeenCalledWith("previous");
  hooks.slots.forEach(s=>s?.cleanup?.()); hooks.slots=[]; render(); await settle(); await settle();
  click("View report for PR #7"); expect(onOpenReport).toHaveBeenLastCalledWith("saved-7");
});

it("keeps report versions reachable for PRs outside the recent GitHub list", async () => {
  reports = [{ ...saved, id: "old-pr-version", pullRequestNumber: 99, headSha: oldHead, freshness: "stale" }];
  render(); await settle();
  click("View report version old-pr-version");
  expect(onOpenReport).toHaveBeenCalledWith("old-pr-version");
  expect(text()).toMatch(/#\s*99/);
});

it("ignores late repository list and report history responses", async () => {
  let oldPr!: (value:Response)=>void, oldHistory!: (value:Response)=>void;
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, init) => path.includes("repositoryId=9")
    ? new Promise(resolve=>{ if(path.includes("pull-requests")) oldPr=resolve; else oldHistory=resolve; }) : normal(path,init));
  render();
  repositoryId = 10; reports = []; render(); await settle();
  oldPr(Response.json({pullRequests:[{number:99,title:"Wrong repository",state:"open",headSha:head}]}));
  oldHistory(Response.json({reports:[saved],hasMore:false,nextOffset:null})); await settle();
  expect(text()).not.toContain("Wrong repository");
  expect(text()).not.toContain("Report available");
});

it.each(["wrong-head", "wrong-origin", "missing-provenance", "missing-testing", "missing-proof-graph"])("rejects %s report data despite a matching target and preserves the previous report", async fault => {
  render(); await settle();
  const body = await generated().json();
  if (fault === "wrong-head") body.report.source.provenance.headSha = oldHead;
  if (fault === "wrong-origin") body.report.source.provenance.origin = "pasted_evidence";
  if (fault === "missing-provenance") delete body.report.source.provenance;
  if (fault === "missing-testing") delete body.report.testing;
  if (fault === "missing-proof-graph") delete body.report.proofGraph;
  fetchMock.mockResolvedValueOnce(Response.json(body));
  regenerateSameHead(7); await settle();
  expect(onGeneratedReport).not.toHaveBeenCalled();
  expect(text()).toContain("could not be matched");
  click("View report for PR #7"); expect(onOpenReport).toHaveBeenCalledWith("saved-7");
});

function field(label: string) { const node = nodes().find(n => n.type === "input" && n.props["aria-label"] === label); expect(node, label).toBeTruthy(); return node!; }
async function lookup(value: string) {
  field("Pull request number or URL").props.onChange({ target: { value } }); render();
  nodes().find(n => n.type === "form")!.props.onSubmit({ preventDefault() {} }); await settle();
}
it("opens a PR outside the recent list by number or same-repository URL through the existing PR lookup, and rejects other repositories", async () => {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (path, init) => path.includes("pullRequestNumber=42")
    ? Response.json({ repositoryId: 9, pullRequestNumber: 42, headSha: oldHead, pullRequest: { number: 42, title: "Older merged fix", state: "closed", headSha: oldHead }, commits: [] })
    : normal(path, init));
  render(); await settle();
  await lookup("https://github.com/other/repo/pull/42");
  expect(text()).toMatch(/another repository/i);
  expect(fetchMock.mock.calls.some(([path]) => path.includes("pullRequestNumber="))).toBe(false);
  await lookup("https://github.com/Owner/Repo/pull/42");
  expect(fetchMock.mock.calls.some(([path]) => path === "/api/dashboard/pull-requests?repositoryId=9&pullRequestNumber=42")).toBe(true);
  expect(text()).toContain("Older merged fix");
  action("Generate report for PR #42");
  await lookup("#7"); expect(onOpenReport).toHaveBeenLastCalledWith("saved-7");
});
it("keeps the open report for an unchanged head and regenerates only after explicit confirmation", async () => {
  render(); await settle();
  click("Regenerate report for PR #7");
  expect(onOpenReport).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.some(([path]) => path === "/api/dashboard/analyze")).toBe(false);
  click("Regenerate anyway for PR #7"); await settle();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dashboard/analyze")).toHaveLength(1);
});
it("keeps the warning directly below Regenerate through a history refresh and cancels without opening a report or posting", async () => {
  reports = [saved, { ...saved, id: "previous", createdAt: "2026-09-30T00:00:00Z" }];
  render(); await settle(); click("Regenerate report for PR #7");
  const versions = () => nodes().find(n => n.type === "details" && n.props.className === "dashboard-pr-versions")!;
  const warning = () => nodes(versions()).find(n => n.props.className === "dashboard-shelf-confirm");
  expect(warning()).toBeTruthy();
  const children = nodes(versions());
  expect(children.indexOf(warning())).toBeGreaterThan(children.indexOf(action("Regenerate report for PR #7")));
  expect(children.indexOf(warning())).toBeLessThan(children.findIndex(n => n.type === "ol"));
  reports = [{ ...saved, id: "new-history", createdAt: "2026-10-01T02:00:00Z" }, ...reports];
  click("Refresh pull requests"); await settle();
  expect(warning()).toBeTruthy();
  expect(onOpenReport).not.toHaveBeenCalled();
  nodes(warning()).find(n => n.type === "button" && text(n) === "Cancel")!.props.onClick(); render();
  expect(warning()).toBeUndefined();
  expect(onOpenReport).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dashboard/analyze")).toHaveLength(0);
});
it("never starts paid generation from repeated clicks on the ordinary regenerate button", async () => {
  render(); await settle();
  const button = action("Regenerate report for PR #7"); button.props.onClick(); button.props.onClick(); render();
  action("Regenerate report for PR #7").props.onClick(); render();
  expect(fetchMock.mock.calls.some(([path]) => path === "/api/dashboard/analyze")).toBe(false);
  action("Regenerate anyway for PR #7");
});
it("ignores a late PR lookup after the repository changes and does not accept new input while a lookup is running", async () => {
  let finish!: (value: Response) => void;
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, init) => path.includes("pullRequestNumber=42") ? new Promise(resolve => { finish = resolve; }) : normal(path, init));
  render(); await settle();
  field("Pull request number or URL").props.onChange({ target: { value: "42" } }); render();
  nodes().find(n => n.type === "form")!.props.onSubmit({ preventDefault() {} }); render();
  expect(field("Pull request number or URL").props.disabled).toBe(true);
  field("Pull request number or URL").props.onChange({ target: { value: "43" } }); render();
  expect(field("Pull request number or URL").props.value).toBe("42");
  repositoryId = 10; reports = []; render(); await settle();
  finish(Response.json({ pullRequest: { number: 42, title: "Late result", state: "open", headSha: oldHead } })); await settle();
  expect(text()).not.toContain("Late result");
  expect(text()).not.toMatch(/not found or not accessible/);
});
it("regenerates without asking when the PR head has moved since the saved report", async () => {
  reports = [{ ...saved, headSha: oldHead }];
  render(); await settle();
  click("Regenerate report for PR #7"); await settle();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dashboard/analyze")).toHaveLength(1);
});

function pendingAnalyses() {
  const pending = new Map<number, (value: Response) => void>();
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, init) => path === "/api/dashboard/analyze"
    ? new Promise(resolve => { pending.set(Number(JSON.parse(String(init!.body)).prUrl.split("/").at(-1)), resolve); })
    : normal(path, init));
  return pending;
}
function generatedFor(number: number) {
  return generated({status: "saved", id: `new-${number}`, createdAt: `2026-10-01T01:00:0${number}Z`},
    {repositoryId: 9, pullRequestNumber: number, headSha: number === 7 ? fetchedHead : "e".repeat(40)});
}
it("runs independent PR analyses with per-PR locks and preserves both cached reports on reverse completion", async () => {
  cache = new Map(); const pending = pendingAnalyses(); render(); await settle();
  click("Select PR #7"); click("Regenerate report for PR #7");
  const first = action("Regenerate anyway for PR #7"); first.props.onClick(); first.props.onClick(); render();
  expect(action("Regenerate report for PR #7").props.disabled).toBe(true);
  click("Select PR #8"); expect(action("Generate report for PR #8").props.disabled).toBe(false);
  const second = action("Generate report for PR #8"); second.props.onClick(); second.props.onClick(); render();
  const requests = fetchMock.mock.calls.filter(([path]) => path === "/api/dashboard/analyze");
  expect(requests.map(([,init]) => JSON.parse(String(init!.body)).prUrl)).toEqual(["https://github.com/owner/repo/pull/7", "https://github.com/owner/repo/pull/8"]);
  expect(requests[0][1]!.signal).not.toBe(requests[1][1]!.signal);
  expect(action("Generate report for PR #8").props.disabled).toBe(true);
  for (const number of [7,8]) expect(text(nodes().find(n => n.type === "li" && nodes(n).some(b=>b.props["aria-label"]===`Select PR #${number}`)))).toContain("Generating");
  pending.get(8)!(generatedFor(8)); await settle();
  expect(onGeneratedReport).toHaveBeenCalledTimes(1); expect(onGeneratedReport).toHaveBeenLastCalledWith(expect.objectContaining({id:"new-8",pullRequestNumber:8}));
  expect(action("Regenerate report for PR #8").props.disabled).toBe(false);
  click("Select PR #7"); expect(action("Regenerate report for PR #7").props.disabled).toBe(true);
  click("Select PR #8"); pending.get(7)!(generatedFor(7)); await settle();
  expect(onGeneratedReport).toHaveBeenCalledTimes(1); expect(text()).not.toContain(`Saved · analyzed head ${fetchedHead.slice(0,12)}`);
  const stored=cache.get(9)!; expect(stored.pullRequests.map(p=>p.headSha)).toEqual([fetchedHead,"e".repeat(40)]);
  expect(stored.history!.filter(r=>r.freshness==='current').map(r=>r.id).sort()).toEqual(['new-7','new-8']);
  expect(stored.history!.find(r=>r.id==='saved-7')!.freshness).toBe('stale');
  click("Select PR #7"); click("View report for PR #7"); expect(onOpenReport).toHaveBeenLastCalledWith('new-7');
  click("Select PR #8"); click("View report for PR #8"); expect(onOpenReport).toHaveBeenLastCalledWith('new-8');
});
it.each([7,8])("keeps parallel PR %s failure separate across opposite completion orders", async failed => {
  cache=new Map();const pending=pendingAnalyses();render();await settle();regenerateSameHead(7);click("Select PR #8");
  expect(action("Generate report for PR #8").props.disabled).toBe(false);click("Generate report for PR #8");
  const success=failed===7?8:7;
  if(failed===7){
    pending.get(8)!(generatedFor(8));await settle();expect(onGeneratedReport).toHaveBeenLastCalledWith(expect.objectContaining({pullRequestNumber:8}));
    pending.get(7)!(Response.json({error:'PR 7 unavailable'},{status:503}));await settle();
    expect(text()).not.toContain('Analysis did not finish.');expect(text()).toContain('Saved · analyzed head');
  }else{
    pending.get(8)!(Response.json({error:'PR 8 unavailable'},{status:503}));await settle();
    click('Select PR #7');expect(text()).not.toContain('Analysis did not finish.');expect(action('Regenerate report for PR #7').props.disabled).toBe(true);
    pending.get(7)!(generatedFor(7));await settle();expect(text()).toContain('Saved · analyzed head');
  }
  expect(cache.get(9)!.history!.some(r=>r.id===`new-${success}`)).toBe(true);
  click(`Select PR #${failed}`);expect(text()).toContain("Analysis did not finish.");expect(text()).not.toContain(`PR ${failed} unavailable`);expect(cache.get(9)!.history!.some(r=>r.id===`new-${failed}`)).toBe(false);
});
it.each(['repository change','unmount'])('aborts every parallel request on %s and ignores late completions',async exit=>{
  cache=new Map();const pending=pendingAnalyses();render();await settle();regenerateSameHead(7);click('Select PR #8');
  expect(action('Generate report for PR #8').props.disabled).toBe(false);click('Generate report for PR #8');
  const requests=fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze');const before=JSON.stringify(cache.get(9));
  if(exit==='repository change'){repositoryId=10;reports=[];render();await settle();}else hooks.slots.forEach(s=>s?.cleanup?.());
  expect(requests).toHaveLength(2);expect(requests.every(([,i])=>i!.signal!.aborted)).toBe(true);
  pending.get(8)!(generatedFor(8));pending.get(7)!(generatedFor(7));for(let n=0;n<24;n++)await Promise.resolve();
  expect(onGeneratedReport).not.toHaveBeenCalled();expect(JSON.stringify(cache.get(9))).toBe(before);
  if(exit==='repository change'){
    render();expect(text()).not.toContain('Saved · analyzed head');
    repositoryId=9;reports=[saved];render();await settle();click('Select PR #7');expect(action('Regenerate report for PR #7').props.disabled).toBe(false);
  }
});
it('keeps existing disabled and missing-PR metadata guards with independent progress',async()=>{
  canGenerate=false;render();await settle();expect(action('Regenerate report for PR #7').props.disabled).toBe(true);regenerateSameHead(7);
  expect(fetchMock.mock.calls.some(([p])=>p==='/api/dashboard/analyze')).toBe(false);
  hooks.slots.forEach(s=>s?.cleanup?.());hooks.slots=[];canGenerate=true;reports=[];
  const normal=fetchMock.getMockImplementation()!;fetchMock.mockImplementation((p,i)=>p.includes('pull-requests')?Promise.resolve(Response.json({pullRequests:[]})):normal(p,i));
  render();await settle();expect(nodes().some(n=>n.type==='button'&&/^(Generate|Regenerate).*report/.test(n.props['aria-label']??''))).toBe(false);
  expect(fetchMock.mock.calls.some(([p])=>p==='/api/dashboard/analyze')).toBe(false);
});

it('developer client traces preserve two PR request IDs across reverse completion and selection changes',async()=>{
 vi.stubEnv('NEXT_PUBLIC_AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});clearAnalysisClientDiagnostics();
 try{
 const pending=pendingAnalyses();render();await settle();regenerateSameHead(7);click('Select PR #8');click('Generate report for PR #8');
 const requests=fetchMock.mock.calls.filter(([path])=>path==='/api/dashboard/analyze');const ids=requests.map(([,init])=>(init!.headers as Record<string,string>)['x-agentproof-analysis-key']);expect(new Set(ids).size).toBe(2);
 for(const n of [8,7]){const response=generatedFor(n);response.headers.set('x-agentproof-diagnostic-request',ids[n===7?0:1]);pending.get(n)!(response);await settle();}
 const es=readAnalysisClientDiagnostics();for(const id of ids){const own=es.filter(e=>e.client===id);expect(own.filter(e=>e.phase==='fetch_start')).toHaveLength(1);expect(own.find(e=>e.phase==='headers')?.correlation).toBe(id);expect(own.some(e=>e.phase==='body_parsed')).toBe(true);}
 expect(es.find(e=>e.client===ids[0]&&e.phase==='view_ignored')).toBeDefined();expect(es.find(e=>e.client===ids[1]&&e.phase==='view_selected')).toBeDefined();expect(onGeneratedReport).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllEnvs();info.mockRestore();clearAnalysisClientDiagnostics();}
});
it('records pre-header TypeError and cleanup abort without logging exception text or changing UI guards',async()=>{
 vi.stubEnv('NEXT_PUBLIC_AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});clearAnalysisClientDiagnostics();
 try{
 render();await settle();fetchMock.mockImplementation(async path=>{if(path==='/api/dashboard/analyze')throw new TypeError('Load failed private-secret-canary');return Response.json({reports:[],hasMore:false});});regenerateSameHead(7);await settle();
 expect(readAnalysisClientDiagnostics().some(e=>e.phase==='network_error')).toBe(true);expect(JSON.stringify(readAnalysisClientDiagnostics())).not.toContain('private-secret-canary');
 const pending=pendingAnalyses();click('Select PR #8');click('Generate report for PR #8');repositoryId=10;reports=[];render();await settle();expect(readAnalysisClientDiagnostics().some(e=>e.phase==='abort')).toBe(true);expect(pending.size).toBe(1);
 }finally{vi.unstubAllEnvs();info.mockRestore();clearAnalysisClientDiagnostics();}
});

const recoveryStart = Date.parse('2026-10-15T07:00:00.000Z');
const recoveredMessage = 'A new saved report was found. The earlier response was not confirmed.';
const networkMessage = 'Response not received. Server completion is unknown. Check saved reports before generating again.';
function rejectAnalysisTransport() {
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((path, init) => path === '/api/dashboard/analyze'
    ? Promise.reject(new TypeError('Load failed')) : normal(path, init));
}
const recoveryReport = (overrides: Record<string, unknown> = {}) => ({ ...saved, id: 'recovered-7', createdAt: new Date(recoveryStart).toISOString(), ...overrides });

it('reconciles a failed response only after reading a new saved version for its PR and head, without another analysis', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    reports = [recoveryReport()]; click('Refresh pull requests'); await settle();
    expect(text()).toContain(recoveredMessage); expect(text()).not.toContain('Load failed');
    expect(onGeneratedReport).not.toHaveBeenCalled();
    click('View report for PR #7'); expect(onOpenReport).toHaveBeenLastCalledWith('recovered-7');
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/dashboard/analyze')).toHaveLength(1);
  } finally { clock.mockRestore(); }
});
it('explains an unreceived response and checks history without automatically generating again', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    expect(text()).toContain(networkMessage);
    click('Check saved reports for PR #7'); await settle();
    expect(text()).toContain(networkMessage); expect(text()).not.toContain(recoveredMessage);
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/dashboard/analyze')).toHaveLength(1);
  } finally { clock.mockRestore(); }
});
it.each([
  ['known ID', { id: saved.id }],
  ['older timestamp', { createdAt: new Date(recoveryStart - 1).toISOString() }],
  ['missing timestamp', { createdAt: undefined }],
  ['invalid timestamp', { createdAt: 'invalid' }],
  ['different head', { headSha: oldHead }],
  ['different PR', { pullRequestNumber: 8 }],
  ['different repository', { repositoryId: 10 }],
  ['unavailable record', { availability: 'unavailable' }],
  ['stale version', { staleAt: new Date(recoveryStart + 1).toISOString(), freshness: 'stale' }],
  ['newer refresh failure', { freshness: 'refresh_failed' }]
])('keeps the network error when history contains only %s', async (_label, fields) => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    reports = [recoveryReport(fields)]; click('Refresh pull requests'); await settle();
    expect(text()).toContain(networkMessage); expect(text()).not.toContain(recoveredMessage);
  } finally { clock.mockRestore(); }
});
it('does not hide an HTTP authorization failure just because a new report exists', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); fetchMock.mockResolvedValueOnce(Response.json({ error: 'Sign in again' }, { status: 401 }));
    regenerateSameHead(7); await settle(); reports = [recoveryReport()]; click('Refresh pull requests'); await settle();
    expect(text()).toContain('Sign in again'); expect(text()).not.toContain(recoveredMessage);
  } finally { clock.mockRestore(); }
});
it('keeps a failed history read and the original response uncertainty separate', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    const normal = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((p, i) => p.includes('scope=history') ? Promise.resolve(Response.json({ error: 'Unauthorized' }, { status: 401 })) : normal(p, i));
    click('Check saved reports for PR #7'); await settle();
    expect(text()).toContain(networkMessage); expect(text()).toContain('Saved report history could not be loaded');
    expect(text()).not.toContain(recoveredMessage);
  } finally { clock.mockRestore(); }
});
it('blocks a duplicate analysis while a saved-result check is pending', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    let finish!: (response: Response) => void;
    const normal = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((p, i) => p.includes('scope=history') ? new Promise(resolve => { finish = resolve; }) : normal(p, i));
    click('Refresh pull requests'); await settle();
    clock.mockReturnValue(recoveryStart + 1000); regenerateSameHead(7); await settle();
    finish(Response.json({ reports: [recoveryReport({ createdAt: new Date(recoveryStart + 2000).toISOString() })], hasMore: false })); await settle();
    expect(text()).toContain(recoveredMessage); expect(text()).not.toContain(networkMessage);
    expect(fetchMock.mock.calls.filter(([p]) => p === '/api/dashboard/analyze')).toHaveLength(1);
  } finally { clock.mockRestore(); }
});
it('retains a new failure started after the recovered report was saved', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    reports = [recoveryReport()]; click('Refresh pull requests'); await settle(); expect(text()).toContain(recoveredMessage);
    clock.mockReturnValue(recoveryStart + 1000); regenerateSameHead(7); await settle(); click('Refresh pull requests'); await settle();
    expect(text()).toContain(networkMessage); expect(text()).not.toContain(recoveredMessage);
  } finally { clock.mockRestore(); }
});
it('recovers one PR without clearing another PR failure', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    click('Select PR #8'); click('Generate report for PR #8'); await settle();
    reports = [recoveryReport()]; click('Select PR #7'); click('Check saved reports for PR #7'); await settle();
    expect(text()).toContain(recoveredMessage); click('Select PR #8'); expect(text()).toContain(networkMessage);
    expect(action('Generate report for PR #8').props.disabled).toBe(false);
  } finally { clock.mockRestore(); }
});
it('reads recovery history while another PR remains pending, then keeps its independent completion', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    cache = new Map(); render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    const pending = pendingAnalyses(); click('Select PR #8'); click('Generate report for PR #8');
    const request = fetchMock.mock.calls.filter(([p]) => p === '/api/dashboard/analyze').at(-1)!;
    reports = [recoveryReport()]; click('Select PR #7'); click('Check saved reports for PR #7'); await settle();
    expect(text()).toContain(recoveredMessage); expect(request[1]!.signal!.aborted).toBe(false);
    click('Select PR #8'); expect(action('Generate report for PR #8').props.disabled).toBe(true);
    pending.get(8)!(generatedFor(8)); await settle();
    expect(cache!.get(9)!.history!.some(report => report.id === 'new-8')).toBe(true);
    expect(text()).toContain('Saved · analyzed head');
    expect(onGeneratedReport).not.toHaveBeenCalled();
    click('View report for PR #8'); expect(onOpenReport).toHaveBeenLastCalledWith('new-8');
  } finally { clock.mockRestore(); }
});
it('keeps the newer network failure when two unconfirmed attempts could own a newly saved version', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
    clock.mockReturnValue(recoveryStart + 1000); regenerateSameHead(7); await settle();
    reports = [recoveryReport({ createdAt: new Date(recoveryStart + 2000).toISOString() })];
    click('Refresh pull requests'); await settle();
    expect(text()).toContain(networkMessage); expect(text()).not.toContain(recoveredMessage);
    click('View report for PR #7'); expect(onOpenReport).toHaveBeenLastCalledWith('recovered-7');
  } finally { clock.mockRestore(); }
});

it.each([
  ['internal_tenant_config', 'Analysis did not finish. Existing saved reports remain available.'],
  ['github_private_consent_required', 'Open repository settings to continue.']
])('maps generation HTTP failure %s without arbitrary server prose', async (code, expected) => {
  render(); await settle();
  fetchMock.mockResolvedValueOnce(Response.json({ error: 'RAW_CONFIG_CANARY tenant=private', code }, { status: 503 }));
  regenerateSameHead(7); await settle();
  expect(text()).toContain(expected); expect(text()).not.toContain('RAW_CONFIG_CANARY'); expect(text()).not.toContain(code);
});


const checkingMessage = 'Checking results…';
it('checks one history read before presenting an unreceived analysis as uncertain, never posting twice', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); rejectAnalysisTransport();
    const normal = fetchMock.getMockImplementation()!;
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation((p,i) => p.includes('scope=history') ? new Promise(resolve => {finish=resolve;}) : normal(p,i));
    regenerateSameHead(7); await settle(); await settle();
    expect(text()).toContain(checkingMessage);
    expect(nodes().find(n=>n.type==='p' && text(n).includes(checkingMessage))?.props.role).toBe('status');
    expect(action('Regenerate report for PR #7').props.disabled).toBe(true);
    finish(Response.json({reports:[recoveryReport()],hasMore:false})); await settle();
    expect(text()).toContain(recoveredMessage); expect(text()).not.toContain('Analysis did not finish');
    expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([p])=>p.includes('scope=history'))).toHaveLength(2);
    await settle(); expect(fetchMock.mock.calls.filter(([p])=>p.includes('scope=history'))).toHaveLength(2);
  } finally {clock.mockRestore();}
});
it('defers background response recovery until return, then reads unchanged history once and stops unconfirmed', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); vi.stubGlobal('document',{visibilityState:'hidden'}); rejectAnalysisTransport();
    regenerateSameHead(7); await settle(); await settle();
    expect(text()).toContain('Checking saved reports. Server completion is not yet confirmed.');
    expect(nodes().some(n=>n.props['aria-busy']===true)).toBe(false);
    expect(fetchMock.mock.calls.filter(([p])=>p.includes('scope=history'))).toHaveLength(1);
    vi.stubGlobal('document',{visibilityState:'visible'}); ++resumeKey; render(); await settle();
    expect(text()).toContain(networkMessage); expect(text()).not.toContain(recoveredMessage);
    expect(nodes().find(n=>text(n)===networkMessage)?.props.role).toBe('status');
    expect(fetchMock.mock.calls.filter(([p])=>p.includes('scope=history'))).toHaveLength(2);
    await settle(); expect(fetchMock.mock.calls.filter(([p])=>p.includes('scope=history'))).toHaveLength(2);
    reports=[recoveryReport()]; ++resumeKey; render(); await settle();
    expect(text()).toContain(recoveredMessage);
    expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
  } finally {clock.mockRestore();}
});
it('recovers a body transport interruption after 200 headers without accepting a malformed JSON result', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(recoveryStart);
  try {
    render(); await settle(); reports=[recoveryReport()];
    const response=generated(); response.json=async()=>{throw new TypeError('Load failed secret-canary');};
    fetchMock.mockResolvedValueOnce(response); regenerateSameHead(7); await settle(); await settle();
    expect(text()).toContain(recoveredMessage); expect(text()).not.toContain('secret-canary');
    expect(onGeneratedReport).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
  } finally {clock.mockRestore();}
});
it.each([401,503])('keeps a known HTTP %s failure when its body also fails and a new report is visible on return', async status => {
  const clock = vi.spyOn(Date,'now').mockReturnValue(recoveryStart);
  try {
    render();await settle();const response=Response.json({}, {status});response.json=async()=>{throw new TypeError('Load failed');};
    fetchMock.mockResolvedValueOnce(response);regenerateSameHead(7);await settle();reports=[recoveryReport()];++resumeKey;render();await settle();
    expect(text()).toContain(status===401?'Sign in again':'Analysis did not finish');expect(text()).not.toContain(recoveredMessage);
    expect(nodes().some(n=>n.props.role==='alert')).toBe(true);
    expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
  } finally {clock.mockRestore();}
});
it('does not recover a malformed successful JSON response from the existence of a new report',async()=>{
  render();await settle();fetchMock.mockResolvedValueOnce(new Response('not JSON',{status:200}));regenerateSameHead(7);await settle();
  reports=[recoveryReport()];++resumeKey;render();await settle();
  expect(text()).toContain('The result could not be matched');expect(text()).not.toContain(recoveredMessage);
});
it("keeps the selected PR's saved versions in one disclosure under its row, and no-report generation stays visible", async () => {
  render(); await settle(); click("Select PR #7");
  const row = (number: number) => nodes().find(n => n.type === "li" && nodes(n).some(b => b.props["aria-label"] === `Select PR #${number}`))!;
  const versions = nodes(row(7)).find(n => n.type === "details" && n.props.className === "dashboard-pr-versions")!;
  expect(versions).toBeTruthy();
  for (const label of ["View report for PR #7", "Regenerate report for PR #7"]) expect(nodes(versions).some(n => n.props["aria-label"] === label)).toBe(true);
  expect(nodes().some(n => n.props["aria-label"] === "Saved report versions")).toBe(false);
  click("Select PR #8");
  expect(nodes(row(8)).some(n => n.type === "details")).toBe(false);
  expect(nodes(row(8)).some(n => n.props["aria-label"] === "Generate report for PR #8")).toBe(true);
  expect(nodes(row(7)).some(n => n.props.className === "dashboard-pr-shelf")).toBe(false);
});

it('shows an accessible checking spinner and synchronously blocks same-PR generation and duplicate checks', async () => {
  render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
  let finish!: (r: Response) => void;
  const normal = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((p,i) => p.includes('scope=history') ? new Promise(resolve => { finish=resolve; }) : normal(p,i));
  const check = action('Check saved reports for PR #7').props.onClick;
  const staleConfirm = action('Regenerate report for PR #7').props.onClick;
  const reads = fetchMock.mock.calls.filter(([p])=>p.includes('scope=history')).length;
  check(); check(); staleConfirm(); render(); await settle();
  const checking = nodes().find(n=>n.props.role==='status' && n.props['aria-busy']===true);
  expect(checking).toBeTruthy(); expect(text(checking)).toContain('Checking results…');
  expect(nodes(checking).some(n=>n.props.className==='spin' && n.props['aria-hidden']===true)).toBe(true);
  expect(action('Regenerate report for PR #7').props.disabled).toBe(true);
  expect(fetchMock.mock.calls.filter(([p])=>p.includes('scope=history'))).toHaveLength(reads+1);
  click('Select PR #8'); expect(action('Generate report for PR #8').props.disabled).toBe(false);
  finish(Response.json({reports:[saved],hasMore:false})); await settle(); click('Select PR #7');
  expect(nodes().some(n=>n.props['aria-busy']===true)).toBe(false);
  expect(action('Regenerate report for PR #7').props.disabled).toBe(false);
  expect(text()).toContain(networkMessage);
  expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
});

it('uses the existing repository language for the active check and unlocks after a failed read', async () => {
  reportLanguage='ko'; render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
  let fail!: (e: Error) => void;
  const normal=fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((p,i)=>p.includes('scope=history') ? new Promise((_r,reject)=>{fail=reject;}) : normal(p,i));
  click('Check saved reports for PR #7'); await settle();
  expect(text()).toContain('결과 확인 중…'); expect(action('Regenerate report for PR #7').props.disabled).toBe(true);
  fail(new TypeError('private-canary')); await settle();
  expect(action('Regenerate report for PR #7').props.disabled).toBe(false);
  expect(text()).toContain('저장된 보고서 확인'); expect(text()).toContain(networkMessage);
  expect(text()).not.toContain('private-canary');
});

it('aborts a pending history check on repository change and ignores its late result', async () => {
  render(); await settle(); rejectAnalysisTransport(); regenerateSameHead(7); await settle();
  let finish!: (r:Response)=>void; let signal:AbortSignal | undefined;
  const normal=fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((p,i)=>p.includes('scope=history') && p.includes('repositoryId=9&')
    ? new Promise(resolve=>{finish=resolve;signal=i?.signal as AbortSignal;}) : normal(p,i));
  click('Check saved reports for PR #7'); await settle();
  repositoryId=10; render(); await settle(); expect(signal?.aborted).toBe(true);
  finish(Response.json({reports:[recoveryReport()],hasMore:false})); await settle();
  expect(text()).not.toContain(recoveredMessage); expect(nodes().some(n=>n.props['aria-busy']===true)).toBe(false);
  expect(action('Generate report for PR #7').props.disabled).toBe(false);
  expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
});

function queueJob(number=7, overrides:Record<string,unknown>={}) {return {id:`00000000-0000-4000-8000-${String(number).padStart(12,'0')}`,revision:1,updatedAt:new Date().toISOString(),repositoryId:9,pullRequestNumber:number,headSha:number===7?fetchedHead:'e'.repeat(40),status:'queued',...overrides};}
async function queueDetail(number=7){const b=await generatedFor(number).json();return {id:b.persistence.id,repositoryId:9,pullRequestNumber:number,headSha:b.target.headSha,createdAt:b.persistence.createdAt,report:b.report,availability:'available',freshness:'current',copyEligible:true};}
it('keeps accepted work pending until a matching signed saved result is read, without another POST',async()=>{
 const normal=fetchMock.getMockImplementation()!;let state='queued';const detail=await queueDetail();
 fetchMock.mockImplementation((p,i)=>p==='/api/dashboard/analyze'?Promise.resolve(Response.json({accepted:true,job:queueJob()},{status:202}))
   :p.startsWith('/api/dashboard/analyze?')?Promise.resolve(Response.json({job:queueJob(7,{status:state,...(state==='saved'?{reportId:detail.id}:{})})}))
   :p.startsWith('/api/dashboard/reports?id=')?Promise.resolve(Response.json(detail)):normal(p,i));
 render();await settle();regenerateSameHead(7);await settle();
 expect(text()).toContain('Analysis queued');expect(text()).not.toContain('Saved · analyzed');expect(onGeneratedReport).not.toHaveBeenCalled();
 expect(action('Regenerate report for PR #7').props.disabled).toBe(true);click('Select PR #8');expect(action('Generate report for PR #8').props.disabled).toBe(false);
 click('Select PR #7');state='saved';click('Check saved reports for PR #7');await settle();
 expect(text()).toContain('Saved · analyzed');expect(action('Regenerate report for PR #7').props.disabled).toBe(false);
 expect(onGeneratedReport).not.toHaveBeenCalled(); // changing the selection/version while queued is respected
 expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
});
it('rediscovers an active server job after reopening and never posts just to resume it',async()=>{
 const normal=fetchMock.getMockImplementation()!;const job=queueJob(7,{headSha:head});
 fetchMock.mockImplementation((p,i)=>p.includes('scope=history')?Promise.resolve(Response.json({reports,jobs:[job],hasMore:false}))
   :p.startsWith('/api/dashboard/analyze?')?Promise.resolve(Response.json({job:{...job,status:'running'}})):normal(p,i));
 render();await settle();expect(text()).toContain('Analyzing on the server');expect(action('Regenerate report for PR #7').props.disabled).toBe(true);
 expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(0);
});
it('aborts only local status reads when closing; the accepted server job is not cancelled or re-posted',async()=>{
 const normal=fetchMock.getMockImplementation()!;let statusSignal:AbortSignal|undefined;
 fetchMock.mockImplementation((p,i)=>p==='/api/dashboard/analyze'?Promise.resolve(Response.json({accepted:true,job:queueJob()},{status:202}))
   :p.startsWith('/api/dashboard/analyze?')?new Promise((_r,reject)=>{statusSignal=i?.signal as AbortSignal;statusSignal.addEventListener('abort',()=>reject(new DOMException('','AbortError')),{once:true});}):normal(p,i));
 render();await settle();regenerateSameHead(7);await settle();expect(statusSignal?.aborted).toBe(false);
 hooks.slots.forEach(s=>s?.cleanup?.());expect(statusSignal?.aborted).toBe(true);
 expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
 expect(fetchMock.mock.calls.some(([,i])=>i?.method==='DELETE')).toBe(false);
});
it.each([401,403,503])('keeps queued status HTTP %s distinct from analysis success and never retries POST',async(status)=>{
 const normal=fetchMock.getMockImplementation()!;
 fetchMock.mockImplementation((p,i)=>p==='/api/dashboard/analyze'?Promise.resolve(Response.json({accepted:true,job:queueJob()},{status:202}))
   :p.startsWith('/api/dashboard/analyze?')?Promise.resolve(Response.json({error:'private-server-canary'},{status})):normal(p,i));
 render();await settle();regenerateSameHead(7);await settle();expect(text()).not.toContain('Saved · analyzed');expect(text()).not.toContain('private-server-canary');
 expect(text()).toContain(status===401?'Sign in again':status===403?'Open repository settings':'Status could not be checked');
 expect(action('Regenerate report for PR #7').props.disabled).toBe(status===503);
 expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
});
it('keeps two queued PRs independent when the selected PR completes first and the other fails later',async()=>{
 const normal=fetchMock.getMockImplementation()!;const states:Record<number,string>={7:'queued',8:'running'};const details={7:await queueDetail(7),8:await queueDetail(8)};
 fetchMock.mockImplementation((p,i)=>{
  if(p==='/api/dashboard/analyze'){const n=Number(JSON.parse(String(i?.body)).prUrl.split('/').pop());return Promise.resolve(Response.json({accepted:true,job:queueJob(n)},{status:202}));}
  if(p.startsWith('/api/dashboard/analyze?')){const n=p.includes('000000000007')?7:8;return Promise.resolve(Response.json({job:queueJob(n,{status:states[n],...(states[n]==='saved'?{reportId:details[n].id}:{})})}));}
  if(p.startsWith('/api/dashboard/reports?id='))return Promise.resolve(Response.json(details[8]));
  return normal(p,i);
 });
 render();await settle();regenerateSameHead(7);await settle();click('Select PR #8');click('Generate report for PR #8');await settle();
 expect(action('Generate report for PR #8').props.disabled).toBe(true);states[8]='saved';click('Check saved reports for PR #8');await settle();
 expect(onGeneratedReport).toHaveBeenCalledOnce();expect(onGeneratedReport).toHaveBeenLastCalledWith(expect.objectContaining({pullRequestNumber:8}));
 click('Select PR #7');states[7]='failed';click('Check saved reports for PR #7');await settle();expect(text()).toContain('Analysis did not finish');
 expect(onGeneratedReport).toHaveBeenCalledOnce();expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(2);
});
it('backs off unavailable job reads, allows one explicit check, and rejects a saved acknowledgement from a different head',async()=>{
 const normal=fetchMock.getMockImplementation()!;let mode='unavailable';const detail=await queueDetail();
 fetchMock.mockImplementation((p,i)=>p==='/api/dashboard/analyze'?Promise.resolve(Response.json({accepted:true,job:queueJob()},{status:202}))
  :p.startsWith('/api/dashboard/analyze?')?mode==='unavailable'?Promise.reject(new TypeError('synthetic')):Promise.resolve(Response.json({job:queueJob(7,{status:'saved',reportId:detail.id})}))
  :p.startsWith('/api/dashboard/reports?id=')?Promise.resolve(Response.json({...detail,headSha:'f'.repeat(40)})):normal(p,i));
 render();await settle();regenerateSameHead(7);await settle();const before=fetchMock.mock.calls.filter(([p])=>p.startsWith('/api/dashboard/analyze?')).length;
 ++resumeKey;render();await settle();expect(fetchMock.mock.calls.filter(([p])=>p.startsWith('/api/dashboard/analyze?'))).toHaveLength(before+1);
 mode='saved';const check=action('Check saved reports for PR #7').props.onClick;check();check();render();await settle();
 expect(fetchMock.mock.calls.filter(([p])=>p.startsWith('/api/dashboard/analyze?'))).toHaveLength(before+2);
 expect(text()).toContain('Status could not be checked');expect(text()).not.toContain('Saved · analyzed');expect(onGeneratedReport).not.toHaveBeenCalled();
 expect(action('Regenerate report for PR #7').props.disabled).toBe(true);expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
});
it('does not lock forever or claim success when a terminal job has no confirmed saved result',async()=>{
 const normal=fetchMock.getMockImplementation()!;
 fetchMock.mockImplementation((p,i)=>p==='/api/dashboard/analyze'?Promise.resolve(Response.json({accepted:true,job:queueJob()},{status:202}))
  :p.startsWith('/api/dashboard/analyze?')?Promise.resolve(Response.json({job:queueJob(7,{status:'unknown'})})):normal(p,i));
 render();await settle();regenerateSameHead(7);await settle();expect(text()).toContain('Analysis ended without a confirmed saved result');expect(onGeneratedReport).not.toHaveBeenCalled();
 expect(action('Regenerate report for PR #7').props.disabled).toBe(false);click('Check saved reports for PR #7');await settle();expect(text()).toContain('Analysis ended without a confirmed saved result');
 expect(fetchMock.mock.calls.filter(([p])=>p==='/api/dashboard/analyze')).toHaveLength(1);
});
