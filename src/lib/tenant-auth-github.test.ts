import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupExpiredGitHubSessionCredentials,
  clearTenantAuthSessionsForTests,
  createTenantAuthSessionForMember,
  getGitHubUserCredentialForSession,
  revokeTenantAuthSession,
  resolveTenantAuthAccess,
  saveGitHubUserCredentials
} from "./tenant-auth";

const day = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 8, 24);

function stubEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_PUBLIC_AUTH_SECRET", "server-encryption-secret-at-least-thirty-two-characters");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_ID", "app-client");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_CLIENT_SECRET", "app-secret");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{ tenantId: "gh_123", name: "Personal", status: "active", plan: "beta", members: [{ memberId: "github:123", role: "owner", status: "active" }] }]));
}

async function session() {
  return createTenantAuthSessionForMember({ tenantId: "gh_123", memberId: "github:123" }, process.env, start);
}

async function save(sessionCookie: string, expiresAt = start + 8 * 60 * 60 * 1000, refreshExpiresAt = start + 180 * day) {
  await saveGitHubUserCredentials({ sessionCookie, githubUserId: "123", accessToken: "ghu-secret-original", accessExpiresAt: expiresAt, refreshToken: "ghr-secret-original", refreshExpiresAt }, process.env, start);
}

afterEach(() => { clearTenantAuthSessionsForTests(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("session-bound GitHub user credentials", () => {
  it("clears encrypted credentials only after the GitHub login expires", async () => {
    stubEnv();
    const expired = await session();
    await save(expired.sessionCookie);
    const countBefore = await cleanupExpiredGitHubSessionCredentials(process.env, start + 29 * day);
    expect(countBefore).toBe(0);
    const countAfter = await cleanupExpiredGitHubSessionCredentials(process.env, start + 31 * day);
    expect(countAfter).toBe(1);
    const records = Array.from(((globalThis as typeof globalThis & { __agentproofTenantAuthSessions?: Map<string, Record<string, unknown>> }).__agentproofTenantAuthSessions ?? new Map()).values());
    expect(records[0]?.githubAccessCiphertext).toBeUndefined();
    expect(records[0]?.githubRefreshCiphertext).toBeUndefined();
    expect(await cleanupExpiredGitHubSessionCredentials(process.env, start + 32 * day)).toBe(0);
  });

  it("limits durable cleanup to expired or revoked GitHub sessions", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL", "https://store.invalid");
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      const params = new URL(url).searchParams;
      expect(params.get("auth_source")).toBe("eq.github");
      expect(params.get("and")).toContain("expires_at.lte.");
      expect(params.get("and")).toContain("revoked_at.not.is.null");
      expect(params.get("and")).toContain("github_access_ciphertext.not.is.null");
      expect(params.get("and")).toContain("github_refresh_ciphertext.not.is.null");
      expect(JSON.parse(String(init?.body))).toMatchObject({ github_access_ciphertext: null, github_refresh_ciphertext: null });
      return Response.json([{ id: "expired" }]);
    });
    vi.stubGlobal("fetch", request);
    expect(await cleanupExpiredGitHubSessionCredentials(process.env, start + 31 * day)).toBe(1);
    expect(request).toHaveBeenCalledOnce();
  });

  it("keeps encrypted tokens server-side and serves the same access token after the old 15-minute cookie window", async () => {
    stubEnv();
    const created = await session();
    await save(created.sessionCookie);
    const records = Array.from(((globalThis as typeof globalThis & { __agentproofTenantAuthSessions?: Map<string, unknown> }).__agentproofTenantAuthSessions ?? new Map()).values());
    expect(JSON.stringify(records)).not.toContain("ghu-secret-original");
    expect(JSON.stringify(records)).not.toContain("ghr-secret-original");
    const result = await getGitHubUserCredentialForSession({ cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" }, process.env, start + 16 * 60_000, vi.fn());
    expect(result).toEqual({ status: "ready", accessToken: "ghu-secret-original", githubUserId: "123" });
  });

  it("refreshes an expired access token once and reuses the rotated pair for concurrent requests", async () => {
    stubEnv();
    const created = await session();
    await save(created.sessionCookie, start + 1_000);
    const exchange = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ access_token: "ghu-secret-rotated", expires_in: 28_800, refresh_token: "ghr-secret-rotated", refresh_token_expires_in: 15_897_600 }));
    const input = { cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" };
    const results = await Promise.all([getGitHubUserCredentialForSession(input, process.env, start + 2_000, exchange), getGitHubUserCredentialForSession(input, process.env, start + 2_000, exchange)]);
    expect(results).toEqual([{ status: "ready", accessToken: "ghu-secret-rotated", githubUserId: "123" }, { status: "ready", accessToken: "ghu-secret-rotated", githubUserId: "123" }]);
    expect(exchange).toHaveBeenCalledOnce();
    expect(String(exchange.mock.calls[0][1]?.body)).toContain("refresh_token=ghr-secret-original");
    expect(JSON.stringify(Array.from(((globalThis as typeof globalThis & { __agentproofTenantAuthSessions?: Map<string, unknown> }).__agentproofTenantAuthSessions ?? new Map()).values()))).not.toContain("ghr-secret-rotated");
  });

  it("uses a conditional server-store lease so separate requests do not spend one refresh token twice", async () => {
    stubEnv();
    const created = await session();
    await save(created.sessionCookie, start + 1_000);
    const memory = Array.from(((globalThis as typeof globalThis & { __agentproofTenantAuthSessions?: Map<string, Record<string, unknown>> }).__agentproofTenantAuthSessions ?? new Map()).values())[0]!;
    const row: Record<string, unknown> = {
      id: memory.id, token_hash: memory.tokenHash, tenant_id: memory.tenantId, member_id: memory.memberId,
      created_at: memory.createdAt, expires_at: memory.expiresAt, revoked_at: null, auth_source: memory.authSource,
      github_user_id: memory.githubUserId, github_access_ciphertext: memory.githubAccessCiphertext,
      github_access_expires_at: memory.githubAccessExpiresAt, github_refresh_ciphertext: memory.githubRefreshCiphertext,
      github_refresh_expires_at: memory.githubRefreshExpiresAt, github_refresh_lease_owner: null, github_refresh_lease_until: null
    };
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL", "https://store.invalid");
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY", "service-role-test");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/agentproof_tenant_auth_sessions");
      if (init?.method === "GET") return Response.json([row]);
      if (init?.method !== "PATCH") throw new Error("Unexpected store request");
      const fields = JSON.parse(String(init.body)) as Record<string, unknown>;
      const params = new URL(url).searchParams;
      if (typeof fields.github_refresh_lease_owner === "string") {
        expect(params.get("or")).toContain("github_refresh_lease_until.is.null");
        if (row.github_refresh_lease_owner) return Response.json([]);
      } else if (fields.github_access_ciphertext) {
        if (params.get("github_refresh_lease_owner") !== `eq.${row.github_refresh_lease_owner}`) return Response.json([]);
      }
      Object.assign(row, fields);
      return Response.json([{ id: row.id }]);
    }));
    const exchange = vi.fn(async () => Response.json({ access_token: "ghu-secret-rotated", expires_in: 28_800, refresh_token: "ghr-secret-rotated", refresh_token_expires_in: 15_897_600 }));
    const input = { cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" };
    const results = await Promise.all([getGitHubUserCredentialForSession(input, process.env, start + 2_000, exchange), getGitHubUserCredentialForSession(input, process.env, start + 2_000, exchange)]);
    expect(results.every((result) => result.status === "ready" && result.accessToken === "ghu-secret-rotated")).toBe(true);
    expect(exchange).toHaveBeenCalledOnce();
    expect(JSON.stringify(row)).not.toContain("ghr-secret-rotated");
  });

  it("renews a GitHub login for approximately 30 days of activity and expires after inactivity", async () => {
    stubEnv();
    const created = await session();
    expect(created.sessionCookie).toContain("Max-Age=");
    expect(await resolveTenantAuthAccess({ cookieHeader: created.sessionCookie }, process.env, start + 20 * day)).toMatchObject({ authorized: true });
    expect(await resolveTenantAuthAccess({ cookieHeader: created.sessionCookie }, process.env, start + 45 * day)).toMatchObject({ authorized: true });
    expect(await resolveTenantAuthAccess({ cookieHeader: created.sessionCookie }, process.env, start + 76 * day)).toEqual({ authorized: false });
  });

  it("rejects wrong users, expired refresh credentials, and logout without exposing tokens", async () => {
    stubEnv();
    const created = await session();
    await save(created.sessionCookie, start + 1_000, start + 3_000);
    expect(await getGitHubUserCredentialForSession({ cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:456" }, process.env, start + 2_000, vi.fn())).toEqual({ status: "reauth" });
    expect(await getGitHubUserCredentialForSession({ cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" }, process.env, start + 4_000, vi.fn())).toEqual({ status: "reauth" });
    await revokeTenantAuthSession({ cookieHeader: created.sessionCookie }, process.env, start + 5_000);
    expect(await getGitHubUserCredentialForSession({ cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" }, process.env, start + 6_000, vi.fn())).toEqual({ status: "reauth" });
    const records = Array.from(((globalThis as typeof globalThis & { __agentproofTenantAuthSessions?: Map<string, unknown> }).__agentproofTenantAuthSessions ?? new Map()).values());
    expect(JSON.stringify(records)).not.toContain("ghu-secret-original");
    expect(JSON.stringify(records)).not.toContain("ghr-secret-original");
  });

  it.each([200, 401])("requires reauthorization after GitHub rejects the refresh token with HTTP %s", async (status) => {
    stubEnv();
    const created = await session();
    await save(created.sessionCookie, start + 1_000);
    const denied = vi.fn(async () => Response.json({ error: "bad_refresh_token" }, { status }));
    const input = { cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" };
    expect(await getGitHubUserCredentialForSession(input, process.env, start + 2_000, denied)).toEqual({ status: "reauth" });
    expect(denied).toHaveBeenCalledOnce();
    expect(await getGitHubUserCredentialForSession(input, process.env, start + 3_000, vi.fn())).toEqual({ status: "reauth" });
  });

  it("reports an app credential failure as unavailable without erasing the user's refresh grant", async () => {
    stubEnv();
    const created = await session();
    await save(created.sessionCookie, start + 1_000);
    const input = { cookieHeader: created.sessionCookie, tenantId: "gh_123", memberId: "github:123" };
    const invalidApp = vi.fn(async () => Response.json({ error: "incorrect_client_credentials" }, { status: 401 }));
    expect(await getGitHubUserCredentialForSession(input, process.env, start + 2_000, invalidApp)).toEqual({ status: "unavailable" });
    const records = Array.from(((globalThis as typeof globalThis & { __agentproofTenantAuthSessions?: Map<string, Record<string, unknown>> }).__agentproofTenantAuthSessions ?? new Map()).values());
    expect(records[0]?.githubRefreshCiphertext).toBeTruthy();
  });
});
