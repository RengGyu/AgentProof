import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/auth/github/start", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("clears any prior installation authorization when a new login starts", async () => {
    stubOAuthEnv();
    const response = await POST(new Request("http://localhost/api/auth/github/start", {
      method: "POST",
      headers: { Origin: "http://localhost", Cookie: "agentproof_github_oauth_install=old" },
      body: "{}"
    }));
    const cookies = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookies).toContain("agentproof_github_oauth_state=");
    expect(cookies).toContain("agentproof_github_oauth_install=deleted");
    expect(cookies).not.toContain("agentproof_tenant_auth_session=deleted");
  });

  it("does not issue an OAuth state cookie on a host different from the configured callback origin", async () => {
    stubOAuthEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL", "https://stable-beta.example/api/auth/github/callback");

    const response = await POST(new Request("https://ephemeral-preview.example/api/auth/github/start", {
      method: "POST",
      headers: { Origin: "https://ephemeral-preview.example" },
      body: "{}"
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "GitHub sign-in must start from the configured AgentProof address.",
      code: "github_oauth_callback_origin_mismatch",
      dashboardUrl: "https://stable-beta.example/dashboard"
    });
    expect(response.headers.get("set-cookie")).toContain("agentproof_github_oauth_install=deleted");
    expect(response.headers.get("set-cookie")).not.toContain("agentproof_github_oauth_state=");
  });
});

function stubOAuthEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_ID", "github-app-client-id");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_SECRET", "github-app-client-secret");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL", "http://localhost/api/auth/github/callback");
  vi.stubEnv("AGENTPROOF_PUBLIC_AUTH_SECRET", "public-auth-secret-that-is-at-least-thirty-two-characters");
}
