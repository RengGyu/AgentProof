import { redactSecrets } from "./redact";

export const TENANT_DELETION_TOMBSTONES_ENV = "AGENTPROOF_TENANT_DELETION_TOMBSTONES";
export const TENANT_DELETION_STATE_ALLOW_MEMORY_ENV = "AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY";
export const DEFAULT_TENANT_DELETION_STATE_TABLE = "agentproof_tenant_deletion_state";

export interface TenantDeletionStateResult {
  privacy: "tenant-deletion-state-metadata-only";
  active: boolean;
  created: boolean;
}

type GlobalWithTenantDeletionState = typeof globalThis & {
  __agentproofTenantDeletionState?: Set<string>;
};

interface TenantDeletionStateStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

export class TenantDeletionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantDeletionStateError";
  }
}

export function isTenantDeletionActive(
  input: { tenantId?: unknown },
  env = process.env
): boolean {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) return false;

  return readStaticTenantDeletionTombstones(env).has(tenantId) || tenantDeletionMemoryStore().has(tenantId);
}

export async function isTenantDeletionActiveAsync(
  input: { tenantId?: unknown },
  env = process.env
): Promise<boolean> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) return false;

  if (isTenantDeletionActive({ tenantId }, env)) return true;

  const config = getTenantDeletionStateStoreConfig(env);
  if (!config) return false;

  return await countSupabaseActiveTenantDeletionState(config, tenantId) > 0;
}

export function assertTenantDeletionNotActive(
  input: { tenantId?: unknown },
  env = process.env
) {
  if (isTenantDeletionActive(input, env)) {
    throw new TenantDeletionStateError("Tenant deletion is in progress.");
  }
}

export async function assertTenantDeletionNotActiveAsync(
  input: { tenantId?: unknown },
  env = process.env
) {
  if (await isTenantDeletionActiveAsync(input, env)) {
    throw new TenantDeletionStateError("Tenant deletion is in progress.");
  }
}

export function markTenantDeletionStartedIfConfigured(
  input: { tenantId?: unknown },
  env = process.env
): TenantDeletionStateResult {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionStateError("Tenant id is invalid.");
  }

  if (readStaticTenantDeletionTombstones(env).has(tenantId)) {
    return {
      privacy: "tenant-deletion-state-metadata-only",
      active: true,
      created: false
    };
  }

  if (!truthy(env[TENANT_DELETION_STATE_ALLOW_MEMORY_ENV])) {
    return {
      privacy: "tenant-deletion-state-metadata-only",
      active: false,
      created: false
    };
  }

  const store = tenantDeletionMemoryStore();
  const created = !store.has(tenantId);
  store.add(tenantId);

  return {
    privacy: "tenant-deletion-state-metadata-only",
    active: true,
    created
  };
}

export async function markTenantDeletionStartedIfConfiguredAsync(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantDeletionStateResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantDeletionStateError("Tenant id is invalid.");
  }

  if (readStaticTenantDeletionTombstones(env).has(tenantId) || tenantDeletionMemoryStore().has(tenantId)) {
    return {
      privacy: "tenant-deletion-state-metadata-only",
      active: true,
      created: false
    };
  }

  const config = getTenantDeletionStateStoreConfig(env);
  if (!config) {
    return markTenantDeletionStartedIfConfigured({ tenantId }, env);
  }

  const existingCount = await countSupabaseActiveTenantDeletionState(config, tenantId);
  await upsertSupabaseTenantDeletionState(config, tenantId);

  return {
    privacy: "tenant-deletion-state-metadata-only",
    active: true,
    created: existingCount === 0
  };
}

export function clearTenantDeletionStateForTests() {
  tenantDeletionMemoryStore().clear();
}

async function countSupabaseActiveTenantDeletionState(
  config: TenantDeletionStateStoreConfig,
  tenantId: string
): Promise<number> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    status: "eq.active",
    select: "tenant_id"
  });
  const response = await supabaseTenantDeletionStateFetch(config, `?${params.toString()}`, {
    method: "HEAD",
    headers: {
      Prefer: "count=exact",
      Range: "0-0"
    }
  });

  if (!response.ok) {
    throw new TenantDeletionStateError(`Tenant deletion state count failed with HTTP ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new TenantDeletionStateError("Tenant deletion state count returned an invalid range.");
  }

  return count;
}

async function upsertSupabaseTenantDeletionState(
  config: TenantDeletionStateStoreConfig,
  tenantId: string
) {
  const now = new Date().toISOString();
  const response = await supabaseTenantDeletionStateFetch(config, "?on_conflict=tenant_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      status: "active",
      started_at: now,
      updated_at: now
    })
  });

  if (!response.ok) {
    throw new TenantDeletionStateError(`Tenant deletion state upsert failed with HTTP ${response.status}.`);
  }
}

async function supabaseTenantDeletionStateFetch(
  config: TenantDeletionStateStoreConfig,
  query: string,
  init: RequestInit
) {
  return fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}${query}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...init.headers
    }
  });
}

function getTenantDeletionStateStoreConfig(env: NodeJS.ProcessEnv): TenantDeletionStateStoreConfig | null {
  const url = env.AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceRoleKey =
    env.AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY ||
    env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url && !serviceRoleKey) return null;

  if (!url || !serviceRoleKey) {
    throw new TenantDeletionStateError("Tenant deletion state Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    table: env.AGENTPROOF_TENANT_DELETION_STATE_TABLE || DEFAULT_TENANT_DELETION_STATE_TABLE
  };
}

function readStaticTenantDeletionTombstones(env: NodeJS.ProcessEnv): Set<string> {
  const raw = env[TENANT_DELETION_TOMBSTONES_ENV];
  if (!raw?.trim()) return new Set();

  const values = parseTenantIdList(raw);
  if (!values) {
    throw new TenantDeletionStateError("Tenant deletion tombstone config is invalid.");
  }

  return new Set(values);
}

function parseTenantIdList(raw: string): string[] | null {
  const trimmed = redactSecrets(raw).trim();

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (!Array.isArray(parsed)) return null;
      const values = parsed
        .map((item) => normalizeTenantId(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, 500);
      return values.length > 0 ? values : null;
    } catch {
      return null;
    }
  }

  const values = trimmed
    .split(",")
    .map((item) => normalizeTenantId(item))
    .filter((item): item is string => Boolean(item))
    .slice(0, 500);
  return values.length > 0 ? values : null;
}

function tenantDeletionMemoryStore() {
  const globalStore = globalThis as GlobalWithTenantDeletionState;
  globalStore.__agentproofTenantDeletionState ??= new Set<string>();

  return globalStore.__agentproofTenantDeletionState;
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function countFromContentRange(value: string | null): number | null {
  if (!value) return null;
  const total = value.split("/").at(1);
  if (!total || total === "*") return null;
  const count = Number(total);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truthy(value: unknown): boolean {
  return value === "1" || value === "true" || value === "yes";
}
