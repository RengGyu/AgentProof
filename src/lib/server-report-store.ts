import { sanitizeReportForShare } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import type { VerificationReport } from "./types";

export const SERVER_REPORT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_SERVER_REPORTS = 100;
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
}

export class SavedReportStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SavedReportStoreError";
  }
}

export async function createSavedReport(report: VerificationReport, ttlMs = SERVER_REPORT_TTL_MS): Promise<StoredServerReport> {
  const config = getSupabaseReportStoreConfig();

  if (config) {
    return createSupabaseSavedReport(config, report, ttlMs);
  }

  return createMemorySavedReport(report, ttlMs);
}

export async function getSavedReport(id: string): Promise<StoredServerReport | null> {
  const config = getSupabaseReportStoreConfig();

  if (config) {
    return getSupabaseSavedReport(config, id);
  }

  return getMemorySavedReport(id);
}

export async function deleteSavedReport(id: string): Promise<boolean> {
  const config = getSupabaseReportStoreConfig();

  if (config) {
    return deleteSupabaseSavedReport(config, id);
  }

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

export function clearSavedReportsForTests() {
  reportStore().clear();
}

function createMemorySavedReport(report: VerificationReport, ttlMs: number): StoredServerReport {
  cleanupExpiredReports();

  const createdAtDate = new Date();
  const saved: StoredServerReport = {
    id: crypto.randomUUID(),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + ttlMs).toISOString(),
    report: sanitizeReportForShare(report)
  };

  reportStore().set(saved.id, saved);
  trimReportStore();
  return saved;
}

function getMemorySavedReport(id: string): StoredServerReport | null {
  const saved = reportStore().get(id);

  if (!saved) return null;
  if (Date.parse(saved.expiresAt) <= Date.now()) {
    reportStore().delete(id);
    return null;
  }

  return saved;
}

async function createSupabaseSavedReport(
  config: SupabaseReportStoreConfig,
  report: VerificationReport,
  ttlMs: number
): Promise<StoredServerReport> {
  const createdAtDate = new Date();
  const saved: StoredServerReport = {
    id: crypto.randomUUID(),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + ttlMs).toISOString(),
    report: sanitizeSummaryReport(report)
  };

  const response = await supabaseFetch(config, "", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(toSupabaseRow(saved))
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report storage failed with status ${response.status}.`);
  }

  return rowToStoredReport((await parseSupabaseArray(response))[0]) ?? saved;
}

async function getSupabaseSavedReport(config: SupabaseReportStoreConfig, id: string): Promise<StoredServerReport | null> {
  if (!isSafeReportId(id)) return null;

  const response = await supabaseFetch(config, `?id=eq.${encodeURIComponent(id)}&select=id,created_at,expires_at,report&limit=1`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new SavedReportStoreError(`Saved report lookup failed with status ${response.status}.`);
  }

  const saved = rowToStoredReport((await parseSupabaseArray(response))[0]);

  if (!saved) return null;
  if (Date.parse(saved.expiresAt) <= Date.now()) {
    await deleteSupabaseSavedReport(config, id);
    return null;
  }

  return saved;
}

async function deleteSupabaseSavedReport(config: SupabaseReportStoreConfig, id: string): Promise<boolean> {
  if (!isSafeReportId(id)) return false;

  const response = await supabaseFetch(config, `?id=eq.${encodeURIComponent(id)}`, {
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
  return {
    id: saved.id,
    created_at: saved.createdAt,
    expires_at: saved.expiresAt,
    report: saved.report
  };
}

function rowToStoredReport(row: SupabaseReportRow | undefined): StoredServerReport | null {
  if (!row) return null;

  return {
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    report: row.report
  };
}

function isSupabaseReportRow(value: unknown): value is SupabaseReportRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.created_at === "string" &&
    typeof row.expires_at === "string" &&
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
