import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveGitHubAnalysisCredential } from "./github-analysis-access";

const tenantId = "gh_123";
const prUrl = "https://github.com/owner/repo/pull/7";
const oauthToken = "ghu_private_test_value";
const installationToken = "ghs_private_test_value";
const oauth = { accessToken: oauthToken, githubUserId: "123" };
const grant = { tenantId, installationId: 42, repositoryFullName: "owner/repo", repositoryId: 9, enabled: true, analysisEnabled: true, repositoryPrivate: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected GitHub request"); })));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("GitHub PR analysis credential routing", () => {
  it.each([false, true])("issues a fresh installation token for a connected %s-private repo", async repositoryPrivate => {
    const issueToken = vi.fn().mockResolvedValue(installationToken);
    const fetchGitHub = vi.fn().mockResolvedValue(json({ id: grant.repositoryId }));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", cookieHeader: "", dependencies: {
      listGrants: async () => [{ ...grant, repositoryPrivate, ...(repositoryPrivate ? { privateAnalysisConsentVersion: "2026-09-24.v1" as const } : {}) }],
      listStatuses: async () => [{ installationId: 42, status: "active" }],
      issueToken,
      readOAuth: () => null,
      fetchGitHub
    } });
    expect(result).toEqual({ ok: true, token: installationToken, kind: "installation", ...(repositoryPrivate ? { privateAnalysisApproved: true, installationId: 42, repositoryId: 9 } : {}) });
    expect(issueToken).toHaveBeenCalledExactlyOnceWith(42);
    expect(fetchGitHub).toHaveBeenCalledWith("https://api.github.com/repos/owner/repo", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${installationToken}` })
    }));
  });

  it("blocks a connected private repository before issuing a token when the new notice was not accepted", async () => {
    const issueToken = vi.fn();
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [{ ...grant, repositoryPrivate: true }],
      listStatuses: async () => [{ installationId: 42, status: "active" }],
      issueToken, readOAuth: () => null, fetchGitHub: vi.fn()
    } });
    expect(result).toMatchObject({ ok: false, code: "github_private_consent_required" });
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("rejects a repository that GitHub now marks private when the stored grant has no private consent", async () => {
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [grant], listStatuses: async () => [{ installationId: 42, status: "active" }],
      issueToken: async () => installationToken, readOAuth: () => null,
      fetchGitHub: vi.fn().mockResolvedValue(json({ id: grant.repositoryId, private: true }))
    } });
    expect(result).toMatchObject({ ok: false, code: "github_private_consent_required" });
  });

  it("rejects a stale grant when the repository name now belongs to another ID", async () => {
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [grant], listStatuses: async () => [{ installationId: 42, status: "active" }],
      issueToken: async () => installationToken, readOAuth: () => null,
      fetchGitHub: vi.fn().mockResolvedValue(json({ id: grant.repositoryId + 1 }))
    } });
    expect(result).toMatchObject({ ok: false, code: "github_connection_required" });
    expect(JSON.stringify(result)).not.toContain(installationToken);
  });

  it("requires a refreshed connection when the stored repository identity is missing", async () => {
    const issueToken = vi.fn();
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [{ ...grant, repositoryId: undefined }],
      listStatuses: async () => [{ installationId: 42, status: "active" }],
      issueToken, readOAuth: () => null, fetchGitHub: vi.fn()
    } });
    expect(result).toMatchObject({ ok: false, code: "github_connection_required" });
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("offers installation for a personal repository without a connected grant", async () => {
    const fetchGitHub = vi.fn().mockResolvedValueOnce(json({ id: 123, login: "owner", type: "User" }));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", cookieHeader: "", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toMatchObject({ ok: false, code: "github_install_required", status: 409 });
    expect(fetchGitHub).toHaveBeenCalledTimes(1);
  });

  it("offers installation for an organization administered by the signed-in user", async () => {
    const fetchGitHub = vi.fn()
      .mockResolvedValueOnce(json({ id: 55, login: "owner", type: "Organization" }))
      .mockResolvedValueOnce(json([{ state: "active", role: "admin", organization: { id: 55 } }]));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toMatchObject({ ok: false, code: "github_install_required", status: 409 });
    expect(fetchGitHub).toHaveBeenCalledTimes(2);
  });

  it("does not issue a token for a disabled, suspended, or cross-tenant connection", async () => {
    const issueToken = vi.fn();
    for (const listGrants of [async () => [{ ...grant, enabled: false }], async () => [{ ...grant, tenantId: "other" }]]) {
      const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
        listGrants, listStatuses: async () => [{ installationId: 42, status: "active" }], issueToken, readOAuth: () => null, fetchGitHub: vi.fn()
      } });
      expect(result.ok).toBe(false);
    }
    const suspended = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [grant], listStatuses: async () => [{ installationId: 42, status: "suspended" }], issueToken, readOAuth: () => null, fetchGitHub: vi.fn()
    } });
    expect(suspended).toMatchObject({ ok: false, code: "github_connection_required" });
    expect(issueToken).not.toHaveBeenCalled();
  });

  it("offers installation when the signed-in user administers another account's public repo", async () => {
    const fetchGitHub = vi.fn()
      .mockResolvedValueOnce(json({ id: 456, login: "owner", type: "User" }))
      .mockResolvedValueOnce(json({ private: false, permissions: { admin: true } }));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toMatchObject({ ok: false, code: "github_install_required", status: 409 });
  });

  it("uses the signed-in user's token for another account's explicitly public repository", async () => {
    const fetchGitHub = vi.fn()
      .mockResolvedValueOnce(json({ id: 456, login: "owner", type: "User" }))
      .mockResolvedValueOnce(json({ private: false, permissions: { admin: false } }));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", cookieHeader: "", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toEqual({ ok: true, token: oauthToken, kind: "user" });
    expect(fetchGitHub.mock.calls.every(([, init]) => init.headers.Authorization === `Bearer ${oauthToken}`)).toBe(true);
  });

  it("uses the user token for an external public repo when GitHub omits permissions", async () => {
    const fetchGitHub = vi.fn()
      .mockResolvedValueOnce(json({ id: 456, login: "owner", type: "User" }))
      .mockResolvedValueOnce(json({ id: 9, private: false }));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toEqual({ ok: true, token: oauthToken, kind: "user" });
  });

  it("requires fresh GitHub authorization after the temporary user token expires", async () => {
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", cookieHeader: "", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => null, fetchGitHub: vi.fn()
    } });
    expect(result).toMatchObject({ ok: false, code: "github_reauth_required", status: 401 });
  });

  it("denies another account's private repository and never falls back to an anonymous read", async () => {
    const fetchGitHub = vi.fn()
      .mockResolvedValueOnce(json({ id: 456, login: "owner", type: "User" }))
      .mockResolvedValueOnce(json({ private: true, permissions: { admin: false } }));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", cookieHeader: "", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toMatchObject({ ok: false, code: "github_private_denied", status: 403 });
    expect(fetchGitHub.mock.calls.every(([, init]) => init.headers.Authorization === `Bearer ${oauthToken}`)).toBe(true);
  });

  it.each([403, 404])("explains unavailable repository access without guessing whether GitHub's response was %s", async status => {
    const fetchGitHub = vi.fn()
      .mockResolvedValueOnce(json({ id: 456, login: "owner", type: "User" }))
      .mockResolvedValueOnce(json({ message: "Unavailable" }, status));
    const result = await resolveGitHubAnalysisCredential({ prUrl, tenantId, memberId: "github:123", dependencies: {
      listGrants: async () => [], listStatuses: async () => [], issueToken: vi.fn(), readOAuth: () => oauth, fetchGitHub
    } });
    expect(result).toMatchObject({ ok: false, code: "github_repository_unavailable", status: 403 });
    expect(result.ok === false ? result.hint : "").toContain("Check the URL");
    expect(JSON.stringify(result)).not.toContain(oauthToken);
  });
});
