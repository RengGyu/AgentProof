import type { VerificationReport } from "./types";

const PRIORITIES = new Set(["low", "medium", "high", "blocker"]);
const REQUIREMENT_STATUSES = new Set(["met", "partial", "missing", "unclear"]);
const CHECK_STATUSES = new Set(["passed", "failed", "pending", "unknown"]);

export interface ReportValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateVerificationReport(report: VerificationReport): ReportValidationResult {
  const errors: string[] = [];
  const evidenceIds = new Set(report.evidenceIndex.map((item) => item.id));

  if (!report.analysisId) errors.push("analysisId is required.");
  if (!report.createdAt) errors.push("createdAt is required.");
  if (!report.source?.title) errors.push("source.title is required.");
  if (!PRIORITIES.has(report.summary?.priority)) errors.push("summary.priority is invalid.");
  if (!isInRange(report.summary?.confidence, 0, 1)) errors.push("summary.confidence must be between 0 and 1.");
  if (!isInRange(report.summary?.evidenceCoverage, 0, 100)) errors.push("summary.evidenceCoverage must be between 0 and 100.");

  for (const requirement of report.requirements) {
    if (!REQUIREMENT_STATUSES.has(requirement.status)) {
      errors.push(`${requirement.requirementId} has an invalid status.`);
    }
    if (!isInRange(requirement.confidence, 0, 1)) {
      errors.push(`${requirement.requirementId} confidence must be between 0 and 1.`);
    }
    for (const ref of requirement.evidenceRefs) {
      if (!evidenceIds.has(ref)) errors.push(`${requirement.requirementId} cites missing evidence ${ref}.`);
    }
  }

  for (const claim of report.claims) {
    for (const ref of claim.evidenceRefs) {
      if (!evidenceIds.has(ref)) errors.push(`${claim.id} cites missing evidence ${ref}.`);
    }
  }

  for (const missing of report.testing.missingTests) {
    for (const ref of missing.evidenceRefs) {
      if (!evidenceIds.has(ref)) errors.push(`${missing.path} cites missing evidence ${ref}.`);
    }
  }

  for (const status of [report.testing.ciStatus, report.testing.lintStatus, report.testing.typecheckStatus]) {
    if (!CHECK_STATUSES.has(status)) errors.push(`Invalid testing status: ${status}.`);
  }

  return { valid: errors.length === 0, errors };
}

function isInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && value >= min && value <= max;
}
