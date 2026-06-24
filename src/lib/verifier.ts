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
  const scope = detectScopeCreep(requirements, input.changedFiles);
  const missingTests = detectMissingTests(input, evidenceIndex);
  const ciStatus = aggregateStatus(input.checks);
  const lintStatus = statusForCheck(input.checks, /lint/i);
  const typecheckStatus = statusForCheck(input.checks, /type(check|script)/i);
  const reviewPriority = buildReviewPriority(input, scope.outOfScopeFiles, missingTests, ciStatus);
  const priority = highestPriority(reviewPriority);
  const evidenceCoverage = computeEvidenceCoverage(requirementFindings, input.changedFiles.length);
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
      confidence: round2(Math.max(0.2, evidenceCoverage / 100)),
      priority,
      evidenceCoverage,
      topRisks
    },
    requirements: requirementFindings,
    claims,
    scope: {
      suspected: scope.outOfScopeFiles.length > 0,
      outOfScopeFiles: scope.outOfScopeFiles,
      reasons: scope.reasons
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
    limitations: buildLimitations(input, requirementFindings, ciStatus)
  };
}

function evaluateRequirement(
  requirement: Requirement,
  evidenceIndex: EvidenceItem[],
  input: PullRequestInput
): RequirementFinding {
  if (requirement.keywords.length === 0) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "unclear",
      evidenceRefs: [],
      gaps: ["The task is too vague to map to concrete PR evidence."],
      reviewerNote: "Ask for explicit acceptance criteria before trusting this result.",
      confidence: 0.25
    };
  }

  const refs = evidenceIndex
    .filter((item) => {
      const text = `${item.label} ${item.summary}`.toLowerCase();
      return requirement.keywords.some((keyword) => text.includes(keyword));
    })
    .map((item) => item.id);

  const hasImplementationEvidence = refs.some((ref) => {
    const item = evidenceIndex.find((evidence) => evidence.id === ref);
    return item?.kind === "changed_file" || item?.kind === "diff";
  });
  const asksForTests = /\b(tests?|coverage|specs?)\b/i.test(requirement.text);
  const hasTestEvidence = refs.some((ref) => {
    const item = evidenceIndex.find((evidence) => evidence.id === ref);
    return Boolean(item && (item.kind === "test" || /test|spec|passed/i.test(item.summary)));
  });
  const failedCheck = input.checks.some((check) => check.status === "failed");

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

  if (asksForTests && hasTestEvidence && !failedCheck) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "met",
      evidenceRefs: refs.slice(0, 5),
      gaps: [],
      reviewerNote: "Test evidence appears connected to this criterion.",
      confidence: 0.82
    };
  }

  if (asksForTests && !hasTestEvidence) {
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

  if (hasImplementationEvidence && refs.length > 0) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "met",
      evidenceRefs: refs.slice(0, 5),
      gaps: hasTestEvidence ? [] : ["Implementation evidence exists, but test coverage is not strongly tied to this criterion."],
      reviewerNote: hasTestEvidence
        ? "Evidence appears connected to this criterion."
        : "Check the changed code path manually if this behavior is important.",
      confidence: hasTestEvidence ? 0.85 : 0.68
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

function detectScopeCreep(requirements: Requirement[], files: PullRequestInput["changedFiles"]) {
  const requirementKeywords = new Set(requirements.flatMap((requirement) => requirement.keywords));
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
    reasons: outOfScopeFiles.map((path) =>
      isRiskFile(path)
        ? `${path} is risk-sensitive and does not clearly map to the stated criteria.`
        : `${path} does not clearly map to the stated criteria.`
    )
  };
}

function detectMissingTests(input: PullRequestInput, evidenceIndex: EvidenceItem[]): MissingTestFinding[] {
  const hasTestFileChange = input.changedFiles.some((file) => isTestFile(file.path));
  const hasPassingTestCheck = input.checks.some((check) => /test|spec/i.test(check.name) && check.status === "passed");
  const changedImplementationFiles = input.changedFiles.filter(
    (file) => !isTestFile(file.path) && /\.(ts|tsx|js|jsx|py|rb|go|rs|java|kt|cs)$/.test(file.path)
  );

  if (changedImplementationFiles.length === 0 || (hasTestFileChange && hasPassingTestCheck)) {
    return [];
  }

  const testEvidenceRefs = evidenceIndex.filter((item) => item.kind === "test" || /test/i.test(item.summary)).map((item) => item.id);

  return changedImplementationFiles.slice(0, 8).map((file) => ({
    path: file.path,
    why: hasTestFileChange
      ? "A test file changed, but no passing test check was provided."
      : "Behavior-affecting file changed without matching test-file evidence.",
    evidenceRefs: testEvidenceRefs
  }));
}

function buildReviewPriority(
  input: PullRequestInput,
  outOfScopeFiles: string[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus
): ReviewPriorityItem[] {
  const items: ReviewPriorityItem[] = [];

  if (ciStatus === "failed") {
    items.push({
      path: "CI checks",
      reason: "At least one check failed; requirement satisfaction is not proven.",
      priority: "blocker"
    });
  }

  for (const path of outOfScopeFiles.slice(0, 6)) {
    items.push({
      path,
      reason: isRiskFile(path)
        ? "Risk-sensitive file appears outside the stated requirement."
        : "Changed file does not clearly map to acceptance criteria.",
      priority: isRiskFile(path) ? "high" : "medium"
    });
  }

  for (const missing of missingTests.slice(0, 6)) {
    items.push({
      path: missing.path,
      reason: missing.why,
      priority: isRiskFile(missing.path) ? "high" : "medium"
    });
  }

  for (const file of input.changedFiles.filter((changed) => isRiskFile(changed.path) && !isTestFile(changed.path)).slice(0, 6)) {
    if (!items.some((item) => item.path === file.path)) {
      items.push({
        path: file.path,
        reason: "Risk-sensitive path changed; verify manually even if other evidence passes.",
        priority: "high"
      });
    }
  }

  if (items.length === 0) {
    items.push({
      path: "Changed files",
      reason: "No blocker found from deterministic evidence; spot-check requirement mapping.",
      priority: "low"
    });
  }

  return items;
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

function aggregateStatus(checks: PullRequestInput["checks"]): CheckStatus {
  if (checks.length === 0) {
    return "unknown";
  }

  if (checks.some((check) => check.status === "failed")) {
    return "failed";
  }

  if (checks.some((check) => check.status === "pending")) {
    return "pending";
  }

  if (checks.every((check) => check.status === "passed")) {
    return "passed";
  }

  return "unknown";
}

function statusForCheck(checks: PullRequestInput["checks"], pattern: RegExp): CheckStatus {
  const check = checks.find((item) => pattern.test(item.name));
  return check?.status ?? "unknown";
}

function highestPriority(items: ReviewPriorityItem[]): PriorityLevel {
  const order: PriorityLevel[] = ["blocker", "high", "medium", "low"];
  return order.find((level) => items.some((item) => item.priority === level)) ?? "low";
}

function computeEvidenceCoverage(requirements: RequirementFinding[], changedFileCount: number): number {
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

  return Math.round(requirementScore * filePenalty * 100);
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
