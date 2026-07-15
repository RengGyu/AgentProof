import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeConciergeAccess, conciergeRuntimeDefaults, type ConciergeAccessDependencies } from "./concierge-private-beta";
import { authorizeDurableTenantRepositoryGrantAsync } from "./tenant-control-plane";

const env: NodeJS.ProcessEnv = {
  ...process.env,
  AGENTPROOF_CONCIERGE_PRIVATE_BETA_ENABLED: "1",
  AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "1",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "test-placeholder",
  AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY: "test-placeholder"
};
const input = { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "acme/private", cookieHeader: "session=x" };

function dependencies(overrides: Partial<ConciergeAccessDependencies> = {}): ConciergeAccessDependencies {
  return {
    verifySession: vi.fn(async () => ({ authorized: true, tenantId: "tenant_alpha", memberId: "member_x", role: "member", method: "durable-session", sessionState: "active" })),
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

  it("authorizes durable manual grant while automated analysis remains off", async () => {
    expect(await authorizeConciergeAccess(input, env, dependencies())).toMatchObject({ authorized: true, repositoryId: 202 });
  });

  it.each([
    ["session", { verifySession: vi.fn(async () => ({ authorized: false })) }, "session_invalid", 0, 0],
    ["installation missing", { listInstallationStatuses: vi.fn(async () => []) }, "installation_not_active", 1, 0],
    ["installation suspended", { listInstallationStatuses: vi.fn(async () => [{ installationId: 101, status: "suspended" }]) }, "installation_not_active", 1, 0],
    ["installation deleted", { listInstallationStatuses: vi.fn(async () => [{ installationId: 101, status: "deleted" }]) }, "installation_not_active", 1, 0],
    ["grant missing", { authorizeGrant: vi.fn(async () => ({ enabled: true, required: true, reason: "grant-missing" })) }, "repository_grant_missing", 1, 1]
  ])("fails closed for %s before later authorization work", async (_name, override, reason, installationCalls, grantCalls) => {
    const deps = dependencies(override as Partial<ConciergeAccessDependencies>);
    expect(await authorizeConciergeAccess(input, env, deps)).toEqual({ authorized: false, reason });
    expect(deps.listInstallationStatuses).toHaveBeenCalledTimes(installationCalls as number);
    expect(deps.authorizeGrant).toHaveBeenCalledTimes(grantCalls as number);
  });

  it("rejects memory/env authorization before any provider lookup", async () => {
    const deps = dependencies();
    const memoryEnv = { ...env, AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "", AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "", AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY: "1", AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "1", AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY: "1", AGENTPROOF_TENANT_ACCOUNTS: "[]" };
    expect(await authorizeConciergeAccess(input, memoryEnv, deps)).toEqual({ authorized: false, reason: "durable_store_required" });
    expect(deps.verifySession).not.toHaveBeenCalled();
  });

  it("rejects a Concierge project mismatch before any session or provider lookup", async () => {
    const deps = dependencies();
    const mismatch = { ...env, AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://other-project.supabase.co" };
    expect(await authorizeConciergeAccess(input, mismatch, deps)).toEqual({ authorized: false, reason: "durable_store_mismatch" });
    expect(deps.verifySession).not.toHaveBeenCalled();
    expect(deps.listInstallationStatuses).not.toHaveBeenCalled();
    expect(deps.authorizeGrant).not.toHaveBeenCalled();
  });

  it("rejects global kill switch before authorization", async () => {
    const deps = dependencies();
    expect(await authorizeConciergeAccess(input, { ...env, AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH: "1" }, deps)).toEqual({ authorized: false, reason: "global_kill_switch" });
    expect(deps.verifySession).not.toHaveBeenCalled();
  });

  it("rejects a granted repository ID paired with a different repository name", async () => {
    const deps = dependencies();
    expect(await authorizeConciergeAccess({ ...input, repositoryFullName: "attacker/other" }, env, deps)).toEqual({ authorized: false, reason: "repository_identity_mismatch" });
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
});
