import { buildReviewIntentGraph, hasReviewNavigationContext } from "./review-intent";
import { selectCanonicalRequirements } from "./extractors";
import {
  createVerificationValidationContextV2,
  validateVerificationReport
} from "./report-validation";
import { readRequirementLocalPromotionMode, type RequirementLocalPromotionMode } from "./proof-promotion-policy";
import type { PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";
import {
  canonicalVerificationBindingV2,
  materializeVerificationContractV2,
  parseVerificationContractV2
} from "./verification-contract-v2";
import type { VerificationCapabilityV2 } from "./verification-capability-policy-v2";

export type RuntimeReportBoundary =
  | "generated_private_full"
  | "inbound_untrusted_full"
  | "signed_summary_read";

// The source compiler is server-only. Retain its independent validator without
// importing it into client-side summary readers. JSON cannot create this context.
const ordinaryDocumentationContexts = new WeakMap<object, (input: PullRequestInput) => boolean>();
const ordinaryStaticContexts = new WeakMap<object, (input: PullRequestInput) => boolean>();
const ordinaryOutcomeContexts = new WeakMap<object, (input: PullRequestInput, report: VerificationReport) => boolean>();
export function registerOrdinaryOutcomeValidationContext(outcomes: object, validate: (input: PullRequestInput, report: VerificationReport) => boolean): void {
  ordinaryOutcomeContexts.set(outcomes, validate);
}
export function registerOrdinaryStaticValidationContext(summary: object, validate: (input: PullRequestInput) => boolean): void {
  ordinaryStaticContexts.set(summary, validate);
}
export function registerOrdinaryDocumentationValidationContext(summary: object, validate: (input: PullRequestInput) => boolean): void {
  ordinaryDocumentationContexts.set(summary, validate);
}

export type RuntimeReportFailureReason =
  | "navigation_context_mismatch" | "intent_mismatch"
  | "outcome_context_mismatch" | "static_context_mismatch" | "documentation_context_mismatch"
  | "inbound_authority_rejected" | "review_candidate_invalid" | "report_invalid";
// Exact existing validator sentinel; never copy a dynamic error string into a code.
const validationReasonCodes=(errors:readonly string[]):RuntimeReportFailureReason[]=>
  [...new Set(errors.map(error=>error==="Invalid review candidates."?"review_candidate_invalid" as const:"report_invalid" as const))];

export type RuntimeReportValidation =
  | {
      valid: true;
      report: VerificationReport;
      usedDeterministicFallback: boolean;
    }
  | {
      valid: false;
      errors: string[];
      reasonCodes?: RuntimeReportFailureReason[];
    };

export type RuntimeReportBoundaryInput =
  | {
      boundary: "generated_private_full";
      input: PullRequestInput;
      report: VerificationReport;
      requireSourceProvenance?: boolean;
      requireV2?: boolean;
      requirementLocalPromotionMode?: RequirementLocalPromotionMode;
      verificationCapabilitiesV2?: ReadonlySet<VerificationCapabilityV2>;
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
    if((input.report as VerificationReportV2).reviewCandidates?.navigation)return {valid:false,reasonCodes:["inbound_authority_rejected"],errors:["Inbound reports cannot supply model-ranked read authority."]};
    if ((input.report as VerificationReportV2).ordinaryRequirementOutcomes !== undefined) return { valid: false, reasonCodes: ["inbound_authority_rejected"], errors: ["Inbound reports cannot supply source-derived requirement authority."] };
    if ((input.report as VerificationReportV2).ordinaryStaticSummary !== undefined) return { valid: false, reasonCodes: ["inbound_authority_rejected"], errors: ["Inbound reports cannot supply scoped static evidence."] };
    if ((input.report as VerificationReportV2).ordinaryDocumentationSummary !== undefined) return { valid: false, reasonCodes: ["inbound_authority_rejected"], errors: ["Inbound reports cannot supply scoped documentation verification."] };
    if (hasActiveV2ContractAuthority(input.report)) {
      return {
        valid: false,
        reasonCodes: ["inbound_authority_rejected"], errors: ["An inbound untrusted full report cannot carry active v2 contract authority."]
      };
    }
    if (hasReceiptGatedPositive(input.report)) {
      return {
        valid: false,
        reasonCodes: ["inbound_authority_rejected"], errors: ["An inbound untrusted full report cannot carry receipt-gated positive claims."]
      };
    }
    const validation = validateVerificationReport(input.report, {
      mode: isVerificationReportV2(input.report) ? "v2_full" : "full"
    });
    return validation.valid
      ? { valid: true, report: input.report, usedDeterministicFallback: false }
      : { valid: false, errors: validation.errors, reasonCodes: validationReasonCodes(validation.errors) };
  }

  const validation = validateVerificationReport(input.report, {
    mode: input.projection === "tenant"
      ? (isVerificationReportV2(input.report) ? "v2_tenant" : "tenant")
      : (isVerificationReportV2(input.report) ? "v2_summary" : "summary")
  });
  return validation.valid
    ? { valid: true, report: input.report, usedDeterministicFallback: false }
    : { valid: false, errors: validation.errors, reasonCodes: validationReasonCodes(validation.errors) };
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
  requirementLocalPromotionMode?: RequirementLocalPromotionMode;
  verificationCapabilitiesV2?: ReadonlySet<VerificationCapabilityV2>;
}): RuntimeReportValidation {
  return validateRuntimeReportBoundary({
    boundary: "generated_private_full",
    input: input.input,
    report: input.report,
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {}),
    ...(input.requireV2 ? { requireV2: true } : {}),
    ...(input.requirementLocalPromotionMode ? { requirementLocalPromotionMode: input.requirementLocalPromotionMode } : {}),
    ...(input.verificationCapabilitiesV2 ? { verificationCapabilitiesV2: input.verificationCapabilitiesV2 } : {})
  });
}

function resolveGeneratedPrivateFull(input: Extract<RuntimeReportBoundaryInput, { boundary: "generated_private_full" }>): RuntimeReportValidation {
  const v2 = isVerificationReportV2(input.report);
  const navigation = (input.report as VerificationReportV2).reviewCandidates?.navigation;
  if(navigation && !hasReviewNavigationContext(navigation,input.input))return {valid:false,reasonCodes:["navigation_context_mismatch"],errors:["Review navigation requires its bound source and exact read context."]};
  const intent = (input.report as VerificationReportV2).reviewCandidates?.intentGraph;
  if (intent && JSON.stringify(intent) !== JSON.stringify(buildReviewIntentGraph(input.input, input.report.requirements, input.report.evidenceIndex))) return { valid: false, reasonCodes: ["intent_mismatch"], errors: ["Review intent references require the original source and exact repository snapshot."] };
  const documentation = (input.report as VerificationReportV2).ordinaryDocumentationSummary;
  const staticSummary = (input.report as VerificationReportV2).ordinaryStaticSummary;
  const ordinaryOutcomes = (input.report as VerificationReportV2).ordinaryRequirementOutcomes;
  if (ordinaryOutcomes && ordinaryOutcomeContexts.get(ordinaryOutcomes)?.(input.input, input.report) !== true) return { valid: false, reasonCodes: ["outcome_context_mismatch"], errors: ["Source-derived outcomes require transient source, head, plan and artifact validation."] };
  if (v2 && staticSummary && ordinaryStaticContexts.get(staticSummary)?.(input.input) !== true) return { valid: false, reasonCodes: ["static_context_mismatch"], errors: ["Scoped static evidence requires separate transient source, plan and artifact context."] };
  if (v2 && documentation && ordinaryDocumentationContexts.get(documentation)?.(input.input) !== true) return { valid: false, reasonCodes: ["documentation_context_mismatch"], errors: ["Scoped documentation verification requires separate transient source, plan and artifact context."] };
  const requirementLocalPromotionMode = input.requirementLocalPromotionMode ?? readRequirementLocalPromotionMode();
  if (v2 && requirementLocalPromotionMode === "off" &&
    (hasReceiptGatedPositive(input.report) || hasPrivateV2Receipts(input.report))) {
    return validateGeneratedFallback(input, true);
  }
  if (input.requireV2 && !v2) {
    return validateGeneratedFallback(input, true);
  }
  const validation = validateVerificationReport(input.report, {
    mode: v2 ? "v2_full" : "full",
    ...(ordinaryOutcomes ? { ordinaryOutcomeValidator: (report: VerificationReport) => ordinaryOutcomeContexts.get(ordinaryOutcomes)?.(input.input, report) === true } : {}),
    ...(v2 ? { receiptValidationContext: createRuntimeValidationContextV2(input.input, input.verificationCapabilitiesV2) } : {}),
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (validation.valid) {
    return { valid: true, report: input.report, usedDeterministicFallback: false };
  }

  if (!input.report.planner) return { valid: false, errors: validation.errors, reasonCodes: validationReasonCodes(validation.errors) };

  return validateGeneratedFallback(input, v2);
}

function validateGeneratedFallback(
  input: Extract<RuntimeReportBoundaryInput, { boundary: "generated_private_full" }>,
  v2: boolean
): RuntimeReportValidation {
  const fallback = v2 || input.requireV2
    ? generateVerificationReportV2FromInput(input.input, {
        requirementLocalPromotionMode: input.requirementLocalPromotionMode ?? readRequirementLocalPromotionMode(),
        ...(input.verificationCapabilitiesV2 ? { verificationCapabilitiesV2: input.verificationCapabilitiesV2 } : {})
      })
    : generateVerificationReport(input.input, {
        requirementLocalPromotionMode: input.requirementLocalPromotionMode ?? readRequirementLocalPromotionMode()
      });
  const fallbackIsV2 = isVerificationReportV2(fallback);
  const fallbackValidation = validateVerificationReport(fallback, {
    mode: fallbackIsV2 ? "v2_full" : "full",
    ...(fallbackIsV2 ? { receiptValidationContext: createRuntimeValidationContextV2(input.input, input.verificationCapabilitiesV2) } : {}),
    ...(input.requireSourceProvenance ? { requireSourceProvenance: true } : {})
  });
  if (!fallbackValidation.valid) return { valid: false, errors: fallbackValidation.errors, reasonCodes: validationReasonCodes(fallbackValidation.errors) };

  return { valid: true, report: fallback, usedDeterministicFallback: true };
}

function createRuntimeValidationContextV2(
  input: PullRequestInput,
  capabilities?: ReadonlySet<VerificationCapabilityV2>
) {
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
      return createVerificationValidationContextV2(input, canonical, capabilities);
    }
  }
  const canonical = selectCanonicalRequirements({ kind: "selected_source", input });
  return createVerificationValidationContextV2(input, canonical, capabilities);
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
