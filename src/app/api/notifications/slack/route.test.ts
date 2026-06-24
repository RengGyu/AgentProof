import { afterEach, describe, expect, it, vi } from "vitest";
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
});
