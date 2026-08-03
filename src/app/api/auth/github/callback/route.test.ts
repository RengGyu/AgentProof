import { afterEach, describe, expect, it, vi } from "vitest";
import { beginGitHubOAuth, getGitHubOAuthConfig } from "@/lib/public-github-auth";
import { GET } from "./route";

describe("GET /api/auth/github/callback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("clears both temporary OAuth cookies when token exchange fails", async () => {
    stubOAuthEnv();
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("Expected OAuth config.");
    const started = beginGitHubOAuth(config);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "bad_verification_code" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    })));

    const response = await GET(new Request(
      `http://localhost/api/auth/github/callback?code=bad-code&state=${state}`,
      { headers: { Cookie: `${started.stateCookie}; agentproof_github_oauth_install=old; agentproof_tenant_auth_session=keep` } }
    ));
    const cookies = response.headers.get("set-cookie") ?? "";
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(401);
    expect(cookies).toContain("agentproof_github_oauth_state=deleted");
    expect(cookies).toContain("agentproof_github_oauth_install=deleted");
    expect(cookies).not.toContain("agentproof_tenant_auth_session=deleted");
    expect(serialized).not.toContain("bad-code");
    expect(serialized).not.toContain("old");
  });

  it("creates the owner tenant and durable session through the public callback without exposing GitHub data", async () => {
    stubOAuthEnv();
    vi.stubEnv("SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const config = getGitHubOAuthConfig();
    if (!config) throw new Error("Expected OAuth config.");
    const started = beginGitHubOAuth(config);
    const state = new URL(started.authorizationUrl).searchParams.get("state");
    let identityReads = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://github.com/login/oauth/access_token") {
        return Response.json({ access_token: "temporary-oauth-token" });
      }
      if (url === "https://api.github.com/user") return Response.json({ id: 12345, login: "private-login" });
      if (url.includes("/agentproof_github_identities") && init?.method === "GET") {
        identityReads += 1;
        return Response.json(identityReads === 1 ? [] : [{ tenant_id: "gh_12345", member_id: "github:12345" }]);
      }
      if (url.includes("/agentproof_tenants") && init?.method === "GET") {
        return Response.json([{ tenant_id: "gh_12345", name: "GitHub beta workspace", status: "active", plan: "beta" }]);
      }
      if (url.includes("/agentproof_tenant_members") && init?.method === "GET") {
        return Response.json([{ tenant_id: "gh_12345", member_id: "github:12345", role: "owner", status: "active" }]);
      }
      if (init?.method === "POST") return new Response(null, { status: 204 });
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      `http://localhost/api/auth/github/callback?code=oauth-code&state=${state}`,
      { headers: { Cookie: started.stateCookie } }
    ));
    const cookies = response.headers.get("set-cookie") ?? "";
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(cookies).toContain("agentproof_github_oauth_state=deleted");
    expect(cookies).toContain("agentproof_github_oauth_install=");
    expect(cookies).toContain("Path=/api/github/onboarding/callback");
    expect(cookies).toContain("agentproof_tenant_auth_session=");
    expect(cookies).toContain("Path=/;");
    expect(serialized).toBe('{"ok":true,"next":"install_github_app","privacy":"github-id-mapping-and-session-only"}');
    expect(`${cookies}${serialized}`).not.toContain("temporary-oauth-token");
    expect(`${cookies}${serialized}`).not.toContain("private-login");
    expect(`${cookies}${serialized}`).not.toContain("12345");
  });
});

function stubOAuthEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_ID", "github-app-client-id");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_SECRET", "github-app-client-secret");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL", "http://localhost/api/auth/github/callback");
  vi.stubEnv("AGENTPROOF_PUBLIC_AUTH_SECRET", "public-auth-secret-that-is-at-least-thirty-two-characters");
}
