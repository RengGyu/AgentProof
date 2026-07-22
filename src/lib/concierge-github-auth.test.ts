import { describe, expect, it, vi } from "vitest";
import { completeConciergeGitHubOAuth, getConciergeGitHubAuthConfigStatus, pkceChallenge, readConciergeGitHubSession, revokeConciergeGitHubSession, revokeConciergeGitHubSessionsForUser, selectPersonalInstallation, startConciergeGitHubOAuth } from "./concierge-github-auth";

const CONCIERGE_COOKIE = "__Host-agentproof-concierge-github-oauth";

const env = {
  AGENTPROOF_GITHUB_OAUTH_CLIENT_ID: "Iv1.test-client",
  AGENTPROOF_GITHUB_OAUTH_CLIENT_SECRET: "test-client-secret",
  AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET: "state-secret-for-concierge-oauth-32bytes",
  AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET: "feedback-secret-for-concierge-32bytes",
  AGENTPROOF_CONCIERGE_OAUTH_CALLBACK_URL: "https://preview.example.test/api/auth/github/callback",
  AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY: "service-placeholder",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-placeholder",
  GITHUB_APP_ID: "717171"
} as unknown as NodeJS.ProcessEnv;

describe("Concierge GitHub OAuth contract", () => {
  it("uses S256 PKCE and an HttpOnly __Host state cookie", async () => {
    const request = vi.fn(async () => Response.json(true));
    const start = await startConciergeGitHubOAuth(env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes) => bytes === 32 ? "s".repeat(43) : "v".repeat(64) });
    const url = new URL(start.redirectUrl);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("v".repeat(64)));
    expect(start.cookie).toContain("__Host-agentproof-concierge-github-oauth=");
    expect(start.cookie).toContain("HttpOnly"); expect(start.cookie).toContain("Secure"); expect(start.cookie).toContain("SameSite=Lax"); expect(start.cookie).toContain("Path=/");
    const body = JSON.parse(String((request.mock.calls as unknown as Array<[string, RequestInit]>)[0]?.[1]?.body));
    expect(body).toMatchObject({ p_state_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(body)).not.toContain("v".repeat(64));
  });

  it("refuses a direct OAuth start when the existing durable session is readable", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes("agentproof_read_concierge_github_session")) return Response.json([{ tenant_id: "tenant_alpha", member_id: "github-user-900001", github_user_id: 900001, installation_id: 101, repository_id: 202 }]);
      throw new Error("new state must not be reserved");
    });
    await expect(startConciergeGitHubOAuth(env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "s".repeat(43) }, `__Host-agentproof-concierge-github-session=${"x".repeat(43)}`)).rejects.toMatchObject({ reason: "session_already_active" });
    expect(request.mock.calls).toHaveLength(1);
    expect(String(request.mock.calls[0]?.[0])).toContain("agentproof_read_concierge_github_session");
  });

  it("uses only exact numeric personal ownership; organization and collaborator installs fail closed", () => {
    const user = { id: 900_001, type: "User" } as const;
    const personal = { id: 100, appId: 717171, targetId: user.id, targetType: "User", account: { id: user.id, type: "User" } } as const;
    expect(selectPersonalInstallation(user, [personal], 717171)).toMatchObject({ kind: "selected", installation: { id: 100 } });
    expect(selectPersonalInstallation(user, [personal, { ...personal, id: 101 }], 717171)).toEqual({ kind: "blocked", reason: "personal_installation_required" });
    expect(selectPersonalInstallation(user, [{ ...personal, account: { id: 900_002, type: "User" } }], 717171)).toEqual({ kind: "blocked", reason: "personal_installation_required" });
    expect(selectPersonalInstallation(user, [{ ...personal, targetType: "Organization", account: { id: user.id, type: "Organization" } }], 717171)).toEqual({ kind: "blocked", reason: "organization_installation_unsupported" });
    expect(selectPersonalInstallation(user, [{ ...personal, appId: 717172 }], 717171)).toEqual({ kind: "blocked", reason: "personal_installation_required" });
  });

  it("consumes state before exchanging code, so replay never reaches GitHub", async () => {
    const calls: string[] = [];
    const request = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("agentproof_consume")) return Response.json(false);
      throw new Error("must not call provider");
    });
    const cookiePayload = Buffer.from(JSON.stringify({ state: "s".repeat(43), verifier: "v".repeat(64), expiresAt: new Date(1_700_000_900_000).toISOString() })).toString("base64url");
    const signature = (await import("crypto")).createHmac("sha256", env.AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET!).update(cookiePayload).digest("base64url");
    await expect(completeConciergeGitHubOAuth({ state: "s".repeat(43), code: "c".repeat(43), cookieHeader: `__Host-agentproof-concierge-github-oauth=${cookiePayload}.${signature}` }, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).rejects.toMatchObject({ reason: "oauth_state_replayed" });
    expect(calls).toEqual([expect.stringContaining("agentproof_consume")]);
  });

  it("rejects malformed callback input before provider calls", async () => {
    const request = vi.fn();
    await expect(completeConciergeGitHubOAuth({ state: "not-valid", code: "short", cookieHeader: null }, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).rejects.toMatchObject({ reason: "oauth_state_invalid", oauthStateStage: "query_invalid" });
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps bounded OAuth state failure stages without retaining callback values", async () => {
    const request = vi.fn();
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) };
    await expect(completeConciergeGitHubOAuth({ state: "s".repeat(43), code: "c".repeat(43), cookieHeader: null }, env, deps)).rejects.toMatchObject({ reason: "oauth_state_invalid", oauthStateStage: "cookie_missing" });
    await expect(completeConciergeGitHubOAuth({ state: "s".repeat(43), code: "c".repeat(43), cookieHeader: `${CONCIERGE_COOKIE}=malformed` }, env, deps)).rejects.toMatchObject({ reason: "oauth_state_invalid", oauthStateStage: "cookie_invalid" });
    const started = await startConciergeGitHubOAuth(env, { ...deps, fetch: vi.fn(async () => Response.json(true)) as typeof fetch, random: (bytes) => bytes === 32 ? "s".repeat(43) : "v".repeat(64) });
    await expect(completeConciergeGitHubOAuth({ state: "z".repeat(43), code: "c".repeat(43), cookieHeader: started.cookie.split(";")[0] }, env, deps)).rejects.toMatchObject({ reason: "oauth_state_invalid", oauthStateStage: "state_mismatch" });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed for short, missing, or reused state/pseudonym secrets", () => {
    expect(getConciergeGitHubAuthConfigStatus({ ...env, AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET: "short", AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET: "also-short" })).toMatchObject({ configured: false });
    expect(getConciergeGitHubAuthConfigStatus({ ...env, AGENTPROOF_CONCIERGE_FEEDBACK_PSEUDONYM_SECRET: env.AGENTPROOF_CONCIERGE_OAUTH_STATE_SECRET })).toMatchObject({ configured: false });
  });

  it("runs the complete hash-only OAuth path without returning provider credentials", async () => {
    const urls: string[] = [];
    const request = vi.fn(async (url: string) => {
      urls.push(url);
      if (url.includes("agentproof_reserve")) return Response.json(true);
      if (url.includes("agentproof_consume")) return Response.json(true);
      if (url.includes("agentproof_resolve")) return Response.json([{ tenant_id: "tenant_alpha" }]);
      if (url.includes("agentproof_create")) return Response.json("created");
      if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "provider-token-must-not-escape" });
      if (url.endsWith("/user")) return Response.json({ id: 900001, type: "User" });
      if (url.includes("/user/installations?") || url.endsWith("/user/installations")) return Response.json({ installations: [{ id: 101, app_id: 717171, target_id: 900001, target_type: "User", account: { id: 900001, type: "User" }, suspended_at: null }] });
      if (url.includes("/repositories?")) return Response.json({ repositories: [
        { id: 201, full_name: "opaque/public-repository", private: false, owner: { id: 900001, type: "User" } },
        { id: 202, full_name: "opaque/private-repository", private: true, owner: { id: 900001, type: "User" } }
      ] });
      throw new Error(`unexpected ${url}`);
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : bytes === 32 && urls.length < 1 ? "s".repeat(43) : "t".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    const callbackUrl = new URL(start.redirectUrl);
    const completed = await completeConciergeGitHubOAuth({ state: callbackUrl.searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps);
    expect(completed.sessionCookie).toContain("__Host-agentproof-concierge-github-session=");
    expect(JSON.stringify(completed)).not.toContain("provider-token-must-not-escape");
    const recordedCalls = request.mock.calls as unknown as Array<[string, RequestInit?]>;
    expect(recordedCalls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
    const durableRpcBodies = recordedCalls
      .filter(([url]) => String(url).includes("example.supabase.co"))
      .map(([, init]) => String(init?.body ?? ""));
    expect(JSON.stringify(durableRpcBodies)).not.toContain("provider-token-must-not-escape");
    const createBody = JSON.parse(durableRpcBodies.find((body) => body.includes("p_repository_ids"))!);
    expect(createBody.p_repository_ids).toEqual([202]);
    expect(urls).toContain("https://api.github.com/user/installations/101/repositories?per_page=100&page=1");
  });

  it("rejects a public-only personal repository intersection", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes("agentproof_reserve") || url.includes("agentproof_consume")) return Response.json(true);
      if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "provider-token" });
      if (url.endsWith("/user")) return Response.json({ id: 900001, type: "User" });
      if (url.includes("/user/installations?")) return Response.json({ installations: [{ id: 101, app_id: 717171, target_id: 900001, target_type: "User", account: { id: 900001, type: "User" }, suspended_at: null }] });
      if (url.includes("/repositories?")) return Response.json({ repositories: [{ id: 201, full_name: "opaque/public-only", private: false, owner: { id: 900001, type: "User" } }] });
      throw new Error(`unexpected ${url}`);
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : bytes === 32 && request.mock.calls.length === 0 ? "s".repeat(43) : "t".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    await expect(completeConciergeGitHubOAuth({ state: new URL(start.redirectUrl).searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps)).rejects.toMatchObject({ reason: "private_repository_required" });
    expect(request.mock.calls.some(([url]) => String(url).includes("agentproof_create_concierge_github_session"))).toBe(false);
  });

  it.each([401, 403, 404, 429, 500])("maps OAuth provider HTTP %i without returning provider data", async (status) => {
    const request = vi.fn(async (url: string) => url.includes("agentproof_reserve") || url.includes("agentproof_consume") ? Response.json(true) : new Response("provider failure", { status }));
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : bytes === 32 && request.mock.calls.length === 0 ? "s".repeat(43) : "t".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    const state = new URL(start.redirectUrl).searchParams.get("state");
    await expect(completeConciergeGitHubOAuth({ state, code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps)).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
  });

  it("maps provider timeout after state consumption to a bounded unavailable result", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes("agentproof_reserve") || url.includes("agentproof_consume")) return Response.json(true);
      throw new Error("timeout");
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : bytes === 32 && request.mock.calls.length === 0 ? "s".repeat(43) : "t".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    await expect(completeConciergeGitHubOAuth({ state: new URL(start.redirectUrl).searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps)).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
  });

  it("aborts a hung Supabase RPC and fails closed within the configured timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    const request = vi.fn((_url: string, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    await expect(startConciergeGitHubOAuth(env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes) => bytes === 32 ? "s".repeat(43) : "v".repeat(64), networkTimeoutMs: 10 })).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
  });

  it("bounds a response body that never finishes after headers", async () => {
    let cancelled = false;
    const request = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
    await expect(startConciergeGitHubOAuth(env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes) => bytes === 32 ? "s".repeat(43) : "v".repeat(64), networkTimeoutMs: 10 })).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
    expect(cancelled).toBe(true);
  });

  it("rejects oversized Supabase response bytes without parsing or retaining them", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ opaque: "x".repeat(300 * 1024) }), { headers: { "content-type": "application/json" } }));
    await expect(startConciergeGitHubOAuth(env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes) => bytes === 32 ? "s".repeat(43) : "v".repeat(64) })).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
  });

  it("uses the same bounded body contract for GitHub token responses", async () => {
    const request = vi.fn(async (url: string) => {
      if (url.includes("agentproof_reserve") || url.includes("agentproof_consume")) return Response.json(true);
      if (url === "https://github.com/login/oauth/access_token") return new Response(new ReadableStream<Uint8Array>({}));
      throw new Error(`unexpected ${url}`);
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : "s".repeat(43), networkTimeoutMs: 10 };
    const start = await startConciergeGitHubOAuth(env, deps);
    await expect(completeConciergeGitHubOAuth({ state: new URL(start.redirectUrl).searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps)).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
  });

  it("fails before any OAuth or Supabase fetch when configured stores are cross-project", async () => {
    const request = vi.fn();
    await expect(startConciergeGitHubOAuth({ ...env, AGENTPROOF_TENANT_GRANTS_SUPABASE_URL: "https://different-project.supabase.co", AGENTPROOF_TENANT_GRANTS_SUPABASE_SERVICE_ROLE_KEY: "placeholder" }, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).rejects.toMatchObject({ reason: "durable_store_mismatch" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([null, "0", {}, -1, 1.5])("rejects malformed user-wide revoke response %j rather than treating it as zero", async (malformed) => {
    const request = vi.fn(async () => Response.json(malformed));
    await expect(revokeConciergeGitHubSessionsForUser(900001, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
  });

  it("keeps a failed durable logout retryable with the identical session cookie", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ unavailable: true }, { status: 503 }))
      .mockResolvedValueOnce(Response.json("revoked"));
    const cookie = `__Host-agentproof-concierge-github-session=${"s".repeat(43)}`;
    await expect(revokeConciergeGitHubSession(cookie, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
    await expect(revokeConciergeGitHubSession(cookie, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).resolves.toBe(true);
    const hashes = request.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).p_token_hash);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it("treats malformed non-empty durable session rows as unavailable, not signed out", async () => {
    const request = vi.fn(async () => Response.json({ malformed: true }));
    await expect(readConciergeGitHubSession(`__Host-agentproof-concierge-github-session=${"s".repeat(43)}`, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) })).rejects.toMatchObject({ reason: "oauth_provider_unavailable" });
  });

  it("keeps a bounded 101-repository session readable rather than silently truncating it", async () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({ tenant_id: "tenant_alpha", member_id: "github-user-900001", github_user_id: 900001, installation_id: 101, repository_id: index + 1 }));
    const request = vi.fn(async () => Response.json(rows));
    const session = await readConciergeGitHubSession(`__Host-agentproof-concierge-github-session=${"x".repeat(43)}`, env, { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: () => "x".repeat(43) });
    expect(session?.repositoryIds).toHaveLength(101);
  });

  it.each([100, 101, 500, 501])("applies the same repository boundary for %i opaque repositories", async (count) => {
    const calls: Array<[string, RequestInit?]> = [];
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.includes("agentproof_reserve") || url.includes("agentproof_consume")) return Response.json(true);
      if (url.includes("agentproof_resolve")) return Response.json([{ tenant_id: "tenant_alpha" }]);
      if (url.includes("agentproof_create")) return Response.json("created");
      if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "provider-token" });
      if (url.endsWith("/user")) return Response.json({ id: 900001, type: "User" });
      if (url.includes("/user/installations?")) return Response.json({ installations: [{ id: 101, app_id: 717171, target_id: 900001, target_type: "User", account: { id: 900001, type: "User" }, suspended_at: null }] });
      const page = Number(new URL(url).searchParams.get("page"));
      if (url.includes("/repositories?")) {
        const startId = (page - 1) * 100;
        const repositories = Array.from({ length: Math.max(0, Math.min(100, count - startId)) }, (_, index) => ({ id: startId + index + 1, full_name: `opaque/repository-${startId + index + 1}`, private: true, owner: { id: 900001, type: "User" } }));
        return Response.json({ repositories });
      }
      throw new Error(`unexpected ${url}`);
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : "s".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    const completion = completeConciergeGitHubOAuth({ state: new URL(start.redirectUrl).searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps);
    if (count === 501) {
      await expect(completion).rejects.toMatchObject({ reason: "repository_inventory_too_large" });
      expect(calls.some(([url]) => url.includes("agentproof_create"))).toBe(false);
    } else {
      await expect(completion).resolves.toMatchObject({ sessionCookie: expect.stringContaining("github-session") });
      const createBody = JSON.parse(String(calls.find(([url]) => url.includes("agentproof_create"))?.[1]?.body));
      expect(createBody.p_repository_ids).toHaveLength(count);
    }
    const expectedLastPage = count >= 500 ? 6 : 2;
    expect(calls.some(([url]) => url.includes(`/repositories?per_page=100&page=${expectedLastPage}`))).toBe(true);
  });

  it("accepts a near-limit response with 100 private repositories without overblocking the byte budget", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, full_name: `opaque/repository-${index + 1}`, private: true, description: "x".repeat(2_000), owner: { id: 900001, type: "User" } }));
    expect(Buffer.byteLength(JSON.stringify({ repositories: rows }))).toBeLessThan(256 * 1024);
    const request = vi.fn(async (url: string) => {
      if (url.includes("agentproof_reserve") || url.includes("agentproof_consume")) return Response.json(true);
      if (url.includes("agentproof_resolve")) return Response.json([{ tenant_id: "tenant_alpha" }]);
      if (url.includes("agentproof_create")) return Response.json("created");
      if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "provider-token" });
      if (url.endsWith("/user")) return Response.json({ id: 900001, type: "User" });
      if (url.includes("/user/installations?")) return Response.json({ installations: [{ id: 101, app_id: 717171, target_id: 900001, target_type: "User", account: { id: 900001, type: "User" }, suspended_at: null }] });
      if (url.includes("/repositories?")) return Response.json({ repositories: Number(new URL(url).searchParams.get("page")) === 1 ? rows : [] });
      throw new Error(`unexpected ${url}`);
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : "s".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    await expect(completeConciergeGitHubOAuth({ state: new URL(start.redirectUrl).searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps)).resolves.toMatchObject({ sessionCookie: expect.any(String) });
  });

  it.each([100, 101, 500, 501])("bounds the user-installation inventory at %i opaque entries without silent omission", async (count) => {
    const calls: string[] = [];
    const request = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes("agentproof_reserve") || url.includes("agentproof_consume")) return Response.json(true);
      if (url.includes("agentproof_resolve")) return Response.json([{ tenant_id: "tenant_alpha" }]);
      if (url.includes("agentproof_create")) return Response.json("created");
      if (url === "https://github.com/login/oauth/access_token") return Response.json({ access_token: "provider-token" });
      if (url.endsWith("/user")) return Response.json({ id: 900001, type: "User" });
      if (url.includes("/user/installations?")) {
        const page = Number(new URL(url).searchParams.get("page"));
        const startIndex = (page - 1) * 100;
        const installations = Array.from({ length: Math.max(0, Math.min(100, count - startIndex)) }, (_, index) => {
          const ordinal = startIndex + index;
          return ordinal === 0
            ? { id: 101, app_id: 717171, target_id: 900001, target_type: "User", account: { id: 900001, type: "User" }, suspended_at: null }
            : { id: 10_000 + ordinal, app_id: 717172, target_id: 10_000 + ordinal, target_type: "User", account: { id: 10_000 + ordinal, type: "User" }, suspended_at: null };
        });
        return Response.json({ installations });
      }
      if (url.includes("/repositories?")) return Response.json({ repositories: [{ id: 202, full_name: "opaque/private-repository", private: true, owner: { id: 900001, type: "User" } }] });
      throw new Error(`unexpected ${url}`);
    });
    const deps = { fetch: request as typeof fetch, now: () => 1_700_000_000_000, random: (bytes: number) => bytes === 48 ? "v".repeat(64) : "s".repeat(43) };
    const start = await startConciergeGitHubOAuth(env, deps);
    const completion = completeConciergeGitHubOAuth({ state: new URL(start.redirectUrl).searchParams.get("state"), code: "c".repeat(43), cookieHeader: start.cookie.split(";")[0] }, env, deps);
    if (count === 501) {
      await expect(completion).rejects.toMatchObject({ reason: "installation_inventory_too_large" });
      expect(calls.some((url) => url.includes("/repositories?"))).toBe(false);
    } else {
      await expect(completion).resolves.toMatchObject({ sessionCookie: expect.any(String) });
    }
    const expectedLastPage = count >= 500 ? 6 : 2;
    expect(calls).toContain(`https://api.github.com/user/installations?per_page=100&page=${expectedLastPage}`);
  });
});
