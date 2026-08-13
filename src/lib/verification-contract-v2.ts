import { createHash } from "crypto";
import type { RequirementProofPolarity, RequirementProofSubject } from "./types";

export const VERIFICATION_CONTRACT_V2_VERSION = 2 as const;
export const VERIFICATION_CONTRACT_TITLE = "AgentProof verification contract";
export const VERIFICATION_CONTRACT_HEADING = "## AgentProof verification";

const MAX_CONTRACT_BYTES = 16 * 1024;
const MAX_OBJECTIVES = 12;
const MAX_CRITERIA_PER_OBJECTIVE = 4;
const MAX_CRITERIA_TOTAL = 24;
const MAX_OBJECTIVE_CHARS = 500;
const MAX_LABEL_CHARS = 240;
const MAX_VALUE_CHARS = 200;
const MAX_RETURN_CASES = 8;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,31}$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]{1,200}$/;
const SAFE_SYMBOL = /^[A-Za-z_$][A-Za-z0-9_$]{0,199}$/;

export type VerificationContractStateV2 = "authoritative" | "author_claim" | "absent" | "invalid";

export type VerificationContractInvalidReasonV2 =
  | "malformed"
  | "overflow"
  | "unsupported_type"
  | "duplicate_id"
  | "conflict"
  | "source_mismatch"
  | "extra_source_prose";

export interface ReturnValueCaseV2 {
  id: string;
  input?: string | number | boolean | null;
  expected: string | number | boolean | null;
}

export interface NodeExportScalarAdapterV2 {
  id: "node_export_scalar.v1";
  modulePath: string;
  exportName: string;
  moduleFormat: "esm" | "commonjs";
}

export interface PythonFunctionScalarAdapterV2 {
  id: "python_function_scalar.v1";
  modulePath: string;
  functionName: string;
}

export interface ReturnValueCriterionV2 {
  id: string;
  type: "return_value";
  label: string;
  adapter: NodeExportScalarAdapterV2 | PythonFunctionScalarAdapterV2;
  cases: ReturnValueCaseV2[];
}

export interface DocumentationLiteralArtifactV2 {
  kind: "documentation_literal";
  literal: string;
}

export interface WorkflowJobArtifactV2 {
  kind: "workflow_job";
  workflowName: string;
  jobName: string;
  runtimeName?: string;
  runtimeVersion?: string;
  packageScript?: string;
}

export interface TestCaseArtifactV2 {
  kind: "test_case";
  testId: string;
}

export interface ArtifactCriterionV2 {
  id: string;
  type: "artifact";
  label: string;
  paths: string[];
  artifact: DocumentationLiteralArtifactV2 | WorkflowJobArtifactV2 | TestCaseArtifactV2;
}

export interface AbsenceCriterionV2 {
  id: string;
  type: "absence";
  prohibitedKind: "path_change";
  scope: Array<{ kind: "exact" | "prefix"; path: string }>;
  label: string;
}

export type VerificationCriterionV2 = ReturnValueCriterionV2 | ArtifactCriterionV2 | AbsenceCriterionV2;

export interface VerificationContractObjectiveV2 {
  id: string;
  objective: string;
  criteria: VerificationCriterionV2[];
}

export interface VerificationContractV2 {
  version: 2;
  scope: "complete_objective_set";
  objectives: VerificationContractObjectiveV2[];
}

export type VerificationCriterionStateV2 = "satisfied" | "violated" | "incomplete" | "unavailable";

export interface MaterializedVerificationCriterionV2 {
  criterionId: string;
  requirementId: string;
  required: true;
  approval: "source_explicit" | "author_claim";
  label: string;
  requiredEvidence: RequirementProofSubject[];
  source: VerificationCriterionV2;
}

export interface MaterializedVerificationObjectiveV2 {
  requirementId: string;
  objective: string;
  state: "authoritative" | "author_claim";
  criteria: MaterializedVerificationCriterionV2[];
}

export interface MaterializedVerificationContractV2 {
  version: 2;
  policy: "strict_typed_contract";
  state: "authoritative" | "author_claim";
  bindingDigest: string;
  objectives: MaterializedVerificationObjectiveV2[];
}

export interface VerificationCriterionEvaluationV2 {
  criterionId: string;
  state: VerificationCriterionStateV2;
  proofAxisRefs: string[];
  evidenceRefs: string[];
  gapKinds: string[];
}

/**
 * Report-safe projection. Source IDs, source text, adapters, and invocation
 * cases remain transient inputs to the evaluator and are never copied here.
 */
export interface VerificationContractReportV2 {
  version: 2;
  policy: "strict_typed_contract";
  state: VerificationContractStateV2;
  source: { kind: VerificationBindingInputV2["sourceKind"] } | null;
  objectives: Array<{
    requirementId: string;
    state: "authoritative" | "author_claim";
    criteria: Array<{
      criterionId: string;
      required: true;
      approval: "source_explicit" | "author_claim";
      label: string;
      type: VerificationCriterionV2["type"];
      requiredEvidence: RequirementProofSubject[];
    }>;
    criterionResults: VerificationCriterionEvaluationV2[];
  }>;
  integrity?: {
    algorithm: "sha256";
    contractDigest: string;
    verificationBindingDigest: string;
  };
}

export interface CriterionAxisReferenceV2 {
  criterionId: string;
  requirementId: string;
  requiredEvidence: readonly RequirementProofSubject[];
  proofAxisRefs: readonly string[];
}

export interface CriterionAxisV2 {
  axisId: string;
  role: "criterion" | "observation";
  criterionId?: string;
  subject: RequirementProofSubject;
  polarity: RequirementProofPolarity;
}

export type VerificationContractSourceInputV2 =
  | { kind: "linked_issue"; title: string; body: string }
  | { kind: "provided_requirement"; contract: unknown }
  | { kind: "pr_description"; title: string; body: string };

/**
 * Selection is deliberately source-precedence only: a supplied contract, then
 * the linked Issue, then the PR author's description. A lower-authority source
 * can never repair or replace an authoritative source that was present but
 * malformed.
 */
export interface VerificationContractSelectionInputV2 {
  providedContract?: unknown;
  linkedIssue?: { title: string; body: string };
  prDescription?: { title: string; body: string };
}

export type ParsedVerificationContractV2 =
  | { state: "authoritative"; contract: VerificationContractV2 }
  | { state: "author_claim"; contract: VerificationContractV2 }
  | { state: "absent" }
  | { state: "invalid"; invalidReason: VerificationContractInvalidReasonV2 };

export interface VerificationBindingInputV2 {
  sourceKind: "linked_issue" | "provided_requirement" | "pr_description";
  sourceIdentity: string;
  sourceContent: string;
  headSha: string;
  baseSha: string;
}

export function parseVerificationContractV2(source: VerificationContractSourceInputV2): ParsedVerificationContractV2 {
  if (
    source.kind === "linked_issue" &&
    source.title !== VERIFICATION_CONTRACT_TITLE &&
    normalizeNewlines(source.body).includes("```agentproof-verification")
  ) {
    return { state: "invalid", invalidReason: "source_mismatch" };
  }
  const raw = source.kind === "provided_requirement"
    ? source.contract
    : extractExactContractEnvelope(source.title, source.body);

  if (raw === undefined) return { state: "absent" };
  if (raw === null) return { state: "invalid", invalidReason: "extra_source_prose" };

  const parsed = normalizeContract(raw);
  if ("invalidReason" in parsed) return { state: "invalid", invalidReason: parsed.invalidReason };
  return source.kind === "pr_description"
    ? { state: "author_claim", contract: parsed.contract }
    : { state: "authoritative", contract: parsed.contract };
}

export function selectVerificationContractV2(input: VerificationContractSelectionInputV2): ParsedVerificationContractV2 {
  if (Object.prototype.hasOwnProperty.call(input, "providedContract")) {
    return parseVerificationContractV2({ kind: "provided_requirement", contract: input.providedContract });
  }
  if (input.linkedIssue) {
    const linked = parseVerificationContractV2({ kind: "linked_issue", ...input.linkedIssue });
    if (linked.state !== "absent") return linked;
  }
  if (input.prDescription) {
    return parseVerificationContractV2({ kind: "pr_description", ...input.prDescription });
  }
  return { state: "absent" };
}

export function canonicalVerificationBindingV2(input: VerificationBindingInputV2, contract: VerificationContractV2): string {
  return sha256(stableJson({
    version: VERIFICATION_CONTRACT_V2_VERSION,
    sourceKind: input.sourceKind,
    sourceIdentity: input.sourceIdentity,
    sourceContent: normalizeNewlines(input.sourceContent),
    headSha: input.headSha,
    baseSha: input.baseSha,
    contract
  }));
}

export function materializeVerificationContractV2(
  parsed: Extract<ParsedVerificationContractV2, { state: "authoritative" | "author_claim" }>,
  bindingDigest: string
): MaterializedVerificationContractV2 {
  const approval = parsed.state === "authoritative" ? "source_explicit" : "author_claim";
  return {
    version: 2,
    policy: "strict_typed_contract",
    state: parsed.state,
    bindingDigest,
    objectives: parsed.contract.objectives.map((objective, objectiveIndex) => {
      const requirementId = `vc_o${objectiveIndex + 1}`;
      return {
        requirementId,
        objective: objective.objective,
        state: parsed.state,
        criteria: objective.criteria.map((criterion, criterionIndex) => ({
          criterionId: `${requirementId}_c${criterionIndex + 1}`,
          requirementId,
          required: true,
          approval,
          label: criterion.label,
          requiredEvidence: requiredEvidenceForCriterionV2(criterion),
          source: criterion
        }))
      };
    })
  };
}

export function criterionAxisIdV2(
  requirementId: string,
  criterionId: string,
  subject: RequirementProofSubject,
  polarity: RequirementProofPolarity
): string {
  return `ax_${requirementId}_${criterionId}_${subject}_${polarity}`;
}

export function validateCriterionAxisClosureV2(input: {
  criteria: readonly CriterionAxisReferenceV2[];
  axes: readonly CriterionAxisV2[];
}): { ok: boolean } {
  const axisById = new Map<string, CriterionAxisV2>();
  for (const axis of input.axes) {
    if (axisById.has(axis.axisId)) return { ok: false };
    axisById.set(axis.axisId, axis);
    if (axis.role === "criterion" && (!axis.criterionId || axis.polarity !== "present")) return { ok: false };
    if (axis.role === "observation" && axis.criterionId !== undefined) return { ok: false };
  }

  const criterionIds = new Set<string>();
  const referencedAxisIds = new Set<string>();
  for (const criterion of input.criteria) {
    if (criterionIds.has(criterion.criterionId) || criterion.requiredEvidence.length === 0) return { ok: false };
    criterionIds.add(criterion.criterionId);
    if (criterion.proofAxisRefs.length !== criterion.requiredEvidence.length) return { ok: false };
    for (const subject of criterion.requiredEvidence) {
      const expectedAxisId = criterionAxisIdV2(criterion.requirementId, criterion.criterionId, subject, "present");
      if (!criterion.proofAxisRefs.includes(expectedAxisId) || referencedAxisIds.has(expectedAxisId)) return { ok: false };
      const axis = axisById.get(expectedAxisId);
      if (!axis || axis.role !== "criterion" || axis.criterionId !== criterion.criterionId || axis.subject !== subject || axis.polarity !== "present") {
        return { ok: false };
      }
      referencedAxisIds.add(expectedAxisId);
    }
  }

  return {
    ok: input.axes
      .filter((axis) => axis.role === "criterion")
      .every((axis) => referencedAxisIds.has(axis.axisId))
  };
}

export function requiredEvidenceForCriterionV2(criterion: VerificationCriterionV2): RequirementProofSubject[] {
  if (criterion.type === "return_value") return ["implementation", "targeted_test", "execution"];
  if (criterion.type === "artifact" && criterion.artifact.kind === "documentation_literal") return ["documentation"];
  if (criterion.type === "artifact" && criterion.artifact.kind === "workflow_job") return ["ci_configuration", "execution"];
  if (criterion.type === "artifact" && criterion.artifact.kind === "test_case") return ["targeted_test", "execution"];
  return ["implementation"];
}

/** Pure total aggregation. Only a server-validated evaluator may supply states. */
export function aggregateVerificationCriteriaV2(
  contractState: VerificationContractStateV2,
  states: readonly VerificationCriterionStateV2[]
): "met" | "partial" | "missing" | "unclear" {
  if (contractState === "absent" || contractState === "invalid" || states.length === 0) return "unclear";
  if (states.every((state) => state === "satisfied")) return contractState === "author_claim" ? "partial" : "met";
  if (states.some((state) => state === "satisfied")) return "partial";
  if (states.every((state) => state === "violated")) return "missing";
  return "unclear";
}

export function toVerificationContractReportV2(
  parsed: ParsedVerificationContractV2,
  sourceKind: VerificationBindingInputV2["sourceKind"] | null,
  materialized?: MaterializedVerificationContractV2,
  results: readonly VerificationCriterionEvaluationV2[] = []
): VerificationContractReportV2 {
  if (parsed.state === "absent" || parsed.state === "invalid" || !materialized || !sourceKind) {
    return { version: 2, policy: "strict_typed_contract", state: parsed.state, source: null, objectives: [] };
  }
  const resultByCriterionId = new Map(results.map((result) => [result.criterionId, result]));
  return {
    version: 2,
    policy: "strict_typed_contract",
    state: materialized.state,
    source: { kind: sourceKind },
    objectives: materialized.objectives.map((objective) => ({
      requirementId: objective.requirementId,
      state: objective.state,
      criteria: objective.criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        required: true,
        approval: criterion.approval,
        label: criterion.label,
        type: criterion.source.type,
        requiredEvidence: criterion.requiredEvidence
      })),
      criterionResults: objective.criteria.map((criterion) => resultByCriterionId.get(criterion.criterionId) ?? {
        criterionId: criterion.criterionId,
        state: "unavailable" as const,
        proofAxisRefs: [],
        evidenceRefs: [],
        gapKinds: ["evidence_unavailable"]
      })
    }))
  };
}

function extractExactContractEnvelope(title: string, body: string): unknown | null | undefined {
  if (title !== VERIFICATION_CONTRACT_TITLE) return undefined;
  let normalized = normalizeNewlines(body).trim();
  const headingPrefix = `${VERIFICATION_CONTRACT_HEADING}\n\n`;
  if (normalized.startsWith(headingPrefix)) normalized = normalized.slice(headingPrefix.length);
  const opening = "```agentproof-verification\n";
  const closing = "\n```";
  if (!normalized.startsWith(opening) || !normalized.endsWith(closing)) return null;
  const json = normalized.slice(opening.length, -closing.length);
  try {
    return JSON.parse(json);
  } catch {
    return { __invalidJson: true };
  }
}

function normalizeContract(value: unknown): { contract: VerificationContractV2 } | { invalidReason: VerificationContractInvalidReasonV2 } {
  if (!isRecord(value)) return { invalidReason: "malformed" };
  if (value.__invalidJson === true) return { invalidReason: "malformed" };
  if (!hasExactKeys(value, ["version", "scope", "objectives"])) return { invalidReason: "malformed" };
  if (value.version !== 2 || value.scope !== "complete_objective_set" || !Array.isArray(value.objectives)) {
    return { invalidReason: "malformed" };
  }
  if (utf8Size(stableJson(value)) > MAX_CONTRACT_BYTES || value.objectives.length < 1 || value.objectives.length > MAX_OBJECTIVES) {
    return { invalidReason: "overflow" };
  }

  const ids = new Set<string>();
  const criteriaIds = new Set<string>();
  const objectives: VerificationContractObjectiveV2[] = [];
  let totalCriteria = 0;
  for (const objective of value.objectives) {
    if (!isRecord(objective) || !hasExactKeys(objective, ["id", "objective", "criteria"]) ||
      !isIdentifier(objective.id) || !isBoundedText(objective.objective, MAX_OBJECTIVE_CHARS) || !Array.isArray(objective.criteria)) {
      return { invalidReason: "malformed" };
    }
    if (ids.has(objective.id) || objective.criteria.length < 1 || objective.criteria.length > MAX_CRITERIA_PER_OBJECTIVE) {
      return { invalidReason: ids.has(objective.id) ? "duplicate_id" : "overflow" };
    }
    ids.add(objective.id);
    totalCriteria += objective.criteria.length;
    if (totalCriteria > MAX_CRITERIA_TOTAL) return { invalidReason: "overflow" };

    const criteria: VerificationCriterionV2[] = [];
    for (const criterion of objective.criteria) {
      const normalized = normalizeCriterion(criterion);
      if ("invalidReason" in normalized) return normalized;
      if (criteriaIds.has(normalized.criterion.id)) return { invalidReason: "duplicate_id" };
      criteriaIds.add(normalized.criterion.id);
      criteria.push(normalized.criterion);
    }
    objectives.push({ id: objective.id, objective: objective.objective, criteria });
  }
  return { contract: { version: 2, scope: "complete_objective_set", objectives } };
}

function normalizeCriterion(value: unknown): { criterion: VerificationCriterionV2 } | { invalidReason: VerificationContractInvalidReasonV2 } {
  if (!isRecord(value) || typeof value.type !== "string") {
    return { invalidReason: "malformed" };
  }
  if (value.type !== "return_value" && value.type !== "artifact" && value.type !== "absence") return { invalidReason: "unsupported_type" };
  if (!isIdentifier(value.id) || !isBoundedText(value.label, MAX_LABEL_CHARS)) return { invalidReason: "malformed" };
  if (value.type === "return_value") return normalizeReturnValueCriterion(value);
  if (value.type === "artifact") return normalizeArtifactCriterion(value);
  if (value.type === "absence") return normalizeAbsenceCriterion(value);
  return { invalidReason: "malformed" };
}

function normalizeReturnValueCriterion(value: Record<string, unknown>): { criterion: ReturnValueCriterionV2 } | { invalidReason: VerificationContractInvalidReasonV2 } {
  if (!hasExactKeys(value, ["id", "type", "label", "adapter", "cases"]) || !Array.isArray(value.cases) ||
    value.cases.length < 1 || value.cases.length > MAX_RETURN_CASES) return { invalidReason: "malformed" };
  const adapter = normalizeScalarAdapter(value.adapter);
  if (!adapter || !value.cases.every(isReturnValueCase)) return { invalidReason: "malformed" };
  const caseIds = new Set<string>();
  for (const testCase of value.cases) {
    if (caseIds.has(testCase.id)) return { invalidReason: "duplicate_id" };
    caseIds.add(testCase.id);
  }
  return { criterion: { id: value.id as string, type: "return_value", label: value.label as string, adapter, cases: value.cases } };
}

function normalizeScalarAdapter(value: unknown): NodeExportScalarAdapterV2 | PythonFunctionScalarAdapterV2 | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isSafePath(value.modulePath)) return null;
  if (value.id === "node_export_scalar.v1" && hasExactKeys(value, ["id", "modulePath", "exportName", "moduleFormat"]) &&
    isSafeSymbol(value.exportName) && (value.moduleFormat === "esm" || value.moduleFormat === "commonjs")) {
    return { id: value.id, modulePath: value.modulePath, exportName: value.exportName, moduleFormat: value.moduleFormat };
  }
  if (value.id === "python_function_scalar.v1" && hasExactKeys(value, ["id", "modulePath", "functionName"]) && isSafeSymbol(value.functionName)) {
    return { id: value.id, modulePath: value.modulePath, functionName: value.functionName };
  }
  return null;
}

function normalizeArtifactCriterion(value: Record<string, unknown>): { criterion: ArtifactCriterionV2 } | { invalidReason: VerificationContractInvalidReasonV2 } {
  if (!hasExactKeys(value, ["id", "type", "label", "paths", "artifact"]) || !Array.isArray(value.paths) ||
    value.paths.length < 1 || value.paths.length > 8 || !value.paths.every(isSafePath) || !isRecord(value.artifact)) {
    return { invalidReason: "malformed" };
  }
  const artifact = normalizeArtifact(value.artifact);
  if (!artifact) return { invalidReason: "malformed" };
  return { criterion: { id: value.id as string, type: "artifact", label: value.label as string, paths: value.paths, artifact } };
}

function normalizeArtifact(value: Record<string, unknown>): ArtifactCriterionV2["artifact"] | null {
  if (value.kind === "documentation_literal" && hasExactKeys(value, ["kind", "literal"]) && isBoundedText(value.literal, MAX_VALUE_CHARS)) {
    return { kind: "documentation_literal", literal: value.literal };
  }
  if (value.kind === "workflow_job" && hasOnlyKeys(value, ["kind", "workflowName", "jobName", "runtimeName", "runtimeVersion", "packageScript"]) &&
    isBoundedText(value.workflowName, MAX_VALUE_CHARS) && isBoundedText(value.jobName, MAX_VALUE_CHARS) &&
    optionalBoundedText(value.runtimeName) && optionalBoundedText(value.runtimeVersion) && optionalBoundedText(value.packageScript)) {
    return {
      kind: "workflow_job", workflowName: value.workflowName, jobName: value.jobName,
      ...(typeof value.runtimeName === "string" ? { runtimeName: value.runtimeName } : {}),
      ...(typeof value.runtimeVersion === "string" ? { runtimeVersion: value.runtimeVersion } : {}),
      ...(typeof value.packageScript === "string" ? { packageScript: value.packageScript } : {})
    };
  }
  if (value.kind === "test_case" && hasExactKeys(value, ["kind", "testId"]) && isBoundedText(value.testId, MAX_VALUE_CHARS)) {
    return { kind: "test_case", testId: value.testId };
  }
  return null;
}

function normalizeAbsenceCriterion(value: Record<string, unknown>): { criterion: AbsenceCriterionV2 } | { invalidReason: VerificationContractInvalidReasonV2 } {
  if (!hasExactKeys(value, ["id", "type", "label", "prohibitedKind", "scope"]) || value.prohibitedKind !== "path_change" ||
    !Array.isArray(value.scope) || value.scope.length < 1 || value.scope.length > 8) return { invalidReason: "malformed" };
  const scope: AbsenceCriterionV2["scope"] = [];
  for (const item of value.scope) {
    if (!isRecord(item) || !hasExactKeys(item, ["kind", "path"]) || (item.kind !== "exact" && item.kind !== "prefix") || !isSafePath(item.path) ||
      (item.kind === "prefix" && !item.path.endsWith("/"))) return { invalidReason: "malformed" };
    scope.push({ kind: item.kind, path: item.path });
  }
  return { criterion: { id: value.id as string, type: "absence", label: value.label as string, prohibitedKind: "path_change", scope } };
}

function isReturnValueCase(value: unknown): value is ReturnValueCaseV2 {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "input", "expected"]) || !isIdentifier(value.id) || !isScalar(value.expected)) return false;
  return !Object.prototype.hasOwnProperty.call(value, "input") || isScalar(value.input);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ||
    (typeof value === "string" && value.length <= MAX_VALUE_CHARS);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function isSafePath(value: unknown): value is string {
  return typeof value === "string" && SAFE_PATH.test(value);
}

function isSafeSymbol(value: unknown): value is string {
  return typeof value === "string" && SAFE_SYMBOL.test(value);
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function optionalBoundedText(value: unknown): boolean {
  return value === undefined || isBoundedText(value, MAX_VALUE_CHARS);
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function utf8Size(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
