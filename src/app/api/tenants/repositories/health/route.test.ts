import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantGitHubInstallationsForTests,
  upsertTenantGitHubInstallation
} from "@/lib/github-installations";
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
    clearTenantGitHubInstallationsForTests();
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
      error: "Tenant repository health requires valid tenant authorization.",
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
      error: "Tenant repository health requires valid tenant authorization.",
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
          slackNotificationsEnabled: false,
          status: "app-credentials-not-ready",
          githubAccess: "not-checked",
          checks: {
            grantActive: true,
            analysisEnabled: true,
            installationStatus: "unknown",
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

  it("reports suspended and deleted installations before live GitHub probes without exposing account metadata", async () => {
    stubSettingsEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/Suspended"
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 322,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Deleted"
    });
    await upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 321,
      accountId: 1001,
      accountLogin: "private-account-login",
      accountType: "Organization",
      status: "suspended"
    });
    await upsertTenantGitHubInstallation({
      tenantId: "tenant_a",
      installationId: 322,
      accountId: 1002,
      accountLogin: "deleted-account-login",
      accountType: "Organization",
      status: "deleted"
    });

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 101,
        status: "installation-deleted",
        githubAccess: "not-checked",
        checks: expect.objectContaining({
          installationStatus: "deleted"
        }),
        nextAction: "Reconnect the GitHub App installation before verifying this repository."
      }),
      expect.objectContaining({
        repositoryId: 100,
        status: "installation-suspended",
        githubAccess: "not-checked",
        checks: expect.objectContaining({
          installationStatus: "suspended"
        }),
        nextAction: "Resume the GitHub App installation before verifying this repository."
      })
    ]);
    expect(json.githubProbe).toEqual({
      checkedRepositories: 0,
      maxRepositories: 10
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("private-account-login");
    expect(serialized).not.toContain("deleted-account-login");
    expect(serialized).not.toContain("accountId");
    expect(serialized).not.toContain("accountType");
    expect(serialized).not.toContain("installation-token");
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

  it("probes first-report readiness for one PR with bounded metadata only", async () => {
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
      if (href === "https://api.github.com/repositories/100") return Response.json({ id: 100 });
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/42") {
        return Response.json({
          changed_files: 121,
          title: "private PR title should not leak",
          body: "raw PR body should not leak",
          head: { sha: "abc123def4567890" },
          token: "github_pat_secret_should_not_leak_1234567890"
        });
      }
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123def4567890/check-runs?per_page=1") {
        return Response.json({ total_count: 0, check_runs: [] });
      }
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123def4567890/status") {
        return Response.json({ statuses: [] });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=42", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubProbe).toEqual({
      checkedRepositories: 1,
      maxRepositories: 10,
      requestedRepositoryId: 100,
      firstReport: {
        pullRequestNumber: 42,
        checkedRepositories: 1,
        maxRepositories: 1
      }
    });
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 100,
        status: "github-accessible",
        firstReport: {
          privacy: "first-report-readiness-metadata-only",
          pullRequestNumber: 42,
          status: "large-pr-capped",
          pullRequestAccess: "accessible",
          changedFiles: {
            status: "over-limit",
            count: 121,
            maxFiles: 120
          },
          checksAvailability: {
            status: "missing",
            sources: []
          },
          nextAction: "This PR exceeds the 120 changed-file evidence cap; split it or expect incomplete file evidence."
        }
      })
    ]);
    expect(serialized).not.toContain("private PR title");
    expect(serialized).not.toContain("raw PR body");
    expect(serialized).not.toContain("abc123def4567890");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("check_runs");
    expect(serialized).not.toContain("statuses");
  });

  it("reports ready first-report readiness when PR metadata and check evidence are reachable", async () => {
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
      if (href === "https://api.github.com/repositories/100") return Response.json({ id: 100 });
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7") {
        return Response.json({ changed_files: 2, head: { sha: "abc123def4567890" } });
      }
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123def4567890/check-runs?per_page=1") {
        return Response.json({
          total_count: 1,
          check_runs: [{ name: "private check name should not leak" }]
        });
      }
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123def4567890/status") {
        return Response.json({ statuses: [] });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=7", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories[0].firstReport).toEqual({
      privacy: "first-report-readiness-metadata-only",
      pullRequestNumber: 7,
      status: "ready",
      pullRequestAccess: "accessible",
      changedFiles: {
        status: "within-limit",
        count: 2,
        maxFiles: 120
      },
      checksAvailability: {
        status: "present",
        sources: ["check-runs"]
      },
      nextAction: "This PR has bounded metadata, changed-file count, and GitHub check/status evidence available for the first report."
    });
    expect(serialized).not.toContain("abc123def4567890");
    expect(serialized).not.toContain("private check name");
    expect(serialized).not.toContain("installation-token");
  });

  it("reports unavailable check evidence without exposing provider error bodies", async () => {
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
      if (href === "https://api.github.com/repositories/100") return Response.json({ id: 100 });
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/8") {
        return Response.json({ changed_files: 2, head: { sha: "abc123def4567890" } });
      }
      if (href.includes("/check-runs") || href.endsWith("/status")) {
        return Response.json({
          message: "provider outage with secret github_pat_secret_should_not_leak"
        }, { status: 503 });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=8", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories[0].firstReport).toEqual(expect.objectContaining({
      privacy: "first-report-readiness-metadata-only",
      pullRequestNumber: 8,
      status: "checks-unavailable",
      pullRequestAccess: "accessible",
      checksAvailability: {
        status: "unavailable",
        sources: []
      },
      nextAction: "Retry the PR readiness probe or check GitHub check/status API availability."
    }));
    expect(serialized).not.toContain("provider outage");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("abc123def4567890");
  });

  it("reports first-report rate limits without probing checks or exposing token material", async () => {
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
      if (href === "https://api.github.com/repositories/100") return Response.json({ id: 100 });
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/9") {
        return Response.json({
          message: "API rate limit exceeded github_pat_secret_should_not_leak"
        }, {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" }
        });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=9", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories[0].firstReport).toEqual({
      privacy: "first-report-readiness-metadata-only",
      pullRequestNumber: 9,
      status: "pull-request-rate-limited",
      pullRequestAccess: "rate-limited",
      changedFiles: {
        status: "not-checked",
        maxFiles: 120
      },
      checksAvailability: {
        status: "not-checked",
        sources: []
      },
      nextAction: "Wait for GitHub rate limits to recover, then rerun the PR readiness probe."
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/check-runs"))).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/status"))).toBe(false);
    expect(serialized).not.toContain("API rate limit exceeded");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("installation-token");
  });

  it("reports inaccessible pull requests without probing checks or echoing GitHub errors", async () => {
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
      if (href === "https://api.github.com/repositories/100") return Response.json({ id: 100 });
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/404") {
        return Response.json({
          message: "Not Found github_pat_secret_should_not_leak"
        }, { status: 404 });
      }

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=404", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories[0].firstReport).toEqual({
      privacy: "first-report-readiness-metadata-only",
      pullRequestNumber: 404,
      status: "pull-request-inaccessible",
      pullRequestAccess: "inaccessible",
      changedFiles: {
        status: "not-checked",
        maxFiles: 120
      },
      checksAvailability: {
        status: "not-checked",
        sources: []
      },
      nextAction: "Check that the GitHub App can read this PR and repository."
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/check-runs"))).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/status"))).toBe(false);
    expect(serialized).not.toContain("Not Found");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("installation-token");
  });

  it("does not fetch first-report PR diagnostics for repository ids outside the authorized tenant grants", async () => {
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
      tenantId: "tenant_b",
      installationId: 999,
      repositoryId: 200,
      repositoryFullName: "Other/Private"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=200&pullRequestNumber=1", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubProbe).toEqual({
      checkedRepositories: 0,
      maxRepositories: 10,
      requestedRepositoryId: 200,
      firstReport: {
        pullRequestNumber: 1,
        checkedRepositories: 0,
        maxRepositories: 1
      }
    });
    expect(json.repositories).toEqual([
      expect.objectContaining({
        repositoryId: 100,
        githubAccess: "not-checked"
      })
    ]);
    expect(json.repositories[0]).not.toHaveProperty("firstReport");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Other/Private");
  });

  it("does not mark disabled analysis grants ready even when repository access succeeds", async () => {
    stubSettingsEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      analysisEnabled: false
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") return Response.json({ token: "installation-token" });
      if (href === "https://api.github.com/repositories/100") return Response.json({ id: 100 });

      return Response.json({ message: `Unexpected ${href}` }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=12", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.repositories[0]).toEqual(expect.objectContaining({
      status: "analysis-disabled",
      githubAccess: "accessible",
      firstReport: {
        privacy: "first-report-readiness-metadata-only",
        pullRequestNumber: 12,
        status: "analysis-disabled",
        pullRequestAccess: "not-checked",
        changedFiles: {
          status: "not-checked",
          maxFiles: 120
        },
        checksAvailability: {
          status: "not-checked",
          sources: []
        },
        nextAction: "Enable evidence report analysis for this repository."
      }
    }));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/pulls/12"))).toBe(false);
    expect(serialized).not.toContain("installation-token");
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

  it("fails closed with bounded JSON when installation metadata is partially configured", async () => {
    stubSettingsEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "GitHub installation metadata is unavailable.",
      code: "tenant_repository_health_installation_metadata_unavailable"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("agentproof-test.supabase.co");
    expect(serialized).not.toContain("SUPABASE");
    expect(serialized).not.toContain("service-role");
    expect(serialized).not.toContain("RengGyu/AgentProof");
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

  it("rejects malformed pull request readiness probes without GitHub calls", async () => {
    stubSettingsEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const invalidNumber = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&repositoryId=100&pullRequestNumber=abc", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const missingGitHubProbe = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&repositoryId=100&pullRequestNumber=1", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const missingRepositoryId = await GET(new Request("http://localhost/api/tenants/repositories/health?tenantId=tenant_a&probe=github&pullRequestNumber=1", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));

    expect(invalidNumber.status).toBe(422);
    expect(missingGitHubProbe.status).toBe(422);
    expect(missingRepositoryId.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(invalidNumber.json()).resolves.toEqual({
      error: "Repository health pullRequestNumber must be a positive integer.",
      code: "tenant_repository_health_pull_request_number_invalid"
    });
    await expect(missingGitHubProbe.json()).resolves.toEqual({
      error: "Repository health pull request readiness requires probe=github.",
      code: "tenant_repository_health_pull_request_probe_requires_github"
    });
    await expect(missingRepositoryId.json()).resolves.toEqual({
      error: "Repository health pull request readiness requires repositoryId.",
      code: "tenant_repository_health_pull_request_repository_required"
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
