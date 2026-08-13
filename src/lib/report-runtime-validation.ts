import { validateVerificationReport } from "./report-validation";
import type { PullRequestInput, VerificationReport } from "./types";
import { generateVerificationReport } from "./verifier";

export type RuntimeReportValidation =
  | {
      valid: true;
      report: VerificationReport;
      usedDeterministicFallback: boolean;
    }
  | {
      valid: false;
      errors: string[];
    };

/**
 * Enhanced planning is optional. A malformed enhanced report must never turn
 * an otherwise usable deterministic evidence report into a terminal failure.
 */
export function resolveRuntimeReportValidation(input: {
  input: PullRequestInput;
  report: VerificationReport;
  requireSourceProvenance?: boolean;
}): RuntimeReportValidation {
  const validation = validateVerificationReport(input.report, {
    mode: "full",
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (validation.valid) {
    return { valid: true, report: input.report, usedDeterministicFallback: false };
  }

  if (!input.report.planner) return { valid: false, errors: validation.errors };

  const fallback = generateVerificationReport(input.input);
  const fallbackValidation = validateVerificationReport(fallback, {
    mode: "full",
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (!fallbackValidation.valid) return { valid: false, errors: validation.errors };

  return { valid: true, report: fallback, usedDeterministicFallback: true };
}
