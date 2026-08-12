export const HYBRID_PLANNER_CONSENT_VERSION = "2026-08-12.v1" as const;
export const HYBRID_PLANNER_CONSENT_DISCLOSURE =
  "Allow AgentProof to send bounded redacted private Issue and pull-request source spans to the configured provider for enhanced planning.";

export type HybridPlannerGateReason =
  | "repository-not-private"
  | "analysis-mode-not-enhanced"
  | "consent-not-granted"
  | "tenant-not-allowlisted"
  | "pilot-disabled";

export interface HybridPlannerGateInput {
  repositoryPrivate: unknown;
  grant?: {
    tenantId?: unknown;
    llmAnalysisMode?: unknown;
    hybridPlannerConsentVersion?: unknown;
  };
  tenantAllowlist: readonly unknown[];
  env?: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED?: string };
}

export type HybridPlannerGateDecision =
  | { enabled: true }
  | { enabled: false; reason: HybridPlannerGateReason };

/**
 * Pure admission check for the private hybrid pilot. Callers must invoke this
 * afresh for every analysis; this helper intentionally caches no input.
 */
export function evaluateHybridPlannerGate(input: HybridPlannerGateInput): HybridPlannerGateDecision {
  if (input.repositoryPrivate !== true) return { enabled: false, reason: "repository-not-private" };
  if (input.grant?.llmAnalysisMode !== "enhanced") return { enabled: false, reason: "analysis-mode-not-enhanced" };
  if (input.grant.hybridPlannerConsentVersion !== HYBRID_PLANNER_CONSENT_VERSION) return { enabled: false, reason: "consent-not-granted" };
  if (!hasAllowlistedTenant(input.grant.tenantId, input.tenantAllowlist)) return { enabled: false, reason: "tenant-not-allowlisted" };
  if (input.env?.AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED !== "true") return { enabled: false, reason: "pilot-disabled" };
  return { enabled: true };
}

function hasAllowlistedTenant(tenantId: unknown, allowlist: readonly unknown[]): boolean {
  if (!isTenantId(tenantId) || allowlist.length > 500) return false;
  return allowlist.some((candidate) => candidate === tenantId && isTenantId(candidate));
}

function isTenantId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value);
}
