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
let tree: any, repositoryId: number, reports: any[], runtime: any;
let fetchMock: ReturnType<typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>>;
let onOpenReport: ReturnType<typeof vi.fn<(id: string) => void>>;
let onGeneratedReport: ReturnType<typeof vi.fn<(detail: import("@/lib/github-dashboard-view-model").DashboardReportDetail) => void>>;
function nodes(value: any = tree): any[] { return Array.isArray(value) ? value.flatMap(n=>nodes(n)) : value?.props ? [value, ...nodes(value.props.children ?? null)] : []; }
function text(value: any = tree): string { return Array.isArray(value) ? value.map(v=>text(v)).join(" ") : value?.props ? text(value.props.children ?? null) : typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function render() {
  hooks.index = 0;
  tree = RepositoryPullRequestWorkspace({ repositoryId, repositoryFullName: repositoryId === 9 ? "owner/repo" : "owner/second", runtime, onOpenReport, onGeneratedReport });
  hooks.effects.splice(0).forEach(work=>work());
}
async function settle() { for(let i=0;i<24;i++) await Promise.resolve(); render(); }
function action(label: string) { const node = nodes().find(n=>n.type === "button" && n.props["aria-label"] === label); expect(node, label).toBeTruthy(); return node!; }
function click(label: string) { action(label).props.onClick(); render(); }
/** An unchanged head opens its saved report first; generation needs the explicit confirmation. */
function regenerateSameHead(number: number) { click(`Regenerate report for PR #${number}`); click(`Regenerate anyway for PR #${number}`); }
function generated(persistence: any = { status: "saved", id: "saved-new", createdAt: "2026-10-01T01:00:00Z" }, target = { repositoryId: 9, pullRequestNumber: 7, headSha: fetchedHead }) {
  const report = prepareTenantDetailReportForStorage(generateVerificationReportV2FromInput({ ...demoScenarios.clean,
    url: "https://github.com/owner/repo/pull/7", sourceProvenance: {
      version: 1, origin: "github_snapshot", headSha: fetchedHead, baseSha: oldHead,
      evidenceCapturedAt: "2026-10-01T01:00:00Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "d".repeat(64), coverage: "github_metadata" }
    }
  }), "verified_agentproof", "test-report-signing-secret-that-is-long-enough");
  return Response.json({ target, persistence, report });
}
beforeEach(() => {
  hooks.slots = []; hooks.index = 0; hooks.effects = []; repositoryId = 9; reports = [saved];
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
  expect(text()).toContain("GitHub unavailable"); expect(onGeneratedReport).not.toHaveBeenCalled();
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
it("opens the saved report for an unchanged head and regenerates only after explicit confirmation", async () => {
  render(); await settle();
  click("Regenerate report for PR #7");
  expect(onOpenReport).toHaveBeenLastCalledWith("saved-7");
  expect(fetchMock.mock.calls.some(([path]) => path === "/api/dashboard/analyze")).toBe(false);
  click("Regenerate anyway for PR #7"); await settle();
  expect(fetchMock.mock.calls.filter(([path]) => path === "/api/dashboard/analyze")).toHaveLength(1);
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
