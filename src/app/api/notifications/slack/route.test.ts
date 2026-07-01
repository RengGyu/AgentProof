import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { POST } from "./route";

describe("POST /api/notifications/slack", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled unless Slack env and a notification token are configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );

    expect(response.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the notification token before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps manual Slack notifications disabled unless explicitly allowed", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Manual Slack notifications are disabled.",
      code: "manual_slack_notifications_disabled"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks manual Slack notifications when tenant control is enabled", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("manual_slack_notifications_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized notification payloads before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: "x".repeat(121_000)
      })
    );
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.error).toContain("too large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects full reports with missing provenance before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("scope.evidenceRefs is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redacts validation details before returning them", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.requirements[0].evidenceRefs = ["github_pat_secret_should_not_leak_1234567890"];

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report })
      })
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(422);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts summary-only reports for summary notifications", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = decodeSharedReport(encodeReportForShare(generateVerificationReport(demoScenarios["scope-creep"])));

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report })
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects unsafe report URLs before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({
          report: generateVerificationReport(demoScenarios.clean),
          reportUrl: "javascript:alert(1)"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
