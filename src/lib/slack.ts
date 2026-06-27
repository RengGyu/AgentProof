import { sanitizeReportForShare } from "./report-share";
import type { VerificationReport } from "./types";

export interface SlackWebhookPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

export function reportToSlackPayload(report: VerificationReport, reportUrl?: string): SlackWebhookPayload {
  const safeReport = sanitizeReportForShare(report);
  const topRisks = safeReport.summary.topRisks.slice(0, 3).map((risk) => `- ${risk}`).join("\n");
  const priorities = safeReport.reviewPriority
    .slice(0, 3)
    .map((item) => `- ${item.priority.toUpperCase()}: ${item.path}`)
    .join("\n");

  return {
    text: `AgentProof ${safeReport.summary.priority.toUpperCase()}: ${neutralizeSlackMentions(safeReport.summary.oneLine)}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: truncateSlackText(`AgentProof ${safeReport.summary.priority.toUpperCase()} evidence check`, 150)
        }
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: truncateSlackText(neutralizeSlackMentions(safeReport.summary.oneLine), 3000)
        }
      },
      {
        type: "section",
        fields: [
          { type: "plain_text", text: `Coverage: ${safeReport.summary.evidenceCoverage}%` },
          { type: "plain_text", text: `Confidence: ${Math.round(safeReport.summary.confidence * 100)}%` },
          { type: "plain_text", text: `Test/build: ${safeReport.testing.ciStatus}` },
          { type: "plain_text", text: `Missing tests: ${safeReport.testing.missingTests.length}` }
        ]
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: truncateSlackText(`Top risks\n${topRisks || "- No major risks detected."}`, 3000)
        }
      },
      {
        type: "section",
        text: {
          type: "plain_text",
          text: truncateSlackText(`Review priority\n${priorities || "- No priority files detected."}`, 3000)
        }
      },
      ...(reportUrl
        ? [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `<${escapeSlackLinkUrl(reportUrl)}|Open summary report>`
              }
            }
          ]
        : []),
      {
        type: "context",
        elements: [
          {
            type: "plain_text",
            text: "Summary-only notification. Raw evidence, logs, claims, and re-prompt text are omitted."
          }
        ]
      }
    ]
  };
}

export function isAllowedSlackWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

export function neutralizeSlackMentions(value: string): string {
  return value
    .replace(/@(channel|here|everyone)\b/gi, "@\u200B$1")
    .replace(/<!?(channel|here|everyone)[^>]*>/gi, "@\u200B$1")
    .replace(/@(?=[a-z0-9][a-z0-9._-]{0,80}\b)/gi, "@\u200B");
}

function truncateSlackText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function escapeSlackLinkUrl(value: string): string {
  return value.replace(/[|>\n\r]/g, encodeURIComponent);
}
