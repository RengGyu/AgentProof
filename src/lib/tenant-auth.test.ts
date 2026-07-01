import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantAuthSessionsForTests,
  createTenantAuthSession,
  readTenantAuthBootstrapRecords,
  TENANT_AUTH_SESSION_COOKIE,
  verifyTenantAuthAccess,
  revokeTenantAuthSession
} from "./tenant-auth";

describe("tenant durable auth sessions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
