import { runGeneralPrObservationNowV2, type GeneralPrObservationBundleV2, type RunGeneralPrObservationNowOptionsV2 } from "./general-pr-observation-service";
import type { GeneralPrSemanticObserverPackageV4 } from "./general-pr-semantic-observer";
import { buildGeneralPrObservationSeedV2, type GeneralPrSourceKindV2 } from "./general-pr-observation-source";
import { ORDINARY_DOCUMENTATION_DIAGNOSTIC_STATES, type OrdinaryDocumentationDiagnostic } from "./general-pr-documentation";

const MAX_TARGETS = 20;
const MAX_REFS = 12;
const MAX_PROPOSALS = 64;
const CLAIM_REASONS = ["span_binding_invalid", "root_shape_invalid", "span_decision_invalid", "role_ceiling_violation", "output_limit_exceeded"] as const;
const EVIDENCE_REASONS = ["validation_provenance_invalid", "output_limit_exceeded", "root_shape_invalid", "relation_limit_exceeded", "selection_binding_invalid", "relation_shape_invalid", "objective_binding_invalid", "reference_binding_invalid", "duplicate_relation", "reference_ownership_conflict", "merge_binding_invalid", "validator_exception"] as const;
type Kind = "evidence_relation" | "test_applicability" | "scope_mapping";
type Proposal = "supports" | "tests" | "implements" | "contradicts" | "unresolved" | "likely_expected" | "likely_not_applicable" | "ambiguous" | "plausibly_mapped";
type Stage = "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
type OmissionCounts = { targetLimit: number; sourceRefLimit: number; changeClusterRefLimit: number; evidenceRefLimit: number; proposalLimit: number };

export type GeneralPrTargetDiagnosticV1 = {
  ordinaryDocumentation?: OrdinaryDocumentationDiagnostic;
  version: 1; targetCount: number; omittedTargetCount: number; rejectedProviderProposalCount: number; projectionOmissionCounts: OmissionCounts;
  targets: Array<{
    targetRef: string; selectedSourceSpanRefs: string[]; selectedChangeClusterRefs: string[]; selectedEvidenceRefs: string[];
    sourceObligation: "author_claim_confirmation" | "authoritative_requirement" | "unavailable";
    currentAssessmentEligibility: "eligible" | "ineligible_provided_requirement" | "unavailable";
    objectiveState: "semantic_candidate" | "observed_objective";
    admissionDisposition: "admitted" | "not_admitted";
    nonAdmissionReason: "not_applicable" | "claim_stage_not_valid" | "evidence_stage_not_valid" | "finalizer_not_admitted" | "unavailable";
    validator: { scope: "global_stage"; claimState: Stage; evidenceState: Stage; claimInvalidReason: (typeof CLAIM_REASONS)[number] | null; evidenceInvalidReason: (typeof EVIDENCE_REASONS)[number] | null; capability: "semantic_relation_validation_only" | "collection_only" | "collection_incomplete" };
    proposedRelations: Array<{ kind: Kind; proposal: Proposal; referenceRef: string; validatorDisposition: "accepted" | "rejected" | "not_completed"; finalizerDisposition: "used" | "not_used" | "not_applicable" }>;
    currentAssessmentCeiling: "evidence_partial" | "blocked" | "not_assessable";
    missingProofReasons: Array<"author_claim_confirmation_required" | "exact_head_subject_required" | "verified_objective_change_relation_not_evaluated" | "targeted_test_requirement_not_evaluated" | "exact_head_execution_not_evaluated" | "candidate_not_admitted">;
  }>;
};
type Captured = { spanIds: string[]; clusters: string[]; evidence: string[]; authority: "authoritative" | "author_claim" | "unavailable"; sourceKind: GeneralPrSourceKindV2 | "unavailable"; relations: Array<{ kind: Kind; proposal: Proposal; id: string }> };

/** Authenticated-only, bounded projection. It retains no provider body, text, ID, path, diff, log, prompt, token, or hash. */
export async function runGeneralPrInformationDiagnosticV1(options: RunGeneralPrObservationNowOptionsV2): Promise<{ result: Awaited<ReturnType<typeof runGeneralPrObservationNowV2>>; diagnostic: GeneralPrTargetDiagnosticV1 }> {
  const targets: Captured[] = [];
  const authorities = new Map<string, "authoritative" | "author_claim">();
  const seed = buildGeneralPrObservationSeedV2(options.input);
  const sourceKinds = new Map<string, GeneralPrSourceKindV2 | "unavailable">(seed.spans.map((span) => [span.id, seed.sources.find((source) => source.id === span.sourceUnitId)?.kind ?? "unavailable"]));
  let rejected = 0, proposalOverflow = 0;
  const upstream = options.semantic?.provider;
  const semantic = upstream ? { ...options.semantic!, provider: { observe: async (request: GeneralPrSemanticObserverPackageV4) => {
    if (request.stage === "claim_discovery") for (const span of request.input.spans) authorities.set(span.id, span.authority);
    if (request.stage === "evidence_linking") {
      const current = request.input.objectiveGroups.map((group) => ({ spanIds: [...group.objectiveSpanIds], clusters: [...group.allowedChangeClusterIds], evidence: [...group.allowedEvidenceIds], authority: authority(group.objectiveSpanIds, authorities), sourceKind: sourceKind(group.objectiveSpanIds, sourceKinds), relations: [] as Captured["relations"] }));
      targets.push(...current);
      const output = await upstream.observe(request);
      const captured = capture(output, current);
      rejected += captured.rejected; proposalOverflow += captured.overflow;
      return output;
    }
    const output = await upstream.observe(request);
    return output;
  } } } : undefined;
  const result = await runGeneralPrObservationNowV2({ ...options, ...(semantic ? { semantic } : {}) });
  const exactHeadBound = seed.completeness === "complete" && seed.testedSubject.kind === "head" && typeof seed.headSha === "string" && seed.testedSubject.sha === seed.headSha;
  return { result, diagnostic: { ...build(result.bundle, targets, rejected, proposalOverflow, exactHeadBound, sourceKinds), ordinaryDocumentation: result.ordinaryDocumentationDiagnostic } };
}

function capture(value: unknown, targets: Captured[]) {
  const fields: Array<[string, Kind, string, Proposal[]]> = [
    ["testApplicabilityProposals", "test_applicability", "changeClusterId", ["likely_expected", "likely_not_applicable", "ambiguous"]],
    ["scopeMappingProposals", "scope_mapping", "changeClusterId", ["plausibly_mapped", "unresolved"]],
    ["evidenceRelationProposals", "evidence_relation", "evidenceId", ["supports", "tests", "implements", "contradicts", "unresolved"]]
  ];
  if (!record(value)) return { rejected: 0, overflow: 0 };
  let rejected = 0, overflow = 0, count = 0;
  const seen = new Set<string>();
  for (const [field, kind, idKey, proposals] of fields) {
    const entries = value[field];
    if (!Array.isArray(entries)) continue;
    const boundedEntries = entries.slice(0, MAX_PROPOSALS + 1);
    overflow += Math.max(0, entries.length - boundedEntries.length);
    for (const entry of boundedEntries) {
      if (!record(entry) || !exact(entry, ["objectiveSpanIds", idKey, "proposal"]) || !Array.isArray(entry.objectiveSpanIds) || !entry.objectiveSpanIds.every((id) => typeof id === "string") || typeof entry[idKey] !== "string" || typeof entry.proposal !== "string" || !proposals.includes(entry.proposal as Proposal)) { rejected += 1; continue; }
      const target = targets.find((item) => same(item.spanIds, entry.objectiveSpanIds as unknown[]));
      const id = entry[idKey] as string;
      const allowed = kind === "evidence_relation" ? target?.evidence : target?.clusters;
      const key = `${kind}:${JSON.stringify(entry.objectiveSpanIds)}:${id}`;
      if (!target || !allowed?.includes(id) || seen.has(key)) { rejected += 1; continue; }
      seen.add(key);
      if (count++ >= MAX_PROPOSALS) { overflow += 1; continue; }
      target.relations.push({ kind, proposal: entry.proposal as Proposal, id });
    }
  }
  return { rejected, overflow };
}

function build(bundle: GeneralPrObservationBundleV2 | null, captured: Captured[], rejected: number, proposalOverflow: number, exactHeadBound: boolean, sourceKinds: Map<string, GeneralPrSourceKindV2 | "unavailable">): GeneralPrTargetDiagnosticV1 {
  const targets = [...captured];
  for (const objective of bundle?.objectives ?? []) if (!targets.some((target) => same(target.spanIds, objective.sourceSpanIds))) targets.push({ spanIds: [...objective.sourceSpanIds], clusters: [], evidence: [], authority: objective.authority, sourceKind: sourceKind(objective.sourceSpanIds, sourceKinds), relations: [] });
  const omittedTargetCount = Math.min(100, Math.max(0, targets.length - MAX_TARGETS));
  const selected = targets.slice(0, MAX_TARGETS);
  const refs = ordinalRefs(selected);
  const claimState = bundle?.semanticStageDiagnostics.claimState ?? "not_run";
  const evidenceState = bundle?.semanticStageDiagnostics.evidenceState ?? "not_run";
  const omissions = { targetLimit: omittedTargetCount, sourceRefLimit: capped(selected.reduce((sum, item) => sum + Math.max(0, item.spanIds.length - MAX_REFS), 0)), changeClusterRefLimit: capped(selected.reduce((sum, item) => sum + Math.max(0, item.clusters.length - MAX_REFS), 0)), evidenceRefLimit: capped(selected.reduce((sum, item) => sum + Math.max(0, item.evidence.length - MAX_REFS), 0)), proposalLimit: capped(proposalOverflow) };
  return { version: 1, targetCount: selected.length, omittedTargetCount, rejectedProviderProposalCount: Math.min(MAX_PROPOSALS, rejected), projectionOmissionCounts: omissions, targets: selected.map((target, index) => row(target, index, bundle, claimState, evidenceState, refs, exactHeadBound)) };
}

function row(target: Captured, index: number, bundle: GeneralPrObservationBundleV2 | null, claimState: Stage, evidenceState: Stage, refs: Map<string, string>, exactHeadBound: boolean): GeneralPrTargetDiagnosticV1["targets"][number] {
  const objective = (bundle?.objectives ?? []).find((item) => same(item.sourceSpanIds, target.spanIds));
  const objectiveIds = objective ? [objective.id] : [];
  const sourceObligation = target.authority === "authoritative" ? "authoritative_requirement" : target.authority === "author_claim" ? "author_claim_confirmation" : "unavailable";
  const currentAssessmentEligibility = target.sourceKind === "provided_requirement" ? "ineligible_provided_requirement" : target.sourceKind === "linked_issue" || target.authority === "author_claim" ? "eligible" : "unavailable";
  const relations = target.relations.filter((relation) => refs.has(relation.id)).map((relation) => {
    const validatorDisposition = evidenceState === "valid" ? "accepted" as const : evidenceState === "invalid" ? "rejected" as const : "not_completed" as const;
    const finalizerDisposition = validatorDisposition !== "accepted" ? "not_applicable" as const : used(bundle, objectiveIds, relation) ? "used" as const : "not_used" as const;
    return { kind: relation.kind, proposal: relation.proposal, referenceRef: refs.get(relation.id)!, validatorDisposition, finalizerDisposition };
  });
  const evidenceUsed = relations.some((relation) => relation.kind === "evidence_relation" && relation.finalizerDisposition === "used");
  const missing: GeneralPrTargetDiagnosticV1["targets"][number]["missingProofReasons"] = [];
  if (sourceObligation === "author_claim_confirmation") missing.push("author_claim_confirmation_required");
  if (!exactHeadBound) missing.push("exact_head_subject_required");
  missing.push("verified_objective_change_relation_not_evaluated");
  missing.push("targeted_test_requirement_not_evaluated", "exact_head_execution_not_evaluated");
  const admitted = Boolean(objective);
  if (!admitted) missing.push("candidate_not_admitted");
  return { targetRef: `target_${index + 1}`, selectedSourceSpanRefs: refsFor(target.spanIds, refs), selectedChangeClusterRefs: refsFor(target.clusters, refs), selectedEvidenceRefs: refsFor(target.evidence, refs), sourceObligation, currentAssessmentEligibility, objectiveState: objective?.state === "observed" ? "observed_objective" : "semantic_candidate", admissionDisposition: admitted ? "admitted" : "not_admitted", nonAdmissionReason: admitted ? "not_applicable" : claimState === "valid" ? "finalizer_not_admitted" : "claim_stage_not_valid", validator: { scope: "global_stage", claimState, evidenceState, claimInvalidReason: bundle?.semanticClaimInvalidReason ?? null, evidenceInvalidReason: bundle?.semanticEvidenceInvalidReason ?? null, capability: evidenceState === "valid" || evidenceState === "invalid" ? "semantic_relation_validation_only" : claimState === "not_run" ? "collection_only" : "collection_incomplete" }, proposedRelations: relations, currentAssessmentCeiling: !admitted || currentAssessmentEligibility !== "eligible" ? "not_assessable" : exactHeadBound ? "evidence_partial" : "blocked", missingProofReasons: missing };
}
function used(bundle: GeneralPrObservationBundleV2 | null, objectiveIds: string[], relation: Captured["relations"][number]) {
  if (relation.kind === "evidence_relation") return (bundle?.evidenceRelations ?? []).some((item) => objectiveIds.includes(item.objectiveId) && item.evidenceId === relation.id && item.proposal === relation.proposal);
  if (relation.kind === "test_applicability") return (bundle?.testCoverage ?? []).some((item) => objectiveIds.includes(item.objectiveId) && item.changeClusterId === relation.id && (relation.proposal === "ambiguous" || (relation.proposal === "likely_expected" && item.applicability === "hypothesized_required") || (relation.proposal === "likely_not_applicable" && item.applicability === "hypothesized_not_applicable")));
  return (bundle?.scopeMappings ?? []).some((item) => objectiveIds.includes(item.objectiveId ?? "") && item.changeClusterId === relation.id && (relation.proposal === "unresolved" || item.state === "plausibly_mapped"));
}
function ordinalRefs(targets: Captured[]) { const refs = new Map<string, string>(); for (const [prefix, lists] of [["span", targets.map((target) => target.spanIds.slice(0, MAX_REFS))], ["cluster", targets.map((target) => target.clusters.slice(0, MAX_REFS))], ["evidence", targets.map((target) => target.evidence.slice(0, MAX_REFS))]] as const) for (const list of lists) for (const id of list) if (!refs.has(id)) refs.set(id, `${prefix}_${[...refs.values()].filter((ref) => ref.startsWith(`${prefix}_`)).length + 1}`); return refs; }
function refsFor(ids: string[], refs: Map<string, string>) { return ids.slice(0, MAX_REFS).map((id) => refs.get(id)!); }
function authority(ids: string[], map: Map<string, "authoritative" | "author_claim">): Captured["authority"] { const values = ids.map((id) => map.get(id)); return values.every((value) => value === "authoritative") ? "authoritative" : values.some((value) => value === "author_claim") ? "author_claim" : "unavailable"; }
function sourceKind(ids: string[], map: Map<string, GeneralPrSourceKindV2 | "unavailable">): Captured["sourceKind"] { const values = ids.map((id) => map.get(id)); return values.every((value) => value === "provided_requirement") ? "provided_requirement" : values.every((value) => value === "linked_issue") ? "linked_issue" : values.some((value) => value === "pr_title") ? "pr_title" : values.some((value) => value === "pr_body") ? "pr_body" : "unavailable"; }
function capped(value: number) { return Math.min(100, Math.max(0, value)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function same(left: readonly string[], right: unknown[]) { return left.length === right.length && left.every((value, index) => value === right[index]); }

/** Strict recursive parser for authenticated integrations; unknown fields and orphan refs fail closed. */
export function isValidGeneralPrTargetDiagnosticV1(value: unknown): value is GeneralPrTargetDiagnosticV1 {
  if (!record(value)) return false;
  if (Object.hasOwn(value, "ordinaryDocumentation")) {
    if (!validOrdinaryDocumentationDiagnostic(value.ordinaryDocumentation)) return false;
    const { ordinaryDocumentation: _ordinaryDocumentation, ...legacy } = value;
    return isValidGeneralPrTargetDiagnosticV1(legacy);
  }
  if (!record(value) || !exact(value, ["version", "targetCount", "omittedTargetCount", "rejectedProviderProposalCount", "projectionOmissionCounts", "targets"]) || value.version !== 1 || !count(value.targetCount, MAX_TARGETS) || !count(value.omittedTargetCount, 100) || (Number(value.omittedTargetCount) > 0 && value.targetCount !== MAX_TARGETS) || !count(value.rejectedProviderProposalCount, MAX_PROPOSALS) || !record(value.projectionOmissionCounts) || value.omittedTargetCount !== value.projectionOmissionCounts.targetLimit || !exact(value.projectionOmissionCounts, ["targetLimit", "sourceRefLimit", "changeClusterRefLimit", "evidenceRefLimit", "proposalLimit"]) || !Object.values(value.projectionOmissionCounts).every((item) => count(item, 100)) || !dense(value.targets) || value.targets.length !== value.targetCount) return false;
  return value.targets.every((row, index) => validRow(row, index + 1)) && contiguousRefs(value.targets) && crossRowState(value.targets) && globalBounds(value);
}
function validRow(value: unknown, index: number): boolean {
  const reasons = record(value) && dense(value.missingProofReasons) && value.missingProofReasons.every((reason): reason is string => typeof reason === "string") ? value.missingProofReasons : [];
  if (!record(value) || !exact(value, ["targetRef", "selectedSourceSpanRefs", "selectedChangeClusterRefs", "selectedEvidenceRefs", "sourceObligation", "currentAssessmentEligibility", "objectiveState", "admissionDisposition", "nonAdmissionReason", "validator", "proposedRelations", "currentAssessmentCeiling", "missingProofReasons"]) || value.targetRef !== `target_${index}` || !refs(value.selectedSourceSpanRefs, "span", true) || !refs(value.selectedChangeClusterRefs, "cluster") || !refs(value.selectedEvidenceRefs, "evidence") || !["author_claim_confirmation", "authoritative_requirement", "unavailable"].includes(String(value.sourceObligation)) || !["eligible", "ineligible_provided_requirement", "unavailable"].includes(String(value.currentAssessmentEligibility)) || !["semantic_candidate", "observed_objective"].includes(String(value.objectiveState)) || !["admitted", "not_admitted"].includes(String(value.admissionDisposition)) || !["not_applicable", "claim_stage_not_valid", "evidence_stage_not_valid", "finalizer_not_admitted", "unavailable"].includes(String(value.nonAdmissionReason)) || (value.admissionDisposition === "admitted" && value.nonAdmissionReason !== "not_applicable") || (value.admissionDisposition === "not_admitted" && value.nonAdmissionReason === "not_applicable") || (value.objectiveState === "observed_objective" && value.admissionDisposition !== "admitted") || !["evidence_partial", "blocked", "not_assessable"].includes(String(value.currentAssessmentCeiling)) || (value.currentAssessmentEligibility !== "eligible" && value.currentAssessmentCeiling !== "not_assessable") || !validValidator(value.validator) || reasons.length === 0 || reasons.length > 6 || new Set(reasons).size !== reasons.length || !reasons.every((reason) => ["author_claim_confirmation_required", "exact_head_subject_required", "verified_objective_change_relation_not_evaluated", "targeted_test_requirement_not_evaluated", "exact_head_execution_not_evaluated", "candidate_not_admitted"].includes(reason)) || !reasons.includes("verified_objective_change_relation_not_evaluated") || !reasons.includes("targeted_test_requirement_not_evaluated") || !reasons.includes("exact_head_execution_not_evaluated") || !dense(value.proposedRelations) || value.proposedRelations.length > MAX_PROPOSALS) return false;
  const seen = new Set<string>();
  if (record(value.validator) && ((value.objectiveState === "semantic_candidate" && value.validator.claimState !== "valid") || (value.objectiveState === "observed_objective" && value.validator.claimState !== "not_run"))) return false;
  if (!value.proposedRelations.every((relation) => validRelation(relation, value, seen))) return false;
  const reasonsForTarget = reasons;
  const sourceMatrix = value.sourceObligation === "author_claim_confirmation" ? value.currentAssessmentEligibility === "eligible" && reasonsForTarget.includes("author_claim_confirmation_required") : value.sourceObligation === "authoritative_requirement" ? ["eligible", "ineligible_provided_requirement"].includes(value.currentAssessmentEligibility as string) : value.currentAssessmentEligibility === "unavailable";
  if (!sourceMatrix) return false;
  if (value.admissionDisposition === "not_admitted") return value.objectiveState === "semantic_candidate" && value.nonAdmissionReason === "finalizer_not_admitted" && value.currentAssessmentCeiling === "not_assessable" && reasonsForTarget.includes("candidate_not_admitted") && !value.proposedRelations.some((relation) => record(relation) && relation.finalizerDisposition === "used");
  if (reasonsForTarget.includes("candidate_not_admitted")) return false;
  if (value.currentAssessmentEligibility === "eligible" && value.currentAssessmentCeiling !== (reasonsForTarget.includes("exact_head_subject_required") ? "blocked" : "evidence_partial")) return false;
  return true;
}
function validValidator(value: unknown) { if (!record(value) || !exact(value, ["scope", "claimState", "evidenceState", "claimInvalidReason", "evidenceInvalidReason", "capability"]) || value.scope !== "global_stage" || !stage(value.claimState) || !stage(value.evidenceState)) return false; const claimInvalid = value.claimState === "invalid"; const evidenceInvalid = value.evidenceState === "invalid"; if (claimInvalid !== (value.claimInvalidReason !== null) || evidenceInvalid !== (value.evidenceInvalidReason !== null) || (claimInvalid && !CLAIM_REASONS.includes(value.claimInvalidReason as never)) || (evidenceInvalid && !EVIDENCE_REASONS.includes(value.evidenceInvalidReason as never))) return false; if (["valid", "invalid"].includes(value.evidenceState) && value.claimState !== "valid") return false; return value.capability === (["valid", "invalid"].includes(value.evidenceState) ? "semantic_relation_validation_only" : value.claimState === "not_run" ? "collection_only" : "collection_incomplete"); }
function validRelation(value: unknown, row: Record<string, unknown>, seen: Set<string>) { const evidenceState = record(row.validator) ? row.validator.evidenceState : null; if (!record(value) || !exact(value, ["kind", "proposal", "referenceRef", "validatorDisposition", "finalizerDisposition"]) || !["evidence_relation", "test_applicability", "scope_mapping"].includes(String(value.kind)) || !proposal(String(value.kind), String(value.proposal)) || typeof value.referenceRef !== "string" || (evidenceState === "valid" ? !(value.validatorDisposition === "accepted" && ["used", "not_used"].includes(String(value.finalizerDisposition))) : evidenceState === "invalid" ? !(value.validatorDisposition === "rejected" && value.finalizerDisposition === "not_applicable") : !(value.validatorDisposition === "not_completed" && value.finalizerDisposition === "not_applicable")) || !(value.kind === "evidence_relation" ? (row.selectedEvidenceRefs as unknown[]).includes(value.referenceRef) : (row.selectedChangeClusterRefs as unknown[]).includes(value.referenceRef))) return false; const key = `${value.kind}:${value.referenceRef}`; if (seen.has(key)) return false; seen.add(key); return true; }
function refs(value: unknown, prefix: string, required = false): value is string[] { return dense(value) && (!required || value.length > 0) && value.length <= MAX_REFS && new Set(value).size === value.length && value.every((ref) => typeof ref === "string" && new RegExp(`^${prefix}_(?:[1-9]|[1-9]\\d|1\\d\\d|2[0-3]\\d|240)$`).test(ref)); }
function contiguousRefs(rows: unknown[]) { for (const prefix of ["span", "cluster", "evidence"]) { const seen = new Set<string>(); let next = 1; for (const row of rows) if (record(row)) for (const refs of [row.selectedSourceSpanRefs, row.selectedChangeClusterRefs, row.selectedEvidenceRefs]) if (Array.isArray(refs)) for (const ref of refs) if (typeof ref === "string" && ref.startsWith(`${prefix}_`) && !seen.has(ref)) { if (ref !== `${prefix}_${next++}`) return false; seen.add(ref); } } return true; }
function crossRowState(rows: unknown[]) { const records = rows.filter(record); const tuples = new Set(records.map((row) => JSON.stringify(row.validator))); if (tuples.size > 1 || new Set(records.map((row) => (row.missingProofReasons as unknown[]).includes("exact_head_subject_required"))).size > 1 || !uniqueOwners(records, "selectedSourceSpanRefs")) return false; const accepted = records[0]?.validator && record(records[0].validator) && records[0].validator.evidenceState === "valid"; return (!accepted || uniqueAcceptedReferences(records)) && records.every((row) => row.currentAssessmentEligibility !== "ineligible_provided_requirement" || row.objectiveState === "observed_objective"); }
function globalBounds(value: Record<string, unknown>) { const rows = value.targets as Record<string, unknown>[]; const omissions = value.projectionOmissionCounts as Record<string, unknown>; const total = rows.reduce((sum, row) => sum + (Array.isArray(row.proposedRelations) ? row.proposedRelations.length : 0), 0); if (total > MAX_PROPOSALS) return false; if (rows.length === 0) return value.rejectedProviderProposalCount === 0 && Object.values(omissions).every((count) => count === 0); const validator = rows[0]?.validator as Record<string, unknown>; const invalid = validator?.evidenceState === "invalid"; if ((Number(value.rejectedProviderProposalCount) > 0 || Number(omissions.proposalLimit) > 0) && !invalid) return false; return [["sourceRefLimit", "selectedSourceSpanRefs"], ["changeClusterRefLimit", "selectedChangeClusterRefs"], ["evidenceRefLimit", "selectedEvidenceRefs"]].every(([count, field]) => Number(omissions[count]) === 0 || rows.some((row) => Array.isArray(row[field]) && row[field].length === MAX_REFS)); }
function uniqueOwners(rows: Record<string, unknown>[], field: string) { const seen = new Set<string>(); return rows.every((row) => Array.isArray(row[field]) && (row[field] as unknown[]).every((ref) => typeof ref === "string" && !seen.has(ref) && (seen.add(ref) || true))); }
function uniqueAcceptedReferences(rows: Record<string, unknown>[]) { const owners = new Map<string, number>(); return rows.every((row, index) => Array.isArray(row.proposedRelations) && row.proposedRelations.every((relation) => !record(relation) || relation.validatorDisposition !== "accepted" || !owners.has(String(relation.referenceRef)) || owners.get(String(relation.referenceRef)) === index ? (relation.validatorDisposition !== "accepted" || (owners.set(String(relation.referenceRef), index), true)) : false)); }
function stage(value: unknown): value is Stage { return ["not_run", "valid", "invalid", "timeout", "unavailable", "stale"].includes(String(value)); }
function proposal(kind: string, value: string) { return kind === "evidence_relation" ? ["supports", "tests", "implements", "contradicts", "unresolved"].includes(value) : kind === "test_applicability" ? ["likely_expected", "likely_not_applicable", "ambiguous"].includes(value) : kind === "scope_mapping" ? ["plausibly_mapped", "unresolved"].includes(value) : false; }
function validOrdinaryDocumentationDiagnostic(value: unknown): boolean {
  if (!record(value) || !exact(value, ["state", "admittedObjectiveCount", "planCount", "rejectionCounts", "predicateCounts"]) || !ORDINARY_DOCUMENTATION_DIAGNOSTIC_STATES.includes(value.state as never) || !count(value.admittedObjectiveCount, 100) || !count(value.planCount, 8) || Number(value.planCount) > Number(value.admittedObjectiveCount) || !record(value.rejectionCounts) || !exact(value.rejectionCounts, ["multiSpan", "sourceIneligible", "unsupportedWording", "unsafePath", "redactedLiteral", "planLimit"]) || !Object.values(value.rejectionCounts).every(item => count(item, 100)) || !record(value.predicateCounts) || !exact(value.predicateCounts, ["supported", "contradicted", "unavailable"]) || !Object.values(value.predicateCounts).every(item => count(item, 8))) return false;
  const rejected = Object.values(value.rejectionCounts).reduce<number>((sum, item) => sum + Number(item), 0);
  const evaluated = Object.values(value.predicateCounts).reduce<number>((sum, item) => sum + Number(item), 0);
  if (Math.min(100, rejected + Number(value.planCount)) !== value.admittedObjectiveCount || (Number(value.rejectionCounts.planLimit) > 0 && value.planCount !== 8)) return false;
  if (value.state === "evaluated") return Number(value.planCount) > 0 && evaluated === value.planCount;
  if (value.state === "artifact_collection_failed") return Number(value.planCount) > 0 && value.predicateCounts.supported === 0 && value.predicateCounts.contradicted === 0 && (evaluated === value.planCount || evaluated === 0);
  if (evaluated !== 0) return false;
  if (value.state === "compiled" || value.state === "projection_unavailable") return Number(value.planCount) > 0;
  if (value.state === "no_compilable_objectives") return Number(value.admittedObjectiveCount) > 0 && value.planCount === 0;
  return value.admittedObjectiveCount === 0 && value.planCount === 0 && rejected === 0;
}
function count(value: unknown, maximum: number) { return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum; }
function dense(value: unknown): value is unknown[] { return Array.isArray(value) && Object.keys(value).length === value.length && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean); }
