import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAnalyzePrSmoke } from "./smoke-analyze-pr-url.mjs";
import { safeSmokePrUrl } from "./smoke-real-pr-evaluation.mjs";

const DEFAULT_BASE_URL = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const DEFAULT_FIXTURE_PATH = join(process.cwd(), "eval/fixtures/external-pr-batch.v1.json");
const DEFAULT_PILOT_FIXTURE_PATH = join(process.cwd(), "eval/fixtures/external-pr-pilot.v1.json");
const EXPLICIT_GITHUB_TOKEN = process.env.AGENTPROOF_EXTERNAL_PR_BATCH_GITHUB_TOKEN;
const MIN_CASES = 20;
const MAX_CASES = 30;
const PREVIEW_HOST_PATTERN = /^agentproof-git-[a-z0-9-]+-renggyus-projects\.vercel\.app$/;

export function loadExternalPrBatchSmokeCases({ fixturePath = DEFAULT_FIXTURE_PATH } = {}) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  return externalPrBatchSmokeCasesFromFixture(fixture);
}

export function externalPrBatchSmokeCasesFromFixture(fixture) {
  validateExternalPrBatchFixture(fixture);
  return fixture.cases.map((testCase) => ({ id: testCase.id, prUrl: testCase.source.url }));
}

export async function runExternalPrBatchSmoke({
  baseUrl = DEFAULT_BASE_URL,
  cases = loadExternalPrBatchSmokeCases(),
  githubToken = EXPLICIT_GITHUB_TOKEN,
  pilotFixturePath = DEFAULT_PILOT_FIXTURE_PATH,
  analyzePr = runAnalyzePrSmoke,
  fetchImpl = fetch
} = {}) {
  assertPreviewBaseUrl(baseUrl);
  assertFiveCasePilotReviewed(pilotFixturePath);
  validateRuntimeCases(cases);
  if (!githubToken?.trim()) {
    throw new Error("External PR batch requires a GitHub token at runtime to avoid anonymous rate-limit bias.");
  }

  const results = [];
  for (const testCase of cases) {
    try {
      const report = await analyzePr({
        baseUrl,
        prUrl: testCase.prUrl,
        taskText: "",
        githubToken,
        allowProductionGithubToken: false,
        fetchImpl
      });
      results.push(successResult(testCase, report));
    } catch (error) {
      results.push(failureResult(testCase, error));
    }
  }

  const analyzedCount = results.filter((result) => result.state === "analyzed").length;
  const failedCount = results.length - analyzedCount;
  return {
    version: 1,
    privacy: "external-pr-batch-run-summary-only",
    baseUrl: new URL(baseUrl).origin,
    caseCount: results.length,
    analyzedCount,
    failedCount,
    releaseState: "no_go",
    next: failedCount > 0
      ? "inspect_bounded_failures_before_independent_comparison"
      : "obtain_independent_labels_before_release_evaluation",
    results
  };
}

function successResult(testCase, report) {
  return {
    id: testCase.id,
    prUrl: safeSmokePrUrl(testCase.prUrl),
    state: "analyzed",
    priority: report.priority ?? "unknown",
    confidence: boundedNumber(report.confidence),
    evidenceCoverage: boundedNumber(report.evidenceCoverage),
    ciStatus: report.ciStatus ?? "unknown",
    requirementCount: boundedCount(report.requirementCount),
    evidenceCount: boundedCount(report.evidenceCount),
    limitationCount: boundedCount(report.limitationCount),
    qualityGate: report.qualityGate?.ok === true ? "passed" : "unknown"
  };
}

function failureResult(testCase, error) {
  return {
    id: testCase.id,
    prUrl: safeSmokePrUrl(testCase.prUrl),
    state: "failed",
    reasonCode: failureReasonCode(error)
  };
}

function failureReasonCode(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("rate limit")) return "github_rate_limited";
  if (message.includes("token") || message.includes("access") || message.includes("permission") || message.includes("auth")) {
    return "github_access";
  }
  if (message.includes("quality gate")) return "report_quality_gate_failed";
  return "analyze_failed";
}

function boundedCount(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function boundedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function assertPreviewBaseUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("External PR batch requires a preview deployment URL.");
  }
  if (url.protocol !== "https:" || !PREVIEW_HOST_PATTERN.test(url.hostname)) {
    throw new Error("External PR batch requires a preview deployment URL, not the production domain.");
  }
}

function assertFiveCasePilotReviewed(fixturePath) {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  } catch {
    throw new Error("External PR batch requires completed five-case pilot labels.");
  }

  const cases = fixture && typeof fixture === "object" && !Array.isArray(fixture) ? fixture.cases : undefined;
  if (
    fixture?.schemaVersion !== "external-pr-pilot.v1" ||
    fixture?.privacy !== "external-pr-pilot-metadata-only" ||
    !Array.isArray(cases) ||
    cases.length !== 5 ||
    !cases.every((testCase) => testCase?.manualLabels?.labelStatus === "reviewed")
  ) {
    throw new Error("External PR batch requires completed five-case pilot labels.");
  }
}

function validateRuntimeCases(cases) {
  if (!Array.isArray(cases) || cases.length < MIN_CASES || cases.length > MAX_CASES) {
    throw new Error(`External PR batch must contain ${MIN_CASES} to ${MAX_CASES} cases.`);
  }
  const ids = new Set();
  const urls = new Set();
  for (const testCase of cases) {
    if (!testCase || typeof testCase.id !== "string" || !testCase.id.startsWith("external-pr-batch-")) {
      throw new Error("External PR batch cases require bounded ids.");
    }
    if (typeof testCase.prUrl !== "string" || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(testCase.prUrl) || /RengGyu\/AgentProof/i.test(testCase.prUrl)) {
      throw new Error("External PR batch cases require public non-AgentProof URLs.");
    }
    if (ids.has(testCase.id) || urls.has(testCase.prUrl)) throw new Error("External PR batch case ids and URLs must be unique.");
    ids.add(testCase.id);
    urls.add(testCase.prUrl);
  }
}

function validateExternalPrBatchFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) throw new Error("External PR batch fixture must be an object.");
  if (fixture.schemaVersion !== "external-pr-batch.v1") throw new Error("External PR batch fixture schemaVersion must be external-pr-batch.v1.");
  if (fixture.privacy !== "external-pr-batch-metadata-only") throw new Error("External PR batch fixture must remain metadata-only.");
  if (!Array.isArray(fixture.cases)) throw new Error("External PR batch fixture must include cases.");

  const cases = fixture.cases.map((testCase) => {
    if (!testCase || typeof testCase !== "object" || Array.isArray(testCase)) throw new Error("External PR batch case must be an object.");
    if (JSON.stringify(Object.keys(testCase).sort()) !== JSON.stringify(["id", "source"])) {
      throw new Error("External PR batch cases cannot carry labels or raw PR content.");
    }
    const source = testCase.source;
    if (!source || typeof source !== "object" || Array.isArray(source) || JSON.stringify(Object.keys(source).sort()) !== JSON.stringify(["pullRequestNumber", "repository", "url"])) {
      throw new Error("External PR batch sources must contain only repository, pullRequestNumber, and url.");
    }
    if (typeof testCase.id !== "string" || typeof source.repository !== "string" || !Number.isInteger(source.pullRequestNumber) || typeof source.url !== "string") {
      throw new Error("External PR batch source fields are invalid.");
    }
    if (source.url !== `https://github.com/${source.repository}/pull/${source.pullRequestNumber}`) {
      throw new Error("External PR batch source URL must match its repository and pull request number.");
    }
    return { id: testCase.id, prUrl: source.url };
  });
  validateRuntimeCases(cases);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExternalPrBatchSmoke()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch(() => {
      console.error(JSON.stringify({
        ok: false,
        privacy: "external-pr-batch-run-summary-only",
        error: "External PR batch could not start."
      }));
      process.exit(1);
    });
}
