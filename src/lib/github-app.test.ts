import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  getGitHubAppConfigStatus,
  normalizeGitHubWebhookEvent,
  verifyGitHubWebhookSignature
} from "./github-app";

describe("github app helpers", () => {
  it("verifies raw-body webhook signatures", () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const secret = "webhook-secret";
    const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(`${body} `, signature, secret)).toBe(false);
  });

  it("reports config readiness without exposing secrets", () => {
    expect(
      getGitHubAppConfigStatus({
        GITHUB_APP_ID: "123",
        GITHUB_PRIVATE_KEY: "private",
        GITHUB_WEBHOOK_SECRET: "secret"
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({
      appIdConfigured: true,
      privateKeyConfigured: true,
      webhookSecretConfigured: true,
      ready: true
    });
  });

  it("normalizes webhook headers", () => {
    const headers = new Headers({
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-id"
    });

    expect(normalizeGitHubWebhookEvent(headers)).toEqual({
      event: "pull_request",
      delivery: "delivery-id"
    });
  });
});
