import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportCodeViewer, clearReportCodeCache } from "./ReportCodeViewer";
import type { PrEvidenceReviewItem } from "@/lib/pr-evidence-review";
const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as Array<() => void> }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState(initial: any) { const index = hooks.index++; if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial; return [hooks.slots[index], (next: any) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }]; },
  useEffect(work: () => any, deps: any[]) { const index = hooks.index++; const old = hooks.slots[index]; if (!old || deps.some((v,i) => v !== old.deps[i])) hooks.effects.push(() => { old?.cleanup?.(); hooks.slots[index] = { deps, cleanup: work() }; }); }
}));
const head = "a".repeat(40);
let item: PrEvidenceReviewItem, id: string, tree: any, runtime: any, response: any;
let request: ReturnType<typeof vi.fn<(path: string, init?: RequestInit) => Promise<Response>>>;
function nodes(value: any = tree): any[] { return Array.isArray(value) ? value.flatMap(n => nodes(n)) : value?.props ? [value, ...nodes(value.props.children)] : []; }
function text(value: any = tree): string { return Array.isArray(value) ? value.map(v => text(v)).join(" ") : value?.props ? text(value.props.children) : typeof value === "string" || typeof value === "number" ? String(value) : ""; }
function render() { hooks.index = 0; tree = ReportCodeViewer({ item, reportId: id, runtime }); hooks.effects.splice(0).forEach(work => work()); }
async function settle() { for (let i = 0; i < 16; i++) await Promise.resolve(); render(); }
function click(label: string) { const button = nodes().find(node => node.type === "button" && node.props["aria-label"] === label); expect(button, label).toBeTruthy(); button.props.onClick(); render(); }
beforeEach(() => {
  hooks.slots = []; hooks.index = 0; hooks.effects = []; id = "report-one"; clearReportCodeCache();
  item = { evidenceId: "code", kind: "code", label: "src/reset.ts", line: 25, relation: "candidate", url: `https://github.com/owner/repo/blob/${head}/src/reset.ts#L25` };
  response = { reference: "code:25", path: "src/reset.ts", revision: head, focusLine: 25, totalLines: 30, lines: [{ number: 25, text: "return expired;" }], truncated: true };
  request = vi.fn(async () => Response.json(response)); runtime = { request };
});
afterEach(() => { hooks.slots.forEach(slot => slot?.cleanup?.()); });
it("loads no code until requested, then shows exact file/revision/line text inside the app", async () => {
  render(); expect(request).not.toHaveBeenCalled();
  click("Read code for src/reset.ts"); expect(text()).toContain("Loading referenced code"); await settle();
  expect(request.mock.calls[0][0]).toBe("/api/dashboard/report-code?reportId=report-one&reference=code%3A25");
  expect(text()).toContain("src/reset.ts"); expect(text()).toContain(head.slice(0, 12));
  expect(text()).toContain("25"); expect(text()).toContain("return expired;");
  expect(text()).toContain("secrets redacted"); expect(text()).not.toMatch(/before|after|removed line/i);
  expect(nodes().some(node => node.props.className === "report-code-scroll" && node.props.tabIndex === 0)).toBe(true);
  click("Close code for src/reset.ts"); expect(text()).not.toContain("return expired;");
});
it("reopens code already read on this page without another request", async () => {
  render(); click("Read code for src/reset.ts"); await settle();
  click("Close code for src/reset.ts"); click("Read code for src/reset.ts"); await settle();
  expect(request).toHaveBeenCalledTimes(1); expect(text()).toContain("return expired;");
  clearReportCodeCache(); click("Close code for src/reset.ts"); click("Read code for src/reset.ts"); await settle();
  expect(request).toHaveBeenCalledTimes(2);
});
it("aborts an on-demand read on close and ignores its late response", async () => {
  let finish!: (value: Response) => void; request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(); click("Read code for src/reset.ts"); const signal = request.mock.calls[0][1]?.signal;
  click("Close code for src/reset.ts"); expect(signal?.aborted).toBe(true);
  finish(Response.json(response)); await settle(); expect(text()).not.toContain("return expired;");
});
it("does not show old report code while the selected report changes", async () => {
  render(); click("Read code for src/reset.ts"); await settle(); expect(text()).toContain("return expired;");
  id = "report-two"; request.mockResolvedValueOnce(Response.json({ error: "Not available" }, { status: 404 })); render();
  expect(text()).not.toContain("return expired;"); await settle(); expect(text()).toContain("Not available");
});
it("shows permission failures without implying missing implementation, and retries", async () => {
  request.mockResolvedValueOnce(Response.json({ error: "Repository access is unavailable." }, { status: 403 }));
  render(); click("Read code for src/reset.ts"); await settle();
  expect(text()).toContain("Repository access is unavailable"); expect(text()).not.toMatch(/not implemented/i);
  click("Retry referenced code"); await settle(); expect(text()).toContain("return expired;");
});
it("handles empty code honestly", async () => {
  response = { ...response, lines: [], totalLines: 0, truncated: false };
  render(); click("Read code for src/reset.ts"); await settle(); expect(text()).toContain("This file is empty at the recorded revision.");
});
it.each([{ path: "other.ts" }, { revision: "b".repeat(40) }, { reference: "unrelated:1" }, { lines: [{ number: -1, text: "untrusted-code" }] }])("rejects mismatched or malformed excerpt metadata (case %#)", async change => {
  response = { ...response, ...change }; render(); click("Read code for src/reset.ts"); await settle();
  expect(text()).toContain("Code could not be matched"); expect(text()).not.toContain("return expired;"); expect(text()).not.toContain("untrusted-code");
});
