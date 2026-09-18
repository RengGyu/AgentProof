import { buildReviewIntentGraph, validReviewIntentGraph, validReviewNavigation, type ReviewIntentGraphV1 } from "./review-intent";
import { createHash } from "crypto";
import type { EvidenceItem, PullRequestInput, RequirementFinding } from "./types";

/** Review-only retrieval metadata. Scores are ranks, never proof confidence. */
export interface ReviewCandidatesV1 {
  version: 1;
  navigation?: import("./review-intent").ReviewNavigation;
  intentGraph?: ReviewIntentGraphV1;
  retainedRelations?: Array<{ requirementId: string; evidenceId: string; relation: "verified" | "observed" }>;
  requirements: Array<{ requirementId: string; sourceHash: string; candidates: Array<{
    evidenceId: string; basis: "source_path" | "source_identifier" | "changed_tokens";
    score: number; evidenceHash: string;
  }> }>;
}

/** Compatibility rows are projections of intent retrieval, not a second lexical search. */
export function buildReviewCandidates(input: PullRequestInput, requirements: RequirementFinding[], evidence: EvidenceItem[]): ReviewCandidatesV1 {
  const intentGraph=buildReviewIntentGraph(input,requirements,evidence);
  return {version:1,intentGraph,requirements:requirements.map(requirement=>{
    const goals=intentGraph.goals.filter(goal=>goal.requirementIds.includes(requirement.requirementId));
    const candidates=new Map<string,ReviewCandidatesV1["requirements"][number]["candidates"][number]>();
    for(const edge of intentGraph.edges.filter(edge=>goals.some(goal=>goal.id===edge.goalId))) {
      const chunk=intentGraph.chunks.find(chunk=>chunk.id===edge.chunkId)!;
      if(!chunk.evidenceId)continue;
      const candidate={evidenceId:chunk.evidenceId,basis:edge.basis.includes("source_path")?"source_path" as const:edge.basis.includes("identifier")?"source_identifier" as const:"changed_tokens" as const,score:edge.score,evidenceHash:chunk.hash};
      if((candidates.get(chunk.evidenceId)?.score??-1)<edge.score)candidates.set(chunk.evidenceId,candidate);
    }
    return {requirementId:requirement.requirementId,sourceHash:createHash("sha256").update(JSON.stringify(goals.map(goal=>[goal.sourceRefs,goal.facets]))).digest("hex"),candidates:[...candidates.values()].sort((a,b)=>b.score-a.score||(evidence.find(e=>e.id===a.evidenceId)?.locator??"").localeCompare(evidence.find(e=>e.id===b.evidenceId)?.locator??"")).slice(0,8)};
  })};
}

/** Shared full-report and signed tenant boundary; no free text or unknown IDs. */
export function reviewCandidateErrors(value: unknown, requirementIds: ReadonlySet<string>, evidence: ReadonlyArray<{ id: string; kind?: string }>): string[] {
  const invalid = ["Invalid review candidates."];
  const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).length === expected.length && expected.every(k => Object.hasOwn(v,k));
  if (!object(value) || !keys(value,["version","requirements", ...(Object.hasOwn(value,"navigation") ? ["navigation"] : []), ...(Object.hasOwn(value,"intentGraph") ? ["intentGraph"] : []), ...(Object.hasOwn(value,"retainedRelations") ? ["retainedRelations"] : [])]) || value.version !== 1 || !Array.isArray(value.requirements) || value.requirements.length > 40) return invalid;
  if (value.navigation !== undefined && !validReviewNavigation(value.navigation)) return invalid;
  if (value.intentGraph !== undefined && !validReviewIntentGraph(value.intentGraph, requirementIds, evidence)) return invalid;
  if (value.retainedRelations !== undefined) {
    if (!Array.isArray(value.retainedRelations) || value.retainedRelations.length > 2000) return invalid;
    const pairs = new Set<string>();
    for (const row of value.retainedRelations) {
      if (!object(row) || !keys(row,["requirementId","evidenceId","relation"]) || typeof row.requirementId !== "string" || !requirementIds.has(row.requirementId) || typeof row.evidenceId !== "string" || !evidence.some(e=>e&&e.id===row.evidenceId) || !["observed","verified"].includes(String(row.relation))) return invalid;
      const pair = `${row.requirementId}:${row.evidenceId}`; if (pairs.has(pair)) return invalid; pairs.add(pair);
    }
  }
  const seen = new Set<string>();
  for (const row of value.requirements) {
    if (!object(row) || !keys(row,["requirementId","sourceHash","candidates"]) || typeof row.requirementId !== "string" || !requirementIds.has(row.requirementId) || seen.has(row.requirementId) || typeof row.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(row.sourceHash) || !Array.isArray(row.candidates) || row.candidates.length > 8) return invalid;
    seen.add(row.requirementId); const refs = new Set<string>();
    for (const item of row.candidates) {
      if (!object(item) || !keys(item,["evidenceId","basis","score","evidenceHash"]) || typeof item.evidenceId !== "string" || refs.has(item.evidenceId) || !evidence.some(e => e && e.id === item.evidenceId && ["diff","changed_file","test"].includes(e.kind ?? "")) || !["source_path","source_identifier","changed_tokens"].includes(String(item.basis)) || !Number.isSafeInteger(item.score) || Number(item.score) < 0 || Number(item.score) > 1000 || typeof item.evidenceHash !== "string" || !/^[a-f0-9]{64}$/.test(item.evidenceHash)) return invalid;
      refs.add(item.evidenceId);
    }
  }
  return seen.size === requirementIds.size ? [] : invalid;
}
