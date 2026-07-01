import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGitHubOnboardingSessionsForTests, createTenantAdminSession } from "@/lib/github-onboarding";
import { POST } from "./route";

describe("POST /api/github/onboarding/start", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubOnboardingSessionsForTests();
  });

  it("starts invite-only onboarding with an opaque state and nonce cookie", async () => {
    stubOnboardingEnv();

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
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

  it("starts onboarding from a tenant admin session cookie without an invite header", async () => {
    stubOnboardingEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: { cookie: session.sessionCookie },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "state-only-no-tokens-stored",
      next: "install_github_app"
    });
  });

  it("rejects missing or invalid invite tokens before creating state", async () => {
    stubOnboardingEnv();

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        "x-agentproof-beta-invite-token": "wrong"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Invite token is required for GitHub App onboarding.",
      code: "github_onboarding_invite_required"
    });
  });

  it("requires tenant-bound invites when scoped beta invite records are configured", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
    vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
    vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
      {
        tenantId: "tenant_a",
        token: "tenant-a-invite-token"
      }
    ]));
    vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");

    const wrongTenant = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_b" })
    }));
    const rightTenant = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
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
      { tenantId: "tenant_a", token: "tenant-a-invite-token" }
    ]));

    const response = await POST(new Request("http://localhost/api/github/onboarding/start", {
      method: "POST",
      headers: {
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
});

function stubOnboardingEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
  vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" }
  ]));
  vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");
}
