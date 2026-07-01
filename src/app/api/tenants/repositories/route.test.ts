import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  listTenantRepositoryGrants
} from "@/lib/tenant-control-plane";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { clearTenantAuthSessionsForTests, createTenantAuthSession } from "@/lib/tenant-auth";
import { GET, PATCH } from "./route";

describe("/api/tenants/repositories", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTenantRepositoryGrantsForTests();
    clearTenantAuthSessionsForTests();
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
      error: "Tenant repository settings require valid tenant authorization.",
      code: "tenant_repository_settings_unauthorized"
    });
  });

  it("blocks tenant-bound invite fallback when configured account metadata is suspended", async () => {
    stubSettingsEnv();
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        name: "Tenant A",
        status: "suspended",
        plan: "team",
        members: []
      }
    ]));

    const response = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository settings require valid tenant authorization.",
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
      commentEnabled: false,
      slackNotificationsEnabled: true
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
          commentEnabled: false,
          slackNotificationsEnabled: true
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

  it("allows role-less and member tenant invites to read repository settings only", async () => {
    stubSettingsEnvWithoutRole();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });

    const roleless = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const rolelessJson = await roleless.json();

    vi.unstubAllEnvs();
    stubSettingsEnvWithRole("member");

    const member = await GET(new Request("http://localhost/api/tenants/repositories?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const memberJson = await member.json();
    const serialized = JSON.stringify([rolelessJson, memberJson]);

    expect(roleless.status).toBe(200);
    expect(member.status).toBe(200);
    expect(rolelessJson).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "grant-metadata-only"
    });
    expect(memberJson).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "grant-metadata-only"
    });
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("member");
  });

  it("updates only known boolean repository verification settings", async () => {
    stubSettingsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
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
          commentEnabled: false,
          slackNotificationsEnabled: false
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
        commentEnabled: false,
        slackNotificationsEnabled: false
      },
      privacy: "grant-metadata-only",
      next: "repository_settings_saved"
    });
    expect(grants[0]).toMatchObject({
      repositoryFullName: "RengGyu/AgentProof",
      analysisEnabled: false,
      saveReportsEnabled: false,
      commentEnabled: false,
      slackNotificationsEnabled: false
    });
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("updates repository settings from a durable owner session without an invite header", async () => {
    stubSettingsEnv();
    stubDurableAuthEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      analysisEnabled: true
    });
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { cookie: session.sessionCookie },
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

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      repository: {
        analysisEnabled: false
      },
      privacy: "grant-metadata-only"
    });
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("tokenHash");
  });

  it("blocks repository settings updates when tenant invite metadata has no role", async () => {
    stubSettingsEnvWithoutRole();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      analysisEnabled: true
    });

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
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Tenant repository settings require an owner or admin role.",
      code: "tenant_repository_settings_role_required"
    });
    expect(grants[0].analysisEnabled).toBe(true);
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant-a-invite-token");
  });

  it("blocks repository settings updates for tenant members without exposing repository metadata", async () => {
    stubSettingsEnvWithRole("member");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
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
          commentEnabled: false
        }
      })
    }));
    const json = await response.json();
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Tenant repository settings require an owner or admin role.",
      code: "tenant_repository_settings_role_required"
    });
    expect(grants[0].commentEnabled).toBe(true);
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("member");
  });

  it("does not treat a stateless tenant admin session as privileged repository settings authorization", async () => {
    stubSettingsEnvWithRole("admin");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true
    });
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { cookie: session.sessionCookie },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          saveReportsEnabled: false
        }
      })
    }));
    const json = await response.json();
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Tenant repository settings require an owner or admin role.",
      code: "tenant_repository_settings_role_required"
    });
    expect(grants[0].saveReportsEnabled).toBe(true);
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("tenant-session-secret");
  });

  it("fails closed for malformed invite roles before mutating repository settings", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
    vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
      { tenantId: "tenant_a", token: "tenant-a-invite-token", role: "superadmin" }
    ]));
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      enabled: true
    });

    const response = await PATCH(new Request("http://localhost/api/tenants/repositories", {
      method: "PATCH",
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        settings: {
          enabled: false
        }
      })
    }));
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_a" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository settings require valid tenant authorization.",
      code: "tenant_repository_settings_unauthorized"
    });
    expect(grants[0].enabled).toBe(true);
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
      error: "Tenant repository settings require valid tenant authorization.",
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

function stubSettingsEnvWithRole(role: "owner" | "admin" | "member") {
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  stubInviteEnv(role);
}

function stubSettingsEnvWithoutRole() {
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  stubInviteEnv(null);
}

function stubInviteEnv(role: "owner" | "admin" | "member" | null = "owner") {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    {
      tenantId: "tenant_a",
      token: "tenant-a-invite-token",
      ...(role ? { role } : {})
    },
    {
      tenantId: "tenant_b",
      token: "tenant-b-invite-token",
      role: "admin"
    }
  ]));
}

function stubDurableAuthEnv(role: "owner" | "admin" | "member" = "owner", status: "active" | "disabled" = "active") {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "team",
      members: [
        { memberId: "member_owner", role, status }
      ]
    }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }
  ]));
}
