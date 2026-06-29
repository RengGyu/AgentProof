import { runAnalyzePrSmoke } from "./smoke-analyze-pr-url.mjs";

const DEFAULT_BASE_URL = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const EXPLICIT_GITHUB_TOKEN = process.env.AGENTPROOF_REAL_PR_SMOKE_GITHUB_TOKEN;
const ALLOW_PRODUCTION_GITHUB_TOKEN = process.env.AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN === "1";
const ANALYZE_TIMING_PHASES = ["input", "evidence", "report", "validation", "total"];
const GITHUB_EVIDENCE_TIMING_PHASES = ["github_pr", "github_files", "github_checks", "github_statuses", "github_annotations", "github_jobs"];

export const DEFAULT_REAL_PR_EVALUATION_CASES = [
  {
    id: "PR-1",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/1",
    taskText:
      "Harden AgentProof as an evidence-based verifier for agent-authored PRs. Acceptance criteria: add a reproducible real-data evaluation pack using SWE-bench Verified; harden evaluation fixture handling so raw rows and hidden oracle test values are not accepted; validate generated reports at /api/analyze; improve GitHub fallback limitations for rate limits/private repos/large PRs; prevent execution/test claims and met requirements from weak non-execution signals; preserve passing execution evidence in met requirement evidenceRefs; harden GitHub comment safety; add GitHub Actions CI; expand smoke testing for /api/analyze and summary-only saved reports; clarify Test/Build taxonomy in UI, Markdown, Slack, README, and docs.",
    expectations: {
      ciStatus: "passed",
      minRequirementCount: 6,
      minEvidenceCount: 8
    }
  },
  {
    id: "PR-2",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/2",
    taskText:
      "Make summary-only saved reports harder to misread as durable full reports. Acceptance criteria: add durability metadata to POST /api/reports and GET /api/reports/[id]; return durability short-lived-in-memory and reader-facing warning without breaking existing fields; update smoke tests to fail if durability metadata disappears; add a summary-mode notice in ReportView explaining omitted raw evidence, patch/log excerpts, claims, evidence references, and re-prompt text; update saved report page to show in-memory expiry warning and expiresAt; prevent duplicate summary-only limitation text when re-sharing sanitized reports.",
    expectations: {
      ciStatus: "passed",
      minRequirementCount: 5,
      minEvidenceCount: 8
    }
  },
  {
    id: "PR-3",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/3",
    taskText:
      "Add execution evidence to verification reports. Acceptance criteria: add an Execution Evidence section to full reports, Markdown exports, and GitHub PR comments; surface bounded check/log evidence from existing redacted evidence summaries; exclude preview/security/non-execution gates from execution evidence, including labels containing test or coverage words; update CI workflow actions to Node 24-based v5 releases; preserve summary-only privacy by not showing execution evidence in summary mode and not adding raw log or patch persistence.",
    expectations: {
      ciStatus: "passed",
      minRequirementCount: 4,
      minEvidenceCount: 8
    }
  },
  {
    id: "PR-9",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/9",
    taskText:
      "Refresh AgentProof UI/UX for mobile and portfolio readiness. Acceptance criteria: preserve evidence-based verifier positioning; make the report readable in 30 seconds; improve mobile layout without overlapping text/buttons; keep summary-only privacy boundaries visible; keep GitHub comment/export flows explicit and human-triggered; avoid generic AI code reviewer language.",
    expectations: {
      ciStatus: "passed",
      minRequirementCount: 5,
      minEvidenceCount: 8,
      requireVisualUnverified: true
    }
  },
  {
    id: "PR-12",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/12",
    taskText:
      "Improve GitHub execution evidence matching. Acceptance criteria: tighten execution-evidence classification so generic CI/build summaries about preview, deployment, security, policy, or report gates do not prove tests/builds; filter GitHub Actions job-step metadata to execution-like steps without fetching raw Actions logs; allow missing-test matching to use passing CI/check evidence that explicitly names an unchanged test path, endpoint, or component symbol while keeping broad pnpm test as a reviewer lead; keep visual UX requirements partial unless browser QA, Playwright, or Cypress-style evidence is present.",
    expectations: {
      ciStatus: "passed",
      minRequirementCount: 4,
      minEvidenceCount: 8,
      requireVisualUnverified: true
    }
  },
  {
    id: "PR-15",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/15",
    taskText:
      "Surface failed check locations safely. Acceptance criteria: parse bounded failed Check Run annotation locations into execution evidence display data; show failed check locations only in full reports, Markdown exports, and intentional PR comments; keep summary-only share/history/server saved reports free of annotation path leaks and raw annotation details; preserve evidence-based verifier positioning.",
    expectations: {
      ciStatus: "passed",
      minRequirementCount: 4,
      minEvidenceCount: 8
    }
  }
];

export async function runRealPrEvaluationSmoke({
  baseUrl = DEFAULT_BASE_URL,
  cases = DEFAULT_REAL_PR_EVALUATION_CASES,
  githubToken = EXPLICIT_GITHUB_TOKEN,
  allowProductionGithubToken = ALLOW_PRODUCTION_GITHUB_TOKEN,
  fetchImpl = fetch
} = {}) {
  const results = [];

  for (const testCase of cases) {
    const result = await runAnalyzePrSmoke({
      baseUrl,
      prUrl: testCase.prUrl,
      taskText: testCase.taskText,
      githubToken,
      allowProductionGithubToken,
      expectations: testCase.expectations,
      fetchImpl
    });

    results.push({
      id: testCase.id,
      prUrl: safeSmokePrUrl(testCase.prUrl),
      priority: result.priority,
      confidence: result.confidence,
      evidenceCoverage: result.evidenceCoverage,
      ciStatus: result.ciStatus,
      requirementCount: result.requirementCount,
      evidenceCount: result.evidenceCount,
      limitationCount: result.limitationCount,
      analyzeTiming: result.analyzeTiming,
      githubEvidenceTiming: result.githubEvidenceTiming,
      expectationCheckCount: result.expectationCheckCount,
      expectationChecks: result.expectationChecks,
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
      savedReportDeleteWarning: result.savedReportDeleteWarning
    });
  }

  return {
    ok: true,
    baseUrl,
    caseCount: results.length,
    timingSummary: summarizeAnalyzeTimings(results),
    githubEvidenceTimingSummary: summarizeGitHubEvidenceTimings(results),
    results
  };
}

export function safeSmokePrUrl(value) {
  try {
    const url = new URL(value);

    if (!["http:", "https:"].includes(url.protocol)) {
      return undefined;
    }

    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return undefined;
  }
}

export function summarizeAnalyzeTimings(results) {
  return summarizeTimingPhases({
    results,
    source: "analyzeTiming",
    phases: ANALYZE_TIMING_PHASES,
    metric: "X-AgentProof-Timing"
  });
}

export function summarizeGitHubEvidenceTimings(results) {
  return summarizeTimingPhases({
    results,
    source: "githubEvidenceTiming",
    phases: GITHUB_EVIDENCE_TIMING_PHASES,
    metric: "X-AgentProof-Evidence-Timing"
  });
}

function summarizeTimingPhases({ results, source, phases: phaseNames, metric }) {
  const phases = {};

  for (const phase of phaseNames) {
    const values = results
      .map((result) => result[source]?.[phase])
      .filter((value) => Number.isSafeInteger(value) && value >= 0)
      .sort((a, b) => a - b);

    phases[phase] = {
      count: values.length,
      missingCount: results.length - values.length,
      p50: percentileNearestRank(values, 50),
      p95: percentileNearestRank(values, 95),
      max: values.length > 0 ? values[values.length - 1] : null
    };
  }

  return {
    metric,
    unit: "ms",
    method: "nearest-rank",
    phases
  };
}

function percentileNearestRank(values, percentile) {
  if (values.length === 0) {
    return null;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * values.length) - 1)
  );

  return values[index];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRealPrEvaluationSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : "Real PR evaluation smoke failed."
      }));
      process.exit(1);
    });
}
