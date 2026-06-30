import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { GET } from "./route";

describe("GET /api/ops/github-app/status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearAnalysisJobsForTests();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const response = await GET(new Request("http://localhost/api/ops/github-app/status"));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
  });

  it("rejects invalid operator tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "wrong-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    });
    expect(JSON.stringify(json)).not.toContain("ops-secret-value");
  });

  it("does not authenticate with query-string operator tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status?token=ops-secret-value"));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    });
    expect(serialized).not.toContain("ops-secret-value");
  });

  it("returns bounded operator diagnostics without secret values, repo names, or table names", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "false");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "false");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE", "private_delivery_table");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual({
      mode: "analysis-ready",
      signedIntake: "ready",
      appCredentials: "ready",
      automation: "enabled",
      repoScope: "configured",
      commentOptIn: "disabled",
      savedReportOptIn: "disabled",
      idempotency: "durable-supabase",
      installationMetadata: "disabled",
      analysisQueue: "disabled",
      cautions: []
    });
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("private_delivery_table");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("reports incomplete durable idempotency without exposing missing env names", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL", "https://agentproof-test.supabase.co");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      mode: "dry-run",
      signedIntake: "ready",
      appCredentials: "not-ready",
      automation: "disabled",
      repoScope: "missing",
      idempotency: "config-incomplete",
      installationMetadata: "disabled",
      analysisQueue: "disabled",
      cautions: expect.arrayContaining([
        "Durable duplicate suppression is partially configured and should fail closed."
      ])
    }));
    expect(serialized).not.toContain("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL");
    expect(serialized).not.toContain("SERVICE_ROLE_KEY");
  });

  it("reports GitHub installation metadata store status without exposing env or table names", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_TABLE", "private_installations_table");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      installationMetadata: "config-incomplete",
      cautions: expect.arrayContaining([
        "GitHub installation metadata storage is partially configured and should fail closed."
      ])
    }));
    expect(serialized).not.toContain("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL");
    expect(serialized).not.toContain("private_installations_table");
    expect(serialized).not.toContain("agentproof-test.supabase.co");
    expect(serialized).not.toContain("ops-secret-value");
  });

  it("reports durable GitHub installation metadata storage without exposing store internals", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_TABLE", "private_installations_table");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      installationMetadata: "durable-supabase"
    }));
    expect(serialized).not.toContain("AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL");
    expect(serialized).not.toContain("private_installations_table");
    expect(serialized).not.toContain("agentproof-test.supabase.co");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("warns when tenant control is configured without installation metadata storage", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      installationMetadata: "disabled",
      cautions: expect.arrayContaining([
        "GitHub installation metadata storage is disabled while tenant onboarding or control-plane mode is configured."
      ])
    }));
  });

  it("warns when GitHub installation metadata uses memory-only storage", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      installationMetadata: "memory-only",
      cautions: expect.arrayContaining([
        "GitHub installation metadata is using memory-only storage; use durable storage for beta/SaaS onboarding."
      ])
    }));
  });

  it("reports analysis queue status without exposing queue env or table names", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "private_jobs_table");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      analysisQueue: "config-incomplete",
      cautions: expect.arrayContaining([
        "Analysis job queue is enabled but storage is not fully configured."
      ])
    }));
    expect(serialized).not.toContain("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL");
    expect(serialized).not.toContain("private_jobs_table");
    expect(serialized).not.toContain("ops-secret-value");
  });

  it("returns aggregate queue summary metrics without exposing queued job internals", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "raw-idempotency-key-should-not-store",
      deliveryId: "123e4567-e89b-12d3-a456-426614174300",
      event: "pull_request",
      action: "opened",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7",
      headSha: "abc123",
      saveReport: true,
      comment: false,
      now: new Date("2026-06-30T00:00:00Z")
    });
    Object.assign(getAnalysisJobsForTests()[0], {
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
      run_after: "2020-01-01T00:00:00.000Z"
    });

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toMatchObject({
      analysisQueue: "memory-only",
      analysisQueueAlertBasis: "sampled_rows",
      analysisQueueSummary: {
        privacy: "analysis-job-queue-summary-only",
        sampled: 1,
        truncated: false,
        counts: {
          queued: 1,
          processing: 0,
          completed: 0,
          failed_retryable: 0,
          failed_terminal: 0
        },
        due: 1,
        delayedRetry: 0,
        staleProcessing: 0,
        oldestQueuedAgeSeconds: expect.any(Number)
      },
      analysisQueueAlerts: expect.arrayContaining([
        {
          code: "analysis_queue_backlog",
          severity: "warning",
          metric: "oldestQueuedAgeSeconds",
          count: expect.any(Number),
          threshold: 900
        }
      ])
    });
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("installation_id");
    expect(serialized).not.toContain("pull_request_url");
    expect(serialized).not.toContain("raw-idempotency-key");
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("webhook-secret-value");
  });

  it("returns aggregate queue alerts without exposing failed job internals", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "terminal-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174300",
      event: "pull_request",
      action: "opened",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7",
      headSha: "abc123",
      saveReport: true,
      comment: false,
      now: new Date("2026-06-30T00:00:00Z")
    });
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "stale-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      event: "pull_request",
      action: "synchronize",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/8",
      headSha: "def456",
      saveReport: false,
      comment: false,
      now: new Date("2026-06-30T00:00:00Z")
    });
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "queued-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      event: "pull_request",
      action: "synchronize",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 9,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/9",
      headSha: "fed789",
      saveReport: false,
      comment: false,
      now: new Date("2026-06-30T00:00:00Z")
    });
    Object.assign(getAnalysisJobsForTests()[0], {
      status: "failed_terminal",
      error_code: "github_fetch_failed",
      error_summary: "Failed for https://github.com/RengGyu/AgentProof/pull/7?token=secret_should_not_leak"
    });
    Object.assign(getAnalysisJobsForTests()[1], {
      status: "processing",
      locked_at: "2020-01-01T00:00:00.000Z"
    });
    Object.assign(getAnalysisJobsForTests()[2], {
      run_after: "2020-01-01T00:00:00.000Z"
    });

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp.analysisQueueAlertBasis).toBe("sampled_rows");
    expect(json.githubApp.analysisQueueAlerts).toEqual(expect.arrayContaining([
      {
        code: "analysis_queue_failed_terminal",
        severity: "warning",
        metric: "counts.failed_terminal",
        count: 1,
        threshold: 1
      },
      {
        code: "analysis_queue_stale_processing",
        severity: "warning",
        metric: "staleProcessing",
        count: 1,
        threshold: 1
      },
      {
        code: "analysis_queue_backlog",
        severity: "warning",
        metric: "oldestQueuedAgeSeconds",
        count: expect.any(Number),
        threshold: 900
      }
    ]));
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("github_fetch_failed");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("pull_request_url");
    expect(serialized).not.toContain("terminal-job-idempotency");
    expect(serialized).not.toContain("idempotency_key_hash");
    expect(serialized).not.toContain("delivery_id");
  });

  it("uses an info alert for due jobs below the backlog threshold", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "small-due-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174303",
      event: "pull_request",
      action: "opened",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 10,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10",
      headSha: "a1b2c3",
      saveReport: true,
      comment: false,
      now: new Date()
    });

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.githubApp.analysisQueueAlerts).toEqual([
      {
        code: "analysis_queue_due_jobs",
        severity: "info",
        metric: "due",
        count: 1,
        threshold: 1
      }
    ]);
  });

  it("omits queue alerts when no aggregate alert condition is present", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "completed-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174304",
      event: "pull_request",
      action: "opened",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 11,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/11",
      headSha: "b1c2d3",
      saveReport: true,
      comment: false,
      now: new Date("2026-06-30T00:00:00Z")
    });
    Object.assign(getAnalysisJobsForTests()[0], {
      status: "completed",
      completed_at: "2026-06-30T00:01:00.000Z"
    });

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.githubApp.analysisQueueAlertBasis).toBe("sampled_rows");
    expect(json.githubApp.analysisQueueAlerts).toBeUndefined();
    expect(json.githubApp.analysisQueueSummary.counts.completed).toBe(1);
  });

  it("warns when queue summary metrics are truncated", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    for (let index = 0; index < 1000; index += 1) {
      await enqueueAnalysisJob({
        tenantId: "tenant_a",
        idempotencyKey: `truncated-job-${index}`,
        deliveryId: `123e4567-e89b-12d3-a456-42661417${String(index).padStart(4, "0")}`,
        event: "pull_request",
        action: "opened",
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/AgentProof",
        pullRequestNumber: index + 1,
        pullRequestUrl: `https://github.com/RengGyu/AgentProof/pull/${index + 1}`,
        headSha: "abc123",
        saveReport: true,
        comment: false,
        now: new Date("2026-06-30T00:00:00Z")
      });
    }

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp.analysisQueueSummary.truncated).toBe(true);
    expect(json.githubApp.analysisQueueAlerts).toEqual(expect.arrayContaining([
      {
        code: "analysis_queue_summary_truncated",
        severity: "warning",
        metric: "sampled",
        count: 1000,
        threshold: 1000
      }
    ]));
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("github_fetch_failed");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("pull_request_url");
    expect(serialized).not.toContain("truncated-job-");
    expect(serialized).not.toContain("idempotency_key_hash");
    expect(serialized).not.toContain("delivery_id");
  });
});

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
