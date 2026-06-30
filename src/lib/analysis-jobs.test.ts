import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAnalysisJobIsPrivate,
  clearAnalysisJobsForTests,
  claimNextAnalysisJob,
  completeAnalysisJob,
  countTenantActiveAnalysisJobsForDeletion,
  enqueueAnalysisJob,
  failAnalysisJob,
  getAnalysisJobDeadLetterSummary,
  getAnalysisJobQueueSummary,
  getAnalysisJobQueueStatus,
  getAnalysisJobsForTests,
  listTenantAnalysisJobs,
  purgeTenantAnalysisJobsForDeletion
} from "./analysis-jobs";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  disableTenantRepositoryGrantsForTenantDeletion
} from "./tenant-control-plane";
import { clearTenantDeletionStateForTests } from "./tenant-deletion-state";

describe("analysis job queue", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
    clearTenantDeletionStateForTests();
  });

  it("is disabled by default", () => {
    expect(getAnalysisJobQueueStatus()).toEqual({
      enabled: false,
      mode: "disabled",
      configured: false,
      durable: false,
      table: "agentproof_analysis_jobs",
      missingEnv: []
    });
  });

  it("fails closed when enabled without durable storage or explicit memory fallback", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");

    expect(getAnalysisJobQueueStatus()).toMatchObject({
      enabled: true,
      configured: false,
      durable: false,
      missingEnv: [
        "AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL or SUPABASE_URL",
        "AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY"
      ]
    });
    await expect(enqueueAnalysisJob(jobInput())).rejects.toThrow("Analysis job Supabase env is incomplete");
  });

  it("enqueues bounded memory jobs without raw idempotency keys or evidence fields", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const result = await enqueueAnalysisJob(jobInput());
    const jobs = getAnalysisJobsForTests();
    const serialized = JSON.stringify(jobs);

    expect(result).toEqual({
      id: expect.any(String),
      status: "queued",
      store: "memory",
      durable: false
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      id: result.id,
      status: "queued",
      tenant_id: "tenant_a",
      idempotency_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      delivery_id: "123e4567-e89b-12d3-a456-426614174300",
      event: "pull_request",
      action: "opened",
      installation_id: 321,
      repository_id: 100,
      repository_full_name: "RengGyu/AgentProof",
      pull_request_number: 7,
      pull_request_url: "https://github.com/RengGyu/AgentProof/pull/7",
      head_sha: "abc123",
      save_report: true,
      comment: false,
      attempts: 0
    });
    expect(serialized).not.toContain("raw-idempotency-key");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("logs");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("rechecks tenant repository grants before direct enqueue when tenant control is enabled", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true",
      AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED: "true",
      AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    }, env);

    const result = await enqueueAnalysisJob(jobInput(), env);

    expect(result).toMatchObject({
      status: "queued",
      store: "memory"
    });
    expect(getAnalysisJobsForTests()).toHaveLength(1);
  });

  it("refuses direct enqueue after tenant deletion grant disable without persisting a job", async () => {
    const env = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true",
      AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED: "true",
      AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY: "true"
    } as unknown as NodeJS.ProcessEnv;
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    }, env);
    await disableTenantRepositoryGrantsForTenantDeletion({ tenantId: "tenant_a" }, env);

    await expect(enqueueAnalysisJob(jobInput(), env)).rejects.toThrow("repository grant is not active");

    expect(getAnalysisJobsForTests()).toEqual([]);
  });

  it("refuses direct enqueue for a tenant with a deletion tombstone before checking repository grants", async () => {
    const env = {
      AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED: "true",
      AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY: "true",
      AGENTPROOF_TENANT_DELETION_TOMBSTONES: JSON.stringify(["tenant_a"])
    } as unknown as NodeJS.ProcessEnv;

    await expect(enqueueAnalysisJob(jobInput(), env)).rejects.toThrow("Tenant deletion is in progress");

    expect(getAnalysisJobsForTests()).toEqual([]);
  });

  it("uses Supabase REST for durable jobs without storing raw idempotency keys", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await enqueueAnalysisJob(jobInput());
    const [, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    const body = JSON.parse(String(init.body));
    const serializedBody = JSON.stringify(body);

    expect(result).toMatchObject({
      status: "queued",
      store: "supabase",
      durable: true
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://agentproof-test.supabase.co/rest/v1/analysis_jobs_test",
      expect.objectContaining({ method: "POST" })
    );
    expect(body).toMatchObject({
      status: "queued",
      tenant_id: "tenant_a",
      idempotency_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      repository_full_name: "RengGyu/AgentProof",
      pull_request_url: "https://github.com/RengGyu/AgentProof/pull/7"
    });
    expect(serializedBody).not.toContain("raw-idempotency-key");
    expect(serializedBody).not.toContain("service-role-secret");
  });

  it("counts active tenant deletion jobs with Supabase HEAD queries only", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = decodeURIComponent(String(input));
      const count = url.includes("status=eq.queued")
        ? 2
        : url.includes("status=eq.processing")
          ? 1
          : url.includes("status=eq.failed_retryable")
            ? 3
            : 0;

      return new Response(null, {
        status: 200,
        headers: {
          "content-range": `0-0/${count}`
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await countTenantActiveAnalysisJobsForDeletion({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "analysis-job-active-deletion-count-metadata-only",
      count: 6,
      statusCounts: {
        queued: 2,
        processing: 1,
        failed_retryable: 3
      }
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.method).toBe("HEAD");
      expect(decodeURIComponent(String(url))).toContain("select=id");
      expect(decodeURIComponent(String(url))).not.toContain("repository_full_name");
      expect(decodeURIComponent(String(url))).not.toContain("pull_request_url");
      expect(decodeURIComponent(String(url))).not.toContain("delivery_id");
    }
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("analysis_jobs_test");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("rejects unsafe URLs, raw evidence fields, and secret-looking strings", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    await expect(enqueueAnalysisJob({
      ...jobInput(),
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7?token=secret"
    })).rejects.toThrow("Analysis job input is invalid");
    expect(() => assertAnalysisJobIsPrivate({
      id: "job",
      rawDiff: "Patch excerpt",
      token: "github_pat_secret_should_not_store_1234567890"
    })).toThrow("Analysis job contains a secret-like value");
    expect(() => assertAnalysisJobIsPrivate({
      id: "job",
      resultSummary: {
        savedReportUrl: "https://agentproof.test/reports/id?key=secret"
      }
    })).toThrow("Analysis job contains an unsafe URL or query value");
  });

  it("claims due memory jobs once, increments attempts, and completes only processing jobs", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const secondClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:30Z") });
    const completed = await completeAnalysisJob({
      id,
      now: new Date("2026-06-30T00:02:00Z"),
      resultSummary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123",
        priority: "medium",
        evidenceCoverage: 18.4,
        savedReport: {
          privacy: "summary-only",
          durability: "summary-only-supabase"
        },
        comment: {
          action: "skipped"
        }
      }
    });
    const jobs = getAnalysisJobsForTests();
    const serialized = JSON.stringify(jobs);

    expect(claim).toMatchObject({
      store: "memory",
      durable: false,
      job: {
        id,
        status: "processing",
        attempts: 1,
        locked_at: "2026-06-30T00:01:00.000Z"
      }
    });
    expect(secondClaim.job).toBeNull();
    expect(completed).toBe(true);
    expect(jobs[0]).toMatchObject({
      id,
      status: "completed",
      locked_at: null,
      completed_at: "2026-06-30T00:02:00.000Z",
      error_code: null,
      error_summary: null,
      result_summary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123",
        priority: "medium",
        evidenceCoverage: 18,
        savedReport: {
          privacy: "summary-only",
          durability: "summary-only-supabase"
        },
        comment: {
          action: "skipped"
        }
      }
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("key=");
  });

  it("lists tenant analysis jobs as summary-only projections", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const tenantA = await enqueueAnalysisJob(jobInput());
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await completeAnalysisJob({
      id: tenantA.id,
      now: new Date("2026-06-30T00:02:00Z"),
      resultSummary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "abc123",
        priority: "medium",
        evidenceCoverage: 18,
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        },
        comment: {
          action: "skipped"
        }
      }
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      tenantId: "tenant_b",
      idempotencyKey: "tenant-b-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174399",
      repositoryFullName: "RengGyu/OtherRepo",
      pullRequestUrl: "https://github.com/RengGyu/OtherRepo/pull/7"
    });

    const jobs = await listTenantAnalysisJobs({ tenantId: "tenant_a", limit: 10 });
    const serialized = JSON.stringify(jobs);

    expect(jobs).toEqual([
      {
        id: tenantA.id,
        status: "completed",
        createdAt: "2026-06-30T00:00:00.000Z",
        updatedAt: "2026-06-30T00:02:00.000Z",
        repositoryFullName: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headShaPrefix: "abc123",
        action: "opened",
        attempts: 1,
        runAfter: "2026-06-30T00:00:00.000Z",
        completedAt: "2026-06-30T00:02:00.000Z",
        errorCode: undefined,
        errorSummary: undefined,
        sideEffects: {
          saveReport: true,
          comment: false
        },
        result: {
          priority: "medium",
          evidenceCoverage: 18,
          savedReport: {
            privacy: "summary-only",
            durability: "short-lived-in-memory"
          },
          comment: {
            action: "skipped"
          }
        },
        privacy: "analysis-job-summary-only"
      }
    ]);
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("OtherRepo");
    expect(serialized).not.toContain("idempotency_key_hash");
    expect(serialized).not.toContain("delivery_id");
    expect(serialized).not.toContain("raw-idempotency-key");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("key=");
  });

  it("returns a disabled tenant purge result when the analysis job queue is off", async () => {
    const result = await purgeTenantAnalysisJobsForDeletion({ tenantId: "tenant_a" });

    expect(result).toEqual({
      privacy: "analysis-job-tenant-purge-metadata-only",
      deletedCount: 0,
      countBasis: "disabled-store-count",
      store: "none",
      durable: false,
      configured: false,
      disabled: true
    });
  });

  it("purges only the requested tenant from memory analysis jobs without returning raw job details", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    await enqueueAnalysisJob(jobInput());
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "tenant-a-second-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/8",
      headSha: "def456"
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "tenant-a-processing-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 9,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/9",
      headSha: "fed789"
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "tenant-a-retryable-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174303",
      pullRequestNumber: 10,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10",
      headSha: "aaa111"
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "tenant-a-terminal-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174304",
      pullRequestNumber: 11,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/11",
      headSha: "bbb222"
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      tenantId: "tenant_b",
      idempotencyKey: "tenant-b-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174399",
      repositoryFullName: "RengGyu/OtherRepo",
      pullRequestUrl: "https://github.com/RengGyu/OtherRepo/pull/7"
    });
    const seededJobs = getAnalysisJobsForTests();
    Object.assign(seededJobs[1], {
      status: "completed",
      completed_at: "2026-06-30T00:02:00.000Z"
    });
    Object.assign(seededJobs[2], {
      status: "processing",
      attempts: 1,
      locked_at: "2026-06-30T00:01:00.000Z"
    });
    Object.assign(seededJobs[3], {
      status: "failed_retryable",
      error_code: "github_fetch_failed"
    });
    Object.assign(seededJobs[4], {
      status: "failed_terminal",
      error_code: "grant_denied"
    });

    const result = await purgeTenantAnalysisJobsForDeletion({ tenantId: "tenant_a" });
    const remainingJobs = getAnalysisJobsForTests();
    const serializedResult = JSON.stringify(result);
    const serializedRemaining = JSON.stringify(remainingJobs);

    expect(result).toEqual({
      privacy: "analysis-job-tenant-purge-metadata-only",
      deletedCount: 5,
      countBasis: "exact-memory-delete-count",
      store: "memory",
      durable: false,
      configured: true
    });
    expect(remainingJobs).toHaveLength(1);
    expect(remainingJobs[0]).toMatchObject({
      tenant_id: "tenant_b",
      repository_full_name: "RengGyu/OtherRepo"
    });
    expect(serializedResult).not.toContain("tenant_a");
    expect(serializedResult).not.toContain("RengGyu/AgentProof");
    expect(serializedResult).not.toContain("pull_request_url");
    expect(serializedResult).not.toContain("idempotency");
    expect(serializedRemaining).not.toContain("tenant_a");
    expect(serializedRemaining).not.toContain("RengGyu/AgentProof");
    expect(serializedRemaining).not.toContain("raw-idempotency-key");
    expect(serializedRemaining).not.toContain("Patch excerpt");
    expect(serializedRemaining).not.toContain("claims");
    expect(serializedRemaining).not.toContain("reprompt");
  });

  it("purges durable Supabase tenant analysis jobs with count-first metadata and no row body", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-range": "0-0/3"
          }
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      throw new Error(`Unexpected fetch call: ${String(url)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await purgeTenantAnalysisJobsForDeletion({ tenantId: "tenant_a" });
    const [countUrl, countInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const serializedResult = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "analysis-job-tenant-purge-metadata-only",
      deletedCount: 3,
      countBasis: "pre-delete-supabase-count",
      store: "supabase",
      durable: true,
      configured: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countUrl).toBe("https://agentproof-test.supabase.co/rest/v1/analysis_jobs_test?tenant_id=eq.tenant_a&select=id");
    expect(countInit.method).toBe("HEAD");
    expect(countInit.body).toBeUndefined();
    expect(countInit.headers).toMatchObject({
      Prefer: "count=exact",
      Range: "0-0"
    });
    expect(deleteUrl).toBe("https://agentproof-test.supabase.co/rest/v1/analysis_jobs_test?tenant_id=eq.tenant_a");
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteInit.body).toBeUndefined();
    expect(deleteInit.headers).toMatchObject({
      Prefer: "return=minimal"
    });
    expect(serializedResult).not.toContain("tenant_a");
    expect(serializedResult).not.toContain("analysis_jobs_test");
    expect(serializedResult).not.toContain("service-role-secret");
  });

  it("summarizes queue state as aggregate-only operator metrics", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    await enqueueAnalysisJob(jobInput());
    const retryable = await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "retryable-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/8",
      headSha: "def456"
    });
    const processing = await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "processing-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 9,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/9",
      headSha: "fed789"
    });
    const jobs = getAnalysisJobsForTests();
    const retryableJob = jobs.find((job) => job.id === retryable.id);
    const processingJob = jobs.find((job) => job.id === processing.id);

    Object.assign(retryableJob ?? {}, {
      status: "failed_retryable",
      run_after: "2026-06-30T00:10:00.000Z",
      updated_at: "2026-06-30T00:01:00.000Z",
      error_code: "github_fetch_failed",
      error_summary: "GitHub fetch failed."
    });
    Object.assign(processingJob ?? {}, {
      status: "processing",
      attempts: 1,
      locked_at: "2026-06-29T23:45:00.000Z",
      updated_at: "2026-06-29T23:45:00.000Z"
    });

    const summary = await getAnalysisJobQueueSummary({
      now: new Date("2026-06-30T00:05:00Z"),
      staleAfterMs: 10 * 60 * 1000
    });
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      privacy: "analysis-job-queue-summary-only",
      sampled: 3,
      truncated: false,
      counts: {
        queued: 1,
        processing: 1,
        completed: 0,
        failed_retryable: 1,
        failed_terminal: 0
      },
      due: 1,
      delayedRetry: 1,
      staleProcessing: 1,
      oldestQueuedAgeSeconds: 300,
      oldestRetryAgeSeconds: 300
    });
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("installation_id");
    expect(serialized).not.toContain("pull_request_url");
    expect(serialized).not.toContain("idempotency");
    expect(serialized).not.toContain("delivery_id");
  });

  it("summarizes terminal failures as dead-letter aggregate-only metrics", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    await enqueueAnalysisJob(jobInput());
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "terminal-idempotency-2",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/8",
      headSha: "def456"
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "terminal-idempotency-3",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 9,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/9",
      headSha: "fed789"
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "retryable-idempotency",
      deliveryId: "123e4567-e89b-12d3-a456-426614174303",
      pullRequestNumber: 10,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10",
      headSha: "aaa111"
    });
    Object.assign(getAnalysisJobsForTests()[0], {
      status: "failed_terminal",
      updated_at: "2026-06-30T00:00:00.000Z",
      error_code: "grant_denied",
      error_summary: "Repo https://github.com/RengGyu/AgentProof/pull/7?token=secret_should_not_leak"
    });
    Object.assign(getAnalysisJobsForTests()[1], {
      status: "failed_terminal",
      updated_at: "2026-06-30T00:01:00.000Z",
      error_code: "grant_denied",
      error_summary: "tenant_a failed"
    });
    Object.assign(getAnalysisJobsForTests()[2], {
      status: "failed_terminal",
      updated_at: "2026-06-30T00:02:00.000Z",
      error_code: "github_fetch_failed",
      error_summary: "Patch excerpt should not leak"
    });
    Object.assign(getAnalysisJobsForTests()[3], {
      status: "failed_retryable",
      updated_at: "2026-06-30T00:03:00.000Z",
      error_code: "retryable_should_not_count"
    });

    const summary = await getAnalysisJobDeadLetterSummary({
      now: new Date("2026-06-30T00:05:00Z")
    });
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      privacy: "analysis-job-dead-letter-summary-only",
      basis: "failed_terminal_recent_sample",
      sampled: 3,
      truncated: false,
      sampledTerminalCount: 3,
      topErrorCodes: [
        { errorCode: "grant_denied", count: 2 },
        { errorCode: "github_fetch_failed", count: 1 }
      ],
      oldestTerminalAgeSeconds: 300
    });
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("pull");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("terminal-idempotency");
    expect(serialized).not.toContain("delivery_id");
    expect(serialized).not.toContain("idempotency");
  });

  it("queries durable dead-letter summaries with a narrow Supabase projection", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const fetchMock = vi.fn(async () => Response.json([
      { error_code: "grant_denied", updated_at: "2026-06-30T00:00:00.000Z" },
      { error_code: "github_fetch_failed", updated_at: "2026-06-30T00:01:00.000Z" },
      { error_code: "ignored_by_limit", updated_at: "2026-06-30T00:02:00.000Z" }
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await getAnalysisJobDeadLetterSummary({
      limit: 2,
      now: new Date("2026-06-30T00:05:00Z")
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      privacy: "analysis-job-dead-letter-summary-only",
      basis: "failed_terminal_recent_sample",
      sampled: 2,
      truncated: true,
      sampledTerminalCount: 2,
      topErrorCodes: [
        { errorCode: "github_fetch_failed", count: 1 },
        { errorCode: "grant_denied", count: 1 }
      ],
      oldestTerminalAgeSeconds: 300
    });
    expect(url).toContain("status=eq.failed_terminal");
    expect(url).toContain("select=error_code%2Cupdated_at");
    expect(url).toContain("limit=3");
    expect(url).not.toContain("repository_full_name");
    expect(url).not.toContain("pull_request_url");
    expect(init.method).toBe("GET");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("analysis_jobs_test");
  });

  it("reclaims stale processing memory jobs only after the lease expires", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z"), leaseMs: 60_000 });

    const beforeLease = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:30Z"), leaseMs: 60_000 });
    const afterLease = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:02:01Z"), leaseMs: 60_000 });

    expect(beforeLease.job).toBeNull();
    expect(afterLease.job).toMatchObject({
      id,
      status: "processing",
      attempts: 2,
      locked_at: "2026-06-30T00:02:01.000Z"
    });
  });

  it("marks retryable and terminal memory failures with redacted bounded summaries", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const retryable = await failAnalysisJob({
      id,
      retryable: true,
      code: "github_fetch_failed",
      summary: "GET https://api.github.com/repos/RengGyu/AgentProof/pulls/7?token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890 failed with Authorization: Bearer sk-secretsecret",
      now: new Date("2026-06-30T00:02:00Z"),
      retryAfterMs: 120_000,
      maxAttempts: 3
    });

    const afterRetryable = getAnalysisJobsForTests()[0];
    const serializedRetryable = JSON.stringify(afterRetryable);

    expect(retryable).toBe(true);
    expect(afterRetryable).toMatchObject({
      status: "failed_retryable",
      locked_at: null,
      run_after: "2026-06-30T00:04:00.000Z",
      error_code: "github_fetch_failed"
    });
    expect(serializedRetryable).not.toContain("github_pat_");
    expect(serializedRetryable).not.toContain("sk-secret");
    expect(serializedRetryable).not.toContain("?token=");
    expect(serializedRetryable).not.toContain("Authorization");

    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:04:01Z") });
    const terminal = await failAnalysisJob({
      id,
      retryable: true,
      code: "github_fetch_failed",
      summary: "Still unavailable",
      now: new Date("2026-06-30T00:05:00Z"),
      maxAttempts: 2
    });

    expect(terminal).toBe(true);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      locked_at: null,
      run_after: "2026-06-30T00:05:00.000Z",
      error_code: "github_fetch_failed",
      error_summary: "Still unavailable"
    });
  });

  it("claims durable Supabase jobs with conditional patch and without storing raw secrets", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const queuedRow = jobRow({ id: "job_1", status: "queued", attempts: 0 });
    const claimedRow = {
      ...queuedRow,
      status: "processing",
      attempts: 1,
      updated_at: "2026-06-30T00:01:00.000Z",
      locked_at: "2026-06-30T00:01:00.000Z"
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (init?.method === "GET" && href.includes("status=in.%28queued%2Cfailed_retryable%29")) {
        return Response.json([queuedRow]);
      }
      if (init?.method === "PATCH" && href.includes("status=eq.queued") && href.includes("updated_at=eq.")) {
        return Response.json([claimedRow]);
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    const serializedBody = JSON.stringify(patchBody);

    expect(result).toMatchObject({
      store: "supabase",
      durable: true,
      job: {
        id: "job_1",
        status: "processing",
        attempts: 1
      }
    });
    expect(String(patchCall?.[0])).toContain("id=eq.job_1");
    expect(String(patchCall?.[0])).toContain("status=eq.queued");
    expect(String(patchCall?.[0])).toContain("updated_at=eq.");
    expect(patchBody).toMatchObject({
      status: "processing",
      attempts: 1,
      locked_at: "2026-06-30T00:01:00.000Z",
      error_code: null,
      error_summary: null
    });
    expect(serializedBody).not.toContain("service-role-secret");
    expect(serializedBody).not.toContain("raw");
    expect(serializedBody).not.toContain("claims");
    expect(serializedBody).not.toContain("reprompt");
  });

  it("fails durable Supabase jobs with redacted summaries and terminal max-attempt handling", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    const processingRow = jobRow({ id: "job_2", status: "processing", attempts: 5 });
    const failedRow = {
      ...processingRow,
      status: "failed_terminal",
      updated_at: "2026-06-30T00:02:00.000Z",
      locked_at: null,
      error_code: "grant_denied",
      error_summary: "Grant denied for https://api.github.com/repos/RengGyu/AgentProof"
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (init?.method === "GET" && href.includes("id=eq.job_2")) {
        return Response.json([processingRow]);
      }
      if (init?.method === "PATCH" && href.includes("id=eq.job_2") && href.includes("status=eq.processing")) {
        return Response.json([failedRow]);
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await failAnalysisJob({
      id: "job_2",
      retryable: true,
      code: "grant_denied",
      summary: "Grant denied for https://api.github.com/repos/RengGyu/AgentProof?access_token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
      now: new Date("2026-06-30T00:02:00Z"),
      maxAttempts: 5
    });
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    const patchBody = JSON.parse(String(patchCall?.[1]?.body));
    const serializedBody = JSON.stringify(patchBody);

    expect(result).toBe(true);
    expect(patchBody).toMatchObject({
      status: "failed_terminal",
      run_after: "2026-06-30T00:02:00.000Z",
      locked_at: null,
      error_code: "grant_denied"
    });
    expect(serializedBody).not.toContain("github_pat_");
    expect(serializedBody).not.toContain("access_token=");
    expect(serializedBody).not.toContain("service-role-secret");
  });
});

function jobInput() {
  return {
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
  };
}

function jobRow(overrides: Partial<ReturnType<typeof jobInput>> & {
  id: string;
  status: "queued" | "processing" | "completed" | "failed_retryable" | "failed_terminal";
  attempts: number;
}) {
  const input = jobInput();
  return {
    id: overrides.id,
    status: overrides.status,
    tenant_id: input.tenantId,
    idempotency_key_hash: "f".repeat(64),
    delivery_id: input.deliveryId,
    event: input.event,
    action: input.action,
    installation_id: input.installationId,
    repository_id: input.repositoryId,
    repository_full_name: input.repositoryFullName,
    pull_request_number: input.pullRequestNumber,
    pull_request_url: input.pullRequestUrl,
    head_sha: input.headSha,
    save_report: input.saveReport,
    comment: input.comment,
    attempts: overrides.attempts,
    created_at: "2026-06-30T00:00:00.000Z",
    updated_at: "2026-06-30T00:00:00.000Z",
    run_after: "2026-06-30T00:00:00.000Z",
    locked_at: overrides.status === "processing" ? "2026-06-30T00:00:00.000Z" : null,
    completed_at: overrides.status === "completed" ? "2026-06-30T00:00:00.000Z" : null,
    error_code: null,
    error_summary: null
  };
}
