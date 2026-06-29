import { createHmac, generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGitHubWebhookDeliveriesForTests,
  createGitHubAppJwt,
  createGitHubInstallationAccessToken,
  forgetGitHubWebhookDelivery,
  getGitHubAppConfigStatus,
  getGitHubAppAutomationSettings,
  getPublicGitHubAppReadinessStatus,
  getGitHubAppReadinessStatus,
  isGitHubPrivateKeyFormatValid,
  isGitHubAppRepoAllowed,
  markGitHubWebhookDelivery,
  normalizeGitHubPrivateKey,
  normalizeGitHubWebhookEvent,
  shouldHandlePullRequestAction,
  verifyGitHubWebhookSignature
} from "./github-app";

describe("github app helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGitHubWebhookDeliveriesForTests();
  });

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

  it("creates a GitHub App JWT without exposing the private key", () => {
    const privateKey = testPrivateKey();
    const token = createGitHubAppJwt({
      GITHUB_APP_ID: "12345",
      GITHUB_PRIVATE_KEY: privateKey
    } as unknown as NodeJS.ProcessEnv, 1_700_000_000);
    const [header, payload, signature] = token.split(".");

    expect(header).toBeTruthy();
    expect(payload).toBeTruthy();
    expect(signature).toBeTruthy();
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: "12345"
    });
    expect(token).not.toContain("BEGIN");
  });

  it("requests an installation token with an app JWT", async () => {
    const privateKey = testPrivateKey();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "installation-token" })));
    vi.stubGlobal("fetch", fetchMock);

    const token = await createGitHubInstallationAccessToken(321, {
      GITHUB_APP_ID: "12345",
      GITHUB_PRIVATE_KEY: privateKey
    } as unknown as NodeJS.ProcessEnv);

    expect(token).toBe("installation-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/321/access_tokens",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/)
        })
      })
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("installation-token");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("BEGIN");
  });

  it("fails closed before token fetch when app credentials are invalid", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createGitHubInstallationAccessToken(321, {
      GITHUB_APP_ID: "12345",
      GITHUB_PRIVATE_KEY: "sha256=not-a-private-key"
    } as unknown as NodeJS.ProcessEnv)).rejects.toThrow("incomplete or invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses automation settings and repo allowlists", () => {
    const settings = getGitHubAppAutomationSettings({
      AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED: "true",
      AGENTPROOF_GITHUB_APP_COMMENT_ENABLED: "false",
      AGENTPROOF_GITHUB_APP_ALLOWED_REPOS: "RengGyu/AgentProof, other/repo"
    } as unknown as NodeJS.ProcessEnv);

    expect(settings.enabled).toBe(true);
    expect(settings.commentEnabled).toBe(false);
    expect(isGitHubAppRepoAllowed("renggyu/agentproof", settings)).toBe(true);
    expect(isGitHubAppRepoAllowed("unknown/repo", settings)).toBe(false);
  });

  it("reports non-secret readiness status for dry-run and automation modes", () => {
    const dryRun = getGitHubAppReadinessStatus({
      GITHUB_WEBHOOK_SECRET: "secret"
    } as unknown as NodeJS.ProcessEnv);
    const ready = getGitHubAppReadinessStatus({
      GITHUB_WEBHOOK_SECRET: "secret",
      GITHUB_APP_ID: "123",
      GITHUB_PRIVATE_KEY: testPrivateKey(),
      AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED: "true",
      AGENTPROOF_GITHUB_APP_ALLOWED_REPOS: "RengGyu/AgentProof",
      AGENTPROOF_GITHUB_APP_SAVE_REPORTS: "true"
    } as unknown as NodeJS.ProcessEnv);

    expect(dryRun).toEqual(expect.objectContaining({
      mode: "dry-run",
      signedIntakeReady: true,
      canAnalyzePullRequests: false,
      allowedRepoCount: 0
    }));
    expect(ready).toEqual(expect.objectContaining({
      mode: "analysis-ready",
      appCredentialsReady: true,
      automationEnabled: true,
      saveReportsEnabled: true,
      allowedRepoCount: 1,
      canAnalyzePullRequests: true,
      canPostComments: false
    }));
    expect(JSON.stringify(ready)).not.toContain("BEGIN PRIVATE KEY");
    expect(JSON.stringify(ready)).not.toContain("secret");
  });

  it("keeps public readiness status coarse enough for public UI and smoke probes", () => {
    const publicStatus = getPublicGitHubAppReadinessStatus({
      GITHUB_WEBHOOK_SECRET: "secret-value",
      GITHUB_APP_ID: "123",
      GITHUB_PRIVATE_KEY: testPrivateKey(),
      AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED: "true",
      AGENTPROOF_GITHUB_APP_ALLOWED_REPOS: "RengGyu/AgentProof,other/repo",
      AGENTPROOF_GITHUB_APP_COMMENT_ENABLED: "true",
      AGENTPROOF_GITHUB_APP_SAVE_REPORTS: "true"
    } as unknown as NodeJS.ProcessEnv);
    const serialized = JSON.stringify(publicStatus);

    expect(publicStatus).toEqual(expect.objectContaining({
      mode: "event-mode",
      label: "Event mode ready"
    }));
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("analysis-and-comment-ready");
    expect(serialized).not.toContain("allowedRepoCount");
    expect(serialized).not.toContain("appCredentialsReady");
    expect(serialized).not.toContain("saveReportsEnabled");
  });

  it("tracks webhook idempotency keys without storing payloads", () => {
    expect(markGitHubWebhookDelivery("installation:repo:1:sha:opened", 1_000)).toBe(true);
    expect(markGitHubWebhookDelivery("installation:repo:1:sha:opened", 1_001)).toBe(false);
    expect(forgetGitHubWebhookDelivery("installation:repo:1:sha:opened")).toBe(true);
    expect(markGitHubWebhookDelivery("installation:repo:1:sha:opened", 1_002)).toBe(true);
  });

  it("limits automated pull request actions to verification-relevant events", () => {
    expect(shouldHandlePullRequestAction("opened")).toBe(true);
    expect(shouldHandlePullRequestAction("synchronize")).toBe(true);
    expect(shouldHandlePullRequestAction("ready_for_review")).toBe(true);
    expect(shouldHandlePullRequestAction("edited")).toBe(false);
    expect(shouldHandlePullRequestAction("closed")).toBe(false);
    expect(shouldHandlePullRequestAction("labeled")).toBe(false);
  });
});

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
