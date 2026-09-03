import { createHash } from "node:crypto";

export const GENERAL_PR_OBSERVATION_APPROVED_SELECTION_POLICY_V1 = Object.freeze({
  version: 1,
  policyVersion: "general-pr-claim-evidence-selection.v1",
  claim: Object.freeze({ maxSpans: 12, maxInputBytes: 12_000 }),
  evidence: Object.freeze({ maxPerObjective: 12, maxTotal: 64, maxInputBytes: 12_000 })
});

export const GENERAL_PR_OBSERVATION_APPROVED_SELECTION_POLICY_HASH_V1 =
  "0c9d55e4512e720ecae264b59428d512951202cebf1e2dd7b29e5625ddaf6b26";

export function generalPrObservationSelectionPolicyHashV1(value) {
  if (!exactKeys(value, ["version", "policyVersion", "claim", "evidence"]) || value.version !== 1 || value.policyVersion !== "general-pr-claim-evidence-selection.v1" ||
    !exactKeys(value.claim, ["maxSpans", "maxInputBytes"]) || !isPositiveInteger(value.claim.maxSpans) || !isPositiveInteger(value.claim.maxInputBytes) ||
    !exactKeys(value.evidence, ["maxPerObjective", "maxTotal", "maxInputBytes"]) || !isPositiveInteger(value.evidence.maxPerObjective) || !isPositiveInteger(value.evidence.maxTotal) || !isPositiveInteger(value.evidence.maxInputBytes)) return null;
  return createHash("sha256").update(stableJson({ domain: "agentproof.general-pr.selection-policy.v1", policy: value }), "utf8").digest("hex");
}

function isPositiveInteger(value) { return Number.isSafeInteger(value) && value > 0; }
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys) { return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
