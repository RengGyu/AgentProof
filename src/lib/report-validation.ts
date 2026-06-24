import type { VerificationReport } from "./types";

const PRIORITIES = new Set(["low", "medium", "high", "blocker"]);
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);

export interface ReportValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateVerificationReport(report: unknown): ReportValidationResult {
  const errors: string[] = [];
  const candidate = report as Partial<VerificationReport> | null;

  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["Report must be an object."] };
  }

  const evidenceIndex = Array.isArray(candidate.evidenceIndex) ? candidate.evidenceIndex : [];
  const requirements = Array.isArray(candidate.requirements) ? candidate.requirements : [];
  const claims = Array.isArray(candidate.claims) ? candidate.claims : [];
  const missingTests = Array.isArray(candidate.testing?.missingTests) ? candidate.testing.missingTests : [];
  const evidenceIds = new Set(evidenceIndex.map((item) => item.id).filter((id): id is string => typeof id === "string"));

  if (!Array.isArray(candidate.evidenceIndex)) errors.push("evidenceIndex must be an array.");
  if (!Array.isArray(candidate.requirements)) errors.push("requirements must be an array.");
  if (!Array.isArray(candidate.claims)) errors.push("claims must be an array.");
  if (!Array.isArray(candidate.testing?.missingTests)) errors.push("testing.missingTests must be an array.");

  if (!candidate.analysisId) errors.push("analysisId is required.");
  if (!candidate.createdAt) errors.push("createdAt is required.");
  if (!candidate.source?.title) errors.push("source.title is required.");
  if (typeof candidate.summary?.priority !== "string" || !PRIORITIES.has(candidate.summary.priority)) {
    errors.push("summary.priority is invalid.");
  }
  if (!isInRange(candidate.summary?.confidence, 0, 1)) errors.push("summary.confidence must be between 0 and 1.");
  if (!isInRange(candidate.summary?.evidenceCoverage, 0, 100)) errors.push("summary.evidenceCoverage must be between 0 and 100.");

  for (const requirement of requirements) {
    if (typeof requirement.status !== "string" || !REQUIREMENT_STATUSES.has(requirement.status)) {
      errors.push(`${requirement.requirementId} has an invalid status.`);
    }
    if (!isInRange(requirement.confidence, 0, 1)) {
      errors.push(`${requirement.requirementId} confidence must be between 0 and 1.`);
    }
    for (const ref of Array.isArray(requirement.evidenceRefs) ? requirement.evidenceRefs : []) {
      if (!evidenceIds.has(ref)) errors.push(`${requirement.requirementId} cites missing evidence ${ref}.`);
    }
  }

  for (const claim of claims) {
    for (const ref of Array.isArray(claim.evidenceRefs) ? claim.evidenceRefs : []) {
      if (!evidenceIds.has(ref)) errors.push(`${claim.id} cites missing evidence ${ref}.`);
    }
  }

  for (const missing of missingTests) {
    for (const ref of Array.isArray(missing.evidenceRefs) ? missing.evidenceRefs : []) {
      if (!evidenceIds.has(ref)) errors.push(`${missing.path} cites missing evidence ${ref}.`);
    }
  }

  for (const status of [candidate.testing?.ciStatus, candidate.testing?.lintStatus, candidate.testing?.typecheckStatus]) {
    if (typeof status !== "string" || !CHECK_STATUSES.has(status)) errors.push(`Invalid testing status: ${status}.`);
  }

  return { valid: errors.length === 0, errors };
}

function isInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && value >= min && value <= max;
}
