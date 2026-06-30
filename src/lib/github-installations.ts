export const DEFAULT_GITHUB_INSTALLATIONS_TABLE = "agentproof_github_installations";

export type GitHubInstallationStatus = "active" | "suspended" | "deleted";
export type GitHubInstallationStore = "none" | "memory" | "supabase";

export interface TenantGitHubInstallationInput {
  tenantId?: unknown;
  installationId?: unknown;
  accountId?: unknown;
  accountLogin?: unknown;
  accountType?: unknown;
  status?: GitHubInstallationStatus;
}

export interface TenantGitHubInstallationCount {
  count: number;
  store: GitHubInstallationStore;
  durable: boolean;
  configured: boolean;
  disabled?: boolean;
}

export interface GitHubInstallationMetadataStoreStatus {
  mode: "disabled" | "memory" | "supabase";
  configured: boolean;
  durable: boolean;
  table: string;
  missingEnv: string[];
}

interface GitHubInstallationRecord {
  tenantId: string;
  installationId: number;
  accountId?: number;
  accountLogin?: string;
  accountType?: string;
  status: GitHubInstallationStatus;
  createdAt: string;
  updatedAt: string;
  suspendedAt?: string;
  deletedAt?: string;
}

interface GitHubInstallationRow {
  tenant_id: string;
  installation_id: number;
  account_id?: number | null;
  account_login?: string | null;
  account_type?: string | null;
  status: GitHubInstallationStatus;
  created_at: string;
  updated_at: string;
  suspended_at?: string | null;
  deleted_at?: string | null;
}

interface GitHubInstallationTenantRow {
  tenant_id?: unknown;
}

interface GitHubInstallationStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

type GlobalWithGitHubInstallations = typeof globalThis & {
  __agentproofGitHubInstallations?: Map<string, GitHubInstallationRecord>;
};

export class GitHubInstallationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubInstallationStoreError";
  }
}

export async function upsertTenantGitHubInstallation(
  input: TenantGitHubInstallationInput,
  env = process.env,
  now = Date.now()
): Promise<TenantGitHubInstallationCount> {
  const record = normalizeInstallationRecord(input, now);
  if (!record) {
    throw new GitHubInstallationStoreError("GitHub installation metadata input is invalid.");
  }

  const config = getGitHubInstallationStoreConfig(env);
  if (config) {
    await assertSupabaseInstallationTenant(config, record);
    await upsertSupabaseGitHubInstallation(config, record);

    return {
      count: 1,
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  if (truthy(env.AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY)) {
    assertMemoryInstallationTenant(record);
    const existing = githubInstallationMemoryStore().get(installationKey(record.tenantId, record.installationId));
    githubInstallationMemoryStore().set(installationKey(record.tenantId, record.installationId), {
      ...existing,
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt
    });

    return {
      count: 1,
      store: "memory",
      durable: false,
      configured: true
    };
  }

  return {
    count: 0,
    store: "none",
    durable: false,
    configured: false,
    disabled: true
  };
}

export async function markTenantGitHubInstallationStatus(
  input: TenantGitHubInstallationInput,
  env = process.env,
  now = Date.now()
): Promise<TenantGitHubInstallationCount> {
  return upsertTenantGitHubInstallation(input, env, now);
}

export async function countTenantGitHubInstallations(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantGitHubInstallationCount> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new GitHubInstallationStoreError("Tenant id is invalid.");
  }

  const config = getGitHubInstallationStoreConfig(env);
  if (config) {
    return {
      count: await countSupabaseTenantGitHubInstallations(config, tenantId),
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  if (truthy(env.AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY)) {
    return {
      count: Array.from(githubInstallationMemoryStore().values()).filter((record) => record.tenantId === tenantId).length,
      store: "memory",
      durable: false,
      configured: true
    };
  }

  return {
    count: 0,
    store: "none",
    durable: false,
    configured: false,
    disabled: true
  };
}

export function clearTenantGitHubInstallationsForTests() {
  githubInstallationMemoryStore().clear();
}

export function getTenantGitHubInstallationsForTests() {
  return Array.from(githubInstallationMemoryStore().values()).map((record) => ({ ...record }));
}

export function getGitHubInstallationMetadataStoreStatus(env = process.env): GitHubInstallationMetadataStoreStatus {
  const read = readGitHubInstallationStoreEnv(env);

  if (read.url && read.serviceRoleKey) {
    return {
      mode: "supabase",
      configured: true,
      durable: true,
      table: read.table,
      missingEnv: []
    };
  }

  const missingEnv: string[] = [];
  if (read.url || read.serviceRoleKey) {
    if (!read.url) {
      missingEnv.push("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL or AGENTPROOF_CONTROL_PLANE_SUPABASE_URL or SUPABASE_URL");
    }

    if (!read.serviceRoleKey) {
      missingEnv.push(
        "AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY or AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY"
      );
    }
  }

  if (truthy(env.AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY)) {
    return {
      mode: "memory",
      configured: true,
      durable: false,
      table: read.table,
      missingEnv
    };
  }

  return {
    mode: "disabled",
    configured: false,
    durable: false,
    table: read.table,
    missingEnv
  };
}

function normalizeInstallationRecord(input: TenantGitHubInstallationInput, now: number): GitHubInstallationRecord | null {
  const tenantId = normalizeTenantId(input.tenantId);
  const installationId = normalizePositiveInteger(input.installationId);
  const status = input.status ?? "active";
  if (!tenantId || !installationId || !isGitHubInstallationStatus(status)) return null;

  const timestamp = new Date(now).toISOString();

  return {
    tenantId,
    installationId,
    accountId: normalizePositiveInteger(input.accountId) ?? undefined,
    accountLogin: normalizeAccountText(input.accountLogin) ?? undefined,
    accountType: normalizeAccountText(input.accountType) ?? undefined,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
    suspendedAt: status === "suspended" ? timestamp : undefined,
    deletedAt: status === "deleted" ? timestamp : undefined
  };
}

async function upsertSupabaseGitHubInstallation(
  config: GitHubInstallationStoreConfig,
  record: GitHubInstallationRecord
) {
  const response = await githubInstallationFetch(config, "?on_conflict=tenant_id,installation_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(toSupabaseGitHubInstallationRow(record))
  });

  if (!response.ok) {
    throw new GitHubInstallationStoreError(`GitHub installation metadata store failed with HTTP ${response.status}.`);
  }
}

async function assertSupabaseInstallationTenant(
  config: GitHubInstallationStoreConfig,
  record: GitHubInstallationRecord
) {
  const response = await githubInstallationFetch(
    config,
    [
      `?installation_id=eq.${encodeURIComponent(String(record.installationId))}`,
      "select=tenant_id",
      "limit=2"
    ].join("&"),
    { method: "GET" }
  );

  if (!response.ok) {
    throw new GitHubInstallationStoreError(`GitHub installation metadata tenant lookup failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(rows)) return;

  const conflictingTenant = rows.some((row) =>
    row && typeof row === "object" && !Array.isArray(row)
      ? normalizeTenantId((row as GitHubInstallationTenantRow).tenant_id) !== record.tenantId
      : false
  );

  if (conflictingTenant) {
    throw new GitHubInstallationStoreError("GitHub installation metadata is already assigned to another tenant.");
  }
}

async function countSupabaseTenantGitHubInstallations(
  config: GitHubInstallationStoreConfig,
  tenantId: string
): Promise<number> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    select: "tenant_id"
  });
  const response = await githubInstallationFetch(config, `?${params.toString()}`, {
    method: "HEAD",
    headers: {
      Prefer: "count=exact",
      Range: "0-0"
    }
  });

  if (!response.ok) {
    throw new GitHubInstallationStoreError(`GitHub installation metadata count failed with HTTP ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new GitHubInstallationStoreError("GitHub installation metadata count returned an invalid range.");
  }

  return count;
}

async function githubInstallationFetch(config: GitHubInstallationStoreConfig, query: string, init: RequestInit) {
  return fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}${query}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(init.headers ?? {})
    }
  });
}

function getGitHubInstallationStoreConfig(env = process.env): GitHubInstallationStoreConfig | null {
  const read = readGitHubInstallationStoreEnv(env);

  if (!read.url && !read.serviceRoleKey) return null;

  if (!read.url || !read.serviceRoleKey) {
    throw new GitHubInstallationStoreError("GitHub installation metadata Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(read.url),
    serviceRoleKey: read.serviceRoleKey,
    table: read.table
  };
}

function readGitHubInstallationStoreEnv(env = process.env) {
  return {
    url: env.AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "",
    serviceRoleKey:
      env.AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY ||
      env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
    table: env.AGENTPROOF_GITHUB_INSTALLATIONS_TABLE || DEFAULT_GITHUB_INSTALLATIONS_TABLE
  };
}

function toSupabaseGitHubInstallationRow(record: GitHubInstallationRecord): GitHubInstallationRow {
  return {
    tenant_id: record.tenantId,
    installation_id: record.installationId,
    account_id: record.accountId ?? null,
    account_login: record.accountLogin ?? null,
    account_type: record.accountType ?? null,
    status: record.status,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    suspended_at: record.suspendedAt ?? null,
    deleted_at: record.deletedAt ?? null
  };
}

function githubInstallationMemoryStore() {
  const globalStore = globalThis as GlobalWithGitHubInstallations;
  globalStore.__agentproofGitHubInstallations ??= new Map<string, GitHubInstallationRecord>();

  return globalStore.__agentproofGitHubInstallations;
}

function assertMemoryInstallationTenant(record: GitHubInstallationRecord) {
  for (const existing of githubInstallationMemoryStore().values()) {
    if (existing.installationId === record.installationId && existing.tenantId !== record.tenantId) {
      throw new GitHubInstallationStoreError("GitHub installation metadata is already assigned to another tenant.");
    }
  }
}

function installationKey(tenantId: string, installationId: number): string {
  return `${tenantId}:${installationId}`;
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(trimmed) ? trimmed : null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAccountText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_. -]{1,120}$/.test(trimmed) ? trimmed : null;
}

function isGitHubInstallationStatus(value: unknown): value is GitHubInstallationStatus {
  return value === "active" || value === "suspended" || value === "deleted";
}

function countFromContentRange(value: string | null): number | null {
  const match = value?.match(/\/(\d+)$/);
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
