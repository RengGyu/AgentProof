import { redactSecrets } from "../src/lib/redact.ts";

const baseUrl = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const prUrl = process.env.AGENTPROOF_SMOKE_PR_URL;
const taskText = process.env.AGENTPROOF_SMOKE_TASK_TEXT ?? "";
const githubToken = process.env.AGENTPROOF_SMOKE_GITHUB_TOKEN;
const allowProductionGithubToken = process.env.AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN === "1";
const ALLOWED_SAVED_REPORT_DURABILITY = new Set(["short-lived-in-memory", "summary-only-supabase"]);
const ANALYZE_TIMING_PHASES = ["input", "evidence", "report", "validation", "total"];
const ANALYZE_TIMING_PATTERN = /^ap_(input|evidence|report|validation|total);dur=(\d+)$/;
const GITHUB_EVIDENCE_TIMING_PHASES = ["github_pr", "github_files", "github_checks", "github_statuses", "github_annotations", "github_jobs"];
const GITHUB_EVIDENCE_TIMING_PATTERN = /^ap_(github_pr|github_files|github_checks|github_statuses|github_annotations|github_jobs);dur=(\d+)$/;
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const GENERAL_PR_ASSESSMENT_MODES = new Set(["ordinary_pr", "typed_contract_companion"]);
const GENERAL_PR_ASSESSMENT_SOURCE_STATES = new Set(["linked_issue", "pr_author_claim", "mixed", "missing", "ambiguous"]);
const GENERAL_PR_ASSESSMENT_CONCLUSIONS = new Set([
  "evidence_supports_stated_change",
  "evidence_partial",
  "mixed_evidence",
  "attention_required",
  "collection_blocked",
  "no_assessable_claims"
]);
const GENERAL_PR_ASSESSMENT_REASON_CODES = new Set([
  "implementation_evidence_observed",
  "test_artifact_observed",
  "exact_execution_passed",
  "exact_execution_failed",
  "verified_relation_missing",
  "execution_not_observed",
  "claimed_artifact_not_observed",
  "unsupported_claim_type",
  "source_missing",
  "source_ambiguous",
  "source_unavailable",
  "collection_incomplete",
  "head_mismatch",
  "evidence_identity_incomplete",
  "semantic_relation_only",
  "author_claim_requires_confirmation",
  "deterministic_candidate_missing",
  "semantic_observer_disabled",
  "semantic_observer_ineligible",
  "semantic_observer_unavailable",
  "semantic_observer_timeout",
  "semantic_proposal_invalid",
  "semantic_candidate_missing",
  "semantic_candidate_rejected",
  "target_relation_unresolved"
]);
const GENERAL_PR_ASSESSMENT_COUNT_KEYS = [
  "evidence_supported",
  "evidence_partial",
  "not_demonstrated",
  "contradicted",
  "blocked",
  "not_assessable"
];
const OPERATOR_DIAGNOSTIC_HEADER = "x-agentproof-observation-diagnostics";
const OPERATOR_DIAGNOSTIC_VERSION = "semantic-boundary-v1";
const OPERATOR_STAGE_STATES = new Set(["not_run", "valid", "invalid", "timeout", "unavailable", "stale"]);
const OPERATOR_COVERAGE_STATES = new Set(["complete", "sampled", "incomplete"]);
const OPERATOR_SOURCE_BUCKETS = new Set(["0", "1_4", "5_8", "9_12"]);
const OPERATOR_EVIDENCE_BUCKETS = new Set(["0", "1_16", "17_32", "33_64"]);
const OPERATOR_OMISSION_KEYS = ["spanBudget", "evidenceBudget", "inputByteBudget", "unsafeDescriptor", "noDeterministicSignal"];
const OPERATOR_PACKAGE_FAILURE_REASONS = new Set([
  "model_profile_invalid", "timeout_invalid", "seed_invalid", "seed_parse_incomplete", "span_missing",
  "span_limit_exceeded", "change_cluster_limit_exceeded", "evidence_atom_limit_exceeded", "seed_rebuild_mismatch",
  "source_binding_invalid", "selection_unavailable", "schema_unavailable", "input_size_exceeded"
]);
const OPERATOR_PROVIDER_PHASES = new Set(["claim_discovery", "evidence_linking"]);
const OPERATOR_PROVIDER_CATEGORIES = new Set(["timeout", "network_error", "rate_limited", "provider_unavailable", "auth_failed", "request_invalid", "invalid_json_schema", "response_invalid", "output_invalid", "incomplete"]);
const OPERATOR_EVIDENCE_INVALID_REASONS = new Set(["validation_provenance_invalid", "output_limit_exceeded", "root_shape_invalid", "relation_limit_exceeded", "selection_binding_invalid", "relation_shape_invalid", "objective_binding_invalid", "reference_binding_invalid", "duplicate_relation", "reference_ownership_conflict", "merge_binding_invalid", "validator_exception"]);
const OPERATOR_FRESHNESS_PHASES = new Set(["before_claim", "after_claim", "before_evidence", "after_evidence"]);
const OPERATOR_FRESHNESS_STALE_REASONS = new Set(["head_changed", "base_changed", "source_changed", "seed_changed"]);
const OPERATOR_FRESHNESS_UNAVAILABLE_REASONS = new Set(["auth_unavailable", "rate_limited", "fetch_failed", "snapshot_unavailable", "privacy_ineligible"]);

/** Optional local diagnostics never change the default public smoke result. */
export async function runAnalyzePrSmoke({ onDiagnostic, ...options }) {
  if (!onDiagnostic) return executeAnalyzePrSmoke(options);
  const diagnostic = { status: "failed", stage: "analyze", httpStatus: null, report: null, operator: null, cleanupConfirmed: null };
  let result;
  let failure;
  try {
    result = await executeAnalyzePrSmoke({
      ...options,
      onStage: (stage) => { diagnostic.stage = stage; },
      onAnalyzed: (report) => { diagnostic.httpStatus = 200; diagnostic.report = projectSmokeReportDetails(report, [options.githubToken, options.operatorDiagnosticsToken]); },
      onOperator: (operator) => { diagnostic.operator = operator; }
    });
    diagnostic.status = "completed";
    diagnostic.stage = "completed";
    diagnostic.httpStatus = result.status;
    diagnostic.cleanupConfirmed = result.savedReportDeleted;
  } catch (error) {
    if (Number.isInteger(error?.status)) diagnostic.httpStatus = error.status;
    failure = error;
  }
  // A failed local checkpoint must stop the run, not masquerade as an API failure.
  await onDiagnostic(diagnostic);
  if (failure) throw failure;
  return result;
}

/** Explicit projection: no raw evidence summaries, bindings, receipts or provider bodies. */
export function projectSmokeReportDetails(report, secrets = []) {
  const safeText = (value) => {
    if (typeof value !== "string") return null;
    let clean = value;
    for (const secret of secrets) if (secret) clean = clean.replaceAll(secret, "[redacted]");
    clean = redactSecrets(clean);
    if (/Patch excerpt|raw[_ ](?:details|diff|log|patch|annotation)|```/i.test(clean)) return "[raw excerpt omitted]";
    return clean.slice(0, 1000);
  };
  const list = (values) => Array.isArray(values) ? values : [];
  const texts = (values) => list(values).map(safeText);
  const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, safeText(value?.[key])]));
  return {
    createdAt: safeText(report.createdAt),
    observedAnchor: Object.fromEntries(["headSha", "baseSha"].map((key) => {
      const value = report.source?.provenance?.[key];
      return [key, typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value) ? value : null];
    })),
    summary: pick(report.summary, ["oneLine", "priority"]),
    checks: pick(report.testing, ["ciStatus", "lintStatus", "typecheckStatus"]),
    requirements: list(report.requirements).map((item) => ({
      ...pick(item, ["requirementId", "requirementText", "status", "evidenceStatus", "sourceAuthority", "reviewerNote"]),
      gaps: texts(item.gaps), evidenceRefs: texts(item.evidenceRefs),
      proofAxes: list(item.proofAxes).map((axis) => ({
        ...pick(axis, ["subject", "polarity", "state", "collectionBasis"]), evidenceRefs: texts(axis.evidenceRefs)
      }))
    })),
    generalPrAssessmentSummary: isValidGeneralPrAssessmentSummary(report.generalPrAssessmentSummary)
      ? copyGeneralPrAssessmentSummary(report.generalPrAssessmentSummary) : null,
    targets: list(report.generalPrAssessment?.targets).map((target, index) => ({
      id: `target_${index + 1}`,
      ...pick(target, ["claimRole", "conclusion", "admissionBasis", "sourceAuthority", "requirementId"]),
      reasonCodes: texts(target.reasonCodes), evidenceRefs: texts(target.evidenceRefs),
      relationLevels: texts(target.relationLevels), headBound: target.headBound === true
    })),
    evidence: list(report.evidenceIndex).map((item) => pick(item, ["id", "kind", "label", "locator"])),
    limitations: texts(report.limitations)
  };
}

async function executeAnalyzePrSmoke({
  baseUrl,
  prUrl,
  taskText = "",
  githubToken,
  operatorDiagnosticsToken,
  allowProductionGithubToken = false,
  requireRequirementFindings = true,
  requireGeneralPrAssessmentSummary = false,
  expectedSourceAnchor,
  expectations,
  fetchImpl = fetch,
  onStage = () => {},
  onAnalyzed = () => {},
  onOperator = () => {}
}) {
  if (!prUrl) {
    throw smokeError("Set AGENTPROOF_SMOKE_PR_URL to a GitHub pull request URL.");
  }

  assertGithubTokenBoundary({ baseUrl, githubToken, allowProductionGithubToken });

  const response = await fetchImpl(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(operatorDiagnosticsToken ? {
        [OPERATOR_DIAGNOSTIC_HEADER]: OPERATOR_DIAGNOSTIC_VERSION,
        "x-agentproof-ops-token": operatorDiagnosticsToken
      } : {})
    },
    body: JSON.stringify({
      prUrl,
      taskText,
      githubToken
    })
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.report) {
    throw smokeError(
      typeof payload.error === "string" ? payload.error : "Analyze smoke failed.",
      response.status
    );
  }

  const analyzeTiming = analyzeTimingFromResponse(response);
  const githubEvidenceTiming = githubEvidenceTimingFromResponse(response);
  const report = payload.report;
  onAnalyzed(report);
  onStage("operator_diagnostics");
  const operatorSemanticDiagnostics = readOperatorSemanticDiagnostics(payload.operatorDiagnostics, Boolean(operatorDiagnosticsToken));
  onOperator(operatorSemanticDiagnostics);
  onStage("assessment_summary");
  const generalPrAssessmentSummary = readGeneralPrAssessmentSummary(
    report,
    requireGeneralPrAssessmentSummary
  );
  onStage("source_anchor");
  assertExpectedSourceAnchor(report, expectedSourceAnchor);
  onStage("ci_evidence");
  const executionEvidence = passingExecutionEvidence(report);
  const failedCheckLocations = failedCheckAnnotationLocations(report);
  const expectationResult = assertReportExpectations(report, expectations);

  if (report.testing?.ciStatus === "passed" && executionEvidence.length === 0) {
    throw smokeError("Report claimed passed CI without passing check/log evidence.", response.status);
  }

  onStage("summary_save");
  const saveResult = await saveSummaryOnlyReport({ baseUrl, report, fetchImpl });
  const savedReport = saveResult.savedReport;
  onStage("summary_privacy");
  assertSummaryOnlyReport(savedReport, {
    originalReprompt: report.reprompt?.prompt,
    githubToken,
    failedCheckLocations
  });
  onStage("quality_gate");
  const qualityGate = evaluateReportQualityGate(report, {
    savedReport,
    requireRequirementFindings
  });

  if (!qualityGate.ok) {
    const failedChecks = qualityGate.checks
      .filter((check) => !check.ok)
      .map((check) => check.id)
      .join(", ");

    throw smokeError(`Report quality gate failed: ${failedChecks}.`, response.status);
  }

  return {
    ok: true,
    status: response.status,
    priority: report.summary?.priority,
    confidence: report.summary?.confidence,
    evidenceCoverage: report.summary?.evidenceCoverage,
    ciStatus: report.testing?.ciStatus,
    requirementCount: Array.isArray(report.requirements) ? report.requirements.length : 0,
    requirementStatusCounts: requirementStatusCounts(report.requirements),
    requirementEvidenceStatusCounts: requirementStatusCounts(report.requirements, (requirement) =>
      requirement.evidenceStatus ?? requirement.status
    ),
    evidenceCount: Array.isArray(report.evidenceIndex) ? report.evidenceIndex.length : 0,
    limitationCount: Array.isArray(report.limitations) ? report.limitations.length : 0,
    generalPrAssessmentSummary,
    analyzeTiming,
    githubEvidenceTiming,
    expectationCheckCount: expectationResult.checks.length,
    expectationChecks: expectationResult.checks,
    failedCheckLocationCount: failedCheckLocations.length,
    savedFailedCheckLocationsOmitted: true,
    githubTokenForwarded: Boolean(githubToken),
    productionTokenForwarded: Boolean(githubToken && isRemoteProductionLikeBaseUrl(baseUrl)),
    savedReportPrivacy: saveResult.privacy,
    savedReportDurability: saveResult.durability,
    savedReportDurabilityWarning: Boolean(saveResult.durabilityWarning),
    savedEvidenceCount: Array.isArray(savedReport.evidenceIndex) ? savedReport.evidenceIndex.length : null,
    savedClaimCount: Array.isArray(savedReport.claims) ? savedReport.claims.length : null,
    savedRepromptOmitted: /omit|shared summary|summary/i.test(savedReport.reprompt?.prompt ?? ""),
    savedEvidenceRefsCleared: evidenceRefsCleared(savedReport),
    savedReportDeleted: saveResult.deleted,
    savedReportDeleteWarning: saveResult.deleteWarning,
    operatorSemanticDiagnostics,
    qualityGate
  };
}

export function readOperatorSemanticDiagnostics(value, required = true) {
  if (!required) return null;
  const keys = ["claimState", "evidenceState", "sourceCoverage", "evidenceCoverage", "providerCallCount", "selectedCountBuckets", "semanticPackageFailureReasons", "omittedReasonCounts"];
  const hasReason = value && Object.hasOwn(value, "claimInvalidReason");
  const hasEvidenceInvalidReason = value && Object.hasOwn(value, "evidenceInvalidReason");
  const hasFreshnessFailure = value && Object.hasOwn(value, "freshnessFailure");
  const hasProviderFailure = value && Object.hasOwn(value, "providerFailure");
  if (hasReason) keys.push("claimInvalidReason");
  if (hasEvidenceInvalidReason) keys.push("evidenceInvalidReason");
  if (hasFreshnessFailure) keys.push("freshnessFailure");
  if (hasProviderFailure) keys.push("providerFailure");
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !hasExactKeys(value, keys) ||
    (hasReason && value.claimInvalidReason !== null && !["root_shape_invalid", "span_decision_invalid", "span_binding_invalid", "role_ceiling_violation", "output_limit_exceeded"].includes(value.claimInvalidReason)) ||
    (hasEvidenceInvalidReason && (
      (value.evidenceState === "invalid" && (value.evidenceInvalidReason === null || !OPERATOR_EVIDENCE_INVALID_REASONS.has(value.evidenceInvalidReason))) ||
      (value.evidenceState !== "invalid" && value.evidenceInvalidReason !== null)
    )) ||
    (hasFreshnessFailure && !isValidOperatorFreshnessFailure(value.freshnessFailure)) ||
    (hasProviderFailure && !isValidOperatorProviderFailure(value.providerFailure)) ||
    !OPERATOR_STAGE_STATES.has(value.claimState) || !OPERATOR_STAGE_STATES.has(value.evidenceState) ||
    (value.sourceCoverage !== null && !OPERATOR_COVERAGE_STATES.has(value.sourceCoverage)) ||
    (value.evidenceCoverage !== null && !OPERATOR_COVERAGE_STATES.has(value.evidenceCoverage)) ||
    ![0, 1, 2, "3_plus"].includes(value.providerCallCount) ||
    !value.selectedCountBuckets || typeof value.selectedCountBuckets !== "object" || Array.isArray(value.selectedCountBuckets) ||
    !hasExactKeys(value.selectedCountBuckets, ["sourceSpans", "evidenceCandidates"]) ||
    !OPERATOR_SOURCE_BUCKETS.has(value.selectedCountBuckets.sourceSpans) || !OPERATOR_EVIDENCE_BUCKETS.has(value.selectedCountBuckets.evidenceCandidates) ||
    !Array.isArray(value.semanticPackageFailureReasons) ||
    new Set(value.semanticPackageFailureReasons).size !== value.semanticPackageFailureReasons.length ||
    !value.semanticPackageFailureReasons.every((reason) => OPERATOR_PACKAGE_FAILURE_REASONS.has(reason)) ||
    !value.omittedReasonCounts || typeof value.omittedReasonCounts !== "object" || Array.isArray(value.omittedReasonCounts) ||
    !hasExactKeys(value.omittedReasonCounts, OPERATOR_OMISSION_KEYS) ||
    !OPERATOR_OMISSION_KEYS.every((key) => Number.isSafeInteger(value.omittedReasonCounts[key]) && value.omittedReasonCounts[key] >= 0)) {
    throw smokeError("Analyze response did not include a valid operator staged diagnostic.");
  }

  return {
    claimState: value.claimState,
    ...(hasReason ? { claimInvalidReason: value.claimInvalidReason } : {}),
    ...(hasEvidenceInvalidReason ? { evidenceInvalidReason: value.evidenceInvalidReason } : {}),
    ...(hasFreshnessFailure ? { freshnessFailure: copyOperatorFreshnessFailure(value.freshnessFailure) } : {}),
    ...(hasProviderFailure ? { providerFailure: copyOperatorProviderFailure(value.providerFailure) } : {}),
    evidenceState: value.evidenceState,
    sourceCoverage: value.sourceCoverage,
    evidenceCoverage: value.evidenceCoverage,
    providerCallCount: value.providerCallCount,
    selectedCountBuckets: { ...value.selectedCountBuckets },
    semanticPackageFailureReasons: [...value.semanticPackageFailureReasons],
    omittedReasonCounts: Object.fromEntries(OPERATOR_OMISSION_KEYS.map((key) => [key, value.omittedReasonCounts[key]]))
  };
}

function isValidOperatorFreshnessFailure(value) {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasExactKeys(value, ["phase", "state", "reason"]) || !OPERATOR_FRESHNESS_PHASES.has(value.phase)) return false;
  return (value.state === "stale" && OPERATOR_FRESHNESS_STALE_REASONS.has(value.reason)) ||
    (value.state === "unavailable" && OPERATOR_FRESHNESS_UNAVAILABLE_REASONS.has(value.reason));
}

function copyOperatorFreshnessFailure(value) {
  return value === null ? null : { phase: value.phase, state: value.state, reason: value.reason };
}

function isValidOperatorProviderFailure(value) {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = ["phase", "category"];
  if (Object.hasOwn(value, "httpStatus")) keys.push("httpStatus");
  if (Object.hasOwn(value, "incompleteReason")) keys.push("incompleteReason");
  return hasExactKeys(value, keys) && OPERATOR_PROVIDER_PHASES.has(value.phase) && OPERATOR_PROVIDER_CATEGORIES.has(value.category) &&
    (!Object.hasOwn(value, "httpStatus") || (Number.isSafeInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599)) &&
    (!Object.hasOwn(value, "incompleteReason") || value.incompleteReason === "max_output_tokens") &&
    (value.category === "incomplete" ? value.incompleteReason === "max_output_tokens" : !Object.hasOwn(value, "incompleteReason"));
}

function copyOperatorProviderFailure(value) {
  if (value === null) return null;
  return { phase: value.phase, category: value.category, ...(Object.hasOwn(value, "httpStatus") ? { httpStatus: value.httpStatus } : {}), ...(Object.hasOwn(value, "incompleteReason") ? { incompleteReason: value.incompleteReason } : {}) };
}

function readGeneralPrAssessmentSummary(report, required) {
  const summary = report?.generalPrAssessmentSummary;
  if (!required) return summary;

  if (!isValidGeneralPrAssessmentSummary(summary)) {
    throw smokeError("General PR assessment summary was unavailable.");
  }

  return copyGeneralPrAssessmentSummary(summary);
}

export function isValidGeneralPrAssessmentSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return false;
  const expectedKeys = ["version", "mode", "sourceState", "overallConclusion", "counts", "reasonCodes", ...(summary.observations === undefined ? [] : ["observations"])];
  if (!hasExactKeys(summary, expectedKeys) || summary.version !== 1 ||
    !GENERAL_PR_ASSESSMENT_MODES.has(summary.mode) ||
    !GENERAL_PR_ASSESSMENT_SOURCE_STATES.has(summary.sourceState) ||
    !GENERAL_PR_ASSESSMENT_CONCLUSIONS.has(summary.overallConclusion) ||
    !summary.counts || typeof summary.counts !== "object" || Array.isArray(summary.counts) ||
    !hasExactKeys(summary.counts, GENERAL_PR_ASSESSMENT_COUNT_KEYS) ||
    !Array.isArray(summary.reasonCodes) || summary.reasonCodes.length > 16 ||
    new Set(summary.reasonCodes).size !== summary.reasonCodes.length ||
    !summary.reasonCodes.every((reason) => GENERAL_PR_ASSESSMENT_REASON_CODES.has(reason))) {
    return false;
  }

  for (const key of GENERAL_PR_ASSESSMENT_COUNT_KEYS) {
    if (!Number.isSafeInteger(summary.counts[key]) || summary.counts[key] < 0 || summary.counts[key] > 100) return false;
  }

  if (summary.overallConclusion !== aggregateGeneralPrAssessmentConclusion(summary.counts) ||
    (summary.sourceState === "pr_author_claim" && !summary.reasonCodes.includes("author_claim_requires_confirmation"))) {
    return false;
  }

  if (summary.observations !== undefined && !isValidGeneralPrAssessmentObservations(summary.observations, summary.counts)) return false;

  return true;
}

function aggregateGeneralPrAssessmentConclusion(counts) {
  if (counts.contradicted > 0) return "attention_required";
  const total = GENERAL_PR_ASSESSMENT_COUNT_KEYS.reduce((sum, key) => sum + counts[key], 0);
  if (total === 0) return "no_assessable_claims";
  if (counts.blocked === total) return "collection_blocked";
  if (counts.evidence_supported === total) return "evidence_supports_stated_change";
  if (counts.evidence_partial === total) return "evidence_partial";
  return "mixed_evidence";
}

export function copyGeneralPrAssessmentSummary(summary) {
  return {
    version: summary.version,
    mode: summary.mode,
    sourceState: summary.sourceState,
    overallConclusion: summary.overallConclusion,
    counts: Object.fromEntries(GENERAL_PR_ASSESSMENT_COUNT_KEYS.map((key) => [key, summary.counts[key]])),
    reasonCodes: [...summary.reasonCodes],
    ...(summary.observations ? { observations: { version: summary.observations.version, inventory: { state: summary.observations.inventory.state, changedArtifacts: summary.observations.inventory.changedArtifacts, changedTestCandidates: summary.observations.inventory.changedTestCandidates }, links: { state: summary.observations.links.state, linkedObjectives: summary.observations.links.linkedObjectives, supports: summary.observations.links.supports, tests: summary.observations.links.tests, implements: summary.observations.links.implements, contradicts: summary.observations.links.contradicts }, coverage: { source: summary.observations.coverage.source, evidence: summary.observations.coverage.evidence } } } : {})
  };
}

function isValidGeneralPrAssessmentObservations(value, counts) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !hasExactKeys(value, ["version", "inventory", "links", "coverage"]) || value.version !== 1 || !value.inventory || typeof value.inventory !== "object" || Array.isArray(value.inventory) || !value.links || typeof value.links !== "object" || Array.isArray(value.links) || !value.coverage || typeof value.coverage !== "object" || Array.isArray(value.coverage)) return false;
  const { inventory, links, coverage } = value;
  if (!hasExactKeys(inventory, ["state", "changedArtifacts", "changedTestCandidates"]) || !hasExactKeys(links, ["state", "linkedObjectives", "supports", "tests", "implements", "contradicts"]) || !hasExactKeys(coverage, ["source", "evidence"]) || !["complete", "incomplete", "unavailable"].includes(inventory.state) || !Number.isSafeInteger(inventory.changedArtifacts) || !Number.isSafeInteger(inventory.changedTestCandidates) || inventory.changedArtifacts < 0 || inventory.changedTestCandidates < 0 || inventory.changedTestCandidates > inventory.changedArtifacts) return false;
  const keys = ["supports", "tests", "implements", "contradicts"];
  if (!["not_attempted", "proposed", "none_proposed", "unavailable"].includes(links.state) || !Number.isSafeInteger(links.linkedObjectives) || links.linkedObjectives < 0 || !keys.every((key) => Number.isSafeInteger(links[key]) && links[key] >= 0)) return false;
  const count = keys.reduce((sum, key) => sum + links[key], 0);
  const targetCount = Object.values(counts).reduce((sum, item) => sum + (Number.isSafeInteger(item) ? item : Infinity), 0);
  if (count > 64 || links.linkedObjectives > targetCount || links.linkedObjectives > count || (links.state === "proposed" ? (links.linkedObjectives === 0 || count === 0) : (links.linkedObjectives !== 0 || count !== 0))) return false;
  return ["source", "evidence"].every((key) => coverage[key] === null || ["complete", "sampled", "incomplete"].includes(coverage[key]));
}

function hasExactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function requirementStatusCounts(requirements, selectStatus = (requirement) => requirement.status) {
  const counts = {};
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    const status = selectStatus(requirement);
    if (REQUIREMENT_STATUSES.has(status)) counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function assertExpectedSourceAnchor(report, expectedSourceAnchor) {
  if (expectedSourceAnchor === undefined) return;

  const expectedHeadSha = expectedSourceAnchor?.headSha;
  const expectedBaseSha = expectedSourceAnchor?.baseSha;
  const provenance = report?.source?.provenance;
  if (
    !isFullGitSha(expectedHeadSha) ||
    !isFullGitSha(expectedBaseSha) ||
    provenance?.origin !== "github_snapshot" ||
    provenance?.headSha !== expectedHeadSha ||
    provenance?.baseSha !== expectedBaseSha
  ) {
    throw smokeError("Analyze report source anchor did not match the frozen external PR sample.");
  }
}

function isFullGitSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value);
}

export function analyzeTimingFromResponse(response) {
  const fallbackHeader = response.headers.get("x-agentproof-timing");
  const serverTimingHeader = response.headers.get("server-timing");

  if (fallbackHeader && serverTimingHeader && fallbackHeader !== serverTimingHeader) {
    throw smokeError("Analyze timing headers disagreed.");
  }

  const header = fallbackHeader ?? serverTimingHeader;
  if (!header) {
    throw smokeError("Analyze response did not include timing evidence.");
  }

  return parseAnalyzeTimingHeader(header);
}

export function parseAnalyzeTimingHeader(header) {
  return parseTimingHeader({
    header,
    phases: ANALYZE_TIMING_PHASES,
    pattern: ANALYZE_TIMING_PATTERN,
    malformedMessage: "Analyze timing header was malformed.",
    duplicateMessage: "Analyze timing header contained duplicate phases.",
    missingMessage: "Analyze timing header was missing a required phase."
  });
}

export function githubEvidenceTimingFromResponse(response) {
  const header = response.headers.get("x-agentproof-evidence-timing");
  if (!header) {
    throw smokeError("Analyze response did not include GitHub evidence timing.");
  }

  return parseGitHubEvidenceTimingHeader(header);
}

export function parseGitHubEvidenceTimingHeader(header) {
  return parseTimingHeader({
    header,
    phases: GITHUB_EVIDENCE_TIMING_PHASES,
    pattern: GITHUB_EVIDENCE_TIMING_PATTERN,
    malformedMessage: "GitHub evidence timing header was malformed.",
    duplicateMessage: "GitHub evidence timing header contained duplicate phases.",
    missingMessage: "GitHub evidence timing header was missing a required phase.",
    allowMissingPhases: true
  });
}

function parseTimingHeader({
  header,
  phases,
  pattern,
  malformedMessage,
  duplicateMessage,
  missingMessage,
  allowMissingPhases = false
}) {
  const timing = {};
  const entries = String(header)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0 || entries.length > phases.length || (!allowMissingPhases && entries.length !== phases.length)) {
    throw smokeError(malformedMessage);
  }

  for (const entry of entries) {
    const match = entry.match(pattern);
    if (!match) {
      throw smokeError(malformedMessage);
    }

    const [, phase, value] = match;
    if (Object.prototype.hasOwnProperty.call(timing, phase)) {
      throw smokeError(duplicateMessage);
    }

    timing[phase] = Number(value);
  }

  for (const phase of Object.keys(timing)) {
    if (!Number.isSafeInteger(timing[phase]) || timing[phase] < 0) {
      throw smokeError(missingMessage);
    }
  }

  if (!allowMissingPhases) {
    for (const phase of phases) {
      if (!Number.isSafeInteger(timing[phase]) || timing[phase] < 0) {
        throw smokeError(missingMessage);
      }
    }
  }

  return timing;
}

export function passingExecutionEvidence(report) {
  return Array.isArray(report.evidenceIndex)
    ? report.evidenceIndex.filter((item) =>
      (item.kind === "check" || item.kind === "log") &&
        isExecutionSignal(item.label, item.summary, item.locator) &&
        hasPassingEvidenceStatusPrefix(item.summary)
    )
    : [];
}

const STRONG_EXECUTION_EVIDENCE_PATTERN =
  /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|pytest|coverage)\b/i;
const WEAK_EXECUTION_EVIDENCE_PATTERN = /\b(ci|build)\b/i;
const NON_EXECUTION_GATE_PATTERN =
  /\b(policy|policies|provenance|attestation|security|scan|sast|secret|secrets|dependency|dependencies|license|licenses|code owners?|owners|review|report|preview|deploy|deployment|merge[- ]?gate|required checks?)\b/i;
const DIRECT_EXECUTION_COMMAND_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build|typecheck|lint)\b|\b(?:vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|tsc|next\s+build)\b/i;

function isExecutionSignalText(text) {
  if (NON_EXECUTION_GATE_PATTERN.test(text) && !DIRECT_EXECUTION_COMMAND_PATTERN.test(text)) {
    return false;
  }

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(text)) {
    return true;
  }

  return WEAK_EXECUTION_EVIDENCE_PATTERN.test(text) && !NON_EXECUTION_GATE_PATTERN.test(text);
}

function isExecutionSignal(label, text = "", locator = "") {
  const labelText = String(label ?? "").trim();

  if (NON_EXECUTION_GATE_PATTERN.test(labelText)) {
    return false;
  }

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(labelText) || DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText)) {
    return true;
  }

  const supportingText = String(text ?? "").trim();
  if (supportingText && NON_EXECUTION_GATE_PATTERN.test(supportingText)) {
    return false;
  }

  return isExecutionSignalText(`${labelText} ${supportingText}`);
}

function hasPassingEvidenceStatusPrefix(summary) {
  return /^Status:\s*passed\b/i.test(String(summary ?? "").trim());
}

export function failedCheckAnnotationLocations(report) {
  if (!Array.isArray(report?.evidenceIndex)) {
    return [];
  }

  const locations = report.evidenceIndex.flatMap((item) => annotationLocationsFromSummary(item?.summary));

  return Array.from(new Set(locations));
}

function annotationLocationsFromSummary(summary) {
  const value = String(summary ?? "");
  const markerIndex = value.indexOf("Check annotations:");
  if (markerIndex < 0) {
    return [];
  }

  const rawSegment = value
    .slice(markerIndex + "Check annotations:".length)
    .split(/\. Raw annotation messages/i)[0];

  return rawSegment
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.match(/^(notice|warning|failure|annotation)\s+at\s+(.+)$/i))
    .filter(Boolean)
    .map((match) => match[2]?.trim())
    .filter((location) => typeof location === "string" && location.length > 0);
}

export function assertReportExpectations(report, expectations = {}) {
  const checks = [];

  if (!expectations || typeof expectations !== "object") {
    return { checks };
  }

  if (expectations.ciStatus && report.testing?.ciStatus !== expectations.ciStatus) {
    throw smokeError(`Expected ciStatus ${expectations.ciStatus}, received ${report.testing?.ciStatus ?? "unknown"}.`);
  }
  if (expectations.ciStatus) {
    checks.push({ name: "ciStatus", expected: expectations.ciStatus });
  }

  if (Array.isArray(expectations.priorityIn) && !expectations.priorityIn.includes(report.summary?.priority)) {
    throw smokeError(`Expected priority in ${expectations.priorityIn.join(", ")}, received ${report.summary?.priority ?? "unknown"}.`);
  }
  if (Array.isArray(expectations.priorityIn)) {
    checks.push({ name: "priorityIn", expected: expectations.priorityIn.join("|") });
  }

  if (typeof expectations.analysisContext === "string" && report.analysisContext !== expectations.analysisContext) {
    throw smokeError(`Expected analysisContext ${expectations.analysisContext}, received ${report.analysisContext ?? "unknown"}.`);
  }
  if (typeof expectations.analysisContext === "string") {
    checks.push({ name: "analysisContext", expected: expectations.analysisContext });
  }

  const requirementCount = Array.isArray(report.requirements) ? report.requirements.length : 0;
  if (typeof expectations.minRequirementCount === "number" && requirementCount < expectations.minRequirementCount) {
    throw smokeError(`Expected at least ${expectations.minRequirementCount} requirements, received ${requirementCount}.`);
  }
  if (typeof expectations.minRequirementCount === "number") {
    checks.push({ name: "minRequirementCount", expected: expectations.minRequirementCount });
  }

  const evidenceCount = Array.isArray(report.evidenceIndex) ? report.evidenceIndex.length : 0;
  if (typeof expectations.minEvidenceCount === "number" && evidenceCount < expectations.minEvidenceCount) {
    throw smokeError(`Expected at least ${expectations.minEvidenceCount} evidence items, received ${evidenceCount}.`);
  }
  if (typeof expectations.minEvidenceCount === "number") {
    checks.push({ name: "minEvidenceCount", expected: expectations.minEvidenceCount });
  }

  if (expectations.requireVisualUnverified === true) {
    assertVisualRequirementsStayUnverifiedWithoutVisualEvidence(report);
    checks.push({ name: "visualRequirementsUnverifiedWithoutVisualEvidence", expected: true });
  }

  return { checks };
}

export function evaluateReportQualityGate(report, {
  savedReport,
  requireRequirementFindings = true
} = {}) {
  const checks = [
    requirementsPresentQualityCheck(report, requireRequirementFindings),
    metRequirementExecutionQualityCheck(report),
    ciExecutionQualityCheck(report),
    reviewerLeadProvenanceQualityCheck(report),
    humanDecisionSupportQualityCheck(report),
    summaryOnlyPrivacyQualityCheck(savedReport)
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

function requirementsPresentQualityCheck(report, requireRequirementFindings) {
  const count = Array.isArray(report.requirements) ? report.requirements.length : 0;

  return qualityCheck({
    id: "requirements_present",
    label: "Requirement extraction present",
    ok: !requireRequirementFindings || count > 0,
    detail: !requireRequirementFindings
      ? "No acceptance contract is required for this evaluation; zero requirement findings are allowed."
      : count > 0
      ? `${count} requirement finding(s) are available for reviewer coverage checks.`
      : "No requirement findings were available for reviewer coverage checks."
  });
}

function metRequirementExecutionQualityCheck(report) {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  const unsupportedMetCount = requirements.filter((requirement) =>
    requirement?.status === "met" && !requirementHasPassingExecutionRef(report, requirement.evidenceRefs)
  ).length;

  return qualityCheck({
    id: "met_requirement_execution",
    label: "Met requirements cite passing execution evidence",
    ok: unsupportedMetCount === 0,
    detail: unsupportedMetCount === 0
      ? "Every met requirement cites passing check or log evidence."
      : `${unsupportedMetCount} met requirement(s) lack passing check or log evidence.`
  });
}

function ciExecutionQualityCheck(report) {
  const ciStatus = report.testing?.ciStatus ?? "unknown";
  const passingEvidenceCount = passingExecutionEvidence(report).length;

  return qualityCheck({
    id: "ci_execution_proof",
    label: "Passed CI is backed by execution evidence",
    ok: ciStatus !== "passed" || passingEvidenceCount > 0,
    detail: ciStatus === "passed"
      ? `${passingEvidenceCount} passing execution evidence item(s) support passed CI.`
      : `CI status is ${ciStatus}; passing execution proof is not required for this check.`
  });
}

function reviewerLeadProvenanceQualityCheck(report) {
  const missingTests = Array.isArray(report.testing?.missingTests) ? report.testing.missingTests : [];
  const reviewPriority = Array.isArray(report.reviewPriority) ? report.reviewPriority : [];
  const missingTestsWithoutRefs = missingTests.filter((item) =>
    !hasNonEmptyStringArray(item?.evidenceRefs) || !hasFindingProvenance(item?.provenance)
  ).length;
  const reviewPriorityWithoutRefs = reviewPriority.filter((item) => !hasNonEmptyStringArray(item?.evidenceRefs)).length;
  const scopeMissingRefs = report.scope?.suspected === true &&
    (!hasNonEmptyStringArray(report.scope?.evidenceRefs) || !hasFindingProvenance(report.scope?.provenance));
  const issueCount = missingTestsWithoutRefs + reviewPriorityWithoutRefs + (scopeMissingRefs ? 1 : 0);

  return qualityCheck({
    id: "reviewer_lead_provenance",
    label: "Reviewer leads include provenance",
    ok: issueCount === 0,
    detail: issueCount === 0
      ? "Missing-test, scope, and review-priority leads include evidence references when present."
      : `${issueCount} reviewer lead group(s) lack evidence references.`
  });
}

function humanDecisionSupportQualityCheck(report) {
  const serialized = JSON.stringify(reportAuthoredDecisionText(report));
  const hasMergeDecision = /\b(?:approved|safe|ready|cleared|okay|ok)\s+(?:to\s+)?merge\b|\bmerge\s+(?:approved|safe|ready|cleared)\b|\bauto[-\s]?merge\s+(?:approved|enabled|safe|ready)\b/i.test(serialized);

  return qualityCheck({
    id: "human_decision_support",
    label: "Report does not make merge decisions",
    ok: !hasMergeDecision,
    detail: hasMergeDecision
      ? "Report contains merge-decision wording; AgentProof should provide evidence for a human decision."
      : "Report stays in evidence handoff language rather than merge-decision language."
  });
}

function summaryOnlyPrivacyQualityCheck(savedReport) {
  try {
    assertSummaryOnlyReport(savedReport);
  } catch {
    return qualityCheck({
      id: "summary_only_privacy",
      label: "Saved report remains summary-only",
      ok: false,
      detail: "Saved report retained full-report material or evidence references."
    });
  }

  return qualityCheck({
    id: "summary_only_privacy",
    label: "Saved report remains summary-only",
    ok: true,
    detail: "Saved report omits raw evidence, claims, raw re-prompt text, and evidence references."
  });
}

function reportAuthoredDecisionText(report) {
  const summary = report?.summary ?? {};
  const requirements = Array.isArray(report?.requirements) ? report.requirements : [];
  const missingTests = Array.isArray(report?.testing?.missingTests) ? report.testing.missingTests : [];
  const scope = report?.scope ?? {};
  const reviewPriority = Array.isArray(report?.reviewPriority) ? report.reviewPriority : [];

  return {
    summary: {
      oneLine: summary.oneLine,
      topRisks: summary.topRisks
    },
    requirementGuidance: requirements.map((requirement) => ({
      gaps: requirement?.gaps,
      reviewerNote: requirement?.reviewerNote
    })),
    scopeReasons: scope.reasons,
    missingTestReasons: missingTests.map((item) => item?.why),
    reviewPriority: reviewPriority.map((item) => item?.reason),
    reprompt: report?.reprompt?.prompt,
    limitations: report?.limitations
  };
}

function qualityCheck({ id, label, ok, detail }) {
  return { id, label, ok, detail };
}

function requirementHasPassingExecutionRef(report, evidenceRefs) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 || !Array.isArray(report.evidenceIndex)) {
    return false;
  }

  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));

  return evidenceRefs.some((ref) => {
    const item = evidenceById.get(ref);

    return Boolean(item) &&
      (item.kind === "check" || item.kind === "log") &&
      isExecutionSignal(item.label, item.summary, item.locator) &&
      hasPassingEvidenceStatusPrefix(item.summary);
  });
}

function hasNonEmptyStringArray(value) {
  return Array.isArray(value) && value.some((item) => typeof item === "string" && item.length > 0);
}

function hasFindingProvenance(value) {
  return Array.isArray(value) && value.some((item) =>
    item &&
    typeof item === "object" &&
    typeof item.evidenceRef === "string" &&
    item.evidenceRef.length > 0 &&
    typeof item.evidenceText === "string" &&
    item.evidenceText.length > 0
  );
}

function assertVisualRequirementsStayUnverifiedWithoutVisualEvidence(report) {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  const visualRequirements = requirements.filter((requirement) =>
    /\b(visual|mobile|layout|overlap|readable|readability|responsive|viewport|browser|screenshot|ux)\b/i.test(requirement.requirementText ?? "")
  );

  if (visualRequirements.length === 0) {
    throw smokeError("Expected at least one visual/mobile requirement, received none.");
  }

  if (hasVisualQaEvidence(report)) {
    return;
  }

  const incorrectlyMet = visualRequirements.filter((requirement) => requirement.status === "met");
  if (incorrectlyMet.length > 0) {
    throw smokeError("Visual/mobile requirements were marked met without browser, screenshot, or visual QA evidence.");
  }
}

function hasVisualQaEvidence(report) {
  return Array.isArray(report.evidenceIndex) && report.evidenceIndex.some((item) =>
    /\b(playwright|cypress|browser qa|screenshot|viewport|visual regression|mobile screenshot)\b/i.test(`${item.label ?? ""} ${item.summary ?? ""}`)
  );
}

function assertGithubTokenBoundary({ baseUrl, githubToken, allowProductionGithubToken }) {
  if (!githubToken || allowProductionGithubToken || !isRemoteProductionLikeBaseUrl(baseUrl)) {
    return;
  }

  throw smokeError(
    "Forwarding a GitHub token to a remote AgentProof base URL requires AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN=1."
  );
}

function isRemoteProductionLikeBaseUrl(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;

    return !(
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".example") ||
      hostname.endsWith(".test") ||
      hostname.endsWith(".invalid")
    );
  } catch {
    return false;
  }
}

export function assertSummaryOnlyReport(report, options = {}) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw smokeError("Saved report payload was not an object.");
  }

  if (!Array.isArray(report.evidenceIndex) || report.evidenceIndex.length !== 0) {
    throw smokeError("Saved report retained raw evidenceIndex items.");
  }

  if (!Array.isArray(report.claims) || report.claims.length !== 0) {
    throw smokeError("Saved report retained agent claims.");
  }

  if (!/omit|shared summary|summary/i.test(report.reprompt?.prompt ?? "")) {
    throw smokeError("Saved report retained raw re-prompt text.");
  }

  if (!evidenceRefsCleared(report)) {
    throw smokeError("Saved report retained evidenceRefs.");
  }

  if (report.generalPrAssessmentSummary !== undefined && !isValidGeneralPrAssessmentSummary(report.generalPrAssessmentSummary)) {
    throw smokeError("Saved report retained private general PR assessment data.");
  }

  if (!Array.isArray(report.limitations) || !report.limitations.some((item) => /omits raw evidence, patch\/log excerpts, claims,(?: proof-graph evidence refs,)? and re-prompt text/i.test(item))) {
    throw smokeError("Saved report did not include the summary-only omission limitation.");
  }

  const serialized = JSON.stringify(report);
  const forbiddenPatterns = [
    /Patch excerpt/i,
    /raw_details/i,
    /github_pat_[A-Za-z0-9_]+/,
    /\bgh[opsur]_[A-Za-z0-9_]+/,
    /\bsk-[A-Za-z0-9_-]+/,
    /hooks\.slack\.com\/services\//i,
    /\bBearer\s+[A-Za-z0-9._-]+/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  ];

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(serialized)) {
      throw smokeError("Saved report retained raw evidence or secret-like content.");
    }
  }

  const forbiddenValues = [
    options.originalReprompt,
    options.githubToken
  ].filter((value) => typeof value === "string" && value.length > 0);

  for (const value of forbiddenValues) {
    if (serialized.includes(value)) {
      throw smokeError("Saved report retained raw re-prompt or token value.");
    }
  }

  for (const location of options.failedCheckLocations ?? []) {
    if (serialized.includes(location)) {
      throw smokeError("Saved report retained failed check annotation location.");
    }
  }
}

async function saveSummaryOnlyReport({ baseUrl, report, fetchImpl }) {
  const saveResponse = await fetchImpl(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ report })
  });
  const savePayload = await saveResponse.json().catch(() => ({}));

  if (!saveResponse.headers.get("cache-control")?.includes("no-store")) {
    throw smokeError("Saved-report response was not marked no-store.", saveResponse.status);
  }

  if (
    !saveResponse.ok ||
    savePayload.privacy !== "summary-only" ||
    !ALLOWED_SAVED_REPORT_DURABILITY.has(savePayload.durability) ||
    typeof savePayload.durabilityWarning !== "string" ||
    typeof savePayload.id !== "string" ||
    typeof savePayload.expiresAt !== "string" ||
    typeof savePayload.url !== "string" ||
    !savePayload.url.includes(`/reports/${savePayload.id}`)
  ) {
    throw smokeError(
      typeof savePayload.error === "string" ? savePayload.error : "Saved-report smoke failed.",
      saveResponse.status
    );
  }

  const getResponse = await fetchImpl(`${baseUrl}/api/reports/${savePayload.id}`);
  const getPayload = await getResponse.json().catch(() => ({}));

  if (!getResponse.headers.get("cache-control")?.includes("no-store")) {
    throw smokeError("Saved-report round-trip response was not marked no-store.", getResponse.status);
  }

  if (
    !getResponse.ok ||
    getPayload.privacy !== "summary-only" ||
    !ALLOWED_SAVED_REPORT_DURABILITY.has(getPayload.durability) ||
    typeof getPayload.durabilityWarning !== "string" ||
    !getPayload.report
  ) {
    throw smokeError(
      typeof getPayload.error === "string" ? getPayload.error : "Saved-report round-trip failed.",
      getResponse.status
    );
  }

  let deleted = false;
  try {
    const deleteResponse = await fetchImpl(`${baseUrl}/api/reports/${savePayload.id}`, { method: "DELETE" });
    const deletePayload = await deleteResponse.json().catch(() => ({}));
    deleted = deleteResponse.ok && deletePayload.deleted === true;
  } catch {
    deleted = false;
  }

  return {
    privacy: getPayload.privacy,
    durability: getPayload.durability,
    durabilityWarning: getPayload.durabilityWarning,
    savedReport: getPayload.report,
    deleted,
    deleteWarning: deleted
      ? undefined
      : "Saved-report cleanup was best-effort and did not confirm deletion; short-lived in-memory reports may already be on another serverless instance."
  };
}

function evidenceRefsCleared(report) {
  const requirementsClear = Array.isArray(report.requirements) &&
    report.requirements.every((requirement) => Array.isArray(requirement.evidenceRefs) && requirement.evidenceRefs.length === 0);
  const missingTestsClear = Array.isArray(report.testing?.missingTests) &&
    report.testing.missingTests.every((missingTest) => Array.isArray(missingTest.evidenceRefs) && missingTest.evidenceRefs.length === 0);
  const reviewPriorityClear = Array.isArray(report.reviewPriority) &&
    report.reviewPriority.every((item) => !("evidenceRefs" in item));

  return requirementsClear && missingTestsClear && reviewPriorityClear;
}

function smokeError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.slice(2).includes("--help")) {
    console.log("Usage: pnpm smoke:analyze-pr\n\nThis command accepts no CLI flags. Configure AGENTPROOF_SMOKE_BASE_URL, AGENTPROOF_SMOKE_PR_URL, optional AGENTPROOF_SMOKE_TASK_TEXT, and optional approved GitHub-token environment handling.");
  } else {
  runAnalyzePrSmoke({ baseUrl, prUrl, taskText, githubToken, allowProductionGithubToken })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        status: typeof error.status === "number" ? error.status : undefined,
        error: error instanceof Error ? error.message : "Analyze smoke failed."
      }));
      process.exit(1);
    });
  }
}
