import { createHash } from "node:crypto";
import { selectCanonicalSelectedSourceBundle } from "./extractors";
import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { buildGeneralPrRedactedSourceViewsV1 } from "./general-pr-semantic-selection";
import type { GeneralPrObservationBundleV2 } from "./general-pr-observation-service";
import { evaluateVerificationCriterionV2 } from "./verification-criterion-evaluator-v2";
import type { PullRequestInput, VerificationReportV2 } from "./types";
import type { OrdinaryDocumentationSummary } from "./general-pr-documentation-presentation";
import { registerOrdinaryDocumentationValidationContext } from "./report-runtime-validation";

/** Private source-owned plan, not an authoritative verification contract. */
export interface OrdinaryDocumentationPlan {
  version: 1;
  targetId: string;
  sourceId: string;
  sourceKind: "linked_issue" | "pr_body" | "pr_title" | "provided_requirement";
  sourceOrdinal: number;
  spanId: string;
  legacyRequirementId: string | null;
  headSha: string;
  path: string;
  literal: string;
  predicate: "literal_presence";
}
export type OrdinaryDocumentationBlob = { path: string; headSha: string; content: string };
export interface OrdinaryDocumentationResult {
  targetId: string;
  headSha: string;
  artifactDigest: string | null;
  state: "supported" | "contradicted" | "unavailable";
}
const plans = new WeakSet<object>();
const summaries = new WeakMap<object, { input: PullRequestInput; plans: OrdinaryDocumentationPlan[]; artifactBlobs: OrdinaryDocumentationBlob[]; results: OrdinaryDocumentationResult[] }>();

export const ORDINARY_DOCUMENTATION_DIAGNOSTIC_STATES = ["deterministic_report_invalid", "observation_disabled", "seed_invalid", "observer_ineligible", "parse_incomplete", "assessment_hidden", "report_version_ineligible", "capability_disabled", "collector_unavailable", "seed_mismatch", "head_unavailable", "source_ineligible", "redacted_views_unavailable", "no_admitted_objectives", "no_compilable_objectives", "compiled", "artifact_collection_failed", "projection_unavailable", "evaluated"] as const;
export interface OrdinaryDocumentationDiagnostic {
  state: (typeof ORDINARY_DOCUMENTATION_DIAGNOSTIC_STATES)[number];
  /** Counts saturate at 100; plan and predicate counts remain exact (at most 8). */
  admittedObjectiveCount: number;
  planCount: number;
  rejectionCounts: { multiSpan: number; sourceIneligible: number; unsupportedWording: number; unsafePath: number; redactedLiteral: number; planLimit: number };
  predicateCounts: { supported: number; contradicted: number; unavailable: number };
}
export function emptyOrdinaryDocumentationDiagnostic(state: OrdinaryDocumentationDiagnostic["state"]): OrdinaryDocumentationDiagnostic {
  return { state, admittedObjectiveCount: 0, planCount: 0, rejectionCounts: { multiSpan: 0, sourceIneligible: 0, unsupportedWording: 0, unsafePath: 0, redactedLiteral: 0, planLimit: 0 }, predicateCounts: { supported: 0, contradicted: 0, unavailable: 0 } };
}

export function compileOrdinaryDocumentationPlans(input: PullRequestInput, seed: GeneralPrObservationSeedV2, bundle: GeneralPrObservationBundleV2): OrdinaryDocumentationPlan[] {
  return compileOrdinaryDocumentationPlansWithDiagnostic(input, seed, bundle).plans;
}

export function compileOrdinaryDocumentationPlansWithDiagnostic(input: PullRequestInput, seed: GeneralPrObservationSeedV2, bundle: GeneralPrObservationBundleV2): { plans: OrdinaryDocumentationPlan[]; diagnostic: OrdinaryDocumentationDiagnostic } {
  const diagnostic = emptyOrdinaryDocumentationDiagnostic("compiled");
  const skip = (state: OrdinaryDocumentationDiagnostic["state"]) => ({ plans: [], diagnostic: { ...diagnostic, state } });
  if (bundle.seedHash !== seed.seedHash) return skip("seed_mismatch");
  if (seed.parseState !== "complete") return skip("parse_incomplete");
  if (!seed.headSha) return skip("head_unavailable");
  if (input.repositoryPrivate !== false || input.sourceProvenance?.origin !== "github_snapshot") return skip("source_ineligible");
  const views = buildGeneralPrRedactedSourceViewsV1(input, seed);
  if (!views) return skip("redacted_views_unavailable");
  diagnostic.admittedObjectiveCount = Math.min(100, bundle.objectives.length);
  const reject = (reason: keyof OrdinaryDocumentationDiagnostic["rejectionCounts"]) => { diagnostic.rejectionCounts[reason] = Math.min(100, diagnostic.rejectionCounts[reason] + 1); return []; };
  const canonical = selectCanonicalSelectedSourceBundle(input);
  const compiled = bundle.objectives.flatMap(objective => {
    if (objective.sourceSpanIds.length !== 1) return reject("multiSpan");
    const span = seed.spans.find(span => span.id === objective.sourceSpanIds[0]);
    const source = seed.sources.find(source => source.id === span?.sourceUnitId);
    if (!span || !source || source.roleCeiling !== "objective" || source.admissionTier === "context") return reject("sourceIneligible");
    const text = views.get(source.id)!.slice(span.start, span.end).trim();
    // Deliberately a whole-span presence assertion, never an addition, conditional,
    // negation, or a inferred acceptance condition for a broader objective.
    const pathFirst = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?`([A-Za-z0-9_./-]+\.(?:md|mdx|rst|txt))` must (?:contain|include) `([^`\r\n]{1,512})`\.?$/.exec(text)
      ?? /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?[Ee]nsure `([A-Za-z0-9_./-]+\.(?:md|mdx|rst|txt))` (?:contains|includes) `([^`\r\n]{1,512})`\.?$/.exec(text);
    const literalFirst = pathFirst ? null : /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?[Ii]nclude `([^`\r\n]{1,512})` in `([A-Za-z0-9_./-]+\.(?:md|mdx|rst|txt))`\.?$/.exec(text);
    const match = pathFirst ?? (literalFirst && [literalFirst[0], literalFirst[2], literalFirst[1]]);
    if (!match) return reject("unsupportedWording");
    if (!safeOrdinaryDocumentationPath(match[1])) return reject("unsafePath");
    if (/\[REDACTED/i.test(match[2])) return reject("redactedLiteral");
    const selectedKind = input.taskText.trim() ? (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") : "pr_body";
    const aliases = source.kind === selectedKind ? [...canonical.structureByRequirementId].filter(([, structure]) => structure.start === span.start && structure.end === span.end).map(([id]) => id) : [];
    const plan: OrdinaryDocumentationPlan = Object.freeze({ version: 1, targetId: `gpd_${hash(JSON.stringify([seed.repositoryIdentityHash, source.sourceIdentityHash, source.rawSourceDigest, span.start, span.end, span.textHash])).slice(0, 24)}`, sourceId: source.id, sourceKind: source.kind, sourceOrdinal: source.structuralSpanIds.indexOf(span.id) + 1, spanId: span.id, legacyRequirementId: aliases.length === 1 ? aliases[0] : null, headSha: seed.headSha!, path: match[1], literal: match[2], predicate: "literal_presence" });
    plans.add(plan);
    return [plan];
  });
  diagnostic.planCount = Math.min(8, compiled.length);
  diagnostic.rejectionCounts.planLimit = Math.min(100, Math.max(0, compiled.length - 8));
  diagnostic.state = !bundle.objectives.length ? "no_admitted_objectives" : !compiled.length ? "no_compilable_objectives" : "compiled";
  return { plans: compiled.slice(0, 8), diagnostic };
}

export function safeOrdinaryDocumentationPath(path: string): boolean {
  return path.length <= 200 && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:md|mdx|rst|txt)$/.test(path) && !path.split("/").some(part => part === "." || part === "..");
}

export function evaluateOrdinaryDocumentationPlan(plan: OrdinaryDocumentationPlan, artifactBlobs: readonly OrdinaryDocumentationBlob[]): OrdinaryDocumentationResult {
  const matching = artifactBlobs.filter(blob => blob.path === plan.path && blob.headSha === plan.headSha && Buffer.byteLength(blob.content, "utf8") <= 64 * 1024);
  const blobs = matching.length === 1 ? matching : [];
  const evaluated = evaluateVerificationCriterionV2({ id: plan.targetId, label: "Source-declared literal presence only", type: "artifact", paths: [plan.path], artifact: { kind: "documentation_literal", literal: plan.literal } }, {
    headSha: plan.headSha, artifactBlobs: blobs, artifactEvidenceRefsByPath: { [plan.path]: [plan.targetId] }, evidenceRefsByPath: {}, changedFileInventory: { completeness: "incomplete", paths: [] }
  });
  return { targetId: plan.targetId, headSha: plan.headSha, artifactDigest: blobs[0] ? hash(blobs[0].content) : null, state: evaluated.state === "satisfied" ? "supported" : evaluated.state === "violated" ? "contradicted" : "unavailable" };
}

export function validateOrdinaryDocumentationResult(result: unknown, context: { input: PullRequestInput; plans: readonly OrdinaryDocumentationPlan[]; artifactBlobs: readonly OrdinaryDocumentationBlob[] }): boolean {
  if (!result || typeof result !== "object") return false;
  const plan = context.plans.find(plan => plan.targetId === (result as OrdinaryDocumentationResult).targetId);
  if (!plan || !plans.has(plan) || plan.headSha !== context.input.sourceProvenance?.headSha) return false;
  const seed = buildGeneralPrObservationSeedV2(context.input);
  const source = seed.sources.find(source => source.id === plan.sourceId);
  const span = seed.spans.find(span => span.id === plan.spanId && span.sourceUnitId === source?.id);
  if (!source || !span || plan.targetId !== `gpd_${hash(JSON.stringify([seed.repositoryIdentityHash, source.sourceIdentityHash, source.rawSourceDigest, span.start, span.end, span.textHash])).slice(0, 24)}`) return false;
  return JSON.stringify(result) === JSON.stringify(evaluateOrdinaryDocumentationPlan(plan, context.artifactBlobs));
}

export function projectOrdinaryDocumentationSummary(context: { input: PullRequestInput; plans: OrdinaryDocumentationPlan[]; artifactBlobs: OrdinaryDocumentationBlob[] }): OrdinaryDocumentationSummary | undefined {
  if (!context.plans.length) return undefined;
  const results = context.plans.map(plan => evaluateOrdinaryDocumentationPlan(plan, context.artifactBlobs));
  if (!results.every(result => validateOrdinaryDocumentationResult(result, context))) return undefined;
  const summary: OrdinaryDocumentationSummary = { version: 1, scope: "literal_presence_only", predicates: context.plans.map((plan, index) => ({ sourceKind: plan.sourceKind, sourceOrdinal: plan.sourceOrdinal, legacyRequirementId: plan.legacyRequirementId, state: results[index].state })) };
  summaries.set(summary, { ...context, plans: [...context.plans], input: structuredClone(context.input), artifactBlobs: structuredClone(context.artifactBlobs), results });
  registerOrdinaryDocumentationValidationContext(summary, input => validateGeneratedOrdinaryDocumentationSummary(input, { ordinaryDocumentationSummary: summary } as VerificationReportV2));
  return summary;
}

export function validateGeneratedOrdinaryDocumentationSummary(input: PullRequestInput, report: VerificationReportV2): boolean {
  const summary = report.ordinaryDocumentationSummary;
  if (!summary) return true;
  const context = summaries.get(summary);
  return Boolean(context && context.results.every(result => validateOrdinaryDocumentationResult(result, { ...context, input })) && JSON.stringify(summary) === JSON.stringify(projectOrdinaryDocumentationSummary(context)));
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
