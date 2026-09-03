export const VERIFICATION_CAPABILITIES_V2 = [
  "documentation_literal",
  "path_change_absence",
  "test_case",
  "workflow_job",
  "return_value"
] as const;

export type VerificationCapabilityV2 = (typeof VERIFICATION_CAPABILITIES_V2)[number];

export const RELEASE_ELIGIBLE_VERIFICATION_CAPABILITIES_V2 = [
  "documentation_literal",
  "path_change_absence"
] as const satisfies readonly VerificationCapabilityV2[];

/**
 * General PR prose is advisory-only. If an authoritative typed contract is
 * later materialized from that flow, it may only plan the literal-document
 * capability until the separate absence contract has a complete rename-safe
 * inventory proof.
 */
export const GENERAL_PR_EXECUTABLE_CAPABILITIES_V2 = [
  "documentation_literal"
] as const satisfies readonly VerificationCapabilityV2[];

const RELEASE_ELIGIBLE_CAPABILITY_SET = new Set<string>(RELEASE_ELIGIBLE_VERIFICATION_CAPABILITIES_V2);
const GENERAL_PR_EXECUTABLE_CAPABILITY_SET = new Set<string>(GENERAL_PR_EXECUTABLE_CAPABILITIES_V2);

/** A closed registry for newly materialized executable plans. */
export function isReleasedVerificationCapabilityV2(capability: VerificationCapabilityV2): boolean {
  return RELEASE_ELIGIBLE_CAPABILITY_SET.has(capability);
}

/** A narrower closed registry used only by the new general-PR planner. */
export function isGeneralPrExecutableCapabilityV2(capability: VerificationCapabilityV2): boolean {
  return GENERAL_PR_EXECUTABLE_CAPABILITY_SET.has(capability);
}

/**
 * A malformed policy is fail-closed as a whole. This keeps production default
 * off and prevents a misspelled extra token from silently enabling a subset.
 */
export function readEnabledVerificationCapabilitiesV2(
  value = process.env.AGENTPROOF_VERIFICATION_CAPABILITIES_V2
): ReadonlySet<VerificationCapabilityV2> {
  if (!value?.trim()) return new Set();
  const tokens = value.split(",").map((token) => token.trim());
  if (tokens.some((token) => !token || !RELEASE_ELIGIBLE_CAPABILITY_SET.has(token))) return new Set();
  const enabled = new Set(tokens);
  if (enabled.size !== tokens.length) return new Set();
  return enabled as ReadonlySet<VerificationCapabilityV2>;
}
