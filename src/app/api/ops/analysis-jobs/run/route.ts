import { AnalysisJobQueueError } from "@/lib/analysis-jobs";
import { runNextAnalysisJob } from "@/lib/analysis-worker";
import { toPublicAnalysisWorkerRunResult } from "@/lib/analysis-worker-public";
import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";

export async function POST(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runNextAnalysisJob({
      requestUrl: request.url
    });

    return noStoreJson(toPublicAnalysisWorkerRunResult(result));
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
