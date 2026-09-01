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

export async function runCurrentExternalPrCorpusSmoke({
  snapshot,
  baseUrl = DEFAULT_BASE_URL,
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

function runArtifactResult(result) {
  return result.analysisStatus === "completed"
    ? { id: result.id, analysisStatus: "completed" }
    : { id: result.id, analysisStatus: "incomplete", failureKind: result.failureKind };
}

function assertAggregateOnlyRunArtifact(value) {
  const forbiddenKeys = new Set([
    "targets",
    "targetId",
    "sourceText",
    "sourceSpanRefs",
    "sourceBindingRef",
    "path",
    "paths",
    "locator",
    "providerOutput",
    "providerResponse",
    "prompt",
    "token",
    "tokens",
    "diagnostics",
    "rawInput",
    "prUrl",
    "cohort",
    "anchorFingerprint"
  ]);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (forbiddenKeys.has(key)) throw new Error("Current external PR run artifact retained private or identifying data.");
      visit(child);
    }
  };
  visit(value);
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

  runCurrentExternalPrCorpusSmoke({ snapshot: readJson(snapshotPath) })
    .then((result) => {
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
