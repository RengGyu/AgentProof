import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTenantGitHubInstallationsForTests,
  countTenantGitHubInstallations
} from "./github-installations";
import {
  clearGitHubOnboardingSessionsForTests,
  clearTenantAdminSessionCookie,
  completeGitHubAppInstallCallback,
  createGitHubAppInstallSession,
  createTenantAdminSession,
  getGitHubOnboardingConfigStatus,
  normalizeGitHubInstallationRepositories,
  ONBOARDING_ACTIVATION_COOKIE,
  ONBOARDING_NONCE_COOKIE,
  TENANT_ADMIN_SESSION_COOKIE,
  verifyBetaInviteToken,
  verifyBetaInviteTokenForTenant,
  verifyTenantAdminAccess,
  verifyTenantAdminSession,
  verifyGitHubActivationSession,
  consumeGitHubActivationSession
} from "./github-onboarding";

describe("github onboarding helpers", () => {
  const now = Date.parse("2026-06-30T00:00:00Z");
  const env = {
    AGENTPROOF_GITHUB_APP_SLUG: "agentproof-test",
    AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
    AGENTPROOF_BETA_INVITE_TOKEN: "invite-token-value",
    AGENTPROOF_BETA_INVITES: JSON.stringify([
      { tenantId: "tenant_a", token: "tenant-a-invite-token" }
    ]),
    AGENTPROOF_ONBOARDING_ALLOW_MEMORY: "true"
  } as unknown as NodeJS.ProcessEnv;

  afterEach(() => {
    vi.unstubAllGlobals();
    clearGitHubOnboardingSessionsForTests();
    clearTenantGitHubInstallationsForTests();
  });

  it("creates opaque install sessions without exposing tenant or invite secrets in state", async () => {
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" }, env, now);
    const url = new URL(install.installUrl);
    const state = url.searchParams.get("state") ?? "";
    const serialized = JSON.stringify(install);

    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe("/apps/agentproof-test/installations/new");
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(state).not.toContain("tenant_a");
    expect(install.expiresAt).toBe("2026-06-30T00:15:00.000Z");
    expect(install.nonceCookie).toContain(`${ONBOARDING_NONCE_COOKIE}=`);
    expect(install.nonceCookie).toContain("Max-Age=900");
    expect(install.nonceCookie).toContain("HttpOnly");
    expect(install.nonceCookie).toContain("Secure");
    expect(install.nonceCookie).toContain("SameSite=Lax");
    expect(serialized).not.toContain("invite-token-value");
    expect(serialized).not.toContain("state-secret-value");
  });

  it("requires the nonce cookie and consumes install state once before issuing activation", async () => {
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" }, env, now);
    const state = new URL(install.installUrl).searchParams.get("state");

    await expect(completeGitHubAppInstallCallback({
      state,
      nonceCookieHeader: `${ONBOARDING_NONCE_COOKIE}=wrong`,
      installationId: 321
    }, env, now + 1_000)).rejects.toThrow("invalid");

    const activation = await completeGitHubAppInstallCallback({
      state,
      nonceCookieHeader: install.nonceCookie,
      installationId: 321
    }, env, now + 1_000);

    expect(activation).toMatchObject({
      tenantId: "tenant_a",
      installationId: 321,
      expiresAt: "2026-06-30T00:15:01.000Z"
    });
    expect(activation.activationCookie).toContain(`${ONBOARDING_ACTIVATION_COOKIE}=`);
    expect(activation.activationCookie).toContain("HttpOnly");

    await expect(completeGitHubAppInstallCallback({
      state,
      nonceCookieHeader: install.nonceCookie,
      installationId: 321
    }, env, now + 2_000)).rejects.toThrow("invalid");
  });

  it("records first-class GitHub installation metadata after verified callback state and nonce", async () => {
    const installEnv = {
      ...env,
      AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" }, installEnv, now);
    const state = new URL(install.installUrl).searchParams.get("state");

    await completeGitHubAppInstallCallback({
      state,
      nonceCookieHeader: install.nonceCookie,
      installationId: 321
    }, installEnv, now + 1_000);

    await expect(countTenantGitHubInstallations({ tenantId: "tenant_a" }, installEnv)).resolves.toEqual({
      count: 1,
      store: "memory",
      durable: false,
      configured: true
    });
  });

  it("verifies activation sessions and rejects replay after repository grant consumption", async () => {
    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" }, env, now);
    const activation = await completeGitHubAppInstallCallback({
      state: new URL(install.installUrl).searchParams.get("state"),
      nonceCookieHeader: install.nonceCookie,
      installationId: 321
    }, env, now + 1_000);

    await expect(verifyGitHubActivationSession({
      cookieHeader: activation.activationCookie,
      installationId: 321
    }, env, now + 2_000)).resolves.toEqual({
      valid: true,
      tenantId: "tenant_a",
      installationId: 321,
      expiresAt: "2026-06-30T00:15:01.000Z"
    });
    await expect(verifyGitHubActivationSession({
      cookieHeader: activation.activationCookie,
      installationId: 999
    }, env, now + 2_000)).resolves.toEqual({
      valid: false,
      reason: "installation-mismatch"
    });

    await expect(consumeGitHubActivationSession({
      cookieHeader: activation.activationCookie,
      installationId: 321
    }, env, now + 2_000)).resolves.toEqual({
      valid: true,
      tenantId: "tenant_a",
      installationId: 321,
      expiresAt: "2026-06-30T00:15:01.000Z"
    });
    await expect(consumeGitHubActivationSession({
      cookieHeader: activation.activationCookie,
      installationId: 321
    }, env, now + 3_000)).resolves.toEqual({
      valid: false,
      reason: "not-found"
    });
  });

  it("fails closed when activation verification has a cookie but no state store", async () => {
    await expect(verifyGitHubActivationSession({
      cookieHeader: `${ONBOARDING_ACTIVATION_COOKIE}=opaque-token`,
      installationId: 321
    }, {
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy"
    } as unknown as NodeJS.ProcessEnv, now)).rejects.toThrow("state store");
  });

  it("stores only hashed state and nonce values in Supabase onboarding storage", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const supabaseEnv = {
      AGENTPROOF_GITHUB_APP_SLUG: "agentproof-test",
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITE_TOKEN: "invite-token-value",
      AGENTPROOF_BETA_INVITES: JSON.stringify([
        { tenantId: "tenant_a", token: "tenant-a-invite-token" }
      ]),
      AGENTPROOF_ONBOARDING_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_ONBOARDING_STATES_TABLE: "onboarding_states_test"
    } as unknown as NodeJS.ProcessEnv;

    const install = await createGitHubAppInstallSession({ tenantId: "tenant_a" }, supabaseEnv, now);
    const rawState = new URL(install.installUrl).searchParams.get("state") ?? "";
    const rawNonce = install.nonceCookie.split(";")[0]?.split("=")[1] ?? "";
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(body);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/onboarding_states_test",
      expect.objectContaining({ method: "POST" })
    );
    expect(body).toMatchObject({
      kind: "install",
      tenant_id: "tenant_a",
      installation_id: null,
      used_at: null
    });
    expect(body.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.nonce_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(serializedBody).not.toContain(rawState);
    expect(serializedBody).not.toContain(rawNonce);
    expect(serializedBody).not.toContain("service-role-secret");
    expect(serializedBody).not.toContain("invite-token-value");
  });

  it("normalizes config and invite tokens without exposing values", () => {
    expect(getGitHubOnboardingConfigStatus(env)).toEqual({
      configured: true,
      appSlugConfigured: true,
      stateSecretConfigured: true,
      inviteTokenConfigured: true
    });
    expect(verifyBetaInviteToken("invite-token-value", env)).toBe(true);
    expect(verifyBetaInviteToken("wrong-token", env)).toBe(false);
  });

  it("does not mark onboarding ready for missing or malformed tenant-bound invite records", () => {
    expect(getGitHubOnboardingConfigStatus({
      AGENTPROOF_GITHUB_APP_SLUG: "agentproof-test",
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITE_TOKEN: "legacy-global-token"
    } as unknown as NodeJS.ProcessEnv)).toEqual({
      configured: false,
      appSlugConfigured: true,
      stateSecretConfigured: true,
      inviteTokenConfigured: false
    });
    expect(getGitHubOnboardingConfigStatus({
      AGENTPROOF_GITHUB_APP_SLUG: "agentproof-test",
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITES: "{not-json"
    } as unknown as NodeJS.ProcessEnv).configured).toBe(false);
  });

  it("supports tenant-bound beta invites so one invite cannot claim another tenant", () => {
    const scopedEnv = {
      AGENTPROOF_GITHUB_APP_SLUG: "agentproof-test",
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITES: JSON.stringify([
        {
          tenantId: "tenant_a",
          token: "tenant-a-invite-token"
        },
        {
          tenantId: "tenant_b",
          tokenHash: "0".repeat(64)
        }
      ])
    } as unknown as NodeJS.ProcessEnv;

    expect(getGitHubOnboardingConfigStatus(scopedEnv).configured).toBe(true);
    expect(verifyBetaInviteTokenForTenant("tenant-a-invite-token", "tenant_a", scopedEnv)).toBe(true);
    expect(verifyBetaInviteTokenForTenant("tenant-a-invite-token", "tenant_b", scopedEnv)).toBe(false);
    expect(verifyBetaInviteTokenForTenant("tenant-a-invite-token", "tenant_a", {
      ...scopedEnv,
      AGENTPROOF_BETA_INVITES: "{not-json"
    } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it("creates tenant admin session cookies without storing invite tokens in the payload", () => {
    const sessionEnv = tenantSessionEnv();
    const session = createTenantAdminSession({
      tenantId: " tenant_a ",
      inviteToken: "tenant-a-invite-token"
    }, sessionEnv, now);
    const serialized = JSON.stringify(session);

    expect(session.tenantId).toBe("tenant_a");
    expect(session.expiresAt).toBe("2026-06-30T12:00:00.000Z");
    expect(session.sessionCookie).toContain(`${TENANT_ADMIN_SESSION_COOKIE}=`);
    expect(session.sessionCookie).toContain("Max-Age=43200");
    expect(session.sessionCookie).toContain("HttpOnly");
    expect(session.sessionCookie).toContain("Secure");
    expect(session.sessionCookie).toContain("SameSite=Lax");
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("tenant-session-secret-value");
  });

  it("verifies tenant admin session cookies by tenant, signature, and expiry", () => {
    const sessionEnv = tenantSessionEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, sessionEnv, now);
    const cookieValue = session.sessionCookie.split(";")[0]?.split("=")[1] ?? "";
    const tamperedCookie = `${TENANT_ADMIN_SESSION_COOKIE}=${cookieValue.slice(0, -1)}x`;

    expect(verifyTenantAdminSession({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    }, sessionEnv, now + 1_000)).toBe(true);
    expect(verifyTenantAdminSession({
      tenantId: "tenant_b",
      cookieHeader: session.sessionCookie
    }, sessionEnv, now + 1_000)).toBe(false);
    expect(verifyTenantAdminSession({
      tenantId: "tenant_a",
      cookieHeader: tamperedCookie
    }, sessionEnv, now + 1_000)).toBe(false);
    expect(verifyTenantAdminSession({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    }, sessionEnv, Date.parse(session.expiresAt) + 1)).toBe(false);
  });

  it("authorizes tenant admin access through either session cookie or tenant-bound header fallback", () => {
    const sessionEnv = tenantSessionEnv();
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, sessionEnv, now);

    expect(verifyTenantAdminAccess({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    }, sessionEnv, now + 1_000)).toEqual({
      authorized: true,
      tenantId: "tenant_a",
      method: "session"
    });
    expect(verifyTenantAdminAccess({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, {
      AGENTPROOF_BETA_INVITES: sessionEnv.AGENTPROOF_BETA_INVITES
    } as unknown as NodeJS.ProcessEnv, now + 1_000)).toEqual({
      authorized: true,
      tenantId: "tenant_a",
      method: "invite"
    });
    expect(verifyTenantAdminAccess({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie,
      inviteToken: "tenant-b-invite-token"
    }, sessionEnv, now + 1_000)).toEqual({
      authorized: true,
      tenantId: "tenant_a",
      method: "session"
    });
  });

  it("carries bounded invite roles into tenant admin access without exposing invite secrets", () => {
    const sessionEnv = {
      AGENTPROOF_TENANT_SESSION_SECRET: "tenant-session-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITES: JSON.stringify([
        { tenantId: "tenant_a", token: "tenant-a-invite-token", role: "admin" },
        { tenantId: "tenant_b", token: "tenant-b-invite-token", role: "member" }
      ])
    } as unknown as NodeJS.ProcessEnv;
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, sessionEnv, now);
    const serialized = JSON.stringify(session);

    expect(verifyTenantAdminAccess({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, sessionEnv, now + 1_000)).toEqual({
      authorized: true,
      tenantId: "tenant_a",
      method: "invite",
      role: "admin"
    });
    expect(verifyTenantAdminAccess({
      tenantId: "tenant_a",
      cookieHeader: session.sessionCookie
    }, sessionEnv, now + 1_000)).toEqual({
      authorized: true,
      tenantId: "tenant_a",
      method: "session",
      role: "admin"
    });
    expect(serialized).not.toContain("tenant-a-invite-token");
    expect(serialized).not.toContain("tenant-session-secret-value");
  });

  it("fails closed for malformed invite roles", () => {
    const malformedEnv = {
      AGENTPROOF_GITHUB_APP_SLUG: "agentproof-test",
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
      AGENTPROOF_TENANT_SESSION_SECRET: "tenant-session-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITES: JSON.stringify([
        { tenantId: "tenant_a", token: "tenant-a-invite-token", role: "superadmin" }
      ])
    } as unknown as NodeJS.ProcessEnv;

    expect(getGitHubOnboardingConfigStatus(malformedEnv).configured).toBe(false);
    expect(verifyTenantAdminAccess({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, malformedEnv, now + 1_000)).toEqual({ authorized: false });
    expect(() => createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, malformedEnv, now)).toThrow("invalid");
  });

  it("requires a dedicated tenant session secret before issuing or accepting session cookies", () => {
    const scopedEnv = {
      AGENTPROOF_ONBOARDING_STATE_SECRET: "state-secret-value-with-enough-entropy",
      AGENTPROOF_BETA_INVITES: JSON.stringify([
        { tenantId: "tenant_a", token: "tenant-a-invite-token" }
      ])
    } as unknown as NodeJS.ProcessEnv;

    expect(() => createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    }, scopedEnv, now)).toThrow("invalid");
    expect(verifyTenantAdminSession({
      tenantId: "tenant_a",
      cookieHeader: `${TENANT_ADMIN_SESSION_COOKIE}=opaque`
    }, scopedEnv, now)).toBe(false);
  });

  it("clears tenant admin session cookies without exposing session internals", () => {
    const cookie = clearTenantAdminSessionCookie(now);

    expect(cookie).toContain(`${TENANT_ADMIN_SESSION_COOKIE}=deleted`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("normalizes GitHub installation repositories to bounded metadata", () => {
    expect(normalizeGitHubInstallationRepositories({
      repositories: [
        {
          id: 1,
          full_name: "RengGyu/AgentProof",
          private: true,
          default_branch: "main",
          description: "not returned",
          token: "github_pat_secret_should_not_leak_1234567890"
        },
        {
          id: "bad",
          full_name: "bad/repo",
          private: false
        }
      ]
    })).toEqual([
      {
        id: 1,
        fullName: "RengGyu/AgentProof",
        private: true,
        defaultBranch: "main"
      }
    ]);
  });
});

function tenantSessionEnv() {
  return {
    AGENTPROOF_TENANT_SESSION_SECRET: "tenant-session-secret-value-with-enough-entropy",
    AGENTPROOF_BETA_INVITES: JSON.stringify([
      { tenantId: "tenant_a", token: "tenant-a-invite-token" },
      { tenantId: "tenant_b", token: "tenant-b-invite-token" }
    ])
  } as unknown as NodeJS.ProcessEnv;
}
