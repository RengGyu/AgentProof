import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { clearTenantRepositoryGrantsForTests } from "@/lib/tenant-control-plane";
import { POST } from "./route";

describe("POST /api/ops/analysis-jobs/preflight", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/preflight", { method: "POST" }));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
  });

  it("rejects invalid operator tokens without exposing the configured token", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/preflight", {
      method: "POST",
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

    const response = await POST(new Request(
      "http://localhost/api/ops/analysis-jobs/preflight?token=ops-secret-value",
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
  });

  it("fails closed when the queue is not configured", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/preflight", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Analysis worker queue is unavailable.",
      code: "analysis_worker_queue_unavailable"
    });
    expect(serialized).not.toContain("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED");
    expect(serialized).not.toContain("ops-secret-value");
  });

  it("runs metadata-only preflight without exposing repo names, env values, or secrets", async () => {
    stubReadyWorkerEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "private_jobs_table");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput());

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/preflight", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-preflight-metadata-only",
      status: "ready",
      job: {
        id,
        pullRequestNumber: 7,
        headShaPrefix: "abc123",
        attempts: 1
      },
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "processing",
      attempts: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("private_jobs_table");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("records grant-denied terminal state without returning repository metadata", async () => {
    stubQueueOnlyEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ enabled: false });

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/preflight", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-preflight-metadata-only",
      status: "failed_terminal",
      reason: "grant-disabled"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "grant-disabled",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("ops-secret-value");
  });
});

function stubQueueOnlyEnv() {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
}

function stubReadyWorkerEnv(grantOverrides: Partial<ReturnType<typeof grantRecord>> = {}) {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
    grantRecord(grantOverrides)
  ]));
}

function grantRecord(overrides: Partial<{
  tenantId: string;
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  commentEnabled: boolean;
  saveReportsEnabled: boolean;
}> = {}) {
  return {
    tenantId: "tenant_a",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    enabled: true,
    analysisEnabled: true,
    commentEnabled: false,
    saveReportsEnabled: true,
    ...overrides
  };
}

function jobInput() {
  return {
    tenantId: "tenant_a",
    idempotencyKey: "raw-idempotency-key-should-not-store",
    deliveryId: "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "synchronize",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7",
    headSha: "abc123",
    saveReport: true,
    comment: true,
    now: new Date("2026-06-30T00:00:00Z")
  };
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
