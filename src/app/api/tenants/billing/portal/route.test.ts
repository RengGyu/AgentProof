import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTenantAuthSessionsForTests, createTenantAuthSession } from "@/lib/tenant-auth";
import { POST } from "./route";

describe("POST /api/tenants/billing/portal", () => {
  afterEach(() => {
    clearTenantAuthSessionsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires same-origin mutation proof before tenant authorization", async () => {
    stubSessionEnv();

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Tenant mutations require a same-origin request.",
      code: "tenant_mutation_csrf_required"
    });
  });

  it("requires tenant authorization", async () => {
    stubSessionEnv();

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: { ...sameOriginHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Tenant billing portal requires valid tenant authorization.",
      code: "tenant_billing_portal_unauthorized"
    });
  });

  it("rejects invite fallback because billing portal needs durable owner or admin auth", async () => {
    stubSessionEnv();

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        "x-agentproof-beta-invite-token": "tenant-a-invite-token"
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Tenant billing portal requires durable owner or admin auth.",
      code: "tenant_billing_portal_durable_auth_required"
    });
    expect(serialized).not.toContain("tenant-a-invite-token");
  });

  it("rejects durable member role access", async () => {
    stubDurableAuthEnv("member");
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));

    expect(response.status).toBe(403);
  });

  it("returns a metadata-only ready boundary for durable owner auth", async () => {
    stubDurableAuthEnv("owner");
    stubBillingEnv({ subscriptionStatus: "active", customerPortalEnabled: true });
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      billing: {
        privacy: "billing-portal-session-boundary-only",
        configured: true,
        providerBacked: true,
        subscriptionStatus: "active",
        plan: "team",
        portal: {
          available: true,
          mode: "server_redirect_required"
        },
        status: "ready",
        next: "redirect_via_provider_adapter"
      },
      privacy: "billing-portal-session-boundary-only",
      next: "redirect_via_provider_adapter"
    });
    expect(serialized).not.toContain("member-bootstrap-token");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("price_secret");
    expect(serialized).not.toContain("payment");
    expect(serialized).not.toContain("owner@example.com");
  });

  it("returns bounded non-ready billing states without provider ids", async () => {
    stubDurableAuthEnv("admin");
    stubBillingEnv({ subscriptionStatus: "past_due", customerPortalEnabled: true });
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({ tenantId: "tenant_a" })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: false,
      tenantId: "tenant_a",
      billing: {
        privacy: "billing-portal-session-boundary-only",
        configured: true,
        providerBacked: true,
        subscriptionStatus: "past_due",
        status: "manual_review_required",
        reason: "billing_subscription_inactive",
        next: "resolve_subscription_status"
      },
      privacy: "billing-portal-session-boundary-only",
      next: "resolve_subscription_status"
    });
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("price_secret");
  });

  it("rejects unknown payload fields", async () => {
    stubDurableAuthEnv("owner");
    const session = await createTenantAuthSession({
      tenantId: "tenant_a",
      memberId: "member_owner",
      bootstrapToken: "member-bootstrap-token"
    });

    const response = await POST(new Request("http://localhost/api/tenants/billing/portal", {
      method: "POST",
      headers: {
        ...sameOriginHeaders(),
        "Content-Type": "application/json",
        cookie: session.sessionCookie
      },
      body: JSON.stringify({
        tenantId: "tenant_a",
        providerCustomerId: "cus_secret_should_not_leak"
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: "Tenant billing portal request must be a bounded JSON object.",
      code: "tenant_billing_portal_payload_invalid"
    });
    expect(serialized).not.toContain("cus_secret");
  });
});

function stubSessionEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" }
  ]));
}

function stubDurableAuthEnv(role: "owner" | "admin" | "member") {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      name: "Tenant A",
      status: "active",
      plan: "team",
      members: [
        { memberId: "member_owner", role, status: "active", email: "owner@example.com" }
      ]
    }
  ]));
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_BOOTSTRAPS", JSON.stringify([
    { tenantId: "tenant_a", memberId: "member_owner", token: "member-bootstrap-token" }
  ]));
}

function stubBillingEnv(input: {
  subscriptionStatus: "active" | "past_due";
  customerPortalEnabled: boolean;
}) {
  vi.stubEnv("AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS", JSON.stringify([
    {
      tenantId: "tenant_a",
      provider: "stripe",
      providerCustomerId: "cus_secret_should_not_leak",
      providerSubscriptionId: "sub_secret_should_not_leak",
      providerPriceId: "price_secret_should_not_leak",
      subscriptionStatus: input.subscriptionStatus,
      plan: "team",
      customerPortalEnabled: input.customerPortalEnabled
    }
  ]));
}

function sameOriginHeaders() {
  return { Origin: "http://localhost" };
}
