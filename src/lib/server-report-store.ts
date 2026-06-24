import { sanitizeReportForShare } from "./report-share";
import type { VerificationReport } from "./types";

export const SERVER_REPORT_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredServerReport {
  id: string;
  createdAt: string;
  expiresAt: string;
  report: VerificationReport;
}

type GlobalWithReportStore = typeof globalThis & {
  __agentproofReportStore?: Map<string, StoredServerReport>;
};

export function createSavedReport(report: VerificationReport, ttlMs = SERVER_REPORT_TTL_MS): StoredServerReport {
  cleanupExpiredReports();

  const createdAtDate = new Date();
  const saved: StoredServerReport = {
    id: crypto.randomUUID(),
    createdAt: createdAtDate.toISOString(),
    expiresAt: new Date(createdAtDate.getTime() + ttlMs).toISOString(),
    report: sanitizeReportForShare(report)
  };

  reportStore().set(saved.id, saved);
  return saved;
}

export function getSavedReport(id: string): StoredServerReport | null {
  const saved = reportStore().get(id);

  if (!saved) return null;
  if (Date.parse(saved.expiresAt) <= Date.now()) {
    reportStore().delete(id);
    return null;
  }

  return saved;
}

export function deleteSavedReport(id: string): boolean {
  return reportStore().delete(id);
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

function reportStore() {
  const globalStore = globalThis as GlobalWithReportStore;
  globalStore.__agentproofReportStore ??= new Map<string, StoredServerReport>();

  return globalStore.__agentproofReportStore;
}
