import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { QuickSummaryPanel } from "./PublicGitHubDashboard";
import { ReportView } from "./ReportView";
import { toQuickSummary, type DashboardReportDetail } from "@/lib/github-dashboard-view-model";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";
import { demoScenarios } from "@/lib/sample-data";

function render(detail: DashboardReportDetail) {
  return renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} demoMode={false} showDetailedEvidence={false} onShowDetail={() => {}} />);
}
it.each([undefined, { state: "authoritative" as const }])("keeps detailed evidence closed until requested (contract: %j)", verificationContract => {
  const detail = { id: "saved", report: { reportSchemaVersion: "verification-report.v2" as const, verificationContract, requirements: [], evidenceIndex: [] } };
  const closed = render(detail);
  expect(closed).toContain('aria-expanded="false" aria-controls="report-evidence-detail"');
  expect(closed).toContain('id="report-evidence-detail" hidden=""');
  expect(closed).toContain("Evidence &amp; code");
  expect(closed).not.toContain('class="detailed-evidence');
  expect(closed).not.toContain("Enhanced planning policy");
  const open = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} demoMode={false} showDetailedEvidence={true} onShowDetail={() => {}} />);
  expect(open).toContain('id="report-evidence-detail"');
  expect(open).toContain("Hide evidence");
});
it("keeps an ordinary PR summary visible with actual checks before opening evidence", () => {
  const html = render({ id: "saved", headSha: "a".repeat(40), report: {
    reportSchemaVersion: "verification-report.v2", requirements: [],
    evidenceIndex: [{ id: "diff", kind: "diff", locator: "src/reset.ts" }],
    testing: { ciStatus: "failed", lintStatus: "passed", typecheckStatus: "unknown" },
    reviewPriority: [{ path: "src/reset.ts", priority: "high" }]
  } });
  expect(html).toContain('aria-label="Report summary"');
  expect(html).not.toContain("What changed");
  expect(html).toContain("CI failed");
  expect(html).toContain("Review the failing CI check");
  expect(html).not.toContain('aria-label="PR-to-Evidence Review"');
});
it("shows contract evidence gaps without upgrading missing evidence to a code failure", () => {
  const html = render({ report: {
    reportSchemaVersion: "verification-report.v2", verificationContract: { state: "authoritative" },
    requirements: [{ requirementId: "req", requirementText: "Reject expired links", status: "missing", evidenceRefs: [], gaps: ["No linked expiry test result."] }],
    testing: { ciStatus: "unknown", lintStatus: "unknown", typecheckStatus: "unknown" }
  } });
  expect(html).toContain('aria-label="Report summary"');
  expect(html).toContain("No linked expiry test result.");
  expect(html).not.toMatch(/not implemented|safe to merge|requirements satisfied/i);
});
it("keeps unavailable change/check evidence honest in the top summary", () => {
  const html = render({ report: { requirements: [], evidenceIndex: [] } });
  expect(html).not.toContain("Change details are unavailable");
  expect(html).toContain("Checks not recorded");
  expect(html).toContain("Collect execution results");
});
it("also shows the concise summary in the full report reader", () => {
  const report = generateVerificationReportV2FromInput(demoScenarios.clean);
  const html = renderToStaticMarkup(<ReportView report={report} />);
  expect(html).toContain('aria-label="Report summary"');
  expect(html).not.toContain("What changed");
  expect(html).toContain("Inspect first");
});
it.each([undefined, { state: "authoritative" as const }])("opens saved dashboard references through the in-app reader, without exposing it in an unsaved report (contract: %j)", verificationContract => {
  const detail = { id: "saved", repositoryFullName: "owner/repo", headSha: "a".repeat(40), report: {
    reportSchemaVersion: "verification-report.v2" as const, verificationContract, requirements: [],
    evidenceIndex: [{ id: "code", kind: "diff" as const, locator: "src/reset.ts", codeLocation: { path: "src/reset.ts", side: "head" as const, revisionSha: "a".repeat(40), line: 25 } }]
  } };
  const html = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} demoMode={false} showDetailedEvidence={true} onShowDetail={() => {}} />);
  expect(html).toContain('aria-label="Read code for src/reset.ts"');
  expect(html).not.toContain('href="https://github.com/owner/repo/blob/');
  // The summary copy is available before opening evidence. Source reading precedes
  // the evidence export actions, not the independent summary copy.
  const reader = html.slice(html.indexOf('id="report-evidence-detail"'));
  expect(reader.indexOf('aria-label="Read code for src/reset.ts"')).toBeLessThan(reader.indexOf("Copy report"));
  const actions = html.slice(html.indexOf('class="summary-actions"'), html.indexOf('id="report-evidence-detail"'));
  expect(actions.indexOf("Hide evidence")).toBeLessThan(actions.indexOf("Copy selected report"));
  expect(html).toContain('<details class="dashboard-report-export"><summary>Export report</summary>');
  expect(render({ ...detail, id: undefined })).not.toContain('aria-label="Read code');
});

it('keeps volume diagnostics in exports while presenting unresolved evidence as human inspection', async () => {
 const {reportToMarkdown}=await import('@/lib/markdown');
 const report=generateVerificationReportV2FromInput(demoScenarios.clean);
 const diagnostics=['GitHub changed-file evidence was capped at 120 files.','Diff was truncated at 1000 characters.','Evidence index was bounded at 200 items; omitted diff:120.','This PR exceeds the 120 changed-file evidence cap; split it or expect incomplete file evidence.'];
 report.limitations=diagnostics;
 report.evidenceIndex[0].summary="Recorded diff\n...[truncated for privacy and token control]";
 const before=JSON.stringify(report);
 const html=renderToStaticMarkup(<ReportView report={report}/>);
 expect(html).not.toMatch(/capped at 120|truncated at 1000|bounded at 200|omitted diff:120|changed-file evidence cap|truncated for privacy/);
 expect(html).toContain('Inspect the linked source and code');
 expect(JSON.stringify(report)).toBe(before);
 for(const diagnostic of diagnostics)expect(reportToMarkdown(report)).toContain(diagnostic);
});
it("shows a saved purpose, its interpretation and its cited range once across the summary and opened evidence", () => {
  const head = "533b43ad994ced329b6691d33c549e9c17b102de", ref = "pe_" + "1".repeat(24), goalId = "pg_" + "1".repeat(24);
  const purpose = "Clarify in the README that inspecting static test assertions does not establish that a test ran.";
  const change = "This README clarification states that execution status requires recorded check or log evidence.";
  const detail = { id: "saved", repositoryFullName: "owner/repo", pullRequestNumber: 122, headSha: head, freshness: "current" as const, report: {
    reportSchemaVersion: "verification-report.v2" as const, requirements: [], testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" },
    purposeAssessmentSummary: { version: 1, flow: "explore_final_v1", scope: "stated_purpose_at_snapshot", state: "limited", overall: "partial", limitations: [],
      goals: [{ goalId, authority: "author_claim", achievement: "partial", assurance: "evidence_assessed", implementation: "supports", testRelation: "unknown", execution: "not_observed" }] },
    purposeReview: { version: 1, flow: "explore_final_v1", headSha: head, baseSha: "c".repeat(40), references: [{ id: ref, path: "README.md", side: "head", revision: head, startLine: 109, endLine: 116 }],
      clauses: [{ clauseId: "pc_" + "1".repeat(24), goalId, purpose, conditions: ["Execution status needs recorded check or log evidence."], implementation: "supports", changeDescriptions: [{ text: change, evidenceRefs: [ref] }], testDescriptions: [] }] } } } as unknown as DashboardReportDetail;
  const html = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} demoMode={true} showDetailedEvidence={true} onShowDetail={() => {}} />);
  for (const text of [purpose, change]) expect(html.split(text)).toHaveLength(2);
  // The cited range is read once in the summary, plus once as its select button in the opened cited-code reader.
  const reader = html.slice(html.indexOf('class="report-code-evidence"'));
  expect(html.replace(/<[^>]+>/g, "").split("README.md:109-116")).toHaveLength(3);
  expect(reader.replace(/<[^>]+>/g, "").split("README.md:109-116")).toHaveLength(2);
  expect(html).toContain("Execution status needs recorded check or log evidence.");
  expect(html).not.toContain("Inspect first");
  // The exact revision stays in the source link, not in a revision dump or a full head SHA display.
  expect(html).toContain("/blob/533b43ad994ced329b6691d33c549e9c17b102de/README.md#L109-L116");
  expect(html.replace(/href="[^"]*"/g, "")).not.toContain("533b43ad994ced329b6691d33c549e9c17b102de");
  expect(html).not.toMatch(/Show full revisions|Evidence only|human review required/);
  expect(html).not.toContain('aria-label="Purpose evidence"');
  const actions = html.slice(html.indexOf('class="summary-actions"'), html.indexOf('id="report-evidence-detail"'));
  expect(actions.indexOf("dashboard-primary-action")).toBeLessThan(actions.indexOf("Copy report"));
  expect(actions).toContain('class="dashboard-secondary-action dashboard-github-link"');
  const ko = { ...detail, report: { ...detail.report, purposeReview: { ...(detail.report as any).purposeReview, locale: "ko" } } } as DashboardReportDetail;
  const koHtml = renderToStaticMarkup(<QuickSummaryPanel detail={ko} quickSummary={toQuickSummary(ko)} demoMode={true} showDetailedEvidence={false} onShowDetail={() => {}} />);
  for (const text of ["적합", "<h4>변경</h4>", purpose, change, "CI 통과"]) expect(koHtml).toContain(text);
  // Report actions use the saved locale; model text is untouched.
  expect(koHtml).toContain("보고서 복사");expect(koHtml).toContain("근거 코드");expect(koHtml).not.toContain("Copy report");expect(koHtml).not.toContain("Evidence &amp; code");
  const koOpen=renderToStaticMarkup(<QuickSummaryPanel detail={ko} quickSummary={toQuickSummary(ko)} demoMode={false} showDetailedEvidence={true} onShowDetail={()=>{}}/>);for(const label of ["코드 닫기","설명으로","보고서 내보내기","JSON 복사"])expect(koOpen).toContain(label);expect(koOpen).toContain('class="report-materials"');
});
