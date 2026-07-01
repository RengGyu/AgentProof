import { AnalysisJobQueueError } from "@/lib/analysis-jobs";
import { runAnalysisJobBatch } from "@/lib/analysis-worker";
import { toPublicAnalysisWorkerBatchResult } from "@/lib/analysis-worker-public";
import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";

export async function POST(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const url = new URL(request.url);
    const result = await runAnalysisJobBatch({
      requestUrl: request.url,
      limit: parseLimit(url.searchParams.get("limit"))
    });

    return noStoreJson(toPublicAnalysisWorkerBatchResult(result));
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
