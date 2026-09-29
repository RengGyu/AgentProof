import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { PublicGitHubDashboard } from "./PublicGitHubDashboard";

// Exercise the component's real handlers and async state changes without a DOM dependency.
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => unknown> }));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState(initial: any) {
    const index = hooks.index++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: any) => { hooks.slots[index] = typeof value === "function" ? value(hooks.slots[index]) : value; }];
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
const repository = { installationId: 321, repositoryId: 100, repositoryFullName: "Owner/repo", enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: false };
const report = { id: "report-one", repositoryId: 100, pullRequestNumber: 1, headSha: "a".repeat(40), priority: "low", createdAt: "2026-09-29T00:00:00Z", freshness: "current" };
let reports: any[];
let activity: any[];
let fetchMock: ReturnType<typeof vi.fn>;
function render() {
  hooks.index = 0;
  tree = PublicGitHubDashboard({});
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
  hooks.slots = []; hooks.index = 0; hooks.effects = [];
  reports = [report];
  activity = [{ id: "job:one", kind: "analysis_completed", state: "Analysis completed", occurredAt: report.createdAt, repositoryId: 100, pullRequestNumber: 2 }];
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: vi.fn() }, setInterval: () => 1, clearInterval: vi.fn() });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/dashboard/session") return Response.json({ signedIn: true });
    if (url === "/api/dashboard/repositories") return Response.json({ repositories: [repository] });
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
  expect(text()).toContain("Repository reports");
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
  expect(text()).toContain("Reports could not be refreshed.");
  expect(text()).toContain("PR #1");
  await click(find("Open Inbox"));
  expect(text()).toContain("Activity could not be refreshed.");
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
  expect(text()).toContain("Repository reports");
  expect(text()).not.toContain("Showing this previous result.");
});


it("clears reports and activity when refreshed access is denied", async () => {
  await click(nodes().find(n => n.type === "button" && n.props.className?.includes("report-row"))!);
  fetchMock.mockImplementation(async () => Response.json({}, { status: 401 }));
  await click(find("Refresh reports and activity"));
  expect(nodes().some(n => n.props["aria-label"] === "Selected report")).toBe(false);
  expect(text()).not.toContain("PR #1");
  await click(find("Open Inbox"));
  expect(text(find("Inbox"))).toContain("No recent activity.");
});
