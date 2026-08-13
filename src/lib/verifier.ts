import {
  buildEvidenceIndexResult,
  extractClaims,
  extractKeywords,
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
import { executionEvidenceMatchesAnyTestPath } from "./evidence-relation";
import { redactSecrets } from "./redact";
import {
  aggregateVerificationCriteriaV2,
  canonicalVerificationBindingV2,
  materializeVerificationContractV2,
  parseVerificationContractV2,
  toVerificationContractReportV2,
  type VerificationBindingInputV2,
  type VerificationContractSourceInputV2
} from "./verification-contract-v2";
import { requirementProofAxisExpectations, requirementProofExpectations, type RequirementProofExpectations } from "./verifier-proof-expectations";
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
  RequirementProofAxis,
  RequirementProofNode,
  RequirementFinding,
  ReviewPriorityItem,
  VerificationReport,
  VerificationReportV2
} from "./types";
import { tenantReportAnalysisContext } from "./tenant-report-language";

const MAX_MISSING_TEST_FINDINGS = 100;
const MAX_FINDING_PROVENANCE_ITEMS = 5;
const MAX_FINDING_PROVENANCE_TEXT = 240;
const MAX_EVIDENCE_REFS_PER_FIELD = 50;
const MAX_SCOPE_FINDINGS = 100;

export function generateVerificationReport(input: PullRequestInput): VerificationReport {
  const requirementEvidence = extractRequirementEvidence(input.taskText, input.description, input.taskSource);
  return generateVerificationReportFromRequirements(input, {
    requirements: requirementEvidence.requirements,
    contexts: requirementEvidence.contexts,
    omittedRequirementCount: requirementEvidence.omittedRequirementCount
  });
}

export interface VerificationReportV2GenerationInput {
  input: PullRequestInput;
  contractSource: VerificationContractSourceInputV2;
  binding: VerificationBindingInputV2;
}

/**
 * Strict-contract report generation is deliberately separate from legacy v1.
 * The v2 evaluator has no ambient Check-name or prose-based path to `met`.
 */
export function generateVerificationReportV2(args: VerificationReportV2GenerationInput): VerificationReportV2 {
  const parsed = parseVerificationContractV2(args.contractSource);
  if (parsed.state === "authoritative" || parsed.state === "author_claim") {
    const bindingDigest = canonicalVerificationBindingV2(args.binding, parsed.contract);
    const materialized = materializeVerificationContractV2(parsed, bindingDigest);
    const report = generateVerificationReportFromRequirements(args.input, {
      requirements: materialized.objectives.map((objective) => ({
        id: objective.requirementId,
        source: parsed.state === "author_claim" ? "pr_description" : args.binding.sourceKind === "linked_issue" ? "issue" : "task",
        text: objective.objective,
        keywords: extractKeywords(objective.objective),
        priority: "must",
        role: "core_requirement",
        sourceQuality: parsed.state === "author_claim" ? "author_claim" : "explicit_acceptance_criteria",
        sourceSection: "AgentProof verification",
        contextRoles: []
      })),
      contexts: []
    });
    const contract = toVerificationContractReportV2(parsed, args.binding.sourceKind, materialized);
    return applyStrictContractOutcomeV2(report, contract);
  }

  const report = generateVerificationReport(args.input);
  return applyStrictContractOutcomeV2(
    report,
    toVerificationContractReportV2(parsed, null)
  );
}

/** Production entrypoint: raw contract source and binding remain transient on the input. */
export function generateVerificationReportV2FromInput(input: PullRequestInput): VerificationReportV2 {
  const source = input.verificationContractSourceV2;
  const binding = input.verificationContractBindingV2;
  if (source && binding) {
    return generateVerificationReportV2({ input, contractSource: source, binding });
  }
  return generateVerificationReportV2({
    input,
    contractSource: { kind: "provided_requirement", contract: undefined },
    binding: {
      sourceKind: "provided_requirement",
      sourceIdentity: "absent",
      sourceContent: "",
      headSha: input.sourceProvenance?.headSha ?? "",
      baseSha: input.sourceProvenance?.baseSha ?? ""
    }
  });
}

function applyStrictContractOutcomeV2(
  report: VerificationReport,
  contract: import("./verification-contract-v2").VerificationContractReportV2
): VerificationReportV2 {
  const stateByRequirement = new Map(contract.objectives.map((objective) => [
    objective.requirementId,
    aggregateVerificationCriteriaV2(objective.state, objective.criterionResults.map((result) => result.state))
  ]));
  const noApprovedContract = contract.state === "absent" || contract.state === "invalid";
  const gap = noApprovedContract
    ? "Outcome was not assessed against an approved verification contract."
    : "A required verification criterion was unavailable, incomplete, or not yet satisfied.";
  const requirements = report.requirements.map((requirement) => ({
    ...requirement,
    evidenceStatus: requirement.evidenceStatus ?? requirement.status,
    status: stateByRequirement.get(requirement.requirementId) ?? "unclear",
    gaps: appendOnce(requirement.gaps, gap)
  }));
  const nodes = report.proofGraph.nodes.map((node) => ({
    ...node,
    status: stateByRequirement.get(node.requirementId) ?? "unclear",
    gapSignals: node.gapSignals.some((signal) => signal.message === gap)
      ? node.gapSignals
      : [...node.gapSignals, {
        kind: "ambiguous_requirement" as const,
        severity: "medium" as const,
        message: gap,
        evidenceRefs: []
      }]
  }));
  const requirementsWithGaps = nodes.filter((node) => node.gapSignals.length > 0).length;
  const gapCount = nodes.reduce((count, node) => count + node.gapSignals.length, 0);
  return {
    ...report,
    reportSchemaVersion: "verification-report.v2",
    verificationContract: contract,
    requirements,
    proofGraph: {
      ...report.proofGraph,
      nodes,
      summary: { ...report.proofGraph.summary, requirementsWithGaps, gapCount }
    }
  };
}

function appendOnce(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

export interface DeterministicRequirementReportSelection {
  requirements: Requirement[];
  contexts: RequirementContextSignal[];
  omittedRequirementCount?: number;
  proofExpectationsByRequirement?: ReadonlyMap<string, RequirementProofExpectations>;
  evidenceContextRequirementIdsByRequirement?: ReadonlyMap<string, readonly string[]>;
}

export interface VerifierEvidenceLookup {
  readonly testEvidenceRefs: readonly string[];
  readonly testEvidenceItems: readonly EvidenceItem[];
  readonly implementationArtifactRefs: readonly string[];
  refsForPath(path: string): string[];
  pathsForRefs(refs: readonly string[]): string[];
  evidenceForRef(ref: string): EvidenceItem | undefined;
  passingExecutionForLabel(label: string): EvidenceItem | undefined;
  firstFilesForRefs(refs: readonly string[]): string[];
  singleArtifactFallbackRefs(kind: "documentation" | "ci"): string[];
  provenanceForRefs(refs: string[]): FindingProvenance[];
}

type RequirementEvidenceMatch = ReturnType<typeof requirementEvidenceMatch>;
type MatchedRequirementEvidence = { item: EvidenceItem; match: RequirementEvidenceMatch };

export interface RequirementEvidenceRelevance {
  readonly matches: readonly MatchedRequirementEvidence[];
  readonly failedExecutionRefs: readonly string[];
  readonly passingExecutionRefs: readonly string[];
  canonicalOverlap(item: EvidenceItem): boolean;
  refsWhere(predicate: (item: EvidenceItem, match: RequirementEvidenceMatch) => boolean): string[];
}

export interface RequirementEvidenceRelevanceIndex {
  /** Deterministic instrumentation: normalized label/summary is read once per evidence item. */
  readonly evidenceTextScanCount: number;
  readonly passingExecutionRefs: readonly string[];
  forRequirement(requirement: Requirement): RequirementEvidenceRelevance;
}

interface KeywordTrieNode {
  next: Map<string, number>;
  fail: number;
  outputs: string[];
}

/**
 * Builds exact substring relevance with one multi-pattern scan per evidence item.
 * Work is O(keyword characters + evidence text characters + emitted matches).
 */
export function buildRequirementEvidenceRelevanceIndex(
  requirements: readonly Requirement[],
  evidenceIndex: readonly EvidenceItem[],
  input: Pick<PullRequestInput, "checks" | "logs">
): RequirementEvidenceRelevanceIndex {
  const canonicalKeywordsByRequirement = new Map<string, string[]>();
  const allKeywords = new Set<string>();
  for (const requirement of requirements) {
    for (const keyword of requirement.keywords) allKeywords.add(keyword);
    const canonicalKeywords = extractKeywords(requirement.text)
      .filter((keyword) => keyword.length >= 4 && !WEAK_SINGLE_MATCH_KEYWORDS.has(keyword));
    canonicalKeywordsByRequirement.set(requirement.id, canonicalKeywords);
    for (const keyword of canonicalKeywords) allKeywords.add(keyword);
  }

  const trie = buildKeywordTrie(allKeywords);
  const keywordHitsByEvidence = new Map<number, Set<string>>();
  const evidenceIndexesByKeyword = new Map<string, number[]>();
  const evidenceIndexByItem = new Map<EvidenceItem, number>();
  let evidenceTextScanCount = 0;
  for (let index = 0; index < evidenceIndex.length; index += 1) {
    const item = evidenceIndex[index];
    evidenceIndexByItem.set(item, index);
    const hits = scanKeywordTrie(trie, `${item.label} ${item.summary}`.toLowerCase());
    evidenceTextScanCount += 1;
    keywordHitsByEvidence.set(index, hits);
    for (const keyword of hits) {
      const indexes = evidenceIndexesByKeyword.get(keyword);
      if (indexes) indexes.push(index);
      else evidenceIndexesByKeyword.set(keyword, [index]);
    }
  }

  const failedRefs = new Set(executionFailureEvidenceRefs(input, evidenceIndex));
  const failedEvidenceIndexes = new Set<number>();
  const opaqueFailedEvidenceIndexes: number[] = [];
  for (let index = 0; index < evidenceIndex.length; index += 1) {
    const item = evidenceIndex[index];
    if (!failedRefs.has(item.id)) continue;
    failedEvidenceIndexes.add(index);
    if (isOpaqueMatrixExecutionFailure(item)) opaqueFailedEvidenceIndexes.push(index);
  }
  const passingExecutionRefs = evidenceIndex.filter(isPassingTestExecutionEvidence).map((item) => item.id);
  const relevanceByRequirement = new Map<string, RequirementEvidenceRelevance>();
  for (const requirement of requirements) {
    const candidateIndexes = evidenceIndexesForKeywords(requirement.keywords, evidenceIndexesByKeyword);
    const matches = candidateIndexes.map((index): MatchedRequirementEvidence => {
      const item = evidenceIndex[index];
      const hits = keywordHitsByEvidence.get(index) ?? new Set<string>();
      const matchedKeywords = requirement.keywords.filter((keyword) => hits.has(keyword));
      const meaningfulHits = matchedKeywords.filter((keyword) => keyword.length >= 4 && !WEAK_SINGLE_MATCH_KEYWORDS.has(keyword));
      const canProve = item.kind === "diff" || item.kind === "test" || item.kind === "log" || item.kind === "check";
      return {
        item,
        match: {
          score: matchedKeywords.length,
          strong: canProve && (meaningfulHits.length >= 2 || meaningfulHits.some((keyword) => keyword.length >= 8)),
          meaningfulScore: meaningfulHits.length
        }
      };
    });
    const canonicalKeywords = canonicalKeywordsByRequirement.get(requirement.id) ?? [];
    const canonicalOverlap = (item: EvidenceItem) => {
      const index = evidenceIndexByItem.get(item);
      if (index === undefined) return false;
      const hits = keywordHitsByEvidence.get(index);
      return Boolean(hits && canonicalKeywords.some((keyword) => hits.has(keyword)));
    };
    const failedCandidateIndexes = new Set([
      ...evidenceIndexesForKeywords(canonicalKeywords, evidenceIndexesByKeyword),
      ...opaqueFailedEvidenceIndexes
    ]);
    const failedExecutionRefs = [...failedCandidateIndexes]
      .filter((index) => failedEvidenceIndexes.has(index))
      .sort((left, right) => left - right)
      .map((index) => evidenceIndex[index].id);
    relevanceByRequirement.set(requirement.id, {
      matches,
      failedExecutionRefs,
      passingExecutionRefs,
      canonicalOverlap,
      refsWhere(predicate) {
        return matches.filter(({ item, match }) => predicate(item, match)).map(({ item }) => item.id);
      }
    });
  }

  return {
    evidenceTextScanCount,
    passingExecutionRefs,
    forRequirement(requirement) {
      const relevance = relevanceByRequirement.get(requirement.id);
      if (!relevance) throw new Error(`Requirement relevance was not indexed: ${requirement.id}`);
      return relevance;
    }
  };
}

function buildKeywordTrie(keywords: ReadonlySet<string>): KeywordTrieNode[] {
  const nodes: KeywordTrieNode[] = [{ next: new Map(), fail: 0, outputs: [] }];
  for (const keyword of keywords) {
    if (!keyword) continue;
    let state = 0;
    for (const character of keyword) {
      const existing = nodes[state].next.get(character);
      if (existing !== undefined) {
        state = existing;
      } else {
        const parent = state;
        state = nodes.length;
        nodes[parent].next.set(character, state);
        nodes.push({ next: new Map(), fail: 0, outputs: [] });
      }
    }
    nodes[state].outputs.push(keyword);
  }
  const queue = [...nodes[0].next.values()];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const state = queue[cursor];
    for (const [character, nextState] of nodes[state].next) {
      queue.push(nextState);
      let fallback = nodes[state].fail;
      while (fallback !== 0 && !nodes[fallback].next.has(character)) fallback = nodes[fallback].fail;
      nodes[nextState].fail = nodes[fallback].next.get(character) ?? 0;
      nodes[nextState].outputs.push(...nodes[nodes[nextState].fail].outputs);
    }
  }
  return nodes;
}

function scanKeywordTrie(nodes: readonly KeywordTrieNode[], text: string): Set<string> {
  const hits = new Set<string>();
  let state = 0;
  for (const character of text) {
    while (state !== 0 && !nodes[state].next.has(character)) state = nodes[state].fail;
    state = nodes[state].next.get(character) ?? 0;
    for (const keyword of nodes[state].outputs) hits.add(keyword);
  }
  return hits;
}

function evidenceIndexesForKeywords(
  keywords: readonly string[],
  evidenceIndexesByKeyword: ReadonlyMap<string, readonly number[]>
): number[] {
  const indexes = new Set<number>();
  for (const keyword of keywords) {
    for (const index of evidenceIndexesByKeyword.get(keyword) ?? []) indexes.add(index);
  }
  return [...indexes].sort((left, right) => left - right);
}

/** Builds the path/ID views once so per-file report construction stays linear. */
export function buildVerifierEvidenceLookup(evidenceIndex: readonly EvidenceItem[]): VerifierEvidenceLookup {
  const evidenceById = new Map<string, EvidenceItem>();
  const refsByPath = new Map<string, string[]>();
  const testEvidenceRefs: string[] = [];
  const testEvidenceItems: EvidenceItem[] = [];
  const implementationArtifactRefs: string[] = [];
  const documentationArtifactItems: EvidenceItem[] = [];
  const ciArtifactItems: EvidenceItem[] = [];
  const passingExecutionByLabel = new Map<string, EvidenceItem>();

  for (const item of evidenceIndex) {
    evidenceById.set(item.id, item);
    if (isPassingTestExecutionEvidence(item)) passingExecutionByLabel.set(item.label, item);
    if (item.kind === "test") testEvidenceItems.push(item);
    if (item.kind === "diff" || item.kind === "changed_file") {
      const path = item.locator ?? item.label;
      if (!isTestFile(path) && !isDocumentationPath(path) && !isCiPath(path)) {
        implementationArtifactRefs.push(item.id);
      }
      if (isDocumentationPath(path)) documentationArtifactItems.push(item);
      if (isCiPath(path)) ciArtifactItems.push(item);
    }
    if (item.kind === "test" || /test/i.test(item.summary)) testEvidenceRefs.push(item.id);
    const rawPaths = [item.locator, item.label].filter((value): value is string => Boolean(value));
    const keys = new Set(rawPaths.flatMap((value) => [value, safeReportPath(value)]));
    for (const key of keys) {
      const refs = refsByPath.get(key);
      if (refs) refs.push(item.id);
      else refsByPath.set(key, [item.id]);
    }
  }

  return {
    testEvidenceRefs,
    testEvidenceItems,
    implementationArtifactRefs,
    refsForPath(path) {
      return [...(refsByPath.get(path) ?? refsByPath.get(safeReportPath(path)) ?? [])];
    },
    pathsForRefs(refs) {
      return refs
        .map((ref) => evidenceById.get(ref))
        .map((item) => item?.locator ?? item?.label ?? "")
        .filter(Boolean);
    },
    evidenceForRef(ref) {
      return evidenceById.get(ref);
    },
    passingExecutionForLabel(label) {
      return passingExecutionByLabel.get(label);
    },
    firstFilesForRefs(refs) {
      return uniqueRefs(refs
        .map((ref) => evidenceById.get(ref))
        .map((item) => item?.locator ?? item?.label ?? "")
        .filter((value) => isConcreteFilePath(value))
        .map(safeReportPath));
    },
    singleArtifactFallbackRefs(kind) {
      const candidates = kind === "documentation" ? documentationArtifactItems : ciArtifactItems;
      const paths = new Set(candidates.map((item) => item.locator ?? item.label));
      return paths.size === 1 ? candidates.map((item) => item.id) : [];
    },
    provenanceForRefs(refs) {
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
        if (provenance.length >= MAX_FINDING_PROVENANCE_ITEMS) break;
      }
      return provenance;
    }
  };
}

/** Reuses the deterministic evidence engine for a server-authorized requirement set. */
export function generateVerificationReportFromRequirements(
  input: PullRequestInput,
  selection: DeterministicRequirementReportSelection
): VerificationReport {
  const evidenceBuild = buildEvidenceIndexResult(
    input.taskText,
    input.description,
    input.changedFiles,
    input.checks,
    input.logs,
    input.taskSource
  );
  const evidenceIndex = evidenceBuild.items;
  const evidenceLookup = buildVerifierEvidenceLookup(evidenceIndex);
  const requirements = selection.requirements;
  const relevanceIndex = buildRequirementEvidenceRelevanceIndex(requirements, evidenceIndex, input);
  const ciStatus = aggregateStatus(input.checks, input.logs);
  const rawRequirementFindings = requirements.map((requirement) =>
    constrainAuthorIntentFinding(requirement, evaluateRequirement(
      requirement,
      evidenceIndex,
      input,
      relevanceIndex.forRequirement(requirement),
      evidenceLookup
    ))
  );
  const missingTests = detectMissingTests(input, evidenceIndex, evidenceLookup);
  const proofBuild = buildProofGraph(
    requirements,
    rawRequirementFindings,
    input,
    evidenceIndex,
    missingTests,
    ciStatus,
    selection.contexts,
    selection.proofExpectationsByRequirement,
    selection.evidenceContextRequirementIdsByRequirement,
    evidenceLookup,
    relevanceIndex
  );
  const proofGraph = proofBuild.proofGraph;
  const proofAdjustedRequirementFindings = applyProofGraphToRequirements(rawRequirementFindings, proofGraph, proofBuild.proofAxesByRequirement);
  const cappedRequirements = capRequirementFindingRefs(proofAdjustedRequirementFindings, requirements, evidenceIndex);
  const requirementFindings = cappedRequirements.findings;
  const rawScope = detectScopeCreep(requirements, input.changedFiles, evidenceLookup);
  const cappedScope = capScopeFindingRefs(rawScope, evidenceIndex, evidenceLookup);
  const scope = cappedScope.scope;
  const lintStatus = statusForCheck(input.checks, /lint/i);
  const typecheckStatus = statusForCheck(input.checks, /type(check|script)/i);
  const failedNonExecutionChecks = nonExecutionFailures(input);
  const reviewPriority = buildReviewPriority(input, requirementFindings, scope.outOfScopeFiles, missingTests, ciStatus, evidenceIndex, proofGraph, evidenceLookup);
  const priority = highestPriority(reviewPriority);
  const evidenceRefsCapped = cappedRequirements.capped || cappedScope.capped || hasRequirementEvidenceRefPressure(requirements, relevanceIndex);
  const hasExecutionEvidence = hasTestBuildExecutionEvidence(input);
  const limitations = buildLimitations(input, requirementFindings, ciStatus, hasExecutionEvidence, evidenceRefsCapped, evidenceBuild.omittedByKind, selection.omittedRequirementCount ?? 0, scope.omittedCount);
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
      provenance: provenanceWithExecutionSuites(input)
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
  report.analysisContext = tenantReportAnalysisContext(report);
  return report;
}

function provenanceWithExecutionSuites(input: PullRequestInput) {
  const provenance = input.sourceProvenance;
  if (!provenance || provenance.origin !== "github_snapshot" || !input.executionSuites?.length) {
    return provenance;
  }

  return {
    ...provenance,
    executionSuites: input.executionSuites.map((suite) => ({
      headSha: suite.headSha,
      status: suite.status,
      executionSource: redactSecrets(suite.executionSource),
      runner: suite.runner,
      scope: suite.scope,
      testPaths: suite.testPaths.map((path) => redactSecrets(path))
    }))
  };
}

function constrainAuthorIntentFinding(requirement: Requirement, finding: RequirementFinding): RequirementFinding {
  if (requirement.sourceQuality !== "author_claim" || finding.status !== "met") return finding;

  return {
    ...finding,
    status: "partial",
    gaps: uniqueRefs([...finding.gaps, "PR author intent is not an authoritative linked requirement."]).slice(0, 8),
    reviewerNote: "Review consistency between the PR intent, changed files, tests, and checks; do not treat author intent as requirement satisfaction.",
    confidence: Math.min(finding.confidence, 0.62)
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
  input: PullRequestInput,
  relevance: RequirementEvidenceRelevance,
  evidenceLookup: VerifierEvidenceLookup
): RequirementFinding {
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

  const expectations = requirementProofExpectations(requirement.text);
  const hasExplicitArtifactObjective = expectations.documentation || expectations.ci || expectations.targetedTest;

  if (requirement.keywords.length === 0 && !hasExplicitArtifactObjective) {
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

  const matches = relevance.matches;
  const refs = matches.map(({ item }) => item.id);

  const implementationMatches = matches.filter(({ item }) =>
    item.kind === "changed_file" || item.kind === "diff"
  );
  const strongImplementationRefs = implementationMatches
    .filter(({ item, match }) => item.kind === "diff" && match.strong)
    .map(({ item }) => item.id);
  const hasImplementationEvidence = implementationMatches.length > 0;
  const hasStrongImplementationEvidence = strongImplementationRefs.length > 0;
  const asksForTests = expectations.targetedTest;
  const matchingTestArtifactRefs = matches
    .filter(({ item, match }) => item.kind === "test" && isUsefulArtifactMatch(match))
    .map(({ item }) => item.id);
  const hasMatchingTestArtifactEvidence = matchingTestArtifactRefs.length > 0;
  const matchingPassingExecutionRefs = matches
    .filter(({ item, match }) => match.strong && isPassingTestExecutionEvidence(item))
    .map(({ item }) => item.id);
  const hasMatchingPassingTestExecutionEvidence = matchingPassingExecutionRefs.length > 0;
  const asksForVisualProof = expectations.visual;
  const matchingVisualEvidenceRefs = matches
    .filter(({ item, match }) => match.strong && isVisualVerificationEvidence(item))
    .map(({ item }) => item.id);
  const hasMatchingVisualEvidence = matchingVisualEvidenceRefs.length > 0;
  const matchingFailedExecutionRefs = relevance.failedExecutionRefs;
  const failedCheck = matchingFailedExecutionRefs.length > 0;

  if (failedCheck && expectations.execution) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: hasImplementationEvidence ? "partial" : "unclear",
      evidenceRefs: uniqueRefs([...refs, ...matchingFailedExecutionRefs]).slice(0, 5),
      gaps: ["CI has a failing check, so requirement satisfaction is not proven."],
      reviewerNote: "Review failed checks before relying on implementation evidence.",
      confidence: hasImplementationEvidence ? 0.45 : 0.25
    };
  }

  const implementationEvidenceRefs = implementationMatches.map(({ item }) => item.id);
  const targetedProofRefs = targetedTestEvidenceRefsForRequirement(
    requirement,
    evidenceIndex,
    input,
    implementationEvidenceRefs,
    expectations,
    relevance,
    evidenceLookup
  );
  const artifactRefs = artifactEvidenceRefsByExpectation(
    requirement,
    evidenceIndex,
    implementationEvidenceRefs,
    targetedProofRefs,
    expectations,
    relevance,
    evidenceLookup
  );
  const expectedArtifactGroups = Object.values(artifactRefs);
  const hasExpectedArtifacts = expectedArtifactGroups.length > 0 && expectedArtifactGroups.every((items) => items.length > 0);
  const anyPassingExecutionRefs = relevance.passingExecutionRefs;

  if (!expectations.implementation && hasExplicitArtifactObjective && hasExpectedArtifacts) {
    if (expectations.execution && anyPassingExecutionRefs.length === 0) {
      return {
        requirementId: requirement.id,
        requirementText: requirement.text,
        status: "partial",
        evidenceRefs: uniqueRefs([...expectedArtifactGroups.flat(), ...refs]).slice(0, 5),
        gaps: [expectations.targetedTest
          ? "Test files changed, but no passing test check or log proves those tests executed."
          : "The required artifact changed, but no passing execution evidence was collected."],
        reviewerNote: "Request a passing check or log tied to this explicit objective.",
        confidence: 0.58
      };
    }
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: expectations.execution ? "met" : "partial",
      evidenceRefs: uniqueRefs([...expectedArtifactGroups.flat(), ...anyPassingExecutionRefs, ...refs]).slice(0, 5),
      gaps: [],
      reviewerNote: expectations.execution
        ? "The explicit artifact objective has matching deterministic evidence."
        : "The explicit documentation artifact has matching deterministic evidence; no execution proof is required by this objective.",
      confidence: expectations.execution ? 0.82 : 0.72
    };
  }

  if (asksForTests && !expectations.implementation && hasMatchingTestArtifactEvidence && hasMatchingPassingTestExecutionEvidence && !failedCheck) {
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

  if (asksForTests && !expectations.implementation && hasMatchingTestArtifactEvidence && !hasMatchingPassingTestExecutionEvidence) {
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

  if (asksForTests && expectations.implementation && hasMatchingTestArtifactEvidence && !hasMatchingPassingTestExecutionEvidence) {
    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      status: "partial",
      evidenceRefs: refsForReport(matches, [...matchingTestArtifactRefs, ...strongImplementationRefs]),
      gaps: ["Test files changed, but no passing test check or log proves those tests executed."],
      reviewerNote: "Request the exact passing test command or CI check tied to this criterion.",
      confidence: 0.58
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
  evidenceIndex: EvidenceItem[],
  evidenceLookup: VerifierEvidenceLookup
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
      provenance: evidenceLookup.provenanceForRefs(evidenceRefs)
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
  matches: ReadonlyArray<{ item: EvidenceItem; match: { score: number; strong: boolean } }>,
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

/**
 * A generic suite is only requirement-local when GitHub snapshot metadata
 * proves that its normalized, unfiltered discovery scope includes a changed
 * test artifact already linked to this requirement.
 */
function verifiedSuiteExecutionEvidenceRefs(
  input: PullRequestInput,
  evidenceLookup: VerifierEvidenceLookup,
  targetedTestEvidenceRefs: string[]
): string[] {
  const headSha = input.sourceProvenance?.origin === "github_snapshot"
    ? input.sourceProvenance.headSha
    : undefined;
  if (!headSha || targetedTestEvidenceRefs.length === 0) return [];

  const targetedPaths = new Set(evidenceLookup.pathsForRefs(targetedTestEvidenceRefs)
    .map((path) => path.toLowerCase()));
  if (targetedPaths.size === 0) return [];

  return uniqueRefs((input.executionSuites ?? [])
    .filter((suite) =>
      suite.status === "passed" &&
        suite.headSha === headSha &&
        suite.scope === "repository_discovery" &&
        suite.testPaths.some((path) => targetedPaths.has(path.toLowerCase()))
    )
    .map((suite) => evidenceLookup.passingExecutionForLabel(suite.executionSource)?.id)
    .filter((ref): ref is string => Boolean(ref)));
}

function evidenceStatusFromSummary(summary: string): CheckStatus {
  const match = summary.trim().match(/^Status:\s*(passed|failed|pending|unknown)\b/i);

  return match ? match[1].toLowerCase() as CheckStatus : "unknown";
}

function isVisualRequirement(text: string): boolean {
  return requirementProofExpectations(text).visual;
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
  contexts: RequirementContextSignal[],
  proofExpectationsByRequirement: ReadonlyMap<string, RequirementProofExpectations> | undefined,
  evidenceContextRequirementIdsByRequirement: ReadonlyMap<string, readonly string[]> | undefined,
  evidenceLookup: VerifierEvidenceLookup,
  relevanceIndex: RequirementEvidenceRelevanceIndex
): { proofGraph: ProofGraph; proofAxesByRequirement: Map<string, RequirementProofAxis[]> } {
  const findingByRequirement = new Map(findings.map((finding) => [finding.requirementId, finding]));
  const selfReportedTestGapRefs = selfReportedTestGapEvidenceRefs(evidenceIndex);
  const changedFileEvidenceUnavailable = hasChangedFileEvidenceUnavailable(input);
  const diffEvidenceUnavailable = hasDiffEvidenceUnavailable(input);
  const authoritativeChangedFileInventory = hasAuthoritativeChangedFileInventory(input);
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const implementationArtifactRefs = new Set(evidenceLookup.implementationArtifactRefs);

  const proofAxesByRequirement = new Map<string, RequirementProofAxis[]>();
  const nodes = requirements.map((requirement): RequirementProofNode => {
    const relevance = relevanceIndex.forRequirement(requirement);
    const finding = findingByRequirement.get(requirement.id);
    const expectations = proofExpectationsByRequirement?.get(requirement.id) ?? requirementProofAxisExpectations(requirement.text);
    const implementationEvidenceRefs = requirementEvidenceRefs(relevance, (item, match) =>
      (item.kind === "diff" || item.kind === "changed_file") && match.score > 0
    );
    const contextualImplementationRefs = contextualImplementationEvidenceRefs(
      requirement.id,
      evidenceContextRequirementIdsByRequirement,
      requirementById,
      relevanceIndex,
      evidenceLookup,
      implementationArtifactRefs
    );
    const targetedTestEvidenceRefs = targetedTestEvidenceRefsForRequirement(
      requirement,
      evidenceIndex,
      input,
      uniqueRefs([...implementationEvidenceRefs, ...contextualImplementationRefs]),
      expectations,
      relevance,
      evidenceLookup,
      contextualImplementationRefs.length > 0 || evidenceContextRequirementIdsByRequirement?.has(requirement.id) === true
    );
    const directlyMatchingExecutionRefs = requirementEvidenceRefs(relevance, (item, match) =>
      (item.kind === "check" || item.kind === "log") &&
      isEvidenceExecutionSignal(item) &&
      (relevance.canonicalOverlap(item) || isOpaqueMatrixExecutionFailure(item))
    );
    const verifiedSuiteExecutionRefs = verifiedSuiteExecutionEvidenceRefs(input, evidenceLookup, targetedTestEvidenceRefs);
    const testLinkedExecutionRefs = passingExecutionEvidenceRefsForTargetedTests(
      targetedTestEvidenceRefs,
      evidenceIndex,
      evidenceLookup
    );
    const matchingExecutionRefs = uniqueRefs([
      ...directlyMatchingExecutionRefs,
      ...verifiedSuiteExecutionRefs,
      ...testLinkedExecutionRefs
    ]);
    const matchingFailedExecutionRefs = [...relevance.failedExecutionRefs];
    const matchingVisualRefs = requirementEvidenceRefs(relevance, (item, match) =>
      isVisualVerificationEvidence(item) && relevance.canonicalOverlap(item)
    );
    const matchingInteractionRefs = matchingVisualRefs;
    const executionEvidenceRefs = uniqueRefs([
      ...matchingExecutionRefs,
      ...matchingFailedExecutionRefs
    ]).slice(0, 8);
    const relatedMissingTests = missingTests.filter((missing) =>
      implementationEvidenceRefs.some((ref) => evidenceLookup.refsForPath(missing.path).includes(ref)) ||
      missing.evidenceRefs.some((ref) => implementationEvidenceRefs.includes(ref))
    );
    const gapSignals: RequirementProofNode["gapSignals"] = [];
    const artifactRefs = artifactEvidenceRefsByExpectation(
      requirement,
      evidenceIndex,
      implementationEvidenceRefs,
      targetedTestEvidenceRefs,
      expectations,
      relevance,
      evidenceLookup
    );
    // The full-report validator checks satisfied artifact axes against the
    // corresponding proof-node references. Keep the exact axis candidates
    // ahead of broader relevance matches, which may otherwise consume the
    // bounded proof-node reference budget on large PRs.
    const proofArtifactRefs = uniqueRefs([
      ...(artifactRefs.implementation ?? []),
      ...(artifactRefs.documentation ?? []),
      ...(artifactRefs.ci ?? [])
    ]);
    const implementationPatchEvidenceUnavailable = expectations.implementation &&
      (artifactRefs.implementation ?? []).some((ref) =>
        evidenceLookup.evidenceForRef(ref)?.kind === "changed_file"
      ) &&
      !(artifactRefs.implementation ?? []).some((ref) =>
        evidenceLookup.evidenceForRef(ref)?.kind === "diff"
      );
    const expectedArtifactRefs = uniqueRefs(Object.values(artifactRefs).flat());
    const forbiddenImplementationRefs = expectations.noImplementationChanges
      ? [...evidenceLookup.implementationArtifactRefs]
      : [];

    const proofAxes = buildRequirementProofAxes({
      expectations,
      artifactRefs,
      forbiddenImplementationRefs,
      matchingExecutionRefs,
      verifiedSuiteExecutionRefs,
      matchingFailedExecutionRefs,
      matchingVisualRefs,
      matchingInteractionRefs,
      evidenceLookup,
      changedFileEvidenceUnavailable,
      diffEvidenceUnavailable,
      implementationPatchEvidenceUnavailable,
      authoritativeChangedFileInventory
    });
    proofAxesByRequirement.set(requirement.id, proofAxes);

    if (implementationPatchEvidenceUnavailable) {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "Changed-file metadata matched this requirement, but its patch text was unavailable; implementation proof is inconclusive rather than absent.",
        evidenceRefs: artifactRefs.implementation ?? []
      });
    } else if (Object.keys(artifactRefs).length > 0 && expectedArtifactRefs.length === 0 && changedFileEvidenceUnavailable) {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "Changed-file evidence could not be collected, so missing required artifact proof is inconclusive rather than proven absent.",
        evidenceRefs: finding?.evidenceRefs.length ? finding.evidenceRefs : sourceEvidenceRefs(evidenceIndex)
      });
    } else {
      for (const [kind, refs] of Object.entries(artifactRefs) as Array<[keyof typeof artifactRefs, string[]]>) {
        if (refs.length > 0) continue;
        const isTargetedTest = kind === "targetedTest";
        gapSignals.push({
          kind: isTargetedTest ? "missing_targeted_test" : "missing_implementation",
          severity: isTargetedTest
            ? targetedProofGapSeverity(requirement, input, ciStatus)
            : missingImplementationSeverity(requirement, input),
          message: `No ${artifactExpectationLabel(kind)} evidence clearly maps to this requirement.`,
          evidenceRefs: finding?.evidenceRefs ?? sourceEvidenceRefs(evidenceIndex)
        });
      }
    }

    const absentImplementationAxis = proofAxes.find((axis) => axis.subject === "implementation" && axis.polarity === "absent");
    if (absentImplementationAxis?.state === "violated") {
      gapSignals.push({
        kind: "forbidden_implementation_present",
        severity: "high",
        message: "Implementation files changed even though this requirement forbids implementation changes.",
        evidenceRefs: absentImplementationAxis.evidenceRefs
      });
    } else if (absentImplementationAxis?.state === "incomplete") {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "The changed-file inventory was incomplete, so implementation absence could not be proven.",
        evidenceRefs: absentImplementationAxis.evidenceRefs
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

    if (
      expectations.implementation &&
      implementationEvidenceRefs.length > 0 &&
      diffEvidenceUnavailable &&
      implementationEvidenceRefs.every((ref) =>
        evidenceLookup.evidenceForRef(ref)?.kind !== "diff"
      )
    ) {
      gapSignals.push({
        kind: "evidence_unavailable",
        severity: "medium",
        message: "Changed-file metadata was collected, but patch evidence was unavailable for at least one mapped file.",
        evidenceRefs: implementationEvidenceRefs.slice(0, 8)
      });
    }

    const matchingPassingExecutionRefs = matchingExecutionRefs.filter((ref) =>
      Boolean(evidenceLookup.evidenceForRef(ref) && isPassingTestExecutionEvidence(evidenceLookup.evidenceForRef(ref)!))
    );
    if (matchingFailedExecutionRefs.length > 0 && expectations.execution) {
      gapSignals.push({
        kind: "failed_execution",
        severity: "blocker",
        message: "A relevant test/build execution signal failed, so this requirement is not proven ready.",
        evidenceRefs: matchingFailedExecutionRefs.slice(0, 8)
      });
    }

    if (expectations.interaction && matchingInteractionRefs.length === 0) {
      gapSignals.push({
        kind: "interaction_proof_missing",
        severity: "medium",
        message: "User-facing interaction needs component or browser evidence beyond logic and suite execution.",
        evidenceRefs: finding?.evidenceRefs ?? sourceEvidenceRefs(evidenceIndex)
      });
    }

    if (expectations.implementation && implementationEvidenceRefs.length > 0 && selfReportedTestGapRefs.length > 0) {
      gapSignals.push({
        kind: "self_reported_test_gap",
        severity: targetedProofGapSeverity(requirement, input, ciStatus),
        message: "The PR text indicates targeted tests may be absent or incomplete.",
        evidenceRefs: selfReportedTestGapRefs.slice(0, 5)
      });
    }

    if (expectations.visual && matchingVisualRefs.length === 0) {
      gapSignals.push({
        kind: "visual_proof_missing",
        severity: "medium",
        message: "Visual or browser-facing behavior needs proof beyond test/build status.",
        evidenceRefs: finding?.evidenceRefs ?? sourceEvidenceRefs(evidenceIndex)
      });
    }

    if (expectedArtifactRefs.length > 0 && expectations.execution && matchingPassingExecutionRefs.length === 0) {
      gapSignals.push({
        kind: "missing_execution",
        severity: "medium",
        message: "No deterministic test/build execution evidence was collected for this requirement.",
        evidenceRefs: expectedArtifactRefs.slice(0, 8)
      });
    }

    return {
      requirementId: requirement.id,
      requirementText: requirement.text,
      sourceRole: requirement.role,
      sourceQuality: requirement.sourceQuality,
      sourceSection: requirement.sourceSection,
      contextRoles: requirement.contextRoles,
      status: requirement.sourceQuality === "manual_check" && finding?.status === "unclear"
        ? "unclear"
        : requirement.sourceQuality === "author_claim" && finding?.status !== "met"
        ? finding?.status ?? "unclear"
        : aggregateProofAxisStatus(proofAxes, finding?.status ?? "unclear"),
      confidence: finding?.confidence ?? 0.2,
      implementationEvidenceRefs: uniqueRefs([
        ...proofArtifactRefs,
        ...implementationEvidenceRefs,
        ...contextualImplementationRefs,
      ]).slice(0, 8),
      targetedTestEvidenceRefs: targetedTestEvidenceRefs.slice(0, 8),
      executionEvidenceRefs,
      gapSignals: dedupeGapSignals(gapSignals),
      firstFiles: evidenceLookup.firstFilesForRefs(uniqueRefs([
        ...implementationEvidenceRefs,
        ...contextualImplementationRefs,
        ...targetedTestEvidenceRefs,
        ...relatedMissingTests.flatMap((item) => item.evidenceRefs)
      ])).slice(0, 5)
    };
  });

  const proofGraph: ProofGraph = {
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
  return { proofGraph, proofAxesByRequirement };
}

function applyProofGraphToRequirements(
  findings: RequirementFinding[],
  proofGraph: ProofGraph,
  proofAxesByRequirement: Map<string, RequirementProofAxis[]>
): RequirementFinding[] {
  const nodeByRequirement = new Map(proofGraph.nodes.map((node) => [node.requirementId, node]));

  return findings.map((finding) => {
    const node = nodeByRequirement.get(finding.requirementId);
    const proofAxes = proofAxesByRequirement.get(finding.requirementId);
    const prDescriptionAuthority = node?.sourceQuality === "author_claim"
      ? { evidenceStatus: finding.status, sourceAuthority: "pr_description" as const }
      : {};
    if (!node || !proofAxes || proofAxes.length === 0) return { ...finding, ...prDescriptionAuthority };

    const gapMessages = node.gapSignals.map((gap) => gap.message);
    const hasHardGap = node.gapSignals.some((gap) => gap.severity === "blocker" || gap.severity === "high");
    const hasEvidenceUnavailable = node.gapSignals.some((gap) => gap.kind === "evidence_unavailable");
    const status = node.status;
    const confidence = hasHardGap ? Math.min(finding.confidence, 0.58) : finding.confidence;
    // A met requirement with an execution axis must retain a matching
    // execution reference even when broad artifact evidence fills the bounded
    // requirement-level evidence list.
    const evidenceRefs = uniqueRefs([
      ...(status === "met" ? node.executionEvidenceRefs : []),
      ...finding.evidenceRefs,
      ...node.implementationEvidenceRefs,
      ...node.targetedTestEvidenceRefs,
      ...node.gapSignals.flatMap((gap) => gap.evidenceRefs)
    ]).slice(0, 12);

    return {
      ...finding,
      status,
      ...(node.sourceQuality === "author_claim" ? {
        evidenceStatus: aggregateProofAxisStatus(proofAxes, finding.status),
        sourceAuthority: "pr_description" as const
      } : prDescriptionAuthority),
      proofAxes,
      confidence,
      gaps: status === "met" ? [] : uniqueRefs([...finding.gaps, ...gapMessages]).slice(0, 8),
      evidenceRefs,
      reviewerNote: hasHardGap
        ? `${finding.reviewerNote} Review implementation, targeted test, and execution proof together before trusting this requirement.`
        : hasEvidenceUnavailable
          ? `${finding.reviewerNote} Treat unavailable file or patch evidence as a collection gap, not proof that implementation is absent.`
        : finding.reviewerNote
    };
  });
}

interface RequirementProofAxisBuildInput {
  expectations: RequirementProofExpectations;
  artifactRefs: Partial<Record<"implementation" | "documentation" | "ci" | "targetedTest", string[]>>;
  forbiddenImplementationRefs: string[];
  matchingExecutionRefs: string[];
  verifiedSuiteExecutionRefs: string[];
  matchingFailedExecutionRefs: string[];
  matchingVisualRefs: string[];
  matchingInteractionRefs: string[];
  evidenceLookup: VerifierEvidenceLookup;
  changedFileEvidenceUnavailable: boolean;
  diffEvidenceUnavailable: boolean;
  implementationPatchEvidenceUnavailable: boolean;
  authoritativeChangedFileInventory: boolean;
}

function buildRequirementProofAxes(input: RequirementProofAxisBuildInput): RequirementProofAxis[] {
  const axes: RequirementProofAxis[] = [];
  const addArtifactAxis = (
    subject: RequirementProofAxis["subject"],
    refs: string[],
    requiresDiff = false
  ) => {
    const usableRefs = requiresDiff
      ? refs.filter((ref) => input.evidenceLookup.evidenceForRef(ref)?.kind === "diff")
      : refs;
    const inventoryIncomplete = input.changedFileEvidenceUnavailable ||
      (requiresDiff && refs.length > 0 && (input.diffEvidenceUnavailable || input.implementationPatchEvidenceUnavailable));
    axes.push({
      subject,
      polarity: "present",
      state: usableRefs.length > 0 ? "satisfied" : inventoryIncomplete ? "incomplete" : "violated",
      evidenceRefs: uniqueRefs(usableRefs.length > 0 ? usableRefs : refs).slice(0, 8),
      collectionBasis: usableRefs.length > 0
        ? "matching_artifact_evidence"
        : inventoryIncomplete
          ? "incomplete_changed_file_inventory"
          : "complete_changed_file_inventory"
    });
  };

  if (input.expectations.implementation) addArtifactAxis("implementation", input.artifactRefs.implementation ?? [], true);
  if (input.expectations.documentation) addArtifactAxis("documentation", input.artifactRefs.documentation ?? []);
  if (input.expectations.ci) addArtifactAxis("ci_configuration", input.artifactRefs.ci ?? []);
  if (input.expectations.targetedTest) addArtifactAxis("targeted_test", input.artifactRefs.targetedTest ?? []);

  if (input.expectations.execution) {
    const passingRefs = uniqueRefs(input.matchingExecutionRefs)
      .filter((ref) => {
        const evidence = input.evidenceLookup.evidenceForRef(ref);
        return Boolean(evidence && isPassingTestExecutionEvidence(evidence));
      });
    const failedRefs = uniqueRefs(input.matchingFailedExecutionRefs);
    const directPassingRefs = passingRefs.filter((ref) => !input.verifiedSuiteExecutionRefs.includes(ref));
    axes.push({
      subject: "execution",
      polarity: "present",
      state: failedRefs.length > 0 ? "violated" : passingRefs.length > 0 ? "satisfied" : "incomplete",
      evidenceRefs: (failedRefs.length > 0 ? failedRefs : passingRefs).slice(0, 8),
      ...(failedRefs.length > 0
        ? { collectionBasis: "failed_execution" as const }
        : directPassingRefs.length > 0
          ? { collectionBasis: "passing_execution" as const }
          : passingRefs.length > 0
            ? { collectionBasis: "passing_suite_execution" as const }
          : {})
    });
  }

  if (input.expectations.visual) {
    const visualRefs = input.matchingVisualRefs.slice(0, 8);
    axes.push({
      subject: "visual",
      polarity: "present",
      state: visualRefs.length > 0 ? "satisfied" : "incomplete",
      evidenceRefs: visualRefs,
      ...(visualRefs.length > 0 ? { collectionBasis: "visual_verification" as const } : {})
    });
  }

  if (input.expectations.interaction) {
    const interactionRefs = input.matchingInteractionRefs.slice(0, 8);
    axes.push({
      subject: "interaction",
      polarity: "present",
      state: interactionRefs.length > 0 ? "satisfied" : "incomplete",
      evidenceRefs: interactionRefs,
      ...(interactionRefs.length > 0 ? { collectionBasis: "interaction_verification" as const } : {})
    });
  }

  if (input.expectations.noImplementationChanges) {
    axes.push({
      subject: "implementation",
      polarity: "absent",
      state: input.forbiddenImplementationRefs.length > 0
          ? "violated"
          : input.authoritativeChangedFileInventory
            ? "satisfied"
            : "incomplete",
      evidenceRefs: input.forbiddenImplementationRefs.slice(0, 8),
      collectionBasis: input.forbiddenImplementationRefs.length > 0
        ? "matching_artifact_evidence"
        : input.authoritativeChangedFileInventory
          ? "complete_changed_file_inventory"
          : "incomplete_changed_file_inventory"
    });
  }

  return axes;
}

function aggregateProofAxisStatus(axes: RequirementProofAxis[], fallback: RequirementFinding["status"]): RequirementFinding["status"] {
  if (axes.length === 0) return fallback;
  const absentAxis = axes.find((axis) => axis.polarity === "absent");
  if (absentAxis?.state === "incomplete") return "unclear";
  if (absentAxis?.state === "violated") {
    return axes.some((axis) => axis !== absentAxis && axis.state === "satisfied") ? "partial" : "missing";
  }
  if (axes.some((axis) => axis.state !== "satisfied")) return fallback === "met" ? "partial" : fallback;
  return "met";
}

function hasRequirementEvidenceRefPressure(
  requirements: Requirement[],
  relevanceIndex: RequirementEvidenceRelevanceIndex
): boolean {
  return requirements.some((requirement) =>
    relevanceIndex.forRequirement(requirement).matches.length > MAX_EVIDENCE_REFS_PER_FIELD
  );
}

function requirementEvidenceRefs(
  relevance: RequirementEvidenceRelevance,
  predicate: (item: EvidenceItem, match: ReturnType<typeof requirementEvidenceMatch>) => boolean
): string[] {
  return relevance.refsWhere(predicate);
}

function isOpaqueMatrixExecutionFailure(item: EvidenceItem): boolean {
  return /^[A-Z0-9_=-]+$/.test(item.label) &&
    isFailedAmbiguousActionsExecutionSignal(item.label, evidenceStatusFromSummary(item.summary), item.locator, item.summary);
}

function targetedTestEvidenceRefsForRequirement(
  requirement: Requirement,
  evidenceIndex: EvidenceItem[],
  input: PullRequestInput,
  implementationEvidenceRefs: string[],
  expectations: RequirementProofExpectations,
  relevance: RequirementEvidenceRelevance,
  evidenceLookup: VerifierEvidenceLookup,
  contextualOnly = false
): string[] {
  const directRefs = contextualOnly
    ? []
    : requirementEvidenceRefs(relevance, (item, match) =>
      item.kind === "test" && isUsefulArtifactMatch(match)
    );
  const implementationPaths = new Set(
    evidenceLookup.pathsForRefs(implementationEvidenceRefs)
      .map((path) => path.toLowerCase())
  );
  const implementationFiles = input.changedFiles.filter((file) =>
    implementationPaths.has(file.path.toLowerCase())
  );
  const testFiles = input.changedFiles.filter((file) => isTestFile(file.path));
  const relatedRefs = evidenceLookup.testEvidenceItems
    .filter((item) => {
      const testFile = testFiles.find((file) => file.path === item.locator || file.path === item.label);
      if (!testFile) return false;

      return implementationFiles.some((implementationFile) =>
        testEvidenceLooksRelated(implementationFile, testFile)
      );
    })
    .map((item) => item.id);
  const singleArtifactFallbackRefs = directRefs.length === 0 &&
    requirement.keywords.length === 0 &&
    expectations.targetedTest &&
    testFiles.length === 1
    ? evidenceLookup.testEvidenceItems
      .filter((item) => testFiles.some((file) => file.path === item.locator || file.path === item.label))
      .map((item) => item.id)
    : [];

  return uniqueRefs([...directRefs, ...relatedRefs, ...singleArtifactFallbackRefs]);
}

function contextualImplementationEvidenceRefs(
  requirementId: string,
  contextIdsByRequirement: ReadonlyMap<string, readonly string[]> | undefined,
  requirementById: ReadonlyMap<string, Requirement>,
  relevanceIndex: RequirementEvidenceRelevanceIndex,
  evidenceLookup: VerifierEvidenceLookup,
  implementationArtifactRefs: ReadonlySet<string>
): string[] {
  const contextIds = contextIdsByRequirement?.get(requirementId) ?? [];
  if (contextIds.length === 0) return [];

  const refs = uniqueRefs(contextIds.flatMap((contextId) => {
    const context = requirementById.get(contextId);
    if (!context) return [];
    return requirementEvidenceRefs(relevanceIndex.forRequirement(context), (item, match) =>
      (item.kind === "diff" || item.kind === "changed_file") &&
      implementationArtifactRefs.has(item.id) &&
      match.score > 0
    );
  }));
  const paths = new Set(evidenceLookup.pathsForRefs(refs).map((path) => path.toLowerCase()));

  return paths.size === 1 ? refs : [];
}

function passingExecutionEvidenceRefsForTargetedTests(
  targetedTestEvidenceRefs: readonly string[],
  evidenceIndex: readonly EvidenceItem[],
  evidenceLookup: VerifierEvidenceLookup
): string[] {
  const testPaths = evidenceLookup.pathsForRefs(targetedTestEvidenceRefs);
  if (testPaths.length === 0) return [];

  return evidenceIndex
    .filter(isPassingTestExecutionEvidence)
    .filter((item) => executionEvidenceMatchesAnyTestPath(
      testPaths,
      item.label,
      item.summary,
      item.locator
    ))
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

function artifactEvidenceRefsByExpectation(
  requirement: Requirement,
  evidenceIndex: EvidenceItem[],
  implementationEvidenceRefs: string[],
  targetedTestEvidenceRefs: string[],
  expectations: RequirementProofExpectations,
  relevance: RequirementEvidenceRelevance,
  evidenceLookup: VerifierEvidenceLookup
): Partial<Record<"implementation" | "documentation" | "ci" | "targetedTest", string[]>> {
  const artifactRefs = (kind: "documentation" | "ci", pathPattern: RegExp) => {
    const matched = requirementEvidenceRefs(relevance, (item, match) =>
      (item.kind === "diff" || item.kind === "changed_file") &&
      isUsefulArtifactMatch(match) &&
      pathPattern.test(item.locator ?? item.label)
    );
    if (matched.length > 0 || requirement.keywords.length > 0) return matched;
    return evidenceLookup.singleArtifactFallbackRefs(kind);
  };
  const result: Partial<Record<"implementation" | "documentation" | "ci" | "targetedTest", string[]>> = {};
  if (expectations.implementation) result.implementation = implementationEvidenceRefs.filter((ref) => {
    const path = evidenceLookup.pathsForRefs([ref])[0] ?? "";
    return !isTestFile(path) && !isDocumentationPath(path) && !isCiPath(path);
  });
  if (expectations.documentation) result.documentation = artifactRefs("documentation", /(?:^|\/)(?:docs?\/|readme(?:\.|$))|\.md$/i);
  if (expectations.ci) result.ci = artifactRefs("ci", /(?:^|\/)(?:\.github\/workflows\/|workflows?\/)|(?:ci|pipeline)[^/]*\.(?:ya?ml|json)$/i);
  if (expectations.targetedTest) result.targetedTest = targetedTestEvidenceRefs;
  return result;
}

function artifactExpectationLabel(kind: "implementation" | "documentation" | "ci" | "targetedTest"): string {
  if (kind === "targetedTest") return "targeted test-file";
  if (kind === "documentation") return "documentation artifact";
  if (kind === "ci") return "CI workflow artifact";
  return "implementation artifact";
}

function isDocumentationPath(path: string): boolean {
  return /(?:^|\/)(?:docs?\/|readme(?:\.|$))|\.md$/i.test(path);
}

function isCiPath(path: string): boolean {
  return /(?:^|\/)(?:\.github\/workflows\/|workflows?\/)|(?:ci|pipeline)[^/]*\.(?:ya?ml|json)$/i.test(path);
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
    /changed-file evidence (?:unavailable|was capped)|changed-file fetch failed|file evidence may be incomplete/i.test(limitation)
  );
}

function hasDiffEvidenceUnavailable(input: PullRequestInput): boolean {
  return (input.limitations ?? []).some((limitation) =>
    /patch text|diff evidence is unavailable/i.test(limitation)
  );
}

function hasAuthoritativeChangedFileInventory(input: PullRequestInput): boolean {
  const provenance = input.sourceProvenance;
  const inventory = provenance?.changedFileInventory;
  return provenance?.origin === "github_snapshot" &&
    typeof provenance.headSha === "string" && /^[a-f0-9]{40,64}$/.test(provenance.headSha) &&
    inventory?.version === 1 && inventory.completeness === "complete" &&
    inventory.headSha === provenance.headSha &&
    !hasChangedFileEvidenceUnavailable(input) &&
    !hasDiffEvidenceUnavailable(input);
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
  evidenceLookup: VerifierEvidenceLookup
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
  const evidenceRefs = uniqueRefs(outOfScopeFiles.flatMap((path) => evidenceLookup.refsForPath(path)));

  return {
    outOfScopeFiles: outOfScopeFiles.map(safeReportPath),
    evidenceRefs,
    provenance: evidenceLookup.provenanceForRefs(evidenceRefs),
    reasons: outOfScopeFiles.map((path) =>
      isRiskFile(path)
        ? `${safeReportPath(path)} is risk-sensitive and does not clearly map to the stated criteria.`
        : `${safeReportPath(path)} does not clearly map to the stated criteria.`
    ),
    omittedCount: Math.max(0, candidateOutOfScopeFiles.length - outOfScopeFiles.length)
  };
}

function detectMissingTests(
  input: PullRequestInput,
  evidenceIndex: EvidenceItem[],
  evidenceLookup: VerifierEvidenceLookup
): MissingTestFinding[] {
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

  const testEvidenceRefs = evidenceLookup.testEvidenceRefs;

  return changedImplementationFiles
    .filter((file) =>
      !hasMatchingVerifiedTestEvidence(file, testFiles, hasPassingTestSignal, evidenceIndex) &&
      !hasVisualVerifiedPresentationEvidence(file, input, asksForTestEvidence)
    )
    .slice(0, MAX_MISSING_TEST_FINDINGS)
    .map((file) => {
      const hasRelatedTestFile = testFiles.some((testFile) => testEvidenceLooksRelated(file, testFile));
      const evidenceRefs = uniqueRefs([...evidenceLookup.refsForPath(file.path), ...testEvidenceRefs]).slice(0, 5);

      return {
        path: safeReportPath(file.path),
        why: missingTestReason(hasRelatedTestFile, hasTestFileChange, hasPassingTestSignal),
        evidenceRefs,
        provenance: evidenceLookup.provenanceForRefs(evidenceRefs)
      };
    });
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
  proofGraph: ProofGraph,
  evidenceLookup: VerifierEvidenceLookup
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
      evidenceRefs: evidenceLookup.refsForPath(path)
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
        priority: hasSpecificRisk ? "high" : "low",
        evidenceRefs: evidenceLookup.refsForPath(file.path)
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
    .filter((item): item is EvidenceItem => Boolean(
      item &&
      (item.kind === "diff" || item.kind === "changed_file" || item.kind === "test") &&
      item.locator &&
      item.locator !== "task" &&
      item.locator !== "pr_description"
    ))
    .sort((left, right) => priorityEvidenceRank(left) - priorityEvidenceRank(right));

  const linkedImplementation = concrete.find((item) => priorityEvidenceRank(item) === 0);
  if (linkedImplementation?.locator) {
    return safeReportPath(linkedImplementation.locator);
  }

  const linkedFallback = concrete[0];
  if (linkedFallback?.locator) {
    return safeReportPath(linkedFallback.locator);
  }

  const fallbackConcrete = evidenceIndex
    .filter((item) =>
      (item.kind === "diff" || item.kind === "changed_file" || item.kind === "test") &&
      item.locator &&
      item.locator !== "task" &&
      item.locator !== "pr_description"
    )
    .sort((left, right) => priorityEvidenceRank(left) - priorityEvidenceRank(right))[0];

  return fallbackConcrete?.locator ? safeReportPath(fallbackConcrete.locator) : "Requirement evidence";
}

function priorityEvidenceRank(item: EvidenceItem): number {
  const locator = item.locator ?? "";
  if (isDocumentationPriorityPath(locator)) return 3;
  if (item.kind === "test" || isTestFile(locator)) return 1;
  return 0;
}

function isDocumentationPriorityPath(path: string): boolean {
  return /(?:^|\/)(?:docs?|documentation)\/|(?:^|\/)(?:readme|changelog|changes|contributing|license)(?:\.[^/]+)?$/i.test(path);
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

function executionFailureEvidenceRefs(
  input: Pick<PullRequestInput, "checks" | "logs">,
  evidenceIndex: readonly EvidenceItem[]
): string[] {
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
    risks.push("Some implementation proof is unavailable because file or patch evidence could not be collected.");
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
  if (!input.taskText.trim()) {
    limitations.push("No original task text was provided and no single valid linked issue was available; the PR description is retained only as unverified author context.");
  }
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
  return input.checks.some((check) => check.status !== "unknown" && isCheckExecutionSignal(check)) ||
    input.logs.some((log) => log.status !== "unknown" && isLogExecutionSignal(log));
}

function hasAnyCheckOrLogMetadata(input: PullRequestInput): boolean {
  return input.checks.length > 0 || input.logs.length > 0;
}

function hasSourceConditionLimitation(limitations: string[]): boolean {
  return limitations.some((limitation) =>
    /Public GitHub (?:Actions )?metadata (?:showed|reported)|Public commit status metadata (?:was available|showed)|No (?:verified )?public test\/build/i.test(limitation)
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
