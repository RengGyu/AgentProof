import { createHash } from "node:crypto";
import { buildObjectiveEvidenceRelationLedgerV1, type RelationVerificationLevelV1 } from "./objective-evidence-relation-ledger";
import { deriveGeneralPrAssessmentV1, summarizeGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { buildGeneralPrObservationSeedV2, validateGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  runGeneralPrSemanticObserverV2,
  type GeneralPrSemanticObserverModelProfileV2,
  type GeneralPrSemanticObserverProviderV2
} from "./general-pr-semantic-observer";
import type { GeneralPrSemanticProposalV2 } from "./general-pr-semantic-proposal";
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
  testCoverage: ReturnType<typeof evaluateTestCoverageObservationV2>[];
  scopeMappings: ReturnType<typeof evaluateScopeMappingObservationV2>[];
  semanticState: "disabled" | "ineligible" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  diagnostics: GeneralPrAssessmentDiagnosticsV1;
}

export interface RunGeneralPrObservationNowOptionsV2 {
  policy: GeneralPrAssessmentRuntimePolicyV1;
  input: PullRequestInput;
  generateReport: (input: PullRequestInput) => VerificationReport;
  validateDeterministicReport: (input: PullRequestInput, report: VerificationReport) => boolean;
  semantic?: {
    provider?: GeneralPrSemanticObserverProviderV2;
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
  promptVersion: "general-pr-observer.v2",
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
  const semantic = await runGeneralPrSemanticObserverV2({
    mode: options.policy.releasePhase,
    input: options.input,
    seed,
    provider: options.semantic?.provider,
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
  const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, semantic.proposal, semantic.state);
  return {
    report: options.policy.assessmentProjection === "advisory" ? attachGeneralPrAssessmentV1(report, seed, bundle) : report,
    bundle
  };
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
  semanticState: GeneralPrObservationBundleV2["semanticState"] = "unavailable"
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
  const semanticEdges = semanticProposal === null ? [] : semanticProposal.evidenceRelationProposals.flatMap((proposal) => {
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
      completeness: atom.completeness
    }];
  });
  const ledger = buildObjectiveEvidenceRelationLedgerV1({
    nodes: [
      ...objectives.map((objective) => ({ version: 1 as const, id: objective.id, kind: "objective_group" as const, subjectDigest: seed.seedHash })),
      ...seed.changeClusters.map((cluster) => ({ version: 1 as const, id: cluster.id, kind: "change_cluster" as const, subjectDigest: seed.seedHash })),
      ...seed.testArtifacts.map((artifact) => ({ version: 1 as const, id: artifact.id, kind: "test_artifact" as const, subjectDigest: seed.seedHash })),
      ...seed.evidenceAtoms.map((atom) => ({ version: 1 as const, id: atom.id, kind: "evidence_atom" as const, subjectDigest: seed.seedHash }))
    ],
    edges: semanticEdges
  });
  const relationLevelCounts: Record<RelationVerificationLevelV1, number> = {
    verified: 0,
    observed: 0,
    hypothesis: 0,
    unresolved: 0,
    unavailable: 0
  };
  for (const edge of semanticEdges) relationLevelCounts[edge.level] += 1;
  const inventoryComplete = seed.completeness === "complete";
  const semanticTestProposals = new Map((semanticProposal?.testApplicabilityProposals ?? []).map((proposal) => [`${proposal.objectiveGroupId}:${proposal.changeClusterId}`, proposal]));
  const semanticScopeProposals = new Map((semanticProposal?.scopeMappingProposals ?? []).map((proposal) => [`${proposal.objectiveGroupId}:${proposal.changeClusterId}`, proposal]));
  const testCoverage = objectives.flatMap((objective) => seed.changeClusters.map((cluster) => {
    const proposal = objective.state === "hypothesis" ? semanticTestProposals.get(`${objective.id}:${cluster.id}`) : undefined;
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
      changedFileInventoryComplete: inventoryComplete,
      applicableTestInventoryComplete: inventoryComplete,
      requiredEvidenceAvailable: inventoryComplete
    });
  }));
  const scopeMappings = objectives.flatMap((objective) => seed.changeClusters.map((cluster) => {
    const proposal = objective.state === "hypothesis" ? semanticScopeProposals.get(`${objective.id}:${cluster.id}`) : undefined;
    return evaluateScopeMappingObservationV2({
      objectiveId: objective.id,
      changeClusterId: cluster.id,
      relationLevel: proposal?.proposal === "plausibly_mapped" ? "hypothesis" : "unresolved",
      authoritativeRoute: false,
      collectionComplete: inventoryComplete,
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
    relationLevelCounts
  });
  return {
    version: 2,
    seedHash: seed.seedHash,
    ledgerDigest: ledger.valid ? ledger.ledger.ledgerDigest : digest({ domain: "agentproof.general-pr.empty-ledger.v2", seedHash: seed.seedHash }),
    objectives,
    relationLevelCounts,
    testCoverage,
    scopeMappings,
    semanticState,
    diagnostics
  };
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
        : input.relationLevelCounts.hypothesis > 0 ? "hypothesis_only" : "unresolved";
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
