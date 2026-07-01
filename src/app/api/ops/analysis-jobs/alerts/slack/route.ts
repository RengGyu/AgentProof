import { AnalysisJobQueueError, getAnalysisJobQueueStatus, getAnalysisJobQueueSummary } from "@/lib/analysis-jobs";
import { countAnalysisQueueAlerts, toAnalysisQueueAlerts } from "@/lib/analysis-job-alerts";
import { analysisQueueAlertsToSlackPayload, isAllowedSlackWebhookUrl } from "@/lib/slack";
import { noStoreJson } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";

const SLACK_TIMEOUT_MS = 5000;

export async function POST(request: Request) {
  const auth = verifyOpsRequest(request);
  if (!auth.ok) return auth.response;

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return noStoreJson({
      error: "Slack queue alerts are not configured.",
      code: "analysis_queue_slack_not_configured"
    }, { status: 501 });
  }

  if (!isAllowedSlackWebhookUrl(webhookUrl)) {
    return noStoreJson({
      error: "SLACK_WEBHOOK_URL must be a Slack incoming webhook URL.",
      code: "analysis_queue_slack_webhook_invalid"
    }, { status: 500 });
  }

  const queue = getAnalysisJobQueueStatus();
  if (!queue.enabled) {
    return noStoreJson({
      sent: false,
      privacy: "analysis-queue-alert-summary-only",
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
    const summary = await getAnalysisJobQueueSummary();
    if (!summary) {
      return noStoreJson({
        error: "Analysis job queue summary is unavailable.",
        code: "analysis_queue_summary_unavailable"
      }, { status: 503 });
    }

    const allAlerts = toAnalysisQueueAlerts(summary);
    const deliverableAlerts = shouldIncludeInfoAlerts(request)
      ? allAlerts
      : allAlerts.filter((alert) => alert.severity === "warning");
    const allCounts = countAnalysisQueueAlerts(allAlerts);
    const deliveredCounts = countAnalysisQueueAlerts(deliverableAlerts);

    if (deliverableAlerts.length === 0) {
      return noStoreJson({
        sent: false,
        privacy: "analysis-queue-alert-summary-only",
        status: "no_alerts",
        alertCount: allCounts.total,
        warningCount: allCounts.warning,
        infoCount: allCounts.info,
        deliveredAlertCount: 0
      });
    }

    const slackResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(analysisQueueAlertsToSlackPayload({
        summary,
        alerts: deliverableAlerts
      })),
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS)
    });

    if (!slackResponse.ok) {
      return noStoreJson({
        error: `Slack webhook returned HTTP ${slackResponse.status}.`,
        code: "analysis_queue_slack_webhook_failed"
      }, { status: 502 });
    }

    return noStoreJson({
      sent: true,
      privacy: "analysis-queue-alert-summary-only",
      status: "sent",
      deliveredAlertCount: deliveredCounts.total,
      deliveredWarningCount: deliveredCounts.warning,
      deliveredInfoCount: deliveredCounts.info,
      sampled: summary.sampled,
      truncated: summary.truncated
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

function shouldIncludeInfoAlerts(request: Request): boolean {
  const value = new URL(request.url).searchParams.get("includeInfo");
  return value === "true";
}
