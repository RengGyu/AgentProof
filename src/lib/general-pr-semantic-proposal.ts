import { createHash } from "node:crypto";
import {
  validateGeneralPrObservationSeedV2,
  type GeneralPrClaimRoleV2,
  type GeneralPrObservationSeedV2,
  type GeneralPrSemanticSpanV2
} from "./general-pr-observation-source";

export const GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION = "general_pr_semantic_proposal.v2" as const;
export const GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION = "agentproof_general_pr_observer_v2" as const;
export const GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES = 16_384;
export const GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS = 12;
export const GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS = 64;

const ROOT_KEYS = [
  "contractVersion",
  "schemaVersion",
  "seedHash",
  "spanRoles",
  "objectiveGroups",
  "testApplicabilityProposals",
  "scopeMappingProposals",
  "evidenceRelationProposals"
] as const;
const SPAN_ROLE_KEYS = ["spanId", "role", "abstained"] as const;
const OBJECTIVE_GROUP_KEYS = ["groupId", "spanIds", "disposition"] as const;
const TEST_APPLICABILITY_KEYS = ["objectiveGroupId", "changeClusterId", "proposal"] as const;
const SCOPE_MAPPING_KEYS = ["objectiveGroupId", "changeClusterId", "proposal"] as const;
const EVIDENCE_RELATION_KEYS = ["objectiveGroupId", "evidenceId", "proposal"] as const;

const ROLES: readonly GeneralPrClaimRoleV2[] = [
  "objective_candidate",
  "problem_observation",
  "implementation_claim",
  "test_claim",
  "scope_exclusion",
  "known_limitation",
  "risk_or_revert",
  "follow_up",
  "template_or_process",
  "supporting_context",
  "mixed_or_ambiguous"
];

export interface GeneralPrSemanticSpanRoleV2 {
  spanId: string;
  role: GeneralPrClaimRoleV2;
  abstained: boolean;
}

export interface GeneralPrSemanticObjectiveGroupV2 {
  groupId: string;
  spanIds: string[];
  disposition: "candidate" | "not_objective" | "ambiguous";
}

export interface GeneralPrSemanticProposalV2 {
  contractVersion: typeof GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION;
  schemaVersion: typeof GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION;
  seedHash: string;
  spanRoles: Record<string, GeneralPrSemanticSpanRoleV2>;
  objectiveGroups: Record<string, GeneralPrSemanticObjectiveGroupV2>;
  testApplicabilityProposals: Array<{
    objectiveGroupId: string;
    changeClusterId: string;
    proposal: "likely_expected" | "likely_not_applicable" | "ambiguous";
  }>;
  scopeMappingProposals: Array<{
    objectiveGroupId: string;
    changeClusterId: string;
    proposal: "plausibly_mapped" | "unresolved";
  }>;
  evidenceRelationProposals: Array<{
    objectiveGroupId: string;
    evidenceId: string;
    proposal: "supports" | "tests" | "implements" | "contradicts" | "unresolved";
  }>;
}

export interface GeneralPrSemanticInvocationReceiptV2 {
  version: 2;
  seedHash: string;
  promptHash: string;
  schemaHash: string;
  modelProfileHash: string;
  outputHash: string | null;
  state: "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  durationBucket: "lt_1s" | "1_3s" | "3_8s" | "gte_8s" | "unknown";
}

export type GeneralPrSemanticProposalValidation =
  | { valid: true; proposal: GeneralPrSemanticProposalV2; errors: [] }
  | { valid: false; errors: string[] };

export interface GeneralPrSemanticProposalValidationContextV2 {
  /** The post-provider seed hash after raw-source and subject freshness revalidation. */
  currentSeedHash: string;
}

type JsonSchema = Record<string, unknown>;

export function deriveGeneralPrObjectiveGroupIdV2(spanIds: readonly string[]): string {
  return `gpog_${digest({ domain: "agentproof.general-pr.objective-group.v2", spanIds: [...spanIds] }).slice(0, 24)}`;
}

export function hashGeneralPrSemanticProposalV2(proposal: GeneralPrSemanticProposalV2): string {
  return digest({ domain: "agentproof.general-pr.semantic-proposal.v2", proposal });
}

export function hashGeneralPrSemanticInvocationReceiptV2(receipt: GeneralPrSemanticInvocationReceiptV2): string {
  return digest({ domain: "agentproof.general-pr.semantic-invocation-receipt.v2", receipt });
}

/**
 * This is a bounded provider schema. It is intentionally an ID-only language;
 * the independent validator below remains the authority for every relation.
 */
export function buildGeneralPrSemanticProposalJsonSchemaV2(seed: GeneralPrObservationSeedV2): JsonSchema | null {
  if (!validateGeneralPrObservationSeedV2(seed).valid || seed.spans.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS) return null;
  const groupIds = possibleContiguousGroupIds(seed);
  return {
    type: "object",
    additionalProperties: false,
    required: [...ROOT_KEYS],
    properties: {
      contractVersion: enumSchema([GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION]),
      schemaVersion: enumSchema([GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION]),
      seedHash: enumSchema([seed.seedHash]),
      spanRoles: {
        type: "object",
        additionalProperties: false,
        required: seed.spans.map((span) => span.id),
        properties: Object.fromEntries(seed.spans.map((span) => [span.id, spanRoleSchema(span.id)]))
      },
      objectiveGroups: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(groupIds.map((groupId) => [groupId, objectiveGroupSchema(groupId, seed.spans.map((span) => span.id))]))
      },
      testApplicabilityProposals: { type: "array", maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS, items: testApplicabilitySchema(seed, groupIds) },
      scopeMappingProposals: { type: "array", maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS, items: scopeMappingSchema(seed, groupIds) },
      evidenceRelationProposals: { type: "array", maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS, items: evidenceRelationSchema(seed, groupIds) }
    }
  };
}

export function validateGeneralPrSemanticProposalV2(
  candidate: unknown,
  seed: GeneralPrObservationSeedV2,
  context: GeneralPrSemanticProposalValidationContextV2 = { currentSeedHash: seed.seedHash }
): GeneralPrSemanticProposalValidation {
  if (!validateGeneralPrObservationSeedV2(seed).valid) return invalid("seed is invalid");
  if (seed.spans.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS) return invalid("seed span limit exceeded");
  if (serializedBytes(candidate) > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES) return invalid("proposal output byte limit exceeded");
  if (!isRecord(candidate) || !hasExactKeys(candidate, ROOT_KEYS)) return invalid("proposal root shape is invalid");
  if (candidate.contractVersion !== GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION || candidate.schemaVersion !== GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION || candidate.seedHash !== seed.seedHash) return invalid("proposal version or seed binding is invalid");
  if (context.currentSeedHash !== seed.seedHash) return invalid("proposal is stale");
  if (!isRecord(candidate.spanRoles) || !isRecord(candidate.objectiveGroups) || !Array.isArray(candidate.testApplicabilityProposals) || !Array.isArray(candidate.scopeMappingProposals) || !Array.isArray(candidate.evidenceRelationProposals)) return invalid("proposal collections are invalid");

  const spanIds = seed.spans.map((span) => span.id);
  if (!hasExactKeys(candidate.spanRoles, spanIds)) return invalid("proposal must decide every seed span exactly once");
  const spansById = new Map(seed.spans.map((span, index) => [span.id, { span, index }]));
  const sourcesById = new Map(seed.sources.map((source) => [source.id, source]));
  const normalizedRoles: Record<string, GeneralPrSemanticSpanRoleV2> = {};
  for (const spanId of spanIds) {
    const spanEntry = spansById.get(spanId);
    const value = candidate.spanRoles[spanId];
    if (!spanEntry || !isRecord(value) || !hasExactKeys(value, SPAN_ROLE_KEYS) || value.spanId !== spanId || !isRole(value.role) || typeof value.abstained !== "boolean") return invalid("span role shape is invalid");
    const source = sourcesById.get(spanEntry.span.sourceUnitId);
    if (!source) return invalid("span source is unknown");
    if (value.abstained && value.role !== "mixed_or_ambiguous") return invalid("abstention must be explicit ambiguity");
    if (spanEntry.span.deterministicRole === "template_or_process" && value.role !== "template_or_process") return invalid("excluded or template span cannot be promoted");
    if (source.roleCeiling !== "objective" && value.role === "objective_candidate") return invalid("context-only span cannot become an objective");
    normalizedRoles[spanId] = { spanId, role: value.role, abstained: value.abstained };
  }

  const normalizedGroups: Record<string, GeneralPrSemanticObjectiveGroupV2> = {};
  const objectiveMembership = new Map<string, number>();
  for (const [key, rawGroup] of Object.entries(candidate.objectiveGroups)) {
    if (!isRecord(rawGroup) || !hasExactKeys(rawGroup, OBJECTIVE_GROUP_KEYS) || rawGroup.groupId !== key || !Array.isArray(rawGroup.spanIds) || rawGroup.spanIds.length === 0 || rawGroup.spanIds.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS || !hasNoArrayHoles(rawGroup.spanIds) || !isObjectiveDisposition(rawGroup.disposition)) return invalid("objective group shape is invalid");
    if (!rawGroup.spanIds.every((spanId): spanId is string => typeof spanId === "string" && spansById.has(spanId)) || new Set(rawGroup.spanIds).size !== rawGroup.spanIds.length) return invalid("objective group span reference is invalid");
    if (deriveGeneralPrObjectiveGroupIdV2(rawGroup.spanIds) !== rawGroup.groupId) return invalid("objective group ID is forged");
    const entries = rawGroup.spanIds.map((spanId) => spansById.get(spanId)!);
    if (!isSourceOrdered(entries) || new Set(entries.map(({ span }) => sourcesById.get(span.sourceUnitId)?.authority)).size !== 1) return invalid("objective group mixes or reorders source authority");
    if (rawGroup.disposition === "candidate") {
      if (entries.some(({ span }) => sourcesById.get(span.sourceUnitId)?.roleCeiling !== "objective" || span.deterministicRole === "template_or_process" || normalizedRoles[span.id]?.role !== "objective_candidate")) return invalid("candidate objective group is not eligible");
      for (const { span } of entries) objectiveMembership.set(span.id, (objectiveMembership.get(span.id) ?? 0) + 1);
    }
    normalizedGroups[key] = { groupId: rawGroup.groupId, spanIds: [...rawGroup.spanIds], disposition: rawGroup.disposition };
  }
  for (const [spanId, role] of Object.entries(normalizedRoles)) {
    if (role.role === "objective_candidate" && (objectiveMembership.get(spanId) ?? 0) !== 1) return invalid("objective candidate must have exactly one candidate group");
  }
  if ([...objectiveMembership.values()].some((count) => count !== 1)) return invalid("objective group ownership is duplicated");

  const groupIds = new Set(Object.keys(normalizedGroups));
  const clusterIds = new Set(seed.changeClusters.map((cluster) => cluster.id));
  const evidenceIds = new Set(seed.evidenceAtoms.map((atom) => atom.id));
  const testApplicabilityProposals = validateTestApplicability(candidate.testApplicabilityProposals, groupIds, clusterIds);
  const scopeMappingProposals = validateScopeMappings(candidate.scopeMappingProposals, groupIds, clusterIds);
  const evidenceRelationProposals = validateEvidenceRelations(candidate.evidenceRelationProposals, groupIds, evidenceIds);
  if (!testApplicabilityProposals || !scopeMappingProposals || !evidenceRelationProposals) return invalid("relation proposal is invalid");

  return {
    valid: true,
    proposal: {
      contractVersion: GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
      schemaVersion: GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION,
      seedHash: seed.seedHash,
      spanRoles: normalizedRoles,
      objectiveGroups: normalizedGroups,
      testApplicabilityProposals,
      scopeMappingProposals,
      evidenceRelationProposals
    },
    errors: []
  };
}

function validateTestApplicability(value: unknown[], groupIds: ReadonlySet<string>, clusterIds: ReadonlySet<string>): GeneralPrSemanticProposalV2["testApplicabilityProposals"] | null {
  if (value.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS || !hasNoArrayHoles(value)) return null;
  const proposals: GeneralPrSemanticProposalV2["testApplicabilityProposals"] = [];
  const keys = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, TEST_APPLICABILITY_KEYS) || !groupIds.has(String(item.objectiveGroupId)) || !clusterIds.has(String(item.changeClusterId)) || !["likely_expected", "likely_not_applicable", "ambiguous"].includes(String(item.proposal))) return null;
    const key = `${item.objectiveGroupId}:${item.changeClusterId}`;
    if (keys.has(key)) return null;
    keys.add(key);
    proposals.push({ objectiveGroupId: item.objectiveGroupId as string, changeClusterId: item.changeClusterId as string, proposal: item.proposal as GeneralPrSemanticProposalV2["testApplicabilityProposals"][number]["proposal"] });
  }
  return proposals;
}

function validateScopeMappings(value: unknown[], groupIds: ReadonlySet<string>, clusterIds: ReadonlySet<string>): GeneralPrSemanticProposalV2["scopeMappingProposals"] | null {
  if (value.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS || !hasNoArrayHoles(value)) return null;
  const proposals: GeneralPrSemanticProposalV2["scopeMappingProposals"] = [];
  const keys = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, SCOPE_MAPPING_KEYS) || !groupIds.has(String(item.objectiveGroupId)) || !clusterIds.has(String(item.changeClusterId)) || !["plausibly_mapped", "unresolved"].includes(String(item.proposal))) return null;
    const key = `${item.objectiveGroupId}:${item.changeClusterId}`;
    if (keys.has(key)) return null;
    keys.add(key);
    proposals.push({ objectiveGroupId: item.objectiveGroupId as string, changeClusterId: item.changeClusterId as string, proposal: item.proposal as GeneralPrSemanticProposalV2["scopeMappingProposals"][number]["proposal"] });
  }
  return proposals;
}

function validateEvidenceRelations(value: unknown[], groupIds: ReadonlySet<string>, evidenceIds: ReadonlySet<string>): GeneralPrSemanticProposalV2["evidenceRelationProposals"] | null {
  if (value.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS || !hasNoArrayHoles(value)) return null;
  const proposals: GeneralPrSemanticProposalV2["evidenceRelationProposals"] = [];
  const keys = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactKeys(item, EVIDENCE_RELATION_KEYS) || !groupIds.has(String(item.objectiveGroupId)) || !evidenceIds.has(String(item.evidenceId)) || !["supports", "tests", "implements", "contradicts", "unresolved"].includes(String(item.proposal))) return null;
    const key = `${item.objectiveGroupId}:${item.evidenceId}`;
    if (keys.has(key)) return null;
    keys.add(key);
    proposals.push({ objectiveGroupId: item.objectiveGroupId as string, evidenceId: item.evidenceId as string, proposal: item.proposal as GeneralPrSemanticProposalV2["evidenceRelationProposals"][number]["proposal"] });
  }
  return proposals;
}

function possibleContiguousGroupIds(seed: GeneralPrObservationSeedV2): string[] {
  const groups: string[] = [];
  for (let start = 0; start < seed.spans.length; start += 1) {
    for (let end = start + 1; end <= seed.spans.length; end += 1) {
      const spans = seed.spans.slice(start, end);
      const firstSource = seed.sources.find((source) => source.id === spans[0]?.sourceUnitId);
      if (!firstSource || spans.some((span) => seed.sources.find((source) => source.id === span.sourceUnitId)?.authority !== firstSource.authority)) break;
      groups.push(deriveGeneralPrObjectiveGroupIdV2(spans.map((span) => span.id)));
    }
  }
  return groups;
}

function spanRoleSchema(spanId: string): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: [...SPAN_ROLE_KEYS],
    properties: { spanId: enumSchema([spanId]), role: enumSchema(ROLES), abstained: { type: "boolean" } }
  };
}

function objectiveGroupSchema(groupId: string, spanIds: string[]): JsonSchema {
  return {
    type: "object",
    additionalProperties: false,
    required: [...OBJECTIVE_GROUP_KEYS],
    properties: {
      groupId: enumSchema([groupId]),
      spanIds: { type: "array", minItems: 1, maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS, items: enumSchema(spanIds) },
      disposition: enumSchema(["candidate", "not_objective", "ambiguous"])
    }
  };
}

function testApplicabilitySchema(seed: GeneralPrObservationSeedV2, groupIds: string[]): JsonSchema {
  return exactObjectSchema(TEST_APPLICABILITY_KEYS, {
    objectiveGroupId: enumSchema(groupIds),
    changeClusterId: enumSchema(seed.changeClusters.map((cluster) => cluster.id)),
    proposal: enumSchema(["likely_expected", "likely_not_applicable", "ambiguous"])
  });
}

function scopeMappingSchema(seed: GeneralPrObservationSeedV2, groupIds: string[]): JsonSchema {
  return exactObjectSchema(SCOPE_MAPPING_KEYS, {
    objectiveGroupId: enumSchema(groupIds),
    changeClusterId: enumSchema(seed.changeClusters.map((cluster) => cluster.id)),
    proposal: enumSchema(["plausibly_mapped", "unresolved"])
  });
}

function evidenceRelationSchema(seed: GeneralPrObservationSeedV2, groupIds: string[]): JsonSchema {
  return exactObjectSchema(EVIDENCE_RELATION_KEYS, {
    objectiveGroupId: enumSchema(groupIds),
    evidenceId: enumSchema(seed.evidenceAtoms.map((atom) => atom.id)),
    proposal: enumSchema(["supports", "tests", "implements", "contradicts", "unresolved"])
  });
}

function exactObjectSchema(keys: readonly string[], properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", additionalProperties: false, required: [...keys], properties };
}

function enumSchema(values: readonly unknown[]): JsonSchema { return { enum: [...values] }; }
function isSourceOrdered(entries: Array<{ span: GeneralPrSemanticSpanV2; index: number }>): boolean { return entries.every((entry, index) => index === 0 || entries[index - 1]!.index < entry.index); }
function isObjectiveDisposition(value: unknown): value is GeneralPrSemanticObjectiveGroupV2["disposition"] { return value === "candidate" || value === "not_objective" || value === "ambiguous"; }
function isRole(value: unknown): value is GeneralPrClaimRoleV2 { return typeof value === "string" && ROLES.includes(value as GeneralPrClaimRoleV2); }
function invalid(error: string): GeneralPrSemanticProposalValidation { return { valid: false, errors: [error] }; }
function isRecord(value: unknown): value is Record<string, unknown> { const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null; return Boolean(value) && !Array.isArray(value) && (prototype === Object.prototype || prototype === null); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function hasNoArrayHoles(value: readonly unknown[]): boolean { return Object.keys(value).length === value.length; }
function serializedBytes(value: unknown): number { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; } }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
