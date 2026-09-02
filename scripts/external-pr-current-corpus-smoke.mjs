import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  isValidGeneralPrAssessmentSummary,
  runAnalyzePrSmoke
} from "./smoke-analyze-pr-url.mjs";
import {
  summarizeAnalyzeTimings,
  summarizeGitHubEvidenceTimings,
  summarizeQualityGates
} from "./smoke-real-pr-evaluation.mjs";

const ROOT = process.cwd();
const DEFAULT_SNAPSHOT_PATH = join(ROOT, "eval/generated/external-pr-live-corpus.v1.json");
const DEFAULT_OUTPUT_PATH = join(ROOT, "eval/generated/external-pr-current-corpus-run.v1.json");
const DEFAULT_BASE_URL = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const DEFAULT_MAX_SNAPSHOT_AGE_MS = 30 * 60 * 1000;
const SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const GENERAL_PR_SOURCE_STATES = new Set(["linked_issue", "pr_author_claim", "mixed", "missing", "ambiguous"]);
const GENERAL_PR_CONCLUSIONS = new Set([
  "evidence_supports_stated_change",
  "evidence_partial",
  "mixed_evidence",
  "attention_required",
  "collection_blocked",
  "no_assessable_claims"
]);
const GENERAL_PR_REASON_CODES = new Set([
  "implementation_evidence_observed", "test_artifact_observed", "exact_execution_passed", "exact_execution_failed",
  "verified_relation_missing", "execution_not_observed", "claimed_artifact_not_observed", "unsupported_claim_type",
  "source_missing", "source_ambiguous", "source_unavailable", "collection_incomplete", "head_mismatch",
  "evidence_identity_incomplete", "semantic_relation_only", "author_claim_requires_confirmation",
  "deterministic_candidate_missing", "semantic_observer_disabled", "semantic_observer_ineligible",
  "semantic_observer_unavailable", "semantic_observer_timeout", "semantic_proposal_invalid",
  "semantic_candidate_missing", "semantic_candidate_rejected", "target_relation_unresolved"
]);
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
const QUALITY_GATE_LABELS = new Map([
  ["requirements_present", "Requirement extraction present"],
  ["met_requirement_execution", "Met requirements cite passing execution evidence"],
  ["ci_execution_proof", "Passed CI is backed by execution evidence"],
  ["reviewer_lead_provenance", "Reviewer leads include provenance"],
  ["human_decision_support", "Report does not make merge decisions"],
  ["summary_only_privacy", "Saved report remains summary-only"]
]);

export async function runCurrentExternalPrCorpusSmoke({
  snapshot,
  baseUrl = DEFAULT_BASE_URL,
  githubToken,
  allowProductionGithubToken = false,
  now = new Date().toISOString(),
  maxSnapshotAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS,
  runAnalyze = runAnalyzePrSmoke
}) {
  validateReadySnapshot(snapshot, { now, maxSnapshotAgeMs });
  const results = [];

  for (const testCase of snapshot.cases) {
    try {
      const result = await runAnalyze({
        baseUrl,
        prUrl: testCase.prUrl,
        githubToken,
        allowProductionGithubToken,
        requireRequirementFindings: false,
        requireGeneralPrAssessmentSummary: true,
        expectedSourceAnchor: testCase.anchor
      });
      results.push(completedResult(testCase, result));
    } catch (error) {
      results.push(incompleteResult(testCase, error));
    }
  }

  const completedCount = results.filter((item) => item.analysisStatus === "completed").length;
  const incompleteCount = results.length - completedCount;
  const run = {
    version: 1,
    privacy: "external-pr-current-corpus-run-summary-only",
    status: incompleteCount === 0 ? "completed" : "incomplete",
    observedAt: new Date(now).toISOString(),
    sourceSnapshotFingerprint: snapshot.corpusFingerprint,
    caseCount: results.length,
    completedCount,
    incompleteCount,
    requirementStatusSummary: summarizeRequirementStatusCounts(results, "requirementStatusCounts"),
    requirementEvidenceStatusSummary: summarizeRequirementStatusCounts(results, "requirementEvidenceStatusCounts"),
    generalPrAssessmentSummary: summarizeGeneralPrAssessments(results),
    qualityGateSummary: summarizeQualityGates(results.filter((item) => item.analysisStatus === "completed")),
    timingSummary: summarizeAnalyzeTimings(results.filter((item) => item.analysisStatus === "completed")),
    githubEvidenceTimingSummary: summarizeGitHubEvidenceTimings(results.filter((item) => item.analysisStatus === "completed")),
    results: results.map(runArtifactResult)
  };
  assertAggregateOnlyRunArtifact(run);
  return run;
}

/**
 * Runs the same frozen corpus while retaining only operator-authenticated
 * semantic boundary totals outside the public summary-only artifact.
 */
export async function runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({
  operatorDiagnosticsToken,
  runAnalyze = runAnalyzePrSmoke,
  ...options
}) {
  if (typeof operatorDiagnosticsToken !== "string" || operatorDiagnosticsToken.length === 0) {
    throw new Error("Operator diagnostics token is required.");
  }

  const diagnostics = [];
  const publicRun = await runCurrentExternalPrCorpusSmoke({
    ...options,
    runAnalyze: async (input) => {
      const result = await runAnalyze({ ...input, operatorDiagnosticsToken });
      if (!isValidOperatorSemanticDiagnostics(result.operatorSemanticDiagnostics)) {
        throw new Error("Operator staged diagnostic was unavailable.");
      }
      diagnostics.push(result.operatorSemanticDiagnostics);
      return result;
    }
  });

  return {
    publicRun,
    operatorDiagnostic: summarizeOperatorSemanticDiagnostics(diagnostics, publicRun.caseCount)
  };
}

export function writeCurrentExternalPrCorpusRun(result, outputPath = DEFAULT_OUTPUT_PATH) {
  assertAggregateOnlyRunArtifact(result);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

function completedResult(testCase, result) {
  if (!isValidGeneralPrAssessmentSummary(result.generalPrAssessmentSummary)) {
    throw new Error("General PR assessment summary was unavailable.");
  }

  return {
    id: testCase.id,
    cohort: testCase.cohort,
    prUrl: testCase.prUrl,
    anchorFingerprint: testCase.anchorFingerprint,
    analysisStatus: "completed",
    priority: result.priority,
    confidence: result.confidence,
    evidenceCoverage: result.evidenceCoverage,
    ciStatus: result.ciStatus,
    requirementCount: result.requirementCount,
    requirementStatusCounts: result.requirementStatusCounts,
    requirementEvidenceStatusCounts: result.requirementEvidenceStatusCounts,
    evidenceCount: result.evidenceCount,
    limitationCount: result.limitationCount,
    generalPrAssessmentSummary: result.generalPrAssessmentSummary,
    analyzeTiming: result.analyzeTiming,
    githubEvidenceTiming: result.githubEvidenceTiming,
    qualityGate: result.qualityGate,
    savedReportPrivacy: result.savedReportPrivacy,
    savedReportDeleted: result.savedReportDeleted
  };
}

function isValidOperatorSemanticDiagnostics(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 8 && OPERATOR_STAGE_STATES.has(value.claimState) && OPERATOR_STAGE_STATES.has(value.evidenceState) &&
    (value.sourceCoverage === null || OPERATOR_COVERAGE_STATES.has(value.sourceCoverage)) &&
    (value.evidenceCoverage === null || OPERATOR_COVERAGE_STATES.has(value.evidenceCoverage)) &&
    [0, 1, 2, "3_plus"].includes(value.providerCallCount) &&
    value.selectedCountBuckets && typeof value.selectedCountBuckets === "object" && !Array.isArray(value.selectedCountBuckets) &&
    Object.keys(value.selectedCountBuckets).length === 2 && OPERATOR_SOURCE_BUCKETS.has(value.selectedCountBuckets.sourceSpans) &&
    OPERATOR_EVIDENCE_BUCKETS.has(value.selectedCountBuckets.evidenceCandidates) &&
    Array.isArray(value.semanticPackageFailureReasons) &&
    new Set(value.semanticPackageFailureReasons).size === value.semanticPackageFailureReasons.length &&
    value.semanticPackageFailureReasons.every((reason) => OPERATOR_PACKAGE_FAILURE_REASONS.has(reason)) &&
    value.omittedReasonCounts && typeof value.omittedReasonCounts === "object" && !Array.isArray(value.omittedReasonCounts) &&
    Object.keys(value.omittedReasonCounts).length === OPERATOR_OMISSION_KEYS.length &&
    OPERATOR_OMISSION_KEYS.every((key) => Number.isSafeInteger(value.omittedReasonCounts[key]) && value.omittedReasonCounts[key] >= 0);
}

function summarizeOperatorSemanticDiagnostics(diagnostics, caseCount) {
  const claimStageStateCounts = {};
  const evidenceStageStateCounts = {};
  const sourceCoverageCounts = {};
  const evidenceCoverageCounts = {};
  const providerCallCountCounts = {};
  const selectedCountBucketCounts = { sourceSpans: {}, evidenceCandidates: {} };
  const semanticPackageFailureReasonCounts = {};
  const omissionReasonCounts = Object.fromEntries(OPERATOR_OMISSION_KEYS.map((key) => [key, 0]));
  let packageReadyCount = 0;

  for (const diagnostic of diagnostics) {
    incrementCount(claimStageStateCounts, diagnostic.claimState);
    incrementCount(evidenceStageStateCounts, diagnostic.evidenceState);
    if (diagnostic.sourceCoverage !== null) incrementCount(sourceCoverageCounts, diagnostic.sourceCoverage);
    if (diagnostic.evidenceCoverage !== null) incrementCount(evidenceCoverageCounts, diagnostic.evidenceCoverage);
    incrementCount(providerCallCountCounts, String(diagnostic.providerCallCount));
    incrementCount(selectedCountBucketCounts.sourceSpans, diagnostic.selectedCountBuckets.sourceSpans);
    incrementCount(selectedCountBucketCounts.evidenceCandidates, diagnostic.selectedCountBuckets.evidenceCandidates);
    for (const reason of diagnostic.semanticPackageFailureReasons) incrementCount(semanticPackageFailureReasonCounts, reason);
    for (const key of OPERATOR_OMISSION_KEYS) omissionReasonCounts[key] += diagnostic.omittedReasonCounts[key];
    if (diagnostic.claimState === "valid" && ["valid", "not_run"].includes(diagnostic.evidenceState)) packageReadyCount += 1;
  }

  return {
    version: 1,
    privacy: "operator-only-aggregate",
    caseCount,
    claimStageStateCounts,
    evidenceStageStateCounts,
    sourceCoverageCounts,
    evidenceCoverageCounts,
    providerCallCountCounts,
    selectedCountBucketCounts,
    packageReadyCount,
    semanticPackageFailureReasonCounts,
    omissionReasonCounts
  };
}

function summarizeGeneralPrAssessments(results) {
  const overallConclusionCounts = {};
  const sourceStateCounts = {};
  const reasonCodeCounts = {};
  const assessmentCountTotals = Object.fromEntries(GENERAL_PR_ASSESSMENT_COUNT_KEYS.map((key) => [key, 0]));
  let presentCount = 0;

  for (const result of results) {
    if (result.analysisStatus !== "completed") continue;
    const summary = result.generalPrAssessmentSummary;
    if (!isValidGeneralPrAssessmentSummary(summary)) continue;

    presentCount += 1;
    incrementCount(overallConclusionCounts, summary.overallConclusion);
    incrementCount(sourceStateCounts, summary.sourceState);
    for (const reasonCode of summary.reasonCodes) incrementCount(reasonCodeCounts, reasonCode);
    for (const key of GENERAL_PR_ASSESSMENT_COUNT_KEYS) assessmentCountTotals[key] += summary.counts[key];
  }

  return { presentCount, overallConclusionCounts, sourceStateCounts, reasonCodeCounts, assessmentCountTotals };
}

const GENERAL_PR_ASSESSMENT_COUNT_KEYS = [
  "evidence_supported",
  "evidence_partial",
  "not_demonstrated",
  "contradicted",
  "blocked",
  "not_assessable"
];

function incrementCount(counts, value) {
  if (typeof value === "string" && value.length > 0) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
}

function summarizeRequirementStatusCounts(results, field) {
  const counts = {};
  for (const result of results) {
    if (result.analysisStatus !== "completed") continue;
    for (const [status, count] of Object.entries(result[field] ?? {})) {
      if (["met", "partial", "missing", "unclear"].includes(status) && Number.isSafeInteger(count) && count > 0) {
        counts[status] = (counts[status] ?? 0) + count;
      }
    }
  }
  return counts;
}

function incompleteResult(testCase, error) {
  return {
    id: testCase.id,
    cohort: testCase.cohort,
    prUrl: testCase.prUrl,
    anchorFingerprint: testCase.anchorFingerprint,
    analysisStatus: "incomplete",
    failureKind: error instanceof Error && /frozen external PR sample/i.test(error.message)
      ? "source_drift"
      : error && typeof error === "object" && typeof error.status === "number" && error.status >= 500
        ? "unexpected_server_error"
        : "analysis_unavailable"
  };
}

function runArtifactResult(result, index) {
  return result.analysisStatus === "completed"
    ? { id: opaqueCaseId(index), analysisStatus: "completed" }
    : { id: opaqueCaseId(index), analysisStatus: "incomplete", failureKind: result.failureKind };
}

function opaqueCaseId(index) {
  return `case_${String(index + 1).padStart(2, "0")}`;
}

export function assertAggregateOnlyRunArtifact(value) {
  const fail = () => { throw new Error("Current external PR run artifact was invalid."); };
  const exactObject = (node, keys) => {
    if (!node || typeof node !== "object" || Array.isArray(node) ||
      Object.keys(node).length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(node, key))) fail();
  };
  const nonNegativeInteger = (node) => Number.isSafeInteger(node) && node >= 0;
  const countRecord = (node, allowed) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) fail();
    for (const [key, count] of Object.entries(node)) {
      if (!allowed.has(key) || !nonNegativeInteger(count)) fail();
    }
  };
  const timingSummary = (node, metric, phases) => {
    exactObject(node, ["metric", "unit", "method", "phases"]);
    if (node.metric !== metric || node.unit !== "ms" || node.method !== "nearest-rank") fail();
    exactObject(node.phases, phases);
    for (const phase of phases) {
      const stats = node.phases[phase];
      exactObject(stats, ["count", "missingCount", "p50", "p95", "max"]);
      if (!nonNegativeInteger(stats.count) || !nonNegativeInteger(stats.missingCount) ||
        ![stats.p50, stats.p95, stats.max].every((stat) => stat === null || nonNegativeInteger(stat))) fail();
    }
  };

  exactObject(value, [
    "version", "privacy", "status", "observedAt", "sourceSnapshotFingerprint", "caseCount", "completedCount",
    "incompleteCount", "requirementStatusSummary", "requirementEvidenceStatusSummary", "generalPrAssessmentSummary",
    "qualityGateSummary", "timingSummary", "githubEvidenceTimingSummary", "results"
  ]);
  if (value.version !== 1 || value.privacy !== "external-pr-current-corpus-run-summary-only" ||
    !["completed", "incomplete"].includes(value.status) || !Number.isFinite(Date.parse(value.observedAt)) ||
    !/^[a-f0-9]{64}$/.test(value.sourceSnapshotFingerprint) || !Array.isArray(value.results) ||
    ![value.caseCount, value.completedCount, value.incompleteCount].every(nonNegativeInteger) ||
    value.caseCount !== value.results.length || value.caseCount !== value.completedCount + value.incompleteCount) fail();

  countRecord(value.requirementStatusSummary, REQUIREMENT_STATUSES);
  countRecord(value.requirementEvidenceStatusSummary, REQUIREMENT_STATUSES);
  exactObject(value.generalPrAssessmentSummary, ["presentCount", "overallConclusionCounts", "sourceStateCounts", "reasonCodeCounts", "assessmentCountTotals"]);
  if (!nonNegativeInteger(value.generalPrAssessmentSummary.presentCount) || value.generalPrAssessmentSummary.presentCount > value.completedCount) fail();
  countRecord(value.generalPrAssessmentSummary.overallConclusionCounts, GENERAL_PR_CONCLUSIONS);
  countRecord(value.generalPrAssessmentSummary.sourceStateCounts, GENERAL_PR_SOURCE_STATES);
  countRecord(value.generalPrAssessmentSummary.reasonCodeCounts, GENERAL_PR_REASON_CODES);
  exactObject(value.generalPrAssessmentSummary.assessmentCountTotals, GENERAL_PR_ASSESSMENT_COUNT_KEYS);
  for (const count of Object.values(value.generalPrAssessmentSummary.assessmentCountTotals)) {
    if (!nonNegativeInteger(count)) fail();
  }

  exactObject(value.qualityGateSummary, ["ok", "checks"]);
  if (typeof value.qualityGateSummary.ok !== "boolean" || !Array.isArray(value.qualityGateSummary.checks)) fail();
  for (const check of value.qualityGateSummary.checks) {
    exactObject(check, ["id", "label", "count", "failedCount"]);
    if (QUALITY_GATE_LABELS.get(check.id) !== check.label ||
      !nonNegativeInteger(check.count) || !nonNegativeInteger(check.failedCount) || check.failedCount > check.count) fail();
  }

  timingSummary(value.timingSummary, "X-AgentProof-Timing", ["input", "evidence", "report", "validation", "total"]);
  timingSummary(value.githubEvidenceTimingSummary, "X-AgentProof-Evidence-Timing", [
    "github_pr", "github_files", "github_checks", "github_statuses", "github_annotations", "github_jobs"
  ]);
  for (const [index, result] of value.results.entries()) {
    if (result?.analysisStatus === "completed") {
      exactObject(result, ["id", "analysisStatus"]);
    } else if (result?.analysisStatus === "incomplete") {
      exactObject(result, ["id", "analysisStatus", "failureKind"]);
      if (!["source_drift", "analysis_unavailable", "unexpected_server_error"].includes(result.failureKind)) fail();
    } else {
      fail();
    }
    if (result.id !== opaqueCaseId(index)) fail();
  }
}

/**
 * Release-only guard for aggregate packaging health. It is not an accuracy
 * benchmark: unclear reports remain legal and labelled calibration is still required.
 */
export function assertCurrentExternalPrSemanticBoundaryHealth({ publicRun: run, operatorDiagnostic }) {
  assertAggregateOnlyRunArtifact(run);
  const fail = () => { throw new Error("Current external PR semantic boundary health was invalid."); };
  if (!isValidOperatorDiagnosticAggregate(operatorDiagnostic, run.caseCount)) fail();
  if (run.status !== "completed" || run.completedCount !== run.caseCount || run.incompleteCount !== 0) fail();
  if (!run.qualityGateSummary.ok || run.qualityGateSummary.checks.some((check) => check.failedCount !== 0)) fail();
  if ((run.requirementStatusSummary.met ?? 0) !== 0 || (run.requirementEvidenceStatusSummary.met ?? 0) !== 0) fail();
  if (run.generalPrAssessmentSummary.assessmentCountTotals.evidence_supported !== 0) fail();
  if ((operatorDiagnostic.providerCallCountCounts["0"] ?? 0) + (operatorDiagnostic.providerCallCountCounts["1"] ?? 0) +
    (operatorDiagnostic.providerCallCountCounts["2"] ?? 0) !== run.caseCount) fail();
  if ((operatorDiagnostic.providerCallCountCounts["3_plus"] ?? 0) !== 0) fail();
  if ((operatorDiagnostic.semanticPackageFailureReasonCounts.span_limit_exceeded ?? 0) !== 0 ||
    (operatorDiagnostic.semanticPackageFailureReasonCounts.change_cluster_limit_exceeded ?? 0) !== 0 ||
    (operatorDiagnostic.semanticPackageFailureReasonCounts.evidence_atom_limit_exceeded ?? 0) !== 0) fail();
}

function isValidOperatorDiagnosticAggregate(value, caseCount) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1 ||
    value.privacy !== "operator-only-aggregate" || value.caseCount !== caseCount ||
    !Number.isSafeInteger(value.packageReadyCount) || value.packageReadyCount < 0 || value.packageReadyCount > caseCount) return false;
  const records = [
    [value.claimStageStateCounts, OPERATOR_STAGE_STATES], [value.evidenceStageStateCounts, OPERATOR_STAGE_STATES],
    [value.sourceCoverageCounts, OPERATOR_COVERAGE_STATES], [value.evidenceCoverageCounts, OPERATOR_COVERAGE_STATES],
    [value.providerCallCountCounts, new Set(["0", "1", "2", "3_plus"])], [value.selectedCountBucketCounts?.sourceSpans, OPERATOR_SOURCE_BUCKETS],
    [value.selectedCountBucketCounts?.evidenceCandidates, OPERATOR_EVIDENCE_BUCKETS]
  ];
  if (Object.keys(value).length !== 12 || !value.selectedCountBucketCounts || typeof value.selectedCountBucketCounts !== "object" ||
    Array.isArray(value.selectedCountBucketCounts) || Object.keys(value.selectedCountBucketCounts).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value.selectedCountBucketCounts, "sourceSpans") ||
    !Object.prototype.hasOwnProperty.call(value.selectedCountBucketCounts, "evidenceCandidates") ||
    !value.omissionReasonCounts || typeof value.omissionReasonCounts !== "object" ||
    Object.keys(value.omissionReasonCounts).length !== OPERATOR_OMISSION_KEYS.length ||
    !value.semanticPackageFailureReasonCounts || typeof value.semanticPackageFailureReasonCounts !== "object" ||
    Array.isArray(value.semanticPackageFailureReasonCounts)) return false;
  for (const [record, keys] of records) {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
      Object.entries(record).some(([key, count]) => !keys.has(key) || !Number.isSafeInteger(count) || count < 0)) return false;
  }
  return OPERATOR_OMISSION_KEYS.every((key) => Number.isSafeInteger(value.omissionReasonCounts[key]) && value.omissionReasonCounts[key] >= 0) &&
    Object.entries(value.semanticPackageFailureReasonCounts).every(([reason, count]) =>
      OPERATOR_PACKAGE_FAILURE_REASONS.has(reason) && Number.isSafeInteger(count) && count >= 0
    );
}

function validateReadySnapshot(snapshot, { now, maxSnapshotAgeMs }) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.version !== 1 ||
    snapshot.privacy !== "external-pr-live-corpus-anchor-summary-only" || snapshot.status !== "ready") {
    throw new Error("Current external PR evaluation requires a ready snapshot.");
  }
  if (!Number.isSafeInteger(snapshot.candidateCount) || snapshot.candidateCount !== 25 ||
    !Array.isArray(snapshot.cases) || snapshot.cases.length !== 25 ||
    typeof snapshot.corpusFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.corpusFingerprint)) {
    throw new Error("Current external PR evaluation snapshot is invalid.");
  }
  const observedAt = Date.parse(snapshot.observedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(observedAt) || !Number.isFinite(current) || !Number.isSafeInteger(maxSnapshotAgeMs) || maxSnapshotAgeMs < 0 ||
    current < observedAt || current - observedAt > maxSnapshotAgeMs) {
    throw new Error("Current external PR evaluation snapshot must be refreshed before analysis.");
  }
  const ids = new Set();
  const urls = new Set();
  for (const testCase of snapshot.cases) {
    if (!validCapturedCase(testCase) || ids.has(testCase.id) || urls.has(testCase.prUrl)) {
      throw new Error("Current external PR evaluation snapshot is invalid.");
    }
    ids.add(testCase.id);
    urls.add(testCase.prUrl);
  }
}

function validCapturedCase(testCase) {
  return testCase && typeof testCase === "object" &&
    typeof testCase.id === "string" && typeof testCase.cohort === "string" &&
    typeof testCase.prUrl === "string" && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(testCase.prUrl) &&
    testCase.captureStatus === "captured" &&
    SHA_PATTERN.test(testCase.anchor?.headSha ?? "") && SHA_PATTERN.test(testCase.anchor?.baseSha ?? "") &&
    typeof testCase.anchorFingerprint === "string" && /^[a-f0-9]{64}$/.test(testCase.anchorFingerprint);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const snapshotPath = process.env.AGENTPROOF_EXTERNAL_CORPUS_SNAPSHOT ?? DEFAULT_SNAPSHOT_PATH;
  const outputPath = process.env.AGENTPROOF_EXTERNAL_CORPUS_RUN_OUTPUT ?? DEFAULT_OUTPUT_PATH;
  const requireSemanticBoundary = process.env.AGENTPROOF_EXTERNAL_CORPUS_REQUIRE_SEMANTIC_BOUNDARY === "1";
  const operatorDiagnosticsToken = process.env.AGENTPROOF_SMOKE_OPS_TOKEN;

  const options = {
    snapshot: readJson(snapshotPath),
    githubToken: process.env.AGENTPROOF_SMOKE_GITHUB_TOKEN,
    allowProductionGithubToken: process.env.AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN === "1"
  };
  const execution = operatorDiagnosticsToken
    ? runCurrentExternalPrCorpusSemanticBoundaryDiagnostic({ ...options, operatorDiagnosticsToken })
    : runCurrentExternalPrCorpusSmoke(options);

  execution
    .then((result) => {
      const publicRun = "publicRun" in result ? result.publicRun : result;
      const operatorDiagnostic = "operatorDiagnostic" in result ? result.operatorDiagnostic : null;
      if (requireSemanticBoundary) assertCurrentExternalPrSemanticBoundaryHealth(result);
      writeCurrentExternalPrCorpusRun(publicRun, outputPath);
      console.log(JSON.stringify({
        status: publicRun.status,
        caseCount: publicRun.caseCount,
        completedCount: publicRun.completedCount,
        incompleteCount: publicRun.incompleteCount,
        ...(operatorDiagnostic ? { operatorDiagnostic } : {}),
        outputPath
      }));
      process.exitCode = publicRun.status === "completed" ? 0 : 1;
    })
    .catch(() => {
      console.error(JSON.stringify({ status: "incomplete", error: "Current external PR corpus smoke could not run." }));
      process.exitCode = 1;
    });
}
