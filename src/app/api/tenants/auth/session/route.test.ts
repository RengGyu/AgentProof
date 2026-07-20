import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAuditEventsForTests, getAuditEventsForTests } from "@/lib/audit-log";
import { clearTenantAuthSessionsForTests, TENANT_AUTH_SESSION_COOKIE, verifyTenantAuthAccess } from "@/lib/tenant-auth";
import { DELETE, POST } from "./route";

describe("/api/tenants/auth/session", () => {
  afterEach(() => {
    clearAuditEventsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTenantAuthSessionsForTests();
  });

  it("starts a durable tenant auth session from a member bootstrap header", async () => {
    stubTenantAuthRouteEnv();

    const response = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
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

  it("rejects replacement while an existing browser session cookie is present", async () => {
    stubTenantAuthRouteEnv();
    const first = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }));
    const firstCookie = first.headers.get("Set-Cookie") ?? "";

    const replacements = await Promise.all(Array.from({ length: 20 }, () => POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: firstCookie,
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }))));
    expect(replacements.map((response) => response.status)).toEqual(Array(20).fill(409));
    expect(replacements.every((response) => response.headers.get("Set-Cookie") === null)).toBe(true);
    await expect(replacements[0]?.json()).resolves.toEqual({
      error: "End the existing durable browser session before starting another.",
      code: "tenant_auth_session_already_present"
    });
    await expect(verifyTenantAuthAccess({ tenantId: "tenant_a", cookieHeader: firstCookie })).resolves.toMatchObject({ authorized: true, memberId: "member_owner" });
  });

  it("allows only one active session across concurrent cookie-free starts", async () => {
    stubTenantAuthRouteEnv();
    const responses = await Promise.all(Array.from({ length: 20 }, () => POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }))));

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(19);
    const conflicts = await Promise.all(responses.filter((response) => response.status === 409).map((response) => response.json()));
    expect(conflicts.every((value) => value.code === "tenant_auth_session_already_active")).toBe(true);
  });

  it("ignores bootstrap tokens in the JSON body", async () => {
    stubTenantAuthRouteEnv();

    const response = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: { ...sameOriginHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        memberId: "member_owner",
        bootstrapToken: "member-bootstrap-token"
      })
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const serialized = JSON.stringify(getAuditEventsForTests());
    expect(getAuditEventsForTests()).toEqual([
      expect.objectContaining({
        action: "tenant_auth_session_failed",
        result: "failed",
        actor: "system",
        tenant_id: "tenant_a",
        status_code: 401,
        metadata: { code: "bootstrap_or_member_invalid" }
      })
    ]);
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("bootstrapToken");
    expect(serialized).not.toContain("cookie");
  });

  it("fails closed for disabled members and unavailable session storage", async () => {
    stubTenantAuthRouteEnv();

    const disabled = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
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
        ...sameOriginHeaders(),
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
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }));
    const startCookie = start.headers.get("Set-Cookie") ?? "";

    const response = await DELETE(new Request("http://localhost/api/tenants/auth/session", {
      method: "DELETE",
      headers: { ...sameOriginHeaders(), cookie: startCookie }
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

  it("clears the browser cookie but fails closed when durable revocation is unconfirmed", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY", "placeholder");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    const response = await DELETE(new Request("http://localhost/api/tenants/auth/session", {
      method: "DELETE",
      headers: { ...sameOriginHeaders(), cookie: `${TENANT_AUTH_SESSION_COOKIE}=opaque-session-token` }
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Set-Cookie")).toContain(`${TENANT_AUTH_SESSION_COOKIE}=deleted`);
    await expect(response.json()).resolves.toEqual({
      error: "The browser cookie was cleared, but durable session revocation could not be confirmed.",
      code: "tenant_auth_session_revoke_unconfirmed",
      deleted: false
    });
    expect(getAuditEventsForTests()).toEqual([
      expect.objectContaining({ action: "tenant_auth_session_failed", result: "failed", status_code: 503, metadata: { code: "session_revoke_unconfirmed" } })
    ]);
  });

  it("rejects cross-site durable auth session creation without issuing a cookie", async () => {
    stubTenantAuthRouteEnv();

    const response = await POST(new Request("http://localhost/api/tenants/auth/session", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "Content-Type": "application/json",
        "x-agentproof-tenant-auth-token": "member-bootstrap-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a", memberId: "member_owner" })
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant mutations require a same-origin request.",
      code: "tenant_mutation_csrf_required"
    });
    expect(JSON.stringify(getAuditEventsForTests())).not.toContain("member-bootstrap-token");
    expect(getAuditEventsForTests()).toEqual([
      expect.objectContaining({
        action: "tenant_auth_session_failed",
        result: "failed",
        status_code: 403,
        metadata: { code: "origin_mismatch" }
      })
    ]);
  });

  it("rejects cross-site durable auth session deletion without clearing cookies", async () => {
    const response = await DELETE(new Request("http://localhost/api/tenants/auth/session", {
      method: "DELETE",
      headers: { Origin: "https://attacker.example", cookie: `${TENANT_AUTH_SESSION_COOKIE}=opaque` }
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant mutations require a same-origin request.",
      code: "tenant_mutation_csrf_required"
    });
  });
});

function sameOriginHeaders() {
  return { Origin: "http://localhost" };
}

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
