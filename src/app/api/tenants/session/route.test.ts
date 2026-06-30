import { afterEach, describe, expect, it, vi } from "vitest";
import { TENANT_ADMIN_SESSION_COOKIE } from "@/lib/github-onboarding";
import { DELETE, POST } from "./route";

describe("/api/tenants/session", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts a tenant admin session from a tenant-bound invite header only", async () => {
    stubSessionEnv();

    const response = await POST(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: " tenant_a " })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain(`${TENANT_ADMIN_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      expiresAt: expect.any(String),
      privacy: "tenant-admin-session-cookie-only",
      next: "use_session_cookie"
    });
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("tenant-session-secret-value");
  });

  it("ignores invite tokens in the JSON body and fails closed without a header invite", async () => {
    stubSessionEnv();

    const response = await POST(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant_a", inviteToken: "tenant-a-invite-token" })
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant session requires a valid tenant-bound invite token.",
      code: "tenant_session_unauthorized"
    });
  });

  it("rejects wrong-tenant invite headers before issuing a cookie", async () => {
    stubSessionEnv();

    const response = await POST(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_b" })
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("fails closed when the dedicated tenant session secret is missing", async () => {
    vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
      { tenantId: "tenant_a", token: "tenant-a-invite-token" }
    ]));

    const response = await POST(new Request("http://localhost/api/tenants/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
  });

  it("clears the tenant admin session cookie", async () => {
    const response = await DELETE();
    const json = await response.json();
    const cookie = response.headers.get("Set-Cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain(`${TENANT_ADMIN_SESSION_COOKIE}=deleted`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(json).toEqual({
      ok: true,
      deleted: true,
      privacy: "tenant-admin-session-cookie-only"
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
