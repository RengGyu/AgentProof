import { getGitHubInstallationMetadataStoreStatus, listTenantGitHubInstallationStatuses } from "./github-installations";
import { getTenantAccountStoreStatus } from "./tenant-accounts";
import { getTenantAuthSessionStoreStatus, verifyTenantAuthAccess } from "./tenant-auth";
import {
  authorizeDurableTenantRepositoryGrantAsync,
  getTenantControlPlaneSettings,
  getTenantRepositoryGrantStoreStatus
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
  | "tenant_mismatch"
  | "authorization_unavailable";

export interface ConciergeAccessInput {
  tenantId: string;
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  cookieHeader?: string | null;
}

export type ConciergeAccessDecision =
  | { authorized: true; tenantId: string; memberId: string; installationId: number; repositoryId: number; repositoryFullName: string }
  | { authorized: false; reason: ConciergeBlockReason };

export interface ConciergeAccessDependencies {
  verifySession: typeof verifyTenantAuthAccess;
  listInstallationStatuses: typeof listTenantGitHubInstallationStatuses;
  authorizeGrant: typeof authorizeDurableTenantRepositoryGrantAsync;
}

const DEFAULT_DEPS: ConciergeAccessDependencies = {
  verifySession: verifyTenantAuthAccess,
  listInstallationStatuses: listTenantGitHubInstallationStatuses,
  authorizeGrant: authorizeDurableTenantRepositoryGrantAsync
};

export function conciergeRuntimeDefaults(env = process.env) {
  return {
    manualAnalysisEnabled: truthy(env.AGENTPROOF_CONCIERGE_PRIVATE_BETA_ENABLED),
    globalKillSwitch: truthy(env.AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH),
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
  if (!runtime.manualAnalysisEnabled || !getTenantControlPlaneSettings(env).enabled) return { authorized: false, reason: "concierge_disabled" };
  if (runtime.globalKillSwitch) return { authorized: false, reason: "global_kill_switch" };
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

    const session = await deps.verifySession({ tenantId: input.tenantId, cookieHeader: input.cookieHeader }, env);
    if (!session.authorized || session.method !== "durable-session" || !session.memberId) return { authorized: false, reason: "session_invalid" };

    const statuses = await deps.listInstallationStatuses({ tenantId: input.tenantId, installationIds: [input.installationId] }, env);
    if (statuses.length !== 1 || statuses[0]?.installationId !== input.installationId || statuses[0].status !== "active") {
      return { authorized: false, reason: "installation_not_active" };
    }

    const grant = await deps.authorizeGrant({
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      repositoryFullName: input.repositoryFullName
    }, env);
    if (!grant.grant) return { authorized: false, reason: "repository_grant_missing" };
    if (grant.grant.tenantId !== input.tenantId) return { authorized: false, reason: "tenant_mismatch" };
    if (grant.grant.repositoryFullName.toLowerCase() !== input.repositoryFullName.toLowerCase()) {
      return { authorized: false, reason: "repository_identity_mismatch" };
    }
    if ((grant.reason && grant.reason !== "analysis-disabled") || !grant.grant.enabled) return { authorized: false, reason: "repository_grant_disabled" };

    return {
      authorized: true,
      tenantId: input.tenantId,
      memberId: session.memberId,
      installationId: input.installationId,
      repositoryId: input.repositoryId,
      repositoryFullName: grant.grant.repositoryFullName
    };
  } catch {
    return { authorized: false, reason: "authorization_unavailable" };
  }
}

function validInput(input: ConciergeAccessInput): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,79}$/i.test(input.tenantId)
    && Number.isSafeInteger(input.installationId) && input.installationId > 0
    && Number.isSafeInteger(input.repositoryId) && input.repositoryId > 0
    && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repositoryFullName);
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
