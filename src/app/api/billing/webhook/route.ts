import {
  BillingBetaStoreError,
  type BillingWebhookIntakeStatus,
  processSignedBillingWebhook,
  syncBillingSubscriptionLifecycleFromWebhook
} from "@/lib/billing-beta";
import { noStoreJson, utf8ByteLength } from "@/lib/http";

const MAX_BILLING_WEBHOOK_REQUEST_BYTES = 200_000;

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_BILLING_WEBHOOK_REQUEST_BYTES) {
    return noStoreJson({
      ok: false,
      privacy: "billing-webhook-intake-metadata-only",
      error: "Billing webhook payload is too large.",
      code: "billing_webhook_payload_too_large",
      next: "review_provider_webhook_payload"
    }, { status: 413 });
  }

  const intake = await processSignedBillingWebhook({
    rawBody: bodyText,
    signatureHeader: request.headers.get("stripe-signature")
  });
  let subscription;
  try {
    subscription = await syncBillingSubscriptionLifecycleFromWebhook(intake);
  } catch (error) {
    if (error instanceof BillingBetaStoreError) {
      return noStoreJson({
        ok: false,
        webhook: intake,
        subscription: {
          privacy: "billing-subscription-lifecycle-metadata-only",
          enabled: true,
          synced: false,
          status: "store_unavailable",
          store: "none",
          durable: false,
          provider: intake.provider,
          tenantId: intake.tenantId,
          eventType: intake.eventType,
          subscriptionStatus: intake.subscriptionStatus,
          plan: intake.plan,
          next: "configure_billing_subscription_lifecycle_store"
        },
        privacy: intake.privacy,
        next: "configure_billing_subscription_lifecycle_store"
      }, { status: 503 });
    }

    throw error;
  }

  const status = billingWebhookStatusCode(intake.status);

  return noStoreJson({
    ok: intake.accepted,
    webhook: intake,
    subscription,
    privacy: intake.privacy,
    next: subscription.enabled ? subscription.next : intake.next
  }, { status });
}

function billingWebhookStatusCode(status: BillingWebhookIntakeStatus): number {
  if (status === "signature_unconfigured") return 501;
  if (status === "signature_missing" || status === "signature_invalid" || status === "signature_stale") return 401;
  if (status === "payload_malformed") return 400;
  if (status === "idempotency_unavailable") return 503;

  return 200;
}
