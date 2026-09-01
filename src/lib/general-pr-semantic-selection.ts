import { createHash } from "node:crypto";
import {
  buildGeneralPrObservationSeedV2,
  validateGeneralPrObservationSeedV2,
  type GeneralPrObservationSeedV2,
  type GeneralPrSemanticSpanV2,
  type GeneralPrSourceAdmissionTierV1,
  type GeneralPrSourceUnitV2
} from "./general-pr-observation-source";
import { redactSecrets } from "./redact";
import type { PullRequestInput } from "./types";

export const GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION = "general-pr-claim-evidence-selection.v1" as const;
const DEFAULT_MAX_SPANS = 12;
const DEFAULT_MAX_INPUT_BYTES = 12_000;

export type GeneralPrSemanticSelectionCoverageV1 = "complete" | "sampled" | "incomplete";

export interface GeneralPrSemanticClaimSelectionV1 {
  version: 1;
  parentSeedHash: string;
  claimSelectionHash: string;
  selectedSpanIds: string[];
  selectedSpans: Array<{
    spanId: string;
    sourceUnitId: string;
    authority: "authoritative" | "author_claim";
    sourceRole: "objective" | "context";
    structuralKind: string;
    deterministicRole: string;
    text: string;
  }>;
  coverage: GeneralPrSemanticSelectionCoverageV1;
  omittedReasonCounts: { spanBudget: number; inputByteBudget: number };
}

export function buildGeneralPrRedactedSourceViewsV1(input: PullRequestInput, seed: GeneralPrObservationSeedV2): Map<string, string> | null {
  if (!validateGeneralPrObservationSeedV2(seed).valid) return null;
  if (buildGeneralPrObservationSeedV2(input).seedHash !== seed.seedHash) return null;
  const candidates: Array<{ kind: string; text: string }> = [];
  if (input.taskText.trim()) candidates.push({ kind: input.taskSource === "issue" ? "linked_issue" : "provided_requirement", text: input.taskText });
  if (input.title.trim()) candidates.push({ kind: "pr_title", text: input.title });
  if (input.description.trim()) candidates.push({ kind: "pr_body", text: input.description });
  if (candidates.length !== seed.sources.length) return null;
  const views = new Map<string, string>();
  for (let index = 0; index < seed.sources.length; index += 1) {
    const source = seed.sources[index];
    const candidate = candidates[index];
    if (!source || !candidate || source.kind !== candidate.kind) return null;
    const redacted = redactSecrets(candidate.text.replace(/\r\n/g, "\n"));
    if (sha(redacted) !== source.sourceContentHash) return null;
    views.set(source.id, redacted);
  }
  for (const span of seed.spans) {
    const view = views.get(span.sourceUnitId);
    if (!view || span.start < 0 || span.end > view.length || span.end <= span.start || sha(view.slice(span.start, span.end)) !== span.textHash) return null;
  }
  return views;
}

export function selectGeneralPrSemanticClaimSpansV1(input: {
  pullRequest: PullRequestInput;
  seed: GeneralPrObservationSeedV2;
  maxSpans?: number;
  maxInputBytes?: number;
}): { ok: true; selection: GeneralPrSemanticClaimSelectionV1 } | { ok: false; reason: "seed_invalid" | "source_binding_invalid" | "selection_unavailable" } {
  if (!validateGeneralPrObservationSeedV2(input.seed).valid) return { ok: false, reason: "seed_invalid" };
  const views = buildGeneralPrRedactedSourceViewsV1(input.pullRequest, input.seed);
  if (!views) return { ok: false, reason: "source_binding_invalid" };
  const maxSpans = boundedBudget(input.maxSpans, DEFAULT_MAX_SPANS);
  const maxInputBytes = boundedBudget(input.maxInputBytes, DEFAULT_MAX_INPUT_BYTES);
  const sourcesById = new Map(input.seed.sources.map((source, index) => [source.id, { source, index }]));
  let inputByteBudget = 0;
  const candidates = input.seed.spans.flatMap((span, seedIndex) => {
    const owner = sourcesById.get(span.sourceUnitId);
    const text = views.get(span.sourceUnitId)?.slice(span.start, span.end);
    if (!owner || typeof text !== "string" || !isEligible(owner.source, span)) return [];
    const selected = toSelectedSpan(owner.source, span, text);
    if (selectionBytes(input.seed.seedHash, [selected], 1, 1) > maxInputBytes) {
      inputByteBudget += 1;
      return [];
    }
    return [{ span, selected, seedIndex, sourceIndex: owner.index, source: owner.source }];
  });
  const byRank = [...candidates].sort(compareCandidate);
  const reserved = new Set<string>();
  for (const source of input.seed.sources) {
    if (source.roleCeiling !== "objective") continue;
    const candidate = byRank.find((item) => item.source.id === source.id && item.span.deterministicRole !== "template_or_process");
    if (candidate) reserved.add(candidate.span.id);
  }
  const selected = byRank.filter((item) => reserved.has(item.span.id)).slice(0, maxSpans);
  for (const candidate of byRank) {
    if (selected.length >= maxSpans) break;
    if (!selected.some((item) => item.span.id === candidate.span.id)) selected.push(candidate);
  }
  const selectedIds = new Set(selected.map((item) => item.span.id));
  let spanBudget = Math.max(0, candidates.length - selected.length);
  while (selected.length > 0 && selectionBytes(input.seed.seedHash, selected.map((item) => item.selected), candidates.length, inputByteBudget) > maxInputBytes) {
    const removable = [...selected].sort(compareCandidate).reverse().find((item) => !reserved.has(item.span.id));
    if (!removable) {
      const reservedCandidate = [...selected].sort(compareCandidate).reverse()[0];
      if (!reservedCandidate) break;
      selected.splice(selected.indexOf(reservedCandidate), 1);
      reserved.delete(reservedCandidate.span.id);
    } else selected.splice(selected.indexOf(removable), 1);
    selectedIds.clear();
    for (const candidate of selected) selectedIds.add(candidate.span.id);
    inputByteBudget += 1;
  }
  if (selected.length === 0) return { ok: false, reason: "selection_unavailable" };
  const ordered = [...selected].sort((left, right) => left.seedIndex - right.seedIndex);
  const selectedSpans = ordered.map((item) => item.selected);
  spanBudget = Math.max(0, candidates.length - selectedIds.size);
  const selectionWithoutHash = selectionPayload(input.seed.seedHash, selectedSpans, spanBudget, inputByteBudget);
  return {
    ok: true,
    selection: {
      ...selectionWithoutHash,
      claimSelectionHash: digest({ domain: "agentproof.general-pr.claim-selection.v1", policyVersion: GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION, selection: selectionWithoutHash })
    }
  };
}

function isEligible(source: GeneralPrSourceUnitV2, span: GeneralPrSemanticSpanV2): boolean {
  return source.roleCeiling !== "policy_only" && span.structuralKind !== "code" && span.structuralKind !== "html";
}

function toSelectedSpan(source: GeneralPrSourceUnitV2, span: GeneralPrSemanticSpanV2, text: string): GeneralPrSemanticClaimSelectionV1["selectedSpans"][number] {
  return { spanId: span.id, sourceUnitId: span.sourceUnitId, authority: source.authority, sourceRole: source.roleCeiling === "context" ? "context" : "objective", structuralKind: span.structuralKind, deterministicRole: span.deterministicRole, text };
}

function compareCandidate(left: Candidate, right: Candidate): number {
  return admissionTierRank(left.source.admissionTier) - admissionTierRank(right.source.admissionTier)
    || roleCeilingRank(left.source.roleCeiling) - roleCeilingRank(right.source.roleCeiling)
    || deterministicRoleRank(left.span.deterministicRole) - deterministicRoleRank(right.span.deterministicRole)
    || structuralKindRank(left.span.structuralKind) - structuralKindRank(right.span.structuralKind)
    || left.sourceIndex - right.sourceIndex || left.span.start - right.span.start || left.span.id.localeCompare(right.span.id);
}

type Candidate = { span: GeneralPrSemanticSpanV2; selected: GeneralPrSemanticClaimSelectionV1["selectedSpans"][number]; seedIndex: number; sourceIndex: number; source: GeneralPrSourceUnitV2 };
function admissionTierRank(value: GeneralPrSourceAdmissionTierV1): number { return value === "primary" ? 0 : value === "fallback" ? 1 : 2; }
function roleCeilingRank(value: GeneralPrSourceUnitV2["roleCeiling"]): number { return value === "objective" ? 0 : value === "context" ? 1 : 2; }
function deterministicRoleRank(value: GeneralPrSemanticSpanV2["deterministicRole"]): number {
  return (["objective_candidate", "problem_observation", "implementation_claim", "test_claim", "unresolved", "supporting_context", "mixed_or_ambiguous", "scope_exclusion", "known_limitation", "follow_up", "risk_or_revert", "template_or_process"] as string[]).indexOf(value);
}
function structuralKindRank(value: GeneralPrSemanticSpanV2["structuralKind"]): number { return (["title", "list_item", "paragraph", "table_cell", "heading", "blockquote", "html", "code"] as string[]).indexOf(value); }
function selectionPayload(
  parentSeedHash: string,
  selectedSpans: GeneralPrSemanticClaimSelectionV1["selectedSpans"],
  spanBudget: number,
  inputByteBudget: number
) {
  return {
    version: 1 as const,
    parentSeedHash,
    selectedSpanIds: selectedSpans.map((span) => span.spanId),
    selectedSpans,
    coverage: (spanBudget > 0 || inputByteBudget > 0 ? "sampled" : "complete") as GeneralPrSemanticSelectionCoverageV1,
    omittedReasonCounts: { spanBudget, inputByteBudget }
  };
}
function selectionBytes(parentSeedHash: string, selectedSpans: GeneralPrSemanticClaimSelectionV1["selectedSpans"], totalCandidates: number, inputByteBudget: number): number {
  return Buffer.byteLength(JSON.stringify({
    ...selectionPayload(parentSeedHash, selectedSpans, Math.max(0, totalCandidates - selectedSpans.length), inputByteBudget),
    claimSelectionHash: "0".repeat(64)
  }), "utf8");
}
function boundedBudget(value: number | undefined, fallback: number): number { return Number.isSafeInteger(value) && value! >= 0 ? value! : fallback; }
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
