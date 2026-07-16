import { redactSecrets } from "./redact";

export const TENANT_DELETION_TOMBSTONES_ENV = "AGENTPROOF_TENANT_DELETION_TOMBSTONES";
export const TENANT_DELETION_STATE_ALLOW_MEMORY_ENV = "AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY";
export const DEFAULT_TENANT_DELETION_STATE_TABLE = "agentproof_tenant_deletion_state";
export const TENANT_DELETION_STATE_ACTIVE_RPC = "agentproof_tenant_deletion_state_active";
export const MARK_TENANT_DELETION_ACTIVE_RPC = "agentproof_mark_tenant_deletion_active";

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

  return await readSupabaseTenantDeletionStateActive(config, tenantId);
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

  const outcome = await markSupabaseTenantDeletionStateActive(config, tenantId);

  return {
    privacy: "tenant-deletion-state-metadata-only",
    active: true,
    created: outcome === "created"
  };
}

export function clearTenantDeletionStateForTests() {
  tenantDeletionMemoryStore().clear();
}

async function readSupabaseTenantDeletionStateActive(
  config: TenantDeletionStateStoreConfig,
  tenantId: string
): Promise<boolean> {
  const response = await supabaseTenantDeletionStateRpcFetch(config, TENANT_DELETION_STATE_ACTIVE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_tenant_id: tenantId })
  });

  if (!response.ok) {
    throw new TenantDeletionStateError(`Tenant deletion state lookup failed with HTTP ${response.status}.`);
  }

  return parseBooleanRpcResult(await response.json().catch(() => null), "active");
}

async function markSupabaseTenantDeletionStateActive(
  config: TenantDeletionStateStoreConfig,
  tenantId: string
) : Promise<"created" | "existing"> {
  const response = await supabaseTenantDeletionStateRpcFetch(config, MARK_TENANT_DELETION_ACTIVE_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ p_tenant_id: tenantId })
  });

  if (!response.ok) {
    throw new TenantDeletionStateError(`Tenant deletion state mark failed with HTTP ${response.status}.`);
  }

  return parseMarkRpcResult(await response.json().catch(() => null));
}

async function supabaseTenantDeletionStateRpcFetch(
  config: TenantDeletionStateStoreConfig,
  rpcName: string,
  init: RequestInit
) {
  return fetch(`${config.url}/rest/v1/rpc/${encodeURIComponent(rpcName)}`, {
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

  // The durable table is intentionally accessed only through the two
  // schema-owned RPCs. A legacy custom-table override cannot satisfy that
  // contract, so do not silently fall back to a different storage boundary.
  const configuredTable = env.AGENTPROOF_TENANT_DELETION_STATE_TABLE?.trim();
  if (configuredTable && configuredTable !== DEFAULT_TENANT_DELETION_STATE_TABLE) {
    throw new TenantDeletionStateError("Tenant deletion state table override is unsupported.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey
  };
}

function parseBooleanRpcResult(value: unknown, field: "active"): boolean {
  if (!Array.isArray(value) || value.length !== 1 || !isExactRecord(value[0], [field]) || typeof value[0][field] !== "boolean") {
    throw new TenantDeletionStateError("Tenant deletion state lookup returned an invalid response.");
  }
  return value[0][field] as boolean;
}

function parseMarkRpcResult(value: unknown): "created" | "existing" {
  if (!Array.isArray(value) || value.length !== 1 || !isExactRecord(value[0], ["outcome"])) {
    throw new TenantDeletionStateError("Tenant deletion state mark returned an invalid response.");
  }
  const outcome = value[0].outcome;
  if (outcome !== "created" && outcome !== "existing") {
    throw new TenantDeletionStateError("Tenant deletion state mark returned an invalid outcome.");
  }
  return outcome;
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).length === keys.length
    && keys.every((key) => Object.hasOwn(value as Record<string, unknown>, key));
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truthy(value: unknown): boolean {
  return value === "1" || value === "true" || value === "yes";
}
