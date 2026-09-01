import { createHash } from "crypto";
import type {
  CanonicalRequirementSetV1,
  ChangedFile,
  DeterministicRequirementRelation,
  PullRequestInput,
  RequirementSourceBinding,
  ResolvedHeadModulePayload,
  VerificationReport
} from "./types";
import { validateLlmSemanticCandidate } from "./llm-semantic-output";
import {
  hasPassingEvidenceStatusPrefix,
  isExecutionEvidenceSignal,
  isFailedAmbiguousActionsExecutionSignal
} from "./evidence-status";
import {
  artifactEvidenceMatchesAnyPath,
  boundedTestRelationCandidate,
  canonicalCurrentRequirementBinding,
  executionEvidenceMatchesAnyTestPath,
  resolveExactHeadTarget
} from "./evidence-relation";
import { buildEvidenceIndexResult, deriveDeterministicRequirementRelations, isTestFile, selectCanonicalRequirements } from "./extractors";
import { evidenceOverlapsCanonicalRequirement } from "./requirement-relevance";
import {
  canonicalVerificationBindingV2,
  criterionAxisIdV2,
  materializeVerificationContractV2,
  parseVerificationContractV2,
  validateCriterionAxisClosureV2,
  type MaterializedVerificationContractV2,
  type VerificationBindingInputV2,
  type VerificationContractSourceInputV2
} from "./verification-contract-v2";
import {
  requirementProofAxisExpectations,
  requirementProofAxisExpectationsWithContext,
  type DeterministicProofContext
} from "./verifier-proof-expectations";
import { aggregateVerificationCriteriaV2 } from "./verification-contract-v2";
import { canonicalRequirementSourceBindingV2, validatePrivateProofReceiptBundleV2 } from "./evidence-receipts";
import {
  PROOF_AXIS_COLLECTION_BASES,
  PROOF_AXIS_SUBJECTS,
  isProofAxisCollectionBasis,
  isProofAxisCollectionBasisAllowed,
  isProofAxisSubject,
} from "./proof-contract";
import { exactHeadArtifactEvidenceItemsV2, type VerificationCriterionEvidenceV2 } from "./verification-criterion-evaluator-v2";
import { readEnabledVerificationCapabilitiesV2, type VerificationCapabilityV2 } from "./verification-capability-policy-v2";

const PRIORITIES = new Set(["low", "medium", "high", "blocker"]);
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const REQUIREMENT_AUTHORITIES = new Set(["pr_description"]);
const PROOF_AXIS_POLARITIES = new Set(["present", "absent"]);
const PROOF_AXIS_STATES = new Set(["satisfied", "violated", "incomplete"]);
const PROOF_AXIS_SUBJECT_SET = new Set<string>(PROOF_AXIS_SUBJECTS);
const PROOF_COLLECTION_BASES = new Set<string>(PROOF_AXIS_COLLECTION_BASES);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);
const EVIDENCE_KINDS = new Set(["task", "pr_description", "diff", "changed_file", "check", "log", "test", "artifact", "inference"]);
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
const FAILED_CHECK_ASSOCIATION_STATES = new Set(["linked", "not_linked", "unknown"]);
const FAILED_CHECK_ASSOCIATION_BASES = new Set([
  "complete_identity_match",
  "deterministic_non_match",
  "identity_incomplete"
]);
const EXACT_HEAD_EXPORT_KINDS = new Set(["named", "default", "commonjs"]);
const TEST_RELATION_SUBJECT_SOURCES = new Set(["current_requirement"]);
const TEST_RELATION_BASES = new Set(["direct_static_import"]);
const GENERAL_PR_ASSESSMENT_MODES = new Set(["ordinary_pr", "typed_contract_companion"]);
const GENERAL_PR_ASSESSMENT_SOURCE_STATES = new Set(["linked_issue", "pr_author_claim", "mixed", "missing", "ambiguous"]);
const GENERAL_PR_ASSESSMENT_CONCLUSIONS = new Set([
  "evidence_supports_stated_change",
  "evidence_partial",
  "mixed_evidence",
  "attention_required",
  "collection_blocked",
  "no_assessable_claims"
]);
const GENERAL_PR_TARGET_CONCLUSIONS = new Set([
  "evidence_supported",
  "evidence_partial",
  "not_demonstrated",
  "contradicted",
  "blocked",
  "not_assessable"
]);
const GENERAL_PR_ASSESSMENT_CLAIM_ROLES = new Set([
  "acceptance_criterion",
  "behavioral_objective",
  "implementation_claim",
  "test_claim",
  "scope_exclusion",
  "known_limitation",
  "risk_claim",
  "follow_up",
  "context"
]);
const GENERAL_PR_ASSESSMENT_REASONS = new Set([
  "implementation_evidence_observed",
  "test_artifact_observed",
  "exact_execution_passed",
  "exact_execution_failed",
  "verified_relation_missing",
  "execution_not_observed",
  "claimed_artifact_not_observed",
  "unsupported_claim_type",
  "source_missing",
  "source_ambiguous",
  "source_unavailable",
  "collection_incomplete",
  "head_mismatch",
  "evidence_identity_incomplete",
  "semantic_relation_only",
  "author_claim_requires_confirmation",
  "deterministic_candidate_missing",
  "semantic_observer_disabled",
  "semantic_observer_ineligible",
  "semantic_observer_unavailable",
  "semantic_observer_timeout",
  "semantic_proposal_invalid",
  "semantic_candidate_missing",
  "semantic_candidate_rejected",
  "target_relation_unresolved"
]);
const GENERAL_PR_RELATION_LEVELS = new Set(["verified", "observed", "hypothesis", "unresolved", "unavailable"]);
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
  sourceBindings: 80,
  exactHeadTargetReceipts: 200,
  testRelationReceipts: 200,
  failedCheckAssociations: 50,
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
  receiptValidationContext?: VerificationValidationContextV2;
}

export interface VerificationValidationContextV2 {
  canonicalRequirementSet: CanonicalRequirementSetV1;
  canonicalRequirementDigest: string;
  selectedRequirementSource?: Pick<PullRequestInput, "taskText" | "description" | "taskSource" | "requirementSourceIdentityHash">;
  typedRequirementSource?: {
    contractSource: VerificationContractSourceInputV2;
    binding: VerificationBindingInputV2;
  };
  typedCriterionPlan?: {
    materialized: MaterializedVerificationContractV2;
    evidence: VerificationCriterionEvidenceV2;
    capabilities: ReadonlySet<VerificationCapabilityV2>;
  };
  changedFileInventory: {
    completeness: "complete" | "incomplete";
    headSha: string;
    files: readonly ChangedFile[];
  };
  resolvedHeadModules: readonly ResolvedHeadModulePayload[];
  testBindings: readonly TransientTestEvidenceBindingV2[];
  executionBindings: readonly TransientExecutionEvidenceBindingV2[];
}

export interface TransientTestEvidenceBindingV2 {
  version: 2;
  kind: "transient_test_evidence_binding";
  evidenceRef: string;
  headSha: string;
  path: string;
  pathDigest: string;
  patchDigest: string;
  identityDigest: string;
}

export interface TransientExecutionEvidenceBindingV2 {
  version: 2;
  kind: "transient_execution_evidence_binding";
  evidenceRef: string;
  headSha: string;
  identityDigest: string;
  suiteAssociations: readonly {
    suiteDigest: string;
    testEvidenceRefs: readonly string[];
  }[];
}

/** Builds the raw, private context consumed by independent receipt validation. */
export function createVerificationValidationContextV2(
  input: PullRequestInput,
  canonicalRequirementSet: CanonicalRequirementSetV1,
  capabilities: ReadonlySet<VerificationCapabilityV2> = readEnabledVerificationCapabilitiesV2()
): VerificationValidationContextV2 {
  const provenance = input.sourceProvenance;
  const inventory = provenance?.changedFileInventory;
  const headSha = provenance?.origin === "github_snapshot" && inventory?.headSha === provenance.headSha
    ? provenance.headSha ?? ""
    : "";
  const transientEvidence = transientReceiptEvidenceBindings(input, headSha);
  const typedCriterionPlan = createTypedCriterionPlanV2(input, capabilities);
  return {
    canonicalRequirementSet,
    canonicalRequirementDigest: canonicalRequirementDigestV2(canonicalRequirementSet),
    ...(canonicalRequirementSet.inputKind === "selected_source" ? {
      selectedRequirementSource: {
        taskText: input.taskText,
        description: input.description,
        taskSource: input.taskSource,
        requirementSourceIdentityHash: input.requirementSourceIdentityHash
      }
    } : {}),
    ...(canonicalRequirementSet.inputKind === "typed_contract" && input.verificationContractSourceV2 && input.verificationContractBindingV2 ? {
      typedRequirementSource: {
        contractSource: input.verificationContractSourceV2,
        binding: input.verificationContractBindingV2
      }
    } : {}),
    ...(typedCriterionPlan ? { typedCriterionPlan } : {}),
    changedFileInventory: {
      completeness: provenance?.origin === "github_snapshot" && inventory?.completeness === "complete" && Boolean(headSha)
        ? "complete"
        : "incomplete",
      headSha,
      files: input.changedFiles
    },
    resolvedHeadModules: input.resolvedHeadModules ?? [],
    testBindings: transientEvidence.testBindings,
    executionBindings: transientEvidence.executionBindings
  };
}

function createTypedCriterionPlanV2(
  input: PullRequestInput,
  capabilities: ReadonlySet<VerificationCapabilityV2>
): VerificationValidationContextV2["typedCriterionPlan"] | undefined {
  if (!input.verificationContractSourceV2 || !input.verificationContractBindingV2) return undefined;
  const parsed = parseVerificationContractV2(input.verificationContractSourceV2);
  if (parsed.state !== "authoritative" && parsed.state !== "author_claim") return undefined;
  const materialized = materializeVerificationContractV2(
    parsed,
    canonicalVerificationBindingV2(input.verificationContractBindingV2, parsed.contract)
  );
  const baseEvidence = buildEvidenceIndexResult(
    input.taskText,
    input.description,
    input.changedFiles,
    input.checks,
    input.logs,
    input.taskSource
  ).items;
  const declaredPaths = materialized.objectives.flatMap((objective) => objective.criteria.flatMap((criterion) =>
    criterion.source.type === "artifact" && criterion.source.artifact.kind === "documentation_literal"
      ? criterion.source.paths
      : []
  ));
  const evidence = [...baseEvidence, ...exactHeadArtifactEvidenceItemsV2({
    existingEvidenceIds: baseEvidence.map((item) => item.id),
    artifactBlobs: input.verificationCriterionEvidenceV2?.artifactBlobs ?? [],
    headSha: input.sourceProvenance?.headSha ?? "",
    declaredPaths
  })];
  const evidenceRefsByPath: Record<string, string[]> = {};
  const artifactEvidenceRefsByPath: Record<string, string[]> = {};
  for (const item of evidence) {
    const path = item.locator;
    if (!path) continue;
    evidenceRefsByPath[path] = [...(evidenceRefsByPath[path] ?? []), item.id];
    if (item.kind === "artifact") artifactEvidenceRefsByPath[path] = [...(artifactEvidenceRefsByPath[path] ?? []), item.id];
  }
  const provenance = input.sourceProvenance;
  const inventory = provenance?.changedFileInventory;
  const completeInventory = provenance?.origin === "github_snapshot" && inventory?.completeness === "complete" &&
    inventory.headSha === provenance.headSha && Boolean(provenance.headSha) &&
    !input.changedFiles.some((file) => file.status === "renamed" && !file.previousPath);
  return {
    materialized,
    evidence: {
      headSha: provenance?.headSha ?? "",
      artifactBlobs: input.verificationCriterionEvidenceV2?.artifactBlobs ?? [],
      changedFileInventory: {
        completeness: completeInventory ? "complete" : "incomplete",
        paths: input.changedFiles.map((file) => file.path),
        previousPaths: input.changedFiles.flatMap((file) => file.previousPath ? [file.previousPath] : [])
      },
      evidenceRefsByPath,
      artifactEvidenceRefsByPath
    },
    capabilities
  };
}

function transientReceiptEvidenceBindings(
  input: PullRequestInput,
  headSha: string
): Pick<VerificationValidationContextV2, "testBindings" | "executionBindings"> {
  const evidence = buildEvidenceIndexResult(
    input.taskText,
    input.description,
    input.changedFiles,
    input.checks,
    input.logs,
    input.taskSource
  ).items;
  const testBindings = evidence.flatMap((item): TransientTestEvidenceBindingV2[] => {
    if (item.kind !== "test") return [];
    const path = item.locator ?? item.label;
    const file = input.changedFiles.find((candidate) => candidate.path.toLowerCase() === path.toLowerCase() && isTestFile(candidate.path));
    if (!file) return [];
    const pathDigest = receiptDigest(["v2", headSha, file.path]);
    const patchDigest = receiptDigest(["v2", file.path, file.patch ?? ""]);
    return [{
      version: 2,
      kind: "transient_test_evidence_binding",
      evidenceRef: item.id,
      headSha,
      path: file.path,
      pathDigest,
      patchDigest,
      identityDigest: receiptDigest(["v2", item.id, headSha, pathDigest, patchDigest])
    }];
  });
  const testBindingsByPath = new Map(testBindings.map((binding) => [binding.path.toLowerCase(), binding]));
  const executionBindings = evidence.flatMap((item): TransientExecutionEvidenceBindingV2[] => {
    if ((item.kind !== "check" && item.kind !== "log") ||
      !hasPassingEvidenceStatusPrefix(item.summary) ||
      !isExecutionEvidenceSignal(item.label, item.summary, item.locator)) return [];
    const suiteAssociations = (input.executionSuites ?? []).flatMap((suite) => {
      if (suite.status !== "passed" || suite.headSha !== headSha || suite.scope !== "repository_discovery" ||
        suite.executionSource !== item.label) return [];
      const testEvidenceRefs = [...new Set(suite.testPaths.flatMap((path) => {
        const binding = testBindingsByPath.get(path.toLowerCase());
        return binding ? [binding.evidenceRef] : [];
      }))].sort();
      if (testEvidenceRefs.length === 0) return [];
      return [{
        suiteDigest: createHash("sha256").update(stableReceiptContextJson({
          domain: "agentproof.transient-suite-binding.v2",
          suite
        }), "utf8").digest("hex"),
        testEvidenceRefs
      }];
    });
    if (suiteAssociations.length === 0) return [];
    const normalizedAssociations = [...suiteAssociations].sort((left, right) => left.suiteDigest.localeCompare(right.suiteDigest));
    return [{
      version: 2,
      kind: "transient_execution_evidence_binding",
      evidenceRef: item.id,
      headSha,
      identityDigest: transientExecutionIdentityDigest(item.id, headSha, normalizedAssociations),
      suiteAssociations: normalizedAssociations
    }];
  });
  return { testBindings, executionBindings };
}

function transientExecutionIdentityDigest(
  evidenceRef: string,
  headSha: string,
  suiteAssociations: TransientExecutionEvidenceBindingV2["suiteAssociations"]
): string {
  return createHash("sha256").update(stableReceiptContextJson({
    domain: "agentproof.transient-execution-binding.v2",
    evidenceRef,
    headSha,
    suiteAssociations
  }), "utf8").digest("hex");
}

export function canonicalRequirementDigestV2(canonical: CanonicalRequirementSetV1): string {
  return createHash("sha256")
    .update(stableReceiptContextJson({ domain: "agentproof.receipt-validation-context.v2", canonical }), "utf8")
    .digest("hex");
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
    ["analysisContext", "authenticity", "semantic", "semanticAnalysis", "planner", ...(isV2 ? ["reportSchemaVersion", "verificationContract", "generalPrAssessment", "generalPrAssessmentSummary"] : [])]
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
  validateProofGraph(report.proofGraph, report.source, evidenceIds, evidenceById, requirementIds, mode, errors);
  validateReprompt(report.reprompt, errors);
  validateStringArray(report.limitations, "limitations", LIMITS.limitationCount, LIMITS.shortText, errors);
  validateSemanticAnalysis(report.semantic, requirementIds, report.evidenceIndex, errors);
  validateSemanticRuntimeState(report.semanticAnalysis, report.semantic, errors);
  validatePlannerProvenance(report.planner, mode, report.authenticity, errors);
  validatePlanningFieldConsistency(report, errors);
  validateGeneralPrAssessment(report.generalPrAssessment, evidenceIds, requirementIds, report.requirements, report.source, mode, "full", errors);
  validateGeneralPrAssessment(report.generalPrAssessmentSummary, evidenceIds, requirementIds, report.requirements, report.source, mode, "summary", errors);
  validateAuthenticity(report.authenticity, errors);
  if (mode === "full" || mode === "v2_full") {
    validateFailedCheckProofIsolation(report, errors);
  }
  if (mode === "summary" || mode === "v2_summary") {
    validateSummaryOnlyReport(report, errors);
  }
  if (mode === "tenant" || mode === "v2_tenant") {
    validatePrivateProofReceiptOmission(report, "tenant reports", errors);
  }
  const isPrivateFullMode = mode === "full" || mode === "v2_full";
  if (isPrivateFullMode) {
    validateFullReportProvenance(report, evidenceIds, errors);
    validateObservationProofSemantics(report, evidenceIds, errors, mode === "v2_full");
  }
  if (mode === "v2_full") {
    validatePrivateV2CriterionPlanSemantics(report, options.receiptValidationContext, errors);
    validatePrivateV2ReceiptSemantics(report, options.receiptValidationContext, errors);
  }
  if (mode === "full") {
    validateLegacyOutcomeSemantics(report, evidenceIds, errors);
  }
  if (isV2) {
    validateVerificationContractV2(report, evidenceIds, mode, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Ordinary-PR assessment is intentionally a closed companion contract. In
 * this release it may describe partial, blocked, unavailable, or absent
 * evidence, but it cannot promote a behavioral claim to verified support or
 * contradiction without a separately released deterministic evaluator.
 */
function validateGeneralPrAssessment(
  value: unknown,
  evidenceIds: Set<string>,
  requirementIds: Set<string>,
  requirements: unknown,
  source: unknown,
  mode: NonNullable<ReportValidationOptions["mode"]>,
  projection: "full" | "summary",
  errors: string[]
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push("generalPrAssessment must be an object.");
    return;
  }
  const summaryMode = projection === "summary";
  if (!summaryMode && (mode === "v2_summary" || mode === "v2_tenant")) {
    errors.push("summary and tenant reports must omit generalPrAssessment target records.");
    return;
  }
  requireKeys(
    value,
    ["version", "mode", "sourceState", "overallConclusion", "counts", "reasonCodes"],
    "generalPrAssessment",
    errors,
    summaryMode ? [] : ["targets"]
  );
  if (!summaryMode && !("targets" in value)) errors.push("generalPrAssessment.targets is required for full reports.");
  if (value.version !== 1) errors.push("generalPrAssessment.version is invalid.");
  validateEnum(value.mode, "generalPrAssessment.mode", GENERAL_PR_ASSESSMENT_MODES, errors);
  validateEnum(value.sourceState, "generalPrAssessment.sourceState", GENERAL_PR_ASSESSMENT_SOURCE_STATES, errors);
  validateEnum(value.overallConclusion, "generalPrAssessment.overallConclusion", GENERAL_PR_ASSESSMENT_CONCLUSIONS, errors);
  const counts = validateGeneralPrAssessmentCounts(value.counts, errors);
  const reportReasons = validateClosedReasonCodes(value.reasonCodes, "generalPrAssessment.reasonCodes", errors);
  if (summaryMode) {
    validateGeneralPrAssessmentSummaryCeiling(value, counts, reportReasons, errors);
    return;
  }

  const targets = validateArray(value.targets, "generalPrAssessment.targets", LIMITS.requirementCount, errors);
  if (!targets || !counts) return;
  const requirementEvidenceRefs = new Map(
    (Array.isArray(requirements) ? requirements : [])
      .filter(isRecord)
      .map((requirement) => [requirement.requirementId, new Set(getStringArray(requirement.evidenceRefs))])
  );
  const targetConclusions: string[] = [];
  const targetAuthorities: string[] = [];
  const targetReasons: string[] = [];
  targets.forEach((target, index) => {
    if (!isRecord(target)) {
      errors.push(`generalPrAssessment.targets[${index}] must be an object.`);
      return;
    }
    const path = `generalPrAssessment.targets[${index}]`;
    requireKeys(target, [
      "version",
      "targetId",
      "sourceBindingRef",
      "sourceAuthority",
      "sourceSpanRefs",
      "admissionBasis",
      "claimRole",
      "conclusion",
      "reasonCodes",
      "evidenceRefs",
      "relationLevels",
      "headBound"
    ], path, errors, ["requirementId"]);
    if (target.version !== 1) errors.push(`${path}.version is invalid.`);
    if (typeof target.targetId !== "string" || !/^gpa_[a-f0-9]{24}$/.test(target.targetId)) errors.push(`${path}.targetId is invalid.`);
    if (typeof target.sourceBindingRef !== "string" || !/^gpsrc_[a-f0-9]{24}$/.test(target.sourceBindingRef)) errors.push(`${path}.sourceBindingRef is invalid.`);
    if (target.sourceAuthority !== "linked_issue" && target.sourceAuthority !== "pr_author_claim") errors.push(`${path}.sourceAuthority is invalid.`);
    const sourceSpanRefs = validateStringArray(target.sourceSpanRefs, `${path}.sourceSpanRefs`, 12, 80, errors);
    if (!sourceSpanRefs || sourceSpanRefs.length === 0 || sourceSpanRefs.some((ref) => !/^gpsp_[1-9]\d*_[1-9]\d*$/.test(ref)) || new Set(sourceSpanRefs).size !== sourceSpanRefs.length) {
      errors.push(`${path}.sourceSpanRefs must contain unique bounded source spans.`);
    }
    if (target.requirementId !== undefined && (typeof target.requirementId !== "string" || !requirementIds.has(target.requirementId))) {
      errors.push(`${path}.requirementId must reference a report requirement.`);
    }
    if (target.admissionBasis !== "explicit_structure" && target.admissionBasis !== "semantic_span_proposal") errors.push(`${path}.admissionBasis is invalid.`);
    validateEnum(target.claimRole, `${path}.claimRole`, GENERAL_PR_ASSESSMENT_CLAIM_ROLES, errors);
    validateEnum(target.conclusion, `${path}.conclusion`, GENERAL_PR_TARGET_CONCLUSIONS, errors);
    const reasons = validateClosedReasonCodes(target.reasonCodes, `${path}.reasonCodes`, errors);
    const evidenceRefs = getStringArray(target.evidenceRefs);
    validateEvidenceRefs(target.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    const relationLevels = validateStringEnumArray(target.relationLevels, `${path}.relationLevels`, 5, GENERAL_PR_RELATION_LEVELS, errors);
    if (!relationLevels || relationLevels.length === 0 || new Set(relationLevels).size !== relationLevels.length) errors.push(`${path}.relationLevels must be nonempty and unique.`);
    validateBoolean(target.headBound, `${path}.headBound`, errors);
    if (target.headBound === true && !hasCompleteExactHeadProvenance(source)) {
      errors.push(`${path}.headBound requires complete exact-head GitHub provenance.`);
    }
    if (target.requirementId !== undefined && typeof target.requirementId === "string") {
      const allowed = requirementEvidenceRefs.get(target.requirementId);
      if (allowed && evidenceRefs.some((ref) => !allowed.has(ref))) errors.push(`${path}.evidenceRefs must belong to its report requirement.`);
    }
    validateGeneralPrTargetCeiling(target, path, reasons, evidenceRefs, relationLevels ?? [], errors);
    if (typeof target.conclusion === "string") targetConclusions.push(target.conclusion);
    if (typeof target.sourceAuthority === "string") targetAuthorities.push(target.sourceAuthority);
    targetReasons.push(...reasons);
  });
  const actualCounts = countGeneralPrTargetConclusions(targetConclusions);
  for (const [key, count] of Object.entries(actualCounts)) {
    if (counts[key as keyof typeof counts] !== count) errors.push(`generalPrAssessment.counts.${key} does not match targets.`);
  }
  const expectedConclusion = aggregateGeneralPrConclusion(targetConclusions);
  if (value.overallConclusion !== expectedConclusion) errors.push("generalPrAssessment.overallConclusion does not match targets.");
  validateGeneralPrSourceState(value.sourceState, targetAuthorities, errors);
  if (reportReasons && reportReasons.some((reason) => !targetReasons.includes(reason) && ![
    "source_missing",
    "source_ambiguous",
    "unsupported_claim_type",
    "deterministic_candidate_missing",
    "semantic_observer_disabled",
    "semantic_observer_ineligible",
    "semantic_observer_unavailable",
    "semantic_observer_timeout",
    "semantic_proposal_invalid",
    "semantic_candidate_missing",
    "semantic_candidate_rejected",
    "target_relation_unresolved"
  ].includes(reason))) {
    errors.push("generalPrAssessment.reasonCodes must be derived from targets or an empty-target source state.");
  }
}

function validateGeneralPrAssessmentCounts(value: unknown, errors: string[]): Record<string, number> | null {
  if (!isRecord(value)) {
    errors.push("generalPrAssessment.counts must be an object.");
    return null;
  }
  const keys = ["evidence_supported", "evidence_partial", "not_demonstrated", "contradicted", "blocked", "not_assessable"];
  requireKeys(value, keys, "generalPrAssessment.counts", errors);
  for (const key of keys) {
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0 || (value[key] as number) > LIMITS.requirementCount) {
      errors.push(`generalPrAssessment.counts.${key} must be a non-negative bounded integer.`);
    }
  }
  return value as Record<string, number>;
}

/** A target-free summary cannot establish a new positive or negative proof. */
function validateGeneralPrAssessmentSummaryCeiling(
  value: RecordValue,
  counts: Record<string, number> | null,
  reasons: string[],
  errors: string[]
): void {
  if (!counts) return;
  if (counts.evidence_supported > 0 || counts.contradicted > 0 ||
    value.overallConclusion === "evidence_supports_stated_change" ||
    value.overallConclusion === "attention_required") {
    errors.push("generalPrAssessmentSummary cannot claim support or contradiction without a private target-local receipt.");
  }
  if (value.sourceState === "pr_author_claim" && !reasons.includes("author_claim_requires_confirmation")) {
    errors.push("generalPrAssessmentSummary PR-author claims require reviewer confirmation.");
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (value.overallConclusion === "collection_blocked" && (counts.blocked === 0 || total !== counts.blocked)) {
    errors.push("generalPrAssessmentSummary collection_blocked must contain only blocked targets.");
  }
  if (value.overallConclusion === "no_assessable_claims" && total !== 0) {
    errors.push("generalPrAssessmentSummary no_assessable_claims must not contain targets.");
  }
}

function validateClosedReasonCodes(value: unknown, path: string, errors: string[]): string[] {
  const reasons = validateStringEnumArray(value, path, 16, GENERAL_PR_ASSESSMENT_REASONS, errors) ?? [];
  if (new Set(reasons).size !== reasons.length) errors.push(`${path} must not contain duplicates.`);
  return reasons;
}

function validateGeneralPrTargetCeiling(
  target: RecordValue,
  path: string,
  reasons: string[],
  evidenceRefs: string[],
  relationLevels: string[],
  errors: string[]
): void {
  const conclusion = target.conclusion;
  if (conclusion === "evidence_supported" || conclusion === "contradicted") {
    errors.push(`${path}.${conclusion} is unavailable until a released deterministic evaluator supplies a target-local receipt.`);
  }
  if (conclusion === "evidence_partial") {
    if (target.headBound !== true) errors.push(`${path}.evidence_partial requires exact-head binding.`);
    if (!reasons.includes("verified_relation_missing") && !reasons.includes("semantic_relation_only") && !reasons.includes("execution_not_observed")) {
      errors.push(`${path}.evidence_partial requires an unresolved-relation or execution reason.`);
    }
    if (!relationLevels.some((level) => level === "observed" || level === "hypothesis" || level === "unresolved")) {
      errors.push(`${path}.evidence_partial requires a non-verified relation level.`);
    }
  }
  if (conclusion === "blocked" && (target.headBound !== false || !reasons.some((reason) => ["collection_incomplete", "head_mismatch", "evidence_identity_incomplete", "source_unavailable"].includes(reason)))) {
    errors.push(`${path}.blocked requires an incomplete-collection reason and no exact-head binding.`);
  }
  if (conclusion === "not_demonstrated" && (target.headBound !== true || !reasons.includes("claimed_artifact_not_observed"))) {
    errors.push(`${path}.not_demonstrated requires complete exact-head absence evidence.`);
  }
  if (conclusion === "not_assessable" && !reasons.includes("unsupported_claim_type")) {
    errors.push(`${path}.not_assessable requires unsupported_claim_type.`);
  }
  if (target.sourceAuthority === "pr_author_claim" && !reasons.includes("author_claim_requires_confirmation")) {
    errors.push(`${path}.pr_author_claim requires author confirmation.`);
  }
  if (conclusion !== "evidence_supported" && evidenceRefs.length > 0 && relationLevels.every((level) => level === "unavailable")) {
    errors.push(`${path} cannot cite evidence while every relation is unavailable.`);
  }
}

function hasCompleteExactHeadProvenance(source: unknown): boolean {
  if (!isRecord(source) || !isRecord(source.provenance)) return false;
  const provenance = source.provenance;
  return provenance.origin === "github_snapshot" && typeof provenance.headSha === "string" &&
    isRecord(provenance.changedFileInventory) && provenance.changedFileInventory.completeness === "complete" &&
    provenance.changedFileInventory.headSha === provenance.headSha;
}

function countGeneralPrTargetConclusions(conclusions: string[]): Record<string, number> {
  return conclusions.reduce<Record<string, number>>((counts, conclusion) => {
    if (GENERAL_PR_TARGET_CONCLUSIONS.has(conclusion)) counts[conclusion] += 1;
    return counts;
  }, {
    evidence_supported: 0,
    evidence_partial: 0,
    not_demonstrated: 0,
    contradicted: 0,
    blocked: 0,
    not_assessable: 0
  });
}

function aggregateGeneralPrConclusion(conclusions: string[]): string {
  if (conclusions.includes("contradicted")) return "attention_required";
  if (conclusions.length > 0 && conclusions.every((conclusion) => conclusion === "blocked")) return "collection_blocked";
  if (conclusions.length > 0 && conclusions.every((conclusion) => conclusion === "evidence_supported")) return "evidence_supports_stated_change";
  if (conclusions.length > 0 && conclusions.every((conclusion) => conclusion === "evidence_partial")) return "evidence_partial";
  return conclusions.length > 0 ? "mixed_evidence" : "no_assessable_claims";
}

function validateGeneralPrSourceState(value: unknown, authorities: string[], errors: string[]): void {
  const uniqueAuthorities = new Set(authorities);
  if (authorities.length === 0) {
    if (value !== "missing" && value !== "ambiguous") errors.push("generalPrAssessment.sourceState without targets must be missing or ambiguous.");
    return;
  }
  const expected = uniqueAuthorities.size > 1 ? "mixed" : uniqueAuthorities.has("linked_issue") ? "linked_issue" : "pr_author_claim";
  if (value !== expected) errors.push("generalPrAssessment.sourceState does not match target authority.");
}

/** Recomputes the active typed plan from transient input without using verifier output. */
function validatePrivateV2CriterionPlanSemantics(
  report: RecordValue,
  context: VerificationValidationContextV2 | undefined,
  errors: string[]
): void {
  const plan = context?.typedCriterionPlan;
  if (!plan) {
    if (hasSatisfiedStaticCriterion(report)) {
      errors.push("v2 satisfied static criterion requires a transient criterion plan.");
    }
    return;
  }
  const contract = isRecord(report.verificationContract) ? report.verificationContract : undefined;
  if (!contract || (contract.state !== "authoritative" && contract.state !== "author_claim")) {
    errors.push("v2 typed contract report does not match the transient criterion plan.");
    return;
  }
  const objectives = Array.isArray(contract.objectives) ? contract.objectives : [];
  if (objectives.length !== plan.materialized.objectives.length) {
    errors.push("v2 typed contract report does not match the transient criterion plan.");
    return;
  }
  for (const [objectiveIndex, materializedObjective] of plan.materialized.objectives.entries()) {
    const objective = objectives[objectiveIndex];
    if (!isRecord(objective) || objective.requirementId !== materializedObjective.requirementId || objective.state !== materializedObjective.state ||
      !Array.isArray(objective.criteria) || !Array.isArray(objective.criterionResults) ||
      objective.criteria.length !== materializedObjective.criteria.length || objective.criterionResults.length !== materializedObjective.criteria.length) {
      errors.push("v2 typed contract report does not match the transient criterion plan.");
      continue;
    }
    for (const [criterionIndex, materializedCriterion] of materializedObjective.criteria.entries()) {
      const criterion = objective.criteria[criterionIndex];
      const result = objective.criterionResults[criterionIndex];
      if (!isRecord(criterion) || !isRecord(result) || !sameMaterializedCriterionPlan(materializedCriterion, criterion)) {
        errors.push("v2 typed contract report does not match the transient criterion plan.");
        continue;
      }
      const expected = independentlyEvaluateTypedCriterion(materializedCriterion, plan.evidence, plan.capabilities);
      if (result.state !== expected.state || !sameStringArray(getStringArray(result.evidenceRefs), expected.evidenceRefs) ||
        !sameStringArray(getStringArray(result.gapKinds), expected.gapKinds)) {
        errors.push(`v2 criterion ${materializedCriterion.criterionId} does not match independent transient evaluation.`);
      }
    }
  }
}

function hasSatisfiedStaticCriterion(report: RecordValue): boolean {
  const contract = isRecord(report.verificationContract) ? report.verificationContract : undefined;
  if (!contract || !Array.isArray(contract.objectives)) return false;
  return contract.objectives.some((objective) => {
    if (!isRecord(objective) || !Array.isArray(objective.criteria) || !Array.isArray(objective.criterionResults)) return false;
    const criteria = objective.criteria as unknown[];
    const results = objective.criterionResults as unknown[];
    return criteria.some((criterion, index) => isRecord(criterion) && isRecord(results[index]) &&
      results[index]!.state === "satisfied" &&
      (criterion.type === "absence" || (criterion.type === "artifact" && criterion.artifactKind === "documentation_literal")));
  });
}

function sameMaterializedCriterionPlan(
  materialized: MaterializedVerificationContractV2["objectives"][number]["criteria"][number],
  reportCriterion: RecordValue
): boolean {
  const source = materialized.source;
  return reportCriterion.criterionId === materialized.criterionId && reportCriterion.required === true &&
    reportCriterion.approval === materialized.approval && reportCriterion.label === materialized.label &&
    reportCriterion.type === source.type && sameStringArray(getStringArray(reportCriterion.requiredEvidence), materialized.requiredEvidence) &&
    (source.type !== "artifact" || reportCriterion.artifactKind === source.artifact.kind) &&
    (source.type !== "absence" || reportCriterion.absenceKind === source.prohibitedKind);
}

function independentlyEvaluateTypedCriterion(
  criterion: MaterializedVerificationContractV2["objectives"][number]["criteria"][number],
  evidence: VerificationCriterionEvidenceV2,
  capabilities: ReadonlySet<VerificationCapabilityV2>
): { state: "satisfied" | "violated" | "incomplete" | "unavailable"; evidenceRefs: string[]; gapKinds: string[] } {
  const source = criterion.source;
  if (source.type === "artifact" && source.artifact.kind === "documentation_literal") {
    const artifact = source.artifact;
    const blobs = new Map(evidence.artifactBlobs
      .filter((blob) => blob.headSha === evidence.headSha && Buffer.byteLength(blob.content, "utf8") <= 64 * 1024)
      .map((blob) => [blob.path, blob.content]));
    const evidenceRefs = uniqueStrings(source.paths
      .filter((path) => blobs.has(path))
      .flatMap((path) => evidence.artifactEvidenceRefsByPath?.[path] ?? []));
    if (!capabilities.has("documentation_literal") || source.paths.some((path) => !blobs.has(path)) || evidenceRefs.length === 0) {
      return { state: "unavailable", evidenceRefs, gapKinds: ["evidence_unavailable"] };
    }
    return source.paths.every((path) => normalizeNewlines(blobs.get(path)!).includes(normalizeNewlines(artifact.literal)))
      ? { state: "satisfied", evidenceRefs, gapKinds: [] }
      : { state: "violated", evidenceRefs, gapKinds: ["missing_implementation"] };
  }
  if (source.type === "absence") {
    if (!capabilities.has("path_change_absence") || evidence.changedFileInventory.completeness !== "complete") {
      return { state: "unavailable", evidenceRefs: [], gapKinds: ["evidence_unavailable"] };
    }
    const paths = uniqueStrings([
      ...evidence.changedFileInventory.paths,
      ...(evidence.changedFileInventory.previousPaths ?? [])
    ]);
    const prohibited = paths.filter((path) => source.scope.some((scope) => scope.kind === "exact" ? path === scope.path : path.startsWith(scope.path)));
    const evidenceRefs = uniqueStrings(prohibited.flatMap((path) => evidence.evidenceRefsByPath[path] ?? []));
    return prohibited.length === 0
      ? { state: "satisfied", evidenceRefs: [], gapKinds: [] }
      : { state: "violated", evidenceRefs, gapKinds: ["forbidden_implementation_present"] };
  }
  return { state: "unavailable", evidenceRefs: [], gapKinds: ["evidence_unavailable"] };
}

function validateVerificationContractV2(
  report: RecordValue,
  evidenceIds: Set<string>,
  mode: NonNullable<ReportValidationOptions["mode"]>,
  errors: string[]
): void {
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
      } else if (!sameStringArray(criterion.requiredEvidence, expectedRequiredEvidenceForReportCriterion(criterion))) {
        errors.push(`${criterionPath}.requiredEvidence must match the closed criterion type.`);
      }
      if (result.state !== "satisfied" && result.state !== "violated" && result.state !== "incomplete" && result.state !== "unavailable") {
        errors.push(`${path}.criterionResults[${criterionIndex}].state is invalid.`);
      } else {
        states.push(result.state);
      }
      if (result.state === "satisfied") {
        // Portable summaries deliberately remove all evidence references. They
        // remain explicitly unverified and cannot pass the full/private mode.
        if (mode === "v2_summary") {
          if (criterion.type === "return_value" ||
            (criterion.type === "artifact" && criterion.artifactKind !== "documentation_literal")) {
            errors.push(`${path}.criterionResults[${criterionIndex}] summary cannot claim a deferred criterion is satisfied.`);
          }
          if (!Array.isArray(result.evidenceRefs) || result.evidenceRefs.length !== 0) {
            errors.push(`${path}.criterionResults[${criterionIndex}] summary evidence references must be omitted.`);
          }
          if (!Array.isArray(result.gapKinds) || result.gapKinds.length !== 0) {
            errors.push(`${path}.criterionResults[${criterionIndex}] satisfied state cannot include gaps.`);
          }
          continue;
        }
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
    if (requirement?.status !== expectedStatus) {
      errors.push(`${path} outcome status must be derived only from its criterion results.`);
    }
    if (node?.status !== requirement?.evidenceStatus) {
      errors.push(`${path} proof-node status must remain the requirement observation status.`);
    }
  }

  if ((state === "authoritative" || state === "author_claim") &&
    (objectiveIds.size !== requirements.length || objectiveIds.size !== nodes.length)) {
    errors.push("v2 objectives must cover every requirement and proof-graph node exactly once.");
  }
  validateV2CriterionAxisOwnership(contract, requirements, errors);
  if ((state === "absent" || state === "invalid") && requirements.some((requirement) => requirement.status !== "unclear")) {
    errors.push("absent or invalid verification contracts must produce only unclear requirement outcomes.");
  }
}

function expectedRequiredEvidenceForReportCriterion(criterion: RecordValue): string[] {
  if (criterion.type === "return_value") return ["implementation", "targeted_test", "execution"];
  if (criterion.type === "absence") return ["implementation"];
  if (criterion.artifactKind === "documentation_literal") return ["documentation"];
  if (criterion.artifactKind === "workflow_job") return ["ci_configuration", "execution"];
  if (criterion.artifactKind === "test_case") return ["targeted_test", "execution"];
  return [];
}

function sameStringArray(value: unknown[], expected: readonly string[]): boolean {
  return value.length === expected.length && value.every((item, index) => item === expected[index]);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function validateV2CriterionAxisOwnership(
  contract: RecordValue,
  requirements: readonly RecordValue[],
  errors: string[]
): void {
  const state = contract.state;
  const objectives = Array.isArray(contract.objectives) ? contract.objectives.filter(isRecord) : [];
  const axes = requirements.flatMap((requirement) => Array.isArray(requirement.proofAxes)
    ? requirement.proofAxes.filter(isRecord)
    : []);
  const hasActiveContract = state === "authoritative" || state === "author_claim";

  for (const [index, axis] of axes.entries()) {
    const path = `v2 proof axis ${index}`;
    if (typeof axis.axisId !== "string" || (axis.role !== "criterion" && axis.role !== "observation")) {
      errors.push(`${path} requires v2 axisId and role.`);
      continue;
    }
    if (axis.role === "criterion" && typeof axis.criterionId !== "string") errors.push(`${path} criterion ownership is missing.`);
    if (axis.role === "observation" && axis.criterionId !== undefined) errors.push(`${path} observation ownership is invalid.`);
  }
  if (!hasActiveContract) {
    if (axes.some((axis) => axis.role === "criterion")) errors.push("absent or invalid contracts cannot contain criterion-owned proof axes.");
    return;
  }

  const references: Array<{ criterionId: string; requirementId: string; requiredEvidence: Array<"implementation" | "documentation" | "ci_configuration" | "targeted_test" | "execution" | "visual" | "interaction">; proofAxisRefs: string[] }> = [];
  const resultByCriterionId = new Map<string, RecordValue>();
  for (const objective of objectives) {
    const requirementId = typeof objective.requirementId === "string" ? objective.requirementId : "";
    const criteria = Array.isArray(objective.criteria) ? objective.criteria : [];
    const results = Array.isArray(objective.criterionResults) ? objective.criterionResults : [];
    for (let index = 0; index < criteria.length; index += 1) {
      const criterion = criteria[index];
      const result = results[index];
      if (!isRecord(criterion) || !isRecord(result) || typeof criterion.criterionId !== "string" || !Array.isArray(criterion.requiredEvidence) || !Array.isArray(result.proofAxisRefs)) continue;
      const requiredEvidence = criterion.requiredEvidence.filter(isProofAxisSubject);
      if (requiredEvidence.length !== criterion.requiredEvidence.length) {
        errors.push(`verificationContract objective ${requirementId} has an invalid requiredEvidence subject.`);
        continue;
      }
      references.push({
        criterionId: criterion.criterionId,
        requirementId,
        requiredEvidence,
        proofAxisRefs: result.proofAxisRefs.filter((value): value is string => typeof value === "string")
      });
      resultByCriterionId.set(criterion.criterionId, result);
    }
  }
  const closure = validateCriterionAxisClosureV2({
    criteria: references,
    axes: axes.flatMap((axis) => {
      if (typeof axis.axisId !== "string" || (axis.role !== "criterion" && axis.role !== "observation") ||
        !isProofAxisSubject(axis.subject) || (axis.polarity !== "present" && axis.polarity !== "absent")) return [];
      return [{
        axisId: axis.axisId,
        role: axis.role,
        ...(typeof axis.criterionId === "string" ? { criterionId: axis.criterionId } : {}),
        subject: axis.subject,
        polarity: axis.polarity
      }];
    })
  });
  if (!closure.ok) errors.push("verificationContract criterion proof-axis ownership is invalid.");
  for (const reference of references) {
    const result = resultByCriterionId.get(reference.criterionId);
    const expectedState = result?.state === "satisfied" ? "satisfied" : result?.state === "violated" ? "violated" : "incomplete";
    const owned = axes.filter((axis) => reference.proofAxisRefs.includes(axis.axisId as string));
    if (owned.length !== reference.proofAxisRefs.length || owned.some((axis) => axis.state !== expectedState)) {
      errors.push(`verificationContract criterion ${reference.criterionId} result does not agree with its owned proof axes.`);
    }
    for (const subject of reference.requiredEvidence) {
      const expected = criterionAxisIdV2(reference.requirementId, reference.criterionId, subject, "present");
      if (!reference.proofAxisRefs.includes(expected)) errors.push(`verificationContract criterion ${reference.criterionId} is missing canonical axis ${expected}.`);
    }
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
  const seenAxisIds = new Set<string>();

  for (const [index, item] of axes.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${itemPath} must be an object.`);
      continue;
    }
    requireKeys(item, ["subject", "polarity", "state", "evidenceRefs"], itemPath, errors, ["axisId", "role", "criterionId", "collectionBasis"]);
    validateEnum(item.subject, `${itemPath}.subject`, PROOF_AXIS_SUBJECT_SET, errors);
    validateEnum(item.polarity, `${itemPath}.polarity`, PROOF_AXIS_POLARITIES, errors);
    validateEnum(item.state, `${itemPath}.state`, PROOF_AXIS_STATES, errors);
    validateEvidenceRefs(item.evidenceRefs, `${itemPath}.evidenceRefs`, evidenceIds, errors);
    if ("collectionBasis" in item) {
      validateEnum(item.collectionBasis, `${itemPath}.collectionBasis`, PROOF_COLLECTION_BASES, errors);
    }
    if (item.axisId !== undefined) {
      validateString(item.axisId, `${itemPath}.axisId`, LIMITS.shortText, errors);
      if (typeof item.axisId === "string") {
        if (seenAxisIds.has(item.axisId)) errors.push(`${itemPath}.axisId duplicates a proof axis ID.`);
        seenAxisIds.add(item.axisId);
      }
    }
    if (item.role !== undefined && item.role !== "criterion" && item.role !== "observation") {
      errors.push(`${itemPath}.role is invalid.`);
    }
    if (item.role === "criterion" && typeof item.criterionId !== "string") {
      errors.push(`${itemPath}.criterion role requires criterionId.`);
    }
    if (item.role === "observation" && item.criterionId !== undefined) {
      errors.push(`${itemPath}.observation role cannot include criterionId.`);
    }
    if (isProofAxisSubject(item.subject) && isProofAxisCollectionBasis(item.collectionBasis) && !isProofAxisCollectionBasisAllowed(item.subject, item.collectionBasis)) {
      errors.push(`${itemPath}.collectionBasis is incompatible with its proof axis subject.`);
    }
    if (typeof item.subject === "string" && typeof item.polarity === "string") {
      if (item.role !== "criterion") {
        const key = `${item.subject}:${item.polarity}`;
        if (seen.has(key)) errors.push(`${itemPath} duplicates proof axis ${key}.`);
        seen.add(key);
        if (seenSubjects.has(item.subject)) errors.push(`${itemPath} duplicates proof axis subject ${item.subject}.`);
        seenSubjects.add(item.subject);
      }
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
  source: unknown,
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

  requireKeys(
    value,
    ["version", "nodes", "context", "summary"],
    "proofGraph",
    errors,
    ["sourceBindings", "exactHeadTargetReceipts", "testRelationReceipts", "privateReceiptBundleV2", "executionBindingReceipts", "failedCheckAssociations"]
  );
  if (value.version !== 1) {
    errors.push("proofGraph.version must be 1.");
  }

  const sourceBindingsById = validateRequirementSourceBindings(value.sourceBindings, requirementIds, errors);
  const provenance = isRecord(source) && isRecord(source.provenance) ? source.provenance : undefined;
  const targetReceiptsById = validateExactHeadTargetReceipts(
    value.exactHeadTargetReceipts,
    provenance?.headSha,
    errors
  );
  const referencedSourceBindingIds = new Set<string>();
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
        ["classificationBasis", "deterministicRelation", "caseCoverageReceipt"]
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
      validateCaseCoverageReceipt(item.caseCoverageReceipt, `${path}.caseCoverageReceipt`, item, evidenceById, errors);
      validateDeterministicRelation(
        item.deterministicRelation,
        `${path}.deterministicRelation`,
        item.requirementId,
        requirementIds,
        sourceBindingsById,
        referencedSourceBindingIds,
        errors
      );
    }
    for (const requirementId of requirementIds) {
      if (!seenRequirementIds.has(requirementId)) {
        errors.push(`proofGraph.nodes must include requirement ${requirementId}.`);
      }
    }
  }

  for (const bindingId of sourceBindingsById.keys()) {
    if (!referencedSourceBindingIds.has(bindingId)) {
      errors.push("proofGraph.sourceBindings contains an unreferenced source binding.");
    }
  }

  validateProofGraphContext(value.context, errors);
  validateTestRelationReceipts(
    value.testRelationReceipts,
    targetReceiptsById,
    evidenceById,
    requirementIds,
    nodes,
    errors
  );
  validateFailedCheckAssociations(
    value.failedCheckAssociations,
    evidenceById,
    requirementIds,
    nodes,
    errors
  );
  validatePrivateProofReceiptAdmission(value, mode, errors);
  validateProofGraphSummary(value.summary, errors);
  validateProofGraphSummaryMatchesNodes(value.summary, nodes, mode === "summary", errors);
}

function validatePrivateProofReceiptAdmission(
  proofGraph: RecordValue,
  mode: ReportValidationOptions["mode"],
  errors: string[]
): void {
  const hasBundle = Object.hasOwn(proofGraph, "privateReceiptBundleV2");
  const hasExecutionBindings = Object.hasOwn(proofGraph, "executionBindingReceipts");
  if (!hasBundle && !hasExecutionBindings) return;

  if (mode !== "full" && mode !== "v2_full") {
    errors.push("private v2 receipt fields are permitted only in full report validation.");
    return;
  }
  if (!hasBundle) {
    errors.push("proofGraph.executionBindingReceipts requires proofGraph.privateReceiptBundleV2.");
    return;
  }

  for (const error of validatePrivateProofReceiptBundleV2(proofGraph.privateReceiptBundleV2)) {
    errors.push(`proofGraph.privateReceiptBundleV2 ${error}`);
  }
  if (hasExecutionBindings && (!isRecord(proofGraph.privateReceiptBundleV2) ||
    !sameJsonValue(proofGraph.executionBindingReceipts, proofGraph.privateReceiptBundleV2.executionBindingReceipts))) {
    errors.push("proofGraph.executionBindingReceipts must exactly mirror the private v2 receipt bundle.");
  }
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function validatePrivateV2ReceiptSemantics(
  report: RecordValue,
  context: VerificationValidationContextV2 | undefined,
  errors: string[]
): void {
  const bundle = isRecord(report.proofGraph) && isRecord(report.proofGraph.privateReceiptBundleV2)
    ? report.proofGraph.privateReceiptBundleV2
    : undefined;
  const relations = Array.isArray(bundle?.testRelationReceipts)
    ? bundle.testRelationReceipts.filter((item): item is RecordValue => isRecord(item) && item.version === 2)
    : [];
  if (relations.length === 0) return;
  if (!context) {
    errors.push("v2 private receipt validation requires transient validation context.");
    return;
  }
  const sourceHeadSha = isRecord(report.source) && isRecord(report.source.provenance) && typeof report.source.provenance.headSha === "string"
    ? report.source.provenance.headSha
    : "";
  const suppliedCanonical = context.canonicalRequirementSet;
  const canonical = recomputeCanonicalRequirementsV2(suppliedCanonical.inputKind, context);
  if (!canonical) {
    errors.push("private v2 receipt does not match transient validation context.");
    return;
  }
  const inventory = context.changedFileInventory;
  const changedFiles = Array.isArray(inventory?.files) ? inventory.files : [];
  const changedPaths = new Set(changedFiles.map((file) => file.path.toLowerCase()));
  const reportEvidenceById = new Map(Array.isArray(report.evidenceIndex)
    ? report.evidenceIndex.filter(isRecord).flatMap((item) => typeof item.id === "string" ? [[item.id, item] as const] : [])
    : []);
  const sourceBindings = Array.isArray(bundle?.sourceBindings) ? bundle.sourceBindings.filter(isRecord) : [];
  const targets = Array.isArray(bundle?.exactHeadTargetReceipts) ? bundle.exactHeadTargetReceipts.filter(isRecord) : [];
  const executions = Array.isArray(bundle?.executionBindingReceipts) ? bundle.executionBindingReceipts.filter(isRecord) : [];
  const sourceById = new Map(sourceBindings.map((binding) => [binding.id, binding]));
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const executionById = new Map(executions.map((execution) => [execution.id, execution]));
  const transientTestByRef = new Map(context.testBindings.map((binding) => [binding.evidenceRef, binding]));
  const transientExecutionByRef = new Map(context.executionBindings.map((binding) => [binding.evidenceRef, binding]));
  let canonicalBindings: RequirementSourceBinding[];
  let derivedRelations: ReturnType<typeof deriveDeterministicRequirementRelations>["deterministicRelationsByRequirement"];
  try {
    canonicalBindings = canonical.requirements.map((unit) => canonicalRequirementSourceBindingV2(unit, canonical.sourceContentHash));
    derivedRelations = deriveDeterministicRequirementRelations(canonical).deterministicRelationsByRequirement;
  } catch {
    errors.push("private v2 receipt does not match transient validation context.");
    return;
  }
  const canonicalBindingById = new Map(canonicalBindings.map((binding) => [binding.id, binding]));
  const canonicalTextById = new Map(canonical.requirements.map((unit) => [unit.reportRequirementId, unit.text]));

  let invalid = context.canonicalRequirementDigest !== canonicalRequirementDigestV2(canonical) ||
    !sameJsonValue(suppliedCanonical, canonical) ||
    (suppliedCanonical.inputKind === "selected_source" && !context.selectedRequirementSource) ||
    (suppliedCanonical.inputKind === "typed_contract" && !context.typedRequirementSource) ||
    inventory?.completeness !== "complete" || inventory?.headSha !== sourceHeadSha ||
    changedFiles.length === 0 || changedPaths.size !== changedFiles.length ||
    transientTestByRef.size !== context.testBindings.length ||
    transientExecutionByRef.size !== context.executionBindings.length ||
    !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(sourceHeadSha);
  for (const actual of sourceBindings) {
    const expected = typeof actual.id === "string" ? canonicalBindingById.get(actual.id) : undefined;
    if (!expected || !sameJsonValue(actual, expected)) invalid = true;
  }
  for (const relation of relations) {
    const requirementId = typeof relation.requirementId === "string" ? relation.requirementId : "";
    const testEvidenceRef = typeof relation.testEvidenceRef === "string" ? relation.testEvidenceRef : "";
    const currentUnit = canonical.requirements.find((unit) => unit.reportRequirementId === requirementId);
    const deterministicRelation = derivedRelations.get(requirementId);
    const subject = canonicalReceiptSubject(canonical, requirementId, relation.subjectSource, deterministicRelation);
    const candidateRelation = relation.subjectSource === "current_requirement" ? undefined : deterministicRelation;
    const testBinding = transientTestByRef.get(testEvidenceRef);
    const testFile = testBinding
      ? changedFiles.find((file) => file.path.toLowerCase() === testBinding.path.toLowerCase() && isTestFile(file.path))
      : undefined;
    const testBindingClosed = Boolean(testBinding && testFile &&
      testBinding.version === 2 && testBinding.kind === "transient_test_evidence_binding" &&
      testBinding.headSha === sourceHeadSha &&
      testBinding.pathDigest === receiptDigest(["v2", sourceHeadSha, testFile.path]) &&
      testBinding.patchDigest === receiptDigest(["v2", testFile.path, testFile.patch ?? ""]) &&
      testBinding.identityDigest === receiptDigest([
        "v2", testBinding.evidenceRef, sourceHeadSha, testBinding.pathDigest, testBinding.patchDigest
      ]));
    const currentBinding = canonicalCurrentRequirementBinding(canonical, requirementId) ?? undefined;
    const candidate = currentUnit && subject && testBindingClosed && testFile?.patch
      ? boundedTestRelationCandidate({
        testFile,
        subject,
        requirementId,
        currentRequirementText: currentUnit.text,
        requirementTexts: canonicalTextById,
        currentSourceBinding: undefined,
        targetMode: relation.targetMode as "changed_target" | "exact_head_target",
        relation: candidateRelation,
        sourceBindings: canonicalBindings
      })
      : null;
    if (!candidate || relation.subjectSource !== candidate.subjectSource || relation.assertionShape !== "direct_argument" ||
      relation.directAssertionCount !== candidate.directAssertionCount || relation.subjectDigest !== candidate.subjectDigest ||
      relation.importBindingDigest !== candidate.importBindingDigest || !currentBinding || !sourceById.has(currentBinding.id)) {
      invalid = true;
      continue;
    }
    for (const bindingId of receiptRelationSourceBindingIds(candidateRelation, currentBinding.id)) {
      if (!sourceById.has(bindingId)) invalid = true;
    }

    let targetRef = "";
    if (relation.targetMode === "changed_target") {
      const implementationEvidence = typeof relation.implementationEvidenceRef === "string"
        ? reportEvidenceById.get(relation.implementationEvidenceRef)
        : undefined;
      const implementationPath = typeof implementationEvidence?.locator === "string"
        ? implementationEvidence.locator
        : typeof implementationEvidence?.label === "string" ? implementationEvidence.label : "";
      if (!changedPaths.has(candidate.target.targetPath.toLowerCase()) ||
        implementationPath.toLowerCase() !== candidate.target.targetPath.toLowerCase() ||
        (implementationEvidence?.kind !== "diff" && implementationEvidence?.kind !== "changed_file") ||
        relation.exactHeadTargetReceiptRef !== undefined) invalid = true;
      targetRef = typeof relation.implementationEvidenceRef === "string" ? relation.implementationEvidenceRef : "";
    } else {
      const matchingModules = context.resolvedHeadModules.filter((module) =>
        module.headSha === sourceHeadSha && module.path.toLowerCase() === candidate.target.targetPath.toLowerCase());
      const resolved = matchingModules.length === 1 && testFile?.patch
        ? resolveExactHeadTarget({
          testPath: testFile.path,
          testPatch: testFile.patch,
          importSpecifier: candidate.target.importSpecifier,
          headSha: sourceHeadSha,
          target: matchingModules[0]!,
          subject
        })
        : null;
      const target = typeof relation.exactHeadTargetReceiptRef === "string" ? targetById.get(relation.exactHeadTargetReceiptRef) : undefined;
      if (!resolved || changedPaths.has(candidate.target.targetPath.toLowerCase()) || relation.implementationEvidenceRef !== undefined ||
        relation.exactHeadTargetReceiptRef !== resolved.receipt.id || !target || !sameJsonValue(target, resolved.receipt)) invalid = true;
      targetRef = resolved?.receipt.id ?? "";
    }

    const execution = typeof relation.executionReceiptRef === "string" ? executionById.get(relation.executionReceiptRef) : undefined;
    if (!execution || execution.requirementId !== requirementId || execution.testEvidenceRef !== testEvidenceRef ||
      typeof execution.executionEvidenceRef !== "string") {
      invalid = true;
      continue;
    }
    const transientExecution = transientExecutionByRef.get(execution.executionEvidenceRef);
    const executionClosed = execution.scope === "exact_test" &&
      transientExecution?.version === 2 && transientExecution.kind === "transient_execution_evidence_binding" &&
      transientExecution.headSha === sourceHeadSha &&
      transientExecution.identityDigest === transientExecutionIdentityDigest(
        transientExecution.evidenceRef,
        transientExecution.headSha,
        transientExecution.suiteAssociations
      ) &&
      transientExecution.suiteAssociations.some((association) =>
        /^[a-f0-9]{64}$/.test(association.suiteDigest) && association.testEvidenceRefs.includes(testEvidenceRef));
    const expectedHeadDigest = receiptDigest(["v2", sourceHeadSha, testEvidenceRef, execution.executionEvidenceRef]);
    const expectedRelationId = `test_relation_v2_${receiptDigest([
      requirementId,
      relation.targetMode as string,
      targetRef,
      testEvidenceRef,
      candidate.subjectDigest,
      candidate.importBindingDigest,
      typeof relation.executionReceiptRef === "string" ? relation.executionReceiptRef : ""
    ]).slice(0, 24)}`;
    const expectedExecutionId = `execution_binding_${receiptDigest([
      requirementId,
      testEvidenceRef,
      execution.executionEvidenceRef,
      expectedHeadDigest
    ]).slice(0, 24)}`;
    if (!executionClosed || execution.headBindingDigest !== expectedHeadDigest ||
      execution.id !== expectedExecutionId || relation.id !== expectedRelationId) invalid = true;
  }
  if (invalid) errors.push("private v2 receipt does not match transient validation context.");
}

function recomputeCanonicalRequirementsV2(
  inputKind: CanonicalRequirementSetV1["inputKind"],
  context: VerificationValidationContextV2
): CanonicalRequirementSetV1 | undefined {
  try {
    if (inputKind === "selected_source") {
      return context.selectedRequirementSource
        ? selectCanonicalRequirements({ kind: "selected_source", input: context.selectedRequirementSource })
        : undefined;
    }
    const raw = context.typedRequirementSource;
    if (!raw) return undefined;
    const parsed = parseVerificationContractV2(raw.contractSource);
    if (parsed.state !== "authoritative" && parsed.state !== "author_claim") return undefined;
    const bindingDigest = canonicalVerificationBindingV2(raw.binding, parsed.contract);
    const materialized = materializeVerificationContractV2(parsed, bindingDigest);
    return selectCanonicalRequirements({ kind: "typed_contract", materialized, binding: raw.binding });
  } catch {
    return undefined;
  }
}

function canonicalReceiptSubject(
  canonical: CanonicalRequirementSetV1,
  requirementId: string,
  subjectSource: unknown,
  relation: DeterministicRequirementRelation | undefined
): string | undefined {
  const current = canonical.requirements.find((unit) => unit.reportRequirementId === requirementId);
  if (!current) return undefined;
  if (subjectSource === "current_requirement") return uniqueCanonicalCodeSubject(current.text);
  if (subjectSource === "test_antecedent" && relation?.kind === "test_antecedent") {
    return uniqueCanonicalCodeSubject(canonical.requirements.find((unit) => unit.reportRequirementId === relation.antecedentRequirementId)?.text ?? "");
  }
  if (subjectSource === "test_subject_chain" && relation?.kind === "test_subject_chain") {
    return uniqueCanonicalCodeSubject(canonical.requirements.find((unit) => unit.reportRequirementId === relation.subjectRequirementId)?.text ?? "");
  }
  return undefined;
}

function uniqueCanonicalCodeSubject(text: string): string | undefined {
  const identifiers = new Set<string>();
  for (const match of text.matchAll(/`([A-Za-z_$][\w$]*)`|\b([A-Za-z_$][\w$]*)\s*\(/g)) identifiers.add(match[1] ?? match[2]!);
  for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const identifier = match[1]!;
    if (/[a-z][A-Z]|[_$]/.test(identifier)) identifiers.add(identifier);
  }
  const generic = new Set(["assert", "check", "describe", "expect", "it", "spec", "test"]);
  const selected = [...identifiers].filter((identifier) => !generic.has(identifier.toLowerCase()));
  return selected.length === 1 ? selected[0] : undefined;
}

function receiptRelationSourceBindingIds(
  relation: DeterministicRequirementRelation | undefined,
  currentBindingId: string
): string[] {
  if (!relation) return [currentBindingId];
  if (relation.kind === "test_antecedent") return [relation.antecedentSourceBindingRef, relation.currentSourceBindingRef];
  if (relation.kind === "test_subject_chain") return [relation.subjectSourceBindingRef, relation.bridgeSourceBindingRef, relation.currentSourceBindingRef];
  return [currentBindingId];
}

function stableReceiptContextJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableReceiptContextJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableReceiptContextJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function receiptDigest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function validateRequirementSourceBindings(
  value: unknown,
  requirementIds: ReadonlySet<string>,
  errors: string[]
): Map<string, RecordValue> {
  const bindingsById = new Map<string, RecordValue>();
  if (value === undefined) return bindingsById;
  const bindings = validateArray(value, "proofGraph.sourceBindings", LIMITS.sourceBindings, errors);
  if (!bindings) return bindingsById;
  const seenRequirementIds = new Set<string>();
  const seenSpanIds = new Set<string>();
  const seenIdentities = new Set<string>();

  for (const [index, item] of bindings.entries()) {
    const path = `proofGraph.sourceBindings[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(
      item,
      ["version", "kind", "id", "requirementId", "spanId", "seedId", "groupId", "source", "ordinal"],
      path,
      errors
    );
    if (item.version !== 1) errors.push(`${path}.version must be 1.`);
    if (item.kind !== "requirement_source_binding") errors.push(`${path}.kind is invalid.`);
    validateString(item.id, `${path}.id`, LIMITS.shortText, errors);
    validateString(item.requirementId, `${path}.requirementId`, LIMITS.shortText, errors);
    validateString(item.spanId, `${path}.spanId`, LIMITS.shortText, errors);
    validateString(item.seedId, `${path}.seedId`, LIMITS.shortText, errors);
    validateString(item.groupId, `${path}.groupId`, LIMITS.shortText, errors);
    validateEnum(item.source, `${path}.source`, REQUIREMENT_SOURCES, errors);

    if (typeof item.requirementId === "string" && !requirementIds.has(item.requirementId)) {
      errors.push(`${path}.requirementId must match a report requirement.`);
    }
    if (typeof item.requirementId === "string") {
      if (seenRequirementIds.has(item.requirementId)) errors.push(`${path} duplicates a requirement binding.`);
      seenRequirementIds.add(item.requirementId);
    }
    if (typeof item.spanId === "string" && !/^sp_\d+_\d+$/.test(item.spanId)) {
      errors.push(`${path}.spanId is invalid.`);
    }
    if (typeof item.spanId === "string") {
      if (seenSpanIds.has(item.spanId)) errors.push(`${path} duplicates a source span binding.`);
      seenSpanIds.add(item.spanId);
    }
    if (typeof item.seedId === "string" && !/^[a-f0-9]{64}$/.test(item.seedId)) {
      errors.push(`${path}.seedId must be a lowercase SHA-256 digest.`);
    }
    if (typeof item.groupId === "string" && !/^grp_\d+$/.test(item.groupId)) {
      errors.push(`${path}.groupId is invalid.`);
    }
    if (typeof item.ordinal !== "number" || !Number.isSafeInteger(item.ordinal) || item.ordinal < 0) {
      errors.push(`${path}.ordinal must be a non-negative integer.`);
    }
    if (
      typeof item.seedId === "string" &&
      typeof item.groupId === "string" &&
      typeof item.source === "string" &&
      typeof item.ordinal === "number" &&
      Number.isSafeInteger(item.ordinal)
    ) {
      const identity = [item.seedId, item.groupId, item.source, item.ordinal].join("\0");
      if (seenIdentities.has(identity)) errors.push(`${path} duplicates a source identity tuple.`);
      seenIdentities.add(identity);
    }
    if (typeof item.id === "string") {
      if (bindingsById.has(item.id)) errors.push(`${path}.id duplicates a source binding ID.`);
      else bindingsById.set(item.id, item);
    }
  }
  return bindingsById;
}

function validateExactHeadTargetReceipts(
  value: unknown,
  reportHeadSha: unknown,
  errors: string[]
): Map<string, RecordValue> {
  const receiptsById = new Map<string, RecordValue>();
  if (value === undefined) return receiptsById;
  const receipts = validateArray(
    value,
    "proofGraph.exactHeadTargetReceipts",
    LIMITS.exactHeadTargetReceipts,
    errors
  );
  if (!receipts) return receiptsById;
  const seenIdentity = new Set<string>();

  for (const [index, item] of receipts.entries()) {
    const path = `proofGraph.exactHeadTargetReceipts[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(
      item,
      ["id", "version", "kind", "headSha", "targetPathDigest", "targetBlobSha", "exportKind", "canonicalBindingDigest"],
      path,
      errors
    );
    if (item.version !== 1) errors.push(`${path}.version must be 1.`);
    if (item.kind !== "exact_head_target") errors.push(`${path}.kind is invalid.`);
    validateString(item.id, `${path}.id`, LIMITS.shortText, errors);
    if (typeof item.headSha !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(item.headSha)) {
      errors.push(`${path}.headSha must be exactly 40 or 64 lowercase hexadecimal characters.`);
    }
    if (item.headSha !== reportHeadSha || typeof reportHeadSha !== "string") {
      errors.push(`${path}.headSha must match source.provenance.headSha.`);
    }
    for (const key of ["targetPathDigest", "canonicalBindingDigest"] as const) {
      if (typeof item[key] !== "string" || !/^[a-f0-9]{64}$/.test(item[key])) {
        errors.push(`${path}.${key} must be a lowercase SHA-256 digest.`);
      }
    }
    if (typeof item.targetBlobSha !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(item.targetBlobSha)) {
      errors.push(`${path}.targetBlobSha must be a lowercase Git blob SHA.`);
    }
    validateEnum(item.exportKind, `${path}.exportKind`, EXACT_HEAD_EXPORT_KINDS, errors);

    if (typeof item.id === "string") {
      if (receiptsById.has(item.id)) errors.push(`${path}.id duplicates a target receipt ID.`);
      else receiptsById.set(item.id, item);
    }
    const identity = [item.headSha, item.targetPathDigest, item.targetBlobSha, item.exportKind, item.canonicalBindingDigest].join("\0");
    if (seenIdentity.has(identity)) errors.push(`${path} duplicates an exact-head target identity.`);
    seenIdentity.add(identity);
  }
  return receiptsById;
}

function validateTestRelationReceipts(
  value: unknown,
  targetReceiptsById: ReadonlyMap<string, RecordValue>,
  evidenceById: ReadonlyMap<string, RecordValue>,
  requirementIds: ReadonlySet<string>,
  nodes: readonly unknown[] | null,
  errors: string[]
): void {
  if (value === undefined) return;
  const receipts = validateArray(value, "proofGraph.testRelationReceipts", LIMITS.testRelationReceipts, errors);
  if (!receipts) return;
  const nodeByRequirementId = new Map<string, RecordValue>();
  for (const node of nodes ?? []) {
    if (isRecord(node) && typeof node.requirementId === "string") nodeByRequirementId.set(node.requirementId, node);
  }
  const seenIds = new Set<string>();
  const ownerByTargetAndTest = new Map<string, string>();
  const seenRelations = new Set<string>();

  for (const [index, item] of receipts.entries()) {
    const path = `proofGraph.testRelationReceipts[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(
      item,
      [
        "id",
        "version",
        "kind",
        "subjectRequirementId",
        "subjectSource",
        "exactHeadTargetReceiptRef",
        "testEvidenceRef",
        "relationBasis",
        "directAssertionCaseCount",
        "executionEvidenceRef"
      ],
      path,
      errors
    );
    if (item.version !== 1) errors.push(`${path}.version must be 1.`);
    if (item.kind !== "targeted_test_relation") errors.push(`${path}.kind is invalid.`);
    for (const key of ["id", "subjectRequirementId", "exactHeadTargetReceiptRef", "testEvidenceRef", "executionEvidenceRef"] as const) {
      validateString(item[key], `${path}.${key}`, LIMITS.shortText, errors);
    }
    validateEnum(item.subjectSource, `${path}.subjectSource`, TEST_RELATION_SUBJECT_SOURCES, errors);
    validateEnum(item.relationBasis, `${path}.relationBasis`, TEST_RELATION_BASES, errors);
    if (
      typeof item.directAssertionCaseCount !== "number" ||
      !Number.isSafeInteger(item.directAssertionCaseCount) ||
      item.directAssertionCaseCount < 1 ||
      item.directAssertionCaseCount > 8
    ) {
      errors.push(`${path}.directAssertionCaseCount must be an integer between 1 and 8.`);
    }
    if (typeof item.subjectRequirementId === "string" && !requirementIds.has(item.subjectRequirementId)) {
      errors.push(`${path}.subjectRequirementId must match a report requirement.`);
    }
    if (typeof item.exactHeadTargetReceiptRef === "string" && !targetReceiptsById.has(item.exactHeadTargetReceiptRef)) {
      errors.push(`${path}.exactHeadTargetReceiptRef cites a missing target receipt.`);
    }
    const testEvidence = typeof item.testEvidenceRef === "string" ? evidenceById.get(item.testEvidenceRef) : undefined;
    if (typeof item.testEvidenceRef === "string" && !testEvidence) {
      errors.push(`${path}.testEvidenceRef cites missing evidence.`);
    } else if (testEvidence?.kind !== "test") {
      errors.push(`${path}.testEvidenceRef must cite test evidence.`);
    }
    const executionEvidence = typeof item.executionEvidenceRef === "string" ? evidenceById.get(item.executionEvidenceRef) : undefined;
    if (typeof item.executionEvidenceRef === "string" && !executionEvidence) {
      errors.push(`${path}.executionEvidenceRef cites missing evidence.`);
    } else if (
      executionEvidence &&
      (executionEvidence.kind !== "check" && executionEvidence.kind !== "log" ||
        evidenceStatusFromSummary(typeof executionEvidence.summary === "string" ? executionEvidence.summary : "") !== "passed")
    ) {
      errors.push(`${path}.executionEvidenceRef must cite passing execution evidence.`);
    }

    const node = typeof item.subjectRequirementId === "string"
      ? nodeByRequirementId.get(item.subjectRequirementId)
      : undefined;
    if (typeof item.testEvidenceRef === "string" && !getStringArray(node?.targetedTestEvidenceRefs).includes(item.testEvidenceRef)) {
      errors.push(`${path}.testEvidenceRef must match requirement-local targeted test proof.`);
    }
    if (typeof item.executionEvidenceRef === "string" && !getStringArray(node?.executionEvidenceRefs).includes(item.executionEvidenceRef)) {
      errors.push(`${path}.executionEvidenceRef must match requirement-local execution proof.`);
    }
    const caseCoverageReceipt = isRecord(node?.caseCoverageReceipt) ? node.caseCoverageReceipt : undefined;
    if (caseCoverageReceipt) {
      if (caseCoverageReceipt.testEvidenceRef !== item.testEvidenceRef) {
        errors.push(`${path}.testEvidenceRef must match proof-node case coverage.`);
      }
      if (caseCoverageReceipt.distinctLiteralCaseCount !== item.directAssertionCaseCount) {
        errors.push(`${path}.directAssertionCaseCount must match proof-node case coverage.`);
      }
    }

    if (typeof item.id === "string") {
      if (seenIds.has(item.id)) errors.push(`${path}.id duplicates a test relation receipt ID.`);
      seenIds.add(item.id);
    }
    const targetAndTest = [item.exactHeadTargetReceiptRef, item.testEvidenceRef].join("\0");
    const existingOwner = ownerByTargetAndTest.get(targetAndTest);
    if (existingOwner !== undefined && existingOwner !== item.subjectRequirementId) {
      errors.push(`${path} reuses one exact target and test relation across requirements.`);
    } else if (existingOwner === undefined && typeof item.subjectRequirementId === "string") {
      ownerByTargetAndTest.set(targetAndTest, item.subjectRequirementId);
    }
    const relation = [item.subjectRequirementId, targetAndTest, item.executionEvidenceRef].join("\0");
    if (seenRelations.has(relation)) errors.push(`${path} duplicates test relation receipt.`);
    seenRelations.add(relation);
  }
}

function validateFailedCheckAssociations(
  value: unknown,
  evidenceById: ReadonlyMap<string, RecordValue>,
  requirementIds: ReadonlySet<string>,
  nodes: readonly unknown[] | null,
  errors: string[]
) {
  if (value === undefined) return;
  const associations = validateArray(
    value,
    "proofGraph.failedCheckAssociations",
    LIMITS.failedCheckAssociations,
    errors
  );
  if (!associations) return;

  const proofNodeByRequirement = new Map<string, RecordValue>();
  for (const node of nodes ?? []) {
    if (isRecord(node) && typeof node.requirementId === "string") {
      proofNodeByRequirement.set(node.requirementId, node);
    }
  }
  const seenPairs = new Set<string>();
  const associationsByRequirement = new Map<string, number>();
  for (const [index, item] of associations.entries()) {
    const path = `proofGraph.failedCheckAssociations[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    requireKeys(
      item,
      ["version", "kind", "requirementId", "checkEvidenceRef", "state", "basis"],
      path,
      errors
    );
    if (item.version !== 1) errors.push(`${path}.version must be 1.`);
    if (item.kind !== "failed_check_association") errors.push(`${path}.kind is invalid.`);
    validateString(item.requirementId, `${path}.requirementId`, LIMITS.shortText, errors);
    validateString(item.checkEvidenceRef, `${path}.checkEvidenceRef`, LIMITS.shortText, errors);
    validateEnum(item.state, `${path}.state`, FAILED_CHECK_ASSOCIATION_STATES, errors);
    validateEnum(item.basis, `${path}.basis`, FAILED_CHECK_ASSOCIATION_BASES, errors);

    if (typeof item.requirementId === "string" && !requirementIds.has(item.requirementId)) {
      errors.push(`${path}.requirementId must match a report requirement.`);
    }
    const evidence = typeof item.checkEvidenceRef === "string"
      ? evidenceById.get(item.checkEvidenceRef)
      : undefined;
    if (typeof item.checkEvidenceRef === "string" && !evidence) {
      errors.push(`${path}.checkEvidenceRef cites missing evidence.`);
    } else if (
      evidence &&
      (evidence.kind !== "check" || evidenceStatusFromSummary(typeof evidence.summary === "string" ? evidence.summary : "") !== "failed")
    ) {
      errors.push(`${path}.checkEvidenceRef must cite failed Check evidence.`);
    }

    const validPair =
      (item.state === "linked" && item.basis === "complete_identity_match") ||
      (item.state === "not_linked" && item.basis === "deterministic_non_match") ||
      (item.state === "unknown" && item.basis === "identity_incomplete");
    if (!validPair) errors.push(`${path} has an incompatible state and basis.`);

    if (typeof item.requirementId === "string" && typeof item.checkEvidenceRef === "string") {
      const requirementAssociationCount = (associationsByRequirement.get(item.requirementId) ?? 0) + 1;
      associationsByRequirement.set(item.requirementId, requirementAssociationCount);
      if (requirementAssociationCount > 8) {
        errors.push("proofGraph.failedCheckAssociations must contain at most 8 items per requirement.");
      }
      const pair = `${item.requirementId}\0${item.checkEvidenceRef}`;
      if (seenPairs.has(pair)) {
        errors.push(`${path} duplicates requirement/check association.`);
      }
      seenPairs.add(pair);

      const proofNode = proofNodeByRequirement.get(item.requirementId);
      const executionRefs = new Set(getStringArray(proofNode?.executionEvidenceRefs));
      const gapRefs = new Set(Array.isArray(proofNode?.gapSignals)
        ? proofNode.gapSignals.filter(isRecord).flatMap((gap) => getStringArray(gap.evidenceRefs))
        : []);
      if (item.state === "linked" && (!executionRefs.has(item.checkEvidenceRef) || !gapRefs.has(item.checkEvidenceRef))) {
        errors.push(`${path} linked association must match local failed-execution proof.`);
      }
      if (item.state !== "linked" && (executionRefs.has(item.checkEvidenceRef) || gapRefs.has(item.checkEvidenceRef))) {
        errors.push(`${path} non-linked association cannot enter requirement-local proof.`);
      }
    }
  }
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
  currentRequirementId: unknown,
  requirementIds: ReadonlySet<string>,
  sourceBindingsById: ReadonlyMap<string, RecordValue>,
  referencedSourceBindingIds: Set<string>,
  errors: string[]
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  const isTestAntecedent = value.kind === "test_antecedent";
  const isTestSubjectChain = value.kind === "test_subject_chain";
  requireKeys(
    value,
    isTestSubjectChain
      ? [
          "version",
          "kind",
          "subjectRequirementId",
          "bridgeRequirementId",
          "currentSourceBindingRef",
          "subjectSourceBindingRef",
          "bridgeSourceBindingRef"
        ]
      : isTestAntecedent
      ? ["version", "kind", "antecedentRequirementId", "currentSourceBindingRef", "antecedentSourceBindingRef"]
      : ["version", "kind", "antecedentRequirementId"],
    path,
    errors
  );
  if (value.version !== 1) errors.push(`${path}.version must be 1.`);
  if (!isTestSubjectChain && value.kind !== "workflow_antecedent" && !isTestAntecedent) {
    errors.push(`${path}.kind is invalid.`);
  }
  if (isTestSubjectChain) {
    validateString(value.subjectRequirementId, `${path}.subjectRequirementId`, LIMITS.shortText, errors);
    validateString(value.bridgeRequirementId, `${path}.bridgeRequirementId`, LIMITS.shortText, errors);
    for (const [key, requirementId] of [
      ["subjectRequirementId", value.subjectRequirementId],
      ["bridgeRequirementId", value.bridgeRequirementId]
    ] as const) {
      if (typeof requirementId === "string" && !requirementIds.has(requirementId)) {
        errors.push(`${path}.${key} must match a report requirement.`);
      }
    }
    if (
      value.subjectRequirementId === currentRequirementId ||
      value.bridgeRequirementId === currentRequirementId ||
      value.subjectRequirementId === value.bridgeRequirementId
    ) {
      errors.push(`${path} must bind three distinct requirements.`);
    }

    const bindingEntries = [
      ["currentSourceBindingRef", currentRequirementId],
      ["subjectSourceBindingRef", value.subjectRequirementId],
      ["bridgeSourceBindingRef", value.bridgeRequirementId]
    ] as const;
    const bindings: Array<RecordValue | undefined> = [];
    for (const [key, requirementId] of bindingEntries) {
      validateString(value[key], `${path}.${key}`, LIMITS.shortText, errors);
      const binding = typeof value[key] === "string" ? sourceBindingsById.get(value[key]) : undefined;
      bindings.push(binding);
      if (typeof value[key] === "string") {
        referencedSourceBindingIds.add(value[key]);
        if (!binding) errors.push(`${path}.${key} cites a missing source binding.`);
      }
      if (binding && binding.requirementId !== requirementId) {
        errors.push(`${path}.${key} must bind its named requirement.`);
      }
    }
    const [currentBinding, subjectBinding, bridgeBinding] = bindings;
    if (
      currentBinding && subjectBinding && bridgeBinding &&
      (
        currentBinding.seedId !== subjectBinding.seedId ||
        currentBinding.seedId !== bridgeBinding.seedId ||
        currentBinding.groupId !== subjectBinding.groupId ||
        currentBinding.groupId !== bridgeBinding.groupId ||
        currentBinding.source !== subjectBinding.source ||
        currentBinding.source !== bridgeBinding.source ||
        typeof currentBinding.ordinal !== "number" ||
        typeof subjectBinding.ordinal !== "number" ||
        typeof bridgeBinding.ordinal !== "number" ||
        bridgeBinding.ordinal !== subjectBinding.ordinal + 1 ||
        currentBinding.ordinal !== bridgeBinding.ordinal + 1
      )
    ) {
      errors.push(`${path} source bindings must share one seed and group with consecutive ordinals.`);
    }
    return;
  }

  validateString(value.antecedentRequirementId, `${path}.antecedentRequirementId`, LIMITS.shortText, errors);
  if (typeof value.antecedentRequirementId === "string" && !requirementIds.has(value.antecedentRequirementId)) {
    errors.push(`${path}.antecedentRequirementId must match a report requirement.`);
  }
  if (!isTestAntecedent) return;

  validateString(value.currentSourceBindingRef, `${path}.currentSourceBindingRef`, LIMITS.shortText, errors);
  validateString(value.antecedentSourceBindingRef, `${path}.antecedentSourceBindingRef`, LIMITS.shortText, errors);
  const currentBinding = typeof value.currentSourceBindingRef === "string"
    ? sourceBindingsById.get(value.currentSourceBindingRef)
    : undefined;
  const antecedentBinding = typeof value.antecedentSourceBindingRef === "string"
    ? sourceBindingsById.get(value.antecedentSourceBindingRef)
    : undefined;
  if (typeof value.currentSourceBindingRef === "string") {
    referencedSourceBindingIds.add(value.currentSourceBindingRef);
    if (!currentBinding) errors.push(`${path}.currentSourceBindingRef cites a missing source binding.`);
  }
  if (typeof value.antecedentSourceBindingRef === "string") {
    referencedSourceBindingIds.add(value.antecedentSourceBindingRef);
    if (!antecedentBinding) errors.push(`${path}.antecedentSourceBindingRef cites a missing source binding.`);
  }
  if (currentBinding && currentBinding.requirementId !== currentRequirementId) {
    errors.push(`${path}.currentSourceBindingRef must bind the current requirement.`);
  }
  if (antecedentBinding && antecedentBinding.requirementId !== value.antecedentRequirementId) {
    errors.push(`${path}.antecedentSourceBindingRef must bind the antecedent requirement.`);
  }
  if (
    currentBinding &&
    antecedentBinding &&
    (
      currentBinding.seedId !== antecedentBinding.seedId ||
      currentBinding.groupId !== antecedentBinding.groupId ||
      currentBinding.source !== antecedentBinding.source ||
      typeof currentBinding.ordinal !== "number" ||
      typeof antecedentBinding.ordinal !== "number" ||
      currentBinding.ordinal !== antecedentBinding.ordinal + 1
    )
  ) {
    errors.push(`${path} source bindings must share one seed and group with consecutive ordinals.`);
  }
}

function validateCaseCoverageReceipt(
  value: unknown,
  path: string,
  proofNode: RecordValue,
  evidenceById: ReadonlyMap<string, RecordValue>,
  errors: string[]
) {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object.`);
    return;
  }

  requireKeys(
    value,
    ["version", "implementationEvidenceRef", "testEvidenceRef", "distinctLiteralCaseCount"],
    path,
    errors
  );
  if (value.version !== 1) errors.push(`${path}.version must be 1.`);
  validateString(value.implementationEvidenceRef, `${path}.implementationEvidenceRef`, LIMITS.shortText, errors);
  validateString(value.testEvidenceRef, `${path}.testEvidenceRef`, LIMITS.shortText, errors);
  if (value.distinctLiteralCaseCount !== 2) {
    errors.push(`${path}.distinctLiteralCaseCount must be 2.`);
  }

  const implementationRefs = new Set(getStringArray(proofNode.implementationEvidenceRefs));
  const targetedTestRefs = new Set(getStringArray(proofNode.targetedTestEvidenceRefs));
  if (typeof value.implementationEvidenceRef === "string" && !implementationRefs.has(value.implementationEvidenceRef)) {
    errors.push(`${path}.implementationEvidenceRef must match implementation evidence.`);
  }
  if (typeof value.testEvidenceRef === "string" && !targetedTestRefs.has(value.testEvidenceRef)) {
    errors.push(`${path}.testEvidenceRef must match targeted test evidence.`);
  }

  const implementationEvidence = typeof value.implementationEvidenceRef === "string"
    ? evidenceById.get(value.implementationEvidenceRef)
    : undefined;
  if (implementationEvidence && !isImplementationProofEvidence(implementationEvidence)) {
    errors.push(`${path}.implementationEvidenceRef must cite implementation evidence.`);
  }
  const testEvidence = typeof value.testEvidenceRef === "string"
    ? evidenceById.get(value.testEvidenceRef)
    : undefined;
  if (testEvidence && !isTargetedTestProofEvidence(testEvidence)) {
    errors.push(`${path}.testEvidenceRef must cite test evidence.`);
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

function validateFailedCheckProofIsolation(report: RecordValue, errors: string[]) {
  const proofGraph = isRecord(report.proofGraph) ? report.proofGraph : null;
  const associations = Array.isArray(proofGraph?.failedCheckAssociations)
    ? proofGraph.failedCheckAssociations
    : [];
  const requirements = Array.isArray(report.requirements) ? report.requirements : [];
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];

  associations.forEach((association, associationIndex) => {
    if (
      !isRecord(association) ||
      (association.state !== "unknown" && association.state !== "not_linked") ||
      typeof association.requirementId !== "string" ||
      typeof association.checkEvidenceRef !== "string"
    ) return;

    const requirement = requirements.find((item) =>
      isRecord(item) && item.requirementId === association.requirementId
    );
    const node = nodes.find((item) =>
      isRecord(item) && item.requirementId === association.requirementId
    );
    const ref = association.checkEvidenceRef;
    const prefix = `proofGraph.failedCheckAssociations[${associationIndex}] ${association.state} Check evidence cannot enter`;

    if (isRecord(requirement) && getStringArray(requirement.evidenceRefs).includes(ref)) {
      errors.push(`${prefix} requirement proof.`);
    }
    if (
      isRecord(requirement) &&
      Array.isArray(requirement.proofAxes) &&
      requirement.proofAxes.some((axis) => isRecord(axis) && getStringArray(axis.evidenceRefs).includes(ref))
    ) {
      errors.push(`${prefix} proof_axis proof.`);
    }
    if (isRecord(node) && getStringArray(node.executionEvidenceRefs).includes(ref)) {
      errors.push(`${prefix} proof_node_execution proof.`);
    }
    if (
      isRecord(node) &&
      Array.isArray(node.gapSignals) &&
      node.gapSignals.some((gap) => isRecord(gap) && getStringArray(gap.evidenceRefs).includes(ref))
    ) {
      errors.push(`${prefix} local_gap proof.`);
    }
  });
}

function validateSummaryOnlyReport(report: RecordValue, errors: string[]) {
  validatePrivateProofReceiptOmission(report, "summary-only reports", errors);

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

function validatePrivateProofReceiptOmission(
  report: RecordValue,
  boundary: "summary-only reports" | "tenant reports",
  errors: string[]
): void {
  if (!isRecord(report.proofGraph)) return;
  for (const collection of [
    "sourceBindings",
    "exactHeadTargetReceipts",
    "testRelationReceipts",
    "privateReceiptBundleV2",
    "executionBindingReceipts",
    "failedCheckAssociations"
  ]) {
    if (Object.hasOwn(report.proofGraph, collection)) {
      errors.push(`${boundary} must omit proofGraph.${collection}.`);
    }
  }
}

function validateObservationProofSemantics(
  report: RecordValue,
  evidenceIds: Set<string>,
  errors: string[],
  requirePromotionReceipt: boolean
) {
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

    const axes = Array.isArray(item.proofAxes)
      ? item.proofAxes.filter(isRecord).filter((axis) => axis.role !== "criterion")
      : null;
    const proofNode = proofNodeByRequirement.get(typeof item.requirementId === "string" ? item.requirementId : "");
    const requirementText = typeof item.requirementText === "string" ? item.requirementText : "";
    const proofNodeText = typeof proofNode?.requirementText === "string" ? proofNode.requirementText : "";
    const duplicateTextMatches = proofNode !== undefined && proofNodeText === requirementText;
    if (proofNode && !duplicateTextMatches) {
      errors.push(`proofGraph node requirementText must match requirements[${index}].requirementText.`);
    }
    if (axes) {
      validateFullRequirementProofAxes(
        report,
        requirementText,
        proofNode,
        axes,
        evidenceById,
        deterministicProofContextForFullReport(proofNode),
        index,
        errors
      );
      if (requirePromotionReceipt) {
        validateRequirementLocalPromotionReceipts(report, item, proofNode, axes, index, errors);
      }
    }

    if (item.evidenceStatus !== undefined && axes && axes.length > 0) {
      if (axes.every((axis) => axis.state === "satisfied") && item.evidenceStatus !== "met") {
        errors.push(`requirements[${index}] evidenceStatus must be met when every proof axis is satisfied.`);
      } else if (item.evidenceStatus === "met" && axes.some((axis) => axis.state !== "satisfied")) {
        errors.push(`requirements[${index}] evidenceStatus cannot be met without every proof axis satisfied.`);
      }
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

function validateLegacyOutcomeSemantics(report: RecordValue, evidenceIds: Set<string>, errors: string[]) {
  const evidenceById = collectEvidenceById(report.evidenceIndex);
  const proofNodeByRequirement = new Map<string, RecordValue>();
  if (isRecord(report.proofGraph) && Array.isArray(report.proofGraph.nodes)) {
    for (const node of report.proofGraph.nodes) {
      if (isRecord(node) && typeof node.requirementId === "string") proofNodeByRequirement.set(node.requirementId, node);
    }
  }
  if (!Array.isArray(report.requirements)) return;
  report.requirements.forEach((item, index) => {
    if (!isRecord(item)) return;
    const axes = Array.isArray(item.proofAxes) ? item.proofAxes.filter(isRecord) : null;
    const proofNode = proofNodeByRequirement.get(typeof item.requirementId === "string" ? item.requirementId : "");
    const duplicateTextMatches = proofNode !== undefined && proofNode.requirementText === item.requirementText;
    if (axes && proofNode && proofNode.status !== item.status) errors.push(`requirements[${index}].status must match proofGraph node status.`);
    const matchingAuthorClaimPartial = item.status === "partial" && proofNode?.sourceQuality === "author_claim" && proofNode.status === "partial" && duplicateTextMatches;
    if (item.sourceAuthority !== undefined || item.evidenceStatus !== undefined) {
      if (item.sourceAuthority !== "pr_description" || proofNode?.sourceQuality !== "author_claim") errors.push(`requirements[${index}] sourceAuthority must match an author-claim proof node.`);
      if (!axes || axes.length === 0) {
        if (item.evidenceStatus !== item.status) errors.push(`requirements[${index}] evidenceStatus without proof axes must match status.`);
      }
    }
    if (axes && axes.length > 0 && axes.every((axis) => axis.state === "satisfied") && item.status !== "met" && !matchingAuthorClaimPartial) errors.push(`requirements[${index}] status must agree with proofAxes; every satisfied authoritative axis requires met.`);
    if (item.status === "met" && Array.isArray(item.gaps) && item.gaps.length > 0) errors.push(`requirements[${index}] cannot be met while evidence gaps are present.`);
    if (item.status !== "met") return;
    if (axes) {
      if (axes.length === 0 || axes.some((axis) => axis.state !== "satisfied")) {
        errors.push(`requirements[${index}] status must agree with proofAxes; met requires every axis satisfied.`);
        if (axes.some((axis) => axis.subject === "execution" && axis.state !== "satisfied")) errors.push(`requirements[${index}] cannot be met without passing test, build, or CI execution evidence.`);
      }
      return;
    }
    const hasPassingTestExecution = getStringArray(item.evidenceRefs).map((ref) => evidenceById.get(ref)).some((evidence) => evidence ? isPassingTestExecutionEvidence(evidence) : false);
    if (!hasPassingTestExecution) errors.push(`requirements[${index}] cannot be met without passing test, build, or CI execution evidence.`);
    if (typeof item.requirementText === "string" && /\b(tests?|coverage|specs?)\b/i.test(item.requirementText) && !hasPassingTestExecution) errors.push(`requirements[${index}] test requirement cannot be met without passing test execution evidence.`);
  });
}

function validateRequirementLocalPromotionReceipts(report: RecordValue, requirement: RecordValue, node: RecordValue | undefined, axes: RecordValue[], requirementIndex: number, errors: string[]): void {
  const targeted = axes.find((axis) => axis.subject === "targeted_test" && axis.state === "satisfied");
  const execution = axes.find((axis) => axis.subject === "execution" && axis.state === "satisfied");
  if (!targeted && !execution) return;
  const requirementId = typeof requirement.requirementId === "string" ? requirement.requirementId : "";
  const testRefs = getStringArray(targeted?.evidenceRefs);
  const executionRefs = getStringArray(execution?.evidenceRefs);
  const nodeTestRefs = getStringArray(node?.targetedTestEvidenceRefs);
  const nodeExecutionRefs = getStringArray(node?.executionEvidenceRefs);
  const bundle = isRecord(report.proofGraph) && isRecord(report.proofGraph.privateReceiptBundleV2)
    ? report.proofGraph.privateReceiptBundleV2
    : undefined;
  const relations = Array.isArray(bundle?.testRelationReceipts) ? bundle.testRelationReceipts.filter(isRecord) : [];
  const executionBindings = Array.isArray(bundle?.executionBindingReceipts) ? bundle.executionBindingReceipts.filter(isRecord) : [];
  const sourceBindings = Array.isArray(bundle?.sourceBindings) ? bundle.sourceBindings.filter(isRecord) : [];
  const exactTargets = Array.isArray(bundle?.exactHeadTargetReceipts) ? bundle.exactHeadTargetReceipts.filter(isRecord) : [];
  const sourceHeadSha = isRecord(report.source) && isRecord(report.source.provenance) && typeof report.source.provenance.headSha === "string"
    ? report.source.provenance.headSha
    : undefined;
  const closed = Boolean(targeted && execution) && relations.some((relation) => {
    if (relation.version !== 2 || relation.kind !== "targeted_test_relation" || relation.requirementId !== requirementId ||
      typeof relation.testEvidenceRef !== "string" || !testRefs.includes(relation.testEvidenceRef) || !nodeTestRefs.includes(relation.testEvidenceRef) ||
      !sourceBindings.some((binding) => binding.requirementId === requirementId) || typeof relation.executionReceiptRef !== "string") {
      return false;
    }
    const targetBound = relation.targetMode === "changed_target"
      ? typeof relation.implementationEvidenceRef === "string" && getStringArray(node?.implementationEvidenceRefs).includes(relation.implementationEvidenceRef)
      : relation.targetMode === "exact_head_target" && typeof relation.exactHeadTargetReceiptRef === "string" && exactTargets.some((target) =>
        target.id === relation.exactHeadTargetReceiptRef && (sourceHeadSha === undefined || target.headSha === sourceHeadSha));
    if (!targetBound) return false;
    return executionBindings.some((binding) => binding.version === 2 && binding.kind === "execution_binding" &&
      binding.id === relation.executionReceiptRef && binding.requirementId === requirementId && binding.testEvidenceRef === relation.testEvidenceRef &&
      typeof binding.executionEvidenceRef === "string" && executionRefs.includes(binding.executionEvidenceRef) && nodeExecutionRefs.includes(binding.executionEvidenceRef));
  });
  if (!closed) errors.push(`requirements[${requirementIndex}] satisfied requirement-local targeted-test or execution observation requires a closed test-relation receipt.`);
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

    if (
      subject === "targeted_test" &&
      axis.collectionBasis === "direct_assertion_case_coverage" &&
      state === "satisfied" &&
      !isRecord(proofNode?.caseCoverageReceipt)
    ) {
      errors.push(`${axisPath} case coverage receipt is required for direct assertion case coverage.`);
    }

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
        return !evidence || !isViolatedExecutionAxisEvidenceCompatible(report, evidence, proofNode, ref);
      })) {
        errors.push(`${axisPath} violated execution has incompatible evidence or collection basis.`);
      }
      continue;
    }

    if (state === "satisfied" && subject === "execution" && isWorkflowAntecedentProofNode(proofNode)) {
      errors.push(`${axisPath} satisfied workflow antecedent execution requires a complete workflow/job identity tuple.`);
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

function isWorkflowAntecedentProofNode(proofNode: RecordValue | undefined): boolean {
  const relation = isRecord(proofNode?.deterministicRelation) ? proofNode.deterministicRelation : null;
  return relation?.version === 1 &&
    relation.kind === "workflow_antecedent" &&
    typeof relation.antecedentRequirementId === "string";
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
  current: RecordValue | undefined
): DeterministicProofContext {
  const relation = isRecord(current?.deterministicRelation) ? current.deterministicRelation : null;
  if (
    relation?.version === 1 &&
    relation.kind === "test_subject_chain" &&
    typeof relation.subjectRequirementId === "string" &&
    typeof relation.bridgeRequirementId === "string" &&
    typeof relation.currentSourceBindingRef === "string" &&
    typeof relation.subjectSourceBindingRef === "string" &&
    typeof relation.bridgeSourceBindingRef === "string"
  ) {
    return {
      kind: "test_subject_chain",
      subjectRequirementId: relation.subjectRequirementId,
      bridgeRequirementId: relation.bridgeRequirementId,
      currentSourceBindingRef: relation.currentSourceBindingRef,
      subjectSourceBindingRef: relation.subjectSourceBindingRef,
      bridgeSourceBindingRef: relation.bridgeSourceBindingRef
    };
  }
  if (
    relation?.version === 1 &&
    relation.kind === "test_antecedent" &&
    typeof relation.antecedentRequirementId === "string" &&
    typeof relation.currentSourceBindingRef === "string" &&
    typeof relation.antecedentSourceBindingRef === "string"
  ) {
    return {
      kind: "test_antecedent",
      requirementId: relation.antecedentRequirementId,
      currentSourceBindingRef: relation.currentSourceBindingRef,
      antecedentSourceBindingRef: relation.antecedentSourceBindingRef
    };
  }
  if (
    relation?.version !== 1 ||
    relation.kind !== "workflow_antecedent" ||
    typeof relation.antecedentRequirementId !== "string"
  ) {
    const text = typeof current?.requirementText === "string" ? current.requirementText : "";
    const presentation = requirementProofAxisExpectationsWithContext(text, { kind: "review_presentation" });
    return presentation.visual && !requirementProofAxisExpectations(text).visual
      ? { kind: "review_presentation" }
      : { kind: "none" };
  }

  return { kind: "workflow_antecedent", requirementId: relation.antecedentRequirementId };
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
    const requiredBasis = isEnglishBothPathsRequirement(requirementText)
      ? "direct_assertion_case_coverage"
      : "matching_artifact_evidence";
    return collectionBasis === requiredBasis &&
      evidence.kind === "test" &&
      targetedTestRefs.has(ref) &&
      targetedTestEvidenceMatchesRequirement(report, proofNode, requirementText, evidence) &&
      (requiredBasis !== "direct_assertion_case_coverage" || caseCoverageReceiptMatchesRef(proofNode, ref));
  }
  if (subject === "execution") {
    if (isEnglishBothPathsRequirement(requirementText) && collectionBasis !== "passing_suite_execution") {
      return false;
    }
    if (collectionBasis === "passing_execution") {
      return isPassingTestExecutionEvidence(evidence) &&
        executionRefs.has(ref) &&
        (
          evidenceOverlapsRequirement(requirementText, evidence) ||
          executionEvidenceMatchesTargetedTests(report, proofNode, evidence)
        );
    }
    if (collectionBasis === "passing_suite_execution") {
      const caseCoverageTestRef = isEnglishBothPathsRequirement(requirementText)
        ? caseCoverageReceiptTestEvidenceRef(proofNode)
        : undefined;
      if (isEnglishBothPathsRequirement(requirementText) && !caseCoverageTestRef) return false;
      return isVerifiedSuiteExecutionEvidenceCompatible(report, evidence, proofNode, ref, caseCoverageTestRef);
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

function caseCoverageReceiptMatchesRef(proofNode: RecordValue | undefined, testEvidenceRef: string): boolean {
  const receipt = isRecord(proofNode?.caseCoverageReceipt) ? proofNode.caseCoverageReceipt : null;
  if (
    receipt?.version !== 1 ||
    receipt.distinctLiteralCaseCount !== 2 ||
    receipt.testEvidenceRef !== testEvidenceRef ||
    typeof receipt.implementationEvidenceRef !== "string"
  ) {
    return false;
  }
  return getStringArray(proofNode?.implementationEvidenceRefs).includes(receipt.implementationEvidenceRef) &&
    getStringArray(proofNode?.targetedTestEvidenceRefs).includes(testEvidenceRef);
}

function caseCoverageReceiptTestEvidenceRef(proofNode: RecordValue | undefined): string | undefined {
  const receipt = isRecord(proofNode?.caseCoverageReceipt) ? proofNode.caseCoverageReceipt : null;
  return typeof receipt?.testEvidenceRef === "string" ? receipt.testEvidenceRef : undefined;
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
  ref: string,
  requiredTestEvidenceRef?: string
): boolean {
  if (!isPassingTestExecutionEvidence(evidence)) return false;
  if (!new Set(getStringArray(proofNode?.executionEvidenceRefs)).has(ref)) return false;

  const source = isRecord(report.source) ? report.source : null;
  const provenance = source && isRecord(source.provenance) ? source.provenance : null;
  const headSha = typeof provenance?.headSha === "string" ? provenance.headSha : "";
  if (provenance?.origin !== "github_snapshot" || !/^[a-f0-9]{40,64}$/.test(headSha)) return false;

  const suites = Array.isArray(provenance.executionSuites) ? provenance.executionSuites.filter(isRecord) : [];
  const label = typeof evidence.label === "string" ? evidence.label : "";
  const targetedTestRefs = requiredTestEvidenceRef
    ? new Set([requiredTestEvidenceRef])
    : new Set(getStringArray(proofNode?.targetedTestEvidenceRefs));
  const evidenceIndex = Array.isArray(report.evidenceIndex) ? report.evidenceIndex.filter(isRecord) : [];

  return suites.some((suite) => {
    if (
      suite.headSha !== headSha ||
      suite.status !== "passed" ||
      suite.executionSource !== label ||
      suite.scope !== "repository_discovery" ||
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

function isEnglishBothPathsRequirement(text: string): boolean {
  return /\bboth(?:\s+[a-z][a-z0-9-]*){0,4}\s+(?:paths?|branches?)\b/i.test(text);
}

function isViolatedExecutionAxisEvidenceCompatible(
  report: RecordValue,
  evidence: RecordValue,
  proofNode: RecordValue | undefined,
  ref: string
): boolean {
  const summary = typeof evidence.summary === "string" ? evidence.summary : "";
  const executionRefs = new Set(getStringArray(proofNode?.executionEvidenceRefs));
  const requirementId = typeof proofNode?.requirementId === "string" ? proofNode.requirementId : "";
  const proofGraph = isRecord(report.proofGraph) ? report.proofGraph : null;
  const associations = Array.isArray(proofGraph?.failedCheckAssociations)
    ? proofGraph.failedCheckAssociations.filter(isRecord)
    : [];
  const hasLinkedAssociation = associations.some((association) =>
    association.version === 1 &&
    association.kind === "failed_check_association" &&
    association.requirementId === requirementId &&
    association.checkEvidenceRef === ref &&
    association.state === "linked" &&
    association.basis === "complete_identity_match"
  );
  return evidence.kind === "check" &&
    evidenceStatusFromSummary(summary) === "failed" &&
    isExecutionProofEvidence(evidence) &&
    executionRefs.has(ref) &&
    hasLinkedAssociation;
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
