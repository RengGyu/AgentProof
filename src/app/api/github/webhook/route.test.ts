import { createHmac, generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAnalysisJobsForTests, getAnalysisJobsForTests } from "@/lib/analysis-jobs";
import { clearAuditEventsForTests, getAuditEventsForTests } from "@/lib/audit-log";
import { clearGitHubWebhookDeliveriesForTests } from "@/lib/github-app";
import {
  clearTenantGitHubInstallationsForTests,
  getTenantGitHubInstallationsForTests
} from "@/lib/github-installations";
import { clearSavedReportsForTests } from "@/lib/server-report-store";
import { clearBillingWebhookEventsForTests } from "@/lib/billing-beta";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  listTenantRepositoryGrants
} from "@/lib/tenant-control-plane";
import { clearUsageQuotaForTests } from "@/lib/usage-quota";
import { GET as GETSavedReport } from "@/app/api/reports/[id]/route";
import { POST } from "./route";

describe("POST /api/github/webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAuditEventsForTests();
    clearGitHubWebhookDeliveriesForTests();
    clearAnalysisJobsForTests();
    clearSavedReportsForTests();
    clearTenantGitHubInstallationsForTests();
    clearTenantRepositoryGrantsForTests();
    clearUsageQuotaForTests();
    clearBillingWebhookEventsForTests();
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

  it("accepts installation lifecycle events as dry-run when tenant control is disabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({
      action: "deleted",
      installation: { id: 321, token: "payload-token-should-not-leak" },
      repositories: [
        { id: 100, full_name: "RengGyu/AgentProof" }
      ]
    });

    const response = await POST(signedRequest(body, {
      event: "installation",
      delivery: "123e4567-e89b-12d3-a456-426614174101",
      secret: "secret"
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      accepted: true,
      dryRun: true,
      event: "installation",
      delivery: "123e4567-e89b-12d3-a456-426614174101",
      action: "deleted",
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      note: "GitHub App lifecycle webhook verified. Tenant control is disabled, so repository grants were not changed."
    });
    expect(serialized).not.toContain("payload-token");
    expect(serialized).not.toContain("RengGyu/AgentProof");
  });

  it("disables tenant repository grants for signed installation deleted events without token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest(JSON.stringify({
      action: "deleted",
      installation: {
        id: 321,
        token: "payload-token-should-not-leak",
        account: {
          id: 1001,
          login: "RengGyu",
          type: "User"
        }
      },
      repositories: [
        { id: 100, full_name: "RengGyu/AgentProof" }
      ],
      rawDiff: "Patch excerpt should not leak"
    }), {
      event: "installation",
      delivery: "123e4567-e89b-12d3-a456-426614174102",
      secret: "secret"
    }));
    const json = await response.json();
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_test" });
    const installations = getTenantGitHubInstallationsForTests();
    const serialized = JSON.stringify({ json, audit: getAuditEventsForTests() });

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      accepted: true,
      dryRun: false,
      event: "installation",
      delivery: "123e4567-e89b-12d3-a456-426614174102",
      action: "deleted",
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      installationId: 321,
      disabledGrantCount: 1,
      privacy: "grant-metadata-only",
      note: "GitHub App installation lifecycle disabled matching AgentProof repository grants."
    });
    expect(grants[0]).toMatchObject({
      enabled: false,
      analysisEnabled: false,
      saveReportsEnabled: false,
      commentEnabled: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(installations).toEqual([
      expect.objectContaining({
        tenantId: "tenant_test",
        installationId: 321,
        accountId: 1001,
        accountLogin: "RengGyu",
        accountType: "User",
        status: "deleted",
        deletedAt: expect.any(String)
      })
    ]);
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_installation_disabled",
      result: "completed",
      tenant_id: "tenant_test",
      installation_id: 321,
      request_id: "123e4567-e89b-12d3-a456-426614174102",
      metadata: {
        webhookAction: "deleted",
        code: "github_app_installation_disabled"
      }
    });
    expect(serialized).not.toContain("payload-token");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("RengGyu");
  });

  it("fails closed when lifecycle metadata storage is partially configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest(JSON.stringify({
      action: "deleted",
      installation: { id: 321 }
    }), {
      event: "installation",
      delivery: "123e4567-e89b-12d3-a456-426614174120",
      secret: "secret"
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub App installation metadata store is unavailable.",
      code: "github_app_installation_metadata_store_unavailable",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_lifecycle_store_unavailable",
      result: "failed",
      installation_id: 321,
      metadata: {
        webhookAction: "deleted",
        code: "github_app_installation_metadata_store_unavailable"
      }
    });
  });

  it("disables only removed repository grants for signed installation_repositories removed events", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 101,
      repositoryFullName: "RengGyu/Docs",
      saveReportsEnabled: true,
      commentEnabled: true
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest(JSON.stringify({
      action: "removed",
      installation: { id: 321 },
      repositories_removed: [
        { id: 101, full_name: "RengGyu/Docs", token: "github_pat_secret_should_not_leak_1234567890" }
      ]
    }), {
      event: "installation_repositories",
      delivery: "123e4567-e89b-12d3-a456-426614174103",
      secret: "secret"
    }));
    const json = await response.json();
    const grants = await listTenantRepositoryGrants({ tenantId: "tenant_test" });
    const serialized = JSON.stringify({ json, audit: getAuditEventsForTests() });

    expect(response.status).toBe(200);
    expect(json.disabledGrantCount).toBe(1);
    expect(json.willAnalyze).toBe(false);
    expect(json.willComment).toBe(false);
    expect(grants).toEqual([
      expect.objectContaining({
        repositoryId: 100,
        enabled: true,
        saveReportsEnabled: true,
        commentEnabled: true
      }),
      expect.objectContaining({
        repositoryId: 101,
        enabled: false,
        saveReportsEnabled: false,
        commentEnabled: false
      })
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_repository_access_removed",
      result: "completed",
      tenant_id: "tenant_test",
      metadata: {
        webhookAction: "removed",
        code: "github_app_repository_access_removed"
      }
    });
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("RengGyu/Docs");
  });

  it("fails closed for lifecycle events when the tenant grant store is unavailable", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(signedRequest(JSON.stringify({
      action: "deleted",
      installation: { id: 321 }
    }), {
      event: "installation",
      delivery: "123e4567-e89b-12d3-a456-426614174104",
      secret: "secret"
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Tenant repository grant store is unavailable.",
      code: "github_app_tenant_grant_store_unavailable",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_lifecycle_store_unavailable",
      result: "failed",
      installation_id: 321,
      metadata: {
        webhookAction: "deleted",
        code: "github_app_tenant_grant_store_unavailable"
      }
    });
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

  it("authorizes tenant webhook automation from stored repository grants by repository id", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "OldName/AgentProof",
      saveReportsEnabled: false,
      commentEnabled: false
    });
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-stored-tenant-grant",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.willAnalyze).toBe(true);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis).not.toHaveProperty("savedReport");
    expect(json.analysis).not.toHaveProperty("comment");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/321/access_tokens",
      expect.objectContaining({ method: "POST" })
    );
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_completed",
      tenant_id: "tenant_test"
    });
  });

  it("queues tenant-granted automation before fetching a GitHub installation token", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: false,
      commentEnabled: false
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://agentproof-test.supabase.co/rest/v1/analysis_jobs_test") {
        return new Response(null, { status: 201 });
      }

      return new Response(JSON.stringify({ message: `Unexpected fetch ${href}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify({
        ...automationPayload(),
        rawDiff: "Patch excerpt: + token = 'github_pat_secret_should_not_leak_1234567890'"
      }), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174300",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const queuedBody = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(queuedBody);

    expect(response.status).toBe(202);
    expect(json).toEqual(expect.objectContaining({
      ok: true,
      accepted: true,
      queued: true,
      willAnalyze: true,
      willComment: false,
      analysis: expect.objectContaining({
        status: "queued",
        jobId: expect.any(String),
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123",
        queue: {
          store: "supabase",
          durable: true
        }
      })
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.github.com/app/installations/321/access_tokens",
      expect.anything()
    );
    expect(queuedBody).toMatchObject({
      status: "queued",
      tenant_id: "tenant_test",
      idempotency_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      delivery_id: "123e4567-e89b-12d3-a456-426614174300",
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      pull_request_url: "https://github.com/RengGyu/AgentProof/pull/7",
      head_sha: "abc123",
      save_report: false,
      comment: false
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serializedBody).not.toContain("Patch excerpt");
    expect(serializedBody).not.toContain("github_pat_secret");
    expect(serializedBody).not.toContain("installation-token");
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_queued",
      result: "completed",
      tenant_id: "tenant_test",
      status_code: 202,
      metadata: {
        code: "github_app_analysis_queued_durable"
      }
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
  });

  it("clamps queued side effects to the tenant plan before Slack config or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", quotaLimitsJson({
      monthlyAnalysisLimit: 5,
      savedSummaryLinksEnabled: false,
      markerCommentsEnabled: false,
      slackSummariesEnabled: false
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://agentproof-test.supabase.co/rest/v1/analysis_jobs_test") {
        return new Response(null, { status: 201 });
      }

      return new Response(JSON.stringify({ message: `Unexpected fetch ${href}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify({
        ...automationPayload(),
        rawDiff: "Patch excerpt: + token = 'github_pat_secret_should_not_leak_1234567890'"
      }), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174301",
        secret: "secret"
      })
    );
    const json = await response.json();
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const queuedBody = JSON.parse(String(init.body));
    const serialized = JSON.stringify({ json, queuedBody });

    expect(response.status).toBe(202);
    expect(json).toEqual(expect.objectContaining({
      ok: true,
      queued: true,
      willAnalyze: true,
      willComment: false
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://api.github.com/app/installations/321/access_tokens",
      expect.anything()
    );
    expect(queuedBody).toMatchObject({
      tenant_id: "tenant_test",
      save_report: false,
      comment: false,
      slack_summary: false
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("hooks.slack.com");
    expect(serialized).not.toContain("installation-token");
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_queued",
      result: "completed",
      tenant_id: "tenant_test"
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
  });

  it("fails closed before quota, idempotency, or token fetch when queue mode lacks storage", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", quotaLimitsJson({ monthlyAnalysisLimit: 1 }));
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174301",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Analysis job queue is unavailable.",
      code: "github_app_analysis_queue_unavailable",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAnalysisJobsForTests()).toEqual([]);
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_queue_unavailable",
      result: "failed",
      tenant_id: "tenant_test",
      status_code: 503
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
  });

  it("marks durable idempotency retryable when queue enqueue fails after reservation", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://jobs.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "jobs-service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL", "https://webhooks.supabase.co");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY", "webhook-service-role-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE", "deliveries_test");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const method = init?.method ?? "GET";

      if (href.startsWith("https://webhooks.supabase.co/rest/v1/deliveries_test?expires_at=") && method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      if (href === "https://webhooks.supabase.co/rest/v1/deliveries_test" && method === "POST") {
        return new Response(null, { status: 201 });
      }

      if (href.startsWith("https://webhooks.supabase.co/rest/v1/deliveries_test?id=eq.") && method === "PATCH") {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          status: "failed_retryable",
          error_code: "github_app_analysis_queue_unavailable"
        });
        return new Response(null, { status: 204 });
      }

      if (href === "https://jobs.supabase.co/rest/v1/analysis_jobs_test" && method === "POST") {
        return new Response("queue down", { status: 500 });
      }

      return new Response(JSON.stringify({ message: `Unexpected fetch ${method} ${href}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174302",
        secret: "secret"
      })
    );
    const json = await response.json();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Analysis job queue is unavailable.",
      code: "github_app_analysis_queue_unavailable",
      willAnalyze: false,
      willComment: false
    });
    expect(urls).toEqual(expect.arrayContaining([
      "https://webhooks.supabase.co/rest/v1/deliveries_test",
      "https://jobs.supabase.co/rest/v1/analysis_jobs_test"
    ]));
    expect(urls.some((url) => url === "https://api.github.com/app/installations/321/access_tokens")).toBe(false);
    expect(getAnalysisJobsForTests()).toEqual([]);
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_queue_unavailable",
      result: "failed",
      tenant_id: "tenant_test",
      status_code: 503
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
  });

  it("does not authorize a stored tenant grant when repository id differs even if the full name matches", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    await createTenantRepositoryGrant({
      tenantId: "tenant_test",
      installationId: 321,
      repositoryId: 999,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-stored-tenant-grant-wrong-repo-id",
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when stored tenant grant lookup is unavailable before token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-tenant-grant-store-unavailable",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Tenant repository grant store is unavailable.",
      code: "github_app_tenant_grant_store_unavailable",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_grant_store_unavailable",
      result: "failed",
      status_code: 503,
      metadata: {
        code: "github_app_tenant_grant_store_unavailable"
      }
    });
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

  it("denies active grants for unavailable tenants before quota, idempotency, enqueue, or token fetch", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson());
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_TOMBSTONES", JSON.stringify(["tenant_test"]));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", quotaLimitsJson({ monthlyAnalysisLimit: 1 }));
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-guard-blocked",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      ignored: true,
      code: "github_app_tenant_grant_required",
      willAnalyze: false,
      willComment: false,
      note: "Repository grant is not active."
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAnalysisJobsForTests()).toEqual([]);
    expect(serialized).not.toContain("tenant_test");
    expect(serialized).not.toContain("deletion");
    expect(serialized).not.toContain("tombstone");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("quota");
    expect(serialized).not.toContain("token");
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

  it("blocks inactive provider billing before quota idempotency, token fetch, saved reports, or comments", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    }));
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", quotaLimitsJson({ monthlyAnalysisLimit: 5 }));
    vi.stubEnv("AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS", billingSubscriptionsJson({
      subscriptionStatus: "past_due"
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: + token = 'github_pat_secret_should_not_leak_1234567890'"
      })), {
        event: "pull_request",
        delivery: "delivery-tenant-billing-past-due",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify({ json, audit: getAuditEventsForTests() });

    expect(response.status).toBe(200);
    expect(json).toEqual(expect.objectContaining({
      ok: true,
      ignored: true,
      code: "github_app_billing_subscription_blocked",
      willAnalyze: false,
      willComment: false
    }));
    expect(json.note).toContain("subscription");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_billing_blocked",
      result: "blocked",
      tenant_id: "tenant_test",
      status_code: 200,
      metadata: {
        code: "github_app_billing_subscription_blocked"
      }
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("price_secret");
  });

  it("blocks exhausted tenant quota before durable idempotency, token fetch, saved reports, or comments", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
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
    expect(serialized).not.toContain("hooks.slack.com");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("abc123");
    const audit = getAuditEventsForTests();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "github_app_quota_blocked",
      result: "blocked",
      tenant_id: "tenant_test",
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      head_sha_prefix: "abc123",
      status_code: 200,
      metadata: {
        webhookAction: "opened",
        code: "github_app_tenant_quota_blocked"
      }
    });
    expectAuditEventIsSummaryOnly(audit[0]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks Slack summary side effects before token fetch when the webhook is missing or invalid", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: false,
      commentEnabled: false,
      slackNotificationsEnabled: true
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const missingResponse = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-slack-missing",
        secret: "secret"
      })
    );
    const missingJson = await missingResponse.json();

    expect(missingResponse.status).toBe(503);
    expect(missingJson).toEqual({
      error: "Slack summary notifications are not configured.",
      code: "slack_summary_not_configured",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();

    clearGitHubWebhookDeliveriesForTests();
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://example.com/not-slack");

    const invalidResponse = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-slack-invalid",
        secret: "secret"
      })
    );
    const invalidJson = await invalidResponse.json();
    const serialized = JSON.stringify({ missingJson, invalidJson });

    expect(invalidResponse.status).toBe(503);
    expect(invalidJson).toEqual({
      error: "Slack summary webhook URL is invalid.",
      code: "slack_summary_webhook_invalid",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("example.com/not-slack");
    expect(serialized).not.toContain("hooks.slack.com");
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_quota_blocked",
      result: "failed",
      tenant_id: "tenant_test",
      status_code: 503,
      metadata: {
        code: "github_app_tenant_quota_invalid"
      }
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_quota_unavailable",
      result: "failed",
      tenant_id: "tenant_test",
      status_code: 503,
      metadata: {
        code: "usage_quota_unavailable"
      }
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      tenant_id: null,
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      head_sha_prefix: "abc123",
      status_code: 200,
      metadata: {
        webhookAction: "opened",
        priority: expect.any(String),
        evidenceCoverage: expect.any(Number)
      }
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      tenant_id: "tenant_test",
      metadata: {
        priority: expect.any(String),
        evidenceCoverage: expect.any(Number)
      }
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      tenant_id: "tenant_test",
      metadata: {
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        }
      }
    });
    expect(JSON.stringify(getAuditEventsForTests()[0])).not.toContain(savedKey);
    expect(JSON.stringify(getAuditEventsForTests()[0])).not.toContain(savedReportUrl.toString());
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
  });

  it("requires durable audit before saved-report side effects when the gate is enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: false
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-durable-audit-required",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Durable audit storage is required before GitHub App side effects.",
      code: "github_app_durable_audit_required",
      willAnalyze: false,
      willComment: false
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()).toEqual([]);
  });

  it("requires durable audit before marker-comment side effects when the gate is enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: false,
      commentEnabled: true
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-durable-audit-comment-required",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.code).toBe("github_app_durable_audit_required");
    expect(json.willComment).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAuditEventsForTests()).toEqual([]);
  });

  it("blocks side effects before token fetch when durable audit storage is down", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: false
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "audit-service-role-secret");
    vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://agentproof-test.supabase.co/rest/v1/audit_events_test") {
        return new Response("down", { status: 500 });
      }

      return jsonResponse({ token: "should-not-be-requested" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-durable-audit-down",
        secret: "secret"
      })
    );
    const json = await response.json();
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));

    expect(response.status).toBe(503);
    expect(json.code).toBe("github_app_durable_audit_required");
    expect(urls).toEqual(["https://agentproof-test.supabase.co/rest/v1/audit_events_test"]);
    expect(urls).not.toContain("https://api.github.com/app/installations/321/access_tokens");
  });

  it("writes a durable side-effect preflight audit before creating a saved report", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson({
      saveReportsEnabled: true,
      commentEnabled: false
    }));
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "audit-service-role-secret");
    vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
    const githubFetch = mockAutomationFetch();
    const auditBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://agentproof-test.supabase.co/rest/v1/audit_events_test") {
        auditBodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      }

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-durable-audit-ready",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serializedAudit = JSON.stringify(auditBodies);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    const tokenFetchIndex = urls.indexOf("https://api.github.com/app/installations/321/access_tokens");

    expect(response.status).toBe(200);
    expect(json.analysis.savedReport.privacy).toBe("summary-only");
    expect(urls[0]).toBe("https://agentproof-test.supabase.co/rest/v1/audit_events_test");
    expect(tokenFetchIndex).toBeGreaterThan(0);
    expect(urls.indexOf("https://agentproof-test.supabase.co/rest/v1/audit_events_test")).toBeLessThan(tokenFetchIndex);
    expect(auditBodies).toHaveLength(2);
    expect(auditBodies[0]).toMatchObject({
      action: "github_app_side_effects_ready",
      result: "completed",
      tenant_id: "tenant_test",
      metadata: {
        code: "github_app_saved_report_ready",
        savedReport: {
          privacy: "summary-only"
        }
      }
    });
    expect(auditBodies[1]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      tenant_id: "tenant_test"
    });
    expect(serializedAudit).not.toContain("audit-service-role-secret");
    expect(serializedAudit).not.toContain(json.analysis.savedReport.url);
    expectAuditEventIsSummaryOnly(auditBodies[0]);
    expectAuditEventIsSummaryOnly(auditBodies[1]);
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

  it("writes bounded Supabase audit rows for completed analysis without raw webhook or report data", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "audit-service-role-secret");
    vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
    const githubFetch = mockAutomationFetch();
    const auditBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);

      if (href === "https://agentproof-test.supabase.co/rest/v1/audit_events_test") {
        auditBodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
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
    const auditBody = auditBodies[0] as Record<string, unknown>;
    const serializedAudit = JSON.stringify(auditBody);

    expect(response.status).toBe(200);
    expect(json.analysis.status).toBe("completed");
    expect(auditBodies).toHaveLength(1);
    expect(auditBody).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      tenant_id: null,
      repository_full_name: "RengGyu/AgentProof",
      installation_id: 321,
      pull_request_number: 7,
      head_sha_prefix: "abc123",
      request_id: "123e4567-e89b-12d3-a456-426614174000",
      status_code: 200
    });
    expect((auditBody.metadata as Record<string, unknown>)).toMatchObject({
      webhookAction: "opened",
      priority: expect.any(String),
      evidenceCoverage: expect.any(Number)
    });
    expect(serializedAudit).not.toContain("audit-service-role-secret");
    expectAuditEventIsSummaryOnly(auditBody);
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
    expect(getAuditEventsForTests().map((event) => event.action)).toEqual([
      "github_app_analysis_completed",
      "github_app_duplicate_skipped"
    ]);
    expect(getAuditEventsForTests()[1]).toMatchObject({
      result: "skipped",
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      head_sha_prefix: "abc123",
      status_code: 200
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[1]);
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
      tenant_id: null,
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      metadata: {
        savedReport: {
          privacy: "summary-only"
        }
      }
    });
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
  });

  it("stores tenant id on durable webhook idempotency rows for tenant-granted automation", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", tenantGrantJson());
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

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890"
      })), {
        event: "pull_request",
        delivery: "123e4567-e89b-12d3-a456-426614174777",
        secret: "secret"
      })
    );
    const json = await response.json();
    const postBody = JSON.parse(String(supabaseCalls.find((call) => call[1]?.method === "POST")?.[1]?.body));
    const serialized = JSON.stringify({ json, postBody });

    expect(response.status).toBe(200);
    expect(json.analysis.status).toBe("completed");
    expect(postBody).toMatchObject({
      tenant_id: "tenant_test",
      status: "processing",
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7
    });
    expect(postBody.id).toMatch(/^[a-f0-9]{64}$/);
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("Patch excerpt");
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
    expect(getAuditEventsForTests()[0]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      metadata: {
        comment: {
          action: "created"
        }
      }
    });
    expect(JSON.stringify(getAuditEventsForTests()[0])).not.toContain("agentproof:github-app:evidence-check:v1");
    expect(JSON.stringify(getAuditEventsForTests()[0])).not.toContain("issuecomment-777");
    expectAuditEventIsSummaryOnly(getAuditEventsForTests()[0]);
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

function expectAuditEventIsSummaryOnly(event: unknown) {
  const serialized = JSON.stringify(event);

  expect(serialized).not.toContain("Patch excerpt");
  expect(serialized).not.toContain("github_pat_secret");
  expect(serialized).not.toContain("payload-token");
  expect(serialized).not.toContain("installation-token");
  expect(serialized).not.toContain("service-role-secret");
  expect(serialized).not.toContain("evidenceIndex");
  expect(serialized).not.toContain("claims");
  expect(serialized).not.toContain("reprompt");
  expect(serialized).not.toContain("rawDiff");
  expect(serialized).not.toContain("comment_body");
}

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

function billingSubscriptionsJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify([
    {
      tenantId: "tenant_test",
      provider: "stripe",
      providerCustomerId: "cus_secret_should_not_leak",
      providerSubscriptionId: "sub_secret_should_not_leak",
      providerPriceId: "price_secret_should_not_leak",
      subscriptionStatus: "active",
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
