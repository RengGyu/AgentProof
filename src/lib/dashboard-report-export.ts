import { redactSecrets } from "./redact";
import type { DashboardReportDetail } from "./github-dashboard-view-model";

const EXPORT_SCHEMA_VERSION = "agentproof.dashboard-report-export.v1";

type DashboardExportDetail = DashboardReportDetail & { repositoryFullName?: string };

/**
 * Creates a client-side copy payload from the already tenant-authorized report
 * detail. This is an allowlist, not a serialization of the stored report.
 */
export function dashboardReportToJson(detail: DashboardExportDetail): string {
  return JSON.stringify(toDashboardReportExport(detail), null, 2);
}

export function dashboardReportToMarkdown(detail: DashboardExportDetail): string {
  const exported = toDashboardReportExport(detail);
  const lines = [
    "# AgentProof evidence report",
    "",
    `**Repository:** ${exported.repository}`,
    `**PR:** #${exported.pull_request.number ?? "Unavailable"}`,
    `**Head SHA:** ${exported.pull_request.head_sha ?? "Unavailable"}`,
    `**Analyzed:** ${exported.pull_request.analyzed_at ?? "Unavailable"}`,
    `**State:** ${exported.pull_request.state}`,
    `**Priority:** ${exported.pull_request.priority ?? "Unavailable"}`,
    "",
    "## Requirements",
    "",
    ...(exported.requirements.length > 0
      ? exported.requirements.flatMap((item) => [
          `- **${item.id} · ${item.coverage}**`,
          `  - Evidence IDs: ${item.evidence_ids.join(", ") || "None"}`,
          ...(item.evidence_gaps.map((gap) => `  - Evidence gap: ${gap}`))
        ])
      : ["- Unavailable"]),
    "",
    "## Checks",
    "",
    `- CI: ${exported.checks.ci}`,
    `- Lint: ${exported.checks.lint}`,
    `- Typecheck: ${exported.checks.typecheck}`,
    "",
    "## Evidence locations",
    "",
    ...(exported.evidence_locations.length > 0
      ? exported.evidence_locations.map((item) => `- ${item.id}: ${item.safe_location ?? "No safe location"}`)
      : ["- Unavailable"]),
    "",
    "## Priority files",
    "",
    ...(exported.priority_files.length > 0
      ? exported.priority_files.map((item) => `- **${item.priority}** ${item.safe_location}`)
      : ["- Unavailable"]),
    "",
    "## Suggested next step",
    "",
    exported.suggested_next_step ?? "Unavailable"
  ];

  if (exported.ai_evidence_reading) {
    lines.push(
      "",
      "## AI evidence reading",
      "",
      ...exported.ai_evidence_reading.requirement_evidence_relations.map((item) => `- **${item.requirement_id} ↔ ${item.evidence_id} · ${item.relation}** ${item.rationale}`),
      ...exported.ai_evidence_reading.requirement_coverage.flatMap((item) => [
        `- **${item.requirement_id} · ${item.evidence_support}** ${item.summary}`,
        `  - Evidence IDs: ${item.evidence_ids.join(", ") || "None"}`
      ]),
      ...exported.ai_evidence_reading.evidence_gaps.flatMap((item) => [
        `- **Needs attention · ${item.priority}** ${item.description}`,
        `  - Needed: ${item.needed_evidence}`
      ]),
      ...exported.ai_evidence_reading.review_targets.map((item) => `- **Inspect first · ${item.priority}** ${item.inspection_goal}`),
      ...exported.ai_evidence_reading.remediation_requests.map((item) => `- **Suggested next step · ${item.priority}** ${item.instruction}`),
      ...exported.ai_evidence_reading.uncertainties.map((item) => `- **Uncertainty · ${item.impact}** ${item.description}`)
    );
  }

  return lines.join("\n");
}

function toDashboardReportExport(detail: DashboardExportDetail) {
  const report = detail.report;
  const semantic = report?.semantic;
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    repository: safeText(detail.repositoryFullName) ?? "Unavailable",
    pull_request: {
      number: detail.pullRequestNumber ?? null,
      head_sha: safeText(detail.headSha),
      analyzed_at: safeText(detail.createdAt),
      priority: safeText(detail.priority),
      state: detail.staleAt ? "STALE" : "CURRENT"
    },
    requirements: (report?.requirements ?? []).map((item) => ({
      id: safeText(item.requirementId) ?? "Unavailable",
      coverage: safeText(item.status) ?? "unclear",
      evidence_ids: item.evidenceRefs.map((reference) => safeText(reference) ?? "Unavailable"),
      evidence_gaps: item.gaps.map((gap) => safeText(gap) ?? "Unavailable")
    })),
    checks: {
      ci: safeText(report?.testing?.ciStatus) ?? "unavailable",
      lint: safeText(report?.testing?.lintStatus) ?? "unavailable",
      typecheck: safeText(report?.testing?.typecheckStatus) ?? "unavailable"
    },
    evidence_locations: (report?.evidenceIndex ?? []).map((item) => ({
      id: safeText(item.id) ?? "Unavailable",
      safe_location: safeText(item.locator) ?? null
    })),
    priority_files: (report?.reviewPriority ?? []).map((item) => ({
      safe_location: safeText(item.path) ?? "Unavailable",
      priority: safeText(item.priority) ?? "unknown"
    })),
    suggested_next_step: safeText(report?.reprompt?.prompt) ?? null,
    ai_evidence_reading: semantic ? {
      requirement_evidence_relations: semantic.requirement_evidence_relations.map((item) => ({
        requirement_id: safeText(item.requirement_id) ?? "Unavailable",
        evidence_id: safeText(item.evidence_id) ?? "Unavailable",
        relation: item.relation,
        rationale: safeText(item.rationale) ?? "Unavailable",
        uncertainty: item.uncertainty
      })),
      requirement_coverage: semantic.requirement_assessments.map((item) => ({
        requirement_id: safeText(item.requirement_id) ?? "Unavailable",
        evidence_support: item.evidence_support,
        summary: safeText(item.summary) ?? "Unavailable",
        evidence_ids: item.evidence_ids.map((id) => safeText(id) ?? "Unavailable"),
        uncertainty: item.uncertainty
      })),
      evidence_gaps: semantic.evidence_gaps.map((item) => ({
        requirement_id: safeText(item.requirement_id) ?? "Unavailable",
        gap_type: item.gap_type,
        priority: item.priority,
        description: safeText(item.description) ?? "Unavailable",
        review_impact: safeText(item.review_impact) ?? "Unavailable",
        needed_evidence: safeText(item.needed_evidence) ?? "Unavailable",
        evidence_ids: item.evidence_ids.map((id) => safeText(id) ?? "Unavailable"),
        uncertainty: item.uncertainty
      })),
      review_targets: semantic.review_targets.map((item) => ({
        target_type: item.target_type,
        target_evidence_id: safeText(item.target_evidence_id) ?? "Unavailable",
        priority: item.priority,
        reason: safeText(item.reason) ?? "Unavailable",
        inspection_goal: safeText(item.inspection_goal) ?? "Unavailable",
        requirement_ids: item.requirement_ids.map((id) => safeText(id) ?? "Unavailable"),
        evidence_ids: item.evidence_ids.map((id) => safeText(id) ?? "Unavailable"),
        uncertainty: item.uncertainty
      })),
      remediation_requests: semantic.remediation_requests.map((item) => ({
        requirement_id: safeText(item.requirement_id) ?? "Unavailable",
        request_type: item.request_type,
        priority: item.priority,
        instruction: safeText(item.instruction) ?? "Unavailable",
        rationale: safeText(item.rationale) ?? "Unavailable",
        expected_evidence: safeText(item.expected_evidence) ?? "Unavailable",
        evidence_ids: item.evidence_ids.map((id) => safeText(id) ?? "Unavailable"),
        uncertainty: item.uncertainty
      })),
      uncertainties: semantic.uncertainties.map((item) => ({
        uncertainty_type: item.uncertainty_type,
        impact: item.impact,
        description: safeText(item.description) ?? "Unavailable",
        needed_information: safeText(item.needed_information) ?? "Unavailable",
        requirement_ids: item.requirement_ids.map((id) => safeText(id) ?? "Unavailable"),
        evidence_ids: item.evidence_ids.map((id) => safeText(id) ?? "Unavailable")
      }))
    } : null
  };
}

function safeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return redactSecrets(value);
}
