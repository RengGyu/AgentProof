import { afterEach, describe, expect, it, vi } from "vitest";
import { continuePersonalAccountDeletions } from "./personal-deletion-store";
import { handlePersonalAccountDeletion, personalDeletionStore } from "./personal-account-deletion";
const env = { NODE_ENV: "test", AGENTPROOF_SELF_SERVICE_DELETION_ENABLED: "true", AGENTPROOF_USAGE_SUPABASE_URL:"https://store.invalid",AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY:"key",AGENTPROOF_BILLING_SUBSCRIPTIONS_SUPABASE_URL:"https://store.invalid",AGENTPROOF_BILLING_SUBSCRIPTIONS_SUPABASE_SERVICE_ROLE_KEY:"key",AGENTPROOF_BILLING_WEBHOOK_SUPABASE_URL:"https://store.invalid",AGENTPROOF_BILLING_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY:"key",SUPABASE_URL: "https://store.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-key", CRON_SECRET: "test-cron" } as NodeJS.ProcessEnv;
const request = (body: unknown = { confirmation: "DELETE" }, headers: Record<string,string> = {}) => new Request("https://app.invalid/api/account/deletion", { method: "POST", headers: { Origin: "https://app.invalid", Cookie: `agentproof_tenant_auth_session=${"a".repeat(43)}`, ...headers }, body: JSON.stringify(body) });
afterEach(() => vi.unstubAllGlobals());
describe("personal deletion API boundary", () => {
  it("denies cross-account identifiers, missing confirmation, CSRF and anonymous attempts before storage", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await handlePersonalAccountDeletion(request({ confirmation:"DELETE", tenantId:"other" }), "web",env)).status).toBe(400);
    expect((await handlePersonalAccountDeletion(request({}), "web",env)).status).toBe(400);
    expect((await handlePersonalAccountDeletion(request(undefined,{ Origin:"https://evil.invalid" }), "web",env)).status).toBe(403);
    expect((await handlePersonalAccountDeletion(request(undefined,{ Cookie:"" }), "web",env)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("passes only a hash of the current session to the RPC and clears the web cookie only on completion", async () => {
    const fetchMock=vi.fn(async()=>Response.json({status:"completed"})); vi.stubGlobal("fetch",fetchMock);
    const response=await handlePersonalAccountDeletion(request(),"web",env);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("deleted");
    const data=JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string,RequestInit])[1].body));
    expect(data).toEqual({p_token_hash:expect.stringMatching(/^[a-f0-9]{64}$/),p_source:"github",p_action:"delete",p_required_tables:expect.arrayContaining(["agentproof_saved_reports","agentproof_billing_subscriptions"])});
    expect(JSON.stringify(data)).not.toContain("a".repeat(43));
  });
  it("preserves retry credentials and never claims completion on a pending or failed store", async () => {
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({status:"pending",reason:"retry_required"})));
    const pending=await handlePersonalAccountDeletion(request(),"web",env);
    expect(pending.status).toBe(202); expect(pending.headers.has("set-cookie")).toBe(false);
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(null,{status:503})));
    const failed=await handlePersonalAccountDeletion(request(),"web",env);
    expect(failed.status).toBe(503); expect(await failed.json()).toMatchObject({status:"unavailable"});
  });
  it("accepts only origin-free mobile credentials and uses the mobile session source", async () => {
    const fetchMock=vi.fn(async()=>Response.json({status:"shared_workspace"})); vi.stubGlobal("fetch",fetchMock);
    const r=new Request("https://app.invalid/api/mobile/account/deletion", {method:"POST",headers:{Authorization:`Bearer apm_${"b".repeat(43)}`},body:'{"confirmation":"DELETE"}'});
    expect((await handlePersonalAccountDeletion(r,"mobile",env)).status).toBe(409);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string,RequestInit])[1].body)).p_source).toBe("mobile");
  });
  it("fails closed for a split/custom store or static grants instead of silently skipping it", () => {
    expect(personalDeletionStore(env)).not.toBeNull();
    expect(personalDeletionStore({...env,CRON_SECRET:"   "})).toBeNull();
    expect(personalDeletionStore({...env,AGENTPROOF_USAGE_SUPABASE_URL:"",AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED:"true"})).toBeNull();
    expect(personalDeletionStore({...env,AGENTPROOF_USAGE_SUPABASE_URL:"",AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY:"",AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED:"on"})).toBeNull();
    expect(personalDeletionStore({...env,AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY:"on"})).toBeNull();
    expect(personalDeletionStore({...env,AGENTPROOF_REPORTS_SUPABASE_URL:"https://other.invalid"})).toBeNull();
    expect(personalDeletionStore({...env,AGENTPROOF_USAGE_RECORDS_TABLE:"custom_usage"})).toBeNull();
    expect(personalDeletionStore({...env,AGENTPROOF_TENANT_REPOSITORY_GRANTS:"[{\"tenantId\":\"gh_123\"}]"})).toBeNull();
  });
  it("uses the durable shared control-plane store when optional usage quota is disabled", () => {
    const productionLike = { ...env,
      SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://store.invalid",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "test-key",
      AGENTPROOF_USAGE_SUPABASE_URL: "",
      AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY: "",
      AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED: ""
    };
    expect(personalDeletionStore(productionLike)).toMatchObject({url:"https://store.invalid",key:"test-key"});
  });
  it("identifies only the blocking setting name without exposing its value", () => {
    const issue = vi.fn();
    expect(personalDeletionStore({...env, AGENTPROOF_REPORTS_SUPABASE_URL:"https://other.invalid"}, issue)).toBeNull();
    expect(issue).toHaveBeenCalledWith("AGENTPROOF_REPORTS_SUPABASE_URL:different_url");
    expect(JSON.stringify(issue.mock.calls)).not.toContain("other.invalid");
    issue.mockClear();
    expect(personalDeletionStore({...env, AGENTPROOF_REPORTS_SUPABASE_URL:" https://store.invalid "}, issue)).toBeNull();
    expect(issue).toHaveBeenCalledWith("AGENTPROOF_REPORTS_SUPABASE_URL:whitespace");
  });
});

describe("accepted deletion continuation", () => {
  it.each(["false", ""])("continues accepted requests with intake flag %s while blocking new requests", async flag => {
    const disabled = { ...env, AGENTPROOF_SELF_SERVICE_DELETION_ENABLED: flag };
    const fetchMock = vi.fn(async () => Response.json({completed: 1, pending: 2}));
    vi.stubGlobal("fetch", fetchMock);
    expect(personalDeletionStore(disabled)).toBeNull();
    expect((await handlePersonalAccountDeletion(request(), "web", disabled)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(continuePersonalAccountDeletions(disabled)).resolves.toEqual({completed: 1, pending: 2});
    expect(fetchMock).toHaveBeenCalledWith("https://store.invalid/rest/v1/rpc/agentproof_continue_personal_deletions", expect.objectContaining({method:"POST",body:"{}",cache:"no-store"}));
  });
  it.each([
    { AGENTPROOF_USAGE_SUPABASE_URL: "", AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED: "true" },
    { AGENTPROOF_REPORTS_SUPABASE_URL: "https://other.invalid" },
    { AGENTPROOF_USAGE_RECORDS_TABLE: "custom_usage" },
    { AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true" },
    { AGENTPROOF_TENANT_REPOSITORY_GRANTS: '[{"tenantId":"gh_123"}]' }
  ])("rejects invalid continuation storage before RPC with intake disabled: %j", async overrides => {
    const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
    await expect(continuePersonalAccountDeletions({...env,AGENTPROOF_SELF_SERVICE_DELETION_ENABLED:"false",...overrides})).rejects.toThrow("storage is unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not suppress an unavailable RPC or invalid aggregate result when intake is off", async () => {
    const disabled={...env,AGENTPROOF_SELF_SERVICE_DELETION_ENABLED:"false"};
    const fetchMock=vi.fn().mockResolvedValueOnce(new Response(null,{status:404})).mockResolvedValueOnce(Response.json({completed:-1,pending:0}));
    vi.stubGlobal("fetch",fetchMock);
    await expect(continuePersonalAccountDeletions(disabled)).rejects.toThrow("storage is unavailable");
    await expect(continuePersonalAccountDeletions(disabled)).rejects.toThrow("Invalid deletion continuation result");
  });
});
