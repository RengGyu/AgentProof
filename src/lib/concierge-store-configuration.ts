/**
 * Concierge rows have foreign keys across tenant/account/session/installation,
 * repository-grant, analysis-run, and feedback tables. All of those tables
 * must live in one Supabase project. This check deliberately compares only
 * normalized project origins; it never returns or logs a service-role secret.
 */
export interface ConciergeStoreConfigurationStatus {
  configured: boolean;
  consistent: boolean;
}

const STORE_ENVIRONMENT_SOURCES = [
  {
    url: ["AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "SUPABASE_URL"],
    key: ["AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  },
  {
    url: ["AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "SUPABASE_URL"],
    key: ["AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  },
  {
    url: ["AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "SUPABASE_URL"],
    key: ["AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  },
  {
    url: ["AGENTPROOF_TENANT_GRANTS_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "SUPABASE_URL"],
    key: ["AGENTPROOF_TENANT_GRANTS_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  },
  {
    url: ["AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "SUPABASE_URL"],
    key: ["AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  }
] as const;

export function getConciergeStoreConfigurationStatus(env = process.env): ConciergeStoreConfigurationStatus {
  const concierge = readConfiguredProject(
    env,
    ["AGENTPROOF_CONCIERGE_SUPABASE_URL"],
    ["AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY"]
  );
  if (!concierge) return { configured: false, consistent: false };

  const dependencies = STORE_ENVIRONMENT_SOURCES.map((source) => readConfiguredProject(env, source.url, source.key));
  if (dependencies.some((source) => source === null)) return { configured: false, consistent: false };
  return {
    configured: true,
    consistent: dependencies.every((source) => source?.origin === concierge.origin)
  };
}

function readConfiguredProject(
  env: NodeJS.ProcessEnv,
  urlNames: readonly string[],
  keyNames: readonly string[]
): { origin: string } | null {
  const url = firstValue(env, urlNames);
  const key = firstValue(env, keyNames);
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") return null;
    return { origin: parsed.origin };
  } catch {
    return null;
  }
}

function firstValue(env: NodeJS.ProcessEnv, names: readonly string[]): string {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return "";
}
