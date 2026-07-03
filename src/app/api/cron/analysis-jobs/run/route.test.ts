import { afterEach, describe, expect, it, vi } from "vitest";
import { runAnalysisJobBatch, type AnalysisWorkerBatchResult } from "@/lib/analysis-worker";
import { GET } from "./route";

vi.mock("@/lib/analysis-worker", () => ({
  runAnalysisJobBatch: vi.fn()
}));

const mockedRunAnalysisJobBatch = vi.mocked(runAnalysisJobBatch);

describe("GET /api/cron/analysis-jobs/run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns a metadata-only no-op when cron authentication is not configured", async () => {
    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
      status: "disabled",
      reason: "cron_auth_not_configured"
    });
    expect(mockedRunAnalysisJobBatch).not.toHaveBeenCalled();
  });

  it("rejects invalid cron tokens without exposing the configured token", async () => {
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "cron-secret-value");

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run", {
      headers: { authorization: "Bearer wrong-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toEqual({
      error: "Invalid analysis job cron token.",
      code: "analysis_job_cron_unauthorized"
    });
    expect(serialized).not.toContain("cron-secret-value");
    expect(mockedRunAnalysisJobBatch).not.toHaveBeenCalled();
  });

  it("accepts Vercel CRON_SECRET even when a separate scheduler token is also configured", async () => {
    vi.stubEnv("CRON_SECRET", "vercel-cron-secret");
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "external-scheduler-secret");

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run", {
      headers: { authorization: "Bearer vercel-cron-secret" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
      status: "disabled",
      reason: "analysis_job_queue_disabled"
    });
    expect(mockedRunAnalysisJobBatch).not.toHaveBeenCalled();
  });

  it("does not authenticate with query-string tokens", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run?token=cron-secret-value"));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid analysis job cron token.",
      code: "analysis_job_cron_unauthorized"
    });
    expect(serialized).not.toContain("cron-secret-value");
    expect(mockedRunAnalysisJobBatch).not.toHaveBeenCalled();
  });

  it("returns a no-op metadata response when the queue is disabled", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run", {
      headers: { authorization: "Bearer cron-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
      status: "disabled",
      reason: "analysis_job_queue_disabled"
    });
    expect(mockedRunAnalysisJobBatch).not.toHaveBeenCalled();
  });

  it("fails closed when queue mode is enabled but storage is incomplete", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run", {
      headers: { authorization: "Bearer cron-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Analysis job queue is unavailable.",
      code: "analysis_worker_queue_unavailable"
    });
    expect(mockedRunAnalysisJobBatch).not.toHaveBeenCalled();
  });

  it("runs a bounded batch with metadata-only output when authorized", async () => {
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "cron-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_CRON_ANALYSIS_JOB_BATCH_LIMIT", "3");
    mockedRunAnalysisJobBatch.mockResolvedValue(batchResult());

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run", {
      headers: { "x-agentproof-cron-token": "cron-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-cron-metadata-only",
      status: "ran",
      requestedLimit: 3,
      processed: 1,
      completed: 1,
      failedRetryable: 0,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "limit_reached"
    });
    expect(mockedRunAnalysisJobBatch).toHaveBeenCalledWith({
      requestUrl: "http://localhost/api/cron/analysis-jobs/run",
      limit: 3
    });
    expect(serialized).not.toContain("cron-secret-value");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("https://github.com");
    expect(serialized).not.toContain("job_1");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("pullRequestNumber");
    expect(serialized).not.toContain("items");
    expect(serialized).not.toContain("installation_id");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("ignores query-string limits and uses only the cron batch env", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_CRON_ANALYSIS_JOB_BATCH_LIMIT", "2");
    mockedRunAnalysisJobBatch.mockResolvedValue({
      ...batchResult(),
      requestedLimit: 2
    });

    const response = await GET(new Request("http://localhost/api/cron/analysis-jobs/run?limit=5", {
      headers: { authorization: "Bearer cron-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      privacy: "analysis-worker-cron-metadata-only",
      requestedLimit: 2
    });
    expect(mockedRunAnalysisJobBatch).toHaveBeenCalledWith({
      requestUrl: "http://localhost/api/cron/analysis-jobs/run?limit=5",
      limit: 2
    });
  });
});

function batchResult(): AnalysisWorkerBatchResult {
  return {
    requestedLimit: 3,
    processed: 1,
    completed: 1,
    failedRetryable: 0,
    failedTerminal: 0,
    idle: false,
    stoppedReason: "limit_reached" as const,
    items: [
      {
        status: "completed" as const,
        job: {
          id: "job_1",
          status: "processing",
          tenant_id: "tenant_a",
          idempotency_key_hash: "f".repeat(64),
          delivery_id: "123e4567-e89b-12d3-a456-426614174300",
          event: "pull_request",
          action: "synchronize",
          installation_id: 321,
          repository_id: 100,
          repository_full_name: "RengGyu/AgentProof",
          pull_request_number: 7,
          pull_request_url: "https://github.com/RengGyu/AgentProof/pull/7",
          head_sha: "abc123",
          save_report: true,
          comment: true,
          attempts: 1,
          created_at: "2026-06-30T00:00:00.000Z",
          updated_at: "2026-06-30T00:01:00.000Z",
          run_after: "2026-06-30T00:00:00.000Z",
          locked_at: "2026-06-30T00:01:00.000Z",
          completed_at: null,
          error_code: null,
          error_summary: null,
          result_summary: null
        },
        resultSummary: {
          status: "completed" as const,
          repository: "RengGyu/AgentProof",
          pullRequestNumber: 7,
          headSha: "abc123",
          priority: "medium",
          evidenceCoverage: 42,
          savedReport: {
            privacy: "summary-only"
          },
          comment: {
            action: "updated"
          }
        },
        sideEffects: {
          saveReport: true,
          comment: true
        }
      }
    ]
  };
}
