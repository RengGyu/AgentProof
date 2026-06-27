import { normalizeGitHubWebhookEvent, verifyGitHubWebhookSignature } from "@/lib/github-app";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { redactSecrets } from "@/lib/redact";

const ALLOWED_EVENTS = new Set(["pull_request", "check_run", "check_suite", "status", "ping"]);
const MAX_WEBHOOK_BODY_BYTES = 400_000;

export async function POST(request: Request) {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET ?? "";

  if (!webhookSecret.trim()) {
    return noStoreJson({
      error: "GitHub App webhook is not configured.",
      code: "github_webhook_not_configured"
    }, { status: 501 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentLength > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  const rawBody = await request.text();

  if (utf8ByteLength(rawBody) > MAX_WEBHOOK_BODY_BYTES) {
    return noStoreJson({ error: "GitHub webhook payload is too large." }, { status: 413 });
  }

  if (!verifyGitHubWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), webhookSecret)) {
    return noStoreJson({ error: "Invalid GitHub webhook signature." }, { status: 401 });
  }

  const meta = normalizeGitHubWebhookEvent(request.headers);
  if (!ALLOWED_EVENTS.has(meta.event)) {
    return noStoreJson({
      ok: true,
      ignored: true,
      dryRun: true,
      event: safeWebhookString(meta.event),
      delivery: safeWebhookString(meta.delivery),
      automationEnabled: false,
      note: "Event ignored. Automated GitHub App actions are disabled."
    });
  }

  const payload = parseJsonSafely<Record<string, unknown>>(rawBody);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return noStoreJson({ error: "GitHub webhook payload must be a JSON object." }, { status: 400 });
  }

  return noStoreJson({
    ok: true,
    accepted: true,
    dryRun: true,
    event: safeWebhookString(meta.event),
    delivery: safeWebhookString(meta.delivery),
    action: safeWebhookString(typeof payload?.action === "string" ? payload.action : undefined),
    automationEnabled: false,
    willAnalyze: false,
    willComment: false,
    summary: buildWebhookDryRunSummary(payload),
    note: "Webhook verified. Automated GitHub App actions stay disabled until installation-token handling and idempotency storage are added."
  });
}

function buildWebhookDryRunSummary(payload: Record<string, unknown>) {
  const repository = getNestedRecord(payload, "repository");
  const pullRequest = getNestedRecord(payload, "pull_request");
  const checkRun = getNestedRecord(payload, "check_run");
  const statusContext = safeWebhookString(typeof payload.context === "string" ? payload.context : undefined);

  return {
    repository: getString(repository, "full_name"),
    pullRequestNumber: getNumber(pullRequest, "number"),
    pullRequestUrl: getString(pullRequest, "html_url"),
    checkRunName: getString(checkRun, "name"),
    statusContext
  };
}

function getNestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = parent[key];

  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function getString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];

  return safeWebhookString(typeof value === "string" ? value : undefined);
}

function getNumber(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeWebhookString(value: string | undefined): string | undefined {
  return value ? redactSecrets(value).slice(0, 500) : undefined;
}
