import { createHash } from "crypto";
import { redactSecrets } from "./redact";

export const BILLING_BETA_SUBSCRIPTIONS_ENV = "AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS";
export const BILLING_BETA_ENFORCEMENT_ENV = "AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED";
export const DEFAULT_BILLING_WEBHOOK_EVENTS_TABLE = "agentproof_billing_webhook_events";

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

type GlobalWithBillingWebhookStore = typeof globalThis & {
  __agentproofBillingWebhookEvents?: Set<string>;
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

  const providerBacked = record.provider !== "manual"
    && Boolean(record.providerCustomerId)
    && Boolean(record.providerSubscriptionId);

  return {
    privacy: "billing-beta-summary-only",
    configured: true,
    providerBacked,
    subscriptionStatus: record.subscriptionStatus,
    ...(record.plan ? { plan: record.plan } : {}),
    portal: {
      available: providerBacked && record.customerPortalEnabled,
      mode: providerBacked && record.customerPortalEnabled ? "server_redirect_required" : "not_configured"
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
  if (!raw?.trim()) return [];

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

  return records.slice(0, 500);
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

export function clearBillingWebhookEventsForTests() {
  billingWebhookMemoryStore().clear();
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
    ...(providerCustomerId ? { providerCustomerId } : {}),
    ...(providerSubscriptionId ? { providerSubscriptionId } : {}),
    ...(providerPriceId ? { providerPriceId } : {}),
    ...(plan ? { plan } : {}),
    subscriptionStatus,
    customerPortalEnabled
  };
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}
