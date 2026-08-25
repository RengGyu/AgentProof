export const VERIFICATION_CAPABILITIES_V2 = [
  "documentation_literal",
  "path_change_absence",
  "test_case",
  "workflow_job",
  "return_value"
] as const;

export type VerificationCapabilityV2 = (typeof VERIFICATION_CAPABILITIES_V2)[number];

const RELEASE_ELIGIBLE_CAPABILITY_SET = new Set<string>([
  "documentation_literal",
  "path_change_absence"
] satisfies VerificationCapabilityV2[]);

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
