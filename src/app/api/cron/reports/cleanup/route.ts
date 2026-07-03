import { timingSafeEqual } from "crypto";
import { cleanupExpiredSavedReports, SavedReportStoreError } from "@/lib/server-report-store";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const cronTokens = cronAuthTokens();

  if (cronTokens.length === 0) {
    return noStoreJson({
      ok: true,
      privacy: "saved-report-cleanup-cron-metadata-only",
      status: "disabled",
      reason: "cron_auth_not_configured"
    });
  }

  if (!cronTokenMatches(request, cronTokens)) {
    return noStoreJson({
      error: "Invalid saved report cleanup cron token.",
      code: "saved_report_cleanup_cron_unauthorized"
    }, { status: 401 });
  }

  try {
    const result = await cleanupExpiredSavedReports();

    return noStoreJson({
      ok: true,
      privacy: "saved-report-cleanup-cron-metadata-only",
      status: "ran",
      deletedCount: result.deletedCount,
      countBasis: publicCountBasis(result.countBasis)
    });
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({
        error: "Saved report cleanup is unavailable.",
        code: "saved_report_cleanup_unavailable"
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

function publicCountBasis(value: string): "exact-delete-count" | "pre-delete-count" {
  return value === "exact-memory-delete-count" ? "exact-delete-count" : "pre-delete-count";
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
