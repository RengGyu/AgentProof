import { redactSecrets } from "./redact";
import type { DashboardReportDetail } from "./github-dashboard-view-model";
import { toDashboardRequirementViewModels } from "./dashboard-requirement-view-model";
import { deriveRequirementPresentationV2, isVerificationReportV2 } from "./requirement-presentation-v2";

const EXPORT_SCHEMA_VERSION = "agentproof.dashboard-report-export.v1";

type DashboardExportDetail = DashboardReportDetail & { repositoryFullName?: string };

/**
 * Creates a client-side copy payload from the already tenant-authorized report
 * detail. This is an allowlist, not a serialization of the stored report.
 */
export function dashboardReportToJson(detail: DashboardExportDetail): string {
  assertCopyEligible(detail);
  return JSON.stringify(toDashboardReportExport(detail), null, 2);
}

export function dashboardReportToMarkdown(detail: DashboardExportDetail): string {
  assertCopyEligible(detail);
  const exported = toDashboardReportExport(detail);
  const requirementCards = toDashboardRequirementViewModels({
    report: detail.report,
    requirements: detail.report?.requirements,
    semantic: detail.report?.semantic,
    semanticAnalysis: detail.report?.semanticAnalysis,
    verificationContract: detail.report?.verificationContract
  });
  const locationsByEvidenceId = new Map(exported.evidence_locations.map((item) => [item.id, item.safe_location]));
  const contractGuidance = verificationContractGuidance(detail.report?.verificationContract?.state);
  const lines = [
    "# AgentProof evidence report",
    "",
    `**Repository:** ${exported.repository}`,
    `**PR:** #${exported.pull_request.number ?? "Unavailable"}`,
    `**Head SHA:** ${exported.pull_request.head_sha ?? "Unavailable"}`,
    `**Analyzed:** ${exported.pull_request.analyzed_at ?? "Unavailable"}`,
    ...(exported.pull_request.evidence_captured_at ? [`**Evidence captured:** ${exported.pull_request.evidence_captured_at}`] : []),
    `**State:** ${exported.pull_request.state}`,
    `**Priority:** ${exported.pull_request.priority ?? "Unavailable"}`,
    `**Analysis context:** ${readableAnalysisContext(exported.analysis_context)}`,
    ...(exported.planning_policy ? [`**Policy:** ${exported.planning_policy}`] : []),
    ...(exported.verification_policy ? [`**Policy:** ${exported.verification_policy}`] : []),
    ...(exported.verification_outcome_note ? [`**Outcome policy:** ${exported.verification_outcome_note}`] : []),
    ...(contractGuidance ? [`**Contract guidance:** ${contractGuidance}`] : []),
    "",
    "## Requirements",
    "",
    ...(requirementCards.length > 0
      ? requirementCards.flatMap((item, index) => conciseRequirementMarkdown(
        item,
        locationsByEvidenceId,
        index === 0 ? exported.priority_files[0]?.safe_location : undefined
      ))
      : ["- No explicit requirement or PR objective was found."]),
    "",
    "## Checks",
    "",
    `- CI: ${exported.checks.ci}`,
    `- Lint: ${exported.checks.lint}`,
    `- Typecheck: ${exported.checks.typecheck}`,
    ""
  ];

  return lines.join("\n");
}

export function dashboardReportsToMarkdown(details: DashboardExportDetail[]): string {
  details.forEach(assertCopyEligible);
  const ordered = [...details].sort((left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  if (ordered.length === 0) return "";
  const repository = safeText(ordered[0]?.repositoryFullName) ?? "Unavailable";
  return [
    "# AgentProof repository evidence reports",
    "",
    `**Repository:** ${repository}`,
    `**Reports:** ${ordered.length}`,
    "**Scope:** Current saved reports",
    "",
    ...ordered.flatMap((detail, index) => [
      ...(index > 0 ? ["---", ""] : []),
      dashboardReportToMarkdown(detail),
      ""
    ])
  ].join("\n").trimEnd();
}

function conciseRequirementMarkdown(
  item: ReturnType<typeof toDashboardRequirementViewModels>[number],
  locationsByEvidenceId: Map<string, string | null>,
  fallbackInspectFirst?: string
): string[] {
  const references = [...new Set([...item.evidenceRefs, ...item.semanticEvidenceIds])];
  const locations = references
    .map((id) => locationsByEvidenceId.get(id))
    .filter((value): value is string => Boolean(value));
  const inspectFirst = item.nextAction ? undefined : item.inspectFirst ?? fallbackInspectFirst;
  return [
    `- **${item.objectiveText ?? `Requirement ${item.requirementId}`}**`,
    `  - ${item.coverageHeading ?? "Evidence coverage"}: ${item.coverageLabel}`,
    ...(item.outcomeLabel && item.outcomeMeaning ? [`  - Requirement outcome: ${item.outcomeLabel}`, `  - Outcome basis: ${item.outcomeMeaning}`] : []),
    ...(item.sourceAuthorityLabel ? [`  - Requirement source: ${item.sourceAuthorityLabel}`] : []),
    ...(item.sourceAuthorityMeaning ? [`  - Source authority: ${item.sourceAuthorityMeaning}`] : []),
    ...(item.evidenceVisibility === "omitted_for_summary" && item.evidenceVisibilityLabel
      ? [`  - Evidence visibility: ${item.evidenceVisibilityLabel}`]
      : []),
    `  - What the evidence shows: ${item.explanation.text}`,
    ...(item.primaryGap ? [`  - Key gap: ${item.primaryGap}`] : []),
    ...(item.nextAction ? [`  - Next: ${item.nextAction}`] : []),
    ...(inspectFirst ? [`  - Inspect first: ${inspectFirst}`] : []),
    "",
    "  <details>",
    "  <summary>Evidence details</summary>",
    "",
    `  Requirement ID: ${item.requirementId}`,
    `  Evidence IDs: ${references.join(", ") || (item.evidenceVisibility === "omitted_for_summary" ? "Omitted from portable summary" : "Unavailable")}`,
    `  Locations: ${locations.join(", ") || (item.evidenceVisibility === "omitted_for_summary" ? "Omitted from portable summary" : "Unavailable")}`,
    "",
    "  </details>"
  ];
}

function readableAnalysisContext(value: "linked_issue" | "unlinked_pr" | "provided_requirement"): string {
  if (value === "linked_issue") return "Linked Issue";
  if (value === "unlinked_pr") return "PR objectives";
  return "Provided requirement";
}

function toDashboardReportExport(detail: DashboardExportDetail) {
  const report = detail.report;
  const semantic = report?.semantic;
  const v2Report = report && isVerificationReportV2(report) ? report : undefined;
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    repository: safeText(detail.repositoryFullName) ?? "Unavailable",
    pull_request: {
      number: detail.pullRequestNumber ?? null,
      head_sha: safeText(detail.headSha),
      analyzed_at: safeText(detail.createdAt),
      evidence_captured_at: safeText(detail.evidenceCapturedAt) ?? null,
      priority: safeText(detail.priority),
      state: "CURRENT"
    },
    analysis_context: detail.analysisContext ?? "provided_requirement",
    ...(report?.planner ? { planning_policy: "Enhanced planning policy" } : {}),
    ...(report?.verificationContract ? {
      verification_policy: "Strict verification contract",
      verification_outcome_note: verificationOutcomeNote(report.verificationContract.state)
    } : {}),
    requirements: (report?.requirements ?? []).map((item) => {
      const presentation = v2Report ? deriveRequirementPresentationV2(v2Report, item.requirementId) : undefined;
      return {
        id: safeText(item.requirementId) ?? "Unavailable",
        coverage: safeText(presentation?.observedEvidence ?? item.evidenceStatus ?? item.status) ?? "unclear",
        ...(presentation ? {
          outcome: presentation.outcome,
          outcome_label: presentation.outcomeLabel,
          outcome_basis: presentation.outcomeBasis,
          observed_evidence_label: presentation.observationLabel,
          evidence_visibility: presentation.evidenceVisibility
        } : {}),
        ...(item.sourceAuthority ? { source_authority: item.sourceAuthority } : {}),
        evidence_ids: item.evidenceRefs.map((reference) => safeText(reference) ?? "Unavailable"),
        evidence_gaps: item.gaps.map((gap) => safeText(gap) ?? "Unavailable")
      };
    }),
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
    ai_analysis: report?.semanticAnalysis
      ? { status: report.semanticAnalysis.status, attempts: report.semanticAnalysis.attempts }
      : report?.semantic
        ? { status: "included" as const, attempts: 1 as const }
        : null,
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

function verificationOutcomeNote(state: "authoritative" | "author_claim" | "absent" | "invalid"): string {
  if (state === "absent") return "No approved verification contract; observed evidence does not establish the requirement outcome.";
  if (state === "invalid") return "The supplied verification contract was invalid; observed evidence does not establish the requirement outcome.";
  if (state === "author_claim") return "PR-description contract; reviewer confirmation is required for the requirement outcome.";
  return "Requirement outcomes are evaluated against an approved verification contract.";
}

function verificationContractGuidance(state: "authoritative" | "author_claim" | "absent" | "invalid" | undefined): string | undefined {
  if (state === "absent") return "Approved verification contract is missing.";
  if (state === "invalid") return "Verification contract could not be validated.";
  return undefined;
}

function assertCopyEligible(detail: DashboardExportDetail): void {
  if (detail.freshness !== "current" || detail.copyEligible !== true) {
    throw new Error("Dashboard report is not current and copy eligible.");
  }
}

function safeText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return redactSecrets(value);
}
