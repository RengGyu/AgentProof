import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(), complete: vi.fn(), landing: vi.fn(), clearOAuth: vi.fn(), clearSession: vi.fn(), errorResponse: vi.fn(), revoke: vi.fn(), read: vi.fn()
}));

vi.mock("@/lib/concierge-github-auth", () => ({
  startConciergeGitHubOAuth: mocks.start,
  completeConciergeGitHubOAuth: mocks.complete,
  conciergeGitHubLandingUrl: mocks.landing,
  clearConciergeGitHubOAuthCookie: mocks.clearOAuth,
  clearConciergeGitHubSessionCookie: mocks.clearSession,
  conciergeGitHubAuthErrorResponse: mocks.errorResponse,
  revokeConciergeGitHubSession: mocks.revoke,
  readConciergeGitHubSession: mocks.read
}));

import { GET as start } from "./start/route";
import { GET as callback } from "./callback/route";
import { DELETE as removeSession } from "./session/route";
import { GET as me } from "../me/route";

describe("Concierge GitHub OAuth routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue({ redirectUrl: "https://github.com/login/oauth/authorize?state=opaque", cookie: "__Host-agentproof-concierge-github-oauth=opaque; Path=/; HttpOnly; Secure; SameSite=Lax" });
    mocks.complete.mockResolvedValue({ sessionCookie: "__Host-agentproof-concierge-github-session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax", expiresAt: "2026-07-21T00:00:00.000Z" });
    mocks.landing.mockReturnValue("https://preview.example.test/concierge");
    mocks.clearOAuth.mockReturnValue("__Host-agentproof-concierge-github-oauth=deleted; Path=/; Max-Age=0");
    mocks.clearSession.mockReturnValue("__Host-agentproof-concierge-github-session=deleted; Path=/; Max-Age=0");
    mocks.errorResponse.mockImplementation((code: string, status: number) => new Response(JSON.stringify({ code }), { status }));
    mocks.revoke.mockResolvedValue(true);
    mocks.read.mockResolvedValue(null);
  });

  it("uses a 303 fixed GitHub redirect with no-store/referrer protection", async () => {
    const response = await start(new Request("https://preview.example.test/api/auth/github/start", { headers: { cookie: "__Host-agentproof-concierge-github-session=opaque" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=opaque");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(mocks.start).toHaveBeenCalledWith(process.env, undefined, "__Host-agentproof-concierge-github-session=opaque");
  });

  it("clears state, sets only the opaque session cookie, and rejects an open redirect", async () => {
    const response = await callback(new Request("https://preview.example.test/api/auth/github/callback?state=opaque&code=provider-code&next=https://attacker.example", { headers: { cookie: "__Host-agentproof-concierge-github-oauth=opaque" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://preview.example.test/concierge");
    expect(response.headers.get("location")).not.toContain("provider-code");
    expect(response.headers.get("set-cookie")).toContain("deleted");
    expect(response.headers.get("set-cookie")).toContain("github-session=opaque");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("clears only pending state and preserves an existing session on callback failure", async () => {
    mocks.complete.mockRejectedValue(Object.assign(new Error("provider token must not appear"), { reason: "oauth_provider_unavailable" }));
    const response = await callback(new Request("https://preview.example.test/api/auth/github/callback?state=opaque&code=provider-code", { headers: { cookie: "__Host-agentproof-concierge-github-session=existing; __Host-agentproof-concierge-github-oauth=pending" } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://preview.example.test/concierge?auth=oauth_provider_unavailable");
    expect(response.headers.get("location")).not.toContain("provider-code");
    expect(response.headers.get("set-cookie")).toContain("github-oauth=deleted");
    expect(response.headers.get("set-cookie")).not.toContain("github-session=deleted");
  });

  it("keeps a bounded installation-inventory failure instead of collapsing it into an OAuth-state error", async () => {
    mocks.complete.mockRejectedValue(Object.assign(new Error("inventory"), { reason: "installation_inventory_too_large" }));
    const response = await callback(new Request("https://preview.example.test/api/auth/github/callback?state=opaque&code=provider-code"));
    expect(response.headers.get("location")).toBe("https://preview.example.test/concierge?auth=installation_inventory_too_large");
  });

  it("refuses a new OAuth start when the durable session is still active", async () => {
    mocks.start.mockRejectedValue(Object.assign(new Error("active"), { reason: "session_already_active" }));
    const response = await start(new Request("https://preview.example.test/api/auth/github/start", { headers: { cookie: "__Host-agentproof-concierge-github-session=existing" } }));
    expect(response.status).toBe(409);
    expect(mocks.errorResponse).toHaveBeenCalledWith("session_already_active", 409);
  });

  it("requires same-origin logout and returns an opaque bounded outcome", async () => {
    const denied = await removeSession(new Request("https://preview.example.test/api/auth/github/session", { method: "DELETE" }));
    expect(denied.status).toBe(403);
    const accepted = await removeSession(new Request("https://preview.example.test/api/auth/github/session", { method: "DELETE", headers: { origin: "https://preview.example.test", "x-agentproof-csrf": "same-origin", cookie: "__Host-agentproof-concierge-github-session=opaque" } }));
    expect(accepted.status).toBe(200);
    await expect(accepted.json()).resolves.toEqual({ deleted: true });
    expect(mocks.revoke).toHaveBeenCalledTimes(1);
    expect(accepted.headers.get("set-cookie")).toContain("github-session=deleted");
  });

  it("keeps durable authentication failure distinct from signed-out state", async () => {
    mocks.read.mockRejectedValue(new Error("durable provider unavailable"));
    const response = await me(new Request("https://preview.example.test/api/auth/me"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ authenticated: false, code: "auth_unavailable" });
  });

  it("preserves the same session cookie after revoke failure so the next request can retry", async () => {
    mocks.revoke.mockRejectedValueOnce(new Error("durable provider unavailable")).mockResolvedValueOnce(true);
    const request = new Request("https://preview.example.test/api/auth/github/session", { method: "DELETE", headers: { origin: "https://preview.example.test", "x-agentproof-csrf": "same-origin", cookie: "__Host-agentproof-concierge-github-session=opaque" } });
    const failed = await removeSession(request);
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toEqual({ deleted: false, code: "auth_unavailable" });
    expect(failed.headers.get("set-cookie")).toBeNull();
    const recovered = await removeSession(request);
    expect(recovered.status).toBe(200);
    expect(recovered.headers.get("set-cookie")).toContain("github-session=deleted");
    expect(mocks.revoke.mock.calls.map(([cookie]) => cookie)).toEqual(["__Host-agentproof-concierge-github-session=opaque", "__Host-agentproof-concierge-github-session=opaque"]);
  });
});
