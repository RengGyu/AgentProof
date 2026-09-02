export const GENERAL_PR_OBSERVATION_APPROVED_SELECTION_POLICY_V1 = Object.freeze({
  version: 1,
  policyVersion: "general-pr-claim-evidence-selection.v1",
  claim: Object.freeze({ maxSpans: 12, maxInputBytes: 12_000 }),
  evidence: Object.freeze({ maxPerObjective: 12, maxTotal: 64, maxInputBytes: 12_000 })
});

export const GENERAL_PR_OBSERVATION_APPROVED_SELECTION_POLICY_HASH_V1 =
  "0c9d55e4512e720ecae264b59428d512951202cebf1e2dd7b29e5625ddaf6b26";
