import { getGitHubAppConfigStatus, normalizeGitHubWebhookEvent, verifyGitHubWebhookSignature } from "@/lib/github-app";
import { noStoreJson, parseJsonSafely } from "@/lib/http";

const ALLOWED_EVENTS = new Set(["pull_request", "check_run", "check_suite", "status", "ping"]);
const MAX_WEBHOOK_BODY_BYTES = 400_000;

export async function POST(request: Request) {
  const config = getGitHubAppConfigStatus();

  if (!config.webhookSecretConfigured) {
    return noStoreJson({ error: "GitHub App webhook is not configured.", config }, { status: 501 });
  }

  const rawBody = await request.text();

  if (new TextEncoder().encode(rawBody).length > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), process.env.GITHUB_WEBHOOK_SECRET ?? "")) {
    return noStoreJson({ error: "Invalid GitHub webhook signature." }, { status: 401 });
  }

  const meta = normalizeGitHubWebhookEvent(request.headers);
  if (!ALLOWED_EVENTS.has(meta.event)) {
    return noStoreJson({ ok: true, ignored: true, event: meta.event, delivery: meta.delivery });
  }

  const payload = parseJsonSafely<Record<string, unknown>>(rawBody);

  return noStoreJson({
    ok: true,
    accepted: true,
    event: meta.event,
    delivery: meta.delivery,
    action: typeof payload?.action === "string" ? payload.action : undefined,
    note: "Webhook verified. Automated GitHub App actions stay disabled until installation-token handling and idempotency storage are added."
  });
}
