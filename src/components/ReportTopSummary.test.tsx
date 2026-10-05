import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReportTopSummary } from "./ReportTopSummary";
import type { DashboardReportDetail } from "@/lib/github-dashboard-view-model";

function summary(report: DashboardReportDetail["report"]) {
  return renderToStaticMarkup(<ReportTopSummary report={report} />);
}
it.each([
  [{ ciStatus: "failed", lintStatus: "passed", typecheckStatus: "unknown" }, "CI failed", "Review the failing CI check."],
  [{ ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "pending" }, "Typecheck pending", "Wait for Typecheck, then refresh."],
  [{ ciStatus: "unknown", lintStatus: "unknown", typecheckStatus: "unknown" }, "Checks not recorded", "Collect execution results for this commit."],
  [{ ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" }, "Other checks not recorded", "Review the referenced evidence."],
] as const)("shows recorded execution status and one next inspection (%j)", (testing, status, next) => {
  const html = summary({ requirements: [], testing });
  expect(html).toContain(status);
  expect(html).toContain(next);
  expect(html.match(/<dd[ >]/g)).toHaveLength(2);
  expect(html).not.toMatch(/What changed|Needs attention|Next action|correctness confirmed|safe to merge|all checks passed/i);
});
it("colors each recorded check by its state and the next step by urgency", () => {
  const html = summary({ requirements: [], testing: { ciStatus: "failed", lintStatus: "passed", typecheckStatus: "pending" } });
  expect(html).toMatch(/tone-fail"><i aria-hidden="true"><\/i>CI failed/);
  expect(html).toMatch(/tone-ok"><i aria-hidden="true"><\/i>Lint passed/);
  expect(html).toMatch(/tone-wait"><i aria-hidden="true"><\/i>Typecheck pending/);
  expect(html).toContain('report-next tone-fail');
});
it("prioritizes incomplete collection over a long goal and file inventory, even with passing CI", () => {
  const report: DashboardReportDetail["report"] = {
    testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" },
    generalPrAssessmentSummary: { version: 1, mode: "ordinary_pr", sourceState: "pr_author_claim", overallConclusion: "collection_blocked", counts: { evidence_supported: 0, evidence_partial: 0, not_demonstrated: 0, contradicted: 0, blocked: 1, not_assessable: 0 }, reasonCodes: [] },
    requirements: [{ requirementId: "req", requirementText: "A long author goal that must remain in the underlying report", status: "missing", gaps: ["A lower-priority gap"], evidenceRefs: [] }],
    evidenceIndex: Array.from({ length: 73 }, (_, i) => ({ id: `file-${i}`, kind: "changed_file", locator: `src/file-${i}.ts` }))
  };
  const before = JSON.stringify(report);
  const html = summary(report);
  expect(html).toContain("CI passed");
  expect(html).toContain("Inspect the linked source and code for unresolved requirements.");
  expect(html).not.toContain("Retry incomplete");
  expect(html).not.toMatch(/A long author goal|src\/file-|73|lower-priority gap|Changed files|Stated change/);
  expect(JSON.stringify(report)).toBe(before);
});
it("keeps a single bounded gap without restating the requirement or implying missing implementation", () => {
  const html = summary({ requirements: [{ requirementId: "req", requirementText: "Reject expired reset links", status: "missing", gaps: ["No linked expiry test result.", "Second gap"], evidenceRefs: [] }], testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" } });
  expect(html).toContain("No linked expiry test result.");
  expect(html).not.toMatch(/Reject expired reset links|Second gap|not implemented/i);
});
