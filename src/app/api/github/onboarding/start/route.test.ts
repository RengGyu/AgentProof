import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGitHubOnboardingSessionsForTests, createTenantAdminSession } from "@/lib/github-onboarding";
import { clearTenantAuthSessionsForTests, createTenantAuthSession } from "@/lib/tenant-auth";
import { POST } from "./route";

describe("POST /api/github/onboarding/start", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubOnboardingSessionsForTests();
    clearTenantAuthSessionsForTests();
  });

  it("starts invite-only onboarding with an opaque state and nonce cookie", async () => {
    stubOnboardingEnv();

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();
    const state = new URL(json.installUrl).searchParams.get("state") ?? "";
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_onboarding_nonce=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(json).toMatchObject({
      ok: true,
      stateExpiresAt: expect.any(String),
      privacy: "state-only-no-tokens-stored",
      next: "install_github_app"
    });
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(state).not.toContain("tenant_a");
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("state-secret-value");
  });

  it("starts onboarding from a durable tenant auth session cookie without an invite header", async () => {
    stubOnboardingEnv();
    stubDurableAuthEnv();
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: { ...sameOriginHeaders(), cookie: session.sessionCookie },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "state-only-no-tokens-stored",
      next: "install_github_app"
    });
    expect(JSON.stringify(json)).not.toContain("member-bootstrap-token");
  });

  it("does not treat a stateless tenant admin session as privileged onboarding authorization", async () => {
    stubOnboardingEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: { ...sameOriginHeaders(), cookie: session.sessionCookie },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App onboarding requires an owner or admin role.",
      code: "github_onboarding_role_required"
    });
  });

  it("rejects missing or invalid invite tokens before creating state", async () => {
    stubOnboardingEnv();

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "x-agentproof-beta-invite-token": "wrong"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App onboarding requires valid tenant authorization.",
      code: "github_onboarding_invite_required"
    });
  });

  it("requires owner or admin role before starting onboarding", async () => {
    stubOnboardingEnv("member");

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "GitHub App onboarding requires an owner or admin role.",
      code: "github_onboarding_role_required"
    });
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("tenant-a-invite-token");
  });

  it("requires tenant-bound invites when scoped beta invite records are configured", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
    vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
    vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
      {
        tenantId: "tenant_a",
        token: "tenant-a-invite-token",
        role: "owner"
      }
    ]));
    vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_ALLOW_LEGACY_PRIVILEGED_BOOTSTRAP", "true");

    const wrongTenant = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_b" })
    }));
    const rightTenant = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(wrongTenant.status).toBe(401);
    expect(rightTenant.status).toBe(200);
  });

  it("fails closed when configured but no onboarding state store is available", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
    vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
    vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
      { tenantId: "tenant_a", token: "tenant-a-invite-token", role: "owner" }
    ]));
    vi.stubEnv("AGENTPROOF_ALLOW_LEGACY_PRIVILEGED_BOOTSTRAP", "true");

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App onboarding state store is unavailable.",
      code: "github_onboarding_state_store_unavailable"
    });
  });

  it("rejects cross-site onboarding start before creating a nonce cookie", async () => {
    stubOnboardingEnv();

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
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

function stubOnboardingEnv(role: "owner" | "admin" | "member" = "owner") {
  vi.stubEnv("AGENTPROOF_ALLOW_LEGACY_PRIVILEGED_BOOTSTRAP", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
  vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token", role }
  ]));
  vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");
}

function stubDurableAuthEnv(role: "owner" | "admin" | "member" = "owner", status: "active" | "disabled" = "active") {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "team",
      members: [
        { memberId: "member_owner", role, status }
      ]
    }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }
  ]));
}
