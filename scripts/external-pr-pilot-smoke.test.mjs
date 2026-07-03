import { describe, expect, it, vi } from "vitest";
import {
  externalPrPilotSmokeCasesFromFixture,
  runExternalPrPilotSmoke
} from "./external-pr-pilot-smoke.mjs";

describe("external-pr-pilot-smoke", () => {
  it("builds exactly five smoke cases without manual label data in analyze input", () => {
    const cases = externalPrPilotSmokeCasesFromFixture(fixture());

    expect(cases).toEqual([
      expect.objectContaining({ id: "external-pr-pilot-clean", category: "clean_pr", taskText: "" }),
      expect.objectContaining({ id: "external-pr-pilot-missing-tests", category: "missing_tests", taskText: "" }),
      expect.objectContaining({ id: "external-pr-pilot-scope-creep", category: "scope_creep", taskText: "" }),
      expect.objectContaining({ id: "external-pr-pilot-failed-ci", category: "failed_ci", taskText: "" }),
      expect.objectContaining({ id: "external-pr-pilot-visual-gap", category: "vague_task_or_visual_gap", taskText: "" })
    ]);

    const serialized = JSON.stringify(cases);
    expect(serialized).not.toContain("requirementStatus");
    expect(serialized).not.toContain("missingTargetedTestEvidence");
    expect(serialized).not.toContain("scopeCreep");
    expect(serialized).not.toContain("topFilesReviewerShouldInspect");
    expect(serialized).not.toContain("pending_manual_review");
  });

  it("can include bounded public task context without including oracle labels", () => {
    const cases = externalPrPilotSmokeCasesFromFixture(fixture(), {
      includePublicTaskContext: true
    });

    expect(cases[0].taskText).toBe("Fixes public/repo#1; bounded public task context.");
    expect(JSON.stringify(cases)).not.toContain("do not feed labels");
    expect(JSON.stringify(cases)).not.toContain("topFilesReviewerShouldInspect");
  });

  it("runs all five external PRs through analyze and emits summary-only pilot metadata", async () => {
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

    const result = await runExternalPrPilotSmoke({
      baseUrl: "https://agentproof.example",
      cases: externalPrPilotSmokeCasesFromFixture(fixture()),
      fetchImpl: fetchMock
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      privacy: "external-pr-pilot-run-summary-only",
      baseUrl: "https://agentproof.example",
      caseCount: 5,
      pendingManualLabels: 5,
      next: "fill_manual_labels_after_reviewer_sessions"
    }));
    expect(result.qualityGateSummary.ok).toBe(true);
    expect(result.categoryStatuses).toEqual([
      { id: "external-pr-pilot-clean", category: "clean_pr", qualityGate: "passed", manualLabelStatus: "pending_reviewer_confirmation" },
      { id: "external-pr-pilot-missing-tests", category: "missing_tests", qualityGate: "passed", manualLabelStatus: "pending_reviewer_confirmation" },
      { id: "external-pr-pilot-scope-creep", category: "scope_creep", qualityGate: "passed", manualLabelStatus: "pending_reviewer_confirmation" },
      { id: "external-pr-pilot-failed-ci", category: "failed_ci", qualityGate: "passed", manualLabelStatus: "pending_reviewer_confirmation" },
      { id: "external-pr-pilot-visual-gap", category: "vague_task_or_visual_gap", qualityGate: "passed", manualLabelStatus: "pending_reviewer_confirmation" }
    ]);
    expect(result.timingSummary.phases.total).toEqual({ count: 5, missingCount: 0, p50: 139, p95: 139, max: 139 });
    for (const item of result.results) {
      expect(item).toEqual(expect.objectContaining({
        reportInputMode: "public_pr_url_only",
        savedReportPrivacy: "summary-only",
        savedEvidenceCount: 0,
        savedClaimCount: 0,
        savedRepromptOmitted: true,
        savedEvidenceRefsCleared: true,
        savedReportDeleted: true,
        productionTokenForwarded: false
      }));
    }

    const analyzeBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/api/analyze"))
      .map(([, init]) => JSON.parse(String(init.body)));

    expect(analyzeBodies).toHaveLength(5);
    expect(analyzeBodies.every((body) => body.taskText === "")).toBe(true);
    expect(analyzeBodies.every((body) => !("githubToken" in body))).toBe(true);
    expect(JSON.stringify(analyzeBodies)).not.toContain("requirementStatus");
    expect(JSON.stringify(analyzeBodies)).not.toContain("topFilesReviewerShouldInspect");
  });

  it("rejects fixtures that are no longer the five-case pilot", () => {
    const invalid = fixture();
    invalid.cases = invalid.cases.slice(0, 4);

    expect(() => externalPrPilotSmokeCasesFromFixture(invalid)).toThrow("exactly 5 cases");
  });
});

function fixture() {
  const cases = [
    ["external-pr-pilot-clean", "clean_pr", 1],
    ["external-pr-pilot-missing-tests", "missing_tests", 2],
    ["external-pr-pilot-scope-creep", "scope_creep", 3],
    ["external-pr-pilot-failed-ci", "failed_ci", 4],
    ["external-pr-pilot-visual-gap", "vague_task_or_visual_gap", 5]
  ].map(([id, category, number]) => ({
    id,
    category,
    reportInput: {
      pullRequestUrl: `https://github.com/public/repo/pull/${number}`,
      publicTaskContext: `Fixes public/repo#${number}; bounded public task context.`
    },
    manualLabels: {
      labelStatus: "pending_reviewer_confirmation",
      requirementStatus: "pending_manual_review",
      missingTargetedTestEvidence: "pending_manual_review",
      scopeCreep: "pending_manual_review",
      topFilesReviewerShouldInspect: [`src/file-${number}.ts`],
      notes: "do not feed labels into report generation"
    }
  }));

  return {
    schemaVersion: "external-pr-pilot.v1",
    privacy: "external-pr-pilot-metadata-only",
    cases
  };
}

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

function reportFixture(prUrl) {
  return {
    analysisId: "ap_external_pilot_test",
    createdAt: "2026-07-03T00:00:00.000Z",
    source: {
      title: "External pilot PR",
      url: prUrl
    },
    summary: {
      oneLine: "Evidence is available for reviewer triage.",
      confidence: 0.82,
      priority: "medium",
      evidenceCoverage: 74,
      topRisks: ["Review exact execution evidence before merge."]
    },
    requirements: [
      {
        requirementId: "req_1",
        requirementText: "verify the public PR change",
        status: "partial",
        evidenceRefs: ["ev_1"],
        gaps: ["Reviewer should inspect the changed file."],
        reviewerNote: "Evidence is partial.",
        confidence: 0.62
      }
    ],
    claims: [
      {
        id: "claim_1",
        text: "Changed public PR file.",
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
          path: "src/file.ts",
          why: "No targeted execution proof was visible.",
          evidenceRefs: ["ev_1"],
          provenance: [
            {
              evidenceRef: "ev_1",
              sourceType: "diff",
              locator: "src/file.ts",
              confidence: 0.8,
              evidenceText: "src/file.ts changed without targeted execution proof."
            }
          ]
        }
      ]
    },
    reviewPriority: [
      {
        path: "src/file.ts",
        reason: "Review this file first.",
        priority: "medium",
        evidenceRefs: ["ev_1"]
      }
    ],
    reprompt: {
      targetAgent: "codex",
      prompt: "Provide targeted execution proof."
    },
    evidenceIndex: [
      {
        id: "ev_1",
        kind: "diff",
        label: "src/file.ts",
        summary: "Changed file summary only.",
        confidence: 0.8
      }
    ],
    limitations: ["No CI or test logs were available."]
  };
}

function summaryOnlyReportFixture() {
  return {
    ...reportFixture("https://github.com/public/repo/pull/1"),
    requirements: [
      {
        requirementId: "req_1",
        requirementText: "verify the public PR change",
        status: "partial",
        evidenceRefs: [],
        gaps: ["Reviewer should inspect the changed file."],
        reviewerNote: "Evidence is partial.",
        confidence: 0.62
      }
    ],
    claims: [],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: []
    },
    testing: {
      ciStatus: "unknown",
      lintStatus: "unknown",
      typecheckStatus: "unknown",
      missingTests: [
        {
          path: "src/file.ts",
          why: "No targeted execution proof was visible.",
          evidenceRefs: []
        }
      ]
    },
    reviewPriority: [
      {
        path: "src/file.ts",
        reason: "Review this file first.",
        priority: "medium"
      }
    ],
    reprompt: {
      targetAgent: "codex",
      prompt: "Shared summary links omit re-prompt text. Open the original report owner session or copy the full report for re-prompt details."
    },
    evidenceIndex: [],
    limitations: [
      "No CI or test logs were available.",
      "Shared report omits raw evidence, patch/log excerpts, claims, and re-prompt text."
    ]
  };
}
