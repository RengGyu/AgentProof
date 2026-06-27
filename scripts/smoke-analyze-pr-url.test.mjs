import { describe, expect, it, vi } from "vitest";
import {
  assertSummaryOnlyReport,
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
        privacy: "summary-only"
      }))
      .mockResolvedValueOnce(jsonResponse({
        report: savedReport,
        createdAt: "2026-06-26T00:00:00.000Z",
        expiresAt: "2026-06-27T00:00:00.000Z",
        privacy: "summary-only"
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
