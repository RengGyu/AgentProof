import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/tenants/account", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires tenant admin access", async () => {
    stubSessionEnv();

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Tenant account status requires a valid tenant-bound invite token.",
      code: "tenant_account_unauthorized"
    });
  });

  it("returns account and role metadata from tenant-bound invites without exposing invite tokens", async () => {
    stubSessionEnv();
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        name: "AgentProof Team",
        status: "active",
        plan: "team",
        members: [
          { memberId: "owner_1", role: "owner", status: "active", email: "owner@example.com" },
          { memberId: "admin_1", role: "admin", status: "invited" },
          { memberId: "member_1", role: "member", status: "active" }
        ]
      }
    ]));

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      account: {
        tenantId: "tenant_a",
        name: "AgentProof Team",
        status: "active",
        plan: "team",
        configured: true,
        memberCount: 3
      },
      members: [
        { memberId: "owner_1", role: "owner", status: "active" },
        { memberId: "admin_1", role: "admin", status: "invited" },
        { memberId: "member_1", role: "member", status: "active" }
      ],
      roleCounts: {
        owner: 1,
        admin: 1,
        member: 1
      },
      privacy: "tenant-account-summary-only",
      next: "manage_member_roles"
    });
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("tenant-session-secret");
    expect(serialized).not.toContain("owner@example.com");
  });

  it("returns a session-derived fallback without pretending the account store is configured", async () => {
    stubSessionEnv();

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      account: {
        tenantId: "tenant_a",
        name: "tenant_a",
        status: "invite-only",
        plan: "beta",
        configured: false,
        memberCount: 0
      },
      members: [],
      privacy: "tenant-account-summary-only",
      next: "configure_account_store"
    });
  });

  it("does not authorize a wrong-tenant invite", async () => {
    stubSessionEnv();

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_b", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(401);
  });

  it("fails closed for invalid account seed configuration", async () => {
    stubSessionEnv();
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      { tenantId: "tenant_a", members: "owner@example.com" }
    ]));

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Tenant account status is unavailable.",
      code: "tenant_account_unavailable"
    });
  });
});

function stubSessionEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" },
    { tenantId: "tenant_b", token: "tenant-b-invite-token" }
  ]));
}
