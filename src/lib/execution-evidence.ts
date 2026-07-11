import {
  hasPassingEvidenceStatusPrefix,
  isExecutionEvidenceSignal,
  isFailedAmbiguousActionsExecutionSignal
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
  displaySummary: string;
  failureLocations: FailedCheckLocation[];
}

export interface FailedCheckLocationItem {
  id: string;
  label: string;
  locator?: string;
  confidence: number;
  locations: FailedCheckLocation[];
}

export interface FailedCheckLocation {
  level: "notice" | "warning" | "failure" | "annotation";
  path: string;
  line?: number;
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
    .map(({ item, index }) => {
      const failureLocations = annotationLocationsFromSummary(item.summary);

      return {
        id: item.id,
        kind: item.kind as "check" | "log",
        label: item.label,
        locator: item.locator,
        status: statusFromEvidenceSummary(item.summary),
        confidence: item.confidence,
        summary: item.summary,
        displaySummary: displaySummaryWithoutAnnotations(item.summary),
        failureLocations,
        index
      };
    })
    .sort((left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status] || left.index - right.index)
    .slice(0, limit)
    .map(({ index: _index, ...item }) => item);
}

export function getFailedCheckLocationItems(
  evidenceIndex: EvidenceItem[],
  limit = 4,
  locationsPerItem = 6
): FailedCheckLocationItem[] {
  return getExecutionEvidenceItems(evidenceIndex, evidenceIndex.length)
    .filter((item) => item.status === "failed")
    .map((item) => ({
      id: item.id,
      label: item.label,
      locator: item.locator,
      confidence: item.confidence,
      locations: item.failureLocations.slice(0, locationsPerItem)
    }))
    .filter((item) => item.locations.length > 0)
    .slice(0, limit);
}

function displaySummaryWithoutAnnotations(summary: string): string {
  const markerIndex = summary.indexOf(" Check annotations:");
  if (markerIndex < 0) {
    return summary;
  }

  return summary.slice(0, markerIndex).trim();
}

export function isExecutionEvidenceItem(item: EvidenceItem): boolean {
  return (item.kind === "check" || item.kind === "log") &&
    (
      isExecutionEvidenceSignal(item.label, item.summary, item.locator) ||
      isFailedAmbiguousActionsExecutionSignal(item.label, statusFromEvidenceSummary(item.summary), item.locator, item.summary)
    );
}

export function statusFromEvidenceSummary(summary: string): CheckStatus {
  if (hasPassingEvidenceStatusPrefix(summary)) {
    return "passed";
  }

  const match = summary.trim().match(/^Status:\s*(failed|pending|unknown)\b/i);

  return match ? match[1].toLowerCase() as CheckStatus : "unknown";
}

function annotationLocationsFromSummary(summary: string): FailedCheckLocation[] {
  const markerIndex = summary.indexOf("Check annotations:");
  if (markerIndex < 0) {
    return [];
  }

  const rawSegment = summary
    .slice(markerIndex + "Check annotations:".length)
    .split(/\. Raw annotation messages/i)[0];

  return rawSegment
    .split(",")
    .map((item) => item.trim())
    .map((item) => item.match(/^(notice|warning|failure|annotation)\s+at\s+(.+)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const locator = match[2]?.trim() ?? "";
      const lineMatch = locator.match(/^(.*):(\d+)$/);
      const line = lineMatch ? Number(lineMatch[2]) : undefined;

      return {
        level: match[1].toLowerCase() as FailedCheckLocation["level"],
        path: (lineMatch ? lineMatch[1] : locator).trim(),
        line: line && Number.isFinite(line) && line > 0 ? line : undefined
      };
    })
    .filter((item) => item.path.length > 0);
}
