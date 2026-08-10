import { describe, expect, it } from "vitest";
import type { DashboardReportDetail } from "./github-dashboard-view-model";
import { dashboardReportToJson, dashboardReportToMarkdown } from "./dashboard-report-export";

const detail = {
  repositoryFullName: "RengGyu/agentproof-evaluation-fixtures",
  pullRequestNumber: 5,
  headSha: "a".repeat(40),
  priority: "high",
  createdAt: "2026-08-09T00:00:00.000Z",
  report: {
    requirements: [{ requirementId: "req_1", status: "partial", evidenceRefs: ["ev_1"], gaps: ["Focused test evidence is missing."] }],
    testing: { ciStatus: "passed", lintStatus: "unknown", typecheckStatus: "pending" },
    reviewPriority: [{ path: "src/repositories/search.ts", priority: "high" }],
    evidenceIndex: [{ id: "ev_1", locator: "src/repositories/search.ts" }],
    reprompt: { prompt: "Add focused evidence for the empty state." }
  }
} satisfies DashboardReportDetail & { repositoryFullName: string };

describe("dashboard report export", () => {
  it("exports the reviewer-visible bounded report as structured JSON without unapproved raw fields", () => {
    const unsafeDetail = {
      ...detail,
      report: { ...detail.report, rawDiff: "private source must never be copied" }
    } as DashboardReportDetail & { repositoryFullName: string };

    const exported = JSON.parse(dashboardReportToJson(unsafeDetail));

    expect(exported).toEqual({
      schema_version: "agentproof.dashboard-report-export.v1",
      repository: "RengGyu/agentproof-evaluation-fixtures",
      pull_request: {
        number: 5,
        head_sha: "a".repeat(40),
        analyzed_at: "2026-08-09T00:00:00.000Z",
        evidence_captured_at: null,
        priority: "high",
        state: "CURRENT"
      },
      analysis_context: "provided_requirement",
      requirements: [{ id: "req_1", coverage: "partial", evidence_ids: ["ev_1"], evidence_gaps: ["Focused test evidence is missing."] }],
      checks: { ci: "passed", lint: "unknown", typecheck: "pending" },
      evidence_locations: [{ id: "ev_1", safe_location: "src/repositories/search.ts" }],
      priority_files: [{ safe_location: "src/repositories/search.ts", priority: "high" }],
      suggested_next_step: "Add focused evidence for the empty state.",
      ai_analysis: null,
      ai_evidence_reading: null
    });
    expect(JSON.stringify(exported)).not.toContain("private source must never be copied");
  });

  it("exports the same bounded fields as readable Markdown", () => {
    const markdown = dashboardReportToMarkdown(detail);

    expect(markdown).toContain("# AgentProof evidence report");
    expect(markdown).toContain("RengGyu/agentproof-evaluation-fixtures");
    expect(markdown).toContain("**PR:** #5");
    expect(markdown).toContain("Focused test evidence is missing.");
    expect(markdown).toContain("src/repositories/search.ts");
    expect(markdown).not.toContain("raw diff");
  });

  it("includes the validator-approved AI relation in both export formats", () => {
    const semanticDetail = {
      ...detail,
      report: {
        ...detail.report,
        semantic: {
          requirement_evidence_relations: [{ requirement_id: "req_1", evidence_id: "ev_1", relation: "partial_support", rationale: "The test covers the normal path only.", uncertainty: "medium" }],
          requirement_assessments: [],
          evidence_gaps: [],
          review_targets: [],
          remediation_requests: [],
          uncertainties: []
        }
      }
    } satisfies DashboardReportDetail & { repositoryFullName: string };

    const exported = JSON.parse(dashboardReportToJson(semanticDetail));

    expect(exported.ai_evidence_reading.requirement_evidence_relations).toEqual([
      { requirement_id: "req_1", evidence_id: "ev_1", relation: "partial_support", rationale: "The test covers the normal path only.", uncertainty: "medium" }
    ]);
    expect(dashboardReportToMarkdown(semanticDetail)).toContain("The test covers the normal path only.");
  });

  it("exports safe evidence timing, analysis context, and AI runtime state", () => {
    const runtimeDetail = {
      ...detail,
      evidenceCapturedAt: "2026-08-09T00:00:05.000Z",
      analysisContext: "linked_issue" as const,
      report: {
        ...detail.report,
        semanticAnalysis: { status: "unavailable" as const, attempts: 2 as const }
      }
    } satisfies DashboardReportDetail & { repositoryFullName: string };

    const exported = JSON.parse(dashboardReportToJson(runtimeDetail));

    expect(exported.pull_request.evidence_captured_at).toBe("2026-08-09T00:00:05.000Z");
    expect(exported.analysis_context).toBe("linked_issue");
    expect(exported.ai_analysis).toEqual({ status: "unavailable", attempts: 2 });
    expect(dashboardReportToMarkdown(runtimeDetail)).toContain("**AI analysis:** unavailable after 2 attempts");
  });
});
