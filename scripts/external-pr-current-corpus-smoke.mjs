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
      if (!["source_drift", "analysis_unavailable"].includes(result.failureKind)) fail();
    } else {
      fail();
    }
    if (result.id !== opaqueCaseId(index)) fail();
  }
}

/**
 * Release-only guard for the observable semantic transport boundary. It does
 * not score semantic accuracy and it cannot infer whether an aggregate
 * evidence_supported count came from a semantic or deterministic target.
 */
export function assertCurrentExternalPrSemanticBoundaryHealth(run) {
  assertAggregateOnlyRunArtifact(run);
  const fail = () => { throw new Error("Current external PR semantic boundary health was invalid."); };
  if (run.status !== "completed" || run.completedCount !== run.caseCount || run.incompleteCount !== 0) fail();
  if (!run.qualityGateSummary.ok || run.qualityGateSummary.checks.some((check) => check.failedCount !== 0)) fail();
  if (run.generalPrAssessmentSummary.assessmentCountTotals.evidence_supported !== 0) fail();

  const reasons = run.generalPrAssessmentSummary.reasonCodeCounts;
  for (const reason of ["semantic_observer_unavailable", "semantic_observer_timeout", "semantic_proposal_invalid"]) {
    if ((reasons[reason] ?? 0) !== 0) fail();
  }
  if (((reasons.semantic_candidate_missing ?? 0) + (reasons.semantic_relation_only ?? 0)) === 0) fail();
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

  runCurrentExternalPrCorpusSmoke({
    snapshot: readJson(snapshotPath),
    githubToken: process.env.AGENTPROOF_SMOKE_GITHUB_TOKEN,
    allowProductionGithubToken: process.env.AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN === "1"
  })
    .then((result) => {
      if (requireSemanticBoundary) assertCurrentExternalPrSemanticBoundaryHealth(result);
      writeCurrentExternalPrCorpusRun(result, outputPath);
      console.log(JSON.stringify({
        status: result.status,
        caseCount: result.caseCount,
        completedCount: result.completedCount,
        incompleteCount: result.incompleteCount,
        outputPath
      }));
      process.exitCode = result.status === "completed" ? 0 : 1;
    })
    .catch(() => {
      console.error(JSON.stringify({ status: "incomplete", error: "Current external PR corpus smoke could not run." }));
      process.exitCode = 1;
    });
}
