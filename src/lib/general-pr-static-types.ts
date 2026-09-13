import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { getGeneralPrUnionMemberCandidatesV1, type GeneralPrSemanticProposalV2 } from "./general-pr-semantic-proposal";
import type { GeneralPrObservationBundleV2 } from "./general-pr-observation-service";
import type { PullRequestInput } from "./types";
import type { TypeScriptUnionPrimitive, TypeScriptUnionArtifactBlob, TypeScriptUnionMemberResult } from "./typescript-union-verification";
import { isOrdinaryStaticSummary, type OrdinaryStaticSummary } from "./general-pr-static-types-presentation";
import { registerOrdinaryStaticValidationContext } from "./report-runtime-validation";
import { selectCanonicalSelectedSourceBundle } from "./extractors";
import { buildGeneralPrRedactedSourceViewsV1 } from "./general-pr-semantic-selection";

/** Exact whole-clause meaning and explicit path; token-only semantic candidates never enter here. */
export function compileExplicitOrdinaryUnionPlans(input: PullRequestInput, seed: GeneralPrObservationSeedV2) {
  if (input.repositoryPrivate !== false || input.sourceProvenance?.origin !== "github_snapshot" || seed.parseState !== "complete" || !seed.headSha || !/^[a-f0-9]{40}$/i.test(seed.headSha)) return [];
  const canonical = selectCanonicalSelectedSourceBundle(input);
  const views = buildGeneralPrRedactedSourceViewsV1(input, seed);
  const selectedKind = input.taskText.trim() ? (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") : "pr_body";
  return seed.spans.flatMap(span => {
    const source = seed.sources.find(source => source.id === span.sourceUnitId);
    if (!views || !source || source.kind !== selectedKind || source.roleCeiling !== "objective" || source.admissionTier === "context") return [];
    const ids = [...canonical.structureByRequirementId].filter(([, structure]) => structure.start === span.start && structure.end === span.end).map(([id]) => id);
    if (ids.length !== 1) return [];
    const match = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?[Tt]ype `([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)` in `((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|mts|cts))` must include `(string|number|boolean|bigint|symbol|undefined|null)` as a union member\.?$/.exec(views.get(source.id)!.slice(span.start, span.end).trim());
    return match ? [{ requirementId: ids[0], path: match[2], aliasName: match[1], member: match[3] as TypeScriptUnionPrimitive, headSha: seed.headSha! }] : [];
  }).slice(0, 8);
}

export interface OrdinaryStaticPlan {
  seedHash: string;
  headSha: string;
  spanId: string;
  sourceKind: OrdinaryStaticSummary["predicates"][number]["sourceKind"];
  sourceOrdinal: number;
  aliasName: string;
  member: TypeScriptUnionPrimitive;
}
const registeredPlans = new WeakSet<object>();
const summaries = new WeakMap<object, { seedHash: string; lookup: string; plans: readonly OrdinaryStaticPlan[]; artifacts: TypeScriptUnionMemberResult[][]; serialized: string }>();

export function selectOrdinaryStaticLookup(input: PullRequestInput): { paths: string[]; incomplete: boolean } {
  const paths = [...new Set(input.changedFiles.map(file => file.path).filter(path => path.length <= 200 && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|mts|cts)$/.test(path)))].sort();
  const inventory = input.sourceProvenance?.changedFileInventory;
  return { paths: paths.slice(0, 8), incomplete: paths.length > 8 || inventory?.completeness !== "complete" || inventory.headSha !== input.sourceProvenance?.headSha };
}
export function compileOrdinaryStaticPlans(input: PullRequestInput, seed: GeneralPrObservationSeedV2, bundle: GeneralPrObservationBundleV2, proposal: GeneralPrSemanticProposalV2 | null): OrdinaryStaticPlan[] {
  if (input.repositoryPrivate !== false || input.sourceProvenance?.origin !== "github_snapshot" || !seed.headSha || !/^[a-f0-9]{40}$/i.test(seed.headSha) || seed.parseState !== "complete" || bundle.seedHash !== seed.seedHash || buildGeneralPrObservationSeedV2(input).seedHash !== seed.seedHash) return [];
  return getGeneralPrUnionMemberCandidatesV1(proposal, seed.seedHash).flatMap(candidate => {
    if (!bundle.objectives.some(objective => objective.sourceSpanIds.length === 1 && objective.sourceSpanIds[0] === candidate.spanId)) return [];
    const span = seed.spans.find(span => span.id === candidate.spanId);
    const source = seed.sources.find(source => source.id === span?.sourceUnitId);
    if (!source || source.roleCeiling !== "objective" || source.admissionTier === "context") return [];
    const sourceOrdinal = source.structuralSpanIds.indexOf(candidate.spanId) + 1;
    if (sourceOrdinal < 1 || sourceOrdinal > 10000) return [];
    const plan: OrdinaryStaticPlan = Object.freeze({ seedHash: seed.seedHash, headSha: seed.headSha!, spanId: candidate.spanId, sourceKind: source.kind, sourceOrdinal, aliasName: candidate.aliasName, member: candidate.member });
    registeredPlans.add(plan);
    return [plan];
  }).slice(0, 8);
}
export async function projectOrdinaryStaticSummary(context: { input: PullRequestInput; plans: readonly OrdinaryStaticPlan[]; artifactBlobs: readonly TypeScriptUnionArtifactBlob[] }): Promise<OrdinaryStaticSummary | undefined> {
  const seedHash = buildGeneralPrObservationSeedV2(context.input).seedHash;
  if (context.input.repositoryPrivate !== false || context.input.sourceProvenance?.origin !== "github_snapshot" || !context.plans.length || context.plans.length > 8 || !context.plans.every(plan => registeredPlans.has(plan) && plan.seedHash === seedHash && plan.headSha === context.input.sourceProvenance?.headSha)) return undefined;
  const lookup = selectOrdinaryStaticLookup(context.input);
  if (!lookup.paths.length) return undefined;
  // Loading the TypeScript parser is deferred until a source-owned plan exists.
  const { evaluateTypeScriptUnionMember } = await import("./typescript-union-verification");
  const artifacts = context.plans.map(plan => lookup.paths.map(path => evaluateTypeScriptUnionMember({ path, aliasName: plan.aliasName, member: plan.member, headSha: plan.headSha }, context.artifactBlobs)));
  const summary: OrdinaryStaticSummary = { version: 1, scope: "direct_union_membership_only", interpretation: "hypothesis", lookupScope: "changed_files_only", lookupIncomplete: lookup.incomplete, predicates: context.plans.map((plan, index) => ({ sourceKind: plan.sourceKind, sourceOrdinal: plan.sourceOrdinal, artifactCounts: { present: artifacts[index].filter(result => result.state === "supported").length, absent: artifacts[index].filter(result => result.state === "contradicted").length, unavailable: artifacts[index].filter(result => result.state === "unavailable").length } })) };
  // Keep private source/plan/artifact provenance, never raw source code.
  summaries.set(summary, { seedHash, lookup: JSON.stringify(lookup), plans: [...context.plans], artifacts, serialized: JSON.stringify(summary) });
  registerOrdinaryStaticValidationContext(summary, input => validateGeneratedOrdinaryStaticSummary(input, summary));
  return summary;
}
export function validateGeneratedOrdinaryStaticSummary(input: PullRequestInput, summary: OrdinaryStaticSummary): boolean {
  const context = summaries.get(summary);
  return Boolean(context && input.repositoryPrivate === false && input.sourceProvenance?.origin === "github_snapshot" && isOrdinaryStaticSummary(summary) && context.seedHash === buildGeneralPrObservationSeedV2(input).seedHash && context.lookup === JSON.stringify(selectOrdinaryStaticLookup(input)) && context.plans.every(plan => registeredPlans.has(plan) && plan.headSha === input.sourceProvenance?.headSha) && context.artifacts.every(results => results.every(result => result.headSha === input.sourceProvenance?.headSha)) && context.serialized === JSON.stringify(summary));
}
