import type { VerificationReport } from "./types";

export interface StoredReport {
  id: string;
  savedAt: string;
  title: string;
  priority: VerificationReport["summary"]["priority"];
  evidenceCoverage: number;
  report: VerificationReport;
}

const HISTORY_KEY = "agentproof.recentReports.v1";
const MAX_HISTORY_ITEMS = 6;
const MAX_REPORT_BYTES = 180_000;

export function readReportHistory(storage: Storage): StoredReport[] {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as StoredReport[]) : [];
  } catch {
    return [];
  }
}

export function saveReportToHistory(storage: Storage, report: VerificationReport): StoredReport[] {
  const serialized = JSON.stringify(report);

  if (new TextEncoder().encode(serialized).length > MAX_REPORT_BYTES) {
    throw new Error("Report is too large for browser history. Use Download instead.");
  }

  const current = readReportHistory(storage).filter((item) => item.id !== report.analysisId);
  const next = [
    {
      id: report.analysisId,
      savedAt: new Date().toISOString(),
      title: report.source.title,
      priority: report.summary.priority,
      evidenceCoverage: report.summary.evidenceCoverage,
      report
    },
    ...current
  ].slice(0, MAX_HISTORY_ITEMS);

  storage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function clearReportHistory(storage: Storage): StoredReport[] {
  storage.removeItem(HISTORY_KEY);
  return [];
}
