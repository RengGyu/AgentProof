import { createHmac, generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGitHubWebhookDeliveriesForTests } from "@/lib/github-app";
import { clearSavedReportsForTests } from "@/lib/server-report-store";
import { clearUsageQuotaForTests } from "@/lib/usage-quota";
import { GET as GETSavedReport } from "@/app/api/reports/[id]/route";
import { POST } from "./route";

describe("POST /api/github/webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubWebhookDeliveriesForTests();
    clearSavedReportsForTests();
    clearUsageQuotaForTests();
  });

  it("is disabled until a webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        body: JSON.stringify({ action: "opened" })
      })
    );

    expect(response.status).toBe(501);
    const json = await response.json();
    expect(json).toEqual({
      error: "GitHub App webhook is not configured.",
      code: "github_webhook_not_configured"
    });
    expect(JSON.stringify(json)).not.toContain("privateKey");
  });

  it("rejects tampered signatures", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify({ action: "opened" });
    const signature = `sha256=${createHmac("sha256", "secret").update(`${body}tampered`).digest("hex")}`;

    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery"
        },
        body
      })
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects missing signatures", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({ action: "opened" });

    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery"
        },
        body
      })
    );

    expect(response.status).toBe(401);
  });

  it("accepts valid pull_request events as dry-run metadata only", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "RengGyu/AgentProof" },
      pull_request: {
        number: 4,
        html_url: "https://github.com/RengGyu/AgentProof/pull/4",
        title: "Sensitive title should not be echoed"
      },
      rawDiff: "Patch excerpt: + secret = 'do-not-return'",
      installation: { token: "do-not-return" }
    });

    const response = await POST(
      signedRequest(body, {
        event: "pull_request",
        delivery: "delivery-pr",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      accepted: true,
      dryRun: true,
      event: "pull_request",
      delivery: "delivery-pr",
      action: "opened",
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      summary: {
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 4,
        pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/4"
      },
      note: "Webhook verified. Automated GitHub App actions stay disabled until automation is explicitly enabled for an allowed repository."
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("Sensitive title");
  });

  it("accepts check_run and status events without enabling automation", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const checkBody = JSON.stringify({
      action: "completed",
      repository: { full_name: "RengGyu/AgentProof" },
      check_run: { name: "CI test/build evidence verification sk-secret1234" }
    });
    const statusBody = JSON.stringify({
      context: "CI test/build evidence verification token=ghp_123456789012345678901234",
      repository: { full_name: "RengGyu/AgentProof" }
    });

    const checkResponse = await POST(
      signedRequest(checkBody, {
        event: "check_run",
        delivery: "delivery-check",
        secret: "secret"
      })
    );
    const statusResponse = await POST(
      signedRequest(statusBody, {
        event: "status",
        delivery: "delivery-status",
        secret: "secret"
      })
    );

    await expect(checkResponse.json()).resolves.toEqual(expect.objectContaining({
      accepted: true,
      dryRun: true,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      summary: expect.objectContaining({
        repository: "RengGyu/AgentProof",
        checkRunName: "CI test/build evidence verification [redacted]"
      })
    }));
    await expect(statusResponse.json()).resolves.toEqual(expect.objectContaining({
      accepted: true,
      dryRun: true,
      automationEnabled: false,
      summary: expect.objectContaining({
        repository: "RengGyu/AgentProof",
        statusContext: "CI test/build evidence verification [redacted]"
      })
    }));
  });

  it("ignores unsupported signed events without parsing or taking action", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = "{not-json";

    const response = await POST(
      signedRequest(body, {
        event: "issues",
        delivery: "delivery-issues",
        secret: "secret"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ignored: true,
      dryRun: true,
      event: "issues",
      delivery: "delivery-issues",
      automationEnabled: false,
      note: "Event ignored. Automated GitHub App actions are disabled."
    });
  });

  it("rejects malformed JSON for supported events after signature verification", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const response = await POST(
      signedRequest("{not-json", {
        event: "pull_request",
        delivery: "delivery-bad-json",
        secret: "secret"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub webhook payload must be a JSON object."
    });
  });

  it("rejects oversized payloads before accepting a signed webhook", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({ action: "opened", filler: "x".repeat(400_001) });
    const response = await POST(
      signedRequest(body, {
        event: "pull_request",
        delivery: "delivery-large",
        secret: "secret"
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub webhook payload is too large."
    });
  });

  it("rejects oversized content-length before requiring a valid signature", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "content-length": "400001",
          "x-hub-signature-256": "sha256=not-a-real-signature",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-large-header"
        },
        body: JSON.stringify({ action: "opened" })
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub webhook payload is too large."
    });
  });

  it("keeps dry-run behavior when App credentials exist but automation is not enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-dry-run",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.automationEnabled).toBe(false);
    expect(json.dryRun).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when automation is enabled but App credentials are incomplete", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-missing-app",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "GitHub App automation is enabled, but App credentials are incomplete or invalid.",
      code: "github_app_not_ready",
      willAnalyze: false,
      willComment: false
    });
    expect(serialized).not.toContain("appIdConfigured");
    expect(serialized).not.toContain("privateKeyFormatValid");
    expect(serialized).not.toContain("webhookSecretConfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects pull_request payloads whose PR URL does not match repository metadata before fetching tokens", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        pull_request: {
          number: 7,
          html_url: "https://github.com/Other/Repo/pull/7",
          title: "Mismatched PR URL should not be trusted",
          head: { sha: "abc123" }
        }
      })), {
        event: "pull_request",
        delivery: "delivery-mismatched-pr-url",
        secret: "secret"
      })
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub pull_request webhook payload is missing required automation fields or has mismatched repository metadata.",
      code: "github_app_payload_invalid",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects pull_request PR-number mismatches with a generic no-secret response before fetching tokens", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890",
        installation: { id: 321, token: "installation-token-should-not-leak" },
        pull_request: {
          number: 7,
          html_url: "https://github.com/RengGyu/AgentProof/pull/8?token=ghp_secret_should_not_leak_1234567890",
          title: "Secret title token=sk-secret-should-not-leak",
          head: { sha: "abc123" }
        }
      })), {
        event: "pull_request",
        delivery: "delivery-mismatched-pr-number",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(422);
    expect(json).toEqual({
      error: "GitHub pull_request webhook payload is missing required automation fields or has mismatched repository metadata.",
      code: "github_app_payload_invalid",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("ghp_secret");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("Secret title");
    expect(serialized).not.toContain("sk-secret");
  });

  it("ignores automation for repositories outside the allowlist before fetching tokens", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "other/repo");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-not-allowed",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ignored).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an active tenant grant before legacy allowlists, durable idempotency, or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "*");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-grant-missing",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      ignored: true,
      code: "github_app_tenant_grant_required",
      willAnalyze: false,
      willComment: false
    }));
    expect(json.note).toContain("No active tenant repository grant");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies disabled tenant grants before durable idempotency or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({ enabled: false }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-grant-disabled",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      ignored: true,
      code: "github_app_tenant_grant_required",
      willAnalyze: false,
      willComment: false
    }));
    expect(json.note).toContain("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denies analysis-disabled tenant grants before durable idempotency or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({ analysisEnabled: false }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-grant-analysis-disabled",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      ignored: true,
      code: "github_app_tenant_grant_required",
      willAnalyze: false,
      willComment: false
    }));
    expect(json.note).toContain("analysis is disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for invalid tenant grant configuration before token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", "{not-json");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-grants-invalid",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual(expect.objectContaining({
      ok: false,
      code: "github_app_tenant_grants_invalid",
      willAnalyze: false,
      willComment: false
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks exhausted tenant quota before durable idempotency, token fetch, saved reports, or comments", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: true
    }));
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", quotaLimitsJson({ monthlyAnalysisLimit: 0 }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-quota-exhausted",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      ok: true,
      ignored: true,
      code: "github_app_tenant_quota_blocked",
      willAnalyze: false,
      willComment: false
    }));
    expect(json.note).toContain("quota");
    expect(json).not.toHaveProperty("analysis");
    expect(serialized).not.toContain("tenant_test");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("abc123");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed for invalid tenant quota configuration before durable idempotency or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson());
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", "{not-json");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890"
      })), {
        event: "pull_request",
        delivery: "delivery-tenant-quota-invalid",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual(expect.objectContaining({
      ok: false,
      code: "github_app_tenant_quota_invalid",
      willAnalyze: false,
      willComment: false
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("{not-json");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("fails closed when tenant quota store is unavailable before idempotency or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson());
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", quotaLimitsJson({ monthlyAnalysisLimit: 10 }));
    vi.stubEnv("AGENTPROOF_USAGE_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response("quota down", { status: 500 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-quota-store-down",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual(expect.objectContaining({
      code: "usage_quota_unavailable",
      willAnalyze: false,
      willComment: false
    }));
    expect(json).not.toHaveProperty("analysis");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_reserve_usage_quota"
    );
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("tenant_test");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("abc123");
  });

  it("ignores unsupported pull_request actions before fetching tokens", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({ action: "closed" })), {
        event: "pull_request",
        delivery: "delivery-closed",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ignored).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not save GitHub App automation reports unless saved reports are explicitly enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-analyze-no-save",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.willAnalyze).toBe(true);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis).not.toHaveProperty("savedReport");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("allows tenant-granted analysis without legacy allowlist and respects grant-level save/comment opt-ins", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: false,
      commentEnabled: false
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-granted-no-side-effects",
        secret: "secret"
      })
    );
    const json = await response.json();
    const commentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/issues/7/comments")
    );

    expect(response.status).toBe(200);
    expect(json.willAnalyze).toBe(true);
    expect(json.willComment).toBe(false);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis).not.toHaveProperty("savedReport");
    expect(json.analysis).not.toHaveProperty("comment");
    expect(commentCalls).toHaveLength(0);
  });

  it("creates tenant-scoped saved reports for tenant-granted webhook automation", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: false
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-granted-save",
        secret: "secret"
      })
    );
    const json = await response.json();
    const savedReportUrl = new URL(json.analysis.savedReport.url);
    const savedId = savedReportUrl.pathname.split("/").at(-1) ?? "";
    const savedKey = savedReportUrl.searchParams.get("key") ?? "";
    const noKeyResponse = await GETSavedReport(new Request(`http://localhost/api/reports/${savedId}`), {
      params: Promise.resolve({ id: savedId })
    });
    const keyResponse = await GETSavedReport(new Request(`http://localhost/api/reports/${savedId}?key=${savedKey}`), {
      params: Promise.resolve({ id: savedId })
    });
    const keyJson = await keyResponse.json();
    const serialized = JSON.stringify({ webhook: json, saved: keyJson });

    expect(response.status).toBe(200);
    expect(json.analysis.savedReport.privacy).toBe("summary-only");
    expect(savedKey).toBeTruthy();
    expect(noKeyResponse.status).toBe(404);
    expect(keyResponse.status).toBe(200);
    expect(keyJson.report.evidenceIndex).toEqual([]);
    expect(keyJson.report.claims).toEqual([]);
    expect(keyJson.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(serialized).not.toContain("tenant_test");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("omits raw automation network error messages before returning 502", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);

      if (href === "https://api.github.com/app/installations/321/access_tokens") {
        return jsonResponse({ token: "installation-token" });
      }

      throw new Error("network failed token=github_pat_error_should_not_leak_1234567890");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-redacted-error",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(502);
    expect(json.code).toBe("github_app_automation_failed");
    expect(serialized).toContain("GitHub metadata request timed out or network failed");
    expect(serialized).not.toContain("network failed token=");
    expect(serialized).not.toContain("github_pat_error");
  });

  it("analyzes signed pull_request events with an installation token and saves summary-only reports", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890",
        installation: { id: 321, token: "payload-token-should-not-leak" }
      })), {
        event: "pull_request",
        delivery: "delivery-analyze",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.dryRun).toBe(false);
    expect(json.automationEnabled).toBe(true);
    expect(json.willAnalyze).toBe(true);
    expect(json.willComment).toBe(false);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis.repository).toBe("RengGyu/AgentProof");
    expect(json.analysis.savedReport.privacy).toBe("summary-only");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("payload-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/321/access_tokens",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("skips duplicate pull_request automation for the same PR head SHA and action", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify(automationPayload());

    const first = await POST(signedRequest(body, {
      event: "pull_request",
      delivery: "delivery-duplicate-1",
      secret: "secret"
    }));
    const callCount = fetchMock.mock.calls.length;
    const second = await POST(signedRequest(body, {
      event: "pull_request",
      delivery: "delivery-duplicate-2",
      secret: "secret"
    }));
    const json = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(json.duplicate).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(callCount);
  });

  it("does not treat changed PR head SHA or action as duplicate automation", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(signedRequest(JSON.stringify(automationPayload({
      action: "opened"
    })), {
      event: "pull_request",
      delivery: "delivery-dimensions-1",
      secret: "secret"
    }));
    const second = await POST(signedRequest(JSON.stringify(automationPayload({
      action: "synchronize",
      pull_request: {
        number: 7,
        html_url: "https://github.com/RengGyu/AgentProof/pull/7",
        title: "Webhook title should not be trusted",
        head: { sha: "def456" }
      }
    })), {
      event: "pull_request",
      delivery: "delivery-dimensions-2",
      secret: "secret"
    }));
    const firstJson = await first.json();
    const secondJson = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstJson.duplicate).not.toBe(true);
    expect(secondJson.duplicate).not.toBe(true);
    expect(firstJson.analysis.status).toBe("completed");
    expect(secondJson.analysis.status).toBe("completed");
    expect(fetchMock.mock.calls.filter((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toHaveLength(2);
  });

  it("fails closed before token fetch when durable webhook idempotency storage is unavailable", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });

      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174000",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "GitHub App idempotency store is unavailable.",
      code: "github_app_idempotency_unavailable",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toBe(false);
  });

  it("skips duplicate pull_request automation from durable webhook idempotency before token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (init?.method === "POST") return new Response(null, { status: 409 });
      if (init?.method === "GET") return Response.json([{ status: "processing" }]);

      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890",
        installation: { id: 321, token: "payload-token-should-not-leak" }
      })), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174000",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.duplicate).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(json.analysis.status).toBe("skipped");
    expect(json.analysis.reason).toContain("already in progress");
    expect(json.analysis).not.toHaveProperty("savedReport");
    expect(json.analysis).not.toHaveProperty("comment");
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toBe(false);
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("payload-token");
  });

  it("records completed durable webhook idempotency metadata without raw payloads", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE", "webhook_deliveries_test");
    const githubFetch = mockAutomationFetch();
    const supabaseCalls: Array<[string, RequestInit | undefined]> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);

      if (href.startsWith("https://agentproof-test.supabase.co/rest/v1/webhook_deliveries_test")) {
        supabaseCalls.push([href, init]);
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "POST") return new Response(null, { status: 201 });
        if (init?.method === "PATCH") return new Response(null, { status: 204 });
      }

      if (href.startsWith("https://agentproof-test.supabase.co/rest/v1/agentproof_saved_reports")) {
        const row = JSON.parse(String(init?.body));

        return Response.json([row]);
      }

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890",
        installation: { id: 321, token: "payload-token-should-not-leak" }
      })), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174000",
        secret: "secret"
      })
    );
    const json = await response.json();
    const postBody = JSON.parse(String(supabaseCalls.find((call) => call[1]?.method === "POST")?.[1]?.body));
    const patchBody = JSON.parse(String(supabaseCalls.find((call) => call[1]?.method === "PATCH")?.[1]?.body));
    const serialized = JSON.stringify({ postBody, patchBody, json });

    expect(response.status).toBe(200);
    expect(json.analysis.status).toBe("completed");
    expect(postBody).toMatchObject({
      status: "processing",
      event: "pull_request",
      delivery_id: "123e4567-e89b-12d3-a456-426614174000",
      installation_id: 321,
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      head_sha: "abc123",
      action: "opened"
    });
    expect(postBody.id).toMatch(/^[a-f0-9]{64}$/);
    expect(patchBody).toMatchObject({
      status: "completed",
      result_summary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123",
        priority: expect.any(String),
        evidenceCoverage: expect.any(Number),
        savedReport: {
          privacy: "summary-only"
        }
      }
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("payload-token");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("creates a GitHub App marker comment only when comment opt-in is enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-comment",
        secret: "secret"
      })
    );
    const json = await response.json();
    const commentPost = fetchMock.mock.calls.find((call) =>
      String(call[0]) === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" &&
      (call[1] as RequestInit | undefined)?.method === "POST"
    );

    expect(response.status).toBe(200);
    expect(json.analysis.comment.action).toBe("created");
    expect(json.analysis.comment.url).toContain("issuecomment-777");
    expect(String((commentPost?.[1] as RequestInit).body)).toContain("agentproof:github-app:evidence-check:v1");
    expect(String((commentPost?.[1] as RequestInit).body)).not.toContain("Agent re-prompt");
  });

  it("suppresses GitHub App comments and saved reports for signed live webhook smoke payloads", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        agentproofSmoke: {
          mode: "live-analysis",
          suppressComment: true,
          suppressSavedReport: true,
          sentinel: "github_pat_secret_should_not_leak_1234567890"
        }
      })), {
        event: "pull_request",
        delivery: "delivery-live-smoke",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const commentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/issues/7/comments")
    );

    expect(response.status).toBe(200);
    expect(json.willAnalyze).toBe(true);
    expect(json.willComment).toBe(false);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis).not.toHaveProperty("comment");
    expect(json.analysis).not.toHaveProperty("savedReport");
    expect(commentCalls).toHaveLength(0);
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("keeps live smoke comments suppressed when saved reports are explicitly allowed", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890",
        installation: { id: 321, token: "payload-token-should-not-leak" },
        agentproofSmoke: {
          mode: "live-analysis",
          suppressComment: true,
          suppressSavedReport: false,
          sentinel: "github_pat_secret_should_not_leak_1234567890"
        }
      })), {
        event: "pull_request",
        delivery: "delivery-live-smoke-save-allowed",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const commentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/issues/7/comments")
    );

    expect(response.status).toBe(200);
    expect(json.willAnalyze).toBe(true);
    expect(json.willComment).toBe(false);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis.savedReport.privacy).toBe("summary-only");
    expect(json.analysis).not.toHaveProperty("comment");
    expect(commentCalls).toHaveLength(0);
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("payload-token");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });
});

function signedRequest(
  body: string,
  options: { event: string; delivery: string; secret: string }
): Request {
  const signature = `sha256=${createHmac("sha256", options.secret).update(body).digest("hex")}`;

  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    headers: {
      "x-hub-signature-256": signature,
      "x-github-event": options.event,
      "x-github-delivery": options.delivery
    },
    body
  });
}

function automationPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    repository: {
      id: 100,
      full_name: "RengGyu/AgentProof"
    },
    pull_request: {
      number: 7,
      html_url: "https://github.com/RengGyu/AgentProof/pull/7",
      title: "Webhook title should not be trusted",
      head: { sha: "abc123" }
    },
    installation: { id: 321 },
    ...overrides
  };
}

function mockAutomationFetch() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";

    if (href === "https://api.github.com/app/installations/321/access_tokens") {
      return jsonResponse({ token: "installation-token" });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7") {
      return jsonResponse({
        title: "Fetched PR title",
        body: "Acceptance criteria: add signed webhook-triggered AgentProof analysis. Save only summary reports. Keep automated comments opt-in.",
        url: "https://api.github.com/repos/RengGyu/AgentProof/pulls/7",
        user: { login: "agent-author" },
        base: { ref: "main" },
        head: { ref: "feature/app-automation", sha: "abc123" }
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7/files?per_page=100&page=1") {
      return jsonResponse([
        {
          filename: "src/app/api/github/webhook/route.ts",
          additions: 30,
          deletions: 2,
          status: "modified",
          patch: "@@ -1 +1 @@\n+ signed webhook-triggered AgentProof analysis"
        }
      ]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123/check-runs?per_page=100&page=1") {
      return jsonResponse({
        total_count: 1,
        check_runs: [
          {
            id: 999,
            name: "CI test/build evidence verification",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/RengGyu/AgentProof/actions/runs/1",
            details_url: "https://github.com/RengGyu/AgentProof/actions/runs/1",
            output: { summary: "pnpm test, typecheck, and build passed" }
          }
        ]
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123/status") {
      return jsonResponse({ statuses: [] });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/actions/runs/1/jobs?per_page=100") {
      return jsonResponse({
        jobs: [
          {
            name: "CI test/build evidence verification",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/RengGyu/AgentProof/actions/runs/1/job/2",
            steps: [
              { name: "Test", status: "completed", conclusion: "success" },
              { name: "Build", status: "completed", conclusion: "success" }
            ]
          }
        ]
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments?per_page=100&page=1") {
      return jsonResponse([]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && method === "POST") {
      return jsonResponse({ html_url: "https://github.com/RengGyu/AgentProof/pull/7#issuecomment-777" });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${method} ${href}` }), { status: 404 });
  });
}

function tenantGrantJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify([
    {
      tenantId: "tenant_test",
      installationId: 321,
      repositoryFullName: "RengGyu/AgentProof",
      enabled: true,
      analysisEnabled: true,
      saveReportsEnabled: true,
      commentEnabled: false,
      ...overrides
    }
  ]);
}

function quotaLimitsJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify([
    {
      tenantId: "tenant_test",
      monthlyAnalysisLimit: 1,
      enabled: true,
      plan: "team",
      ...overrides
    }
  ]);
}

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  });
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
