export type RequirementLocalPromotionMode = "off" | "receipt_v2";

export interface RequirementLocalPromotionInput {
  axis: "targeted_test" | "execution";
  requirementId: string;
  receiptRefs: readonly string[];
  receiptsValidated: boolean;
}

/**
 * Reads the kill switch at use time so report-boundary validation can safely
 * downgrade an already-generated report after configuration changes.
 */
export function readRequirementLocalPromotionMode(): RequirementLocalPromotionMode {
  return process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE === "receipt_v2"
    ? "receipt_v2"
    : "off";
}

/**
 * Requirement-local test and execution evidence is promotable only after the
 * explicitly enabled, closed v2 receipt path. All other cases fail closed.
 */
export function mayPromoteObservedAxis(
  mode: RequirementLocalPromotionMode,
  input: RequirementLocalPromotionInput
): boolean {
  return mode === "receipt_v2" &&
    (input.axis === "targeted_test" || input.axis === "execution") &&
    input.requirementId.trim().length > 0 &&
    input.receiptsValidated &&
    input.receiptRefs.length > 0 &&
    input.receiptRefs.every((reference) => reference.trim().length > 0);
}
