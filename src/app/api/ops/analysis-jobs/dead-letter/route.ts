import {
  AnalysisJobQueueError,
  getAnalysisJobDeadLetterSummary,
  getAnalysisJobQueueStatus
} from "@/lib/analysis-jobs";
import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";

export async function GET(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  const queue = getAnalysisJobQueueStatus();
  if (!queue.enabled) {
    return noStoreJson({
      ok: true,
      privacy: "analysis-job-dead-letter-summary-only",
      status: "disabled",
      reason: "analysis_job_queue_disabled"
    });
  }

  if (!queue.configured) {
    return noStoreJson({
      error: "Analysis job queue is unavailable.",
      code: "analysis_worker_queue_unavailable"
    }, { status: 503 });
  }

  try {
    const summary = await getAnalysisJobDeadLetterSummary({
      limit: parseLimit(new URL(request.url).searchParams.get("limit"))
    });

    if (!summary) {
      return noStoreJson({
        error: "Analysis job dead-letter summary is unavailable.",
        code: "analysis_job_dead_letter_unavailable"
      }, { status: 503 });
    }

    return noStoreJson({
      ok: true,
      privacy: summary.privacy,
      status: "ready",
      summary
    });
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

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
