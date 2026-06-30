import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGitHubOnboardingSessionsForTests,
  completeGitHubAppInstallCallback,
  createGitHubAppInstallSession
} from "@/lib/github-onboarding";
import {
  authorizeTenantRepositoryGrantAsync,
  clearTenantRepositoryGrantsForTests
} from "@/lib/tenant-control-plane";
import { GET, POST } from "./route";

describe("/api/github/onboarding/repositories", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubOnboardingSessionsForTests();
    clearTenantRepositoryGrantsForTests();
  });

  it("lists only bounded repository metadata for a verified activation session", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockRepositoryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();

    const response = await GET(new Request("http://localhost/api/github/onboarding/repositories?installationId=321", {
      headers: { cookie: activationCookie }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      installationId: 321,
      repositories: [
        {
          id: 100,
          fullName: "RengGyu/AgentProof",
          private: true,
          defaultBranch: "main"
        },
        {
          id: 101,
          fullName: "RengGyu/AgentProofDocs",
          private: false,
          defaultBranch: "main"
        }
      ],
      next: "choose_one_repository"
    });
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("description should not return");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("fails closed when activation cookies are present but no onboarding state store is configured", async () => {
    vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");

    const response = await GET(new Request("http://localhost/api/github/onboarding/repositories?installationId=321", {
      headers: { cookie: "agentproof_github_activation=opaque-token" }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App onboarding state store is unavailable.",
      code: "github_onboarding_state_store_unavailable"
    });
  });


  it("creates a tenant repository grant from server-fetched repository id metadata", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    const fetchMock = mockRepositoryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();

    const response = await POST(new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "Attacker/ChosenName",
        saveReportsEnabled: true,
        commentEnabled: false
      })
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      settings: {
        analysisEnabled: true,
        saveReportsEnabled: true,
        commentEnabled: false
      },
      privacy: "grant-metadata-only",
      next: "webhook_analysis_enabled_for_repository"
    });
    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "Renamed/AgentProof"
    })).resolves.toMatchObject({
      grant: {
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/AgentProof"
      }
    });
  });

  it("blocks repository grant creation for an unavailable tenant before fetching GitHub repositories", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_TOMBSTONES", JSON.stringify(["tenant_a"]));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();

    const response = await POST(new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({
        installationId: 321,
        repositoryId: 100
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: "Tenant repository setup is unavailable.",
      code: "github_onboarding_tenant_unavailable"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("deletion");
    expect(serialized).not.toContain("tombstone");
    expect(serialized).not.toContain("RengGyu");
  });

  it("can grant a repository found on a later bounded installation repository page", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    const fetchMock = mockPaginatedRepositoryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();

    const response = await POST(new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({
        installationId: 321,
        repositoryId: 250
      })
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      repositoryId: 250,
      repositoryFullName: "RengGyu/PageTwoRepo"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/installation/repositories?per_page=100&page=2",
      expect.any(Object)
    );
  });


  it("does not consume activation when the requested repository id is not installed", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    const fetchMock = mockRepositoryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();

    const bad = await POST(new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({ installationId: 321, repositoryId: 999 })
    }));
    const good = await POST(new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({ installationId: 321, repositoryId: 100 })
    }));

    expect(bad.status).toBe(422);
    await expect(bad.json()).resolves.toEqual({
      error: "Selected repository is not available to this GitHub App installation.",
      code: "github_onboarding_repository_not_installed"
    });
    expect(good.status).toBe(200);
  });

  it("rejects replay after repository grant creation consumes activation", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    const fetchMock = mockRepositoryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();
    const request = () => new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({ installationId: 321, repositoryId: 100 })
    });

    expect((await POST(request())).status).toBe(200);
    const replay = await POST(request());

    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({
      error: "GitHub App activation session is invalid or expired.",
      code: "github_onboarding_activation_invalid"
    });
  });

  it("fails closed when grant storage is unavailable after server-side repository verification", async () => {
    stubOnboardingEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    const fetchMock = mockRepositoryFetch();
    vi.stubGlobal("fetch", fetchMock);
    const activationCookie = await createActivationCookie();

    const response = await POST(new Request("http://localhost/api/github/onboarding/repositories", {
      method: "POST",
      headers: { cookie: activationCookie },
      body: JSON.stringify({ installationId: 321, repositoryId: 100 })
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant repository grant store is unavailable.",
      code: "github_onboarding_grant_store_unavailable"
    });
  });
});

async function createActivationCookie() {
  const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
  const activation = await completeGitHubAppInstallCallback({
    state: new URL(install.installUrl).searchParams.get("state"),
    nonceCookieHeader: install.nonceCookie,
    installationId: 321
  });

  return activation.activationCookie;
}

function stubOnboardingEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
  vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITE_TOKEN", "invite-token-value");
  vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");
}

function mockRepositoryFetch() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);

    if (href === "https://api.github.com/app/installations/321/access_tokens") {
      return Response.json({ token: "installation-token" });
    }

    if (href === "https://api.github.com/installation/repositories?per_page=100&page=1") {
      expect(init?.headers).toEqual(expect.objectContaining({
        Authorization: "Bearer installation-token"
      }));

      return Response.json({
        repositories: [
          {
            id: 100,
            full_name: "RengGyu/AgentProof",
            private: true,
            default_branch: "main",
            description: "description should not return",
            token: "github_pat_secret_should_not_leak_1234567890"
          },
          {
            id: 101,
            full_name: "RengGyu/AgentProofDocs",
            private: false,
            default_branch: "main"
          }
        ]
      });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${href}` }), { status: 404 });
  });
}

function mockPaginatedRepositoryFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);

    if (href === "https://api.github.com/app/installations/321/access_tokens") {
      return Response.json({ token: "installation-token" });
    }

    if (href === "https://api.github.com/installation/repositories?per_page=100&page=1") {
      return Response.json({
        repositories: Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          full_name: `RengGyu/PageOneRepo${index + 1}`,
          private: false,
          default_branch: "main"
        }))
      });
    }

    if (href === "https://api.github.com/installation/repositories?per_page=100&page=2") {
      return Response.json({
        repositories: [
          {
            id: 250,
            full_name: "RengGyu/PageTwoRepo",
            private: true,
            default_branch: "main"
          }
        ]
      });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${href}` }), { status: 404 });
  });
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
