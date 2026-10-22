import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { DetailedEvidence, PublicGitHubDashboard, QuickSummaryPanel } from "./PublicGitHubDashboard";
import { RepositoryPullRequestWorkspace } from "./RepositoryCommitBrowser";

// Exercise the component's real handlers and async state changes without a DOM dependency.
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => unknown> }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState(initial: any) {
    const index = hooks.index++;
    const slots = hooks.slots;
    if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
    return [slots[index], (value: any) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  },
  useRef(initial: any) {
    const index = hooks.index++;
    return hooks.slots[index] ??= { current: initial };
  },
  useMemo(work: () => unknown) { return work(); },
  useEffect(work: () => unknown, deps: unknown[]) {
    const index = hooks.index++;
    const previous = hooks.slots[index];
    if (!previous || deps.some((value, i) => value !== previous[i])) hooks.effects.push(work);
    hooks.slots[index] = deps;
  }
}));
type Node = ReactElement<any>;
let tree: Node;
let runtime: any;
let initialReportId:string|undefined;
const repository = { installationId: 321, repositoryId: 100, repositoryFullName: "Owner/repo", enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false };
const report = { id: "report-one", repositoryId: 100, pullRequestNumber: 1, headSha: "a".repeat(40), priority: "low", createdAt: "2026-09-29T00:00:00Z", freshness: "current" };
let reports: any[];
let repositories: any[];
let activity: any[];
let fetchMock: ReturnType<typeof vi.fn>;
const evidenceToggle = { focus: vi.fn() };
const focusedReport = { focus: vi.fn(), scrollIntoView: vi.fn(), querySelector: vi.fn(() => evidenceToggle) };
const focusedPrList = { focus: vi.fn(), scrollIntoView: vi.fn() };
function render() {
  hooks.index = 0;
  tree = PublicGitHubDashboard({ runtime, initialReportId });
  for (const node of nodes()) if (node.props["aria-label"] === "Selected report" && node.props.ref) node.props.ref.current = focusedReport;
  for (const node of nodes()) if (node.props["aria-label"] === "Pull request list" && node.props.ref) node.props.ref.current = focusedPrList;
  hooks.effects.splice(0).forEach(work => work());
  return tree;
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); render(); }
function nodes(value: any = tree): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !value.props) return [];
  return [value, ...nodes(value.props.children ?? null)];
}
function text(value: any = tree): string {
  if (Array.isArray(value)) return value.map(text).join(" ");
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value?.props ? text(value.props.children ?? null) : "";
}
function find(label: string) { const node = nodes().find(n => n.props["aria-label"] === label); expect(node, label).toBeTruthy(); return node!; }
async function click(node: Node, insideInbox = false) {
  tree.props.onClickCapture?.({ target: { closest: () => insideInbox || node.props["aria-label"] === "Open Inbox" ? {} : null } });
  await node.props.onClick();
  await settle();
}
beforeEach(async () => {
  focusedReport.focus.mockClear(); focusedReport.scrollIntoView.mockClear();
  evidenceToggle.focus.mockClear(); focusedReport.querySelector.mockClear();
  focusedPrList.focus.mockClear(); focusedPrList.scrollIntoView.mockClear();
  runtime = undefined; initialReportId=undefined; hooks.slots = []; hooks.index = 0; hooks.effects = [];
  reports = [report];
  repositories = [repository];
  activity = [{ id: "job:one", kind: "analysis_completed", state: "Analysis completed", occurredAt: report.createdAt, repositoryId: 100, pullRequestNumber: 2 }];
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn() }, setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/dashboard/session") return Response.json({ signedIn: true });
    if (url === "/api/dashboard/repositories") return Response.json({ repositories });
    if (url === "/api/dashboard/reports") return Response.json({ reports });
    if (url === "/api/dashboard/activity") return Response.json({ activity });
    if (url === "/api/tenants/repositories") return Response.json({ repository: { ...repository, ...JSON.parse(String(init?.body)).settings } });
    if (url.startsWith("/api/dashboard/reports?id=")) return Response.json({ ...report, report: { requirements: [], evidenceIndex: [] } });
    throw new Error(`Unexpected test URL: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  render(); await settle(); await settle();
});
afterEach(() => { vi.unstubAllGlobals(); });

it("uses one web repository selection for PRs and reports and opens generated results in place", async () => {
  const workspace = () => nodes().find(n => typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace");
  expect(workspace()).toBeTruthy();
  expect(nodes().some(n => typeof n.type === "function" && n.type.name === "RepositoryCommitBrowser")).toBe(false);
  expect(workspace()!.props.repositoryId).toBe(100);
  workspace()!.props.onGeneratedReport({ ...report, id: "generated", report: { requirements: [], evidenceIndex: [] } }); await settle();
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(true);
  const summary = nodes().find(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")!;
  expect(summary.props.detail.id).toBe("generated");
});

it("switches from the PR list to the report and returns without unmounting the PR workspace", async () => {
  const workspace = () => nodes().find(n => typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace")!;
  expect(find("Pull request list").props.hidden).toBe(false);
  workspace().props.onOpenReport(report.id); await settle();
  expect(find("Pull request list").props.hidden).toBe(true);
  expect(find("Report reader").props.hidden).toBe(false);
  expect(workspace()).toBeTruthy();
  const panel = () => nodes().find(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")!;
  expect(panel().props.showDetailedEvidence).toBe(false);
  panel().props.onShowDetail(); await settle();
  expect(panel().props.showDetailedEvidence).toBe(true);
  panel().props.onShowDetail(); await settle();
  expect(panel().props.showDetailedEvidence).toBe(false);
  expect(evidenceToggle.focus).toHaveBeenCalled();
  await click(find("Back to PR list"));
  expect(find("Pull request list").props.hidden).toBe(false);
  expect(find("Report reader").props.hidden).toBe(true);
  expect(focusedPrList.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(focusedPrList.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  workspace().props.onGeneratedReport({ ...report, id: "regenerated", report: { requirements: [], evidenceIndex: [] } }); await settle();
  expect(find("Pull request list").props.hidden).toBe(true);
  expect(find("Report reader").props.hidden).toBe(false);
  expect(panel().props.detail.id).toBe("regenerated");
  expect(panel().props.showDetailedEvidence).toBe(false);
});

it("keeps the PR list and version shelf beside the report on wide screens and flags an earlier version", async () => {
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn() }, setInterval: () => 1, clearInterval: vi.fn(),
    matchMedia: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  hooks.slots = []; hooks.effects = []; render(); await settle(); await settle();
  const workspace = () => nodes().find(n => typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace")!;
  expect(find("Pull request list").props.hidden).toBe(false);
  expect(find("Report reader").props.hidden).toBe(false);
  workspace().props.onHistoryChange([{ ...report, id: "report-two", createdAt: "2026-09-30T00:00:00Z", availability: "available" }, { ...report, availability: "available" }]); await settle();
  workspace().props.onOpenReport(report.id); await settle();
  expect(find("Pull request list").props.hidden).toBe(false);
  expect(workspace().props.activeReportId).toBe(report.id);
  expect(nodes().some(n => n.props["aria-label"] === "Back to PR list")).toBe(false);
  // The version and earlier-version controls sit in the report's context row (QuickSummaryPanel versionContext).
  const context = () => nodes().find(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")!.props.versionContext;
  expect(text(context())).toMatch(/v\s*1[\s\S]*Earlier version[\s\S]*Open latest v\s*2/);
  await click(nodes(context()).find(n => n.type === "button" && /Open latest/.test(text(n)))!);
  expect(fetchMock).toHaveBeenCalledWith("/api/dashboard/reports?id=report-two", expect.anything());
});

it("keeps the PR workspace and its cache across a Settings round trip", async () => {
  const workspace = () => nodes().find(n => typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace");
  const cache = workspace()!.props.cache;
  await click(find("Open settings"));
  expect(workspace()).toBeTruthy();
  expect(nodes().find(n => n.props.className === "dashboard-repositories-view")!.props.hidden).toBe(true);
  await click(find("Show reports"));
  expect(nodes().find(n => n.props.className === "dashboard-repositories-view")!.props.hidden).toBe(false);
  expect(workspace()!.props.cache).toBe(cache);
});

it("reopens a report read earlier without a loading state and still rechecks it quietly", async () => {
  const workspace = () => nodes().find(n => typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace")!;
  workspace().props.onOpenReport(report.id); await settle();
  await click(find("Back to PR list"));
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  workspace().props.onOpenReport(report.id); await settle();
  expect(text()).not.toContain("Opening report");
  expect(nodes().some(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")).toBe(true);
  finish(Response.json({ ...report, availability: "unavailable" })); await settle();
  expect(text()).toContain("Report unavailable");
});

it("does not reload PRs or paginated history on unchanged polling, but loads a new report version", async () => {
  const workspace = () => nodes().find(n => n.type === RepositoryPullRequestWorkspace)!;
  const childSlots: any[] = [];
  const renderWorkspace = () => {
    const previous = { slots: hooks.slots, index: hooks.index, effects: hooks.effects };
    hooks.slots = childSlots; hooks.index = 0; hooks.effects = [];
    try {
      const child = RepositoryPullRequestWorkspace(workspace().props);
      hooks.effects.splice(0).forEach(work => work());
      return child;
    } finally { Object.assign(hooks, previous); }
  };
  let historyReports = [{ ...report, availability: "available" }];
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.includes("pull-requests?")) return Response.json({ pullRequests: [{ number: 1, title: "Example PR", state: "open", headSha: report.headSha }] });
    if (url.includes("scope=history")) return url.includes("offset=50")
      ? Response.json({ reports: [{ ...report, id: "older", createdAt: "2026-09-28T00:00:00Z", availability: "available" }], hasMore: false })
      : Response.json({ reports: historyReports, hasMore: true, nextOffset: 50 });
    return normal(url, init);
  });
  const prRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("pull-requests?")).length;
  const historyRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).includes("scope=history")).length;
  renderWorkspace(); await settle(); await settle(); renderWorkspace(); await settle();
  expect(prRequests()).toBe(1); expect(historyRequests()).toBe(2);
  const initialKey = workspace().props.refreshKey;
  const [poll, delay] = vi.mocked(window.setInterval).mock.calls[0];
  expect(delay).toBe(60_000);
  (poll as () => void)(); await settle(); await settle(); renderWorkspace(); await settle();
  expect(workspace().props.refreshKey).toBe(initialKey);
  expect(prRequests()).toBe(1); expect(historyRequests()).toBe(2);
  reports = [...reports, { ...report, id: "other-repository", repositoryId: 200 }];
  (poll as () => void)(); await settle(); await settle(); renderWorkspace(); await settle();
  expect(workspace().props.refreshKey).toBe(initialKey);
  expect(prRequests()).toBe(1); expect(historyRequests()).toBe(2);
  const newVersion = { ...report, id: "new-version", createdAt: "2026-10-03T00:00:00Z", availability: "available" };
  reports = [newVersion, ...reports]; historyReports = [newVersion, ...historyReports];
  (poll as () => void)(); await settle(); await settle(); renderWorkspace(); await settle(); await settle();
  expect(workspace().props.refreshKey).not.toBe(initialKey);
  expect(prRequests()).toBe(2); expect(historyRequests()).toBe(4);
  expect(nodes(renderWorkspace()).some(n => n.props["aria-label"] === "View report for PR #1" && /v3/.test(text(n)))).toBe(true);
  reports.reverse();
  (poll as () => void)(); await settle(); await settle(); renderWorkspace(); await settle();
  expect(prRequests()).toBe(2); expect(historyRequests()).toBe(4);
  reports = reports.map(item => item.id === newVersion.id ? { ...item, freshness: "refreshing", copyEligible: false } : item);
  historyReports = historyReports.map(item => item.id === newVersion.id ? { ...item, freshness: "refreshing", copyEligible: false } : item);
  (poll as () => void)(); await settle(); await settle(); renderWorkspace(); await settle(); await settle();
  expect(prRequests()).toBe(3); expect(historyRequests()).toBe(6);
  const manualRefresh = nodes(renderWorkspace()).find(n => n.props["aria-label"] === "Refresh pull requests")!;
  manualRefresh.props.onClick(); renderWorkspace(); await settle(); await settle(); renderWorkspace();
  expect(prRequests()).toBe(4); expect(historyRequests()).toBe(8);
});

it.each([
  { freshness: "refreshing", copyEligible: false },
  { freshness: "stale", copyEligible: false },
  { freshness: "refresh_failed", copyEligible: false, failure: { code: "analysis_failed", summary: "Server refresh failed" } },
  { freshness: "current", copyEligible: true }
])("applies cached report revalidation $freshness/$copyEligible without collapsing evidence or moving focus", async status => {
  const workspace = () => nodes().find(n => n.type === RepositoryPullRequestWorkspace)!;
  const panel = () => nodes().find(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")!;
  const initial = { ...report, freshness: "current", copyEligible: false, report: { requirements: [], evidenceIndex: [] } };
  fetchMock.mockResolvedValueOnce(Response.json(initial));
  workspace().props.onOpenReport(report.id); await settle();
  await click(find("Back to PR list"));
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  workspace().props.onOpenReport(report.id); await settle();
  panel().props.onShowDetail(); await settle();
  const before = panel().props.detail;
  focusedReport.focus.mockClear(); focusedReport.scrollIntoView.mockClear(); evidenceToggle.focus.mockClear();
  finish(Response.json({ ...initial, ...status })); await settle();
  expect(panel().props.detail).toMatchObject(status);
  expect(panel().props.detail.report).not.toBe(before.report);
  expect(panel().props.showDetailedEvidence).toBe(true);
  expect(focusedReport.focus).not.toHaveBeenCalled();
  expect(focusedReport.scrollIntoView).not.toHaveBeenCalled();
  expect(evidenceToggle.focus).not.toHaveBeenCalled();
  const previous = { slots: hooks.slots, index: hooks.index, effects: hooks.effects };
  hooks.slots = []; hooks.index = 0; hooks.effects = [];
  try {
    const evidence = DetailedEvidence({ detail: panel().props.detail, demoMode: false });
    const copyButtons = nodes(evidence).filter(n => n.type === "button" && /Copy report|Copy JSON/.test(text(n)));
    expect(copyButtons).toHaveLength(2);
    expect(copyButtons.every(n => n.props.disabled === !status.copyEligible)).toBe(true);
  } finally { Object.assign(hooks, previous); }
});

it("keeps an unchanged cached detail reference and ignores a late changed revalidation after leaving", async () => {
  const workspace = () => nodes().find(n => n.type === RepositoryPullRequestWorkspace)!;
  const panel = () => nodes().find(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")!;
  workspace().props.onOpenReport(report.id); await settle();
  await click(find("Back to PR list"));
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  workspace().props.onOpenReport(report.id); await settle();
  const before = panel().props.detail;
  finish(Response.json({ ...report, report: { requirements: [], evidenceIndex: [] } })); await settle();
  expect(panel().props.detail.report).toBe(before.report);
  await click(find("Back to PR list"));
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  workspace().props.onOpenReport(report.id); await settle();
  const reopened = panel().props.detail;
  await click(find("Back to PR list"));
  finish(Response.json({ ...report, freshness: "stale", copyEligible: false, report: { requirements: [], evidenceIndex: [] } })); await settle();
  expect(find("Report reader").props.hidden).toBe(true);
  expect(panel().props.detail).toEqual(before);
  expect(panel().props.detail.report).toBe(reopened.report);
});

it("lets the user close repository selection and connect several repositories without reloading the list", async () => {
  const listed = [{ id: 200, fullName: "Owner/one", private: false }, { id: 201, fullName: "Owner/two", private: false }];
  const normal = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/github/onboarding/callback?existing=1") return Response.json({ next: "select_repository", installationId: 321 });
    if (url.startsWith("/api/github/onboarding/repositories?")) return Response.json({ repositories: listed });
    if (url === "/api/github/onboarding/repositories") return Response.json({ settings: { analysisEnabled: true, saveReportsEnabled: true } });
    return normal(url, init);
  });
  const listRequests = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/github/onboarding/repositories?")).length;
  await click(nodes().find(n => n.type === "button" && /Add repositories/.test(text(n)))!); await settle();
  expect(listRequests()).toBe(1);
  await click(nodes().find(n => n.props.className === "dashboard-list-row" && /Owner\/one/.test(text(n)))!);
  expect(find("Add repositories")).toBeTruthy();
  const one = nodes().find(n => n.props.className === "dashboard-list-row" && /Owner\/one/.test(text(n)))!;
  expect(one.props.disabled).toBe(true); expect(text(one)).toContain("Connected");
  expect(nodes().find(n => n.props.className === "dashboard-list-row" && /Owner\/two/.test(text(n)))!.props.disabled).toBe(false);
  await click(find("Close repository selection"));
  expect(nodes().some(n => n.props["aria-label"] === "Add repositories")).toBe(false);
  await click(nodes().find(n => n.type === "button" && /Add repositories/.test(text(n)))!); await settle();
  expect(find("Add repositories")).toBeTruthy();
  expect(listRequests()).toBe(1);
});

it("keeps the list out of the loading view and lets the user return while loading", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  nodes().find(n => typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace")!.props.onOpenReport(report.id);
  await settle();
  expect(find("Pull request list").props.hidden).toBe(true);
  expect(text(find("Report reader"))).toContain("Opening report");
  await click(find("Back to PR list"));
  finish(Response.json({ ...report, report: { requirements: [], evidenceIndex: [] } })); await settle();
  expect(find("Pull request list").props.hidden).toBe(false);
  expect(find("Report reader").props.hidden).toBe(true);
});

it("does not let a report response switch back to a repository the user left", async () => {
  repositories.push({ ...repository, repositoryId: 200, repositoryFullName: "Owner/second" });
  const refresh = vi.mocked(document.addEventListener).mock.calls.find(call => call[0] === "visibilitychange")![1] as () => void;
  refresh(); await settle(); await settle();
  let finish!: (value: Response)=>void;
  fetchMock.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  nodes().find(n=>n.type === "button" && n.props.className?.includes("report-row"))!.props.onClick();
  await click(nodes().find(n=>n.type === "button" && text(n).includes("Owner/second") && n.props.className?.includes("repository-tab"))!);
  finish(Response.json({ ...report, report: { requirements: [], evidenceIndex: [] } })); await settle();
  expect(nodes().some(n=>n.props["aria-label"] === "Selected report")).toBe(false);
  expect(nodes().find(n=>typeof n.type === "function" && n.type.name === "RepositoryPullRequestWorkspace")?.props.repositoryId).toBe(200);
});

it("discards an in-flight report when refresh discovers an expired account session", async () => {
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  nodes().find(n => n.type === "button" && n.props.className?.includes("report-row"))!.props.onClick();
  await settle();
  expect(text()).toContain("Opening report");
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 401 }));
  await click(find("Refresh reports and activity"));
  finish(Response.json({ ...report, report: { requirements: [], evidenceIndex: [] } }));
  await settle();
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(false);
});

it("closes Inbox for Settings and repository navigation", async () => {
  await click(find("Open Inbox"));
  expect(nodes().some(n => n.props["aria-label"] === "Inbox")).toBe(true);
  await click(find("Open settings"));
  expect(nodes().some(n => n.props["aria-label"] === "Inbox")).toBe(false);
  await click(find("Show reports"));
  await click(find("Open Inbox"));
  await click(nodes().find(n => n.type === "button" && text(n).includes("Owner/repo") && n.props.className?.includes("repository-tab"))!);
  expect(nodes().some(n => n.props["aria-label"] === "Inbox")).toBe(false);
});

it("shows setting failures but leaves no success banner", async () => {
  await click(find("Open settings"));
  const settings = () => nodes().find(n => typeof n.type === "function" && n.type.name === "SettingsPanel")!;
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await settings().props.onUpdate("commentEnabled", true); await settle();
  expect(text()).toContain("Repository settings could not be saved.");
  await settings().props.onUpdate("commentEnabled", true); await settle();
  expect(settings().props.repository.commentEnabled).toBe(true);
  expect(text()).not.toContain("Repository settings saved.");
  expect(text()).not.toContain("Repository settings could not be saved.");
});

it("marks completed activity without a report before selection and clears the old report when selected", async () => {
  await click(nodes().find(n => n.type === "button" && n.props.className?.includes("report-row"))!);
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(true);
  await click(find("Open settings"));
  await click(find("Open Inbox"));
  expect(text(find("Inbox"))).toContain("No report in recent saved reports");
  await click(nodes().find(n => n.props.className?.includes("dashboard-activity-row"))!, true);
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(false);
  expect(find("Report reader").props.hidden).toBe(false);
  expect(text()).toContain("No report in recent saved reports");
  reports = [{ ...report, pullRequestNumber: 2 }];
  activity = [{ ...activity[0], id: "report:one", kind: "report_ready", reportId: report.id }];
  await click(find("Refresh reports and activity"));
  expect(text()).not.toContain("No report in recent saved reports");
});

it("requests reports and activity again and renders both fresh responses on manual refresh", async () => {
  const before = fetchMock.mock.calls.length;
  reports = [{ ...report, id: "new-report", pullRequestNumber: 99 }];
  activity = [{ ...activity[0], id: "job:new", pullRequestNumber: 98 }];
  await click(find("Refresh reports and activity"));
  const calls = fetchMock.mock.calls.slice(before);
  for (const path of ["/api/dashboard/reports", "/api/dashboard/activity"]) expect(calls).toContainEqual([path, { cache: "no-store" }]);
  expect(text()).toContain("PR #99");
  await click(find("Open Inbox"));
  expect(text(find("Inbox"))).toContain("PR #98");
});

it("preserves loaded lists and shows refresh failures", async () => {
  fetchMock.mockImplementation(async () => Response.json({}, { status: 503 }));
  await click(find("Refresh reports and activity"));
  expect(text(find("Workspace refresh status"))).toContain("reports");
  expect(text()).toContain("PR #1");
  await click(find("Open Inbox"));
  expect(text(find("Workspace refresh status"))).toContain("activity");
  expect(text(find("Inbox"))).toContain("PR #2");
});

it("does not let an older background response overwrite a newer manual refresh", async () => {
  let finishReports!: (response: Response) => void;
  let finishActivity!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishReports = resolve; }));
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finishActivity = resolve; }));
  const visibilityRefresh = vi.mocked(document.addEventListener).mock.calls.find(call => call[0] === "visibilitychange")![1] as () => void;
  visibilityRefresh();
  reports = [{ ...report, id: "latest-report", pullRequestNumber: 99 }];
  activity = [{ ...activity[0], id: "job:latest", pullRequestNumber: 98 }];
  await click(find("Refresh reports and activity"));
  finishReports(Response.json({ reports: [{ ...report, pullRequestNumber: 10 }] }));
  finishActivity(Response.json({ activity: [{ ...activity[0], pullRequestNumber: 11 }] }));
  await settle();
  expect(text()).toContain("PR #99");
  expect(text()).not.toContain("PR #10");
  await click(find("Open Inbox"));
  expect(text(find("Inbox"))).toContain("PR #98");
  expect(text(find("Inbox"))).not.toContain("PR #11");
});

it("opens a saved historical report from Inbox when the current report list is empty", async () => {
  reports = [{ ...report, freshness: "stale" }];
  activity = [{ ...activity[0], kind: "report_stale", reportId: report.id }];
  await click(find("Refresh reports and activity"));
  await click(find("Open settings"));
  const settings = nodes().find(n => typeof n.type === "function" && n.type.name === "SettingsPanel")!;
  await settings.props.onUpdate("analysisEnabled", false); await settle();
  await click(find("Open Inbox"));
  await click(nodes().find(n => n.props.className?.includes("dashboard-activity-row"))!, true);
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(true);
  expect(find("Report reader").props.hidden).toBe(false);
  expect(text()).not.toContain("Showing this previous result.");
});


it("clears reports and activity when refreshed access is denied", async () => {
  await click(nodes().find(n => n.type === "button" && n.props.className?.includes("report-row"))!);
  fetchMock.mockImplementation(async () => Response.json({}, { status: 401 }));
  await click(find("Refresh reports and activity"));
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(false);
  expect(text()).not.toContain("PR #1");
  await click(find("Open Inbox"));
  expect(text(find("Inbox"))).toContain("Activity is unavailable.");
});

it("clears inbox only after persistence succeeds, preserves reports and keeps newer events", async () => {
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  const dismissedThrough = "2026-10-02T00:00:00.000Z";
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => url === "/api/dashboard/activity" && init?.method === "POST"
    ? new Promise(resolve => { finish = resolve; }) : normal(url, init));
  await click(find("Open Inbox"));
  find("Clear inbox").props.onClick(); await settle();
  expect(find("Clear inbox").props.disabled).toBe(true);
  expect(text(find("Inbox"))).toContain("PR #2");
  activity = [...activity, { ...activity[0], id: "future", pullRequestNumber: 99, occurredAt: "2026-10-02T00:00:01.000Z" }];
  const refresh = vi.mocked(document.addEventListener).mock.calls.find(call => call[0] === "visibilitychange")![1] as () => void;
  refresh(); await settle();
  finish(Response.json({ ok: true, dismissedThrough })); await settle();
  expect(text(find("Inbox"))).not.toContain("PR #2");
  expect(text(find("Inbox"))).toContain("PR #99");
  expect(text()).toContain("PR #1");
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  const sent = fetchMock.mock.calls.find(([url, init]) => url === "/api/dashboard/activity" && init?.method === "POST")!;
  expect(JSON.parse(sent[1].body)).toEqual({});
  expect(sent[1].headers["x-agentproof-csrf"]).toBe("same-origin");
});
it("keeps inbox rows on clear failure and ignores an older refresh after a successful clear", async () => {
  await click(find("Open Inbox"));
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await click(find("Clear inbox"), true);
  expect(text(find("Inbox"))).toContain("PR #2"); expect(text()).toContain("Inbox could not be cleared");
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  let old!: (value: Response) => void;
  fetchMock.mockImplementation((url: string, init?: RequestInit) => url === "/api/dashboard/activity"
    ? init?.method === "POST" ? Promise.resolve(Response.json({ ok: true, dismissedThrough: "2026-10-02T00:00:00.000Z" })) : new Promise(resolve => { old = resolve; }) : normal(url, init));
  const refresh = vi.mocked(document.addEventListener).mock.calls.find(call => call[0] === "visibilitychange")![1] as () => void;
  refresh();
  await click(find("Clear inbox"), true);
  old(Response.json({ activity })); await settle();
  expect(text(find("Inbox"))).toContain("No recent activity."); expect(text()).not.toContain("Inbox could not be cleared");
});
it("closes inbox immediately and exposes report loading, success and unavailable states", async () => {
  activity = [{ ...activity[0], kind: "report_ready", reportId: report.id }];
  await click(find("Refresh reports and activity")); await click(find("Open Inbox"));
  let finish!: (value: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  nodes().find(n => n.props.className?.includes("dashboard-activity-row"))!.props.onClick(); await settle();
  expect(nodes().some(n => n.props["aria-label"] === "Inbox")).toBe(false);
  expect(text()).toContain("Opening report");
  finish(Response.json({ ...report, report: { requirements: [], evidenceIndex: [] } })); await settle();
  expect(find("Selected report").props.tabIndex).toBe(-1);
  expect(focusedReport.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(focusedReport.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(text()).not.toContain("Opening report");
  await click(find("Open Inbox"));
  fetchMock.mockResolvedValueOnce(Response.json({ ...report, availability: "unavailable" }));
  await click(nodes().find(n => n.props.className?.includes("dashboard-activity-row"))!, true);
  expect(text()).toContain("Report unavailable");
  expect(nodes().some(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")).toBe(false);
});
it("opens the inbox-linked saved report even when its repository is no longer connected", async () => {
  activity = [{ ...activity[0], repositoryId: 200, reportId: "disconnected-report" }];
  await click(find("Refresh reports and activity")); await click(find("Open Inbox"));
  fetchMock.mockResolvedValueOnce(Response.json({ ...report, repositoryId: 200, report: { requirements: [], evidenceIndex: [] } }));
  await click(nodes().find(n => n.props.className?.includes("dashboard-activity-row"))!, true);
  expect(find("Selected report")).toBeTruthy();
  expect(nodes().find(n => typeof n.type === "function" && n.type.name === "QuickSummaryPanel")?.props.detail.repositoryId).toBe(200);
});

it("renders repositories from the supplied session transport and passes it to the PR browser",async()=>{
  hooks.slots=[];hooks.index=0;hooks.effects=[];
  runtime={storage:window.localStorage,launchStorage:window.localStorage,navigate:()=>{},request:async(path:string)=>{
    if(path==="/api/dashboard/session")return Response.json({signedIn:true});
    if(path==="/api/dashboard/repositories")return Response.json({repositories:[{...repository,repositoryFullName:"Native/account-only"}]});
    if(path==="/api/dashboard/reports")return Response.json({reports:[]});
    return Response.json({activity:[]});
  }};
  render();await settle();await settle();
  expect(text()).toContain("Native/account-only");
  expect(text()).not.toContain("Owner/repo");
  const browser=nodes().find(n=>typeof n.type==="function"&&n.type.name==="RepositoryCommitBrowser");
  expect(browser?.props.runtime).toBe(runtime);
});

it("keeps the unread count when Inbox only opens, marks just the opened notification read, and restores it after refresh", async () => {
  activity = [2, 3].map(n => ({ id: `job:pr${n}`, kind: "analysis_completed", state: "Analysis completed", occurredAt: report.createdAt, repositoryId: 100, pullRequestNumber: n }));
  await click(find("Refresh reports and activity"));
  const badge = () => text(nodes().find(n => n.props.className === "dashboard-unread-badge") ?? null);
  const rows = () => nodes().filter(n => typeof n.props.className === "string" && n.props.className.includes("dashboard-activity-row"));
  expect(badge()).toBe("2");
  await click(find("Open Inbox"));
  expect(badge()).toBe("2");
  expect(rows().map(row => row.props.className.includes("is-unread"))).toEqual([true, true]);
  await click(rows().find(row => text(row).includes("PR #2"))!, true);
  expect(badge()).toBe("1");
  const stored = (window.localStorage.setItem as any).mock.calls.at(-1);
  expect(stored[0]).toBe("agentproof.inbox.read.v1");
  expect(JSON.parse(stored[1])).toEqual(["job:pr2"]);
  await click(find("Open Inbox"));
  expect(rows().find(row => text(row).includes("PR #2"))!.props.className).toContain("is-read");
  expect(rows().find(row => text(row).includes("PR #3"))!.props.className).toContain("is-unread");
  hooks.slots = []; hooks.effects = [];
  (window as any).localStorage.getItem = () => JSON.stringify(["job:pr2"]);
  render(); await settle(); await settle();
  expect(badge()).toBe("1");
});

it("keeps the AgentProof session when GitHub installation access expired and offers a separate GitHub confirmation", async () => {
  expect(nodes().find(n => n.props.className === "dashboard-brand")!.props.href).toBe("/dashboard");
  const normal = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === "/api/github/onboarding/callback?existing=1"
    ? Response.json({ code: "github_existing_installation_reauth_required" }, { status: 401 }) : normal(url, init));
  await click(nodes().find(n => n.type === "button" && /Add repositories/.test(text(n)))!); await settle();
  expect(nodes().some(n => typeof n.type === "function" && n.type.name === "WorkspaceSignIn")).toBe(false);
  expect(nodes().some(n => n.props.className === "dashboard-topbar")).toBe(true);
  expect(text()).toContain("You are still signed in.");
  expect(nodes().some(n => n.type === "button" && text(n) === "Confirm with GitHub")).toBe(true);
  expect(text()).not.toContain("Reconnect GitHub to recognize");
});

it("uses the shared sign-in entry when the session is signed out", async () => {
  hooks.slots = []; hooks.effects = [];
  const normal = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === "/api/dashboard/session" ? Response.json({ signedIn: false }) : normal(url, init));
  render(); await settle(); await settle();
  expect(nodes().some(n => typeof n.type === "function" && n.type.name === "WorkspaceSignIn")).toBe(true);
});


it("copies only the selected report on click without fetching, and resets feedback for another selection", async () => {
  const { toQuickSummary } = await import("@/lib/github-dashboard-view-model");
  hooks.slots = []; hooks.effects = [];
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  let selected = { ...report, repositoryFullName: "Owner/repo", freshness: "stale" as const, copyEligible: false, report: { testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" } } };
  const panel = () => { hooks.index = 0; return QuickSummaryPanel({ detail: selected, quickSummary: toQuickSummary(selected), onShowDetail: vi.fn(), showDetailedEvidence: false, demoMode: false }); };
  let output = panel();
  const summary = nodes(output).find(node => node.props.ref)!;
  summary.props.ref.current = { innerText: "Inspect first\nReview the referenced evidence." };
  expect(writeText).not.toHaveBeenCalled(); fetchMock.mockClear();
  await nodes(output).find(node => node.props["aria-label"] === "Copy selected report")!.props.onClick();
  output = panel();
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(writeText.mock.calls[0][0]).toContain("PR #1");
  expect(writeText.mock.calls[0][0]).toContain("Review the referenced evidence.");
  expect(text(output)).toContain("Report copied.");
  expect(fetchMock).not.toHaveBeenCalled();
  selected = { ...selected, id: "another-report", pullRequestNumber: 2 };
  output = panel();
  expect(text(output)).not.toContain("Report copied.");
});

it("shows a brief failure when clipboard and browser fallback cannot copy", async () => {
  const { toQuickSummary } = await import("@/lib/github-dashboard-view-model");
  hooks.slots = []; hooks.effects = []; hooks.index = 0;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const detail = { ...report, freshness: "current" as const, report: {} };
  const panel = () => { hooks.index = 0; return QuickSummaryPanel({ detail, quickSummary: toQuickSummary(detail), onShowDetail: vi.fn(), showDetailedEvidence: false, demoMode: false }); };
  const output = panel(); fetchMock.mockClear();
  await nodes(output).find(node => node.props["aria-label"] === "Copy selected report")!.props.onClick();
  expect(text(panel())).toContain("Copy failed. Select the report text manually.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("returns to the dashboard home state from the brand without a page load and keeps the link for new tabs", async () => {
  const location = { assign: vi.fn(), replace: vi.fn(), reload: vi.fn() };
  (window as any).location = location;
  await click(nodes().find(n => n.type === "button" && n.props.className?.includes("report-row"))!);
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(true);
  await click(find("Open Inbox"));
  expect(nodes().some(n => n.props["aria-label"] === "Inbox")).toBe(true);
  const brand = () => nodes().find(n => n.props.className === "dashboard-brand")!;
  expect(brand().props.href).toBe("/dashboard");
  const modified = { button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() };
  brand().props.onClick(modified); await settle();
  expect(modified.preventDefault).not.toHaveBeenCalled();
  const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() };
  brand().props.onClick(plain); await settle();
  expect(plain.preventDefault).toHaveBeenCalledTimes(1);
  expect(nodes().some(n => n.props["aria-label"] === "Inbox")).toBe(false);
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(false);
  expect(find("Pull request list").props.hidden).toBe(false);
  expect([location.assign, location.replace, location.reload].every(fn => fn.mock.calls.length === 0)).toBe(true);
});

it('shows the existing first private notice with purpose interpretation use and requires the user checkbox',async()=>{
 const normal=fetchMock.getMockImplementation() as (u:string,i?:RequestInit)=>Promise<Response>;
 fetchMock.mockImplementation(async(u:string,i?:RequestInit)=>u==='/api/github/onboarding/callback?existing=1'?Response.json({next:'select_repository',installationId:321}):u.startsWith('/api/github/onboarding/repositories?')?Response.json({repositories:[{id:200,fullName:'Owner/private',private:true}]}):normal(u,i));
 await click(nodes().find(n=>n.type==='button'&&/Add repositories/.test(text(n)))!);await settle();await click(nodes().find(n=>n.props.className==='dashboard-list-row'&&/Owner\/private/.test(text(n)))!);
 expect(text()).toContain('explain how those changes fit the stated purpose');expect(text()).not.toMatch(/zero.data.retention|ZDR/);
 const consentLabel=nodes().find(n=>n.type==='label'&&text(n).includes('Required to turn analysis ON for this repository.'))!;const approve=nodes(consentLabel).find(n=>n.type==='input')!;expect(approve).toBeTruthy();
 const enable=nodes().find(n=>n.type==='button'&&/analysis ON/.test(text(n)))!;expect(enable.props.disabled).toBe(true);approve.props.onChange({target:{checked:true}});await settle();expect(nodes().find(n=>n.type==='button'&&/analysis ON/.test(text(n)))!.props.disabled).toBe(false);
});

it('approved private settings show the transmission notice without asking consent again, including OFF then ON',async()=>{
 repositories=[{...repository,repositoryPrivate:true,privateAnalysisConsentVersion:'2026-09-24.v1'}];
 const normal=fetchMock.getMockImplementation() as (u:string,i?:RequestInit)=>Promise<Response>;fetchMock.mockImplementation(async(u:string,i?:RequestInit)=>{if(u==='/api/tenants/repositories'){repositories[0]={...repositories[0],...JSON.parse(String(i?.body)).settings};return Response.json({repository:repositories[0]});}return normal(u,i);});
 hooks.slots=[];hooks.effects=[];render();await settle();await settle();await click(find('Open settings'));
 const settings=()=>nodes().find(n=>typeof n.type==='function'&&n.type.name==='SettingsPanel')!;
 function content(){const old=hooks.slots,oldIndex=hooks.index;hooks.slots=[];hooks.index=0;try{return (settings().type as any)(settings().props);}finally{hooks.slots=old;hooks.index=oldIndex;}}
 expect(text(content())).toContain('explain how those changes fit the stated purpose');expect(text(content())).not.toContain('I approve private PR analysis');
 await settings().props.onUpdate('analysisEnabled',false);await settle();await settings().props.onUpdate('analysisEnabled',true);await settle();
 const changes=fetchMock.mock.calls.filter(([u])=>u==='/api/tenants/repositories').map(([,i])=>JSON.parse(String(i?.body)));
 expect(changes.map(c=>c.settings.analysisEnabled)).toEqual([false,true]);expect(changes.some(c=>c.settings.privateAnalysisConsent===true)).toBe(false);expect(settings().props.repository.privateAnalysisConsentVersion).toBe('2026-09-24.v1');
});

it('saves the report language for new reports through the existing settings request, defaulting to English',async()=>{
 const normal=fetchMock.getMockImplementation() as (u:string,i?:RequestInit)=>Promise<Response>;fetchMock.mockImplementation(async(u:string,i?:RequestInit)=>{if(u==='/api/tenants/repositories'&&i?.method==='PATCH'){repositories[0]={...repositories[0],...JSON.parse(String(i?.body)).settings};return Response.json({repository:repositories[0]});}return normal(u,i);});
 hooks.slots=[];hooks.effects=[];render();await settle();await settle();await click(find('Open settings'));
 const settings=()=>nodes().find(n=>typeof n.type==='function'&&n.type.name==='SettingsPanel')!;
 function content(){const old=hooks.slots,oldIndex=hooks.index;hooks.slots=[];hooks.index=0;try{return (settings().type as any)(settings().props);}finally{hooks.slots=old;hooks.index=oldIndex;}}
 const selector=()=>nodes(content()).find(n=>typeof n.type==='function'&&n.type.name==='ReportLanguageSetting')!;
 expect(selector().props.value).toBe('en');
 const options=nodes((selector().type as any)(selector().props)).filter(n=>n.type==='input');
 expect(options.map(n=>n.props.value)).toEqual(['en','ko']);expect(text((selector().type as any)(selector().props))).not.toContain('Applies to newly generated reports.');
 const callsBefore=fetchMock.mock.calls.length;
 selector().props.onChange('ko');await settle();
 // Only the setting is saved: no report is reloaded, regenerated or translated.
 expect(fetchMock.mock.calls.slice(callsBefore).map(([u,i])=>`${i?.method??'GET'} ${u}`)).toEqual(['PATCH /api/tenants/repositories']);
 const patches=fetchMock.mock.calls.filter(([u,i])=>u==='/api/tenants/repositories'&&i?.method==='PATCH').map(([,i])=>JSON.parse(String(i?.body)));
 expect(patches).toEqual([{installationId:321,repositoryId:100,settings:{reportLanguage:'ko'}}]);
 expect(settings().props.repository.reportLanguage).toBe('ko');expect(selector().props.value).toBe('ko');
});

it.each(['transport', 'json'])("keeps a first %s load failure distinct from empty data and retries all three reads", async kind => {
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url, init) => url === '/api/dashboard/session' ? normal(url, init)
    : kind === 'json' ? new Response('<html>unavailable</html>') : Promise.reject(new TypeError('Load failed')));
  hooks.slots = []; hooks.effects = []; render(); await settle(); await settle();
  expect(nodes().filter(n => n.props['aria-label'] === 'Workspace refresh status')).toHaveLength(1);
  expect(text()).not.toContain('No active repository.');
  expect(text()).not.toContain('Add a repository');
  expect(text()).not.toContain('Connect a repository to view pull requests.');
  expect(text()).not.toContain('Connect a GitHub repository to review saved evidence reports.');
  await click(find('Open Inbox'));
  expect(text()).not.toContain('No recent activity.');
  const before = fetchMock.mock.calls.length;
  fetchMock.mockImplementation(normal);
  await click(find('Retry workspace loading'));
  const urls = fetchMock.mock.calls.slice(before).map(([url]) => url);
  expect(urls).toEqual(expect.arrayContaining(['/api/dashboard/repositories', '/api/dashboard/reports', '/api/dashboard/activity']));
  expect(text()).toContain('Owner/repo');
  expect(nodes().some(n => n.props['aria-label'] === 'Workspace refresh status')).toBe(false);
});

it('preserves loaded data, clears only successful read errors, and includes repositories in manual refresh', async () => {
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async () => { throw new TypeError('Load failed'); });
  await click(find('Refresh reports and activity'));
  expect(text()).toContain('Owner/repo'); expect(text()).toContain('PR #1');
  expect(text(find('Workspace refresh status'))).toContain('repositories, reports, activity');
  fetchMock.mockImplementation((url, init) => url === '/api/dashboard/activity'
    ? Promise.reject(new TypeError('Load failed')) : normal(url, init));
  await click(find('Retry workspace loading'));
  expect(text(find('Workspace refresh status'))).toContain('activity');
  expect(text(find('Workspace refresh status'))).not.toContain('repositories,');
  expect(text(find('Workspace refresh status'))).not.toContain('reports,');
});

it('does not let an older repository read failure replace the latest successful read', async () => {
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  let finish!: (r: Response) => void;
  fetchMock.mockImplementation((url, init) => url === '/api/dashboard/repositories'
    ? new Promise(resolve => { finish = resolve; }) : normal(url, init));
  const visibility = vi.mocked(document.addEventListener).mock.calls.find(c => c[0] === 'visibilitychange')![1] as () => void;
  visibility(); await settle();
  fetchMock.mockImplementation(normal);
  await click(find('Refresh reports and activity'));
  finish(Response.json({}, { status: 503 })); await settle();
  expect(text()).toContain('Owner/repo');
  expect(nodes().some(n => n.props['aria-label'] === 'Workspace refresh status')).toBe(false);
});

it('keeps repository read errors independent from settings actions', async () => {
  const normal = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation((url, init) => url === '/api/dashboard/repositories'
    ? Promise.reject(new TypeError('Load failed')) : normal(url, init));
  await click(find('Refresh reports and activity')); await click(find('Open settings'));
  const settings = nodes().find(n => typeof n.type === 'function' && n.type.name === 'SettingsPanel')!;
  await settings.props.onUpdate('commentEnabled', true); await settle();
  expect(text(find('Workspace refresh status'))).toContain('repositories');
  fetchMock.mockImplementation((url, init) => url === '/api/tenants/repositories'
    ? Promise.resolve(Response.json({}, { status: 503 })) : normal(url, init));
  await settings.props.onUpdate('commentEnabled', true); await settle();
  await click(find('Retry workspace loading'));
  expect(text()).toContain('Repository settings could not be saved.');
  expect(nodes().some(n => n.props['aria-label'] === 'Workspace refresh status')).toBe(false);
});

it.each([401, 403])('keeps denied reads (%s) distinct and clears inaccessible data', async status => {
  fetchMock.mockResolvedValue(Response.json({}, { status }));
  await click(find('Refresh reports and activity'));
  expect(text()).not.toContain('Owner/repo');
  expect(text()).toContain(status === 401 ? 'Your sign-in session has expired.' : 'Workspace access is unavailable.');
  expect(nodes().some(n => n.type === 'button' && text(n).includes('Continue with GitHub'))).toBe(status === 401);
  expect(text()).not.toContain('Previously loaded data is unchanged.');
  expect(text()).not.toContain('No active repository.');
});

it('renders a genuine empty connection list only after a successful read', async () => {
  repositories = []; reports = []; activity = [];
  await click(find('Refresh reports and activity'));
  expect(text()).toContain('No active repository.');
  expect(text()).toContain('Add a repository');
  await click(find('Open Inbox')); expect(text()).toContain('No recent activity.');
});

it('does not show arbitrary legacy failure summaries or codes in report rows and activity', async () => {
  reports = [{ ...report, freshness: 'refresh_failed', failure: { code: 'internal_tenant_config', summary: 'PRIVATE_CONFIG_CANARY' } }];
  activity = [{ ...activity[0], kind: 'analysis_needs_attention', state: 'Needs attention', failure: { code: 'internal_tenant_config', summary: 'PRIVATE_CONFIG_CANARY' } }];
  await click(find('Refresh reports and activity')); await click(find('Open Inbox'));
  expect(text()).not.toContain('PRIVATE_CONFIG_CANARY'); expect(text()).not.toContain('internal_tenant_config');
  expect(text()).toContain('Existing saved reports remain available.');
});

it('uses icon-only top navigation and shows settings in the repository report language, with a back control',async()=>{
 repositories=[{...repository,reportLanguage:'ko'}];
 hooks.slots=[];hooks.effects=[];render();await settle();await settle();
 // The brand and the settings toggle carry their words only as accessible names and titles.
 const brand=nodes().find(n=>n.type==='a'&&n.props.className==='dashboard-brand')!;expect(brand.props['aria-label']).toBe('DiffEvidence home');expect(brand.props.title).toBe('DiffEvidence');expect(text(brand)).toBe('');
 const toggle=find('Open settings');expect(toggle.props.title).toBe('Open settings');expect(text(toggle)).toBe('');
 await click(toggle);
 expect(find('Show reports').props.title).toBe('Show reports');
 const settings=()=>nodes().find(n=>typeof n.type==='function'&&n.type.name==='SettingsPanel');
 function content(){const s=settings()!,old=hooks.slots,oldIndex=hooks.index;hooks.slots=[];hooks.index=0;try{return (s.type as any)(s.props);}finally{hooks.slots=old;hooks.index=oldIndex;}}
 const panel=content();
 expect(text(panel)).toContain('저장소 설정');expect(text(panel)).toContain('계정');expect(text(panel)).toContain('로그아웃');
 expect(nodes(panel).filter(n=>typeof n.type==='function'&&n.type.name==='SettingToggle').map(n=>n.props.label)).toEqual(['자동 분석','보고서 저장','요약 댓글']);
 const language=nodes(panel).find(n=>typeof n.type==='function'&&n.type.name==='ReportLanguageSetting')!;expect(text((language.type as any)(language.props))).not.toContain('새로 작성하는 보고서에 적용됩니다.');
 const back=nodes(panel).find(n=>n.props?.['aria-label']==='보고서로 돌아가기')!;expect(back.props.title).toBe('보고서로 돌아가기');
 back.props.onClick();await settle();
 expect(settings()).toBeUndefined();
});


it('hands one visible-return refresh to the PR workspace even when reports do not change', async () => {
  const workspace=()=>nodes().find(n=>n.type===RepositoryPullRequestWorkspace)!;
  const before=workspace().props.resumeKey;
  const visibility=vi.mocked(document.addEventListener).mock.calls.find(c=>c[0]==='visibilitychange')![1] as ()=>void;
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});visibility();await settle();
  expect(workspace().props.resumeKey).toBe(before);
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});visibility();await settle();
  expect(workspace().props.resumeKey).toBe(before+1);
  visibility();await settle();expect(workspace().props.resumeKey).toBe(before+1);
  // Existing periodic polling and repeated visible notifications do not create recovery bursts.
  expect(fetchMock.mock.calls.some(([p])=>p==='/api/dashboard/analyze')).toBe(false);
});

it('opens a native notification target through the normal authenticated GET without an analysis call',async()=>{
 initialReportId='report-one';render();
 await settle();await settle();expect(fetchMock.mock.calls.some(([p])=>p==='/api/dashboard/reports?id=report-one')).toBe(true);
 expect(fetchMock.mock.calls.some(([p])=>p==='/api/dashboard/analyze')).toBe(false);
});

it("leads a first connection with the guide and keeps the installation access confirmation inside it", async () => {
  repositories = []; reports = []; activity = [];
  await click(find("Refresh reports and activity"));
  const guide = () => nodes().find(n => typeof n.type === "function" && n.type.name === "ConnectRepositoryGuide");
  expect(guide()?.props.stage).toBe("install");
  expect(nodes().some(n => String(n.props.className ?? "").startsWith("dashboard-history-layout"))).toBe(false);
  const normal = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === "/api/github/onboarding/callback?existing=1"
    ? Response.json({ code: "github_existing_installation_reauth_required" }, { status: 401 }) : normal(url, init));
  await guide()!.props.onInstall(); await settle(); await settle();
  expect(guide()?.props.stage).toBe("reauth");
  expect(nodes().some(n => n.props.className === "dashboard-reauth")).toBe(false);
  expect(nodes().some(n => typeof n.type === "function" && n.type.name === "WorkspaceSignIn")).toBe(false);
});
