import { afterEach, describe, expect, it, vi } from "vitest";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearTenantAuthSessionsForTests, createTenantAuthSession, TENANT_AUTH_SESSION_COOKIE } from "@/lib/tenant-auth";
import { GET, PATCH } from "./route";

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

  it("updates member lifecycle metadata from a durable owner session only", async () => {
    stubDurableSupabaseAccountEnv();
    const fetchMock = mockSupabaseAccountStore([
      { tenant_id: "tenant_a", member_id: "member_owner", role: "owner", status: "active" },
      { tenant_id: "tenant_a", member_id: "member_1", role: "member", status: "active", token: "github_pat_secret_should_not_leak" }
    ]);
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({
        tenantId: "tenant_a",
        memberId: "member_1",
        role: "admin",
        status: "disabled"
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    const [patchUrl, patchInit] = patchCall as unknown as [string, RequestInit];

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      member: { memberId: "member_1", role: "admin", status: "disabled" },
      privacy: "tenant-account-member-lifecycle-metadata-only",
      next: "member_lifecycle_saved"
    });
    expect(patchUrl).toContain("select=tenant_id%2Cmember_id%2Crole%2Cstatus");
    expect(JSON.parse(String(patchInit.body))).toEqual({ role: "admin", status: "disabled" });
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("agentproof_tenant_members");
  });

  it("does not allow invite or legacy session credentials to mutate member lifecycle", async () => {
    stubSessionEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const legacySession = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const inviteResponse = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_1", role: "admin" })
    }));
    const legacyResponse = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: legacySession.sessionCookie
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_1", role: "admin" })
    }));

    expect(inviteResponse.status).toBe(403);
    expect(legacyResponse.status).toBe(403);
    await expect(inviteResponse.json()).resolves.toMatchObject({
      code: "tenant_account_member_lifecycle_durable_auth_required"
    });
    await expect(legacyResponse.json()).resolves.toMatchObject({
      code: "tenant_account_member_lifecycle_durable_auth_required"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not allow durable non-admin members to mutate member lifecycle", async () => {
    stubDurableSupabaseAccountEnv("member");
    const fetchMock = mockSupabaseAccountStore([
      { tenant_id: "tenant_a", member_id: "member_owner", role: "member", status: "active" },
      { tenant_id: "tenant_a", member_id: "owner_2", role: "owner", status: "active" }
    ]);
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner", status: "disabled" })
    }));

    expect(response.status).toBe(403);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("does not complete a member lifecycle change that would remove the last active owner", async () => {
    stubDurableSupabaseAccountEnv();
    const fetchMock = mockSupabaseAccountStore([
      { tenant_id: "tenant_a", member_id: "member_owner", role: "owner", status: "active" }
    ]);
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner", status: "disabled" })
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant account must keep at least one active owner.",
      code: "tenant_account_last_owner_required"
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("rejects cross-site account lifecycle mutations before auth or storage access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_1", role: "admin" })
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant mutations require a same-origin request.",
      code: "tenant_mutation_csrf_required"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unbounded account lifecycle payload keys without leaking submitted credentials", async () => {
    const response = await PATCH(new Request("http://localhost/api/tenants/account", {
      method: "PATCH",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tenantId: "tenant_a",
        memberId: "member_1",
        role: "admin",
        bootstrapToken: "member-bootstrap-token"
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: "Tenant account member lifecycle request must be a bounded JSON object.",
      code: "tenant_account_member_lifecycle_payload_invalid"
    });
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("bootstrapToken");
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

function stubDurableSupabaseAccountEnv(role: "owner" | "admin" | "member" = "owner") {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "team",
      members: [{ memberId: "member_owner", role, status: "active" }]
    }
  ]));
}

function mockSupabaseAccountStore(members: Array<{
  tenant_id: string;
  member_id: string;
  role: string;
  status: string;
  token?: string;
}>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("agentproof_tenants")) {
      return Response.json([
        { tenant_id: "tenant_a", name: "Tenant A", status: "active", plan: "team" }
      ]);
    }

    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      return Response.json([
        { tenant_id: "tenant_a", member_id: "member_1", role: body.role, status: body.status }
      ]);
    }

    return Response.json(members);
  });
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function sameOriginHeaders() {
  return { Origin: "http://localhost" };
}
