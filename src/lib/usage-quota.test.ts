import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUsageQuotaForTests,
  readUsageQuotaLimits,
  readUsageQuotaStatus,
  reserveUsageQuota,
  usageQuotaPublicReason,
  UsageQuotaStoreError
} from "./usage-quota";

describe("usage quota", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    clearUsageQuotaForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("allows requests without consuming quota when enforcement is disabled", async () => {
    await expect(reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "delivery:repo:sha"
    }, {} as NodeJS.ProcessEnv)).resolves.toEqual(expect.objectContaining({
      allowed: true,
      enforced: false,
      store: "none",
      reason: "quota-disabled"
    }));
  });

  it("fails closed for invalid quota limits without leaking raw config", async () => {
    const env = {
      AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED: "true",
      AGENTPROOF_USAGE_QUOTA_LIMITS: "{not-json"
    } as unknown as NodeJS.ProcessEnv;

    expect(readUsageQuotaLimits(env)).toBeNull();
    await expect(reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "delivery:repo:sha"
    }, env)).resolves.toEqual(expect.objectContaining({
      allowed: false,
      reason: "quota-limits-invalid"
    }));
    expect(usageQuotaPublicReason("quota-limits-invalid")).not.toContain("{not-json");
  });

  it("requires configured tenant quota when enforcement is enabled", async () => {
    const env = quotaEnv({ monthlyAnalysisLimit: 1 });

    await expect(reserveUsageQuota({
      tenantId: "tenant_b",
      feature: "github_app_analysis",
      idempotencyKey: "tenant-b-key"
    }, env)).resolves.toEqual(expect.objectContaining({
      allowed: false,
      reason: "quota-limit-missing"
    }));
  });

  it("fails closed without durable storage unless memory mode is explicitly allowed", async () => {
    const env = {
      AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED: "true",
      AGENTPROOF_USAGE_QUOTA_LIMITS: JSON.stringify([
        {
          tenantId: "tenant_a",
          monthlyAnalysisLimit: 1,
          enabled: true
        }
      ])
    } as unknown as NodeJS.ProcessEnv;

    await expect(reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "first"
    }, env)).rejects.toThrow(UsageQuotaStoreError);
  });

  it("reserves in-memory quota once per idempotency key and blocks overage", async () => {
    const env = quotaEnv({
      monthlyAnalysisLimit: 1,
      AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY: "true"
    });
    const first = await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "first"
    }, env);
    const duplicate = await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "first"
    }, env);
    const second = await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "second"
    }, env);

    expect(first).toEqual(expect.objectContaining({
      allowed: true,
      store: "memory",
      used: 1,
      remaining: 0
    }));
    expect(duplicate).toEqual(expect.objectContaining({
      allowed: true,
      duplicate: true,
      used: 1,
      remaining: 0
    }));
    expect(second).toEqual(expect.objectContaining({
      allowed: false,
      reason: "quota-exceeded",
      used: 1,
      remaining: 0
    }));
  });

  it("reads in-memory quota status without consuming quota", async () => {
    const env = quotaEnv({
      monthlyAnalysisLimit: 2,
      AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY: "true"
    });
    await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "first",
      now: new Date("2026-06-30T00:00:00Z")
    }, env);

    const firstStatus = await readUsageQuotaStatus({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      now: new Date("2026-06-30T12:00:00Z")
    }, env);
    const secondStatus = await readUsageQuotaStatus({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      now: new Date("2026-06-30T12:00:00Z")
    }, env);

    expect(firstStatus).toEqual({
      enforced: true,
      configured: true,
      store: "memory",
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      period: "2026-06",
      plan: "team",
      limit: 2,
      used: 1,
      remaining: 1
    });
    expect(secondStatus).toEqual(firstStatus);
  });

  it("returns bounded quota status when enforcement is disabled or tenant quota is missing", async () => {
    const disabled = await readUsageQuotaStatus({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      now: new Date("2026-06-30T00:00:00Z")
    }, {} as NodeJS.ProcessEnv);
    const missing = await readUsageQuotaStatus({
      tenantId: "tenant_b",
      feature: "github_app_analysis",
      now: new Date("2026-06-30T00:00:00Z")
    }, quotaEnv({
      monthlyAnalysisLimit: 1,
      AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY: "true"
    }));

    expect(disabled).toEqual(expect.objectContaining({
      enforced: false,
      configured: false,
      store: "none",
      tenantId: "tenant_a",
      period: "2026-06",
      reason: "quota-disabled"
    }));
    expect(missing).toEqual(expect.objectContaining({
      enforced: true,
      configured: false,
      store: "none",
      tenantId: "tenant_b",
      reason: "quota-limit-missing"
    }));
  });

  it("reserves Supabase quota through an atomic RPC without storing raw idempotency keys", async () => {
    const env = quotaEnv({
      monthlyAnalysisLimit: 2,
      AGENTPROOF_USAGE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_USAGE_RECORDS_TABLE: "usage_records_test",
      AGENTPROOF_USAGE_RESERVATION_RPC: "reserve_usage_quota_test"
    });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.endsWith("/rest/v1/rpc/reserve_usage_quota_test")) {
        return Response.json({ allowed: true, duplicate: false, used: 1 });
      }

      return new Response(null, { status: 500 });
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "raw-idempotency-key-should-not-store",
      now: new Date("2026-06-30T00:00:00Z")
    }, env);
    const postBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const serialized = JSON.stringify(postBody);

    expect(result).toEqual(expect.objectContaining({
      allowed: true,
      store: "supabase",
      period: "2026-06",
      used: 1,
      remaining: 1
    }));
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://agentproof-test.supabase.co/rest/v1/rpc/reserve_usage_quota_test"
    );
    expect(postBody).toEqual(expect.objectContaining({
      p_tenant_id: "tenant_a",
      p_period: "2026-06",
      p_feature: "github_app_analysis",
      p_idempotency_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_records_table: "usage_records_test"
    }));
    expect(serialized).not.toContain("raw-idempotency-key");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("reads Supabase usage status from count headers without fetching raw records", async () => {
    const env = quotaEnv({
      monthlyAnalysisLimit: 10,
      AGENTPROOF_USAGE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_USAGE_RECORDS_TABLE: "usage_records_test"
    });
    const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(null, {
      status: 200,
      headers: { "content-range": "0-0/3" }
    }));
    global.fetch = fetchMock as typeof fetch;

    const result = await readUsageQuotaStatus({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      now: new Date("2026-06-30T00:00:00Z")
    }, env);
    const [url, init] = fetchMock.mock.calls[0];

    expect(result).toEqual({
      enforced: true,
      configured: true,
      store: "supabase",
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      period: "2026-06",
      plan: "team",
      limit: 10,
      used: 3,
      remaining: 7
    });
    expect(String(url)).toContain("https://agentproof-test.supabase.co/rest/v1/usage_records_test?");
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).not.toContain("service-role-secret");
    expect(init?.method).toBe("HEAD");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual(expect.objectContaining({
      Prefer: "count=exact",
      Range: "0-0"
    }));
  });

  it("throws a bounded store error when Supabase usage status count is unavailable", async () => {
    const env = quotaEnv({
      monthlyAnalysisLimit: 10,
      AGENTPROOF_USAGE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    });
    global.fetch = vi.fn(async () => new Response(null, { status: 500 })) as typeof fetch;

    await expect(readUsageQuotaStatus({
      tenantId: "tenant_a",
      feature: "github_app_analysis"
    }, env)).rejects.toThrow(UsageQuotaStoreError);
  });

  it("throws a bounded store error when Supabase quota reservation fails", async () => {
    const env = quotaEnv({
      monthlyAnalysisLimit: 1,
      AGENTPROOF_USAGE_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    });
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    await expect(reserveUsageQuota({
      tenantId: "tenant_a",
      feature: "github_app_analysis",
      idempotencyKey: "first"
    }, env)).rejects.toThrow(UsageQuotaStoreError);
  });
});

function quotaEnv(values: Record<string, unknown>): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED: "true",
    AGENTPROOF_USAGE_QUOTA_LIMITS: JSON.stringify([
      {
        tenantId: "tenant_a",
        monthlyAnalysisLimit: values.monthlyAnalysisLimit ?? 1,
        enabled: values.enabled ?? true,
        plan: "team"
      }
    ]),
    ...Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith("AGENTPROOF_")))
  } as unknown as NodeJS.ProcessEnv;
}
