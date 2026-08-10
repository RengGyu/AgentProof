import { containsSecretPattern } from "./redact";
import type { EvidenceKind } from "./types";

export const LLM_SEMANTIC_OUTPUT_LIMITS = {
  requirementRelations: 120,
  requirementAssessments: 20,
  evidenceGaps: 40,
  reviewTargets: 12,
  remediationRequests: 20,
  uncertainties: 20,
  evidenceRefs: 12,
  requirementRefs: 8,
  id: 120,
  requirementSummary: 280,
  explanation: 400,
  instruction: 600
} as const;

const RELATIONS = [
  "direct_support",
  "partial_support",
  "indirect_support",
  "non_supporting",
  "conflicting_signal",
  "indeterminate"
] as const;
const EVIDENCE_SUPPORT = [
  "direct_evidence_present",
  "partial_evidence_present",
  "indirect_evidence_only",
  "no_evidence_found",
  "indeterminate"
] as const;
const GAP_TYPES = [
  "missing_implementation_evidence",
  "missing_test_evidence",
  "missing_check_evidence",
  "missing_runtime_evidence",
  "ambiguous_requirement",
  "traceability_gap",
  "conflicting_evidence",
  "insufficient_context",
  "other"
] as const;
const PRIORITIES = ["high", "medium", "low"] as const;
const UNCERTAINTY_LEVELS = ["low", "medium", "high"] as const;
const TARGET_TYPES = ["file", "check"] as const;
const REQUEST_TYPES = [
  "add_or_update_test",
  "provide_or_link_evidence",
  "clarify_requirement",
  "explain_implementation",
  "investigate_check_result",
  "investigate_requirement_mismatch",
  "reduce_or_split_scope",
  "other"
] as const;
const UNCERTAINTY_TYPES = [
  "insufficient_context",
  "ambiguous_requirement",
  "truncated_input",
  "unavailable_evidence",
  "conflicting_evidence",
  "unsupported_inference",
  "mixed_language_ambiguity",
  "other"
] as const;
const UNCERTAINTY_IMPACTS = ["blocks_assessment", "limits_assessment", "minor"] as const;

type Relation = (typeof RELATIONS)[number];
type EvidenceSupport = (typeof EVIDENCE_SUPPORT)[number];
type GapType = (typeof GAP_TYPES)[number];
type ReviewPriority = (typeof PRIORITIES)[number];
type UncertaintyLevel = (typeof UNCERTAINTY_LEVELS)[number];
type ReviewTargetType = (typeof TARGET_TYPES)[number];
type RemediationRequestType = (typeof REQUEST_TYPES)[number];
type UncertaintyType = (typeof UNCERTAINTY_TYPES)[number];
type UncertaintyImpact = (typeof UNCERTAINTY_IMPACTS)[number];

export interface LlmRequirementEvidenceRelation {
  requirement_id: string;
  evidence_id: string;
  relation: Relation;
  rationale: string;
  uncertainty: UncertaintyLevel;
}

export interface LlmRequirementAssessment {
  requirement_id: string;
  requirement_summary: string;
  evidence_support: EvidenceSupport;
  summary: string;
  evidence_ids: string[];
  uncertainty: UncertaintyLevel;
}

export interface LlmEvidenceGap {
  requirement_id: string;
  gap_type: GapType;
  priority: ReviewPriority;
  description: string;
  review_impact: string;
  needed_evidence: string;
  evidence_ids: string[];
  uncertainty: UncertaintyLevel;
}

export interface LlmReviewTarget {
  target_type: ReviewTargetType;
  target_evidence_id: string;
  priority: ReviewPriority;
  reason: string;
  inspection_goal: string;
  requirement_ids: string[];
  evidence_ids: string[];
  uncertainty: UncertaintyLevel;
}

export interface LlmRemediationRequest {
  requirement_id: string;
  request_type: RemediationRequestType;
  priority: ReviewPriority;
  instruction: string;
  rationale: string;
  expected_evidence: string;
  evidence_ids: string[];
  uncertainty: UncertaintyLevel;
}

export interface LlmUncertainty {
  uncertainty_type: UncertaintyType;
  impact: UncertaintyImpact;
  description: string;
  needed_information: string;
  requirement_ids: string[];
  evidence_ids: string[];
}

export interface LlmSemanticOutput {
  requirement_evidence_relations: LlmRequirementEvidenceRelation[];
  requirement_assessments: LlmRequirementAssessment[];
  evidence_gaps: LlmEvidenceGap[];
  review_targets: LlmReviewTarget[];
  remediation_requests: LlmRemediationRequest[];
  uncertainties: LlmUncertainty[];
}

export interface LlmSemanticReferenceCatalog {
  requirementIds: readonly string[];
  evidence: readonly {
    id: string;
    kind: EvidenceKind;
  }[];
}

export type LlmSemanticDisposition = "accepted" | "partial" | "discarded";

export type LlmSemanticRejectReason =
  | "invalid_unit_shape"
  | "length_limit"
  | "incomplete_text"
  | "unknown_requirement_reference"
  | "unknown_evidence_reference"
  | "reference_type_mismatch"
  | "duplicate_reference"
  | "inconsistent_evidence_support"
  | "prohibited_assurance";

export type LlmSemanticDiscardReason =
  | "root_schema_invalid"
  | "secret_detected"
  | "raw_content_detected"
  | "untrusted_instruction_influence"
  | "empty_usable_analysis";

export interface LlmSemanticRejectedUnit {
  section: keyof LlmSemanticOutput;
  index: number;
  reason_codes: LlmSemanticRejectReason[];
}

export interface LlmSemanticValidationDiagnostics {
  version: 1;
  raw_section_counts: Record<keyof LlmSemanticOutput, number>;
  accepted_section_counts: Record<keyof LlmSemanticOutput, number>;
  rejected_section_counts: Record<keyof LlmSemanticOutput, number>;
  rejected_reason_code_counts: Record<LlmSemanticRejectReason, number>;
  discard_reason_codes: LlmSemanticDiscardReason[];
  input_requirement_count: number;
  assessed_requirement_count: number;
  missing_requirement_count: number;
  retryAttempted: boolean;
}

export interface LlmSemanticValidationResult {
  disposition: LlmSemanticDisposition;
  candidate: LlmSemanticOutput | null;
  rejected_units: LlmSemanticRejectedUnit[];
  discard_reason_codes: LlmSemanticDiscardReason[];
  /** Transient only: do not persist these identifiers with a report. */
  missing_requirement_ids: string[];
  diagnostics: LlmSemanticValidationDiagnostics;
}

const idSchema = {
  type: "string",
  maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.id
} as const;
const evidenceIdArraySchema = {
  type: "array",
  maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.evidenceRefs,
  items: idSchema
} as const;
const requirementIdArraySchema = {
  type: "array",
  maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.requirementRefs,
  items: idSchema
} as const;

export const llmSemanticOutputSchema = {
  name: "agentproof_llm_semantic_output_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "requirement_evidence_relations",
      "requirement_assessments",
      "evidence_gaps",
      "review_targets",
      "remediation_requests",
      "uncertainties"
    ],
    properties: {
      requirement_evidence_relations: {
        type: "array",
        maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.requirementRelations,
        items: { $ref: "#/$defs/requirement_evidence_relation" }
      },
      requirement_assessments: {
        type: "array",
        maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.requirementAssessments,
        items: { $ref: "#/$defs/requirement_assessment" }
      },
      evidence_gaps: {
        type: "array",
        maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.evidenceGaps,
        items: { $ref: "#/$defs/evidence_gap" }
      },
      review_targets: {
        type: "array",
        maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.reviewTargets,
        items: { $ref: "#/$defs/review_target" }
      },
      remediation_requests: {
        type: "array",
        maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.remediationRequests,
        items: { $ref: "#/$defs/remediation_request" }
      },
      uncertainties: {
        type: "array",
        maxItems: LLM_SEMANTIC_OUTPUT_LIMITS.uncertainties,
        items: { $ref: "#/$defs/uncertainty" }
      }
    },
    $defs: {
      requirement_evidence_relation: {
        type: "object",
        additionalProperties: false,
        required: ["requirement_id", "evidence_id", "relation", "rationale", "uncertainty"],
        properties: {
          requirement_id: idSchema,
          evidence_id: idSchema,
          relation: { type: "string", enum: RELATIONS },
          rationale: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          uncertainty: { $ref: "#/$defs/uncertainty_level" }
        }
      },
      requirement_assessment: {
        type: "object",
        additionalProperties: false,
        required: [
          "requirement_id",
          "requirement_summary",
          "evidence_support",
          "summary",
          "evidence_ids",
          "uncertainty"
        ],
        properties: {
          requirement_id: idSchema,
          requirement_summary: {
            type: "string",
            maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.requirementSummary
          },
          evidence_support: { type: "string", enum: EVIDENCE_SUPPORT },
          summary: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          evidence_ids: evidenceIdArraySchema,
          uncertainty: { $ref: "#/$defs/uncertainty_level" }
        }
      },
      evidence_gap: {
        type: "object",
        additionalProperties: false,
        required: [
          "requirement_id",
          "gap_type",
          "priority",
          "description",
          "review_impact",
          "needed_evidence",
          "evidence_ids",
          "uncertainty"
        ],
        properties: {
          requirement_id: idSchema,
          gap_type: { type: "string", enum: GAP_TYPES },
          priority: { $ref: "#/$defs/review_priority" },
          description: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          review_impact: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          needed_evidence: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          evidence_ids: evidenceIdArraySchema,
          uncertainty: { $ref: "#/$defs/uncertainty_level" }
        }
      },
      review_target: {
        type: "object",
        additionalProperties: false,
        required: [
          "target_type",
          "target_evidence_id",
          "priority",
          "reason",
          "inspection_goal",
          "requirement_ids",
          "evidence_ids",
          "uncertainty"
        ],
        properties: {
          target_type: { type: "string", enum: TARGET_TYPES },
          target_evidence_id: idSchema,
          priority: { $ref: "#/$defs/review_priority" },
          reason: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          inspection_goal: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          requirement_ids: requirementIdArraySchema,
          evidence_ids: evidenceIdArraySchema,
          uncertainty: { $ref: "#/$defs/uncertainty_level" }
        }
      },
      remediation_request: {
        type: "object",
        additionalProperties: false,
        required: [
          "requirement_id",
          "request_type",
          "priority",
          "instruction",
          "rationale",
          "expected_evidence",
          "evidence_ids",
          "uncertainty"
        ],
        properties: {
          requirement_id: idSchema,
          request_type: { type: "string", enum: REQUEST_TYPES },
          priority: { $ref: "#/$defs/review_priority" },
          instruction: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.instruction },
          rationale: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          expected_evidence: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          evidence_ids: evidenceIdArraySchema,
          uncertainty: { $ref: "#/$defs/uncertainty_level" }
        }
      },
      uncertainty: {
        type: "object",
        additionalProperties: false,
        required: [
          "uncertainty_type",
          "impact",
          "description",
          "needed_information",
          "requirement_ids",
          "evidence_ids"
        ],
        properties: {
          uncertainty_type: { type: "string", enum: UNCERTAINTY_TYPES },
          impact: { type: "string", enum: UNCERTAINTY_IMPACTS },
          description: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          needed_information: { type: "string", maxLength: LLM_SEMANTIC_OUTPUT_LIMITS.explanation },
          requirement_ids: requirementIdArraySchema,
          evidence_ids: evidenceIdArraySchema
        }
      },
      review_priority: {
        type: "string",
        enum: PRIORITIES
      },
      uncertainty_level: {
        type: "string",
        enum: UNCERTAINTY_LEVELS
      }
    }
  }
} as const;

const ROOT_KEYS = [
  "requirement_evidence_relations",
  "requirement_assessments",
  "evidence_gaps",
  "review_targets",
  "remediation_requests",
  "uncertainties"
] as const;

const RAW_CONTENT_PATTERN = /(?:^|\n)(?:diff --git |@@ -\d|```[a-z0-9_-]*\n)/i;
const UNTRUSTED_INSTRUCTION_PATTERN =
  /\b(?:(?:ignore|disregard) (?:all |the )?(?:previous|prior) instructions|reveal (?:the )?(?:system|developer|hidden) (?:prompt|policy)|change (?:the )?(?:system policy|output locale))\b/i;
const PROHIBITED_ASSURANCE_PATTERN =
  /\b(?:safe to merge|ready to merge|merge[- ]ready|(?:the )?requirement (?:is )?(?:fully )?satisfied|correctness (?:is )?(?:guaranteed|verified)|security (?:is )?(?:guaranteed|verified))\b/i;

export function validateLlmSemanticCandidate(
  value: unknown,
  catalog: LlmSemanticReferenceCatalog
): LlmSemanticValidationResult {
  const inputRequirementIds = unique(catalog.requirementIds);
  const rawSectionCounts = sectionCounts(value);
  if (!isValidRoot(value)) {
    return discarded("root_schema_invalid", inputRequirementIds, rawSectionCounts);
  }

  const allText = collectStrings(value);
  if (allText.some(containsSecretPattern)) {
    return discarded("secret_detected", inputRequirementIds, rawSectionCounts);
  }
  if (allText.some((text) => RAW_CONTENT_PATTERN.test(text))) {
    return discarded("raw_content_detected", inputRequirementIds, rawSectionCounts);
  }
  if (allText.some((text) => UNTRUSTED_INSTRUCTION_PATTERN.test(text))) {
    return discarded("untrusted_instruction_influence", inputRequirementIds, rawSectionCounts);
  }

  const context: ValidationContext = {
    requirementIds: new Set(catalog.requirementIds),
    evidenceById: new Map(catalog.evidence.map((item) => [item.id, item.kind]))
  };
  const rejected: LlmSemanticRejectedUnit[] = [];

  const relations = validateUnits(
    "requirement_evidence_relations",
    value.requirement_evidence_relations,
    context,
    validateRelation,
    rejected
  );
  const uniqueRelations = rejectDuplicateRelations(relations, rejected);
  const relationIndex = buildRelationIndex(uniqueRelations);

  const assessments = validateUnits(
    "requirement_assessments",
    value.requirement_assessments,
    context,
    (item, validationContext) => validateAssessment(item, validationContext, relationIndex),
    rejected
  );
  const uniqueAssessments = rejectDuplicateAssessments(assessments, rejected);

  const gaps = validateUnits(
    "evidence_gaps",
    value.evidence_gaps,
    context,
    validateGap,
    rejected
  );
  const targets = validateUnits(
    "review_targets",
    value.review_targets,
    context,
    validateTarget,
    rejected
  );
  const remediation = validateUnits(
    "remediation_requests",
    value.remediation_requests,
    context,
    validateRemediation,
    rejected
  );
  const uncertainties = validateUnits(
    "uncertainties",
    value.uncertainties,
    context,
    validateUncertainty,
    rejected
  );

  const candidate: LlmSemanticOutput = {
    requirement_evidence_relations: uniqueRelations.map((item) => item.value),
    requirement_assessments: uniqueAssessments.map((item) => item.value),
    evidence_gaps: gaps.map((item) => item.value),
    review_targets: targets.map((item) => item.value),
    remediation_requests: remediation.map((item) => item.value),
    uncertainties: uncertainties.map((item) => item.value)
  };

  if (semanticUnitCount(candidate) === 0 && context.requirementIds.size > 0) {
    return discarded("empty_usable_analysis", inputRequirementIds, rawSectionCounts, rejected);
  }

  const missingRequirementIds = inputRequirementIds.filter(
    (id) => !candidate.requirement_assessments.some((assessment) => assessment.requirement_id === id)
  );
  const sortedRejected = rejected.sort((left, right) =>
    left.section.localeCompare(right.section) || left.index - right.index
  );
  return {
    disposition: rejected.length > 0 ? "partial" : "accepted",
    candidate,
    rejected_units: sortedRejected,
    discard_reason_codes: [],
    missing_requirement_ids: missingRequirementIds,
    diagnostics: diagnostics({
      rawSectionCounts,
      candidate,
      rejected: sortedRejected,
      discardReasonCodes: [],
      inputRequirementIds,
      missingRequirementIds
    })
  };
}

interface ValidationContext {
  requirementIds: Set<string>;
  evidenceById: Map<string, EvidenceKind>;
}

interface IndexedUnit<T> {
  index: number;
  value: T;
}

interface UnitValidation<T> {
  value: T | null;
  reasonCodes: LlmSemanticRejectReason[];
}

type UnitValidator<T> = (
  value: unknown,
  context: ValidationContext
) => UnitValidation<T>;

function validateUnits<T>(
  section: keyof LlmSemanticOutput,
  values: unknown[],
  context: ValidationContext,
  validator: UnitValidator<T>,
  rejected: LlmSemanticRejectedUnit[]
): IndexedUnit<T>[] {
  const accepted: IndexedUnit<T>[] = [];

  values.forEach((item, index) => {
    const result = validator(item, context);
    if (result.value) {
      accepted.push({ index, value: result.value });
    } else {
      rejected.push({
        section,
        index,
        reason_codes: unique(result.reasonCodes)
      });
    }
  });

  return accepted;
}

function validateRelation(
  value: unknown,
  context: ValidationContext
): UnitValidation<LlmRequirementEvidenceRelation> {
  const keys = ["requirement_id", "evidence_id", "relation", "rationale", "uncertainty"];
  const reasons = baseObjectReasons(value, keys);
  if (!isRecord(value)) return invalid(reasons);

  validateId(value.requirement_id, reasons);
  validateId(value.evidence_id, reasons);
  validateEnum(value.relation, RELATIONS, reasons);
  validateText(value.rationale, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateEnum(value.uncertainty, UNCERTAINTY_LEVELS, reasons);
  validateRequirementRef(value.requirement_id, context, reasons);
  validateEvidenceRef(value.evidence_id, context, reasons);
  validateAssuranceText(value.rationale, reasons);

  return reasons.length > 0 ? invalid(reasons) : valid(value as unknown as LlmRequirementEvidenceRelation);
}

function validateAssessment(
  value: unknown,
  context: ValidationContext,
  relationIndex: Map<string, Map<string, Relation>>
): UnitValidation<LlmRequirementAssessment> {
  const keys = [
    "requirement_id",
    "requirement_summary",
    "evidence_support",
    "summary",
    "evidence_ids",
    "uncertainty"
  ];
  const reasons = baseObjectReasons(value, keys);
  if (!isRecord(value)) return invalid(reasons);

  validateId(value.requirement_id, reasons);
  validateText(value.requirement_summary, LLM_SEMANTIC_OUTPUT_LIMITS.requirementSummary, reasons);
  validateEnum(value.evidence_support, EVIDENCE_SUPPORT, reasons);
  validateText(value.summary, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateReferenceArray(value.evidence_ids, "evidence", context, LLM_SEMANTIC_OUTPUT_LIMITS.evidenceRefs, reasons);
  validateEnum(value.uncertainty, UNCERTAINTY_LEVELS, reasons);
  validateRequirementRef(value.requirement_id, context, reasons);
  validateAssuranceText(value.requirement_summary, reasons);
  validateAssuranceText(value.summary, reasons);

  if (
    reasons.length === 0 &&
    !assessmentMatchesRelations(value as unknown as LlmRequirementAssessment, relationIndex)
  ) {
    reasons.push("inconsistent_evidence_support");
  }

  return reasons.length > 0 ? invalid(reasons) : valid(value as unknown as LlmRequirementAssessment);
}

function validateGap(value: unknown, context: ValidationContext): UnitValidation<LlmEvidenceGap> {
  const keys = [
    "requirement_id",
    "gap_type",
    "priority",
    "description",
    "review_impact",
    "needed_evidence",
    "evidence_ids",
    "uncertainty"
  ];
  const reasons = baseObjectReasons(value, keys);
  if (!isRecord(value)) return invalid(reasons);

  validateId(value.requirement_id, reasons);
  validateEnum(value.gap_type, GAP_TYPES, reasons);
  validateEnum(value.priority, PRIORITIES, reasons);
  validateText(value.description, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateText(value.review_impact, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateText(value.needed_evidence, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateReferenceArray(value.evidence_ids, "evidence", context, LLM_SEMANTIC_OUTPUT_LIMITS.evidenceRefs, reasons);
  validateEnum(value.uncertainty, UNCERTAINTY_LEVELS, reasons);
  validateRequirementRef(value.requirement_id, context, reasons);
  validateAssuranceText(value.description, reasons);
  validateAssuranceText(value.review_impact, reasons);
  validateAssuranceText(value.needed_evidence, reasons);

  return reasons.length > 0 ? invalid(reasons) : valid(value as unknown as LlmEvidenceGap);
}

function validateTarget(value: unknown, context: ValidationContext): UnitValidation<LlmReviewTarget> {
  const keys = [
    "target_type",
    "target_evidence_id",
    "priority",
    "reason",
    "inspection_goal",
    "requirement_ids",
    "evidence_ids",
    "uncertainty"
  ];
  const reasons = baseObjectReasons(value, keys);
  if (!isRecord(value)) return invalid(reasons);

  validateEnum(value.target_type, TARGET_TYPES, reasons);
  validateId(value.target_evidence_id, reasons);
  validateEnum(value.priority, PRIORITIES, reasons);
  validateText(value.reason, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateText(value.inspection_goal, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateReferenceArray(value.requirement_ids, "requirement", context, LLM_SEMANTIC_OUTPUT_LIMITS.requirementRefs, reasons);
  validateReferenceArray(value.evidence_ids, "evidence", context, LLM_SEMANTIC_OUTPUT_LIMITS.evidenceRefs, reasons);
  validateEnum(value.uncertainty, UNCERTAINTY_LEVELS, reasons);
  validateEvidenceRef(value.target_evidence_id, context, reasons);
  validateAssuranceText(value.reason, reasons);
  validateAssuranceText(value.inspection_goal, reasons);

  if (
    reasons.length === 0 &&
    !targetMatchesEvidenceKind(
      value.target_type as ReviewTargetType,
      value.target_evidence_id as string,
      context
    )
  ) {
    reasons.push("reference_type_mismatch");
  }
  if (
    reasons.length === 0 &&
    !(value.evidence_ids as string[]).includes(value.target_evidence_id as string)
  ) {
    reasons.push("inconsistent_evidence_support");
  }

  return reasons.length > 0 ? invalid(reasons) : valid(value as unknown as LlmReviewTarget);
}

function validateRemediation(
  value: unknown,
  context: ValidationContext
): UnitValidation<LlmRemediationRequest> {
  const keys = [
    "requirement_id",
    "request_type",
    "priority",
    "instruction",
    "rationale",
    "expected_evidence",
    "evidence_ids",
    "uncertainty"
  ];
  const reasons = baseObjectReasons(value, keys);
  if (!isRecord(value)) return invalid(reasons);

  validateId(value.requirement_id, reasons);
  validateEnum(value.request_type, REQUEST_TYPES, reasons);
  validateEnum(value.priority, PRIORITIES, reasons);
  validateText(value.instruction, LLM_SEMANTIC_OUTPUT_LIMITS.instruction, reasons);
  validateText(value.rationale, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateText(value.expected_evidence, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateReferenceArray(value.evidence_ids, "evidence", context, LLM_SEMANTIC_OUTPUT_LIMITS.evidenceRefs, reasons);
  validateEnum(value.uncertainty, UNCERTAINTY_LEVELS, reasons);
  validateRequirementRef(value.requirement_id, context, reasons);
  validateAssuranceText(value.instruction, reasons);
  validateAssuranceText(value.rationale, reasons);
  validateAssuranceText(value.expected_evidence, reasons);
  if (
    reasons.length === 0 &&
    (value.evidence_ids as string[]).length === 0 &&
    value.request_type !== "provide_or_link_evidence" &&
    value.request_type !== "clarify_requirement"
  ) {
    reasons.push("inconsistent_evidence_support");
  }

  return reasons.length > 0 ? invalid(reasons) : valid(value as unknown as LlmRemediationRequest);
}

function validateUncertainty(
  value: unknown,
  context: ValidationContext
): UnitValidation<LlmUncertainty> {
  const keys = [
    "uncertainty_type",
    "impact",
    "description",
    "needed_information",
    "requirement_ids",
    "evidence_ids"
  ];
  const reasons = baseObjectReasons(value, keys);
  if (!isRecord(value)) return invalid(reasons);

  validateEnum(value.uncertainty_type, UNCERTAINTY_TYPES, reasons);
  validateEnum(value.impact, UNCERTAINTY_IMPACTS, reasons);
  validateText(value.description, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateText(value.needed_information, LLM_SEMANTIC_OUTPUT_LIMITS.explanation, reasons);
  validateReferenceArray(value.requirement_ids, "requirement", context, LLM_SEMANTIC_OUTPUT_LIMITS.requirementRefs, reasons);
  validateReferenceArray(value.evidence_ids, "evidence", context, LLM_SEMANTIC_OUTPUT_LIMITS.evidenceRefs, reasons);
  validateAssuranceText(value.description, reasons);
  validateAssuranceText(value.needed_information, reasons);

  return reasons.length > 0 ? invalid(reasons) : valid(value as unknown as LlmUncertainty);
}

function isValidRoot(value: unknown): value is Record<keyof LlmSemanticOutput, unknown[]> {
  if (!isRecord(value) || !hasExactKeys(value, ROOT_KEYS)) return false;

  return ROOT_KEYS.every((key) => {
    if (!Array.isArray(value[key])) return false;
    return value[key].length <= rootLimit(key);
  });
}

function rootLimit(key: keyof LlmSemanticOutput): number {
  switch (key) {
    case "requirement_evidence_relations":
      return LLM_SEMANTIC_OUTPUT_LIMITS.requirementRelations;
    case "requirement_assessments":
      return LLM_SEMANTIC_OUTPUT_LIMITS.requirementAssessments;
    case "evidence_gaps":
      return LLM_SEMANTIC_OUTPUT_LIMITS.evidenceGaps;
    case "review_targets":
      return LLM_SEMANTIC_OUTPUT_LIMITS.reviewTargets;
    case "remediation_requests":
      return LLM_SEMANTIC_OUTPUT_LIMITS.remediationRequests;
    case "uncertainties":
      return LLM_SEMANTIC_OUTPUT_LIMITS.uncertainties;
  }
}

function baseObjectReasons(
  value: unknown,
  keys: readonly string[]
): LlmSemanticRejectReason[] {
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    return ["invalid_unit_shape"];
  }
  return [];
}

function validateId(value: unknown, reasons: LlmSemanticRejectReason[]) {
  validateText(value, LLM_SEMANTIC_OUTPUT_LIMITS.id, reasons, false);
}

function validateText(
  value: unknown,
  maxLength: number,
  reasons: LlmSemanticRejectReason[],
  requireCompleteSentence = true
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    reasons.push("invalid_unit_shape");
    return;
  }
  if (value.length > maxLength) {
    reasons.push("length_limit");
  } else if (
    requireCompleteSentence
    && value.length >= maxLength - 4
    && !/[.!?。！？]$/u.test(value.trim())
  ) {
    reasons.push("incomplete_text");
  }
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  reasons: LlmSemanticRejectReason[]
) {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    reasons.push("invalid_unit_shape");
  }
}

function validateRequirementRef(
  value: unknown,
  context: ValidationContext,
  reasons: LlmSemanticRejectReason[]
) {
  if (typeof value === "string" && !context.requirementIds.has(value)) {
    reasons.push("unknown_requirement_reference");
  }
}

function validateEvidenceRef(
  value: unknown,
  context: ValidationContext,
  reasons: LlmSemanticRejectReason[]
) {
  if (typeof value === "string" && !context.evidenceById.has(value)) {
    reasons.push("unknown_evidence_reference");
  }
}

function validateReferenceArray(
  value: unknown,
  kind: "requirement" | "evidence",
  context: ValidationContext,
  maxItems: number,
  reasons: LlmSemanticRejectReason[]
) {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string")) {
    reasons.push(value && Array.isArray(value) && value.length > maxItems ? "length_limit" : "invalid_unit_shape");
    return;
  }

  if (new Set(value).size !== value.length) {
    reasons.push("duplicate_reference");
  }

  for (const item of value) {
    validateId(item, reasons);
    if (kind === "requirement") {
      validateRequirementRef(item, context, reasons);
    } else {
      validateEvidenceRef(item, context, reasons);
    }
  }
}

function validateAssuranceText(value: unknown, reasons: LlmSemanticRejectReason[]) {
  if (typeof value === "string" && PROHIBITED_ASSURANCE_PATTERN.test(value)) {
    reasons.push("prohibited_assurance");
  }
}

function targetMatchesEvidenceKind(
  targetType: ReviewTargetType,
  evidenceId: string,
  context: ValidationContext
): boolean {
  const kind = context.evidenceById.get(evidenceId);
  if (!kind) return false;
  return targetType === "check"
    ? kind === "check"
    : kind === "changed_file" || kind === "diff" || kind === "test";
}

function buildRelationIndex(
  relations: IndexedUnit<LlmRequirementEvidenceRelation>[]
): Map<string, Map<string, Relation>> {
  const index = new Map<string, Map<string, Relation>>();
  for (const { value } of relations) {
    const byEvidence = index.get(value.requirement_id) ?? new Map<string, Relation>();
    byEvidence.set(value.evidence_id, value.relation);
    index.set(value.requirement_id, byEvidence);
  }
  return index;
}

function assessmentMatchesRelations(
  assessment: LlmRequirementAssessment,
  relationIndex: Map<string, Map<string, Relation>>
): boolean {
  const relations = assessment.evidence_ids
    .map((id) => relationIndex.get(assessment.requirement_id)?.get(id))
    .filter((relation): relation is Relation => Boolean(relation));

  switch (assessment.evidence_support) {
    case "direct_evidence_present":
      return assessment.evidence_ids.length > 0 && relations.includes("direct_support");
    case "partial_evidence_present":
      return assessment.evidence_ids.length > 0 && relations.includes("partial_support");
    case "indirect_evidence_only":
      return assessment.evidence_ids.length > 0 &&
        relations.length === assessment.evidence_ids.length &&
        relations.every((relation) => relation === "indirect_support");
    case "no_evidence_found":
      return assessment.evidence_ids.length === 0;
    case "indeterminate":
      return true;
  }
}

function rejectDuplicateRelations(
  relations: IndexedUnit<LlmRequirementEvidenceRelation>[],
  rejected: LlmSemanticRejectedUnit[]
): IndexedUnit<LlmRequirementEvidenceRelation>[] {
  const counts = new Map<string, number>();
  for (const item of relations) {
    const key = `${item.value.requirement_id}\u0000${item.value.evidence_id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return relations.filter((item) => {
    const key = `${item.value.requirement_id}\u0000${item.value.evidence_id}`;
    if (counts.get(key) === 1) return true;
    rejected.push({
      section: "requirement_evidence_relations",
      index: item.index,
      reason_codes: ["duplicate_reference"]
    });
    return false;
  });
}

function rejectDuplicateAssessments(
  assessments: IndexedUnit<LlmRequirementAssessment>[],
  rejected: LlmSemanticRejectedUnit[]
): IndexedUnit<LlmRequirementAssessment>[] {
  const counts = new Map<string, number>();
  for (const item of assessments) {
    counts.set(item.value.requirement_id, (counts.get(item.value.requirement_id) ?? 0) + 1);
  }

  return assessments.filter((item) => {
    if (counts.get(item.value.requirement_id) === 1) return true;
    rejected.push({
      section: "requirement_assessments",
      index: item.index,
      reason_codes: ["duplicate_reference"]
    });
    return false;
  });
}

function semanticUnitCount(candidate: LlmSemanticOutput): number {
  return ROOT_KEYS.reduce((count, key) => count + candidate[key].length, 0);
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (isRecord(value)) return Object.values(value).flatMap(collectStrings);
  return [];
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function valid<T>(value: T): UnitValidation<T> {
  return { value, reasonCodes: [] };
}

function invalid<T>(reasonCodes: LlmSemanticRejectReason[]): UnitValidation<T> {
  return {
    value: null,
    reasonCodes: unique(reasonCodes.length > 0 ? reasonCodes : ["invalid_unit_shape"])
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sectionCounts(value: unknown): Record<keyof LlmSemanticOutput, number> {
  const counts = emptySectionCounts();
  if (!isRecord(value)) return counts;

  for (const section of ROOT_KEYS) {
    if (Array.isArray(value[section])) {
      counts[section] = value[section].length;
    }
  }
  return counts;
}

function emptySectionCounts(): Record<keyof LlmSemanticOutput, number> {
  return {
    requirement_evidence_relations: 0,
    requirement_assessments: 0,
    evidence_gaps: 0,
    review_targets: 0,
    remediation_requests: 0,
    uncertainties: 0
  };
}

function diagnostics(input: {
  rawSectionCounts: Record<keyof LlmSemanticOutput, number>;
  candidate: LlmSemanticOutput | null;
  rejected: readonly LlmSemanticRejectedUnit[];
  discardReasonCodes: LlmSemanticDiscardReason[];
  inputRequirementIds: readonly string[];
  missingRequirementIds: readonly string[];
}): LlmSemanticValidationDiagnostics {
  const rejectedSectionCounts = emptySectionCounts();
  const rejectedReasonCodeCounts: Record<LlmSemanticRejectReason, number> = {
    invalid_unit_shape: 0,
    length_limit: 0,
    incomplete_text: 0,
    unknown_requirement_reference: 0,
    unknown_evidence_reference: 0,
    reference_type_mismatch: 0,
    duplicate_reference: 0,
    inconsistent_evidence_support: 0,
    prohibited_assurance: 0
  };

  for (const unit of input.rejected) {
    rejectedSectionCounts[unit.section] += 1;
    for (const reason of unit.reason_codes) rejectedReasonCodeCounts[reason] += 1;
  }

  return {
    version: 1,
    raw_section_counts: input.rawSectionCounts,
    accepted_section_counts: input.candidate
      ? ROOT_KEYS.reduce((counts, section) => {
          counts[section] = input.candidate![section].length;
          return counts;
        }, emptySectionCounts())
      : emptySectionCounts(),
    rejected_section_counts: rejectedSectionCounts,
    rejected_reason_code_counts: rejectedReasonCodeCounts,
    discard_reason_codes: input.discardReasonCodes,
    input_requirement_count: input.inputRequirementIds.length,
    assessed_requirement_count: input.inputRequirementIds.length - input.missingRequirementIds.length,
    missing_requirement_count: input.missingRequirementIds.length,
    retryAttempted: false
  };
}

function discarded(
  reason: LlmSemanticDiscardReason,
  inputRequirementIds: readonly string[],
  rawSectionCounts: Record<keyof LlmSemanticOutput, number>,
  rejected: readonly LlmSemanticRejectedUnit[] = []
): LlmSemanticValidationResult {
  const missingRequirementIds = [...inputRequirementIds];
  return {
    disposition: "discarded",
    candidate: null,
    rejected_units: [],
    discard_reason_codes: [reason],
    missing_requirement_ids: missingRequirementIds,
    diagnostics: diagnostics({
      rawSectionCounts,
      candidate: null,
      rejected,
      discardReasonCodes: [reason],
      inputRequirementIds,
      missingRequirementIds
    })
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
