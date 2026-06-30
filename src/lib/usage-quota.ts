import { createHash } from "crypto";
import { redactSecrets } from "./redact";

export const DEFAULT_USAGE_RECORDS_TABLE = "agentproof_usage_records";
export const DEFAULT_USAGE_RESERVATION_RPC = "agentproof_reserve_usage_quota";
export const USAGE_QUOTA_LIMITS_ENV = "AGENTPROOF_USAGE_QUOTA_LIMITS";

export type UsageQuotaFeature = "github_app_analysis";
export type UsageQuotaDenyReason =
  | "quota-disabled"
  | "quota-limits-invalid"
  | "quota-tenant-missing"
  | "quota-limit-missing"
  | "quota-exceeded";

export interface UsageQuotaLimit {
  tenantId: string;
  monthlyAnalysisLimit: number;
  enabled: boolean;
  plan?: string;
}

export interface UsageQuotaReservationInput {
  tenantId?: string;
  feature: UsageQuotaFeature;
  idempotencyKey: string;
  now?: Date;
}

export interface UsageQuotaReservation {
  allowed: boolean;
  enforced: boolean;
  store: "memory" | "supabase" | "none";
  tenantId?: string;
  feature: UsageQuotaFeature;
  period?: string;
  limit?: number;
  used?: number;
  remaining?: number;
  duplicate?: boolean;
  reason?: UsageQuotaDenyReason;
}

interface UsageQuotaLimitInput {
  tenantId?: unknown;
  monthlyAnalysisLimit?: unknown;
  enabled?: unknown;
  plan?: unknown;
}

interface UsageQuotaStoreConfig {
  url: string;
  serviceRoleKey: string;
  recordsTable: string;
  reservationRpc: string;
}

interface SupabaseUsageQuotaRpcResult {
  allowed?: unknown;
  duplicate?: unknown;
  used?: unknown;
  reason?: unknown;
}

type GlobalWithUsageQuota = typeof globalThis & {
  __agentproofUsageQuotaRecords?: Map<string, Set<string>>;
};

export class UsageQuotaStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageQuotaStoreError";
  }
}

export async function reserveUsageQuota(
  input: UsageQuotaReservationInput,
  env = process.env
): Promise<UsageQuotaReservation> {
  const period = usageQuotaPeriod(input.now ?? new Date());
  const tenantId = input.tenantId ? normalizeTenantId(input.tenantId) : undefined;

  if (!truthy(env.AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED)) {
    return {
      allowed: true,
      enforced: false,
      store: "none",
      tenantId,
      feature: input.feature,
      period,
      reason: "quota-disabled"
    };
  }

  if (!tenantId) {
    return denied(input, {
      store: "none",
      period,
      reason: "quota-tenant-missing"
    });
  }

  const limits = readUsageQuotaLimits(env);
  if (!limits) {
    return denied(input, {
      store: "none",
      tenantId,
      period,
      reason: "quota-limits-invalid"
    });
  }

  const limit = limits.find((item) => item.tenantId === tenantId && item.enabled);
  if (!limit) {
    return denied(input, {
      store: "none",
      tenantId,
      period,
      reason: "quota-limit-missing"
    });
  }

  const config = getUsageQuotaStoreConfig(env);
  if (config) {
    return reserveSupabaseUsageQuota(config, input, limit, period);
  }

  if (!truthy(env.AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY)) {
    throw new UsageQuotaStoreError("Usage quota durable store is not configured.");
  }

  return reserveMemoryUsageQuota(input, limit, period);
}

export function readUsageQuotaLimits(env = process.env): UsageQuotaLimit[] | null {
  const raw = env[USAGE_QUOTA_LIMITS_ENV];
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const limits: UsageQuotaLimit[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const limit = normalizeUsageQuotaLimit(item as UsageQuotaLimitInput);
    if (!limit) return null;
    limits.push(limit);
  }

  return limits.slice(0, 500);
}

export function usageQuotaPublicReason(reason: UsageQuotaDenyReason | undefined): string {
  if (reason === "quota-exceeded") {
    return "Tenant monthly PR analysis quota has been reached.";
  }

  if (reason === "quota-limit-missing") {
    return "Tenant quota is not configured for GitHub App analysis.";
  }

  if (reason === "quota-limits-invalid") {
    return "Usage quota configuration is invalid.";
  }

  if (reason === "quota-tenant-missing") {
    return "Tenant context is required before quota-protected analysis can run.";
  }

  return "Usage quota enforcement is disabled.";
}

export function clearUsageQuotaForTests() {
  usageQuotaMemoryStore().clear();
}

function reserveMemoryUsageQuota(
  input: UsageQuotaReservationInput,
  limit: UsageQuotaLimit,
  period: string
): UsageQuotaReservation {
  const idempotencyHash = hashQuotaKey(input.idempotencyKey);
  const key = `${limit.tenantId}:${period}:${input.feature}`;
  const records = usageQuotaMemoryStore().get(key) ?? new Set<string>();
  usageQuotaMemoryStore().set(key, records);

  if (records.has(idempotencyHash)) {
    return allowed(input, {
      store: "memory",
      tenantId: limit.tenantId,
      period,
      limit: limit.monthlyAnalysisLimit,
      used: records.size,
      remaining: Math.max(0, limit.monthlyAnalysisLimit - records.size),
      duplicate: true
    });
  }

  if (records.size >= limit.monthlyAnalysisLimit) {
    return denied(input, {
      store: "memory",
      tenantId: limit.tenantId,
      period,
      limit: limit.monthlyAnalysisLimit,
      used: records.size,
      remaining: 0,
      reason: "quota-exceeded"
    });
  }

  records.add(idempotencyHash);

  return allowed(input, {
    store: "memory",
    tenantId: limit.tenantId,
    period,
    limit: limit.monthlyAnalysisLimit,
    used: records.size,
    remaining: Math.max(0, limit.monthlyAnalysisLimit - records.size)
  });
}

async function reserveSupabaseUsageQuota(
  config: UsageQuotaStoreConfig,
  input: UsageQuotaReservationInput,
  limit: UsageQuotaLimit,
  period: string
): Promise<UsageQuotaReservation> {
  const idempotencyHash = hashQuotaKey(input.idempotencyKey);
  const id = usageRecordId(limit.tenantId, period, input.feature, idempotencyHash);
  const createdAt = (input.now ?? new Date()).toISOString();
  const response = await supabaseUsageRpcFetch(config, {
    p_id: id,
    p_tenant_id: limit.tenantId,
    p_period: period,
    p_feature: input.feature,
    p_idempotency_key_hash: idempotencyHash,
    p_limit: limit.monthlyAnalysisLimit,
    p_created_at: createdAt,
    p_records_table: config.recordsTable
  });

  if (!response.ok) {
    throw new UsageQuotaStoreError(`Usage quota reservation failed with status ${response.status}.`);
  }

  const result = await parseSupabaseUsageQuotaRpcResult(response);
  const used = normalizeUsageCount(result.used);
  if (used === null) {
    throw new UsageQuotaStoreError("Usage quota reservation returned invalid usage count.");
  }

  if (result.allowed === true) {
    return allowed(input, {
      store: "supabase",
      tenantId: limit.tenantId,
      period,
      limit: limit.monthlyAnalysisLimit,
      used,
      remaining: Math.max(0, limit.monthlyAnalysisLimit - used),
      duplicate: result.duplicate === true
    });
  }

  if (result.reason === "quota-exceeded") {
    return denied(input, {
      store: "supabase",
      tenantId: limit.tenantId,
      period,
      limit: limit.monthlyAnalysisLimit,
      used,
      remaining: 0,
      reason: "quota-exceeded"
    });
  }

  throw new UsageQuotaStoreError("Usage quota reservation returned invalid result.");
}

async function supabaseUsageRpcFetch(config: UsageQuotaStoreConfig, body: Record<string, unknown>) {
  return fetch(`${config.url}/rest/v1/rpc/${encodeURIComponent(config.reservationRpc)}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

async function parseSupabaseUsageQuotaRpcResult(response: Response): Promise<SupabaseUsageQuotaRpcResult> {
  const value = (await response.json().catch(() => null)) as unknown;
  const result = Array.isArray(value) ? value[0] : value;

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new UsageQuotaStoreError("Usage quota reservation returned a malformed response.");
  }

  return result as SupabaseUsageQuotaRpcResult;
}

function normalizeUsageQuotaLimit(input: UsageQuotaLimitInput): UsageQuotaLimit | null {
  const tenantId = normalizeTenantId(input.tenantId);
  const monthlyAnalysisLimit = normalizeLimit(input.monthlyAnalysisLimit);
  const plan = typeof input.plan === "string" ? redactSecrets(input.plan).trim().slice(0, 80) : undefined;

  if (!tenantId || monthlyAnalysisLimit === null) return null;

  return {
    tenantId,
    monthlyAnalysisLimit,
    enabled: input.enabled !== false,
    plan: plan || undefined
  };
}

function normalizeLimit(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    return null;
  }

  return value;
}

function allowed(
  input: UsageQuotaReservationInput,
  partial: Omit<UsageQuotaReservation, "allowed" | "enforced" | "feature">
): UsageQuotaReservation {
  return {
    allowed: true,
    enforced: true,
    feature: input.feature,
    ...partial
  };
}

function denied(
  input: UsageQuotaReservationInput,
  partial: Omit<UsageQuotaReservation, "allowed" | "enforced" | "feature">
): UsageQuotaReservation {
  return {
    allowed: false,
    enforced: true,
    feature: input.feature,
    ...partial
  };
}

function getUsageQuotaStoreConfig(env = process.env): UsageQuotaStoreConfig | null {
  const url = env.AGENTPROOF_USAGE_SUPABASE_URL;
  const serviceRoleKey = env.AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY;

  if (!url && !serviceRoleKey) return null;

  if (!url || !serviceRoleKey) {
    throw new UsageQuotaStoreError("Usage quota Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    recordsTable: env.AGENTPROOF_USAGE_RECORDS_TABLE || DEFAULT_USAGE_RECORDS_TABLE,
    reservationRpc: env.AGENTPROOF_USAGE_RESERVATION_RPC || DEFAULT_USAGE_RESERVATION_RPC
  };
}

function normalizeUsageCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000_000) {
    return null;
  }

  return value;
}

function usageQuotaPeriod(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function usageRecordId(
  tenantId: string,
  period: string,
  feature: UsageQuotaFeature,
  idempotencyHash: string
): string {
  return hashQuotaKey(`${tenantId}:${period}:${feature}:${idempotencyHash}`);
}

function hashQuotaKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTenantId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;

  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : undefined;
}

function usageQuotaMemoryStore() {
  const globalStore = globalThis as GlobalWithUsageQuota;
  globalStore.__agentproofUsageQuotaRecords ??= new Map<string, Set<string>>();

  return globalStore.__agentproofUsageQuotaRecords;
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
