import { createHash } from "node:crypto";
import {
  validateGeneralPrObservationSeedV2,
  type GeneralPrClaimRoleV2,
  type GeneralPrObservationSeedV2,
  type GeneralPrSemanticSpanV2
} from "./general-pr-observation-source";

export const GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION = "general_pr_semantic_proposal.v2" as const;
export const GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION = "agentproof_general_pr_observer_v2" as const;
export const GENERAL_PR_SEMANTIC_PROVIDER_SCHEMA_NAME = "agentproof_general_pr_observer_candidate_v1" as const;
export const GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES = 16_384;
export const GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS = 12;
export const GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS = 64;

const PROVIDER_ROOT_KEYS = [
  "spanRoles",
  "objectiveGroups",
  "testApplicabilityProposals",
  "scopeMappingProposals",
  "evidenceRelationProposals"
] as const;
const SPAN_ROLE_KEYS = ["spanId", "role", "abstained"] as const;
const PROVIDER_OBJECTIVE_GROUP_KEYS = ["spanIds", "disposition"] as const;
const PROVIDER_TEST_APPLICABILITY_KEYS = ["objectiveSpanIds", "changeClusterId", "proposal"] as const;
const PROVIDER_SCOPE_MAPPING_KEYS = ["objectiveSpanIds", "changeClusterId", "proposal"] as const;
const PROVIDER_EVIDENCE_RELATION_KEYS = ["objectiveSpanIds", "evidenceId", "proposal"] as const;

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

/** Private provider response. It contains no model-authored authority or seed binding. */
export interface GeneralPrSemanticProviderCandidateV1 {
  spanRoles: GeneralPrSemanticSpanRoleV2[];
  objectiveGroups: Array<{
    spanIds: string[];
    disposition: GeneralPrSemanticObjectiveGroupV2["disposition"];
  }>;
  testApplicabilityProposals: Array<{
    objectiveSpanIds: string[];
    changeClusterId: string;
    proposal: "likely_expected" | "likely_not_applicable" | "ambiguous";
  }>;
  scopeMappingProposals: Array<{
    objectiveSpanIds: string[];
    changeClusterId: string;
    proposal: "plausibly_mapped" | "unresolved";
  }>;
  evidenceRelationProposals: Array<{
    objectiveSpanIds: string[];
    evidenceId: string;
    proposal: "supports" | "tests" | "implements" | "contradicts" | "unresolved";
  }>;
}

/** Canonical post-validation proposal. Existing finalizers consume this shape. */
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
 * This is a bounded, provider-facing strict schema. IDs are data values in
 * arrays, never seed-derived object property names. The validator below is
 * still authoritative for reference validity and semantic ownership.
 */
export function buildGeneralPrSemanticProposalJsonSchemaV2(seed: GeneralPrObservationSeedV2): JsonSchema | null {
  if (!validateGeneralPrObservationSeedV2(seed).valid || seed.spans.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS) return null;
  const spanIds = seed.spans.map((span) => span.id);
  return exactObjectSchema(PROVIDER_ROOT_KEYS, {
    spanRoles: {
      type: "array",
      minItems: spanIds.length,
      maxItems: spanIds.length,
      items: exactObjectSchema(SPAN_ROLE_KEYS, {
        spanId: enumSchema(spanIds),
        role: enumSchema(ROLES),
        abstained: { type: "boolean" }
      })
    },
    objectiveGroups: {
      type: "array",
      maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS,
      items: exactObjectSchema(PROVIDER_OBJECTIVE_GROUP_KEYS, {
        spanIds: spanIdArraySchema(spanIds),
        disposition: enumSchema(["candidate", "not_objective", "ambiguous"])
      })
    },
    testApplicabilityProposals: relationArraySchema(
      PROVIDER_TEST_APPLICABILITY_KEYS,
      {
        objectiveSpanIds: spanIdArraySchema(spanIds),
        changeClusterId: idReferenceSchema(seed.changeClusters.map((cluster) => cluster.id)),
        proposal: enumSchema(["likely_expected", "likely_not_applicable", "ambiguous"])
      }
    ),
    scopeMappingProposals: relationArraySchema(
      PROVIDER_SCOPE_MAPPING_KEYS,
      {
        objectiveSpanIds: spanIdArraySchema(spanIds),
        changeClusterId: idReferenceSchema(seed.changeClusters.map((cluster) => cluster.id)),
        proposal: enumSchema(["plausibly_mapped", "unresolved"])
      }
    ),
    evidenceRelationProposals: relationArraySchema(
      PROVIDER_EVIDENCE_RELATION_KEYS,
      {
        objectiveSpanIds: spanIdArraySchema(spanIds),
        evidenceId: idReferenceSchema(seed.evidenceAtoms.map((atom) => atom.id)),
        proposal: enumSchema(["supports", "tests", "implements", "contradicts", "unresolved"])
      }
    )
  });
}

export function validateGeneralPrSemanticProposalV2(
  candidate: unknown,
  seed: GeneralPrObservationSeedV2,
  context: GeneralPrSemanticProposalValidationContextV2 = { currentSeedHash: seed.seedHash }
): GeneralPrSemanticProposalValidation {
  if (!validateGeneralPrObservationSeedV2(seed).valid) return invalid("seed is invalid");
  if (seed.spans.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS) return invalid("seed span limit exceeded");
  if (serializedBytes(candidate) > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES) return invalid("proposal output byte limit exceeded");
  if (!isRecord(candidate) || !hasExactKeys(candidate, PROVIDER_ROOT_KEYS)) return invalid("provider candidate root shape is invalid");
  if (context.currentSeedHash !== seed.seedHash) return invalid("proposal is stale");
  if (!Array.isArray(candidate.spanRoles) || !Array.isArray(candidate.objectiveGroups) || !Array.isArray(candidate.testApplicabilityProposals) || !Array.isArray(candidate.scopeMappingProposals) || !Array.isArray(candidate.evidenceRelationProposals)) return invalid("provider candidate collections are invalid");

  const spanIds = seed.spans.map((span) => span.id);
  const spansById = new Map(seed.spans.map((span, index) => [span.id, { span, index }]));
  const sourcesById = new Map(seed.sources.map((source) => [source.id, source]));
  const normalizedRoles = normalizeRoles(candidate.spanRoles, spanIds, spansById, sourcesById);
  if (!normalizedRoles) return invalid("provider span decisions are invalid");

  const normalizedGroups = normalizeGroups(candidate.objectiveGroups, normalizedRoles, spansById, sourcesById);
  if (!normalizedGroups) return invalid("provider objective groups are invalid");

  const clusterIds = new Set(seed.changeClusters.map((cluster) => cluster.id));
  const evidenceIds = new Set(seed.evidenceAtoms.map((atom) => atom.id));
  const testApplicabilityProposals = normalizeTestApplicability(candidate.testApplicabilityProposals, normalizedGroups, spansById, clusterIds);
  const scopeMappingProposals = normalizeScopeMappings(candidate.scopeMappingProposals, normalizedGroups, spansById, clusterIds);
  const evidenceRelationProposals = normalizeEvidenceRelations(candidate.evidenceRelationProposals, normalizedGroups, spansById, evidenceIds);
  if (!testApplicabilityProposals || !scopeMappingProposals || !evidenceRelationProposals) return invalid("provider relation proposal is invalid");

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

function normalizeRoles(
  values: unknown[],
  spanIds: string[],
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>,
  sourcesById: ReadonlyMap<string, GeneralPrObservationSeedV2["sources"][number]>
): Record<string, GeneralPrSemanticSpanRoleV2> | null {
  if (values.length !== spanIds.length || !hasNoArrayHoles(values)) return null;
  const normalized: Record<string, GeneralPrSemanticSpanRoleV2> = {};
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, SPAN_ROLE_KEYS) || typeof value.spanId !== "string" || !isRole(value.role) || typeof value.abstained !== "boolean") return null;
    if (normalized[value.spanId] || !spanIds.includes(value.spanId)) return null;
    const entry = spansById.get(value.spanId);
    const source = entry ? sourcesById.get(entry.span.sourceUnitId) : undefined;
    if (!entry || !source) return null;
    if (value.abstained && value.role !== "mixed_or_ambiguous") return null;
    if (entry.span.deterministicRole === "template_or_process" && value.role !== "template_or_process") return null;
    if (source.roleCeiling !== "objective" && value.role === "objective_candidate") return null;
    normalized[value.spanId] = { spanId: value.spanId, role: value.role, abstained: value.abstained };
  }
  return spanIds.every((spanId) => normalized[spanId] !== undefined) ? normalized : null;
}

function normalizeGroups(
  values: unknown[],
  roles: Record<string, GeneralPrSemanticSpanRoleV2>,
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>,
  sourcesById: ReadonlyMap<string, GeneralPrObservationSeedV2["sources"][number]>
): Record<string, GeneralPrSemanticObjectiveGroupV2> | null {
  if (values.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS || !hasNoArrayHoles(values)) return null;
  const normalized: Record<string, GeneralPrSemanticObjectiveGroupV2> = {};
  const objectiveMembership = new Map<string, number>();
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, PROVIDER_OBJECTIVE_GROUP_KEYS) || !isObjectiveDisposition(value.disposition)) return null;
    const entries = resolveSpanEntries(value.spanIds, spansById);
    if (!entries || !isContiguousSourceSequence(entries, sourcesById)) return null;
    const groupId = deriveGeneralPrObjectiveGroupIdV2(entries.map(({ span }) => span.id));
    if (normalized[groupId]) return null;
    if (value.disposition === "candidate") {
      if (entries.some(({ span }) => {
        const source = sourcesById.get(span.sourceUnitId);
        return source?.roleCeiling !== "objective" || span.deterministicRole === "template_or_process" || roles[span.id]?.role !== "objective_candidate";
      })) return null;
      for (const { span } of entries) objectiveMembership.set(span.id, (objectiveMembership.get(span.id) ?? 0) + 1);
    }
    normalized[groupId] = { groupId, spanIds: entries.map(({ span }) => span.id), disposition: value.disposition };
  }
  if (Object.values(roles).some((role) => role.role === "objective_candidate" && objectiveMembership.get(role.spanId) !== 1)) return null;
  return [...objectiveMembership.values()].some((count) => count !== 1) ? null : normalized;
}

function normalizeTestApplicability(
  values: unknown[],
  groups: Record<string, GeneralPrSemanticObjectiveGroupV2>,
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>,
  clusterIds: ReadonlySet<string>
): GeneralPrSemanticProposalV2["testApplicabilityProposals"] | null {
  return normalizeRelations(values, PROVIDER_TEST_APPLICABILITY_KEYS, groups, spansById, clusterIds, "changeClusterId", ["likely_expected", "likely_not_applicable", "ambiguous"]);
}

function normalizeScopeMappings(
  values: unknown[],
  groups: Record<string, GeneralPrSemanticObjectiveGroupV2>,
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>,
  clusterIds: ReadonlySet<string>
): GeneralPrSemanticProposalV2["scopeMappingProposals"] | null {
  return normalizeRelations(values, PROVIDER_SCOPE_MAPPING_KEYS, groups, spansById, clusterIds, "changeClusterId", ["plausibly_mapped", "unresolved"]);
}

function normalizeEvidenceRelations(
  values: unknown[],
  groups: Record<string, GeneralPrSemanticObjectiveGroupV2>,
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>,
  evidenceIds: ReadonlySet<string>
): GeneralPrSemanticProposalV2["evidenceRelationProposals"] | null {
  return normalizeRelations(values, PROVIDER_EVIDENCE_RELATION_KEYS, groups, spansById, evidenceIds, "evidenceId", ["supports", "tests", "implements", "contradicts", "unresolved"]);
}

function normalizeRelations<
  Field extends "changeClusterId" | "evidenceId",
  Proposal extends string
>(
  values: unknown[],
  keys: readonly string[],
  groups: Record<string, GeneralPrSemanticObjectiveGroupV2>,
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>,
  referenceIds: ReadonlySet<string>,
  referenceField: Field,
  allowedProposals: readonly Proposal[]
): Array<{ objectiveGroupId: string } & Record<Field, string> & { proposal: Proposal }> | null {
  if (values.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS || !hasNoArrayHoles(values)) return null;
  const proposals: Array<{ objectiveGroupId: string } & Record<Field, string> & { proposal: Proposal }> = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, keys) || typeof value[referenceField] !== "string" || !referenceIds.has(value[referenceField] as string) || !allowedProposals.includes(value.proposal as Proposal)) return null;
    const entries = resolveSpanEntries(value.objectiveSpanIds, spansById);
    if (!entries) return null;
    const objectiveGroupId = deriveGeneralPrObjectiveGroupIdV2(entries.map(({ span }) => span.id));
    if (!groups[objectiveGroupId]) return null;
    const referenceId = value[referenceField] as string;
    const key = `${objectiveGroupId}:${referenceId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    proposals.push({ objectiveGroupId, [referenceField]: referenceId, proposal: value.proposal as Proposal } as { objectiveGroupId: string } & Record<Field, string> & { proposal: Proposal });
  }
  return proposals;
}

function resolveSpanEntries(
  value: unknown,
  spansById: ReadonlyMap<string, { span: GeneralPrSemanticSpanV2; index: number }>
): Array<{ span: GeneralPrSemanticSpanV2; index: number }> | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS || !hasNoArrayHoles(value) || !value.every((spanId): spanId is string => typeof spanId === "string" && spansById.has(spanId)) || new Set(value).size !== value.length) return null;
  return value.map((spanId) => spansById.get(spanId)!);
}

function isContiguousSourceSequence(
  entries: Array<{ span: GeneralPrSemanticSpanV2; index: number }>,
  sourcesById: ReadonlyMap<string, GeneralPrObservationSeedV2["sources"][number]>
): boolean {
  const first = entries[0];
  const source = first ? sourcesById.get(first.span.sourceUnitId) : undefined;
  return Boolean(source) && entries.every((entry, index) =>
    entry.span.sourceUnitId === source!.id &&
    sourcesById.get(entry.span.sourceUnitId)?.authority === source!.authority &&
    (index === 0 || entries[index - 1]!.index + 1 === entry.index)
  );
}

function spanIdArraySchema(spanIds: readonly string[]): JsonSchema {
  return { type: "array", minItems: 1, maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS, items: enumSchema(spanIds) };
}

function relationArraySchema(keys: readonly string[], properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "array", maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS, items: exactObjectSchema(keys, properties) };
}

function idReferenceSchema(ids: readonly string[]): JsonSchema {
  return ids.length > 0 ? enumSchema(ids) : { type: "string", minLength: 1, maxLength: 120 };
}

function exactObjectSchema(keys: readonly string[], properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", additionalProperties: false, required: [...keys], properties };
}

function enumSchema(values: readonly unknown[]): JsonSchema { return { enum: [...values] }; }
function isObjectiveDisposition(value: unknown): value is GeneralPrSemanticObjectiveGroupV2["disposition"] { return value === "candidate" || value === "not_objective" || value === "ambiguous"; }
function isRole(value: unknown): value is GeneralPrClaimRoleV2 { return typeof value === "string" && ROLES.includes(value as GeneralPrClaimRoleV2); }
function invalid(error: string): GeneralPrSemanticProposalValidation { return { valid: false, errors: [error] }; }
function isRecord(value: unknown): value is Record<string, unknown> { const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null; return Boolean(value) && !Array.isArray(value) && (prototype === Object.prototype || prototype === null); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function hasNoArrayHoles(value: readonly unknown[]): boolean { return Object.keys(value).length === value.length; }
function serializedBytes(value: unknown): number { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; } }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
