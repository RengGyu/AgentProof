import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { clearAuditEventsForTests } from "@/lib/audit-log";
import { clearSavedReportsForTests } from "@/lib/server-report-store";
import { clearTenantRepositoryGrantsForTests } from "@/lib/tenant-control-plane";
import { POST } from "./route";

describe("POST /api/ops/analysis-jobs/run-batch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearSavedReportsForTests();
    clearAuditEventsForTests();
    clearTenantRepositoryGrantsForTests();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run-batch", { method: "POST" }));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
  });

  it("rejects invalid operator tokens without exposing the configured token", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run-batch", {
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
      "http://localhost/api/ops/analysis-jobs/run-batch?token=ops-secret-value",
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

  it("runs a bounded batch with metadata-only public results", async () => {
    stubReadyWorkerEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubGlobal("fetch", mockWorkerFetch());
    const first = await enqueueAnalysisJob(jobInput({ idempotencyKey: "first-batch-job" }));
    const second = await enqueueAnalysisJob(jobInput({
      idempotencyKey: "second-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301"
    }));
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "third-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302"
    }));

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run-batch?limit=2", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-batch-metadata-only",
      requestedLimit: 2,
      processed: 2,
      completed: 2,
      failedRetryable: 0,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "limit_reached",
      items: [
        {
          index: 0,
          privacy: "analysis-worker-run-metadata-only",
          status: "completed",
          job: {
            id: first.id,
            pullRequestNumber: 7,
            headShaPrefix: "abc123",
            attempts: 1
          },
          result: {
            priority: expect.any(String),
            evidenceCoverage: expect.any(Number)
          },
          sideEffects: {
            saveReport: false,
            comment: false
          }
        },
        {
          index: 1,
          privacy: "analysis-worker-run-metadata-only",
          status: "completed",
          job: {
            id: second.id,
            pullRequestNumber: 7,
            headShaPrefix: "abc123",
            attempts: 1
          },
          result: {
            priority: expect.any(String),
            evidenceCoverage: expect.any(Number)
          },
          sideEffects: {
            saveReport: false,
            comment: false
          }
        }
      ]
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "completed",
      "completed",
      "queued"
    ]);
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("key=");
  });

  it("clamps excessive limits to five jobs", async () => {
    stubReadyWorkerEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubGlobal("fetch", mockWorkerFetch());

    for (let index = 0; index < 6; index += 1) {
      await enqueueAnalysisJob(jobInput({
        idempotencyKey: `batch-job-${index}`,
        deliveryId: `123e4567-e89b-12d3-a456-42661417430${index}`
      }));
    }

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run-batch?limit=999", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      requestedLimit: 5,
      processed: 5,
      completed: 5,
      stoppedReason: "limit_reached"
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
      "completed",
      "queued"
    ]);
  });

  it("stops after a retryable failure and leaves later due jobs untouched", async () => {
    stubReadyWorkerEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({ token: "installation-token" });
      }

      return new Response("GitHub unavailable", { status: 500 });
    }));
    await enqueueAnalysisJob(jobInput({ idempotencyKey: "retryable-batch-job" }));
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "untouched-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301"
    }));

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run-batch?limit=5", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      privacy: "analysis-worker-batch-metadata-only",
      requestedLimit: 5,
      processed: 1,
      completed: 0,
      failedRetryable: 1,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "retryable_failure",
      items: [
        {
          index: 0,
          privacy: "analysis-worker-run-metadata-only",
          status: "failed_retryable",
          reason: "github_fetch_failed"
        }
      ]
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "failed_retryable",
      "queued"
    ]);
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("installation-token");
  });
});

function stubReadyWorkerEnv() {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
    {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      enabled: true,
      analysisEnabled: true,
      commentEnabled: false,
      saveReportsEnabled: false
    }
  ]));
}

function jobInput(overrides: Partial<{
  idempotencyKey: string;
  deliveryId: string;
}> = {}) {
  return {
    tenantId: "tenant_a",
    idempotencyKey: overrides.idempotencyKey ?? "raw-idempotency-key-should-not-store",
    deliveryId: overrides.deliveryId ?? "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "synchronize",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7",
    headSha: "abc123",
    saveReport: false,
    comment: false,
    now: new Date("2026-06-30T00:00:00Z")
  };
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function mockWorkerFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);

    if (href === "https://api.github.com/app/installations/321/access_tokens") {
      return Response.json({ token: "installation-token" });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7") {
      return Response.json({
        title: "Fetched PR title",
        body: "Acceptance criteria: add signed webhook-triggered AgentProof analysis. Save only summary reports. Keep automated comments opt-in.",
        url: "https://api.github.com/repos/RengGyu/AgentProof/pulls/7",
        user: { login: "agent-author" },
        base: { ref: "main" },
        head: { ref: "feature/app-automation", sha: "abc123" }
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7/files?per_page=100&page=1") {
      return Response.json([
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
      return Response.json({
        total_count: 0,
        check_runs: []
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123/status") {
      return Response.json({ statuses: [] });
    }

    return new Response(`unexpected url: ${href}`, { status: 500 });
  });
}
