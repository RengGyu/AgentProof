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
  expect(html.indexOf('aria-label="Read code for src/reset.ts"')).toBeLessThan(html.indexOf("Copy report"));
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
