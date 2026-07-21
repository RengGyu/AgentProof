import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/ConciergeWorkspace.tsx", "utf8");
const reportView = readFileSync("src/components/ReportView.tsx", "utf8");
const conciergeReport = readFileSync("src/components/ConciergeReportView.tsx", "utf8");
const feedback = readFileSync("src/components/ConciergeFeedbackForm.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
describe("concierge UI boundary", () => {
  it("does not persist reports or expose generic share/comment actions", () => {
    expect(source).not.toContain("localStorage"); expect(source).not.toContain("saveReportToHistory");
    expect(source).toContain("<ConciergeReportView report={report}");
    expect(reportView).toContain("!isConcierge && !isSummaryMode && report.source.url");
    expect(conciergeReport).not.toContain("buildShareUrl");
    expect(conciergeReport).not.toContain("postGitHubComment");
  });
  it("starts only a durable same-origin session and clears the bootstrap input", () => {
    expect(source).toContain('"/api/tenants/auth/session"');
    expect(source).toContain('"x-agentproof-tenant-auth-token": bootstrapToken');
    expect(source).toContain('credentials: "same-origin"');
    expect(source).toContain('setBootstrapToken("")');
    expect(source).toContain("isTenantSessionStartResponse");
    expect(source).toContain("isTenantSessionDeleteResponse");
    expect(source).toContain("sessionStartInFlight.current");
    expect(source).toContain('revoke.ok ? "session_response_invalid" : revoke.code');
    expect(source).not.toContain("sessionStorage");
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
  it("locks the pre-report judgment before rendering the report", () => {
    expect(source).toContain("lockedPreReportGapCategory");
    expect(source).toContain("setLockedPreReportGapCategory(frozenPreReportGapCategory)");
    expect(source).toContain("preReportGapCategory={lockedPreReportGapCategory}");
    expect(feedback).not.toContain("setPreReportGapCategory");
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
