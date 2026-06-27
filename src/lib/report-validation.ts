import type { VerificationReport } from "./types";
import { hasPassingEvidenceStatusPrefix, isExecutionSignalText } from "./evidence-status";

const PRIORITIES = new Set(["low", "medium", "high", "blocker"]);
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);
const EVIDENCE_KINDS = new Set(["task", "pr_description", "diff", "changed_file", "check", "log", "test", "inference"]);
const TARGET_AGENTS = new Set(["codex", "claude_code", "cursor", "copilot"]);

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
  reprompt: 6000,
  evidenceIndex: 200,
  evidenceLabel: 600,
  evidenceLocator: 1000,
  evidenceSummary: 3000,
  evidenceRefs: 50,
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
      "reprompt",
      "evidenceIndex",
      "limitations"
    ],
    "report",
    errors
  );

  validateString(report.analysisId, "analysisId", LIMITS.analysisId, errors);
  validateString(report.createdAt, "createdAt", LIMITS.createdAt, errors);

  const evidenceIds = validateEvidenceIndex(report.evidenceIndex, errors);
  validateSource(report.source, errors);
  validateSummary(report.summary, errors);
  validateRequirements(report.requirements, evidenceIds, errors);
  validateClaims(report.claims, evidenceIds, errors);
  validateScope(report.scope, evidenceIds, errors);
  validateTesting(report.testing, evidenceIds, errors);
  validateReviewPriority(report.reviewPriority, evidenceIds, errors);
  validateReprompt(report.reprompt, errors);
  validateStringArray(report.limitations, "limitations", LIMITS.limitationCount, LIMITS.shortText, errors);
  if (mode === "summary") {
    validateSummaryOnlyReport(report, errors);
  }
  if (mode === "full") {
    validateFullReportProvenance(report, evidenceIds, errors);
    validateFullReportSemantics(report, evidenceIds, errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateSource(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("source must be an object.");
    return;
  }

  requireKeys(value, ["title"], "source", errors, ["url", "author", "baseBranch", "headBranch"]);
  validateString(value.title, "source.title", LIMITS.sourceTitle, errors);
  validateOptionalString(value.url, "source.url", LIMITS.sourceUrl, errors);
  validateOptionalString(value.author, "source.author", LIMITS.sourceField, errors);
  validateOptionalString(value.baseBranch, "source.baseBranch", LIMITS.sourceField, errors);
  validateOptionalString(value.headBranch, "source.headBranch", LIMITS.sourceField, errors);
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

  requireKeys(value, ["suspected", "outOfScopeFiles", "reasons"], "scope", errors, ["evidenceRefs"]);
  validateBoolean(value.suspected, "scope.suspected", errors);
  validateStringArray(value.outOfScopeFiles, "scope.outOfScopeFiles", LIMITS.scopeFiles, LIMITS.sourceUrl, errors);
  validateStringArray(value.reasons, "scope.reasons", LIMITS.scopeFiles, LIMITS.shortText, errors);
  if (value.evidenceRefs !== undefined) {
    validateEvidenceRefs(value.evidenceRefs, "scope.evidenceRefs", evidenceIds, errors);
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

    requireKeys(item, ["path", "why", "evidenceRefs"], path, errors);
    validateString(item.path, `${path}.path`, LIMITS.sourceUrl, errors);
    validateString(item.why, `${path}.why`, LIMITS.shortText, errors);
    validateEvidenceRefs(item.evidenceRefs, `${path}.evidenceRefs`, evidenceIds, errors);
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
}

function validateFullReportSemantics(report: RecordValue, evidenceIds: Set<string>, errors: string[]) {
  if (evidenceIds.size === 0) return;

  const summary = isRecord(report.summary) ? report.summary : null;
  const testing = isRecord(report.testing) ? report.testing : null;
  const scope = isRecord(report.scope) ? report.scope : null;
  const evidenceById = new Map<string, RecordValue>();

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
  const text = `${typeof item.label === "string" ? item.label : ""} ${typeof item.summary === "string" ? item.summary : ""}`;
  const summary = typeof item.summary === "string" ? item.summary : "";

  return (kind === "check" || kind === "log") &&
    isExecutionSignalText(text) &&
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
  if (value === undefined) return;
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
