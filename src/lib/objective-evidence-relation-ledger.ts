import { createHash } from "node:crypto";

export type RelationNodeKindV1 = "objective_group" | "change_cluster" | "test_artifact" | "workflow_execution" | "test_result" | "evidence_atom";
export type RelationEdgeKindV1 = "maps_to" | "source_names_artifact" | "syntax_imports" | "direct_asserts" | "executed_in" | "reported_result" | "semantic_supports" | "semantic_contradicts";
export type RelationVerificationLevelV1 = "verified" | "observed" | "hypothesis" | "unresolved" | "unavailable";
export type RelationBasisV1 = "source_literal" | "existing_bounded_js_ts_detector" | "typescript_ast_relation" | "acorn_syntax_relation" | "runner_result" | "github_execution_identity" | "semantic_proposal";
export type RelationConsumerCeilingV1 = "observation_only" | "test_relation_component" | "test_binding_component" | "execution_binding_component" | "artifact_binding_component";

export interface RelationNodeV1 {
  version: 1;
  id: string;
  kind: RelationNodeKindV1;
  subjectDigest: string;
}

export interface RelationEdgeCandidateV1 {
  fromNodeId: string;
  toNodeId: string;
  kind: RelationEdgeKindV1;
  level: RelationVerificationLevelV1;
  basis: RelationBasisV1;
  subjectDigest: string;
  evidenceRefs: string[];
  completeness: "complete" | "incomplete" | "unknown";
}

export interface ObjectiveEvidenceRelationV1 extends RelationEdgeCandidateV1 {
  version: 1;
  id: string;
  consumerCeiling: RelationConsumerCeilingV1;
}

export interface ObjectiveEvidenceRelationLedgerV1 {
  version: 1;
  nodes: RelationNodeV1[];
  edges: ObjectiveEvidenceRelationV1[];
  ledgerDigest: string;
}

export type RelationLedgerBuildResultV1 =
  | { valid: true; ledger: ObjectiveEvidenceRelationLedgerV1; errors: [] }
  | { valid: false; errors: string[] };

export function buildObjectiveEvidenceRelationLedgerV1(input: {
  nodes: RelationNodeV1[];
  edges: RelationEdgeCandidateV1[];
}): RelationLedgerBuildResultV1 {
  if (!Array.isArray(input.nodes) || !Array.isArray(input.edges) || !hasNoArrayHoles(input.nodes) || !hasNoArrayHoles(input.edges)) return invalid("ledger input collections are invalid");
  const nodeIds = new Set<string>();
  const nodes: RelationNodeV1[] = [];
  for (const node of input.nodes) {
    if (!isNode(node) || nodeIds.has(node.id)) return invalid("ledger node is invalid");
    nodeIds.add(node.id);
    nodes.push({ ...node });
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: ObjectiveEvidenceRelationV1[] = [];
  const seenEdgeIds = new Set<string>();
  const verifiedEvidenceOwner = new Map<string, string>();
  for (const candidate of input.edges) {
    const relation = normalizeEdge(candidate, nodeById);
    if (!relation) return invalid("relation edge is invalid");
    if (seenEdgeIds.has(relation.id)) continue;
    seenEdgeIds.add(relation.id);
    if (relation.level === "verified") {
      const objectiveId = objectiveEndpoint(relation, nodeById);
      if (objectiveId) {
        for (const evidenceRef of relation.evidenceRefs) {
          const prior = verifiedEvidenceOwner.get(evidenceRef);
          if (prior && prior !== objectiveId) return invalid("verified evidence cannot be copied across objectives");
          verifiedEvidenceOwner.set(evidenceRef, objectiveId);
        }
      }
    }
    edges.push(relation);
  }
  const sortedNodes = [...nodes].sort(compareById);
  const sortedEdges = [...edges].sort(compareById);
  const unsigned = { version: 1 as const, nodes: sortedNodes, edges: sortedEdges };
  return { valid: true, ledger: { ...unsigned, ledgerDigest: digest({ domain: "agentproof.objective-evidence-ledger.v1", ledger: unsigned }) }, errors: [] };
}

/** Rebuilds final edges instead of trusting a producer-supplied ceiling or ID. */
export function validateObjectiveEvidenceRelationLedgerV1(value: unknown): RelationLedgerBuildResultV1 {
  if (!isRecord(value) || !hasExactKeys(value, ["version", "nodes", "edges", "ledgerDigest"]) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !isHash(value.ledgerDigest)) return invalid("ledger shape is invalid");
  const rebuilt = buildObjectiveEvidenceRelationLedgerV1({ nodes: value.nodes as RelationNodeV1[], edges: value.edges as RelationEdgeCandidateV1[] });
  if (!rebuilt.valid) return rebuilt;
  if (stableJson(rebuilt.ledger) !== stableJson(value)) return invalid("ledger was not independently recomputed");
  return rebuilt;
}

/** A component can be considered only after a release policy accepts this exact ledger. */
export function canUseRelationForReleasedReceiptV1(edge: ObjectiveEvidenceRelationV1, released: boolean): boolean {
  return released && edge.level === "verified" && (edge.consumerCeiling === "artifact_binding_component" || edge.consumerCeiling === "execution_binding_component" || edge.consumerCeiling === "test_binding_component");
}

function normalizeEdge(candidate: RelationEdgeCandidateV1, nodes: ReadonlyMap<string, RelationNodeV1>): ObjectiveEvidenceRelationV1 | null {
  if (!isCandidate(candidate) || !hasNoArrayHoles(candidate.evidenceRefs) || new Set(candidate.evidenceRefs).size !== candidate.evidenceRefs.length) return null;
  const from = nodes.get(candidate.fromNodeId);
  const to = nodes.get(candidate.toNodeId);
  if (!from || !to || from.subjectDigest !== candidate.subjectDigest || to.subjectDigest !== candidate.subjectDigest) return null;
  const consumerCeiling = deriveConsumerCeiling(candidate);
  if (!consumerCeiling) return null;
  const normalized: RelationEdgeCandidateV1 = {
    fromNodeId: candidate.fromNodeId,
    toNodeId: candidate.toNodeId,
    kind: candidate.kind,
    level: candidate.level,
    basis: candidate.basis,
    subjectDigest: candidate.subjectDigest,
    evidenceRefs: [...candidate.evidenceRefs].sort(),
    completeness: candidate.completeness
  };
  return {
    version: 1,
    id: `gpre_${digest({ domain: "agentproof.objective-evidence-edge.v1", edge: normalized }).slice(0, 24)}`,
    ...normalized,
    consumerCeiling
  };
}

function deriveConsumerCeiling(candidate: RelationEdgeCandidateV1): RelationConsumerCeilingV1 | null {
  if (candidate.basis === "semantic_proposal") return candidate.level === "hypothesis" && isSemanticKind(candidate.kind) ? "observation_only" : null;
  if (candidate.level !== "verified") return candidate.level === "hypothesis" ? null : "observation_only";
  if (candidate.completeness !== "complete") return null;
  if (["existing_bounded_js_ts_detector", "typescript_ast_relation", "acorn_syntax_relation"].includes(candidate.basis) && candidate.kind === "syntax_imports") return "test_relation_component";
  if (candidate.basis === "typescript_ast_relation" && candidate.kind === "direct_asserts") return "test_binding_component";
  if (candidate.basis === "github_execution_identity" && candidate.kind === "executed_in") return "execution_binding_component";
  if (candidate.basis === "runner_result" && candidate.kind === "reported_result") return "execution_binding_component";
  return null;
}

function objectiveEndpoint(edge: ObjectiveEvidenceRelationV1, nodes: ReadonlyMap<string, RelationNodeV1>): string | null {
  if (nodes.get(edge.fromNodeId)?.kind === "objective_group") return edge.fromNodeId;
  if (nodes.get(edge.toNodeId)?.kind === "objective_group") return edge.toNodeId;
  return null;
}

function isNode(value: unknown): value is RelationNodeV1 {
  return isRecord(value) && hasExactKeys(value, ["version", "id", "kind", "subjectDigest"]) && value.version === 1 && typeof value.id === "string" && value.id.length > 0 && isNodeKind(value.kind) && isHash(value.subjectDigest);
}
function isCandidate(value: unknown): value is RelationEdgeCandidateV1 {
  return isRecord(value) && hasExactKeys(value, ["fromNodeId", "toNodeId", "kind", "level", "basis", "subjectDigest", "evidenceRefs", "completeness"]) && typeof value.fromNodeId === "string" && typeof value.toNodeId === "string" && isEdgeKind(value.kind) && isLevel(value.level) && isBasis(value.basis) && isHash(value.subjectDigest) && Array.isArray(value.evidenceRefs) && value.evidenceRefs.every((item) => typeof item === "string" && item.length > 0) && isCompleteness(value.completeness);
}
function isNodeKind(value: unknown): value is RelationNodeKindV1 { return ["objective_group", "change_cluster", "test_artifact", "workflow_execution", "test_result", "evidence_atom"].includes(String(value)); }
function isEdgeKind(value: unknown): value is RelationEdgeKindV1 { return ["maps_to", "source_names_artifact", "syntax_imports", "direct_asserts", "executed_in", "reported_result", "semantic_supports", "semantic_contradicts"].includes(String(value)); }
function isLevel(value: unknown): value is RelationVerificationLevelV1 { return ["verified", "observed", "hypothesis", "unresolved", "unavailable"].includes(String(value)); }
function isBasis(value: unknown): value is RelationBasisV1 { return ["source_literal", "existing_bounded_js_ts_detector", "typescript_ast_relation", "acorn_syntax_relation", "runner_result", "github_execution_identity", "semantic_proposal"].includes(String(value)); }
function isCompleteness(value: unknown): value is RelationEdgeCandidateV1["completeness"] { return value === "complete" || value === "incomplete" || value === "unknown"; }
function isSemanticKind(value: RelationEdgeKindV1): boolean { return value === "semantic_supports" || value === "semantic_contradicts"; }
function compareById<T extends { id: string }>(left: T, right: T): number { return left.id.localeCompare(right.id); }
function invalid(error: string): RelationLedgerBuildResultV1 { return { valid: false, errors: [error] }; }
function isRecord(value: unknown): value is Record<string, unknown> { const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null; return Boolean(value) && !Array.isArray(value) && (prototype === Object.prototype || prototype === null); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function hasNoArrayHoles(value: readonly unknown[]): boolean { return Object.keys(value).length === value.length; }
function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
