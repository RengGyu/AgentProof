import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import {
  analysisQueueAlertsToSlackPayload,
  isAllowedSlackWebhookUrl,
  neutralizeSlackMentions,
  reportToSlackPayload
} from "./slack";
import { generateVerificationReport } from "./verifier";

describe("slack helpers", () => {
  it("formats summary-only payloads", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.summary.oneLine = "@channel verify github_pat_secret_should_not_leak_1234567890";
    report.summary.topRisks = ["Risk has sk-secret_should_not_leak"];
    report.testing.missingTests.push({
      path: "src/github_pat_secret_should_not_leak_1234567890/test.ts",
      why: "Needs api_key=secret_should_not_leak",
      evidenceRefs: []
    });
    report.reviewPriority.push({
      path: "src/review.ts",
      reason: "Review has https://hooks.slack.com/services/T000/B000/secret",
      priority: "high"
    });
    report.claims.push({
      id: "claim_raw",
      text: "Added raw claim that should not leave the report boundary.",
      evidenceRefs: [],
      supported: false
    });
    const payloadText = JSON.stringify(reportToSlackPayload(report, "https://agentproof.example/reports/1"));

    expect(payloadText).not.toContain("Patch excerpt");
    expect(payloadText).not.toContain(report.reprompt.prompt);
    expect(payloadText).not.toContain("Added raw claim");
    expect(payloadText).not.toContain("github_pat_secret");
    expect(payloadText).not.toContain("sk-secret");
    expect(payloadText).not.toContain("hooks.slack.com/services");
    expect(payloadText).not.toContain("secret_should_not_leak");
    expect(payloadText).toContain("[redacted]");
    expect(payloadText).toContain("@​channel");
    expect(payloadText).toContain("Test/build:");
    expect(payloadText).toContain("summary report");
  });

  it("escapes Slack markdown link delimiters in report URLs", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const payloadText = JSON.stringify(reportToSlackPayload(report, "https://agentproof.example/reports/1|bad>"));

    expect(payloadText).toContain("https://agentproof.example/reports/1%7Cbad%3E");
    expect(payloadText).not.toContain("1|bad>");
  });

  it("neutralizes broad Slack mentions", () => {
    expect(neutralizeSlackMentions("@channel <!here> @teammate")).toBe("@​channel @​here @​teammate");
  });

  it("only allows Slack incoming webhook URLs", () => {
    expect(isAllowedSlackWebhookUrl("https://hooks.slack.com/services/T/B/C")).toBe(true);
    expect(isAllowedSlackWebhookUrl("https://example.com/services/T/B/C")).toBe(false);
  });

  it("formats analysis queue alerts as aggregate-only payloads", () => {
    const payloadText = JSON.stringify(analysisQueueAlertsToSlackPayload({
      summary: {
        privacy: "analysis-job-queue-summary-only",
        sampled: 3,
        truncated: false,
        counts: {
          queued: 1,
          processing: 1,
          completed: 0,
          failed_retryable: 0,
          failed_terminal: 1
        },
        due: 1,
        delayedRetry: 0,
        staleProcessing: 1,
        oldestQueuedAgeSeconds: 1000
      },
      alerts: [
        {
          code: "analysis_queue_failed_terminal",
          severity: "warning",
          metric: "counts.failed_terminal",
          count: 1,
          threshold: 1
        },
        {
          code: "analysis_queue_backlog",
          severity: "warning",
          metric: "oldestQueuedAgeSeconds",
          count: 1000,
          threshold: 900
        }
      ]
    }));

    expect(payloadText).toContain("analysis queue WARNING");
    expect(payloadText).toContain("Failed terminal: 1");
    expect(payloadText).toContain("analysis_queue_backlog");
    expect(payloadText).toContain("Summary-only ops alert");
    expect(payloadText).not.toContain("RengGyu/AgentProof");
    expect(payloadText).not.toContain("tenant_a");
    expect(payloadText).not.toContain("https://github.com");
    expect(payloadText).not.toContain("evidenceIndex");
    expect(payloadText).not.toContain("claims");
    expect(payloadText).not.toContain("reprompt");
    expect(payloadText).not.toContain("Patch excerpt");
    expect(payloadText).not.toContain("github_pat_");
  });
});
