import { selectCanonicalRequirements } from "./extractors";
import {
  createVerificationValidationContextV2,
  validateVerificationReport
} from "./report-validation";
import { readRequirementLocalPromotionMode } from "./proof-promotion-policy";
import type { PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";
import {
  canonicalVerificationBindingV2,
  materializeVerificationContractV2,
  parseVerificationContractV2
} from "./verification-contract-v2";

export type RuntimeReportBoundary =
  | "generated_private_full"
  | "inbound_untrusted_full"
  | "signed_summary_read";

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

export type RuntimeReportBoundaryInput =
  | {
      boundary: "generated_private_full";
      input: PullRequestInput;
      report: VerificationReport;
      requireSourceProvenance?: boolean;
      requireV2?: boolean;
    }
  | {
      boundary: "inbound_untrusted_full" | "signed_summary_read";
      report: VerificationReport;
      projection?: "summary" | "tenant";
    };

/**
 * Single runtime trust-boundary adapter. Low-level schema validation stays
 * private to this module so request, publication, persistence, and read paths
 * cannot choose a more permissive mode themselves.
 */
export function validateRuntimeReportBoundary(
  input: RuntimeReportBoundaryInput
): RuntimeReportValidation {
  if (input.boundary === "generated_private_full") {
    return resolveGeneratedPrivateFull(input);
  }

  if (input.boundary === "inbound_untrusted_full") {
    if (hasActiveV2ContractAuthority(input.report)) {
      return {
        valid: false,
        errors: ["An inbound untrusted full report cannot carry active v2 contract authority."]
      };
    }
    if (hasReceiptGatedPositive(input.report)) {
      return {
        valid: false,
        errors: ["An inbound untrusted full report cannot carry receipt-gated positive claims."]
      };
    }
    const validation = validateVerificationReport(input.report, {
      mode: isVerificationReportV2(input.report) ? "v2_full" : "full"
    });
    return validation.valid
      ? { valid: true, report: input.report, usedDeterministicFallback: false }
      : { valid: false, errors: validation.errors };
  }

  const validation = validateVerificationReport(input.report, {
    mode: input.projection === "tenant"
      ? (isVerificationReportV2(input.report) ? "v2_tenant" : "tenant")
      : (isVerificationReportV2(input.report) ? "v2_summary" : "summary")
  });
  return validation.valid
    ? { valid: true, report: input.report, usedDeterministicFallback: false }
    : { valid: false, errors: validation.errors };
}

/**
 * Enhanced planning is optional. A malformed enhanced report must never turn
 * an otherwise usable deterministic evidence report into a terminal failure.
 */
export function resolveRuntimeReportValidation(input: {
  boundary?: "generated_private_full";
  input: PullRequestInput;
  report: VerificationReport;
  requireSourceProvenance?: boolean;
  requireV2?: boolean;
}): RuntimeReportValidation {
  return validateRuntimeReportBoundary({
    boundary: "generated_private_full",
    input: input.input,
    report: input.report,
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {}),
    ...(input.requireV2 ? { requireV2: true } : {})
  });
}

function resolveGeneratedPrivateFull(input: Extract<RuntimeReportBoundaryInput, { boundary: "generated_private_full" }>): RuntimeReportValidation {
  const v2 = isVerificationReportV2(input.report);
  if (v2 && readRequirementLocalPromotionMode() === "off" &&
    (hasReceiptGatedPositive(input.report) || hasPrivateV2Receipts(input.report))) {
    return validateGeneratedFallback(input, true);
  }
  if (input.requireV2 && !v2) {
    return validateGeneratedFallback(input, true);
  }
  const validation = validateVerificationReport(input.report, {
    mode: v2 ? "v2_full" : "full",
    ...(v2 ? { receiptValidationContext: createRuntimeValidationContextV2(input.input) } : {}),
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (validation.valid) {
    return { valid: true, report: input.report, usedDeterministicFallback: false };
  }

  if (!input.report.planner) return { valid: false, errors: validation.errors };

  return validateGeneratedFallback(input, v2);
}

function validateGeneratedFallback(
  input: Extract<RuntimeReportBoundaryInput, { boundary: "generated_private_full" }>,
  v2: boolean
): RuntimeReportValidation {
  const fallback = v2 || input.requireV2
    ? generateVerificationReportV2FromInput(input.input)
    : generateVerificationReport(input.input);
  const fallbackIsV2 = isVerificationReportV2(fallback);
  const fallbackValidation = validateVerificationReport(fallback, {
    mode: fallbackIsV2 ? "v2_full" : "full",
    ...(fallbackIsV2 ? { receiptValidationContext: createRuntimeValidationContextV2(input.input) } : {}),
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (!fallbackValidation.valid) return { valid: false, errors: fallbackValidation.errors };

  return { valid: true, report: fallback, usedDeterministicFallback: true };
}

function createRuntimeValidationContextV2(input: PullRequestInput) {
  const source = input.verificationContractSourceV2;
  const binding = input.verificationContractBindingV2;
  if (source && binding) {
    const parsed = parseVerificationContractV2(source);
    if (parsed.state === "authoritative" || parsed.state === "author_claim") {
      const materialized = materializeVerificationContractV2(
        parsed,
        canonicalVerificationBindingV2(binding, parsed.contract)
      );
      const canonical = selectCanonicalRequirements({ kind: "typed_contract", materialized, binding });
      return createVerificationValidationContextV2(input, canonical);
    }
  }
  const canonical = selectCanonicalRequirements({ kind: "selected_source", input });
  return createVerificationValidationContextV2(input, canonical);
}

function hasActiveV2ContractAuthority(report: VerificationReport): boolean {
  if (!isVerificationReportV2(report)) return false;
  const state = (report as Partial<VerificationReportV2>).verificationContract?.state;
  return state === "authoritative" || state === "author_claim";
}

function hasReceiptGatedPositive(report: VerificationReport): boolean {
  return Array.isArray(report.requirements) && report.requirements.some((requirement) => {
    if (!requirement || typeof requirement !== "object" || !Array.isArray(requirement.proofAxes)) return false;
    return requirement.proofAxes.some((axis) => axis && typeof axis === "object" &&
      (axis.subject === "targeted_test" || axis.subject === "execution") && axis.state === "satisfied");
  });
}

function hasPrivateV2Receipts(report: VerificationReport): boolean {
  const graph = report.proofGraph;
  if (!graph || typeof graph !== "object") return false;
  const bundle = graph.privateReceiptBundleV2;
  return Boolean(bundle && (
    (Array.isArray(bundle.testRelationReceipts) && bundle.testRelationReceipts.some((receipt) => receipt.version === 2)) ||
    (Array.isArray(bundle.executionBindingReceipts) && bundle.executionBindingReceipts.length > 0)
  ));
}

function isVerificationReportV2(report: VerificationReport): report is VerificationReportV2 {
  return (report as Partial<VerificationReportV2>).reportSchemaVersion === "verification-report.v2";
}
