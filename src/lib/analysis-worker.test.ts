import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "./analysis-jobs";
import { clearAuditEventsForTests, getAuditEventsForTests } from "./audit-log";
import { clearSavedReportsForTests, countTenantSavedReports } from "./server-report-store";
import { preflightNextAnalysisJob, runAnalysisJobBatch, runNextAnalysisJob } from "./analysis-worker";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  updateTenantRepositoryGrantSettings
} from "./tenant-control-plane";

describe("analysis worker preflight", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
    clearSavedReportsForTests();
    clearAuditEventsForTests();
  });

  it("returns idle when no queued job is due", async () => {
    stubQueueEnv();

    await expect(preflightNextAnalysisJob({ now: new Date("2026-06-30T00:00:00Z") })).resolves.toEqual({
      status: "idle"
    });
  });

  it("fails retryable before grant lookup when GitHub App credentials are not ready", async () => {
    stubQueueEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", "sha256=not-a-private-key");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret");
    await enqueueAnalysisJob(jobInput());

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_retryable",
      reason: "github_app_not_ready"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      error_code: "github_app_not_ready",
      locked_at: null
    });
  });

  it("fails terminal before token fetch when a grant is disabled after enqueue", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: { enabled: false } });

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests() });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "grant-disabled"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "grant-disabled",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("fails terminal before token fetch when analysis is disabled after enqueue", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: { analysisEnabled: false } });

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "analysis-disabled"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "analysis-disabled",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails terminal before token fetch when the queued repository has no active tenant grant", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: { repositoryFullName: "RengGyu/OtherRepo", repositoryId: 101 } });

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "grant-missing"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "grant-missing",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails retryable before token fetch when the tenant grant store is unavailable", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: null });
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_SUPABASE_URL", "https://agentproof-test.supabase.co");

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_retryable",
      reason: "github_app_tenant_grant_store_unavailable"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      error_code: "github_app_tenant_grant_store_unavailable",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ready and clamps queued side effects to the current tenant grant", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      status: "ready",
      job: {
        id,
        status: "processing",
        repository_full_name: "RengGyu/AgentProof",
        pull_request_number: 7
      },
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "processing",
      attempts: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("service-role");
  });

  it("executes a ready job, validates the report, and completes with summary-only result metadata", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const job = getAnalysisJobsForTests()[0];
    const serialized = JSON.stringify({ result, job });

    expect(result).toMatchObject({
      status: "completed",
      job: {
        id,
        status: "processing",
        attempts: 1
      },
      resultSummary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123",
        priority: expect.any(String),
        evidenceCoverage: expect.any(Number)
      },
      sideEffects: {
        saveReport: false,
        comment: false
      }
    });
    expect(job).toMatchObject({
      id,
      status: "completed",
      locked_at: null,
      completed_at: "2026-06-30T00:01:00.000Z",
      result_summary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123"
      }
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/app/installations/321/access_tokens");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("key=");
  });

  it("creates summary-only saved reports but stores no saved-report URL or key in the job result", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const job = getAnalysisJobsForTests()[0];
    const serialized = JSON.stringify({ result, job });

    expect(result).toMatchObject({
      status: "completed",
      resultSummary: {
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        },
        comment: undefined
      },
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(job).toMatchObject({
      id,
      status: "completed",
      result_summary: {
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        }
      }
    });
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("key=");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("comment_body");
  });

  it("rechecks tenant grants before side effects and stops if deletion disables the grant mid-run", async () => {
    stubReadyWorkerEnv({ grant: null });
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    await createTenantRepositoryGrant(grantRecord({
      saveReportsEnabled: true,
      commentEnabled: true
    }));
    const baseFetchMock = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const response = await baseFetchMock(url, init);

      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7/files?per_page=100&page=1") {
        await updateTenantRepositoryGrantSettings({
          tenantId: "tenant_a",
          installationId: 321,
          repositoryId: 100,
          enabled: false,
          analysisEnabled: false,
          saveReportsEnabled: false,
          commentEnabled: false
        });
      }

      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const savedReportCount = await countTenantSavedReports({ tenantId: "tenant_a" });
    const commentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/issues/7/comments")
    );
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests(), savedReportCount });

    expect(result).toEqual({
      status: "failed_terminal",
      job: expect.objectContaining({ id, status: "processing" }),
      reason: "grant-disabled",
      sideEffects: {
        saveReport: true,
        comment: true
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_terminal",
      error_code: "grant-disabled",
      locked_at: null,
      result_summary: null
    });
    expect(savedReportCount).toMatchObject({
      count: 0,
      store: "memory",
      durable: false,
      configured: true
    });
    expect(commentCalls).toHaveLength(0);
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("key=");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("comment_body");
  });

  it("stops before token fetch when durable audit is required for side effects but unavailable", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toEqual({
      status: "failed_retryable",
      job: expect.objectContaining({ id, status: "processing" }),
      reason: "github_app_durable_audit_required",
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_retryable",
      error_code: "github_app_durable_audit_required",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks GitHub evidence fetch failures retryable with redacted bounded summaries", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({ token: "installation-token" });
      }
      return new Response("upstream token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890 failed", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const serialized = JSON.stringify(getAnalysisJobsForTests()[0]);

    expect(result).toMatchObject({
      status: "failed_retryable",
      reason: "github_fetch_failed"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_retryable",
      error_code: "github_fetch_failed",
      locked_at: null
    });
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("token=");
  });

  it("runs a bounded batch and stops when the requested limit is reached", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "first-batch-job",
      pullRequestNumber: 7,
      headSha: "abc123"
    }));
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "second-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 7,
      headSha: "abc123"
    }));
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "third-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 7,
      headSha: "abc123"
    }));

    const result = await runAnalysisJobBatch({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run-batch?limit=2",
      limit: 2,
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({
      requestedLimit: 2,
      processed: 2,
      completed: 2,
      failedRetryable: 0,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "limit_reached",
      items: [
        { status: "completed" },
        { status: "completed" }
      ]
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "completed",
      "completed",
      "queued"
    ]);
  });

  it("stops a batch after the first retryable failure to avoid draining due jobs during systemic outages", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({ token: "installation-token" });
      }

      return new Response("GitHub unavailable", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "retryable-batch-job",
      pullRequestNumber: 7,
      headSha: "abc123"
    }));
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "untouched-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 7,
      headSha: "abc123"
    }));

    const result = await runAnalysisJobBatch({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run-batch?limit=5",
      limit: 5,
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({
      requestedLimit: 5,
      processed: 1,
      completed: 0,
      failedRetryable: 1,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "retryable_failure",
      items: [
        { status: "failed_retryable", reason: "github_fetch_failed" }
      ]
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "failed_retryable",
      "queued"
    ]);
  });
});

function stubQueueEnv() {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
}

function stubReadyWorkerEnv(options: {
  grant?: Partial<ReturnType<typeof grantRecord>> | null;
} = {}) {
  stubQueueEnv();
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");

  if (options.grant !== null) {
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
      grantRecord(options.grant)
    ]));
  }
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
    commentEnabled: true,
    saveReportsEnabled: true,
    ...overrides
  };
}

function jobInput(overrides: Partial<{
  saveReport: boolean;
  comment: boolean;
  idempotencyKey: string;
  deliveryId: string;
  pullRequestNumber: number;
  headSha: string;
}> = {}) {
  const pullRequestNumber = overrides.pullRequestNumber ?? 7;

  return {
    tenantId: "tenant_a",
    idempotencyKey: overrides.idempotencyKey ?? "raw-idempotency-key-should-not-store",
    deliveryId: overrides.deliveryId ?? "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "synchronize",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber,
    pullRequestUrl: `https://github.com/RengGyu/AgentProof/pull/${pullRequestNumber}`,
    headSha: overrides.headSha ?? "abc123",
    saveReport: overrides.saveReport ?? true,
    comment: overrides.comment ?? true,
    now: new Date("2026-06-30T00:00:00Z")
  };
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function mockWorkerFetch() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";

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
      return Response.json({ statuses: [] });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/actions/runs/1/jobs?per_page=100") {
      return Response.json({
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
      return Response.json([]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && method === "POST") {
      return Response.json({ html_url: "https://github.com/RengGyu/AgentProof/pull/7#issuecomment-777" });
    }

    return new Response(`unexpected url: ${href}`, { status: 500 });
  });
}
