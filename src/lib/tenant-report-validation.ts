import { createHash, createHmac, timingSafeEqual } from "crypto";
import { containsSecretPattern } from "./redact";
import { verifyVerifiedAuthenticity } from "./report-authenticity";
import { validateVerificationReport, type ReportValidationResult } from "./report-validation";
import { validateLlmSemanticCandidate, type LlmSemanticOutput } from "./llm-semantic-output";
import {
  ALLOWED_TENANT_GAP_TEXTS,
  ALLOWED_TENANT_REMEDIATION_TEXTS,
  tenantReportAnalysisContext,
  type TenantReportAnalysisContext
} from "./tenant-report-language";
import type { CheckStatus, EvidenceKind, PriorityLevel, RequirementProofAxis, RequirementStatus, VerificationReport } from "./types";

const TENANT_REPORT_MAX_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:@#-]{1,160}$/;
const SAFE_LOCATOR_PATTERN = /^[A-Za-z0-9_./:@#-]{1,240}$/;
const SAFE_EVIDENCE_REFERENCE_PATTERN = /^[A-Za-z0-9_.:@#-]{1,160}$/;
const MAX_TENANT_REQUIREMENTS = 40;
const MAX_TENANT_EVIDENCE = 200;
const MAX_TENANT_PRIORITY_FILES = 100;
const MAX_TENANT_EVIDENCE_REFS = 50;
const MAX_TENANT_GAPS = 20;
const MAX_TENANT_OBJECTIVE_LABEL = 160;

export interface TenantPersistedReport {
  version: 1;
  analysisContext?: TenantReportAnalysisContext;
  priority: PriorityLevel;
  requirements: Array<{ requirementId: string; objectiveLabel?: string; status: RequirementStatus; evidenceRefs: string[]; gaps: string[]; proofAxes?: RequirementProofAxis[] }>;
  testing: { ciStatus: CheckStatus; lintStatus: CheckStatus; typecheckStatus: CheckStatus };
  reviewPriority: Array<{ path: string; priority: PriorityLevel; evidenceRefs: string[] }>;
  evidenceIndex: Array<{ id: string; kind?: EvidenceKind; locator?: string }>;
  reprompt: { prompt: string };
  semantic?: LlmSemanticOutput;
  semanticAnalysis?: { status: "included" | "unavailable"; attempts: 1 | 2 };
  integrity: { version: 1; algorithm: "hmac-sha256"; canonicalDigest: string; signature: string };
}

const FIXED = {
  sourceTitle: "GitHub pull request evidence report",
  summary: "Grounded verification result; review structured evidence.",
  topRisk: "Verification evidence requires reviewer attention.",
  reviewerNote: "Review the linked evidence and safe locations.",
  scopeReason: "Scope evidence requires reviewer confirmation.",
  missingTestReason: "Targeted test evidence is missing.",
  priorityReason: "Review priority based on grounded evidence.",
  evidenceSummary: "Bounded evidence metadata.",
  limitation: "Some evidence was unavailable or intentionally omitted for privacy."
} as const;

/**
 * Exact persisted contract for signed tenant reports. Generic report
 * validation supplies object-key, enum, length and evidence-reference checks;
 * these checks constrain every remaining string to a generated label, a safe
 * identifier/location, fixed privacy-safe copy, or provenance hashes.
 */
export function validateTenantStoredReport(
  report: unknown,
  signingSecret: string
): ReportValidationResult {
  const errors: string[] = [];
  const structural = validateVerificationReport(report, { mode: "tenant" });
  errors.push(...structural.errors);

  if (!isReport(report)) return { valid: false, errors };
  if (Buffer.byteLength(JSON.stringify(report), "utf8") > TENANT_REPORT_MAX_BYTES) {
    errors.push(`report exceeds ${TENANT_REPORT_MAX_BYTES} bytes.`);
  }
  if (report.authenticity?.trust !== "verified_agentproof") {
    errors.push("authenticity.trust must be verified_agentproof for tenant reports.");
  } else if (!verifyVerifiedAuthenticity(report, signingSecret)) {
    errors.push("authenticity signature is invalid.");
  }

  if (report.source.title !== FIXED.sourceTitle) {
    errors.push("source.title is outside the tenant report contract.");
  }
  if (report.source.url !== undefined || report.source.author !== undefined || report.source.baseBranch !== undefined || report.source.headBranch !== undefined) {
    errors.push("source may contain only title and provenance.");
  }
  if (report.summary.oneLine !== FIXED.summary) errors.push("summary.oneLine is outside the tenant report contract.");
  if (report.summary.topRisks.some((value) => value !== FIXED.topRisk)) errors.push("summary.topRisks contains non-contract text.");
  if (report.claims.length !== 0) errors.push("claims must be empty in tenant reports.");
  if (report.proofGraph.context.length !== 0) errors.push("proofGraph.context must be empty in tenant reports.");
  if (!ALLOWED_TENANT_REMEDIATION_TEXTS.has(report.reprompt.prompt)) errors.push("reprompt.prompt is outside the tenant report contract.");
  if (report.limitations.some((value) => value !== FIXED.limitation)) errors.push("limitations contains non-contract text.");

  if (!isSafeTenantIdentifier(report.analysisId)) errors.push("analysisId is not a safe identifier.");
  for (const requirement of report.requirements) {
    if (!isSafeTenantIdentifier(requirement.requirementId)) errors.push(`requirement id is unsafe: ${requirement.requirementId}`);
    if (requirement.requirementText !== `Requirement ${requirement.requirementId}` && tenantObjectiveLabel(requirement.requirementText) !== requirement.requirementText) {
      errors.push(`requirement ${requirement.requirementId} contains non-contract text.`);
    }
    if (requirement.gaps.some((value) => !ALLOWED_TENANT_GAP_TEXTS.has(value))) errors.push(`requirement ${requirement.requirementId} contains non-contract gap text.`);
    if (requirement.reviewerNote !== FIXED.reviewerNote) errors.push(`requirement ${requirement.requirementId} contains non-contract reviewer text.`);
  }
  if (report.scope.reasons.some((value) => value !== FIXED.scopeReason)) errors.push("scope.reasons contains non-contract text.");
  report.scope.outOfScopeFiles.forEach((value) => validateLocator(value, "scope.outOfScopeFiles", errors));
  for (const item of report.testing.missingTests) {
    validateLocator(item.path, "testing.missingTests.path", errors);
    if (item.why !== FIXED.missingTestReason) errors.push("testing.missingTests.why contains non-contract text.");
  }
  for (const item of report.reviewPriority) {
    validateLocator(item.path, "reviewPriority.path", errors);
    if (item.reason !== FIXED.priorityReason) errors.push("reviewPriority.reason contains non-contract text.");
  }
  for (const node of report.proofGraph.nodes) {
    const requirementText = report.requirements.find((requirement) => requirement.requirementId === node.requirementId)?.requirementText;
    if (node.requirementText !== requirementText) errors.push(`proofGraph node ${node.requirementId} does not match its requirement label.`);
    if (node.sourceSection !== null || node.contextRoles.length !== 0) errors.push(`proofGraph node ${node.requirementId} retains source context.`);
    node.firstFiles.forEach((value) => validateLocator(value, "proofGraph.firstFiles", errors));
    if (node.gapSignals.some((gap) => !ALLOWED_TENANT_GAP_TEXTS.has(gap.message))) errors.push(`proofGraph node ${node.requirementId} contains non-contract gap text.`);
  }
  for (const evidence of report.evidenceIndex) {
    if (!isSafeTenantIdentifier(evidence.id)) errors.push(`evidence id is unsafe: ${evidence.id}`);
    if (evidence.label !== `Evidence ${evidence.id}`) errors.push(`evidence ${evidence.id} contains non-contract label text.`);
    if (evidence.summary !== FIXED.evidenceSummary) errors.push(`evidence ${evidence.id} contains non-contract summary text.`);
    if (evidence.locator !== undefined) validateLocator(evidence.locator, `evidence ${evidence.id} locator`, errors);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

/** The only report object written to tenant Supabase rows. */
export function projectTenantPersistedReport(report: VerificationReport, signingSecret: string): TenantPersistedReport {
  const unsigned = {
    version: 1 as const,
    analysisContext: tenantReportAnalysisContext(report),
    priority: report.summary.priority,
    requirements: report.requirements.map(({ requirementId, requirementText, status, evidenceRefs, gaps, proofAxes }) => {
      const objectiveLabel = tenantObjectiveLabel(requirementText);
      return {
        requirementId,
        ...(objectiveLabel ? { objectiveLabel } : {}),
        status,
        evidenceRefs: [...evidenceRefs],
        gaps: [...gaps],
        ...(proofAxes ? { proofAxes: copyProofAxes(proofAxes) } : {})
      };
    }),
    testing: {
      ciStatus: report.testing.ciStatus,
      lintStatus: report.testing.lintStatus,
      typecheckStatus: report.testing.typecheckStatus
    },
    reviewPriority: report.reviewPriority.map(({ path, priority, evidenceRefs }) => ({ path, priority, evidenceRefs: [...(evidenceRefs ?? [])] })),
    evidenceIndex: report.evidenceIndex.map(({ id, kind, locator }) => locator ? { id, kind, locator } : { id, kind }),
    reprompt: { prompt: report.reprompt.prompt },
    ...(report.semantic ? { semantic: report.semantic } : {}),
    ...(report.semanticAnalysis ? { semanticAnalysis: report.semanticAnalysis } : {})
  };
  const payload = stableJson(unsigned);
  return {
    ...unsigned,
    integrity: {
      version: 1,
      algorithm: "hmac-sha256",
      canonicalDigest: sha256(payload),
      signature: createHmac("sha256", signingSecret).update(payload).digest("hex")
    }
  };
}

export function validateTenantPersistedReport(value: unknown, signingSecret: string): ReportValidationResult {
  const errors: string[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, errors: ["Tenant persisted report must be an object."] };
  const report = value as Partial<TenantPersistedReport> & Record<string, unknown>;
  const allowed = new Set(["version", "analysisContext", "priority", "requirements", "testing", "reviewPriority", "evidenceIndex", "reprompt", "semantic", "semanticAnalysis", "integrity"]);
  for (const key of Object.keys(report)) if (!allowed.has(key)) errors.push(`tenant persisted report contains disallowed field: ${key}.`);
  if (report.version !== 1) errors.push("tenant persisted report version must be 1.");
  if (report.analysisContext !== undefined && !isAnalysisContext(report.analysisContext)) errors.push("tenant persisted report analysis context is invalid.");
  if (!isPriority(report.priority)) errors.push("tenant persisted report priority is invalid.");
  if (!Array.isArray(report.requirements) || report.requirements.length > MAX_TENANT_REQUIREMENTS) errors.push("tenant persisted report requirements are invalid.");
  if (!Array.isArray(report.evidenceIndex) || report.evidenceIndex.length > MAX_TENANT_EVIDENCE) errors.push("tenant persisted report evidence index is invalid.");
  if (!Array.isArray(report.reviewPriority) || report.reviewPriority.length > MAX_TENANT_PRIORITY_FILES) errors.push("tenant persisted report review priority is invalid.");
  const evidenceIds = new Set<string>();
  for (const evidence of report.evidenceIndex ?? []) {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) { errors.push("tenant persisted evidence is invalid."); continue; }
    const item = evidence as { id?: unknown; kind?: unknown; locator?: unknown } & Record<string, unknown>;
    if (Object.keys(item).some((key) => !["id", "kind", "locator"].includes(key))) errors.push("tenant persisted evidence has disallowed fields.");
    if (typeof item.id !== "string" || !SAFE_EVIDENCE_REFERENCE_PATTERN.test(item.id) || evidenceIds.has(item.id)) errors.push("tenant persisted evidence id is invalid.");
    else evidenceIds.add(item.id);
    if (item.kind !== undefined && !isEvidenceKind(item.kind)) errors.push("tenant persisted evidence kind is invalid.");
    if (item.locator !== undefined && (typeof item.locator !== "string" || !isSafeTenantLocator(item.locator))) errors.push("tenant persisted evidence locator is invalid.");
  }
  for (const requirement of report.requirements ?? []) {
    if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) { errors.push("tenant persisted requirement is invalid."); continue; }
    const item = requirement as { requirementId?: unknown; objectiveLabel?: unknown; status?: unknown; evidenceRefs?: unknown; gaps?: unknown; proofAxes?: unknown } & Record<string, unknown>;
    if (Object.keys(item).some((key) => !["requirementId", "objectiveLabel", "status", "evidenceRefs", "gaps", "proofAxes"].includes(key))) errors.push("tenant persisted requirement has disallowed fields.");
    if (typeof item.requirementId !== "string" || !SAFE_EVIDENCE_REFERENCE_PATTERN.test(item.requirementId)) errors.push("tenant persisted requirement id is invalid.");
    if (item.objectiveLabel !== undefined && (typeof item.objectiveLabel !== "string" || tenantObjectiveLabel(item.objectiveLabel) !== item.objectiveLabel)) errors.push("tenant persisted objective label is invalid.");
    if (!isRequirementStatus(item.status)) errors.push("tenant persisted requirement status is invalid.");
    validateEvidenceRefs(item.evidenceRefs, evidenceIds, errors);
    if (item.proofAxes !== undefined) validatePersistedProofAxes(item.proofAxes, evidenceIds, errors);
    if (!Array.isArray(item.gaps) || item.gaps.length > MAX_TENANT_GAPS || item.gaps.some((gap) => typeof gap !== "string" || !ALLOWED_TENANT_GAP_TEXTS.has(gap))) errors.push("tenant persisted requirement gaps are invalid.");
  }
  const testing = report.testing as Record<string, unknown> | undefined;
  if (!testing || !isCheckStatus(testing.ciStatus) || !isCheckStatus(testing.lintStatus) || !isCheckStatus(testing.typecheckStatus) || Object.keys(testing).some((key) => !["ciStatus", "lintStatus", "typecheckStatus"].includes(key))) errors.push("tenant persisted check status is invalid.");
  for (const priority of report.reviewPriority ?? []) {
    if (!priority || typeof priority !== "object" || Array.isArray(priority)) { errors.push("tenant persisted priority file is invalid."); continue; }
    const item = priority as { path?: unknown; priority?: unknown; evidenceRefs?: unknown } & Record<string, unknown>;
    if (Object.keys(item).some((key) => !["path", "priority", "evidenceRefs"].includes(key))) errors.push("tenant persisted priority file has disallowed fields.");
    if (typeof item.path !== "string" || !isSafeTenantLocator(item.path) || !isPriority(item.priority)) errors.push("tenant persisted priority file is invalid.");
    validateEvidenceRefs(item.evidenceRefs, evidenceIds, errors);
  }
  const reprompt = report.reprompt as Record<string, unknown> | undefined;
  if (!reprompt || typeof reprompt.prompt !== "string" || !ALLOWED_TENANT_REMEDIATION_TEXTS.has(reprompt.prompt) || Object.keys(reprompt).some((key) => key !== "prompt")) errors.push("tenant persisted repair prompt is invalid.");
  if (report.semantic !== undefined) {
    const semanticEvidence = (report.evidenceIndex ?? []).flatMap((evidence) => {
      if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [];
      const item = evidence as { id?: unknown; kind?: unknown };
      return typeof item.id === "string" && isEvidenceKind(item.kind) ? [{ id: item.id, kind: item.kind }] : [];
    });
    const semanticValidation = validateLlmSemanticCandidate(report.semantic, {
      requirementIds: (report.requirements ?? []).flatMap((requirement) => {
        if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) return [];
        const item = requirement as { requirementId?: unknown };
        return typeof item.requirementId === "string" ? [item.requirementId] : [];
      }),
      evidence: semanticEvidence
    });
    if (semanticValidation.disposition !== "accepted") errors.push("tenant persisted semantic analysis is invalid.");
  }
  validateSemanticRuntimeState(report.semanticAnalysis, report.semantic, errors);
  const integrity = report.integrity as Record<string, unknown> | undefined;
  const unsigned = { version: report.version, ...(report.analysisContext !== undefined ? { analysisContext: report.analysisContext } : {}), priority: report.priority, requirements: report.requirements, testing: report.testing, reviewPriority: report.reviewPriority, evidenceIndex: report.evidenceIndex, reprompt: report.reprompt, ...(report.semantic !== undefined ? { semantic: report.semantic } : {}), ...(report.semanticAnalysis !== undefined ? { semanticAnalysis: report.semanticAnalysis } : {}) };
  const payload = stableJson(unsigned);
  if (!integrity || Object.keys(integrity).some((key) => !["version", "algorithm", "canonicalDigest", "signature"].includes(key)) || integrity.version !== 1 || integrity.algorithm !== "hmac-sha256" || !sameDigest(integrity.canonicalDigest, sha256(payload)) || !sameDigest(integrity.signature, createHmac("sha256", signingSecret).update(payload).digest("hex"))) errors.push("tenant persisted report signature is invalid.");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > TENANT_REPORT_MAX_BYTES) errors.push(`report exceeds ${TENANT_REPORT_MAX_BYTES} bytes.`);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function validateSemanticRuntimeState(value: unknown, semantic: unknown, errors: string[]) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("tenant persisted semantic runtime state is invalid.");
    return;
  }
  const state = value as { status?: unknown; attempts?: unknown } & Record<string, unknown>;
  if (Object.keys(state).some((key) => key !== "status" && key !== "attempts")) errors.push("tenant persisted semantic runtime state has disallowed fields.");
  if (state.status !== "included" && state.status !== "unavailable") errors.push("tenant persisted semantic runtime status is invalid.");
  if (state.attempts !== 1 && state.attempts !== 2) errors.push("tenant persisted semantic runtime attempts is invalid.");
  if (state.status === "included" && semantic === undefined) errors.push("tenant persisted included semantic runtime state requires semantic analysis.");
  if (state.status === "unavailable" && semantic !== undefined) errors.push("tenant persisted unavailable semantic runtime state must not include semantic analysis.");
}

export function isTenantPersistedReport(value: unknown, signingSecret: string): value is TenantPersistedReport {
  return validateTenantPersistedReport(value, signingSecret).valid;
}

export function isSafeTenantLocator(value: string): boolean {
  if (!SAFE_LOCATOR_PATTERN.test(value) || value.startsWith("/") || value.includes("://") || value.includes("\\")) return false;
  return !value.split("/").some((segment) => segment === "..");
}

export function tenantObjectiveLabel(value: string): string | undefined {
  if (!value || value.length > MAX_TENANT_OBJECTIVE_LABEL || /[\r\n\u0000-\u001f\u007f]/.test(value)) return undefined;
  const normalized = value.trim().replace(/[\t ]+/g, " ");
  if (!normalized || normalized.length > MAX_TENANT_OBJECTIVE_LABEL || normalized !== value.trim()) return undefined;
  if (/^Requirement\s+[A-Za-z0-9_.:@#-]+$/i.test(normalized)) return undefined;
  if (containsSecretPattern(normalized) || normalized.includes("[redacted]")) return undefined;
  if (/```|https?:\/\/|www\.|\b(?:Issue|PR)\s+body\s*:|\b(?:raw|full|complete)\s+(?:source|patch|diff|logs?|output|artifacts?)\b/i.test(normalized)) return undefined;
  if (/(?:^|\s)(?:src|app|lib|test|tests|docs|\.github)\/[A-Za-z0-9_.@/-]+/i.test(normalized)) return undefined;
  if (/\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior)\b|\b(?:system|developer)\s+prompt\b/i.test(normalized)) return undefined;
  return normalized;
}

function isSafeTenantIdentifier(value: string): boolean {
  return SAFE_ID_PATTERN.test(value);
}

function validateLocator(value: string, path: string, errors: string[]) {
  if (!isSafeTenantLocator(value)) errors.push(`${path} is not a safe location.`);
}

function isReport(value: unknown): value is VerificationReport {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateEvidenceRefs(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  if (!Array.isArray(value) || value.length > MAX_TENANT_EVIDENCE_REFS || value.some((reference) => typeof reference !== "string" || !SAFE_EVIDENCE_REFERENCE_PATTERN.test(reference) || !evidenceIds.has(reference))) errors.push("tenant persisted evidence references are invalid.");
}

function validatePersistedProofAxes(value: unknown, evidenceIds: Set<string>, errors: string[]) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 12) {
    errors.push("tenant persisted proof axes are invalid.");
    return;
  }
  const seen = new Set<string>();
  for (const axis of value) {
    if (!axis || typeof axis !== "object" || Array.isArray(axis)) {
      errors.push("tenant persisted proof axis is invalid.");
      continue;
    }
    const item = axis as Record<string, unknown>;
    if (Object.keys(item).some((key) => !["subject", "polarity", "state", "evidenceRefs", "collectionBasis"].includes(key))) errors.push("tenant persisted proof axis has disallowed fields.");
    if (!["implementation", "documentation", "ci_configuration", "targeted_test", "execution", "visual"].includes(String(item.subject))) errors.push("tenant persisted proof axis subject is invalid.");
    if (item.polarity !== "present" && item.polarity !== "absent") errors.push("tenant persisted proof axis polarity is invalid.");
    if (item.state !== "satisfied" && item.state !== "violated" && item.state !== "incomplete") errors.push("tenant persisted proof axis state is invalid.");
    if ("collectionBasis" in item && !["complete_changed_file_inventory", "incomplete_changed_file_inventory", "matching_artifact_evidence", "passing_execution", "failed_execution", "visual_verification"].includes(String(item.collectionBasis))) errors.push("tenant persisted proof axis collection basis is invalid.");
    validateEvidenceRefs(item.evidenceRefs, evidenceIds, errors);
    const key = `${String(item.subject)}:${String(item.polarity)}`;
    if (seen.has(key)) errors.push("tenant persisted proof axis is duplicated.");
    seen.add(key);
  }
}

function copyProofAxes(axes: RequirementProofAxis[]): RequirementProofAxis[] {
  return axes.map((axis) => ({
    subject: axis.subject,
    polarity: axis.polarity,
    state: axis.state,
    evidenceRefs: [...axis.evidenceRefs],
    ...(axis.collectionBasis ? { collectionBasis: axis.collectionBasis } : {})
  }));
}

function isPriority(value: unknown): value is PriorityLevel { return value === "low" || value === "medium" || value === "high" || value === "blocker"; }
function isRequirementStatus(value: unknown): value is RequirementStatus { return value === "met" || value === "partial" || value === "missing" || value === "unclear"; }
function isCheckStatus(value: unknown): value is CheckStatus { return value === "passed" || value === "failed" || value === "pending" || value === "unknown"; }
function isAnalysisContext(value: unknown): value is TenantReportAnalysisContext { return value === "linked_issue" || value === "unlinked_pr" || value === "provided_requirement"; }
function isEvidenceKind(value: unknown): value is EvidenceKind { return value === "task" || value === "pr_description" || value === "diff" || value === "changed_file" || value === "check" || value === "log" || value === "test" || value === "inference"; }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function sameDigest(value: unknown, expected: string): boolean { if (typeof value !== "string") return false; const left = Buffer.from(value, "utf8"); const right = Buffer.from(expected, "utf8"); return left.length === right.length && timingSafeEqual(left, right); }
