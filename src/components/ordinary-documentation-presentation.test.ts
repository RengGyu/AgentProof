import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "./ReportView";
import { DetailedEvidence } from "./PublicGitHubDashboard";
import { reportToMarkdown, reportToGitHubComment } from "@/lib/markdown";
import { dashboardReportToMarkdown, dashboardReportToJson } from "@/lib/dashboard-report-export";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";
import { demoScenarios } from "@/lib/sample-data";
import type { VerificationReportV2 } from "@/lib/types";

function fixture() {
  const report = generateVerificationReportV2FromInput(demoScenarios.clean) as VerificationReportV2;
  report.ordinaryDocumentationSummary = {
    version: 1, scope: "literal_presence_only", predicates: [
      { sourceKind: "pr_body", sourceOrdinal: 2, legacyRequirementId: "req_1", state: "supported" },
      { sourceKind: "linked_issue", sourceOrdinal: 3, legacyRequirementId: "req_2", state: "contradicted" },
      { sourceKind: "pr_body", sourceOrdinal: 4, legacyRequirementId: null, state: "unavailable" }
    ]
  };
  Object.assign(report, { privateDocumentationContext: { path: "PRIVATE_DOCUMENT.md", literal: "PRIVATE_LITERAL", sourceText: "PRIVATE_SOURCE_TEXT", targetId: "PRIVATE_TARGET_ID" } });
  return report;
}

describe("scoped documentation presentation", () => {
  it.each([
    ["report UI", (report: VerificationReportV2) => renderToStaticMarkup(createElement(ReportView, { report }))],
    ["dashboard UI", (report: VerificationReportV2) => renderToStaticMarkup(createElement(DetailedEvidence, { detail: { report, freshness: "current", copyEligible: true }, demoMode: true }))],
    ["full Markdown", reportToMarkdown],
    ["PR comment", reportToGitHubComment],
    ["dashboard Markdown", (report: VerificationReportV2) => dashboardReportToMarkdown({ report, freshness: "current", copyEligible: true })]
  ])("preserves scoped documentation findings and privacy in %s", (_name, render) => {
    const report = fixture();
    const output = render(report);
    expect(output).toContain("source item 2 (req_1): literal present");
    expect(output).toContain("source item 3 (req_2): literal absent after complete artifact read");
    expect(output).toContain("source item 4: exact-head artifact unavailable");
    expect(output).toContain("not whole-goal or PR verification");
    expect(output).toContain("author claim needs reviewer confirmation");
    expect(output).not.toMatch(/PRIVATE_DOCUMENT|PRIVATE_LITERAL|PRIVATE_SOURCE_TEXT|PRIVATE_TARGET_ID/);
  });

  it("preserves the allowlisted documentation predicates in dashboard JSON", () => {
    const report = fixture();
    const detail = { report, freshness: "current" as const, copyEligible: true };
    const json = JSON.parse(dashboardReportToJson(detail));
    expect(json.documentation_predicates).toEqual(report.ordinaryDocumentationSummary);
    expect(JSON.stringify(json)).not.toMatch(/PRIVATE_DOCUMENT|PRIVATE_LITERAL|PRIVATE_SOURCE_TEXT|PRIVATE_TARGET_ID/);
  });

  it("leaves the report, dashboard and exports unchanged when the optional summary is absent", () => {
    const report = fixture();
    delete report.ordinaryDocumentationSummary;
    const detail = { report, freshness: "current" as const, copyEligible: true };
    for (const output of [renderToStaticMarkup(createElement(ReportView, { report })), renderToStaticMarkup(createElement(DetailedEvidence, { detail, demoMode: true })), reportToMarkdown(report), reportToGitHubComment(report), dashboardReportToMarkdown(detail), dashboardReportToJson(detail)]) {
      expect(output).not.toContain("Documentation predicate evidence");
      expect(output).not.toContain("literal_presence_only");
      expect(output).not.toContain("source item");
    }
  });
});
