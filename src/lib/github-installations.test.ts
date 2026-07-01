import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantGitHubInstallationsForTests,
  countTenantGitHubInstallations,
  getTenantGitHubInstallationsForTests,
  getGitHubInstallationMetadataStoreStatus,
  GitHubInstallationStoreError,
  listTenantGitHubInstallationStatuses,
  markTenantGitHubInstallationStatus,
  upsertTenantGitHubInstallation
} from "./github-installations";

describe("GitHub installation metadata store", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearTenantGitHubInstallationsForTests();
  });

  it("stores and counts tenant installation metadata in memory without repository-derived counts", async () => {
    const env = {
      AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 321,
      accountId: 1001,
      accountLogin: "RengGyu",
      accountType: "User"
    }, env);
    await markTenantGitHubInstallationStatus({
      tenantId: "tenant_a",
      installationId: 321,
      accountId: 1001,
      accountLogin: "RengGyu",
      accountType: "User",
      status: "deleted"
    }, env, Date.parse("2026-06-30T00:00:00Z"));

    await expect(countTenantGitHubInstallations({ tenantId: "tenant_a" }, env)).resolves.toEqual({
      count: 1,
      store: "memory",
      durable: false,
      configured: true
    });
    await expect(countTenantGitHubInstallations({ tenantId: "tenant_b" }, env)).resolves.toEqual({
      count: 0,
      store: "memory",
      durable: false,
      configured: true
    });
    expect(getTenantGitHubInstallationsForTests()).toEqual([
      expect.objectContaining({
        tenantId: "tenant_a",
        installationId: 321,
        accountId: 1001,
        accountLogin: "RengGyu",
        accountType: "User",
        status: "deleted",
        deletedAt: "2026-06-30T00:00:00.000Z"
      })
    ]);
  });

  it("rejects cross-tenant installation reassignment in memory", async () => {
    const env = {
      AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await upsertTenantGitHubInstallation({ tenantId: "tenant_a", installationId: 321 }, env);

    await expect(
      upsertTenantGitHubInstallation({ tenantId: "tenant_b", installationId: 321 }, env)
    ).rejects.toBeInstanceOf(GitHubInstallationStoreError);
  });

  it("lists tenant installation statuses as bounded metadata only", async () => {
    const env = {
      AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    await upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 321,
      accountId: 1001,
      accountLogin: "RengGyu",
      accountType: "User",
      status: "suspended"
    }, env);
    await upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 322,
      accountId: 1002,
      accountLogin: "PrivateOrg",
      accountType: "Organization",
      status: "deleted"
    }, env);
    await upsertTenantGitHubInstallation({
      tenantId: "tenant_b",
      installationId: 999,
      accountId: 9999,
      accountLogin: "OtherTenant",
      accountType: "Organization",
      status: "deleted"
    }, env);

    const statuses = await listTenantGitHubInstallationStatuses({
      tenantId: "tenant_a",
      installationIds: [322, 321, 321, 999, "bad"]
    }, env);
    const serialized = JSON.stringify(statuses);

    expect(statuses).toEqual([
      { installationId: 321, status: "suspended" },
      { installationId: 322, status: "deleted" }
    ]);
    expect(serialized).not.toContain("RengGyu");
    expect(serialized).not.toContain("PrivateOrg");
    expect(serialized).not.toContain("OtherTenant");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("accountType");
  });

  it("uses Supabase lookup and upsert without storing tokens or raw payloads", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("select=tenant_id")) {
        return Response.json([]);
      }

      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const env = supabaseEnv();

    await expect(upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 321,
      accountId: 1001,
      accountLogin: "RengGyu",
      accountType: "User",
      status: "active"
    }, env, Date.parse("2026-06-30T00:00:00Z"))).resolves.toEqual({
      count: 1,
      store: "supabase",
      durable: true,
      configured: true
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://agentproof-test.supabase.co/rest/v1/github_installations_test?installation_id=eq.321&select=tenant_id&limit=2",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://agentproof-test.supabase.co/rest/v1/github_installations_test?on_conflict=tenant_id,installation_id",
      expect.objectContaining({ method: "POST" })
    );
    const [, init] = fetchMock.mock.calls[1] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(body);

    expect(body).toEqual({
      tenant_id: "tenant_a",
      installation_id: 321,
      account_id: 1001,
      account_login: "RengGyu",
      account_type: "User",
      status: "active",
      created_at: "2026-06-30T00:00:00.000Z",
      updated_at: "2026-06-30T00:00:00.000Z",
      suspended_at: null,
      deleted_at: null
    });
    expect(serializedBody).not.toContain("service-role-secret");
    expect(serializedBody).not.toContain("github_pat_");
    expect(serializedBody).not.toContain("webhook");
    expect(serializedBody).not.toContain("raw_payload");
  });

  it("rejects Supabase installation rows already mapped to another tenant", async () => {
    const fetchMock = vi.fn(async () => Response.json([{ tenant_id: "tenant_other" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 321
    }, supabaseEnv())).rejects.toThrow("another tenant");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("counts Supabase installation rows with a narrow HEAD request", async () => {
    const fetchMock = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-range": "0-0/3" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(countTenantGitHubInstallations({ tenantId: "tenant_a" }, supabaseEnv())).resolves.toEqual({
      count: 3,
      store: "supabase",
      durable: true,
      configured: true
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/github_installations_test?tenant_id=eq.tenant_a&select=tenant_id",
      expect.objectContaining({
        method: "HEAD"
      })
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("Prefer")).toBe("count=exact");
    expect(new Headers(init.headers).get("Range")).toBe("0-0");
  });

  it("lists Supabase installation statuses with tenant and installation filters only", async () => {
    const fetchMock = vi.fn(async () => Response.json([
      {
        installation_id: 321,
        status: "suspended",
        account_login: "PrivateOrg",
        raw_payload: "must not be returned"
      },
      {
        installation_id: 322,
        status: "deleted"
      },
      {
        installation_id: 323,
        status: "invalid"
      }
    ]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listTenantGitHubInstallationStatuses({
      tenantId: "tenant_a",
      installationIds: [321, 322, 322]
    }, supabaseEnv())).resolves.toEqual([
      { installationId: 321, status: "suspended" },
      { installationId: 322, status: "deleted" }
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/github_installations_test?tenant_id=eq.tenant_a&installation_id=in.(321,322)&select=installation_id,status&limit=500",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("is disabled when no durable or explicit memory store is configured", async () => {
    expect(getGitHubInstallationMetadataStoreStatus({} as NodeJS.ProcessEnv)).toEqual({
      mode: "disabled",
      configured: false,
      durable: false,
      table: "agentproof_github_installations",
      missingEnv: []
    });
    await expect(countTenantGitHubInstallations({
      tenantId: "tenant_a"
    }, {} as NodeJS.ProcessEnv)).resolves.toEqual({
      count: 0,
      store: "none",
      durable: false,
      configured: false,
      disabled: true
    });
  });

  it("fails closed for partial Supabase configuration", async () => {
    expect(getGitHubInstallationMetadataStoreStatus({
      AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL: "https://agentproof-test.supabase.co"
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      mode: "disabled",
      configured: false,
      durable: false,
      table: "agentproof_github_installations",
      missingEnv: [
        "AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY or AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY"
      ]
    });
    await expect(countTenantGitHubInstallations({
      tenantId: "tenant_a"
    }, {
      AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL: "https://agentproof-test.supabase.co"
    } as unknown as NodeJS.ProcessEnv)).rejects.toBeInstanceOf(GitHubInstallationStoreError);
  });
});

function supabaseEnv() {
  return {
    AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL: "https://agentproof-test.supabase.co",
    AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
    AGENTPROOF_GITHUB_INSTALLATIONS_TABLE: "github_installations_test"
  } as unknown as NodeJS.ProcessEnv;
}
