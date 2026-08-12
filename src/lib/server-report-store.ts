import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSharedControlPlaneServiceRoleKey } from "./control-plane-supabase";
import {
  createUnverifiedAuthenticity,
  createVerifiedAuthenticity,
  requireReportSigningSecret,
  verifyVerifiedAuthenticity
} from "./report-authenticity";
import { sanitizeReportForShare } from "./report-share";
import { redactSecrets } from "./redact";
import { validateVerificationReport } from "./report-validation";
import {
  decodeTenantPersistedReport,
  isSafeTenantLocator,
  projectTenantPersistedReport,
  tenantObjectiveLabel,
  type TenantPersistedReport,
  validateTenantStoredReport
} from "./tenant-report-validation";
import { tenantGapText, tenantRemediationText, tenantReportAnalysisContext } from "./tenant-report-language";
import type { RequirementProofAxis, VerificationReport } from "./types";

export const SERVER_REPORT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_SERVER_REPORTS = 100;
export const TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT = 100;
export const SAVED_REPORT_DURABILITY = "short-lived-in-memory";
export const SAVED_REPORT_DURABILITY_WARNING =
  "Saved reports are summary-only, short-lived, and stored in memory; they may expire or disappear after a serverless instance change.";
export const DEFAULT_SUPABASE_REPORTS_TABLE = "agentproof_saved_reports";

const SUPABASE_DURABILITY = "summary-only-supabase";
const SUPABASE_DURABILITY_WARNING =
  "Saved reports are summary-only and short-lived by TTL. Durable Supabase storage is configured; raw evidence, claims, and re-prompt text are omitted.";
const PARTIAL_SUPABASE_WARNING =
  "Supabase saved-report env is incomplete; using short-lived in-memory storage until both URL and service-role key are configured.";

export interface StoredServerReport {
  id: string;
  createdAt: string;
  expiresAt: string;
  report: VerificationReport;
  tenantId?: string;
  accessToken?: string;
  accessTokenHash?: string;
  installationId?: number;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  staleAt?: string;
  /** Invalid tenant payloads keep only this metadata-only state. */
  availability?: "available" | "unavailable";
}

export interface SavedReportAccessContext {
  tenantId?: string;
  accessToken?: string;
}

export interface CreateSavedReportOptions {
  ttlMs?: number;
  tenantId?: string;
  installationId?: number;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
}

interface NormalizedCreateSavedReportOptions {
  ttlMs: number;
  tenantId?: string;
  installationId?: number;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
}

export interface SavedReportStoreStatus {
  mode: "memory" | "supabase";
  configured: boolean;
  durable: boolean;
  durability: string;
  durabilityWarning: string;
  table: string;
  missingEnv: string[];
}

export interface TenantSavedReportSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  repositoryId?: number;
  pullRequestNumber?: number;
  headSha?: string;
  sourceTitle: string;
  sourceUrl?: string;
  priority: VerificationReport["summary"]["priority"];
  evidenceCoverage: number;
  requirementCounts: Record<VerificationReport["requirements"][number]["status"], number>;
  testing: {
    ciStatus: VerificationReport["testing"]["ciStatus"];
    lintStatus: VerificationReport["testing"]["lintStatus"];
    typecheckStatus: VerificationReport["testing"]["typecheckStatus"];
    missingTestCount: number;
  };
  reviewPriorityCount: number;
  scopeCreepSuspected: boolean;
  staleAt?: string;
  availability?: "available" | "unavailable";
  privacy: "summary-only";
}

export type TenantSavedReportPriorityFilter = "all" | VerificationReport["summary"]["priority"];
export type TenantSavedReportStatusFilter = "all" | "missing_tests" | "scope_creep" | "weak_evidence";

export interface TenantSavedReportFilters {
  priority: TenantSavedReportPriorityFilter;
  status: TenantSavedReportStatusFilter;
  query?: string;
}

export interface TenantSavedReportCount {
  count: number;
  store: "memory" | "supabase";
  durable: boolean;
  configured: boolean;
}

export interface SavedReportCleanupResult {
  privacy: "saved-report-cleanup-metadata-only";
  deletedCount: number;
  countBasis: "exact-memory-delete-count" | "pre-delete-supabase-count";
  store: "memory" | "supabase";
  durable: boolean;
  configured: boolean;
}

export interface TenantSavedReportPurgeResult {
  privacy: "saved-report-tenant-purge-metadata-only";
  deletedCount: number;
  countBasis: "exact-memory-delete-count" | "pre-delete-supabase-count";
}

type GlobalWithReportStore = typeof globalThis & {
  __agentproofReportStore?: Map<string, StoredServerReport>;
};

interface SupabaseReportStoreConfig {
  url: string;
  serviceRoleKey: string;
  table: string;
}

interface SupabaseReportRow {
  id: string;
  created_at: string;
  expires_at: string;
  report: VerificationReport | TenantPersistedReport;
  tenant_id?: string | null;
  access_token_hash?: string | null;
  installation_id?: number | null;
  repository_id?: number | null;
  pull_request_number?: number | null;
  head_sha?: string | null;
  stale_at?: string | null;
}

export class SavedReportStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedReportStoreError";
  }
}

export async function createSavedReport(
  report: VerificationReport,
  optionsOrTtlMs: CreateSavedReportOptions | number = SERVER_REPORT_TTL_MS
): Promise<StoredServerReport> {
  const config = getSupabaseReportStoreConfig();
  const options = normalizeCreateOptions(optionsOrTtlMs);

  if (config) return createSupabaseSavedReport(config, report, options, "imported_unverified");

  return createMemorySavedReport(report, options, "imported_unverified");
}

/**
 * Reserved for server-side evidence collection after it has generated and
 * validated the deterministic report. Browser/API supplied reports must use
 * createSavedReport and are always labelled imported/unverified.
 */
export async function createVerifiedSavedReport(
  report: VerificationReport,
  optionsOrTtlMs: CreateSavedReportOptions | number = SERVER_REPORT_TTL_MS
): Promise<StoredServerReport> {
  const config = getSupabaseReportStoreConfig();
  const options = normalizeCreateOptions(optionsOrTtlMs);
  requireReportSigningSecret();

  if (config) return createSupabaseSavedReport(config, report, options, "verified_agentproof");

  return createMemorySavedReport(report, options, "verified_agentproof");
}

export async function getSavedReport(
  id: string,
  access: SavedReportAccessContext = {}
): Promise<StoredServerReport | null> {
  const config = getSupabaseReportStoreConfig();

  if (config) {
    return getSupabaseSavedReport(config, id, access);
  }

  return getMemorySavedReport(id, access);
}

export async function listTenantSavedReports(
  input: { tenantId?: unknown; limit?: number }
): Promise<TenantSavedReportSummary[]> {
  const tenantId = typeof input.tenantId === "string" ? normalizeTenantId(input.tenantId) : undefined;
  if (!tenantId) {
    throw new SavedReportStoreError("Saved report tenant id is invalid.");
  }

  const limit = normalizeSavedReportListLimit(input.limit);
  const config = getSupabaseReportStoreConfig();
  const rows = config
    ? await listSupabaseTenantSavedReports(config, tenantId, limit)
    : listMemoryTenantSavedReports(tenantId, limit);

  return rows
    .map(toTenantSavedReportSummary)
    .filter((summary): summary is TenantSavedReportSummary => Boolean(summary));
}

export async function listTenantSavedReportDetails(input: {
  tenantId?: unknown;
  repositoryId?: unknown;
  currentOnly?: boolean;
  limit?: number;
}): Promise<StoredServerReport[]> {
  const tenantId = typeof input.tenantId === "string" ? normalizeTenantId(input.tenantId) : undefined;
  const repositoryId = typeof input.repositoryId === "number" && Number.isSafeInteger(input.repositoryId) && input.repositoryId > 0
    ? input.repositoryId
    : undefined;
  if (!tenantId) throw new SavedReportStoreError("Saved report tenant id is invalid.");
  if (!repositoryId) throw new SavedReportStoreError("Saved report repository id is invalid.");

  const limit = normalizeSavedReportListLimit(input.limit);
  const config = getSupabaseReportStoreConfig();
  return config
    ? listSupabaseTenantSavedReports(config, tenantId, limit, { repositoryId, currentOnly: input.currentOnly === true })
    : listMemoryTenantSavedReports(tenantId, limit, { repositoryId, currentOnly: input.currentOnly === true });
}

export function normalizeTenantSavedReportFilters(input: {
  priority?: unknown;
  status?: unknown;
  query?: unknown;
}): TenantSavedReportFilters {
  const priority = typeof input.priority === "string" && isTenantSavedReportPriorityFilter(input.priority)
    ? input.priority
    : "all";
  const status = typeof input.status === "string" && isTenantSavedReportStatusFilter(input.status)
    ? input.status
    : "all";
  const query = normalizeSavedReportQuery(input.query);

  return {
    priority,
    status,
    ...(query ? { query } : {})
  };
}

export function filterTenantSavedReportSummaries(
  reports: TenantSavedReportSummary[],
  filters: TenantSavedReportFilters
): TenantSavedReportSummary[] {
  const query = filters.query?.toLowerCase();

  return reports.filter((report) => {
    if (filters.priority !== "all" && report.priority !== filters.priority) return false;
    if (filters.status === "missing_tests" && report.testing.missingTestCount <= 0) return false;
    if (filters.status === "scope_creep" && !report.scopeCreepSuspected) return false;
    if (filters.status === "weak_evidence" && report.evidenceCoverage >= 70) return false;
    if (query && !tenantSavedReportMatchesQuery(report, query)) return false;

    return true;
  });
}

export async function countTenantSavedReports(
  input: { tenantId?: unknown }
): Promise<TenantSavedReportCount> {
  const tenantId = typeof input.tenantId === "string" ? normalizeTenantId(input.tenantId) : undefined;
  if (!tenantId) {
    throw new SavedReportStoreError("Saved report tenant id is invalid.");
  }

  const config = getSupabaseReportStoreConfig();
  if (config) {
    return {
      count: await countSupabaseTenantSavedReports(config, tenantId),
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  return {
    count: countMemoryTenantSavedReports(tenantId),
    store: "memory",
    durable: false,
    configured: true
  };
}

export async function deleteSavedReport(
  id: string,
  access: SavedReportAccessContext = {}
): Promise<boolean> {
  const config = getSupabaseReportStoreConfig();

  if (config) {
    return deleteSupabaseSavedReport(config, id, access);
  }

  const saved = getMemorySavedReport(id, access);
  if (!saved) return false;

  return reportStore().delete(id);
}

export function getSavedReportStoreStatus(): SavedReportStoreStatus {
  const env = readSupabaseReportStoreEnv();
  const table = env.table;

  if (env.url && env.serviceRoleKey) {
    return {
      mode: "supabase",
      configured: true,
      durable: true,
      durability: SUPABASE_DURABILITY,
      durabilityWarning: SUPABASE_DURABILITY_WARNING,
      table,
      missingEnv: []
    };
  }

  const missingEnv: string[] = [];
  if (env.url || env.serviceRoleKey) {
    if (!env.url) missingEnv.push("AGENTPROOF_REPORTS_SUPABASE_URL or SUPABASE_URL");
    if (!env.serviceRoleKey) {
      missingEnv.push("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
    }
  }

  return {
    mode: "memory",
    configured: false,
    durable: false,
    durability: SAVED_REPORT_DURABILITY,
    durabilityWarning: missingEnv.length > 0 ? PARTIAL_SUPABASE_WARNING : SAVED_REPORT_DURABILITY_WARNING,
    table,
    missingEnv
  };
}

export function cleanupExpiredReports(now = Date.now()): number {
  let deleted = 0;

  for (const [id, saved] of reportStore()) {
    if (Date.parse(saved.expiresAt) <= now) {
      reportStore().delete(id);
      deleted += 1;
    }
  }

  return deleted;
}

export async function cleanupExpiredSavedReports(now = Date.now()): Promise<SavedReportCleanupResult> {
  const config = getSupabaseReportStoreConfig();

  if (config) {
    return {
      privacy: "saved-report-cleanup-metadata-only",
      deletedCount: await cleanupExpiredSupabaseSavedReports(config, new Date(now).toISOString()),
      countBasis: "pre-delete-supabase-count",
      store: "supabase",
      durable: true,
      configured: true
    };
  }

  return {
    privacy: "saved-report-cleanup-metadata-only",
    deletedCount: cleanupExpiredReports(now),
    countBasis: "exact-memory-delete-count",
    store: "memory",
    durable: false,
    configured: getSavedReportStoreStatus().configured
  };
}

export async function purgeTenantSavedReportsForDeletion(
  input: { tenantId?: unknown }
): Promise<TenantSavedReportPurgeResult> {
  const tenantId = typeof input.tenantId === "string" ? normalizeTenantId(input.tenantId) : undefined;
  if (!tenantId) {
    throw new SavedReportStoreError("Saved report tenant id is invalid.");
  }

  const config = getSupabaseReportStoreConfig();
  if (config) {
    return {
      privacy: "saved-report-tenant-purge-metadata-only",
      deletedCount: await purgeSupabaseTenantSavedReports(config, tenantId),
      countBasis: "pre-delete-supabase-count"
    };
  }

  return {
    privacy: "saved-report-tenant-purge-metadata-only",
    deletedCount: purgeMemoryTenantSavedReports(tenantId),
    countBasis: "exact-memory-delete-count"
  };
}

export function clearSavedReportsForTests() {
  reportStore().clear();
}

function createMemorySavedReport(
  report: VerificationReport,
  options: NormalizedCreateSavedReportOptions,
  trust: "verified_agentproof" | "imported_unverified"
): StoredServerReport {
  cleanupExpiredReports();

  const createdAtDate = new Date();
  const access = createTenantAccess(options.tenantId, trust === "verified_agentproof");
  const existingSameHeadId = findCurrentMemoryReportId(options);
  const saved: StoredServerReport = {
    id: existingSameHeadId ?? createSavedReportId(options.tenantId),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + options.ttlMs).toISOString(),
    report: options.tenantId && trust === "verified_agentproof" ? prepareTenantDetailReportForStorage(report, trust) : prepareSummaryReportForStorage(report, trust),
    ...(options.installationId ? { installationId: options.installationId } : {}),
    ...(options.repositoryId ? { repositoryId: options.repositoryId } : {}),
    ...(options.pullRequestNumber ? { pullRequestNumber: options.pullRequestNumber } : {}),
    ...(options.headSha ? { headSha: options.headSha } : {}),
    ...access
  };

  markPriorMemoryReportsStale(saved);
  reportStore().set(saved.id, withoutTransientAccessToken(saved));
  trimReportStore();
  return saved;
}

function findCurrentMemoryReportId(options: NormalizedCreateSavedReportOptions): string | undefined {
  if (!options.tenantId || !options.repositoryId || !options.pullRequestNumber || !options.headSha) return undefined;

  for (const [id, existing] of reportStore()) {
    if (
      existing.tenantId === options.tenantId &&
      existing.repositoryId === options.repositoryId &&
      existing.pullRequestNumber === options.pullRequestNumber &&
      existing.headSha === options.headSha &&
      !existing.staleAt
    ) return id;
  }

  return undefined;
}

function getMemorySavedReport(id: string, access: SavedReportAccessContext): StoredServerReport | null {
  const saved = reportStore().get(id);

  if (!saved) return null;
  if (Date.parse(saved.expiresAt) <= Date.now()) {
    reportStore().delete(id);
    return null;
  }

  if (!canAccessSavedReport(saved, access)) return null;

  return sanitizeStoredReport(saved);
}

function listMemoryTenantSavedReports(
  tenantId: string,
  limit: number,
  filters: { repositoryId?: number; currentOnly?: boolean } = {}
): StoredServerReport[] {
  cleanupExpiredReports();

  return [...reportStore().values()]
    .filter((saved) => saved.tenantId === tenantId)
    .filter((saved) => filters.repositoryId === undefined || saved.repositoryId === filters.repositoryId)
    .filter((saved) => filters.currentOnly !== true || !saved.staleAt)
    .map(sanitizeStoredReport)
    .filter((saved): saved is StoredServerReport => Boolean(saved))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

function countMemoryTenantSavedReports(tenantId: string): number {
  return [...reportStore().values()].filter((saved) => saved.tenantId === tenantId).length;
}

function purgeMemoryTenantSavedReports(tenantId: string): number {
  let deletedCount = 0;

  for (const [id, saved] of reportStore()) {
    if (saved.tenantId !== tenantId) continue;
    reportStore().delete(id);
    deletedCount += 1;
  }

  return deletedCount;
}

async function createSupabaseSavedReport(
  config: SupabaseReportStoreConfig,
  report: VerificationReport,
  options: NormalizedCreateSavedReportOptions,
  trust: "verified_agentproof" | "imported_unverified"
): Promise<StoredServerReport> {
  const createdAtDate = new Date();
  const access = createTenantAccess(options.tenantId, trust === "verified_agentproof");
  const saved: StoredServerReport = {
    id: createSavedReportId(options.tenantId),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + options.ttlMs).toISOString(),
    report: options.tenantId && trust === "verified_agentproof" ? prepareTenantDetailReportForStorage(report, trust) : prepareSummaryReportForStorage(report, trust),
    ...(options.installationId ? { installationId: options.installationId } : {}),
    ...(options.repositoryId ? { repositoryId: options.repositoryId } : {}),
    ...(options.pullRequestNumber ? { pullRequestNumber: options.pullRequestNumber } : {}),
    ...(options.headSha ? { headSha: options.headSha } : {}),
    ...access
  };

  const usesAtomicTenantStore = Boolean(
    trust === "verified_agentproof" &&
    saved.tenantId &&
    saved.installationId &&
    saved.repositoryId &&
    saved.pullRequestNumber &&
    saved.headSha
  );
  if (usesAtomicTenantStore && config.table !== DEFAULT_SUPABASE_REPORTS_TABLE) {
    throw new SavedReportStoreError(
      `Verified tenant report storage requires ${DEFAULT_SUPABASE_REPORTS_TABLE} and its atomic STALE migration.`
    );
  }
  const response = usesAtomicTenantStore
    ? await supabaseRpcFetch(config, "agentproof_store_tenant_report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSupabaseTenantReportRpc(saved))
      })
    : await supabaseFetch(config, "", {
        method: "POST",
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(toSupabaseRow(saved))
      });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report storage failed with status ${response.status}.`);
  }

  const stored = rowToStoredReport((await parseSupabaseArray(response))[0]);

  return stored
    ? {
        ...stored,
        tenantId: saved.tenantId,
        accessToken: saved.accessToken,
        accessTokenHash: saved.accessTokenHash
      }
    : saved;
}

async function getSupabaseSavedReport(
  config: SupabaseReportStoreConfig,
  id: string,
  access: SavedReportAccessContext
): Promise<StoredServerReport | null> {
  if (!isSafeReportId(id)) return null;
  if (!hasSavedReportAccessContext(access) && isTenantScopedReportId(id)) return null;

  const query = buildSupabaseReportAccessQuery(id, access);
  const response = await supabaseFetch(config, query, {
    method: "GET"
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report lookup failed with status ${response.status}.`);
  }

  const saved = rowToStoredReport((await parseSupabaseArray(response))[0]);

  if (!saved) return null;
  if (Date.parse(saved.expiresAt) <= Date.now()) {
    await deleteSupabaseSavedReportRow(config, id, access);
    return null;
  }

  return canAccessSavedReport(saved, access) ? saved : null;
}

async function listSupabaseTenantSavedReports(
  config: SupabaseReportStoreConfig,
  tenantId: string,
  limit: number,
  filters: { repositoryId?: number; currentOnly?: boolean } = {}
): Promise<StoredServerReport[]> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    expires_at: `gt.${new Date().toISOString()}`,
    select: "id,created_at,expires_at,report,tenant_id,installation_id,repository_id,pull_request_number,head_sha,stale_at",
    order: "created_at.desc",
    limit: String(limit)
  });
  if (filters.repositoryId !== undefined) params.set("repository_id", `eq.${filters.repositoryId}`);
  if (filters.currentOnly === true) params.set("stale_at", "is.null");
  const response = await supabaseFetch(config, `?${params.toString()}`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report list failed with status ${response.status}.`);
  }

  return (await parseSupabaseArray(response))
    .map(rowToStoredReport)
    .filter((row): row is StoredServerReport => Boolean(row && row.tenantId === tenantId))
    .filter((row) => filters.repositoryId === undefined || row.repositoryId === filters.repositoryId)
    .filter((row) => filters.currentOnly !== true || !row.staleAt);
}

async function countSupabaseTenantSavedReports(
  config: SupabaseReportStoreConfig,
  tenantId: string
): Promise<number> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    select: "id"
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "HEAD",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Prefer: "count=exact",
      Range: "0-0"
    }
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report count failed with status ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new SavedReportStoreError("Saved report count returned an invalid range.");
  }

  return count;
}

async function cleanupExpiredSupabaseSavedReports(
  config: SupabaseReportStoreConfig,
  expiresBefore: string
): Promise<number> {
  const deletedCount = await countExpiredSupabaseSavedReports(config, expiresBefore);
  const params = new URLSearchParams({
    expires_at: `lte.${expiresBefore}`
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "DELETE",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Expired saved report cleanup failed with status ${response.status}.`);
  }

  return deletedCount;
}

async function purgeSupabaseTenantSavedReports(
  config: SupabaseReportStoreConfig,
  tenantId: string
): Promise<number> {
  const deletedCount = await countSupabaseTenantSavedReports(config, tenantId);
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "DELETE",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Prefer: "return=minimal"
    }
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Tenant saved report purge failed with status ${response.status}.`);
  }

  return deletedCount;
}

async function countExpiredSupabaseSavedReports(
  config: SupabaseReportStoreConfig,
  expiresBefore: string
): Promise<number> {
  const params = new URLSearchParams({
    expires_at: `lte.${expiresBefore}`,
    select: "id"
  });
  const response = await fetch(`${config.url}/rest/v1/${encodeURIComponent(config.table)}?${params.toString()}`, {
    method: "HEAD",
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      Prefer: "count=exact",
      Range: "0-0"
    }
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Expired saved report count failed with status ${response.status}.`);
  }

  const count = countFromContentRange(response.headers.get("content-range"));
  if (count === null) {
    throw new SavedReportStoreError("Expired saved report count returned an invalid range.");
  }

  return count;
}

async function deleteSupabaseSavedReport(
  config: SupabaseReportStoreConfig,
  id: string,
  access: SavedReportAccessContext
): Promise<boolean> {
  if (!isSafeReportId(id)) return false;
  if (!hasSavedReportAccessContext(access) && isTenantScopedReportId(id)) return false;

  const existing = await getSupabaseSavedReport(config, id, access);
  if (!existing) return false;

  return deleteSupabaseSavedReportRow(config, id, access);
}

async function deleteSupabaseSavedReportRow(
  config: SupabaseReportStoreConfig,
  id: string,
  access: SavedReportAccessContext
): Promise<boolean> {
  const response = await supabaseFetch(config, buildSupabaseReportDeleteQuery(id, access), {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report delete failed with status ${response.status}.`);
  }

  return true;
}

function prepareSummaryReportForStorage(
  report: VerificationReport,
  trust: "verified_agentproof" | "imported_unverified"
): VerificationReport {
  const safeReport = sanitizeReportForShare(report);
  safeReport.authenticity = trust === "verified_agentproof"
    ? createVerifiedAuthenticity(safeReport, requireReportSigningSecret())
    : createUnverifiedAuthenticity("imported_unverified");
  const validation = validateVerificationReport(safeReport, { mode: "summary" });

  if (!validation.valid) {
    throw new SavedReportStoreError(`Summary-only saved report failed validation: ${validation.errors.join("; ")}`);
  }

  return safeReport;
}

/**
 * Tenant reports retain verification structure, evidence ids, safe file or
 * check locations, and a validated one-line objective label. This is the
 * durable privacy boundary for private repositories: no diff, log, token,
 * raw GitHub response, PR/Issue body, or unbounded generated prose is written
 * to the saved-report row.
 */
function prepareTenantDetailReportForStorage(report: VerificationReport, trust: "verified_agentproof" | "imported_unverified"): VerificationReport {
  const analysisContext = tenantReportAnalysisContext(report);
  const proofNodesByRequirement = new Map(report.proofGraph.nodes.map((node) => [node.requirementId, node]));
  const objectiveLabels = new Map(report.requirements.map((item) => [item.requirementId, tenantObjectiveLabel(item.requirementText)]));
  const allGapKinds = report.proofGraph.nodes.flatMap((node) => node.gapSignals.map((gap) => gap.kind));
  const safe: VerificationReport = {
    analysisId: report.analysisId,
    createdAt: report.createdAt,
    analysisContext,
    source: {
      title: "GitHub pull request evidence report",
      ...(report.source.provenance ? { provenance: report.source.provenance } : {})
    },
    summary: {
      oneLine: "Grounded verification result; review structured evidence.",
      confidence: report.summary.confidence,
      priority: report.summary.priority,
      evidenceCoverage: report.summary.evidenceCoverage,
      topRisks: report.summary.topRisks.map(() => "Verification evidence requires reviewer attention.").slice(0, 5)
    },
    requirements: report.requirements.map((item) => {
      const proofGaps = proofNodesByRequirement.get(item.requirementId)?.gapSignals ?? [];
      const gapKinds = proofGaps.map((gap) => gap.kind);
      const gaps = uniqueStrings(gapKinds.map(tenantGapText));
      return {
        requirementId: item.requirementId,
        requirementText: objectiveLabels.get(item.requirementId) ?? `Requirement ${item.requirementId}`,
        status: item.status,
        evidenceRefs: item.evidenceRefs,
        gaps: gaps.slice(0, 10),
        reviewerNote: "Review the linked evidence and safe locations.",
        confidence: item.confidence,
        ...(item.proofAxes ? { proofAxes: copyProofAxes(item.proofAxes) } : {}),
        ...(item.classificationBasis ? { classificationBasis: item.classificationBasis } : {}),
        ...(item.plannerAxisSubjects ? { plannerAxisSubjects: [...item.plannerAxisSubjects] } : {})
      };
    }),
    claims: [],
    scope: {
      suspected: report.scope.suspected,
      outOfScopeFiles: report.scope.outOfScopeFiles.map(safeLocator).filter((value): value is string => Boolean(value)).slice(0, 50),
      reasons: report.scope.reasons.map(() => "Scope evidence requires reviewer confirmation.").slice(0, 10),
      ...(report.scope.evidenceRefs ? { evidenceRefs: report.scope.evidenceRefs } : {})
    },
    testing: {
      ciStatus: report.testing.ciStatus,
      lintStatus: report.testing.lintStatus,
      typecheckStatus: report.testing.typecheckStatus,
      missingTests: report.testing.missingTests.map((item) => ({ path: safeLocator(item.path) ?? "unavailable", why: "Targeted test evidence is missing.", evidenceRefs: item.evidenceRefs }))
    },
    reviewPriority: report.reviewPriority.map((item) => ({ path: safeLocator(item.path) ?? "unavailable", reason: "Review priority based on grounded evidence.", priority: item.priority, ...(item.evidenceRefs ? { evidenceRefs: item.evidenceRefs } : {}) })),
    proofGraph: {
      version: 1,
      nodes: report.proofGraph.nodes.map((node) => ({
        requirementId: node.requirementId,
        requirementText: objectiveLabels.get(node.requirementId) ?? `Requirement ${node.requirementId}`,
        sourceRole: node.sourceRole,
        sourceQuality: node.sourceQuality,
        sourceSection: null,
        contextRoles: [],
        status: node.status,
        confidence: node.confidence,
        implementationEvidenceRefs: node.implementationEvidenceRefs,
        targetedTestEvidenceRefs: node.targetedTestEvidenceRefs,
        executionEvidenceRefs: node.executionEvidenceRefs,
        gapSignals: node.gapSignals.map((gap) => ({ kind: gap.kind, severity: gap.severity, message: tenantGapText(gap.kind), evidenceRefs: gap.evidenceRefs })),
        firstFiles: node.firstFiles.map(safeLocator).filter((value): value is string => Boolean(value)).slice(0, 20),
        ...(node.classificationBasis ? { classificationBasis: node.classificationBasis } : {})
      })),
      context: [],
      summary: report.proofGraph.summary
    },
    reprompt: { targetAgent: report.reprompt.targetAgent, prompt: tenantRemediationText(allGapKinds) },
    evidenceIndex: report.evidenceIndex.map((item) => {
      const locator = safeLocator(item.locator);
      return { id: item.id, kind: item.kind, label: `Evidence ${item.id}`, summary: "Bounded evidence metadata.", ...(locator ? { locator } : {}), confidence: item.confidence };
    }),
    limitations: report.limitations.map(() => "Some evidence was unavailable or intentionally omitted for privacy.").slice(0, 20),
    ...(report.planner ? { planner: copyPlannerProvenance(report.planner) } : {}),
    ...(report.semantic ? { semantic: report.semantic } : {}),
    ...(report.semanticAnalysis ? { semanticAnalysis: report.semanticAnalysis } : {})
  };
  safe.authenticity = trust === "verified_agentproof" ? createVerifiedAuthenticity(safe, requireReportSigningSecret()) : createUnverifiedAuthenticity("imported_unverified");
  const validation = validateTenantStoredReport(safe, requireReportSigningSecret());
  if (!validation.valid) {
    throw new SavedReportStoreError(`Tenant saved report failed validation: ${validation.errors.join("; ")}`);
  }
  return safe;
}

function copyPlannerProvenance(planner: NonNullable<VerificationReport["planner"]>): NonNullable<VerificationReport["planner"]> {
  return {
    version: planner.version,
    contractVersion: planner.contractVersion,
    schemaVersion: planner.schemaVersion,
    promptVersion: planner.promptVersion,
    model: planner.model,
    inputHash: planner.inputHash
  };
}

function safeLocator(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = redactSecrets(value).trim();
  return normalized && isSafeTenantLocator(normalized) ? normalized : null;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sanitizeSummaryReport(report: VerificationReport): VerificationReport {
  const safeReport = sanitizeReportForShare(report);
  const authenticity = report.authenticity;
  safeReport.authenticity = authenticity?.trust === "verified_agentproof"
    ? authenticity
    : authenticity?.trust === "legacy_unverified"
      ? createUnverifiedAuthenticity("legacy_unverified")
      : authenticity?.trust === "portable_unverified"
        ? createUnverifiedAuthenticity("portable_unverified")
        : createUnverifiedAuthenticity("imported_unverified");
  const validation = validateVerificationReport(safeReport, { mode: "summary" });

  if (!validation.valid) {
    throw new SavedReportStoreError(`Summary-only saved report failed validation: ${validation.errors.join("; ")}`);
  }

  return safeReport;
}

function toTenantSavedReportSummary(saved: StoredServerReport): TenantSavedReportSummary | null {
  if (saved.availability === "unavailable") {
    return {
      id: saved.id,
      createdAt: saved.createdAt,
      expiresAt: saved.expiresAt,
      ...(saved.repositoryId ? { repositoryId: saved.repositoryId } : {}),
      ...(saved.pullRequestNumber ? { pullRequestNumber: saved.pullRequestNumber } : {}),
      ...(saved.headSha ? { headSha: saved.headSha } : {}),
      sourceTitle: "Saved report unavailable",
      priority: "low",
      evidenceCoverage: 0,
      requirementCounts: { met: 0, partial: 0, missing: 0, unclear: 0 },
      testing: { ciStatus: "unknown", lintStatus: "unknown", typecheckStatus: "unknown", missingTestCount: 0 },
      reviewPriorityCount: 0,
      scopeCreepSuspected: false,
      ...(saved.staleAt ? { staleAt: saved.staleAt } : {}),
      availability: "unavailable",
      privacy: "summary-only"
    };
  }
  const validation = saved.tenantId && saved.report.authenticity?.trust === "verified_agentproof"
    ? validateTenantStoredReport(saved.report, requireReportSigningSecret())
    : validateVerificationReport(saved.report, { mode: "summary" });
  if (!validation.valid) return null;

  const report = saved.report;
  return {
    id: saved.id,
    createdAt: saved.createdAt,
    expiresAt: saved.expiresAt,
    ...(saved.repositoryId ? { repositoryId: saved.repositoryId } : {}),
    ...(saved.pullRequestNumber ? { pullRequestNumber: saved.pullRequestNumber } : {}),
    ...(saved.headSha ? { headSha: saved.headSha } : {}),
    sourceTitle: safeReportText(report.source.title, "Untitled PR"),
    sourceUrl: safeReportUrl(report.source.url),
    priority: report.summary.priority,
    evidenceCoverage: safePercent(report.summary.evidenceCoverage),
    requirementCounts: {
      met: report.requirements.filter((item) => item.status === "met").length,
      partial: report.requirements.filter((item) => item.status === "partial").length,
      missing: report.requirements.filter((item) => item.status === "missing").length,
      unclear: report.requirements.filter((item) => item.status === "unclear").length
    },
    testing: {
      ciStatus: report.testing.ciStatus,
      lintStatus: report.testing.lintStatus,
      typecheckStatus: report.testing.typecheckStatus,
      missingTestCount: report.testing.missingTests.length
    },
    reviewPriorityCount: report.reviewPriority.length,
    scopeCreepSuspected: report.scope.suspected,
    ...(saved.staleAt ? { staleAt: saved.staleAt } : {}),
    availability: "available",
    privacy: "summary-only"
  };
}

async function supabaseFetch(config: SupabaseReportStoreConfig, query: string, init: RequestInit) {
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

async function supabaseRpcFetch(config: SupabaseReportStoreConfig, rpc: string, init: RequestInit) {
  return fetch(`${config.url}/rest/v1/rpc/${encodeURIComponent(rpc)}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(init.headers ?? {})
    }
  });
}

async function parseSupabaseArray(response: Response): Promise<SupabaseReportRow[]> {
  const value = (await response.json()) as unknown;

  if (!Array.isArray(value)) return [];

  return value.filter(isSupabaseReportRow);
}

function toSupabaseRow(saved: StoredServerReport): SupabaseReportRow {
  const row: SupabaseReportRow = {
    id: saved.id,
    created_at: saved.createdAt,
    expires_at: saved.expiresAt,
    report: reportForPersistence(saved)
  };

  if (saved.tenantId) {
    row.tenant_id = saved.tenantId;
    row.access_token_hash = saved.accessTokenHash;
  }
  if (saved.installationId) row.installation_id = saved.installationId;
  if (saved.repositoryId) row.repository_id = saved.repositoryId;
  if (saved.pullRequestNumber) row.pull_request_number = saved.pullRequestNumber;
  if (saved.headSha) row.head_sha = saved.headSha;
  if (saved.staleAt) row.stale_at = saved.staleAt;

  return row;
}

function toSupabaseTenantReportRpc(saved: StoredServerReport) {
  return {
    p_id: saved.id,
    p_created_at: saved.createdAt,
    p_expires_at: saved.expiresAt,
    p_report: reportForPersistence(saved),
    p_tenant_id: saved.tenantId,
    p_installation_id: saved.installationId,
    p_repository_id: saved.repositoryId,
    p_pull_request_number: saved.pullRequestNumber,
    p_head_sha: saved.headSha
  };
}

function rowToStoredReport(row: SupabaseReportRow | undefined): StoredServerReport | null {
  if (!row) return null;
  const saved = {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    tenantId: row.tenant_id ?? undefined,
    accessTokenHash: row.access_token_hash ?? undefined,
    installationId: row.installation_id ?? undefined,
    repositoryId: row.repository_id ?? undefined,
    pullRequestNumber: row.pull_request_number ?? undefined,
    headSha: row.head_sha ?? undefined,
    staleAt: row.stale_at ?? undefined
  } satisfies Omit<StoredServerReport, "report">;

  if (saved.tenantId && looksLikeTenantPersistedCandidate(row.report)) {
    const decoded = decodeTenantPersistedReport(row.report, {
      signingSecret: requireReportSigningSecret(),
      createdAt: saved.createdAt
    });
    if (decoded.status === "invalid") return unavailableStoredReport(saved);
    return sanitizeStoredReport({ ...saved, report: decoded.report, availability: "available" });
  }

  return sanitizeStoredReport({ ...saved, report: row.report as VerificationReport });
}

function reportForPersistence(saved: StoredServerReport): VerificationReport | TenantPersistedReport {
  if (saved.tenantId && saved.report.authenticity?.trust === "verified_agentproof") {
    return projectTenantPersistedReport(saved.report, requireReportSigningSecret());
  }
  return saved.report;
}

function unavailableStoredReport(saved: Omit<StoredServerReport, "report">): StoredServerReport {
  return {
    ...saved,
    availability: "unavailable",
    report: {
      analysisId: "tenant-report-unavailable",
      createdAt: saved.createdAt,
      source: { title: "Saved report unavailable" },
      summary: { oneLine: "Saved report unavailable.", confidence: 0, priority: "low", evidenceCoverage: 0, topRisks: [] },
      requirements: [],
      claims: [],
      scope: { suspected: false, outOfScopeFiles: [], reasons: [] },
      testing: { ciStatus: "unknown", lintStatus: "unknown", typecheckStatus: "unknown", missingTests: [] },
      reviewPriority: [],
      proofGraph: {
        version: 1,
        nodes: [],
        context: [],
        summary: { requirementCount: 0, requirementsWithImplementation: 0, requirementsWithTargetedTests: 0, requirementsWithExecution: 0, requirementsWithGaps: 0, gapCount: 0 }
      },
      reprompt: { targetAgent: "codex", prompt: "Review the linked evidence." },
      evidenceIndex: [],
      limitations: ["Some evidence was unavailable or intentionally omitted for privacy."],
      authenticity: createUnverifiedAuthenticity("imported_unverified")
    }
  };
}

function copyProofAxes(axes: RequirementProofAxis[]): RequirementProofAxis[] {
  return axes.map((axis) => ({
    subject: axis.subject,
    polarity: axis.polarity,
    state: axis.state,
    evidenceRefs: [...axis.evidenceRefs],
    ...(axis.collectionBasis ? { collectionBasis: axis.collectionBasis } : {})
  }));
}

function looksLikeTenantPersistedCandidate(report: unknown): report is TenantPersistedReport {
  return Boolean(
    report &&
      typeof report === "object" &&
      !Array.isArray(report) &&
      ("integrity" in report || "version" in report)
  );
}

function sanitizeStoredReport(saved: StoredServerReport): StoredServerReport | null {
  try {
    const authenticity = saved.report.authenticity;
    if (authenticity?.trust === "verified_agentproof") {
      const secret = requireReportSigningSecret();
      if (!verifyVerifiedAuthenticity(saved.report, secret)) return null;
      if (saved.tenantId && !validateTenantStoredReport(saved.report, secret).valid) return null;
    }
    return {
      ...saved,
      report: saved.tenantId && authenticity?.trust === "verified_agentproof" ? saved.report : sanitizeSummaryReport(saved.report)
    };
  } catch {
    return null;
  }
}

function isSupabaseReportRow(value: unknown): value is SupabaseReportRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.created_at === "string" &&
    typeof row.expires_at === "string" &&
    (row.tenant_id === undefined || row.tenant_id === null || typeof row.tenant_id === "string") &&
    (row.access_token_hash === undefined || row.access_token_hash === null || typeof row.access_token_hash === "string") &&
    (row.installation_id === undefined || row.installation_id === null || typeof row.installation_id === "number") &&
    (row.repository_id === undefined || row.repository_id === null || typeof row.repository_id === "number") &&
    (row.pull_request_number === undefined || row.pull_request_number === null || typeof row.pull_request_number === "number") &&
    (row.head_sha === undefined || row.head_sha === null || typeof row.head_sha === "string") &&
    (row.stale_at === undefined || row.stale_at === null || typeof row.stale_at === "string") &&
    Boolean(row.report && typeof row.report === "object" && !Array.isArray(row.report))
  );
}

function getSupabaseReportStoreConfig(): SupabaseReportStoreConfig | null {
  const env = readSupabaseReportStoreEnv();

  if (!env.url || !env.serviceRoleKey) return null;

  return {
    url: trimTrailingSlash(env.url),
    serviceRoleKey: env.serviceRoleKey,
    table: env.table
  };
}

function readSupabaseReportStoreEnv() {
  const url = process.env.AGENTPROOF_REPORTS_SUPABASE_URL || process.env.SUPABASE_URL || "";

  return {
    url,
    serviceRoleKey:
      getSharedControlPlaneServiceRoleKey(url) ||
      process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    table: process.env.AGENTPROOF_REPORTS_TABLE || DEFAULT_SUPABASE_REPORTS_TABLE
  };
}

function isSafeReportId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,100}$/.test(id);
}

function normalizeCreateOptions(optionsOrTtlMs: CreateSavedReportOptions | number): NormalizedCreateSavedReportOptions {
  const options = typeof optionsOrTtlMs === "number"
    ? { ttlMs: optionsOrTtlMs }
    : optionsOrTtlMs;
  const ttlMs = typeof options.ttlMs === "number" && Number.isFinite(options.ttlMs)
    ? options.ttlMs
    : SERVER_REPORT_TTL_MS;
  const tenantId = options.tenantId ? normalizeTenantId(options.tenantId) : undefined;
  const installationId = normalizePositiveInteger(options.installationId);
  const repositoryId = normalizePositiveInteger(options.repositoryId);
  const pullRequestNumber = normalizePositiveInteger(options.pullRequestNumber);
  const headSha = normalizeHeadSha(options.headSha);

  if (options.tenantId && !tenantId) {
    throw new SavedReportStoreError("Saved report tenant id is invalid.");
  }
  if ((options.installationId !== undefined && !installationId) || (options.repositoryId !== undefined && !repositoryId) || (options.pullRequestNumber !== undefined && !pullRequestNumber) || (options.headSha !== undefined && !headSha)) {
    throw new SavedReportStoreError("Saved report identity metadata is invalid.");
  }
  if ((installationId || repositoryId || pullRequestNumber || headSha) && (!tenantId || !installationId || !repositoryId || !pullRequestNumber || !headSha)) {
    throw new SavedReportStoreError("Saved report identity metadata must be complete and tenant scoped.");
  }

  return {
    ttlMs,
    tenantId, installationId, repositoryId, pullRequestNumber, headSha
  };
}

function markPriorMemoryReportsStale(saved: StoredServerReport) {
  if (!saved.tenantId || !saved.repositoryId || !saved.pullRequestNumber || !saved.headSha) return;
  const staleAt = new Date().toISOString();
  for (const [id, existing] of reportStore()) {
    if (existing.tenantId === saved.tenantId && existing.repositoryId === saved.repositoryId && existing.pullRequestNumber === saved.pullRequestNumber && existing.headSha && existing.headSha !== saved.headSha && !existing.staleAt) {
      reportStore().set(id, { ...existing, staleAt });
    }
  }
}

function normalizePositiveInteger(value: unknown): number | undefined { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined; }
function normalizeHeadSha(value: unknown): string | undefined { return typeof value === "string" && /^[a-f0-9]{6,64}$/.test(value) ? value : undefined; }

function createTenantAccess(tenantId: string | undefined, sessionOnly = false): Partial<StoredServerReport> {
  if (!tenantId) return {};
  // Tenant artifacts are never capability-link shared. They require the
  // logged-in tenant session; legacy non-tenant reports retain their existing
  // short-lived access key behavior.
  if (sessionOnly) return { tenantId };
  const accessToken = randomBytes(24).toString("base64url");
  return { tenantId, accessToken, accessTokenHash: hashSavedReportAccessToken(accessToken) };
}

function buildSupabaseReportAccessQuery(id: string, access: SavedReportAccessContext): string {
  if (!hasSavedReportAccessContext(access)) {
    return `?id=eq.${encodeURIComponent(id)}&select=id,created_at,expires_at,report&limit=1`;
  }

  return [
    `id=eq.${encodeURIComponent(id)}`,
    ...supabaseAccessFilters(access),
    "select=id,created_at,expires_at,report,tenant_id,access_token_hash,installation_id,repository_id,pull_request_number,head_sha,stale_at",
    "limit=1"
  ].join("&").replace(/^/, "?");
}

function buildSupabaseReportDeleteQuery(id: string, access: SavedReportAccessContext): string {
  if (!hasSavedReportAccessContext(access)) {
    return `?id=eq.${encodeURIComponent(id)}`;
  }

  return [
    `id=eq.${encodeURIComponent(id)}`,
    ...supabaseAccessFilters(access)
  ].join("&").replace(/^/, "?");
}

function supabaseAccessFilters(access: SavedReportAccessContext): string[] {
  const filters: string[] = [];
  const tenantId = access.tenantId ? normalizeTenantId(access.tenantId) : undefined;
  const accessTokenHash = access.accessToken ? hashSavedReportAccessToken(access.accessToken) : undefined;

  if (tenantId) filters.push(`tenant_id=eq.${encodeURIComponent(tenantId)}`);
  if (accessTokenHash) filters.push(`access_token_hash=eq.${encodeURIComponent(accessTokenHash)}`);

  return filters;
}

function hasSavedReportAccessContext(access: SavedReportAccessContext): boolean {
  return Boolean(access.tenantId || access.accessToken);
}

function createSavedReportId(tenantId: string | undefined): string {
  const id = crypto.randomUUID();

  return tenantId ? `tenant_${id}` : id;
}

function isTenantScopedReportId(id: string): boolean {
  return id.startsWith("tenant_");
}

function canAccessSavedReport(saved: StoredServerReport, access: SavedReportAccessContext): boolean {
  if (!saved.tenantId && !saved.accessTokenHash) return true;

  const tenantId = access.tenantId ? normalizeTenantId(access.tenantId) : undefined;
  if (tenantId && saved.tenantId && tenantId === saved.tenantId) {
    return true;
  }

  return Boolean(access.accessToken && saved.accessTokenHash && safeTokenEqual(
    saved.accessTokenHash,
    hashSavedReportAccessToken(access.accessToken)
  ));
}

function hashSavedReportAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeTenantId(value: string): string | undefined {
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : undefined;
}

function normalizeSavedReportListLimit(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? Math.min(value, TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT + 1)
    : 10;
}

function isTenantSavedReportPriorityFilter(value: string): value is TenantSavedReportPriorityFilter {
  return ["all", "blocker", "high", "medium", "low"].includes(value);
}

function isTenantSavedReportStatusFilter(value: string): value is TenantSavedReportStatusFilter {
  return ["all", "missing_tests", "scope_creep", "weak_evidence"].includes(value);
}

function normalizeSavedReportQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = stripReportFilterForbiddenTerms(redactReportFilterSecrets(redactSecrets(value)))
    .replace(/[^a-zA-Z0-9_.:/#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

  return normalized || undefined;
}

function redactReportFilterSecrets(value: string): string {
  return value.replace(/\b(?:key|api_key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi, "[redacted]");
}

function stripReportFilterForbiddenTerms(value: string): string {
  return value.replace(
    /\b(rawDiff|rawLog|rawPatch|evidenceIndex|claims|reprompt|reportBody|savedReportUrl|commentBody|payload|serviceRole|service-role|table)\b/gi,
    " "
  );
}

function tenantSavedReportSearchText(report: TenantSavedReportSummary): string {
  return [
    report.sourceTitle,
    report.sourceUrl,
    report.priority,
    report.testing.ciStatus,
    report.testing.lintStatus,
    report.testing.typecheckStatus
  ].filter(Boolean).join(" ").toLowerCase();
}

function tenantSavedReportMatchesQuery(report: TenantSavedReportSummary, query: string): boolean {
  const searchText = tenantSavedReportSearchText(report);
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item && item !== "redacted");

  return tokens.length === 0 || tokens.every((token) => searchText.includes(token));
}

function countFromContentRange(value: string | null): number | null {
  if (!value) return null;
  const total = value.split("/").at(1);
  if (!total || total === "*") return null;
  const count = Number(total);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function safePercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

function safeReportText(value: string | undefined, fallback: string): string {
  const text = redactSecrets(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, 180);
}

function safeReportUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(redactSecrets(value));
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.search = "";
    url.hash = "";
    return url.toString().slice(0, 240);
  } catch {
    return undefined;
  }
}

function withoutTransientAccessToken(saved: StoredServerReport): StoredServerReport {
  const { accessToken: _accessToken, ...stored } = saved;

  return stored;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function reportStore() {
  const globalStore = globalThis as GlobalWithReportStore;
  globalStore.__agentproofReportStore ??= new Map<string, StoredServerReport>();

  return globalStore.__agentproofReportStore;
}

function trimReportStore() {
  const store = reportStore();

  while (store.size > MAX_SERVER_REPORTS) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) return;
    store.delete(oldest);
  }
}
