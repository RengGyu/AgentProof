import { afterEach, describe, expect, it, vi } from "vitest";
import { canUsePrivilegedTenantAccess, verifyTenantAccess } from "./tenant-admin-access";

describe("tenant admin access fail-closed boundaries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("does not fall back to a legacy invite when durable account lookup is unavailable", async () => {
    vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
      { tenantId: "tenant_a", token: "tenant-a-invite-token", role: "owner" }
    ]));
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));

    await expect(verifyTenantAccess({ tenantId: "tenant_a", inviteToken: "tenant-a-invite-token" })).resolves.toMatchObject({
      authorized: true,
      unavailable: true
    });
  });

  it("requires an explicit local bootstrap flag before an invite can perform a privileged mutation", () => {
    const inviteOwner = { authorized: true, tenantId: "tenant_a", method: "invite" as const, role: "owner" as const };

    expect(canUsePrivilegedTenantAccess(inviteOwner)).toBe(false);
    vi.stubEnv("AGENTPROOF_ALLOW_LEGACY_PRIVILEGED_BOOTSTRAP", "true");
    expect(canUsePrivilegedTenantAccess(inviteOwner)).toBe(true);
  });
});
