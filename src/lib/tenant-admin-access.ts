import { verifyTenantAdminAccess, type TenantAdminRole } from "./github-onboarding";
import { readTenantAccountSeeds } from "./tenant-accounts";
import { TenantAuthStoreError, verifyTenantAuthAccess } from "./tenant-auth";

export interface TenantAccessResult {
  authorized: boolean;
  tenantId?: string;
  memberId?: string;
  method?: "durable-session" | "session" | "invite";
  role?: TenantAdminRole;
  sessionState?: "active";
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
    durable = { authorized: false };
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

  if (await tenantAccountBlocksLegacyAccess(legacy.tenantId, env)) {
    return { authorized: false };
  }

  return legacy;
}

export function canUsePrivilegedTenantAccess(access: TenantAccessResult): boolean {
  return (access.role === "owner" || access.role === "admin")
    && (access.method === "durable-session" || access.method === "invite");
}

async function tenantAccountBlocksLegacyAccess(tenantId: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const seeds = readTenantAccountSeeds(env);
  if (!seeds) return false;

  const seed = seeds.find((item) => item.tenantId === tenantId);
  return seed?.status === "suspended" || seed?.status === "deleted";
}
