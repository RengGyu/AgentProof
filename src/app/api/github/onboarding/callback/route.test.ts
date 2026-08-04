import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGitHubOnboardingSessionsForTests,
  createGitHubAppInstallSession
} from "@/lib/github-onboarding";
import {
  clearTenantGitHubInstallationsForTests,
  getTenantGitHubInstallationsForTests
} from "@/lib/github-installations";
import { createTenantAuthSessionForMember, clearTenantAuthSessionsForTests } from "@/lib/tenant-auth";
import {
  beginGitHubOAuth,
  bindGitHubInstallationAuthorization,
  finishGitHubOAuth,
  getGitHubOAuthConfig
} from "@/lib/public-github-auth";
import { GET } from "./route";

describe("GET /api/github/onboarding/callback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubOnboardingSessionsForTests();
    clearTenantGitHubInstallationsForTests();
    clearTenantAuthSessionsForTests();
  });

  it("clears the transient installation cookie on an invalid terminal callback", async () => {
    const response = await GET(new Request(
      "http://localhost/api/github/onboarding/callback?setup_action=install"
    ));

    expect(response.status).toBe(422);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_oauth_install=deleted");
  });

  it("activates the signed-in user's single existing App installation without exposing the OAuth token", async () => {
    stubOnboardingEnv();
    stubPublicOAuthEnv();
    vi.stubEnv("GITHUB_APP_ID", "456");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "beta",
      members: [{ memberId: "github:12345", role: "owner", status: "active" }]
    }]));
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:12345" });
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("Expected OAuth config.");
    const oauth = beginGitHubOAuth(config);
    const oauthState = new URL(oauth.authorizationUrl).searchParams.get("state");
    const identity = await finishGitHubOAuth({
      code: "oauth-code",
      state: oauthState,
      cookieHeader: oauth.stateCookie,
      tenantId: "pending"
    }, config, vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "temporary-token" }))
      .mockResolvedValueOnce(Response.json({ id: 12345 })));
    const installCookie = bindGitHubInstallationAuthorization({
      cookieHeader: identity.installCookie,
      tenantId: "tenant_a"
    }, config);
    if (!installCookie) throw new Error("Expected bound installation authorization.");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      installations: [{
        id: 321,
        app_id: 456,
        account: { id: 12345, login: "private-account", type: "User" }
      }]
    })));

    const response = await GET(new Request(
      "http://localhost/api/github/onboarding/callback?existing=1",
      {
        headers: {
          Origin: "http://localhost",
          Cookie: [session.sessionCookie, installCookie].join("; ")
        }
      }
    ));
    const json = await response.json();
    const serialized = JSON.stringify({ json, cookies: response.headers.get("Set-Cookie") });

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, installationId: 321, next: "select_repository" });
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_activation=");
    expect(getTenantGitHubInstallationsForTests()).toEqual([
      expect.objectContaining({
        tenantId: "tenant_a",
        installationId: 321,
        accountId: 12345,
        accountLogin: "private-account",
        accountType: "User"
      })
    ]);
    expect(serialized).not.toContain("temporary-token");
    expect(serialized).not.toContain("private-account");

    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unavailable = await GET(new Request(
      "http://localhost/api/github/onboarding/callback?existing=1",
      { headers: { Origin: "http://localhost", Cookie: [session.sessionCookie, installCookie].join("; ") } }
    ));

    expect(unavailable.status).toBe(503);
    expect(warning).toHaveBeenCalledWith("github_existing_installation_activation_failed", {
      store: "installation",
      reason: "not_configured"
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain("temporary-token");
    expect(JSON.stringify(warning.mock.calls)).not.toContain("tenant_a");
  });

  it("returns sanitized choices instead of requiring a typed installation id when more than one existing App installation is accessible", async () => {
    stubOnboardingEnv();
    stubPublicOAuthEnv();
    vi.stubEnv("GITHUB_APP_ID", "456");
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "beta",
      members: [{ memberId: "github:12345", role: "owner", status: "active" }]
    }]));
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:12345" });
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("Expected OAuth config.");
    const oauth = beginGitHubOAuth(config);
    const identity = await finishGitHubOAuth({
      code: "oauth-code",
      state: new URL(oauth.authorizationUrl).searchParams.get("state"),
      cookieHeader: oauth.stateCookie,
      tenantId: "pending"
    }, config, vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "temporary-token" }))
      .mockResolvedValueOnce(Response.json({ id: 12345 })));
    const installCookie = bindGitHubInstallationAuthorization({ cookieHeader: identity.installCookie, tenantId: "tenant_a" }, config);
    if (!installCookie) throw new Error("Expected bound installation authorization.");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      installations: [
        { id: 321, app_id: 456, account: { id: 12345, login: "personal-account", type: "User" } },
        { id: 654, app_id: 456, account: { id: 99999, login: "private-organization", type: "Organization" } }
      ]
    })));

    const response = await GET(new Request(
      "http://localhost/api/github/onboarding/callback?existing=1",
      { headers: { Origin: "http://localhost", Cookie: [session.sessionCookie, installCookie].join("; ") } }
    ));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      next: "choose_installation",
      installations: [
        { installationId: 321, accountLogin: "personal-account" },
        { installationId: 654, accountLogin: "private-organization" }
      ]
    });
    expect(serialized).not.toContain("temporary-token");
  });

  it("rejects automatic tenant ownership without a matching personal account proof", async () => {
    stubOnboardingEnv();
    stubPublicOAuthEnv();
    vi.stubEnv("GITHUB_APP_ID", "456");
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{
      tenantId: "gh_12345",
      name: "GitHub owner",
      status: "active",
      plan: "beta",
      members: [{ memberId: "github:12345", role: "owner", status: "active" }]
    }]));
    const session = await createTenantAuthSessionForMember({ tenantId: "gh_12345", memberId: "github:12345" });
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("Expected OAuth config.");
    const oauth = beginGitHubOAuth(config);
    const identity = await finishGitHubOAuth({
      code: "oauth-code",
      state: new URL(oauth.authorizationUrl).searchParams.get("state"),
      cookieHeader: oauth.stateCookie,
      tenantId: "pending"
    }, config, vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "temporary-token" }))
      .mockResolvedValueOnce(Response.json({ id: 12345 })));
    const installCookie = bindGitHubInstallationAuthorization({
      cookieHeader: identity.installCookie,
      tenantId: "gh_12345"
    }, config);
    if (!installCookie) throw new Error("Expected bound installation authorization.");

    let account = { id: 12345, login: "private-organization", type: "Organization" };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      installations: [{
        id: 321,
        app_id: 456,
        account
      }]
    })));

    const request = () => new Request(
      "http://localhost/api/github/onboarding/callback?existing=1",
      { headers: { Origin: "http://localhost", Cookie: [session.sessionCookie, installCookie].join("; ") } }
    );
    const organizationResponse = await GET(request());

    expect(organizationResponse.status).toBe(403);
    await expect(organizationResponse.json()).resolves.toEqual({
      error: "Existing installations require matching personal owner proof.",
      code: "github_existing_installation_owner_proof_required"
    });

    account = { id: 99999, login: "different-person", type: "User" };
    const differentUserResponse = await GET(request());
    expect(differentUserResponse.status).toBe(403);
    await expect(differentUserResponse.json()).resolves.toMatchObject({
      code: "github_existing_installation_owner_proof_required"
    });
    expect(getTenantGitHubInstallationsForTests()).toEqual([]);
  });

  it("creates a pending operator claim without exposing tenant or installation identity", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(202);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_installation_claim=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(json).toEqual({
      ok: true,
      claimExpiresAt: expect.any(String),
      operatorRequestCode: expect.any(String),
      next: "operator_approval_required"
    });
    expect(serialized).not.toContain(String(state));
    expect(serialized).not.toContain("state-secret-value");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("321");
  });

  it("rejects callback replay for the same state and nonce", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");
    const request = () => new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    );

    expect((await GET(request())).status).toBe(202);
    const replay = await GET(request());

    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({
      error: "GitHub App onboarding state is invalid or expired.",
      code: "github_onboarding_state_invalid"
    });
  });

  it("redirects browser callbacks to integrations without exposing opaque state", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { accept: "text/html", cookie: install.nonceCookie } }
    ));
    const location = response.headers.get("Location") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_installation_claim=");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(location).toContain("/tenant?");
    expect(location).toContain("githubApp=pending");
    expect(location).not.toContain("tenantId=");
    expect(location).not.toContain("installationId=");
    expect(location).not.toContain(String(state));
    expect(location).not.toContain("state-secret-value");
  });

  it("requires the browser nonce cookie before issuing activation", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: "agentproof_github_onboarding_nonce=wrong" } }
    ));

    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_oauth_install=deleted");
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App onboarding state is invalid or expired.",
      code: "github_onboarding_state_invalid"
    });
  });

  it("does not touch installation metadata before operator approval", async () => {
    stubOnboardingEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));

    expect(response.status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a bounded 503 when durable claim storage is unavailable", async () => {
    stubOnboardingEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");
    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));
    expect(response.status).toBe(503);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_oauth_install=deleted");
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App installation approval storage is unavailable.",
      code: "github_installation_claim_store_unavailable"
    });
  });

  it("rejects an installation not owned by the signed-in GitHub identity without entering the legacy claim flow", async () => {
    stubOnboardingEnv();
    stubPublicOAuthEnv();
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "beta",
      members: [{ memberId: "github:12345", role: "owner", status: "active" }]
    }]));
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:12345" });
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("Expected OAuth config.");
    const oauth = beginGitHubOAuth(config);
    const oauthState = new URL(oauth.authorizationUrl).searchParams.get("state");
    const tokenFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "temporary-token" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 12345 }), {
        status: 200, headers: { "Content-Type": "application/json" }
      }));
    const identity = await finishGitHubOAuth({
      code: "oauth-code",
      state: oauthState,
      cookieHeader: oauth.stateCookie,
      tenantId: "pending"
    }, config, tokenFetch);
    const boundCookie = bindGitHubInstallationAuthorization({
      cookieHeader: identity.installCookie,
      tenantId: "tenant_a"
    }, config);
    if (!boundCookie) throw new Error("Expected bound install cookie.");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const installState = new URL(install.installUrl).searchParams.get("state");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      installations: [{ id: 999 }]
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${installState}`,
      { headers: { Cookie: [session.sessionCookie, install.nonceCookie, boundCookie].join("; ") } }
    ));

    expect(response.status).toBe(403);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_oauth_install=deleted");
    await expect(response.json()).resolves.toMatchObject({ code: "github_installation_access_denied" });
  });

  it("uses the same pending path under strict operator-claim configuration", async () => {
    stubOnboardingEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_OPERATOR_CLAIMS_REQUIRED", "true");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));

    expect(response.status).toBe(202);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_installation_claim=");
  });
});

function stubOnboardingEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
  vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITE_TOKEN", "invite-token-value");
  vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-claim-token");
}

function stubPublicOAuthEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_ID", "github-app-client-id");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_SECRET", "github-app-client-secret");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL", "http://localhost/api/auth/github/callback");
  vi.stubEnv("AGENTPROOF_PUBLIC_AUTH_SECRET", "public-auth-secret-that-is-at-least-thirty-two-characters");
}
