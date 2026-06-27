import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REAL_PR_EVALUATION_CASES,
  runRealPrEvaluationSmoke
} from "./smoke-real-pr-evaluation.mjs";

describe("smoke-real-pr-evaluation", () => {
  it("runs every real PR evaluation case through analyze and summary-only save smoke", async () => {
    let savedId = 0;
    const fetchMock = vi.fn(async (url, init = {}) => {
      const method = init.method ?? "GET";

      if (String(url).endsWith("/api/analyze")) {
        const body = JSON.parse(String(init.body));
        return jsonResponse({ report: reportFixture(body.prUrl) });
      }

      if (String(url).endsWith("/api/reports") && method === "POST") {
        savedId += 1;

        return jsonResponse({
          id: `saved_${savedId}`,
          url: `https://agentproof.example/reports/saved_${savedId}`,
          expiresAt: "2026-06-27T00:00:00.000Z",
          privacy: "summary-only",
          durability: "short-lived-in-memory",
          durabilityWarning: "Saved reports are short-lived."
        });
      }

      if (/\/api\/reports\/saved_\d+$/.test(String(url)) && method === "GET") {
        return jsonResponse({
          report: summaryOnlyReportFixture(),
          createdAt: "2026-06-26T00:00:00.000Z",
          expiresAt: "2026-06-27T00:00:00.000Z",
          privacy: "summary-only",
          durability: "short-lived-in-memory",
          durabilityWarning: "Saved reports are short-lived."
        });
      }

      if (/\/api\/reports\/saved_\d+$/.test(String(url)) && method === "DELETE") {
        return jsonResponse({ deleted: true });
      }

      return new Response("unexpected url", { status: 500 });
    });

    const result = await runRealPrEvaluationSmoke({
      baseUrl: "https://agentproof.example",
      cases: DEFAULT_REAL_PR_EVALUATION_CASES,
      fetchImpl: fetchMock
    });

    expect(result.ok).toBe(true);
    expect(result.caseCount).toBe(3);
    expect(result.results.map((item) => item.id)).toEqual(["PR-1", "PR-2", "PR-3"]);
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ciStatus: "passed",
          savedReportPrivacy: "summary-only",
          savedReportDurability: "short-lived-in-memory",
          savedEvidenceCount: 0,
          savedClaimCount: 0,
          savedRepromptOmitted: true,
          savedEvidenceRefsCleared: true,
          savedReportDeleted: true
        })
      ])
    );
    expect(fetchMock).toHaveBeenCalledTimes(12);
    const analyzeBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/api/analyze"))
      .map(([, init]) => JSON.parse(String(init.body)));
    expect(analyzeBodies.every((body) => !("githubToken" in body))).toBe(true);
  });

  it("passes a GitHub token only when explicitly provided", async () => {
    const fetchMock = vi.fn(async (url, init = {}) => {
      const method = init.method ?? "GET";

      if (String(url).endsWith("/api/analyze")) {
        return jsonResponse({ report: reportFixture("https://github.com/RengGyu/AgentProof/pull/1") });
      }

      if (String(url).endsWith("/api/reports") && method === "POST") {
        return jsonResponse({
          id: "saved_1",
          url: "https://agentproof.example/reports/saved_1",
          expiresAt: "2026-06-27T00:00:00.000Z",
          privacy: "summary-only",
          durability: "short-lived-in-memory",
          durabilityWarning: "Saved reports are short-lived."
        });
      }

      if (String(url).endsWith("/api/reports/saved_1") && method === "GET") {
        return jsonResponse({
          report: summaryOnlyReportFixture(),
          createdAt: "2026-06-26T00:00:00.000Z",
          expiresAt: "2026-06-27T00:00:00.000Z",
          privacy: "summary-only",
          durability: "short-lived-in-memory",
          durabilityWarning: "Saved reports are short-lived."
        });
      }

      if (String(url).endsWith("/api/reports/saved_1") && method === "DELETE") {
        return jsonResponse({ deleted: true });
      }

      return new Response("unexpected url", { status: 500 });
    });

    await runRealPrEvaluationSmoke({
      baseUrl: "https://agentproof.example",
      cases: [DEFAULT_REAL_PR_EVALUATION_CASES[0]],
      githubToken: "explicit_token_for_private_case",
      fetchImpl: fetchMock
    });

    const analyzeBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(analyzeBody.githubToken).toBe("explicit_token_for_private_case");
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

function reportFixture(prUrl) {
  return {
    analysisId: "ap_real_pr_smoke",
    createdAt: "2026-06-26T00:00:00.000Z",
    source: {
      title: `Report for ${prUrl}`,
      url: prUrl
    },
    summary: {
      oneLine: "Evidence is sufficient for smoke validation.",
      confidence: 0.82,
      priority: "medium",
      evidenceCoverage: 74,
      topRisks: ["Some requirements have only partial evidence."]
    },
    requirements: [
      {
        requirementId: "req_1",
        requirementText: "verify real PR evidence",
        status: "met",
        evidenceRefs: ["ev_1"],
        gaps: [],
        reviewerNote: "Passing execution evidence is present.",
        confidence: 0.85
      }
    ],
    claims: [],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: [],
      evidenceRefs: []
    },
    testing: {
      ciStatus: "passed",
      lintStatus: "unknown",
      typecheckStatus: "unknown",
      missingTests: []
    },
    reviewPriority: [
      {
        path: "Changed files",
        reason: "No blocker found from deterministic evidence; spot-check requirement mapping.",
        priority: "low",
        evidenceRefs: ["ev_1"]
      }
    ],
    reprompt: {
      targetAgent: "codex",
      prompt: "Summarize how each acceptance criterion maps to the changed files and test evidence."
    },
    evidenceIndex: [
      {
        id: "ev_1",
        kind: "check",
        label: "unit tests",
        summary: "Status: passed. unit tests completed",
        confidence: 0.9
      }
    ],
    limitations: []
  };
}

function summaryOnlyReportFixture() {
  const report = reportFixture("https://github.com/RengGyu/AgentProof/pull/1");

  return {
    ...report,
    requirements: report.requirements.map((requirement) => ({
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
      ...report.testing,
      missingTests: []
    },
    reviewPriority: report.reviewPriority.map(({ evidenceRefs: _evidenceRefs, ...item }) => item),
    reprompt: {
      targetAgent: "codex",
      prompt: "Shared summary links omit re-prompt text. Open the original report owner session or copy the full report for re-prompt details."
    },
    evidenceIndex: [],
    limitations: [
      "Shared report omits raw evidence, patch/log excerpts, claims, and re-prompt text."
    ]
  };
}
