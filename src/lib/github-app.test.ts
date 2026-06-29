import { createHmac, generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearGitHubWebhookDeliveriesForTests,
  completeGitHubWebhookDelivery,
  createGitHubAppJwt,
  createGitHubInstallationAccessToken,
  failGitHubWebhookDelivery,
  forgetGitHubWebhookDelivery,
  getGitHubAppConfigStatus,
  getGitHubAppAutomationSettings,
  getPublicGitHubAppReadinessStatus,
  getGitHubAppReadinessStatus,
  getGitHubWebhookIdempotencyStoreStatus,
  isGitHubPrivateKeyFormatValid,
  isGitHubAppRepoAllowed,
  markGitHubWebhookDelivery,
  normalizeGitHubPrivateKey,
  normalizeGitHubWebhookEvent,
  reserveGitHubWebhookDelivery,
  shouldHandlePullRequestAction,
  verifyGitHubWebhookSignature
} from "./github-app";

describe("github app helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
    expect(settings.saveReportsEnabled).toBe(false);
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

  it("falls back to in-memory webhook idempotency when durable env is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input = webhookDeliveryInput();

    await expect(reserveGitHubWebhookDelivery(input, 1_000)).resolves.toEqual({
      accepted: true,
      store: "memory",
      durable: false
    });
    await expect(reserveGitHubWebhookDelivery(input, 1_001)).resolves.toEqual({
      accepted: false,
      store: "memory",
      durable: false
    });
    expect(getGitHubWebhookIdempotencyStoreStatus()).toMatchObject({
      mode: "memory",
      configured: false,
      durable: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for partial durable webhook idempotency env", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL", "https://agentproof-test.supabase.co");

    expect(getGitHubWebhookIdempotencyStoreStatus()).toMatchObject({
      mode: "memory",
      configured: false,
      durable: false,
      missingEnv: expect.arrayContaining([
        expect.stringContaining("SERVICE_ROLE_KEY")
      ])
    });
    await expect(reserveGitHubWebhookDelivery(webhookDeliveryInput(), 1_000)).rejects.toThrow("incomplete");
  });

  it("uses Supabase REST for durable webhook idempotency without storing raw payloads", async () => {
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE", "webhook_deliveries_test");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return new Response(null, { status: 201 });
      if (init?.method === "PATCH") return new Response(null, { status: 204 });

      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const input = webhookDeliveryInput({
      delivery: "delivery-with-token=github_pat_secret_should_not_leak_1234567890",
      repositoryFullName: "RengGyu/AgentProof",
      headSha: "abc123def4567890"
    });

    const reservation = await reserveGitHubWebhookDelivery(input, Date.parse("2026-06-29T00:00:00Z"));
    await completeGitHubWebhookDelivery(input, {
      status: "completed",
      repository: "RengGyu/AgentProof",
      pullRequestNumber: 7,
      headSha: "abc123def4567890",
      priority: "medium",
      evidenceCoverage: 67,
      savedReport: { privacy: "summary-only", durability: "summary-only-supabase" },
      comment: { action: "updated" }
    }, Date.parse("2026-06-29T00:01:00Z"));
    const postCall = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    const postBody = JSON.parse(String(postCall?.[1]?.body));
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    const serialized = JSON.stringify({ postBody, patchBody });

    expect(reservation).toEqual({
      accepted: true,
      store: "supabase",
      durable: true
    });
    expect(String(postCall?.[0])).toBe("https://agentproof-test.supabase.co/rest/v1/webhook_deliveries_test");
    expect((postCall?.[1]?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(postBody.id).toMatch(/^[a-f0-9]{64}$/);
    expect(postBody.id).not.toContain(input.key);
    expect(postBody.status).toBe("processing");
    expect(postBody.delivery_id).toBe("unknown");
    expect(postBody.repository_full_name).toBe("RengGyu/AgentProof");
    expect(postBody.pull_request_number).toBe(7);
    expect(postBody.head_sha).toBe("abc123def4567890");
    expect(postBody).not.toHaveProperty("rawBody");
    expect(patchBody).toMatchObject({
      status: "completed",
      result_summary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123def4567890",
        priority: "medium",
        evidenceCoverage: 67,
        savedReport: {
          privacy: "summary-only",
          durability: "summary-only-supabase"
        },
        comment: {
          action: "updated"
        }
      }
    });
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("retries durable webhook idempotency rows marked failed_retryable", async () => {
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const existingUpdatedAt = "2026-06-29T00:00:00.000Z";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return new Response(null, { status: 409 });
      if (init?.method === "GET") return Response.json([{ status: "failed_retryable", updated_at: existingUpdatedAt }]);
      if (init?.method === "PATCH") return Response.json([{ status: "processing" }]);

      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reserveGitHubWebhookDelivery(webhookDeliveryInput(), 1_000)).resolves.toEqual({
      accepted: true,
      store: "supabase",
      durable: true
    });
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(String(patchCall?.[0])).toContain("status=eq.failed_retryable");
    expect(decodeURIComponent(String(patchCall?.[0]))).toContain(`updated_at=eq.${existingUpdatedAt}`);
    expect((patchCall?.[1]?.headers as Record<string, string>).Prefer).toBe("return=representation");
    expect(JSON.parse(String(patchCall?.[1]?.body)).status).toBe("processing");
  });

  it("does not accept retryable durable rows when another worker wins the conditional takeover", async () => {
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return new Response(null, { status: 409 });
      if (init?.method === "GET") return Response.json([{ status: "failed_retryable", updated_at: "2026-06-29T00:00:00.000Z" }]);
      if (init?.method === "PATCH") return Response.json([]);

      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reserveGitHubWebhookDelivery(webhookDeliveryInput(), Date.parse("2026-06-29T00:01:00Z"))).resolves.toEqual({
      accepted: false,
      store: "supabase",
      durable: true,
      duplicateStatus: "failed_retryable"
    });
  });

  it("allows durable processing rows to be retried after the processing lease expires", async () => {
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return new Response(null, { status: 409 });
      if (init?.method === "GET") return Response.json([{ status: "processing", updated_at: "2026-06-29T00:00:00.000Z" }]);
      if (init?.method === "PATCH") return Response.json([{ status: "processing" }]);

      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reserveGitHubWebhookDelivery(webhookDeliveryInput(), Date.parse("2026-06-29T00:31:00Z"))).resolves.toEqual({
      accepted: true,
      store: "supabase",
      durable: true
    });
    expect(String(fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH")?.[0])).toContain("status=eq.processing");
  });

  it("keeps durable webhook idempotency rows after retryable failures", async () => {
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? new Response(null, { status: 204 }) : new Response(null, { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(failGitHubWebhookDelivery(webhookDeliveryInput(), {
      code: "github_app_automation_failed",
      summary: "network failed [redacted]"
    }, 1_000)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      status: "failed_retryable",
      error_code: "github_app_automation_failed",
      error_summary: "network failed [redacted]"
    });
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

function webhookDeliveryInput(overrides: Partial<Parameters<typeof reserveGitHubWebhookDelivery>[0]> = {}) {
  return {
    key: "321:renggyu/agentproof:7:abc123def4567890:synchronize",
    event: "pull_request",
    delivery: "123e4567-e89b-12d3-a456-426614174000",
    installationId: 321,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber: 7,
    headSha: "abc123def4567890",
    action: "synchronize",
    ...overrides
  };
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
