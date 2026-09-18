import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { GeneralPrClaimRoleV2, GeneralPrSourceKindV2 } from "../src/lib/general-pr-observation-source";
import type { GeneralPrSemanticObserverModelProfileV2 } from "../src/lib/general-pr-semantic-observer";
import type { PullRequestInput } from "../src/lib/types";
import { ablationHash, validateAblationCorpus, type AblationCorpus } from "./requirement-source-ablation";
import {
  prepareRequirementRoleExperimentV0,
  validateResearchRoleOutput,
  type RequirementRoleExperimentPacket,
  type RequirementRoleExperimentRegistryUnit,
} from "./requirement-role-experiment";

const roles = ["objective_candidate", "problem_observation", "implementation_claim", "test_claim", "scope_exclusion", "known_limitation", "risk_or_revert", "follow_up", "template_or_process", "supporting_context", "mixed_or_ambiguous"] as const satisfies readonly GeneralPrClaimRoleV2[];
const roleSet = new Set<GeneralPrClaimRoleV2>(roles);
const targetAxis = ["yes", "no", "unresolved"] as const;
const targetSet = new Set<string>(targetAxis);
const arms = ["legacy_v0", "separated_v1"] as const;
const MAX_CALLS = 30;
const MAX_OUTPUT_BYTES = 64_000;
const identifier = /^[A-Za-z0-9_.:-]{1,100}$/;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const textHash = (value: string) => createHash("sha256").update(value).digest("hex");
const bytes = (value: unknown) => { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; } };
const sourceText = (input: PullRequestInput, kind: GeneralPrSourceKindV2) => kind === "pr_title" ? input.title : kind === "pr_body" ? input.description : kind === (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") ? input.taskText : "";

export type RequirementRoleObjectiveArm = typeof arms[number];
export type RequirementRoleTargetPresence = typeof targetAxis[number];
type LedgerStatus = "decided" | "abstained" | "unreviewed" | "invalid";

export interface RequirementRoleObjectiveProviderRequest {
  callId: string;
  caseId: string;
  arm: RequirementRoleObjectiveArm;
  packet: RequirementRoleExperimentPacket;
}

export interface RequirementRoleObjectiveProvider {
  observe(request: RequirementRoleObjectiveProviderRequest): Promise<unknown>;
}

export interface RequirementRoleObjectiveUnitRef {
  caseId: string;
  unitId: string;
  sourceUnitId: string;
  sourceKind: GeneralPrSourceKindV2;
  start: number;
  end: number;
  textHash: string;
}

export interface RequirementRoleObjectiveJudgment {
  objectivePresence: RequirementRoleTargetPresence;
  semanticRole: GeneralPrClaimRoleV2;
  subspans: Array<{ sourceUnitId: string; sourceKind: GeneralPrSourceKindV2; start: number; end: number; textHash: string }>;
  goalIds: string[];
  contextUnitIds: string[];
}

interface ReviewCase {
  caseId: string;
  goalDefinitions: Array<{ goalId: string }>;
  decisions: Array<{ ref: RequirementRoleObjectiveUnitRef; judgment: RequirementRoleObjectiveJudgment | null }>;
}

export interface RequirementRoleObjectiveReviewTemplate {
  schemaVersion: "requirement_role_objective_review.v1";
  contract: ReturnType<typeof contractFor>["contract"];
  contractHash: string;
  templateHash: string;
  labelProvenance: null | { kind: string; description: string; humanIdentityVerified: false };
  annotators: Array<{ slotId: "annotator_1" | "annotator_2"; humanIdentityVerified: false; cases: ReviewCase[] }>;
  adjudication: { humanIdentityVerified: false; cases: ReviewCase[] };
}

const rubric = {
  objectivePresence: {
    yes: "This exact unit explicitly states a target behavior or deliverable for the current PR.",
    no: "This exact unit does not explicitly state a target behavior or deliverable for the current PR.",
    unresolved: "The exact unit does not support a reliable yes/no target judgment without human resolution.",
  },
  semanticRoleAxis: roles,
  independence: "Objective presence and semantic role are independent: a current-PR target may also be an implementation_claim.",
  nonImplications: "Target presence does not imply an executable criterion, implementation proof, test proof, support, or fulfillment.",
  authority: "Source authority is immutable input metadata and is never a model decision.",
} as const;

type Prepared = Awaited<ReturnType<typeof prepareRequirementRoleExperimentV0>>;

function refFor(caseId: string, unit: RequirementRoleExperimentRegistryUnit): RequirementRoleObjectiveUnitRef {
  return { caseId, unitId: unit.id, sourceUnitId: unit.sourceUnitId, sourceKind: unit.sourceKind, start: unit.start, end: unit.end, textHash: unit.textHash };
}

function contractFor(corpus: AblationCorpus, prepared: Prepared) {
  const cases = prepared.map(item => {
    const selected = new Set(item.plans.flatMap(plan => plan.unitIds));
    return { caseId: item.caseId, inputHash: item.inputHash, seedHash: item.seedHash, units: item.registry.map(unit => ({ ...refFor(item.caseId, unit), authority: unit.authority, sourceRole: unit.sourceRole, sourceBindingAvailable: unit.sourceBindingAvailable, comparisonEligible: selected.has(unit.id) })) };
  });
  const sourceInputHash = ablationHash({ schemaVersion: "requirement_role_objective_input.v1", cases: corpus.cases.map(item => ({ id: item.id, cohort: item.cohort, input: item.input })) });
  const rubricHash = ablationHash(rubric);
  const boundaryHash = ablationHash(cases);
  const contract = {
    schemaVersion: "requirement_role_objective_contract.v1" as const,
    sourceInputHash,
    rubricHash,
    boundaryHash,
    inputLabelsUsed: false,
    targetAxis: [...targetAxis],
    semanticRoleAxis: [...roles],
    denominatorPolicy: "fixed_v0_selected_source_units" as const,
    matchingPolicy: "exact_case_source_unit_and_range_hash" as const,
    labelProvenancePolicy: "explicit_import_only_no_identity_verification" as const,
    rubric,
    cases,
  };
  return { contract, contractHash: ablationHash(contract) };
}

async function build(corpusValue: unknown, modelProfile: GeneralPrSemanticObserverModelProfileV2) {
  validateAblationCorpus(corpusValue);
  const corpus = corpusValue as AblationCorpus;
  const prepared = await prepareRequirementRoleExperimentV0(corpus, modelProfile);
  const { contract, contractHash } = contractFor(corpus, prepared);
  const reviewCases = contract.cases.map(item => ({ caseId: item.caseId, goalDefinitions: [], decisions: item.units.map(unit => ({ ref: { caseId: unit.caseId, unitId: unit.unitId, sourceUnitId: unit.sourceUnitId, sourceKind: unit.sourceKind, start: unit.start, end: unit.end, textHash: unit.textHash }, judgment: null })) }));
  const templateHash = ablationHash({ schemaVersion: "requirement_role_objective_review_template.v1", contractHash, cases: reviewCases.map(item => ({ caseId: item.caseId, refs: item.decisions.map(decision => decision.ref) })) });
  const template: RequirementRoleObjectiveReviewTemplate = {
    schemaVersion: "requirement_role_objective_review.v1",
    contract,
    contractHash,
    templateHash,
    labelProvenance: null,
    annotators: [
      { slotId: "annotator_1", humanIdentityVerified: false, cases: structuredClone(reviewCases) },
      { slotId: "annotator_2", humanIdentityVerified: false, cases: structuredClone(reviewCases) },
    ],
    adjudication: { humanIdentityVerified: false, cases: structuredClone(reviewCases) },
  };
  return { corpus, prepared, template };
}

export async function exportRequirementRoleObjectiveReviewTemplate(corpus: unknown, options: { modelProfile: GeneralPrSemanticObserverModelProfileV2 }) {
  return (await build(corpus, options.modelProfile)).template;
}

export function validateSeparatedObjectiveOutput(value: unknown, expectedIds: readonly string[], knownIds: ReadonlySet<string>): { valid: true; decisions: Map<string, { semanticRole: GeneralPrClaimRoleV2; objectivePresence: RequirementRoleTargetPresence }> } | { valid: false; reason: string } {
  if (!record(value) || !keysAre(value, ["spanDecisions"]) || !Array.isArray(value.spanDecisions)) return { valid: false, reason: "root_shape_invalid" };
  if (bytes(value) > MAX_OUTPUT_BYTES) return { valid: false, reason: "output_size_exceeded" };
  const expected = new Set(expectedIds);
  const decisions = new Map<string, { semanticRole: GeneralPrClaimRoleV2; objectivePresence: RequirementRoleTargetPresence }>();
  for (const item of value.spanDecisions) {
    if (!record(item) || !keysAre(item, ["spanId", "semanticRole", "objectivePresence"]) || typeof item.spanId !== "string" || !roleSet.has(item.semanticRole as GeneralPrClaimRoleV2) || !targetSet.has(String(item.objectivePresence))) return { valid: false, reason: "span_decision_invalid" };
    if (decisions.has(item.spanId)) return { valid: false, reason: "duplicate_span_id" };
    if (!knownIds.has(item.spanId)) return { valid: false, reason: "unknown_span_id" };
    if (!expected.has(item.spanId)) return { valid: false, reason: "stale_span_id" };
    decisions.set(item.spanId, { semanticRole: item.semanticRole as GeneralPrClaimRoleV2, objectivePresence: item.objectivePresence as RequirementRoleTargetPresence });
  }
  return decisions.size === expected.size ? { valid: true, decisions } : { valid: false, reason: "missing_span_id" };
}

function reviewCases(value: unknown, expected: RequirementRoleObjectiveReviewTemplate, corpus: AblationCorpus): { valid: true; cases: ReviewCase[] } | { valid: false; reason: string } {
  if (!Array.isArray(value) || value.length !== expected.contract.cases.length) return { valid: false, reason: "missing_unit" };
  const seenCases = new Set<string>();
  for (const item of value) {
    if (!record(item) || !keysAre(item, ["caseId", "goalDefinitions", "decisions"]) || typeof item.caseId !== "string" || seenCases.has(item.caseId) || !Array.isArray(item.goalDefinitions) || !Array.isArray(item.decisions)) return { valid: false, reason: "root_shape_invalid" };
    seenCases.add(item.caseId);
    const expectedCase = expected.contract.cases.find(candidate => candidate.caseId === item.caseId);
    const sourceCase = corpus.cases.find(candidate => candidate.id === item.caseId);
    if (!expectedCase || !sourceCase) return { valid: false, reason: "unknown_unit" };
    const goals = new Set<string>();
    for (const goal of item.goalDefinitions) {
      if (!record(goal) || !keysAre(goal, ["goalId"]) || typeof goal.goalId !== "string" || !identifier.test(goal.goalId) || goals.has(goal.goalId)) return { valid: false, reason: "goal_link_invalid" };
      goals.add(goal.goalId);
    }
    if (item.decisions.length !== expectedCase.units.length) return { valid: false, reason: "missing_unit" };
    const seenUnits = new Set<string>();
    for (const decision of item.decisions) {
      if (!record(decision) || !keysAre(decision, ["ref", "judgment"]) || !record(decision.ref)) return { valid: false, reason: "root_shape_invalid" };
      const ref = decision.ref;
      const unitId = ref.unitId;
      if (typeof unitId !== "string") return { valid: false, reason: "root_shape_invalid" };
      if (seenUnits.has(unitId)) return { valid: false, reason: "duplicate_unit" };
      seenUnits.add(unitId);
      const expectedUnit = expectedCase.units.find(unit => unit.unitId === unitId);
      if (!expectedUnit) return { valid: false, reason: "unknown_unit" };
      const expectedRef = { caseId: expectedUnit.caseId, unitId: expectedUnit.unitId, sourceUnitId: expectedUnit.sourceUnitId, sourceKind: expectedUnit.sourceKind, start: expectedUnit.start, end: expectedUnit.end, textHash: expectedUnit.textHash };
      if (JSON.stringify(ref) !== JSON.stringify(expectedRef)) return { valid: false, reason: "source_binding_mismatch" };
      if (decision.judgment === null) continue;
      if (!record(decision.judgment) || !keysAre(decision.judgment, ["objectivePresence", "semanticRole", "subspans", "goalIds", "contextUnitIds"]) || !targetSet.has(String(decision.judgment.objectivePresence)) || !roleSet.has(decision.judgment.semanticRole as GeneralPrClaimRoleV2) || !Array.isArray(decision.judgment.subspans) || !Array.isArray(decision.judgment.goalIds) || !Array.isArray(decision.judgment.contextUnitIds)) return { valid: false, reason: "judgment_invalid" };
      if (new Set(decision.judgment.goalIds).size !== decision.judgment.goalIds.length || decision.judgment.goalIds.some(goalId => typeof goalId !== "string" || !goals.has(goalId))) return { valid: false, reason: "goal_link_invalid" };
      if (new Set(decision.judgment.contextUnitIds).size !== decision.judgment.contextUnitIds.length || decision.judgment.contextUnitIds.some(unitId => typeof unitId !== "string" || !expectedCase.units.some(unit => unit.unitId === unitId))) return { valid: false, reason: "context_link_invalid" };
      for (const subspan of decision.judgment.subspans) {
        if (!record(subspan) || !keysAre(subspan, ["sourceUnitId", "sourceKind", "start", "end", "textHash"]) || subspan.sourceUnitId !== expectedUnit.sourceUnitId || subspan.sourceKind !== expectedUnit.sourceKind || !Number.isSafeInteger(subspan.start) || !Number.isSafeInteger(subspan.end) || (subspan.start as number) < expectedUnit.start || (subspan.end as number) > expectedUnit.end || (subspan.end as number) <= (subspan.start as number)) return { valid: false, reason: "subspan_invalid" };
        const text = sourceText(sourceCase.input, expectedUnit.sourceKind).slice(subspan.start as number, subspan.end as number);
        if (subspan.textHash !== textHash(text)) return { valid: false, reason: "subspan_invalid" };
      }
    }
  }
  return { valid: true, cases: value as unknown as ReviewCase[] };
}

function validateReviewAgainstBuild(value: unknown, built: Awaited<ReturnType<typeof build>>) {
  if (!record(value) || value.schemaVersion !== "requirement_role_objective_review.v1" || value.contractHash !== built.template.contractHash) return { valid: false as const, reason: "contract_hash_mismatch" };
  if (value.templateHash !== built.template.templateHash || JSON.stringify(value.contract) !== JSON.stringify(built.template.contract)) return { valid: false as const, reason: "template_hash_mismatch" };
  if (value.labelProvenance !== null && (!record(value.labelProvenance) || !keysAre(value.labelProvenance, ["kind", "description", "humanIdentityVerified"]) || typeof value.labelProvenance.kind !== "string" || !identifier.test(value.labelProvenance.kind) || typeof value.labelProvenance.description !== "string" || !value.labelProvenance.description.trim() || value.labelProvenance.description.length > 1_000 || value.labelProvenance.humanIdentityVerified !== false)) return { valid: false as const, reason: "label_provenance_invalid" };
  if (!Array.isArray(value.annotators) || value.annotators.length !== 2 || !record(value.adjudication) || value.adjudication.humanIdentityVerified !== false) return { valid: false as const, reason: "root_shape_invalid" };
  const slots = new Map<string, ReviewCase[]>();
  for (const slot of value.annotators) {
    if (!record(slot) || !keysAre(slot, ["slotId", "humanIdentityVerified", "cases"]) || !["annotator_1", "annotator_2"].includes(String(slot.slotId)) || slots.has(String(slot.slotId)) || slot.humanIdentityVerified !== false) return { valid: false as const, reason: "root_shape_invalid" };
    const validation = reviewCases(slot.cases, built.template, built.corpus);
    if (!validation.valid) return validation;
    slots.set(String(slot.slotId), validation.cases);
  }
  if (slots.size !== 2) return { valid: false as const, reason: "root_shape_invalid" };
  const adjudication = reviewCases(value.adjudication.cases, built.template, built.corpus);
  if (!adjudication.valid) return adjudication;
  const summary = { pending: 0, agreement: 0, disagreement: 0, unresolved: 0, adjudicated: 0 };
  const adjudicatedLabels: Array<{ caseId: string; unitId: string; judgment: RequirementRoleObjectiveJudgment }> = [];
  for (const item of built.template.contract.cases) {
    const first = slots.get("annotator_1")!.find(candidate => candidate.caseId === item.caseId)!;
    const second = slots.get("annotator_2")!.find(candidate => candidate.caseId === item.caseId)!;
    const final = adjudication.cases.find(candidate => candidate.caseId === item.caseId)!;
    for (const unit of item.units) {
      const a = first.decisions.find(decision => decision.ref.unitId === unit.unitId)!.judgment;
      const b = second.decisions.find(decision => decision.ref.unitId === unit.unitId)!.judgment;
      const settled = final.decisions.find(decision => decision.ref.unitId === unit.unitId)!.judgment;
      if (settled) { summary.adjudicated++; adjudicatedLabels.push({ caseId: item.caseId, unitId: unit.unitId, judgment: settled }); }
      else if (!a || !b) summary.pending++;
      else if (JSON.stringify(a) !== JSON.stringify(b)) summary.disagreement++;
      else if (a.objectivePresence === "unresolved" || a.semanticRole === "mixed_or_ambiguous") summary.unresolved++;
      else summary.agreement++;
    }
  }
  return { valid: true as const, summary, adjudicatedLabels, labelProvenance: value.labelProvenance as RequirementRoleObjectiveReviewTemplate["labelProvenance"] };
}

export async function validateRequirementRoleObjectiveReview(value: unknown, corpus: unknown, options: { modelProfile: GeneralPrSemanticObserverModelProfileV2 }) {
  return validateReviewAgainstBuild(value, await build(corpus, options.modelProfile));
}

function separatedPacket(packet: RequirementRoleExperimentPacket) {
  const copy = structuredClone(packet);
  copy.system = `${copy.system} Independently classify each exact span on two axes. semanticRole uses the existing role rubric. objectivePresence is yes only for an explicit target behavior or deliverable of the current PR, no when absent, and unresolved when the unit cannot support a reliable yes/no judgment. A target may coexist with implementation_claim. Never output or change source authority.`;
  copy.request.responseFormat.schema = {
    type: "object",
    additionalProperties: false,
    required: ["spanDecisions"],
    properties: {
      spanDecisions: {
        type: "array",
        minItems: copy.input.spans.length,
        maxItems: copy.input.spans.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["spanId", "semanticRole", "objectivePresence"],
          properties: {
            spanId: { type: "string", enum: copy.input.spans.map(span => span.id) },
            semanticRole: { type: "string", enum: [...roles] },
            objectivePresence: { type: "string", enum: [...targetAxis] },
          },
        },
      },
    },
  };
  return copy;
}

function fraction(numerator: number, denominator: number) { return { numerator, denominator, rate: denominator ? numerator / denominator : null }; }

function ledgerMetrics(ledger: Array<{ selected: boolean; status: LedgerStatus }>) {
  return {
    selected: fraction(ledger.filter(entry => entry.selected).length, ledger.length),
    decided: fraction(ledger.filter(entry => entry.status === "decided").length, ledger.length),
    abstained: fraction(ledger.filter(entry => entry.status === "abstained").length, ledger.length),
    unreviewed: fraction(ledger.filter(entry => entry.status === "unreviewed").length, ledger.length),
    invalid: fraction(ledger.filter(entry => entry.status === "invalid").length, ledger.length),
  };
}

function scoreEvaluation(cases: Array<{ id: string; arms: Record<RequirementRoleObjectiveArm, { ledger: Array<{ unitId: string; selected: boolean; semanticRole: GeneralPrClaimRoleV2 | null; objectivePresence: RequirementRoleTargetPresence | null; status: LedgerStatus }> }> }>, review: ReturnType<typeof validateReviewAgainstBuild> | null) {
  const notEvaluated = (reason: string) => ({ status: "not_evaluated" as const, reason, denominator: 0, denominatorPolicy: "fixed_v0_selected_source_units" as const, labelProvenanceHash: null, labelSetHash: null, reviewSummary: review?.valid ? review.summary : null, arms: null, unavailable: { goalLevelRecall: null, subspanFidelity: null, generalization: null } });
  if (!review?.valid || !review.labelProvenance) return notEvaluated("adjudicated_labels_not_supplied");
  const eligible = cases.flatMap(item => item.arms.legacy_v0.ledger.filter(entry => entry.selected).map(entry => ({ caseId: item.id, unitId: entry.unitId })));
  if (eligible.length === 0) return notEvaluated("empty_denominator");
  const labels = new Map(review.adjudicatedLabels.map(label => [`${label.caseId}:${label.unitId}`, label.judgment]));
  if (eligible.some(unit => !labels.has(`${unit.caseId}:${unit.unitId}`))) return notEvaluated("adjudicated_labels_incomplete");
  const scoredArms = Object.fromEntries(arms.map(arm => {
    const targetPredictions = [...targetAxis, "unreviewed"] as const;
    const targetConfusion = Object.fromEntries(targetAxis.map(gold => [gold, Object.fromEntries(targetPredictions.map(prediction => [prediction, 0]))])) as Record<RequirementRoleTargetPresence, Record<typeof targetPredictions[number], number>>;
    const rolePredictions = [...roles, "unreviewed"] as const;
    const roleConfusion = Object.fromEntries(roles.map(gold => [gold, Object.fromEntries(rolePredictions.map(prediction => [prediction, 0]))])) as Record<GeneralPrClaimRoleV2, Record<typeof rolePredictions[number], number>>;
    const byCase = cases.map(item => {
      let denominator = 0; let correct = 0; let unresolvedGold = 0; let unreviewedPredictions = 0;
      for (const entry of item.arms[arm].ledger.filter(entry => entry.selected)) {
        const gold = labels.get(`${item.id}:${entry.unitId}`)!;
        const targetPrediction = entry.objectivePresence ?? "unreviewed";
        const rolePrediction = entry.semanticRole ?? "unreviewed";
        targetConfusion[gold.objectivePresence][targetPrediction]++;
        roleConfusion[gold.semanticRole][rolePrediction]++;
        denominator++; if (targetPrediction === gold.objectivePresence) correct++; if (gold.objectivePresence === "unresolved") unresolvedGold++; if (targetPrediction === "unreviewed") unreviewedPredictions++;
      }
      return { caseId: item.id, denominator, correct, accuracy: denominator ? correct / denominator : null, unresolvedGold, unreviewedPredictions };
    });
    const denominator = byCase.reduce((sum, item) => sum + item.denominator, 0);
    const targetCorrect = byCase.reduce((sum, item) => sum + item.correct, 0);
    const roleCorrect = roles.reduce((sum, role) => sum + roleConfusion[role][role], 0);
    const allRolesRepresented = roles.every(role => rolePredictions.reduce((sum, prediction) => sum + roleConfusion[role][prediction], 0) > 0);
    const perRole = Object.fromEntries(roles.map(role => {
      const tp = roleConfusion[role][role];
      const fp = roles.reduce((sum, gold) => sum + (gold === role ? 0 : roleConfusion[gold][role]), 0);
      const fn = rolePredictions.reduce((sum, prediction) => sum + (prediction === role ? 0 : roleConfusion[role][prediction]), 0);
      return [role, { support: rolePredictions.reduce((sum, prediction) => sum + roleConfusion[role][prediction], 0), precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, f1: 2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : null }];
    }));
    const macroF1 = allRolesRepresented ? { status: "evaluated" as const, value: roles.reduce((sum, role) => sum + (perRole[role].f1 ?? 0), 0) / roles.length, reason: null } : { status: "not_evaluated" as const, value: null, reason: "all_11_roles_not_represented" as const };
    return [arm, { target: { confusion: targetConfusion, denominator, correct: targetCorrect, accuracy: denominator ? targetCorrect / denominator : null, unresolvedGold: byCase.reduce((sum, item) => sum + item.unresolvedGold, 0), unreviewedPredictions: byCase.reduce((sum, item) => sum + item.unreviewedPredictions, 0), byCase }, semanticRole: { confusion: roleConfusion, exactMatch: { denominator, correct: roleCorrect, accuracy: denominator ? roleCorrect / denominator : null }, perRole, macroF1 } }];
  }));
  return { status: "evaluated" as const, reason: null, denominator: eligible.length, denominatorPolicy: "fixed_v0_selected_source_units" as const, labelProvenanceHash: ablationHash(review.labelProvenance), labelSetHash: ablationHash(review.adjudicatedLabels), reviewSummary: review.summary, arms: scoredArms, unavailable: { goalLevelRecall: null, subspanFidelity: null, generalization: null } };
}

export async function runRequirementRoleObjectiveExperiment(corpusValue: unknown, options: { modelProfile: GeneralPrSemanticObserverModelProfileV2; provider?: RequirementRoleObjectiveProvider; review?: unknown }) {
  const built = await build(corpusValue, options.modelProfile);
  const plannedCalls = built.prepared.reduce((sum, item) => sum + item.plans.length * arms.length, 0);
  if (options.provider && plannedCalls > MAX_CALLS) throw new Error("actual request budget would exceed 30");
  let actualCallCount = 0;
  const cases = [];
  for (const item of built.prepared) {
    const selected = new Set(item.plans.flatMap(plan => plan.unitIds));
    const armState = Object.fromEntries(arms.map(arm => [arm, {
      ledger: item.registry.map(unit => ({ unitId: unit.id, sourceUnitId: unit.sourceUnitId, sourceKind: unit.sourceKind, start: unit.start, end: unit.end, textHash: unit.textHash, authority: unit.authority, sourceRole: unit.sourceRole, selected: selected.has(unit.id), attempted: false, semanticRole: null as GeneralPrClaimRoleV2 | null, objectivePresence: null as RequirementRoleTargetPresence | null, status: "unreviewed" as LedgerStatus, reason: selected.has(unit.id) ? "offline" : "v0_not_selected" })),
      calls: item.plans.map((plan, index) => {
        const packet = arm === "legacy_v0" ? structuredClone(plan.packet) : separatedPacket(plan.packet);
        return { id: `${item.caseId}:${arm}:${index + 1}`, arm, unitIds: [...plan.unitIds], inputHash: ablationHash(packet.input), promptHash: textHash(packet.system), requestHash: ablationHash(packet.request), outputSchemaHash: ablationHash(packet.request.responseFormat.schema), attempted: false, retryCount: 0 as const, state: "not_run" as "not_run" | "valid" | "invalid" | "unavailable", reason: "offline", packet };
      }),
    }])) as Record<RequirementRoleObjectiveArm, { ledger: Array<{ unitId: string; sourceUnitId: string; sourceKind: GeneralPrSourceKindV2; start: number; end: number; textHash: string; authority: RequirementRoleExperimentRegistryUnit["authority"]; sourceRole: RequirementRoleExperimentRegistryUnit["sourceRole"]; selected: boolean; attempted: boolean; semanticRole: GeneralPrClaimRoleV2 | null; objectivePresence: RequirementRoleTargetPresence | null; status: LedgerStatus; reason: string }>; calls: Array<{ id: string; arm: RequirementRoleObjectiveArm; unitIds: string[]; inputHash: string; promptHash: string; requestHash: string; outputSchemaHash: string; attempted: boolean; retryCount: 0; state: "not_run" | "valid" | "invalid" | "unavailable"; reason: string; packet: RequirementRoleExperimentPacket }> }>;
    if (options.provider) {
      for (const planIndex of item.plans.keys()) for (const arm of arms) {
        const state = armState[arm], call = state.calls[planIndex]!, plan = item.plans[planIndex]!;
        call.attempted = true; actualCallCount++;
        for (const unitId of call.unitIds) state.ledger.find(entry => entry.unitId === unitId)!.attempted = true;
        try {
          const output = await options.provider.observe({ callId: call.id, caseId: item.caseId, arm, packet: call.packet });
          const knownIds = new Set(item.registry.flatMap(unit => unit.spanId ?? []));
          const validation = arm === "legacy_v0"
            ? (() => {
                const legacy = validateResearchRoleOutput(output, plan.unitIds, knownIds);
                if (!legacy.valid) return legacy;
                return {
                  valid: true as const,
                  decisions: new Map([...legacy.roles].map(([unitId, semanticRole]) => [unitId, {
                    semanticRole,
                    objectivePresence: semanticRole === "objective_candidate" ? "yes" as const : semanticRole === "mixed_or_ambiguous" ? "unresolved" as const : "no" as const,
                  }])),
                };
              })()
            : validateSeparatedObjectiveOutput(output, plan.unitIds, knownIds);
          if (!validation.valid) {
            call.state = "invalid"; call.reason = validation.reason;
            for (const unitId of call.unitIds) { const entry = state.ledger.find(candidate => candidate.unitId === unitId)!; entry.status = "invalid"; entry.reason = validation.reason; }
          } else {
            call.state = "valid"; call.reason = "validated";
            for (const unitId of call.unitIds) {
              const entry = state.ledger.find(candidate => candidate.unitId === unitId)!;
              const decision = validation.decisions.get(unitId)!;
              entry.semanticRole = decision.semanticRole; entry.objectivePresence = decision.objectivePresence; entry.status = decision.semanticRole === "mixed_or_ambiguous" || decision.objectivePresence === "unresolved" ? "abstained" : "decided"; entry.reason = entry.status === "abstained" ? "ambiguous_or_unresolved" : "decided";
            }
          }
        } catch { call.state = "unavailable"; call.reason = "provider_error"; for (const unitId of call.unitIds) state.ledger.find(entry => entry.unitId === unitId)!.reason = "provider_error"; }
      }
    }
    cases.push({ id: item.caseId, cohort: item.cohort, inputHash: item.inputHash, seedHash: item.seedHash, registry: item.registry, selection: { policy: "existing_v0", unitIds: [...selected], plannedCallsPerArm: item.plans.length }, arms: Object.fromEntries(arms.map(arm => [arm, { ledger: armState[arm].ledger, calls: armState[arm].calls.map(({ packet: _packet, ...call }) => call), metrics: ledgerMetrics(armState[arm].ledger) }])) as Record<RequirementRoleObjectiveArm, { ledger: typeof armState[RequirementRoleObjectiveArm]["ledger"]; calls: Array<Omit<typeof armState[RequirementRoleObjectiveArm]["calls"][number], "packet">>; metrics: ReturnType<typeof ledgerMetrics> }> });
  }
  const review = options.review === undefined ? null : validateReviewAgainstBuild(options.review, built);
  if (review && !review.valid) throw new Error(`invalid review: ${review.reason}`);
  const evaluation = scoreEvaluation(cases, review);
  return {
    schemaVersion: "requirement_role_objective_result.v1" as const,
    shadowOnly: true,
    offline: !options.provider,
    sourceInputHash: built.template.contract.sourceInputHash,
    contractHash: built.template.contractHash,
    reviewTemplateHash: built.template.templateHash,
    configuredModel: options.modelProfile.model,
    modelProfileHash: ablationHash(options.modelProfile),
    actualCallCount,
    maxCallCount: MAX_CALLS,
    retries: 0,
    reviewTemplate: built.template,
    armContract: {
      legacy_v0: { targetOutput: "legacy_objective_candidate_projection", semanticRoleOutput: "existing_v0_role", sourceSelection: "existing_v0", extraContext: false },
      separated_v1: { targetOutput: "independent_yes_no_unresolved", semanticRoleOutput: "existing_11_roles", sourceSelection: "existing_v0", extraContext: false },
    },
    evaluation,
    cases,
    limitations: ["Fixture-provider runs validate plumbing and contracts, not prompt linguistic accuracy", "No model output may change source authority", "Goal-level recall, subspan fidelity, and generalization require evidence not produced by this unit-level experiment", "Character overlap is not semantic correctness", "Duplicate source occurrences remain distinct unless human annotations link a PR-local goal identity"],
  };
}
