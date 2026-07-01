import {
  readTenantAccountSummary,
  type TenantAccountPlan,
  type TenantAccountStatus
} from "./tenant-accounts";
import {
  listTenantRepositoryGrants,
  readTenantRepositoryGrants,
  type TenantRepositoryGrant
} from "./tenant-control-plane";
import {
  readUsageQuotaStatus,
  type UsageQuotaStatus
} from "./usage-quota";
import { redactSecrets } from "./redact";

export type TenantEntitlementPlan = TenantAccountPlan;
export type TenantEntitlementStatus = TenantAccountStatus;
export type TenantEntitlementState = "enabled" | "disabled" | "not_configured" | "unavailable" | "unclear";
export type TenantEntitlementFeatureKey =
  | "github_app_analysis"
  | "connected_repository_verification"
  | "saved_summary_links"
  | "marker_comments"
  | "slack_summaries"
  | "structured_llm_verifier";

export interface TenantEntitlementFeature {
  key: TenantEntitlementFeatureKey;
  label: string;
  state: TenantEntitlementState;
  enabled: boolean;
  reason?: string;
}

export interface TenantEntitlementAccountSummary {
  status: TenantEntitlementStatus;
  configured: boolean;
  source: "tenant_account_summary" | "unavailable";
}

export interface TenantEntitlementQuotaSummary {
  state: "available" | "exhausted" | "not_configured" | "not_enforced" | "unavailable" | "unclear";
  configured: boolean;
  enforced: boolean;
  period?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  plan?: string;
  planMatchesAccount?: boolean;
}

export interface TenantEntitlementRepositorySummary {
  state: "configured" | "not_configured" | "unavailable";
  connectedRepositoryCount?: number;
  analysisEnabledCount?: number;
  saveReportsEnabledCount?: number;
  commentEnabledCount?: number;
  slackNotificationsEnabledCount?: number;
}

export interface TenantEntitlementSummary {
  privacy: "plan-entitlement-summary-only";
  tenantId: string;
  plan: TenantEntitlementPlan;
  account: TenantEntitlementAccountSummary;
  quota: TenantEntitlementQuotaSummary;
  repositories: TenantEntitlementRepositorySummary;
  features: TenantEntitlementFeature[];
}

interface AccountRead {
  plan: TenantEntitlementPlan;
  account: TenantEntitlementAccountSummary;
}

const FEATURE_LABELS: Record<TenantEntitlementFeatureKey, string> = {
  github_app_analysis: "PR evidence reports",
  connected_repository_verification: "Connected repository verification",
  saved_summary_links: "Summary report links",
  marker_comments: "Marker PR comments",
  slack_summaries: "Slack summaries",
  structured_llm_verifier: "Structured LLM verifier"
};

export class TenantEntitlementStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantEntitlementStoreError";
  }
}

export async function readTenantEntitlementSummary(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantEntitlementSummary> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantEntitlementStoreError("Tenant entitlement id is invalid.");
  }

  const [account, quota, repositories] = await Promise.all([
    readAccountBoundary(tenantId, env),
    readQuotaBoundary(tenantId, env),
    readRepositoryBoundary(tenantId, env)
  ]);

  return {
    privacy: "plan-entitlement-summary-only",
    tenantId,
    plan: account.plan,
    account: account.account,
    quota: {
      ...quota,
      planMatchesAccount: account.plan !== "unknown" && quota.plan
        ? account.plan === quota.plan
        : undefined
    },
    repositories,
    features: buildFeatures({
      account: account.account,
      quota,
      repositories
    })
  };
}

async function readAccountBoundary(tenantId: string, env: NodeJS.ProcessEnv): Promise<AccountRead> {
  try {
    const summary = await readTenantAccountSummary({ tenantId }, env);

    return {
      plan: summary.account.plan,
      account: {
        status: summary.account.status,
        configured: summary.account.configured,
        source: "tenant_account_summary"
      }
    };
  } catch {
    return {
      plan: "unknown",
      account: {
        status: "unknown",
        configured: false,
        source: "unavailable"
      }
    };
  }
}

async function readQuotaBoundary(tenantId: string, env: NodeJS.ProcessEnv): Promise<TenantEntitlementQuotaSummary> {
  try {
    const quota = await readUsageQuotaStatus({
      tenantId,
      feature: "github_app_analysis"
    }, env);

    return toQuotaSummary(quota);
  } catch {
    return {
      state: "unavailable",
      configured: false,
      enforced: true
    };
  }
}

async function readRepositoryBoundary(
  tenantId: string,
  env: NodeJS.ProcessEnv
): Promise<TenantEntitlementRepositorySummary> {
  try {
    const grants = await readTenantRepositoryGrantSummaries(tenantId, env);
    if (!grants) {
      return { state: "unavailable" };
    }

    return {
      state: grants.length > 0 ? "configured" : "not_configured",
      connectedRepositoryCount: grants.length,
      analysisEnabledCount: grants.filter((grant) => grant.enabled && grant.analysisEnabled).length,
      saveReportsEnabledCount: grants.filter((grant) => grant.enabled && grant.saveReportsEnabled).length,
      commentEnabledCount: grants.filter((grant) => grant.enabled && grant.commentEnabled).length,
      slackNotificationsEnabledCount: grants.filter((grant) => grant.enabled && grant.slackNotificationsEnabled).length
    };
  } catch {
    return { state: "unavailable" };
  }
}

async function readTenantRepositoryGrantSummaries(
  tenantId: string,
  env: NodeJS.ProcessEnv
): Promise<TenantRepositoryGrant[] | null> {
  if (hasDurableGrantConfig(env) || truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    return listTenantRepositoryGrants({ tenantId }, env);
  }

  const envGrants = readTenantRepositoryGrants(env);
  if (!envGrants) return null;

  return envGrants.filter((grant) => grant.tenantId === tenantId).slice(0, 500);
}

function toQuotaSummary(quota: UsageQuotaStatus): TenantEntitlementQuotaSummary {
  return {
    state: quotaState(quota),
    configured: quota.configured,
    enforced: quota.enforced,
    period: quota.period,
    limit: quota.limit,
    used: quota.used,
    remaining: quota.remaining,
    plan: quota.plan
  };
}

function quotaState(quota: UsageQuotaStatus): TenantEntitlementQuotaSummary["state"] {
  if (!quota.enforced) return "not_enforced";
  if (!quota.configured) return "not_configured";
  if (typeof quota.remaining !== "number") return "unclear";
  if (quota.remaining <= 0) return "exhausted";

  return "available";
}

function buildFeatures(input: {
  account: TenantEntitlementAccountSummary;
  quota: TenantEntitlementQuotaSummary;
  repositories: TenantEntitlementRepositorySummary;
}): TenantEntitlementFeature[] {
  return [
    feature("github_app_analysis", githubAnalysisState(input)),
    feature("connected_repository_verification", repositoryVerificationState(input)),
    feature("saved_summary_links", repoSettingState(input, "saveReportsEnabledCount")),
    feature("marker_comments", repoSettingState(input, "commentEnabledCount")),
    feature("slack_summaries", repoSettingState(input, "slackNotificationsEnabledCount")),
    feature("structured_llm_verifier", {
      state: "not_configured",
      reason: "tenant_llm_opt_in_not_implemented"
    })
  ];
}

function githubAnalysisState(input: {
  account: TenantEntitlementAccountSummary;
  quota: TenantEntitlementQuotaSummary;
  repositories: TenantEntitlementRepositorySummary;
}): Pick<TenantEntitlementFeature, "state" | "reason"> {
  const base = activeTenantBaseState(input.account);
  if (base) return base;
  if (input.quota.state === "unavailable") return { state: "unavailable", reason: "quota_unavailable" };
  if (input.repositories.state === "unavailable") return { state: "unavailable", reason: "repository_grants_unavailable" };
  if (input.quota.state === "not_configured" || input.quota.state === "not_enforced") {
    return { state: "not_configured", reason: "quota_not_configured" };
  }
  if (input.quota.state === "exhausted") return { state: "disabled", reason: "quota_exhausted" };
  if (input.quota.state === "unclear") return { state: "unclear", reason: "quota_unclear" };
  if ((input.repositories.analysisEnabledCount ?? 0) <= 0) {
    return { state: "not_configured", reason: "no_analysis_enabled_repositories" };
  }

  return { state: "enabled" };
}

function repositoryVerificationState(input: {
  account: TenantEntitlementAccountSummary;
  repositories: TenantEntitlementRepositorySummary;
}): Pick<TenantEntitlementFeature, "state" | "reason"> {
  const base = activeTenantBaseState(input.account);
  if (base) return base;
  if (input.repositories.state === "unavailable") return { state: "unavailable", reason: "repository_grants_unavailable" };
  if ((input.repositories.connectedRepositoryCount ?? 0) <= 0) {
    return { state: "not_configured", reason: "no_connected_repositories" };
  }

  return { state: "enabled" };
}

function repoSettingState(
  input: {
    account: TenantEntitlementAccountSummary;
    repositories: TenantEntitlementRepositorySummary;
  },
  countKey: "saveReportsEnabledCount" | "commentEnabledCount" | "slackNotificationsEnabledCount"
): Pick<TenantEntitlementFeature, "state" | "reason"> {
  const base = activeTenantBaseState(input.account);
  if (base) return base;
  if (input.repositories.state === "unavailable") return { state: "unavailable", reason: "repository_grants_unavailable" };
  if ((input.repositories.connectedRepositoryCount ?? 0) <= 0) {
    return { state: "not_configured", reason: "no_connected_repositories" };
  }
  if ((input.repositories[countKey] ?? 0) <= 0) {
    return { state: "disabled", reason: "repo_setting_disabled" };
  }

  return { state: "enabled" };
}

function activeTenantBaseState(
  account: TenantEntitlementAccountSummary
): Pick<TenantEntitlementFeature, "state" | "reason"> | null {
  if (account.source === "unavailable") return { state: "unavailable", reason: "account_unavailable" };
  if (account.status !== "active" && account.status !== "trialing") return { state: "disabled", reason: "tenant_not_active" };

  return null;
}

function feature(
  key: TenantEntitlementFeatureKey,
  state: Pick<TenantEntitlementFeature, "state" | "reason">
): TenantEntitlementFeature {
  return {
    key,
    label: FEATURE_LABELS[key],
    state: state.state,
    enabled: state.state === "enabled",
    reason: state.reason
  };
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function hasDurableGrantConfig(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY);
}

function truthy(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}
