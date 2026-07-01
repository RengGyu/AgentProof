import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { validateVerificationReport } from "@/lib/report-validation";
import { redactSecrets } from "@/lib/redact";
import { assertSlackReportNotificationConfigured, sendSlackReportSummary, SlackNotificationError } from "@/lib/slack";
import { getTenantControlPlaneSettings } from "@/lib/tenant-control-plane";
import type { VerificationReport } from "@/lib/types";

const MAX_SLACK_REQUEST_BYTES = 120_000;

interface SlackNotificationRequest {
  report?: VerificationReport;
  reportUrl?: string;
}

export async function POST(request: Request) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL?.trim();
  const notifyToken = process.env.AGENTPROOF_NOTIFY_TOKEN?.trim();

  if (!webhookUrl || !notifyToken) {
    return noStoreJson(
      {
        error: "Slack notifications are not configured.",
        requiredEnv: ["SLACK_WEBHOOK_URL", "AGENTPROOF_NOTIFY_TOKEN"]
      },
      { status: 501 }
    );
  }

  try {
    assertSlackReportNotificationConfigured();
  } catch (error) {
    if (error instanceof SlackNotificationError && error.code === "slack_summary_webhook_invalid") {
      return noStoreJson({ error: "SLACK_WEBHOOK_URL must be a Slack incoming webhook URL." }, { status: 500 });
    }

    throw error;
  }

  if (request.headers.get("x-agentproof-notify-token") !== notifyToken) {
    return noStoreJson({ error: "Invalid notification token." }, { status: 401 });
  }

  if (!manualSlackNotificationsEnabled() || getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Manual Slack notifications are disabled.",
      code: "manual_slack_notifications_disabled"
    }, { status: 403 });
  }

  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_SLACK_REQUEST_BYTES) {
    return noStoreJson({ error: "Slack notification payload is too large." }, { status: 413 });
  }

  const body = parseJsonSafely<SlackNotificationRequest>(bodyText);
  if (!body?.report) {
    return noStoreJson({ error: "report is required." }, { status: 400 });
  }

  const validation = validateVerificationReport(body.report, { mode: reportValidationMode(body.report) });
  if (!validation.valid) {
    return noStoreJson({ error: "Report failed validation.", details: validation.errors.map(redactSecrets) }, { status: 422 });
  }

  const reportUrl = normalizeSlackReportUrl(body.reportUrl, request.url);
  if (body.reportUrl && !reportUrl) {
    return noStoreJson({ error: "reportUrl must be an HTTPS URL or a same-origin AgentProof report URL." }, { status: 400 });
  }

  try {
    await sendSlackReportSummary(body.report, { reportUrl });
  } catch (error) {
    if (error instanceof SlackNotificationError) {
      return noStoreJson({ error: redactSecrets(error.message) }, { status: 502 });
    }

    throw error;
  }

  return noStoreJson({ sent: true });
}

function reportValidationMode(report: unknown): "full" | "summary" {
  return isRecord(report) && Array.isArray(report.evidenceIndex) && report.evidenceIndex.length === 0 ? "summary" : "full";
}

function normalizeSlackReportUrl(value: string | undefined, requestUrl: string): string | undefined {
  if (!value) return undefined;

  try {
    const parsed = new URL(value, requestUrl);
    const requestOrigin = new URL(requestUrl).origin;

    if (parsed.origin === requestOrigin || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function manualSlackNotificationsEnabled(): boolean {
  return /^(1|true|yes|on)$/i.test(process.env.AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED?.trim() ?? "");
}
