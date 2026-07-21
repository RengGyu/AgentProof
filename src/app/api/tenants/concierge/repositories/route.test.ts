import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(), runtime: vi.fn(), configuration: vi.fn(), authStatus: vi.fn(), accountStatus: vi.fn(), installationStore: vi.fn(), grantStore: vi.fn(),
  verifySession: vi.fn(), listInstallations: vi.fn(), createToken: vi.fn(), registerGrant: vi.fn()
}));

vi.mock("@/lib/csrf", () => ({ verifySameOriginMutationRequest: mocks.csrf }));
vi.mock("@/lib/concierge-private-beta", () => ({ conciergeRuntimeDefaults: mocks.runtime }));
vi.mock("@/lib/concierge-store-configuration", () => ({ getConciergeStoreConfigurationStatus: mocks.configuration }));
vi.mock("@/lib/tenant-auth", () => ({ getTenantAuthSessionStoreStatus: mocks.authStatus, verifyTenantAuthAccess: mocks.verifySession }));
vi.mock("@/lib/tenant-accounts", () => ({ getTenantAccountStoreStatus: mocks.accountStatus }));
vi.mock("@/lib/github-installations", () => ({ getGitHubInstallationMetadataStoreStatus: mocks.installationStore, listTenantGitHubInstallationStatuses: mocks.listInstallations }));
vi.mock("@/lib/github-app", () => ({ createGitHubInstallationAccessToken: mocks.createToken }));
vi.mock("@/lib/tenant-control-plane", () => ({ registerConciergeManualRepositoryGrant: mocks.registerGrant, getTenantRepositoryGrantStoreStatus: mocks.grantStore }));

import { POST } from "./route";

const body = { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "opaque/repository" };
const durable = { configured: true, durable: true };

describe("Concierge manual repository grant route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockReturnValue({ ok: true });
    mocks.runtime.mockReturnValue({ manualAnalysisEnabled: true, globalKillSwitch: false });
    mocks.configuration.mockReturnValue({ configured: true, consistent: true });
    mocks.authStatus.mockReturnValue(durable); mocks.accountStatus.mockReturnValue(durable); mocks.installationStore.mockReturnValue(durable); mocks.grantStore.mockReturnValue(durable);
    mocks.verifySession.mockResolvedValue({ authorized: true, method: "durable-session", role: "owner" });
    mocks.listInstallations.mockResolvedValue([{ installationId: 101, status: "active" }]);
    mocks.createToken.mockResolvedValue("installation-token");
    mocks.registerGrant.mockResolvedValue({ outcome: "created", grant: { ...body, enabled: true, analysisEnabled: false, saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: false } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ repositories: [{ id: 202, full_name: "opaque/repository" }] }), { status: 200 })));
  });

  function request() { return new Request("https://beta.example.test/api/tenants/concierge/repositories", { method: "POST", body: JSON.stringify(body) }); }

  it("rejects CSRF, non-admin, mismatched installation, and missing durable stores before token issuance", async () => {
    mocks.csrf.mockReturnValueOnce({ ok: false });
    expect((await POST(request())).status).toBe(403);
    mocks.verifySession.mockResolvedValueOnce({ authorized: true, method: "durable-session", role: "member" });
    expect((await POST(request())).status).toBe(403);
    mocks.listInstallations.mockResolvedValueOnce([{ installationId: 999, status: "active" }]);
    expect((await POST(request())).status).toBe(403);
    mocks.authStatus.mockReturnValueOnce({ configured: true, durable: false });
    expect((await POST(request())).status).toBe(503);
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it("rejects an invalid or unavailable session before token issuance", async () => {
    mocks.verifySession.mockResolvedValueOnce({ authorized: false, method: "none", role: null });
    expect((await POST(request())).status).toBe(403);
    mocks.verifySession.mockRejectedValueOnce(new Error("store unavailable"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it("rejects a cross-project Concierge configuration before token issuance", async () => {
    mocks.configuration.mockReturnValueOnce({ configured: true, consistent: false });
    const response = await POST(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "durable_store_mismatch" });
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it("creates only an exact installed manual-only grant for a durable owner", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ registration: "created", settings: { manualAnalysisEnabled: true, analysisEnabled: false, saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: false }, conciergeCapabilities: { llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false } });
    expect(mocks.registerGrant).toHaveBeenCalledWith(body);
  });

  it("reports an existing ordinary grant without changing its settings while Concierge capabilities stay off", async () => {
    mocks.registerGrant.mockResolvedValueOnce({ outcome: "existing", grant: { ...body, enabled: true, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: true, slackNotificationsEnabled: true } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ registration: "existing", settings: { analysisEnabled: true, saveReportsEnabled: true, commentEnabled: true, slackNotificationsEnabled: true }, conciergeCapabilities: { llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false } });
  });

  it("does not claim manual analysis is enabled when an existing grant is disabled", async () => {
    mocks.registerGrant.mockResolvedValueOnce({ outcome: "existing", grant: { ...body, enabled: false, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: true, slackNotificationsEnabled: true } });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ registration: "existing", settings: { manualAnalysisEnabled: false, analysisEnabled: true, saveReportsEnabled: true, commentEnabled: true, slackNotificationsEnabled: true }, conciergeCapabilities: { llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false } });
  });

  it("does not grant when the installed repository id has a different name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ repositories: [{ id: 202, full_name: "other/repository" }] }), { status: 200 })));
    const response = await POST(request());
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ code: "repository_not_installed" });
    expect(mocks.registerGrant).not.toHaveBeenCalled();
  });

  it("returns bounded failure for provider rejection without persisting a grant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const response = await POST(request());
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ code: "concierge_repository_grant_unavailable" });
    expect(mocks.registerGrant).not.toHaveBeenCalled();
  });
});
