import { createHash } from "node:crypto";
import { selectCanonicalSelectedSourceBundle } from "../src/lib/extractors";
import { buildGeneralPrObservationSeedV2, type GeneralPrClaimRoleV2, type GeneralPrSourceKindV2 } from "../src/lib/general-pr-observation-source";
import { GeneralPrSemanticProviderFailure, runGeneralPrSemanticObserverV2, type GeneralPrSemanticObserverModelProfileV2, type GeneralPrSemanticObserverPackageV4 } from "../src/lib/general-pr-semantic-observer";
import { buildGeneralPrRedactedSourceViewsV1, GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION, selectGeneralPrSemanticClaimSpansV1 } from "../src/lib/general-pr-semantic-selection";
import { validateGeneralPrSemanticClaimCandidateV2 } from "../src/lib/general-pr-semantic-proposal";
import { parseGeneralPrStructureV1 } from "../src/lib/general-pr-structure";
import { submitGeneralPrSemanticObservationWithOpenAI } from "../src/lib/openai-semantic";
import { redactSecrets } from "../src/lib/redact";
import type { PullRequestInput } from "../src/lib/types";

export interface SourceLabel {
  id: string;
  sourceKind: GeneralPrSourceKindV2;
  /** UTF-16 offsets into the supplied, already LF-normalized view. */
  start: number;
  end: number;
  text: string;
  label: "requirement" | "non_requirement" | "ambiguous";
}
export interface AblationCase { id: string; cohort: "public" | "controlled"; input: PullRequestInput; labels: SourceLabel[] }
export interface AblationCorpus { schemaVersion: "requirement_source_ablation.v1"; labelProvenance: string; cases: AblationCase[] }
type ClaimPackage = Extract<GeneralPrSemanticObserverPackageV4, { stage: "claim_discovery" }>;
type ArmState = "valid" | "invalid" | "unavailable" | "not_run";
export interface ClassifiedInterval { id: string; sourceKind: GeneralPrSourceKindV2; start: number; end: number; role: GeneralPrClaimRoleV2 }
interface ContextRef {
  sourceUnitId: string; sourceKind: GeneralPrSourceKindV2; start: number; end: number;
  textHash: string; text: string; authority: "authoritative" | "author_claim";
  roleCeiling: "objective" | "context" | "policy_only";
}
interface SourceContext { candidateSpanId: string; sourceUnitId: string; sourceKind: GeneralPrSourceKindV2; title: ContextRef | null; headingChain: ContextRef[]; adjacent: ContextRef[] }
type ContextPackage = Omit<ClaimPackage, "input"> & { input: ClaimPackage["input"] & { sourceContext: SourceContext[] } };
const sourceKinds: GeneralPrSourceKindV2[] = ["provided_requirement", "linked_issue", "pr_title", "pr_body"];
export const SOURCE_ABLATION_EVALUATION_POLICY_VERSION = "requirement-source-content-coverage.v1" as const;
const identifier = /^[A-Za-z0-9_.:-]{1,100}$/;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
export const ablationHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value).digest("hex");
const sourceText = (input: PullRequestInput, kind: GeneralPrSourceKindV2) => kind === "pr_title" ? input.title : kind === "pr_body" ? input.description : kind === (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") ? input.taskText : "";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Reject the entire corpus before packaging/calls, never silently remove unsupported cases. */
export function validateAblationCorpus(value: unknown): asserts value is AblationCorpus {
  const fail = () => { throw new Error("unsupported corpus: schema, source coordinates, privacy, or label binding invalid"); };
  if (!record(value) || value.schemaVersion !== "requirement_source_ablation.v1" || typeof value.labelProvenance !== "string" || !value.labelProvenance.trim() || value.labelProvenance.length > 2_000 || !Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 100) return fail();
  const caseIds = new Set<string>();
  for (const item of value.cases) {
    if (!record(item) || typeof item.id !== "string" || !identifier.test(item.id) || caseIds.has(item.id) || !["public", "controlled"].includes(String(item.cohort)) || !record(item.input) || !Array.isArray(item.labels) || item.labels.length > 500) return fail();
    caseIds.add(item.id);
    const input = item.input;
    if (typeof input.title !== "string" || typeof input.description !== "string" || typeof input.taskText !== "string" || !Array.isArray(input.changedFiles) || !Array.isArray(input.checks) || !Array.isArray(input.logs) || input.repositoryPrivate !== false || (input.taskSource !== undefined && input.taskSource !== "task" && input.taskSource !== "issue")) return fail();
    for (const text of [input.title, input.description, input.taskText]) {
      if (text.includes("\r") || Buffer.byteLength(text, "utf8") > 64_000 || redactSecrets(text) !== text) return fail();
    }
    const labels: SourceLabel[] = [];
    const labelIds = new Set<string>();
    for (const label of item.labels) {
      if (!record(label) || typeof label.id !== "string" || !identifier.test(label.id) || labelIds.has(label.id) || !sourceKinds.includes(label.sourceKind as GeneralPrSourceKindV2) || !["requirement", "non_requirement", "ambiguous"].includes(String(label.label)) || typeof label.text !== "string" || !Number.isSafeInteger(label.start) || !Number.isSafeInteger(label.end)) return fail();
      const typed = label as unknown as SourceLabel;
      const original = sourceText(input as unknown as PullRequestInput, typed.sourceKind);
      if (typed.start < 0 || typed.end <= typed.start || typed.end > original.length || original.slice(typed.start, typed.end) !== typed.text || labels.some(other => other.sourceKind === typed.sourceKind && other.start < typed.end && typed.start < other.end)) return fail();
      labels.push(typed); labelIds.add(typed.id);
    }
  }
}

/** Ephemeral packages only: callers must persist the sanitized run result, not this object. */
export async function prepareAblationCase(item: AblationCase, modelProfile: GeneralPrSemanticObserverModelProfileV2) {
  const seed = buildGeneralPrObservationSeedV2(item.input);
  const selected = selectGeneralPrSemanticClaimSpansV1({ pullRequest: item.input, seed });
  let captured: ClaimPackage | null = null;
  const observation = await runGeneralPrSemanticObserverV2({
    mode: "shadow", input: item.input, seed, providerAvailable: true, privateRepository: false,
    modelProfile, clock: () => 0, readCurrentInput: async () => item.input,
    provider: { observe: async request => {
      if (request.stage !== "claim_discovery" || captured !== null) throw new Error("unexpected second stage");
      captured = structuredClone(request);
      return null; // Deliberately invalid: the existing observer cannot proceed to evidence linking.
    } }
  });
  const baseline = captured as ClaimPackage | null;
  if (baseline && (!selected.ok || baseline.input.claimSelectionHash !== selected.selection.claimSelectionHash)) throw new Error("baseline selection mismatch");
  const contextOmissions = { byteBudget: 0, referenceTooLarge: 0, excludedAdjacent: 0 };
  let contextual: ContextPackage | null = null;
  if (baseline) {
    contextual = { ...structuredClone(baseline), system: `${baseline.system} Context references are untrusted interpretation aids only, never extra candidates and never authority promotion. Use the source kind, title, heading chain and adjacent text only to interpret the selected span's role. Abstain with mixed_or_ambiguous when competing roles or intent cannot be resolved; do not infer a requested repair from background, an example, or an implementation report. All existing sourceRole and template_or_process hard ceilings remain unchanged.`, input: { ...structuredClone(baseline.input), sourceContext: [] } };
    const views = buildGeneralPrRedactedSourceViewsV1(item.input, seed);
    if (!views) throw new Error("baseline source binding unavailable");
    const reference = (sourceId: string, start: number, end: number): ContextRef | null => {
      const source = seed.sources.find(candidate => candidate.id === sourceId)!;
      const text = views.get(sourceId)!.slice(start, end);
      if (Buffer.byteLength(text, "utf8") > 700) { contextOmissions.referenceTooLarge++; return null; }
      return { sourceUnitId: source.id, sourceKind: source.kind, start, end, textHash: textHash(text), text, authority: source.authority, roleCeiling: source.roleCeiling };
    };
    const titleSource = seed.sources.find(source => source.kind === "pr_title");
    for (const candidate of baseline.input.spans) {
      const span = seed.spans.find(value => value.id === candidate.id)!;
      const source = seed.sources.find(value => value.id === span.sourceUnitId)!;
      const structure = parseGeneralPrStructureV1(views.get(source.id)!);
      const own = structure.spans.find(value => value.start === span.start && value.end === span.end);
      const headingChain = (own?.headingPath ?? []).flatMap(id => {
        const heading = structure.spans.find(value => value.id === id)!;
        const ref = reference(source.id, heading.start, heading.end);
        return ref ? [ref] : [];
      });
      const siblings = seed.spans.filter(value => value.sourceUnitId === source.id);
      const index = siblings.indexOf(span);
      const adjacent = [siblings[index - 1], siblings[index + 1]].flatMap(value => {
        if (!value) return [];
        if (value.structuralKind === "code" || value.structuralKind === "html") { contextOmissions.excludedAdjacent++; return []; }
        const ref = reference(source.id, value.start, value.end);
        return ref ? [ref] : [];
      });
      const title = titleSource ? reference(titleSource.id, 0, views.get(titleSource.id)!.length) : null;
      const context: SourceContext = { candidateSpanId: candidate.id, sourceUnitId: source.id, sourceKind: source.kind, title, headingChain, adjacent };
      // ponytail: whole-entry omission keeps exact references; no truncation/offset remapping.
      if (bytes({ ...contextual.input, sourceContext: [...contextual.input.sourceContext, context] }) > 15_000) contextOmissions.byteBudget++;
      else contextual.input.sourceContext.push(context);
    }
  }
  const canonical = selectCanonicalSelectedSourceBundle(item.input);
  const canonicalIntervals: ClassifiedInterval[] = canonical.canonical.requirements.map(unit => {
    const range = canonical.structureByRequirementId.get(unit.reportRequirementId)!;
    return { id: unit.reportRequirementId, sourceKind: unit.source === "issue" ? "linked_issue" : unit.source === "pr_description" ? "pr_body" : "provided_requirement", start: range.start, end: range.end, role: "objective_candidate" };
  });
  return { seed, selection: selected.ok ? selected.selection : null, baseline, contextual, contextOmissions, canonicalIntervals,
    canonicalOmitted: canonical.omittedRequirementCount, canonicalHash: ablationHash(canonical.canonical), packageFailureReasons: observation.semanticPackageFailureReasons };
}

function unionLength(ranges: Array<{ start: number; end: number }>, content?: { text: string; start: number }): number {
  let end = -1; let length = 0;
  for (const range of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const start = Math.max(end, range.start);
    if (range.end > start) length += content
      ? content.text.slice(start - content.start, range.end - content.start).replace(/\s/g, "").length
      : range.end - start;
    end = Math.max(end, range.end);
  }
  return length;
}
const fraction = (numerator: number, denominator: number) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });

/** Exact character coverage: a tiny objective fragment never preserves an entire gold unit. */
export function scoreSourceLabels(labels: SourceLabel[], intervals: ClassifiedInterval[], state: ArmState, selectedIntervals: Array<Omit<ClassifiedInterval, "role">> = intervals) {
  const rows = labels.map(label => {
    const overlap = intervals.filter(span => span.sourceKind === label.sourceKind && span.start < label.end && label.start < span.end);
    const selectedOverlap = selectedIntervals.filter(span => span.sourceKind === label.sourceKind && span.start < label.end && label.start < span.end);
    const clip = (span: Omit<ClassifiedInterval, "role">) => ({ start: Math.max(span.start, label.start), end: Math.min(span.end, label.end) });
    const selectedCharacters = unionLength(selectedOverlap.map(clip));
    const objectiveCharacters = unionLength(overlap.filter(span => span.role === "objective_candidate").map(clip));
    const ambiguousCharacters = unionLength(overlap.filter(span => span.role === "mixed_or_ambiguous").map(clip));
    const length = label.end - label.start;
    const prediction = state !== "valid" ? state : selectedCharacters === 0 ? "omitted" : selectedCharacters < length ? "partial" : objectiveCharacters === length ? "requirement" : ambiguousCharacters > 0 || objectiveCharacters > 0 ? "ambiguous" : "non_requirement";
    const contentLength = label.text.replace(/\s/g, "").length;
    const contentSelected = unionLength(selectedOverlap.map(clip), label);
    const contentObjective = unionLength(overlap.filter(span => span.role === "objective_candidate").map(clip), label);
    const contentAmbiguous = unionLength(overlap.filter(span => span.role === "mixed_or_ambiguous").map(clip), label);
    const contentCoverage = {
      labelCharacters: contentLength, selectedCharacters: contentSelected, objectiveCharacters: contentObjective, ambiguousCharacters: contentAmbiguous,
      selectedFraction: contentLength ? contentSelected / contentLength : null,
      selectionState: contentLength === 0 ? "empty" : contentSelected === 0 ? "not_selected" : contentSelected === contentLength ? "full" : "partial",
      prediction: state !== "valid" ? state : contentLength === 0 ? "not_evaluable" : contentSelected === 0 ? "omitted" : contentSelected < contentLength ? "partial" : contentObjective === contentLength ? "requirement" : contentAmbiguous > 0 || contentObjective > 0 ? "ambiguous" : "non_requirement"
    };
    return { labelId: label.id, sourceKind: label.sourceKind, start: label.start, end: label.end, textHash: textHash(label.text), gold: label.label, prediction,
      selectedCharacters, objectiveCharacters, ambiguousCharacters, labelCharacters: length, selectedFraction: selectedCharacters / length, contentCoverage,
      selectionState: selectedCharacters === 0 ? "not_selected" : selectedCharacters === length ? "full" : "partial",
      selectedSpanIds: selectedOverlap.map(span => span.id), roles: [...new Set(overlap.map(span => span.role))] };
  });
  const required = rows.filter(row => row.gold === "requirement");
  const negative = rows.filter(row => row.gold === "non_requirement");
  const ambiguous = rows.filter(row => row.gold === "ambiguous");
  let unlabeledSelectedCharacters = 0;
  let unlabeledObjectiveCharacters = 0;
  for (const kind of sourceKinds) {
    const selected = selectedIntervals.filter(span => span.sourceKind === kind);
    const labeledIntersection = (spans: Array<Omit<ClassifiedInterval, "role">>) => labels.filter(label => label.sourceKind === kind).flatMap(label => spans.filter(span => span.start < label.end && label.start < span.end).map(span => ({ start: Math.max(label.start, span.start), end: Math.min(label.end, span.end) })));
    unlabeledSelectedCharacters += unionLength(selected) - unionLength(labeledIntersection(selected));
    const objectives = intervals.filter(span => span.sourceKind === kind && span.role === "objective_candidate");
    unlabeledObjectiveCharacters += unionLength(objectives) - unionLength(labeledIntersection(objectives));
  }
  return { evaluationPolicyVersion: SOURCE_ABLATION_EVALUATION_POLICY_VERSION, rows, unlabeledSelectedCharacters, unlabeledObjectiveCharacters, contentMetrics: {
    missedRequirement: fraction(required.filter(row => row.contentCoverage.prediction !== "requirement").length, required.length),
    preservedRequirement: fraction(required.filter(row => row.contentCoverage.prediction === "requirement").length, required.length),
    falsePositive: fraction(negative.filter(row => row.contentCoverage.objectiveCharacters > 0).length, negative.length),
    abstention: fraction(rows.filter(row => row.contentCoverage.ambiguousCharacters > 0).length, rows.length),
    ambiguousGoldPromotion: fraction(ambiguous.filter(row => row.contentCoverage.objectiveCharacters > 0).length, ambiguous.length),
    partialSelection: fraction(rows.filter(row => row.contentCoverage.selectionState === "partial").length, rows.length),
    omitted: fraction(rows.filter(row => row.contentCoverage.selectionState === "not_selected").length, rows.length),
    invalidOrUnavailable: fraction(state === "invalid" || state === "unavailable" ? rows.length : 0, rows.length),
    notRun: fraction(state === "not_run" ? rows.length : 0, rows.length),
    notEvaluable: fraction(rows.filter(row => row.contentCoverage.labelCharacters === 0).length, rows.length)
  }, metrics: {
    // Operational non-preservation includes omitted, partial and failed/not-run units, not only definite negative decisions.
    missedRequirement: fraction(required.filter(row => row.prediction !== "requirement").length, required.length),
    preservedRequirement: fraction(required.filter(row => row.prediction === "requirement").length, required.length),
    falsePositive: fraction(negative.filter(row => row.objectiveCharacters > 0).length, negative.length),
    abstention: fraction(rows.filter(row => row.ambiguousCharacters > 0).length, rows.length),
    ambiguousGoldPromotion: fraction(ambiguous.filter(row => row.objectiveCharacters > 0).length, ambiguous.length),
    partialSelection: fraction(rows.filter(row => row.selectedCharacters > 0 && row.selectedCharacters < row.labelCharacters).length, rows.length),
    omitted: fraction(rows.filter(row => row.selectedCharacters === 0).length, rows.length),
    invalidOrUnavailable: fraction(state === "invalid" || state === "unavailable" ? rows.length : 0, rows.length),
    notRun: fraction(state === "not_run" ? rows.length : 0, rows.length)
  } };
}

interface Telemetry { actualRequestCount: number; latencyMs: number | null; httpStatus: number | null; model: string | null; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null }
const emptyTelemetry = (): Telemetry => ({ actualRequestCount: 0, latencyMs: null, httpStatus: null, model: null, usage: null });
type Prepared = Awaited<ReturnType<typeof prepareAblationCase>>;
export interface AblationRunOptions {
  modelProfile: GeneralPrSemanticObserverModelProfileV2;
  live?: boolean;
  acknowledgement?: boolean;
  apiKey?: string;
  fetchFn?: typeof fetch;
}

export async function runSourceAblation(value: unknown, options: AblationRunOptions) {
  validateAblationCorpus(value);
  if (options.live && (!options.acknowledgement || !options.apiKey?.trim())) throw new Error("live acknowledgement and nonempty API key required");
  if (options.live && value.cases.length * 2 > 30) throw new Error("actual request budget would exceed 30");
  if (!identifier.test(options.modelProfile.model)) throw new Error("invalid model profile");
  // Preflight every case and both complete requests before any transport can run.
  const prepared = await Promise.all(value.cases.map(item => prepareAblationCase(item, options.modelProfile)));
  for (const item of prepared) {
    if (item.baseline && bytes(item.baseline.input) > 12_000 || item.contextual && bytes(item.contextual.input) > 15_000) throw new Error("input byte budget exceeded");
  }
  let actualRequestCount = 0;
  const observe = async (item: AblationCase, ready: Prepared, packet: ClaimPackage | null) => {
    const telemetry = emptyTelemetry();
    let state: ArmState = options.live ? "unavailable" : "not_run";
    let reason: string | null = options.live ? "package_unavailable" : "live_disabled";
    let intervals: ClassifiedInterval[] = [];
    if (options.live && packet && ready.selection) {
      const start = Date.now();
      const transport: typeof fetch = async (url, init) => {
        if (actualRequestCount >= 30 || telemetry.actualRequestCount >= 1) throw new Error("request budget exceeded");
        actualRequestCount++; telemetry.actualRequestCount++;
        const response = await (options.fetchFn ?? fetch)(url, init);
        telemetry.httpStatus = response.status;
        if (response.ok) {
          try {
            const payload: unknown = await response.clone().json();
            if (record(payload)) {
              telemetry.model = typeof payload.model === "string" && identifier.test(payload.model) ? payload.model : null;
              if (record(payload.usage)) {
                const token = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
                telemetry.usage = { inputTokens: token(payload.usage.input_tokens), outputTokens: token(payload.usage.output_tokens), totalTokens: token(payload.usage.total_tokens) };
              }
            }
          } catch { /* Metadata unavailable: never retain response bodies or parsing errors. */ }
        }
        return response;
      };
      try {
        const output = await submitGeneralPrSemanticObservationWithOpenAI(packet, { apiKey: options.apiKey!, fetchFn: transport });
        const validation = validateGeneralPrSemanticClaimCandidateV2(output, ready.seed, ready.selection);
        if (!validation.valid) { state = "invalid"; reason = validation.invalidReason; }
        else {
          state = "valid"; reason = null;
          intervals = ready.selection.selectedSpanIds.map(id => {
            const span = ready.seed.spans.find(span => span.id === id)!;
            const source = ready.seed.sources.find(source => source.id === span.sourceUnitId)!;
            return { id, sourceKind: source.kind, start: span.start, end: span.end, role: validation.spanRoles.find(role => role.spanId === id)!.role };
          });
        }
      } catch (error) {
        const category = error instanceof GeneralPrSemanticProviderFailure ? error.diagnostic?.category : undefined;
        state = category === "output_invalid" || category === "response_invalid" || category === "incomplete" ? "invalid" : "unavailable";
        reason = category ?? "provider_unavailable";
      }
      telemetry.latencyMs = Math.max(0, Date.now() - start);
    }
    const selectedIntervals = packet ? (ready.selection?.selectedSpanIds ?? []).map(id => {
      const span = ready.seed.spans.find(span => span.id === id)!;
      const source = ready.seed.sources.find(source => source.id === span.sourceUnitId)!;
      return { id, sourceKind: source.kind, start: span.start, end: span.end };
    }) : [];
    return { state, reason, telemetry, roles: intervals, ...scoreSourceLabels(item.labels, intervals, state, selectedIntervals) };
  };
  const cases = [];
  for (let index = 0; index < value.cases.length; index++) {
    const item = value.cases[index]!; const ready = prepared[index]!;
    const B = await observe(item, ready, ready.baseline);
    const C = await observe(item, ready, ready.contextual);
    cases.push({ id: item.id, cohort: item.cohort, inputHash: ablationHash(item.input), seedHash: ready.seed.seedHash,
      sources: ready.seed.sources.map(source => ({ id: source.id, kind: source.kind, contentHash: source.sourceContentHash, authority: source.authority, roleCeiling: source.roleCeiling, admissionTier: source.admissionTier, spanCount: source.structuralSpanIds.length })),
      selection: { selectedSpanIds: ready.selection?.selectedSpanIds ?? [], totalSpans: ready.seed.spans.length, coverage: ready.selection?.coverage ?? "unavailable", omissions: ready.selection?.omittedReasonCounts ?? null, packageFailureReasons: ready.packageFailureReasons, contextOmissions: ready.contextOmissions, canonicalOmitted: ready.canonicalOmitted },
      hashes: { canonical: ready.canonicalHash, B: ready.baseline ? ablationHash(ready.baseline) : null, C: ready.contextual ? ablationHash(ready.contextual) : null, BSystem: ready.baseline ? textHash(ready.baseline.system) : null, CSystem: ready.contextual ? textHash(ready.contextual.system) : null, outputSchema: ready.baseline ? ablationHash(ready.baseline.request.responseFormat) : null },
      inputBytes: { B: ready.baseline ? bytes(ready.baseline.input) : 0, C: ready.contextual ? bytes(ready.contextual.input) : 0 },
      arms: { A: { state: "valid" as const, reason: null, telemetry: emptyTelemetry(), roles: ready.canonicalIntervals, ...scoreSourceLabels(item.labels, ready.canonicalIntervals, "valid") }, B, C }
    });
  }
  return { schemaVersion: "requirement_source_ablation_result.v1", selectionPolicyVersion: GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION, evaluationPolicyVersion: SOURCE_ABLATION_EVALUATION_POLICY_VERSION, shadowOnly: true, liveRequested: options.live === true, corpusHash: ablationHash(value), labelProvenanceHash: textHash(value.labelProvenance), modelProfileHash: ablationHash(options.modelProfile), configuredModel: options.modelProfile.model,
    actualRequestCount, caseCount: cases.length, labeledUnitCount: value.cases.reduce((n, item) => n + item.labels.length, 0),
    limitations: ["Source/template hard ceilings unchanged in B and C", "Only selected spans are model candidates; context never adds candidates", "LF-only redaction-stable source views; UTF-16 interval coverage is not semantic equivalence", "missedRequirement means not fully preserved, including partial, omitted, invalid, unavailable and not_run", "Gold ambiguous is separate from non_requirement; unlabeled selection is not presumed noise", "A canonical selection and B/C bounded selection have different candidate coverage", "B/C objective_candidate is Stage-A source classification, not downstream union admission, canonical requirement creation, or fulfillment"], cases };
}
