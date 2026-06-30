import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant
} from "@/lib/tenant-control-plane";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { GET } from "./route";

describe("GET /api/tenants/repositories/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearTenantRepositoryGrantsForTests();
  });

  it("requires tenant control plane before reading repository health", async () => {
    stubInviteEnv();

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant control plane must be enabled before repository health can be read.",
      code: "tenant_repository_health_control_required"
    });
  });

  it("does not accept the legacy global invite token for repository health", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_BETA_INVITE_TOKEN", "global-invite-token");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "global-invite-token" }
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository health requires a valid tenant-bound invite token.",
      code: "tenant_repository_health_unauthorized"
    });
  });

  it("rejects wrong-tenant and missing invite tokens before store or GitHub access", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    stubInviteEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const wrongTenant = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" }
    }));
    const missing = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github"));

    expect(wrongTenant.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrongTenant.headers.get("Cache-Control")).toContain("no-store");
    expect(missing.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(wrongTenant.json()).resolves.toEqual({
      error: "Tenant repository health requires a valid tenant-bound invite token.",
      code: "tenant_repository_health_unauthorized"
    });
  });

  it("returns metadata-only repository health for one authorized tenant without GitHub calls", async () => {
    stubSettingsEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a", {
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
          status: "app-credentials-not-ready",
          githubAccess: "not-checked",
          checks: {
            grantActive: true,
            analysisEnabled: true,
            appCredentialsReady: false,
            githubAccess: "not-checked"
          },
          nextAction: "Configure GitHub App credentials before running repository health probes."
        }
      ],
      truncated: false,
      probe: "metadata-only",
      privacy: "grant-metadata-only",
      next: "fix_repository_setup"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Other/Private");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("GITHUB_PRIVATE_KEY");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("returns metadata-only repository health with a tenant admin session cookie", async () => {
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

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      probe: "metadata-only",
      privacy: "grant-metadata-only"
    });
    expect(json.repositories).toHaveLength(1);
  });

  it("probes GitHub repository access with bounded metadata and no token exposure", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/RemovedRepo"
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);

      if (href === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({ token: "installation-token" });
      }

      if (href === "https://api.github.com/repositories/100") {
        return Response.json({
          id: 100,
          full_name: "RengGyu/AgentProof",
          private: true,
          token: "github_pat_secret_should_not_leak_1234567890"
        });
      }

      if (href === "https://api.github.com/repositories/101") {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }

      return Response.json({ message: `Unhandled ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 100,
        status: "github-accessible",
        githubAccess: "accessible",
        nextAction: "Repository is ready for AgentProof evidence reports."
      }),
      expect.objectContaining({
        repositoryId: 101,
        status: "github-inaccessible",
        githubAccess: "inaccessible",
        nextAction: "Check GitHub App installation access for this repository."
      })
    ]);
    expect(json.probe).toBe("github");
    expect(json.githubProbe).toEqual({
      checkedRepositories: 2,
      maxRepositories: 10
    });
    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toHaveLength(1);
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("Not Found");
  });

  it("does not report ready when installation token creation fails", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({
          message: "Bad credentials",
          token: "github_pat_secret_should_not_leak_1234567890"
        }, { status: 401 });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 100,
        status: "app-credentials-not-ready",
        githubAccess: "credentials-not-ready",
        nextAction: "Configure GitHub App credentials before running repository health probes."
      })
    ]);
    expect(serialized).not.toContain("Bad credentials");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("ready for AgentProof");
  });

  it("gives rate-limit headers precedence over generic permission failures", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") return Response.json({ token: "installation-token" });
      if (href === "https://api.github.com/repositories/100") {
        return Response.json({ message: "API rate limit exceeded" }, {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" }
        });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 100,
        status: "github-rate-limited",
        githubAccess: "rate-limited",
        nextAction: "Wait for GitHub rate limits to recover, then rerun the health probe."
      })
    ]);
  });

  it("bounds live GitHub probes and leaves unprobed repositories not checked", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    for (let index = 0; index < 12; index += 1) {
      await createTenantRepositoryGrant({
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100 + index,
        repositoryFullName: `RengGyu/Repo${String(index).padStart(2, "0")}`
      });
    }
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") return Response.json({ token: "installation-token" });
      if (href.startsWith("https://api.github.com/repositories/")) return Response.json({ id: Number(href.split("/").pop()) });

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.repositories).toHaveLength(12);
    expect(json.githubProbe).toEqual({
      checkedRepositories: 10,
      maxRepositories: 10
    });
    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("https://api.github.com/repositories/")
    )).toHaveLength(10);
    expect(json.repositories.slice(0, 10).every((repo: { githubAccess: string }) => repo.githubAccess === "accessible")).toBe(true);
    expect(json.repositories.slice(10)).toEqual([
      expect.objectContaining({ repositoryId: 110, status: "github-not-checked", githubAccess: "not-checked" }),
      expect.objectContaining({ repositoryId: 111, status: "github-not-checked", githubAccess: "not-checked" })
    ]);
  });

  it("can probe one requested repository id without probing the full tenant list", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/First"
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Second"
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") return Response.json({ token: "installation-token" });
      if (href === "https://api.github.com/repositories/101") return Response.json({ id: 101 });

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=101", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.githubProbe).toEqual({
      checkedRepositories: 1,
      maxRepositories: 10,
      requestedRepositoryId: 101
    });
    expect(json.repositories).toEqual([
      expect.objectContaining({ repositoryId: 100, status: "github-not-checked", githubAccess: "not-checked" }),
      expect.objectContaining({ repositoryId: 101, status: "github-accessible", githubAccess: "accessible" })
    ]);
    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("https://api.github.com/repositories/")
    )).toHaveLength(1);
  });

  it("reports disabled and analysis-disabled grants before live GitHub probe status", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/Disabled",
      enabled: false
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/AnalysisOff",
      analysisEnabled: false
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") return Response.json({ token: "installation-token" });
      return Response.json({ id: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 101,
        status: "analysis-disabled",
        githubAccess: "accessible"
      }),
      expect.objectContaining({
        repositoryId: 100,
        status: "disabled",
        githubAccess: "accessible"
      })
    ]);
  });

  it("fails closed when the repository grant store is unavailable after authorization", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    stubInviteEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository grant store is unavailable.",
      code: "tenant_repository_grant_store_unavailable"
    });
  });

  it("rejects malformed requested repository ids without GitHub calls", async () => {
    stubSettingsEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=abc", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Repository health probe repositoryId must be a positive integer.",
      code: "tenant_repository_health_repository_id_invalid"
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

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
