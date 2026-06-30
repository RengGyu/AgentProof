import { AnalysisJobQueueError } from "@/lib/analysis-jobs";
import { preflightNextAnalysisJob, type AnalysisWorkerPreflightResult } from "@/lib/analysis-worker";
import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";

export async function POST(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await preflightNextAnalysisJob();

    return noStoreJson(toPublicPreflightResult(result));
  } catch (error) {
    if (error instanceof AnalysisJobQueueError) {
      return noStoreJson({
        error: "Analysis worker queue is unavailable.",
        code: "analysis_worker_queue_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function toPublicPreflightResult(result: AnalysisWorkerPreflightResult) {
  return {
    ok: true,
    privacy: "analysis-worker-preflight-metadata-only",
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
    sideEffects: result.sideEffects
  };
}
