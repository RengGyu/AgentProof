import { redactSecrets } from "./redact";
import {
  assertTenantDeletionNotActiveAsync,
  isTenantDeletionActive,
  isTenantDeletionActiveAsync
} from "./tenant-deletion-state";

export const TENANT_CONTROL_PLANE_GRANTS_ENV = "AGENTPROOF_TENANT_REPOSITORY_GRANTS";
export const DEFAULT_TENANT_REPOSITORY_GRANTS_TABLE = "agentproof_tenant_repository_grants";

export interface TenantControlPlaneSettings {
  enabled: boolean;
}

export interface TenantRepositoryGrant {
  tenantId: string;
  installationId: number;
  repositoryId?: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  commentEnabled: boolean;
  saveReportsEnabled: boolean;
}

export interface TenantRepositoryGrantDecision {
  enabled: boolean;
  required: boolean;
  grant?: TenantRepositoryGrant;
  reason?: "control-plane-disabled" | "grant-missing" | "grant-disabled" | "analysis-disabled" | "invalid-grants" | "tenant-deletion-active";
}

export interface TenantRepositoryGrantSettingsInput {
  tenantId?: unknown;
  installationId?: unknown;
  repositoryId?: unknown;
  enabled?: unknown;
  analysisEnabled?: unknown;
  commentEnabled?: unknown;
  saveReportsEnabled?: unknown;
}

export interface TenantRepositoryGrantDisableResult {
  updatedCount: number;
  grants: TenantRepositoryGrant[];
}

export interface TenantRepositoryGrantTenantDeletionDisableResult {
  privacy: "tenant-repository-grant-disable-metadata-only";
  matchedCount: number;
  disabledCount: number;
  store: "env" | "memory" | "supabase";
  durable: boolean;
  configured: boolean;
  manualReviewRequired?: boolean;
}

export interface TenantRepositoryGrantCount {
  count: number;
  store: "env" | "memory" | "supabase";
  durable: boolean;
  configured: boolean;
}

interface TenantRepositoryGrantInput {
  tenantId?: unknown;
  installationId?: unknown;
  repositoryId?: unknown;
  repositoryFullName?: unknown;
  enabled?: unknown;
  analysisEnabled?: unknown;
  commentEnabled?: unknown;
  saveReportsEnabled?: unknown;
}

interface TenantRepositoryGrantRow {
  tenant_id: string;
  installation_id: number;
  repository_id?: number | null;
  repository_full_name: string;
  enabled: boolean;
  analysis_enabled: boolean;
  comment_enabled: boolean;
  save_reports_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

interface TenantGrantStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

type GlobalWithTenantGrants = typeof globalThis & {
  __agentproofTenantRepositoryGrants?: Map<string, TenantRepositoryGrant>;
};

export class TenantControlPlaneStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantControlPlaneStoreError";
  }
}

export function getTenantControlPlaneSettings(env = process.env): TenantControlPlaneSettings {
  return {
    enabled: truthy(env.AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED)
  };
}

export function authorizeTenantRepositoryGrant(
  input: { installationId: number; repositoryFullName: string; repositoryId?: number },
  env = process.env
): TenantRepositoryGrantDecision {
  const settings = getTenantControlPlaneSettings(env);

  if (!settings.enabled) {
    return {
      enabled: false,
      required: false,
      reason: "control-plane-disabled"
    };
  }

  const grants = readTenantRepositoryGrants(env);
  if (!grants) {
    return {
      enabled: true,
      required: true,
      reason: "invalid-grants"
    };
  }

  const grant = grants.find((item) =>
    item.installationId === input.installationId &&
    sameRepositoryGrant(item, input)
  );

  if (!grant) {
    return {
      enabled: true,
      required: true,
      reason: "grant-missing"
    };
  }

  return decisionForGrant(grant, env);
}

export async function authorizeTenantRepositoryGrantAsync(
  input: { installationId: number; repositoryFullName: string; repositoryId?: number },
  env = process.env
): Promise<TenantRepositoryGrantDecision> {
  const envDecision = authorizeTenantRepositoryGrant(input, env);

  if (!envDecision.enabled || envDecision.grant || envDecision.reason === "invalid-grants") {
    if (envDecision.grant && await isTenantDeletionActiveAsync({ tenantId: envDecision.grant.tenantId }, env)) {
      return {
        enabled: true,
        required: true,
        grant: envDecision.grant,
        reason: "tenant-deletion-active"
      };
    }

    return envDecision;
  }

  const storedGrant = await findStoredTenantRepositoryGrant(input, env);
  if (!storedGrant) {
    return envDecision;
  }

  if (await isTenantDeletionActiveAsync({ tenantId: storedGrant.tenantId }, env)) {
    return {
      enabled: true,
      required: true,
      grant: storedGrant,
      reason: "tenant-deletion-active"
    };
  }

  return decisionForGrant(storedGrant, env);
}

export function readTenantRepositoryGrants(env = process.env): TenantRepositoryGrant[] | null {
  const raw = env[TENANT_CONTROL_PLANE_GRANTS_ENV];

  if (!raw?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const grants: TenantRepositoryGrant[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const grant = normalizeGrant(item as TenantRepositoryGrantInput);
    if (!grant) {
      return null;
    }

    grants.push(grant);
  }

  return grants.slice(0, 500);
}

export async function createTenantRepositoryGrant(
  input: TenantRepositoryGrantInput,
  env = process.env
): Promise<TenantRepositoryGrant> {
  const grant = normalizeGrant(input);

  if (!grant) {
    throw new TenantControlPlaneStoreError("Tenant repository grant is invalid.");
  }

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    if (!grant.repositoryId) {
      throw new TenantControlPlaneStoreError("Durable tenant repository grants require a GitHub repository id.");
    }
    await assertTenantDeletionNotActiveAsync({ tenantId: grant.tenantId }, env);
    await createSupabaseTenantRepositoryGrant(config, grant);
  } else if (truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    await assertTenantDeletionNotActiveAsync({ tenantId: grant.tenantId }, env);
    tenantGrantMemoryStore().set(tenantGrantKey(grant.installationId, grant.repositoryFullName, grant.repositoryId), grant);
  } else {
    throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
  }

  return grant;
}

export function clearTenantRepositoryGrantsForTests() {
  tenantGrantMemoryStore().clear();
}

export async function listTenantRepositoryGrants(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantRepositoryGrant[]> {
  const tenantId = normalizeId(input.tenantId);
  if (!tenantId) {
    throw new TenantControlPlaneStoreError("Tenant id is invalid.");
  }

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    return listSupabaseTenantRepositoryGrants(config, tenantId);
  }

  if (!truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
  }

  return Array.from(tenantGrantMemoryStore().values())
    .filter((grant) => grant.tenantId === tenantId)
    .sort(compareTenantRepositoryGrants)
    .slice(0, 500);
}

export async function countTenantRepositoryGrants(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantRepositoryGrantCount> {
  const tenantId = normalizeId(input.tenantId);
  if (!tenantId) {
    throw new TenantControlPlaneStoreError("Tenant id is invalid.");
  }

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    return {
      count: await countSupabaseTenantRepositoryGrants(config, tenantId),
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  if (truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    return {
      count: Array.from(tenantGrantMemoryStore().values()).filter((grant) => grant.tenantId === tenantId).length,
      store: "memory",
      durable: false,
      configured: true
    };
  }

  const envGrants = readTenantRepositoryGrants(env);
  if (envGrants) {
    return {
      count: envGrants.filter((grant) => grant.tenantId === tenantId).length,
      store: "env",
      durable: false,
      configured: true
    };
  }

  throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
}

export async function updateTenantRepositoryGrantSettings(
  input: TenantRepositoryGrantSettingsInput,
  env = process.env
): Promise<TenantRepositoryGrant> {
  const normalized = normalizeGrantSettingsUpdate(input);
  if (!normalized) {
    throw new TenantControlPlaneStoreError("Tenant repository grant settings are invalid.");
  }
  await assertTenantDeletionNotActiveAsync({ tenantId: normalized.tenantId }, env);

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    return updateSupabaseTenantRepositoryGrantSettings(config, normalized);
  }

  if (!truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
  }

  const existing = findMemoryTenantRepositoryGrant(normalized);
  if (!existing) {
    throw new TenantControlPlaneStoreError("Tenant repository grant was not found.");
  }

  const updated = {
    ...existing,
    ...normalized.settings
  };
  tenantGrantMemoryStore().set(tenantGrantKey(updated.installationId, updated.repositoryFullName, updated.repositoryId), updated);

  return updated;
}

export async function disableTenantRepositoryGrantsForInstallation(
  input: { installationId?: unknown },
  env = process.env
): Promise<TenantRepositoryGrantDisableResult> {
  const installationId = normalizeInstallationId(input.installationId);
  if (!installationId) {
    throw new TenantControlPlaneStoreError("GitHub App installation id is invalid.");
  }

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    return disableSupabaseTenantRepositoryGrants(config, { installationId });
  }

  if (!truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
  }

  return disableMemoryTenantRepositoryGrants({ installationId });
}

export async function disableTenantRepositoryGrantsForRepositories(
  input: { installationId?: unknown; repositoryIds?: unknown },
  env = process.env
): Promise<TenantRepositoryGrantDisableResult> {
  const installationId = normalizeInstallationId(input.installationId);
  const repositoryIds = normalizeRepositoryIdList(input.repositoryIds);
  if (!installationId || repositoryIds.length === 0) {
    throw new TenantControlPlaneStoreError("GitHub App repository grant disable input is invalid.");
  }

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    return disableSupabaseTenantRepositoryGrants(config, { installationId, repositoryIds });
  }

  if (!truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
  }

  return disableMemoryTenantRepositoryGrants({ installationId, repositoryIds });
}

export async function disableTenantRepositoryGrantsForTenantDeletion(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantRepositoryGrantTenantDeletionDisableResult> {
  const tenantId = normalizeId(input.tenantId);
  if (!tenantId) {
    throw new TenantControlPlaneStoreError("Tenant id is invalid.");
  }

  const config = getTenantGrantStoreConfig(env);
  if (config) {
    const matchedCount = await countSupabaseTenantRepositoryGrants(config, tenantId);
    await disableSupabaseTenantRepositoryGrantsForTenant(config, tenantId);

    return {
      privacy: "tenant-repository-grant-disable-metadata-only",
      matchedCount,
      disabledCount: matchedCount,
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  if (truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    const disabledCount = disableMemoryTenantRepositoryGrantsForTenant(tenantId);

    return {
      privacy: "tenant-repository-grant-disable-metadata-only",
      matchedCount: disabledCount,
      disabledCount,
      store: "memory",
      durable: false,
      configured: true
    };
  }

  const envGrants = readTenantRepositoryGrants(env);
  if (envGrants) {
    return {
      privacy: "tenant-repository-grant-disable-metadata-only",
      matchedCount: envGrants.filter((grant) => grant.tenantId === tenantId).length,
      disabledCount: 0,
      store: "env",
      durable: false,
      configured: true,
      manualReviewRequired: true
    };
  }

  throw new TenantControlPlaneStoreError("Tenant repository grant store is not configured.");
}

export function tenantGrantPublicReason(reason: TenantRepositoryGrantDecision["reason"]): string {
  if (reason === "grant-disabled") {
    return "Repository grant is disabled for this GitHub App installation.";
  }

  if (reason === "analysis-disabled") {
    return "Repository grant exists, but AgentProof analysis is disabled for this repository.";
  }

  if (reason === "tenant-deletion-active") {
    return "Repository grant is not active.";
  }

  if (reason === "invalid-grants") {
    return "Tenant repository grants are misconfigured.";
  }

  return "No active tenant repository grant matches this GitHub App installation and repository.";
}

function normalizeGrant(input: TenantRepositoryGrantInput): TenantRepositoryGrant | null {
  const tenantId = normalizeId(input.tenantId);
  const installationId = normalizeInstallationId(input.installationId);
  const repositoryId = normalizeOptionalRepositoryId(input.repositoryId);
  const repositoryFullName = normalizeRepositoryFullName(input.repositoryFullName);

  if (!tenantId || !installationId || !repositoryFullName) {
    return null;
  }

  return {
    tenantId,
    installationId,
    ...(repositoryId ? { repositoryId } : {}),
    repositoryFullName,
    enabled: input.enabled !== false,
    analysisEnabled: input.analysisEnabled !== false,
    commentEnabled: input.commentEnabled === true,
    saveReportsEnabled: input.saveReportsEnabled === true
  };
}

async function findStoredTenantRepositoryGrant(
  input: { installationId: number; repositoryFullName: string; repositoryId?: number },
  env = process.env
): Promise<TenantRepositoryGrant | undefined> {
  const config = getTenantGrantStoreConfig(env);

  if (config) {
    return findSupabaseTenantRepositoryGrant(config, input);
  }

  if (!truthy(env.AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY)) {
    return undefined;
  }

  return tenantGrantMemoryStore().get(tenantGrantKey(input.installationId, input.repositoryFullName, input.repositoryId));
}

async function createSupabaseTenantRepositoryGrant(config: TenantGrantStoreConfig, grant: TenantRepositoryGrant) {
  if (!grant.repositoryId) {
    throw new TenantControlPlaneStoreError("Durable tenant repository grants require a GitHub repository id.");
  }

  const now = new Date().toISOString();
  const response = await supabaseTenantGrantFetch(config, "?on_conflict=tenant_id,installation_id,repository_id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(toTenantRepositoryGrantRow(grant, now))
  });

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant store failed with HTTP ${response.status}.`);
  }
}

async function listSupabaseTenantRepositoryGrants(
  config: TenantGrantStoreConfig,
  tenantId: string
): Promise<TenantRepositoryGrant[]> {
  const response = await supabaseTenantGrantFetch(
    config,
    [
      `?tenant_id=eq.${encodeURIComponent(tenantId)}`,
      "select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled",
      "order=repository_full_name.asc",
      "limit=500"
    ].join("&"),
    { method: "GET" }
  );

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant list failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => rowToTenantRepositoryGrant(row))
    .filter((grant): grant is TenantRepositoryGrant => Boolean(grant))
    .slice(0, 500);
}

async function countSupabaseTenantRepositoryGrants(
  config: TenantGrantStoreConfig,
  tenantId: string
): Promise<number> {
  const response = await supabaseTenantGrantFetch(
    config,
    [
      `?tenant_id=eq.${encodeURIComponent(tenantId)}`,
      "select=tenant_id"
    ].join("&"),
    {
      method: "HEAD",
      headers: {
        Prefer: "count=exact",
        Range: "0-0"
      }
    }
  );

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant count failed with HTTP ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new TenantControlPlaneStoreError("Tenant repository grant count returned an invalid range.");
  }

  return count;
}

async function findSupabaseTenantRepositoryGrant(
  config: TenantGrantStoreConfig,
  input: { installationId: number; repositoryFullName: string; repositoryId?: number }
): Promise<TenantRepositoryGrant | undefined> {
  const response = await supabaseTenantGrantFetch(
    config,
    [
      `?installation_id=eq.${encodeURIComponent(String(input.installationId))}`,
      input.repositoryId
        ? `repository_id=eq.${encodeURIComponent(String(input.repositoryId))}`
        : `repository_full_name=eq.${encodeURIComponent(input.repositoryFullName)}`,
      "select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled",
      "limit=1"
    ].join("&"),
    { method: "GET" }
  );

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant lookup failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  if (!Array.isArray(rows)) return undefined;

  return rowToTenantRepositoryGrant(rows[0]);
}

async function updateSupabaseTenantRepositoryGrantSettings(
  config: TenantGrantStoreConfig,
  input: {
    tenantId: string;
    installationId: number;
    repositoryId: number;
    settings: Partial<Pick<TenantRepositoryGrant, "enabled" | "analysisEnabled" | "commentEnabled" | "saveReportsEnabled">>;
  }
): Promise<TenantRepositoryGrant> {
  const body = toTenantRepositoryGrantSettingsRow(input.settings);
  const response = await supabaseTenantGrantFetch(
    config,
    [
      `?tenant_id=eq.${encodeURIComponent(input.tenantId)}`,
      `installation_id=eq.${encodeURIComponent(String(input.installationId))}`,
      `repository_id=eq.${encodeURIComponent(String(input.repositoryId))}`,
      "select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled"
    ].join("&"),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        ...body,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant update failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  const updated = Array.isArray(rows) ? rowToTenantRepositoryGrant(rows[0]) : undefined;
  if (!updated) {
    throw new TenantControlPlaneStoreError("Tenant repository grant was not found.");
  }

  return updated;
}

async function disableSupabaseTenantRepositoryGrants(
  config: TenantGrantStoreConfig,
  input: { installationId: number; repositoryIds?: number[] }
): Promise<TenantRepositoryGrantDisableResult> {
  const filters = [
    `?installation_id=eq.${encodeURIComponent(String(input.installationId))}`,
    ...(input.repositoryIds?.length
      ? [`repository_id=in.(${input.repositoryIds.map((id) => encodeURIComponent(String(id))).join(",")})`]
      : []),
    "select=tenant_id,installation_id,repository_id,repository_full_name,enabled,analysis_enabled,comment_enabled,save_reports_enabled"
  ];
  const response = await supabaseTenantGrantFetch(config, filters.join("&"), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      enabled: false,
      analysis_enabled: false,
      comment_enabled: false,
      save_reports_enabled: false,
      updated_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant disable failed with HTTP ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as unknown;
  const grants = Array.isArray(rows)
    ? rows
      .map((row) => rowToTenantRepositoryGrant(row))
      .filter((grant): grant is TenantRepositoryGrant => Boolean(grant))
    : [];

  return {
    updatedCount: grants.length,
    grants
  };
}

async function disableSupabaseTenantRepositoryGrantsForTenant(
  config: TenantGrantStoreConfig,
  tenantId: string
): Promise<void> {
  const response = await supabaseTenantGrantFetch(
    config,
    `?tenant_id=eq.${encodeURIComponent(tenantId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        enabled: false,
        analysis_enabled: false,
        comment_enabled: false,
        save_reports_enabled: false,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    throw new TenantControlPlaneStoreError(`Tenant repository grant tenant disable failed with HTTP ${response.status}.`);
  }
}

async function supabaseTenantGrantFetch(config: TenantGrantStoreConfig, query: string, init: RequestInit) {
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

function getTenantGrantStoreConfig(env = process.env): TenantGrantStoreConfig | null {
  const url = env.AGENTPROOF_TENANT_GRANTS_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceRoleKey =
    env.AGENTPROOF_TENANT_GRANTS_SUPABASE_SERVICE_ROLE_KEY ||
    env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url && !serviceRoleKey) return null;

  if (!url || !serviceRoleKey) {
    throw new TenantControlPlaneStoreError("Tenant repository grant Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    table: env.AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE || DEFAULT_TENANT_REPOSITORY_GRANTS_TABLE
  };
}

function toTenantRepositoryGrantRow(grant: TenantRepositoryGrant, now: string): TenantRepositoryGrantRow {
  return {
    tenant_id: grant.tenantId,
    installation_id: grant.installationId,
    repository_id: grant.repositoryId ?? null,
    repository_full_name: grant.repositoryFullName,
    enabled: grant.enabled,
    analysis_enabled: grant.analysisEnabled,
    comment_enabled: grant.commentEnabled,
    save_reports_enabled: grant.saveReportsEnabled,
    created_at: now,
    updated_at: now
  };
}

function toTenantRepositoryGrantSettingsRow(
  settings: Partial<Pick<TenantRepositoryGrant, "enabled" | "analysisEnabled" | "commentEnabled" | "saveReportsEnabled">>
) {
  const row: Partial<TenantRepositoryGrantRow> = {};

  if (settings.enabled !== undefined) row.enabled = settings.enabled;
  if (settings.analysisEnabled !== undefined) row.analysis_enabled = settings.analysisEnabled;
  if (settings.commentEnabled !== undefined) row.comment_enabled = settings.commentEnabled;
  if (settings.saveReportsEnabled !== undefined) row.save_reports_enabled = settings.saveReportsEnabled;

  return row;
}

function rowToTenantRepositoryGrant(row: unknown): TenantRepositoryGrant | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const value = row as Partial<TenantRepositoryGrantRow>;

  return normalizeGrant({
    tenantId: value.tenant_id,
    installationId: value.installation_id,
    repositoryId: value.repository_id,
    repositoryFullName: value.repository_full_name,
    enabled: value.enabled,
    analysisEnabled: value.analysis_enabled,
    commentEnabled: value.comment_enabled,
    saveReportsEnabled: value.save_reports_enabled
  }) ?? undefined;
}

function normalizeGrantSettingsUpdate(input: TenantRepositoryGrantSettingsInput): {
  tenantId: string;
  installationId: number;
  repositoryId: number;
  settings: Partial<Pick<TenantRepositoryGrant, "enabled" | "analysisEnabled" | "commentEnabled" | "saveReportsEnabled">>;
} | null {
  const tenantId = normalizeId(input.tenantId);
  const installationId = normalizeInstallationId(input.installationId);
  const repositoryId = normalizeOptionalRepositoryId(input.repositoryId);
  const settings = {
    ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
    ...(typeof input.analysisEnabled === "boolean" ? { analysisEnabled: input.analysisEnabled } : {}),
    ...(typeof input.commentEnabled === "boolean" ? { commentEnabled: input.commentEnabled } : {}),
    ...(typeof input.saveReportsEnabled === "boolean" ? { saveReportsEnabled: input.saveReportsEnabled } : {})
  };

  if (!tenantId || !installationId || !repositoryId || Object.keys(settings).length === 0) {
    return null;
  }

  return {
    tenantId,
    installationId,
    repositoryId,
    settings
  };
}

function decisionForGrant(grant: TenantRepositoryGrant, env: NodeJS.ProcessEnv): TenantRepositoryGrantDecision {
  if (isTenantDeletionActive({ tenantId: grant.tenantId }, env)) {
    return {
      enabled: true,
      required: true,
      grant,
      reason: "tenant-deletion-active"
    };
  }

  if (!grant.enabled) {
    return {
      enabled: true,
      required: true,
      grant,
      reason: "grant-disabled"
    };
  }

  if (!grant.analysisEnabled) {
    return {
      enabled: true,
      required: true,
      grant,
      reason: "analysis-disabled"
    };
  }

  return {
    enabled: true,
    required: true,
    grant
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function normalizeInstallationId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeOptionalRepositoryId(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeRepositoryIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => normalizeOptionalRepositoryId(item))
    .filter((item): item is number => Boolean(item));

  return Array.from(new Set(ids)).slice(0, 500);
}

function countFromContentRange(value: string | null): number | null {
  if (!value) return null;
  const total = value.split("/").at(1);
  if (!total || total === "*") return null;
  const count = Number(total);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function normalizeRepositoryFullName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = redactSecrets(value).trim();

  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

function sameRepositoryGrant(
  grant: TenantRepositoryGrant,
  input: { repositoryFullName: string; repositoryId?: number }
): boolean {
  if (grant.repositoryId && input.repositoryId) {
    return grant.repositoryId === input.repositoryId;
  }

  return grant.repositoryFullName.toLowerCase() === input.repositoryFullName.toLowerCase();
}

function tenantGrantKey(installationId: number, repositoryFullName: string, repositoryId?: number): string {
  return repositoryId
    ? `${installationId}:repo-id:${repositoryId}`
    : `${installationId}:repo-name:${repositoryFullName.toLowerCase()}`;
}

function tenantGrantMemoryStore() {
  const globalStore = globalThis as GlobalWithTenantGrants;
  globalStore.__agentproofTenantRepositoryGrants ??= new Map<string, TenantRepositoryGrant>();

  return globalStore.__agentproofTenantRepositoryGrants;
}

function findMemoryTenantRepositoryGrant(input: { tenantId: string; installationId: number; repositoryId: number }) {
  return Array.from(tenantGrantMemoryStore().values()).find((grant) =>
    grant.tenantId === input.tenantId &&
    grant.installationId === input.installationId &&
    grant.repositoryId === input.repositoryId
  );
}

function disableMemoryTenantRepositoryGrants(input: { installationId: number; repositoryIds?: number[] }): TenantRepositoryGrantDisableResult {
  const repositoryIds = input.repositoryIds ? new Set(input.repositoryIds) : undefined;
  const updated: TenantRepositoryGrant[] = [];

  for (const grant of tenantGrantMemoryStore().values()) {
    if (grant.installationId !== input.installationId) continue;
    if (repositoryIds && (!grant.repositoryId || !repositoryIds.has(grant.repositoryId))) continue;

    const next = {
      ...grant,
      enabled: false,
      analysisEnabled: false,
      commentEnabled: false,
      saveReportsEnabled: false
    };
    tenantGrantMemoryStore().set(tenantGrantKey(next.installationId, next.repositoryFullName, next.repositoryId), next);
    updated.push(next);
  }

  return {
    updatedCount: updated.length,
    grants: updated.sort(compareTenantRepositoryGrants)
  };
}

function disableMemoryTenantRepositoryGrantsForTenant(tenantId: string): number {
  let disabledCount = 0;

  for (const grant of tenantGrantMemoryStore().values()) {
    if (grant.tenantId !== tenantId) continue;

    const next = {
      ...grant,
      enabled: false,
      analysisEnabled: false,
      commentEnabled: false,
      saveReportsEnabled: false
    };
    tenantGrantMemoryStore().set(tenantGrantKey(next.installationId, next.repositoryFullName, next.repositoryId), next);
    disabledCount += 1;
  }

  return disabledCount;
}

function compareTenantRepositoryGrants(left: TenantRepositoryGrant, right: TenantRepositoryGrant): number {
  const byName = left.repositoryFullName.localeCompare(right.repositoryFullName);
  if (byName !== 0) return byName;

  return (left.repositoryId ?? 0) - (right.repositoryId ?? 0);
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
