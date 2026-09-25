import { timingSafeEqual } from "crypto";
import { noStoreJson } from "@/lib/http";
import { cleanupExpiredGitHubSessionCredentials, TenantAuthStoreError } from "@/lib/tenant-auth";

export async function GET(request: Request) {
  const tokens = [process.env.CRON_SECRET?.trim(), process.env.AGENTPROOF_CRON_TOKEN?.trim()].filter((value): value is string => Boolean(value));
  if (tokens.length === 0) return noStoreJson({ ok: true, status: "disabled", reason: "cron_auth_not_configured" });

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const header = request.headers.get("x-agentproof-cron-token");
  const authorized = [bearer, header].some((candidate) => candidate && tokens.some((token) => {
    const left = Buffer.from(candidate);
    const right = Buffer.from(token);
    return left.length === right.length && timingSafeEqual(left, right);
  }));
  if (!authorized) return noStoreJson({ error: "Unauthorized cron request.", code: "github_session_cleanup_unauthorized" }, { status: 401 });

  try {
    const processedCount = await cleanupExpiredGitHubSessionCredentials();
    return noStoreJson({ ok: true, status: "ran", processedCount });
  } catch (error) {
    if (error instanceof TenantAuthStoreError) return noStoreJson({ error: "GitHub session cleanup is unavailable.", code: "github_session_cleanup_unavailable" }, { status: 503 });
    throw error;
  }
}
