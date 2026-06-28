import { describe, expect, it, vi } from "vitest";
import {
  assertSummaryOnlyReport,
  passingExecutionEvidence,
  runAnalyzePrSmoke
} from "./smoke-analyze-pr-url.mjs";

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
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://agentproof.example/api/reports", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "https://agentproof.example/api/reports/saved_123");
    expect(fetchMock).toHaveBeenNthCalledWith(4, "https://agentproof.example/api/reports/saved_123", { method: "DELETE" });
  });

  it("rejects saved reports that retain raw evidence or re-prompt data", () => {
    const fullReport = reportFixture();

    expect(() => assertSummaryOnlyReport(fullReport, {
      originalReprompt: fullReport.reprompt.prompt,
      githubToken: "github_pat_secret_should_not_leak_123"
    })).toThrow("Saved report retained raw evidenceIndex items");
  });

  it("rejects saved reports that keep evidence refs after evidenceIndex is stripped", () => {
    const fullReport = reportFixture();
    const savedReport = summaryOnlyReportFixture(fullReport);
    savedReport.requirements[0].evidenceRefs = ["ev_1"];

    expect(() => assertSummaryOnlyReport(savedReport)).toThrow("Saved report retained evidenceRefs");
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
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store"
    }
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
          evidenceRefs: ["ev_1", "ev_2"]
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
      missingTests: fullReport.testing.missingTests.map((missingTest) => ({
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
