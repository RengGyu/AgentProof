import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearTenantAuthSessionsForTests, createTenantAuthSession, TENANT_AUTH_SESSION_COOKIE } from "@/lib/tenant-auth";
import { GET } from "./route";

describe("GET /api/tenants/account", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTenantAuthSessionsForTests();
  });

  it("requires tenant admin access", async () => {
    stubSessionEnv();

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a"));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Tenant account status requires valid tenant authorization.",
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
        memberCount: 3,
        membersTruncated: false
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
        memberCount: 0,
        membersTruncated: false
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

  it("accepts a tenant admin session cookie without an invite header", async () => {
    stubSessionEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "tenant-account-summary-only"
    });
  });

  it("accepts a durable tenant auth session cookie without an invite header", async () => {
    stubSessionEnv();
    stubDurableAuthEnv();
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      account: {
        tenantId: "tenant_a",
        status: "active",
        plan: "team",
        configured: true
      },
      privacy: "tenant-account-summary-only"
    });
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("tokenHash");
  });

  it("fails closed with bounded JSON when durable tenant auth storage is incomplete", async () => {
    stubSessionEnv();
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL", "https://tenant-auth.example.supabase.co");

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { cookie: `${TENANT_AUTH_SESSION_COOKIE}=opaque-session-token` }
    }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Tenant account status requires valid tenant authorization.",
      code: "tenant_account_unauthorized"
    });
  });

  it("rejects a wrong-tenant admin session cookie before reading account status", async () => {
    stubSessionEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_b",
      inviteToken: "tenant-b-invite-token"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/account?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
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

function stubDurableAuthEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "team",
      members: [
        { memberId: "member_owner", role: "owner", status: "active" }
      ]
    }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }
  ]));
}
