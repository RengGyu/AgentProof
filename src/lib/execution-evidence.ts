import {
  hasPassingEvidenceStatusPrefix,
  isExecutionEvidenceSignal
} from "./evidence-status";
import type { CheckStatus, EvidenceItem } from "./types";

export interface ExecutionEvidenceItem {
  id: string;
  kind: "check" | "log";
  label: string;
  locator?: string;
  status: CheckStatus;
  confidence: number;
  summary: string;
}

const STATUS_ORDER: Record<CheckStatus, number> = {
  failed: 0,
  pending: 1,
  unknown: 2,
  passed: 3
};

export function getExecutionEvidenceItems(
  evidenceIndex: EvidenceItem[],
  limit = 6
): ExecutionEvidenceItem[] {
  return evidenceIndex
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isExecutionEvidenceItem(item))
    .map(({ item, index }) => ({
      id: item.id,
      kind: item.kind as "check" | "log",
      label: item.label,
      locator: item.locator,
      status: statusFromEvidenceSummary(item.summary),
      confidence: item.confidence,
      summary: item.summary,
      index
    }))
    .sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.index - right.index)
    .slice(0, limit)
    .map(({ index: _index, ...item }) => item);
}

export function isExecutionEvidenceItem(item: EvidenceItem): boolean {
  return (item.kind === "check" || item.kind === "log") &&
    isExecutionEvidenceSignal(item.label, item.summary, item.locator);
}

export function statusFromEvidenceSummary(summary: string): CheckStatus {
  if (hasPassingEvidenceStatusPrefix(summary)) {
    return "passed";
  }

  const match = summary.trim().match(/^Status:\s*(failed|pending|unknown)\b/i);

  return match ? match[1].toLowerCase() as CheckStatus : "unknown";
}
