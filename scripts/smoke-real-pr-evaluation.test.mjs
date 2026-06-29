import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REAL_PR_EVALUATION_CASES,
  runRealPrEvaluationSmoke,
  safeSmokePrUrl,
  summarizeAnalyzeTimings
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
    expect(result.caseCount).toBe(6);
    expect(result.timingSummary).toEqual({
      metric: "X-AgentProof-Timing",
      unit: "ms",
      method: "nearest-rank",
      phases: {
        input: { count: 6, missingCount: 0, p50: 6, p95: 12, max: 12 },
        evidence: { count: 6, missingCount: 0, p50: 60, p95: 120, max: 120 },
        report: { count: 6, missingCount: 0, p50: 12, p95: 24, max: 24 },
        validation: { count: 6, missingCount: 0, p50: 1, p95: 4, max: 4 },
        total: { count: 6, missingCount: 0, p50: 85, p95: 160, max: 160 }
      }
    });
    expect(result.results.map((item) => item.id)).toEqual(["PR-1", "PR-2", "PR-3", "PR-9", "PR-12", "PR-15"]);
    for (const [index, item] of result.results.entries()) {
      expect(item).toEqual(expect.objectContaining({
        ciStatus: "passed",
        savedReportPrivacy: "summary-only",
        savedReportDurability: "short-lived-in-memory",
        savedEvidenceCount: 0,
        savedClaimCount: 0,
        savedRepromptOmitted: true,
        savedEvidenceRefsCleared: true,
        savedFailedCheckLocationsOmitted: true,
        savedReportDeleted: true,
        productionTokenForwarded: false
      }));
      expect(item.analyzeTiming).toEqual(timingForIndex(index));
      expect(item.expectationCheckCount).toBeGreaterThan(0);
    }
    expect(result.results.find((item) => item.id === "PR-15")).toEqual(expect.objectContaining({
      failedCheckLocationCount: 1,
      savedFailedCheckLocationsOmitted: true
    }));
    expect(fetchMock).toHaveBeenCalledTimes(24);
    const analyzeBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/api/analyze"))
      .map(([, init]) => JSON.parse(String(init.body)));
    expect(analyzeBodies.every((body) => !("githubToken" in body))).toBe(true);
  });

  it("summarizes missing analyze timing without leaking case details", () => {
    const summary = summarizeAnalyzeTimings([
      {
        id: "private-case",
        prUrl: "https://user:github_pat_secret_should_not_leak@github.com/org/private/pull/1?token=sk-secret",
        taskText: "Acceptance criteria: secret task text",
        analyzeTiming: { input: 2, evidence: 20, report: 4, validation: 1, total: 27 }
      },
      { prUrl: "https://github.com/org/private/pull/2", analyzeTiming: { input: 8, evidence: 60, report: 10, validation: 2, total: 80 } },
      {}
    ]);

    expect(summary).toEqual({
      metric: "X-AgentProof-Timing",
      unit: "ms",
      method: "nearest-rank",
      phases: {
        input: { count: 2, missingCount: 1, p50: 2, p95: 8, max: 8 },
        evidence: { count: 2, missingCount: 1, p50: 20, p95: 60, max: 60 },
        report: { count: 2, missingCount: 1, p50: 4, p95: 10, max: 10 },
        validation: { count: 2, missingCount: 1, p50: 1, p95: 2, max: 2 },
        total: { count: 2, missingCount: 1, p50: 27, p95: 80, max: 80 }
      }
    });
    expect(JSON.stringify(summary)).not.toContain("github_pat_secret_should_not_leak");
    expect(JSON.stringify(summary)).not.toContain("sk-secret");
    expect(JSON.stringify(summary)).not.toContain("secret task text");
    expect(JSON.stringify(summary)).not.toContain("private-case");
  });

  it("strips secret-like URL parts from smoke result PR URLs", () => {
    expect(safeSmokePrUrl("https://user:github_pat_secret_should_not_leak@github.com/org/repo/pull/1?token=sk-secret#files"))
      .toBe("https://github.com/org/repo/pull/1");
    expect(safeSmokePrUrl("not a url")).toBeUndefined();
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
      allowProductionGithubToken: true,
      fetchImpl: fetchMock
    });

    const analyzeBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(analyzeBody.githubToken).toBe("explicit_token_for_private_case");
  });
});

function jsonResponse(payload, status = 200) {
  const headers = {
    "content-type": "application/json",
    "cache-control": "private, no-store"
  };

  if (payload && typeof payload === "object" && Object.keys(payload).length === 1 && payload.report) {
    const pullNumber = Number(String(payload.report.source?.url ?? "").match(/\/pull\/(\d+)$/)?.[1] ?? 1);
    const index = [1, 2, 3, 9, 12, 15].indexOf(pullNumber);
    headers["x-agentproof-timing"] = timingHeaderForIndex(index < 0 ? 0 : index);
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers
  });
}

function timingForIndex(index) {
  return {
    input: (index + 1) * 2,
    evidence: (index + 1) * 20,
    report: (index + 1) * 4,
    validation: Math.max(1, index - 1),
    total: (index + 1) * 25 + 10
  };
}

function timingHeaderForIndex(index) {
  const timing = timingForIndex(index);

  return `ap_input;dur=${timing.input}, ap_evidence;dur=${timing.evidence}, ap_report;dur=${timing.report}, ap_validation;dur=${timing.validation}, ap_total;dur=${timing.total}`;
}

function reportFixture(prUrl) {
  const isVisualCase = prUrl.endsWith("/pull/9") || prUrl.endsWith("/pull/12");
  const isFailedLocationCase = prUrl.endsWith("/pull/15");
  const requirements = [
    {
      requirementId: "req_1",
      requirementText: "verify real PR evidence",
      status: "met",
      evidenceRefs: ["ev_1"],
      gaps: [],
      reviewerNote: "Passing execution evidence is present.",
      confidence: 0.85
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      requirementId: `req_${index + 2}`,
      requirementText: `preserve evidence boundary ${index + 2}`,
      status: "partial",
      evidenceRefs: ["ev_1"],
      gaps: ["Reviewer should spot-check requirement mapping."],
      reviewerNote: "Evidence is partial but grounded.",
      confidence: 0.62
    })),
    ...(isVisualCase
      ? [
          {
            requirementId: "req_visual",
            requirementText: "keep mobile layout readable without browser QA evidence",
            status: "partial",
            evidenceRefs: ["ev_1"],
            gaps: ["No browser, screenshot, or visual QA artifact verifies this UX criterion."],
            reviewerNote: "Visual evidence was not present.",
            confidence: 0.55
          }
        ]
      : []),
    ...(isFailedLocationCase
      ? [
          {
            requirementId: "req_failed_locations",
            requirementText: "keep summary-only saved reports free of failed check locations",
            status: "partial",
            evidenceRefs: ["ev_2"],
            gaps: ["Summary-only save must prove annotation paths are stripped."],
            reviewerNote: "Smoke should compare full failed locations against saved summary data.",
            confidence: 0.62
          },
          {
            requirementId: "req_positioning",
            requirementText: "preserve evidence-based verifier positioning",
            status: "met",
            evidenceRefs: ["ev_1"],
            gaps: [],
            reviewerNote: "Positioning evidence is present.",
            confidence: 0.82
          },
          {
            requirementId: "req_full_surfaces",
            requirementText: "show failed check locations only in full report surfaces",
            status: "partial",
            evidenceRefs: ["ev_2"],
            gaps: ["Full UI rendering is not exercised by this API smoke."],
            reviewerNote: "Keep as reviewer lead until browser QA exists.",
            confidence: 0.58
          }
        ]
      : [])
  ];
  const evidenceIndex = [
    {
      id: "ev_1",
      kind: "check",
      label: "unit tests",
      summary: "Status: passed. unit tests completed",
      confidence: 0.9
    },
    ...(isFailedLocationCase
      ? [
          {
            id: "ev_2",
            kind: "check",
            label: "unit tests",
            summary:
              "Status: failed. unit tests - Vitest failed. Check annotations: failure at src/app/api/analyze/route.test.ts:42. Raw annotation messages and raw annotation details omitted.",
            confidence: 0.9
          }
        ]
      : []),
    ...Array.from({ length: isFailedLocationCase ? 10 : 11 }, (_, index) => ({
      id: `ev_extra_${index + 1}`,
      kind: "diff",
      label: `src/example/file${index + 1}.ts`,
      summary: `Changed file evidence ${index + 1}.`,
      confidence: 0.7
    }))
  ];

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
    requirements,
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
    evidenceIndex,
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
