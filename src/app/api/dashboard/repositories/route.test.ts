import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant
} from "@/lib/tenant-control-plane";
import {
  clearTenantAuthSessionsForTests,
  createTenantAuthSessionForMember
} from "@/lib/tenant-auth";
import { GET } from "./route";

describe("GET /api/dashboard/repositories", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      { tenantId: "tenant_a", name: "A", status: "active", plan: "beta", members: [{ memberId: "github:1", role: "owner", status: "active" }] },
      { tenantId: "tenant_b", name: "B", status: "active", plan: "beta", members: [{ memberId: "github:2", role: "owner", status: "active" }] }
    ]));
  });

  afterEach(() => {
    clearTenantRepositoryGrantsForTests();
    clearTenantAuthSessionsForTests();
    vi.unstubAllEnvs();
  });

  it("returns only the signed-in tenant's bounded repository connection metadata", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/dongo",
      enabled: true,
      analysisEnabled: true,
      saveReportsEnabled: true,
      commentEnabled: false
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_b",
      installationId: 654,
      repositoryId: 200,
      repositoryFullName: "Other/private",
      enabled: true,
      analysisEnabled: true,
      saveReportsEnabled: true,
      commentEnabled: true
    });

    const response = await GET(new Request("http://localhost/api/dashboard/repositories", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      repositories: [{
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/dongo",
        enabled: true,
        analysisEnabled: true,
        saveReportsEnabled: true,
        commentEnabled: false
      }],
      privacy: "grant-metadata-only"
    });
  });
});
