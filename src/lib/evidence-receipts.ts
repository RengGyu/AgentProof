import type {
  CanonicalRequirementSetV1,
  CanonicalRequirementUnitV1,
  ExecutionBindingReceiptV2,
  ExistingTestRelationReceiptV1,
  PrivateProofReceiptBundleV2,
  RequirementSourceBinding,
  TestRelationReceiptV2
} from "./types";

type UnknownRecord = Record<string, unknown>;

const MAX_RECEIPTS = 200;
const MAX_SOURCE_BINDINGS = 80;
const MAX_FAILED_CHECK_ASSOCIATIONS = 50;
const DIGEST = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const SPAN_ID = /^sp_\d+_\d+$/;
const GROUP_ID = /^grp_\d+$/;
const SOURCE = new Set(["task", "issue", "pr_description"]);
const SUBJECT_SOURCE = new Set(["current_requirement", "test_antecedent", "test_subject_chain"]);
const EXECUTION_SCOPE = new Set(["exact_test", "exact_workflow_job"]);

/**
 * Produces the only source-binding representation admitted to the v2 private
 * bundle. Text and source-section data deliberately stay out of the receipt.
 */
export function canonicalRequirementSourceBindingV2(
  unit: CanonicalRequirementUnitV1,
  sourceContentHash: string
): RequirementSourceBinding {
  const group = canonicalGroupNumber(unit.groupId);
  if (group === null || !Number.isSafeInteger(unit.ordinal) || unit.ordinal < 1) {
    throw new Error("Invalid canonical requirement source binding.");
  }
  return {
    version: 1,
    kind: "requirement_source_binding",
    id: `rsb_${unit.stableBindingKey}`,
    requirementId: unit.reportRequirementId,
    spanId: `sp_${group}_${unit.ordinal}` as RequirementSourceBinding["spanId"],
    seedId: sourceContentHash,
    groupId: `grp_${group}` as RequirementSourceBinding["groupId"],
    source: unit.source,
    ordinal: unit.ordinal
  };
}

/**
 * Relation extraction may only discover a subset of requirements. The v2
 * bundle nevertheless closes ownership over the full canonical source set.
 */
export function completePrivateProofReceiptBundleV2(
  bundle: PrivateProofReceiptBundleV2,
  canonical: CanonicalRequirementSetV1
): PrivateProofReceiptBundleV2 {
  return {
    ...bundle,
    sourceBindings: canonical.requirements.map((unit) =>
      canonicalRequirementSourceBindingV2(unit, canonical.sourceContentHash)
    )
  };
}

/**
 * Private bundles are accepted only as bounded receipt records. This checker
 * intentionally returns generic structural errors and never copies a caller's
 * raw IDs, refs, source, or assertion text into the result.
 */
export function validatePrivateProofReceiptBundleV2(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["must be an object"];
  rejectUnknownKeys(value, [
    "sourceBindings",
    "exactHeadTargetReceipts",
    "testRelationReceipts",
    "executionBindingReceipts",
    "failedCheckAssociations"
  ], "bundle", errors);

  const sourceBindings = boundedArray(value.sourceBindings, "sourceBindings", MAX_SOURCE_BINDINGS, errors);
  const exactTargets = boundedArray(value.exactHeadTargetReceipts, "exact head target receipts", MAX_RECEIPTS, errors);
  const relations = boundedArray(value.testRelationReceipts, "test relation receipts", MAX_RECEIPTS, errors);
  const executions = boundedArray(value.executionBindingReceipts, "execution binding receipts", MAX_RECEIPTS, errors);
  const failedChecks = boundedArray(value.failedCheckAssociations, "failed Check associations", MAX_FAILED_CHECK_ASSOCIATIONS, errors);

  const sourceIds = new Set<string>();
  const sourceRequirements = new Set<string>();
  sourceBindings.forEach((item) => validateSourceBinding(item, sourceIds, sourceRequirements, errors));

  const targetIds = new Set<string>();
  exactTargets.forEach((item) => validateExactHeadTarget(item, targetIds, errors));

  const executionById = new Map<string, UnknownRecord>();
  executions.forEach((item) => validateExecutionBinding(item, executionById, errors));

  const relationIds = new Set<string>();
  const v2Relations: UnknownRecord[] = [];
  relations.forEach((item) => {
    if (!isRecord(item)) {
      errors.push("test relation receipts must contain objects");
      return;
    }
    if (item.version === 1) validateV1Relation(item, relationIds, errors);
    else if (item.version === 2) {
      validateV2Relation(item, relationIds, targetIds, errors);
      v2Relations.push(item);
    } else {
      errors.push("test relation receipt version or kind is invalid");
    }
  });

  for (const relation of v2Relations) {
    const executionRef = typeof relation.executionReceiptRef === "string"
      ? executionById.get(relation.executionReceiptRef)
      : undefined;
    if (!executionRef ||
      executionRef.requirementId !== relation.requirementId ||
      executionRef.testEvidenceRef !== relation.testEvidenceRef) {
      errors.push("test relation receipts cite a missing execution binding receipt");
    }
  }

  const failedPairs = new Set<string>();
  failedChecks.forEach((item) => validateFailedCheckAssociation(item, failedPairs, errors));
  return [...new Set(errors)];
}

function canonicalGroupNumber(groupId: string): number | null {
  const match = /^(?:vc_)?grp_(\d+)$/.exec(groupId);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function validateSourceBinding(
  item: unknown,
  ids: Set<string>,
  requirements: Set<string>,
  errors: string[]
): void {
  if (!isRecord(item)) {
    errors.push("source bindings must contain objects");
    return;
  }
  rejectUnknownKeys(item, ["version", "kind", "id", "requirementId", "spanId", "seedId", "groupId", "source", "ordinal"], "source binding receipt", errors);
  if (item.version !== 1 || item.kind !== "requirement_source_binding") errors.push("source binding receipt version or kind is invalid");
  if (!boundedString(item.id) || !addUnique(ids, item.id)) errors.push("source binding receipt ID is invalid or duplicated");
  if (!boundedString(item.requirementId) || !addUnique(requirements, item.requirementId)) errors.push("source binding receipt requirement is invalid or duplicated");
  if (typeof item.spanId !== "string" || !SPAN_ID.test(item.spanId)) errors.push("source binding receipt span is invalid");
  if (typeof item.seedId !== "string" || !DIGEST.test(item.seedId)) errors.push("source binding receipt seed is invalid");
  if (typeof item.groupId !== "string" || !GROUP_ID.test(item.groupId)) errors.push("source binding receipt group is invalid");
  if (typeof item.source !== "string" || !SOURCE.has(item.source)) errors.push("source binding receipt source is invalid");
  if (!positiveInteger(item.ordinal)) errors.push("source binding receipt ordinal is invalid");
}

function validateExactHeadTarget(item: unknown, ids: Set<string>, errors: string[]): void {
  if (!isRecord(item)) {
    errors.push("exact head target receipts must contain objects");
    return;
  }
  rejectUnknownKeys(item, ["id", "version", "kind", "headSha", "targetPathDigest", "targetBlobSha", "exportKind", "canonicalBindingDigest"], "exact head target receipt", errors);
  if (item.version !== 1 || item.kind !== "exact_head_target") errors.push("exact head target receipt version or kind is invalid");
  if (!boundedString(item.id) || !addUnique(ids, item.id)) errors.push("exact head target receipt ID is invalid or duplicated");
  if (typeof item.headSha !== "string" || !GIT_SHA.test(item.headSha)) errors.push("exact head target receipt head binding is invalid");
  if (typeof item.targetPathDigest !== "string" || !DIGEST.test(item.targetPathDigest) ||
    typeof item.targetBlobSha !== "string" || !GIT_SHA.test(item.targetBlobSha) ||
    typeof item.canonicalBindingDigest !== "string" || !DIGEST.test(item.canonicalBindingDigest)) {
    errors.push("exact head target receipt digest is invalid");
  }
  if (item.exportKind !== "named" && item.exportKind !== "default" && item.exportKind !== "commonjs") {
    errors.push("exact head target receipt export kind is invalid");
  }
}

function validateExecutionBinding(item: unknown, byId: Map<string, UnknownRecord>, errors: string[]): void {
  if (!isRecord(item)) {
    errors.push("execution binding receipts must contain objects");
    return;
  }
  rejectUnknownKeys(item, ["id", "version", "kind", "requirementId", "testEvidenceRef", "executionEvidenceRef", "headBindingDigest", "scope"], "execution binding receipt", errors);
  if (item.version !== 2 || item.kind !== "execution_binding") errors.push("execution binding receipt version or kind is invalid");
  if (!boundedString(item.id) || byId.has(item.id)) errors.push("execution binding receipt ID is invalid or duplicated");
  else byId.set(item.id, item);
  if (!boundedString(item.requirementId) || !boundedString(item.testEvidenceRef) || !boundedString(item.executionEvidenceRef)) {
    errors.push("execution binding receipt references are invalid");
  }
  if (typeof item.headBindingDigest !== "string" || !DIGEST.test(item.headBindingDigest)) errors.push("execution binding receipt head binding is invalid");
  if (typeof item.scope !== "string" || !EXECUTION_SCOPE.has(item.scope)) errors.push("execution binding receipt scope is invalid");
}

function validateV1Relation(item: UnknownRecord, ids: Set<string>, errors: string[]): void {
  rejectUnknownKeys(item, ["id", "version", "kind", "subjectRequirementId", "subjectSource", "exactHeadTargetReceiptRef", "testEvidenceRef", "relationBasis", "directAssertionCaseCount", "executionEvidenceRef"], "test relation receipt", errors);
  if (item.kind !== "targeted_test_relation") errors.push("test relation receipt version or kind is invalid");
  if (!boundedString(item.id) || !addUnique(ids, item.id)) errors.push("test relation receipt ID is invalid or duplicated");
  if (!boundedString(item.subjectRequirementId) || !boundedString(item.exactHeadTargetReceiptRef) || !boundedString(item.testEvidenceRef) || !boundedString(item.executionEvidenceRef)) {
    errors.push("test relation receipt references are invalid");
  }
  if (item.subjectSource !== "current_requirement" || item.relationBasis !== "direct_static_import" || !assertionCount(item.directAssertionCaseCount)) {
    errors.push("test relation receipt shape is invalid");
  }
}

function validateV2Relation(item: UnknownRecord, ids: Set<string>, targetIds: Set<string>, errors: string[]): void {
  rejectUnknownKeys(
    item,
    ["id", "version", "kind", "requirementId", "subjectSource", "targetMode", "implementationEvidenceRef", "exactHeadTargetReceiptRef", "testEvidenceRef", "subjectDigest", "importBindingDigest", "assertionShape", "directAssertionCount", "executionReceiptRef"],
    "test relation receipt",
    errors,
    ["id", "version", "kind", "requirementId", "subjectSource", "targetMode", "testEvidenceRef", "subjectDigest", "importBindingDigest", "assertionShape", "directAssertionCount", "executionReceiptRef"]
  );
  if (item.kind !== "targeted_test_relation") errors.push("test relation receipt version or kind is invalid");
  if (!boundedString(item.id) || !addUnique(ids, item.id)) errors.push("test relation receipt ID is invalid or duplicated");
  if (!boundedString(item.requirementId) || !boundedString(item.testEvidenceRef) || !boundedString(item.executionReceiptRef)) {
    errors.push("test relation receipt references are invalid");
  }
  if (typeof item.subjectSource !== "string" || !SUBJECT_SOURCE.has(item.subjectSource)) errors.push("test relation receipt subject source is invalid");
  if (typeof item.subjectDigest !== "string" || !DIGEST.test(item.subjectDigest) ||
    typeof item.importBindingDigest !== "string" || !DIGEST.test(item.importBindingDigest)) {
    errors.push("test relation receipt digest is invalid");
  }
  if (item.assertionShape !== "direct_argument" || !assertionCount(item.directAssertionCount)) errors.push("test relation receipt assertion shape is invalid");
  if (item.targetMode === "changed_target") {
    if (!boundedString(item.implementationEvidenceRef) || item.exactHeadTargetReceiptRef !== undefined) {
      errors.push("changed-target test relation receipt target binding is invalid");
    }
  } else if (item.targetMode === "exact_head_target") {
    if (!boundedString(item.exactHeadTargetReceiptRef) || item.implementationEvidenceRef !== undefined || !targetIds.has(item.exactHeadTargetReceiptRef)) {
      errors.push("exact-head test relation receipt target binding is invalid");
    }
  } else {
    errors.push("test relation receipt target mode is invalid");
  }
}

function validateFailedCheckAssociation(item: unknown, pairs: Set<string>, errors: string[]): void {
  if (!isRecord(item)) {
    errors.push("failed Check associations must contain objects");
    return;
  }
  rejectUnknownKeys(item, ["version", "kind", "requirementId", "checkEvidenceRef", "state", "basis"], "failed Check association", errors);
  if (item.version !== 1 || item.kind !== "failed_check_association") errors.push("failed Check association version or kind is invalid");
  if (!boundedString(item.requirementId) || !boundedString(item.checkEvidenceRef)) errors.push("failed Check association references are invalid");
  const pair = typeof item.requirementId === "string" && typeof item.checkEvidenceRef === "string"
    ? `${item.requirementId}\0${item.checkEvidenceRef}`
    : "";
  if (!pair || pairs.has(pair)) errors.push("failed Check association is duplicated");
  else pairs.add(pair);
  const compatible =
    (item.state === "linked" && item.basis === "complete_identity_match") ||
    (item.state === "not_linked" && item.basis === "deterministic_non_match") ||
    (item.state === "unknown" && item.basis === "identity_incomplete");
  if (!compatible) errors.push("failed Check association state and basis are incompatible");
}

function boundedArray(value: unknown, label: string, limit: number, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  if (value.length > limit) errors.push(`${label} exceeds its maximum size`);
  return value.slice(0, limit);
}

function rejectUnknownKeys(
  value: UnknownRecord,
  allowed: readonly string[],
  label: string,
  errors: string[],
  required: readonly string[] = allowed
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) errors.push(`${label}.${key} is not allowed`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`);
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 600;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function assertionCount(value: unknown): value is number {
  return positiveInteger(value) && value <= 8;
}

function addUnique(set: Set<string>, value: unknown): boolean {
  if (typeof value !== "string" || set.has(value)) return false;
  set.add(value);
  return true;
}
