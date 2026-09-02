import { createHash } from "node:crypto";
import {
  validateGeneralPrObservationSeedV2,
  type GeneralPrClaimRoleV2,
  type GeneralPrObservationSeedV2,
  type GeneralPrSemanticSpanV2
} from "./general-pr-observation-source";
import {
  computeGeneralPrSemanticEvidenceSelectionHashV1,
  type GeneralPrSemanticEvidenceDescriptorV1,
  type GeneralPrSemanticEvidenceSelectionV1
} from "./general-pr-semantic-evidence-selection";
import {
  computeGeneralPrSemanticClaimSelectionHashV1,
  GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION,
  type GeneralPrSemanticClaimSelectionV1
} from "./general-pr-semantic-selection";

export const GENERAL_PR_SEMANTIC_PROPOSAL_CONTRACT_VERSION = "general_pr_semantic_proposal.v2" as const;
export const GENERAL_PR_SEMANTIC_PROPOSAL_SCHEMA_VERSION = "agentproof_general_pr_observer_v2" as const;
export const GENERAL_PR_SEMANTIC_CLAIM_SCHEMA_NAME = "agentproof_general_pr_claim_candidate_v1" as const;
export const GENERAL_PR_SEMANTIC_EVIDENCE_SCHEMA_NAME = "agentproof_general_pr_evidence_candidate_v1" as const;
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
const CLAIM_ROOT_KEYS = ["spanRoles", "objectiveGroups"] as const;
const EVIDENCE_ROOT_KEYS = ["testApplicabilityProposals", "scopeMappingProposals", "evidenceRelationProposals"] as const;
const CLAIM_SELECTION_KEYS = ["version", "parentSeedHash", "claimSelectionHash", "selectedSpanIds", "selectedSpans", "coverage", "omittedReasonCounts"] as const;
const CLAIM_SELECTED_SPAN_KEYS = ["spanId", "sourceUnitId", "authority", "sourceRole", "structuralKind", "deterministicRole", "text"] as const;
const OMITTED_CLAIM_KEYS = ["spanBudget", "inputByteBudget"] as const;
const EVIDENCE_SELECTION_KEYS = ["version", "policyVersion", "limits", "parentSeedHash", "claimSelectionHash", "evidenceSelectionHash", "objectiveGroups", "changeClusterDescriptors", "evidenceDescriptors", "coverage", "omittedReasonCounts"] as const;
const EVIDENCE_LIMIT_KEYS = ["maxPerObjective", "maxTotal", "maxInputBytes"] as const;
const EVIDENCE_SELECTION_GROUP_KEYS = ["objectiveSpanIds", "changeClusterIds", "evidenceIds"] as const;
const CHANGE_CLUSTER_DESCRIPTOR_KEYS = ["changeClusterId", "roleCandidates", "languages", "tokenSketch", "completeness", "relationBasis"] as const;
const EVIDENCE_DESCRIPTOR_KEYS = ["evidenceId", "kind", "roleCandidates", "language", "changeStatus", "tokenSketch", "completeness", "subjectBinding", "relationBasis"] as const;
const OMITTED_EVIDENCE_KEYS = ["evidenceBudget", "inputByteBudget", "unsafeDescriptor", "noDeterministicSignal"] as const;

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

export type GeneralPrSemanticDurationBucketV1 = "lt_1s" | "1_3s" | "3_8s" | "gte_8s" | "unknown";

export interface GeneralPrSemanticInvocationReceiptV3 {
  version: 3;
  seedHash: string;
  claimSelectionHash: string | null;
  evidenceSelectionHash: string | null;
  selectionHash: string | null;
  modelProfileHash: string;
  claimPromptHash: string;
  claimSchemaHash: string;
  claimOutputHash: string | null;
  evidencePromptHash: string | null;
  evidenceSchemaHash: string | null;
  evidenceOutputHash: string | null;
  claimState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  evidenceState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  durationBucket: GeneralPrSemanticDurationBucketV1;
}

export type GeneralPrSemanticProposalValidation =
  | { valid: true; proposal: GeneralPrSemanticProposalV2; errors: [] }
  | { valid: false; errors: string[] };

export type GeneralPrSemanticClaimValidationV1 =
  | {
      valid: true;
      parentSeedHash: string;
      claimSelectionHash: string;
      spanRoles: GeneralPrSemanticSpanRoleV2[];
      objectiveGroups: GeneralPrSemanticProviderCandidateV1["objectiveGroups"];
      errors: [];
    }
  | { valid: false; errors: string[] };

export type GeneralPrSemanticEvidenceValidationV1 =
  | {
      valid: true;
      parentSeedHash: string;
      evidenceSelectionHash: string;
      testApplicabilityProposals: GeneralPrSemanticProviderCandidateV1["testApplicabilityProposals"];
      scopeMappingProposals: GeneralPrSemanticProviderCandidateV1["scopeMappingProposals"];
      evidenceRelationProposals: GeneralPrSemanticProviderCandidateV1["evidenceRelationProposals"];
      errors: [];
    }
  | { valid: false; errors: string[] };

type ValidatedClaimResultV1 = Extract<GeneralPrSemanticClaimValidationV1, { valid: true }>;
type ValidatedEvidenceResultV1 = Extract<GeneralPrSemanticEvidenceValidationV1, { valid: true }>;
interface ValidatedEvidenceRegistrationV1 {
  claimSnapshot: ValidatedClaimResultV1;
  evidenceSnapshot: ValidatedEvidenceResultV1;
}

const VALIDATED_CLAIM_RESULTS = new WeakMap<object, ValidatedClaimResultV1>();
const VALIDATED_EVIDENCE_RESULTS = new WeakMap<object, ValidatedEvidenceRegistrationV1>();

type JsonSchema = Record<string, unknown>;

export function deriveGeneralPrObjectiveGroupIdV2(spanIds: readonly string[]): string {
  return `gpog_${digest({ domain: "agentproof.general-pr.objective-group.v2", spanIds: [...spanIds] }).slice(0, 24)}`;
}

export function hashGeneralPrSemanticProposalV2(proposal: GeneralPrSemanticProposalV2): string {
  return digest({ domain: "agentproof.general-pr.semantic-proposal.v2", proposal });
}

export function hashGeneralPrSemanticInvocationReceiptV3(receipt: GeneralPrSemanticInvocationReceiptV3): string {
  return digest({ domain: "agentproof.general-pr.semantic-invocation-receipt.v3", receipt });
}

export function buildGeneralPrSemanticClaimJsonSchemaV1(selection: GeneralPrSemanticClaimSelectionV1): JsonSchema {
  const spanIds = selection.selectedSpanIds;
  return exactObjectSchema(CLAIM_ROOT_KEYS, {
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
      maxItems: spanIds.length,
      items: exactObjectSchema(PROVIDER_OBJECTIVE_GROUP_KEYS, {
        spanIds: spanIdArraySchema(spanIds),
        disposition: enumSchema(["candidate", "not_objective", "ambiguous"])
      })
    }
  });
}

export function buildGeneralPrSemanticEvidenceJsonSchemaV1(selection: GeneralPrSemanticEvidenceSelectionV1): JsonSchema {
  return exactObjectSchema(EVIDENCE_ROOT_KEYS, {
    testApplicabilityProposals: selectedRelationArraySchema(selection.objectiveGroups, "changeClusterIds", PROVIDER_TEST_APPLICABILITY_KEYS, "changeClusterId", ["likely_expected", "likely_not_applicable", "ambiguous"]),
    scopeMappingProposals: selectedRelationArraySchema(selection.objectiveGroups, "changeClusterIds", PROVIDER_SCOPE_MAPPING_KEYS, "changeClusterId", ["plausibly_mapped", "unresolved"]),
    evidenceRelationProposals: selectedRelationArraySchema(selection.objectiveGroups, "evidenceIds", PROVIDER_EVIDENCE_RELATION_KEYS, "evidenceId", ["supports", "tests", "implements", "contradicts", "unresolved"])
  });
}

export function validateGeneralPrSemanticClaimCandidateV1(
  value: unknown,
  seed: GeneralPrObservationSeedV2,
  selection: GeneralPrSemanticClaimSelectionV1
): GeneralPrSemanticClaimValidationV1 {
  if (!validateGeneralPrObservationSeedV2(seed).valid) return invalidClaim("seed is invalid");
  const selectedEntries = validateClaimSelection(seed, selection);
  if (!selectedEntries) return invalidClaim("claim selection binding is invalid");
  if (serializedBytes(value) > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES) return invalidClaim("claim output byte limit exceeded");
  if (!isRecord(value) || !hasExactKeys(value, CLAIM_ROOT_KEYS) || !Array.isArray(value.spanRoles) || !Array.isArray(value.objectiveGroups)) return invalidClaim("claim candidate root shape is invalid");
  const sourcesById = new Map(seed.sources.map((source) => [source.id, source]));
  const selectedById = new Map(selectedEntries.map((entry) => [entry.span.id, entry]));
  const normalizedSelectedRoles = normalizeRoles(value.spanRoles, selection.selectedSpanIds, selectedById, sourcesById);
  if (!normalizedSelectedRoles) return invalidClaim("claim span decisions are invalid");
  const normalizedGroups = normalizeGroups(value.objectiveGroups, normalizedSelectedRoles, selectedById, sourcesById);
  if (!normalizedGroups) return invalidClaim("claim objective groups are invalid");
  const spanRoles = seed.spans.map((span) => normalizedSelectedRoles[span.id] ?? deterministicUnselectedRole(span));
  const objectiveGroups = Object.values(normalizedGroups).map(({ spanIds, disposition }) => ({ spanIds, disposition }));
  return registerValidatedStageResult(VALIDATED_CLAIM_RESULTS, { valid: true, parentSeedHash: seed.seedHash, claimSelectionHash: selection.claimSelectionHash, spanRoles, objectiveGroups, errors: [] });
}

export function validateGeneralPrSemanticEvidenceCandidateV1(
  value: unknown,
  seed: GeneralPrObservationSeedV2,
  claim: GeneralPrSemanticClaimValidationV1,
  selection: GeneralPrSemanticEvidenceSelectionV1
): GeneralPrSemanticEvidenceValidationV1 {
  const validatedClaim = VALIDATED_CLAIM_RESULTS.get(claim);
  if (!validatedClaim) {
    if (!claim.valid) return invalidEvidence("claim stage is invalid");
    return invalidEvidence("claim stage validation provenance is invalid");
  }
  if (!validateGeneralPrObservationSeedV2(seed).valid) return invalidEvidence("seed is invalid");
  if (serializedBytes(value) > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_OUTPUT_BYTES) return invalidEvidence("evidence output byte limit exceeded");
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_ROOT_KEYS) || !Array.isArray(value.testApplicabilityProposals) || !Array.isArray(value.scopeMappingProposals) || !Array.isArray(value.evidenceRelationProposals)) return invalidEvidence("evidence candidate root shape is invalid");
  const totalRelations = value.testApplicabilityProposals.length + value.scopeMappingProposals.length + value.evidenceRelationProposals.length;
  if (totalRelations > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS) return invalidEvidence("evidence relation limit exceeded");
  const allowedGroups = validateEvidenceSelection(seed, validatedClaim, selection);
  if (!allowedGroups) return invalidEvidence("evidence selection binding is invalid");
  const testApplicabilityProposals = normalizeSelectedRelations(value.testApplicabilityProposals, PROVIDER_TEST_APPLICABILITY_KEYS, allowedGroups, "changeClusterIds", "changeClusterId", ["likely_expected", "likely_not_applicable", "ambiguous"]);
  const scopeMappingProposals = normalizeSelectedRelations(value.scopeMappingProposals, PROVIDER_SCOPE_MAPPING_KEYS, allowedGroups, "changeClusterIds", "changeClusterId", ["plausibly_mapped", "unresolved"]);
  const evidenceRelationProposals = normalizeSelectedRelations(value.evidenceRelationProposals, PROVIDER_EVIDENCE_RELATION_KEYS, allowedGroups, "evidenceIds", "evidenceId", ["supports", "tests", "implements", "contradicts", "unresolved"]);
  if (!testApplicabilityProposals || !scopeMappingProposals || !evidenceRelationProposals) return invalidEvidence("evidence relation proposal is invalid");
  if (!hasConsistentRelationOwnership([
    ...testApplicabilityProposals.map((item) => ({ objectiveSpanIds: item.objectiveSpanIds, referenceId: `cluster:${item.changeClusterId}` })),
    ...scopeMappingProposals.map((item) => ({ objectiveSpanIds: item.objectiveSpanIds, referenceId: `cluster:${item.changeClusterId}` })),
    ...evidenceRelationProposals.map((item) => ({ objectiveSpanIds: item.objectiveSpanIds, referenceId: `evidence:${item.evidenceId}` }))
  ])) return invalidEvidence("evidence relation proposal is invalid");
  return registerValidatedEvidenceStageResult({
    valid: true,
    parentSeedHash: seed.seedHash,
    evidenceSelectionHash: selection.evidenceSelectionHash,
    testApplicabilityProposals,
    scopeMappingProposals,
    evidenceRelationProposals,
    errors: []
  }, validatedClaim);
}

export function mergeGeneralPrSemanticStageCandidatesV1(
  seed: GeneralPrObservationSeedV2,
  claim: GeneralPrSemanticClaimValidationV1,
  evidence: GeneralPrSemanticEvidenceValidationV1 | null
): GeneralPrSemanticProposalValidation {
  const validatedClaim = VALIDATED_CLAIM_RESULTS.get(claim);
  if (!validatedClaim) {
    if (!claim.valid) return invalid("claim stage is invalid");
    return invalid("claim stage validation provenance is invalid");
  }
  if (validatedClaim.parentSeedHash !== seed.seedHash) return invalid("claim stage is stale");
  const validatedEvidence = evidence ? VALIDATED_EVIDENCE_RESULTS.get(evidence) : undefined;
  if (evidence && !validatedEvidence) {
    if (!evidence.valid) return invalid("evidence stage is invalid");
    return invalid("evidence stage validation provenance is invalid");
  }
  if (validatedEvidence && validatedEvidence.claimSnapshot !== validatedClaim) return invalid("evidence stage claim provenance is invalid");
  if (validatedEvidence && validatedEvidence.evidenceSnapshot.parentSeedHash !== seed.seedHash) return invalid("evidence stage is stale");
  const evidenceSnapshot = validatedEvidence?.evidenceSnapshot;
  return validateGeneralPrSemanticProposalV2Internal({
    spanRoles: validatedClaim.spanRoles,
    objectiveGroups: validatedClaim.objectiveGroups,
    testApplicabilityProposals: evidenceSnapshot?.testApplicabilityProposals ?? [],
    scopeMappingProposals: evidenceSnapshot?.scopeMappingProposals ?? [],
    evidenceRelationProposals: evidenceSnapshot?.evidenceRelationProposals ?? []
  }, seed);
}

function validateGeneralPrSemanticProposalV2Internal(
  candidate: unknown,
  seed: GeneralPrObservationSeedV2
): GeneralPrSemanticProposalValidation {
  if (!validateGeneralPrObservationSeedV2(seed).valid) return invalid("seed is invalid");
  if (!isRecord(candidate) || !hasExactKeys(candidate, PROVIDER_ROOT_KEYS)) return invalid("provider candidate root shape is invalid");
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

type SelectedSpanEntry = { span: GeneralPrSemanticSpanV2; index: number };
type EvidenceAllowedGroup = GeneralPrSemanticEvidenceSelectionV1["objectiveGroups"][number];

function validateClaimSelection(seed: GeneralPrObservationSeedV2, selection: GeneralPrSemanticClaimSelectionV1): SelectedSpanEntry[] | null {
  if (!isRecord(selection) || !hasExactKeys(selection, CLAIM_SELECTION_KEYS) || selection.version !== 1 || selection.parentSeedHash !== seed.seedHash || !isHash(selection.claimSelectionHash)) return null;
  const { claimSelectionHash, ...unsigned } = selection;
  if (computeGeneralPrSemanticClaimSelectionHashV1(unsigned) !== claimSelectionHash) return null;
  if (!isCoverage(selection.coverage) || !isRecord(selection.omittedReasonCounts) || !hasExactKeys(selection.omittedReasonCounts, OMITTED_CLAIM_KEYS) || !isCount(selection.omittedReasonCounts.spanBudget) || !isCount(selection.omittedReasonCounts.inputByteBudget)) return null;
  if (!Array.isArray(selection.selectedSpanIds) || !Array.isArray(selection.selectedSpans) || selection.selectedSpanIds.length === 0 || selection.selectedSpanIds.length > GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS || selection.selectedSpanIds.length !== selection.selectedSpans.length || !hasNoArrayHoles(selection.selectedSpanIds) || !hasNoArrayHoles(selection.selectedSpans)) return null;
  const spansById = new Map(seed.spans.map((span, index) => [span.id, { span, index }]));
  const sourcesById = new Map(seed.sources.map((source) => [source.id, source]));
  const selected: SelectedSpanEntry[] = [];
  const seen = new Set<string>();
  let priorIndex = -1;
  for (let index = 0; index < selection.selectedSpans.length; index += 1) {
    const item = selection.selectedSpans[index];
    if (!isRecord(item) || !hasExactKeys(item, CLAIM_SELECTED_SPAN_KEYS) || typeof item.spanId !== "string" || item.spanId !== selection.selectedSpanIds[index] || seen.has(item.spanId)) return null;
    const canonical = spansById.get(item.spanId);
    const source = canonical ? sourcesById.get(canonical.span.sourceUnitId) : undefined;
    if (!canonical || !source || canonical.index <= priorIndex || source.roleCeiling === "policy_only" || canonical.span.structuralKind === "code" || canonical.span.structuralKind === "html") return null;
    if (item.sourceUnitId !== canonical.span.sourceUnitId || item.authority !== source.authority || item.sourceRole !== (source.roleCeiling === "context" ? "context" : "objective") || item.structuralKind !== canonical.span.structuralKind || item.deterministicRole !== canonical.span.deterministicRole || typeof item.text !== "string" || sha(item.text) !== canonical.span.textHash) return null;
    priorIndex = canonical.index;
    seen.add(item.spanId);
    selected.push(canonical);
  }
  return selected;
}

function validateEvidenceSelection(
  seed: GeneralPrObservationSeedV2,
  claim: Extract<GeneralPrSemanticClaimValidationV1, { valid: true }>,
  selection: GeneralPrSemanticEvidenceSelectionV1
): EvidenceAllowedGroup[] | null {
  if (!isRecord(selection) || !hasExactKeys(selection, EVIDENCE_SELECTION_KEYS) || selection.version !== 1 || selection.policyVersion !== GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION || selection.parentSeedHash !== seed.seedHash || selection.claimSelectionHash !== claim.claimSelectionHash || !isHash(selection.evidenceSelectionHash)) return null;
  const { evidenceSelectionHash, ...unsigned } = selection;
  if (computeGeneralPrSemanticEvidenceSelectionHashV1(unsigned) !== evidenceSelectionHash) return null;
  if (!isRecord(selection.limits) || !hasExactKeys(selection.limits, EVIDENCE_LIMIT_KEYS) || !boundedCount(selection.limits.maxPerObjective, 12) || !boundedCount(selection.limits.maxTotal, GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS) || !boundedCount(selection.limits.maxInputBytes, 12_000)) return null;
  if (serializedBytes(selection) > selection.limits.maxInputBytes || !isCoverage(selection.coverage) || !isRecord(selection.omittedReasonCounts) || !hasExactKeys(selection.omittedReasonCounts, OMITTED_EVIDENCE_KEYS) || Object.values(selection.omittedReasonCounts).some((value) => !isCount(value))) return null;
  if (!Array.isArray(selection.objectiveGroups) || !Array.isArray(selection.changeClusterDescriptors) || !Array.isArray(selection.evidenceDescriptors) || !hasNoArrayHoles(selection.objectiveGroups) || !hasNoArrayHoles(selection.changeClusterDescriptors) || !hasNoArrayHoles(selection.evidenceDescriptors)) return null;
  const claimGroups = claim.objectiveGroups.filter((group) => group.disposition === "candidate");
  if (selection.objectiveGroups.length !== claimGroups.length || selection.objectiveGroups.length === 0) return null;
  const seedClusterIds = new Set(seed.changeClusters.map((cluster) => cluster.id));
  const seedEvidenceById = new Map(seed.evidenceAtoms.map((atom) => [atom.id, atom]));
  const clusterDescriptorIds = new Set<string>();
  for (const descriptor of selection.changeClusterDescriptors) {
    if (!isRecord(descriptor) || !hasExactKeys(descriptor, CHANGE_CLUSTER_DESCRIPTOR_KEYS) || typeof descriptor.changeClusterId !== "string" || clusterDescriptorIds.has(descriptor.changeClusterId) || !seedClusterIds.has(descriptor.changeClusterId) || !isStringArray(descriptor.roleCandidates) || !isStringArray(descriptor.languages) || !isStringArray(descriptor.tokenSketch) || !isCompleteness(descriptor.completeness)) return null;
    const cluster = seed.changeClusters.find((candidate) => candidate.id === descriptor.changeClusterId);
    const expectedBasis = cluster?.formationBasis === "static_relation" ? "released_static_relation" : cluster?.formationBasis === "build_relation" ? "released_build_relation" : cluster?.formationBasis;
    if (descriptor.relationBasis !== expectedBasis) return null;
    clusterDescriptorIds.add(descriptor.changeClusterId);
  }
  const evidenceDescriptorIds = new Set<string>();
  for (const descriptor of selection.evidenceDescriptors) {
    if (!isRecord(descriptor) || !hasExactKeys(descriptor, EVIDENCE_DESCRIPTOR_KEYS) || typeof descriptor.evidenceId !== "string" || evidenceDescriptorIds.has(descriptor.evidenceId) || !isStringArray(descriptor.roleCandidates) || !isStringArray(descriptor.tokenSketch) || !(descriptor.language === null || typeof descriptor.language === "string") || !(descriptor.changeStatus === null || typeof descriptor.changeStatus === "string")) return null;
    const atom = seedEvidenceById.get(descriptor.evidenceId);
    if (!atom || !validEvidenceDescriptorBinding(descriptor as unknown as GeneralPrSemanticEvidenceDescriptorV1, atom, seed)) return null;
    evidenceDescriptorIds.add(descriptor.evidenceId);
  }
  const usedClusterIds = new Set<string>();
  const usedEvidenceIds = new Set<string>();
  for (let index = 0; index < selection.objectiveGroups.length; index += 1) {
    const group = selection.objectiveGroups[index];
    const claimGroup = claimGroups[index];
    if (!isRecord(group) || !hasExactKeys(group, EVIDENCE_SELECTION_GROUP_KEYS) || !claimGroup || !sameStringArray(group.objectiveSpanIds, claimGroup.spanIds) || !uniqueStringArray(group.changeClusterIds, true) || !uniqueStringArray(group.evidenceIds, true)) return null;
    if (group.changeClusterIds.length + group.evidenceIds.length > selection.limits.maxPerObjective || group.changeClusterIds.some((id) => !clusterDescriptorIds.has(id)) || group.evidenceIds.some((id) => !evidenceDescriptorIds.has(id))) return null;
    group.changeClusterIds.forEach((id) => usedClusterIds.add(id));
    group.evidenceIds.forEach((id) => usedEvidenceIds.add(id));
  }
  if (usedClusterIds.size + usedEvidenceIds.size === 0 || new Set([...usedClusterIds, ...usedEvidenceIds]).size > selection.limits.maxTotal || usedClusterIds.size !== clusterDescriptorIds.size || usedEvidenceIds.size !== evidenceDescriptorIds.size) return null;
  return selection.objectiveGroups;
}

function validEvidenceDescriptorBinding(
  descriptor: GeneralPrSemanticEvidenceDescriptorV1,
  atom: GeneralPrObservationSeedV2["evidenceAtoms"][number],
  seed: GeneralPrObservationSeedV2
): boolean {
  if (descriptor.kind !== atom.kind || descriptor.completeness !== atom.completeness || !isCompleteness(descriptor.completeness)) return false;
  const exactSeedHead = Boolean(seed.headSha && seed.testedSubject.kind === "head" && seed.testedSubject.sha === seed.headSha);
  let exact = exactSeedHead;
  if (atom.kind === "check" || atom.kind === "execution") {
    const kindIndex = seed.evidenceAtoms.filter((candidate) => candidate.kind === atom.kind).findIndex((candidate) => candidate.id === atom.id);
    const execution = seed.executions[kindIndex];
    exact = Boolean(exactSeedHead && execution && execution.subjectKind === "head" && execution.subjectSha === seed.headSha && execution.headSha === seed.headSha && execution.subjectContextDigest !== null);
  }
  const expectedBinding: GeneralPrSemanticEvidenceDescriptorV1["subjectBinding"] = exact ? "exact_head" : seed.headSha || seed.testedSubject.sha ? "incomplete" : "unknown";
  const expectedBasis: GeneralPrSemanticEvidenceDescriptorV1["relationBasis"] = atom.kind === "change" ? "observation_only" : atom.kind === "test_artifact" ? "changed_artifact" : exact ? "exact_subject" : "unresolved";
  return descriptor.subjectBinding === expectedBinding && descriptor.relationBasis === expectedBasis;
}

function normalizeSelectedRelations<
  Field extends "changeClusterId" | "evidenceId",
  IdField extends "changeClusterIds" | "evidenceIds",
  Proposal extends string
>(
  values: unknown[],
  keys: readonly string[],
  groups: readonly EvidenceAllowedGroup[],
  idsField: IdField,
  referenceField: Field,
  proposals: readonly Proposal[]
): Array<{ objectiveSpanIds: string[] } & Record<Field, string> & { proposal: Proposal }> | null {
  if (!hasNoArrayHoles(values)) return null;
  const groupsByKey = new Map(groups.map((group) => [objectiveKey(group.objectiveSpanIds), group]));
  const normalized: Array<{ objectiveSpanIds: string[] } & Record<Field, string> & { proposal: Proposal }> = [];
  const seen = new Set<string>();
  const ownerByReference = new Map<string, string>();
  for (const value of values) {
    if (!isRecord(value) || !hasExactKeys(value, keys) || !uniqueStringArray(value.objectiveSpanIds) || typeof value[referenceField] !== "string" || !proposals.includes(value.proposal as Proposal)) return null;
    const groupKey = objectiveKey(value.objectiveSpanIds);
    const group = groupsByKey.get(groupKey);
    const referenceId = value[referenceField] as string;
    if (!group || !(group[idsField] as string[]).includes(referenceId)) return null;
    const relationKey = `${groupKey}:${referenceId}`;
    const priorOwner = ownerByReference.get(referenceId);
    if (seen.has(relationKey) || (priorOwner !== undefined && priorOwner !== groupKey)) return null;
    seen.add(relationKey);
    ownerByReference.set(referenceId, groupKey);
    normalized.push({ objectiveSpanIds: [...value.objectiveSpanIds], [referenceField]: referenceId, proposal: value.proposal as Proposal } as { objectiveSpanIds: string[] } & Record<Field, string> & { proposal: Proposal });
  }
  return normalized;
}

function deterministicUnselectedRole(span: GeneralPrSemanticSpanV2): GeneralPrSemanticSpanRoleV2 {
  return span.deterministicRole === "template_or_process"
    ? { spanId: span.id, role: "template_or_process", abstained: false }
    : { spanId: span.id, role: "supporting_context", abstained: false };
}

function registerValidatedStageResult<T extends object>(registry: WeakMap<object, T>, result: T): T {
  const snapshot = deepFreeze(structuredClone(result));
  registry.set(snapshot, snapshot);
  return snapshot;
}

function registerValidatedEvidenceStageResult(
  result: ValidatedEvidenceResultV1,
  claimSnapshot: ValidatedClaimResultV1
): ValidatedEvidenceResultV1 {
  const snapshot = deepFreeze(structuredClone(result));
  VALIDATED_EVIDENCE_RESULTS.set(snapshot, Object.freeze({
    claimSnapshot,
    evidenceSnapshot: snapshot
  }));
  return snapshot;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function hasConsistentRelationOwnership(relations: Array<{ objectiveSpanIds: string[]; referenceId: string }>): boolean {
  const owners = new Map<string, string>();
  for (const relation of relations) {
    const owner = objectiveKey(relation.objectiveSpanIds);
    const prior = owners.get(relation.referenceId);
    if (prior !== undefined && prior !== owner) return false;
    owners.set(relation.referenceId, owner);
  }
  return true;
}

function selectedRelationArraySchema(
  groups: GeneralPrSemanticEvidenceSelectionV1["objectiveGroups"],
  idsField: "changeClusterIds" | "evidenceIds",
  keys: readonly string[],
  referenceField: "changeClusterId" | "evidenceId",
  proposals: readonly string[]
): JsonSchema {
  const variants = groups.flatMap((group) => group[idsField].length === 0 ? [] : [exactObjectSchema(keys, {
    objectiveSpanIds: enumSchema([[...group.objectiveSpanIds]]),
    [referenceField]: enumSchema(group[idsField]),
    proposal: enumSchema(proposals)
  })]);
  return variants.length === 0
    ? { type: "array", maxItems: 0, items: false }
    : { type: "array", maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_RELATIONS, items: { anyOf: variants } };
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

function exactObjectSchema(keys: readonly string[], properties: Record<string, JsonSchema>): JsonSchema {
  return { type: "object", additionalProperties: false, required: [...keys], properties };
}

function enumSchema(values: readonly unknown[]): JsonSchema { return { enum: [...values] }; }
function isObjectiveDisposition(value: unknown): value is GeneralPrSemanticObjectiveGroupV2["disposition"] { return value === "candidate" || value === "not_objective" || value === "ambiguous"; }
function isRole(value: unknown): value is GeneralPrClaimRoleV2 { return typeof value === "string" && ROLES.includes(value as GeneralPrClaimRoleV2); }
function invalid(error: string): GeneralPrSemanticProposalValidation { return { valid: false, errors: [error] }; }
function invalidClaim(error: string): GeneralPrSemanticClaimValidationV1 { return { valid: false, errors: [error] }; }
function invalidEvidence(error: string): GeneralPrSemanticEvidenceValidationV1 { return { valid: false, errors: [error] }; }
function isRecord(value: unknown): value is Record<string, unknown> { const prototype = value && typeof value === "object" ? Object.getPrototypeOf(value) : null; return Boolean(value) && !Array.isArray(value) && (prototype === Object.prototype || prototype === null); }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function hasNoArrayHoles(value: readonly unknown[]): boolean { return Object.keys(value).length === value.length; }
function isCoverage(value: unknown): boolean { return value === "complete" || value === "sampled" || value === "incomplete"; }
function isCompleteness(value: unknown): boolean { return value === "complete" || value === "incomplete" || value === "unknown"; }
function isCount(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function boundedCount(value: unknown, maximum: number): value is number { return isCount(value) && value <= maximum; }
function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && hasNoArrayHoles(value) && value.every((item) => typeof item === "string"); }
function uniqueStringArray(value: unknown, allowEmpty = false): value is string[] { return isStringArray(value) && (allowEmpty || value.length > 0) && new Set(value).size === value.length; }
function sameStringArray(left: unknown, right: readonly string[]): left is string[] { return isStringArray(left) && left.length === right.length && left.every((item, index) => item === right[index]); }
function objectiveKey(spanIds: readonly string[]): string { return JSON.stringify(spanIds); }
function serializedBytes(value: unknown): number { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return Number.POSITIVE_INFINITY; } }
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
