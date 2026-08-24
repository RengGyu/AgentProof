import { isDeepStrictEqual } from "node:util";
import { extractRequirementSpanSeed } from "./extractors";
import {
  bindHybridPlannerSeedHash,
  HYBRID_PLANNER_CONTRACT_VERSION,
  HYBRID_PLANNER_MODEL,
  HYBRID_PLANNER_PROMPT_VERSION,
  HYBRID_PLANNER_SCHEMA_VERSION,
  validateHybridPlannerPlan,
  type HybridPlannerPlanValidation
} from "./hybrid-planner";
import type {
  PullRequestInput,
  RequirementSpanSeed,
  SourceProvenance,
  VerificationReport
} from "./types";
import { generateVerificationReport } from "./verifier";

export const HYBRID_OVERFLOW_LIMITATION = "Enhanced planning was not attempted because the bounded source-span limit was exceeded; the deterministic evidence report is unchanged.";
export const HYBRID_PLAN_FALLBACK_LIMITATION = "Enhanced planning was unavailable; the deterministic evidence report is unchanged.";

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

  // The raw-span planner seed proves only planner input provenance. Canonical
  // BASE selection remains the sole owner of report requirements and proof.
  const report = generateVerificationReport(args.input);
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
  }
  for (const node of report.proofGraph.nodes) node.classificationBasis = "enhanced_plan";
  return { disposition: "hybrid", report };
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
