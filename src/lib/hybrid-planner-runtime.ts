import {
  evaluateHybridPlannerGate,
  type HybridPlannerGateDecision
} from "./hybrid-planner-consent";

export const HYBRID_PLANNER_TENANT_ALLOWLIST_ENV =
  "AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST" as const;

export interface HybridPlannerGateReaderOptions {
  readRepositoryPrivate: () => unknown | Promise<unknown>;
  readGrant: () => Promise<{
    tenantId?: unknown;
    llmAnalysisMode?: unknown;
    hybridPlannerConsentVersion?: unknown;
  } | undefined>;
  env?: Partial<NodeJS.ProcessEnv>;
}

/** Creates a deliberately uncached phase gate. */
export function createHybridPlannerGateReader(
  options: HybridPlannerGateReaderOptions
): () => Promise<HybridPlannerGateDecision> {
  return async () => evaluateHybridPlannerGate({
    repositoryPrivate: await options.readRepositoryPrivate(),
    grant: await options.readGrant(),
    tenantAllowlist: readHybridPlannerTenantAllowlist(options.env ?? process.env),
    env: {
      AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED:
        (options.env ?? process.env).AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED
    }
  });
}

export function readHybridPlannerTenantAllowlist(
  env: Partial<NodeJS.ProcessEnv> = process.env
): string[] {
  const raw = env[HYBRID_PLANNER_TENANT_ALLOWLIST_ENV];
  if (!raw?.trim()) return [];
  const values = raw.split(",").map((value) => value.trim());
  if (
    values.length > 500 ||
    values.some((value) => !/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(value)) ||
    new Set(values).size !== values.length
  ) return [];
  return values;
}
