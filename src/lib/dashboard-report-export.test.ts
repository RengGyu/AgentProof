import { describe, expect, it } from "vitest";
import type { DashboardReportDetail } from "./github-dashboard-view-model";
import { dashboardReportsToMarkdown, dashboardReportToJson, dashboardReportToMarkdown } from "./dashboard-report-export";

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
    expect(markdown).toContain("Requirement ID: req_1");
    expect(markdown).not.toContain("**Evidence captured:**");
    expect(markdown).not.toContain("raw diff");
  });

  it("bundles every selected repository report in newest-first order using the bounded Markdown projection", () => {
    const older = { ...detail, pullRequestNumber: 12, createdAt: "2026-08-09T00:00:00.000Z" };
    const newer = { ...detail, pullRequestNumber: 28, createdAt: "2026-08-11T00:00:00.000Z" };

    const markdown = dashboardReportsToMarkdown([older, newer]);

    expect(markdown).toContain("# AgentProof repository evidence reports");
    expect(markdown).toContain("**Repository:** RengGyu/agentproof-evaluation-fixtures");
    expect(markdown).toContain("**Reports:** 2");
    expect(markdown.indexOf("**PR:** #28")).toBeLessThan(markdown.indexOf("**PR:** #12"));
    expect(markdown.match(/# AgentProof evidence report/g)).toHaveLength(2);
    expect(markdown).not.toContain("private source must never be copied");
  });

  it("keeps the validator-approved relation in machine JSON without dumping it into Markdown", () => {
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
          uncertainties: [{ uncertainty_type: "insufficient_context", impact: "limits_assessment", description: "The remaining context is bounded.", needed_information: "A linked requirement statement.", requirement_ids: ["req_1"], evidence_ids: ["ev_1"] }]
        }
      }
    } satisfies DashboardReportDetail & { repositoryFullName: string };

    const exported = JSON.parse(dashboardReportToJson(semanticDetail));

    expect(exported.ai_evidence_reading.requirement_evidence_relations).toEqual([
      { requirement_id: "req_1", evidence_id: "ev_1", relation: "partial_support", rationale: "The test covers the normal path only.", uncertainty: "medium" }
    ]);
    expect(dashboardReportToMarkdown(semanticDetail)).not.toContain("The test covers the normal path only.");
  });

  it("keeps machine JSON detailed while projecting Markdown into one concise provider-neutral requirement reading", () => {
    const semanticDetail = {
      ...detail,
      report: {
        ...detail.report,
        semantic: {
          requirement_evidence_relations: [{ requirement_id: "req_1", evidence_id: "ev_1", relation: "partial_support", rationale: "The test covers the normal path only.", uncertainty: "medium" }],
          requirement_assessments: [{ requirement_id: "req_1", requirement_summary: "Show a retry status.", evidence_support: "partial_evidence_present", summary: "The supplied test evidence covers the status update.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
          evidence_gaps: [{ requirement_id: "req_1", gap_type: "missing_test_evidence", priority: "high", description: "The retry failure path is not evidenced.", review_impact: "Coverage remains partial.", needed_evidence: "A focused retry failure test.", evidence_ids: ["ev_1"], uncertainty: "high" }],
          review_targets: [{ target_type: "file", target_evidence_id: "ev_1", priority: "high", reason: "The status update is relevant.", inspection_goal: "Inspect the retry status transition.", requirement_ids: ["req_1"], evidence_ids: ["ev_1"], uncertainty: "medium" }],
          remediation_requests: [{ requirement_id: "req_1", request_type: "add_or_update_test", priority: "high", instruction: "Add the focused retry failure test.", rationale: "The failure path is not evidenced.", expected_evidence: "A passing focused test.", evidence_ids: ["ev_1"], uncertainty: "medium" }],
          uncertainties: [{ uncertainty_type: "insufficient_context", impact: "limits_assessment", description: "The remaining context is bounded.", needed_information: "A linked requirement statement.", requirement_ids: ["req_1"], evidence_ids: ["ev_1"] }]
        }
      }
    } satisfies DashboardReportDetail & { repositoryFullName: string };

    const exported = JSON.parse(dashboardReportToJson(semanticDetail));
    const markdown = dashboardReportToMarkdown(semanticDetail);

    expect(exported.ai_evidence_reading.requirement_evidence_relations).toHaveLength(1);
    expect(exported.ai_evidence_reading.requirement_coverage).toHaveLength(1);
    expect(exported.ai_evidence_reading.evidence_gaps).toHaveLength(1);
    expect(exported.ai_evidence_reading.review_targets).toHaveLength(1);
    expect(exported.ai_evidence_reading.remediation_requests).toHaveLength(1);
    expect(exported.ai_evidence_reading.uncertainties).toHaveLength(1);
    expect(markdown).toContain("Show a retry status.");
    expect(markdown).toContain("Evidence coverage: Partially supported");
    expect(markdown).toContain("What the evidence shows: The supplied test evidence covers the status update.");
    expect(markdown).toContain("Key gap: Focused test evidence is missing.");
    expect(markdown).not.toContain("Next: Add the focused retry failure test.");
    expect(markdown).toContain("Inspect first: Inspect the retry status transition.");
    expect(markdown).not.toContain("AI analysis");
    expect(markdown).not.toContain("AI evidence reading");
    expect(markdown).not.toContain("req_1 ↔ ev_1");
    expect(markdown).not.toContain("**req_1 ·");
    expect(markdown).not.toContain("The test covers the normal path only.");
    expect(markdown).not.toContain("Coverage remains partial.");
    expect(markdown).not.toContain("A passing focused test.");
  });

  it("keeps safe evidence timing and analysis context in both exports while runtime detail stays machine-only", () => {
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
    const markdown = dashboardReportToMarkdown(runtimeDetail);
    expect(markdown).toContain("Some supporting details are unavailable. Available evidence is still shown.");
    expect(markdown).toContain("**Analysis context:** Linked Issue");
    expect(markdown).toContain("**Evidence captured:** 2026-08-09T00:00:05.000Z");
    expect(markdown).not.toContain("AI analysis");
  });

  it("keeps one deterministic inspect-first fallback when semantic targets are absent", () => {
    const markdown = dashboardReportToMarkdown(detail);

    expect(markdown).toContain("Inspect first: src/repositories/search.ts");
  });
});
