import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeConciergeAccess, conciergeRuntimeDefaults, type ConciergeAccessDependencies } from "./concierge-private-beta";
import { authorizeDurableTenantRepositoryGrantAsync } from "./tenant-control-plane";

const env: NodeJS.ProcessEnv = {
  ...process.env,
  VERCEL_ENV: "preview",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "test-placeholder",
  AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY: "test-placeholder"
};
const input = { repositoryFullName: "acme/private", cookieHeader: "session=x" };

function dependencies(overrides: Partial<ConciergeAccessDependencies> = {}): ConciergeAccessDependencies {
  return {
    resolveSession: vi.fn(async () => ({ tenantId: "tenant_alpha", memberId: "github-user-404", githubUserId: 404, installationId: 101, repositoryIds: [202], expiresAt: "session-bound" })),
    listGrants: vi.fn(async () => [{ tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", enabled: true, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false }]),
    listInstallationStatuses: vi.fn(async () => [{ installationId: 101, status: "active" }]),
    authorizeGrant: vi.fn(async () => ({ enabled: true, required: true, reason: "analysis-disabled", grant: { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", enabled: true, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false } })),
    ...overrides
  } as ConciergeAccessDependencies;
}

describe("concierge private beta authorization", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("keeps every external side effect off by default", () => {
    expect(conciergeRuntimeDefaults(env)).toMatchObject({ llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false, billingEnabled: false, fullHistoryEnabled: false });
  });

  it("keeps the global kill switch engaged until explicitly released", () => {
    expect(conciergeRuntimeDefaults(env)).toMatchObject({ manualAnalysisEnabled: false, globalKillSwitch: true });
    for (const release of ["0", "false", "no", "off"]) {
      expect(conciergeRuntimeDefaults({ ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: release })).toMatchObject({ manualAnalysisEnabled: true, globalKillSwitch: false });
    }
    expect(conciergeRuntimeDefaults({ ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "unexpected" })).toMatchObject({ manualAnalysisEnabled: false, globalKillSwitch: true });
  });

  it("never enables Concierge outside Vercel Preview", () => {
    const released = { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" };
    expect(conciergeRuntimeDefaults({ ...released, VERCEL_ENV: "production" }).manualAnalysisEnabled).toBe(false);
    expect(conciergeRuntimeDefaults({ ...released, VERCEL_ENV: undefined }).manualAnalysisEnabled).toBe(false);
  });

  it("uses existing complete same-project durable stores without the legacy control-plane enable flag", () => {
    const released = { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false", AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: undefined };
    expect(conciergeRuntimeDefaults(released).manualAnalysisEnabled).toBe(true);
    expect(conciergeRuntimeDefaults({ ...released, AGENTPROOF_CONCIERGE_SUPABASE_URL: "", AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "", AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }).manualAnalysisEnabled).toBe(false);
    expect(conciergeRuntimeDefaults({ ...released, AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://other.supabase.co" }).manualAnalysisEnabled).toBe(false);
  });

  it("authorizes durable manual grant while automated analysis remains off", async () => {
    expect(await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, dependencies())).toMatchObject({ authorized: true, repositoryId: 202 });
  });

  it.each([
    ["installation", { installationId: 999, repositoryId: 202 }],
    ["repository", { installationId: 101, repositoryId: 999 }]
  ])("rejects a grant adapter response with a mismatched %s id", async (_label, ids) => {
    const deps = dependencies({
      authorizeGrant: vi.fn(async () => ({
        enabled: true,
        required: true,
        reason: "analysis-disabled" as const,
        grant: {
          tenantId: "tenant_alpha",
          ...ids,
          repositoryFullName: "acme/private",
          enabled: true,
          analysisEnabled: false,
          commentEnabled: false,
          saveReportsEnabled: false,
          slackNotificationsEnabled: false
        }
      }))
    });
    await expect(authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, deps))
      .resolves.toEqual({ authorized: false, reason: "repository_identity_mismatch" });
  });

  it("requires exactly one enabled repository grant for the human-beta tenant", async () => {
    const multiGrant = dependencies({ listGrants: vi.fn(async () => [
      { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", enabled: true, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false },
      { tenantId: "tenant_alpha", installationId: 101, repositoryId: 203, repositoryFullName: "acme/other-private", enabled: true, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false }
    ]) });
    expect(await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, multiGrant)).toEqual({ authorized: false, reason: "tenant_grant_scope_invalid" });
    expect(multiGrant.listInstallationStatuses).not.toHaveBeenCalled();
    expect(multiGrant.authorizeGrant).not.toHaveBeenCalled();

    const disabledExtra = dependencies({ listGrants: vi.fn(async () => [
      { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", enabled: true, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false },
      { tenantId: "tenant_alpha", installationId: 101, repositoryId: 203, repositoryFullName: "acme/disabled", enabled: false, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false }
    ]) });
    expect(await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, disabledExtra)).toMatchObject({ authorized: true, repositoryId: 202 });
  });

  it.each([
    ["session", { resolveSession: vi.fn(async () => null) }, "session_invalid", 0, 0],
    ["installation missing", { listInstallationStatuses: vi.fn(async () => []) }, "installation_not_active", 1, 0],
    ["installation suspended", { listInstallationStatuses: vi.fn(async () => [{ installationId: 101, status: "suspended" }]) }, "installation_not_active", 1, 0],
    ["installation deleted", { listInstallationStatuses: vi.fn(async () => [{ installationId: 101, status: "deleted" }]) }, "installation_not_active", 1, 0],
    ["grant missing", { authorizeGrant: vi.fn(async () => ({ enabled: true, required: true, reason: "grant-missing" })) }, "repository_grant_missing", 1, 1]
  ])("fails closed for %s before later authorization work", async (_name, override, reason, installationCalls, grantCalls) => {
    const deps = dependencies(override as Partial<ConciergeAccessDependencies>);
    expect(await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, deps)).toEqual({ authorized: false, reason });
    expect(deps.listInstallationStatuses).toHaveBeenCalledTimes(installationCalls as number);
    expect(deps.authorizeGrant).toHaveBeenCalledTimes(grantCalls as number);
  });

  it("keeps activation disabled for memory/env authorization before any provider lookup", async () => {
    const deps = dependencies();
    const memoryEnv = { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false", AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "", AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "", AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY: "1", AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "1", AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY: "1", AGENTPROOF_TENANT_ACCOUNTS: "[]" };
    expect(await authorizeConciergeAccess(input, memoryEnv, deps)).toEqual({ authorized: false, reason: "concierge_disabled" });
    expect(deps.resolveSession).not.toHaveBeenCalled();
  });

  it("keeps activation disabled for a Concierge project mismatch before any session or provider lookup", async () => {
    const deps = dependencies();
    const mismatch = { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false", AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://other-project.supabase.co" };
    expect(await authorizeConciergeAccess(input, mismatch, deps)).toEqual({ authorized: false, reason: "concierge_disabled" });
    expect(deps.resolveSession).not.toHaveBeenCalled();
    expect(deps.listInstallationStatuses).not.toHaveBeenCalled();
    expect(deps.authorizeGrant).not.toHaveBeenCalled();
  });

  it("rejects global kill switch before authorization", async () => {
    const deps = dependencies();
    expect(await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "1" }, deps)).toEqual({ authorized: false, reason: "global_kill_switch" });
    expect(deps.resolveSession).not.toHaveBeenCalled();
  });

  it("rejects a browser repository name outside the single server-resolved grant", async () => {
    const deps = dependencies();
    expect(await authorizeConciergeAccess({ ...input, repositoryFullName: "attacker/other" }, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, deps)).toEqual({ authorized: false, reason: "repository_identity_mismatch" });
  });

  it("does not authorize a matching legacy environment grant when the durable lookup is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("[]", { status: 200 })));
    const seededEnv = {
      ...env,
      AGENTPROOF_TENANT_REPOSITORY_GRANTS: JSON.stringify([{ tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", enabled: true, analysisEnabled: false, commentEnabled: false, saveReportsEnabled: false, slackNotificationsEnabled: false }])
    };
    const decision = await authorizeDurableTenantRepositoryGrantAsync({ installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" }, seededEnv);
    expect(decision).toMatchObject({ required: true, reason: "grant-missing" });
  });

  it.each([
    ["absent", Response.json([{ active: false }]), "analysis-disabled"],
    ["active", Response.json([{ active: true }]), "tenant-deletion-active"]
  ])("uses the durable deletion state when it is %s", async (_label, deletionResponse, expectedReason) => {
    const grant = {
      tenant_id: "tenant_alpha", installation_id: 101, repository_id: 202, repository_full_name: "acme/private",
      enabled: true, analysis_enabled: false, comment_enabled: false, save_reports_enabled: false, slack_notifications_enabled: false
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("agentproof_tenant_deletion_state_active")) {
        expect(init?.method).toBe("POST");
        return deletionResponse;
      }
      if (url.includes("agentproof_tenant_repository_grants")) return Response.json([grant]);
      throw new Error("unexpected durable authorization request");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeDurableTenantRepositoryGrantAsync({ installationId: 101, repositoryId: 202, repositoryFullName: "acme/private" }, env)).resolves.toMatchObject({ reason: expectedReason });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["database error", new Response(null, { status: 404 })],
    ["malformed response", Response.json([{ active: false, extra: true }])]
  ])("maps durable deletion state %s to authorization_unavailable before later work", async (_label, deletionResponse) => {
    const grant = {
      tenant_id: "tenant_alpha", installation_id: 101, repository_id: 202, repository_full_name: "acme/private",
      enabled: true, analysis_enabled: false, comment_enabled: false, save_reports_enabled: false, slack_notifications_enabled: false
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("agentproof_tenant_deletion_state_active")) return deletionResponse;
      if (url.includes("agentproof_tenant_repository_grants")) return Response.json([grant]);
      throw new Error("unexpected durable authorization request");
    });
    vi.stubGlobal("fetch", fetchMock);
    const tokenProvider = vi.fn();
    const result = await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "false" }, dependencies({
      authorizeGrant: async (request, runtimeEnv) => authorizeDurableTenantRepositoryGrantAsync(request, runtimeEnv),
      listInstallationStatuses: tokenProvider.mockResolvedValue([{ installationId: 101, status: "active" }])
    }));

    expect(result).toEqual({ authorized: false, reason: "authorization_unavailable" });
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
