import { noStoreJson, parseJsonSafely } from "@/lib/http";
import { validateVerificationReport } from "@/lib/report-validation";
import { isAllowedSlackWebhookUrl, reportToSlackPayload } from "@/lib/slack";
import type { VerificationReport } from "@/lib/types";

const MAX_SLACK_REQUEST_BYTES = 120_000;
const SLACK_TIMEOUT_MS = 5000;

interface SlackNotificationRequest {
  report?: VerificationReport;
  reportUrl?: string;
}

export async function POST(request: Request) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const notifyToken = process.env.AGENTPROOF_NOTIFY_TOKEN;

  if (!webhookUrl || !notifyToken) {
    return noStoreJson(
      {
        error: "Slack notifications are not configured.",
        requiredEnv: ["SLACK_WEBHOOK_URL", "AGENTPROOF_NOTIFY_TOKEN"]
      },
      { status: 501 }
    );
  }

  if (!isAllowedSlackWebhookUrl(webhookUrl)) {
    return noStoreJson({ error: "SLACK_WEBHOOK_URL must be a Slack incoming webhook URL." }, { status: 500 });
  }

  if (request.headers.get("x-agentproof-notify-token") !== notifyToken) {
    return noStoreJson({ error: "Invalid notification token." }, { status: 401 });
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_SLACK_REQUEST_BYTES) {
    return noStoreJson({ error: "Slack notification payload is too large." }, { status: 413 });
  }

  const body = parseJsonSafely<SlackNotificationRequest>(bodyText);
  if (!body?.report) {
    return noStoreJson({ error: "report is required." }, { status: 400 });
  }

  const validation = validateVerificationReport(body.report);
  if (!validation.valid) {
    return noStoreJson({ error: "Report failed validation.", details: validation.errors }, { status: 422 });
  }

  const slackResponse = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reportToSlackPayload(body.report, body.reportUrl)),
    signal: AbortSignal.timeout(SLACK_TIMEOUT_MS)
  });

  if (!slackResponse.ok) {
    return noStoreJson({ error: `Slack webhook returned HTTP ${slackResponse.status}.` }, { status: 502 });
  }

  return noStoreJson({ sent: true });
}
