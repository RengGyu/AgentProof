import { getControlPlaneSupabaseEnv } from "./control-plane-supabase";

const tables = new Set(["agentproof_tenants", "agentproof_tenant_members", "agentproof_github_identities", "agentproof_tenant_auth_sessions", "agentproof_tenant_deletion_state", "agentproof_saved_reports", "agentproof_analysis_jobs", "agentproof_tenant_repository_grants", "agentproof_github_installations", "agentproof_github_installation_claims", "agentproof_github_onboarding_states", "agentproof_github_webhook_deliveries", "agentproof_usage_records", "agentproof_audit_events", "agentproof_billing_subscriptions", "agentproof_billing_webhook_events", "agentproof_concierge_analysis_runs", "agentproof_concierge_feedback"]);
export type PersonalDeletionStore = { url: string; key: string; requiredTables: string[] };
export function personalDeletionStore(env = process.env): PersonalDeletionStore | null {
  if (env.AGENTPROOF_SELF_SERVICE_DELETION_ENABLED !== "true") return null;
  return configuredPersonalDeletionStore(env);
}

function configuredPersonalDeletionStore(env: NodeJS.ProcessEnv): PersonalDeletionStore | null {
  const shared = getControlPlaneSupabaseEnv(env);
  const url = shared.url.replace(/\/+$/, "");
  if (!url || !shared.serviceRoleKey || !(env.CRON_SECRET?.trim() || env.AGENTPROOF_CRON_TOKEN?.trim())) return null;
  // These stores otherwise use process memory, which a database transaction
  // cannot purge across running instances. Require durable storage up front.
  if ((/^(true|1|yes|on)$/i.test(env.AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED ?? "")
    || env.AGENTPROOF_USAGE_SUPABASE_URL || env.AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY)
    && (!env.AGENTPROOF_USAGE_SUPABASE_URL || !env.AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY)) return null;
  // One transactional purge cannot silently omit another configured database
  // or environment-backed identity/grant/billing data.
  for (const [name, value] of Object.entries(env)) {
    if (!value) continue;
    if (name.startsWith("AGENTPROOF_") && name.endsWith("_ALLOW_MEMORY") && /^(true|1|yes|on)$/i.test(value)) return null;
    if ((name === "SUPABASE_URL" || name.endsWith("_SUPABASE_URL")) && value.replace(/\/+$/, "") !== url) return null;
    if (name.startsWith("AGENTPROOF_") && name.endsWith("_TABLE") && !tables.has(value)) return null;
  }
  for (const name of ["AGENTPROOF_TENANT_ACCOUNTS", "AGENTPROOF_BETA_INVITES", "AGENTPROOF_TENANT_DELETION_TOMBSTONES", "AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", "AGENTPROOF_TENANT_REPOSITORY_GRANTS", "AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS"]) {
    if (env[name]?.trim() && env[name]?.trim() !== "[]") return null;
  }
  const requiredTables = [...tables].filter(table => !table.startsWith("agentproof_billing_"));
  if (env.AGENTPROOF_BILLING_SUBSCRIPTIONS_SUPABASE_URL) requiredTables.push("agentproof_billing_subscriptions");
  if (env.AGENTPROOF_BILLING_WEBHOOK_SUPABASE_URL) requiredTables.push("agentproof_billing_webhook_events");
  return { url, key: shared.serviceRoleKey, requiredTables };
}

export async function personalDeletionRpc(config: PersonalDeletionStore, name: string, body: Record<string, unknown>) {
  const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST", cache: "no-store",
    headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error("Account deletion storage is unavailable.");
  return response.json() as Promise<unknown>;
}

export async function continuePersonalAccountDeletions(env = process.env) {
  // The intake flag cannot cancel accepted requests or stop receipt expiry.
  // Configuration and RPC failures still fail closed, even when intake is off.
  const config = configuredPersonalDeletionStore(env);
  if (!config) throw new Error("Account deletion storage is unavailable.");
  const result = await personalDeletionRpc(config, "agentproof_continue_personal_deletions", {}) as { completed?: unknown; pending?: unknown };
  if (!Number.isSafeInteger(result?.completed) || !Number.isSafeInteger(result?.pending)
    || Number(result.completed) < 0 || Number(result.pending) < 0) throw new Error("Invalid deletion continuation result.");
  return result;
}
