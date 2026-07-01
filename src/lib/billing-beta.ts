import { createHash, createHmac, timingSafeEqual } from "crypto";
import { redactSecrets } from "./redact";

export const BILLING_BETA_SUBSCRIPTIONS_ENV = "AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS";
export const BILLING_BETA_ENFORCEMENT_ENV = "AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED";
export const BILLING_WEBHOOK_SECRET_ENV = "AGENTPROOF_BILLING_WEBHOOK_SECRET";
export const DEFAULT_BILLING_WEBHOOK_EVENTS_TABLE = "agentproof_billing_webhook_events";
export const DEFAULT_BILLING_SUBSCRIPTIONS_TABLE = "agentproof_billing_subscriptions";
export const DEFAULT_BILLING_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

export type BillingBetaProvider = "stripe" | "manual";
export type BillingBetaSubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "past_due"
  | "paused"
  | "trialing"
  | "unknown";

export interface BillingBetaSummary {
  privacy: "billing-beta-summary-only";
  configured: boolean;
  providerBacked: boolean;
  subscriptionStatus: BillingBetaSubscriptionStatus;
  plan?: string;
  portal: {
    available: boolean;
    mode: "server_redirect_required" | "not_configured";
  };
  webhooks: {
    idempotency: "configured" | "not_configured";
  };
}

export interface BillingWebhookReservation {
  accepted: boolean;
  duplicate: boolean;
  store: "memory" | "supabase" | "none";
  provider?: BillingBetaProvider;
  tenantId?: string;
  eventType?: string;
  reason?: "billing-webhook-idempotency-not-configured";
  privacy: "billing-webhook-idempotency-metadata-only";
}

export type BillingWebhookIntakeStatus =
  | "accepted"
  | "duplicate"
  | "signature_unconfigured"
  | "signature_missing"
  | "signature_invalid"
  | "signature_stale"
  | "payload_malformed"
  | "idempotency_unavailable";

export interface BillingWebhookIntakeResult {
  privacy: "billing-webhook-intake-metadata-only";
  provider: "stripe";
  verified: boolean;
  accepted: boolean;
  duplicate: boolean;
  status: BillingWebhookIntakeStatus;
  tenantId?: string;
  eventType?: string;
  subscriptionStatus?: BillingBetaSubscriptionStatus;
  plan?: string;
  idempotency?: Pick<BillingWebhookReservation, "privacy" | "store" | "provider" | "tenantId" | "eventType" | "accepted" | "duplicate">;
  next:
    | "configure_billing_webhook_secret"
    | "retry_with_signed_provider_payload"
    | "retry_with_recent_provider_signature"
    | "review_provider_webhook_payload"
    | "configure_billing_webhook_idempotency"
    | "process_billing_event_metadata"
    | "ignore_duplicate_billing_event";
}

export type BillingSubscriptionLifecycleSyncStatus =
  | "synced"
  | "duplicate_ignored"
  | "not_enabled"
  | "webhook_not_accepted"
  | "missing_tenant"
  | "missing_subscription_status"
  | "store_unavailable";

export interface BillingSubscriptionLifecycleSyncResult {
  privacy: "billing-subscription-lifecycle-metadata-only";
  enabled: boolean;
  synced: boolean;
  status: BillingSubscriptionLifecycleSyncStatus;
  store: "memory" | "supabase" | "none";
  durable: boolean;
  provider?: "stripe";
  tenantId?: string;
  eventType?: string;
  subscriptionStatus?: BillingBetaSubscriptionStatus;
  plan?: string;
  next:
    | "enable_billing_subscription_lifecycle_sync"
    | "retry_billing_webhook_intake"
    | "review_provider_billing_mapping"
    | "configure_billing_subscription_lifecycle_store"
    | "billing_subscription_metadata_synced"
    | "ignore_duplicate_billing_event";
}

export type BillingBetaGateReason =
  | "billing-beta-enforcement-disabled"
  | "billing-record-missing"
  | "billing-record-not-provider-backed"
  | "billing-subscription-inactive"
  | "billing-plan-mismatch";

export interface BillingBetaGateDecision {
  allowed: boolean;
  enforced: boolean;
  configured: boolean;
  providerBacked: boolean;
  subscriptionStatus: BillingBetaSubscriptionStatus;
  plan?: string;
  reason?: BillingBetaGateReason;
  privacy: "billing-beta-gate-metadata-only";
}

export type BillingPortalSessionBoundaryStatus =
  | "ready"
  | "not_configured"
  | "manual_review_required"
  | "unavailable";

export interface BillingPortalSessionBoundary {
  privacy: "billing-portal-session-boundary-only";
  configured: boolean;
  providerBacked: boolean;
  subscriptionStatus: BillingBetaSubscriptionStatus;
  plan?: string;
  portal: BillingBetaSummary["portal"];
  status: BillingPortalSessionBoundaryStatus;
  reason?:
    | "billing_record_missing"
    | "billing_record_not_provider_backed"
    | "billing_subscription_inactive"
    | "billing_portal_not_configured"
    | "billing_summary_unavailable";
  next:
    | "configure_billing_record"
    | "configure_provider_backed_billing"
    | "resolve_subscription_status"
    | "enable_customer_portal"
    | "redirect_via_provider_adapter"
    | "review_billing_summary";
}

interface BillingBetaSubscriptionInput {
  tenantId?: unknown;
  provider?: unknown;
  providerCustomerId?: unknown;
  providerSubscriptionId?: unknown;
  providerPriceId?: unknown;
  plan?: unknown;
  subscriptionStatus?: unknown;
  status?: unknown;
  customerPortalEnabled?: unknown;
}

interface BillingBetaSubscriptionRecord {
  tenantId: string;
  provider: BillingBetaProvider;
  providerBacked: boolean;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  providerPriceId?: string;
  plan?: string;
  subscriptionStatus: BillingBetaSubscriptionStatus;
  customerPortalEnabled: boolean;
}

interface BillingWebhookStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

interface BillingSubscriptionLifecycleStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

interface StripeBillingWebhookPayload {
  id?: unknown;
  type?: unknown;
  data?: {
    object?: {
      status?: unknown;
      metadata?: Record<string, unknown>;
    };
  };
}

type GlobalWithBillingWebhookStore = typeof globalThis & {
  __agentproofBillingWebhookEvents?: Set<string>;
  __agentproofBillingSubscriptions?: Map<string, BillingBetaSubscriptionRecord>;
};

export class BillingBetaStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingBetaStoreError";
  }
}

export function readBillingBetaSummary(
  input: { tenantId?: unknown },
  env = process.env
): BillingBetaSummary {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new BillingBetaStoreError("Billing beta tenant id is invalid.");
  }

  const records = readBillingBetaSubscriptionRecords(env);
  if (!records) {
    throw new BillingBetaStoreError("Billing beta subscription configuration is invalid.");
  }

  const record = records.find((item) => item.tenantId === tenantId);
  const webhookIdempotency = billingWebhookIdempotencyConfigured(env) ? "configured" : "not_configured";
  if (!record) {
    return {
      privacy: "billing-beta-summary-only",
      configured: false,
      providerBacked: false,
      subscriptionStatus: "unknown",
      portal: {
        available: false,
        mode: "not_configured"
      },
      webhooks: {
        idempotency: webhookIdempotency
      }
    };
  }

  return {
    privacy: "billing-beta-summary-only",
    configured: true,
    providerBacked: record.providerBacked,
    subscriptionStatus: record.subscriptionStatus,
    ...(record.plan ? { plan: record.plan } : {}),
    portal: {
      available: record.providerBacked && record.customerPortalEnabled,
      mode: record.providerBacked && record.customerPortalEnabled ? "server_redirect_required" : "not_configured"
    },
    webhooks: {
      idempotency: webhookIdempotency
    }
  };
}

export function billingSubscriptionAllowsAccess(summary: BillingBetaSummary): boolean {
  if (!summary.configured) return true;
  return summary.subscriptionStatus === "active" || summary.subscriptionStatus === "trialing";
}

export function evaluateBillingBetaGate(
  input: { tenantId?: unknown; quotaPlan?: unknown },
  env = process.env
): BillingBetaGateDecision {
  const summary = readBillingBetaSummary({ tenantId: input.tenantId }, env);
  const quotaPlan = normalizePlanLabel(input.quotaPlan);

  const base = {
    enforced: truthy(env[BILLING_BETA_ENFORCEMENT_ENV]),
    configured: summary.configured,
    providerBacked: summary.providerBacked,
    subscriptionStatus: summary.subscriptionStatus,
    ...(summary.plan ? { plan: summary.plan } : {}),
    privacy: "billing-beta-gate-metadata-only" as const
  };

  if (!base.enforced) {
    return {
      ...base,
      allowed: true,
      reason: "billing-beta-enforcement-disabled"
    };
  }

  if (!summary.configured) {
    return {
      ...base,
      allowed: false,
      reason: "billing-record-missing"
    };
  }

  if (!summary.providerBacked) {
    return {
      ...base,
      allowed: false,
      reason: "billing-record-not-provider-backed"
    };
  }

  if (!billingSubscriptionAllowsAccess(summary)) {
    return {
      ...base,
      allowed: false,
      reason: "billing-subscription-inactive"
    };
  }

  if (summary.plan && quotaPlan && summary.plan !== quotaPlan) {
    return {
      ...base,
      allowed: false,
      reason: "billing-plan-mismatch"
    };
  }

  return {
    ...base,
    allowed: true
  };
}

export function buildBillingPortalSessionBoundary(
  input: { tenantId?: unknown },
  env = process.env
): BillingPortalSessionBoundary {
  let summary: BillingBetaSummary;
  try {
    summary = readBillingBetaSummary(input, env);
  } catch {
    return {
      privacy: "billing-portal-session-boundary-only",
      configured: false,
      providerBacked: false,
      subscriptionStatus: "unknown",
      portal: {
        available: false,
        mode: "not_configured"
      },
      status: "unavailable",
      reason: "billing_summary_unavailable",
      next: "review_billing_summary"
    };
  }

  const base = {
    privacy: "billing-portal-session-boundary-only" as const,
    configured: summary.configured,
    providerBacked: summary.providerBacked,
    subscriptionStatus: summary.subscriptionStatus,
    ...(summary.plan ? { plan: summary.plan } : {}),
    portal: summary.portal
  };

  if (!summary.configured) {
    return {
      ...base,
      status: "not_configured",
      reason: "billing_record_missing",
      next: "configure_billing_record"
    };
  }

  if (!summary.providerBacked) {
    return {
      ...base,
      status: "manual_review_required",
      reason: "billing_record_not_provider_backed",
      next: "configure_provider_backed_billing"
    };
  }

  if (!billingSubscriptionAllowsAccess(summary)) {
    return {
      ...base,
      status: "manual_review_required",
      reason: "billing_subscription_inactive",
      next: "resolve_subscription_status"
    };
  }

  if (!summary.portal.available) {
    return {
      ...base,
      status: "manual_review_required",
      reason: "billing_portal_not_configured",
      next: "enable_customer_portal"
    };
  }

  return {
    ...base,
    status: "ready",
    next: "redirect_via_provider_adapter"
  };
}

export function billingBetaPublicReason(reason: BillingBetaGateReason | undefined): string {
  if (reason === "billing-record-missing") {
    return "Tenant billing is not configured for provider-backed beta access.";
  }

  if (reason === "billing-record-not-provider-backed") {
    return "Tenant billing is not provider-backed for beta access.";
  }

  if (reason === "billing-subscription-inactive") {
    return "Tenant subscription is not active for GitHub App analysis.";
  }

  if (reason === "billing-plan-mismatch") {
    return "Tenant billing plan and quota plan do not match.";
  }

  return "Billing beta enforcement is disabled.";
}

export function readBillingBetaSubscriptionRecords(env = process.env): BillingBetaSubscriptionRecord[] | null {
  const raw = env[BILLING_BETA_SUBSCRIPTIONS_ENV];
  if (!raw?.trim()) return mergeMemoryBillingSubscriptionRecords([], env).slice(0, 500);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const records: BillingBetaSubscriptionRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = normalizeBillingBetaSubscription(item as BillingBetaSubscriptionInput);
    if (!record) return null;
    records.push(record);
  }

  return mergeMemoryBillingSubscriptionRecords(records, env).slice(0, 500);
}

export async function reserveBillingWebhookEvent(
  input: {
    provider?: unknown;
    providerEventId?: unknown;
    tenantId?: unknown;
    eventType?: unknown;
    receivedAt?: Date;
  },
  env = process.env
): Promise<BillingWebhookReservation> {
  const provider = normalizeBillingProvider(input.provider);
  const providerEventId = normalizeProviderEventId(input.providerEventId);
  if (!provider || !providerEventId) {
    throw new BillingBetaStoreError("Billing webhook idempotency input is invalid.");
  }

  const tenantId = normalizeTenantId(input.tenantId) ?? undefined;
  const eventType = normalizeEventType(input.eventType);
  const eventIdHash = hashBillingWebhookEvent(providerEventId);
  const idempotencyKey = `${provider}:${eventIdHash}`;
  const config = getBillingWebhookStoreConfig(env);

  if (config) {
    return reserveSupabaseBillingWebhookEvent(config, {
      provider,
      eventIdHash,
      idempotencyKey,
      tenantId,
      eventType,
      receivedAt: input.receivedAt ?? new Date()
    });
  }

  if (!truthy(env.AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY)) {
    return {
      accepted: false,
      duplicate: false,
      store: "none",
      provider,
      tenantId,
      eventType,
      reason: "billing-webhook-idempotency-not-configured",
      privacy: "billing-webhook-idempotency-metadata-only"
    };
  }

  const store = billingWebhookMemoryStore();
  const duplicate = store.has(idempotencyKey);
  if (!duplicate) store.add(idempotencyKey);

  return {
    accepted: true,
    duplicate,
    store: "memory",
    provider,
    tenantId,
    eventType,
    privacy: "billing-webhook-idempotency-metadata-only"
  };
}

export async function processSignedBillingWebhook(
  input: {
    rawBody?: unknown;
    signatureHeader?: string | null;
    receivedAt?: Date;
    toleranceSeconds?: number;
  },
  env = process.env
): Promise<BillingWebhookIntakeResult> {
  const provider = "stripe" as const;
  const rawBody = typeof input.rawBody === "string" ? input.rawBody : "";
  const receivedAt = input.receivedAt ?? new Date();
  const secret = normalizeWebhookSecret(env[BILLING_WEBHOOK_SECRET_ENV]);

  if (!secret) {
    return webhookIntakeResult({
      provider,
      verified: false,
      accepted: false,
      duplicate: false,
      status: "signature_unconfigured",
      next: "configure_billing_webhook_secret"
    });
  }

  const signature = verifyStripeWebhookSignature({
    rawBody,
    signatureHeader: input.signatureHeader,
    secret,
    receivedAt,
    toleranceSeconds: input.toleranceSeconds ?? DEFAULT_BILLING_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
  });

  if (signature !== "ok") {
    return webhookIntakeResult({
      provider,
      verified: false,
      accepted: false,
      duplicate: false,
      status: signature,
      next: signature === "signature_stale" ? "retry_with_recent_provider_signature" : "retry_with_signed_provider_payload"
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return webhookIntakeResult({
      provider,
      verified: true,
      accepted: false,
      duplicate: false,
      status: "payload_malformed",
      next: "review_provider_webhook_payload"
    });
  }

  const metadata = extractStripeWebhookMetadata(parsed);
  if (!metadata.providerEventId || !metadata.publicMetadata.eventType) {
    return webhookIntakeResult({
      provider,
      verified: true,
      accepted: false,
      duplicate: false,
      status: "payload_malformed",
      next: "review_provider_webhook_payload",
      ...metadata.publicMetadata
    });
  }

  const idempotency = await reserveBillingWebhookEvent({
    provider,
    providerEventId: metadata.providerEventId,
    tenantId: metadata.publicMetadata.tenantId,
    eventType: metadata.publicMetadata.eventType,
    receivedAt
  }, env);

  if (!idempotency.accepted) {
    return webhookIntakeResult({
      provider,
      verified: true,
      accepted: false,
      duplicate: false,
      status: "idempotency_unavailable",
      next: "configure_billing_webhook_idempotency",
      idempotency,
      ...metadata.publicMetadata
    });
  }

  return webhookIntakeResult({
    provider,
    verified: true,
    accepted: true,
    duplicate: idempotency.duplicate,
    status: idempotency.duplicate ? "duplicate" : "accepted",
    next: idempotency.duplicate ? "ignore_duplicate_billing_event" : "process_billing_event_metadata",
    idempotency,
    ...metadata.publicMetadata
  });
}

export async function syncBillingSubscriptionLifecycleFromWebhook(
  intake: BillingWebhookIntakeResult,
  env = process.env
): Promise<BillingSubscriptionLifecycleSyncResult> {
  if (!truthy(env.AGENTPROOF_BILLING_SUBSCRIPTION_SYNC_ENABLED)) {
    return billingSubscriptionLifecycleResult({
      enabled: false,
      synced: false,
      status: "not_enabled",
      store: "none",
      durable: false,
      provider: intake.provider,
      tenantId: intake.tenantId,
      eventType: intake.eventType,
      subscriptionStatus: intake.subscriptionStatus,
      plan: intake.plan,
      next: "enable_billing_subscription_lifecycle_sync"
    });
  }

  if (intake.status === "duplicate") {
    return billingSubscriptionLifecycleResult({
      enabled: true,
      synced: false,
      status: "duplicate_ignored",
      store: intake.idempotency?.store ?? "none",
      durable: intake.idempotency?.store === "supabase",
      provider: intake.provider,
      tenantId: intake.tenantId,
      eventType: intake.eventType,
      subscriptionStatus: intake.subscriptionStatus,
      plan: intake.plan,
      next: "ignore_duplicate_billing_event"
    });
  }

  if (!intake.verified || !intake.accepted) {
    return billingSubscriptionLifecycleResult({
      enabled: true,
      synced: false,
      status: "webhook_not_accepted",
      store: "none",
      durable: false,
      provider: intake.provider,
      tenantId: intake.tenantId,
      eventType: intake.eventType,
      subscriptionStatus: intake.subscriptionStatus,
      plan: intake.plan,
      next: "retry_billing_webhook_intake"
    });
  }

  if (!intake.tenantId) {
    return billingSubscriptionLifecycleResult({
      enabled: true,
      synced: false,
      status: "missing_tenant",
      store: "none",
      durable: false,
      provider: intake.provider,
      eventType: intake.eventType,
      subscriptionStatus: intake.subscriptionStatus,
      plan: intake.plan,
      next: "review_provider_billing_mapping"
    });
  }

  if (!intake.subscriptionStatus) {
    return billingSubscriptionLifecycleResult({
      enabled: true,
      synced: false,
      status: "missing_subscription_status",
      store: "none",
      durable: false,
      provider: intake.provider,
      tenantId: intake.tenantId,
      eventType: intake.eventType,
      plan: intake.plan,
      next: "review_provider_billing_mapping"
    });
  }

  const config = getBillingSubscriptionLifecycleStoreConfig(env);
  if (config) {
    await syncSupabaseBillingSubscriptionLifecycle(config, {
      provider: intake.provider,
      tenantId: intake.tenantId,
      eventType: intake.eventType,
      subscriptionStatus: intake.subscriptionStatus,
      plan: intake.plan
    });

    return billingSubscriptionLifecycleResult({
      enabled: true,
      synced: true,
      status: "synced",
      store: "supabase",
      durable: true,
      provider: intake.provider,
      tenantId: intake.tenantId,
      eventType: intake.eventType,
      subscriptionStatus: intake.subscriptionStatus,
      plan: intake.plan,
      next: "billing_subscription_metadata_synced"
    });
  }

  if (!truthy(env.AGENTPROOF_BILLING_SUBSCRIPTION_SYNC_ALLOW_MEMORY)) {
    return billingSubscriptionLifecycleResult({
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
    });
  }

  billingSubscriptionMemoryStore().set(intake.tenantId, {
    tenantId: intake.tenantId,
    provider: intake.provider,
    providerBacked: true,
    ...(intake.plan ? { plan: intake.plan } : {}),
    subscriptionStatus: intake.subscriptionStatus,
    customerPortalEnabled: false
  });

  return billingSubscriptionLifecycleResult({
    enabled: true,
    synced: true,
    status: "synced",
    store: "memory",
    durable: false,
    provider: intake.provider,
    tenantId: intake.tenantId,
    eventType: intake.eventType,
    subscriptionStatus: intake.subscriptionStatus,
    plan: intake.plan,
    next: "billing_subscription_metadata_synced"
  });
}

export function clearBillingWebhookEventsForTests() {
  billingWebhookMemoryStore().clear();
  billingSubscriptionMemoryStore().clear();
}

function normalizeBillingBetaSubscription(input: BillingBetaSubscriptionInput): BillingBetaSubscriptionRecord | null {
  const tenantId = normalizeTenantId(input.tenantId);
  const provider = normalizeBillingProvider(input.provider);
  const providerCustomerId = normalizeProviderId(input.providerCustomerId);
  const providerSubscriptionId = normalizeProviderId(input.providerSubscriptionId);
  const providerPriceId = normalizeProviderId(input.providerPriceId);
  const plan = normalizePlanLabel(input.plan);
  const subscriptionStatus = normalizeSubscriptionStatus(input.subscriptionStatus ?? input.status);
  const customerPortalEnabled = input.customerPortalEnabled === true;
  if (!tenantId || !provider || !subscriptionStatus) return null;
  if (provider !== "manual" && (!providerCustomerId || !providerSubscriptionId)) return null;

  return {
    tenantId,
    provider,
    providerBacked: provider !== "manual" && Boolean(providerCustomerId) && Boolean(providerSubscriptionId),
    ...(providerCustomerId ? { providerCustomerId } : {}),
    ...(providerSubscriptionId ? { providerSubscriptionId } : {}),
    ...(providerPriceId ? { providerPriceId } : {}),
    ...(plan ? { plan } : {}),
    subscriptionStatus,
    customerPortalEnabled
  };
}

async function syncSupabaseBillingSubscriptionLifecycle(
  config: BillingSubscriptionLifecycleStoreConfig,
  input: {
    provider: "stripe";
    tenantId: string;
    eventType?: string;
    subscriptionStatus: BillingBetaSubscriptionStatus;
    plan?: string;
  }
): Promise<void> {
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?on_conflict=tenant_id`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      tenant_id: input.tenantId,
      provider: input.provider,
      provider_backed: true,
      subscription_status: input.subscriptionStatus,
      plan: input.plan ?? null,
      last_event_type: input.eventType ?? null,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new BillingBetaStoreError(`Billing subscription lifecycle store failed with HTTP ${response.status}.`);
  }
}

function getBillingSubscriptionLifecycleStoreConfig(env = process.env): BillingSubscriptionLifecycleStoreConfig | null {
  const url = env.AGENTPROOF_BILLING_SUBSCRIPTIONS_SUPABASE_URL || "";
  const serviceRoleKey = env.AGENTPROOF_BILLING_SUBSCRIPTIONS_SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url && !serviceRoleKey) return null;
  if (!url || !serviceRoleKey) {
    throw new BillingBetaStoreError("Billing subscription lifecycle Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    table: env.AGENTPROOF_BILLING_SUBSCRIPTIONS_TABLE || DEFAULT_BILLING_SUBSCRIPTIONS_TABLE
  };
}

function mergeMemoryBillingSubscriptionRecords(
  records: BillingBetaSubscriptionRecord[],
  env: NodeJS.ProcessEnv
): BillingBetaSubscriptionRecord[] {
  if (!truthy(env.AGENTPROOF_BILLING_SUBSCRIPTION_SYNC_ALLOW_MEMORY)) return records;
  const merged = new Map(records.map((record) => [record.tenantId, record]));
  for (const [tenantId, record] of billingSubscriptionMemoryStore()) {
    merged.set(tenantId, record);
  }

  return [...merged.values()];
}

function billingWebhookIdempotencyConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(getBillingWebhookStoreConfig(env)) || truthy(env.AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY);
}

async function reserveSupabaseBillingWebhookEvent(
  config: BillingWebhookStoreConfig,
  input: {
    provider: BillingBetaProvider;
    eventIdHash: string;
    idempotencyKey: string;
    tenantId?: string;
    eventType?: string;
    receivedAt: Date;
  }
): Promise<BillingWebhookReservation> {
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      id: input.idempotencyKey,
      provider: input.provider,
      provider_event_id_hash: input.eventIdHash,
      tenant_id: input.tenantId ?? null,
      event_type: input.eventType ?? null,
      received_at: input.receivedAt.toISOString()
    })
  });

  if (response.status === 409) {
    return {
      accepted: true,
      duplicate: true,
      store: "supabase",
      provider: input.provider,
      tenantId: input.tenantId,
      eventType: input.eventType,
      privacy: "billing-webhook-idempotency-metadata-only"
    };
  }

  if (!response.ok) {
    throw new BillingBetaStoreError(`Billing webhook idempotency store failed with HTTP ${response.status}.`);
  }

  return {
    accepted: true,
    duplicate: false,
    store: "supabase",
    provider: input.provider,
    tenantId: input.tenantId,
    eventType: input.eventType,
    privacy: "billing-webhook-idempotency-metadata-only"
  };
}

function getBillingWebhookStoreConfig(env = process.env): BillingWebhookStoreConfig | null {
  const url = env.AGENTPROOF_BILLING_WEBHOOK_SUPABASE_URL || "";
  const serviceRoleKey = env.AGENTPROOF_BILLING_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url && !serviceRoleKey) return null;
  if (!url || !serviceRoleKey) {
    throw new BillingBetaStoreError("Billing webhook idempotency Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    table: env.AGENTPROOF_BILLING_WEBHOOK_EVENTS_TABLE || DEFAULT_BILLING_WEBHOOK_EVENTS_TABLE
  };
}

function webhookIntakeResult(
  input: Omit<BillingWebhookIntakeResult, "privacy">
): BillingWebhookIntakeResult {
  return {
    privacy: "billing-webhook-intake-metadata-only",
    ...input,
    ...(input.idempotency ? { idempotency: boundedBillingWebhookReservation(input.idempotency) } : {})
  };
}

function billingSubscriptionLifecycleResult(
  input: Omit<BillingSubscriptionLifecycleSyncResult, "privacy">
): BillingSubscriptionLifecycleSyncResult {
  return {
    privacy: "billing-subscription-lifecycle-metadata-only",
    ...input
  };
}

function boundedBillingWebhookReservation(
  input: BillingWebhookReservation
): NonNullable<BillingWebhookIntakeResult["idempotency"]> {
  return {
    privacy: input.privacy,
    store: input.store,
    provider: input.provider,
    tenantId: input.tenantId,
    eventType: input.eventType,
    accepted: input.accepted,
    duplicate: input.duplicate
  };
}

function verifyStripeWebhookSignature(input: {
  rawBody: string;
  signatureHeader?: string | null;
  secret: string;
  receivedAt: Date;
  toleranceSeconds: number;
}): "ok" | "signature_missing" | "signature_invalid" | "signature_stale" {
  const parsed = parseStripeSignatureHeader(input.signatureHeader);
  if (!parsed) return "signature_missing";

  const nowSeconds = Math.floor(input.receivedAt.getTime() / 1000);
  if (!Number.isFinite(parsed.timestamp) || Math.abs(nowSeconds - parsed.timestamp) > input.toleranceSeconds) {
    return "signature_stale";
  }

  const signedPayload = `${parsed.timestamp}.${input.rawBody}`;
  const expected = createHmac("sha256", input.secret).update(signedPayload).digest("hex");
  const matched = parsed.signatures.some((signature) => timingSafeHexEqual(signature, expected));

  return matched ? "ok" : "signature_invalid";
}

function parseStripeSignatureHeader(value?: string | null): { timestamp: number; signatures: string[] } | null {
  if (!value?.trim()) return null;
  const parts = value.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = Number(timestampPart?.slice(2));
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3).trim().toLowerCase())
    .filter((part) => /^[a-f0-9]{64}$/.test(part));

  if (!Number.isSafeInteger(timestamp) || signatures.length === 0) return null;

  return { timestamp, signatures };
}

function timingSafeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) return false;

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function extractStripeWebhookMetadata(value: unknown): {
  providerEventId?: string;
  publicMetadata: Pick<BillingWebhookIntakeResult, "tenantId" | "eventType" | "subscriptionStatus" | "plan">;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { publicMetadata: {} };
  }

  const payload = value as StripeBillingWebhookPayload;
  const object = payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
    ? payload.data.object
    : undefined;
  const metadata = object && typeof object === "object" && !Array.isArray(object)
    && object.metadata && typeof object.metadata === "object" && !Array.isArray(object.metadata)
    ? object.metadata
    : undefined;
  const providerEventId = normalizeProviderEventId(payload.id) ?? undefined;
  const eventType = normalizeEventType(payload.type);
  const tenantId = normalizeTenantId(
    metadata?.agentproofTenantId
    ?? metadata?.tenantId
    ?? metadata?.agentproof_tenant_id
  ) ?? undefined;
  const subscriptionStatus = normalizeSubscriptionStatus(object?.status) ?? undefined;
  const plan = normalizePlanLabel(metadata?.agentproofPlan ?? metadata?.plan) ?? undefined;

  return {
    providerEventId,
    publicMetadata: {
      ...(tenantId ? { tenantId } : {}),
      ...(eventType ? { eventType } : {}),
      ...(subscriptionStatus ? { subscriptionStatus } : {}),
      ...(plan ? { plan } : {})
    }
  };
}

function normalizeWebhookSecret(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();
  if (normalized.length < 16 || normalized.includes("[redacted]")) return null;

  return normalized;
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function normalizeBillingProvider(value: unknown): BillingBetaProvider | null {
  return value === "stripe" || value === "manual" ? value : null;
}

function normalizeSubscriptionStatus(value: unknown): BillingBetaSubscriptionStatus | null {
  if (
    value === "active" ||
    value === "canceled" ||
    value === "incomplete" ||
    value === "past_due" ||
    value === "paused" ||
    value === "trialing" ||
    value === "unknown"
  ) {
    return value;
  }

  return null;
}

function normalizeProviderId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecrets(value).trim();
  if (!normalized || normalized.includes("[redacted]")) return undefined;
  if (/[?&=]/.test(normalized)) return undefined;

  return /^[a-zA-Z0-9][a-zA-Z0-9_:-]{2,199}$/.test(normalized) ? normalized : undefined;
}

function normalizeProviderEventId(value: unknown): string | null {
  const id = normalizeProviderId(value);
  return id && id.length <= 240 ? id : null;
}

function normalizeEventType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecrets(value).trim();

  return /^[a-z0-9][a-z0-9_.:-]{0,119}$/i.test(normalized) ? normalized : undefined;
}

function normalizePlanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const plan = redactSecrets(value).trim().slice(0, 80);
  if (!plan || plan.includes("[redacted]")) return undefined;
  if (/\b(?:acct|cus|cs|evt|in|pi|pm|price|prod|si|sub)_[a-z0-9_-]{4,}/i.test(plan)) return undefined;

  return /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,79}$/.test(plan) ? plan : undefined;
}

function hashBillingWebhookEvent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function billingWebhookMemoryStore(): Set<string> {
  const global = globalThis as GlobalWithBillingWebhookStore;
  global.__agentproofBillingWebhookEvents ??= new Set<string>();

  return global.__agentproofBillingWebhookEvents;
}

function billingSubscriptionMemoryStore(): Map<string, BillingBetaSubscriptionRecord> {
  const global = globalThis as GlobalWithBillingWebhookStore;
  global.__agentproofBillingSubscriptions ??= new Map<string, BillingBetaSubscriptionRecord>();

  return global.__agentproofBillingSubscriptions;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
