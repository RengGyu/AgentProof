import type { AnalysisJobQueueSummary } from "./analysis-jobs";

export const ANALYSIS_QUEUE_ALERT_BASIS = "sampled_rows" as const;

export type AnalysisQueueAlertSeverity = "info" | "warning";
export type AnalysisQueueAlertCode =
  | "analysis_queue_failed_terminal"
  | "analysis_queue_stale_processing"
  | "analysis_queue_backlog"
  | "analysis_queue_due_jobs"
  | "analysis_queue_summary_truncated";
export type AnalysisQueueAlertMetric =
  | "counts.failed_terminal"
  | "staleProcessing"
  | "due"
  | "oldestQueuedAgeSeconds"
  | "sampled";

export interface AnalysisQueueAlert {
  code: AnalysisQueueAlertCode;
  severity: AnalysisQueueAlertSeverity;
  metric: AnalysisQueueAlertMetric;
  count: number;
  threshold: number;
}

export function toAnalysisQueueAlerts(summary: AnalysisJobQueueSummary | null): AnalysisQueueAlert[] {
  if (!summary) return [];

  const alerts: AnalysisQueueAlert[] = [];

  if (summary.counts.failed_terminal > 0) {
    alerts.push({
      code: "analysis_queue_failed_terminal",
      severity: "warning",
      metric: "counts.failed_terminal",
      count: summary.counts.failed_terminal,
      threshold: 1
    });
  }

  if (summary.staleProcessing > 0) {
    alerts.push({
      code: "analysis_queue_stale_processing",
      severity: "warning",
      metric: "staleProcessing",
      count: summary.staleProcessing,
      threshold: 1
    });
  }

  if (summary.due >= 5) {
    alerts.push({
      code: "analysis_queue_backlog",
      severity: "warning",
      metric: "due",
      count: summary.due,
      threshold: 5
    });
  } else if ((summary.oldestQueuedAgeSeconds ?? 0) >= 900) {
    alerts.push({
      code: "analysis_queue_backlog",
      severity: "warning",
      metric: "oldestQueuedAgeSeconds",
      count: summary.oldestQueuedAgeSeconds ?? 0,
      threshold: 900
    });
  } else if (summary.due > 0) {
    alerts.push({
      code: "analysis_queue_due_jobs",
      severity: "info",
      metric: "due",
      count: summary.due,
      threshold: 1
    });
  }

  if (summary.truncated) {
    alerts.push({
      code: "analysis_queue_summary_truncated",
      severity: "warning",
      metric: "sampled",
      count: summary.sampled,
      threshold: summary.sampled
    });
  }

  return alerts;
}

export function countAnalysisQueueAlerts(alerts: AnalysisQueueAlert[]) {
  return {
    total: alerts.length,
    warning: alerts.filter((alert) => alert.severity === "warning").length,
    info: alerts.filter((alert) => alert.severity === "info").length
  };
}
