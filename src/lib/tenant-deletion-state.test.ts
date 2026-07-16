import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTenantDeletionNotActive,
  clearTenantDeletionStateForTests,
  isTenantDeletionActive,
  isTenantDeletionActiveAsync,
  markTenantDeletionStartedIfConfigured,
  markTenantDeletionStartedIfConfiguredAsync
} from "./tenant-deletion-state";

describe("tenant deletion state", () => {
  afterEach(() => {
    clearTenantDeletionStateForTests();
  });

  it("reads static deletion tombstones without exposing the configured tenant ids", () => {
    const env = {
      AGENTPROOF_TENANT_DELETION_TOMBSTONES: JSON.stringify(["tenant_a", "tenant_b"])
    } as unknown as NodeJS.ProcessEnv;

    expect(isTenantDeletionActive({ tenantId: "tenant_a" }, env)).toBe(true);
    expect(isTenantDeletionActive({ tenantId: "tenant_other" }, env)).toBe(false);
    expect(() => assertTenantDeletionNotActive({ tenantId: "tenant_b" }, env)).toThrow("Tenant deletion is in progress");
  });

  it("starts memory deletion state only when explicitly configured", () => {
    const disabledEnv = {} as NodeJS.ProcessEnv;
    const enabledEnv = {
      AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;

    expect(markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" }, disabledEnv)).toEqual({
      privacy: "tenant-deletion-state-metadata-only",
      active: false,
      created: false
    });
    expect(isTenantDeletionActive({ tenantId: "tenant_a" }, disabledEnv)).toBe(false);

    const result = markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" }, enabledEnv);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "tenant-deletion-state-metadata-only",
      active: true,
      created: true
    });
    expect(isTenantDeletionActive({ tenantId: "tenant_a" }, enabledEnv)).toBe(true);
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("store");
    expect(serialized).not.toContain("memory");
    expect(serialized).not.toContain("configured");
  });

  it("uses exact bounded RPC contracts for durable deletion state", async () => {
    const env = {
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    } as unknown as NodeJS.ProcessEnv;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(_input);
      if (url.endsWith("/agentproof_mark_tenant_deletion_active")) return Response.json([{ outcome: "created" }]);
      throw new Error("unexpected durable deletion RPC");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await markTenantDeletionStartedIfConfiguredAsync({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(result);
    const [postUrl, postInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const postBody = JSON.parse(String(postInit.body));

    expect(result).toEqual({
      privacy: "tenant-deletion-state-metadata-only",
      active: true,
      created: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postInit.method).toBe("POST");
    expect(postUrl).toBe("https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_mark_tenant_deletion_active");
    expect(postBody).toEqual({ p_tenant_id: "tenant_a" });
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("tenant_deletion_state_test");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("service-role-secret");
  });

  it.each([
    ["active", Response.json([{ active: true }]), true],
    ["absent", Response.json([{ active: false }]), false]
  ])("reads an exact durable %s state", async (_label, response, expected) => {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(isTenantDeletionActiveAsync({ tenantId: "tenant_a" }, {
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    } as unknown as NodeJS.ProcessEnv)).resolves.toBe(expected);
  });

  it.each([
    ["database error", new Response(null, { status: 404 })],
    ["malformed response", Response.json([{ active: false, extra: true }])],
    ["missing response", Response.json([])]
  ])("fails closed for durable deletion state %s", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(isTenantDeletionActiveAsync({ tenantId: "tenant_a" }, {
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    } as unknown as NodeJS.ProcessEnv)).rejects.toThrow("Tenant deletion state");
  });

  it("fails closed for malformed static tombstone configuration", () => {
    expect(() => isTenantDeletionActive({
      tenantId: "tenant_a"
    }, {
      AGENTPROOF_TENANT_DELETION_TOMBSTONES: "{not-json"
    } as unknown as NodeJS.ProcessEnv)).toThrow("Tenant deletion tombstone config is invalid");
  });

  it("fails closed instead of silently accepting a legacy custom table override", async () => {
    await expect(isTenantDeletionActiveAsync({ tenantId: "tenant_a" }, {
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_DELETION_STATE_TABLE: "legacy_custom_table"
    } as unknown as NodeJS.ProcessEnv)).rejects.toThrow("table override is unsupported");
  });

  it("rejects invalid tenant ids before marking deletion state", () => {
    expect(() => markTenantDeletionStartedIfConfigured({
      tenantId: "sk-secret-should-not-be-a-tenant-id"
    }, {
      AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv)).toThrow("Tenant id is invalid");
  });
});
