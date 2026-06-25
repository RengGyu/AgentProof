import {
  buildEvidenceIndex,
  extractClaims,
  extractRequirements,
  fileKeywords,
  isRiskFile,
  isTestFile
} from "./extractors";
import type {
  CheckStatus,
  EvidenceItem,
  MissingTestFinding,
  PriorityLevel,
  PullRequestInput,
  Requirement,
  RequirementFinding,
  ReviewPriorityItem,
  VerificationReport
} from "./types";

export function generateVerificationReport(input: PullRequestInput): VerificationReport {
  const evidenceIndex = buildEvidenceIndex(
    input.taskText,
    input.description,
    input.changedFiles,
    input.checks,
    input.logs
  );
  const requirements = extractRequirements(input.taskText, input.description);
  const requirementFindings = requirements.map((requirement) =>
    evaluateRequirement(requirement, evidenceIndex, input)
  );
  const scope = detectScopeCreep(requirements, input.changedFiles, evidenceIndex);
  const missingTests = detectMissingTests(input, evidenceIndex);
  const ciStatus = aggregateStatus(input.checks, input.logs);
  const lintStatus = statusForCheck(input.checks, /lint/i);
  const typecheckStatus = statusForCheck(input.checks, /type(check|script)/i);
  const reviewPriority = buildReviewPriority(input, requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, evidenceIndex);
  const priority = highestPriority(reviewPriority);
  const limitations = buildLimitations(input, requirementFindings, ciStatus);
  const evidenceCoverage = computeEvidenceCoverage(
    requirementFindings,
    input.changedFiles.length,
    missingTests.length,
    scope.outOfScopeFiles.length,
    ciStatus,
    limitations.length
  );
  const topRisks = buildTopRisks(requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus);
  const reprompt = buildReprompt(requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus);
  const claims = extractClaims(input.description, evidenceIndex);

  return {
    analysisId: `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source: {
      title: input.title,
      url: input.url,
      author: input.author,
      baseBranch: input.baseBranch,
      headBranch: input.headBranch
    },
    summary: {
      oneLine: summarize(priority, evidenceCoverage, topRisks),
      confidence: computeSummaryConfidence(evidenceCoverage, priority, limitations.length),
      priority,
      evidenceCoverage,
      topRisks
    },
    requirements: requirementFindings,
    claims,
    scope: {
      suspected: scope.outOfScopeFiles.length > 0,
      outOfScopeFiles: scope.outOfScopeFiles,
      reasons: scope.reasons,
      evidenceRefs: scope.evidenceRefs
    },
    testing: {
      ciStatus,
      lintStatus,
      typecheckStatus,
      missingTests
    },
    reviewPriority,
    reprompt: {
      targetAgent: "codex",
      prompt: reprompt
    },
    evidenceIndex,
    limitations
  };
}

function evaluateRequirement(
  requirement: Requirement,
  evidenceIndex: EvidenceItem[],
  input: PullRequestInput
): RequirementFinding {
  if (requirement.keywords.length === 0) {
    const refs = sourceEvidenceRefs(evidenceIndex);

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "unclear",
      evidenceRefs: refs,
      gaps: ["The task is too vague to map to concrete PR evidence."],
      reviewerNote: "Ask for explicit acceptance criteria before trusting this result.",
      confidence: 0.25
    };
  }

  const matches = evidenceIndex
    .map((item) => ({ item, match: requirementEvidenceMatch(requirement, item) }))
    .filter(({ match }) => match.score > 0);
  const refs = matches.map(({ item }) => item.id);

  const implementationMatches = matches.filter(({ item }) =>
    item.kind === "changed_file" || item.kind === "diff"
  );
  const strongImplementationRefs = implementationMatches
    .filter(({ item, match }) => item.kind === "diff" && match.strong)
    .map(({ item }) => item.id);
  const hasImplementationEvidence = implementationMatches.length > 0;
  const hasStrongImplementationEvidence = strongImplementationRefs.length > 0;
  const asksForTests = /\b(tests?|coverage|specs?)\b/i.test(requirement.text);
  const hasMatchingTestArtifactEvidence = matches.some(({ item, match }) => item.kind === "test" && match.strong);
  const hasMatchingPassingTestExecutionEvidence = matches.some(({ item, match }) =>
    match.strong && isPassingTestExecutionEvidence(item)
  );
  const failedCheck = input.checks.some((check) => check.status === "failed") ||
    input.logs.some((log) => log.status === "failed");

  if (failedCheck) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: hasImplementationEvidence ? "partial" : "unclear",
      evidenceRefs: refs,
      gaps: ["CI has a failing check, so requirement satisfaction is not proven."],
      reviewerNote: "Review failed checks before relying on implementation evidence.",
      confidence: hasImplementationEvidence ? 0.45 : 0.25
    };
  }

  if (asksForTests && hasMatchingTestArtifactEvidence && hasMatchingPassingTestExecutionEvidence && !failedCheck) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "met",
      evidenceRefs: refsForReport(matches, strongImplementationRefs),
      gaps: [],
      reviewerNote: "Test evidence appears connected to this criterion.",
      confidence: 0.82
    };
  }

  if (asksForTests && hasMatchingTestArtifactEvidence && !hasMatchingPassingTestExecutionEvidence) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "partial",
      evidenceRefs: refsForReport(matches, strongImplementationRefs),
      gaps: ["Test files changed, but no passing test check or log proves those tests executed."],
      reviewerNote: "Request the exact passing test command or CI check tied to this criterion.",
      confidence: 0.52
    };
  }

  if (asksForTests && !hasMatchingTestArtifactEvidence) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: hasImplementationEvidence ? "partial" : "missing",
      evidenceRefs: refs,
      gaps: ["The requirement asks for tests, but no matching test evidence was found."],
      reviewerNote: "Request test evidence tied to this criterion.",
      confidence: hasImplementationEvidence ? 0.55 : 0.3
    };
  }

  if (hasStrongImplementationEvidence && refs.length > 0) {
    if (!hasMatchingPassingTestExecutionEvidence) {
      return {
        requirementId: requirement.id,
        requirementText: requirement.text,
        status: "partial",
        evidenceRefs: refsForReport(matches, strongImplementationRefs),
        gaps: ["Implementation evidence exists, but no matching test, log, or check evidence verifies this criterion."],
        reviewerNote: "Treat diff evidence as implementation evidence, not proof that behavior is verified.",
        confidence: 0.62
      };
    }

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "met",
      evidenceRefs: refsForReport(matches, strongImplementationRefs),
      gaps: [],
      reviewerNote: "Evidence appears connected to this criterion.",
      confidence: 0.85
    };
  }

  if (hasImplementationEvidence && refs.length > 0) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "partial",
      evidenceRefs: refs.slice(0, 5),
      gaps: ["A related file changed, but no diff, test, or log evidence proves this criterion."],
      reviewerNote: "Treat this as a lead for human review, not proof of satisfaction.",
      confidence: 0.5
    };
  }

  return {
    requirementId: requirement.id,
    requirementText: requirement.text,
    status: refs.length > 0 ? "unclear" : "missing",
    evidenceRefs: refs.slice(0, 3),
    gaps: ["No changed-file evidence clearly maps to this criterion."],
    reviewerNote: "Ask the coding agent to connect implementation changes to this requirement.",
    confidence: refs.length > 0 ? 0.38 : 0.2
  };
}

function requirementEvidenceMatch(
  requirement: Requirement,
  item: EvidenceItem
): { score: number; strong: boolean } {
  const text = `${item.label} ${item.summary}`.toLowerCase();
  const hits = requirement.keywords.filter((keyword) => text.includes(keyword));
  const meaningfulHits = hits.filter((keyword) => keyword.length >= 4 && !WEAK_SINGLE_MATCH_KEYWORDS.has(keyword));
  const score = hits.length;
  const canProve = item.kind === "diff" || item.kind === "test" || item.kind === "log" || item.kind === "check";
  const strong = canProve && (meaningfulHits.length >= 2 || meaningfulHits.some((keyword) => keyword.length >= 8));

  return { score, strong };
}

function refsForReport(
  matches: Array<{ item: EvidenceItem; match: { score: number; strong: boolean } }>,
  preferredRefs: string[]
): string[] {
  return Array.from(new Set([
    ...preferredRefs,
    ...matches.filter(({ match }) => match.strong).map(({ item }) => item.id),
    ...matches.map(({ item }) => item.id)
  ])).slice(0, 5);
}

const WEAK_SINGLE_MATCH_KEYWORDS = new Set([
  "api",
  "app",
  "auth",
  "code",
  "data",
  "edge",
  "file",
  "node",
  "page",
  "pages",
  "route",
  "test",
  "tests",
  "user"
]);

const TEST_EXECUTION_PATTERN = /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|coverage|ci|build)\b/i;
const PASSING_EXECUTION_PATTERN = /\b(pass|passed|success|succeeded|green)\b/i;

function isPassingTestExecutionEvidence(item: EvidenceItem): boolean {
  return (item.kind === "check" || item.kind === "log") &&
    TEST_EXECUTION_PATTERN.test(`${item.label} ${item.summary}`) &&
    PASSING_EXECUTION_PATTERN.test(item.summary);
}

function detectScopeCreep(
  requirements: Requirement[],
  files: PullRequestInput["changedFiles"],
  evidenceIndex: EvidenceItem[]
) {
  const requirementKeywords = new Set(requirements.flatMap((requirement) => requirement.keywords));

  if (requirementKeywords.size === 0) {
    return {
      outOfScopeFiles: [],
      evidenceRefs: [],
      reasons: []
    };
  }

  const outOfScopeFiles = files
    .filter((file) => !isTestFile(file.path))
    .filter((file) => {
      const keywords = fileKeywords(file.path);
      const directMatch = keywords.some((keyword) =>
        Array.from(requirementKeywords).some(
          (requirementKeyword) =>
            requirementKeyword === keyword ||
            requirementKeyword.includes(keyword) ||
            keyword.includes(requirementKeyword)
        )
      );
      return !directMatch && (isRiskFile(file.path) || files.length > 3);
    })
    .map((file) => file.path);

  return {
    outOfScopeFiles,
    evidenceRefs: uniqueRefs(outOfScopeFiles.flatMap((path) => evidenceRefsForPath(evidenceIndex, path))),
    reasons: outOfScopeFiles.map((path) =>
      isRiskFile(path)
        ? `${path} is risk-sensitive and does not clearly map to the stated criteria.`
        : `${path} does not clearly map to the stated criteria.`
    )
  };
}

function detectMissingTests(input: PullRequestInput, evidenceIndex: EvidenceItem[]): MissingTestFinding[] {
  const testFiles = input.changedFiles.filter((file) => isTestFile(file.path));
  const hasTestFileChange = testFiles.length > 0;
  const hasPassingTestSignal =
    input.checks.some((check) => /test|spec/i.test(`${check.name} ${check.summary ?? ""}`) && check.status === "passed") ||
    input.logs.some((log) => /test|spec/i.test(`${log.source} ${log.text}`) && log.status === "passed");
  const changedImplementationFiles = input.changedFiles.filter(
    (file) => !isTestFile(file.path) && /\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|cs)$/.test(file.path)
  );

  if (changedImplementationFiles.length === 0) {
    return [];
  }

  const testEvidenceRefs = evidenceIndex.filter((item) => item.kind === "test" || /test/i.test(item.summary)).map((item) => item.id);

  return changedImplementationFiles
    .filter((file) => !hasMatchingVerifiedTestEvidence(file.path, testFiles, hasPassingTestSignal))
    .slice(0, 8)
    .map((file) => {
      const hasRelatedTestFile = testFiles.some((testFile) => pathsLookRelated(file.path, testFile.path));

      return {
        path: file.path,
        why: hasRelatedTestFile
          ? "A related test file changed, but no passing test check or log was provided."
          : hasTestFileChange
            ? "Test evidence changed, but none clearly maps to this implementation file."
            : "Behavior-affecting file changed without matching test-file evidence.",
        evidenceRefs: uniqueRefs([...evidenceRefsForPath(evidenceIndex, file.path), ...testEvidenceRefs]).slice(0, 5)
      };
    });
}

function hasMatchingVerifiedTestEvidence(
  implementationPath: string,
  testFiles: PullRequestInput["changedFiles"],
  hasPassingTestSignal: boolean
): boolean {
  return hasPassingTestSignal && testFiles.some((testFile) => pathsLookRelated(implementationPath, testFile.path));
}

function pathsLookRelated(implementationPath: string, testPath: string): boolean {
  const implementationStem = fileStem(implementationPath);
  const testStem = fileStem(testPath);

  if (implementationStem && testStem && (testStem.includes(implementationStem) || implementationStem.includes(testStem))) {
    return true;
  }

  const implementationKeywords = new Set(fileKeywords(implementationPath).filter((keyword) => keyword.length >= 4));
  const sharedKeywords = fileKeywords(testPath).filter((keyword) => implementationKeywords.has(keyword) && keyword.length >= 4);

  return sharedKeywords.length >= 2;
}

function fileStem(path: string): string {
  const filename = path.split(/[\\/]/).pop() ?? path;

  return filename
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function buildReviewPriority(
  input: PullRequestInput,
  requirements: RequirementFinding[],
  outOfScopeFiles: string[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus,
  evidenceIndex: EvidenceItem[]
): ReviewPriorityItem[] {
  const items: ReviewPriorityItem[] = [];
  const sourceRefs = sourceEvidenceRefs(evidenceIndex);

  if (ciStatus === "failed") {
    items.push({
      path: "CI checks",
      reason: "At least one check failed; requirement satisfaction is not proven.",
      priority: "blocker",
      evidenceRefs: evidenceIndex
        .filter((item) => (item.kind === "check" || item.kind === "log") && /\bfailed\b/i.test(item.summary))
        .map((item) => item.id)
    });
  }

  const missingRequirements = requirements.filter((finding) => finding.status === "missing");
  const unclearRequirements = requirements.filter((finding) => finding.status === "unclear");
  const partialRequirements = requirements.filter((finding) => finding.status === "partial");

  if (missingRequirements.length > 0) {
    items.push({
      path: "Requirement evidence",
      reason: `${missingRequirements.length} requirement(s) have no matching implementation evidence.`,
      priority: "high",
      evidenceRefs: refsForFindings(missingRequirements, sourceRefs)
    });
  }

  if (unclearRequirements.length > 0) {
    items.push({
      path: "Requirement evidence",
      reason: `${unclearRequirements.length} requirement(s) need human interpretation before trusting the report.`,
      priority: "medium",
      evidenceRefs: refsForFindings(unclearRequirements, sourceRefs)
    });
  }

  if (partialRequirements.length > 0) {
    items.push({
      path: "Requirement evidence",
      reason: `${partialRequirements.length} requirement(s) have only partial evidence.`,
      priority: "medium",
      evidenceRefs: refsForFindings(partialRequirements, sourceRefs)
    });
  }

  for (const path of outOfScopeFiles.slice(0, 6)) {
    items.push({
      path,
      reason: isRiskFile(path)
        ? "Risk-sensitive file appears outside the stated requirement."
        : "Changed file does not clearly map to acceptance criteria.",
      priority: isRiskFile(path) ? "high" : "medium",
      evidenceRefs: evidenceRefsForPath(evidenceIndex, path)
    });
  }

  for (const missing of missingTests.slice(0, 6)) {
    items.push({
      path: missing.path,
      reason: missing.why,
      priority: isRiskFile(missing.path) ? "high" : "medium",
      evidenceRefs: missing.evidenceRefs
    });
  }

  for (const file of input.changedFiles.filter((changed) => isRiskFile(changed.path) && !isTestFile(changed.path)).slice(0, 6)) {
    if (!items.some((item) => item.path === file.path)) {
      const hasSpecificRisk = outOfScopeFiles.includes(file.path) || missingTests.some((missing) => missing.path === file.path);
      items.push({
        path: file.path,
        reason: "Risk-sensitive path changed; verify manually even if other evidence passes.",
        priority: hasSpecificRisk ? "high" : "medium",
        evidenceRefs: evidenceRefsForPath(evidenceIndex, file.path)
      });
    }
  }

  if (items.length === 0) {
    items.push({
      path: "Changed files",
      reason: "No blocker found from deterministic evidence; spot-check requirement mapping.",
      priority: "low",
      evidenceRefs: evidenceIndex
        .filter((item) => item.kind === "changed_file" || item.kind === "diff" || item.kind === "test")
        .map((item) => item.id)
        .slice(0, 5)
    });
  }

  return items;
}

function evidenceRefsForPath(evidenceIndex: EvidenceItem[], path: string): string[] {
  return evidenceIndex
    .filter((item) => item.locator === path || item.label === path)
    .map((item) => item.id);
}

function sourceEvidenceRefs(evidenceIndex: EvidenceItem[]): string[] {
  return evidenceIndex
    .filter((item) => item.kind === "task" || item.kind === "pr_description")
    .map((item) => item.id)
    .slice(0, 2);
}

function refsForFindings(findings: RequirementFinding[], fallbackRefs: string[]): string[] {
  const refs = uniqueRefs(findings.flatMap((finding) => finding.evidenceRefs));
  return (refs.length > 0 ? refs : fallbackRefs).slice(0, 5);
}

function uniqueRefs(refs: string[]): string[] {
  return Array.from(new Set(refs));
}

function buildReprompt(
  requirements: RequirementFinding[],
  outOfScopeFiles: string[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus
): string {
  const actions: string[] = [];
  const weakRequirements = requirements.filter((finding) => finding.status !== "met");

  for (const finding of weakRequirements.slice(0, 4)) {
    actions.push(`Address requirement "${finding.requirementText}" and provide evidence for the implementation.`);
  }

  if (outOfScopeFiles.length > 0) {
    actions.push(`Explain or revert out-of-scope changes in: ${outOfScopeFiles.slice(0, 5).join(", ")}.`);
  }

  if (missingTests.length > 0) {
    actions.push(`Add or identify tests that cover: ${missingTests.slice(0, 5).map((item) => item.path).join(", ")}.`);
  }

  if (ciStatus === "failed") {
    actions.push("Fix the failing CI check and summarize the exact log line that proves it now passes.");
  }

  if (actions.length === 0) {
    actions.push("Summarize how each acceptance criterion maps to the changed files and test evidence.");
  }

  return [
    "You are revising an AI-generated PR for AgentProof verification.",
    "Do not broaden the PR. Make only changes tied to the original task.",
    ...actions.map((action, index) => `${index + 1}. ${action}`),
    "Return a concise summary with changed files, tests run, and remaining risks."
  ].join("\n");
}

function aggregateStatus(checks: PullRequestInput["checks"], logs: PullRequestInput["logs"] = []): CheckStatus {
  const allStatuses = [
    ...checks.map((check) => check.status),
    ...logs.map((log) => log.status).filter((status): status is CheckStatus => Boolean(status))
  ];
  const executionStatuses = [
    ...checks
      .filter((check) => isExecutionSignal(`${check.name} ${check.summary ?? ""}`))
      .map((check) => check.status),
    ...logs
      .filter((log) => isExecutionSignal(`${log.source} ${log.text}`))
      .map((log) => log.status)
      .filter((status): status is CheckStatus => Boolean(status))
  ];

  if (allStatuses.length === 0) {
    return "unknown";
  }

  if (allStatuses.some((status) => status === "failed")) {
    return "failed";
  }

  if (executionStatuses.some((status) => status === "pending")) {
    return "pending";
  }

  if (executionStatuses.length > 0 && executionStatuses.every((status) => status === "passed")) {
    return "passed";
  }

  return "unknown";
}

function isExecutionSignal(text: string): boolean {
  return TEST_EXECUTION_PATTERN.test(text);
}

function statusForCheck(checks: PullRequestInput["checks"], pattern: RegExp): CheckStatus {
  const check = checks.find((item) => pattern.test(item.name));
  return check?.status ?? "unknown";
}

function highestPriority(items: ReviewPriorityItem[]): PriorityLevel {
  const order: PriorityLevel[] = ["blocker", "high", "medium", "low"];
  return order.find((level) => items.some((item) => item.priority === level)) ?? "low";
}

function computeEvidenceCoverage(
  requirements: RequirementFinding[],
  changedFileCount: number,
  missingTestCount: number,
  outOfScopeFileCount: number,
  ciStatus: CheckStatus,
  limitationCount: number
): number {
  if (requirements.length === 0) {
    return 0;
  }

  const requirementScore =
    requirements.reduce((score, finding) => {
      if (finding.status === "met") return score + 1;
      if (finding.status === "partial") return score + 0.55;
      if (finding.status === "unclear") return score + 0.25;
      return score;
    }, 0) / requirements.length;
  const filePenalty = changedFileCount > 25 ? 0.75 : changedFileCount > 10 ? 0.9 : 1;
  const missingTestPenalty = Math.max(0.65, 1 - missingTestCount * 0.1);
  const scopePenalty = Math.max(0.7, 1 - outOfScopeFileCount * 0.1);
  const ciPenalty = ciStatus === "failed" ? 0.55 : ciStatus === "unknown" || ciStatus === "pending" ? 0.85 : 1;
  const limitationPenalty = Math.max(0.85, 1 - limitationCount * 0.04);

  return Math.round(requirementScore * filePenalty * missingTestPenalty * scopePenalty * ciPenalty * limitationPenalty * 100);
}

function computeSummaryConfidence(evidenceCoverage: number, priority: PriorityLevel, limitationCount: number): number {
  const priorityCap: Record<PriorityLevel, number> = {
    low: 0.95,
    medium: 0.82,
    high: 0.72,
    blocker: 0.45
  };
  const limitationPenalty = Math.max(0.85, 1 - limitationCount * 0.03);
  const confidence = Math.min(evidenceCoverage / 100, priorityCap[priority]) * limitationPenalty;

  return round2(Math.max(0.2, confidence));
}

function buildTopRisks(
  requirements: RequirementFinding[],
  outOfScopeFiles: string[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus
): string[] {
  const risks: string[] = [];

  if (ciStatus === "failed") risks.push("CI failed, so the PR is not proven ready.");
  if (requirements.some((finding) => finding.status === "missing")) risks.push("One or more requirements have no matching implementation evidence.");
  if (requirements.some((finding) => finding.status === "unclear")) risks.push("Some requirements are too vague or weakly evidenced.");
  if (requirements.some((finding) => finding.status === "partial")) risks.push("Some requirements have only partial evidence.");
  if (missingTests.length > 0) risks.push("Behavior changed without strong test evidence.");
  if (outOfScopeFiles.length > 0) risks.push("Potential scope creep in changed files.");

  return risks.length > 0 ? risks.slice(0, 4) : ["No major blocker found from available evidence."];
}

function buildLimitations(
  input: PullRequestInput,
  requirements: RequirementFinding[],
  ciStatus: CheckStatus
): string[] {
  const limitations: string[] = [];

  limitations.push(...(input.limitations ?? []));
  if (!input.taskText.trim()) limitations.push("No original task text was provided; criteria were inferred from PR description.");
  if (input.logs.length === 0) limitations.push("No CI or test logs were available.");
  if (ciStatus === "unknown") limitations.push("Check status is unknown or incomplete.");
  if (requirements.some((finding) => finding.status === "unclear")) {
    limitations.push("At least one requirement needs human interpretation.");
  }

  return limitations;
}

function summarize(priority: PriorityLevel, evidenceCoverage: number, topRisks: string[]): string {
  if (priority === "blocker") {
    return `Blocked by evidence failure. Coverage ${evidenceCoverage}%. ${topRisks[0]}`;
  }

  if (priority === "high") {
    return `High-priority review needed. Coverage ${evidenceCoverage}%. ${topRisks[0]}`;
  }

  if (priority === "medium") {
    return `Some evidence is weak. Coverage ${evidenceCoverage}%. ${topRisks[0]}`;
  }

  return `Evidence looks mostly aligned. Coverage ${evidenceCoverage}%.`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
