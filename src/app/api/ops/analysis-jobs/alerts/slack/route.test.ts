import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { POST } from "./route";

describe("POST /api/ops/analysis-jobs/alerts/slack", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST"
    }));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid operator tokens before reading Slack or queue state", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "wrong-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    });
    expect(serialized).not.toContain("ops-secret-value");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not authenticate with query-string operator tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request(
      "http://localhost/api/ops/analysis-jobs/alerts/slack?token=ops-secret-value",
      { method: "POST" }
    ));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    });
    expect(serialized).not.toContain("ops-secret-value");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires Slack webhook configuration after operator auth", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Slack queue alerts are not configured.",
      code: "analysis_queue_slack_not_configured"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid Slack webhook URLs before sending", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://example.com/services/T/B/C");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(500);
    expect(json).toEqual({
      error: "SLACK_WEBHOOK_URL must be a Slack incoming webhook URL.",
      code: "analysis_queue_slack_webhook_invalid"
    });
    expect(serialized).not.toContain("https://example.com");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a summary-only no-op when the queue is disabled", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      sent: false,
      privacy: "analysis-queue-alert-summary-only",
      status: "disabled",
      reason: "analysis_job_queue_disabled"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when queue mode is enabled but storage is incomplete", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Analysis job queue is unavailable.",
      code: "analysis_worker_queue_unavailable"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send info-only due-job alerts by default", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ now: new Date() }));

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      sent: false,
      privacy: "analysis-queue-alert-summary-only",
      status: "no_alerts",
      alertCount: 1,
      warningCount: 0,
      infoCount: 1,
      deliveredAlertCount: 0
    });
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can send info alerts only when explicitly requested", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ now: new Date() }));

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack?includeInfo=true", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const payloadText = String(init.body);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      sent: true,
      privacy: "analysis-queue-alert-summary-only",
      status: "sent",
      deliveredAlertCount: 1,
      deliveredWarningCount: 0,
      deliveredInfoCount: 1
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/C",
      expect.objectContaining({ method: "POST" })
    );
    expect(payloadText).toContain("analysis_queue_due_jobs");
    expect(payloadText).not.toContain("RengGyu/AgentProof");
    expect(payloadText).not.toContain("tenant_a");
  });

  it("sends warning alerts with aggregate-only Slack payloads", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await enqueueAnalysisJob(jobInput({ idempotencyKey: "terminal-job-idempotency" }));
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "stale-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/8",
      headSha: "def456"
    }));
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "queued-job-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 9,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/9",
      headSha: "fed789"
    }));
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
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:00.000Z",
      run_after: "2020-01-01T00:00:00.000Z"
    });

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serializedResponse = JSON.stringify(json);
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const payloadText = String(init.body);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      sent: true,
      privacy: "analysis-queue-alert-summary-only",
      status: "sent",
      deliveredWarningCount: 3,
      deliveredInfoCount: 0,
      sampled: 3,
      truncated: false
    });
    expect(payloadText).toContain("analysis_queue_failed_terminal");
    expect(payloadText).toContain("analysis_queue_stale_processing");
    expect(payloadText).toContain("analysis_queue_backlog");
    expect(payloadText).toContain("Summary-only ops alert");
    expect(serializedResponse).not.toContain("ops-secret-value");
    expect(serializedResponse).not.toContain("RengGyu/AgentProof");
    expect(payloadText).not.toContain("RengGyu/AgentProof");
    expect(payloadText).not.toContain("tenant_a");
    expect(payloadText).not.toContain("secret_should_not_leak");
    expect(payloadText).not.toContain("pull_request_url");
    expect(payloadText).not.toContain("terminal-job-idempotency");
    expect(payloadText).not.toContain("github_fetch_failed");
    expect(payloadText).not.toContain("evidenceIndex");
    expect(payloadText).not.toContain("claims");
    expect(payloadText).not.toContain("reprompt");
    expect(payloadText).not.toContain("Patch excerpt");
  });

  it("does not return Slack response bodies when the webhook fails", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn(async () => new Response("channel secret_should_not_leak", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ idempotencyKey: "terminal-job-idempotency" }));
    Object.assign(getAnalysisJobsForTests()[0], { status: "failed_terminal" });

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(serialized).toContain("Slack webhook returned HTTP 503");
    expect(serialized).not.toContain("channel secret_should_not_leak");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores request bodies and derives queue alerts only from server state", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ idempotencyKey: "terminal-job-idempotency" }));
    Object.assign(getAnalysisJobsForTests()[0], {
      status: "failed_terminal",
      error_summary: "Repo https://github.com/RengGyu/AgentProof/pull/7?token=secret_should_not_leak"
    });

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        repositoryFullName: "RengGyu/AgentProof",
        tenantId: "tenant_a",
        evidenceIndex: [{ id: "raw", text: "Patch excerpt" }],
        claims: ["claim should not leak"],
        reprompt: "raw re-prompt should not leak",
        token: "github_pat_secret_should_not_leak_1234567890"
      })
    }));
    const json = await response.json();
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const payloadText = String(init.body);
    const combined = `${JSON.stringify(json)} ${payloadText}`;

    expect(response.status).toBe(200);
    expect(json.sent).toBe(true);
    expect(payloadText).toContain("analysis_queue_failed_terminal");
    expect(combined).not.toContain("RengGyu/AgentProof");
    expect(combined).not.toContain("tenant_a");
    expect(combined).not.toContain("Patch excerpt");
    expect(combined).not.toContain("claim should not leak");
    expect(combined).not.toContain("raw re-prompt");
    expect(combined).not.toContain("github_pat_secret");
    expect(combined).not.toContain("secret_should_not_leak");
  });
});

function jobInput(overrides: Partial<{
  idempotencyKey: string;
  deliveryId: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  now: Date;
}> = {}) {
  return {
    tenantId: "tenant_a",
    idempotencyKey: overrides.idempotencyKey ?? "raw-idempotency-key-should-not-store",
    deliveryId: overrides.deliveryId ?? "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "opened",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber: overrides.pullRequestNumber ?? 7,
    pullRequestUrl: overrides.pullRequestUrl ?? "https://github.com/RengGyu/AgentProof/pull/7",
    headSha: overrides.headSha ?? "abc123",
    saveReport: true,
    comment: false,
    now: overrides.now ?? new Date("2026-06-30T00:00:00Z")
  };
}
