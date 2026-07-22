import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/ConciergeWorkspace.tsx", "utf8");
const reportView = readFileSync("src/components/ReportView.tsx", "utf8");
const conciergeReport = readFileSync("src/components/ConciergeReportView.tsx", "utf8");
const feedback = readFileSync("src/components/ConciergeFeedbackForm.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
describe("concierge UI boundary", () => {
  it("separates the welcome, setup, summary, and detail journey without browser persistence", () => {
    expect(source).toContain("PR 검토 시작");
    expect(source).toContain("검토할 PR을 선택하세요");
    expect(conciergeReport).toContain("검토 요약 · 2단계");
    expect(conciergeReport).toContain("상세 근거 · 3단계");
    expect(conciergeReport).toContain("검토 요약으로");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });
  it("keeps original-task reasons distinct in developer-facing copy", () => {
    expect(conciergeReport).toContain('not_linked: "연결된 GitHub Issue 없음"');
    expect(conciergeReport).toContain('linked_issue_inaccessible: "연결된 GitHub Issue 접근 불가"');
    expect(conciergeReport).toContain('linked_issue_deleted_or_empty: "연결된 GitHub Issue 내용 없음"');
    expect(conciergeReport).toContain('linked_reference_is_pull_request: "연결 참조가 Issue가 아닌 PR"');
  });
  it("does not persist reports or expose generic share/comment actions", () => {
    expect(source).not.toContain("localStorage"); expect(source).not.toContain("saveReportToHistory");
    expect(source).toContain("<ConciergeReportView report={report}");
    expect(reportView).toContain("!isConcierge && !isSummaryMode && report.source.url");
    expect(conciergeReport).not.toContain("buildShareUrl");
    expect(conciergeReport).not.toContain("postGitHubComment");
  });
  it("uses the GitHub OAuth session without browser-entered beta identities", () => {
    expect(source).toContain('"/api/auth/github/start"');
    expect(source).toContain('"/api/auth/me"');
    expect(source).toContain('"/api/auth/github/repositories"');
    expect(source).toContain('"/api/auth/github/session"');
    expect(source).toContain('credentials: "same-origin"');
    expect(source).not.toContain("tenant_alpha");
    expect(source).not.toContain("일회용 세션 시작 코드");
    expect(source).not.toContain("베타 공간 ID");
    expect(source).not.toContain("sessionStorage");
  });
  it("submits only the GitHub repository and PR while keeping internal ids server-side", () => {
    expect(source).toContain("허용된 개인 저장소");
    expect(source).toContain("pullRequestNumber: Number(form.pullRequestNumber)");
    const analyzeBody = source.slice(source.indexOf('body: JSON.stringify({\n          repositoryFullName'), source.indexOf('const json = await response.json()'));
    expect(analyzeBody).not.toContain("tenantId");
    expect(analyzeBody).not.toContain("installationId");
    expect(analyzeBody).not.toContain("repositoryId");
    expect(analyzeBody).not.toContain("explicitTask");
  });
  it("focuses the report and puts it first on mobile", () => {
    expect(source).toContain("reportRef.current?.focus({ preventScroll: true })");
    expect(source).toContain("document.documentElement.scrollTop = 0");
    expect(css).toContain('.concierge-layout.has-report > [aria-label="PR 증거 보고서"] { order: 1; }');
  });
  it("renders the two non-certification cautions", () => {
    expect(conciergeReport).toContain("증거 부족은 구현 실패를 뜻하지 않습니다.");
    expect(conciergeReport).toContain("이 보고서는 병합 여부를 결정하거나 구현이 맞다고 보증하지 않습니다.");
  });
  it("keeps pre-report judgment optional and isolated to evaluation feedback", () => {
    expect(source).toContain("lockedPreReportGapCategory");
    expect(source).toContain("setLockedPreReportGapCategory(frozenPreReportGapCategory)");
    expect(source).toContain("caseIdOrHash && lockedPreReportGapCategory");
    expect(source).toContain("평가 진행 시에만 사용");
    expect(source).toContain('<option value="">기록하지 않음</option>');
    expect(feedback).not.toContain("setPreReportGapCategory");
  });
  it("renders errors with a real icon and body instead of placing text in the 18px icon column", () => {
    expect(source).toContain('<CircleAlert size={18} aria-hidden="true" />');
    expect(source).toContain('className="intake-error-body"');
    expect(source).not.toContain('<p className="intake-error"');
  });
  it("keeps internal confidence and evidence identifiers off the summary screen", () => {
    const summaryStart = conciergeReport.indexOf('view === "summary"');
    const requirementStart = conciergeReport.indexOf('view === "requirements"');
    const summary = conciergeReport.slice(summaryStart, requirementStart);
    expect(summary).not.toContain("confidence");
    expect(summary).not.toContain("evidence.id");
    expect(summary).not.toContain("evidenceCoverage");
  });
});
