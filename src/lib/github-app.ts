import { createHmac, createPrivateKey, timingSafeEqual } from "crypto";

export interface GitHubAppConfigStatus {
  appIdConfigured: boolean;
  privateKeyConfigured: boolean;
  privateKeyFormatValid: boolean;
  webhookSecretConfigured: boolean;
  ready: boolean;
}

export function getGitHubAppConfigStatus(env = process.env): GitHubAppConfigStatus {
  const privateKeyConfigured = Boolean(env.GITHUB_PRIVATE_KEY?.trim());
  const privateKeyFormatValid = privateKeyConfigured
    ? isGitHubPrivateKeyFormatValid(env.GITHUB_PRIVATE_KEY)
    : false;
  const status = {
    appIdConfigured: Boolean(env.GITHUB_APP_ID),
    privateKeyConfigured,
    privateKeyFormatValid,
    webhookSecretConfigured: Boolean(env.GITHUB_WEBHOOK_SECRET)
  };

  return {
    ...status,
    ready: status.appIdConfigured && status.privateKeyConfigured && status.privateKeyFormatValid && status.webhookSecretConfigured
  };
}

export function normalizeGitHubPrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

export function isGitHubPrivateKeyFormatValid(value: string | undefined): boolean {
  if (!value?.trim()) {
    return false;
  }

  try {
    createPrivateKey(normalizeGitHubPrivateKey(value));
    return true;
  } catch {
    return false;
  }
}

export function verifyGitHubWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !secret) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(signatureHeader);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

export function normalizeGitHubWebhookEvent(headers: Headers) {
  return {
    event: headers.get("x-github-event") ?? "unknown",
    delivery: headers.get("x-github-delivery") ?? "unknown"
  };
}
