import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantAuthSessionsForTests,
  createTenantAuthSession,
  readTenantAuthBootstrapRecords,
  resolveTenantAuthAccess,
  TENANT_AUTH_SESSION_COOKIE,
  verifyTenantAuthAccess,
  revokeTenantAuthSession
} from "./tenant-auth";

describe("tenant durable auth sessions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTenantAuthSessionsForTests();
  });

  it("creates and verifies a durable active member session without exposing bootstrap secrets", async () => {
    stubTenantAuthEnv();

    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });
    const access = await verifyTenantAuthAccess({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    });
    const resolvedAccess = await resolveTenantAuthAccess({ cookieHeader: session.sessionCookie });
    const serialized = JSON.stringify(session);

    expect(session).toMatchObject({
      tenantId: "tenant_a",
      memberId: "member_owner",
      role: "owner",
      expiresAt: expect.any(String)
    });
    expect(session.sessionCookie).toContain(`${TENANT_AUTH_SESSION_COOKIE}=`);
    expect(session.sessionCookie).toContain("HttpOnly");
    expect(session.sessionCookie).toContain("Secure");
    expect(session.sessionCookie).toContain("SameSite=Lax");
    expect(access).toEqual({
      authorized: true,
      tenantId: "tenant_a",
      memberId: "member_owner",
      role: "owner",
      method: "durable-session",
      sessionState: "active"
    });
    expect(resolvedAccess).toEqual(access);
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("tokenHash");
  });

  it("denies wrong-tenant, revoked, and expired durable sessions", async () => {
    stubTenantAuthEnv();
    const now = Date.parse("2026-07-01T00:00:00.000Z");
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    }, process.env, now);

    await expect(verifyTenantAuthAccess({
      tenantId: "tenant_b",
      cookieHeader: session.sessionCookie
    }, process.env, now)).resolves.toEqual({ authorized: false });

    await expect(verifyTenantAuthAccess({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    }, process.env, now + 13 * 60 * 60 * 1000)).resolves.toEqual({ authorized: false });

    await revokeTenantAuthSession({ cookieHeader: session.sessionCookie }, process.env, now + 1_000);
    await expect(verifyTenantAuthAccess({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    }, process.env, now + 2_000)).resolves.toEqual({ authorized: false });
  });

  it("fails closed for disabled members and unavailable tenant states", async () => {
    stubTenantAuthEnv();

    await expect(createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_disabled",
      bootstrapToken: "disabled-bootstrap-token"
    })).rejects.toThrow("Tenant auth member is not active.");

    await expect(createTenantAuthSession({
      tenantId: "tenant_suspended",
      memberId: "member_owner",
      bootstrapToken: "suspended-bootstrap-token"
    })).rejects.toThrow("Tenant auth member is not active.");
  });

  it("drops malformed bootstrap records instead of treating them as auth facts", () => {
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
      { tenantId: "tenant_a", memberId: "member_owner", token: "short" }
    ]));

    expect(readTenantAuthBootstrapRecords()).toBeNull();
  });

  it("requires an exact durable revoke representation instead of trusting HTTP success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      expect((init?.headers as Record<string, string>).Prefer).toBe("return=representation");
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const env = {
      NODE_ENV: "test" as const,
      AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL: "https://example.supabase.co",
      AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
    };
    await expect(revokeTenantAuthSession({ cookieHeader: `${TENANT_AUTH_SESSION_COOKIE}=opaque-session-token` }, env, Date.parse("2026-07-20T00:00:00.000Z"))).rejects.toThrow("not durably confirmed");
  });

  it("accepts a durable revoke only when exactly one matching timestamp is returned", async () => {
    const revokedAt = "2026-07-20T00:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ id: "session-record-id-123456", revoked_at: revokedAt }])));
    const env = {
      NODE_ENV: "test" as const,
      AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL: "https://example.supabase.co",
      AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
    };
    await expect(revokeTenantAuthSession({ cookieHeader: `${TENANT_AUTH_SESSION_COOKIE}=opaque-session-token` }, env, Date.parse(revokedAt))).resolves.toBeUndefined();
  });

  it("uses the atomic session RPC and rejects an existing-active outcome", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return Response.json([{ outcome: calls.length === 1 ? "created" : "active_exists" }]);
    }));
    const env = {
      NODE_ENV: "test" as const,
      AGENTPROOF_TENANT_ACCOUNTS: JSON.stringify([{ tenantId: "tenant_a", name: "Tenant A", status: "active", plan: "team", members: [{ memberId: "member_owner", role: "owner", status: "active" }] }]),
      AGENTPROOF_TENANT_AUTH_BOOTSTRAPS: JSON.stringify([{ tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }]),
      AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL: "https://example.supabase.co",
      AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
    };

    await expect(createTenantAuthSession({ tenantId: "tenant_a", memberId: "member_owner", bootstrapToken: "member-bootstrap-token" }, env)).resolves.toMatchObject({ tenantId: "tenant_a", memberId: "member_owner" });
    await expect(createTenantAuthSession({ tenantId: "tenant_a", memberId: "member_owner", bootstrapToken: "member-bootstrap-token" }, env)).rejects.toThrow("already active");
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url === "https://example.supabase.co/rest/v1/rpc/agentproof_create_tenant_auth_session")).toBe(true);
    expect(calls[0]?.body).toMatchObject({ p_tenant_id: "tenant_a", p_member_id: "member_owner", p_token_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(calls)).not.toContain("member-bootstrap-token");
  });
});

function stubTenantAuthEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "team",
      members: [
        { memberId: "member_owner", role: "owner", status: "active" },
        { memberId: "member_disabled", role: "admin", status: "disabled" }
      ]
    },
    {
      tenantId: "tenant_suspended",
      name: "Tenant Suspended",
      status: "suspended",
      plan: "team",
      members: [
        { memberId: "member_owner", role: "owner", status: "active" }
      ]
    }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" },
    { tenantId: "tenant_a", memberId: "member_disabled", token: "disabled-bootstrap-token" },
    { tenantId: "tenant_suspended", memberId: "member_owner", token: "suspended-bootstrap-token" }
  ]));
}
