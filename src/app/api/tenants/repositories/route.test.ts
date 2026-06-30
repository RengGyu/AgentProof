import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  listTenantRepositoryGrants
} from "@/lib/tenant-control-plane";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { GET, PATCH } from "./route";

describe("/api/tenants/repositories", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTenantRepositoryGrantsForTests();
  });

  it("requires tenant control plane before reading repository verification settings", async () => {
    stubInviteEnv();

    const response = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant control plane must be enabled before repository settings can be read.",
      code: "tenant_repository_settings_control_required"
    });
  });

  it("does not accept the legacy global invite token for repository settings", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_BETA_INVITE_TOKEN", "global-invite-token");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");

    const response = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "global-invite-token" }
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository settings require a valid tenant-bound invite token.",
      code: "tenant_repository_settings_unauthorized"
    });
  });

  it("lists only repository verification settings for the authorized tenant", async () => {
    stubSettingsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: false
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_b",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private",
      saveReportsEnabled: true,
      commentEnabled: true
    });

    const response = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      repositories: [
        {
          installationId: 321,
          repositoryId: 100,
          repositoryFullName: "RengGyu/AgentProof",
          enabled: true,
          analysisEnabled: true,
          saveReportsEnabled: true,
          commentEnabled: false
        }
      ],
      privacy: "grant-metadata-only",
      next: "configure_repository"
    });
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Other/Private");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("lists repository settings with a tenant admin session cookie and no invite header", async () => {
    stubSettingsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryFullName: "RengGyu/AgentProof"
      })
    ]);
  });

  it("updates only known boolean repository verification settings", async () => {
    stubSettingsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          analysisEnabled: false,
          saveReportsEnabled: false,
          commentEnabled: false
        }
      })
    }));
    const json = await response.json();
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      repository: {
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: false,
        saveReportsEnabled: false,
        commentEnabled: false
      },
      privacy: "grant-metadata-only",
      next: "repository_settings_saved"
    });
    expect(grants[0]).toMatchObject({
      repositoryFullName: "RengGyu/AgentProof",
      analysisEnabled: false,
      saveReportsEnabled: false,
      commentEnabled: false
    });
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("blocks repository settings updates for an unavailable tenant with bounded JSON", async () => {
    stubSettingsEnv();
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_TOMBSTONES", JSON.stringify(["tenant_a"]));

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          analysisEnabled: false
        }
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: "Tenant repository settings are unavailable.",
      code: "tenant_repository_settings_unavailable"
    });
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("deletion");
    expect(serialized).not.toContain("tombstone");
    expect(serialized).not.toContain("RengGyu");
  });

  it("rejects raw evidence or repository identity fields in settings updates", async () => {
    stubSettingsEnv();

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      body: JSON.stringify({
        tenantId: "tenant_a",
        inviteToken: "tenant-a-invite-token",
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "Attacker/ChosenName",
        rawDiff: "Patch excerpt should not be accepted",
        settings: {
          analysisEnabled: true
        }
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(422);
    expect(json).toEqual({
      error: "Tenant repository settings request contains unsupported fields.",
      code: "tenant_repository_settings_payload_invalid"
    });
    expect(serialized).not.toContain("Attacker/ChosenName");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("rejects unknown or non-boolean mutable settings", async () => {
    stubSettingsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });

    const unknown = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          analysisEnabled: true,
          reviewStyle: "generic"
        }
      })
    }));
    const nonBoolean = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          commentEnabled: "true"
        }
      })
    }));

    expect(unknown.status).toBe(422);
    expect(nonBoolean.status).toBe(422);
    await expect(unknown.json()).resolves.toEqual({
      error: "Repository settings may only update known boolean verification settings.",
      code: "tenant_repository_settings_invalid"
    });
  });

  it("does not reveal repository existence for the wrong tenant invite", async () => {
    stubSettingsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          enabled: false
        }
      })
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository settings require a valid tenant-bound invite token.",
      code: "tenant_repository_settings_unauthorized"
    });
  });

  it("returns not found for authorized tenant repository ids that are not granted", async () => {
    stubSettingsEnv();

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 404,
        settings: {
          enabled: false
        }
      })
    }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository grant was not found.",
      code: "tenant_repository_grant_not_found"
    });
  });

  it("fails closed when the repository grant store is unavailable after authorization", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    stubInviteEnv();

    const response = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository grant store is unavailable.",
      code: "tenant_repository_grant_store_unavailable"
    });
  });
});

function stubSettingsEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  stubInviteEnv();
}

function stubInviteEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    {
      tenantId: "tenant_a",
      token: "tenant-a-invite-token"
    },
    {
      tenantId: "tenant_b",
      token: "tenant-b-invite-token"
    }
  ]));
}
