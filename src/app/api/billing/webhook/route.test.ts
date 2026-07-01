import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearBillingWebhookEventsForTests } from "@/lib/billing-beta";
import { POST } from "./route";

describe("POST /api/billing/webhook", () => {
  afterEach(() => {
    clearBillingWebhookEventsForTests();
    vi.unstubAllEnvs();
  });

  it("rejects missing signatures without echoing provider payload data", async () => {
    stubWebhookEnv();
    const body = billingWebhookBody({
      id: "evt_route_missing_123",
      customer: "cus_secret_should_not_leak"
    });

    const response = await POST(new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      body
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(json).toMatchObject({
      ok: false,
      privacy: "billing-webhook-intake-metadata-only",
      next: "retry_with_signed_provider_payload",
      webhook: {
        privacy: "billing-webhook-intake-metadata-only",
        provider: "stripe",
        verified: false,
        accepted: false,
        duplicate: false,
        status: "signature_missing"
      }
    });
    expect(serialized).not.toContain("evt_route_missing_123");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("raw");
  });

  it("accepts valid signed Stripe webhook metadata and ignores duplicates", async () => {
    stubWebhookEnv();
    const body = billingWebhookBody({
      id: "evt_route_123",
      status: "trialing",
      metadata: {
        tenantId: "tenant_a",
        plan: "team",
        paymentMethod: "pm_secret_should_not_leak"
      }
    });
    const headers = {
      "stripe-signature": stripeSignature(body, webhookSecret(), Math.floor(Date.now() / 1000))
    };

    const first = await POST(new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers,
      body
    }));
    const firstJson = await first.json();
    const duplicate = await POST(new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers,
      body
    }));
    const duplicateJson = await duplicate.json();
    const serialized = JSON.stringify({ firstJson, duplicateJson });

    expect(first.status).toBe(200);
    expect(firstJson).toMatchObject({
      ok: true,
      privacy: "billing-webhook-intake-metadata-only",
      next: "process_billing_event_metadata",
      webhook: {
        verified: true,
        accepted: true,
        duplicate: false,
        status: "accepted",
        tenantId: "tenant_a",
        eventType: "customer.subscription.updated",
        subscriptionStatus: "trialing",
        plan: "team"
      }
    });
    expect(duplicate.status).toBe(200);
    expect(duplicateJson).toMatchObject({
      ok: true,
      next: "ignore_duplicate_billing_event",
      webhook: {
        accepted: true,
        duplicate: true,
        status: "duplicate"
      }
    });
    expect(serialized).not.toContain("evt_route_123");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("pm_secret");
    expect(serialized).not.toContain(webhookSecret());
    expect(serialized).not.toContain("AGENTPROOF");
    expect(serialized).not.toContain("agentproof_billing_webhook_events");
  });

  it("rejects malformed JSON after signature verification as bounded metadata", async () => {
    stubWebhookEnv();
    const body = "{not-json";

    const response = await POST(new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": stripeSignature(body, webhookSecret(), Math.floor(Date.now() / 1000))
      },
      body
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      ok: false,
      privacy: "billing-webhook-intake-metadata-only",
      next: "review_provider_webhook_payload",
      webhook: {
        verified: true,
        accepted: false,
        status: "payload_malformed"
      }
    });
  });

  it("rejects oversized payloads before signature processing", async () => {
    stubWebhookEnv();
    const response = await POST(new Request("http://localhost/api/billing/webhook", {
      method: "POST",
      headers: {
        "stripe-signature": "t=1782921600,v1=00"
      },
      body: "x".repeat(200_001)
    }));
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json).toEqual({
      ok: false,
      privacy: "billing-webhook-intake-metadata-only",
      error: "Billing webhook payload is too large.",
      code: "billing_webhook_payload_too_large",
      next: "review_provider_webhook_payload"
    });
  });
});

function stubWebhookEnv() {
  vi.stubEnv("AGENTPROOF_BILLING_WEBHOOK_SECRET", webhookSecret());
  vi.stubEnv("AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY", "true");
}

function webhookSecret() {
  return "whsec_route_secret_with_enough_entropy";
}

function billingWebhookBody(input: {
  id: string;
  status?: string;
  customer?: string;
  metadata?: Record<string, string>;
}) {
  return JSON.stringify({
    id: input.id,
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_secret_should_not_leak",
        customer: input.customer ?? "cus_secret_should_not_leak",
        status: input.status ?? "active",
        metadata: input.metadata ?? {
          tenantId: "tenant_a"
        }
      }
    }
  });
}

function stripeSignature(rawBody: string, secret: string, timestamp: number): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  return `t=${timestamp},v1=${digest}`;
}
