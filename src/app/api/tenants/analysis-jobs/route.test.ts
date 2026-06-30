import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimNextAnalysisJob,
  clearAnalysisJobsForTests,
  completeAnalysisJob,
  enqueueAnalysisJob,
  failAnalysisJob
} from "@/lib/analysis-jobs";
import { createTenantAdminSession } from "@/lib/github-onboarding";
import { GET } from "./route";

describe("GET /api/tenants/analysis-jobs", () => {
  afterEach(() => {
    clearAnalysisJobsForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("requires tenant admin access before reading analysis jobs", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-b-invite-token" }
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: "Tenant analysis jobs require a valid tenant-bound invite token.",
      code: "tenant_analysis_jobs_unauthorized"
    });
  });

  it("returns summary-only analysis jobs for the authorized tenant only", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const completedJob = await enqueueAnalysisJob(jobInput());
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await completeAnalysisJob({
      id: completedJob.id,
      now: new Date("2026-06-30T00:02:00Z"),
      resultSummary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123def456",
        priority: "medium",
        evidenceCoverage: 64,
        savedReport: {
          privacy: "summary-only",
          durability: "summary-only-supabase"
        },
        comment: {
          action: "skipped"
        }
      }
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      tenantId: "tenant_b",
      idempotencyKey: "tenant-b-raw-key",
      deliveryId: "123e4567-e89b-12d3-a456-426614174399",
      repositoryFullName: "Other/Private",
      pullRequestUrl: "https://github.com/Other/Private/pull/7"
    });

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a&limit=100", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      tenantId: "tenant_a",
      filter: "all",
      jobs: [
        {
          id: completedJob.id,
          status: "completed",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-06-30T00:02:00.000Z",
          repositoryFullName: "RengGyu/AgentProof",
          pullRequestNumber: 7,
          headShaPrefix: "abc123def456",
          action: "synchronize",
          attempts: 1,
          runAfter: "2026-06-30T00:00:00.000Z",
          completedAt: "2026-06-30T00:02:00.000Z",
          sideEffects: {
            saveReport: true,
            comment: true
          },
          result: {
            priority: "medium",
            evidenceCoverage: 64,
            savedReport: {
              privacy: "summary-only",
              durability: "summary-only-supabase"
            },
            comment: {
              action: "skipped"
            }
          },
          privacy: "analysis-job-summary-only"
        }
      ],
      count: 1,
      truncated: false,
      page: {
        count: 1,
        limit: 25,
        truncated: false
      },
      summary: {
        privacy: "analysis-job-tenant-rollup-summary-only",
        basis: "tenant_recent_sample",
        sampled: 1,
        truncated: false,
        statusCounts: {
          queued: 0,
          processing: 0,
          completed: 1,
          failed_retryable: 0,
          failed_terminal: 0
        },
        counts: {
          active: 0,
          failed: 0,
          completed: 1,
          retrying: 0,
          terminal: 0
        }
      },
      privacy: "analysis-job-summary-only",
      next: "monitor_async_analysis"
    });
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Other/Private");
    expect(serialized).not.toContain("tenant-b-raw-key");
    expect(serialized).not.toContain("idempotency_key_hash");
    expect(serialized).not.toContain("delivery_id");
    expect(serialized).not.toContain("123e4567-e89b-12d3-a456-426614174300");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("savedReportUrl");
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("key=");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("returns analysis jobs with a tenant admin session cookie", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob(jobInput());
    const session = createTenantAdminSession({
      tenantId: "tenant_a",
      inviteToken: "tenant-a-invite-token"
    });

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a", {
      headers: { cookie: session.sessionCookie }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      tenantId: "tenant_a",
      privacy: "analysis-job-summary-only",
      count: 1
    });
  });

  it("marks analysis jobs as truncated when more rows exist than the requested limit", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    for (let index = 0; index < 3; index += 1) {
      await enqueueAnalysisJob({
        ...jobInput(),
        idempotencyKey: `tenant-a-job-${index}`,
        deliveryId: `123e4567-e89b-12d3-a456-42661417430${index}`
      });
    }

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a&limit=2", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.count).toBe(2);
    expect(json.truncated).toBe(true);
    expect(json.jobs).toHaveLength(2);
  });

  it("rejects explicit invalid status filters instead of falling back to all jobs", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    await enqueueAnalysisJob(jobInput());

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a&status=failed_terminal", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toEqual({
      error: "Tenant analysis job status filter is invalid.",
      code: "invalid_status_filter"
    });
  });

  it("filters failed analysis jobs and returns summary-only rollups", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const retryable = await enqueueAnalysisJob(jobInput({
      idempotencyKey: "retryable-job-key",
      deliveryId: "123e4567-e89b-12d3-a456-426614174310",
      pullRequestNumber: 8
    }));
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await failAnalysisJob({
      id: retryable.id,
      retryable: true,
      code: "github_fetch_failed",
      summary: "Retryable failure for https://github.com/RengGyu/AgentProof/pull/8?token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
      now: new Date("2026-06-30T00:02:00Z")
    });

    const terminal = await enqueueAnalysisJob(jobInput({
      idempotencyKey: "terminal-job-key",
      deliveryId: "123e4567-e89b-12d3-a456-426614174311",
      pullRequestNumber: 9
    }));
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:03:00Z") });
    await failAnalysisJob({
      id: terminal.id,
      retryable: false,
      code: "grant_denied",
      summary: "Grant denied",
      now: new Date("2026-06-30T00:04:00Z")
    });

    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "completed-job-key",
      deliveryId: "123e4567-e89b-12d3-a456-426614174312",
      pullRequestNumber: 10
    }));

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a&status=failed&limit=10", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.filter).toBe("failed");
    expect(json.jobs).toHaveLength(2);
    expect(json.jobs.map((job: { status: string }) => job.status).sort()).toEqual([
      "failed_retryable",
      "failed_terminal"
    ]);
    expect(json.summary).toEqual({
      privacy: "analysis-job-tenant-rollup-summary-only",
      basis: "tenant_recent_sample",
      sampled: 3,
      truncated: false,
      statusCounts: {
        queued: 1,
        processing: 0,
        completed: 0,
        failed_retryable: 1,
        failed_terminal: 1
      },
      counts: {
        active: 2,
        failed: 2,
        completed: 0,
        retrying: 1,
        terminal: 1
      }
    });
    expect(serialized).not.toContain("completed-job-key");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("?token=");
    expect(serialized).not.toContain("idempotency_key_hash");
    expect(serialized).not.toContain("delivery_id");
  });

  it("returns redacted bounded failure metadata only", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const { id } = await enqueueAnalysisJob(jobInput());
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await failAnalysisJob({
      id,
      retryable: true,
      code: "github_fetch_failed",
      summary: "GET https://api.github.com/repos/RengGyu/AgentProof/pulls/7?token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890 failed with Authorization: Bearer sk-secretsecret",
      now: new Date("2026-06-30T00:02:00Z")
    });

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.jobs[0]).toMatchObject({
      status: "failed_retryable",
      errorCode: "github_fetch_failed",
      errorSummary: expect.any(String)
    });
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("?token=");
    expect(serialized).not.toContain("Authorization");
  });

  it("fails closed when durable analysis job storage is unavailable", async () => {
    stubInviteEnv();
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));

    const response = await GET(new Request("http://localhost/api/tenants/analysis-jobs?tenantId=tenant_a", {
      headers: { "x-agentproof-beta-invite-token": "tenant-a-invite-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Tenant analysis jobs are unavailable.",
      code: "tenant_analysis_jobs_unavailable"
    });
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("agentproof-test.supabase.co");
  });
});

function stubInviteEnv() {
  vi.stubEnv("AGENTPROOF_TENANT_SESSION_SECRET", "tenant-session-secret-value-with-enough-entropy");
  vi.stubEnv("AGENTPROOF_BETA_INVITES", JSON.stringify([
    { tenantId: "tenant_a", token: "tenant-a-invite-token" },
    { tenantId: "tenant_b", token: "tenant-b-invite-token" }
  ]));
}

function jobInput(overrides: Partial<{
  idempotencyKey: string;
  deliveryId: string;
  pullRequestNumber: number;
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
    headSha: "abc123def456",
    saveReport: true,
    comment: true,
    now: new Date("2026-06-30T00:00:00Z")
  };
}
