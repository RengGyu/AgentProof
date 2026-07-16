import {
  buildEvidenceIndexResult,
  extractClaims,
  extractRequirementEvidence,
  fileKeywords,
  isRiskFile,
  isTestFile
} from "./extractors";
import {
  hasPassingEvidenceStatusPrefix,
  isExecutionEvidenceSignal,
  isFailedAmbiguousActionsExecutionSignal
} from "./evidence-status";
import { redactSecrets } from "./redact";
import { buildDecisionCard } from "./decision-card";
import type {
  CheckStatus,
  EvidenceItem,
  FindingProvenance,
  MissingTestFinding,
  PriorityLevel,
  ProofGraph,
  PullRequestInput,
  Requirement,
  RequirementContextSignal,
  RequirementProofNode,
  RequirementFinding,
  ReviewPriorityItem,
  VerificationReport
} from "./types";

const MAX_MISSING_TEST_FINDINGS = 100;
const MAX_FINDING_PROVENANCE_ITEMS = 5;
const MAX_FINDING_PROVENANCE_TEXT = 240;
const MAX_EVIDENCE_REFS_PER_FIELD = 50;
const MAX_SCOPE_FINDINGS = 100;

export function generateVerificationReport(input: PullRequestInput): VerificationReport {
  const authoritativeRequirementContext = input.originalTask?.status === "available"
    ? input.description
    : "";
  const evidenceBuild = buildEvidenceIndexResult(
    input.taskText,
    input.description,
    input.changedFiles,
    input.checks,
    input.logs,
    input.taskSource
  );
  const evidenceIndex = evidenceBuild.items;
  const authoritativeRequirementEvidence = extractRequirementEvidence(input.taskText, authoritativeRequirementContext, input.taskSource);
  const contextualEvidence = input.originalTask?.status === "available"
    ? authoritativeRequirementEvidence
    : extractRequirementEvidence(input.taskText, input.description, input.taskSource);
  const requirementEvidence = {
    ...authoritativeRequirementEvidence,
    contexts: contextualEvidence.contexts
  };
  const requirements = requirementEvidence.requirements;
  const ciStatus = aggregateStatus(input.checks, input.logs);
  const rawRequirementFindings = requirements.map((requirement) =>
    evaluateRequirement(requirement, evidenceIndex, input)
  );
  const missingTests = detectMissingTests(input, evidenceIndex);
  const proofGraph = buildProofGraph(requirements, rawRequirementFindings, input, evidenceIndex, missingTests, ciStatus, requirementEvidence.contexts);
  const proofAdjustedRequirementFindings = applyProofGraphToRequirements(rawRequirementFindings, proofGraph);
  const cappedRequirements = capRequirementFindingRefs(proofAdjustedRequirementFindings, requirements, evidenceIndex);
  const requirementFindings = cappedRequirements.findings;
  const rawScope = detectScopeCreep(requirements, input.changedFiles, evidenceIndex);
  const cappedScope = capScopeFindingRefs(rawScope, evidenceIndex);
  const scope = cappedScope.scope;
  const lintStatus = statusForCheck(input.checks, /lint/i);
  const typecheckStatus = statusForCheck(input.checks, /type(check|script)/i);
  const failedNonExecutionChecks = nonExecutionFailures(input);
  const reviewPriority = buildReviewPriority(input, requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, evidenceIndex, proofGraph);
  const priority = highestPriority(reviewPriority);
  const evidenceRefsCapped = cappedRequirements.capped || cappedScope.capped || hasRequirementEvidenceRefPressure(requirements, evidenceIndex);
  const hasExecutionEvidence = hasTestBuildExecutionEvidence(input);
  const limitations = buildLimitations(input, requirementFindings, ciStatus, hasExecutionEvidence, evidenceRefsCapped, evidenceBuild.omittedByKind, requirementEvidence.omittedRequirementCount, scope.omittedCount);
  const evidenceCoverage = computeEvidenceCoverage(
    requirementFindings,
    input.changedFiles.length,
    missingTests.length,
    scope.outOfScopeFiles.length,
    ciStatus,
    limitations.length
  );
  const topRisks = buildTopRisks(requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, failedNonExecutionChecks.length > 0, proofGraph);
  const reprompt = buildReprompt(requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, failedNonExecutionChecks, proofGraph);
  const claims = extractClaims(input.description, evidenceIndex);

  const report: VerificationReport = {
    analysisId: `ap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    source: {
      title: redactSecrets(input.title),
      url: sanitizeSourceUrl(input.url),
      author: input.author ? redactSecrets(input.author) : undefined,
      baseBranch: input.baseBranch ? redactSecrets(input.baseBranch) : undefined,
      headBranch: input.headBranch ? redactSecrets(input.headBranch) : undefined,
      provenance: input.sourceProvenance,
      originalTask: input.originalTask
    },
    summary: {
      oneLine: summarize(priority, evidenceCoverage, topRisks),
      confidence: computeSummaryConfidence(evidenceCoverage, priority, limitations.length, hasExecutionEvidence),
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
      evidenceRefs: scope.evidenceRefs,
      provenance: scope.provenance
    },
    testing: {
      ciStatus,
      lintStatus,
      typecheckStatus,
      missingTests
    },
    reviewPriority,
    proofGraph,
    reprompt: {
      targetAgent: "codex",
      prompt: reprompt
    },
    evidenceIndex,
    limitations
  };
  const decisionCard = buildDecisionCard(report);
  report.decisionCard = decisionCard;
  return report;
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
  if (input.originalTask && input.originalTask.status !== "available") {
    const refs = sourceEvidenceRefs(evidenceIndex);
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "unclear",
      evidenceRefs: refs,
      gaps: [input.originalTask.status === "ambiguous"
        ? "The original task source is ambiguous, so requirement satisfaction cannot be verified."
        : "The original task source is unavailable, so requirement satisfaction cannot be verified."],
      reviewerNote: "Fetch or paste one authoritative original issue/task before treating this requirement as satisfied.",
      confidence: 0.2
    };
  }
  if (isUntrustedPrDescriptionRequirementSource(requirement, input)) {
    const refs = sourceEvidenceRefs(evidenceIndex);

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "unclear",
      evidenceRefs: refs,
      gaps: ["The linked issue source is ambiguous or unavailable, so the PR body alone is not enough to verify this requirement."],
      reviewerNote: "Fetch or paste the original issue/task before treating this requirement as satisfied.",
      confidence: 0.28
    };
  }

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

function isUntrustedPrDescriptionRequirementSource(requirement: Requirement, input: PullRequestInput): boolean {
  if (requirement.source !== "pr_description" || input.taskText.trim()) {
    return false;
  }

  return (input.limitations ?? []).some((limitation) =>
    /Multiple supported issue references found|Linked issue .* could not be fetched|Linked issue .* had no title or body text|Linked reference .* points to a pull request/i.test(limitation)
  );
}

function capRequirementFindingRefs(
  findings: RequirementFinding[],
  requirements: Requirement[],
  evidenceIndex: EvidenceItem[]
): { findings: RequirementFinding[]; capped: boolean } {
  let capped = false;
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const cappedFindings = findings.map((finding) => {
    const requirement = requirementById.get(finding.requirementId);
    const refs = capEvidenceRefs(
      finding.evidenceRefs,
      evidenceIndex,
      (item) => rankRequirementEvidenceRef(requirement, item)
    );

    if (refs.length < uniqueRefs(finding.evidenceRefs).length) {
      capped = true;
    }

    return {
      ...finding,
      evidenceRefs: refs
    };
  });

  return { findings: cappedFindings, capped };
}

function capScopeFindingRefs(
  scope: ReturnType<typeof detectScopeCreep>,
  evidenceIndex: EvidenceItem[]
): { scope: ReturnType<typeof detectScopeCreep>; capped: boolean } {
  const evidenceRefs = capEvidenceRefs(scope.evidenceRefs ?? [], evidenceIndex, (item) =>
    item.kind === "diff" || item.kind === "changed_file" ? 0 : item.kind === "task" || item.kind === "pr_description" ? 1 : 2
  );
  const capped = evidenceRefs.length < uniqueRefs(scope.evidenceRefs ?? []).length;

  if (!capped) {
    return { scope, capped: false };
  }

  return {
    scope: {
      ...scope,
      evidenceRefs,
      provenance: findingProvenanceForRefs(evidenceIndex, evidenceRefs)
    },
    capped: true
  };
}

function capEvidenceRefs(
  refs: string[],
  evidenceIndex: EvidenceItem[],
  rank: (item: EvidenceItem) => number
): string[] {
  const order = new Map(evidenceIndex.map((item, index) => [item.id, index]));
  const evidenceById = new Map(evidenceIndex.map((item) => [item.id, item]));

  return uniqueRefs(refs)
    .sort((left, right) => {
      const leftEvidence = evidenceById.get(left);
      const rightEvidence = evidenceById.get(right);
      const leftRank = leftEvidence ? rank(leftEvidence) : 99;
      const rightRank = rightEvidence ? rank(rightEvidence) : 99;

      return leftRank - rightRank ||
        (order.get(left) ?? Number.MAX_SAFE_INTEGER) - (order.get(right) ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, MAX_EVIDENCE_REFS_PER_FIELD);
}

function rankRequirementEvidenceRef(requirement: Requirement | undefined, item: EvidenceItem): number {
  if (item.kind === "task" || item.kind === "pr_description") {
    return 0;
  }

  const match = requirement ? requirementEvidenceMatch(requirement, item) : { score: 0, strong: false };

  if ((item.kind === "diff" || item.kind === "changed_file") && match.score > 0) {
    return 1;
  }

  if (item.kind === "test" && match.score > 0) {
    return 2;
  }

  if ((item.kind === "check" || item.kind === "log") && isEvidenceExecutionSignal(item)) {
    return 3;
  }

  if (match.score > 0) {
    return 4;
  }

  return 5;
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

function evidenceStatusFromSummary(summary: string): CheckStatus {
  const match = summary.trim().match(/^Status:\s*(passed|failed|pending|unknown)\b/i);

  return match ? match[1].toLowerCase() as CheckStatus : "unknown";
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

function buildProofGraph(
  requirements: Requirement[],
  findings: RequirementFinding[],
  input: PullRequestInput,
  evidenceIndex: EvidenceItem[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus,
  contexts: RequirementContextSignal[]
): ProofGraph {
  const findingByRequirement = new Map(findings.map((finding) => [finding.requirementId, finding]));
  const failedExecutionRefs = executionFailureEvidenceRefs(input, evidenceIndex);
  const allExecutionRefs = executionEvidenceRefs(input, evidenceIndex);
  const selfReportedTestGapRefs = selfReportedTestGapEvidenceRefs(evidenceIndex);
  const changedFileEvidenceUnavailable = hasChangedFileEvidenceUnavailable(input);
  const diffEvidenceUnavailable = hasDiffEvidenceUnavailable(input);

  const nodes = requirements.map((requirement): RequirementProofNode => {
    const finding = findingByRequirement.get(requirement.id);
    const implementationEvidenceRefs = requirementEvidenceRefs(requirement, evidenceIndex, (item, match) =>
      (item.kind === "diff" || item.kind === "changed_file") && match.score > 0
    );
    const targetedTestEvidenceRefs = targetedTestEvidenceRefsForRequirement(
      requirement,
      evidenceIndex,
      input,
      implementationEvidenceRefs
    );
    const matchingExecutionRefs = requirementEvidenceRefs(requirement, evidenceIndex, (item, match) =>
      (item.kind === "check" || item.kind === "log") &&
      isEvidenceExecutionSignal(item) &&
      isUsefulArtifactMatch(match)
    );
    const executionEvidenceRefs = uniqueRefs([
      ...matchingExecutionRefs,
      ...(ciStatus === "failed" ? failedExecutionRefs : [])
    ]).slice(0, 8);
    const relatedMissingTests = missingTests.filter((missing) =>
      implementationEvidenceRefs.some((ref) => evidenceRefsForPath(evidenceIndex, missing.path).includes(ref)) ||
      missing.evidenceRefs.some((ref) => implementationEvidenceRefs.includes(ref))
    );
    const gapSignals: RequirementProofNode["gapSignals"] = [];
    const expectsTargetedProof = shouldExpectTargetedProof(requirement.text, input);

    if ((!finding || finding.status === "missing" || implementationEvidenceRefs.length === 0) && changedFileEvidenceUnavailable) {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "Changed-file evidence could not be collected, so missing implementation proof is inconclusive rather than proven absent.",
        evidenceRefs: finding?.evidenceRefs.length ? finding.evidenceRefs : sourceEvidenceRefs(evidenceIndex)
      });
    } else if (!finding || finding.status === "missing" || implementationEvidenceRefs.length === 0) {
      gapSignals.push({
        kind: "missing_implementation",
        severity: missingImplementationSeverity(requirement, input),
        message: "No implementation evidence clearly maps to this requirement.",
        evidenceRefs: finding?.evidenceRefs ?? sourceEvidenceRefs(evidenceIndex)
      });
    }

    if (finding?.status === "unclear") {
      gapSignals.push({
        kind: "ambiguous_requirement",
        severity: "medium",
        message: "Requirement needs human interpretation before trusting the report.",
        evidenceRefs: finding.evidenceRefs
      });
    }

    if (implementationEvidenceRefs.length > 0 && expectsTargetedProof && targetedTestEvidenceRefs.length === 0) {
      gapSignals.push({
        kind: "missing_targeted_test",
        severity: targetedProofGapSeverity(requirement, input, ciStatus),
        message: "Implementation evidence exists, but no targeted test-file evidence maps to this requirement.",
        evidenceRefs: uniqueRefs([...implementationEvidenceRefs, ...relatedMissingTests.flatMap((item) => item.evidenceRefs)]).slice(0, 8)
      });
    }

    if (
      implementationEvidenceRefs.length > 0 &&
      diffEvidenceUnavailable &&
      implementationEvidenceRefs.every((ref) =>
        refsToEvidence(evidenceIndex, [ref]).every((item) => item.kind !== "diff")
      )
    ) {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "Changed-file metadata was collected, but patch evidence was unavailable for at least one mapped file.",
        evidenceRefs: implementationEvidenceRefs.slice(0, 8)
      });
    }

    if (implementationEvidenceRefs.length > 0 && allExecutionRefs.length === 0) {
      gapSignals.push({
        kind: "missing_execution",
        severity: "medium",
        message: "No deterministic test/build execution evidence was collected for this requirement.",
        evidenceRefs: implementationEvidenceRefs.slice(0, 8)
      });
    }

    if (ciStatus === "failed") {
      gapSignals.push({
        kind: "failed_execution",
        severity: "blocker",
        message: "A relevant test/build execution signal failed, so this requirement is not proven ready.",
        evidenceRefs: failedExecutionRefs.slice(0, 8)
      });
    }

    if (implementationEvidenceRefs.length > 0 && selfReportedTestGapRefs.length > 0) {
      gapSignals.push({
        kind: "self_reported_test_gap",
        severity: targetedProofGapSeverity(requirement, input, ciStatus),
        message: "The PR text indicates targeted tests may be absent or incomplete.",
        evidenceRefs: selfReportedTestGapRefs.slice(0, 5)
      });
    }

    if ((finding?.gaps ?? []).some((gap) => /visual|screenshot|browser|ux|ui/i.test(gap)) || requirement.contextRoles.includes("visual_context")) {
      gapSignals.push({
        kind: "visual_proof_missing",
        severity: "medium",
        message: "Visual or browser-facing behavior needs proof beyond test/build status.",
        evidenceRefs: finding?.evidenceRefs ?? sourceEvidenceRefs(evidenceIndex)
      });
    }

    if (finding?.status === "partial" && gapSignals.length === 0 && finding.evidenceRefs.length > 0) {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "The cited deterministic evidence only partially supports this requirement; no narrower proof gap was derived.",
        evidenceRefs: uniqueRefs(finding.evidenceRefs).slice(0, 8)
      });
    }

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      sourceRole: requirement.role,
      sourceQuality: requirement.sourceQuality,
      sourceSection: requirement.sourceSection,
      contextRoles: requirement.contextRoles,
      status: finding?.status ?? "unclear",
      confidence: finding?.confidence ?? 0.2,
      implementationEvidenceRefs: implementationEvidenceRefs.slice(0, 8),
      targetedTestEvidenceRefs: targetedTestEvidenceRefs.slice(0, 8),
      executionEvidenceRefs,
      gapSignals: dedupeGapSignals(gapSignals),
      firstFiles: firstProofFiles(evidenceIndex, uniqueRefs([
        ...implementationEvidenceRefs,
        ...targetedTestEvidenceRefs,
        ...relatedMissingTests.flatMap((item) => item.evidenceRefs)
      ])).slice(0, 5)
    };
  });

  return {
    version: 1,
    nodes,
    context: contexts.map((context) => ({
      ...context,
      text: shortEvidenceText(context.text)
    })).slice(0, 30),
    summary: {
      requirementCount: nodes.length,
      requirementsWithImplementation: nodes.filter((node) => node.implementationEvidenceRefs.length > 0).length,
      requirementsWithTargetedTests: nodes.filter((node) => node.targetedTestEvidenceRefs.length > 0).length,
      requirementsWithExecution: nodes.filter((node) => node.executionEvidenceRefs.length > 0).length,
      requirementsWithGaps: nodes.filter((node) => node.gapSignals.length > 0).length,
      gapCount: nodes.reduce((count, node) => count + node.gapSignals.length, 0)
    }
  };
}

function applyProofGraphToRequirements(
  findings: RequirementFinding[],
  proofGraph: ProofGraph
): RequirementFinding[] {
  const nodeByRequirement = new Map(proofGraph.nodes.map((node) => [node.requirementId, node]));

  return findings.map((finding) => {
    const node = nodeByRequirement.get(finding.requirementId);
    if (!node || node.gapSignals.length === 0) {
      return finding;
    }

    const gapMessages = node.gapSignals.map((gap) => gap.message);
    const hasHardGap = node.gapSignals.some((gap) => gap.severity === "blocker" || gap.severity === "high");
    const hasEvidenceUnavailable = node.gapSignals.some((gap) => gap.kind === "evidence_unavailable");
    const status = finding.status === "met" && hasHardGap
      ? "partial"
      : finding.status === "missing" && hasEvidenceUnavailable
        ? "unclear"
        : finding.status;
    const confidence = hasHardGap ? Math.min(finding.confidence, 0.58) : finding.confidence;

    return {
      ...finding,
      status,
      confidence,
      gaps: uniqueRefs([...finding.gaps, ...gapMessages]).slice(0, 8),
      evidenceRefs: uniqueRefs([
        ...finding.evidenceRefs,
        ...node.implementationEvidenceRefs,
        ...node.targetedTestEvidenceRefs,
        ...node.executionEvidenceRefs,
        ...node.gapSignals.flatMap((gap) => gap.evidenceRefs)
      ]).slice(0, 12),
      reviewerNote: hasHardGap
        ? `${finding.reviewerNote} Review implementation, targeted test, and execution proof together before trusting this requirement.`
        : hasEvidenceUnavailable
          ? `${finding.reviewerNote} Treat unavailable or inconclusive deterministic evidence as a proof gap, not proof that implementation is absent.`
        : finding.reviewerNote
    };
  });
}

function hasRequirementEvidenceRefPressure(requirements: Requirement[], evidenceIndex: EvidenceItem[]): boolean {
  return requirements.some((requirement) =>
    evidenceIndex.filter((item) => requirementEvidenceMatch(requirement, item).score > 0).length > MAX_EVIDENCE_REFS_PER_FIELD
  );
}

function requirementEvidenceRefs(
  requirement: Requirement,
  evidenceIndex: EvidenceItem[],
  predicate: (item: EvidenceItem, match: ReturnType<typeof requirementEvidenceMatch>) => boolean
): string[] {
  return evidenceIndex
    .map((item) => ({ item, match: requirementEvidenceMatch(requirement, item) }))
    .filter(({ item, match }) => predicate(item, match))
    .map(({ item }) => item.id);
}

function targetedTestEvidenceRefsForRequirement(
  requirement: Requirement,
  evidenceIndex: EvidenceItem[],
  input: PullRequestInput,
  implementationEvidenceRefs: string[]
): string[] {
  const directRefs = requirementEvidenceRefs(requirement, evidenceIndex, (item, match) =>
    item.kind === "test" && isUsefulArtifactMatch(match)
  );
  const implementationPaths = new Set(
    implementationEvidenceRefs
      .flatMap((ref) => refsToPaths(evidenceIndex, [ref]))
      .map((path) => path.toLowerCase())
  );
  const implementationFiles = input.changedFiles.filter((file) =>
    implementationPaths.has(file.path.toLowerCase())
  );
  const testFiles = input.changedFiles.filter((file) => isTestFile(file.path));
  const relatedRefs = evidenceIndex
    .filter((item) => item.kind === "test")
    .filter((item) => {
      const testFile = testFiles.find((file) => file.path === item.locator || file.path === item.label);
      if (!testFile) return false;

      return implementationFiles.some((implementationFile) =>
        testEvidenceLooksRelated(implementationFile, testFile)
      );
    })
    .map((item) => item.id);

  return uniqueRefs([...directRefs, ...relatedRefs]);
}

function refsToPaths(evidenceIndex: EvidenceItem[], refs: string[]): string[] {
  const evidenceById = new Map(evidenceIndex.map((item) => [item.id, item]));

  return refs
    .map((ref) => evidenceById.get(ref))
    .map((item) => item?.locator ?? item?.label ?? "")
    .filter(Boolean);
}

function refsToEvidence(evidenceIndex: EvidenceItem[], refs: string[]): EvidenceItem[] {
  const evidenceById = new Map(evidenceIndex.map((item) => [item.id, item]));

  return refs
    .map((ref) => evidenceById.get(ref))
    .filter((item): item is EvidenceItem => Boolean(item));
}

function executionEvidenceRefs(input: PullRequestInput, evidenceIndex: EvidenceItem[]): string[] {
  const checkLabels = new Set(input.checks
    .filter((check) => isCheckExecutionSignal(check))
    .map((check) => redactSecrets(check.name)));
  const logLabels = new Set(input.logs
    .filter((log) => isLogExecutionSignal(log))
    .map((log) => redactSecrets(log.source)));

  return evidenceIndex
    .filter((item) =>
      (item.kind === "check" && checkLabels.has(item.label)) ||
      (item.kind === "log" && logLabels.has(item.label))
    )
    .map((item) => item.id);
}

function selfReportedTestGapEvidenceRefs(evidenceIndex: EvidenceItem[]): string[] {
  return evidenceIndex
    .filter((item) =>
      item.kind === "pr_description" &&
      /\b(no|none|without|unrelated|not sure|open to suggestions|could be added|no tests?|not tested|test gap)\b.{0,120}\b(tests?|coverage|spec|failures?)\b|\b(tests?|coverage|spec|failures?)\b.{0,120}\b(no|none|without|unrelated|not sure|open to suggestions|could be added|not tested|gap)\b/i.test(item.summary)
    )
    .map((item) => item.id);
}

function shouldExpectTargetedProof(requirementText: string, input: PullRequestInput): boolean {
  const combined = `${requirementText} ${input.taskText} ${input.description}`;

  return /\b(tests?|coverage|specs?|crash|segfault|regression|data loss|mutat(?:e|ion)|security|auth|permission|billing|payment)\b/i.test(combined);
}

function missingImplementationSeverity(requirement: Requirement, input: PullRequestInput): PriorityLevel {
  if (isManualCheckRequirement(requirement)) {
    return "medium";
  }

  return isRiskSensitiveRequirement(requirement, input) ? "high" : "medium";
}

function targetedProofGapSeverity(
  requirement: Requirement,
  input: PullRequestInput,
  ciStatus: CheckStatus
): PriorityLevel {
  if (ciStatus === "failed") {
    return "blocker";
  }

  if (isRiskSensitiveRequirement(requirement, input) || explicitlyRequiresTestEvidence(requirement.text)) {
    return "high";
  }

  return "medium";
}

function isManualCheckRequirement(requirement: Requirement): boolean {
  return requirement.sourceQuality === "manual_check" ||
    requirement.sourceQuality === "fallback" ||
    requirement.sourceQuality === "author_claim" ||
    requirement.source === "pr_description";
}

function explicitlyRequiresTestEvidence(text: string): boolean {
  return /\b(must|shall|required|acceptance criteria).{0,100}\b(tests?|coverage|specs?)\b|\b(tests?|coverage|specs?).{0,100}\b(must|shall|required)\b/i.test(text);
}

function isRiskSensitiveRequirement(requirement: Requirement, input: PullRequestInput): boolean {
  const combined = `${requirement.text} ${input.taskText} ${input.description}`;

  return /\b(crash|segfault|panic|security|auth|authorization|permission|billing|payment|data loss|data corruption|corrupt|credential|password|secret|token|directory traversal|path traversal|xss|csrf|injection)\b/i.test(combined) ||
    input.changedFiles.some((file) => isRiskFile(file.path));
}

function hasChangedFileEvidenceUnavailable(input: PullRequestInput): boolean {
  return (input.limitations ?? []).some((limitation) =>
    /changed-file evidence unavailable|changed-file fetch failed|file evidence may be incomplete/i.test(limitation)
  );
}

function hasDiffEvidenceUnavailable(input: PullRequestInput): boolean {
  return (input.limitations ?? []).some((limitation) =>
    /patch text|diff evidence is unavailable/i.test(limitation)
  );
}

function firstProofFiles(evidenceIndex: EvidenceItem[], refs: string[]): string[] {
  const evidenceById = new Map(evidenceIndex.map((item) => [item.id, item]));

  return uniqueRefs(refs
    .map((ref) => evidenceById.get(ref))
    .map((item) => item?.locator ?? item?.label ?? "")
    .filter((value) => isConcreteFilePath(value))
    .map(safeReportPath));
}

function dedupeGapSignals(signals: RequirementProofNode["gapSignals"]): RequirementProofNode["gapSignals"] {
  const seen = new Set<string>();
  const result: RequirementProofNode["gapSignals"] = [];

  for (const signal of signals) {
    const key = `${signal.kind}:${signal.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...signal,
      evidenceRefs: uniqueRefs(signal.evidenceRefs).slice(0, 8)
    });
  }

  return result;
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
      reasons: [],
      omittedCount: 0
    };
  }

  const candidateOutOfScopeFiles = files
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
  const outOfScopeFiles = candidateOutOfScopeFiles.slice(0, MAX_SCOPE_FINDINGS);
  const evidenceRefs = uniqueRefs(outOfScopeFiles.flatMap((path) => evidenceRefsForPath(evidenceIndex, path)));

  return {
    outOfScopeFiles: outOfScopeFiles.map(safeReportPath),
    evidenceRefs,
    provenance: findingProvenanceForRefs(evidenceIndex, evidenceRefs),
    reasons: outOfScopeFiles.map((path) =>
      isRiskFile(path)
        ? `${safeReportPath(path)} is risk-sensitive and does not clearly map to the stated criteria.`
        : `${safeReportPath(path)} does not clearly map to the stated criteria.`
    ),
    omittedCount: Math.max(0, candidateOutOfScopeFiles.length - outOfScopeFiles.length)
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
      const evidenceRefs = uniqueRefs([...evidenceRefsForPath(evidenceIndex, file.path), ...testEvidenceRefs]).slice(0, 5);

      return {
        path: safeReportPath(file.path),
        why: missingTestReason(hasRelatedTestFile, hasTestFileChange, hasPassingTestSignal),
        evidenceRefs,
        provenance: findingProvenanceForRefs(evidenceIndex, evidenceRefs)
      };
    });
}

function findingProvenanceForRefs(evidenceIndex: EvidenceItem[], refs: string[]): FindingProvenance[] {
  const evidenceById = new Map(evidenceIndex.map((item) => [item.id, item]));
  const provenance: FindingProvenance[] = [];

  for (const ref of uniqueRefs(refs)) {
    const evidence = evidenceById.get(ref);
    if (!evidence) continue;

    provenance.push({
      evidenceRef: ref,
      sourceType: evidence.kind,
      locator: evidence.locator ?? evidence.label,
      confidence: evidence.confidence,
      evidenceText: shortEvidenceText(evidence.summary)
    });

    if (provenance.length >= MAX_FINDING_PROVENANCE_ITEMS) {
      break;
    }
  }

  return provenance;
}

function shortEvidenceText(value: string): string {
  const text = redactSecrets(value).replace(/\s+/g, " ").trim();

  if (text.length <= MAX_FINDING_PROVENANCE_TEXT) {
    return text;
  }

  return `${text.slice(0, MAX_FINDING_PROVENANCE_TEXT - 3).trim()}...`;
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
  return /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|cs|c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|swift|cfg|ini|toml|ya?ml|json)$/.test(path) ||
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
  evidenceIndex: EvidenceItem[],
  proofGraph: ProofGraph
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
    const refs = refsForFindings(missingRequirements, sourceRefs);
    items.push({
      path: reviewPriorityPathForEvidence(refs, evidenceIndex),
      reason: `${missingRequirements.length} requirement(s) have no matching implementation evidence.`,
      priority: "high",
      evidenceRefs: refs
    });
  }

  if (unclearRequirements.length > 0) {
    const refs = refsForFindings(unclearRequirements, sourceRefs);
    items.push({
      path: reviewPriorityPathForEvidence(refs, evidenceIndex),
      reason: `${unclearRequirements.length} requirement(s) need human interpretation before trusting the report.`,
      priority: "medium",
      evidenceRefs: refs
    });
  }

  if (partialRequirements.length > 0) {
    const refs = refsForFindings(partialRequirements, sourceRefs);
    items.push({
      path: reviewPriorityPathForEvidence(refs, evidenceIndex),
      reason: `${partialRequirements.length} requirement(s) have only partial evidence.`,
      priority: "medium",
      evidenceRefs: refs
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

  const proofGapItems = proofGraph.nodes
    .flatMap((node) => node.gapSignals.map((gap) => ({ node, gap })))
    .filter(({ gap }) =>
      gap.kind === "missing_targeted_test" ||
      gap.kind === "self_reported_test_gap" ||
      gap.kind === "evidence_unavailable" ||
      gap.kind === "failed_execution"
    )
    .slice(0, 6);

  for (const { node, gap } of proofGapItems) {
    const path = node.firstFiles[0] ?? reviewPriorityPathForEvidence(gap.evidenceRefs, evidenceIndex);
    items.push({
      path,
      reason: `Requirement proof gap: ${gap.message}`,
      priority: gap.severity,
      evidenceRefs: gap.evidenceRefs
    });
  }

  for (const file of input.changedFiles.filter((changed) => isRiskFile(changed.path) && !isTestFile(changed.path)).slice(0, 6)) {
    const safePath = safeReportPath(file.path);

    if (!items.some((item) => item.path === safePath)) {
      const hasSpecificRisk = outOfScopeFiles.includes(safePath) || missingTests.some((missing) => missing.path === safePath);
      items.push({
        path: safePath,
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

  return dedupeReviewPriorityItems(items);
}

function dedupeReviewPriorityItems(items: ReviewPriorityItem[]): ReviewPriorityItem[] {
  const priorityRank: Record<PriorityLevel, number> = {
    blocker: 0,
    high: 1,
    medium: 2,
    low: 3
  };
  const indexByPath = new Map<string, number>();
  const deduped: ReviewPriorityItem[] = [];

  for (const item of items) {
    const key = item.path.toLowerCase();
    const existingIndex = indexByPath.get(key);

    if (existingIndex !== undefined) {
      const existing = deduped[existingIndex];
      if (existing && priorityRank[item.priority] < priorityRank[existing.priority]) {
        deduped[existingIndex] = {
          ...item,
          evidenceRefs: uniqueRefs([...(existing.evidenceRefs ?? []), ...(item.evidenceRefs ?? [])])
        };
      } else if (existing) {
        existing.evidenceRefs = uniqueRefs([...(existing.evidenceRefs ?? []), ...(item.evidenceRefs ?? [])]);
      }
      continue;
    }

    indexByPath.set(key, deduped.length);
    deduped.push(item);
  }

  return deduped;
}

function evidenceRefsForPath(evidenceIndex: EvidenceItem[], path: string): string[] {
  const safePath = safeReportPath(path);

  return evidenceIndex
    .filter((item) => item.locator === path || item.label === path || item.locator === safePath || item.label === safePath)
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

function reviewPriorityPathForEvidence(refs: string[], evidenceIndex: EvidenceItem[]): string {
  const evidenceById = new Map(evidenceIndex.map((item) => [item.id, item]));
  const concrete = refs
    .map((ref) => evidenceById.get(ref))
    .find((item) =>
      item &&
      (item.kind === "diff" || item.kind === "changed_file" || item.kind === "test") &&
      item.locator &&
      item.locator !== "task" &&
      item.locator !== "pr_description"
    );

  if (concrete?.locator) {
    return safeReportPath(concrete.locator);
  }

  const fallbackConcrete = evidenceIndex.find((item) =>
    (item.kind === "diff" || item.kind === "changed_file" || item.kind === "test") &&
    item.locator &&
    item.locator !== "task" &&
    item.locator !== "pr_description"
  );

  return fallbackConcrete?.locator ? safeReportPath(fallbackConcrete.locator) : "Requirement evidence";
}

function safeReportPath(path: string): string {
  return redactSecrets(path);
}

function isConcreteFilePath(value: string): boolean {
  const trimmed = value.trim();

  if (
    !trimmed ||
    trimmed === "task" ||
    trimmed === "pr_description" ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("?") ||
    trimmed.includes("#") ||
    /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
  ) {
    return false;
  }

  const parts = trimmed.split("/");
  if (parts.some((part) => part === "." || part === ".." || part.trim() === "")) {
    return false;
  }

  return /(^|\/)[^/\s]+\.[^/\s]+$/.test(trimmed) || (trimmed.includes("/") && !/\s/.test(trimmed));
}

function uniqueRefs(refs: string[]): string[] {
  return Array.from(new Set(refs));
}

function buildReprompt(
  requirements: RequirementFinding[],
  outOfScopeFiles: string[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus,
  failedNonExecutionChecks: string[],
  proofGraph: ProofGraph
): string {
  const actions: string[] = [];
  const weakRequirements = requirements.filter((finding) => finding.status !== "met");
  const proofGapNodes = proofGraph.nodes.filter((node) => node.gapSignals.length > 0);

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

  if (proofGapNodes.length > 0) {
    actions.push(`Return requirement-by-requirement proof for: ${proofGapNodes.slice(0, 4).map((node) => `"${node.requirementText}"`).join(", ")}.`);
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

  if (executionStatuses.some((status) => status === "passed")) {
    return "passed";
  }

  return "unknown";
}

function isCheckExecutionSignal(check: PullRequestInput["checks"][number]): boolean {
  return isExecutionEvidenceSignal(check.name, check.summary ?? "", check.url) ||
    isFailedAmbiguousActionsExecutionSignal(check.name, check.status, check.url, check.summary ?? "");
}

function isLogExecutionSignal(log: PullRequestInput["logs"][number]): boolean {
  return isExecutionEvidenceSignal(log.source, log.text);
}

function isEvidenceExecutionSignal(item: EvidenceItem): boolean {
  return isExecutionEvidenceSignal(item.label, item.summary, item.locator) ||
    isFailedAmbiguousActionsExecutionSignal(item.label, evidenceStatusFromSummary(item.summary), item.locator, item.summary);
}

function hasFailingExecutionEvidence(input: PullRequestInput): boolean {
  return input.checks.some((check) => check.status === "failed" && isCheckExecutionSignal(check)) ||
    input.logs.some((log) => log.status === "failed" && isLogExecutionSignal(log));
}

function nonExecutionFailures(input: PullRequestInput): string[] {
  return [
    ...input.checks
      .filter((check) => check.status === "failed" && !isCheckExecutionSignal(check))
      .map((check) => redactSecrets(check.name)),
    ...input.logs
      .filter((log) => log.status === "failed" && !isLogExecutionSignal(log))
      .map((log) => redactSecrets(log.source))
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

function computeSummaryConfidence(
  evidenceCoverage: number,
  priority: PriorityLevel,
  limitationCount: number,
  hasExecutionEvidence: boolean
): number {
  const priorityCap: Record<PriorityLevel, number> = {
    low: 0.95,
    medium: 0.82,
    high: 0.72,
    blocker: 0.45
  };
  const limitationPenalty = Math.max(0.85, 1 - limitationCount * 0.03);
  const executionCap = hasExecutionEvidence ? 1 : 0.7;
  const confidence = Math.min(evidenceCoverage / 100, priorityCap[priority], executionCap) * limitationPenalty;

  return round2(Math.max(0.2, confidence));
}

function buildTopRisks(
  requirements: RequirementFinding[],
  outOfScopeFiles: string[],
  missingTests: MissingTestFinding[],
  ciStatus: CheckStatus,
  hasNonExecutionCheckFailures: boolean,
  proofGraph: ProofGraph
): string[] {
  const risks: string[] = [];
  const highProofGaps = proofGraph.nodes.flatMap((node) => node.gapSignals).filter((gap) => gap.severity === "high" || gap.severity === "blocker");
  const unavailableProofGaps = proofGraph.nodes.flatMap((node) => node.gapSignals).filter((gap) => gap.kind === "evidence_unavailable");

  if (ciStatus === "failed") risks.push("Test/build execution failed, so the PR is not proven ready.");
  if (hasNonExecutionCheckFailures) risks.push("Static or merge-gate checks failed outside test/build proof.");
  if (unavailableProofGaps.length > 0) {
    risks.push("Some requirements have unavailable or inconclusive deterministic evidence.");
  }
  if (highProofGaps.some((gap) => gap.kind === "missing_targeted_test" || gap.kind === "self_reported_test_gap")) {
    risks.push("Requirement-level proof graph found missing targeted proof.");
  }
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
  ciStatus: CheckStatus,
  hasExecutionEvidence: boolean,
  evidenceRefsCapped: boolean,
  omittedEvidenceByKind: Partial<Record<EvidenceItem["kind"], number>>,
  omittedRequirementCount: number,
  omittedScopeCount: number
): string[] {
  const limitations: string[] = [];

  limitations.push(...(input.limitations ?? []));
  if (!input.taskText.trim()) limitations.push("No original task text was provided; criteria were inferred from PR description.");
  if (!hasExecutionEvidence) {
    if (!hasSourceConditionLimitation(limitations)) {
      limitations.push(
        hasAnyCheckOrLogMetadata(input)
          ? "Public check/status metadata was available, but no test/build execution evidence was found."
          : "No public test/build workflow run, check, or raw CI log was available."
      );
    }
    limitations.push("Confidence is based only on issue, diff, and test-artifact evidence because no public test/build execution evidence was found.");
  }
  if (ciStatus === "unknown" && !hasSourceConditionLimitation(limitations)) {
    limitations.push("No public test/build workflow run, check, or raw CI log was available.");
  }
  if (evidenceRefsCapped) {
    limitations.push(`Some evidence references were capped at ${MAX_EVIDENCE_REFS_PER_FIELD} per field to keep the report bounded.`);
  }
  const omittedEvidence = Object.entries(omittedEvidenceByKind).filter(([, count]) => typeof count === "number" && count > 0);
  if (omittedEvidence.length > 0) limitations.push(`Evidence index was bounded at 200 items; omitted ${omittedEvidence.map(([kind, count]) => `${kind}:${count}`).join(", ")}.`);
  if (omittedRequirementCount > 0) limitations.push(`Requirement extraction was bounded at 8 requirements; ${omittedRequirementCount} additional candidate requirement(s) were omitted.`);
  if (omittedScopeCount > 0) limitations.push(`Scope findings were bounded at ${MAX_SCOPE_FINDINGS} files; ${omittedScopeCount} additional candidate file(s) were omitted.`);
  if (requirements.some((finding) => finding.status === "unclear")) {
    limitations.push("At least one requirement needs human interpretation.");
  }

  return uniqueRefs(limitations);
}

function hasTestBuildExecutionEvidence(input: PullRequestInput): boolean {
  return input.checks.some((check) => isCheckExecutionSignal(check)) ||
    input.logs.some((log) => isLogExecutionSignal(log));
}

function hasAnyCheckOrLogMetadata(input: PullRequestInput): boolean {
  return input.checks.length > 0 || input.logs.length > 0;
}

function hasSourceConditionLimitation(limitations: string[]): boolean {
  return limitations.some((limitation) =>
    /Public GitHub Actions metadata showed|Public commit status metadata (?:was available|showed)|No public test\/build workflow run/i.test(limitation)
  );
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
