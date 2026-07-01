import type { AnalysisJobDeadLetterSummary, AnalysisJobQueueSummary } from "./analysis-jobs";

export const ANALYSIS_QUEUE_ALERT_BASIS = "sampled_rows" as const;
export const ANALYSIS_DEAD_LETTER_OPS_BASIS = "failed_terminal_recent_sample" as const;
export const ANALYSIS_DEAD_LETTER_TERMINAL_THRESHOLD = 1;
export const ANALYSIS_DEAD_LETTER_INCIDENT_THRESHOLD = 5;
export const ANALYSIS_DEAD_LETTER_STALE_SECONDS_THRESHOLD = 60 * 60;

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

export type AnalysisDeadLetterOpsState = "clear" | "needs_attention" | "incident";
export type AnalysisDeadLetterAlertSeverity = "info" | "warning";
export type AnalysisDeadLetterAlertCode =
  | "analysis_dead_letter_terminal_failures"
  | "analysis_dead_letter_terminal_spike"
  | "analysis_dead_letter_stale_terminal"
  | "analysis_dead_letter_summary_truncated";
export type AnalysisDeadLetterAlertMetric =
  | "sampledTerminalCount"
  | "oldestTerminalAgeSeconds"
  | "sampled";
export type AnalysisDeadLetterNextAction =
  | "continue_monitoring"
  | "review_top_error_codes"
  | "pause_batch_drains_and_check_provider_or_storage"
  | "triage_or_record_follow_up"
  | "increase_sample_or_check_durable_store";

export interface AnalysisDeadLetterAlert {
  code: AnalysisDeadLetterAlertCode;
  severity: AnalysisDeadLetterAlertSeverity;
  metric: AnalysisDeadLetterAlertMetric;
  count: number;
  threshold: number;
  nextAction: AnalysisDeadLetterNextAction;
}

export interface AnalysisDeadLetterOpsStatus {
  privacy: "analysis-job-dead-letter-ops-status-summary-only";
  basis: typeof ANALYSIS_DEAD_LETTER_OPS_BASIS;
  state: AnalysisDeadLetterOpsState;
  alerts: AnalysisDeadLetterAlert[];
  nextActions: AnalysisDeadLetterNextAction[];
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

export function toAnalysisDeadLetterOpsStatus(
  summary: AnalysisJobDeadLetterSummary
): AnalysisDeadLetterOpsStatus {
  const alerts = toAnalysisDeadLetterAlerts(summary);
  const nextActions = uniqueNextActions(alerts);

  return {
    privacy: "analysis-job-dead-letter-ops-status-summary-only",
    basis: ANALYSIS_DEAD_LETTER_OPS_BASIS,
    state: deadLetterState(alerts),
    alerts,
    nextActions: nextActions.length > 0 ? nextActions : ["continue_monitoring"]
  };
}

export function toAnalysisDeadLetterAlerts(summary: AnalysisJobDeadLetterSummary): AnalysisDeadLetterAlert[] {
  const alerts: AnalysisDeadLetterAlert[] = [];

  if (summary.sampledTerminalCount >= ANALYSIS_DEAD_LETTER_TERMINAL_THRESHOLD) {
    alerts.push({
      code: "analysis_dead_letter_terminal_failures",
      severity: "info",
      metric: "sampledTerminalCount",
      count: summary.sampledTerminalCount,
      threshold: ANALYSIS_DEAD_LETTER_TERMINAL_THRESHOLD,
      nextAction: "review_top_error_codes"
    });
  }

  if (summary.sampledTerminalCount >= ANALYSIS_DEAD_LETTER_INCIDENT_THRESHOLD) {
    alerts.push({
      code: "analysis_dead_letter_terminal_spike",
      severity: "warning",
      metric: "sampledTerminalCount",
      count: summary.sampledTerminalCount,
      threshold: ANALYSIS_DEAD_LETTER_INCIDENT_THRESHOLD,
      nextAction: "pause_batch_drains_and_check_provider_or_storage"
    });
  }

  if ((summary.oldestTerminalAgeSeconds ?? 0) >= ANALYSIS_DEAD_LETTER_STALE_SECONDS_THRESHOLD) {
    alerts.push({
      code: "analysis_dead_letter_stale_terminal",
      severity: "warning",
      metric: "oldestTerminalAgeSeconds",
      count: summary.oldestTerminalAgeSeconds ?? 0,
      threshold: ANALYSIS_DEAD_LETTER_STALE_SECONDS_THRESHOLD,
      nextAction: "triage_or_record_follow_up"
    });
  }

  if (summary.truncated) {
    alerts.push({
      code: "analysis_dead_letter_summary_truncated",
      severity: "warning",
      metric: "sampled",
      count: summary.sampled,
      threshold: summary.sampled,
      nextAction: "increase_sample_or_check_durable_store"
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

function deadLetterState(alerts: AnalysisDeadLetterAlert[]): AnalysisDeadLetterOpsState {
  if (alerts.some((alert) => alert.severity === "warning")) return "incident";
  if (alerts.length > 0) return "needs_attention";
  return "clear";
}

function uniqueNextActions(alerts: AnalysisDeadLetterAlert[]): AnalysisDeadLetterNextAction[] {
  return [...new Set(alerts.map((alert) => alert.nextAction))];
}
