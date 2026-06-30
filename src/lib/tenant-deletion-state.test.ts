import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertTenantDeletionNotActive,
  clearTenantDeletionStateForTests,
  isTenantDeletionActive,
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

  it("uses Supabase count-only checks and minimal upsert for durable deletion state", async () => {
    const env = {
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_TENANT_DELETION_STATE_TABLE: "tenant_deletion_state_test"
    } as unknown as NodeJS.ProcessEnv;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "0-0/0" }
        });
      }

      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await markTenantDeletionStartedIfConfiguredAsync({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(result);
    const [headUrl, headInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [postUrl, postInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const postBody = JSON.parse(String(postInit.body));

    expect(result).toEqual({
      privacy: "tenant-deletion-state-metadata-only",
      active: true,
      created: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(headInit.method).toBe("HEAD");
    expect(decodeURIComponent(headUrl)).toContain("select=tenant_id");
    expect(decodeURIComponent(headUrl)).not.toContain("repository");
    expect(postInit.method).toBe("POST");
    expect(decodeURIComponent(postUrl)).toContain("on_conflict=tenant_id");
    expect(postBody).toEqual({
      tenant_id: "tenant_a",
      status: "active",
      started_at: expect.any(String),
      updated_at: expect.any(String)
    });
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("tenant_deletion_state_test");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("fails closed for malformed static tombstone configuration", () => {
    expect(() => isTenantDeletionActive({
      tenantId: "tenant_a"
    }, {
      AGENTPROOF_TENANT_DELETION_TOMBSTONES: "{not-json"
    } as unknown as NodeJS.ProcessEnv)).toThrow("Tenant deletion tombstone config is invalid");
  });

  it("rejects invalid tenant ids before marking deletion state", () => {
    expect(() => markTenantDeletionStartedIfConfigured({
      tenantId: "sk-secret-should-not-be-a-tenant-id"
    }, {
      AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv)).toThrow("Tenant id is invalid");
  });
});
