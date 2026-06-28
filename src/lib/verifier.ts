import {
  buildEvidenceIndex,
  extractClaims,
  extractRequirements,
  fileKeywords,
  isRiskFile,
  isTestFile
} from "./extractors";
import { hasPassingEvidenceStatusPrefix, isExecutionEvidenceSignal } from "./evidence-status";
import { redactSecrets } from "./redact";
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

const MAX_MISSING_TEST_FINDINGS = 100;

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
  const failedNonExecutionChecks = nonExecutionFailures(input);
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
  const topRisks = buildTopRisks(requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, failedNonExecutionChecks.length > 0);
  const reprompt = buildReprompt(requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, failedNonExecutionChecks);
  const claims = extractClaims(input.description, evidenceIndex);

  return {
    analysisId: `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source: {
      title: redactSecrets(input.title),
      url: sanitizeSourceUrl(input.url),
      author: input.author ? redactSecrets(input.author) : undefined,
      baseBranch: input.baseBranch ? redactSecrets(input.baseBranch) : undefined,
      headBranch: input.headBranch ? redactSecrets(input.headBranch) : undefined
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

function sanitizeSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const redacted = redactSecrets(value);

  try {
    const url = new URL(redacted);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redacted;
  }
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
  const matchingTestArtifactRefs = matches
    .filter(({ item, match }) => item.kind === "test" && isUsefulArtifactMatch(match))
    .map(({ item }) => item.id);
  const hasMatchingTestArtifactEvidence = matchingTestArtifactRefs.length > 0;
  const matchingPassingExecutionRefs = matches
    .filter(({ item, match }) => match.strong && isPassingTestExecutionEvidence(item))
    .map(({ item }) => item.id);
  const hasMatchingPassingTestExecutionEvidence = matchingPassingExecutionRefs.length > 0;
  const asksForVisualProof = isVisualRequirement(requirement.text);
  const matchingVisualEvidenceRefs = matches
    .filter(({ item, match }) => match.strong && isVisualVerificationEvidence(item))
    .map(({ item }) => item.id);
  const hasMatchingVisualEvidence = matchingVisualEvidenceRefs.length > 0;
  const failedCheck = hasFailingExecutionEvidence(input);

  if (failedCheck) {
    const failedExecutionRefs = executionFailureEvidenceRefs(input, evidenceIndex);

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: hasImplementationEvidence ? "partial" : "unclear",
      evidenceRefs: uniqueRefs([...refs, ...failedExecutionRefs]).slice(0, 5),
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
      evidenceRefs: refsForReport(matches, [
        ...matchingPassingExecutionRefs,
        ...matchingTestArtifactRefs,
        ...strongImplementationRefs
      ]),
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

  if (asksForVisualProof && hasImplementationEvidence && !hasMatchingVisualEvidence) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "partial",
      evidenceRefs: refsForReport(matches, strongImplementationRefs),
      gaps: ["Implementation evidence exists, but no browser, screenshot, or visual QA artifact verifies this UX criterion."],
      reviewerNote: "Treat CI/build evidence as execution proof, not visual proof for this requirement.",
      confidence: hasStrongImplementationEvidence ? 0.6 : 0.48
    };
  }

  if (asksForVisualProof && hasStrongImplementationEvidence && hasMatchingVisualEvidence) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "met",
      evidenceRefs: refsForReport(matches, [...matchingVisualEvidenceRefs, ...strongImplementationRefs]),
      gaps: [],
      reviewerNote: "Implementation evidence and visual QA evidence both appear connected to this criterion.",
      confidence: 0.84
    };
  }

  if (hasMatchingTestArtifactEvidence && !hasStrongImplementationEvidence) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "partial",
      evidenceRefs: refsForReport(matches, matchingTestArtifactRefs),
      gaps: ["A matching test artifact changed, but no passing test check or implementation diff proves this criterion."],
      reviewerNote: "Treat test-file changes as reviewer leads until execution and implementation evidence are connected.",
      confidence: 0.48
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
      evidenceRefs: refsForReport(matches, [...matchingPassingExecutionRefs, ...strongImplementationRefs]),
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
): { score: number; strong: boolean; meaningfulScore: number } {
  const text = `${item.label} ${item.summary}`.toLowerCase();
  const hits = requirement.keywords.filter((keyword) => text.includes(keyword));
  const meaningfulHits = hits.filter((keyword) => keyword.length >= 4 && !WEAK_SINGLE_MATCH_KEYWORDS.has(keyword));
  const score = hits.length;
  const canProve = item.kind === "diff" || item.kind === "test" || item.kind === "log" || item.kind === "check";
  const strong = canProve && (meaningfulHits.length >= 2 || meaningfulHits.some((keyword) => keyword.length >= 8));

  return { score, strong, meaningfulScore: meaningfulHits.length };
}

function isUsefulArtifactMatch(match: { score: number; strong: boolean; meaningfulScore: number }): boolean {
  return match.strong || match.meaningfulScore > 0;
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

function isPassingTestExecutionEvidence(item: EvidenceItem): boolean {
  return (item.kind === "check" || item.kind === "log") &&
    isEvidenceExecutionSignal(item) &&
    hasPassingEvidenceStatusPrefix(item.summary);
}

function isVisualRequirement(text: string): boolean {
  return /\b(accessibility|browser|desktop|layout|mobile|overlap|overflow|responsive|screenshot|screen|visual|viewport|ui|ux)\b/i.test(text) ||
    /\b(readable|readability|30 seconds?)\b/i.test(text);
}

function isVisualVerificationEvidence(item: EvidenceItem): boolean {
  if (item.kind !== "check" && item.kind !== "log") {
    return false;
  }

  return hasPassingEvidenceStatusPrefix(item.summary) &&
    isVisualVerificationSignal(item.label, item.summary, item.locator);
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
      const keywords = fileRelationKeywords(file);
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
    input.checks.some((check) => isCheckExecutionSignal(check) && /test|spec/i.test(`${check.name} ${check.summary ?? ""}`) && check.status === "passed") ||
    input.logs.some((log) => isLogExecutionSignal(log) && /test|spec/i.test(`${log.source} ${log.text}`) && log.status === "passed");
  const asksForTestEvidence = /\b(tests?|coverage|specs?)\b/i.test(`${input.taskText} ${input.description}`);
  const changedImplementationFiles = input.changedFiles.filter((file) =>
    !isTestFile(file.path) && isBehaviorAffectingPath(file.path)
  );

  if (changedImplementationFiles.length === 0) {
    return [];
  }

  const testEvidenceRefs = evidenceIndex.filter((item) => item.kind === "test" || /test/i.test(item.summary)).map((item) => item.id);

  return changedImplementationFiles
    .filter((file) =>
      !hasMatchingVerifiedTestEvidence(file, testFiles, hasPassingTestSignal, evidenceIndex) &&
      !hasVisualVerifiedPresentationEvidence(file, input, asksForTestEvidence)
    )
    .slice(0, MAX_MISSING_TEST_FINDINGS)
    .map((file) => {
      const hasRelatedTestFile = testFiles.some((testFile) => testEvidenceLooksRelated(file, testFile));

      return {
        path: file.path,
        why: missingTestReason(hasRelatedTestFile, hasTestFileChange, hasPassingTestSignal),
        evidenceRefs: uniqueRefs([...evidenceRefsForPath(evidenceIndex, file.path), ...testEvidenceRefs]).slice(0, 5)
      };
    });
}

function missingTestReason(
  hasRelatedTestFile: boolean,
  hasTestFileChange: boolean,
  hasPassingTestSignal: boolean
): string {
  if (hasRelatedTestFile && hasPassingTestSignal) {
    return "Related test evidence and passing execution exist; verify the test actually covers this file.";
  }

  if (hasRelatedTestFile) {
    return "A related test file changed, but no passing test check or log was provided.";
  }

  if (hasTestFileChange && hasPassingTestSignal) {
    return "Passing test evidence exists, but no targeted test evidence clearly maps to this file.";
  }

  if (hasTestFileChange) {
    return "Test evidence changed, but none clearly maps to this implementation file.";
  }

  if (hasPassingTestSignal) {
    return "Passing test evidence exists, but no targeted test evidence clearly maps to this file.";
  }

  return "Behavior-affecting file changed without matching test-file evidence.";
}

function isBehaviorAffectingPath(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|cs|cfg|ini|toml|ya?ml|json)$/.test(path) ||
    /(^|\/)(setup\.cfg|pyproject\.toml|tox\.ini|noxfile\.py|setup\.py|package\.json)$/.test(path);
}

function hasVisualVerifiedPresentationEvidence(
  file: PullRequestInput["changedFiles"][number],
  input: PullRequestInput,
  asksForTestEvidence: boolean
): boolean {
  if (asksForTestEvidence || !isVisualSurfacePath(file.path)) {
    return false;
  }

  if (!isVisualRequirement(`${input.taskText} ${input.description}`) || !hasPassingVisualVerification(input)) {
    return false;
  }

  return isPresentationOnlyPatch(file.patch ?? "");
}

function isVisualSurfacePath(path: string): boolean {
  return /\.(tsx|jsx)$/.test(path) || /(^|\/)components?\//i.test(path);
}

function hasPassingVisualVerification(input: PullRequestInput): boolean {
  return input.checks.some((check) => check.status === "passed" && isVisualVerificationSignal(check.name, check.summary ?? "", check.url)) ||
    input.logs.some((log) => log.status === "passed" && isVisualVerificationSignal(log.source, log.text, log.url));
}

function isVisualVerificationSignal(label: string, text = "", locator = ""): boolean {
  const labelText = label.trim();
  const combined = `${label} ${text} ${locator}`;
  const visualPattern = /\b(browser qa|browser|desktop|mobile|overflow|playwright|cypress|screenshot|visual|viewport)\b/i;
  const nonProofVisualGatePattern =
    /\b(preview|deploy|deployment|security|scan|sast|policy|provenance|attestation|code owners?|review|report)\b/i;
  const trustedVisualSource =
    /\b(browser qa|playwright|cypress)\b/i.test(labelText) &&
    !nonProofVisualGatePattern.test(labelText);
  const nonProofVisualGate =
    nonProofVisualGatePattern.test(combined);

  return visualPattern.test(combined) && (!nonProofVisualGate || trustedVisualSource);
}

function isPresentationOnlyPatch(patch: string): boolean {
  if (!patch.trim()) {
    return false;
  }

  const changedLines = patch
    .split(/\r?\n/)
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    .join("\n");

  if (!changedLines.trim()) {
    return false;
  }

  const behaviorPattern = /\b(fetch|localStorage|sessionStorage|navigator|createObjectURL|onClick|onSubmit|onChange|useEffect|useState|async|await|POST|PUT|PATCH|DELETE|copyText|downloadMarkdown|copyShareLink|postGitHubComment|set[A-Z][A-Za-z0-9_]*)\b/;

  return !behaviorPattern.test(changedLines);
}

function hasMatchingVerifiedTestEvidence(
  implementationFile: PullRequestInput["changedFiles"][number],
  testFiles: PullRequestInput["changedFiles"],
  hasPassingTestSignal: boolean,
  evidenceIndex: EvidenceItem[]
): boolean {
  return hasPassingTestSignal && (
    testFiles.some((testFile) => testEvidenceLooksRelated(implementationFile, testFile)) ||
    hasMatchingPassingExecutionEvidenceForFile(implementationFile, evidenceIndex)
  );
}

function hasMatchingPassingExecutionEvidenceForFile(
  implementationFile: PullRequestInput["changedFiles"][number],
  evidenceIndex: EvidenceItem[]
): boolean {
  return evidenceIndex.some((item) =>
    isPassingTestExecutionEvidence(item) &&
      executionEvidenceLooksRelated(implementationFile, item)
  );
}

function executionEvidenceLooksRelated(
  implementationFile: PullRequestInput["changedFiles"][number],
  item: EvidenceItem
): boolean {
  const evidenceText = `${item.label} ${item.summary} ${item.locator ?? ""}`.toLowerCase();

  if (!/\b(tests?|spec|vitest|jest|playwright|cypress|pytest|smoke|e2e)\b/i.test(evidenceText)) {
    return false;
  }

  return apiRouteEvidenceMatches(implementationFile.path, evidenceText) ||
    symbolEvidenceMatches(implementationFile.path, evidenceText) ||
    executionEvidenceMentionsRelatedTestPath(implementationFile.path, evidenceText);
}

function executionEvidenceMentionsRelatedTestPath(implementationPath: string, evidenceText: string): boolean {
  const candidates = evidenceText.match(
    /\b[a-z0-9_./\-[\]]*(?:(?:\/tests?\/[a-z0-9_./\-[\]]+\.[a-z0-9]+)|(?:[a-z0-9_./\-[\]]+\.(?:test|spec)\.[cm]?[jt]sx?)|(?:test_[a-z0-9_.-]+\.py))\b/gi
  ) ?? [];

  return candidates.some((testPath) =>
    pathsLookRelated(implementationPath, testPath) ||
      apiRouteEvidenceMatches(implementationPath, testPath) ||
      symbolEvidenceMatches(implementationPath, testPath)
  );
}

function pathsLookRelated(implementationPath: string, testPath: string): boolean {
  const implementationStem = fileStem(implementationPath);
  const testStem = fileStem(testPath);

  if (
    implementationStem &&
    testStem &&
    !GENERIC_FILE_STEMS.has(implementationStem) &&
    !GENERIC_FILE_STEMS.has(testStem) &&
    (testStem.includes(implementationStem) || implementationStem.includes(testStem))
  ) {
    return true;
  }

  const implementationKeywords = new Set(pathRelationKeywords(implementationPath));
  const sharedKeywords = pathRelationKeywords(testPath).filter((keyword) => implementationKeywords.has(keyword));

  return sharedKeywords.length >= 2;
}

function testEvidenceLooksRelated(
  implementationFile: PullRequestInput["changedFiles"][number],
  testFile: PullRequestInput["changedFiles"][number]
): boolean {
  if (pathsLookRelated(implementationFile.path, testFile.path)) {
    return true;
  }

  const testText = `${testFile.path} ${testFile.patch ?? ""}`.toLowerCase();
  const testPatchText = (testFile.patch ?? "").toLowerCase();

  return apiRouteEvidenceMatches(implementationFile.path, testPatchText) ||
    symbolEvidenceMatches(implementationFile.path, testText);
}

function apiRouteEvidenceMatches(implementationPath: string, testText: string): boolean {
  const match = implementationPath.match(/(?:^|\/)app\/api\/(.+)\/route\.[jt]s$/i);
  if (!match) return false;

  const route = match[1];
  const staticSegments = route
    .split("/")
    .filter((segment) => segment && !/^\[.+\]$/.test(segment))
    .map((segment) => segment.toLowerCase());

  if (staticSegments.length === 0) return false;

  const endpoint = `/api/${route}`.toLowerCase();
  const normalizedEndpoint = endpoint.replace(/\[[^\]]+\]/g, "");
  const slashlessEndpoint = normalizedEndpoint.replace(/\/+/g, "/");

  return testText.includes(slashlessEndpoint) ||
    staticSegments.every((segment) => testText.includes(segment)) && /\b(api|route|endpoint|request|response|fetch)\b/.test(testText);
}

function symbolEvidenceMatches(implementationPath: string, testText: string): boolean {
  const symbols = implementationSymbols(implementationPath);

  if (symbols.compact && !GENERIC_FILE_STEMS.has(symbols.compact) && testText.includes(symbols.compact)) {
    return true;
  }

  if (symbols.words.length < 2) {
    return false;
  }

  const distinctiveWords = symbols.words.filter((word) => word.length >= 5 && !GENERIC_PATH_KEYWORDS.has(word));

  return distinctiveWords.length >= 1 &&
    symbols.words.every((word) => testText.includes(word));
}

function implementationSymbols(path: string): { compact: string; words: string[] } {
  const filename = path.split(/[\\/]/).pop() ?? path;
  const stem = filename
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/i, "");
  const compact = stem.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const words = stem
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC_PATH_KEYWORDS.has(word) && !GENERIC_FILE_STEMS.has(word));

  return { compact, words: Array.from(new Set(words)) };
}

function pathRelationKeywords(path: string): string[] {
  return fileKeywords(path).filter((keyword) => keyword.length >= 4 && !GENERIC_PATH_KEYWORDS.has(keyword));
}

function fileRelationKeywords(file: PullRequestInput["changedFiles"][number]): string[] {
  return uniqueRefs([
    ...pathRelationKeywords(file.path),
    ...fileRoleKeywords(file.path)
  ]);
}

function fileRoleKeywords(path: string): string[] {
  const lower = path.toLowerCase();
  const roles: string[] = [];

  if (/\.(css|scss|sass|less)$/.test(lower)) {
    roles.push("style", "styles", "layout", "mobile", "responsive", "button", "text", "ui", "ux", "visual", "screen");
  }

  if (/\.(tsx|jsx)$/.test(lower) || lower.includes("/components/")) {
    roles.push("component", "components", "ui", "ux", "screen", "mobile", "layout", "button", "text");
  }

  if (/report|markdown|comment|share|history/.test(lower)) {
    roles.push("report", "evidence", "handoff", "export", "comment", "copy", "share", "summary", "privacy");
  }

  if (/readme|docs?\//.test(lower)) {
    roles.push("docs", "documentation", "handoff", "language", "position", "portfolio", "generic", "reviewer");
  }

  if (/api\/analyze|route\.ts$/.test(lower)) {
    roles.push("api", "analysis", "verification", "report", "language", "copy", "evidence");
  }

  if (/verifier|extractor|validation/.test(lower)) {
    roles.push("verifier", "verification", "evidence", "requirement", "coverage", "scope", "test");
  }

  return roles.filter((keyword) => keyword.length >= 4 && !GENERIC_PATH_KEYWORDS.has(keyword));
}

const GENERIC_PATH_KEYWORDS = new Set([
  "app",
  "apps",
  "component",
  "components",
  "feature",
  "features",
  "lib",
  "libs",
  "module",
  "modules",
  "package",
  "packages",
  "server",
  "source",
  "src",
  "test",
  "tests",
  "util",
  "utils"
]);

const GENERIC_FILE_STEMS = new Set([
  "button",
  "form",
  "index",
  "layout",
  "page",
  "route",
  "view"
]);

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
      path: "Test/build checks",
      reason: "At least one test, build, or CI execution check failed; requirement satisfaction is not proven.",
      priority: "blocker",
      evidenceRefs: executionFailureEvidenceRefs(input, evidenceIndex)
    });
  }

  const nonExecutionFailureRefs = nonExecutionFailureEvidenceRefs(input, evidenceIndex);
  if (nonExecutionFailureRefs.length > 0) {
    items.push({
      path: "Static or merge-gate checks",
      reason: "A non-test/build check failed; review merge policy separately from requirement and execution proof.",
      priority: "high",
      evidenceRefs: nonExecutionFailureRefs
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
  ciStatus: CheckStatus,
  failedNonExecutionChecks: string[]
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
    actions.push("Fix the failing test/build check and summarize the exact log line that proves it now passes.");
  }

  if (failedNonExecutionChecks.length > 0) {
    actions.push(`Address failing static or merge-gate checks separately: ${failedNonExecutionChecks.slice(0, 5).join(", ")}.`);
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
  const executionStatuses = [
    ...checks
      .filter((check) => isCheckExecutionSignal(check))
      .map((check) => check.status),
    ...logs
      .filter((log) => isLogExecutionSignal(log))
      .map((log) => log.status)
      .filter((status): status is CheckStatus => Boolean(status))
  ];

  if (executionStatuses.length === 0) {
    return "unknown";
  }

  if (executionStatuses.some((status) => status === "failed")) {
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

function isCheckExecutionSignal(check: PullRequestInput["checks"][number]): boolean {
  return isExecutionEvidenceSignal(check.name, check.summary ?? "", check.url);
}

function isLogExecutionSignal(log: PullRequestInput["logs"][number]): boolean {
  return isExecutionEvidenceSignal(log.source, log.text);
}

function isEvidenceExecutionSignal(item: EvidenceItem): boolean {
  return isExecutionEvidenceSignal(item.label, item.summary, item.locator);
}

function hasFailingExecutionEvidence(input: PullRequestInput): boolean {
  return input.checks.some((check) => check.status === "failed" && isCheckExecutionSignal(check)) ||
    input.logs.some((log) => log.status === "failed" && isLogExecutionSignal(log));
}

function nonExecutionFailures(input: PullRequestInput): string[] {
  return [
    ...input.checks
      .filter((check) => check.status === "failed" && !isCheckExecutionSignal(check))
      .map((check) => check.name),
    ...input.logs
      .filter((log) => log.status === "failed" && !isLogExecutionSignal(log))
      .map((log) => log.source)
  ];
}

function nonExecutionFailureEvidenceRefs(input: PullRequestInput, evidenceIndex: EvidenceItem[]): string[] {
  const failedCheckLabels = new Set(input.checks
    .filter((check) => check.status === "failed" && !isCheckExecutionSignal(check))
    .map((check) => redactSecrets(check.name)));
  const failedLogLabels = new Set(input.logs
    .filter((log) => log.status === "failed" && !isLogExecutionSignal(log))
    .map((log) => redactSecrets(log.source)));

  return evidenceIndex
    .filter((item) =>
      (item.kind === "check" && failedCheckLabels.has(item.label)) ||
      (item.kind === "log" && failedLogLabels.has(item.label))
    )
    .map((item) => item.id);
}

function executionFailureEvidenceRefs(input: PullRequestInput, evidenceIndex: EvidenceItem[]): string[] {
  const failedCheckLabels = new Set(input.checks
    .filter((check) => check.status === "failed" && isCheckExecutionSignal(check))
    .map((check) => redactSecrets(check.name)));
  const failedLogLabels = new Set(input.logs
    .filter((log) => log.status === "failed" && isLogExecutionSignal(log))
    .map((log) => redactSecrets(log.source)));

  return evidenceIndex
    .filter((item) =>
      (item.kind === "check" && failedCheckLabels.has(item.label)) ||
      (item.kind === "log" && failedLogLabels.has(item.label))
    )
    .map((item) => item.id);
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
  ciStatus: CheckStatus,
  hasNonExecutionCheckFailures: boolean
): string[] {
  const risks: string[] = [];

  if (ciStatus === "failed") risks.push("Test/build execution failed, so the PR is not proven ready.");
  if (hasNonExecutionCheckFailures) risks.push("Static or merge-gate checks failed outside test/build proof.");
  if (requirements.some((finding) => finding.status === "missing")) risks.push("One or more requirements have no matching implementation evidence.");
  if (requirements.some((finding) => finding.status === "unclear")) risks.push("Some requirements are too vague or weakly evidenced.");
  if (requirements.some((finding) => finding.status === "partial")) risks.push("Some requirements have only partial evidence.");
  if (missingTests.length > 0) {
    risks.push(
      missingTests.some((finding) => /^Passing test evidence exists/.test(finding.why))
        ? "Some changed files have broad test evidence, but no targeted test mapping."
        : "Behavior changed without strong test evidence."
    );
  }
  if (outOfScopeFiles.length > 0) risks.push("Potential scope creep in changed files.");

  return risks.length > 0 ? risks.slice(0, 4) : ["No major evidence gap found from available evidence."];
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
    return `Critical evidence gap found. Coverage ${evidenceCoverage}%. ${topRisks[0]}`;
  }

  if (priority === "high") {
    return `High-priority verification needed. Coverage ${evidenceCoverage}%. ${topRisks[0]}`;
  }

  if (priority === "medium") {
    return `Some evidence is weak. Coverage ${evidenceCoverage}%. ${topRisks[0]}`;
  }

  return `Evidence looks mostly aligned. Coverage ${evidenceCoverage}%.`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
