import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const blindCandidateSource = "eval/external-pr-blind-candidates.json";
const existingOutputPath = "eval/external-pr-proofgraph-rerun-results.json";
const newBlindOutputPath = "eval/external-pr-proofgraph-new-blind-results.json";
const baseUrl = (process.env.AGENTPROOF_PROOFGRAPH_BASE_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

const NON_EXECUTION_PATTERN =
  /\b(ai[- ]?review|allowed failure|allow failure|backport|changelog|change log|code[- ]owners?|codecov|coverage (?:gate|policy|report|threshold|upload)|coveralls|dependency|dependencies|deprecation|deploy|deployment|docs?|documentation|do not merge|label|license|licenses|merge[- ]?gate|non[- ]?blocking|optional|owners|patch coverage|policies|policy|preview|prevent merging|project coverage|provenance|readthedocs|read the docs|release notes?|required checks?|report|review|sast|scan|secret|secrets|security|semver|stats?|towncrier)\b/i;
const DIRECT_EXECUTION_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b|\buv\s+run\s+tox\b|\bcoverage\s+run\s+-m\s+pytest\b|\b(?:vitest|jest|pytest|tox|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|next\s+build)\b/i;
const STRONG_EXECUTION_PATTERN = /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|pytest|tox)\b/i;
const WEAK_EXECUTION_PATTERN = /\bbuild\b/i;
const STATIC_ONLY_PATTERN = /\b(?:eslint|lint|typecheck|type-check|type check|tsc|static analysis|static check)\b/i;
const GITHUB_ACTIONS_JOB_URL_PATTERN = /github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+\/job\/\d+/i;
const CANCELLED_OR_OPTIONAL_PATTERN =
  /\b(cancelled|canceled|skipped|optional|non[- ]?blocking|allowed failure|allow failure|neutral|not required|action required)\b/i;
const MATRIX_EXECUTION_JOB_PATTERN =
  /(?:^[A-Z][A-Z0-9_]{2,}=)|\b(?:ubuntu|linux|windows|macos|darwin|python|py\d|node|ruby|go|java|jdk|x86|x64|arm64|sqlite|postgres|mysql|mariadb|oracle|matrix)\b/i;

async function main() {
  const token = transientGithubToken();
  const existingPrevious = readOptionalJson(join(root, existingOutputPath));
  const newBlindPrevious = readOptionalJson(join(root, newBlindOutputPath));
  const blindCandidates = readJson(join(root, blindCandidateSource)).candidates ?? [];
  const newBlindCandidates = newBlindPrevious?.candidates ?? [];

  const existingResults = [];
  for (const candidate of blindCandidates) {
    existingResults.push(await analyzeCandidate(candidate, token, existingPrevious));
  }

  const newBlindResults = [];
  for (const candidate of newBlindCandidates) {
    newBlindResults.push(await analyzeCandidate(candidate, token, newBlindPrevious));
  }

  writeOutput(existingOutputPath, {
    privacy: "external-pr-proofgraph-rerun-results-summary-only",
    status: "proofgraph_rerun_reports_need_human_labeling",
    generatedAt: new Date().toISOString(),
    candidateSource: blindCandidateSource,
    analysisBaseUrl: baseUrl,
    usedTransientGithubToken: Boolean(token),
    sourcePolicy: sourcePolicy([
      "Existing blind set rerun after reviewer-signal proofGraph evidence classification changes.",
      "Before/after fields are summary-only and compare against the previous summary result file when present."
    ]),
    results: existingResults,
    summary: summarizeResults(existingResults)
  });

  writeOutput(newBlindOutputPath, {
    privacy: "external-pr-proofgraph-new-blind-results-summary-only",
    status: "new_blind_reports_need_human_labeling",
    generatedAt: new Date().toISOString(),
    analysisBaseUrl: baseUrl,
    usedTransientGithubToken: Boolean(token),
    sourcePolicy: sourcePolicy([
      "New blind candidate set rerun after reviewer-signal proofGraph evidence classification changes.",
      "Candidate list is carried forward from the previous new-blind result file; no new candidates were fetched by this script."
    ]),
    candidates: newBlindCandidates,
    results: newBlindResults,
    summary: summarizeResults(newBlindResults)
  });

  console.log(`Wrote ${existingOutputPath}`);
  console.log(summarizeResults(existingResults));
  console.log(`Wrote ${newBlindOutputPath}`);
  console.log(summarizeResults(newBlindResults));
}

async function analyzeCandidate(candidate, token, previousOutput) {
  const previous = previousOutput?.results?.find((item) => item.candidateId === candidate.id);

  try {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prUrl: candidate.prUrl,
        ...(token ? { githubToken: token } : {})
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.report) {
      return failedResult(candidate, previous, typeof payload.error === "string" ? payload.error : `HTTP ${response.status}`);
    }

    const report = payload.report;
    const diagnosticMetadata = diagnosticMetadataForReport(report, response.headers.get("x-agentproof-evidence-timing"));
    const reportSummary = summarizeReport(report);
    const proofGraphDiagnostics = summarizeProofGraph(report);
    const quickAssessment = quickAssessmentForReport(report, diagnosticMetadata, proofGraphDiagnostics);

    return {
      candidateId: candidate.id,
      repository: candidate.repository,
      prNumber: candidate.prNumber,
      prUrl: candidate.prUrl,
      classification: candidate.classification,
      analysisStatus: "completed",
      failureReason: null,
      previousSummary: previous ? compactPreviousSummary(previous.reportSummary) : null,
      beforeAfter: beforeAfter(previous?.reportSummary, reportSummary),
      diagnosticMetadata,
      reportSummary,
      proofGraphDiagnostics,
      humanCheckNeeded: {
        issueToEvidenceMapping: true,
        falseBlockerRisk: true,
        missingTestJudgment: true,
        scopeCreepJudgment: true,
        rePromptUsefulness: true
      },
      quickAssessment
    };
  } catch (error) {
    return failedResult(candidate, previous, error instanceof Error ? error.message : "analysis failed");
  }
}

function failedResult(candidate, previous, reason) {
  return {
    candidateId: candidate.id,
    repository: candidate.repository,
    prNumber: candidate.prNumber,
    prUrl: candidate.prUrl,
    classification: candidate.classification,
    analysisStatus: "failed",
    failureReason: safeText(reason, 400),
    previousSummary: previous ? compactPreviousSummary(previous.reportSummary) : null,
    beforeAfter: null,
    diagnosticMetadata: emptyDiagnostics(),
    reportSummary: null,
    proofGraphDiagnostics: null,
    humanCheckNeeded: {
      issueToEvidenceMapping: true,
      falseBlockerRisk: true,
      missingTestJudgment: true,
      scopeCreepJudgment: true,
      rePromptUsefulness: true
    },
    quickAssessment: {
      looksUsefulFor30SecondReview: "unclear",
      obviousProblem: safeText(reason, 240),
      stayedEvidenceVerifierFocused: true,
      unsupportedMergeSecurityCorrectnessClaims: [],
      possibleFalsePass: false,
      possibleFalseBlocker: false,
      proofGraphUsedInJudgment: false
    }
  };
}

function summarizeReport(report) {
  return {
    priority: report.summary?.priority ?? "medium",
    evidenceCoverage: numeric(report.summary?.evidenceCoverage),
    confidence: numeric(report.summary?.confidence),
    testBuildStatus: report.testing?.ciStatus ?? "unknown",
    requirementCounts: requirementCounts(report.requirements),
    topRisks: boundedStrings(report.summary?.topRisks, 4),
    missingTestCount: Array.isArray(report.testing?.missingTests) ? report.testing.missingTests.length : 0,
    firstReviewPriorityFiles: boundedStrings(uniqueStrings((report.reviewPriority ?? []).map((item) => item?.path)), 6),
    rePromptSummary: summarizeReprompt(report),
    limitations: boundedStrings(report.limitations, 12)
  };
}

function summarizeProofGraph(report) {
  const graph = report.proofGraph;
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const gapKinds = {};

  for (const node of nodes) {
    for (const gap of node.gapSignals ?? []) {
      gapKinds[gap.kind] = (gapKinds[gap.kind] ?? 0) + 1;
    }
  }

  return {
    present: Boolean(graph),
    version: graph?.version ?? null,
    summary: graph?.summary ?? null,
    gapKinds,
    proofGraphUsedInJudgment: {
      graphPresent: Boolean(graph),
      usedInRequirementGaps: nodes.some((node) => (node.gapSignals ?? []).length > 0),
      usedInReviewPriority: (report.reviewPriority ?? []).some((item) => /Requirement proof gap/i.test(item.reason ?? "")),
      usedInTopRisks: (report.summary?.topRisks ?? []).some((risk) => /proof graph|proof/i.test(risk)),
      usedInReprompt: /proof/i.test(report.reprompt ?? "")
    },
    requirementSignalSummary: nodes.slice(0, 8).map((node) => ({
      requirementId: node.requirementId,
      requirementText: safeText(node.requirementText, 160),
      status: node.status,
      confidence: numeric(node.confidence),
      implementationEvidenceCount: node.implementationEvidenceRefs?.length ?? 0,
      targetedTestEvidenceCount: node.targetedTestEvidenceRefs?.length ?? 0,
      executionEvidenceCount: node.executionEvidenceRefs?.length ?? 0,
      gapKinds: (node.gapSignals ?? []).map((gap) => gap.kind),
      gapSeverities: (node.gapSignals ?? []).map((gap) => gap.severity),
      firstFiles: boundedStrings(node.firstFiles, 4)
    }))
  };
}

function diagnosticMetadataForReport(report, timingHeader) {
  const evidence = Array.isArray(report.evidenceIndex) ? report.evidenceIndex : [];
  const checkEvidence = evidence.filter((item) => item.kind === "check" || item.kind === "log");
  const executionEvidence = checkEvidence.filter(isExecutionEvidence);
  const failedExecutionEvidence = executionEvidence.filter((item) => statusFromSummary(item.summary) === "failed");
  const nonExecutionStatuses = checkEvidence.filter((item) => !isExecutionEvidence(item));
  const failedNonExecutionStatuses = nonExecutionStatuses.filter((item) => statusFromSummary(item.summary) === "failed");
  const prDescriptionText = evidence
    .filter((item) => item.kind === "pr_description")
    .map((item) => `${item.label ?? ""} ${item.summary ?? ""}`)
    .join("\n");
  const timings = timingPhases(timingHeader);
  const limitations = Array.isArray(report.limitations) ? report.limitations.join(" ") : "";

  return {
    issueFetched: evidence.some((item) => item.kind === "task" && /Linked issue/i.test(`${item.label ?? ""} ${item.summary ?? ""}`)),
    prBodyFetched: evidence.some((item) => item.kind === "pr_description") || Boolean(report.source?.title),
    changedFilesFetched: evidence.some((item) => item.kind === "changed_file" || item.kind === "diff" || item.kind === "test"),
    workflowRunsFetched: timings.has("github_checks") || timings.has("github_jobs") || /GitHub Actions metadata/i.test(limitations),
    commitStatusesFetched: timings.has("github_statuses") || /commit status metadata/i.test(limitations),
    rawLogsFetched: false,
    testBuildExecutionEvidenceFound: executionEvidence.length > 0,
    failedExecutionEvidenceFound: failedExecutionEvidence.length > 0,
    selfReportedTestingFound: /\b(testing|tests?|pytest|tox|vitest|jest|playwright|cypress)\b.+\b(passed|ran|run|success|failed)\b/i.test(prDescriptionText),
    changedTestFilesFound: evidence.some((item) => item.kind === "test"),
    nonExecutionStatusesFound: nonExecutionStatuses.length > 0,
    failedNonExecutionStatusesFound: failedNonExecutionStatuses.length > 0,
    executionEvidenceCount: executionEvidence.length,
    failedExecutionEvidenceCount: failedExecutionEvidence.length,
    nonExecutionStatusCount: nonExecutionStatuses.length,
    failedNonExecutionStatusCount: failedNonExecutionStatuses.length
  };
}

function isExecutionEvidence(item) {
  const label = String(item?.label ?? "");
  const summary = String(item?.summary ?? "");
  const locator = String(item?.locator ?? "");
  const status = statusFromSummary(summary);
  const text = `${label} ${summary}`;

  if (NON_EXECUTION_PATTERN.test(text) && !DIRECT_EXECUTION_PATTERN.test(text)) {
    return false;
  }

  if (
    STATIC_ONLY_PATTERN.test(text) &&
    !STRONG_EXECUTION_PATTERN.test(text) &&
    !WEAK_EXECUTION_PATTERN.test(text) &&
    !DIRECT_EXECUTION_PATTERN.test(text)
  ) {
    return false;
  }

  if (
    (status === "failed" || status === "pending") &&
    GITHUB_ACTIONS_JOB_URL_PATTERN.test(locator) &&
    !CANCELLED_OR_OPTIONAL_PATTERN.test(text) &&
    MATRIX_EXECUTION_JOB_PATTERN.test(label)
  ) {
    return true;
  }

  return DIRECT_EXECUTION_PATTERN.test(text) ||
    STRONG_EXECUTION_PATTERN.test(text) ||
    (WEAK_EXECUTION_PATTERN.test(text) && !NON_EXECUTION_PATTERN.test(text));
}

function statusFromSummary(summary) {
  const match = String(summary ?? "").trim().match(/^Status:\s*(passed|failed|pending|unknown)\b/i);
  return match ? match[1].toLowerCase() : "unknown";
}

function quickAssessmentForReport(report, diagnostics, proofGraphDiagnostics) {
  const unsupported = unsupportedClaims(report);
  const possibleFalsePass = report.testing?.ciStatus === "passed" && diagnostics.failedExecutionEvidenceFound;
  const possibleFalseBlocker = report.testing?.ciStatus === "failed" && !diagnostics.failedExecutionEvidenceFound;

  return {
    looksUsefulFor30SecondReview: report?.summary && Array.isArray(report.reviewPriority) ? "yes" : "unclear",
    obviousProblem: obviousProblem(unsupported, possibleFalsePass, possibleFalseBlocker),
    stayedEvidenceVerifierFocused: unsupported.length === 0,
    unsupportedMergeSecurityCorrectnessClaims: unsupported,
    possibleFalsePass,
    possibleFalseBlocker,
    proofGraphUsedInJudgment: Boolean(proofGraphDiagnostics?.proofGraphUsedInJudgment?.usedInRequirementGaps)
  };
}

function beforeAfter(previous, current) {
  if (!previous || !current) return null;

  return {
    priority: { before: previous.priority ?? null, after: current.priority },
    testBuildStatus: { before: previous.testBuildStatus ?? null, after: current.testBuildStatus },
    missingTestCount: { before: previous.missingTestCount ?? null, after: current.missingTestCount },
    firstReviewPriorityFiles: {
      before: boundedStrings(previous.firstReviewPriorityFiles, 6),
      after: boundedStrings(current.firstReviewPriorityFiles, 6)
    },
    topRisksChanged: JSON.stringify(previous.topRisks ?? []) !== JSON.stringify(current.topRisks ?? []),
    limitationsChanged: JSON.stringify(previous.limitations ?? []) !== JSON.stringify(current.limitations ?? [])
  };
}

function compactPreviousSummary(summary) {
  if (!summary) return null;
  return {
    priority: summary.priority ?? null,
    testBuildStatus: summary.testBuildStatus ?? null,
    missingTestCount: typeof summary.missingTestCount === "number" ? summary.missingTestCount : null,
    firstReviewPriorityFiles: boundedStrings(summary.firstReviewPriorityFiles, 6),
    topRisks: boundedStrings(summary.topRisks, 4)
  };
}

function requirementCounts(requirements) {
  const counts = { met: 0, partial: 0, missing: 0, unclear: 0 };
  for (const requirement of Array.isArray(requirements) ? requirements : []) {
    if (requirement?.status in counts) counts[requirement.status] += 1;
  }
  return counts;
}

function summarizeReprompt(report) {
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  const partial = requirements.filter((item) => item.status === "partial").length;
  const missing = requirements.filter((item) => item.status === "missing").length;
  const unclear = requirements.filter((item) => item.status === "unclear").length;
  const missingTests = Array.isArray(report.testing?.missingTests) ? report.testing.missingTests.length : 0;
  const proofGaps = Array.isArray(report.proofGraph?.nodes)
    ? report.proofGraph.nodes.reduce((count, node) => count + (node.gapSignals?.length ?? 0), 0)
    : 0;
  const failed = report.testing?.ciStatus === "failed";
  const parts = [
    partial ? `${partial} partial requirement(s)` : "",
    missing ? `${missing} missing requirement(s)` : "",
    unclear ? `${unclear} unclear requirement(s)` : "",
    missingTests ? `${missingTests} missing targeted test lead(s)` : "",
    failed ? "failing test/build evidence" : "",
    proofGaps ? `${proofGaps} proofGraph gap signal(s)` : ""
  ].filter(Boolean);

  return `Summary-only: asks the agent to address ${parts.length > 0 ? parts.join(", ") : "remaining evidence mapping"}, keep scope tied to the original request, and return concise evidence for reviewer verification.`;
}

function unsupportedClaims(report) {
  const text = [
    report.summary?.oneLine,
    ...(report.summary?.topRisks ?? []),
    ...(report.limitations ?? [])
  ].filter(Boolean).join("\n");

  return boundedStrings(text.match(/\b(?:safe to merge|approved to merge|secure|security verified|correct implementation|production ready)\b/gi) ?? [], 5);
}

function obviousProblem(unsupported, possibleFalsePass, possibleFalseBlocker) {
  if (possibleFalsePass) return "Possible false pass: report says passed while failed execution evidence was detected.";
  if (possibleFalseBlocker) return "Possible false blocker: report says failed without failed execution evidence in summary diagnostics.";
  if (unsupported.length > 0) return "Report made unsupported merge/security/correctness-like claims.";
  return null;
}

function summarizeResults(results) {
  const completed = results.filter((item) => item.analysisStatus === "completed");
  const statuses = {};
  const priorities = {};

  for (const result of completed) {
    const status = result.reportSummary?.testBuildStatus ?? "unknown";
    const priority = result.reportSummary?.priority ?? "medium";
    statuses[status] = (statuses[status] ?? 0) + 1;
    priorities[priority] = (priorities[priority] ?? 0) + 1;
  }

  return {
    completedCount: completed.length,
    failedCount: results.filter((item) => item.analysisStatus === "failed").length,
    skippedCount: results.filter((item) => item.analysisStatus === "skipped").length,
    testBuildStatusCounts: statuses,
    priorityCounts: priorities,
    possibleFalsePassCount: completed.filter((item) => item.quickAssessment?.possibleFalsePass).length,
    possibleFalseBlockerCount: completed.filter((item) => item.quickAssessment?.possibleFalseBlocker).length,
    proofGraphUsedCount: completed.filter((item) => item.quickAssessment?.proofGraphUsedInJudgment).length
  };
}

function sourcePolicy(notes) {
  return {
    publicOnly: true,
    noPrivateRepos: true,
    noTokensStored: true,
    noRawFullLogs: true,
    noRawDiffs: true,
    noPrivateUserData: true,
    noRawPrompts: true,
    correctnessLabelsCompleted: false,
    notes: [
      ...notes,
      "Results are AgentProof output summaries for human review only.",
      "AgentProof output is not treated as truth.",
      "Manual labels remain incomplete and must not be inferred from these results.",
      "The full report is processed in memory only; output files store summary-only fields."
    ]
  };
}

function timingPhases(header) {
  if (!header) return new Set();

  return new Set(String(header)
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean));
}

function transientGithubToken() {
  if (process.env.AGENTPROOF_EVAL_GITHUB_TOKEN?.trim()) {
    return process.env.AGENTPROOF_EVAL_GITHUB_TOKEN.trim();
  }

  try {
    return execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim() || null;
  } catch {
    return null;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readOptionalJson(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function writeOutput(path, value) {
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

function boundedStrings(value, limit = 8) {
  return uniqueStrings(Array.isArray(value) ? value : [])
    .map((item) => safeText(item, 240))
    .filter(Boolean)
    .slice(0, limit);
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function safeText(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
