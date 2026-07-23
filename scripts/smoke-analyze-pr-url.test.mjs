import { describe, expect, it, vi } from "vitest";
import {
  assertSummaryOnlyReport,
  assertReportExpectations,
  failedCheckAnnotationLocations,
  passingExecutionEvidence,
  analyzeTimingFromResponse,
  githubEvidenceTimingFromResponse,
  parseGitHubEvidenceTimingHeader,
  parseAnalyzeTimingHeader,
  runAnalyzePrSmoke
} from "./smoke-analyze-pr-url.mjs";
import { isExecutionEvidenceItemSignal, statusFromExecutionEvidenceSummary } from "../src/lib/evidence-status";
import { generateVerificationReport } from "../src/lib/verifier";
import { validateVerificationReport } from "../src/lib/report-validation";

describe("smoke-analyze-pr-url", () => {
  it("verifies analyze metadata and summary-only saved report privacy", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      taskText: "Acceptance criteria: add invoice export and tests.",
      githubToken: "github_pat_secret_should_not_leak_123",
      fetchImpl: fetchMock
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      status: 200,
      savedReportPrivacy: "summary-only",
      savedReportDurability: "short-lived-in-memory",
      savedReportDurabilityWarning: true,
      savedEvidenceCount: 0,
      savedClaimCount: 0,
      savedRepromptOmitted: true,
      savedEvidenceRefsCleared: true,
      savedReportDeleted: true
    }));
    expect(result.analyzeTiming).toEqual({
      input: 3,
      evidence: 120,
      report: 14,
      validation: 2,
      total: 139
    });
    expect(result.githubEvidenceTiming).toEqual({
      github_pr: 20,
      github_files: 40,
      github_checks: 50,
      github_statuses: 10,
      github_annotations: 0,
      github_jobs: 0
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://agentproof.example/api/reports", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://agentproof.example/api/reports/saved_123");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "https://agentproof.example/api/reports/saved_123", { method: "DELETE" });
  });

  it("accepts durable Supabase saved-report metadata while keeping summary-only checks", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "summary-only-supabase",
        durabilityWarning: "Saved reports are summary-only and durable."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "summary-only-supabase",
        durabilityWarning: "Saved reports are summary-only and durable."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      taskText: "Acceptance criteria: add invoice export and tests.",
      fetchImpl: fetchMock
    });

    expect(result.savedReportDurability).toBe("summary-only-supabase");
    expect(result.savedReportPrivacy).toBe("summary-only");
    expect(result.savedEvidenceCount).toBe(0);
    expect(result.savedClaimCount).toBe(0);
    expect(result.savedEvidenceRefsCleared).toBe(true);
  });

  it("rejects saved reports that retain raw evidence or re-prompt data", () => {
    const fullReport = reportFixture();

    expect(() => assertSummaryOnlyReport(fullReport, {
      originalReprompt: fullReport.reprompt.prompt,
      githubToken: "github_pat_secret_should_not_leak_123"
    })).toThrow("Saved report retained raw evidenceIndex items");
  });

  it("parses only bounded analyze timing metrics", () => {
    expect(parseAnalyzeTimingHeader("ap_input;dur=1, ap_evidence;dur=23, ap_report;dur=4, ap_validation;dur=2, ap_total;dur=30")).toEqual({
      input: 1,
      evidence: 23,
      report: 4,
      validation: 2,
      total: 30
    });

    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_total;dur=2"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1;desc=github_pat_secret_should_not_leak, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_input;dur=2, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_input;dur=2, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4"))
      .toThrow("Analyze timing header contained duplicate phases");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, ap_foo;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1, src/private/file.ts;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1.5, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=-1, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=1e3, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was malformed");
    expect(() => parseAnalyzeTimingHeader("ap_input;dur=9007199254740992, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"))
      .toThrow("Analyze timing header was missing a required phase");

    try {
      parseAnalyzeTimingHeader("ap_input;dur=1;desc=src/private/file.ts?token=sk-secret, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5");
    } catch (error) {
      expect(error.message).not.toContain("src/private/file.ts");
      expect(error.message).not.toContain("sk-secret");
    }
  });

  it("parses analyze timing from either timing header without exposing raw header values", () => {
    const header = "ap_input;dur=1, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5";

    expect(analyzeTimingFromResponse(new Response("{}", {
      headers: { "x-agentproof-timing": header }
    }))).toEqual({ input: 1, evidence: 2, report: 3, validation: 4, total: 5 });
    expect(analyzeTimingFromResponse(new Response("{}", {
      headers: { "server-timing": header }
    }))).toEqual({ input: 1, evidence: 2, report: 3, validation: 4, total: 5 });
    expect(analyzeTimingFromResponse(new Response("{}", {
      headers: {
        "x-agentproof-timing": header,
        "server-timing": header
      }
    }))).toEqual({ input: 1, evidence: 2, report: 3, validation: 4, total: 5 });

    expect(() => analyzeTimingFromResponse(new Response("{}", {
      headers: {
        "x-agentproof-timing": header,
        "server-timing": "ap_input;dur=1;desc=github_pat_secret_should_not_leak, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"
      }
    }))).toThrow("Analyze timing headers disagreed");
    try {
      analyzeTimingFromResponse(new Response("{}", {
        headers: {
          "x-agentproof-timing": header,
          "server-timing": "ap_input;dur=1;desc=github_pat_secret_should_not_leak, ap_evidence;dur=2, ap_report;dur=3, ap_validation;dur=4, ap_total;dur=5"
        }
      }));
    } catch (error) {
      expect(error.message).not.toContain("github_pat_secret_should_not_leak");
    }

    expect(() => analyzeTimingFromResponse(new Response("{}")))
      .toThrow("Analyze response did not include timing evidence");
  });

  it("parses partial GitHub evidence timing without requiring unavailable subphases", () => {
    expect(parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12, ap_github_files;dur=34, ap_github_checks;dur=56")).toEqual({
      github_pr: 12,
      github_files: 34,
      github_checks: 56
    });

    expect(githubEvidenceTimingFromResponse(new Response("{}", {
      headers: {
        "x-agentproof-evidence-timing": "ap_github_pr;dur=12, ap_github_files;dur=34"
      }
    }))).toEqual({
      github_pr: 12,
      github_files: 34
    });

    expect(() => parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12, ap_github_foo;dur=34"))
      .toThrow("GitHub evidence timing header was malformed");
    expect(() => parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12;desc=src/private/file.ts?token=sk-secret"))
      .toThrow("GitHub evidence timing header was malformed");
    expect(() => parseGitHubEvidenceTimingHeader("ap_github_pr;dur=12, ap_github_pr;dur=34"))
      .toThrow("GitHub evidence timing header contained duplicate phases");
    expect(() => githubEvidenceTimingFromResponse(new Response("{}")))
      .toThrow("Analyze response did not include GitHub evidence timing");
  });

  it("preserves analyze API errors when error responses have partial timing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ error: "bounded github access error" }),
      {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-agentproof-timing": "ap_input;dur=1, ap_total;dur=2"
        }
      }
    ));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      fetchImpl: fetchMock
    })).rejects.toThrow("bounded github access error");
  });

  it("rejects saved reports that keep evidence refs after evidenceIndex is stripped", () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    savedReport.requirements[0].evidenceRefs = ["ev_1"];

    expect(() => assertSummaryOnlyReport(savedReport)).toThrow("Saved report retained evidenceRefs");
  });

  it("rejects saved reports that retain failed check annotation locations", () => {
    const fullReport = reportFixture();
    fullReport.evidenceIndex.push({
      id: "ev_failed_annotation",
      kind: "check",
      label: "unit tests",
      summary:
        "Status: failed. unit tests - Vitest failed. Check annotations: failure at src/app/api/analyze/route.test.ts:42. Raw annotation messages and raw annotation details omitted.",
      confidence: 0.9
    });
    const savedReport = summaryOnlyReportFixture(fullReport);
    savedReport.limitations.push("Debug note: src/app/api/analyze/route.test.ts:42");

    expect(failedCheckAnnotationLocations(fullReport)).toEqual(["src/app/api/analyze/route.test.ts:42"]);
    expect(() => assertSummaryOnlyReport(savedReport, {
      failedCheckLocations: failedCheckAnnotationLocations(fullReport)
    })).toThrow("Saved report retained failed check annotation location");
  });

  it("blocks GitHub tokens from remote production-like smoke URLs unless explicitly allowed", async () => {
    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof-pearl.vercel.app",
      prUrl: "https://github.com/org/repo/pull/1",
      githubToken: "github_pat_secret_should_not_leak_123",
      fetchImpl: vi.fn()
    })).rejects.toThrow("Forwarding a GitHub token to a remote AgentProof base URL requires");
  });

  it("reports explicit production token forwarding when allowed", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof-pearl.vercel.app/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof-pearl.vercel.app",
      prUrl: "https://github.com/org/repo/pull/1",
      githubToken: "github_pat_secret_should_not_leak_123",
      allowProductionGithubToken: true,
      fetchImpl: fetchMock
    });

    expect(result.githubTokenForwarded).toBe(true);
    expect(result.productionTokenForwarded).toBe(true);
  });

  it("rejects passed CI smoke reports without status-prefixed passing execution evidence", async () => {
    const report = reportFixture();
    report.testing.ciStatus = "passed";
    report.evidenceIndex = [
      {
        id: "ev_1",
        kind: "check",
        label: "unit tests: passed",
        summary: "unit tests: passed on a previous branch, but current status is unknown",
        confidence: 0.45
      }
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ report }));

    await expect(runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      fetchImpl: fetchMock
    })).rejects.toThrow("Report claimed passed CI without passing check/log evidence");
  });

  it("treats saved-report cleanup as best-effort after summary-only validation", async () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: fullReport }))
      .mockResolvedValueOnce(jsonResponse({
        id: "saved_123",
        url: "https://agentproof.example/reports/saved_123",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only",
        durability: "short-lived-in-memory",
        durabilityWarning: "Saved reports are short-lived."
      }))
      .mockResolvedValueOnce(jsonResponse({ deleted: false }));

    const result = await runAnalyzePrSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      fetchImpl: fetchMock
    });

    expect(result.savedReportDeleted).toBe(false);
    expect(result.savedReportDeleteWarning).toContain("best-effort");
    expect(result.savedEvidenceCount).toBe(0);
    expect(result.savedClaimCount).toBe(0);
    expect(result.savedRepromptOmitted).toBe(true);
    expect(result.savedEvidenceRefsCleared).toBe(true);
  });

  it("does not count preview or security checks as passing execution evidence even with test words", () => {
    const report = reportFixture();
    report.evidenceIndex = [
      {
        id: "ev_preview",
        kind: "check",
        label: "Vercel Preview tests",
        summary: "Status: passed. Vercel Preview tests completed",
        confidence: 0.9
      },
      {
        id: "ev_security",
        kind: "check",
        label: "Socket Security coverage tests report",
        summary: "Status: passed. security coverage tests completed",
        confidence: 0.9
      },
      {
        id: "ev_generic_preview",
        kind: "check",
        label: "CI",
        summary: "Status: passed. Vercel Preview tests passed after deployment",
        confidence: 0.9
      },
      {
        id: "ev_security_command",
        kind: "check",
        label: "CI",
        summary: "Status: passed. Security report annotation: pnpm test src/app/api/analyze/route.test.ts passed",
        confidence: 0.9
      },
      {
        id: "ev_actual_step",
        kind: "log",
        label: "GitHub Actions job: CI",
        summary: "Status: passed. GitHub Actions job CI: passed. Steps: pnpm test: passed",
        confidence: 0.75
      },
      {
        id: "ev_unit",
        kind: "check",
        label: "unit tests",
        summary: "Status: passed. unit tests completed",
        confidence: 0.9
      }
    ];

    expect(passingExecutionEvidence(report).map((item) => item.id)).toEqual(["ev_actual_step", "ev_unit"]);
  });

  it("uses the same generic contract-test and non-execution boundary in smoke assertions", () => {
    const report = reportFixture();
    report.evidenceIndex = [
      { id: "ev_label_contract", kind: "check", label: "State Label Contract Test", summary: "Status: passed. Contract test completed.", confidence: 0.9 },
      { id: "ev_policy_contract", kind: "check", label: "Policy Guard Contract Test", summary: "Status: passed. pnpm test completed.", confidence: 0.9 },
      { id: "ev_label_automation", kind: "check", label: "Label Automation Test", summary: "Status: passed. pnpm test completed.", confidence: 0.9 },
      { id: "ev_preview", kind: "check", label: "Preview Contract Test", summary: "Status: passed. pnpm test completed.", confidence: 0.9 },
      { id: "ev_static", kind: "check", label: "Static Test Report", summary: "Status: passed. pnpm test completed.", confidence: 0.9 },
      { id: "ev_deployment_test", kind: "check", label: "Deployment Unit Test", summary: "Status: passed. pnpm test completed. Coverage report uploaded.", confidence: 0.9 },
      { id: "ev_security_test", kind: "check", label: "Security Integration Test", summary: "Status: passed. integration test completed for security behavior.", confidence: 0.9 },
      { id: "ev_policy_intent", kind: "check", label: "Policy", summary: "Status: passed. Policy requires pnpm test.", confidence: 0.9 }
    ];

    expect(passingExecutionEvidence(report).map((item) => item.id)).toEqual([
      "ev_label_contract",
      "ev_policy_contract",
      "ev_preview",
      "ev_deployment_test",
      "ev_security_test"
    ]);
  });

  it("keeps smoke and runtime execution classification aligned for generic label/policy boundaries", () => {
    const vectors = [
      ["State Label Contract Test", "Status: passed. Contract test completed."],
      ["Policy Guard Contract Test", "Status: passed. pnpm test completed."],
      ["Policy Gate Contract Test", "Status: passed. test completed."],
      ["Label Automation Test", "Status: passed. pnpm test completed."],
      ["Preview Contract Test", "Status: passed. pnpm test completed."],
      ["Static Test Report", "Status: passed. pnpm test completed."],
      ["State Label Contract Test", "Status: passed. preview deployment published."],
      ["Deployment Unit Test", "Status: passed. pnpm test completed. Coverage report uploaded."],
      ["Security Integration Test", "Status: passed. integration test completed for security behavior."],
      ["CI", "Status: passed. pnpm test exited with code 0."],
      ["Unit Test", "Status: passed. Tests were not run."],
      ["CI", "Status: passed. Example: pnpm test passed."],
      ["Policy", "Status: passed. Policy requires pnpm test."]
    ];
    const report = reportFixture();
    report.evidenceIndex = vectors.map(([label, summary], index) => ({
      id: `ev_${index}`,
      kind: "check",
      label,
      summary,
      confidence: 0.9
    }));

    const smokeIds = new Set(passingExecutionEvidence(report).map((item) => item.id));
    for (const [index, [label, summary]] of vectors.entries()) {
      expect(smokeIds.has(`ev_${index}`)).toBe(
        isExecutionEvidenceItemSignal(label, statusFromExecutionEvidenceSummary(summary), "", summary)
      );
    }
  });

  it("keeps smoke log evidence aligned with the shared status-aware execution contract", () => {
    const report = reportFixture();
    report.evidenceIndex = [
      {
        id: "ev_log_observed",
        kind: "log",
        label: "CI",
        summary: "Status: passed. pnpm test exited with code 0.",
        confidence: 0.9
      },
      {
        id: "ev_log_non_observed",
        kind: "log",
        label: "Unit Test",
        summary: "Status: passed. Tests have not run.",
        confidence: 0.9
      }
    ];

    expect(passingExecutionEvidence(report).map((item) => item.id)).toEqual(["ev_log_observed"]);
  });

  it.each([
    ["passed", "Status: failed. Stale provider text.", 1],
    ["failed", "Status: passed. Stale provider text.", 0],
    ["pending", "Status: passed. Stale provider text.", 0],
    ["unknown", "Malformed state text.", 0]
  ])("normalizes conflicting provider and rendered check states before validation and smoke: %s", (status, providerText, expectedPassingEvidenceCount) => {
    const report = generateVerificationReport({
      title: "Synthetic CI state normalization",
      taskSource: "issue",
      taskText: "Preserve deterministic CI execution state.",
      description: "Synthetic regression input.",
      changedFiles: [],
      checks: [{ name: "Opaque Contract Test", status, summary: providerText }],
      logs: [],
      limitations: []
    });

    expect(report.testing.ciStatus).toBe(status);
    expect(report.evidenceIndex.some((item) => item.summary.startsWith(`Status: ${status}`))).toBe(true);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(passingExecutionEvidence(report)).toHaveLength(expectedPassingEvidenceCount);
  });

  it("keeps visual requirements unverified without browser or screenshot evidence", () => {
    const report = reportFixture();
    report.requirements = [
      {
        requirementId: "req_visual",
        requirementText: "improve mobile layout without overlapping text/buttons",
        status: "partial",
        evidenceRefs: ["ev_1"],
        gaps: ["No browser, screenshot, or visual QA artifact verifies this UX criterion."],
        reviewerNote: "Visual evidence was not present.",
        confidence: 0.55
      }
    ];

    expect(assertReportExpectations(report, { requireVisualUnverified: true }).checks).toEqual([
      { name: "visualRequirementsUnverifiedWithoutVisualEvidence", expected: true }
    ]);

    report.requirements[0].status = "met";
    expect(() => assertReportExpectations(report, { requireVisualUnverified: true }))
      .toThrow("Visual/mobile requirements were marked met without browser, screenshot, or visual QA evidence");
  });
});

function jsonResponse(payload, status = 200) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "private, no-store"
  };

  if (payload && typeof payload === "object" && Object.keys(payload).length === 1 && payload.report) {
    headers["x-agentproof-timing"] = "ap_input;dur=3, ap_evidence;dur=120, ap_report;dur=14, ap_validation;dur=2, ap_total;dur=139";
    headers["x-agentproof-evidence-timing"] = "ap_github_pr;dur=20, ap_github_files;dur=40, ap_github_checks;dur=50, ap_github_statuses;dur=10, ap_github_annotations;dur=0, ap_github_jobs;dur=0";
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers
  });
}

function reportFixture() {
  return {
    analysisId: "ap_test",
    createdAt: "2026-06-26T00:00:00.000Z",
    source: {
      title: "Add invoice export",
      url: "https://github.com/org/repo/pull/1"
    },
    summary: {
      oneLine: "Evidence looks mostly aligned.",
      confidence: 0.82,
      priority: "medium",
      evidenceCoverage: 74,
      topRisks: ["Some requirements have only partial evidence."]
    },
    requirements: [
      {
        requirementId: "req_1",
        requirementText: "add invoice export and tests",
        status: "partial",
        evidenceRefs: ["ev_1", "ev_2"],
        gaps: ["Review exact test command."],
        reviewerNote: "Evidence is partial.",
        confidence: 0.62
      }
    ],
    claims: [
      {
        id: "claim_1",
        text: "Implemented invoice export",
        evidenceRefs: ["ev_1"],
        supported: true
      }
    ],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: [],
      evidenceRefs: []
    },
    testing: {
      ciStatus: "unknown",
      lintStatus: "unknown",
      typecheckStatus: "unknown",
      missingTests: [
        {
          path: "src/billing/invoiceExport.ts",
          why: "No passing test command was provided.",
          evidenceRefs: ["ev_1", "ev_2"],
          provenance: [
            {
              evidenceRef: "ev_1",
              sourceType: "diff",
              locator: "src/billing/invoiceExport.ts",
              confidence: 0.8,
              evidenceText: "src/billing/invoiceExport.ts changed without a passing related test command."
            }
          ]
        }
      ]
    },
    reviewPriority: [
      {
        path: "src/billing/invoiceExport.ts",
        reason: "Implementation needs test proof.",
        priority: "medium",
        evidenceRefs: ["ev_1", "ev_2"]
      }
    ],
    reprompt: {
      targetAgent: "codex",
      prompt: "Add tests and provide the exact command output."
    },
    evidenceIndex: [
      {
        id: "ev_1",
        kind: "diff",
        label: "src/billing/invoiceExport.ts",
        summary: "Patch excerpt: + export function invoiceExport() {}",
        confidence: 0.8
      },
      {
        id: "ev_2",
        kind: "check",
        label: "Socket Security",
        summary: "Socket Security: passed",
        confidence: 0.9
      }
    ],
    limitations: ["No CI or test logs were available."]
  };
}

function summaryOnlyReportFixture(fullReport) {
  return {
    ...fullReport,
    requirements: fullReport.requirements.map((requirement) => ({
      ...requirement,
      evidenceRefs: []
    })),
    claims: [],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: []
    },
    testing: {
      ...fullReport.testing,
      missingTests: fullReport.testing.missingTests.map(({ provenance: _provenance, ...missingTest }) => ({
        ...missingTest,
        evidenceRefs: []
      }))
    },
    reviewPriority: fullReport.reviewPriority.map(({ evidenceRefs: _evidenceRefs, ...item }) => item),
    reprompt: {
      targetAgent: "codex",
      prompt: "Shared summary links omit re-prompt text. Open the original report owner session or copy the full report for re-prompt details."
    },
    evidenceIndex: [],
    limitations: [
      ...fullReport.limitations,
      "Shared report omits raw evidence, patch/log excerpts, claims, and re-prompt text."
    ]
  };
}
