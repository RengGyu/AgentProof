import { createHash } from "node:crypto";
import type { GeneralPrObservationBundleV2 } from "./general-pr-observation-service";
import type { GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type {
  GeneralPrAssessmentCountsV1,
  GeneralPrAssessmentReasonV1,
  GeneralPrAssessmentTargetV1,
  GeneralPrAssessmentV1,
  GeneralPrTargetConclusionV1,
  VerificationReport
} from "./types";

export interface GeneralPrAssessmentInputV1 {
  seed: GeneralPrObservationSeedV2;
  bundle: GeneralPrObservationBundleV2;
  report: VerificationReport;
}

const EMPTY_COUNTS: GeneralPrAssessmentCountsV1 = {
  evidence_supported: 0,
  evidence_partial: 0,
  not_demonstrated: 0,
  contradicted: 0,
  blocked: 0,
  not_assessable: 0
};

/**
 * Produces a bounded observation companion. It intentionally has no path to
 * a positive or contradictory behavioral conclusion until a separately
 * released deterministic relation/evaluation capability is available.
 */
export function deriveGeneralPrAssessmentV1({
  seed,
  bundle,
  report
}: GeneralPrAssessmentInputV1): GeneralPrAssessmentV1 {
  const mode = isActiveTypedContract(report) ? "typed_contract_companion" : "ordinary_pr";
  const sourceById = new Map(seed.sources.map((source) => [source.id, source]));
  const spanById = new Map(seed.spans.map((span) => [span.id, span]));
  const headBound = hasCompleteHeadBinding(seed);
  const targets = bundle.seedHash === seed.seedHash
    ? bundle.objectives.flatMap((objective) => {
      const spans = objective.sourceSpanIds.map((spanId) => spanById.get(spanId));
      const source = spans[0] ? sourceById.get(spans[0].sourceUnitId) : undefined;
      if (!source || spans.some((span) => !span || span.sourceUnitId !== source.id)) return [];
      if (source.kind !== "linked_issue" && source.authority !== "author_claim") return [];

      const sourceAuthority = source.kind === "linked_issue" ? "linked_issue" : "pr_author_claim" as const;
      const conclusion = conclusionFor(objective.state, headBound);
      const reasonCodes = reasonsFor(objective.state, headBound, sourceAuthority);
      const relationLevels = objective.state === "hypothesis" ? ["hypothesis" as const] : ["unresolved" as const];
      return [{
        version: 1 as const,
        targetId: `gpa_${digest({ seedHash: seed.seedHash, objectiveId: objective.id }).slice(0, 24)}`,
        sourceBindingRef: source.id,
        sourceAuthority,
        sourceSpanRefs: [...objective.sourceSpanIds],
        admissionBasis: objective.admissionBasis === "semantic_proposal" ? "semantic_span_proposal" as const : "explicit_structure" as const,
        claimRole: sourceAuthority === "linked_issue" ? "acceptance_criterion" as const : "behavioral_objective" as const,
        conclusion,
        reasonCodes,
        evidenceRefs: [],
        relationLevels,
        headBound
      } satisfies GeneralPrAssessmentTargetV1];
    })
    : [];
  const counts = countTargets(targets);
  const sourceState = sourceStateFor(targets, seed, bundle);
  const headMismatch = bundle.seedHash !== seed.seedHash || bundle.semanticState === "stale";
  const reasonCodes = uniqueReasons([
    ...targets.flatMap((target) => target.reasonCodes),
    ...diagnosticReasons(bundle),
    ...(sourceState === "pr_author_claim" ? ["author_claim_requires_confirmation" as const] : []),
    ...(sourceState === "missing" ? ["source_missing" as const] : []),
    ...(headMismatch ? ["head_mismatch" as const] : sourceState === "ambiguous" ? ["source_ambiguous" as const] : [])
  ]);

  return {
    version: 1,
    mode,
    sourceState,
    overallConclusion: overallConclusionFor(targets),
    counts,
    targets,
    reasonCodes
  };
}

export function summarizeGeneralPrAssessmentV1(
  assessment: GeneralPrAssessmentV1
): Omit<GeneralPrAssessmentV1, "targets"> {
  return {
    version: assessment.version,
    mode: assessment.mode,
    sourceState: assessment.sourceState,
    overallConclusion: assessment.overallConclusion,
    counts: { ...assessment.counts },
    reasonCodes: [...assessment.reasonCodes]
  };
}

function conclusionFor(
  _state: GeneralPrObservationBundleV2["objectives"][number]["state"],
  headBound: boolean
): GeneralPrTargetConclusionV1 {
  if (!headBound) return "blocked";
  return "evidence_partial";
}

function reasonsFor(
  state: GeneralPrObservationBundleV2["objectives"][number]["state"],
  headBound: boolean,
  sourceAuthority: GeneralPrAssessmentTargetV1["sourceAuthority"]
): GeneralPrAssessmentReasonV1[] {
  if (!headBound) return uniqueReasons([
    "collection_incomplete",
    ...(sourceAuthority === "pr_author_claim" ? ["author_claim_requires_confirmation" as const] : [])
  ]);
  return uniqueReasons([
    state === "hypothesis" ? "semantic_relation_only" : "verified_relation_missing",
    ...(sourceAuthority === "pr_author_claim" ? ["author_claim_requires_confirmation" as const] : [])
  ]);
}

function sourceStateFor(
  targets: GeneralPrAssessmentTargetV1[],
  seed: GeneralPrObservationSeedV2,
  bundle: GeneralPrObservationBundleV2
): GeneralPrAssessmentV1["sourceState"] {
  if (bundle.seedHash !== seed.seedHash || bundle.semanticState === "stale") return "ambiguous";
  const authorities = new Set(targets.map((target) => target.sourceAuthority));
  if (authorities.size > 1) return "mixed";
  if (authorities.has("linked_issue")) return "linked_issue";
  if (authorities.has("pr_author_claim")) return "pr_author_claim";
  const validSources = seed.sources.filter((source) => source.structuralSpanIds.length > 0);
  if (validSources.some((source) => source.kind === "linked_issue")) return "linked_issue";
  if (validSources.length > 0 && validSources.every((source) => source.kind === "pr_title" || source.kind === "pr_body")) return "pr_author_claim";
  return validSources.length === 0 ? "missing" : "ambiguous";
}

function diagnosticReasons(bundle: GeneralPrObservationBundleV2): GeneralPrAssessmentReasonV1[] {
  const diagnostics = bundle.diagnostics;
  return uniqueReasons([
    ...(diagnostics.deterministicAdmission === "no_candidate" ? ["deterministic_candidate_missing" as const] : []),
    ...(diagnostics.deterministicAdmission === "context_only" ? ["unsupported_claim_type" as const] : []),
    ...(diagnostics.sourceCollection === "collection_unavailable" ? ["source_unavailable" as const] : []),
    ...(diagnostics.sourceCollection === "parse_incomplete" ? ["collection_incomplete" as const] : []),
    ...(diagnostics.semanticAdmission === "disabled" ? ["semantic_observer_disabled" as const] : []),
    ...(diagnostics.semanticAdmission === "ineligible" ? ["semantic_observer_ineligible" as const] : []),
    ...(diagnostics.semanticAdmission === "unavailable" ? ["semantic_observer_unavailable" as const] : []),
    ...(diagnostics.semanticAdmission === "timeout" ? ["semantic_observer_timeout" as const] : []),
    ...(diagnostics.semanticAdmission === "invalid" ? ["semantic_proposal_invalid" as const] : []),
    ...(diagnostics.semanticAdmission === "no_candidate" && diagnostics.counts.semanticCandidates === 0 ? ["semantic_candidate_missing" as const] : []),
    ...(diagnostics.semanticAdmission === "no_candidate" && diagnostics.counts.semanticCandidates > 0 ? ["semantic_candidate_rejected" as const] : []),
    ...(diagnostics.counts.admittedTargets > 0 && diagnostics.relationState !== "verified" ? ["target_relation_unresolved" as const] : [])
  ]);
}

function overallConclusionFor(targets: GeneralPrAssessmentTargetV1[]): GeneralPrAssessmentV1["overallConclusion"] {
  if (targets.some((target) => target.conclusion === "contradicted")) return "attention_required";
  if (targets.length > 0 && targets.every((target) => target.conclusion === "blocked")) return "collection_blocked";
  if (targets.length > 0 && targets.every((target) => target.conclusion === "evidence_supported")) return "evidence_supports_stated_change";
  if (targets.length > 0 && targets.every((target) => target.conclusion === "evidence_partial")) return "evidence_partial";
  if (targets.length > 0) return "mixed_evidence";
  return "no_assessable_claims";
}

function countTargets(targets: GeneralPrAssessmentTargetV1[]): GeneralPrAssessmentCountsV1 {
  return targets.reduce<GeneralPrAssessmentCountsV1>((counts, target) => {
    counts[target.conclusion] += 1;
    return counts;
  }, { ...EMPTY_COUNTS });
}

function hasCompleteHeadBinding(seed: GeneralPrObservationSeedV2): boolean {
  return seed.completeness === "complete" &&
    seed.testedSubject.kind === "head" &&
    typeof seed.headSha === "string" &&
    seed.testedSubject.sha === seed.headSha;
}

function isActiveTypedContract(report: VerificationReport): boolean {
  const contract = (report as VerificationReport & { verificationContract?: { state?: unknown } }).verificationContract;
  return contract?.state === "authoritative" || contract?.state === "author_claim";
}

function uniqueReasons(reasons: GeneralPrAssessmentReasonV1[]): GeneralPrAssessmentReasonV1[] {
  return [...new Set(reasons)].sort();
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}
