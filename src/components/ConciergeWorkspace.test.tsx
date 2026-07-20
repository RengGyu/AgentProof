import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/ConciergeWorkspace.tsx", "utf8");
const reportView = readFileSync("src/components/ReportView.tsx", "utf8");
const css = readFileSync("src/app/globals.css", "utf8");
describe("concierge UI boundary", () => {
  it("does not persist reports or expose generic share/comment actions", () => {
    expect(source).not.toContain("localStorage"); expect(source).not.toContain("saveReportToHistory");
    expect(source).toContain('surface="concierge"');
    expect(reportView).toContain("!isConcierge && !isSummaryMode && report.source.url");
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
    expect(source).toContain("scrollIntoView"); expect(source).toContain("reportRef.current?.focus()");
    expect(css).toContain('.concierge-layout.has-report > [aria-label="Concierge evidence report"] { order: 1; }');
  });
  it("renders the two non-certification cautions", () => {
    expect(reportView).toContain("증거 부족은 구현 실패를 의미하지 않습니다.");
    expect(reportView).toContain("이 보고서는 merge 결정이나 correctness 인증이 아닙니다.");
  });
});
