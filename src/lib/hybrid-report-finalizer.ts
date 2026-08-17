import { isDeepStrictEqual } from "node:util";
import {
  deriveDeterministicRequirementRelations,
  extractKeywords,
  extractRequirementSpanSeed,
  isUnlinkedPrEvaluationMetaCandidate
} from "./extractors";
import {
  bindHybridPlannerSeedHash,
  decodeHybridPlannerExpectedAxes,
  HYBRID_PLANNER_CONTRACT_VERSION,
  HYBRID_PLANNER_MODEL,
  HYBRID_PLANNER_PROMPT_VERSION,
  HYBRID_PLANNER_SCHEMA_VERSION,
  validateHybridPlannerPlan,
  type HybridPlannerPlanValidation,
  type PlannerAxis
} from "./hybrid-planner";
import type { RequirementProofSubject } from "./proof-contract";
import type {
  PullRequestInput,
  Requirement,
  RequirementSpanSeed,
  SourceProvenance,
  VerificationReport
} from "./types";
import {
  requirementProofAxisExpectations,
  type RequirementProofExpectations
} from "./verifier-proof-expectations";
import {
  generateVerificationReport,
  generateVerificationReportFromRequirements
} from "./verifier";

export const HYBRID_OVERFLOW_LIMITATION = "Enhanced planning was not attempted because the bounded source-span limit was exceeded; the deterministic evidence report is unchanged.";
export const HYBRID_PLAN_FALLBACK_LIMITATION = "Enhanced planning was unavailable; the deterministic evidence report is unchanged.";
export const HYBRID_PR_OMISSION_LIMITATION = "An unlinked PR objective candidate was omitted because enhanced planning did not admit it as a requirement.";

export type HybridFallbackReason =
  | "disabled"
  | "ineligible"
  | "consent_absent"
  | "no_spans"
  | "overflow"
  | "post_call_failure";

export type HybridReportFinalization =
  | { disposition: "hybrid"; report: VerificationReport }
  | { disposition: "fallback"; reason: "invalid_plan" | "finalization_failure"; report: VerificationReport };

export interface HybridReportFinalizerInput {
  input: PullRequestInput;
  seed: RequirementSpanSeed;
  provenance: Pick<SourceProvenance, "origin" | "headSha" | "baseSha">;
  /** Transient only; never projected into the report. */
  requirementSourceIdentityHash?: string;
  planValidation: HybridPlannerPlanValidation;
}

/** Generates BASE first, then applies only the allowlisted fallback limitation. */
export function generateHybridFallbackReport(
  input: PullRequestInput,
  reason: HybridFallbackReason
): VerificationReport {
  const report = generateVerificationReport(input);
  const limitation = reason === "overflow"
    ? HYBRID_OVERFLOW_LIMITATION
    : reason === "post_call_failure"
      ? HYBRID_PLAN_FALLBACK_LIMITATION
      : null;
  if (!limitation || report.limitations.includes(limitation)) return report;
  return { ...report, limitations: [...report.limitations, limitation] };
}

/**
 * Consumes Task 2 validation output and revalidates its binding before any
 * decision is read. Every failure discards the whole plan.
 */
export function finalizeHybridVerificationReport(
  args: HybridReportFinalizerInput
): HybridReportFinalization {
  if (!args.planValidation.valid) {
    return fallback(args.input, "invalid_plan");
  }

  const sourceIdentityHash = currentSourceIdentityHash(
    args.input,
    args.requirementSourceIdentityHash
  );
  if (sourceIdentityHash === null) return fallback(args.input, "invalid_plan");

  const currentSeed = currentBoundSeed(
    args.input,
    args.provenance,
    sourceIdentityHash
  );
  if (!currentSeed || !isDeepStrictEqual(currentSeed, args.seed)) {
    return fallback(args.input, "invalid_plan");
  }

  const rebound = validateHybridPlannerPlan(
    args.planValidation.plan,
    currentSeed,
    args.provenance,
    sourceIdentityHash
  );
  if (!rebound.valid) return fallback(args.input, "invalid_plan");

  const materialized = materializeRequirements(currentSeed, rebound.plan);
  if (!materialized) return fallback(args.input, "finalization_failure");

  const reportInput = materialized.omittedPrCandidate
    ? { ...args.input, limitations: appendOnce(args.input.limitations ?? [], HYBRID_PR_OMISSION_LIMITATION) }
    : args.input;
  const deterministicRelations = deriveAdmittedDeterministicRelations(
    reportInput,
    currentSeed,
    materialized.requirements
  );
  const proofExpectationsByRequirement = new Map(materialized.expectations);
  for (const [requirementId, expectations] of deterministicRelations.proofExpectationsByRequirement) {
    proofExpectationsByRequirement.set(requirementId, expectations);
  }
  const evidenceContextRequirementIdsByRequirement = new Map(materialized.evidenceContextRequirementIds);
  for (const [requirementId, contextIds] of deterministicRelations.evidenceContextRequirementIdsByRequirement) {
    evidenceContextRequirementIdsByRequirement.set(requirementId, [...contextIds]);
  }
  const report = generateVerificationReportFromRequirements(reportInput, {
    requirements: materialized.requirements,
    contexts: currentSeed.contexts,
    proofExpectationsByRequirement,
    evidenceContextRequirementIdsByRequirement,
    deterministicRelationsByRequirement: deterministicRelations.deterministicRelationsByRequirement,
    sourceBindingsByRef: deterministicRelations.sourceBindingsByRef
  });
  report.analysisContext = currentSeed.analysisContext;
  report.planner = {
    version: 1,
    contractVersion: HYBRID_PLANNER_CONTRACT_VERSION,
    schemaVersion: HYBRID_PLANNER_SCHEMA_VERSION,
    promptVersion: HYBRID_PLANNER_PROMPT_VERSION,
    model: HYBRID_PLANNER_MODEL,
    inputHash: currentSeed.seedHash
  };
  for (const requirement of report.requirements) {
    requirement.classificationBasis = "enhanced_plan";
    const subjects = materialized.plannerAxisSubjects.get(requirement.requirementId);
    if (subjects && subjects.length > 0) requirement.plannerAxisSubjects = [...subjects];
  }
  for (const node of report.proofGraph.nodes) node.classificationBasis = "enhanced_plan";
  return { disposition: "hybrid", report };
}

function deriveAdmittedDeterministicRelations(
  input: Pick<PullRequestInput, "taskText" | "description" | "taskSource">,
  seed: RequirementSpanSeed,
  admittedRequirements: readonly Requirement[]
) {
  const admittedById = new Map(admittedRequirements.map((requirement) => [requirement.id, requirement]));
  const sourceRequirements = seed.spans.map((span): Requirement => admittedById.get(span.id) ?? ({
    id: span.id,
    source: span.source,
    text: span.text,
    keywords: span.sourceQuality === "manual_check" ? [] : extractKeywords(span.text),
    priority: span.priority,
    role: "core_requirement",
    sourceQuality: span.authority === "pr_author_claim" ? "author_claim" : span.sourceQuality,
    sourceSection: span.sourceSection,
    contextRoles: []
  }));
  const derived = deriveDeterministicRequirementRelations(input, sourceRequirements);
  const admittedIds = new Set(admittedRequirements.map((requirement) => requirement.id));
  const deterministicRelationsByRequirement = new Map([...derived.deterministicRelationsByRequirement]
    .filter(([requirementId, relation]) =>
      admittedIds.has(requirementId) && admittedIds.has(relation.antecedentRequirementId)
    ));
  const retainedSourceBindingRefs = new Set([...deterministicRelationsByRequirement.values()].flatMap((relation) =>
    relation.kind === "test_antecedent"
      ? [relation.currentSourceBindingRef, relation.antecedentSourceBindingRef]
      : []
  ));
  const sourceBindingsByRef = new Map([...derived.sourceBindingsByRef]
    .filter(([ref]) => retainedSourceBindingRefs.has(ref)));
  const relationRequirementIds = new Set(deterministicRelationsByRequirement.keys());
  const proofExpectationsByRequirement = new Map([...derived.proofExpectationsByRequirement]
    .filter(([requirementId]) => relationRequirementIds.has(requirementId)));
  const evidenceContextRequirementIdsByRequirement = new Map([...derived.evidenceContextRequirementIdsByRequirement]
    .filter(([requirementId, contextIds]) =>
      relationRequirementIds.has(requirementId) && contextIds.every((contextId) => admittedIds.has(contextId))
    ));

  return {
    proofExpectationsByRequirement,
    evidenceContextRequirementIdsByRequirement,
    deterministicRelationsByRequirement,
    sourceBindingsByRef
  };
}

function currentBoundSeed(
  input: PullRequestInput,
  provenance: Pick<SourceProvenance, "origin" | "headSha" | "baseSha">,
  requirementSourceIdentityHash?: string
): RequirementSpanSeed | null {
  const currentProvenance = input.sourceProvenance;
  if (!currentProvenance || !sameProvenance(provenance, currentProvenance)) return null;
  const extracted = extractRequirementSpanSeed(input.taskText, input.description, input.taskSource);
  if (!extracted.eligible || extracted.overflow || !extracted.seed) return null;
  return bindHybridPlannerSeedHash(
    extracted.seed,
    currentProvenance,
    requirementSourceIdentityHash
  );
}

function currentSourceIdentityHash(
  input: PullRequestInput,
  supplied: string | undefined
): string | undefined | null {
  const current = input.requirementSourceIdentityHash;
  if (current === undefined) {
    return input.sourceProvenance?.origin === "github_snapshot" ? null : undefined;
  }
  if (typeof current !== "string" || !/^[a-f0-9]{64}$/.test(current)) return null;
  if (supplied !== undefined && supplied !== current) return null;
  return current;
}

function sameProvenance(
  supplied: Pick<SourceProvenance, "origin" | "headSha" | "baseSha">,
  current: Pick<SourceProvenance, "origin" | "headSha" | "baseSha">
): boolean {
  return supplied.origin === current.origin &&
    (supplied.headSha ?? null) === (current.headSha ?? null) &&
    (supplied.baseSha ?? null) === (current.baseSha ?? null);
}

function fallback(
  input: PullRequestInput,
  reason: "invalid_plan" | "finalization_failure"
): HybridReportFinalization {
  return {
    disposition: "fallback",
    reason,
    report: generateHybridFallbackReport(input, "post_call_failure")
  };
}

function materializeRequirements(
  seed: RequirementSpanSeed,
  plan: Extract<HybridPlannerPlanValidation, { valid: true }>["plan"]
): {
  requirements: Requirement[];
  expectations: Map<string, RequirementProofExpectations>;
  plannerAxisSubjects: Map<string, RequirementProofSubject[]>;
  evidenceContextRequirementIds: Map<string, string[]>;
  omittedPrCandidate: boolean;
} | null {
  const requirements: Requirement[] = [];
  const expectations = new Map<string, RequirementProofExpectations>();
  const ownAxesBySpan = new Map<string, AxisMap>();
  const plannerAxisSubjects = new Map<string, RequirementProofSubject[]>();
  const evidenceContextRequirementIds = new Map<string, string[]>();
  const admittedIds = new Set<string>();
  let omittedPrCandidate = false;

  for (let index = 0; index < seed.spans.length; index += 1) {
    const span = seed.spans[index];
    const decision = plan.span_decisions[`d_${index}`];
    if (!span || !decision) return null;
    if (!decodeHybridPlannerExpectedAxes(decision.expected_axes)) return null;

    const plannerAdmitted = span.authority === "authoritative" ||
      (decision.disposition === "admit" && decision.classification === "requirement");
    const admitted = plannerAdmitted && !(
      span.authority === "pr_author_claim" &&
      isUnlinkedPrEvaluationMetaCandidate(span.text, span.sourceSection)
    );
    if (!admitted) {
      omittedPrCandidate = true;
      continue;
    }

    // The planner may classify a span, but cannot strengthen or weaken the
    // deterministic proof contract. Its axis suggestions are deliberately
    // not materialized as required report axes or report gaps.
    const ownAxes = expectationAxes(requirementProofAxisExpectations(span.text));
    addExecutionCompanion(ownAxes);
    ownAxesBySpan.set(span.id, ownAxes);
    admittedIds.add(span.id);

    const effectiveAxes = new Map(ownAxes);
    if (span.immediateParentSpanId && admittedIds.has(span.immediateParentSpanId)) {
      const parentAxes = ownAxesBySpan.get(span.immediateParentSpanId);
      if (!parentAxes || !mergeAxes(effectiveAxes, parentAxes)) return null;
    }

    const requirement: Requirement = {
      id: span.id,
      source: span.source,
      text: span.text,
      keywords: span.sourceQuality === "manual_check" ? [] : extractKeywords(span.text),
      priority: span.priority,
      role: "core_requirement",
      sourceQuality: span.authority === "pr_author_claim" ? "author_claim" : span.sourceQuality,
      sourceSection: span.sourceSection,
      contextRoles: []
    };
    requirements.push(requirement);
    expectations.set(requirement.id, axesToExpectations(effectiveAxes));
    if (ownAxes.get("targeted_test") === "present" && ownAxes.get("implementation") !== "present") {
      const contextIds = span.immediateParentSpanId && admittedIds.has(span.immediateParentSpanId)
        ? [span.immediateParentSpanId]
        : seed.spans
          .slice(0, index)
          .filter((candidate) =>
            candidate.groupId === span.groupId &&
            candidate.immediateParentSpanId === null &&
            admittedIds.has(candidate.id)
          )
          .map((candidate) => candidate.id);
      if (contextIds.length > 0) evidenceContextRequirementIds.set(requirement.id, contextIds);
    }
  }

  return {
    requirements,
    expectations,
    plannerAxisSubjects,
    evidenceContextRequirementIds,
    omittedPrCandidate
  };
}

type AxisMap = Map<RequirementProofSubject, PlannerAxis["polarity"]>;

function expectationAxes(expectations: RequirementProofExpectations): AxisMap {
  const axes: AxisMap = new Map();
  if (expectations.implementation) axes.set("implementation", "present");
  if (expectations.documentation) axes.set("documentation", "present");
  if (expectations.ci) axes.set("ci_configuration", "present");
  if (expectations.targetedTest) axes.set("targeted_test", "present");
  if (expectations.execution) axes.set("execution", "present");
  if (expectations.visual) axes.set("visual", "present");
  if (expectations.interaction) axes.set("interaction", "present");
  if (expectations.noImplementationChanges) axes.set("implementation", "absent");
  return axes;
}

function mergeAxes(target: AxisMap, additions: AxisMap): boolean {
  for (const [subject, polarity] of additions) {
    const existing = target.get(subject);
    if (existing && existing !== polarity) return false;
    target.set(subject, polarity);
  }
  return true;
}

function addExecutionCompanion(axes: AxisMap) {
  if (
    axes.get("implementation") === "present" ||
    axes.get("ci_configuration") === "present" ||
    axes.get("targeted_test") === "present"
  ) {
    axes.set("execution", "present");
  }
}

function axesToExpectations(axes: AxisMap): RequirementProofExpectations {
  return {
    implementation: axes.get("implementation") === "present",
    documentation: axes.get("documentation") === "present",
    ci: axes.get("ci_configuration") === "present",
    targetedTest: axes.get("targeted_test") === "present",
    visual: axes.get("visual") === "present",
    interaction: axes.get("interaction") === "present",
    noImplementationChanges: axes.get("implementation") === "absent",
    execution: axes.get("execution") === "present"
  };
}

function appendOnce(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}
