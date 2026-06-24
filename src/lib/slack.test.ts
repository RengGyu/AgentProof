import { describe, expect, it } from "vitest";
import { demoScenarios } from "./sample-data";
import { isAllowedSlackWebhookUrl, neutralizeSlackMentions, reportToSlackPayload } from "./slack";
import { generateVerificationReport } from "./verifier";

describe("slack helpers", () => {
  it("formats summary-only payloads", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
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
    expect(payloadText).toContain("summary report");
  });

  it("neutralizes broad Slack mentions", () => {
    expect(neutralizeSlackMentions("@channel <!here> @teammate")).toBe("@​channel @​here @​teammate");
  });

  it("only allows Slack incoming webhook URLs", () => {
    expect(isAllowedSlackWebhookUrl("https://hooks.slack.com/services/T/B/C")).toBe(true);
    expect(isAllowedSlackWebhookUrl("https://example.com/services/T/B/C")).toBe(false);
  });
});
