import { timingSafeEqual } from "crypto";
import { AnalysisJobQueueError, getAnalysisJobQueueStatus } from "@/lib/analysis-jobs";
import { runAnalysisJobBatch } from "@/lib/analysis-worker";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const cronTokens = cronAuthTokens();

  if (cronTokens.length === 0) {
    return noStoreJson({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
      status: "disabled",
      reason: "cron_auth_not_configured"
    });
  }

  if (!cronTokenMatches(request, cronTokens)) {
    return noStoreJson({
      error: "Invalid analysis job cron token.",
      code: "analysis_job_cron_unauthorized"
    }, { status: 401 });
  }

  const queue = getAnalysisJobQueueStatus();
  if (!queue.enabled) {
    return noStoreJson({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
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
    const result = await runAnalysisJobBatch({
      requestUrl: request.url,
      limit: parseLimit(process.env.AGENTPROOF_CRON_ANALYSIS_JOB_BATCH_LIMIT ?? null)
    });

    return noStoreJson({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
      status: "ran",
      requestedLimit: result.requestedLimit,
      processed: result.processed,
      completed: result.completed,
      failedRetryable: result.failedRetryable,
      failedTerminal: result.failedTerminal,
      idle: result.idle,
      stoppedReason: result.stoppedReason
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

function cronAuthTokens(): string[] {
  return [
    trimToken(process.env.CRON_SECRET),
    trimToken(process.env.AGENTPROOF_CRON_TOKEN)
  ].filter((token): token is string => Boolean(token));
}

function cronTokenMatches(request: Request, tokens: string[]): boolean {
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const headerToken = request.headers.get("x-agentproof-cron-token");
  const candidates = [bearer, headerToken].filter((token): token is string => Boolean(token));

  return candidates.some((candidate) =>
    tokens.some((token) => constantTimeEquals(candidate, token))
  );
}

function trimToken(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
