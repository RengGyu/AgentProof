import { afterEach, describe, expect, it, vi } from "vitest";
import { registerConciergeManualRepositoryGrant } from "./tenant-control-plane";

const input = { tenantId: "tenant_alpha", installationId: 101, repositoryId: 202, repositoryFullName: "opaque/repository" };
const env = {
  ...process.env,
  AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "placeholder",
  AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE: "agentproof_tenant_repository_grants"
};

function row(outcome: "created" | "existing", settings = { enabled: true, analysis_enabled: false, save_reports_enabled: false, comment_enabled: false, slack_notifications_enabled: false }) {
  return { outcome, tenant_id: input.tenantId, installation_id: input.installationId, repository_id: input.repositoryId, repository_full_name: input.repositoryFullName, ...settings };
}

function deletionStateResponse(active = false) {
  return Response.json([{ active }]);
}

const existingFlagCombinations = Array.from({ length: 32 }, (_, bits) => ({
  enabled: Boolean(bits & 1),
  analysis_enabled: Boolean(bits & 2),
  save_reports_enabled: Boolean(bits & 4),
  comment_enabled: Boolean(bits & 8),
  slack_notifications_enabled: Boolean(bits & 16)
}));

describe("Concierge manual repository grant", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a new durable grant with manual-only defaults through the atomic RPC", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("agentproof_tenant_deletion_state_active")) {
        expect(init?.method).toBe("POST");
        return deletionStateResponse();
      }
      return Response.json([row("created")]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const registration = await registerConciergeManualRepositoryGrant(input, env);
    expect(registration).toMatchObject({ outcome: "created", grant: { ...input, enabled: true, analysisEnabled: false, saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: false } });
    const [url, init] = fetchMock.mock.calls.find(([value]) => String(value).includes("agentproof_register_concierge_repository_grant")) as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/rpc/agentproof_register_concierge_repository_grant");
    expect(JSON.parse(String(init.body))).toEqual({ p_tenant_id: input.tenantId, p_installation_id: input.installationId, p_repository_id: input.repositoryId, p_repository_full_name: input.repositoryFullName });
  });

  it.each(existingFlagCombinations)("preserves every existing automation flag combination without merge or patch", async (settings) => {
    const fetchMock = vi.fn(async (url: string) => url.includes("agentproof_tenant_deletion_state_active")
      ? deletionStateResponse()
      : Response.json([row("existing", settings)]));
    vi.stubGlobal("fetch", fetchMock);
    const registration = await registerConciergeManualRepositoryGrant(input, env);
    expect(registration.outcome).toBe("existing");
    expect(registration.grant).toMatchObject({ enabled: settings.enabled, analysisEnabled: settings.analysis_enabled, saveReportsEnabled: settings.save_reports_enabled, commentEnabled: settings.comment_enabled, slackNotificationsEnabled: settings.slack_notifications_enabled });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("agentproof_tenant_repository_grants?") || (String(url).includes("agentproof_tenant_repository_grants") && !String(url).includes("rpc")))).toHaveLength(0);
  });

  it("is stable under concurrent registration: exactly one creation and no flag rewrite", async () => {
    let first = true;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("agentproof_tenant_deletion_state_active")) return deletionStateResponse();
      const outcome = first ? "created" : "existing"; first = false;
      return Response.json([row(outcome)]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const registrations = await Promise.all(Array.from({ length: 20 }, () => registerConciergeManualRepositoryGrant(input, env)));
    expect(registrations.filter((registration) => registration.outcome === "created")).toHaveLength(1);
    expect(registrations.filter((registration) => registration.outcome === "existing")).toHaveLength(19);
    expect(registrations.every((registration) => registration.grant.analysisEnabled === false && registration.grant.saveReportsEnabled === false && registration.grant.commentEnabled === false && registration.grant.slackNotificationsEnabled === false)).toBe(true);
  });

  it("fails closed instead of using a memory/env fallback or accepting malformed RPC rows", async () => {
    await expect(registerConciergeManualRepositoryGrant(input, { ...process.env, AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "1" })).rejects.toThrow("durable");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("agentproof_tenant_deletion_state_active")
      ? deletionStateResponse()
      : Response.json([{ ...row("created"), raw_diff: "diff --git a/a b/a" }])));
    await expect(registerConciergeManualRepositoryGrant(input, env)).rejects.toThrow("response is invalid");
  });

  it.each([
    ["active deletion", deletionStateResponse(true)],
    ["missing deletion RPC", new Response(null, { status: 404 })],
    ["malformed deletion RPC", Response.json([{ active: false, extra: true }])]
  ])("does not register a grant when the durable deletion state is %s", async (_label, deletionResponse) => {
    const grantRpc = vi.fn(async () => Response.json([row("created")]));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("agentproof_tenant_deletion_state_active")) return deletionResponse;
      return grantRpc();
    }));

    await expect(registerConciergeManualRepositoryGrant(input, env)).rejects.toThrow();
    expect(grantRpc).not.toHaveBeenCalled();
  });
});
