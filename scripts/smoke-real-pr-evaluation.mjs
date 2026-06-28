import { runAnalyzePrSmoke } from "./smoke-analyze-pr-url.mjs";

const DEFAULT_BASE_URL = (process.env.AGENTPROOF_SMOKE_BASE_URL ?? "https://agentproof-pearl.vercel.app").replace(/\/$/, "");
const EXPLICIT_GITHUB_TOKEN = process.env.AGENTPROOF_REAL_PR_SMOKE_GITHUB_TOKEN;

export const DEFAULT_REAL_PR_EVALUATION_CASES = [
  {
    id: "PR-1",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/1",
    taskText:
      "Harden AgentProof as an evidence-based verifier for agent-authored PRs. Acceptance criteria: add a reproducible real-data evaluation pack using SWE-bench Verified; harden evaluation fixture handling so raw rows and hidden oracle test values are not accepted; validate generated reports at /api/analyze; improve GitHub fallback limitations for rate limits/private repos/large PRs; prevent execution/test claims and met requirements from weak non-execution signals; preserve passing execution evidence in met requirement evidenceRefs; harden GitHub comment safety; add GitHub Actions CI; expand smoke testing for /api/analyze and summary-only saved reports; clarify Test/Build taxonomy in UI, Markdown, Slack, README, and docs."
  },
  {
    id: "PR-2",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/2",
    taskText:
      "Make summary-only saved reports harder to misread as durable full reports. Acceptance criteria: add durability metadata to POST /api/reports and GET /api/reports/[id]; return durability short-lived-in-memory and reader-facing warning without breaking existing fields; update smoke tests to fail if durability metadata disappears; add a summary-mode notice in ReportView explaining omitted raw evidence, patch/log excerpts, claims, evidence references, and re-prompt text; update saved report page to show in-memory expiry warning and expiresAt; prevent duplicate summary-only limitation text when re-sharing sanitized reports."
  },
  {
    id: "PR-3",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/3",
    taskText:
      "Add execution evidence to verification reports. Acceptance criteria: add an Execution Evidence section to full reports, Markdown exports, and GitHub PR comments; surface bounded check/log evidence from existing redacted evidence summaries; exclude preview/security/non-execution gates from execution evidence, including labels containing test or coverage words; update CI workflow actions to Node 24-based v5 releases; preserve summary-only privacy by not showing execution evidence in summary mode and not adding raw log or patch persistence."
  },
  {
    id: "PR-9",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/9",
    taskText:
      "Refresh AgentProof UI/UX for mobile and portfolio readiness. Acceptance criteria: preserve evidence-based verifier positioning; make the report readable in 30 seconds; improve mobile layout without overlapping text/buttons; keep summary-only privacy boundaries visible; keep GitHub comment/export flows explicit and human-triggered; avoid generic AI code reviewer language."
  }
];

export async function runRealPrEvaluationSmoke({
  baseUrl = DEFAULT_BASE_URL,
  cases = DEFAULT_REAL_PR_EVALUATION_CASES,
  githubToken = EXPLICIT_GITHUB_TOKEN,
  fetchImpl = fetch
} = {}) {
  const results = [];

  for (const testCase of cases) {
    const result = await runAnalyzePrSmoke({
      baseUrl,
      prUrl: testCase.prUrl,
      taskText: testCase.taskText,
      githubToken,
      fetchImpl
    });

    results.push({
      id: testCase.id,
      prUrl: testCase.prUrl,
      priority: result.priority,
      confidence: result.confidence,
      evidenceCoverage: result.evidenceCoverage,
      ciStatus: result.ciStatus,
      requirementCount: result.requirementCount,
      evidenceCount: result.evidenceCount,
      limitationCount: result.limitationCount,
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
    results
  };
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
