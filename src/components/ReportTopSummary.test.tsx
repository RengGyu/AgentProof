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
type Review = NonNullable<NonNullable<DashboardReportDetail["report"]>["purposeReview"]>;
const head = "a".repeat(40), base = "b".repeat(40);
const purposeReport = (clauses: Review["clauses"], references: Review["references"], locale?: "en" | "ko") => ({ requirements: [], testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" },
  purposeReview: { version: 1, flow: "explore_final_v1", ...(locale ? { locale } : {}), headSha: head, baseSha: base, clauses, references } }) as DashboardReportDetail["report"];
const refs: Review["references"] = [
  { id: "pe_h", path: "src/queue/worker.py", side: "head", revision: head, startLine: 3, endLine: 9 },
  { id: "pe_b", path: "src/Connect.java", side: "base", revision: base, startLine: 10, endLine: 24 },
  { id: "pe_t", path: "tests/test_queue.py", side: "head", revision: head, startLine: 20, endLine: 31 }];
const clauses: Review["clauses"] = [
  { clauseId: "pc_1", goalId: "pg_1", purpose: "Keep queued work", implementation: "supports", conditions: ["Only for pending items"], exceptions: ["Not for cancelled jobs"],
    changeDescriptions: [{ text: "The queue now keeps pending items.", evidenceRefs: ["pe_h"] }, { text: "Second detail.", evidenceRefs: ["pe_b"] }], testDescriptions: [{ text: "The test asserts retention.", evidenceRefs: ["pe_t"] }] },
  { clauseId: "pc_2", goalId: "pg_1", purpose: "Retry failed jobs", implementation: "contradicts", changeDescriptions: [], testDescriptions: [{ text: "The test expects no retry.", evidenceRefs: ["pe_t"] }] },
  { clauseId: "pc_3", goalId: "pg_1", purpose: "Count failures", implementation: "unknown", changeDescriptions: [{ text: "A counter field is added.", evidenceRefs: ["pe_h"] }], testDescriptions: [] },
  { clauseId: "pc_4", goalId: "pg_1", purpose: "Audit statements", implementation: "contradicts", changeDescriptions: [], testDescriptions: [], evidenceRefs: ["pe_b"] }];

it("keeps primary claims open and preserves intent scope and extra tests in details without inventing a lead", () => {
  const html = summary(purposeReport(clauses, refs));
  for(const text of ['Keep queued work','Second detail.','The test asserts retention.','Only for pending items','Not for cancelled jobs','Audit statements','Selected change locations','CI passed'])expect(html).toContain(text);
  expect(html).toContain('data-claim="change"');expect(html).toContain('data-claim="test"');expect(html).not.toContain('report-purpose-overflow');
  const primary=html.split('<details class="report-purpose-details">')[0];expect(primary).toContain('Second detail.');for(const text of ['Only for pending items','Not for cancelled jobs','The test asserts retention.']){expect(primary).not.toContain(text);expect(html).toContain(text);}
  // Short verdicts, one model-interpretation context, and no blanket disclaimers in the reading view.
  for (const text of ['>Fits</span>','>Conflicts</span>','>Insufficient evidence</span>']) expect(html).toContain(text);
  expect(html.match(/Model interpretation/g)).toHaveLength(1);
  expect(html).not.toMatch(/model interpretations, not verified|These interpretations cover|Consistent with stated intent|From the stated intent/);
});
it("keeps the full path behind a keyboard disclosure while per-claim links stay exact, without revision or author dumps",()=>{
 const review={mode:'change_summary',source:null,changes:[],objectives:[],nextInspection:'',repositoryFullName:'owner/repo',purpose:{goals:[{goalId:'pg_1',authority:'author_claim'}]}} as any;
 const html=renderToStaticMarkup(<ReportTopSummary report={purposeReport(clauses,refs)} review={review}/>);
 expect(html).toContain(`href="https://github.com/owner/repo/blob/${head}/src/queue/worker.py#L3-L9"`);expect(html).toContain('aria-label="src/queue/worker.py, after change, lines 3-9, open on GitHub"');
 expect(html).toContain('<summary>Path</summary><code translate="no">src/queue/worker.py</code>');expect(html).not.toMatch(/<details[^>]* open/);
 // The exact revision lives only in the links; no revision dump, author source or visible "after change" marker on every reference.
 expect(html.replace(/href="[^"]*"/g,'')).not.toContain(head);expect(html).not.toMatch(/Show full revisions|Author claim|report-ref-side">after change/);
});
it("uses Korean saved labels without changing model text, and legacy without locale stays English",()=>{
 const ko=summary(purposeReport([{...clauses[0],purpose:'대기 중인 작업 유지',changeDescriptions:[{text:'변경된 소스는 대기 중인 작업을 유지합니다.',evidenceRefs:['pe_h']}]}],refs,'ko'));
 for(const text of ['lang="ko"','변경 요약','<h4>변경</h4>','대기 중인 작업 유지','변경된 소스는 대기 중인 작업을 유지합니다.','CI 통과','>적합</span>'])expect(ko).toContain(text);
 expect(ko).not.toMatch(/전체 리비전 보기|작성자 의도 기준|판정과 설명은 모델 해석이며|이 해석은 인용된 변경 소스만/);
 expect(ko).not.toContain('Conclusion');expect(summary(purposeReport(clauses,refs))).toContain('Change summary');
});
it('places cited behavior in the first card, keeps explicit conflicts visible, and folds background without editing prose',()=>{
 const primary={...clauses[0],changeSummary:{text:'Keep pending items until completed',evidenceRefs:['pe_h']},scopeNotes:[{text:'This is an independent example only.',evidenceRefs:['pe_b']}],changeDescriptions:[{text:'Pending items stay queued unless cancelled.',evidenceRefs:['pe_h']}]};
 const report=purposeReport([primary,...clauses.slice(1)],refs),before=JSON.stringify(report),html=summary(report);
 expect(html.indexOf('Pending items stay queued unless cancelled.')).toBeLessThan(html.indexOf('report-execution-records'));
 expect(html.indexOf('The test expects no retry.')).toBeLessThan(html.indexOf('report-purpose-details'));
 expect(html.indexOf('This is an independent example only.')).toBeGreaterThan(html.indexOf('report-purpose-details'));
 expect(html.indexOf('Only for pending items')).toBeGreaterThan(html.indexOf('report-purpose-details'));
 expect(html).toContain('data-reference-id="pe_h"');expect(JSON.stringify(report)).toBe(before);
});

it('does not fold a separately selected supported purpose or a conflicting static assertion',()=>{
 const conflict={...clauses[1],changeDescriptions:[{text:'The implementation retries.',evidenceRefs:['pe_h']}],counterEvidenceRefs:['pe_t']};
 const html=summary(purposeReport([clauses[0],clauses[2],conflict],refs));const main=html.split('<details class="report-purpose-details">')[0];expect(main).toContain('A counter field is added.');expect(main).toContain('The test expects no retry.');expect(main.indexOf('The test expects no retry.')).toBeLessThan(main.indexOf('>Conflicts</span>'));
});
