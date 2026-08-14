import type { VerificationReport } from "./types";
import { validateLlmSemanticCandidate } from "./llm-semantic-output";
import {
  hasPassingEvidenceStatusPrefix,
  isExecutionEvidenceSignal,
  isFailedAmbiguousActionsExecutionSignal
} from "./evidence-status";
import {
  artifactEvidenceMatchesAnyPath,
  executionEvidenceMatchesAnyTestPath
} from "./evidence-relation";
import { evidenceOverlapsCanonicalRequirement } from "./requirement-relevance";
import {
  requirementProofAxisExpectations,
  requirementProofAxisExpectationsWithContext,
  type DeterministicProofContext
} from "./verifier-proof-expectations";
import { aggregateVerificationCriteriaV2 } from "./verification-contract-v2";
import {
  PROOF_AXIS_COLLECTION_BASES,
  PROOF_AXIS_SUBJECTS,
  isProofAxisCollectionBasis,
  isProofAxisCollectionBasisAllowed,
  isProofAxisSubject,
} from "./proof-contract";

const PRIORITIES = new Set(["low", "medium", "high", "blocker"]);
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const REQUIREMENT_AUTHORITIES = new Set(["pr_description"]);
const PROOF_AXIS_POLARITIES = new Set(["present", "absent"]);
const PROOF_AXIS_STATES = new Set(["satisfied", "violated", "incomplete"]);
const PROOF_AXIS_SUBJECT_SET = new Set<string>(PROOF_AXIS_SUBJECTS);
const PROOF_COLLECTION_BASES = new Set<string>(PROOF_AXIS_COLLECTION_BASES);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);
const EVIDENCE_KINDS = new Set(["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"]);
const TARGET_AGENTS = new Set(["codex", "claude_code", "cursor", "copilot"]);
const CLASSIFICATION_BASES = new Set(["deterministic", "enhanced_plan"]);
const REQUIREMENT_CONTEXT_ROLES = new Set([
  "problem_context",
  "reproduction_context",
  "environment_context",
  "visual_context",
  "external_reference",
  "solution_hint",
  "author_claim"
]);
const REQUIREMENT_SOURCE_QUALITIES = new Set([
  "linked_issue",
  "explicit_acceptance_criteria",
  "expected_behavior",
  "requirement_language",
  "problem_statement",
  "solution_hint",
  "author_claim",
  "manual_check",
  "fallback"
]);
const REQUIREMENT_SOURCES = new Set(["task", "issue", "pr_description", "manual"]);
const PROOF_GAP_KINDS = new Set([
  "missing_implementation",
  "missing_targeted_test",
  "missing_execution",
  "failed_execution",
  "interaction_proof_missing",
  "ambiguous_requirement",
  "self_reported_test_gap",
  "evidence_unavailable",
  "forbidden_implementation_present",
  "visual_proof_missing"
]);
const SUMMARY_ONLY_RAW_PROOF_TEXT_PATTERN = /\b(Patch excerpt|raw_details|raw diff|raw log|full log|raw patch|raw annotation|BEGIN PRIVATE KEY)\b/i;

const LIMITS = {
  analysisId: 160,
  createdAt: 80,
  sourceTitle: 600,
  sourceUrl: 500,
  sourceField: 120,
  summaryOneLine: 1000,
  summaryTopRisks: 20,
  requirementCount: 40,
  requirementText: 2000,
  requirementGaps: 20,
  claimCount: 40,
  claimText: 2000,
  scopeFiles: 100,
  missingTests: 100,
  reviewPriority: 100,
  proofGraphNodes: 40,
  proofGraphContext: 30,
  proofGraphGaps: 20,
  verificationContractGaps: 4,
  proofGraphFiles: 20,
  reprompt: 6000,
  evidenceIndex: 200,
  evidenceLabel: 600,
  evidenceLocator: 1000,
  evidenceSummary: 3000,
  evidenceRefs: 50,
  provenanceCount: 20,
  provenanceText: 600,
  limitationCount: 50,
  shortText: 600
};

export interface ReportValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ReportValidationOptions {
  mode?: "default" | "full" | "summary" | "tenant" | "legacy_read" | "v2_full" | "v2_summary" | "v2_tenant";
  requireFullProvenance?: boolean;
  requireSourceProvenance?: boolean;
}

type RecordValue = Record<string, unknown>;

export function validateVerificationReport(report: unknown, options: ReportValidationOptions = {}): ReportValidationResult {
  const errors: string[] = [];
  const mode = options.mode ?? (options.requireFullProvenance ? "full" : "default");

  if (!isRecord(report)) {
    return { valid: false, errors: ["Report must be an object."] };
  }

  const isV2 = report.reportSchemaVersion === "verification-report.v2";
  const isV2Mode = mode === "v2_full" || mode === "v2_summary" || mode === "v2_tenant";
  if (isV2 && !isV2Mode) {
    return { valid: false, errors: ["v2 reports must be validated through a v2 validation mode."] };
  }
  if (!isV2 && isV2Mode) {
    return { valid: false, errors: ["v2 validation requires reportSchemaVersion verification-report.v2."] };
  }

  requireKeys(
    report,
    [
      "analysisId",
      "createdAt",
      "source",
      "summary",
      "requirements",
      "claims",
      "scope",
      "testing",
      "reviewPriority",
      "proofGraph",
      "reprompt",
      "evidenceIndex",
      "limitations"
    ],
    "report",
    errors,
    ["analysisContext", "authenticity", "semantic", "semanticAnalysis", "planner", ...(isV2 ? ["reportSchemaVersion", "verificationContract"] : [])]
  );

  validateString(report.analysisId, "analysisId", LIMITS.analysisId, errors);
  validateString(report.createdAt, "createdAt", LIMITS.createdAt, errors);
  if (report.analysisContext !== undefined && report.analysisContext !== "linked_issue" && report.analysisContext !== "unlinked_pr" && report.analysisContext !== "provided_requirement") {
    errors.push("analysisContext is invalid.");
  }

  const evidenceIds = validateEvidenceIndex(report.evidenceIndex, errors);
  const evidenceById = collectEvidenceById(report.evidenceIndex);
  const requirementIds = collectRequirementIds(report.requirements);
  validateSource(report.source, errors, options.requireSourceProvenance === true);
  validateSummary(report.summary, errors);
  validateRequirements(report.requirements, evidenceIds, errors, isV2);
  validateClaims(report.claims, evidenceIds, errors);
  validateScope(report.scope, evidenceIds, errors);
  validateTesting(report.testing, evidenceIds, errors);
  validateReviewPriority(report.reviewPriority, evidenceIds, errors);
  validateProofGraph(report.proofGraph, evidenceIds, evidenceById, requirementIds, mode, errors);
  validateReprompt(report.reprompt, errors);
  validateStringArray(report.limitations, "limitations", LIMITS.limitationCount, LIMITS.shortText, errors);
  validateSemanticAnalysis(report.semantic, requirementIds, report.evidenceIndex, errors);
  validateSemanticRuntimeState(report.semanticAnalysis, report.semantic, errors);
  validatePlannerProvenance(report.planner, mode, report.authenticity, errors);
  validatePlanningFieldConsistency(report, errors);
  validateAuthenticity(report.authenticity, errors);
  if (mode === "summary" || mode === "v2_summary") {
    validateSummaryOnlyReport(report, errors);
  }
  if (mode === "full") {
    validateFullReportProvenance(report, evidenceIds, errors);
    validateFullReportSemantics(report, evidenceIds, errors);
  }
  if (isV2) {
    validateVerificationContractV2(report, evidenceIds, errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateVerificationContractV2(report: RecordValue, evidenceIds: Set<string>, errors: string[]): void {
  if (report.reportSchemaVersion !== "verification-report.v2") {
    errors.push("report.reportSchemaVersion must be verification-report.v2.");
    return;
  }
  if (isRecord(report.authenticity) && isRecord(report.authenticity.generator) &&
    report.authenticity.generator.reportSchemaVersion !== "verification-report.v2") {
    errors.push("v2 report authenticity must declare verification-report.v2.");
  }
  if (!isRecord(report.verificationContract)) {
    errors.push("v2 report requires verificationContract.");
    return;
  }
  const contract = report.verificationContract;
  requireKeys(contract, ["version", "policy", "state", "source", "gaps", "objectives"], "verificationContract", errors, ["integrity"]);
  if (contract.version !== 2 || contract.policy !== "strict_typed_contract") {
    errors.push("verificationContract version or policy is invalid.");
  }
  const state = contract.state;
  if (state !== "authoritative" && state !== "author_claim" && state !== "absent" && state !== "invalid") {
    errors.push("verificationContract.state is invalid.");
    return;
  }
  if ((state === "absent" || state === "invalid") && contract.source !== null) {
    errors.push("absent or invalid verification contracts must not expose a source.");
  }
  if ((state === "authoritative" || state === "author_claim") && (!isRecord(contract.source) ||
    (contract.source.kind !== "linked_issue" && contract.source.kind !== "provided_requirement" && contract.source.kind !== "pr_description"))) {
    errors.push("active verification contracts require a recognized source kind.");
  }
  validateVerificationContractGaps(contract.gaps, state, errors);
  const objectives = Array.isArray(contract.objectives) ? contract.objectives : null;
  if (!objectives) {
    errors.push("verificationContract.objectives must be an array.");
    return;
  }
  if ((state === "absent" || state === "invalid") && objectives.length !== 0) {
    errors.push("absent or invalid verification contracts cannot contain objectives.");
  }
  if ((state === "authoritative" || state === "author_claim") && (objectives.length < 1 || objectives.length > 12)) {
    errors.push("active verification contracts require 1 to 12 objectives.");
  }

  const requirements = Array.isArray(report.requirements) ? report.requirements.filter(isRecord) : [];
  const nodes = isRecord(report.proofGraph) && Array.isArray(report.proofGraph.nodes)
    ? report.proofGraph.nodes.filter(isRecord)
    : [];
  const requirementIds = new Set(requirements.map((requirement) => requirement.requirementId).filter((id): id is string => typeof id === "string"));
  const nodeIds = new Set(nodes.map((node) => node.requirementId).filter((id): id is string => typeof id === "string"));
  const objectiveIds = new Set<string>();

  for (const [index, objective] of objectives.entries()) {
    const path = `verificationContract.objectives[${index}]`;
    if (!isRecord(objective)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(objective, ["requirementId", "state", "criteria", "criterionResults"], path, errors);
    if (typeof objective.requirementId !== "string" || !/^vc_o[1-9]\d*$/.test(objective.requirementId) || objectiveIds.has(objective.requirementId)) {
      errors.push(`${path}.requirementId must be a unique canonical v2 ID.`);
      continue;
    }
    objectiveIds.add(objective.requirementId);
    if (objective.state !== state || !requirementIds.has(objective.requirementId) || !nodeIds.has(objective.requirementId)) {
      errors.push(`${path} must map one-to-one to the requirement and proof-graph node.`);
    }
    const criteria = Array.isArray(objective.criteria) ? objective.criteria : null;
    const results = Array.isArray(objective.criterionResults) ? objective.criterionResults : null;
    if (!criteria || !results || criteria.length < 1 || criteria.length > 4 || criteria.length !== results.length) {
      errors.push(`${path} requires one-to-four criteria and same-order results.`);
      continue;
    }
    const criterionIds = new Set<string>();
    const states: Array<"satisfied" | "violated" | "incomplete" | "unavailable"> = [];
    for (const [criterionIndex, criterion] of criteria.entries()) {
      const criterionPath = `${path}.criteria[${criterionIndex}]`;
      const result = results[criterionIndex];
      if (!isRecord(criterion) || !isRecord(result)) {
        errors.push(`${criterionPath} and its result must be objects.`);
        continue;
      }
      requireKeys(criterion, ["criterionId", "required", "approval", "label", "type", "requiredEvidence"], criterionPath, errors, ["artifactKind", "absenceKind"]);
      requireKeys(result, ["criterionId", "state", "proofAxisRefs", "evidenceRefs", "gapKinds"], `${path}.criterionResults[${criterionIndex}]`, errors);
      const expectedCriterionId = `${objective.requirementId}_c${criterionIndex + 1}`;
      if (criterion.criterionId !== expectedCriterionId || result.criterionId !== expectedCriterionId || criterionIds.has(expectedCriterionId)) {
        errors.push(`${criterionPath} has an invalid canonical criterion ID.`);
      }
      criterionIds.add(expectedCriterionId);
      if (criterion.required !== true || (state === "authoritative" && criterion.approval !== "source_explicit") ||
        (state === "author_claim" && criterion.approval !== "author_claim")) {
        errors.push(`${criterionPath} has invalid required or approval fields.`);
      }
      if (criterion.type !== "return_value" && criterion.type !== "artifact" && criterion.type !== "absence") {
        errors.push(`${criterionPath}.type is invalid.`);
      }
      if (criterion.type === "artifact" &&
        criterion.artifactKind !== "documentation_literal" && criterion.artifactKind !== "workflow_job" && criterion.artifactKind !== "test_case") {
        errors.push(`${criterionPath}.artifactKind is invalid.`);
      }
      if (criterion.type === "absence" && criterion.absenceKind !== "path_change") {
        errors.push(`${criterionPath}.absenceKind is invalid.`);
      }
      if (criterion.type === "return_value" && (criterion.artifactKind !== undefined || criterion.absenceKind !== undefined)) {
        errors.push(`${criterionPath} return-value criterion must not include static kind fields.`);
      }
      if (!Array.isArray(criterion.requiredEvidence) || criterion.requiredEvidence.length === 0) {
        errors.push(`${criterionPath}.requiredEvidence must be nonempty.`);
      }
      if (result.state !== "satisfied" && result.state !== "violated" && result.state !== "incomplete" && result.state !== "unavailable") {
        errors.push(`${path}.criterionResults[${criterionIndex}].state is invalid.`);
      } else {
        states.push(result.state);
      }
      if (result.state === "satisfied") {
        const satisfiedAbsenceInventory = criterion.type === "absence" && hasAuthoritativeReportChangedFileInventory(report);
        if (criterion.type === "return_value") {
          errors.push(`${path}.criterionResults[${criterionIndex}] return-value satisfied state requires an attested executor result.`);
        }
        if (criterion.type === "artifact" && criterion.artifactKind !== "documentation_literal") {
          errors.push(`${path}.criterionResults[${criterionIndex}] artifact kind cannot be satisfied until its immutable evaluator is configured.`);
        }
        if (criterion.type === "absence" && !satisfiedAbsenceInventory) {
          errors.push(`${path}.criterionResults[${criterionIndex}] absence satisfied state requires a complete exact-head changed-file inventory.`);
        }
        if (!Array.isArray(result.evidenceRefs) || (result.evidenceRefs.length === 0 && !satisfiedAbsenceInventory)) {
          errors.push(`${path}.criterionResults[${criterionIndex}] satisfied state requires deterministic evidence references.`);
        } else if (result.evidenceRefs.length > 0) {
          validateEvidenceRefs(result.evidenceRefs, `${path}.criterionResults[${criterionIndex}].evidenceRefs`, evidenceIds, errors);
          const requirement = requirements.find((item) => item.requirementId === objective.requirementId);
          const requirementEvidenceRefs = Array.isArray(requirement?.evidenceRefs)
            ? requirement.evidenceRefs.filter((ref): ref is string => typeof ref === "string")
            : [];
          if (result.evidenceRefs.some((ref) => !requirementEvidenceRefs.includes(ref))) {
            errors.push(`${path}.criterionResults[${criterionIndex}] satisfied evidence must also support its requirement.`);
          }
        }
        if (!Array.isArray(result.gapKinds) || result.gapKinds.length !== 0) {
          errors.push(`${path}.criterionResults[${criterionIndex}] satisfied state cannot include gaps.`);
        }
      }
    }
    const expectedStatus = aggregateVerificationCriteriaV2(state, states);
    const requirement = requirements.find((item) => item.requirementId === objective.requirementId);
    const node = nodes.find((item) => item.requirementId === objective.requirementId);
    if (requirement?.status !== expectedStatus || node?.status !== expectedStatus) {
      errors.push(`${path} status must be derived only from its criterion results.`);
    }
  }

  if ((state === "authoritative" || state === "author_claim") &&
    (objectiveIds.size !== requirements.length || objectiveIds.size !== nodes.length)) {
    errors.push("v2 objectives must cover every requirement and proof-graph node exactly once.");
  }
  if ((state === "absent" || state === "invalid") && requirements.some((requirement) => requirement.status === "met")) {
    errors.push("absent or invalid verification contracts cannot produce met requirements.");
  }
}

function validateVerificationContractGaps(value: unknown, state: "authoritative" | "author_claim" | "absent" | "invalid", errors: string[]): void {
  const gaps = validateArray(value, "verificationContract.gaps", LIMITS.verificationContractGaps, errors);
  if (!gaps) return;
  const expected = state === "absent" ? "verification_contract_missing" : state === "invalid" ? "verification_contract_invalid" : undefined;
  if (expected ? gaps.length !== 1 : gaps.length !== 0) {
    errors.push(expected
      ? `verificationContract.${state} state requires exactly one ${expected} gap.`
      : "active verification contracts cannot contain report-level gaps.");
  }
  for (const [index, gap] of gaps.entries()) {
    const path = `verificationContract.gaps[${index}]`;
    if (!isRecord(gap)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(gap, ["kind", "message"], path, errors);
    if (gap.kind !== "verification_contract_missing" && gap.kind !== "verification_contract_invalid" &&
      gap.kind !== "criterion_evidence_incomplete" && gap.kind !== "criterion_evidence_unavailable") {
      errors.push(`${path}.kind is invalid.`);
    }
    if (expected && gap.kind !== expected) errors.push(`${path}.kind must be ${expected}.`);
    validateString(gap.message, `${path}.message`, LIMITS.shortText, errors);
  }
}

function validatePlannerProvenance(
  value: unknown,
  mode: NonNullable<ReportValidationOptions["mode"]>,
  authenticity: unknown,
  errors: string[]
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("planner must be an object.");
    return;
  }
  const trust = isRecord(authenticity) ? authenticity.trust : undefined;
  const hashlessSummary = mode === "summary" &&
    (trust === "portable_unverified" || trust === "verified_agentproof" || trust === "imported_unverified");
  const hasInputHash = Object.hasOwn(value, "inputHash");
  const neutralKeys = ["version", "contractVersion", "schemaVersion", "promptVersion", "model"];

  if (hashlessSummary) {
    requireKeys(value, neutralKeys, "planner", errors);
    if (hasInputHash) errors.push("public summary planner provenance must omit planner.inputHash.");
  } else {
    requireKeys(value, [...neutralKeys, "inputHash"], "planner", errors);
    if (mode === "summary" && !hasInputHash) {
      errors.push("hashless planner provenance requires public-summary authenticity.");
    }
  }
  if (value.version !== 1) errors.push("planner.version must be 1.");
  if (value.contractVersion !== "hybrid_requirement_planner.v1") errors.push("planner.contractVersion is invalid.");
  if (value.schemaVersion !== "agentproof_requirement_span_plan_v1") errors.push("planner.schemaVersion is invalid.");
  if (value.promptVersion !== "2026-08-12.v1") errors.push("planner.promptVersion is invalid.");
  if (value.model !== "gpt-5-mini") errors.push("planner.model is invalid.");
  if (!hashlessSummary && (typeof value.inputHash !== "string" || !/^[a-f0-9]{64}$/.test(value.inputHash))) {
    errors.push("planner.inputHash must be a lowercase SHA-256 digest.");
  }
}

function validatePlanningFieldConsistency(report: RecordValue, errors: string[]) {
  const nodes = new Map<string, RecordValue>();
  let enhancedNodeCount = 0;
  let proofNodeCount = 0;
  if (isRecord(report.proofGraph) && Array.isArray(report.proofGraph.nodes)) {
    for (const node of report.proofGraph.nodes) {
      if (!isRecord(node)) continue;
      proofNodeCount += 1;
      if (node.classificationBasis !== undefined) validateEnum(node.classificationBasis, "proofGraph node classificationBasis", CLASSIFICATION_BASES, errors);
      if (node.classificationBasis === "enhanced_plan") enhancedNodeCount += 1;
      if (typeof node.requirementId === "string") nodes.set(node.requirementId, node);
    }
  }
  if (!Array.isArray(report.requirements)) return;
  const requirementCount = report.requirements.filter(isRecord).length;
  const requirementsById = new Map<string, RecordValue>();
  let enhancedRequirementCount = 0;
  for (const [index, requirement] of report.requirements.entries()) {
    if (!isRecord(requirement)) continue;
    const path = `requirements[${index}]`;
    if (typeof requirement.requirementId === "string") requirementsById.set(requirement.requirementId, requirement);
    if (requirement.classificationBasis !== undefined) validateEnum(requirement.classificationBasis, `${path}.classificationBasis`, CLASSIFICATION_BASES, errors);
    if (requirement.classificationBasis === "enhanced_plan") enhancedRequirementCount += 1;
    if (requirement.plannerAxisSubjects !== undefined) {
      if (requirement.classificationBasis !== "enhanced_plan") errors.push(`${path}.plannerAxisSubjects requires enhanced_plan classificationBasis.`);
      if (report.planner === undefined) errors.push(`${path}.plannerAxisSubjects requires planner provenance.`);
      const subjects = validateArray(requirement.plannerAxisSubjects, `${path}.plannerAxisSubjects`, 4, errors);
      const axes = Array.isArray(requirement.proofAxes) ? requirement.proofAxes : [];
      const axisSubjects = new Set(axes.flatMap((axis) => isRecord(axis) && typeof axis.subject === "string" ? [axis.subject] : []));
      const seen = new Set<string>();
      for (const [subjectIndex, subject] of (subjects ?? []).entries()) {
        if (typeof subject !== "string" || !PROOF_AXIS_SUBJECT_SET.has(subject)) {
          errors.push(`${path}.plannerAxisSubjects[${subjectIndex}] is invalid.`);
          continue;
        }
        if (seen.has(subject)) errors.push(`${path}.plannerAxisSubjects must be unique.`);
        seen.add(subject);
        if (!axisSubjects.has(subject)) errors.push(`${path}.plannerAxisSubjects must be a subset of proofAxes subjects.`);
      }
    }
    const node = typeof requirement.requirementId === "string" ? nodes.get(requirement.requirementId) : undefined;
    if (node && requirement.classificationBasis !== node.classificationBasis) {
      errors.push(`${path}.classificationBasis must match proofGraph node classificationBasis.`);
    }
  }
  if ((enhancedRequirementCount > 0 || enhancedNodeCount > 0) && report.planner === undefined) {
    errors.push("enhanced planning classifications require planner provenance.");
  }
  // A valid Task 3 exclusion may intentionally materialize no requirements at
  // all. Otherwise a planner marker must be backed by matching enhanced pairs.
  if (report.planner !== undefined && (requirementCount > 0 || proofNodeCount > 0) &&
      (enhancedRequirementCount === 0 || enhancedNodeCount === 0 || enhancedRequirementCount !== enhancedNodeCount)) {
    errors.push("planner provenance requires matching enhanced requirement and proof-node classifications.");
  }
  if (report.planner !== undefined && requirementCount > 0) {
    for (const [index, requirement] of report.requirements.entries()) {
      if (!isRecord(requirement)) continue;
      if (requirement.classificationBasis !== "enhanced_plan") {
        errors.push(`planner provenance requires every materialized requirement to use enhanced_plan classificationBasis (requirements[${index}]).`);
      }
      const node = typeof requirement.requirementId === "string" ? nodes.get(requirement.requirementId) : undefined;
      if (!node || node.classificationBasis !== "enhanced_plan") {
        errors.push(`planner provenance requires matching enhanced_plan proof node for requirements[${index}].`);
      }
    }
    for (const [requirementId, node] of nodes.entries()) {
      if (requirementsById.has(requirementId) && node.classificationBasis !== "enhanced_plan") {
        errors.push(`planner provenance requires every materialized proof node to use enhanced_plan classificationBasis (${requirementId}).`);
      }
    }
  }
}

function validateSemanticAnalysis(
  value: unknown,
  requirementIds: Set<string>,
  evidenceIndex: unknown,
  errors: string[]
) {
  if (value === undefined) return;
  if (!Array.isArray(evidenceIndex)) {
    errors.push("semantic analysis requires evidenceIndex.");
    return;
  }
  const evidence = evidenceIndex.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.kind !== "string") return [];
    return [{ id: item.id, kind: item.kind as import("./types").EvidenceKind }];
  });
  const validation = validateLlmSemanticCandidate(value, {
    requirementIds: [...requirementIds],
    evidence
  });
  if (validation.disposition !== "accepted") {
    errors.push("semantic analysis is not a fully validated grounded candidate.");
  }
}

function validateSemanticRuntimeState(value: unknown, semantic: unknown, errors: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("semanticAnalysis must be an object.");
    return;
  }
  requireKeys(value, ["status", "attempts"], "semanticAnalysis", errors);
  if (value.status !== "included" && value.status !== "unavailable") {
    errors.push("semanticAnalysis.status is invalid.");
  }
  if (value.attempts !== 1 && value.attempts !== 2) {
    errors.push("semanticAnalysis.attempts is invalid.");
  }
  if (value.status === "included" && semantic === undefined) {
    errors.push("semanticAnalysis.included requires semantic analysis.");
  }
  if (value.status === "unavailable" && semantic !== undefined) {
    errors.push("semanticAnalysis.unavailable must not include semantic analysis.");
  }
}

function validateAuthenticity(value: unknown, errors: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("authenticity must be an object.");
    return;
  }

  requireKeys(value, ["version", "trust", "generator"], "authenticity", errors, ["canonicalDigest", "signingKeyId", "signature"]);
  if (value.version !== 1) errors.push("authenticity.version must be 1.");
  const trust = value.trust;
  if (trust !== "verified_agentproof" && trust !== "imported_unverified" && trust !== "legacy_unverified" && trust !== "portable_unverified") {
    errors.push("authenticity.trust is invalid.");
  }
  if (!isRecord(value.generator)) {
    errors.push("authenticity.generator must be an object.");
  } else {
    requireKeys(value.generator, ["reportSchemaVersion", "deterministicEngineVersion"], "authenticity.generator", errors);
    if (value.generator.reportSchemaVersion !== "verification-report.v1" && value.generator.reportSchemaVersion !== "verification-report.v2") {
      errors.push("authenticity.generator.reportSchemaVersion is invalid.");
    }
    validateString(value.generator.deterministicEngineVersion, "authenticity.generator.deterministicEngineVersion", LIMITS.shortText, errors);
  }

  const hasSignatureFields = value.canonicalDigest !== undefined || value.signingKeyId !== undefined || value.signature !== undefined;
  if (trust === "verified_agentproof") {
    if (typeof value.canonicalDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.canonicalDigest)) errors.push("authenticity.canonicalDigest must be a lowercase SHA-256 digest for verified reports.");
    validateString(value.signingKeyId, "authenticity.signingKeyId", LIMITS.shortText, errors);
    if (typeof value.signature !== "string" || !/^[a-f0-9]{64}$/.test(value.signature)) errors.push("authenticity.signature must be a lowercase HMAC digest for verified reports.");
  } else if (hasSignatureFields) {
    errors.push("unverified report authenticity must not include a canonical signature.");
  }
}

function validateSource(value: unknown, errors: string[], requireSourceProvenance = false) {
  if (!isRecord(value)) {
    errors.push("source must be an object.");
    return;
  }

  requireKeys(value, ["title"], "source", errors, ["url", "author", "baseBranch", "headBranch", "provenance"]);
  validateString(value.title, "source.title", LIMITS.sourceTitle, errors);
  validateOptionalString(value.url, "source.url", LIMITS.sourceUrl, errors);
  validateOptionalString(value.author, "source.author", LIMITS.sourceField, errors);
  validateOptionalString(value.baseBranch, "source.baseBranch", LIMITS.sourceField, errors);
  validateOptionalString(value.headBranch, "source.headBranch", LIMITS.sourceField, errors);
  if (value.provenance === undefined) {
    if (requireSourceProvenance) errors.push("source.provenance is required for this report.");
    return;
  }
  validateSourceProvenance(value.provenance, errors, requireSourceProvenance);
}

function validateSourceProvenance(value: unknown, errors: string[], requireFullHeadSha: boolean) {
  if (!isRecord(value)) { errors.push("source.provenance must be an object."); return; }
  requireKeys(value, ["version", "origin", "evidenceCapturedAt", "inputFingerprint"], "source.provenance", errors, ["headSha", "baseSha", "changedFileInventory", "executionSuites"]);
  if (value.version !== 1) errors.push("source.provenance.version must be 1.");
  const origin = value.origin;
  if (origin !== "github_snapshot" && origin !== "pasted_evidence" && origin !== "demo") errors.push("source.provenance.origin is invalid.");
  validateString(value.evidenceCapturedAt, "source.provenance.evidenceCapturedAt", LIMITS.createdAt, errors);
  if (typeof value.evidenceCapturedAt === "string" && Number.isNaN(Date.parse(value.evidenceCapturedAt))) errors.push("source.provenance.evidenceCapturedAt must be an ISO timestamp.");
  if (origin === "github_snapshot") {
    const shaPattern = requireFullHeadSha ? /^[a-f0-9]{40,64}$/ : /^[a-f0-9]{6,64}$/;
    if (typeof value.headSha !== "string" || !shaPattern.test(value.headSha)) errors.push(requireFullHeadSha ? "source.provenance.headSha must be a full lowercase Git commit SHA for github_snapshot." : "source.provenance.headSha must be a lowercase Git commit SHA for github_snapshot.");
    if (requireFullHeadSha && (typeof value.baseSha !== "string" || !shaPattern.test(value.baseSha))) {
      errors.push("source.provenance.baseSha must be a full lowercase Git commit SHA for github_snapshot.");
    } else if (value.baseSha !== undefined && (typeof value.baseSha !== "string" || !shaPattern.test(value.baseSha))) {
      errors.push("source.provenance.baseSha must be a lowercase Git commit SHA for github_snapshot.");
    }
  } else {
    if (value.headSha !== undefined) errors.push("source.provenance.headSha is allowed only for github_snapshot.");
    if (value.baseSha !== undefined) errors.push("source.provenance.baseSha is allowed only for github_snapshot.");
  }
  if (value.changedFileInventory !== undefined) {
    validateChangedFileInventoryProvenance(value.changedFileInventory, origin, value.headSha, errors);
  }
  if (value.executionSuites !== undefined) {
    validateExecutionSuiteProvenance(value.executionSuites, origin, value.headSha, errors);
  }
  if (!isRecord(value.inputFingerprint)) { errors.push("source.provenance.inputFingerprint must be an object."); return; }
  requireKeys(value.inputFingerprint, ["version", "algorithm", "value", "coverage"], "source.provenance.inputFingerprint", errors);
  if (value.inputFingerprint.version !== 1) errors.push("source.provenance.inputFingerprint.version must be 1.");
  if (value.inputFingerprint.algorithm !== "sha256") errors.push("source.provenance.inputFingerprint.algorithm must be sha256.");
  if (typeof value.inputFingerprint.value !== "string" || !/^[a-f0-9]{64}$/.test(value.inputFingerprint.value)) errors.push("source.provenance.inputFingerprint.value must be a lowercase SHA-256 digest.");
  const expectedCoverage = origin === "github_snapshot" ? "github_metadata" : origin === "pasted_evidence" ? "pasted_metadata" : "demo_fixture";
  if (value.inputFingerprint.coverage !== expectedCoverage) errors.push("source.provenance.inputFingerprint.coverage does not match source.provenance.origin.");
}

function validateExecutionSuiteProvenance(value: unknown, origin: unknown, headSha: unknown, errors: string[]) {
  const suites = validateArray(value, "source.provenance.executionSuites", 12, errors);
  if (!suites) return;

  for (const [index, suite] of suites.entries()) {
    const path = `source.provenance.executionSuites[${index}]`;
    if (!isRecord(suite)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(suite, ["headSha", "status", "executionSource", "runner", "scope", "testPaths"], path, errors);
    if (origin !== "github_snapshot" || suite.headSha !== headSha || typeof headSha !== "string") {
      errors.push(`${path} must be anchored to the GitHub snapshot head.`);
    }
    validateEnum(suite.status, `${path}.status`, CHECK_STATUSES, errors);
    if (suite.status !== "passed") errors.push(`${path}.status must be passed.`);
    validateString(suite.executionSource, `${path}.executionSource`, LIMITS.evidenceLabel, errors);
    validateEnum(suite.runner, `${path}.runner`, new Set(["node_test", "pytest", "go_test", "cargo_test"]), errors);
    validateEnum(suite.scope, `${path}.scope`, new Set(["repository_discovery", "explicit_paths"]), errors);
    validateStringArray(suite.testPaths, `${path}.testPaths`, 60, LIMITS.evidenceLocator, errors);
    if (Array.isArray(suite.testPaths) && suite.testPaths.length === 0) errors.push(`${path}.testPaths must not be empty.`);
  }
}

function validateChangedFileInventoryProvenance(value: unknown, origin: unknown, provenanceHeadSha: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("source.provenance.changedFileInventory must be an object.");
    return;
  }
  requireKeys(value, ["version", "completeness"], "source.provenance.changedFileInventory", errors, ["headSha"]);
  if (value.version !== 1) errors.push("source.provenance.changedFileInventory.version must be 1.");
  if (value.completeness !== "complete" && value.completeness !== "incomplete") {
    errors.push("source.provenance.changedFileInventory.completeness is invalid.");
  }
  if (value.headSha !== undefined && (typeof value.headSha !== "string" || !/^[a-f0-9]{40,64}$/.test(value.headSha))) {
    errors.push("source.provenance.changedFileInventory.headSha must be a full lowercase Git commit SHA.");
  }
  if (value.completeness === "complete" && (
    origin !== "github_snapshot" ||
    typeof provenanceHeadSha !== "string" ||
    value.headSha !== provenanceHeadSha
  )) {
    errors.push("source.provenance.changedFileInventory complete state must match the GitHub snapshot head.");
  }
}

function validateSummary(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("summary must be an object.");
    return;
  }

  requireKeys(value, ["oneLine", "confidence", "priority", "evidenceCoverage", "topRisks"], "summary", errors);
  validateString(value.oneLine, "summary.oneLine", LIMITS.summaryOneLine, errors);
  validateEnum(value.priority, "summary.priority", PRIORITIES, errors);
  validateRange(value.confidence, "summary.confidence", 0, 1, errors);
  validateRange(value.evidenceCoverage, "summary.evidenceCoverage", 0, 100, errors);
  validateStringArray(value.topRisks, "summary.topRisks", LIMITS.summaryTopRisks, LIMITS.shortText, errors);
}

function validateRequirements(value: unknown, evidenceIds: Set<string>, errors: string[], allowIndependentEvidenceStatus = false) {
  const requirements = validateArray(value, "requirements", LIMITS.requirementCount, errors);
  if (!requirements) return;

  for (const [index, item] of requirements.entries()) {
    const path = `requirements[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["requirementId", "requirementText", "status", "evidenceRefs", "gaps", "reviewerNote", "confidence"], path, errors, ["evidenceStatus", "sourceAuthority", "proofAxes", "classificationBasis", "plannerAxisSubjects"]);
    validateString(item.requirementId, `${path}.requirementId`, LIMITS.shortText, errors);
    validateString(item.requirementText, `${path}.requirementText`, LIMITS.requirementText, errors);
    validateEnum(item.status, `${path}.status`, REQUIREMENT_STATUSES, errors);
    if (item.evidenceStatus !== undefined) validateEnum(item.evidenceStatus, `${path}.evidenceStatus`, REQUIREMENT_STATUSES, errors);
    if (item.sourceAuthority !== undefined) validateEnum(item.sourceAuthority, `${path}.sourceAuthority`, REQUIREMENT_AUTHORITIES, errors);
    if (item.evidenceStatus !== undefined && item.sourceAuthority !== "pr_description" && !allowIndependentEvidenceStatus) {
      errors.push(`${path}.evidenceStatus requires pr_description sourceAuthority.`);
    }
    if (item.sourceAuthority === "pr_description" && item.evidenceStatus === undefined) {
      errors.push(`${path}.sourceAuthority requires evidenceStatus.`);
    }
    validateEvidenceRefs(item.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    validateStringArray(item.gaps, `${path}.gaps`, LIMITS.requirementGaps, LIMITS.shortText, errors);
    validateString(item.reviewerNote, `${path}.reviewerNote`, LIMITS.shortText, errors);
    validateRange(item.confidence, `${path}.confidence`, 0, 1, errors);
    if (item.proofAxes !== undefined) validateRequirementProofAxes(item.proofAxes, `${path}.proofAxes`, evidenceIds, errors);
  }
}

function validateRequirementProofAxes(value: unknown, path: string, evidenceIds: Set<string>, errors: string[]) {
  const axes = validateArray(value, path, 12, errors);
  if (!axes) return;
  if (axes.length === 0) errors.push(`${path} must contain at least one axis when present.`);
  const seen = new Set<string>();
  const seenSubjects = new Set<string>();

  for (const [index, item] of axes.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${itemPath} must be an object.`);
      continue;
    }
    requireKeys(item, ["subject", "polarity", "state", "evidenceRefs"], itemPath, errors, ["collectionBasis"]);
    validateEnum(item.subject, `${itemPath}.subject`, PROOF_AXIS_SUBJECT_SET, errors);
    validateEnum(item.polarity, `${itemPath}.polarity`, PROOF_AXIS_POLARITIES, errors);
    validateEnum(item.state, `${itemPath}.state`, PROOF_AXIS_STATES, errors);
    validateEvidenceRefs(item.evidenceRefs, `${itemPath}.evidenceRefs`, evidenceIds, errors);
    if ("collectionBasis" in item) {
      validateEnum(item.collectionBasis, `${itemPath}.collectionBasis`, PROOF_COLLECTION_BASES, errors);
    }
    if (isProofAxisSubject(item.subject) && isProofAxisCollectionBasis(item.collectionBasis) && !isProofAxisCollectionBasisAllowed(item.subject, item.collectionBasis)) {
      errors.push(`${itemPath}.collectionBasis is incompatible with its proof axis subject.`);
    }
    if (typeof item.subject === "string" && typeof item.polarity === "string") {
      const key = `${item.subject}:${item.polarity}`;
      if (seen.has(key)) errors.push(`${itemPath} duplicates proof axis ${key}.`);
      seen.add(key);
      if (seenSubjects.has(item.subject)) errors.push(`${itemPath} duplicates proof axis subject ${item.subject}.`);
      seenSubjects.add(item.subject);
      if (item.polarity === "absent" && item.subject !== "implementation") {
        errors.push(`${itemPath} uses an unsupported absent polarity.`);
      }
    }
    if (item.polarity === "absent" && item.state === "satisfied" && item.collectionBasis !== "complete_changed_file_inventory") {
      errors.push(`${itemPath} cannot satisfy absence without a complete changed-file inventory.`);
    }
    if (item.polarity === "absent" && item.state === "incomplete" && item.collectionBasis !== "incomplete_changed_file_inventory") {
      errors.push(`${itemPath} incomplete absence must record an incomplete changed-file inventory.`);
    }
  }
}

function validateClaims(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  const claims = validateArray(value, "claims", LIMITS.claimCount, errors);
  if (!claims) return;

  for (const [index, item] of claims.entries()) {
    const path = `claims[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["id", "text", "evidenceRefs", "supported"], path, errors);
    validateString(item.id, `${path}.id`, LIMITS.shortText, errors);
    validateString(item.text, `${path}.text`, LIMITS.claimText, errors);
    validateEvidenceRefs(item.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    validateBoolean(item.supported, `${path}.supported`, errors);
  }
}

function validateScope(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("scope must be an object.");
    return;
  }

  requireKeys(value, ["suspected", "outOfScopeFiles", "reasons"], "scope", errors, ["evidenceRefs", "provenance"]);
  validateBoolean(value.suspected, "scope.suspected", errors);
  validateStringArray(value.outOfScopeFiles, "scope.outOfScopeFiles", LIMITS.scopeFiles, LIMITS.sourceUrl, errors);
  validateStringArray(value.reasons, "scope.reasons", LIMITS.scopeFiles, LIMITS.shortText, errors);
  if (value.evidenceRefs !== undefined) {
    validateEvidenceRefs(value.evidenceRefs, "scope.evidenceRefs", evidenceIds, errors);
  }
  if (value.provenance !== undefined) {
    validateFindingProvenance(value.provenance, "scope.provenance", evidenceIds, errors);
  }
}

function validateTesting(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("testing must be an object.");
    return;
  }

  requireKeys(value, ["ciStatus", "lintStatus", "typecheckStatus", "missingTests"], "testing", errors);
  validateEnum(value.ciStatus, "testing.ciStatus", CHECK_STATUSES, errors);
  validateEnum(value.lintStatus, "testing.lintStatus", CHECK_STATUSES, errors);
  validateEnum(value.typecheckStatus, "testing.typecheckStatus", CHECK_STATUSES, errors);

  const missingTests = validateArray(value.missingTests, "testing.missingTests", LIMITS.missingTests, errors);
  if (!missingTests) return;

  for (const [index, item] of missingTests.entries()) {
    const path = `testing.missingTests[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["path", "why", "evidenceRefs"], path, errors, ["provenance"]);
    validateString(item.path, `${path}.path`, LIMITS.sourceUrl, errors);
    validateString(item.why, `${path}.why`, LIMITS.shortText, errors);
    validateEvidenceRefs(item.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    if (item.provenance !== undefined) {
      validateFindingProvenance(item.provenance, `${path}.provenance`, evidenceIds, errors);
    }
  }
}

function validateReviewPriority(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  const items = validateArray(value, "reviewPriority", LIMITS.reviewPriority, errors);
  if (!items) return;

  for (const [index, item] of items.entries()) {
    const path = `reviewPriority[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["path", "reason", "priority"], path, errors, ["evidenceRefs"]);
    validateString(item.path, `${path}.path`, LIMITS.sourceUrl, errors);
    validateString(item.reason, `${path}.reason`, LIMITS.shortText, errors);
    validateEnum(item.priority, `${path}.priority`, PRIORITIES, errors);
    if (item.evidenceRefs !== undefined) {
      validateEvidenceRefs(item.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    }
  }
}

function validateProofGraph(
  value: unknown,
  evidenceIds: Set<string>,
  evidenceById: Map<string, RecordValue>,
  requirementIds: Set<string>,
  mode: ReportValidationOptions["mode"],
  errors: string[]
) {
  if (!isRecord(value)) {
    errors.push("proofGraph must be an object.");
    return;
  }

  requireKeys(value, ["version", "nodes", "context", "summary"], "proofGraph", errors);
  if (value.version !== 1) {
    errors.push("proofGraph.version must be 1.");
  }

  const nodes = validateArray(value.nodes, "proofGraph.nodes", LIMITS.proofGraphNodes, errors);
  if (nodes) {
    const seenRequirementIds = new Set<string>();
    for (const [index, item] of nodes.entries()) {
      const path = `proofGraph.nodes[${index}]`;
      if (!isRecord(item)) {
        errors.push(`${path} must be an object.`);
        continue;
      }

      requireKeys(
        item,
        [
          "requirementId",
          "requirementText",
          "sourceRole",
          "sourceQuality",
          "sourceSection",
          "contextRoles",
          "status",
          "confidence",
          "implementationEvidenceRefs",
          "targetedTestEvidenceRefs",
          "executionEvidenceRefs",
          "gapSignals",
          "firstFiles"
        ],
        path,
        errors,
        ["classificationBasis", "deterministicRelation"]
      );
      validateString(item.requirementId, `${path}.requirementId`, LIMITS.shortText, errors);
      if (typeof item.requirementId === "string" && requirementIds.size > 0 && !requirementIds.has(item.requirementId)) {
        errors.push(`${path}.requirementId must match a report requirement.`);
      }
      if (typeof item.requirementId === "string") {
        if (seenRequirementIds.has(item.requirementId)) {
          errors.push(`${path}.requirementId duplicates proofGraph node for ${item.requirementId}.`);
        }
        seenRequirementIds.add(item.requirementId);
      }
      validateString(item.requirementText, `${path}.requirementText`, LIMITS.requirementText, errors);
      validateEnum(item.sourceRole, `${path}.sourceRole`, new Set(["core_requirement"]), errors);
      validateEnum(item.sourceQuality, `${path}.sourceQuality`, REQUIREMENT_SOURCE_QUALITIES, errors);
      validateOptionalString(item.sourceSection, `${path}.sourceSection`, LIMITS.shortText, errors);
      validateStringEnumArray(item.contextRoles, `${path}.contextRoles`, LIMITS.proofGraphContext, REQUIREMENT_CONTEXT_ROLES, errors);
      validateEnum(item.status, `${path}.status`, REQUIREMENT_STATUSES, errors);
      validateRange(item.confidence, `${path}.confidence`, 0, 1, errors);
      validateEvidenceRefs(item.implementationEvidenceRefs, `${path}.implementationEvidenceRefs`, evidenceIds, errors);
      validateEvidenceRefs(item.targetedTestEvidenceRefs, `${path}.targetedTestEvidenceRefs`, evidenceIds, errors);
      validateEvidenceRefs(item.executionEvidenceRefs, `${path}.executionEvidenceRefs`, evidenceIds, errors);
      if (mode !== "tenant" && mode !== "v2_tenant") {
        validateProofEvidenceClass(item.implementationEvidenceRefs, `${path}.implementationEvidenceRefs`, evidenceById, isImplementationProofEvidence, errors);
        validateProofEvidenceClass(item.targetedTestEvidenceRefs, `${path}.targetedTestEvidenceRefs`, evidenceById, isTargetedTestProofEvidence, errors);
        validateProofEvidenceClass(item.executionEvidenceRefs, `${path}.executionEvidenceRefs`, evidenceById, isExecutionProofEvidence, errors);
      }
      validateStringArray(item.firstFiles, `${path}.firstFiles`, LIMITS.proofGraphFiles, LIMITS.sourceUrl, errors);
      validateProofGapSignals(item.gapSignals, `${path}.gapSignals`, evidenceIds, errors);
      validateDeterministicRelation(item.deterministicRelation, `${path}.deterministicRelation`, requirementIds, errors);
    }
    for (const requirementId of requirementIds) {
      if (!seenRequirementIds.has(requirementId)) {
        errors.push(`proofGraph.nodes must include requirement ${requirementId}.`);
      }
    }
  }

  validateProofGraphContext(value.context, errors);
  validateProofGraphSummary(value.summary, errors);
  validateProofGraphSummaryMatchesNodes(value.summary, nodes, mode === "summary", errors);
}

function validateProofGraphContext(value: unknown, errors: string[]) {
  const contexts = validateArray(value, "proofGraph.context", LIMITS.proofGraphContext, errors);
  if (!contexts) return;

  for (const [index, item] of contexts.entries()) {
    const path = `proofGraph.context[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["id", "source", "role", "sourceQuality", "sourceSection", "text"], path, errors);
    validateString(item.id, `${path}.id`, LIMITS.shortText, errors);
    validateEnum(item.source, `${path}.source`, REQUIREMENT_SOURCES, errors);
    validateEnum(item.role, `${path}.role`, REQUIREMENT_CONTEXT_ROLES, errors);
    validateEnum(item.sourceQuality, `${path}.sourceQuality`, REQUIREMENT_SOURCE_QUALITIES, errors);
    validateOptionalString(item.sourceSection, `${path}.sourceSection`, LIMITS.shortText, errors);
    validateString(item.text, `${path}.text`, LIMITS.shortText, errors);
  }
}

function validateProofGapSignals(value: unknown, path: string, evidenceIds: Set<string>, errors: string[]) {
  const gaps = validateArray(value, path, LIMITS.proofGraphGaps, errors);
  if (!gaps) return;

  for (const [index, item] of gaps.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${itemPath} must be an object.`);
      continue;
    }

    requireKeys(item, ["kind", "severity", "message", "evidenceRefs"], itemPath, errors);
    validateEnum(item.kind, `${itemPath}.kind`, PROOF_GAP_KINDS, errors);
    validateEnum(item.severity, `${itemPath}.severity`, PRIORITIES, errors);
    validateString(item.message, `${itemPath}.message`, LIMITS.shortText, errors);
    validateEvidenceRefs(item.evidenceRefs, `${itemPath}.evidenceRefs`, evidenceIds, errors);
  }
}

function validateDeterministicRelation(
  value: unknown,
  path: string,
  requirementIds: ReadonlySet<string>,
  errors: string[]
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireKeys(value, ["version", "kind", "antecedentRequirementId"], path, errors);
  if (value.version !== 1) errors.push(`${path}.version must be 1.`);
  if (value.kind !== "workflow_antecedent") errors.push(`${path}.kind is invalid.`);
  validateString(value.antecedentRequirementId, `${path}.antecedentRequirementId`, LIMITS.shortText, errors);
  if (typeof value.antecedentRequirementId === "string" && !requirementIds.has(value.antecedentRequirementId)) {
    errors.push(`${path}.antecedentRequirementId must match a report requirement.`);
  }
}

function validateProofGraphSummary(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("proofGraph.summary must be an object.");
    return;
  }

  const keys = [
    "requirementCount",
    "requirementsWithImplementation",
    "requirementsWithTargetedTests",
    "requirementsWithExecution",
    "requirementsWithGaps",
    "gapCount"
  ];
  requireKeys(value, keys, "proofGraph.summary", errors);

  for (const key of keys) {
    const field = value[key];
    if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0 || field > LIMITS.requirementCount * LIMITS.proofGraphGaps) {
      errors.push(`proofGraph.summary.${key} must be a non-negative integer.`);
    }
  }
}

function validateProofGraphSummaryMatchesNodes(
  summary: unknown,
  nodes: unknown[] | null,
  allowOmittedEvidenceCounters: boolean,
  errors: string[]
) {
  if (!isRecord(summary) || !nodes) return;

  const proofNodes = nodes.filter(isRecord);
  const expected = {
    requirementCount: proofNodes.length,
    requirementsWithImplementation: proofNodes.filter((node) => getStringArray(node.implementationEvidenceRefs).length > 0).length,
    requirementsWithTargetedTests: proofNodes.filter((node) => getStringArray(node.targetedTestEvidenceRefs).length > 0).length,
    requirementsWithExecution: proofNodes.filter((node) => getStringArray(node.executionEvidenceRefs).length > 0).length,
    requirementsWithGaps: proofNodes.filter((node) => Array.isArray(node.gapSignals) && node.gapSignals.length > 0).length,
    gapCount: proofNodes.reduce((count, node) => count + (Array.isArray(node.gapSignals) ? node.gapSignals.length : 0), 0)
  };
  const omittedCounterKeys = new Set([
    "requirementsWithImplementation",
    "requirementsWithTargetedTests",
    "requirementsWithExecution"
  ]);

  for (const [key, value] of Object.entries(expected)) {
    if (allowOmittedEvidenceCounters && omittedCounterKeys.has(key)) {
      continue;
    }
    if (summary[key] !== value) {
      errors.push(`proofGraph.summary.${key} must match proofGraph.nodes.`);
    }
  }
}

function validateProofEvidenceClass(
  refs: unknown,
  path: string,
  evidenceById: Map<string, RecordValue>,
  predicate: (evidence: RecordValue) => boolean,
  errors: string[]
) {
  for (const ref of getStringArray(refs)) {
    const evidence = evidenceById.get(ref);
    if (evidence && !predicate(evidence)) {
      errors.push(`${path} cites incompatible evidence ${ref}.`);
    }
  }
}

function collectEvidenceById(value: unknown): Map<string, RecordValue> {
  const evidenceById = new Map<string, RecordValue>();
  if (!Array.isArray(value)) return evidenceById;

  for (const item of value) {
    if (isRecord(item) && typeof item.id === "string") {
      evidenceById.set(item.id, item);
    }
  }

  return evidenceById;
}

function collectRequirementIds(value: unknown): Set<string> {
  const requirementIds = new Set<string>();
  if (!Array.isArray(value)) return requirementIds;

  for (const item of value) {
    if (isRecord(item) && typeof item.requirementId === "string") {
      requirementIds.add(item.requirementId);
    }
  }

  return requirementIds;
}

function isImplementationProofEvidence(evidence: RecordValue): boolean {
  return evidence.kind === "diff" || evidence.kind === "changed_file";
}

function isTargetedTestProofEvidence(evidence: RecordValue): boolean {
  return evidence.kind === "test";
}

function isExecutionProofEvidence(evidence: RecordValue): boolean {
  const kind = evidence.kind;
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const summary = typeof evidence.summary === "string" ? evidence.summary : "";
  const locator = typeof evidence.locator === "string" ? evidence.locator : "";

  return (kind === "check" || kind === "log") &&
    (
      isExecutionEvidenceSignal(label, summary, locator) ||
      isFailedAmbiguousActionsExecutionSignal(label, evidenceStatusFromSummary(summary), locator, summary)
    );
}

function evidenceStatusFromSummary(summary: string): string {
  const match = summary.trim().match(/^Status:\s*(passed|failed|pending|unknown)\b/i);

  return match ? match[1].toLowerCase() : "unknown";
}

function validateReprompt(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("reprompt must be an object.");
    return;
  }

  requireKeys(value, ["targetAgent", "prompt"], "reprompt", errors);
  validateEnum(value.targetAgent, "reprompt.targetAgent", TARGET_AGENTS, errors);
  validateString(value.prompt, "reprompt.prompt", LIMITS.reprompt, errors);
}

function validateEvidenceIndex(value: unknown, errors: string[]): Set<string> {
  const evidenceIds = new Set<string>();
  const evidenceItems = validateArray(value, "evidenceIndex", LIMITS.evidenceIndex, errors);
  if (!evidenceItems) return evidenceIds;

  for (const [index, item] of evidenceItems.entries()) {
    const path = `evidenceIndex[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["id", "kind", "label", "summary", "confidence"], path, errors, ["locator"]);
    validateString(item.id, `${path}.id`, LIMITS.shortText, errors);
    validateEnum(item.kind, `${path}.kind`, EVIDENCE_KINDS, errors);
    validateString(item.label, `${path}.label`, LIMITS.evidenceLabel, errors);
    validateString(item.summary, `${path}.summary`, LIMITS.evidenceSummary, errors);
    validateOptionalString(item.locator, `${path}.locator`, LIMITS.evidenceLocator, errors);
    validateRange(item.confidence, `${path}.confidence`, 0, 1, errors);

    if (typeof item.id === "string") {
      if (evidenceIds.has(item.id)) {
        errors.push(`${path}.id duplicates evidence id ${item.id}.`);
      }
      evidenceIds.add(item.id);
    }
  }

  return evidenceIds;
}

function validateEvidenceRefs(value: unknown, path: string, evidenceIds: Set<string>, errors: string[]) {
  const refs = validateStringArray(value, path, LIMITS.evidenceRefs, LIMITS.shortText, errors);
  if (!refs) return;

  for (const ref of refs) {
    if (!evidenceIds.has(ref)) {
      errors.push(`${path} cites missing evidence ${ref}.`);
    }
  }
}

function validateFindingProvenance(value: unknown, path: string, evidenceIds: Set<string>, errors: string[]) {
  const items = validateArray(value, path, LIMITS.provenanceCount, errors);
  if (!items) return;

  for (const [index, item] of items.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${itemPath} must be an object.`);
      continue;
    }

    requireKeys(item, ["evidenceRef", "sourceType", "confidence", "evidenceText"], itemPath, errors, ["locator"]);
    validateString(item.evidenceRef, `${itemPath}.evidenceRef`, LIMITS.shortText, errors);
    if (typeof item.evidenceRef === "string" && !evidenceIds.has(item.evidenceRef)) {
      errors.push(`${itemPath}.evidenceRef cites missing evidence ${item.evidenceRef}.`);
    }
    validateEnum(item.sourceType, `${itemPath}.sourceType`, EVIDENCE_KINDS, errors);
    validateOptionalString(item.locator, `${itemPath}.locator`, LIMITS.evidenceLocator, errors);
    validateRange(item.confidence, `${itemPath}.confidence`, 0, 1, errors);
    validateString(item.evidenceText, `${itemPath}.evidenceText`, LIMITS.provenanceText, errors);
  }
}

function validateFullReportProvenance(report: RecordValue, evidenceIds: Set<string>, errors: string[]) {
  if (evidenceIds.size === 0) {
    errors.push("evidenceIndex must contain evidence items for full reports.");
    return;
  }

  if (isRecord(report.scope) && report.scope.suspected === true) {
    const refs = getStringArray(report.scope.evidenceRefs);
    if (refs.length === 0 && !hasEvidenceUnavailableNote(report.scope.reasons)) {
      errors.push("scope.evidenceRefs is required for full reports when scope.suspected is true.");
    }
  }

  if (!Array.isArray(report.reviewPriority)) {
    return;
  }

  report.reviewPriority.forEach((item, index) => {
    if (!isRecord(item) || !requiresPriorityEvidence(item)) {
      return;
    }

    const refs = getStringArray(item.evidenceRefs);
    if (refs.length === 0 && !hasEvidenceUnavailableNote([item.reason])) {
      errors.push(`reviewPriority[${index}].evidenceRefs is required for full reports with high-risk or file-specific priority items.`);
    }
  });
}

function validateSummaryOnlyReport(report: RecordValue, errors: string[]) {
  if (Array.isArray(report.evidenceIndex) && report.evidenceIndex.length > 0) {
    errors.push("summary-only reports must omit evidenceIndex items.");
  }

  if (Array.isArray(report.claims) && report.claims.length > 0) {
    errors.push("summary-only reports must omit claims.");
  }

  if (isRecord(report.reprompt) && typeof report.reprompt.prompt === "string" && !/omit|shared summary|summary/i.test(report.reprompt.prompt)) {
    errors.push("summary-only reports must not include raw re-prompt text.");
  }

  if (isRecord(report.scope) && "provenance" in report.scope) {
    errors.push("summary-only reports must omit finding provenance.");
  }

  if (isRecord(report.testing) && Array.isArray(report.testing.missingTests)) {
    report.testing.missingTests.forEach((item, index) => {
      if (isRecord(item) && "provenance" in item) {
        errors.push(`summary-only reports must omit testing.missingTests[${index}].provenance.`);
      }
    });
  }

  if (isRecord(report.proofGraph) && Array.isArray(report.proofGraph.nodes)) {
    report.proofGraph.nodes.forEach((node, index) => {
      if (!isRecord(node)) return;

      for (const key of ["implementationEvidenceRefs", "targetedTestEvidenceRefs", "executionEvidenceRefs"]) {
        if (Array.isArray(node[key]) && node[key].length > 0) {
          errors.push(`summary-only reports must omit proofGraph.nodes[${index}].${key}.`);
        }
      }

      for (const key of ["requirementText", "firstFiles"]) {
        const value = node[key];
        const values = Array.isArray(value) ? value : [value];
        if (values.some((item) => typeof item === "string" && SUMMARY_ONLY_RAW_PROOF_TEXT_PATTERN.test(item))) {
          errors.push(`summary-only reports must omit raw-looking proofGraph.nodes[${index}].${key}.`);
        }
      }

      if (Array.isArray(node.gapSignals)) {
        node.gapSignals.forEach((gap, gapIndex) => {
          if (isRecord(gap) && Array.isArray(gap.evidenceRefs) && gap.evidenceRefs.length > 0) {
            errors.push(`summary-only reports must omit proofGraph.nodes[${index}].gapSignals[${gapIndex}].evidenceRefs.`);
          }
          if (isRecord(gap) && typeof gap.message === "string" && SUMMARY_ONLY_RAW_PROOF_TEXT_PATTERN.test(gap.message)) {
            errors.push(`summary-only reports must omit raw-looking proofGraph.nodes[${index}].gapSignals[${gapIndex}].message.`);
          }
        });
      }
    });
  }

  if (Array.isArray(report.requirements)) {
    report.requirements.forEach((requirement, requirementIndex) => {
      if (!isRecord(requirement) || !Array.isArray(requirement.proofAxes)) return;
      requirement.proofAxes.forEach((axis, axisIndex) => {
        if (isRecord(axis) && Array.isArray(axis.evidenceRefs) && axis.evidenceRefs.length > 0) {
          errors.push(`summary-only reports must omit requirements[${requirementIndex}].proofAxes[${axisIndex}].evidenceRefs.`);
        }
      });
    });
  }

  if (isRecord(report.proofGraph) && Array.isArray(report.proofGraph.context)) {
    report.proofGraph.context.forEach((context, index) => {
      if (!isRecord(context)) return;

      for (const key of ["sourceSection", "text"]) {
        const value = context[key];
        if (typeof value === "string" && SUMMARY_ONLY_RAW_PROOF_TEXT_PATTERN.test(value)) {
          errors.push(`summary-only reports must omit raw-looking proofGraph.context[${index}].${key}.`);
        }
      }
    });
  }
}

function validateFullReportSemantics(report: RecordValue, evidenceIds: Set<string>, errors: string[]) {
  if (evidenceIds.size === 0) return;

  const summary = isRecord(report.summary) ? report.summary : null;
  const testing = isRecord(report.testing) ? report.testing : null;
  const scope = isRecord(report.scope) ? report.scope : null;
  const evidenceById = new Map<string, RecordValue>();
  const proofNodeByRequirement = new Map<string, RecordValue>();

  if (Array.isArray(report.evidenceIndex)) {
    for (const item of report.evidenceIndex) {
      if (isRecord(item) && typeof item.id === "string") {
        evidenceById.set(item.id, item);
      }
    }
  }
  if (isRecord(report.proofGraph) && Array.isArray(report.proofGraph.nodes)) {
    for (const node of report.proofGraph.nodes) {
      if (isRecord(node) && typeof node.requirementId === "string") {
        proofNodeByRequirement.set(node.requirementId, node);
      }
    }
  }

  if (summary && testing?.ciStatus === "failed") {
    if (summary.priority !== "blocker") {
      errors.push("summary.priority must be blocker when CI status is failed.");
    }
    if (typeof summary.confidence === "number" && summary.confidence > 0.55) {
      errors.push("summary.confidence must be capped when CI status is failed.");
    }
  }

  const missingTests = Array.isArray(testing?.missingTests) ? testing.missingTests.length : 0;
  const hasScopeRisk = scope?.suspected === true;
  if (summary && (missingTests > 0 || hasScopeRisk) && typeof summary.confidence === "number" && summary.confidence > 0.9) {
    errors.push("summary.confidence must be capped when missing-test or scope-creep risks exist.");
  }

  if (
    summary &&
    (testing?.ciStatus === "unknown" || testing?.ciStatus === "pending") &&
    typeof summary.confidence === "number" &&
    summary.confidence > 0.85
  ) {
    errors.push("summary.confidence must be capped when CI status is unknown or pending.");
  }

  if (
    testing?.ciStatus === "passed" &&
    !Array.from(evidenceById.values()).some((evidence) => isPassingTestExecutionEvidence(evidence))
  ) {
    errors.push("testing.ciStatus cannot be passed without passing test, build, or CI execution evidence.");
  }

  if (!Array.isArray(report.requirements)) {
    return;
  }

  report.requirements.forEach((item, index) => {
    if (!isRecord(item)) return;

    const axes = Array.isArray(item.proofAxes) ? item.proofAxes.filter(isRecord) : null;
    const proofNode = proofNodeByRequirement.get(typeof item.requirementId === "string" ? item.requirementId : "");
    const requirementText = typeof item.requirementText === "string" ? item.requirementText : "";
    const proofNodeText = typeof proofNode?.requirementText === "string" ? proofNode.requirementText : "";
    const duplicateTextMatches = proofNode !== undefined && proofNodeText === requirementText;
    const duplicateStatusMatches = proofNode !== undefined && proofNode.status === item.status;
    if (proofNode && !duplicateTextMatches) {
      errors.push(`proofGraph node requirementText must match requirements[${index}].requirementText.`);
    }
    if (axes && proofNode && !duplicateStatusMatches) {
      errors.push(`requirements[${index}].status must match proofGraph node status.`);
    }
    if (axes) {
      validateFullRequirementProofAxes(
        report,
        requirementText,
        proofNode,
        axes,
        evidenceById,
        deterministicProofContextForFullReport(proofNode, proofNodeByRequirement),
        index,
        errors
      );
    }

    const matchingAuthorClaimPartial = item.status === "partial" &&
      proofNode?.sourceQuality === "author_claim" &&
      proofNode.status === "partial" &&
      duplicateTextMatches;
    if (item.sourceAuthority !== undefined || item.evidenceStatus !== undefined) {
      if (item.sourceAuthority !== "pr_description" || proofNode?.sourceQuality !== "author_claim") {
        errors.push(`requirements[${index}] sourceAuthority must match an author-claim proof node.`);
      }
      if (!axes || axes.length === 0) {
        if (item.evidenceStatus !== item.status) {
          errors.push(`requirements[${index}] evidenceStatus without proof axes must match status.`);
        }
      } else if (axes.every((axis) => axis.state === "satisfied") && item.evidenceStatus !== "met") {
        errors.push(`requirements[${index}] evidenceStatus must be met when every proof axis is satisfied.`);
      } else if (item.evidenceStatus === "met" && axes.some((axis) => axis.state !== "satisfied")) {
        errors.push(`requirements[${index}] evidenceStatus cannot be met without every proof axis satisfied.`);
      }
    }
    if (
      axes &&
      axes.length > 0 &&
      axes.every((axis) => axis.state === "satisfied") &&
      item.status !== "met" &&
      !matchingAuthorClaimPartial
    ) {
      errors.push(`requirements[${index}] status must agree with proofAxes; every satisfied authoritative axis requires met.`);
    }

    if (item.status === "met" && Array.isArray(item.gaps) && item.gaps.length > 0) {
      errors.push(`requirements[${index}] cannot be met while evidence gaps are present.`);
    }

    if (item.status !== "met") {
      return;
    }

    if (axes) {
      if (axes.length === 0 || axes.some((axis) => axis.state !== "satisfied")) {
        errors.push(`requirements[${index}] status must agree with proofAxes; met requires every axis satisfied.`);
        if (axes.some((axis) => axis.subject === "execution" && axis.state !== "satisfied")) {
          errors.push(`requirements[${index}] cannot be met without passing test, build, or CI execution evidence.`);
        }
      }
      return;
    }

    const refs = getStringArray(item.evidenceRefs);
    const hasPassingTestExecution = refs
      .map((ref) => evidenceById.get(ref))
      .some((evidence) => evidence ? isPassingTestExecutionEvidence(evidence) : false);

    if (!hasPassingTestExecution) {
      errors.push(`requirements[${index}] cannot be met without passing test, build, or CI execution evidence.`);
    }

    if (typeof item.requirementText !== "string" || !/\b(tests?|coverage|specs?)\b/i.test(item.requirementText)) {
      return;
    }

    if (!hasPassingTestExecution) {
      errors.push(`requirements[${index}] test requirement cannot be met without passing test execution evidence.`);
    }
  });

  if (!Array.isArray(report.claims)) {
    return;
  }

  report.claims.forEach((item, index) => {
    if (!isRecord(item) || item.supported !== true || typeof item.text !== "string" || !isExecutionClaim(item.text)) {
      return;
    }

    const refs = getStringArray(item.evidenceRefs);
    const hasPassingTestExecution = refs
      .map((ref) => evidenceById.get(ref))
      .some((evidence) => evidence ? isPassingTestExecutionEvidence(evidence) : false);

    if (!hasPassingTestExecution) {
      errors.push(`claims[${index}] execution claim cannot be supported without passing test or CI execution evidence.`);
    }
  });
}

function validateFullRequirementProofAxes(
  report: RecordValue,
  requirementText: string,
  proofNode: RecordValue | undefined,
  axes: RecordValue[],
  evidenceById: Map<string, RecordValue>,
  proofContext: DeterministicProofContext,
  requirementIndex: number,
  errors: string[]
) {
  const path = `requirements[${requirementIndex}].proofAxes`;
  const expectedKeys = expectedProofAxisKeys(requirementText, proofContext);
  const actualKeys = new Set(axes.flatMap((axis) =>
    typeof axis.subject === "string" && typeof axis.polarity === "string" ? [`${axis.subject}:${axis.polarity}`] : []
  ));
  if ([...expectedKeys].some((key) => !actualKeys.has(key))) {
    errors.push(`${path} must include the complete required proof axis set as its deterministic floor.`);
  }
  if (actualKeys.has("implementation:absent") && !expectedKeys.has("implementation:absent")) {
    errors.push(`${path} can require implementation absence only for an exact deterministic no-implementation policy.`);
  }
  if (
    ["implementation:present", "ci_configuration:present", "targeted_test:present"].some((key) => actualKeys.has(key)) &&
    !actualKeys.has("execution:present")
  ) {
    errors.push(`${path} must include the deterministic execution companion.`);
  }

  for (const [axisIndex, axis] of axes.entries()) {
    const axisPath = `${path}[${axisIndex}]`;
    const subject = typeof axis.subject === "string" ? axis.subject : "";
    const polarity = typeof axis.polarity === "string" ? axis.polarity : "";
    const state = typeof axis.state === "string" ? axis.state : "";
    const refs = getStringArray(axis.evidenceRefs);

    if (polarity === "absent") {
      if (state === "satisfied" && !hasAuthoritativeReportChangedFileInventory(report)) {
        errors.push(`${axisPath} cannot satisfy absence without a head-anchored authoritative GitHub inventory.`);
      }
      if (state === "satisfied" && refs.length > 0) {
        errors.push(`${axisPath} satisfied absence must not cite present implementation evidence.`);
      }
      if (state === "violated") {
        if (axis.collectionBasis !== "matching_artifact_evidence" || refs.length === 0 || refs.some((ref) => {
          const evidence = evidenceById.get(ref);
          return !evidence || !isImplementationArtifactEvidence(evidence);
        })) {
          errors.push(`${axisPath} violated absence has incompatible evidence or collection basis.`);
        }
      }
      continue;
    }

    if (state === "violated" && subject === "execution") {
      if (axis.collectionBasis !== "failed_execution" || refs.length === 0 || refs.some((ref) => {
        const evidence = evidenceById.get(ref);
        return !evidence || !isViolatedExecutionAxisEvidenceCompatible(evidence, proofNode, requirementText, ref);
      })) {
        errors.push(`${axisPath} violated execution has incompatible evidence or collection basis.`);
      }
      continue;
    }

    if (state !== "satisfied") continue;
    if (refs.length === 0) {
      errors.push(`${axisPath} satisfied present axis must cite evidence.`);
      continue;
    }
    if (!refs.every((ref) => {
      const evidence = evidenceById.get(ref);
      return evidence ? isSatisfiedAxisEvidenceCompatible(report, subject, axis.collectionBasis, evidence, proofNode, requirementText, ref) : false;
    })) {
      errors.push(`${axisPath} cites incompatible evidence or collection basis.`);
    }
  }
}

function expectedProofAxisKeys(text: string, context: DeterministicProofContext): Set<string> {
  const expectations = requirementProofAxisExpectationsWithContext(text, context);
  const keys: string[] = [];
  if (expectations.implementation) keys.push("implementation:present");
  if (expectations.documentation) keys.push("documentation:present");
  if (expectations.ci) keys.push("ci_configuration:present");
  if (expectations.targetedTest) keys.push("targeted_test:present");
  if (expectations.execution) keys.push("execution:present");
  if (expectations.interaction) keys.push("interaction:present");
  if (expectations.visual) keys.push("visual:present");
  if (expectations.noImplementationChanges) keys.push("implementation:absent");
  return new Set(keys);
}

function deterministicProofContextForFullReport(
  current: RecordValue | undefined,
  proofNodeByRequirement: ReadonlyMap<string, RecordValue>
): DeterministicProofContext {
  const text = typeof current?.requirementText === "string" ? current.requirementText : "";
  const presentation = requirementProofAxisExpectationsWithContext(text, { kind: "review_presentation" });
  if (presentation.visual && !requirementProofAxisExpectations(text).visual) {
    return { kind: "review_presentation" };
  }

  const relation = isRecord(current?.deterministicRelation) ? current.deterministicRelation : null;
  if (
    relation?.version !== 1 ||
    relation.kind !== "workflow_antecedent" ||
    typeof relation.antecedentRequirementId !== "string"
  ) return { kind: "none" };

  const antecedent = proofNodeByRequirement.get(relation.antecedentRequirementId);
  const antecedentText = typeof antecedent?.requirementText === "string" ? antecedent.requirementText : "";
  return requirementProofAxisExpectations(antecedentText).ci
    ? { kind: "workflow_antecedent", requirementId: relation.antecedentRequirementId }
    : { kind: "none" };
}

function isSatisfiedAxisEvidenceCompatible(
  report: RecordValue,
  subject: string,
  collectionBasis: unknown,
  evidence: RecordValue,
  proofNode: RecordValue | undefined,
  requirementText: string,
  ref: string
): boolean {
  const implementationRefs = new Set(getStringArray(proofNode?.implementationEvidenceRefs));
  const targetedTestRefs = new Set(getStringArray(proofNode?.targetedTestEvidenceRefs));
  const executionRefs = new Set(getStringArray(proofNode?.executionEvidenceRefs));
  const path = typeof evidence.locator === "string" ? evidence.locator : typeof evidence.label === "string" ? evidence.label : "";

  if (subject === "implementation") {
    return collectionBasis === "matching_artifact_evidence" && evidence.kind === "diff" && implementationRefs.has(ref);
  }
  if (subject === "documentation") {
    return collectionBasis === "matching_artifact_evidence" && isImplementationProofEvidence(evidence) && isDocumentationEvidencePath(path) && implementationRefs.has(ref);
  }
  if (subject === "ci_configuration") {
    return collectionBasis === "matching_artifact_evidence" && isImplementationProofEvidence(evidence) && isCiEvidencePath(path) && implementationRefs.has(ref);
  }
  if (subject === "targeted_test") {
    return collectionBasis === "matching_artifact_evidence" &&
      evidence.kind === "test" &&
      targetedTestRefs.has(ref) &&
      targetedTestEvidenceMatchesRequirement(report, proofNode, requirementText, evidence);
  }
  if (subject === "execution") {
    if (collectionBasis === "passing_execution") {
      return isPassingTestExecutionEvidence(evidence) &&
        executionRefs.has(ref) &&
        (
          evidenceOverlapsRequirement(requirementText, evidence) ||
          executionEvidenceMatchesTargetedTests(report, proofNode, evidence)
        );
    }
    if (collectionBasis === "passing_suite_execution") {
      return isVerifiedSuiteExecutionEvidenceCompatible(report, evidence, proofNode, ref);
    }
    return false;
  }
  if (subject === "visual") {
    return collectionBasis === "visual_verification" && isVisualVerificationProofEvidence(evidence) && evidenceOverlapsRequirement(requirementText, evidence);
  }
  if (subject === "interaction") {
    return collectionBasis === "interaction_verification" && isVisualVerificationProofEvidence(evidence) && evidenceOverlapsRequirement(requirementText, evidence);
  }
  return false;
}

function targetedTestEvidenceMatchesRequirement(
  report: RecordValue,
  proofNode: RecordValue | undefined,
  requirementText: string,
  evidence: RecordValue
): boolean {
  if (evidenceOverlapsRequirement(requirementText, evidence)) return true;
  if (!Array.isArray(report.evidenceIndex)) return false;

  const implementationRefs = new Set(getStringArray(proofNode?.implementationEvidenceRefs));
  const implementationPaths = report.evidenceIndex
    .filter(isRecord)
    .filter((item) => typeof item.id === "string" && implementationRefs.has(item.id))
    .map((item) => typeof item.locator === "string" ? item.locator : typeof item.label === "string" ? item.label : "")
    .filter(Boolean);
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const summary = typeof evidence.summary === "string" ? evidence.summary : "";
  const locator = typeof evidence.locator === "string" ? evidence.locator : "";
  if (artifactEvidenceMatchesAnyPath([requirementText], label, summary, locator)) return true;
  if (artifactEvidenceMatchesAnyPath(implementationPaths, label, summary, locator)) return true;
  return false;
}

function executionEvidenceMatchesTargetedTests(
  report: RecordValue,
  proofNode: RecordValue | undefined,
  evidence: RecordValue
): boolean {
  const targetedTestRefs = new Set(getStringArray(proofNode?.targetedTestEvidenceRefs));
  if (targetedTestRefs.size === 0 || !Array.isArray(report.evidenceIndex)) return false;
  const testPaths = report.evidenceIndex
    .filter(isRecord)
    .filter((item) => typeof item.id === "string" && targetedTestRefs.has(item.id) && item.kind === "test")
    .map((item) => typeof item.locator === "string" ? item.locator : typeof item.label === "string" ? item.label : "")
    .filter(Boolean);
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const summary = typeof evidence.summary === "string" ? evidence.summary : "";
  const locator = typeof evidence.locator === "string" ? evidence.locator : "";

  return executionEvidenceMatchesAnyTestPath(testPaths, label, summary, locator);
}

function isVerifiedSuiteExecutionEvidenceCompatible(
  report: RecordValue,
  evidence: RecordValue,
  proofNode: RecordValue | undefined,
  ref: string
): boolean {
  if (!isPassingTestExecutionEvidence(evidence)) return false;
  if (!new Set(getStringArray(proofNode?.executionEvidenceRefs)).has(ref)) return false;

  const source = isRecord(report.source) ? report.source : null;
  const provenance = source && isRecord(source.provenance) ? source.provenance : null;
  const headSha = typeof provenance?.headSha === "string" ? provenance.headSha : "";
  if (provenance?.origin !== "github_snapshot" || !/^[a-f0-9]{40,64}$/.test(headSha)) return false;

  const suites = Array.isArray(provenance.executionSuites) ? provenance.executionSuites.filter(isRecord) : [];
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const targetedTestRefs = new Set(getStringArray(proofNode?.targetedTestEvidenceRefs));
  const evidenceIndex = Array.isArray(report.evidenceIndex) ? report.evidenceIndex.filter(isRecord) : [];

  return suites.some((suite) => {
    if (
      suite.headSha !== headSha ||
      suite.status !== "passed" ||
      suite.executionSource !== label ||
      (suite.scope !== "repository_discovery" && suite.scope !== "explicit_paths") ||
      !Array.isArray(suite.testPaths)
    ) {
      return false;
    }

    const coveredPaths = new Set(suite.testPaths.filter((path): path is string => typeof path === "string").map((path) => path.toLowerCase()));
    return evidenceIndex.some((item) =>
      typeof item.id === "string" &&
      targetedTestRefs.has(item.id) &&
      item.kind === "test" &&
      typeof item.locator === "string" &&
      coveredPaths.has(item.locator.toLowerCase())
    );
  });
}

function isViolatedExecutionAxisEvidenceCompatible(
  evidence: RecordValue,
  proofNode: RecordValue | undefined,
  requirementText: string,
  ref: string
): boolean {
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const summary = typeof evidence.summary === "string" ? evidence.summary : "";
  const locator = typeof evidence.locator === "string" ? evidence.locator : "";
  const executionRefs = new Set(getStringArray(proofNode?.executionEvidenceRefs));
  const opaqueMatrixFailure = isFailedAmbiguousActionsExecutionSignal(
    label,
    evidenceStatusFromSummary(summary),
    locator,
    summary
  );
  return (evidence.kind === "check" || evidence.kind === "log") &&
    evidenceStatusFromSummary(summary) === "failed" &&
    isExecutionProofEvidence(evidence) &&
    executionRefs.has(ref) &&
    (evidenceOverlapsRequirement(requirementText, evidence) || opaqueMatrixFailure);
}

function isImplementationArtifactEvidence(evidence: RecordValue): boolean {
  if (!isImplementationProofEvidence(evidence)) return false;
  const path = typeof evidence.locator === "string" ? evidence.locator : typeof evidence.label === "string" ? evidence.label : "";
  return !isDocumentationEvidencePath(path) && !isCiEvidencePath(path) && !/(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|test_|_test\.)/i.test(path);
}

function isDocumentationEvidencePath(path: string): boolean {
  return /(?:^|\/)(?:docs?\/|readme(?:\.|$))|\.md$/i.test(path);
}

function isCiEvidencePath(path: string): boolean {
  return /(?:^|\/)(?:\.github\/workflows\/|workflows?\/)|(?:ci|pipeline)[^/]*\.(?:ya?ml|json)$/i.test(path);
}

function isVisualVerificationProofEvidence(evidence: RecordValue): boolean {
  const kind = evidence.kind;
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const summary = typeof evidence.summary === "string" ? evidence.summary : "";
  const locator = typeof evidence.locator === "string" ? evidence.locator : "";
  if ((kind !== "check" && kind !== "log") || !hasPassingEvidenceStatusPrefix(summary)) return false;
  const combined = `${label} ${summary} ${locator}`;
  const visual = /\b(browser qa|browser|desktop|mobile|overflow|playwright|cypress|screenshot|visual|viewport)\b/i;
  const nonProof = /\b(preview|deploy|deployment|security|scan|sast|policy|provenance|attestation|code owners?|review|report)\b/i;
  const trusted = /\b(browser qa|playwright|cypress)\b/i.test(label) && !nonProof.test(label);
  return visual.test(combined) && (!nonProof.test(combined) || trusted);
}

function evidenceOverlapsRequirement(requirementText: string, evidence: RecordValue): boolean {
  return evidenceOverlapsCanonicalRequirement(
    requirementText,
    String(evidence.label ?? ""),
    String(evidence.summary ?? "")
  );
}

function hasAuthoritativeReportChangedFileInventory(report: RecordValue): boolean {
  const source = isRecord(report.source) ? report.source : null;
  const provenance = source && isRecord(source.provenance) ? source.provenance : null;
  const inventory = provenance && isRecord(provenance.changedFileInventory) ? provenance.changedFileInventory : null;
  const limitations = getStringArray(report.limitations);
  return provenance?.origin === "github_snapshot" &&
    typeof provenance.headSha === "string" && /^[a-f0-9]{40,64}$/.test(provenance.headSha) &&
    inventory?.version === 1 && inventory.completeness === "complete" && inventory.headSha === provenance.headSha &&
    !limitations.some((limitation) => /changed-file evidence (?:unavailable|was capped)|changed-file fetch failed|file evidence may be incomplete|patch text|diff evidence is unavailable/i.test(limitation));
}

function isExecutionClaim(text: string): boolean {
  return /\btested\b/i.test(text) ||
    /\b(verified|validated).{0,80}\b(tests?|spec|unit|integration|e2e|ci|build|coverage)\b/i.test(text) ||
    /\b(tests?|spec|unit|integration|e2e|ci|build|coverage).{0,80}\b(pass|passed|verified|validated|succeeded|green)\b/i.test(text);
}

function isPassingTestExecutionEvidence(item: RecordValue): boolean {
  const kind = item.kind;
  const label = typeof item.label === "string" ? item.label : "";
  const summary = typeof item.summary === "string" ? item.summary : "";
  const locator = typeof item.locator === "string" ? item.locator : "";

  return (kind === "check" || kind === "log") &&
    isExecutionEvidenceSignal(label, summary, locator) &&
    hasPassingEvidenceStatusPrefix(summary);
}

function requiresPriorityEvidence(item: RecordValue): boolean {
  const priority = typeof item.priority === "string" ? item.priority : "";
  const path = typeof item.path === "string" ? item.path : "";

  return priority === "high" || priority === "blocker" || isConcretePath(path);
}

function isConcretePath(value: string): boolean {
  return /(^|\/)[^/\s]+\.[^/\s]+$/.test(value) || value.includes("/");
}

function hasEvidenceUnavailableNote(value: unknown): boolean {
  const text = getStringArray(value).join(" ");

  return /\bevidence\b.{0,80}\b(unavailable|not available|omitted|missing|redacted|not collected|could not be collected)\b/i.test(text);
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function validateArray(value: unknown, path: string, maxItems: number, errors: string[]): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return null;
  }

  if (value.length > maxItems) {
    errors.push(`${path} must contain at most ${maxItems} items.`);
  }

  return value;
}

function validateStringArray(
  value: unknown,
  path: string,
  maxItems: number,
  maxLength: number,
  errors: string[]
): string[] | null {
  const items = validateArray(value, path, maxItems, errors);
  if (!items) return null;

  for (const [index, item] of items.entries()) {
    validateString(item, `${path}[${index}]`, maxLength, errors);
  }

  return items.filter((item): item is string => typeof item === "string");
}

function validateStringEnumArray(
  value: unknown,
  path: string,
  maxItems: number,
  allowed: Set<string>,
  errors: string[]
): string[] | null {
  const items = validateStringArray(value, path, maxItems, LIMITS.shortText, errors);
  if (!items) return null;

  for (const [index, item] of items.entries()) {
    validateEnum(item, `${path}[${index}]`, allowed, errors);
  }

  return items;
}

function validateString(value: unknown, path: string, maxLength: number, errors: string[]) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${path} must be a non-empty string.`);
    return;
  }

  if (value.length > maxLength) {
    errors.push(`${path} must be at most ${maxLength} characters.`);
  }
}

function validateOptionalString(value: unknown, path: string, maxLength: number, errors: string[]) {
  if (value === undefined || value === null) return;
  validateString(value, path, maxLength, errors);
}

function validateBoolean(value: unknown, path: string, errors: string[]) {
  if (typeof value !== "boolean") {
    errors.push(`${path} must be a boolean.`);
  }
}

function validateEnum(value: unknown, path: string, allowed: Set<string>, errors: string[]) {
  if (typeof value !== "string" || !allowed.has(value)) {
    errors.push(`${path} is invalid.`);
  }
}

function validateRange(value: unknown, path: string, min: number, max: number, errors: string[]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path} must be between ${min} and ${max}.`);
  }
}

function requireKeys(
  value: RecordValue,
  requiredKeys: string[],
  path: string,
  errors: string[],
  optionalKeys: string[] = []
) {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);

  for (const key of requiredKeys) {
    if (!(key in value)) {
      errors.push(`${path}.${key} is required.`);
    }
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      errors.push(`${path}.${key} is not allowed.`);
    }
  }
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
