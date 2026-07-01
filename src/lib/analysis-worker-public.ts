import type { AnalysisWorkerBatchResult, AnalysisWorkerRunResult } from "./analysis-worker";

export function toPublicAnalysisWorkerRunResult(result: AnalysisWorkerRunResult) {
  return {
    ok: true,
    privacy: "analysis-worker-run-metadata-only" as const,
    ...toPublicAnalysisWorkerRunItem(result)
  };
}

function toPublicAnalysisWorkerRunItem(result: AnalysisWorkerRunResult) {
  return {
    status: result.status,
    reason: result.reason,
    job: result.job
      ? {
        id: result.job.id,
        pullRequestNumber: result.job.pull_request_number,
        headShaPrefix: result.job.head_sha.slice(0, 12),
        attempts: result.job.attempts
      }
      : undefined,
    result: result.resultSummary
      ? {
        priority: result.resultSummary.priority,
        evidenceCoverage: result.resultSummary.evidenceCoverage,
        savedReport: result.resultSummary.savedReport,
        comment: result.resultSummary.comment,
        slack: result.resultSummary.slack
      }
      : undefined,
    sideEffects: result.sideEffects
  };
}

export function toPublicAnalysisWorkerBatchResult(result: AnalysisWorkerBatchResult) {
  return {
    ok: true,
    privacy: "analysis-worker-batch-metadata-only" as const,
    requestedLimit: result.requestedLimit,
    processed: result.processed,
    completed: result.completed,
    failedRetryable: result.failedRetryable,
    failedTerminal: result.failedTerminal,
    idle: result.idle,
    stoppedReason: result.stoppedReason,
    items: result.items.map((item, index) => ({
      index,
      privacy: "analysis-worker-run-metadata-only" as const,
      ...toPublicAnalysisWorkerRunItem(item)
    }))
  };
}
