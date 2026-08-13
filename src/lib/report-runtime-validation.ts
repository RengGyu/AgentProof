import { validateVerificationReport } from "./report-validation";
import type { PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";

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
  requireV2?: boolean;
}): RuntimeReportValidation {
  const v2 = isVerificationReportV2(input.report);
  if (input.requireV2 && !v2) {
    const fallback = generateVerificationReportV2FromInput(input.input);
    const fallbackValidation = validateVerificationReport(fallback, {
      mode: "v2_full",
      ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
    });
    return fallbackValidation.valid
      ? { valid: true, report: fallback, usedDeterministicFallback: true }
      : { valid: false, errors: fallbackValidation.errors };
  }
  const validation = validateVerificationReport(input.report, {
    mode: v2 ? "v2_full" : "full",
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (validation.valid) {
    return { valid: true, report: input.report, usedDeterministicFallback: false };
  }

  if (!input.report.planner) return { valid: false, errors: validation.errors };

  const fallback = v2 ? generateVerificationReportV2FromInput(input.input) : generateVerificationReport(input.input);
  const fallbackValidation = validateVerificationReport(fallback, {
    mode: v2 ? "v2_full" : "full",
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (!fallbackValidation.valid) return { valid: false, errors: validation.errors };

  return { valid: true, report: fallback, usedDeterministicFallback: true };
}

function isVerificationReportV2(report: VerificationReport): report is VerificationReportV2 {
  return (report as Partial<VerificationReportV2>).reportSchemaVersion === "verification-report.v2";
}
