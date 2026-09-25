import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailedEvidence, QuickSummaryPanel } from "./PublicGitHubDashboard";
import { ReportView } from "./ReportView";
import { dashboardReportToMarkdown } from "@/lib/dashboard-report-export";
import { reportToMarkdown, reportToGitHubComment } from "@/lib/markdown";
import { buildDashboardPrEvidenceReview } from "@/lib/pr-evidence-review";
import { runGeneralPrObservationNowV2 } from "@/lib/general-pr-observation-service";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "@/lib/general-pr-runtime-policy";
import { toQuickSummary } from "@/lib/github-dashboard-view-model";
import { sanitizeReportForShare } from "@/lib/report-share";
import { resolveRuntimeReportValidation } from "@/lib/report-runtime-validation";
import { prepareTenantDetailReportForStorage } from "@/lib/server-report-store";
import { decodeTenantPersistedReport, projectTenantPersistedReport } from "@/lib/tenant-report-validation";
import type { GeneralPrAssessmentSummaryV1, PullRequestInput, VerificationReportV2 } from "@/lib/types";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const SECRET = "pr-evidence-review-test-signing-secret-long-enough";

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Reject expired reset links",
    url: "https://github.com/acme/widget/pull/42",
    taskText: "Acceptance criteria:\n- The service must reject expired reset links.",
    taskSource: "issue",
    description: "Rejects expired reset links.",
    changedFiles: [
      { path: "src/reset.ts", status: "modified", patch: "+ if (expired) return false" },
      { path: "src/reset.test.ts", previousPath: "test/reset.test.ts", status: "renamed", patch: "+ expect(reset(expired)).toBe(false)" },
      { path: "src/legacy.ts", status: "removed" },
    ],
    checks: [{ name: "unit", status: "failed", summary: "1 failed", url: "https://github.com/acme/widget/actions/runs/7" }],
    logs: [],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD,
      baseSha: BASE,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD },
      evidenceCapturedAt: "2026-09-15T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" },
    },
    ...overrides,
  };
}

function ordinarySummary(sourceState: GeneralPrAssessmentSummaryV1["sourceState"]): GeneralPrAssessmentSummaryV1 {
  const missing = sourceState === "missing";
  return {
    version: 1,
    mode: "ordinary_pr",
    sourceState,
    overallConclusion: missing ? "no_assessable_claims" : "evidence_partial",
    counts: { evidence_supported: 0, evidence_partial: missing ? 0 : 1, not_demonstrated: 0, contradicted: 0, blocked: 0, not_assessable: 0 },
    reasonCodes: missing ? ["source_missing"] : ["exact_execution_failed"],
  };
}

describe("PR-to-Evidence producer and surfaces", () => {
  it("shows only collected checks in the review and copied summary", () => {
    const report = generateVerificationReportV2FromInput(input());
    report.testing = { ...report.testing, ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" };
    const detail = { repositoryFullName: "acme/widget", pullRequestNumber: 42, headSha: HEAD, report, freshness: "current" as const, copyEligible: true };
    const html = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} onShowDetail={() => {}} showDetailedEvidence={false} demoMode={false} />);
    const markdown = dashboardReportToMarkdown(detail);
    expect(html).toContain("Checks: CI passed");
    expect(html).toContain("CI</span><strong>passed</strong>");
    expect(html).not.toContain("Lint</span><strong>unknown</strong>");
    expect(html).not.toContain("Typecheck</span><strong>unknown</strong>");
    expect(markdown).toContain("- CI: passed");
    expect(markdown).not.toContain("- Lint: unknown");
    expect(markdown).not.toContain("- Typecheck: unknown");
    expect(html).not.toMatch(/\bunknown\b|\bpartial(?:ly)?\b/i);
  });
  it("does not turn an ordinary saved summary into partial or unknown verdict badges", () => {
    const report = generateVerificationReportV2FromInput(input());
    report.testing = { ...report.testing, ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "unknown" };
    const html = renderToStaticMarkup(<ReportView report={report} mode="summary" />);
    expect(html).not.toMatch(/\bunknown\b|\bpartial(?:ly)?\b/i);
  });
  it("keeps candidate cards, source, and exact links invariant when only assessment changes", () => {
    const report = generateVerificationReportV2FromInput(input());
    const before = structuredClone(report);
    const states = [
      undefined,
      ordinarySummary("linked_issue"),
      ordinarySummary("missing"),
      ordinarySummary("ambiguous"),
      { ...ordinarySummary("pr_author_claim"), overallConclusion: "no_assessable_claims" as const },
      { ...ordinarySummary("pr_author_claim"), overallConclusion: "collection_blocked" as const },
    ];
    const outputs = states.map((summary) => {
      const candidate = { ...report, generalPrAssessmentSummary: summary };
      const detail = { repositoryFullName: "acme/widget", headSha: HEAD, report: candidate, freshness: "current" as const, copyEligible: true };
      const surfaces = [
        renderToStaticMarkup(<ReportView report={candidate} />),
        renderToStaticMarkup(<DetailedEvidence detail={detail} demoMode={false} />),
        reportToMarkdown(candidate),
        reportToGitHubComment(candidate),
        dashboardReportToMarkdown(detail),
      ];
      for (const surface of surfaces) {
        expect(surface).toContain("PR-to-Evidence Review");
        expect(surface).toContain("Linked issue requirement source");
        expect(surface).toContain(`blob/${HEAD}/src/reset.ts`);
        expect(surface).toContain(`blob/${BASE}/src/legacy.ts`);
        expect(surface).not.toContain("No approved verification contract");
        expect(surface).not.toMatch(/Agent Claims|Agent Re-prompt|SUPPORTED|UNPROVEN|Ordinary PR [Ee]vidence [Aa]ssessment/);
      }
      return surfaces;
    });
    for (const output of outputs) expect(output).toEqual(outputs[0]);
    expect(report).toEqual(before);
  });

  it("shows ordinary PR objectives and exact code links before opening supporting details", () => {
    const report = generateVerificationReportV2FromInput(input());
    const detail = { repositoryFullName: "acme/widget", pullRequestNumber: 42, headSha: HEAD, report, freshness: "current" as const, copyEligible: true };
    const html = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} onShowDetail={() => {}} showDetailedEvidence={false} demoMode={false} />);
    expect(html).toContain("The service must reject expired reset links");
    expect(html).toContain(`blob/${HEAD}/src/reset.ts`);
    expect(html).toContain("Copy report");
    expect(html).toContain("Copy JSON");
    expect(html).toContain("Checks &amp; CI");
    expect(html.indexOf("PR-to-Evidence Review")).toBeLessThan(html.indexOf("Check state"));
  });

  it("keeps non-current ordinary reports readable with copy actions disabled", () => {
    const report = generateVerificationReportV2FromInput(input());
    const detail = { repositoryFullName: "acme/widget", headSha: HEAD, report, freshness: "refreshing" as const, copyEligible: false };
    const html = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} onShowDetail={() => {}} showDetailedEvidence={false} demoMode={false} />);
    expect(html).toContain(`blob/${HEAD}/src/reset.ts`);
    expect(html).toContain("This saved report remains readable");
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });

  it("keeps zero requirements neutral without assessment on every surface", () => {
    const report = generateVerificationReportV2FromInput(input({ taskText: "", description: "", taskSource: "task" }));
    expect(report.requirements).toHaveLength(0);
    for (const summary of [undefined, ordinarySummary("missing"), ordinarySummary("linked_issue")]) {
      const candidate = { ...report, generalPrAssessmentSummary: summary };
      for (const surface of [
        renderToStaticMarkup(<ReportView report={candidate} />),
        renderToStaticMarkup(<DetailedEvidence detail={{ report: candidate }} demoMode={false} />),
        renderToStaticMarkup(<QuickSummaryPanel detail={{ report: candidate }} quickSummary={toQuickSummary({ report: candidate })} onShowDetail={() => {}} showDetailedEvidence={false} demoMode={false} />),
        reportToMarkdown(candidate), reportToGitHubComment(candidate),
        dashboardReportToMarkdown({ report: candidate, freshness: "current", copyEligible: true }),
      ]) {
        expect(surface).toMatch(/Collected changes/i);
        expect(surface).not.toMatch(/unknown purpose|missing description|No original task text was provided|No approved verification contract|no assessable|Requirement Coverage|Requirement Proof Gaps|Agent Re-prompt|More proof is needed/i);
      }
    }
  });

  it("derives issue, PR-author, and change-summary modes through the actual advisory pipeline without a provider", async () => {
    const cases = [
      { input: input(), source: "linked_issue", mode: "objectives" },
      { input: input({ taskText: "", taskSource: "task", description: "The service must reject expired reset links." }), source: "pr_author_claim", mode: "objectives" },
      { input: input({ title: "Maintenance", taskText: "", taskSource: "task", description: "" }), source: "pr_author_claim", mode: "change_summary" },
    ] as const;

    for (const fixture of cases) {
      const result = await runGeneralPrObservationNowV2({
        policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
        input: fixture.input,
        generateReport: generateVerificationReportV2FromInput,
        validateDeterministicReport: (candidateInput, candidateReport) => resolveRuntimeReportValidation({ boundary: "generated_private_full", input: candidateInput, report: candidateReport, requireV2: true }).valid,
      });
      const produced = result.report as VerificationReportV2;
      expect(produced.generalPrAssessmentSummary?.sourceState).toBe(fixture.source);
      expect(produced.generalPrAssessmentSummary?.mode).toBe("ordinary_pr");
      expect(buildDashboardPrEvidenceReview({ repositoryFullName: "acme/widget", headSha: HEAD, report: produced })?.mode).toBe(fixture.mode);
    }
  });

  it("preserves canonical code locations through tenant save/hydrate and renders exact dashboard links", () => {
    const report = generateVerificationReportV2FromInput(input());
    report.generalPrAssessmentSummary = {
      ...ordinarySummary("linked_issue"),
      sourceState: "pr_author_claim",
      reasonCodes: ["author_claim_requires_confirmation"]
    };
    const safe = prepareTenantDetailReportForStorage(report, "verified_agentproof", SECRET);
    const persisted = projectTenantPersistedReport(safe, SECRET);
    const decoded = decodeTenantPersistedReport(persisted, { signingSecret: SECRET, createdAt: report.createdAt });
    expect(decoded.status).toBe("valid");
    if (decoded.status !== "valid") throw new Error("fixture did not hydrate");

    expect(persisted.evidenceIndex.map((item) => item.codeLocation).filter(Boolean)).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/reset.ts", side: "head", revisionSha: HEAD }),
      expect.objectContaining({ path: "src/reset.test.ts", previousPath: "test/reset.test.ts", side: "head", revisionSha: HEAD }),
      expect.objectContaining({ path: "src/legacy.ts", side: "base", revisionSha: BASE }),
    ]));
    expect(JSON.stringify(sanitizeReportForShare(report))).not.toContain("codeLocation");

    const detail = { id: "saved_1", createdAt: report.createdAt, repositoryFullName: "acme/widget", pullRequestNumber: 42, headSha: HEAD, freshness: "current" as const, copyEligible: true, report: decoded.report };
    const review = buildDashboardPrEvidenceReview(detail);
    expect(review?.source).toEqual({ kind: "linked_issue", label: "Linked issue requirement source", authority: "issue_source" });
    expect([...(review?.objectives.flatMap((item) => [...item.code, ...item.tests]) ?? []), ...(review?.changes ?? [])].map((item) => item.url)).toEqual(expect.arrayContaining([
      `https://github.com/acme/widget/blob/${HEAD}/src/reset.ts`,
      `https://github.com/acme/widget/blob/${BASE}/src/legacy.ts`,
    ]));
    const dashboardHtml = renderToStaticMarkup(<DetailedEvidence detail={detail} demoMode={false} />);
    expect(dashboardHtml).toContain("PR-to-Evidence Review");
    expect(dashboardHtml).toContain("Linked issue requirement source");
    expect(dashboardHtml).toContain(`blob/${BASE}/src/legacy.ts`);
    expect(dashboardHtml).toContain("failed");
    expect(dashboardHtml).not.toContain("Requirements and PR objectives");
    const quickHtml = renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} onShowDetail={() => {}} showDetailedEvidence={false} demoMode={false} />);
    expect(quickHtml).toContain(`blob/${HEAD}/src/reset.ts`);
    expect(quickHtml).not.toContain("MOST IMPORTANT EVIDENCE GAP");
    expect(quickHtml).toContain("CI failed");
  });

  it("renders full ordinary reports without the legacy satisfaction/coverage front panel", () => {
    const report = generateVerificationReportV2FromInput(input());
    report.generalPrAssessmentSummary = ordinarySummary("linked_issue");
    const html = renderToStaticMarkup(<ReportView report={report} />);
    expect(html).toContain("PR-to-Evidence Review");
    expect(html).toContain("FAILED");
    expect(html).not.toContain("Requirement Evidence");
    expect(html).not.toContain("Evidence answer");
  });

  it("renders an empty-description ordinary PR as collected changes without purpose warnings", () => {
    const report = generateVerificationReportV2FromInput(input({
      taskText: "",
      description: "",
      taskSource: "task",
      limitations: ["Public GitHub metadata could not be fetched."]
    })) as VerificationReportV2;
    report.generalPrAssessmentSummary = ordinarySummary("missing");
    const html = renderToStaticMarkup(<ReportView report={report} />);
    expect(html).toContain("Collected changes");
    expect(html).not.toMatch(/unknown purpose|missing description|No original task text was provided|No approved verification contract|no assessable|Requirement Coverage|Requirement Proof Gaps|Agent Re-prompt/i);
    expect(html).toContain("FAILED");
    expect(html).toContain("Public GitHub metadata could not be fetched.");
    expect(html).toContain("GitHub PR Comment");
  });

  it("preserves typed-contract UI even when the companion assessment is absent", () => {
    const report = generateVerificationReportV2FromInput(input());
    report.verificationContract = { ...report.verificationContract, state: "authoritative" };
    delete report.generalPrAssessmentSummary;
    expect(buildDashboardPrEvidenceReview({ report })).toBeUndefined();
    const full = renderToStaticMarkup(<ReportView report={report} />);
    const dashboard = renderToStaticMarkup(<DetailedEvidence detail={{ report }} demoMode={false} />);
    expect(full).toContain("Requirement Evidence");
    expect(dashboard).toContain("Requirements and PR objectives");
    for (const surface of [full, dashboard, reportToMarkdown(report), reportToGitHubComment(report)]) {
      expect(surface).not.toContain("PR-to-Evidence Review");
    }
  });

  it("does not replace typed-contract companion presentation", () => {
    const report = generateVerificationReportV2FromInput(input());
    report.generalPrAssessmentSummary = { ...ordinarySummary("linked_issue"), mode: "typed_contract_companion" };
    const html = renderToStaticMarkup(<ReportView report={report} />);
    expect(html).toContain("Requirement Evidence");
    expect(html).toContain("Evidence answer");
    expect(html).toContain("Agent Claims");
    expect(html).toContain("Agent Re-prompt");
    expect(html).not.toContain("PR-to-Evidence Review");
  });
});
