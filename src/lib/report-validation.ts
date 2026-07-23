import type { VerificationReport } from "./types";
import { buildDecisionCard } from "./decision-card";
import {
  hasPassingEvidenceStatusPrefix,
  isExecutionEvidenceItemSignal,
  statusFromExecutionEvidenceSummary
} from "./evidence-status";

const PRIORITIES = new Set(["low", "medium", "high", "blocker"]);
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);
const EVIDENCE_KINDS = new Set(["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"]);
const TARGET_AGENTS = new Set(["codex", "claude_code", "cursor", "copilot"]);
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
  "ambiguous_requirement",
  "self_reported_test_gap",
  "evidence_unavailable",
  "evidence_insufficient",
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
  mode?: "default" | "full" | "summary";
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
    ["authenticity", "decisionCard"]
  );

  validateString(report.analysisId, "analysisId", LIMITS.analysisId, errors);
  validateString(report.createdAt, "createdAt", LIMITS.createdAt, errors);

  const evidenceIds = validateEvidenceIndex(report.evidenceIndex, errors);
  const evidenceById = collectEvidenceById(report.evidenceIndex);
  const requirementIds = collectRequirementIds(report.requirements);
  validateSource(report.source, errors, options.requireSourceProvenance === true);
  validateSummary(report.summary, errors);
  validateRequirements(report.requirements, evidenceIds, errors);
  validateClaims(report.claims, evidenceIds, errors);
  validateScope(report.scope, evidenceIds, errors);
  validateTesting(report.testing, evidenceIds, errors);
  validateReviewPriority(report.reviewPriority, evidenceIds, errors);
  validateProofGraph(report.proofGraph, evidenceIds, evidenceById, requirementIds, mode, errors);
  validateReprompt(report.reprompt, errors);
  validateDecisionCard(report.decisionCard, evidenceIds, report, errors);
  if (report.decisionCard !== undefined) {
    try {
      const expected = buildDecisionCard(report as unknown as VerificationReport);
      if (JSON.stringify(report.decisionCard) !== JSON.stringify(expected)) errors.push("decisionCard must match the deterministic Decision Card builder output.");
    } catch {
      errors.push("decisionCard could not be recomputed from the report.");
    }
  }
  validateStringArray(report.limitations, "limitations", LIMITS.limitationCount, LIMITS.shortText, errors);
  validateAuthenticity(report.authenticity, errors);
  if (mode === "summary") {
    validateSummaryOnlyReport(report, errors);
  }
  if (mode === "full") {
    validateFullReportProvenance(report, evidenceIds, errors);
    validateFullReportSemantics(report, evidenceIds, errors);
  }

  return { valid: errors.length === 0, errors };
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
    if (value.generator.reportSchemaVersion !== "verification-report.v1") {
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

  requireKeys(value, ["title"], "source", errors, ["url", "author", "baseBranch", "headBranch", "provenance", "originalTask"]);
  validateString(value.title, "source.title", LIMITS.sourceTitle, errors);
  validateOptionalString(value.url, "source.url", LIMITS.sourceUrl, errors);
  validateOptionalString(value.author, "source.author", LIMITS.sourceField, errors);
  validateOptionalString(value.baseBranch, "source.baseBranch", LIMITS.sourceField, errors);
  validateOptionalString(value.headBranch, "source.headBranch", LIMITS.sourceField, errors);
  validateOriginalTask(value.originalTask, errors);
  if (value.provenance === undefined) {
    if (requireSourceProvenance) errors.push("source.provenance is required for this report.");
    return;
  }
  validateSourceProvenance(value.provenance, errors, requireSourceProvenance);
}

function validateOriginalTask(value: unknown, errors: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) { errors.push("source.originalTask must be an object."); return; }
  requireKeys(value, ["version", "status", "sourceType", "reason"], "source.originalTask", errors, ["sourceRef"]);
  if (value.version !== 1) errors.push("source.originalTask.version must be 1.");
  if (value.status !== "available" && value.status !== "unavailable" && value.status !== "ambiguous") errors.push("source.originalTask.status is invalid.");
  if (value.sourceType !== "explicit_task" && value.sourceType !== "linked_issue" && value.sourceType !== "none") errors.push("source.originalTask.sourceType is invalid.");
  const reasons = new Set(["none", "not_linked", "multiple_linked_issues", "linked_issue_inaccessible", "linked_issue_outside_selected_repository", "linked_issue_deleted_or_empty", "linked_reference_is_pull_request"]);
  if (!reasons.has(String(value.reason))) errors.push("source.originalTask.reason is invalid.");
  validateOptionalString(value.sourceRef, "source.originalTask.sourceRef", 200, errors);
  if (value.status === "available" && value.reason !== "none") errors.push("source.originalTask available status requires reason none.");
  if (value.status === "available" && value.sourceType === "none") errors.push("source.originalTask available status requires an authoritative sourceType.");
  if (value.status !== "available" && value.reason === "none") errors.push("source.originalTask unavailable or ambiguous status requires a bounded reason.");
  if (value.status === "ambiguous" && (value.sourceType !== "none" || value.reason !== "multiple_linked_issues" || value.sourceRef !== undefined)) errors.push("source.originalTask ambiguous status must represent multiple linked issues without selecting a source.");
  if (value.sourceType === "linked_issue" && typeof value.sourceRef !== "string") errors.push("source.originalTask linked_issue requires sourceRef.");
  if (value.sourceType !== "linked_issue" && value.sourceRef !== undefined) errors.push("source.originalTask sourceRef is allowed only for linked_issue.");
  if (value.sourceType === "none" && value.status === "unavailable" && value.reason !== "not_linked") errors.push("source.originalTask unavailable none source must use not_linked.");
  if (value.sourceType === "linked_issue" && value.status === "unavailable" && !new Set(["linked_issue_inaccessible", "linked_issue_outside_selected_repository", "linked_issue_deleted_or_empty", "linked_reference_is_pull_request"]).has(String(value.reason))) errors.push("source.originalTask unavailable linked_issue reason is invalid.");
}

function validateSourceProvenance(value: unknown, errors: string[], requireFullHeadSha: boolean) {
  if (!isRecord(value)) { errors.push("source.provenance must be an object."); return; }
  requireKeys(value, ["version", "origin", "evidenceCapturedAt", "inputFingerprint"], "source.provenance", errors, ["headSha"]);
  if (value.version !== 1) errors.push("source.provenance.version must be 1.");
  const origin = value.origin;
  if (origin !== "github_snapshot" && origin !== "pasted_evidence" && origin !== "demo") errors.push("source.provenance.origin is invalid.");
  validateString(value.evidenceCapturedAt, "source.provenance.evidenceCapturedAt", LIMITS.createdAt, errors);
  if (typeof value.evidenceCapturedAt === "string" && Number.isNaN(Date.parse(value.evidenceCapturedAt))) errors.push("source.provenance.evidenceCapturedAt must be an ISO timestamp.");
  if (origin === "github_snapshot") {
    const headShaPattern = requireFullHeadSha ? /^[a-f0-9]{40,64}$/ : /^[a-f0-9]{6,64}$/;
    if (typeof value.headSha !== "string" || !headShaPattern.test(value.headSha)) errors.push(requireFullHeadSha ? "source.provenance.headSha must be a full lowercase Git commit SHA for github_snapshot." : "source.provenance.headSha must be a lowercase Git commit SHA for github_snapshot.");
  } else if (value.headSha !== undefined) errors.push("source.provenance.headSha is allowed only for github_snapshot.");
  if (!isRecord(value.inputFingerprint)) { errors.push("source.provenance.inputFingerprint must be an object."); return; }
  requireKeys(value.inputFingerprint, ["version", "algorithm", "value", "coverage"], "source.provenance.inputFingerprint", errors);
  if (value.inputFingerprint.version !== 1) errors.push("source.provenance.inputFingerprint.version must be 1.");
  if (value.inputFingerprint.algorithm !== "sha256") errors.push("source.provenance.inputFingerprint.algorithm must be sha256.");
  if (typeof value.inputFingerprint.value !== "string" || !/^[a-f0-9]{64}$/.test(value.inputFingerprint.value)) errors.push("source.provenance.inputFingerprint.value must be a lowercase SHA-256 digest.");
  const expectedCoverage = origin === "github_snapshot" ? "github_metadata" : origin === "pasted_evidence" ? "pasted_metadata" : "demo_fixture";
  if (value.inputFingerprint.coverage !== expectedCoverage) errors.push("source.provenance.inputFingerprint.coverage does not match source.provenance.origin.");
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

function validateRequirements(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  const requirements = validateArray(value, "requirements", LIMITS.requirementCount, errors);
  if (!requirements) return;

  for (const [index, item] of requirements.entries()) {
    const path = `requirements[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      continue;
    }

    requireKeys(item, ["requirementId", "requirementText", "status", "evidenceRefs", "gaps", "reviewerNote", "confidence"], path, errors);
    validateString(item.requirementId, `${path}.requirementId`, LIMITS.shortText, errors);
    validateString(item.requirementText, `${path}.requirementText`, LIMITS.requirementText, errors);
    validateEnum(item.status, `${path}.status`, REQUIREMENT_STATUSES, errors);
    validateEvidenceRefs(item.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    validateStringArray(item.gaps, `${path}.gaps`, LIMITS.requirementGaps, LIMITS.shortText, errors);
    validateString(item.reviewerNote, `${path}.reviewerNote`, LIMITS.shortText, errors);
    validateRange(item.confidence, `${path}.confidence`, 0, 1, errors);
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
        errors
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
      validateProofEvidenceClass(item.implementationEvidenceRefs, `${path}.implementationEvidenceRefs`, evidenceById, isImplementationProofEvidence, errors);
      validateProofEvidenceClass(item.targetedTestEvidenceRefs, `${path}.targetedTestEvidenceRefs`, evidenceById, isTargetedTestProofEvidence, errors);
      validateProofEvidenceClass(item.executionEvidenceRefs, `${path}.executionEvidenceRefs`, evidenceById, isExecutionProofEvidence, errors);
      validateStringArray(item.firstFiles, `${path}.firstFiles`, LIMITS.proofGraphFiles, LIMITS.sourceUrl, errors);
      validateProofGapSignals(item.gapSignals, `${path}.gapSignals`, evidenceIds, mode === "full", errors);
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

function validateProofGapSignals(value: unknown, path: string, evidenceIds: Set<string>, requireProvenance: boolean, errors: string[]) {
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
    const refs = validateEvidenceRefs(item.evidenceRefs, `${itemPath}.evidenceRefs`, evidenceIds, errors);
    if (requireProvenance && refs.length === 0) errors.push(`${itemPath}.evidenceRefs must contain deterministic provenance.`);
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
    isExecutionEvidenceItemSignal(label, evidenceStatusFromSummary(summary), locator, summary);
}

function evidenceStatusFromSummary(summary: string): string {
  return statusFromExecutionEvidenceSummary(summary);
}

function validateReprompt(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("reprompt must be an object.");
    return;
  }

  requireKeys(value, ["targetAgent", "prompt"], "reprompt", errors, ["evidenceRefs", "basedOnGapKind"]);
  validateEnum(value.targetAgent, "reprompt.targetAgent", TARGET_AGENTS, errors);
  validateString(value.prompt, "reprompt.prompt", LIMITS.reprompt, errors);
  if (value.evidenceRefs !== undefined) validateStringArray(value.evidenceRefs, "reprompt.evidenceRefs", LIMITS.evidenceRefs, LIMITS.shortText, errors);
  if (value.basedOnGapKind !== undefined && !PROOF_GAP_KINDS.has(String(value.basedOnGapKind))) errors.push("reprompt.basedOnGapKind is invalid.");
}

function validateDecisionCard(value: unknown, evidenceIds: Set<string>, report: RecordValue, errors: string[]) {
  if (value === undefined) return;
  if (!isRecord(value)) { errors.push("decisionCard must be an object."); return; }
  requireKeys(value, ["version", "topGap", "testBuildStatus", "firstInspectionPoints", "reprompt"], "decisionCard", errors);
  if (value.version !== 1) errors.push("decisionCard.version must be 1.");
  validateEnum(value.testBuildStatus, "decisionCard.testBuildStatus", CHECK_STATUSES, errors);
  if (isRecord(report.testing) && value.testBuildStatus !== report.testing.ciStatus) errors.push("decisionCard.testBuildStatus must match testing.ciStatus.");

  const topGap = value.topGap;
  let gapKey: string | null = null;
  let gapKind: string | null = null;
  let gapRefs: string[] = [];
  if (topGap !== null) {
    if (!isRecord(topGap)) errors.push("decisionCard.topGap must be null or an object.");
    else {
      requireKeys(topGap, ["gapKey", "requirementId", "kind", "severity", "summary", "evidenceRefs"], "decisionCard.topGap", errors);
      validateString(topGap.gapKey, "decisionCard.topGap.gapKey", LIMITS.shortText, errors);
      if (topGap.requirementId !== null) validateString(topGap.requirementId, "decisionCard.topGap.requirementId", LIMITS.shortText, errors);
      if (!PROOF_GAP_KINDS.has(String(topGap.kind))) errors.push("decisionCard.topGap.kind is invalid.");
      validateEnum(topGap.severity, "decisionCard.topGap.severity", PRIORITIES, errors);
      validateString(topGap.summary, "decisionCard.topGap.summary", LIMITS.shortText, errors);
      gapRefs = validateEvidenceRefs(topGap.evidenceRefs, "decisionCard.topGap.evidenceRefs", evidenceIds, errors);
      if (gapRefs.length === 0) errors.push("decisionCard.topGap.evidenceRefs must contain deterministic provenance.");
      gapKey = typeof topGap.gapKey === "string" ? topGap.gapKey : null;
      gapKind = typeof topGap.kind === "string" ? topGap.kind : null;
    }
  }

  const points = validateArray(value.firstInspectionPoints, "decisionCard.firstInspectionPoints", 2, errors) ?? [];
  for (const [index, point] of points.entries()) {
    const path = `decisionCard.firstInspectionPoints[${index}]`;
    if (!isRecord(point)) { errors.push(`${path} must be an object.`); continue; }
    requireKeys(point, ["kind", "label", "href", "evidenceRefs"], path, errors);
    if (point.kind !== "file" && point.kind !== "check") errors.push(`${path}.kind is invalid.`);
    validateString(point.label, `${path}.label`, LIMITS.evidenceLabel, errors);
    validateString(point.href, `${path}.href`, LIMITS.sourceUrl, errors);
    if (typeof point.href === "string" && !/^https:\/\/github\.com\//i.test(point.href)) errors.push(`${path}.href must be a GitHub HTTPS deep link.`);
    const refs = validateEvidenceRefs(point.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
    if (refs.length === 0) errors.push(`${path}.evidenceRefs must contain deterministic provenance.`);
  }

  if (value.reprompt !== null) {
    if (!isRecord(value.reprompt)) errors.push("decisionCard.reprompt must be null or an object.");
    else {
      requireKeys(value.reprompt, ["prompt", "gapKey", "basedOnGapKind", "evidenceRefs"], "decisionCard.reprompt", errors);
      validateString(value.reprompt.prompt, "decisionCard.reprompt.prompt", LIMITS.reprompt, errors);
      const refs = validateEvidenceRefs(value.reprompt.evidenceRefs, "decisionCard.reprompt.evidenceRefs", evidenceIds, errors);
      if (!gapKey || value.reprompt.gapKey !== gapKey || value.reprompt.basedOnGapKind !== gapKind || JSON.stringify(refs) !== JSON.stringify(gapRefs)) errors.push("decisionCard.reprompt must be bound exactly to decisionCard.topGap.");
    }
  } else if (topGap !== null) errors.push("decisionCard.reprompt is required when topGap exists.");

  const gapCount = isRecord(report.proofGraph) && isRecord(report.proofGraph.summary)
    ? report.proofGraph.summary.gapCount
    : null;
  if (gapCount === 0 && (topGap !== null || value.reprompt !== null)) {
    errors.push("decisionCard must use the explicit zero-gap state when proofGraph.summary.gapCount is 0.");
  }
  if (typeof gapCount === "number" && gapCount > 0 && topGap === null) {
    errors.push("decisionCard.topGap is required when deterministic proof gaps exist.");
  }
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

function validateEvidenceRefs(value: unknown, path: string, evidenceIds: Set<string>, errors: string[]): string[] {
  const refs = validateStringArray(value, path, LIMITS.evidenceRefs, LIMITS.shortText, errors);
  if (!refs) return [];

  for (const ref of refs) {
    if (!evidenceIds.has(ref)) {
      errors.push(`${path} cites missing evidence ${ref}.`);
    }
  }
  return refs;
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
  const originalTask = isRecord(report.source) && isRecord(report.source.originalTask) ? report.source.originalTask : null;
  if (originalTask && originalTask.status !== "available" && Array.isArray(report.requirements)) {
    report.requirements.forEach((requirement, index) => {
      if (isRecord(requirement) && requirement.status === "met") errors.push(`requirements[${index}] cannot be met when the authoritative original task is unavailable or ambiguous.`);
    });
  }

  if (Array.isArray(report.evidenceIndex)) {
    for (const item of report.evidenceIndex) {
      if (isRecord(item) && typeof item.id === "string") {
        evidenceById.set(item.id, item);
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

    if (item.status === "met" && Array.isArray(item.gaps) && item.gaps.length > 0) {
      errors.push(`requirements[${index}] cannot be met while evidence gaps are present.`);
    }

    if (item.status !== "met") {
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
    isExecutionEvidenceItemSignal(label, evidenceStatusFromSummary(summary), locator, summary) &&
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
