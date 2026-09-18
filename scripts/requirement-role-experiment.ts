import { createHash } from "node:crypto";
import {
  buildGeneralPrObservationSeedV2,
  type GeneralPrClaimRoleV2,
  type GeneralPrObservationSeedV2,
  type GeneralPrSourceAuthorityV2,
  type GeneralPrSourceKindV2,
} from "../src/lib/general-pr-observation-source";
import {
  type GeneralPrSemanticObserverModelProfileV2,
  type GeneralPrSemanticObserverPackageV4,
} from "../src/lib/general-pr-semantic-observer";
import {
  buildGeneralPrRedactedSourceViewsV1,
  computeGeneralPrSemanticClaimSelectionHashV1,
  type GeneralPrSemanticClaimSelectionV1,
} from "../src/lib/general-pr-semantic-selection";
import {
  GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES,
  buildGeneralPrSemanticClaimJsonSchemaV1,
  validateGeneralPrSemanticClaimCandidateV2,
} from "../src/lib/general-pr-semantic-proposal";
import { parseGeneralPrStructureV1 } from "../src/lib/general-pr-structure";
import type { PullRequestInput } from "../src/lib/types";
import { ablationHash, prepareAblationCase, validateAblationCorpus, type AblationCase, type AblationCorpus } from "./requirement-source-ablation";

export type RequirementRoleExperimentVersion = "V0" | "V1" | "V2" | "V3" | "V4";
type ClaimPacket = Extract<GeneralPrSemanticObserverPackageV4, { stage: "claim_discovery" }>;
type SourceRole = "objective" | "context" | "policy_only";
type LedgerStatus = "decided" | "abstained" | "unreviewed" | "invalid";
type ResearchInvalidReason = "root_shape_invalid" | "output_size_exceeded" | "span_decision_invalid" | "missing_span_id" | "duplicate_span_id" | "stale_span_id" | "unknown_span_id" | "union_candidate_invalid";

interface ContextReference {
  sourceUnitId: string;
  sourceKind: GeneralPrSourceKindV2;
  start: number;
  end: number;
  textHash: string;
  text: string;
  authority: GeneralPrSourceAuthorityV2;
  sourceRole: SourceRole;
}

interface SourceContext {
  candidateSpanId: string;
  sourceUnitId: string;
  references: ContextReference[];
}

export type RequirementRoleExperimentPacket = Omit<ClaimPacket, "input"> & {
  input: ClaimPacket["input"] & { sourceContext?: SourceContext[] };
};

export interface RequirementRoleExperimentProviderRequest {
  callId: string;
  caseId: string;
  version: RequirementRoleExperimentVersion;
  pass: "initial" | "expanded";
  requestHash: string;
  packet: RequirementRoleExperimentPacket;
  signal?: AbortSignal;
}

export interface RequirementRoleExperimentProvider {
  observe(request: RequirementRoleExperimentProviderRequest): Promise<unknown>;
}

export interface RequirementRoleExperimentTelemetry {
  latencyMs: number | null;
  httpStatus: number | null;
  observedModel: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export class RequirementRoleExperimentProviderError extends Error {
  constructor(public readonly reason: string, public readonly telemetry: unknown) {
    super("requirement role experiment provider failed");
    this.name = "RequirementRoleExperimentProviderError";
  }
}

export interface RequirementRoleExperimentOptions {
  modelProfile: GeneralPrSemanticObserverModelProfileV2;
  provider?: RequirementRoleExperimentProvider;
  maxCalls?: number;
  totalTimeoutMs?: number;
}

export interface RequirementRoleExperimentRegistryUnit {
  id: string;
  spanId: string | null;
  sourceUnitId: string;
  sourceKind: GeneralPrSourceKindV2;
  sourceContentHash: string;
  structuralKind: string;
  start: number;
  end: number;
  textHash: string;
  authority: GeneralPrSourceAuthorityV2;
  sourceRole: SourceRole;
  sourceBindingAvailable: boolean;
}

interface InternalUnit extends RequirementRoleExperimentRegistryUnit {
  roleCeiling: "objective" | "context" | "policy_only";
  deterministicRole: GeneralPrClaimRoleV2 | "unresolved" | "unreviewed";
  sectionKey: string;
  headingSpanIds: string[];
}

interface LedgerEntry {
  unitId: string;
  selected: boolean;
  attempted: boolean;
  initialSemanticRole: GeneralPrClaimRoleV2 | null;
  semanticRole: GeneralPrClaimRoleV2 | null;
  validatedOutcome: GeneralPrClaimRoleV2 | null;
  authorityDecision: ReturnType<typeof decideRequirementRoleAuthority> | "unreviewed";
  researchSchema: { state: "valid" | "invalid" | "not_run"; reason: ResearchInvalidReason | null };
  productValidator: { state: "valid" | "invalid" | "not_run"; reason: string | null };
  status: LedgerStatus;
  reason: string;
  contextState: "not_used" | "included" | "unavailable" | "context_byte_budget";
  expansionCount: 0 | 1;
  expansionReason: string | null;
}

interface CallRecord {
  id: string;
  pass: "initial" | "expanded";
  unitIds: string[];
  inputBytes: number;
  inputHash: string;
  promptHash: string;
  requestHash: string;
  contextOmittedUnitIds: string[];
  attempted: boolean;
  retryCount: 0;
  state: "not_run" | "valid" | "invalid" | "unavailable";
  reason: string;
  researchSchema: { state: "valid" | "invalid" | "not_run"; reason: ResearchInvalidReason | null };
  productValidator: { state: "valid" | "invalid" | "not_run"; reason: string | null };
  telemetry: RequirementRoleExperimentTelemetry;
}

interface Plan {
  packet: RequirementRoleExperimentPacket;
  selection: GeneralPrSemanticClaimSelectionV1;
  units: InternalUnit[];
  contextOmittedUnitIds: string[];
  pass: "initial" | "expanded";
}

interface PreparedCase {
  item: AblationCase;
  seed: GeneralPrObservationSeedV2;
  views: Map<string, string> | null;
  registry: InternalUnit[];
  versions: Record<RequirementRoleExperimentVersion, { version: RequirementRoleExperimentVersion; constraintPolicy: "existing_hard" | "semantic_hints_authority_hard"; outputValidationPolicy: "product_legacy" | "research_strict_with_product_diagnostic"; contextPolicy: "none" | "structural_neighbors" | "ambiguous_same_section_once"; plans: Plan[]; ledger: LedgerEntry[]; calls: CallRecord[] }>;
}

const versions: RequirementRoleExperimentVersion[] = ["V0", "V1", "V2", "V3", "V4"];
const roles = new Set<GeneralPrClaimRoleV2>(["objective_candidate", "problem_observation", "implementation_claim", "test_claim", "scope_exclusion", "known_limitation", "risk_or_revert", "follow_up", "template_or_process", "supporting_context", "mixed_or_ambiguous"]);
const MAX_SPANS = 12;
const MAX_INPUT_BYTES = 12_000;
const MAX_CALLS = 30;
export const REQUIREMENT_ROLE_EXPERIMENT_TOTAL_TIMEOUT_MS = 2_100_000;
export const REQUIREMENT_ROLE_EXPERIMENT_WRAPPER_TIMEOUT_MS = REQUIREMENT_ROLE_EXPERIMENT_TOTAL_TIMEOUT_MS + 5_000;
const HARD_CEILING_TEXT = "Hard ceilings: sourceRole=context must never yield objective_candidate; deterministicRole=template_or_process must remain template_or_process.";
const HINT_TEXT = "Research-only semantic hints: sourceRole and deterministicRole inform semanticRole but do not force it. Authority is evaluated separately and never changes. When sourceContext is present, use only its same-source exact ranges as interpretation aids; context never adds candidates or authority.";
const emptyTelemetry = (): RequirementRoleExperimentTelemetry => ({ latencyMs: null, httpStatus: null, observedModel: null, inputTokens: null, outputTokens: null, totalTokens: null });
const bytes = (value: unknown) => { try { const serialized = JSON.stringify(value); return typeof serialized === "string" ? Buffer.byteLength(serialized, "utf8") : Number.POSITIVE_INFINITY; } catch { return Number.POSITIVE_INFINITY; } };
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function decideRequirementRoleAuthority(role: GeneralPrClaimRoleV2, authority: GeneralPrSourceAuthorityV2, sourceRole: SourceRole) {
  if (role !== "objective_candidate") return "not_objective" as const;
  if (sourceRole === "context") return "blocked_context" as const;
  if (sourceRole === "policy_only") return "blocked_policy_only" as const;
  return authority === "authoritative" ? "eligible_authoritative" as const : "eligible_author_claim" as const;
}

export function validateResearchRoleOutput(value: unknown, expectedIds: readonly string[], knownIds: ReadonlySet<string>): { valid: true; roles: Map<string, GeneralPrClaimRoleV2> } | { valid: false; reason: ResearchInvalidReason } {
  if (!record(value)) return { valid: false, reason: "root_shape_invalid" };
  if (bytes(value) > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES) return { valid: false, reason: "output_size_exceeded" };
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["spanRoles", "unionMemberCandidates"] ) || !Array.isArray(value.spanRoles) || !Array.isArray(value.unionMemberCandidates)) return { valid: false, reason: "root_shape_invalid" };
  const expected = new Set(expectedIds);
  const found = new Map<string, GeneralPrClaimRoleV2>();
  for (const item of value.spanRoles) {
    if (!record(item) || Object.keys(item).sort().join(",") !== "role,spanId" || typeof item.spanId !== "string" || !roles.has(item.role as GeneralPrClaimRoleV2)) return { valid: false, reason: "span_decision_invalid" };
    if (found.has(item.spanId)) return { valid: false, reason: "duplicate_span_id" };
    if (!knownIds.has(item.spanId)) return { valid: false, reason: "unknown_span_id" };
    if (!expected.has(item.spanId)) return { valid: false, reason: "stale_span_id" };
    found.set(item.spanId, item.role as GeneralPrClaimRoleV2);
  }
  if (found.size !== expected.size) return { valid: false, reason: "missing_span_id" };
  if (value.unionMemberCandidates.length > 8) return { valid: false, reason: "union_candidate_invalid" };
  for (const item of value.unionMemberCandidates) {
    if (!record(item) || Object.keys(item).sort().join(",") !== "aliasName,member,spanId" || typeof item.spanId !== "string" || !expected.has(item.spanId) || found.get(item.spanId) !== "objective_candidate" || typeof item.aliasName !== "string" || item.aliasName.length > 200 || !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(item.aliasName) || typeof item.member !== "string" || !["string", "number", "boolean", "bigint", "symbol", "undefined", "null"].includes(item.member)) return { valid: false, reason: "union_candidate_invalid" };
  }
  return { valid: true, roles: found };
}

function sourceText(input: PullRequestInput, kind: GeneralPrSourceKindV2): string {
  if (kind === "pr_title") return input.title.replace(/\r\n/g, "\n");
  if (kind === "pr_body") return input.description.replace(/\r\n/g, "\n");
  return kind === (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") ? input.taskText.replace(/\r\n/g, "\n") : "";
}

function buildRegistry(input: PullRequestInput, seed: GeneralPrObservationSeedV2) {
  const views = buildGeneralPrRedactedSourceViewsV1(input, seed);
  const units: InternalUnit[] = [];
  for (const source of seed.sources) {
    const sourceRole: SourceRole = source.roleCeiling;
    const view = views?.get(source.id);
    if (view === undefined) {
      const length = sourceText(input, source.kind).length;
      units.push({ id: `gap_${hash(`${source.id}:0:${length}:unsupported`).slice(0, 24)}`, spanId: null, sourceUnitId: source.id, sourceKind: source.kind, sourceContentHash: source.sourceContentHash, structuralKind: "unsupported", start: 0, end: length, textHash: source.rawSourceDigest, authority: source.authority, sourceRole, sourceBindingAvailable: false, roleCeiling: source.roleCeiling, deterministicRole: "unreviewed", sectionKey: source.id, headingSpanIds: [] });
      continue;
    }
    const spans = seed.spans.filter(span => span.sourceUnitId === source.id);
    const structure = source.kind === "pr_title" ? null : parseGeneralPrStructureV1(view);
    const structuralByRange = new Map(structure?.spans.map(span => [`${span.start}:${span.end}`, span]) ?? []);
    let cursor = 0;
    const addGap = (start: number, end: number) => {
      const text = view.slice(start, end);
      if (end <= start || !/\S/.test(text)) return;
      units.push({ id: `gap_${hash(`${source.id}:${start}:${end}:${hash(text)}`).slice(0, 24)}`, spanId: null, sourceUnitId: source.id, sourceKind: source.kind, sourceContentHash: source.sourceContentHash, structuralKind: "gap", start, end, textHash: hash(text), authority: source.authority, sourceRole, sourceBindingAvailable: true, roleCeiling: source.roleCeiling, deterministicRole: "unreviewed", sectionKey: source.id, headingSpanIds: [] });
    };
    for (const span of spans) {
      addGap(cursor, span.start);
      const structural = structuralByRange.get(`${span.start}:${span.end}`);
      const headingSpanIds = (structural?.headingPath ?? []).flatMap(id => {
        const heading = structure?.spans.find(candidate => candidate.id === id);
        const seedHeading = heading && spans.find(candidate => candidate.start === heading.start && candidate.end === heading.end);
        return seedHeading ? [seedHeading.id] : [];
      });
      units.push({ id: span.id, spanId: span.id, sourceUnitId: source.id, sourceKind: source.kind, sourceContentHash: source.sourceContentHash, structuralKind: span.structuralKind, start: span.start, end: span.end, textHash: span.textHash, authority: source.authority, sourceRole, sourceBindingAvailable: true, roleCeiling: source.roleCeiling, deterministicRole: span.deterministicRole, sectionKey: `${source.id}:${headingSpanIds.join("/")}`, headingSpanIds });
      cursor = span.end;
    }
    addGap(cursor, view.length);
  }
  return { views, units };
}

function selectable(unit: InternalUnit): boolean {
  return unit.spanId !== null && unit.sourceBindingAvailable && unit.roleCeiling !== "policy_only" && unit.structuralKind !== "code" && unit.structuralKind !== "html";
}

function selectionFor(seed: GeneralPrObservationSeedV2, views: Map<string, string>, selected: InternalUnit[], total: number, inputByteBudget: number): GeneralPrSemanticClaimSelectionV1 {
  const selectedSpans = selected.map(unit => ({
    spanId: unit.spanId!, sourceUnitId: unit.sourceUnitId, authority: unit.authority,
    sourceRole: unit.sourceRole === "context" ? "context" as const : "objective" as const,
    structuralKind: unit.structuralKind, deterministicRole: unit.deterministicRole,
    text: views.get(unit.sourceUnitId)!.slice(unit.start, unit.end),
  }));
  const unsigned = { version: 1 as const, parentSeedHash: seed.seedHash, selectedSpanIds: selectedSpans.map(span => span.spanId), selectedSpans,
    coverage: (selected.length === total && inputByteBudget === 0 ? "complete" : "sampled") as "complete" | "sampled",
    omittedReasonCounts: { spanBudget: Math.max(0, total - selected.length), inputByteBudget } };
  return { ...unsigned, claimSelectionHash: computeGeneralPrSemanticClaimSelectionHashV1(unsigned) };
}

function researchSystem(baseline: string): string {
  if (baseline.includes(HINT_TEXT)) return baseline;
  if (!baseline.includes(HARD_CEILING_TEXT)) throw new Error("existing claim constraint text unavailable");
  return baseline.replace(HARD_CEILING_TEXT, HINT_TEXT);
}

function contextReference(unit: InternalUnit, views: Map<string, string>): ContextReference {
  return { sourceUnitId: unit.sourceUnitId, sourceKind: unit.sourceKind, start: unit.start, end: unit.end, textHash: unit.textHash,
    text: views.get(unit.sourceUnitId)!.slice(unit.start, unit.end), authority: unit.authority, sourceRole: unit.sourceRole };
}

function contextsFor(selected: InternalUnit[], registry: InternalUnit[], views: Map<string, string>, mode: "neighbors" | "section"): SourceContext[] {
  return selected.map(unit => {
    const sameSource = registry.filter(candidate => candidate.spanId && candidate.sourceUnitId === unit.sourceUnitId);
    const index = sameSource.findIndex(candidate => candidate.id === unit.id);
    const references = mode === "section"
      ? sameSource.filter(candidate => candidate.id !== unit.id && candidate.sectionKey === unit.sectionKey)
      : [...new Set([...unit.headingSpanIds, sameSource[index - 1]?.id, sameSource[index + 1]?.id].filter((id): id is string => Boolean(id)))].flatMap(id => sameSource.find(candidate => candidate.id === id) ?? []);
    return { candidateSpanId: unit.spanId!, sourceUnitId: unit.sourceUnitId, references: references.map(reference => contextReference(reference, views)) };
  });
}

function packetFor(baseline: ClaimPacket, seed: GeneralPrObservationSeedV2, views: Map<string, string>, registry: InternalUnit[], units: InternalUnit[], total: number, inputByteBudget: number, hardConstraints: boolean, contextMode?: "neighbors" | "section"): Plan {
  const selection = selectionFor(seed, views, units, total, inputByteBudget);
  const input: RequirementRoleExperimentPacket["input"] = {
    contractVersion: "general_pr_semantic_claim.v2", schemaVersion: "agentproof_general_pr_claim_observer_v2",
    seedHash: seed.seedHash, claimSelectionHash: selection.claimSelectionHash, coverage: selection.coverage,
    spans: selection.selectedSpans.map(span => ({ id: span.spanId, authority: span.authority, sourceRole: span.sourceRole, structuralKind: span.structuralKind, deterministicRole: span.deterministicRole, text: span.text })),
  };
  const contextOmittedUnitIds: string[] = [];
  if (contextMode) {
    input.sourceContext = [];
    for (const context of contextsFor(units, registry, views, contextMode)) {
      if (bytes({ ...input, sourceContext: [...input.sourceContext, context] }) <= MAX_INPUT_BYTES) input.sourceContext.push(context);
      else contextOmittedUnitIds.push(context.candidateSpanId);
    }
  }
  return {
    packet: { stage: "claim_discovery", system: hardConstraints ? baseline.system : researchSystem(baseline.system), input,
      request: { ...baseline.request, responseFormat: { ...baseline.request.responseFormat, schema: buildGeneralPrSemanticClaimJsonSchemaV1(selection) } } },
    selection, units, contextOmittedUnitIds, pass: contextMode === "section" ? "expanded" : "initial",
  };
}

function baseBatches(baseline: ClaimPacket, seed: GeneralPrObservationSeedV2, views: Map<string, string>, registry: InternalUnit[], candidates: InternalUnit[]) {
  const batches: InternalUnit[][] = [];
  const oversized = new Set<string>();
  let current: InternalUnit[] = [];
  for (const unit of candidates) {
    const trial = [...current, unit];
    if (trial.length <= MAX_SPANS && bytes(packetFor(baseline, seed, views, registry, trial, candidates.length, oversized.size, true).packet.input) <= MAX_INPUT_BYTES) {
      current = trial;
      continue;
    }
    if (current.length) batches.push(current);
    current = [];
    if (bytes(packetFor(baseline, seed, views, registry, [unit], candidates.length, oversized.size, true).packet.input) <= MAX_INPUT_BYTES) current = [unit];
    else oversized.add(unit.id);
  }
  if (current.length) batches.push(current);
  return { batches, oversized };
}

function initialReason(unit: InternalUnit, version: RequirementRoleExperimentVersion, selected: ReadonlySet<string>, oversized: ReadonlySet<string>, packageFailureReason: string | null, views: Map<string, string> | null): string {
  if (!unit.sourceBindingAvailable) return "source_binding_unavailable";
  if (unit.spanId === null) return "unsupported_source_region";
  if (unit.structuralKind === "code" || unit.structuralKind === "html" || unit.roleCeiling === "policy_only") return "product_policy_excluded";
  if (oversized.has(unit.id) || unit.spanId && views && Buffer.byteLength(views.get(unit.sourceUnitId)!.slice(unit.start, unit.end), "utf8") > MAX_INPUT_BYTES) return "input_byte_budget";
  if (packageFailureReason) return `packet_${packageFailureReason}`;
  if (version === "V0" && !selected.has(unit.id)) return "v0_not_selected";
  return selected.has(unit.id) ? "offline" : "unreviewed";
}

function ledgerFor(registry: InternalUnit[], version: RequirementRoleExperimentVersion, plans: Plan[], oversized: ReadonlySet<string>, packageFailureReason: string | null, views: Map<string, string> | null): LedgerEntry[] {
  const selected = new Set(plans.flatMap(plan => plan.units.map(unit => unit.id)));
  const contextIncluded = new Set(plans.flatMap(plan => (plan.packet.input.sourceContext ?? []).map(context => context.candidateSpanId)));
  const contextOmitted = new Set(plans.flatMap(plan => plan.contextOmittedUnitIds));
  return registry.map(unit => ({
    unitId: unit.id, selected: selected.has(unit.id), attempted: false, initialSemanticRole: null, semanticRole: null, validatedOutcome: null,
    authorityDecision: "unreviewed", researchSchema: { state: "not_run", reason: null }, productValidator: { state: "not_run", reason: null }, status: "unreviewed",
    reason: initialReason(unit, version, selected, oversized, packageFailureReason, views),
    contextState: contextIncluded.has(unit.id) ? "included" : contextOmitted.has(unit.id) ? "context_byte_budget" : version === "V3" || version === "V4" ? selectable(unit) ? "unavailable" : "not_used" : "not_used",
    expansionCount: 0,
    expansionReason: null,
  }));
}

function callRecord(caseId: string, version: RequirementRoleExperimentVersion, plan: Plan, index: number): CallRecord {
  return { id: `${caseId}:${version}:${plan.pass}:${index + 1}`, pass: plan.pass, unitIds: plan.units.map(unit => unit.id), inputBytes: bytes(plan.packet.input), inputHash: hash(plan.packet.input), promptHash: hash(plan.packet.system), requestHash: hash(plan.packet.request), contextOmittedUnitIds: [...plan.contextOmittedUnitIds], attempted: false, retryCount: 0, state: "not_run", reason: "offline", researchSchema: { state: "not_run", reason: null }, productValidator: { state: "not_run", reason: null }, telemetry: emptyTelemetry() };
}

async function prepareCase(item: AblationCase, modelProfile: GeneralPrSemanticObserverModelProfileV2): Promise<PreparedCase> {
  const prepared = await prepareAblationCase(item, modelProfile);
  const seed = prepared.seed;
  const { views, units: registry } = buildRegistry(item.input, seed);
  const state = (version: RequirementRoleExperimentVersion, constraintPolicy: PreparedCase["versions"][RequirementRoleExperimentVersion]["constraintPolicy"], outputValidationPolicy: PreparedCase["versions"][RequirementRoleExperimentVersion]["outputValidationPolicy"], contextPolicy: PreparedCase["versions"][RequirementRoleExperimentVersion]["contextPolicy"]): PreparedCase["versions"][RequirementRoleExperimentVersion] => ({ version, constraintPolicy, outputValidationPolicy, contextPolicy, plans: [], ledger: [], calls: [] });
  const states: PreparedCase["versions"] = {
    V0: state("V0", "existing_hard", "product_legacy", "none"),
    V1: state("V1", "existing_hard", "product_legacy", "none"),
    V2: state("V2", "semantic_hints_authority_hard", "research_strict_with_product_diagnostic", "none"),
    V3: state("V3", "semantic_hints_authority_hard", "research_strict_with_product_diagnostic", "structural_neighbors"),
    V4: state("V4", "semantic_hints_authority_hard", "research_strict_with_product_diagnostic", "ambiguous_same_section_once"),
  };
  const oversized = new Set<string>();
  if (prepared.baseline && prepared.selection && views) {
    const v0Units = prepared.selection.selectedSpanIds.flatMap(id => registry.find(unit => unit.id === id) ?? []);
    states.V0.plans = [{ packet: prepared.baseline, selection: prepared.selection, units: v0Units, contextOmittedUnitIds: [], pass: "initial" }];
    const candidates = registry.filter(selectable);
    const batched = baseBatches(prepared.baseline, seed, views, registry, candidates);
    for (const id of batched.oversized) oversized.add(id);
    states.V1.plans = batched.batches.map(batch => packetFor(prepared.baseline!, seed, views, registry, batch, candidates.length, oversized.size, true));
    states.V2.plans = batched.batches.map(batch => packetFor(prepared.baseline!, seed, views, registry, batch, candidates.length, oversized.size, false));
    states.V3.plans = batched.batches.map(batch => packetFor(prepared.baseline!, seed, views, registry, batch, candidates.length, oversized.size, false, "neighbors"));
    states.V4.plans = states.V3.plans.map(plan => ({ ...plan, packet: structuredClone(plan.packet), selection: structuredClone(plan.selection), units: [...plan.units], contextOmittedUnitIds: [...plan.contextOmittedUnitIds] }));
  }
  for (const version of versions) {
    const state = states[version];
    state.ledger = ledgerFor(registry, version, state.plans, oversized, prepared.baseline ? null : prepared.packageFailureReasons[0] ?? "package_unavailable", views);
    state.calls = state.plans.map((plan, index) => callRecord(item.id, version, plan, index));
  }
  return { item, seed, views, registry, versions: states };
}

/** Ephemeral V0 packets for sibling research tools; persist only the sanitized metadata they derive. */
export async function prepareRequirementRoleExperimentV0(value: unknown, modelProfile: GeneralPrSemanticObserverModelProfileV2) {
  validateAblationCorpus(value);
  if (!record(modelProfile) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(modelProfile.model) || typeof modelProfile.promptVersion !== "string" || typeof modelProfile.inputFieldPolicyVersion !== "string") throw new Error("invalid model profile");
  const prepared = await Promise.all(value.cases.map(item => prepareCase(item, modelProfile)));
  return prepared.map(item => ({
    caseId: item.item.id,
    cohort: item.item.cohort,
    inputHash: ablationHash(item.item.input),
    seedHash: item.seed.seedHash,
    registry: item.registry.map(({ roleCeiling: _roleCeiling, deterministicRole: _deterministicRole, sectionKey: _sectionKey, headingSpanIds: _headingSpanIds, ...unit }) => unit),
    plans: item.versions.V0.plans.map(plan => ({
      packet: structuredClone(plan.packet),
      unitIds: plan.units.map(unit => unit.id),
      inputHash: hash(plan.packet.input),
      promptHash: hash(plan.packet.system),
      requestHash: hash(plan.packet.request),
    })),
  }));
}

function sanitizeTelemetry(value: unknown): RequirementRoleExperimentTelemetry {
  const telemetry = record(value) ? value : {};
  const number = (key: string) => Number.isSafeInteger(telemetry[key]) && (telemetry[key] as number) >= 0 ? telemetry[key] as number : null;
  const status = number("httpStatus");
  return {
    latencyMs: number("latencyMs"),
    httpStatus: status !== null && status >= 100 && status <= 599 ? status : null,
    observedModel: typeof telemetry.observedModel === "string" && /^[A-Za-z0-9_.:-]{1,100}$/.test(telemetry.observedModel) ? telemetry.observedModel : null,
    inputTokens: number("inputTokens"),
    outputTokens: number("outputTokens"),
    totalTokens: number("totalTokens"),
  };
}

function providerValue(value: unknown) {
  if (!record(value) || !Object.hasOwn(value, "output")) return { output: value, telemetry: emptyTelemetry() };
  return { output: value.output, telemetry: sanitizeTelemetry(value.telemetry) };
}

function updateLedger(version: RequirementRoleExperimentVersion, prepared: PreparedCase, plan: Plan, call: CallRecord, output: unknown, expanded: boolean) {
  const knownIds = new Set(prepared.seed.spans.map(span => span.id));
  const research = validateResearchRoleOutput(output, plan.units.map(unit => unit.id), knownIds);
  let product: ReturnType<typeof validateGeneralPrSemanticClaimCandidateV2>;
  try { product = validateGeneralPrSemanticClaimCandidateV2(output, prepared.seed, plan.selection); }
  catch { product = { valid: false, invalidReason: "root_shape_invalid", errors: ["validator exception"] }; }
  call.researchSchema = research.valid ? { state: "valid", reason: null } : { state: "invalid", reason: research.reason };
  call.productValidator = product.valid ? { state: "valid", reason: null } : { state: "invalid", reason: product.invalidReason };
  const ledgers = prepared.versions[version].ledger;
  const productPolicy = version === "V0" || version === "V1";
  if (productPolicy ? !product.valid : !research.valid) {
    call.state = "invalid";
    call.reason = productPolicy ? `product_${product.valid ? "unknown" : product.invalidReason}` : research.valid ? "research_unknown" : research.reason;
    for (const unit of plan.units) {
      const entry = ledgers.find(candidate => candidate.unitId === unit.id)!;
      const role = research.valid ? research.roles.get(unit.id)! : null;
      if (role) { if (!expanded) entry.initialSemanticRole = role; entry.semanticRole = role; entry.authorityDecision = decideRequirementRoleAuthority(role, unit.authority, unit.sourceRole); }
      entry.attempted = true; entry.researchSchema = call.researchSchema; entry.productValidator = call.productValidator;
      if (expanded) { entry.expansionCount = 1; entry.expansionReason = call.reason; }
      else { entry.status = "invalid"; entry.reason = call.reason; }
    }
    return;
  }
  call.state = "valid";
  call.reason = research.valid ? "validated" : "validated_product_with_research_schema_diagnostic";
  const productRoles = product.valid ? new Map(product.spanRoles.map(role => [role.spanId, role.role])) : null;
  for (const unit of plan.units) {
    const entry = ledgers.find(candidate => candidate.unitId === unit.id)!;
    const role = productPolicy ? productRoles!.get(unit.id)! : research.valid ? research.roles.get(unit.id)! : null;
    if (!role) throw new Error("validated role unavailable");
    if (!expanded) entry.initialSemanticRole = role;
    entry.semanticRole = role;
    entry.validatedOutcome = role;
    entry.authorityDecision = decideRequirementRoleAuthority(role, unit.authority, unit.sourceRole);
    entry.researchSchema = call.researchSchema;
    entry.productValidator = call.productValidator;
    entry.attempted = true;
    entry.status = role === "mixed_or_ambiguous" ? "abstained" : "decided";
    entry.reason = role === "mixed_or_ambiguous" ? (expanded ? "ambiguous_after_expansion" : "ambiguous_initial") : "role_decided";
    if (expanded) { entry.expansionCount = 1; entry.expansionReason = entry.reason; }
  }
}

async function executePlan(prepared: PreparedCase, version: RequirementRoleExperimentVersion, plan: Plan, call: CallRecord, provider: RequirementRoleExperimentProvider, budget: { used: number; max: number }, signal?: AbortSignal) {
  const ledger = prepared.versions[version].ledger;
  if (signal?.aborted || budget.used >= budget.max) {
    call.reason = signal?.aborted ? "total_timeout" : "total_call_budget";
    for (const unit of plan.units) {
      const entry = ledger.find(candidate => candidate.unitId === unit.id)!;
      if (plan.pass === "expanded") entry.expansionReason = call.reason;
      else entry.reason = call.reason;
    }
    return;
  }
  budget.used++;
  call.attempted = true;
  for (const unit of plan.units) ledger.find(entry => entry.unitId === unit.id)!.attempted = true;
  try {
    const value = providerValue(await provider.observe({ callId: call.id, caseId: prepared.item.id, version, pass: plan.pass, requestHash: call.requestHash, packet: plan.packet, signal }));
    call.telemetry = value.telemetry;
    updateLedger(version, prepared, plan, call, value.output, plan.pass === "expanded");
  } catch (error) {
    call.state = "unavailable";
    call.reason = error instanceof RequirementRoleExperimentProviderError && /^provider_[a-z_]{1,80}$/.test(error.reason) ? error.reason : "provider_error";
    if (error instanceof RequirementRoleExperimentProviderError) call.telemetry = sanitizeTelemetry(error.telemetry);
    for (const unit of plan.units) {
      const entry = ledger.find(candidate => candidate.unitId === unit.id)!;
      if (plan.pass === "expanded") { entry.status = "abstained"; entry.expansionReason = call.reason; entry.expansionCount = 1; }
      else { entry.status = "unreviewed"; entry.reason = call.reason; }
    }
  }
}

function expansionPlans(prepared: PreparedCase) {
  if (!prepared.views) return [];
  const ambiguous = prepared.versions.V4.ledger.flatMap(entry => entry.status === "abstained" && entry.semanticRole === "mixed_or_ambiguous" ? prepared.registry.find(unit => unit.id === entry.unitId) ?? [] : []);
  const initial = prepared.versions.V4.plans[0];
  if (!initial || ambiguous.length === 0) return [];
  const plans: Plan[] = [];
  const initialReferences = new Map(prepared.versions.V4.plans.flatMap(plan => (plan.packet.input.sourceContext ?? []).map(context => [context.candidateSpanId, new Set(context.references.map(reference => `${reference.sourceUnitId}:${reference.start}:${reference.end}`))] as const)));
  for (const unit of ambiguous) {
    const plan = packetFor(initial.packet, prepared.seed, prepared.views, prepared.registry, [unit], ambiguous.length, 0, false, "section");
    const context = plan.packet.input.sourceContext?.find(candidate => candidate.candidateSpanId === unit.id);
    const prior = initialReferences.get(unit.id) ?? new Set<string>();
    if (context?.references.some(reference => !prior.has(`${reference.sourceUnitId}:${reference.start}:${reference.end}`)) && bytes(plan.packet.input) <= MAX_INPUT_BYTES) plans.push(plan);
    else prepared.versions.V4.ledger.find(entry => entry.unitId === unit.id)!.expansionReason = plan.contextOmittedUnitIds.length ? "context_byte_budget" : "context_unavailable";
  }
  return plans;
}

function metrics(ledger: LedgerEntry[], calls: CallRecord[]) {
  const count = (predicate: (entry: LedgerEntry) => boolean) => ledger.filter(predicate).length;
  const fraction = (numerator: number) => ({ numerator, denominator: ledger.length, rate: ledger.length ? numerator / ledger.length : null });
  return { selected: fraction(count(entry => entry.selected)), attempted: fraction(count(entry => entry.attempted)), decided: fraction(count(entry => entry.status === "decided")), abstained: fraction(count(entry => entry.status === "abstained")), unreviewed: fraction(count(entry => entry.status === "unreviewed")), invalid: fraction(count(entry => entry.status === "invalid")), productValidatorFailures: calls.filter(call => call.productValidator.state === "invalid").length };
}

function comparisons(states: PreparedCase["versions"]) {
  const pairs = [["V0", "V1"], ["V1", "V2"], ["V2", "V3"], ["V3", "V4"]] as const;
  return Object.fromEntries(pairs.map(([left, right]) => {
    const rightById = new Map(states[right].ledger.map(entry => [entry.unitId, entry]));
    let selectionChanged = 0; let statusChanged = 0; let semanticRoleChanged = 0;
    for (const entry of states[left].ledger) {
      const other = rightById.get(entry.unitId)!;
      if (entry.selected !== other.selected) selectionChanged++;
      if (entry.status !== other.status) statusChanged++;
      if (entry.semanticRole !== other.semanticRole) semanticRoleChanged++;
    }
    return [`${left}_to_${right}`, { units: states[left].ledger.length, selectionChanged, statusChanged, semanticRoleChanged }];
  }));
}

function comparisonCompletion(prepared: PreparedCase[], providerConfigured: boolean, timedOut: boolean) {
  const caseVersions = prepared.flatMap(item => versions.map(version => {
    const calls = item.versions[version].calls;
    const attemptedCalls = calls.filter(call => call.attempted).length;
    const validCalls = calls.filter(call => call.state === "valid").length;
    const invalidCalls = calls.filter(call => call.state === "invalid").length;
    const unavailableCalls = calls.filter(call => call.state === "unavailable").length;
    const unexecutedCalls = calls.length - attemptedCalls;
    const unexecutedReasons = Object.fromEntries([...new Set(calls.filter(call => !call.attempted).map(call => call.reason))].sort().map(reason => [reason, calls.filter(call => !call.attempted && call.reason === reason).length]));
    const status = calls.length === 0
      ? "not_planned"
      : attemptedCalls === 0
        ? "not_run"
        : unexecutedCalls > 0
          ? "partial"
          : invalidCalls + unavailableCalls > 0
            ? "complete_with_failures"
            : "complete";
    return { caseId: item.item.id, version, status, plannedCalls: calls.length, attemptedCalls, validCalls, invalidCalls, unavailableCalls, unexecutedCalls, unexecutedReasons };
  }));
  const totals = caseVersions.reduce((sum, row) => ({
    plannedCalls: sum.plannedCalls + row.plannedCalls,
    attemptedCalls: sum.attemptedCalls + row.attemptedCalls,
    validCalls: sum.validCalls + row.validCalls,
    invalidCalls: sum.invalidCalls + row.invalidCalls,
    unavailableCalls: sum.unavailableCalls + row.unavailableCalls,
    unexecutedCalls: sum.unexecutedCalls + row.unexecutedCalls,
  }), { plannedCalls: 0, attemptedCalls: 0, validCalls: 0, invalidCalls: 0, unavailableCalls: 0, unexecutedCalls: 0 });
  const plannedInitialCalls = prepared.flatMap(item => versions.flatMap(version => item.versions[version].calls)).filter(call => call.pass === "initial").length;
  const plannedExpansionCalls = totals.plannedCalls - plannedInitialCalls;
  const status = !providerConfigured
    ? "offline_not_run"
    : totals.plannedCalls === 0
      ? "not_planned"
      : totals.unexecutedCalls > 0
        ? timedOut ? "partial_timeout" : "partial_not_run"
        : totals.invalidCalls + totals.unavailableCalls > 0
          ? "complete_with_failures"
          : "complete";
  return { status, ...totals, plannedInitialCalls, plannedExpansionCalls, caseVersions };
}

export async function runRequirementRoleExperiment(value: unknown, options: RequirementRoleExperimentOptions) {
  validateAblationCorpus(value);
  const corpus = value as AblationCorpus;
  if (!record(options.modelProfile) || !/^[A-Za-z0-9_.:-]{1,100}$/.test(options.modelProfile.model) || typeof options.modelProfile.promptVersion !== "string" || typeof options.modelProfile.inputFieldPolicyVersion !== "string") throw new Error("invalid model profile");
  const maxCalls = options.maxCalls ?? MAX_CALLS;
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0 || maxCalls > MAX_CALLS) throw new Error("invalid total call budget");
  const totalTimeoutMs = options.totalTimeoutMs ?? null;
  if (totalTimeoutMs !== null && (!Number.isSafeInteger(totalTimeoutMs) || totalTimeoutMs < 1 || totalTimeoutMs > REQUIREMENT_ROLE_EXPERIMENT_TOTAL_TIMEOUT_MS)) throw new Error("invalid total timeout");
  const controller = totalTimeoutMs === null ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), totalTimeoutMs!) : null;
  try {
    const prepared = await Promise.all(corpus.cases.map(item => prepareCase(item, options.modelProfile)));
    const budget = { used: 0, max: maxCalls };
    if (options.provider) {
      for (const item of prepared) {
        for (const version of versions) {
          const state = item.versions[version];
          for (let index = 0; index < state.plans.length; index++) await executePlan(item, version, state.plans[index]!, state.calls[index]!, options.provider, budget, controller?.signal);
        }
      }
      for (const item of prepared) {
        const state = item.versions.V4;
        for (const plan of expansionPlans(item)) {
          state.plans.push(plan);
          const call = callRecord(item.item.id, "V4", plan, state.calls.length);
          state.calls.push(call);
          await executePlan(item, "V4", plan, call, options.provider, budget, controller?.signal);
        }
      }
    }
    return {
      schemaVersion: "requirement_role_experiment.v1",
      shadowOnly: true,
      offline: !options.provider,
      corpusHash: ablationHash(corpus),
      modelProfileHash: ablationHash(options.modelProfile),
      configuredModel: options.modelProfile.model,
      actualCallCount: budget.used,
      maxCallCount: maxCalls,
      totalTimeoutMs,
      timedOut: controller?.signal.aborted ?? false,
      comparisonCompletion: comparisonCompletion(prepared, Boolean(options.provider), controller?.signal.aborted ?? false),
      limits: { maxSpansPerPacket: MAX_SPANS, maxInputBytesPerPacket: MAX_INPUT_BYTES, retries: 0 },
      cases: prepared.map(item => ({
      id: item.item.id,
      seedHash: item.seed.seedHash,
      registryHash: hash(item.registry.map(({ roleCeiling: _roleCeiling, deterministicRole: _deterministicRole, sectionKey: _sectionKey, headingSpanIds: _headingSpanIds, ...unit }) => unit)),
      registry: item.registry.map(({ roleCeiling: _roleCeiling, deterministicRole: _deterministicRole, sectionKey: _sectionKey, headingSpanIds: _headingSpanIds, ...unit }) => unit),
      versions: Object.fromEntries(versions.map(version => {
        const state = item.versions[version];
        return [version, { version, constraintPolicy: state.constraintPolicy, outputValidationPolicy: state.outputValidationPolicy, contextPolicy: state.contextPolicy, ledger: state.ledger, calls: state.calls, metrics: metrics(state.ledger, state.calls) }];
      })) as Record<RequirementRoleExperimentVersion, { version: RequirementRoleExperimentVersion; constraintPolicy: PreparedCase["versions"][RequirementRoleExperimentVersion]["constraintPolicy"]; outputValidationPolicy: PreparedCase["versions"][RequirementRoleExperimentVersion]["outputValidationPolicy"]; contextPolicy: PreparedCase["versions"][RequirementRoleExperimentVersion]["contextPolicy"]; ledger: LedgerEntry[]; calls: CallRecord[]; metrics: ReturnType<typeof metrics> }>,
      pairedChanges: comparisons(item.versions),
      })),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
