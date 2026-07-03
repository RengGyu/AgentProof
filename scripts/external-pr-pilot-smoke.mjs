import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runAnalyzePrSmoke
} from "./smoke-analyze-pr-url.mjs";
import {
  safeSmokePrUrl,
  summarizeAnalyzeTimings,
  summarizeGitHubEvidenceTimings,
  summarizeQualityGates
} from "./smoke-real-pr-evaluation.mjs";

const DEFAULT_BASE_URL = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const DEFAULT_FIXTURE_PATH = join(process.cwd(), "eval/fixtures/external-pr-pilot.v1.json");
const EXPLICIT_GITHUB_TOKEN = process.env.AGENTPROOF_EXTERNAL_PR_PILOT_GITHUB_TOKEN;
const ALLOW_PRODUCTION_GITHUB_TOKEN = process.env.AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN === "1";
const INCLUDE_PUBLIC_TASK_CONTEXT = process.env.AGENTPROOF_EXTERNAL_PR_PILOT_INCLUDE_PUBLIC_CONTEXT === "1";
const REQUIRED_CATEGORIES = new Set([
  "clean_pr",
  "missing_tests",
  "scope_creep",
  "failed_ci",
  "vague_task_or_visual_gap"
]);

export function loadExternalPrPilotSmokeCases({
  fixturePath = DEFAULT_FIXTURE_PATH,
  includePublicTaskContext = false
} = {}) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  return externalPrPilotSmokeCasesFromFixture(fixture, { includePublicTaskContext });
}

export function externalPrPilotSmokeCasesFromFixture(fixture, {
  includePublicTaskContext = false
} = {}) {
  validateExternalPrPilotFixtureForSmoke(fixture);

  return fixture.cases.map((testCase) => ({
    id: testCase.id,
    category: testCase.category,
    prUrl: testCase.reportInput.pullRequestUrl,
    taskText: includePublicTaskContext ? testCase.reportInput.publicTaskContext : "",
    labelStatus: testCase.manualLabels.labelStatus
  }));
}

export async function runExternalPrPilotSmoke({
  baseUrl = DEFAULT_BASE_URL,
  fixturePath = DEFAULT_FIXTURE_PATH,
  cases = loadExternalPrPilotSmokeCases({
    fixturePath,
    includePublicTaskContext: INCLUDE_PUBLIC_TASK_CONTEXT
  }),
  githubToken = EXPLICIT_GITHUB_TOKEN,
  allowProductionGithubToken = ALLOW_PRODUCTION_GITHUB_TOKEN,
  fetchImpl = fetch
} = {}) {
  if (!Array.isArray(cases) || cases.length !== 5) {
    throw new Error("External PR pilot smoke must run exactly 5 cases before any 20-case expansion.");
  }

  const results = [];

  for (const testCase of cases) {
    const result = await runAnalyzePrSmoke({
      baseUrl,
      prUrl: testCase.prUrl,
      taskText: testCase.taskText,
      githubToken,
      allowProductionGithubToken,
      fetchImpl
    });

    results.push({
      id: testCase.id,
      category: testCase.category,
      prUrl: safeSmokePrUrl(testCase.prUrl),
      reportInputMode: testCase.taskText ? "public_pr_url_plus_public_task_context" : "public_pr_url_only",
      manualLabelStatus: testCase.labelStatus,
      priority: result.priority,
      confidence: result.confidence,
      evidenceCoverage: result.evidenceCoverage,
      ciStatus: result.ciStatus,
      requirementCount: result.requirementCount,
      evidenceCount: result.evidenceCount,
      limitationCount: result.limitationCount,
      analyzeTiming: result.analyzeTiming,
      githubEvidenceTiming: result.githubEvidenceTiming,
      failedCheckLocationCount: result.failedCheckLocationCount,
      savedFailedCheckLocationsOmitted: result.savedFailedCheckLocationsOmitted,
      productionTokenForwarded: result.productionTokenForwarded,
      savedReportPrivacy: result.savedReportPrivacy,
      savedReportDurability: result.savedReportDurability,
      savedEvidenceCount: result.savedEvidenceCount,
      savedClaimCount: result.savedClaimCount,
      savedRepromptOmitted: result.savedRepromptOmitted,
      savedEvidenceRefsCleared: result.savedEvidenceRefsCleared,
      savedReportDeleted: result.savedReportDeleted,
      savedReportDeleteWarning: result.savedReportDeleteWarning,
      qualityGate: result.qualityGate
    });
  }

  const pendingManualLabels = results.filter((result) => result.manualLabelStatus !== "reviewed").length;

  return {
    ok: true,
    privacy: "external-pr-pilot-run-summary-only",
    baseUrl,
    caseCount: results.length,
    categoryStatuses: summarizeCategoryStatuses(results),
    pendingManualLabels,
    next: pendingManualLabels > 0
      ? "fill_manual_labels_after_reviewer_sessions"
      : "review_pilot_results_before_20_case_expansion",
    qualityGateSummary: summarizeQualityGates(results),
    timingSummary: summarizeAnalyzeTimings(results),
    githubEvidenceTimingSummary: summarizeGitHubEvidenceTimings(results),
    results
  };
}

function validateExternalPrPilotFixtureForSmoke(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    throw new Error("External PR pilot fixture must be an object.");
  }

  if (fixture.schemaVersion !== "external-pr-pilot.v1") {
    throw new Error("External PR pilot fixture schemaVersion must be external-pr-pilot.v1.");
  }

  if (fixture.privacy !== "external-pr-pilot-metadata-only") {
    throw new Error("External PR pilot fixture must remain metadata-only.");
  }

  if (!Array.isArray(fixture.cases) || fixture.cases.length !== 5) {
    throw new Error("External PR pilot fixture must contain exactly 5 cases before scaling.");
  }

  const categories = new Set();
  for (const testCase of fixture.cases) {
    validateExternalPrPilotCaseForSmoke(testCase);
    categories.add(testCase.category);
  }

  for (const category of REQUIRED_CATEGORIES) {
    if (!categories.has(category)) {
      throw new Error(`External PR pilot fixture is missing category ${category}.`);
    }
  }
}

function validateExternalPrPilotCaseForSmoke(testCase) {
  if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) {
    throw new Error("External PR pilot case must be an object.");
  }

  if (typeof testCase.id !== "string" || !testCase.id.startsWith("external-pr-pilot-")) {
    throw new Error("External PR pilot case id must use the external-pr-pilot prefix.");
  }

  if (!REQUIRED_CATEGORIES.has(testCase.category)) {
    throw new Error(`External PR pilot case ${testCase.id} has an unsupported category.`);
  }

  if (!testCase.reportInput || typeof testCase.reportInput !== "object" || Array.isArray(testCase.reportInput)) {
    throw new Error(`External PR pilot case ${testCase.id} must include reportInput.`);
  }

  if (!testCase.manualLabels || typeof testCase.manualLabels !== "object" || Array.isArray(testCase.manualLabels)) {
    throw new Error(`External PR pilot case ${testCase.id} must keep manualLabels separate.`);
  }

  const pullRequestUrl = testCase.reportInput.pullRequestUrl;
  if (
    typeof pullRequestUrl !== "string" ||
    !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(pullRequestUrl) ||
    /RengGyu\/AgentProof/i.test(pullRequestUrl)
  ) {
    throw new Error(`External PR pilot case ${testCase.id} must use a public non-AgentProof GitHub PR URL.`);
  }

  if (testCase.manualLabels.labelStatus !== "pending_reviewer_confirmation" && testCase.manualLabels.labelStatus !== "reviewed") {
    throw new Error(`External PR pilot case ${testCase.id} has an unsupported manual label status.`);
  }
}

function summarizeCategoryStatuses(results) {
  return results.map((result) => ({
    id: result.id,
    category: result.category,
    qualityGate: result.qualityGate?.ok === true ? "passed" : "failed",
    manualLabelStatus: result.manualLabelStatus
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExternalPrPilotSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        privacy: "external-pr-pilot-run-summary-only",
        error: error instanceof Error ? error.message : "External PR pilot smoke failed."
      }));
      process.exit(1);
    });
}
