import { verifyTenantAdminAccess, type TenantAdminRole } from "./github-onboarding";
import { readTenantAccountSummary, TenantAccountStoreError } from "./tenant-accounts";
import { TenantAuthStoreError, verifyTenantAuthAccess } from "./tenant-auth";

export interface TenantAccessResult {
  authorized: boolean;
  tenantId?: string;
  memberId?: string;
  method?: "durable-session" | "session" | "invite";
  role?: TenantAdminRole;
  sessionState?: "active";
  unavailable?: true;
}

export async function verifyTenantAccess(
  input: {
    tenantId: unknown;
    inviteToken?: string;
    cookieHeader?: string | null;
  },
  env = process.env,
  now = Date.now()
): Promise<TenantAccessResult> {
  let durable: Awaited<ReturnType<typeof verifyTenantAuthAccess>>;
  try {
    durable = await verifyTenantAuthAccess({
      tenantId: input.tenantId,
      cookieHeader: input.cookieHeader
    }, env, now);
  } catch (error) {
    if (!(error instanceof TenantAuthStoreError)) throw error;
    // A durable-session lookup failure is not evidence that a signed legacy
    // invite is safe to use. Do not downgrade an outage into an authorization
    // success.
    return { authorized: false, unavailable: true };
  }

  if (durable.authorized && durable.tenantId) {
    return {
      authorized: true,
      tenantId: durable.tenantId,
      memberId: durable.memberId,
      method: "durable-session",
      role: durable.role,
      sessionState: durable.sessionState
    };
  }

  const legacy = verifyTenantAdminAccess(input, env, now);
  if (!legacy.authorized || !legacy.tenantId) return legacy;

  const accountState = await tenantAccountLegacyState(legacy.tenantId, env);
  if (accountState === "blocked") return { authorized: false };
  if (accountState === "unavailable") return { ...legacy, unavailable: true };
  return legacy;
}

export function canUsePrivilegedTenantAccess(access: TenantAccessResult): boolean {
  if (access.unavailable) return false;
  if (access.role !== "owner" && access.role !== "admin") return false;
  if (access.method === "durable-session") return true;

  // A narrowly explicit bootstrap escape hatch keeps legacy invite onboarding
  // possible for a fresh local/demo tenant. It is off by default and must not
  // be enabled for a durable tenant deployment.
  return access.method === "invite" && /^(1|true|yes|on)$/i.test(
    process.env.AGENTPROOF_ALLOW_LEGACY_PRIVILEGED_BOOTSTRAP?.trim() ?? ""
  );
}

async function tenantAccountLegacyState(tenantId: string, env: NodeJS.ProcessEnv): Promise<"allowed" | "blocked" | "unavailable"> {
  try {
    const summary = await readTenantAccountSummary({ tenantId }, env);
    return summary.account.status === "suspended" || summary.account.status === "deleted" || summary.account.status === "unknown"
      ? "blocked"
      : "allowed";
  } catch (error) {
    if (error instanceof TenantAccountStoreError) return "unavailable";
    throw error;
  }
}
