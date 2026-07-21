import { getGitHubInstallationMetadataStoreStatus, listTenantGitHubInstallationStatuses } from "./github-installations";
import { getTenantAccountStoreStatus } from "./tenant-accounts";
import { getTenantAuthSessionStoreStatus, resolveTenantAuthAccess } from "./tenant-auth";
import {
  authorizeDurableTenantRepositoryGrantAsync,
  getTenantControlPlaneSettings,
  getTenantRepositoryGrantStoreStatus,
  listTenantEnabledRepositoryGrantScope
} from "./tenant-control-plane";
import { getConciergeStoreConfigurationStatus } from "./concierge-store-configuration";

export type ConciergeBlockReason =
  | "concierge_disabled"
  | "global_kill_switch"
  | "durable_store_required"
  | "durable_store_mismatch"
  | "session_invalid"
  | "installation_not_active"
  | "repository_grant_missing"
  | "repository_grant_disabled"
  | "repository_identity_mismatch"
  | "tenant_grant_scope_invalid"
  | "tenant_mismatch"
  | "authorization_unavailable";

export interface ConciergeAccessInput {
  repositoryFullName: string;
  cookieHeader?: string | null;
}

export type ConciergeAccessDecision =
  | { authorized: true; tenantId: string; memberId: string; installationId: number; repositoryId: number; repositoryFullName: string }
  | { authorized: false; reason: ConciergeBlockReason };

export interface ConciergeAccessDependencies {
  resolveSession: typeof resolveTenantAuthAccess;
  listInstallationStatuses: typeof listTenantGitHubInstallationStatuses;
  authorizeGrant: typeof authorizeDurableTenantRepositoryGrantAsync;
  listGrants: typeof listTenantEnabledRepositoryGrantScope;
}

const DEFAULT_DEPS: ConciergeAccessDependencies = {
  resolveSession: resolveTenantAuthAccess,
  listInstallationStatuses: listTenantGitHubInstallationStatuses,
  authorizeGrant: authorizeDurableTenantRepositoryGrantAsync,
  listGrants: listTenantEnabledRepositoryGrantScope
};

export function conciergeRuntimeDefaults(env = process.env) {
  const previewOnly = env.VERCEL_ENV === "preview";
  const tenantControlPlaneEnabled = getTenantControlPlaneSettings(env).enabled;
  const conciergeExplicitlyReleased = explicitlyReleased(env.AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH);
  return {
    // Reuse existing platform/control-plane settings. Production stays off
    // even if the control plane and kill-switch settings are present.
    manualAnalysisEnabled: previewOnly && tenantControlPlaneEnabled && conciergeExplicitlyReleased,
    globalKillSwitch: !conciergeExplicitlyReleased,
    llmEnabled: false,
    webhookAutomationEnabled: false,
    saveReportsEnabled: false,
    publicShareEnabled: false,
    githubCommentEnabled: false,
    slackEnabled: false,
    billingEnabled: false,
    fullHistoryEnabled: false
  } as const;
}

export async function authorizeConciergeAccess(
  input: ConciergeAccessInput,
  env = process.env,
  deps: ConciergeAccessDependencies = DEFAULT_DEPS
): Promise<ConciergeAccessDecision> {
  const runtime = conciergeRuntimeDefaults(env);
  if (runtime.globalKillSwitch) return { authorized: false, reason: "global_kill_switch" };
  if (!runtime.manualAnalysisEnabled || !getTenantControlPlaneSettings(env).enabled) return { authorized: false, reason: "concierge_disabled" };
  if (!validInput(input)) return { authorized: false, reason: "authorization_unavailable" };

  try {
    const configuration = getConciergeStoreConfigurationStatus(env);
    if (!configuration.configured) return { authorized: false, reason: "durable_store_required" };
    if (!configuration.consistent) return { authorized: false, reason: "durable_store_mismatch" };
    const stores = [
      getTenantAuthSessionStoreStatus(env),
      getTenantAccountStoreStatus(env),
      getGitHubInstallationMetadataStoreStatus(env),
      getTenantRepositoryGrantStoreStatus(env)
    ];
    if (stores.some((store) => !store.configured || !store.durable)) return { authorized: false, reason: "durable_store_required" };

    const session = await deps.resolveSession({ cookieHeader: input.cookieHeader }, env);
    if (!session.authorized || session.method !== "durable-session" || !session.memberId || !session.tenantId) return { authorized: false, reason: "session_invalid" };

    const enabledGrants = (await deps.listGrants({ tenantId: session.tenantId }, env)).filter((grant) => grant.enabled);
    if (enabledGrants.length !== 1) {
      return { authorized: false, reason: "tenant_grant_scope_invalid" };
    }
    const scopedGrant = enabledGrants[0];
    if (!scopedGrant || !Number.isSafeInteger(scopedGrant.repositoryId) || !scopedGrant.repositoryId) {
      return { authorized: false, reason: "tenant_grant_scope_invalid" };
    }
    if (scopedGrant.repositoryFullName.toLowerCase() !== input.repositoryFullName.toLowerCase()) {
      return { authorized: false, reason: "repository_identity_mismatch" };
    }
    const repositoryId = scopedGrant.repositoryId;

    const statuses = await deps.listInstallationStatuses({ tenantId: session.tenantId, installationIds: [scopedGrant.installationId] }, env);
    if (statuses.length !== 1 || statuses[0]?.installationId !== scopedGrant.installationId || statuses[0].status !== "active") {
      return { authorized: false, reason: "installation_not_active" };
    }

    const grant = await deps.authorizeGrant({
      installationId: scopedGrant.installationId,
      repositoryId,
      repositoryFullName: input.repositoryFullName
    }, env);
    if (!grant.grant) return { authorized: false, reason: "repository_grant_missing" };
    if (grant.grant.tenantId !== session.tenantId) return { authorized: false, reason: "tenant_mismatch" };
    if (grant.grant.installationId !== scopedGrant.installationId || grant.grant.repositoryId !== repositoryId) {
      return { authorized: false, reason: "repository_identity_mismatch" };
    }
    if (grant.grant.repositoryFullName.toLowerCase() !== input.repositoryFullName.toLowerCase()) {
      return { authorized: false, reason: "repository_identity_mismatch" };
    }
    if ((grant.reason && grant.reason !== "analysis-disabled") || !grant.grant.enabled) return { authorized: false, reason: "repository_grant_disabled" };

    return {
      authorized: true,
      tenantId: session.tenantId,
      memberId: session.memberId,
      installationId: scopedGrant.installationId,
      repositoryId,
      repositoryFullName: grant.grant.repositoryFullName
    };
  } catch {
    return { authorized: false, reason: "authorization_unavailable" };
  }
}

function validInput(input: ConciergeAccessInput): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repositoryFullName);
}

function explicitlyReleased(value: string | undefined): boolean {
  return /^(0|false|no|off)$/i.test(value?.trim() ?? "");
}
