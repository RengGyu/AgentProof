import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGitHubOnboardingSessionsForTests,
  createGitHubAppInstallSession
} from "@/lib/github-onboarding";
import { clearTenantGitHubInstallationsForTests } from "@/lib/github-installations";
import { GET } from "./route";

describe("GET /api/github/onboarding/callback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubOnboardingSessionsForTests();
    clearTenantGitHubInstallationsForTests();
  });

  it("creates a pending operator claim without exposing tenant or installation identity", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(202);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_installation_claim=");
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(json).toEqual({
      ok: true,
      claimExpiresAt: expect.any(String),
      operatorRequestCode: expect.any(String),
      next: "operator_approval_required"
    });
    expect(serialized).not.toContain(String(state));
    expect(serialized).not.toContain("state-secret-value");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("321");
  });

  it("rejects callback replay for the same state and nonce", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");
    const request = () => new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    );

    expect((await GET(request())).status).toBe(202);
    const replay = await GET(request());

    expect(replay.status).toBe(401);
    await expect(replay.json()).resolves.toEqual({
      error: "GitHub App onboarding state is invalid or expired.",
      code: "github_onboarding_state_invalid"
    });
  });

  it("redirects browser callbacks to integrations without exposing opaque state", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { accept: "text/html", cookie: install.nonceCookie } }
    ));
    const location = response.headers.get("Location") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_installation_claim=");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(location).toContain("/tenant?");
    expect(location).toContain("githubApp=pending");
    expect(location).not.toContain("tenantId=");
    expect(location).not.toContain("installationId=");
    expect(location).not.toContain(String(state));
    expect(location).not.toContain("state-secret-value");
  });

  it("requires the browser nonce cookie before issuing activation", async () => {
    stubOnboardingEnv();
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: "agentproof_github_onboarding_nonce=wrong" } }
    ));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App onboarding state is invalid or expired.",
      code: "github_onboarding_state_invalid"
    });
  });

  it("does not touch installation metadata before operator approval", async () => {
    stubOnboardingEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));

    expect(response.status).toBe(202);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed with a bounded 503 when durable claim storage is unavailable", async () => {
    stubOnboardingEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");
    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App installation approval storage is unavailable.",
      code: "github_installation_claim_store_unavailable"
    });
  });

  it("uses the same pending path under strict operator-claim configuration", async () => {
    stubOnboardingEnv();
    vi.stubEnv("AGENTPROOF_GITHUB_OPERATOR_CLAIMS_REQUIRED", "true");
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" });
    const state = new URL(install.installUrl).searchParams.get("state");

    const response = await GET(new Request(
      `http://localhost/api/github/onboarding/callback?installation_id=321&setup_action=install&state=${state}`,
      { headers: { cookie: install.nonceCookie } }
    ));

    expect(response.status).toBe(202);
    expect(response.headers.get("Set-Cookie")).toContain("agentproof_github_installation_claim=");
  });
});

function stubOnboardingEnv() {
  vi.stubEnv("AGENTPROOF_GITHUB_APP_SLUG", "agentproof-test");
  vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITE_TOKEN", "invite-token-value");
  vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-claim-token");
}
