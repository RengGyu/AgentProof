import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeTenantRepositoryGrant,
  authorizeTenantRepositoryGrantAsync,
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  disableTenantRepositoryGrantsForInstallation,
  disableTenantRepositoryGrantsForRepositories,
  disableTenantRepositoryGrantsForTenantDeletion,
  listTenantRepositoryGrants,
  readTenantRepositoryGrants,
  TenantControlPlaneStoreError,
  tenantGrantPublicReason,
  updateTenantRepositoryGrantSettings
} from "./tenant-control-plane";
import {
  clearTenantDeletionStateForTests,
  markTenantDeletionStartedIfConfigured
} from "./tenant-deletion-state";

describe("tenant control plane helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTenantRepositoryGrantsForTests();
    clearTenantDeletionStateForTests();
  });

  it("does not require repository grants when tenant control is disabled", () => {
    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, {} as NodeJS.ProcessEnv)
    ).toEqual({
      enabled: false,
      required: false,
      reason: "control-plane-disabled"
    });
  });

  it("authorizes only matching active installation and repository grants", () => {
    const env = grantEnv();

    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "renggyu/agentproof"
      }, env)
    ).toEqual({
      enabled: true,
      required: true,
      grant: {
        tenantId: "tenant_test",
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        commentEnabled: false,
        saveReportsEnabled: true,
        slackNotificationsEnabled: false
      }
    });

    expect(
      authorizeTenantRepositoryGrant({
        installationId: 999,
        repositoryFullName: "RengGyu/AgentProof"
      }, env)
    ).toEqual({
      enabled: true,
      required: true,
      reason: "grant-missing"
    });
  });

  it("denies disabled grants and analysis-disabled grants with bounded reasons", () => {
    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, grantEnv({ enabled: false }))
    ).toMatchObject({
      enabled: true,
      required: true,
      reason: "grant-disabled"
    });

    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, grantEnv({ analysisEnabled: false }))
    ).toMatchObject({
      enabled: true,
      required: true,
      reason: "analysis-disabled"
    });
  });

  it("fails closed for malformed grant configuration", () => {
    const invalidEnv = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS: "{not-json"
    } as unknown as NodeJS.ProcessEnv;

    expect(readTenantRepositoryGrants(invalidEnv)).toBeNull();
    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, invalidEnv)
    ).toEqual({
      enabled: true,
      required: true,
      reason: "invalid-grants"
    });
    expect(tenantGrantPublicReason("invalid-grants")).not.toContain("{not-json");
  });

  it("rejects oversized or secret-shaped grant fields instead of normalizing them into access", () => {
    const env = {
      AGENTPROOF_TENANT_REPOSITORY_GRANTS: JSON.stringify([
        {
          tenantId: "sk-secret-should-not-be-a-tenant-id",
          installationId: 321,
          repositoryFullName: "RengGyu/AgentProof"
        }
      ])
    } as unknown as NodeJS.ProcessEnv;

    expect(readTenantRepositoryGrants(env)).toBeNull();
  });

  it("authorizes stored repository grants by repository id without legacy env grants", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true
    }, env);

    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "Renamed/AgentProof"
    }, env)).resolves.toEqual({
      enabled: true,
      required: true,
      grant: {
        tenantId: "tenant_test",
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        commentEnabled: false,
        saveReportsEnabled: true,
        slackNotificationsEnabled: false
      }
    });
  });

  it("does not authorize a stored grant with a different repository id even when the full name matches", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    }, env);

    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 999,
      repositoryFullName: "RengGyu/AgentProof"
    }, env)).resolves.toEqual({
      enabled: true,
      required: true,
      reason: "grant-missing"
    });
  });

  it("lists stored repository grants for one tenant without exposing other tenants", async () => {
    const env = {
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/Zeta"
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Alpha"
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_other",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private"
    }, env);

    await expect(listTenantRepositoryGrants({ tenantId: "tenant_test" }, env)).resolves.toEqual([
      expect.objectContaining({
        tenantId: "tenant_test",
        repositoryId: 101,
        repositoryFullName: "RengGyu/Alpha"
      }),
      expect.objectContaining({
        tenantId: "tenant_test",
        repositoryId: 100,
        repositoryFullName: "RengGyu/Zeta"
      })
    ]);
  });

  it("updates stored repository verification settings without changing repository identity", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    }, env);

    await expect(updateTenantRepositoryGrantSettings({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      enabled: true,
      analysisEnabled: false,
      saveReportsEnabled: false,
      commentEnabled: false,
      slackNotificationsEnabled: false
    }, env)).resolves.toEqual({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      enabled: true,
      analysisEnabled: false,
      commentEnabled: false,
      saveReportsEnabled: false,
      slackNotificationsEnabled: false
    });
    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "Renamed/AgentProof"
    }, env)).resolves.toMatchObject({
      reason: "analysis-disabled"
    });
  });

  it("disables all stored grants for a GitHub App installation lifecycle event", async () => {
    const env = {
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Docs",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_other",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Repo",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);

    await expect(disableTenantRepositoryGrantsForInstallation({ installationId: 321 }, env)).resolves.toEqual({
      updatedCount: 2,
      grants: [
        expect.objectContaining({
          repositoryId: 100,
          enabled: false,
          analysisEnabled: false,
          saveReportsEnabled: false,
          commentEnabled: false
        }),
        expect.objectContaining({
          repositoryId: 101,
          enabled: false,
          analysisEnabled: false,
          saveReportsEnabled: false,
          commentEnabled: false
        })
      ]
    });
    await expect(listTenantRepositoryGrants({ tenantId: "tenant_other" }, env)).resolves.toEqual([
      expect.objectContaining({
        repositoryId: 999,
        enabled: true,
        saveReportsEnabled: true,
        commentEnabled: true
      })
    ]);
  });

  it("disables only removed repository grants for an installation_repositories event", async () => {
    const env = {
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Docs",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);

    await expect(disableTenantRepositoryGrantsForRepositories({
      installationId: 321,
      repositoryIds: [101, 101, "bad"]
    }, env)).resolves.toEqual({
      updatedCount: 1,
      grants: [
        expect.objectContaining({
          repositoryId: 101,
          enabled: false,
          analysisEnabled: false,
          saveReportsEnabled: false,
          commentEnabled: false
        })
      ]
    });
    await expect(listTenantRepositoryGrants({ tenantId: "tenant_test" }, env)).resolves.toEqual([
      expect.objectContaining({
        repositoryId: 100,
        enabled: true,
        saveReportsEnabled: true,
        commentEnabled: true
      }),
      expect.objectContaining({
        repositoryId: 101,
        enabled: false,
        saveReportsEnabled: false,
        commentEnabled: false
      })
    ]);
  });

  it("disables all memory grants for one tenant deletion without returning repository metadata", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Docs",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_other",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);

    const result = await disableTenantRepositoryGrantsForTenantDeletion({ tenantId: "tenant_test" }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "tenant-repository-grant-disable-metadata-only",
      matchedCount: 2,
      disabledCount: 2,
      store: "memory",
      durable: false,
      configured: true
    });
    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "Renamed/AgentProof"
    }, env)).resolves.toMatchObject({
      reason: "grant-disabled"
    });
    await expect(listTenantRepositoryGrants({ tenantId: "tenant_other" }, env)).resolves.toEqual([
      expect.objectContaining({
        tenantId: "tenant_other",
        repositoryId: 999,
        enabled: true,
        analysisEnabled: true,
        saveReportsEnabled: true,
        commentEnabled: true
      })
    ]);
    expect(serialized).not.toContain("tenant_test");
    expect(serialized).not.toContain("RengGyu");
    expect(serialized).not.toContain("Other/Private");
    expect(serialized).not.toContain("repositoryFullName");
    expect(serialized).not.toContain("installation");
    expect(serialized).not.toContain("service-role");
    expect(serialized).not.toContain("token");
  });

  it("marks env-backed tenant deletion grant disable as manual review instead of pretending to mutate config", async () => {
    const result = await disableTenantRepositoryGrantsForTenantDeletion({
      tenantId: "tenant_test"
    }, grantEnv());
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "tenant-repository-grant-disable-metadata-only",
      matchedCount: 1,
      disabledCount: 0,
      store: "env",
      durable: false,
      configured: true,
      manualReviewRequired: true
    });
    expect(serialized).not.toContain("RengGyu");
    expect(serialized).not.toContain("repositoryFullName");
    expect(serialized).not.toContain("service-role");
    expect(serialized).not.toContain("secret");
  });

  it("blocks grant authorization, creation, and settings updates while tenant deletion is active", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true",
      AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    markTenantDeletionStartedIfConfigured({ tenantId: "tenant_test" }, env);

    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    }, env)).resolves.toMatchObject({
      reason: "tenant-deletion-active"
    });
    await expect(updateTenantRepositoryGrantSettings({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      enabled: true
    }, env)).rejects.toThrow("Tenant deletion is in progress");
    await expect(createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/NewRepo"
    }, env)).rejects.toThrow("Tenant deletion is in progress");
    await expect(createTenantRepositoryGrant({
      tenantId: "tenant_other",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private"
    }, env)).resolves.toHaveProperty("tenantId", "tenant_other");
    expect(tenantGrantPublicReason("tenant-deletion-active")).toBe("Repository grant is not active.");
  });

  it("rejects repository settings updates without a repository id or boolean setting", async () => {
    const env = {
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await expect(updateTenantRepositoryGrantSettings({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      analysisEnabled: "false"
    }, env)).rejects.toThrow("invalid");
    await expect(updateTenantRepositoryGrantSettings({
      tenantId: "tenant_test",
      installationId: 321,
      analysisEnabled: false
    }, env)).rejects.toThrow("invalid");
  });

  it("writes Supabase repository grant rows with repository id and without service-role values in the body", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("agentproof_tenant_deletion_state_active")) return Response.json([{ active: false }]);
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE: "tenant_repository_grants_test"
    } as unknown as NodeJS.ProcessEnv;

    const grant = await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      commentEnabled: true
    }, env);
    const [, init] = fetchMock.mock.calls[1] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(body);

    expect(grant.repositoryId).toBe(100);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_tenant_deletion_state_active",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ p_tenant_id: "tenant_test" }) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/tenant_repository_grants_test?on_conflict=tenant_id,installation_id,repository_id",
      expect.objectContaining({ method: "POST" })
    );
    expect(body).toMatchObject({
      tenant_id: "tenant_test",
      installation_id: 321,
      repository_id: 100,
      repository_full_name: "RengGyu/AgentProof",
      comment_enabled: true
    });
    expect(serializedBody).not.toContain("service-role-secret");
  });

  it("lists Supabase repository grants by tenant id with metadata-only rows", async () => {
    const fetchMock = vi.fn(async () => Response.json([
      {
        tenant_id: "tenant_test",
        installation_id: 321,
        repository_id: 100,
        repository_full_name: "RengGyu/AgentProof",
        enabled: true,
        analysis_enabled: true,
        comment_enabled: false,
        save_reports_enabled: true,
        slack_notifications_enabled: true,
        raw_diff: "Patch excerpt should be ignored"
      }
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE: "tenant_repository_grants_test"
    } as unknown as NodeJS.ProcessEnv;

    await expect(listTenantRepositoryGrants({ tenantId: "tenant_test" }, env)).resolves.toEqual([
      {
        tenantId: "tenant_test",
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        commentEnabled: false,
        saveReportsEnabled: true,
        slackNotificationsEnabled: true
      }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/tenant_repository_grants_test?tenant_id=eq.tenant_test&select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled,slack_notifications_enabled&order=repository_full_name.asc&limit=500",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("patches Supabase repository grant settings by tenant, installation, and repository id only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("agentproof_tenant_deletion_state_active")) return Response.json([{ active: false }]);
      return Response.json([
        {
          tenant_id: "tenant_test",
          installation_id: 321,
          repository_id: 100,
          repository_full_name: "RengGyu/AgentProof",
          enabled: true,
          analysis_enabled: true,
          comment_enabled: true,
          save_reports_enabled: false,
          slack_notifications_enabled: true
        }
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE: "tenant_repository_grants_test"
    } as unknown as NodeJS.ProcessEnv;

    const updated = await updateTenantRepositoryGrantSettings({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      commentEnabled: true,
      saveReportsEnabled: false,
      slackNotificationsEnabled: true
    }, env);
    const [, init] = fetchMock.mock.calls[1] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(body);

    expect(updated).toMatchObject({
      tenantId: "tenant_test",
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      commentEnabled: true,
      saveReportsEnabled: false
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_tenant_deletion_state_active",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ p_tenant_id: "tenant_test" }) })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/tenant_repository_grants_test?tenant_id=eq.tenant_test&installation_id=eq.321&repository_id=eq.100&select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled,slack_notifications_enabled",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(body).toMatchObject({
      comment_enabled: true,
      save_reports_enabled: false,
      updated_at: expect.any(String)
    });
    expect(serializedBody).not.toContain("repository_full_name");
    expect(serializedBody).not.toContain("service-role-secret");
  });

  it("patches Supabase installation grants to disabled metadata only", async () => {
    const fetchMock = vi.fn(async () => Response.json([
      {
        tenant_id: "tenant_test",
        installation_id: 321,
        repository_id: 100,
        repository_full_name: "RengGyu/AgentProof",
        enabled: false,
        analysis_enabled: false,
        comment_enabled: false,
        save_reports_enabled: false,
        slack_notifications_enabled: false
      }
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE: "tenant_repository_grants_test"
    } as unknown as NodeJS.ProcessEnv;

    const result = await disableTenantRepositoryGrantsForInstallation({ installationId: 321 }, env);
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(body);

    expect(result.updatedCount).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/tenant_repository_grants_test?installation_id=eq.321&select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled,slack_notifications_enabled",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(body).toMatchObject({
      enabled: false,
      analysis_enabled: false,
      comment_enabled: false,
      save_reports_enabled: false,
      slack_notifications_enabled: false,
      updated_at: expect.any(String)
    });
    expect(serializedBody).not.toContain("service-role-secret");
    expect(serializedBody).not.toContain("repository_full_name");
  });

  it("patches Supabase removed repository grants by installation and repository ids", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    } as unknown as NodeJS.ProcessEnv;

    await expect(disableTenantRepositoryGrantsForRepositories({
      installationId: 321,
      repositoryIds: [100, 101]
    }, env)).resolves.toEqual({
      updatedCount: 0,
      grants: []
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/agentproof_tenant_repository_grants?installation_id=eq.321&repository_id=in.(100,101)&select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled,slack_notifications_enabled",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("patches Supabase tenant grants for deletion with count-first metadata and no returned rows", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-range": "0-0/3"
          }
        });
      }

      if (init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }

      return new Response("unexpected", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE: "tenant_repository_grants_test"
    } as unknown as NodeJS.ProcessEnv;

    const result = await disableTenantRepositoryGrantsForTenantDeletion({ tenantId: "tenant_test" }, env);
    const [countUrl, countInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const patchBody = JSON.parse(String(patchInit.body));
    const serializedResult = JSON.stringify(result);
    const serializedBody = JSON.stringify(patchBody);

    expect(result).toEqual({
      privacy: "tenant-repository-grant-disable-metadata-only",
      matchedCount: 3,
      disabledCount: 3,
      store: "supabase",
      durable: true,
      configured: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countUrl).toBe("https://agentproof-test.supabase.co/rest/v1/tenant_repository_grants_test?tenant_id=eq.tenant_test&select=tenant_id");
    expect(countInit.method).toBe("HEAD");
    expect(countInit.body).toBeUndefined();
    expect(countInit.headers).toMatchObject({
      Prefer: "count=exact",
      Range: "0-0"
    });
    expect(patchUrl).toBe("https://agentproof-test.supabase.co/rest/v1/tenant_repository_grants_test?tenant_id=eq.tenant_test");
    expect(patchInit.method).toBe("PATCH");
    expect(patchInit.headers).toMatchObject({
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    });
    expect(patchBody).toMatchObject({
      enabled: false,
      analysis_enabled: false,
      comment_enabled: false,
      save_reports_enabled: false,
      slack_notifications_enabled: false,
      updated_at: expect.any(String)
    });
    expect(serializedResult).not.toContain("tenant_test");
    expect(serializedResult).not.toContain("tenant_repository_grants_test");
    expect(serializedResult).not.toContain("agentproof-test.supabase.co");
    expect(serializedResult).not.toContain("service-role-secret");
    expect(serializedResult).not.toContain("repositoryFullName");
    expect(serializedBody).not.toContain("repository_full_name");
    expect(serializedBody).not.toContain("service-role-secret");
  });

  it("requires repository id for durable Supabase repository grant writes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    } as unknown as NodeJS.ProcessEnv;

    await expect(createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryFullName: "RengGyu/AgentProof"
    }, env)).rejects.toThrow("repository id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when the stored grant backend env is incomplete", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_SUPABASE_URL: "https://agentproof-test.supabase.co"
    } as unknown as NodeJS.ProcessEnv;

    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    }, env)).rejects.toBeInstanceOf(TenantControlPlaneStoreError);
  });
});

function grantEnv(overrides: Record<string, unknown> = {}): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
    AGENTPROOF_TENANT_REPOSITORY_GRANTS: JSON.stringify([
      {
        tenantId: "tenant_test",
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        commentEnabled: false,
        saveReportsEnabled: true,
        ...overrides
      }
    ])
  } as unknown as NodeJS.ProcessEnv;
}
