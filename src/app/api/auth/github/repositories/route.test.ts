import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configuration: vi.fn(),
  session: vi.fn(),
  installations: vi.fn(),
  grants: vi.fn()
}));

vi.mock("@/lib/concierge-store-configuration", () => ({ getConciergeStoreConfigurationStatus: mocks.configuration }));
vi.mock("@/lib/concierge-github-auth", () => ({ readConciergeGitHubSession: mocks.session }));
vi.mock("@/lib/github-installations", () => ({ listTenantGitHubInstallationStatuses: mocks.installations }));
vi.mock("@/lib/tenant-control-plane", () => ({ listTenantEnabledRepositoryGrantScope: mocks.grants }));

import { GET } from "./route";

describe("GET /api/auth/github/repositories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configuration.mockReturnValue({ configured: true, consistent: true });
    mocks.session.mockResolvedValue({ tenantId: "tenant_opaque", memberId: "github-user-900001", githubUserId: 900001, installationId: 101, repositoryIds: [202], expiresAt: "session-bound" });
    mocks.installations.mockResolvedValue([{ installationId: 101, status: "active" }]);
    mocks.grants.mockResolvedValue([{ installationId: 101, repositoryId: 202, repositoryFullName: "opaque/private-repository", enabled: true }]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fails before session or provider/store fetches when durable projects differ", async () => {
    mocks.configuration.mockReturnValue({ configured: true, consistent: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const response = await GET(new Request("https://preview.example.test/api/auth/github/repositories"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "durable_store_mismatch" });
    expect(mocks.session).not.toHaveBeenCalled();
    expect(mocks.installations).not.toHaveBeenCalled();
    expect(mocks.grants).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns only exact bounded repository display metadata without inventing privacy", async () => {
    const response = await GET(new Request("https://preview.example.test/api/auth/github/repositories"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ state: "ready", repositories: [{ fullName: "opaque/private-repository" }] });
  });

  it("reports a durable authorization outage without presenting it as access loss", async () => {
    mocks.session.mockRejectedValue(new Error("store unavailable"));
    const response = await GET(new Request("https://preview.example.test/api/auth/github/repositories"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ code: "auth_unavailable" });
  });
});
