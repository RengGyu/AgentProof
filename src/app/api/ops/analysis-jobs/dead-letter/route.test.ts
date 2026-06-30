import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { GET } from "./route";

describe("GET /api/ops/analysis-jobs/dead-letter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter"));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid operator tokens and query-string tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const invalidHeader = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter", {
      headers: { "x-agentproof-ops-token": "wrong-token" }
    }));
    const queryToken = await GET(new Request(
      "http://localhost/api/ops/analysis-jobs/dead-letter?token=ops-secret-value"
    ));
    const serialized = JSON.stringify([await invalidHeader.json(), await queryToken.json()]);

    expect(invalidHeader.status).toBe(401);
    expect(queryToken.status).toBe(401);
    expect(serialized).not.toContain("ops-secret-value");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a summary-only disabled response when the queue is disabled", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-job-dead-letter-summary-only",
      status: "disabled",
      reason: "analysis_job_queue_disabled"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when queue mode is enabled but storage is incomplete", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter", {
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

  it("returns terminal failure distribution without job internals", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob(jobInput());
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "terminal-idempotency-2",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/8",
      headSha: "def456"
    }));
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "queued-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 9,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/9",
      headSha: "fed789"
    }));
    Object.assign(getAnalysisJobsForTests()[0], {
      status: "failed_terminal",
      updated_at: "2026-06-30T00:00:00.000Z",
      error_code: "grant_denied",
      error_summary: "Repo https://github.com/RengGyu/AgentProof/pull/7?token=secret_should_not_leak"
    });
    Object.assign(getAnalysisJobsForTests()[1], {
      status: "failed_terminal",
      updated_at: "2026-06-30T00:01:00.000Z",
      error_code: "github_fetch_failed",
      error_summary: "Patch excerpt should not leak"
    });

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter?limit=25", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "analysis-job-dead-letter-summary-only",
      status: "ready",
      summary: {
        privacy: "analysis-job-dead-letter-summary-only",
        basis: "failed_terminal_recent_sample",
        sampled: 2,
        truncated: false,
        sampledTerminalCount: 2,
        topErrorCodes: [
          { errorCode: "github_fetch_failed", count: 1 },
          { errorCode: "grant_denied", count: 1 }
        ]
      }
    });
    expect(json.summary.oldestTerminalAgeSeconds).toEqual(expect.any(Number));
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("pull_request_url");
    expect(serialized).not.toContain("pullRequestNumber");
    expect(serialized).not.toContain("headSha");
    expect(serialized).not.toContain("terminal-idempotency");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("error_summary");
    expect(serialized).not.toContain("delivery_id");
  });

  it("returns an empty ready summary when there are no terminal failures", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob(jobInput());

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-job-dead-letter-summary-only",
      status: "ready",
      summary: {
        privacy: "analysis-job-dead-letter-summary-only",
        basis: "failed_terminal_recent_sample",
        sampled: 0,
        truncated: false,
        sampledTerminalCount: 0,
        topErrorCodes: []
      }
    });
  });

  it("uses a narrow durable Supabase projection and clamps large limits", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const fetchMock = vi.fn(async () => Response.json([
      { error_code: "grant_denied", updated_at: "2026-06-30T00:00:00.000Z" }
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter?limit=999999", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "analysis-job-dead-letter-summary-only",
      summary: {
        sampled: 1,
        sampledTerminalCount: 1,
        topErrorCodes: [{ errorCode: "grant_denied", count: 1 }]
      }
    });
    expect(url).toContain("status=eq.failed_terminal");
    expect(url).toContain("select=error_code%2Cupdated_at");
    expect(url).toContain("limit=1001");
    expect(url).not.toContain("id");
    expect(url).not.toContain("tenant");
    expect(url).not.toContain("repository");
    expect(url).not.toContain("pull_request");
    expect(url).not.toContain("error_summary");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("analysis_jobs_test");
  });

  it("caps error-code buckets and normalizes malformed codes", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    for (let index = 0; index < 12; index += 1) {
      await enqueueAnalysisJob(jobInput({
        idempotencyKey: `terminal-idempotency-${index}`,
        deliveryId: `123e4567-e89b-12d3-a456-4266141743${String(index).padStart(2, "0")}`,
        pullRequestNumber: index + 1,
        pullRequestUrl: `https://github.com/RengGyu/AgentProof/pull/${index + 1}`,
        headSha: `abc12${index.toString(16)}`
      }));
      Object.assign(getAnalysisJobsForTests()[index], {
        status: "failed_terminal",
        updated_at: `2026-06-30T00:${String(index).padStart(2, "0")}:00.000Z`,
        error_code: index >= 9 ? "bad code with spaces and github_pat_secret_should_not_leak" : `error_code_${index}`
      });
    }

    const response = await GET(new Request("http://localhost/api/ops/analysis-jobs/dead-letter", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.summary.sampledTerminalCount).toBe(12);
    expect(json.summary.topErrorCodes).toHaveLength(10);
    expect(serialized).toContain("\"unknown\"");
    expect(serialized).not.toContain("bad code with spaces");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("terminal-idempotency");
  });
});

function jobInput(overrides: Partial<{
  idempotencyKey: string;
  deliveryId: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
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
    now: new Date("2026-06-30T00:00:00Z")
  };
}
