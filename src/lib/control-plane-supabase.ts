/**
 * Resolves the shared control-plane store without requiring duplicate secrets
 * when onboarding and tenant data intentionally use the same Supabase project.
 */
export function getControlPlaneSupabaseEnv(env: Record<string, string | undefined> = process.env) {
  return {
    url:
      env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL ||
      env.SUPABASE_URL ||
      env.AGENTPROOF_ONBOARDING_SUPABASE_URL ||
      "",
    serviceRoleKey:
      env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      env.AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY ||
      ""
  };
}

export function getSharedControlPlaneServiceRoleKey(
  url: string,
  env: Record<string, string | undefined> = process.env
) {
  const shared = getControlPlaneSupabaseEnv(env);
  const normalizedUrl = trimTrailingSlash(url);

  if (!normalizedUrl || normalizedUrl !== trimTrailingSlash(shared.url)) {
    return "";
  }

  return shared.serviceRoleKey;
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
