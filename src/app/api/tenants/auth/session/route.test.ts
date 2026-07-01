import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTenantAuthSessionsForTests, TENANT_AUTH_SESSION_COOKIE, verifyTenantAuthAccess } from "@/lib/tenant-auth";
import { DELETE, POST } from "./route";

describe("/api/tenants/auth/session", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearTenantAuthSessionsForTests();
  });

  it("starts a durable tenant auth session from a member bootstrap header", async () => {
    stubTenantAuthRouteEnv();

    const response = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }));
    const json = await response.json();
    const cookie = response.headers.get("Set-Cookie") ?? "";
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(cookie).toContain(`${TENANT_AUTH_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      memberId: "member_owner",
      role: "owner",
      expiresAt: expect.any(String),
      privacy: "tenant-auth-session-cookie-only",
      next: "use_session_cookie"
    });
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("tokenHash");

    await expect(verifyTenantAuthAccess({
      tenantId: "tenant_a",
      cookieHeader: cookie
    })).resolves.toMatchObject({
      authorized: true,
      method: "durable-session",
      role: "owner"
    });
  });

  it("ignores bootstrap tokens in the JSON body", async () => {
    stubTenantAuthRouteEnv();

    const response = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        memberId: "member_owner",
        bootstrapToken: "member-bootstrap-token"
      })
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("fails closed for disabled members and unavailable session storage", async () => {
    stubTenantAuthRouteEnv();

    const disabled = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "disabled-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_disabled" })
    }));

    expect(disabled.status).toBe(401);

    vi.unstubAllEnvs();
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        status: "active",
        members: [{ memberId: "member_owner", role: "owner", status: "active" }]
      }
    ]));
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
      { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }
    ]));
    const unavailable = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }));

    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: "Tenant auth session storage is unavailable.",
      code: "tenant_auth_session_unavailable"
    });
  });

  it("revokes and clears the durable tenant auth session cookie", async () => {
    stubTenantAuthRouteEnv();
    const start = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }));
    const startCookie = start.headers.get("Set-Cookie") ?? "";

    const response = await DELETE(new Request("http://localhost/api/tenants/auth/session", {
      method: "DELETE",
      headers: { cookie: startCookie }
    }));
    const json = await response.json();
    const clearCookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(200);
    expect(clearCookie).toContain(`${TENANT_AUTH_SESSION_COOKIE}=deleted`);
    expect(clearCookie).toContain("Max-Age=0");
    expect(json).toEqual({
      ok: true,
      deleted: true,
      privacy: "tenant-auth-session-cookie-only"
    });
    await expect(verifyTenantAuthAccess({
      tenantId: "tenant_a",
      cookieHeader: startCookie
    })).resolves.toEqual({ authorized: false });
  });
});

function stubTenantAuthRouteEnv() {
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
    }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" },
    { tenantId: "tenant_a", memberId: "member_disabled", token: "disabled-bootstrap-token" }
  ]));
}
