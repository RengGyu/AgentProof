import { verifyVerifiedAuthenticity } from "./report-authenticity";
import { validateVerificationReport, type ReportValidationResult } from "./report-validation";
import type { VerificationReport } from "./types";

const TENANT_REPORT_MAX_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.:@#-]{1,160}$/;
const SAFE_LOCATOR_PATTERN = /^[A-Za-z0-9_./:@#-]{1,240}$/;

const FIXED = {
  sourceTitle: "GitHub pull request evidence report",
  summary: "Grounded verification result; review structured evidence.",
  topRisk: "Verification evidence requires reviewer attention.",
  requirementGap: "Evidence gap recorded.",
  reviewerNote: "Review the linked evidence and safe locations.",
  scopeReason: "Scope evidence requires reviewer confirmation.",
  missingTestReason: "Targeted test evidence is missing.",
  priorityReason: "Review priority based on grounded evidence.",
  evidenceSummary: "Bounded evidence metadata.",
  reprompt: "Address missing or unclear verification evidence, then rerun the relevant checks.",
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
  if (report.reprompt.prompt !== FIXED.reprompt) errors.push("reprompt.prompt is outside the tenant report contract.");
  if (report.limitations.some((value) => value !== FIXED.limitation)) errors.push("limitations contains non-contract text.");

  if (!isSafeTenantIdentifier(report.analysisId)) errors.push("analysisId is not a safe identifier.");
  for (const requirement of report.requirements) {
    if (!isSafeTenantIdentifier(requirement.requirementId)) errors.push(`requirement id is unsafe: ${requirement.requirementId}`);
    if (requirement.requirementText !== `Requirement ${requirement.requirementId}`) errors.push(`requirement ${requirement.requirementId} contains non-contract text.`);
    if (requirement.gaps.some((value) => value !== FIXED.requirementGap)) errors.push(`requirement ${requirement.requirementId} contains non-contract gap text.`);
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
    if (node.requirementText !== `Requirement ${node.requirementId}`) errors.push(`proofGraph node ${node.requirementId} contains non-contract text.`);
    if (node.sourceSection !== null || node.contextRoles.length !== 0) errors.push(`proofGraph node ${node.requirementId} retains source context.`);
    node.firstFiles.forEach((value) => validateLocator(value, "proofGraph.firstFiles", errors));
    if (node.gapSignals.some((gap) => gap.message !== FIXED.requirementGap)) errors.push(`proofGraph node ${node.requirementId} contains non-contract gap text.`);
  }
  for (const evidence of report.evidenceIndex) {
    if (!isSafeTenantIdentifier(evidence.id)) errors.push(`evidence id is unsafe: ${evidence.id}`);
    if (evidence.label !== `Evidence ${evidence.id}`) errors.push(`evidence ${evidence.id} contains non-contract label text.`);
    if (evidence.summary !== FIXED.evidenceSummary) errors.push(`evidence ${evidence.id} contains non-contract summary text.`);
    if (evidence.locator !== undefined) validateLocator(evidence.locator, `evidence ${evidence.id} locator`, errors);
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function isSafeTenantLocator(value: string): boolean {
  if (!SAFE_LOCATOR_PATTERN.test(value) || value.startsWith("/") || value.includes("://") || value.includes("\\")) return false;
  return !value.split("/").some((segment) => segment === "..");
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
