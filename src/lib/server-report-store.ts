import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { sanitizeReportForShare } from "./report-share";
import { redactSecrets } from "./redact";
import { validateVerificationReport } from "./report-validation";
import type { VerificationReport } from "./types";

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
}

export interface SavedReportAccessContext {
  tenantId?: string;
  accessToken?: string;
}

export interface CreateSavedReportOptions {
  ttlMs?: number;
  tenantId?: string;
}

interface NormalizedCreateSavedReportOptions {
  ttlMs: number;
  tenantId?: string;
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
  report: VerificationReport;
  tenant_id?: string | null;
  access_token_hash?: string | null;
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

  if (config) {
    return createSupabaseSavedReport(config, report, options);
  }

  return createMemorySavedReport(report, options);
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

function createMemorySavedReport(report: VerificationReport, options: NormalizedCreateSavedReportOptions): StoredServerReport {
  cleanupExpiredReports();

  const createdAtDate = new Date();
  const access = createTenantAccess(options.tenantId);
  const saved: StoredServerReport = {
    id: createSavedReportId(options.tenantId),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + options.ttlMs).toISOString(),
    report: sanitizeSummaryReport(report),
    ...access
  };

  reportStore().set(saved.id, withoutTransientAccessToken(saved));
  trimReportStore();
  return saved;
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

function listMemoryTenantSavedReports(tenantId: string, limit: number): StoredServerReport[] {
  cleanupExpiredReports();

  return [...reportStore().values()]
    .filter((saved) => saved.tenantId === tenantId)
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
  options: NormalizedCreateSavedReportOptions
): Promise<StoredServerReport> {
  const createdAtDate = new Date();
  const access = createTenantAccess(options.tenantId);
  const saved: StoredServerReport = {
    id: createSavedReportId(options.tenantId),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + options.ttlMs).toISOString(),
    report: sanitizeSummaryReport(report),
    ...access
  };

  const response = await supabaseFetch(config, "", {
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
  limit: number
): Promise<StoredServerReport[]> {
  const params = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    expires_at: `gt.${new Date().toISOString()}`,
    select: "id,created_at,expires_at,report,tenant_id",
    order: "created_at.desc",
    limit: String(limit)
  });
  const response = await supabaseFetch(config, `?${params.toString()}`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report list failed with status ${response.status}.`);
  }

  return (await parseSupabaseArray(response))
    .map(rowToStoredReport)
    .filter((row): row is StoredServerReport => Boolean(row && row.tenantId === tenantId));
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

function sanitizeSummaryReport(report: VerificationReport): VerificationReport {
  const safeReport = sanitizeReportForShare(report);
  const validation = validateVerificationReport(safeReport, { mode: "summary" });

  if (!validation.valid) {
    throw new SavedReportStoreError(`Summary-only saved report failed validation: ${validation.errors.join("; ")}`);
  }

  return safeReport;
}

function toTenantSavedReportSummary(saved: StoredServerReport): TenantSavedReportSummary | null {
  const validation = validateVerificationReport(saved.report, { mode: "summary" });
  if (!validation.valid) return null;

  const report = saved.report;
  return {
    id: saved.id,
    createdAt: saved.createdAt,
    expiresAt: saved.expiresAt,
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
    report: saved.report
  };

  if (saved.tenantId) {
    row.tenant_id = saved.tenantId;
    row.access_token_hash = saved.accessTokenHash;
  }

  return row;
}

function rowToStoredReport(row: SupabaseReportRow | undefined): StoredServerReport | null {
  if (!row) return null;

  return sanitizeStoredReport({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    report: row.report,
    tenantId: row.tenant_id ?? undefined,
    accessTokenHash: row.access_token_hash ?? undefined
  });
}

function sanitizeStoredReport(saved: StoredServerReport): StoredServerReport | null {
  try {
    return {
      ...saved,
      report: sanitizeSummaryReport(saved.report)
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
  return {
    url: process.env.AGENTPROOF_REPORTS_SUPABASE_URL || process.env.SUPABASE_URL || "",
    serviceRoleKey:
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

  if (options.tenantId && !tenantId) {
    throw new SavedReportStoreError("Saved report tenant id is invalid.");
  }

  return {
    ttlMs,
    tenantId
  };
}

function createTenantAccess(tenantId: string | undefined): Partial<StoredServerReport> {
  if (!tenantId) return {};

  const accessToken = randomBytes(24).toString("base64url");

  return {
    tenantId,
    accessToken,
    accessTokenHash: hashSavedReportAccessToken(accessToken)
  };
}

function buildSupabaseReportAccessQuery(id: string, access: SavedReportAccessContext): string {
  if (!hasSavedReportAccessContext(access)) {
    return `?id=eq.${encodeURIComponent(id)}&select=id,created_at,expires_at,report&limit=1`;
  }

  return [
    `id=eq.${encodeURIComponent(id)}`,
    ...supabaseAccessFilters(access),
    "select=id,created_at,expires_at,report,tenant_id,access_token_hash",
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
