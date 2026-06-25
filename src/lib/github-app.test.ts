import { createHmac, generateKeyPairSync } from "crypto";
import { describe, expect, it } from "vitest";
import {
  getGitHubAppConfigStatus,
  isGitHubPrivateKeyFormatValid,
  normalizeGitHubPrivateKey,
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
    const privateKey = testPrivateKey();

    expect(
      getGitHubAppConfigStatus({
        GITHUB_APP_ID: "123",
        GITHUB_PRIVATE_KEY: privateKey,
        GITHUB_WEBHOOK_SECRET: "secret"
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({
      appIdConfigured: true,
      privateKeyConfigured: true,
      privateKeyFormatValid: true,
      webhookSecretConfigured: true,
      ready: true
    });
  });

  it("rejects malformed private keys without exposing the value", () => {
    expect(
      getGitHubAppConfigStatus({
        GITHUB_APP_ID: "123",
        GITHUB_PRIVATE_KEY: "sha256=not-a-private-key",
        GITHUB_WEBHOOK_SECRET: "secret"
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual({
      appIdConfigured: true,
      privateKeyConfigured: true,
      privateKeyFormatValid: false,
      webhookSecretConfigured: true,
      ready: false
    });
  });

  it("accepts escaped-newline private keys for local env files", () => {
    const privateKey = testPrivateKey();
    const escapedPrivateKey = privateKey.replace(/\n/g, "\\n");

    expect(normalizeGitHubPrivateKey(escapedPrivateKey)).toBe(privateKey.trim());
    expect(isGitHubPrivateKeyFormatValid(escapedPrivateKey)).toBe(true);
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

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
