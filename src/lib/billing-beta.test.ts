import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BillingBetaStoreError,
  billingSubscriptionAllowsAccess,
  clearBillingWebhookEventsForTests,
  evaluateBillingBetaGate,
  readBillingBetaSummary,
  reserveBillingWebhookEvent
} from "./billing-beta";

describe("billing beta metadata boundary", () => {
  afterEach(() => {
    clearBillingWebhookEventsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns provider-backed subscription status without exposing provider ids or payment data", () => {
    const summary = readBillingBetaSummary({ tenantId: "tenant_a" }, billingEnv({
      subscriptionStatus: "active",
      customerPortalEnabled: true
    }));
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      privacy: "billing-beta-summary-only",
      configured: true,
      providerBacked: true,
      subscriptionStatus: "active",
      plan: "team",
      portal: {
        available: true,
        mode: "server_redirect_required"
      },
      webhooks: {
        idempotency: "configured"
      }
    });
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("price_secret");
    expect(serialized).not.toContain("invoice");
    expect(serialized).not.toContain("payment");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("service-role");
  });

  it("distinguishes manual records from provider-backed subscriptions", () => {
    const summary = readBillingBetaSummary({ tenantId: "tenant_a" }, testEnv({
      AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS: JSON.stringify([
        {
          tenantId: "tenant_a",
          provider: "manual",
          subscriptionStatus: "trialing",
          plan: "team"
        }
      ])
    }));

    expect(summary).toMatchObject({
      configured: true,
      providerBacked: false,
      subscriptionStatus: "trialing",
      plan: "team",
      portal: {
        available: false,
        mode: "not_configured"
      }
    });
  });

  it.each([
    ["active", true],
    ["trialing", true],
    ["past_due", false],
    ["canceled", false],
    ["incomplete", false],
    ["paused", false],
    ["unknown", false]
  ] as const)("maps %s subscription access deterministically", (subscriptionStatus, allowed) => {
    const summary = readBillingBetaSummary({ tenantId: "tenant_a" }, billingEnv({ subscriptionStatus }));

    expect(billingSubscriptionAllowsAccess(summary)).toBe(allowed);
  });

  it("fails closed under billing beta enforcement for missing, inactive, or mismatched records", () => {
    const missing = evaluateBillingBetaGate({ tenantId: "tenant_missing", quotaPlan: "team" }, {
      ...billingEnv({ subscriptionStatus: "active" }),
      AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED: "true"
    });
    const inactive = evaluateBillingBetaGate({ tenantId: "tenant_a", quotaPlan: "team" }, {
      ...billingEnv({ subscriptionStatus: "past_due" }),
      AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED: "true"
    });
    const mismatch = evaluateBillingBetaGate({ tenantId: "tenant_a", quotaPlan: "pro" }, {
      ...billingEnv({ subscriptionStatus: "active" }),
      AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED: "true"
    });
    const disabled = evaluateBillingBetaGate({ tenantId: "tenant_missing", quotaPlan: "team" }, billingEnv({
      subscriptionStatus: "active"
    }));

    expect(missing).toMatchObject({
      allowed: false,
      enforced: true,
      reason: "billing-record-missing",
      privacy: "billing-beta-gate-metadata-only"
    });
    expect(inactive).toMatchObject({
      allowed: false,
      reason: "billing-subscription-inactive",
      subscriptionStatus: "past_due"
    });
    expect(mismatch).toMatchObject({
      allowed: false,
      reason: "billing-plan-mismatch",
      plan: "team"
    });
    expect(disabled).toMatchObject({
      allowed: true,
      enforced: false,
      reason: "billing-beta-enforcement-disabled"
    });
  });

  it("rejects malformed provider-backed records without echoing provider ids", () => {
    const env = testEnv({
      AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS: JSON.stringify([
        {
          tenantId: "tenant_a",
          provider: "stripe",
          providerCustomerId: "cus_secret?token=leak",
          providerSubscriptionId: "sub_secret_should_not_leak",
          subscriptionStatus: "active"
        }
      ])
    });

    expect(() => readBillingBetaSummary({ tenantId: "tenant_a" }, env)).toThrow(BillingBetaStoreError);
  });

  it("uses hashed billing webhook event ids for memory idempotency", async () => {
    const env = testEnv({
      AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY: "true"
    });

    const first = await reserveBillingWebhookEvent({
      provider: "stripe",
      providerEventId: "evt_secret_should_not_leak_123",
      tenantId: "tenant_a",
      eventType: "customer.subscription.updated",
      receivedAt: new Date("2026-07-01T00:00:00Z")
    }, env);
    const duplicate = await reserveBillingWebhookEvent({
      provider: "stripe",
      providerEventId: "evt_secret_should_not_leak_123",
      tenantId: "tenant_a",
      eventType: "customer.subscription.updated",
      receivedAt: new Date("2026-07-01T00:01:00Z")
    }, env);
    const serialized = JSON.stringify({ first, duplicate });

    expect(first).toMatchObject({
      accepted: true,
      duplicate: false,
      store: "memory",
      privacy: "billing-webhook-idempotency-metadata-only"
    });
    expect(duplicate).toMatchObject({
      accepted: true,
      duplicate: true,
      store: "memory"
    });
    expect(serialized).not.toContain("evt_secret");
  });

  it("refuses billing webhook reservations when idempotency is not configured", async () => {
    const result = await reserveBillingWebhookEvent({
      provider: "stripe",
      providerEventId: "evt_secret_should_not_leak_123",
      tenantId: "tenant_a",
      eventType: "invoice.payment_succeeded"
    }, testEnv({}));

    expect(result).toEqual({
      accepted: false,
      duplicate: false,
      store: "none",
      provider: "stripe",
      tenantId: "tenant_a",
      eventType: "invoice.payment_succeeded",
      reason: "billing-webhook-idempotency-not-configured",
      privacy: "billing-webhook-idempotency-metadata-only"
    });
    expect(JSON.stringify(result)).not.toContain("evt_secret");
  });

  it("stores only hashed provider event ids in Supabase webhook idempotency rows", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 201 });
    }));

    const result = await reserveBillingWebhookEvent({
      provider: "stripe",
      providerEventId: "evt_secret_should_not_leak_456",
      tenantId: "tenant_a",
      eventType: "customer.subscription.updated",
      receivedAt: new Date("2026-07-01T00:00:00Z")
    }, testEnv({
      AGENTPROOF_BILLING_WEBHOOK_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_BILLING_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      AGENTPROOF_BILLING_WEBHOOK_EVENTS_TABLE: "billing_webhook_events_test"
    }));
    const serialized = JSON.stringify({ result, bodies });

    expect(result).toMatchObject({
      accepted: true,
      duplicate: false,
      store: "supabase",
      privacy: "billing-webhook-idempotency-metadata-only"
    });
    expect(bodies[0]).toMatchObject({
      id: expect.stringMatching(/^stripe:[a-f0-9]{64}$/),
      provider: "stripe",
      provider_event_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      tenant_id: "tenant_a",
      event_type: "customer.subscription.updated",
      received_at: "2026-07-01T00:00:00.000Z"
    });
    expect(bodies[0]).not.toHaveProperty("provider_event_id");
    expect(bodies[0]).not.toHaveProperty("payload");
    expect(serialized).not.toContain("evt_secret");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("treats Supabase idempotency conflicts as duplicate billing webhook events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 409 })));

    const result = await reserveBillingWebhookEvent({
      provider: "stripe",
      providerEventId: "evt_secret_should_not_leak_789",
      tenantId: "tenant_a",
      eventType: "invoice.payment_succeeded"
    }, testEnv({
      AGENTPROOF_BILLING_WEBHOOK_SUPABASE_URL: "https://agentproof-test.supabase.co",
      AGENTPROOF_BILLING_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY: "service-role-secret"
    }));

    expect(result).toMatchObject({
      accepted: true,
      duplicate: true,
      store: "supabase",
      privacy: "billing-webhook-idempotency-metadata-only"
    });
    expect(JSON.stringify(result)).not.toContain("evt_secret");
  });
});

function billingEnv(input: {
  subscriptionStatus: string;
  customerPortalEnabled?: boolean;
}): NodeJS.ProcessEnv {
  return testEnv({
    AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY: "true",
    AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS: JSON.stringify([
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
    ])
  });
}

function testEnv(input: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...input
  } as NodeJS.ProcessEnv;
}
