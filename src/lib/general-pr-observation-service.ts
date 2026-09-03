import { createHash } from "node:crypto";
import { buildObjectiveEvidenceRelationLedgerV1, type RelationVerificationLevelV1 } from "./objective-evidence-relation-ledger";
import { deriveGeneralPrAssessmentV1, summarizeGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { buildGeneralPrObservationSeedV2, validateGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  runGeneralPrSemanticObserverV2,
  type GeneralPrSemanticFailureStageV1,
  type GeneralPrSemanticPackageFailureReasonV1,
  type GeneralPrSemanticProviderDiagnosticV1,
  type GeneralPrSemanticObserverModelProfileV2,
  type GeneralPrSemanticObserverProviderV4,
  type GeneralPrSemanticObserverRunResultV3,
  type GeneralPrFreshnessFailureV1
} from "./general-pr-semantic-observer";
import type { GeneralPrSemanticSelectionCoverageV1 } from "./general-pr-semantic-selection";
import type { GeneralPrSemanticClaimInvalidReasonV2, GeneralPrSemanticEvidenceInvalidReasonV1, GeneralPrSemanticProposalV2 } from "./general-pr-semantic-proposal";
import { evaluateScopeMappingObservationV2 } from "./scope-mapping-observation";
import { evaluateTestCoverageObservationV2 } from "./test-coverage-observation";
import type { GeneralPrAssessmentDiagnosticsV1, PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";
import type { GeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";

export interface GeneralPrObservationBundleV2 {
  version: 2;
  seedHash: string;
  ledgerDigest: string;
  objectives: Array<{
    id: string;
    sourceSpanIds: string[];
    authority: "authoritative" | "author_claim";
    admissionBasis: "explicit_structure" | "semantic_proposal";
    state: "observed" | "hypothesis";
  }>;
  relationLevelCounts: Record<RelationVerificationLevelV1, number>;
  /** Private, accepted Stage B proposal edges. Never project IDs into reports. */
  evidenceRelations: GeneralPrObservedEvidenceRelationV1[];
  testCoverage: ReturnType<typeof evaluateTestCoverageObservationV2>[];
  scopeMappings: ReturnType<typeof evaluateScopeMappingObservationV2>[];
  semanticState: "disabled" | "ineligible" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  /** Private aggregate diagnostic only; it is not copied into reports. */
  semanticFailureStage: GeneralPrSemanticFailureStageV1 | null;
  /** Private closed provider metadata; authenticated operator projection only. */
  semanticProviderDiagnostic: GeneralPrSemanticProviderDiagnosticV1 | null;
  /** Private closed reason set only; it is not copied into reports. */
  semanticPackageFailureReasons: GeneralPrSemanticPackageFailureReasonV1[];
  /** Private closed validator category; only the authenticated operator projection exposes it. */
  semanticClaimInvalidReason: GeneralPrSemanticClaimInvalidReasonV2 | null;
  /** Private closed Stage B validator category; only the authenticated operator projection exposes it. */
  semanticEvidenceInvalidReason: GeneralPrSemanticEvidenceInvalidReasonV1 | null;
  /** Private closed freshness diagnostic; only the authenticated operator projection exposes it. */
  semanticFreshnessFailure: GeneralPrFreshnessFailureV1 | null;
  /** Private aggregate only; no selection IDs, hashes, descriptors, or provider output. */
  semanticStageDiagnostics: GeneralPrSemanticStageDiagnosticsV1;
  /** Private closed aggregate only; it is not copied into reports. */
  semanticSelectionOmittedReasonCounts: GeneralPrSemanticSelectionOmittedReasonCountsV1;
  diagnostics: GeneralPrAssessmentDiagnosticsV1;
}

export interface GeneralPrObservedEvidenceRelationV1 {
  objectiveId: string;
  evidenceId: string;
  proposal: "supports" | "tests" | "implements" | "contradicts";
  level: "hypothesis";
}

export interface GeneralPrSemanticStageDiagnosticsV1 {
  version: 1;
  claimState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  evidenceState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  sourceCoverage: GeneralPrSemanticSelectionCoverageV1 | null;
  evidenceCoverage: GeneralPrSemanticSelectionCoverageV1 | null;
  providerCallCount: GeneralPrSemanticProviderCallCountV1;
  selectedCountBuckets: {
    sourceSpans: "0" | "1_4" | "5_8" | "9_12";
    evidenceCandidates: "0" | "1_16" | "17_32" | "33_64";
  };
  providerFailure?: GeneralPrSemanticProviderDiagnosticV1 | null;
}

/** Optional private finalizer diagnostics; Task 2 extends this object. */
export interface GeneralPrSemanticFailureDiagnosticsV1 {
  evidenceInvalidReason?: GeneralPrSemanticEvidenceInvalidReasonV1 | null;
  freshnessFailure?: GeneralPrFreshnessFailureV1 | null;
}

/** Closed private safety bucket; it never exposes an unbounded call metric. */
export type GeneralPrSemanticProviderCallCountV1 = 0 | 1 | 2 | "3_plus";

export interface GeneralPrSemanticSelectionOmittedReasonCountsV1 {
  spanBudget: number;
  evidenceBudget: number;
  inputByteBudget: number;
  unsafeDescriptor: number;
  noDeterministicSignal: number;
}

export interface RunGeneralPrObservationNowOptionsV2 {
  policy: GeneralPrAssessmentRuntimePolicyV1;
  input: PullRequestInput;
  generateReport: (input: PullRequestInput) => VerificationReport;
  validateDeterministicReport: (input: PullRequestInput, report: VerificationReport) => boolean;
  semantic?: {
    provider?: GeneralPrSemanticObserverProviderV4;
    providerAvailable: boolean;
    privateRepository?: boolean;
    privateRepositoryConsent?: boolean;
    providerRetentionApproved?: boolean;
    timeoutMs?: number;
    readCurrentInput: () => Promise<PullRequestInput | null>;
    modelProfile: GeneralPrSemanticObserverModelProfileV2;
  };
}

const UNCONFIGURED_MODEL_PROFILE: GeneralPrSemanticObserverModelProfileV2 = {
  model: "deployment-unconfigured",
  promptVersion: "general-pr-observer.v4",
  inputFieldPolicyVersion: "general-pr-observer-fields.v1"
};

/**
 * This observation pipeline is deliberately default-off. An unknown value
 * must not silently enable a new source of report findings.
 */
export async function runGeneralPrObservationNowV2(
  options: RunGeneralPrObservationNowOptionsV2
): Promise<{ report: VerificationReport; bundle: GeneralPrObservationBundleV2 | null }> {
  // The deterministic report is always the first and authoritative product output.
  const report = options.generateReport(options.input);
  if (!options.validateDeterministicReport(options.input, report)) return { report, bundle: null };
  if (options.policy.semanticObservation === "disabled") return { report, bundle: null };
  const seed = buildGeneralPrObservationSeedV2(options.input);
  if (!validateGeneralPrObservationSeedV2(seed).valid) return { report, bundle: null };
  if (!isGeneralPrSemanticObserverEligibleV2(options.input)) {
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "ineligible");
    return {
      report: options.policy.assessmentProjection === "advisory" ? attachGeneralPrAssessmentV1(report, seed, bundle) : report,
      bundle
    };
  }
  if (seed.parseState !== "complete") {
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");
    return {
      report: options.policy.assessmentProjection === "advisory" ? attachGeneralPrAssessmentV1(report, seed, bundle) : report,
      bundle
    };
  }
  const deterministicBundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "disabled");
  if (hasExplicitDeterministicObjective(deterministicBundle)) {
    return {
      report: options.policy.assessmentProjection === "advisory" ? attachGeneralPrAssessmentV1(report, seed, deterministicBundle) : report,
      bundle: deterministicBundle
    };
  }
  let providerCallCount: GeneralPrSemanticProviderCallCountV1 = 0;
  const configuredProvider = options.semantic?.provider;
  const semantic = await runGeneralPrSemanticObserverV2({
    mode: options.policy.releasePhase,
    input: options.input,
    seed,
    provider: configuredProvider ? {
      observe: (request) => {
        providerCallCount = nextProviderCallCount(providerCallCount);
        return configuredProvider.observe(request);
      }
    } : undefined,
    providerAvailable: options.semantic?.providerAvailable ?? false,
    privateRepository: options.semantic?.privateRepository,
    privateRepositoryConsent: options.semantic?.privateRepositoryConsent,
    providerRetentionApproved: options.semantic?.providerRetentionApproved,
    timeoutMs: options.semantic?.timeoutMs,
    // A semantic call is never accepted without a caller-provided freshness
    // read. The null fallback is a fail-closed unavailable result.
    readCurrentInput: options.semantic?.readCurrentInput ?? (async () => null),
    modelProfile: options.semantic?.modelProfile ?? UNCONFIGURED_MODEL_PROFILE
  });
  const aggregate = buildGeneralPrSemanticAggregateDiagnosticsV1(semantic, providerCallCount);
  const bundle = finalizeDeterministicGeneralPrObservationsV2(
    seed,
    semantic.proposal,
    semantic.state,
    semantic.semanticFailureStage,
    semantic.semanticPackageFailureReasons,
    aggregate.stageDiagnostics,
    aggregate.omittedReasonCounts,
    semantic.semanticClaimInvalidReason,
    semantic.semanticProviderDiagnostic,
    { evidenceInvalidReason: semantic.semanticEvidenceInvalidReason, freshnessFailure: semantic.semanticFreshnessFailure }
  );
  return {
    report: options.policy.assessmentProjection === "advisory" ? attachGeneralPrAssessmentV1(report, seed, bundle) : report,
    bundle
  };
}

function hasExplicitDeterministicObjective(bundle: GeneralPrObservationBundleV2): boolean {
  return bundle.objectives.some((objective) => objective.admissionBasis === "explicit_structure");
}

function nextProviderCallCount(value: GeneralPrSemanticProviderCallCountV1): GeneralPrSemanticProviderCallCountV1 {
  return value === 0 ? 1 : value === 1 ? 2 : "3_plus";
}

export function isGeneralPrSemanticObserverEligibleV2(input: PullRequestInput): boolean {
  return input.repositoryPrivate === false &&
    input.sourceProvenance?.origin === "github_snapshot" &&
    (input.taskText.trim() === "" || input.taskSource === "issue");
}

/**
 * Shadow collection must not modify a report. Advisory collection may add the
 * optional V2 companion but never touches strict requirement outcomes.
 */
function attachGeneralPrAssessmentV1(
  report: VerificationReport,
  seed: ReturnType<typeof buildGeneralPrObservationSeedV2>,
  bundle: GeneralPrObservationBundleV2
): VerificationReport {
  if ((report as Partial<VerificationReportV2>).reportSchemaVersion !== "verification-report.v2") return report;
  return {
    ...report,
    // The report/API boundary retains only reviewer-safe aggregate results.
    // Source bindings and span IDs remain inside the transient observation
    // bundle; neither is stored or returned here.
    generalPrAssessmentSummary: summarizeGeneralPrAssessmentV1(deriveGeneralPrAssessmentV1({ seed, bundle, report }))
  } as VerificationReportV2;
}

export function finalizeDeterministicGeneralPrObservationsV2(
  seed: ReturnType<typeof buildGeneralPrObservationSeedV2>,
  semanticProposal: GeneralPrSemanticProposalV2 | null = null,
  semanticState: GeneralPrObservationBundleV2["semanticState"] = "unavailable",
  semanticFailureStage: GeneralPrSemanticFailureStageV1 | null = null,
  semanticPackageFailureReasons: GeneralPrSemanticPackageFailureReasonV1[] = [],
  semanticStageDiagnostics: GeneralPrSemanticStageDiagnosticsV1 = emptySemanticStageDiagnostics(),
  semanticSelectionOmittedReasonCounts: GeneralPrSemanticSelectionOmittedReasonCountsV1 = emptySemanticSelectionOmittedReasonCounts(),
  semanticClaimInvalidReason: GeneralPrSemanticClaimInvalidReasonV2 | null = null,
  semanticProviderDiagnostic: GeneralPrSemanticProviderDiagnosticV1 | null = null,
  failureDiagnostics: GeneralPrSemanticFailureDiagnosticsV1 = {}
): GeneralPrObservationBundleV2 {
  const deterministicObjectives = seed.spans.flatMap((span) => {
    if (span.deterministicRole !== "objective_candidate") return [];
    const source = seed.sources.find((candidate) => candidate.id === span.sourceUnitId);
    if (!source || source.roleCeiling !== "objective" || source.admissionTier === "context") return [];
    return [{
      id: `gpo_${digest({ domain: "agentproof.general-pr.objective.v2", seedHash: seed.seedHash, spanId: span.id }).slice(0, 24)}`,
      sourceSpanIds: [span.id],
      authority: source.authority,
      admissionBasis: "explicit_structure" as const,
      state: "observed" as const,
      admissionTier: source.admissionTier
    }];
  });
  const semanticObjectives = semanticProposal === null ? [] : Object.values(semanticProposal.objectiveGroups).flatMap((group) => {
    if (group.disposition !== "candidate") return [];
    const spans = group.spanIds.map((spanId) => seed.spans.find((span) => span.id === spanId));
    const source = spans[0] ? seed.sources.find((candidate) => candidate.id === spans[0]!.sourceUnitId) : undefined;
    if (!source || source.roleCeiling !== "objective" || source.admissionTier === "context" || spans.some((span) => !span || span.sourceUnitId !== spans[0]!.sourceUnitId)) return [];
    return [{
      id: group.groupId,
      sourceSpanIds: [...group.spanIds],
      authority: source.authority,
      admissionBasis: "semantic_proposal" as const,
      state: "hypothesis" as const,
      admissionTier: source.admissionTier
    }];
  });
  const objectives = selectAdmittedObjectives(deterministicObjectives, semanticObjectives);
  const semanticObjectiveIds = new Set(objectives.filter((objective) => objective.state === "hypothesis").map((objective) => objective.id));
  const semanticEdges = semanticProposal === null || semanticProposal.seedHash !== seed.seedHash || semanticState !== "valid" || semanticStageDiagnostics.evidenceState !== "valid" ? [] : semanticProposal.evidenceRelationProposals.flatMap((proposal) => {
    if (proposal.proposal === "unresolved" || !semanticObjectiveIds.has(proposal.objectiveGroupId)) return [];
    const atom = seed.evidenceAtoms.find((candidate) => candidate.id === proposal.evidenceId);
    if (!atom) return [];
    return [{
      fromNodeId: proposal.objectiveGroupId,
      toNodeId: atom.id,
      kind: proposal.proposal === "contradicts" ? "semantic_contradicts" as const : "semantic_supports" as const,
      level: "hypothesis" as const,
      basis: "semantic_proposal" as const,
      subjectDigest: seed.seedHash,
      evidenceRefs: [atom.id],
      completeness: atom.completeness,
      proposal: proposal.proposal
    }];
  });
  const ledger = buildObjectiveEvidenceRelationLedgerV1({
    nodes: [
      ...objectives.map((objective) => ({ version: 1 as const, id: objective.id, kind: "objective_group" as const, subjectDigest: seed.seedHash })),
      ...seed.changeClusters.map((cluster) => ({ version: 1 as const, id: cluster.id, kind: "change_cluster" as const, subjectDigest: seed.seedHash })),
      ...seed.testArtifacts.map((artifact) => ({ version: 1 as const, id: artifact.id, kind: "test_artifact" as const, subjectDigest: seed.seedHash })),
      ...seed.evidenceAtoms.map((atom) => ({ version: 1 as const, id: atom.id, kind: "evidence_atom" as const, subjectDigest: seed.seedHash }))
    ],
    edges: semanticEdges.map(({ proposal: _proposal, ...edge }) => edge)
  });
  const evidenceRelations: GeneralPrObservedEvidenceRelationV1[] = ledger.valid ? semanticEdges.map((edge) => ({
    objectiveId: edge.fromNodeId,
    evidenceId: edge.toNodeId,
    proposal: edge.proposal,
    level: "hypothesis"
  })) : [];
  const relationLevelCounts: Record<RelationVerificationLevelV1, number> = {
    verified: 0,
    observed: 0,
    hypothesis: 0,
    unresolved: 0,
    unavailable: 0
  };
  for (const edge of evidenceRelations) relationLevelCounts[edge.level] += 1;
  const inventoryComplete = seed.completeness === "complete";
  const semanticEvidenceComplete = semanticStageDiagnostics.evidenceCoverage === "complete";
  const semanticTestProposals = new Map((semanticProposal?.testApplicabilityProposals ?? []).map((proposal) => [`${proposal.objectiveGroupId}:${proposal.changeClusterId}`, proposal]));
  const semanticScopeProposals = new Map((semanticProposal?.scopeMappingProposals ?? []).map((proposal) => [`${proposal.objectiveGroupId}:${proposal.changeClusterId}`, proposal]));
  const testCoverage = objectives.flatMap((objective) => seed.changeClusters.map((cluster) => {
    const proposal = objective.state === "hypothesis" ? semanticTestProposals.get(`${objective.id}:${cluster.id}`) : undefined;
    const relationCoverageComplete = objective.state !== "hypothesis" || semanticEvidenceComplete || (proposal !== undefined && proposal.proposal !== "ambiguous");
    return evaluateTestCoverageObservationV2({
      objectiveId: objective.id,
      changeClusterId: cluster.id,
      applicability: proposal?.proposal === "likely_expected"
        ? "hypothesized_required"
        : proposal?.proposal === "likely_not_applicable"
          ? "hypothesized_not_applicable"
          : "unknown",
      relation: proposal && proposal.proposal !== "ambiguous" ? "hypothesis" : "unresolved",
      execution: "not_observed",
      changedFileInventoryComplete: inventoryComplete && relationCoverageComplete,
      applicableTestInventoryComplete: inventoryComplete && relationCoverageComplete,
      requiredEvidenceAvailable: inventoryComplete && relationCoverageComplete
    });
  }));
  const scopeMappings = objectives.flatMap((objective) => seed.changeClusters.map((cluster) => {
    const proposal = objective.state === "hypothesis" ? semanticScopeProposals.get(`${objective.id}:${cluster.id}`) : undefined;
    const relationCoverageComplete = objective.state !== "hypothesis" || semanticEvidenceComplete || proposal?.proposal === "plausibly_mapped";
    return evaluateScopeMappingObservationV2({
      objectiveId: objective.id,
      changeClusterId: cluster.id,
      relationLevel: proposal?.proposal === "plausibly_mapped" ? "hypothesis" : "unresolved",
      authoritativeRoute: false,
      collectionComplete: inventoryComplete && relationCoverageComplete,
      contractViolation: false
    });
  }));
  const eligibleSpans = seed.spans.filter((span) => {
    const source = seed.sources.find((candidate) => candidate.id === span.sourceUnitId);
    return source?.roleCeiling === "objective" && source.admissionTier !== "context" && span.deterministicRole !== "template_or_process";
  }).length;
  const diagnostics = buildDiagnostics({
    seed,
    semanticState,
    eligibleSpans,
    deterministicCandidates: deterministicObjectives.length,
    semanticCandidates: semanticObjectives.length,
    objectives,
    relationLevelCounts,
    evidenceRelations
  });
  return {
    version: 2,
    seedHash: seed.seedHash,
    ledgerDigest: ledger.valid ? ledger.ledger.ledgerDigest : digest({ domain: "agentproof.general-pr.empty-ledger.v2", seedHash: seed.seedHash }),
    objectives,
    relationLevelCounts,
    evidenceRelations,
    testCoverage,
    scopeMappings,
    semanticState,
    semanticFailureStage,
    semanticProviderDiagnostic,
    semanticEvidenceInvalidReason: failureDiagnostics.evidenceInvalidReason ?? null,
    semanticFreshnessFailure: failureDiagnostics.freshnessFailure ?? null,
    semanticPackageFailureReasons: semanticState === "unavailable" && semanticFailureStage === "package"
      ? semanticPackageFailureReasons
      : [],
    semanticClaimInvalidReason: semanticState === "invalid" ? semanticClaimInvalidReason : null,
    semanticStageDiagnostics,
    semanticSelectionOmittedReasonCounts,
  diagnostics
  };
}

export function buildGeneralPrSemanticAggregateDiagnosticsV1(
  semantic: GeneralPrSemanticObserverRunResultV3,
  providerCallCount: GeneralPrSemanticProviderCallCountV1
): {
  stageDiagnostics: GeneralPrSemanticStageDiagnosticsV1;
  omittedReasonCounts: GeneralPrSemanticSelectionOmittedReasonCountsV1;
} {
  const manifest = semantic.selectionManifest;
  return {
    stageDiagnostics: {
      version: 1,
      claimState: semantic.receipt.claimState,
      evidenceState: semantic.receipt.evidenceState,
      sourceCoverage: manifest?.coverage.sourceSpans ?? null,
      evidenceCoverage: manifest?.coverage.evidenceCandidates ?? null,
      providerCallCount,
      selectedCountBuckets: {
        sourceSpans: sourceSpanCountBucket(manifest?.counts.sourceSpansSelected ?? 0),
        evidenceCandidates: evidenceCandidateCountBucket(manifest?.counts.evidenceCandidatesSelected ?? 0)
      },
      ...(semantic.semanticProviderDiagnostic ? { providerFailure: semantic.semanticProviderDiagnostic } : {})
    },
    omittedReasonCounts: manifest
      ? { ...manifest.omittedReasonCounts }
      : emptySemanticSelectionOmittedReasonCounts()
  };
}

function emptySemanticStageDiagnostics(): GeneralPrSemanticStageDiagnosticsV1 {
  return {
    version: 1,
    claimState: "not_run",
    evidenceState: "not_run",
    sourceCoverage: null,
    evidenceCoverage: null,
    providerCallCount: 0,
    selectedCountBuckets: { sourceSpans: "0", evidenceCandidates: "0" }
  };
}

function emptySemanticSelectionOmittedReasonCounts(): GeneralPrSemanticSelectionOmittedReasonCountsV1 {
  return { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 };
}

function sourceSpanCountBucket(count: number): GeneralPrSemanticStageDiagnosticsV1["selectedCountBuckets"]["sourceSpans"] {
  if (count <= 0) return "0";
  if (count <= 4) return "1_4";
  if (count <= 8) return "5_8";
  return "9_12";
}

function evidenceCandidateCountBucket(count: number): GeneralPrSemanticStageDiagnosticsV1["selectedCountBuckets"]["evidenceCandidates"] {
  if (count <= 0) return "0";
  if (count <= 16) return "1_16";
  if (count <= 32) return "17_32";
  return "33_64";
}

type ObjectiveCandidate = {
  id: string;
  sourceSpanIds: string[];
  authority: "authoritative" | "author_claim";
  admissionBasis: "explicit_structure" | "semantic_proposal";
  state: "observed" | "hypothesis";
  admissionTier: "primary" | "fallback";
};

function selectAdmittedObjectives(
  deterministic: ObjectiveCandidate[],
  semantic: ObjectiveCandidate[]
): GeneralPrObservationBundleV2["objectives"] {
  const firstAvailable = [
    deterministic.filter((candidate) => candidate.admissionTier === "primary"),
    semantic.filter((candidate) => candidate.admissionTier === "primary"),
    deterministic.filter((candidate) => candidate.admissionTier === "fallback"),
    semantic.filter((candidate) => candidate.admissionTier === "fallback")
  ].find((candidates) => candidates.length > 0) ?? [];
  return firstAvailable.map(({ admissionTier: _admissionTier, ...objective }) => objective);
}

function buildDiagnostics(input: {
  seed: ReturnType<typeof buildGeneralPrObservationSeedV2>;
  semanticState: GeneralPrObservationBundleV2["semanticState"];
  eligibleSpans: number;
  deterministicCandidates: number;
  semanticCandidates: number;
  objectives: GeneralPrObservationBundleV2["objectives"];
  relationLevelCounts: GeneralPrObservationBundleV2["relationLevelCounts"];
  evidenceRelations: GeneralPrObservationBundleV2["evidenceRelations"];
}): GeneralPrAssessmentDiagnosticsV1 {
  const deterministicSelected = input.objectives.some((objective) => objective.admissionBasis === "explicit_structure");
  const semanticAdmitted = input.objectives.some((objective) => objective.admissionBasis === "semantic_proposal");
  const sourceCollection: GeneralPrAssessmentDiagnosticsV1["sourceCollection"] = input.seed.sources.length === 0
    ? "missing"
    : input.seed.parseState === "incomplete"
      ? "parse_incomplete"
      : input.seed.completeness === "unavailable"
        ? "collection_unavailable"
        : "available";
  const deterministicAdmission: GeneralPrAssessmentDiagnosticsV1["deterministicAdmission"] = input.deterministicCandidates > 0
    ? "admitted"
    : input.eligibleSpans === 0 && input.seed.sources.length > 0 ? "context_only" : "no_candidate";
  const semanticAdmission: GeneralPrAssessmentDiagnosticsV1["semanticAdmission"] = deterministicSelected
    ? "not_needed"
    : input.seed.parseState !== "complete" || input.eligibleSpans === 0
      ? "ineligible"
      : input.semanticState === "valid"
        ? semanticAdmitted ? "admitted" : "no_candidate"
        : input.semanticState;
  const relationState: GeneralPrAssessmentDiagnosticsV1["relationState"] = input.objectives.length === 0
    ? "not_attempted"
    : input.seed.completeness !== "complete"
      ? "collection_blocked"
      : input.relationLevelCounts.verified > 0
        ? "verified"
    : input.evidenceRelations.length > 0 ? "hypothesis_only" : "unresolved";
  return {
    version: 1,
    sourceCollection,
    deterministicAdmission,
    semanticAdmission,
    relationState,
    counts: {
      sourceUnits: input.seed.sources.length,
      eligibleSpans: input.eligibleSpans,
      deterministicCandidates: input.deterministicCandidates,
      semanticCandidates: input.semanticCandidates,
      admittedTargets: input.objectives.length
    }
  };
}

function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
