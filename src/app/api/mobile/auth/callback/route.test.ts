import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as start } from "../start/route";
import { GET as callback } from "./route";

vi.mock("@/lib/tenant-accounts", () => ({
  ensureGitHubOwnerTenant: vi.fn(async () => ({ tenantId: "gh_123", memberId: "github:123" })),
  TenantAccountStoreError: class TenantAccountStoreError extends Error {}
}));
vi.mock("@/lib/mobile-auth", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/mobile-auth")>();
  return { ...actual, createMobileHandoff: vi.fn(async () => "h".repeat(43)) };
});

describe("mobile GitHub callback", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("returns the verified handoff directly to the app after GitHub approves", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_ID", "client-id");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_SECRET", "client-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL", "https://agentproof.example/api/auth/github/callback");
    vi.stubEnv("AGENTPROOF_PUBLIC_AUTH_SECRET", "s".repeat(40));
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    const begin = await start(new Request(`https://agentproof.example/api/mobile/auth/start?challenge=${"c".repeat(43)}`));
    expect(begin.status).toBe(302);
    const state = new URL(begin.headers.get("location")!).searchParams.get("state");
    const cookie = begin.headers.get("set-cookie")!.split(";")[0];
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "github-test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 123 }), { status: 200 })));

    const result = await callback(new Request(`https://agentproof.example/api/mobile/auth/callback?code=github-code&state=${state}`, { headers: { cookie } }));

    expect(result.status).toBe(302);
    expect(result.headers.get("location")).toBe(`agentproof://auth/callback?code=${"h".repeat(43)}`);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await result.text()).not.toContain("github-test-token");
  });
});
