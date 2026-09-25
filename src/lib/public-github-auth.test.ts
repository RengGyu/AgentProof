import { createHash } from "crypto";
import { describe, expect, it, vi } from "vitest";
import {
  beginGitHubOAuth,
  clearGitHubOAuthInstallCookie,
  clearGitHubOAuthStateCookie,
  finishGitHubOAuth,
  getGitHubOAuthAccess,
  GitHubOAuthError,
  verifyGitHubInstallationAccess,
  type GitHubOAuthConfig
} from "./public-github-auth";

const config: GitHubOAuthConfig = {
  clientId: "github-app-client-id",
  clientSecret: "github-app-client-secret",
  callbackUrl: "https://agentproof.example/api/auth/github/callback",
  secret: "public-auth-secret-that-is-at-least-thirty-two-characters"
};

describe("public GitHub OAuth cookies", () => {
  it("limits the OAuth state cookie to the OAuth callback path", () => {
    const started = beginGitHubOAuth(config, Date.UTC(2026, 7, 4));

    expect(started.stateCookie).toContain("Path=/api/auth/github/callback");
    expect(started.stateCookie).not.toContain("Path=/;");
  });

  it("limits and expires the installation authorization cookie to the shared API callback prefix", () => {
    const expired = clearGitHubOAuthInstallCookie(Date.UTC(2026, 7, 4));

    expect(expired).toContain("Path=/api;");
    expect(expired).not.toContain("Path=/;");
    expect(expired).toContain("Max-Age=0");
  });

  it("expires the OAuth state cookie at the same narrow callback path", () => {
    const expired = clearGitHubOAuthStateCookie(Date.UTC(2026, 7, 4));

    expect(expired).toContain("Path=/api/auth/github/callback");
    expect(expired).toContain("Max-Age=0");
  });

  it("rejects a forged state before exchanging a token", async () => {
    const started = beginGitHubOAuth(config, Date.UTC(2026, 7, 4));
    const fetchMock = vi.fn();

    await expect(finishGitHubOAuth({
      code: "oauth-code",
      state: "forged-state",
      cookieHeader: started.stateCookie,
      tenantId: "pending"
    }, config, fetchMock, Date.UTC(2026, 7, 4))).rejects.toBeInstanceOf(GitHubOAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an expired PKCE state before exchanging a token", async () => {
    const startedAt = Date.UTC(2026, 7, 4);
    const started = beginGitHubOAuth(config, startedAt);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const fetchMock = vi.fn();

    await expect(finishGitHubOAuth({
      code: "oauth-code",
      state,
      cookieHeader: started.stateCookie,
      tenantId: "pending"
    }, config, fetchMock, startedAt + 16 * 60 * 1000)).rejects.toBeInstanceOf(GitHubOAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when GitHub token exchange fails", async () => {
    const startedAt = Date.UTC(2026, 7, 4);
    const started = beginGitHubOAuth(config, startedAt);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "bad_verification_code" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    }));

    await expect(finishGitHubOAuth({
      code: "oauth-code",
      state,
      cookieHeader: started.stateCookie,
      tenantId: "pending"
    }, config, fetchMock, startedAt)).rejects.toThrow("token exchange failed");
  });

  it("captures a renewable GitHub App token pair with provider lifetimes", async () => {
    const now = Date.UTC(2026, 7, 4);
    const started = beginGitHubOAuth(config, now);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "ghu-test", expires_in: 28_800, refresh_token: "ghr-test", refresh_token_expires_in: 15_897_600 })).mockResolvedValueOnce(Response.json({ id: 123 }));
    const result = await finishGitHubOAuth({ code: "code", state: new URL(started.authorizationUrl).searchParams.get("state"), cookieHeader: started.stateCookie, tenantId: "gh_123" }, config, fetchMock, now);
    expect(result.credentials).toEqual({ accessToken: "ghu-test", accessExpiresAt: now + 28_800_000, refreshToken: "ghr-test", refreshExpiresAt: now + 15_897_600_000 });
  });

  it("rejects an expiring access token without a renewable pair", async () => {
    const now = Date.UTC(2026, 7, 4);
    const started = beginGitHubOAuth(config, now);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "ghu-test", expires_in: 28_800 }));
    await expect(finishGitHubOAuth({ code: "code", state: new URL(started.authorizationUrl).searchParams.get("state"), cookieHeader: started.stateCookie, tenantId: "gh_123" }, config, fetchMock, now)).rejects.toThrow("renewable credential");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not authorize an installation owned by another GitHub account", async () => {
    const startedAt = Date.UTC(2026, 7, 4);
    const started = beginGitHubOAuth(config, startedAt);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "temporary-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 12345 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    const identity = await finishGitHubOAuth({
      code: "oauth-code",
      state,
      cookieHeader: started.stateCookie,
      tenantId: "tenant_a"
    }, config, fetchMock, startedAt);
    const tokenRequest = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const challenge = createHash("sha256").update(tokenRequest.code_verifier).digest("base64url");
    expect(new URL(started.authorizationUrl).searchParams.get("code_challenge")).toBe(challenge);
    expect(tokenRequest.code_verifier).not.toBe(challenge);
    const installationFetch = vi.fn(async () => new Response(JSON.stringify({
      installations: [{ id: 999 }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(verifyGitHubInstallationAccess({
      cookieHeader: identity.installCookie,
      tenantId: "tenant_a",
      installationId: 321, appId: 456
    }, config, installationFetch, startedAt)).resolves.toBe(false);
  });

  it("keeps the temporary user credential tenant-bound and expires it independently", async () => {
    const now = Date.UTC(2026, 7, 4);
    const started = beginGitHubOAuth(config, now);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "temporary-user-token" })).mockResolvedValueOnce(Response.json({ id: 123 }));
    const identity = await finishGitHubOAuth({ code: "code", state: new URL(started.authorizationUrl).searchParams.get("state"), cookieHeader: started.stateCookie, tenantId: "gh_123" }, config, fetchMock, now);
    expect(getGitHubOAuthAccess({ cookieHeader: identity.installCookie, tenantId: "gh_123" }, config, now)).toEqual({ accessToken: "temporary-user-token", githubUserId: "123" });
    expect(getGitHubOAuthAccess({ cookieHeader: identity.installCookie, tenantId: "gh_456" }, config, now)).toBeNull();
    expect(getGitHubOAuthAccess({ cookieHeader: identity.installCookie, tenantId: "gh_123" }, config, now + 16 * 60_000)).toBeNull();
  });
});

it.each(['/analyze', '/dashboard', 'https://attacker.example', '//attacker.example', '/analyze?secret=value'])("allowlists signed OAuth return path %s", async destination => {
  const now = Date.now();
  const started = beginGitHubOAuth(config, now, destination);
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'test-token' })).mockResolvedValueOnce(Response.json({ id: 123 }));
  const result = await finishGitHubOAuth({ code: 'code', state: new URL(started.authorizationUrl).searchParams.get('state'), cookieHeader: started.stateCookie, tenantId: 'pending' }, config, fetchMock, now);
  expect(result.returnTo).toBe(destination === '/analyze' ? '/analyze' : '/dashboard');
});
