import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertAnalysisJobIsPrivate,
  claimAnalysisJobById,
  clearAnalysisJobsForTests,
  claimAnalysisJobForProviderResponse,
  claimNextAnalysisJob,
  completeAnalysisJob,
  countTenantActiveAnalysisJobsForDeletion,
  enqueueAnalysisJob,
  failAnalysisJob,
  fenceAnalysisJobRevision,
  fenceAnalysisJobSemanticRetryFinalization,
  getAnalysisJobDeadLetterSummary,
  getAnalysisJobQueueSummary,
  getAnalysisJobQueueStatus,
  getAnalysisJobsForTests,
  listTenantAnalysisJobs,
  markAnalysisJobProviderSubmission,
  markAnalysisJobSemanticRetrySubmission,
  parkAnalysisJobForProvider,
  purgeTenantAnalysisJobsForDeletion,
  sealAnalysisJobRevision
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

  it("fails closed when canonical RPC mode is configured with a non-canonical table", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "analysis_jobs_test");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    expect(getAnalysisJobQueueStatus()).toMatchObject({
      enabled: true,
      configured: false,
      durable: false,
      table: "analysis_jobs_test",
      missingEnv: ["AGENTPROOF_ANALYSIS_JOBS_TABLE must be agentproof_analysis_jobs"]
    });
    await expect(enqueueAnalysisJob(jobInput())).rejects.toThrow("canonical table");
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
      canonical_key_hash: "365bee0a7b6f15bad9e7d640940e17d5449861b5495d7e96097927274503078a",
      desired_revision: 1,
      running_revision: null,
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

  it("coalesces same-head events into one debounced canonical memory revision", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const first = await enqueueAnalysisJob(jobInput());
    const refreshed = await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "second-delivery-key",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      event: "check_suite",
      action: "completed",
      comment: true,
      now: new Date("2026-06-30T00:00:05Z")
    });

    expect(refreshed.id).toBe(first.id);
    expect(getAnalysisJobsForTests()).toHaveLength(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id: first.id,
      status: "queued",
      event: "check_suite",
      action: "completed",
      delivery_id: "123e4567-e89b-12d3-a456-426614174301",
      desired_revision: 2,
      running_revision: null,
      run_after: "2026-06-30T00:00:20.000Z",
      comment: true
    });
  });

  it("keeps separate canonical rows for different heads", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const first = await enqueueAnalysisJob(jobInput());
    const nextHead = await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "next-head-key",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      headSha: "def456"
    });

    expect(nextHead.id).not.toBe(first.id);
    expect(getAnalysisJobsForTests()).toHaveLength(2);
    expect(new Set(getAnalysisJobsForTests().map((job) => job.canonical_key_hash)).size).toBe(2);
  });

  it("requeues a processing canonical row when its running revision becomes stale", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const first = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:00:15Z") });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "refresh-while-processing",
      deliveryId: "123e4567-e89b-12d3-a456-426614174303",
      now: new Date("2026-06-30T00:00:16Z")
    });

    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id: first.id,
      status: "processing",
      desired_revision: 2,
      running_revision: 1
    });
    await expect(fenceAnalysisJobRevision({
      id: first.id,
      claimGeneration: claim.job!.claim_generation!,
      runningRevision: claim.job!.running_revision!,
      now: new Date("2026-06-30T00:00:17Z")
    })).resolves.toBe(false);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      claim_generation: null
    });
  });

  it("requeues a completed canonical row only when a later eligible event refreshes it", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const first = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:00:15Z") });
    await completeAnalysisJob({
      id: first.id,
      claimGeneration: claim.job!.claim_generation!,
      now: new Date("2026-06-30T00:00:16Z")
    });
    expect(getAnalysisJobsForTests()[0].status).toBe("completed");

    const refreshed = await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "later-completed-refresh",
      deliveryId: "123e4567-e89b-12d3-a456-426614174305",
      now: new Date("2026-06-30T00:00:20Z")
    });

    expect(refreshed.id).toBe(first.id);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      run_after: "2026-06-30T00:00:35.000Z"
    });
  });

  it("uses one durable RPC call to atomically enqueue or refresh a canonical row", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const fetchMock = vi.fn(async () => Response.json([{ id: "canonical-job", status: "queued" }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await enqueueAnalysisJob(jobInput());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(result.id).toBe("canonical-job");
    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_enqueue_analysis_job");
    expect(init.method).toBe("POST");
    expect(body.job_payload).toMatchObject({
      canonical_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      desired_revision: 1,
      running_revision: null
    });
    expect(JSON.stringify(body)).not.toContain("raw-idempotency-key");
    expect(JSON.stringify(body)).not.toContain("service-role-secret");
  });

  it("uses the durable revision-fence RPC to requeue stale Supabase work atomically", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    const current = await fenceAnalysisJobRevision({
      id: "123e4567-e89b-42d3-a456-426614174000",
      claimGeneration: "123e4567-e89b-42d3-a456-426614174001",
      runningRevision: 1,
      now: new Date("2026-06-30T00:01:00Z")
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(current).toBe(false);
    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_fence_analysis_job_revision");
    expect(JSON.parse(String(init.body))).toEqual({
      job_id: "123e4567-e89b-42d3-a456-426614174000",
      claim_token: "123e4567-e89b-42d3-a456-426614174001",
      claim_revision: 1,
      fence_time: "2026-06-30T00:01:00.000Z"
    });
    expect(JSON.stringify({ url, body: init.body })).not.toContain("service-role-secret");
  });

  it("uses the durable publication-seal RPC as the revision linearization point", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    const fetchMock = vi.fn(async () => Response.json([{ id: "sealed-job" }]));
    vi.stubGlobal("fetch", fetchMock);

    const sealed = await sealAnalysisJobRevision({
      id: "123e4567-e89b-42d3-a456-426614174000",
      claimGeneration: "123e4567-e89b-42d3-a456-426614174001",
      runningRevision: 3,
      now: new Date("2026-06-30T00:01:00Z")
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(sealed).toBe(true);
    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_seal_analysis_job_revision");
    expect(JSON.parse(String(init.body))).toEqual({
      job_id: "123e4567-e89b-42d3-a456-426614174000",
      claim_token: "123e4567-e89b-42d3-a456-426614174001",
      claim_revision: 3,
      seal_time: "2026-06-30T00:01:00.000Z"
    });
  });

  it("does not let sealed completion consume a refresh ordered after publication", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const { id } = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:00:15Z") });
    await sealAnalysisJobRevision({
      id,
      claimGeneration: claim.job!.claim_generation!,
      runningRevision: claim.job!.running_revision!,
      now: new Date("2026-06-30T00:00:16Z")
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "refresh-after-seal-before-complete",
      deliveryId: "123e4567-e89b-12d3-a456-426614174306",
      now: new Date("2026-06-30T00:00:17Z")
    });

    await expect(completeAnalysisJob({
      id,
      claimGeneration: claim.job!.claim_generation!,
      now: new Date("2026-06-30T00:00:18Z")
    })).resolves.toBe(true);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      result_summary: null
    });
  });

  it("does not let sealed failure consume a refresh ordered after publication", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const { id } = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:00:15Z") });
    await sealAnalysisJobRevision({
      id,
      claimGeneration: claim.job!.claim_generation!,
      runningRevision: claim.job!.running_revision!,
      now: new Date("2026-06-30T00:00:16Z")
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "refresh-after-seal-before-fail",
      deliveryId: "123e4567-e89b-12d3-a456-426614174307",
      now: new Date("2026-06-30T00:00:17Z")
    });

    await expect(failAnalysisJob({
      id,
      claimGeneration: claim.job!.claim_generation!,
      retryable: true,
      code: "temporary_failure",
      summary: "Temporary publication failure.",
      now: new Date("2026-06-30T00:00:18Z")
    })).resolves.toBe(true);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      error_code: null
    });
  });

  it("recovers the latest unsealed revision without reusing an older provider continuation", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const { id } = await enqueueAnalysisJob(jobInput());
    await claimNextAnalysisJob({ now: new Date("2026-06-30T00:00:15Z") });
    const stored = getAnalysisJobsForTests()[0];
    stored.provider_response_id = "resp_old_revision_123";
    stored.provider_status = "in_progress";
    stored.provider_submitted_at = "2026-06-30T00:00:15.000Z";
    stored.provider_expires_at = "2026-06-30T00:09:00.000Z";
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "refresh-before-unsealed-recovery",
      deliveryId: "123e4567-e89b-12d3-a456-426614174308",
      now: new Date("2026-06-30T00:00:16Z")
    });

    const recovered = await claimNextAnalysisJob({
      now: new Date("2026-06-30T00:03:00Z"),
      leaseMs: 60_000
    });

    expect(recovered.job).toMatchObject({
      id,
      status: "processing",
      desired_revision: 2,
      running_revision: 2,
      sealed_revision: null,
      provider_response_id: null,
      provider_status: null
    });
  });

  it("recovers a sealed publication on its sealed revision even when a later revision is desired", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const { id } = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:00:15Z") });
    await sealAnalysisJobRevision({
      id,
      claimGeneration: claim.job!.claim_generation!,
      runningRevision: claim.job!.running_revision!,
      now: new Date("2026-06-30T00:00:16Z")
    });
    await enqueueAnalysisJob({
      ...jobInput(),
      idempotencyKey: "refresh-after-seal-before-recovery",
      deliveryId: "123e4567-e89b-12d3-a456-426614174309",
      now: new Date("2026-06-30T00:00:17Z")
    });

    const recovered = await claimNextAnalysisJob({
      now: new Date("2026-06-30T00:03:00Z"),
      leaseMs: 60_000
    });

    expect(recovered.job).toMatchObject({
      id,
      status: "processing",
      desired_revision: 2,
      running_revision: 1,
      sealed_revision: 1,
      publication_sealed_at: "2026-06-30T00:00:16.000Z"
    });
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
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      return Response.json([payload.job_payload], { status: 200 });
    });
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
      "https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_enqueue_analysis_job",
      expect.objectContaining({ method: "POST" })
    );
    expect(body.job_payload).toMatchObject({
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
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
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
    expect(serialized).not.toContain("agentproof_analysis_jobs");
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
      claimGeneration: claim.job!.claim_generation!,
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
      running_revision: null,
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

  it("parks a processing job for provider polling and reclaims the same opaque response id when due", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const parked = await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_background_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const parkedRunningRevision = getAnalysisJobsForTests()[0].running_revision;
    const early = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:14Z") });
    const due = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });

    expect(parked).toBe(true);
    expect(parkedRunningRevision).toBeNull();
    expect(early.job).toBeNull();
    expect(due.job).toMatchObject({
      id,
      status: "processing",
      provider_response_id: "resp_background_123",
      provider_status: "in_progress",
      attempts: 1,
      provider_poll_attempts: 1,
      provider_submitted_at: "2026-06-30T00:01:00.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    });
    const tenantProjection = await listTenantAnalysisJobs({ tenantId: "tenant_a", limit: 10 });
    expect(JSON.stringify(tenantProjection)).not.toContain("resp_background_123");
    expect(JSON.stringify(tenantProjection)).not.toContain("provider_");
  });

  it("claims exactly one queued provider continuation by opaque response id", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_webhook_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:08:00Z")
    });

    const claimed = await claimAnalysisJobForProviderResponse("resp_webhook_123", {
      now: new Date("2026-06-30T00:01:10Z"),
      webhookId: "wh_delivery_123"
    });
    const duplicate = await claimAnalysisJobForProviderResponse("resp_webhook_123", {
      now: new Date("2026-06-30T00:01:11Z"),
      webhookId: "wh_delivery_123"
    });
    const unknown = await claimAnalysisJobForProviderResponse("resp_unknown_123", {
      now: new Date("2026-06-30T00:01:12Z"),
      webhookId: "wh_unknown_123"
    });

    expect(claimed.job).toMatchObject({
      id,
      status: "processing",
      provider_response_id: "resp_webhook_123",
      provider_status: "in_progress",
      attempts: 1,
      claim_generation: expect.any(String)
    });
    expect(duplicate.job).toBeNull();
    expect(unknown.job).toBeNull();
    expect(JSON.stringify(getAnalysisJobsForTests())).not.toContain("wh_delivery_123");
    const tenantProjection = await listTenantAnalysisJobs({ tenantId: "tenant_a", limit: 10 });
    expect(JSON.stringify(tenantProjection)).not.toContain("provider_webhook");
    expect(JSON.stringify(tenantProjection)).not.toContain("resp_webhook_123");
    expect(JSON.stringify({ claimed, duplicate, unknown })).not.toContain("service-role-secret");
  });

  it("claims the requested queued job without consuming an older queued job", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const first = await enqueueAnalysisJob(jobInput());
    const requested = await enqueueAnalysisJob({
      ...jobInput(),
      headSha: "def456",
      now: new Date("2026-06-30T00:00:01Z")
    });
    const claim = await claimAnalysisJobById(requested.id, { now: new Date("2026-06-30T00:00:16Z") });

    expect(claim.job).toMatchObject({ id: requested.id });
    expect(getAnalysisJobsForTests().find((job) => job.id === first.id)).toMatchObject({ status: "queued" });
  });

  it("rejects malformed provider response ids before lookup", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    await expect(claimAnalysisJobForProviderResponse("resp_bad?token=secret", { webhookId: "wh_delivery_123" }))
      .rejects.toThrow("Analysis job provider response id is invalid.");
    await expect(claimAnalysisJobForProviderResponse("resp_valid_123", { webhookId: "bad webhook id" }))
      .rejects.toThrow("OpenAI webhook id is invalid.");
    expect(getAnalysisJobsForTests()).toEqual([]);
  });

  it("does not let a repeated webhook delivery bypass retry backoff", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_webhook_retry_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const webhookClaim = await claimAnalysisJobForProviderResponse("resp_webhook_retry_123", {
      now: new Date("2026-06-30T00:01:10Z"),
      webhookId: "wh_retry_123"
    });
    await failAnalysisJob({
      id,
      claimGeneration: webhookClaim.job!.claim_generation!,
      retryable: true,
      code: "openai_provider_unavailable",
      summary: "OpenAI response retrieval is temporarily unavailable.",
      now: new Date("2026-06-30T00:01:11Z"),
      retryAfterMs: 120_000
    });

    const replayBeforeBackoff = await claimAnalysisJobForProviderResponse("resp_webhook_retry_123", {
      now: new Date("2026-06-30T00:01:12Z"),
      webhookId: "wh_retry_123"
    });
    const replayAfterBackoff = await claimAnalysisJobForProviderResponse("resp_webhook_retry_123", {
      now: new Date("2026-06-30T00:03:11Z"),
      webhookId: "wh_retry_123"
    });

    expect(replayBeforeBackoff.job).toBeNull();
    expect(replayBeforeBackoff.disposition).toBe("backoff");
    expect(replayAfterBackoff.job).toMatchObject({ id, status: "processing" });
    const serialized = JSON.stringify(getAnalysisJobsForTests());
    expect(serialized).not.toContain("wh_retry_123");
    expect(serialized).toMatch(/provider_webhook_id_hash[^a-z0-9]*[a-f0-9]{64}/i);
  });

  it("claims a Supabase provider continuation with status and updated-at fencing", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const queuedRow = {
      id: "job_123",
      status: "queued",
      tenant_id: "tenant_a",
      idempotency_key_hash: "a".repeat(64),
      delivery_id: "delivery_123",
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
      attempts: 0,
      created_at: "2026-06-30T00:00:00.000Z",
      updated_at: "2026-06-30T00:01:00.000Z",
      run_after: "2026-06-30T00:08:00.000Z",
      locked_at: null,
      completed_at: null,
      error_code: null,
      error_summary: null,
      result_summary: null,
      claim_generation: null,
      provider_response_id: "resp_webhook_123",
      provider_status: "in_progress",
      provider_poll_attempts: 1,
      provider_submitted_at: "2026-06-30T00:01:00.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const update = JSON.parse(String(init.body));
        return Response.json([{ ...queuedRow, ...update }]);
      }
      return Response.json([queuedRow]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimAnalysisJobForProviderResponse("resp_webhook_123", {
      now: new Date("2026-06-30T00:01:10Z"),
      webhookId: "wh_delivery_123"
    });

    expect(result.job).toMatchObject({
      id: "job_123",
      status: "processing",
      claim_generation: expect.any(String)
    });
    const [getUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(decodeURIComponent(getUrl)).toContain("provider_response_id=eq.resp_webhook_123");
    expect(decodeURIComponent(getUrl)).toContain("status=in.(queued,failed_retryable,processing)");
    expect(decodeURIComponent(patchUrl)).toContain("status=eq.queued");
    expect(decodeURIComponent(patchUrl)).toContain("updated_at=eq.2026-06-30T00:01:00.000Z");
    expect(JSON.stringify({ getUrl, patchUrl, body: patchInit.body })).not.toContain("service-role-secret");
  });

  it("rejects malformed or secret-like provider continuation ids before storage", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    await expect(parkAnalysisJobForProvider({
      id,
      claimGeneration: claim.job!.claim_generation!,
      responseId: "resp_valid?token=github_pat_secret",
      providerStatus: "queued",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    })).rejects.toThrow("Analysis job provider continuation is invalid.");
    expect(JSON.stringify(getAnalysisJobsForTests()[0])).not.toContain("github_pat_secret");
  });

  it("fences stale workers and records submission intent before an external provider call", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const first = await claimNextAnalysisJob({
      now: new Date("2026-06-30T00:01:00Z"),
      leaseMs: 1_000
    });
    const firstToken = first.job!.claim_generation!;
    const marked = await markAnalysisJobProviderSubmission({
      id,
      claimGeneration: firstToken,
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      now: new Date("2026-06-30T00:01:00Z")
    });
    const second = await claimNextAnalysisJob({
      now: new Date("2026-06-30T00:01:02Z"),
      leaseMs: 1_000
    });

    expect(marked).toMatchObject({
      status: "processing",
      claim_generation: firstToken,
      provider_status: "submitting",
      provider_response_id: null
    });
    expect(second.job!.claim_generation).not.toBe(firstToken);
    await expect(parkAnalysisJobForProvider({
      id,
      claimGeneration: firstToken,
      responseId: "resp_stale_worker_123",
      providerStatus: "queued",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z"),
      now: new Date("2026-06-30T00:01:03Z")
    })).resolves.toBe(false);
    await expect(completeAnalysisJob({
      id,
      claimGeneration: firstToken,
      now: new Date("2026-06-30T00:01:03Z")
    })).resolves.toBe(false);
    await expect(failAnalysisJob({
      id,
      claimGeneration: firstToken,
      retryable: false,
      code: "stale_worker",
      summary: "Stale worker must not alter the current claim.",
      now: new Date("2026-06-30T00:01:03Z")
    })).resolves.toBe(false);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "processing",
      claim_generation: second.job!.claim_generation,
      provider_status: "submitting"
    });
  });

  it("rejects provider submission windows longer than the bounded continuation lifetime", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    await expect(markAnalysisJobProviderSubmission({
      id,
      claimGeneration: claim.job!.claim_generation!,
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:12:00Z")
    })).rejects.toThrow("Analysis job provider submission marker is invalid.");
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "processing",
      provider_response_id: null,
      provider_status: null
    });
  });

  it("atomically moves the first response into a bounded prior continuation before retry submission", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_background_first_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const retryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });

    const marked = await markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      priorResponseId: "resp_background_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      now: new Date("2026-06-30T00:01:20Z")
    });

    expect(marked).toMatchObject({
      status: "processing",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_first_123",
      prior_provider_submitted_at: "2026-06-30T00:01:00.000Z",
      prior_provider_expires_at: "2026-06-30T00:09:00.000Z",
      provider_response_id: null,
      provider_status: "submitting",
      provider_submitted_at: "2026-06-30T00:01:20.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    });

    await expect(markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      priorResponseId: "resp_background_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:21Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z")
    })).resolves.toBeNull();
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_first_123",
      provider_response_id: null,
      provider_status: "submitting"
    });
  });

  it("reclaims only an abandoned semantic retry submission after its bounded short lease", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_reclaim_first_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const retryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });
    const marked = await markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      priorResponseId: "resp_reclaim_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      now: new Date("2026-06-30T00:01:20Z")
    });

    const tooEarly = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:49.999Z") });
    const reclaimed = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:50.001Z") });
    const secondReclaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:02:20.002Z") });

    expect(marked).toMatchObject({ locked_at: "2026-06-30T00:01:20.000Z" });
    expect(tooEarly.job).toBeNull();
    expect(reclaimed.job).toMatchObject({
      id,
      status: "processing",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_reclaim_first_123",
      provider_response_id: null,
      provider_status: "in_progress",
      provider_submitted_at: null,
      provider_expires_at: null,
      attempts: 2
    });
    expect(reclaimed.job!.claim_generation).not.toBe(retryClaim.job!.claim_generation);
    expect(secondReclaim.job).toBeNull();
  });

  it("atomically exits semantic retry submission uncertainty before finalization side effects", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_fence_first_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const retryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });
    await markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      priorResponseId: "resp_fence_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      now: new Date("2026-06-30T00:01:20Z")
    });

    const fenced = await fenceAnalysisJobSemanticRetryFinalization({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      now: new Date("2026-06-30T00:01:25Z")
    });
    const earlyReclaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:55.001Z") });

    expect(fenced).toMatchObject({
      status: "processing",
      locked_at: "2026-06-30T00:01:25.000Z",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_fence_first_123",
      provider_response_id: null,
      provider_status: null,
      provider_submitted_at: null,
      provider_expires_at: null
    });
    expect(earlyReclaim.job).toBeNull();
  });

  it("does not shorten the normal processing lease outside semantic retry submission uncertainty", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const earlyReclaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:31Z") });

    expect(claim.job).toMatchObject({ status: "processing", semantic_retry_attempts: 0 });
    expect(earlyReclaim.job).toBeNull();
  });

  it("preserves both active and prior opaque references while a retryable retry poll backs off", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_background_first_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const retryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });
    await markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      priorResponseId: "resp_background_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z")
    });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      responseId: "resp_background_retry_123",
      providerStatus: "queued",
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:35Z")
    });
    const pollClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:35Z") });
    await failAnalysisJob({
      id,
      claimGeneration: pollClaim.job!.claim_generation!,
      retryable: true,
      code: "openai_rate_limited",
      summary: "OpenAI semantic request is temporarily limited.",
      now: new Date("2026-06-30T00:01:36Z"),
      maxAttempts: 20
    });

    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_first_123",
      provider_response_id: "resp_background_retry_123",
      provider_status: "queued"
    });
  });

  it("preserves Supabase active and prior retry references through retryable backoff", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const processingRow = {
      ...jobRow({ id: "job_retry_backoff_123", status: "processing", attempts: 2 }),
      claim_generation: "123e4567-e89b-42d3-a456-426614174000",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_first_123",
      prior_provider_submitted_at: "2026-06-30T00:01:00.000Z",
      prior_provider_expires_at: "2026-06-30T00:09:00.000Z",
      provider_response_id: "resp_background_retry_123",
      provider_status: "queued",
      provider_submitted_at: "2026-06-30T00:01:20.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    };
    const fetchMock = vi.fn(async () => Response.json([processingRow]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await failAnalysisJob({
      id: processingRow.id,
      claimGeneration: processingRow.claim_generation,
      retryable: true,
      code: "openai_rate_limited",
      summary: "OpenAI semantic request is temporarily limited.",
      now: new Date("2026-06-30T00:01:36Z"),
      maxAttempts: 20
    });
    const [rpcUrl, rpcInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const rpcBody = JSON.parse(String(rpcInit.body));

    expect(result).toBe(true);
    expect(rpcUrl).toContain("/rpc/agentproof_fail_analysis_job");
    expect(rpcBody).toMatchObject({
      retryable_failure: true,
      retry_after_ms: 120000,
      maximum_attempts: 20
    });
    expect(rpcBody).not.toHaveProperty("semantic_retry_attempts");
    expect(rpcBody).not.toHaveProperty("prior_provider_response_id");
    expect(rpcBody).not.toHaveProperty("provider_response_id");
  });

  it("uses claim and updated-at fencing for the Supabase semantic retry transition", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const processingRow = {
      ...jobRow({ id: "job_semantic_retry_123", status: "processing", attempts: 1 }),
      status: "processing",
      updated_at: "2026-06-30T00:01:15.000Z",
      claim_generation: "123e4567-e89b-42d3-a456-426614174000",
      provider_response_id: "resp_background_first_123",
      provider_status: "in_progress",
      provider_submitted_at: "2026-06-30T00:01:00.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      prior_provider_submitted_at: null,
      prior_provider_expires_at: null
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Response.json([{ ...processingRow, ...JSON.parse(String(init.body)) }]);
      }
      return Response.json([processingRow]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await markAnalysisJobSemanticRetrySubmission({
      id: processingRow.id,
      claimGeneration: processingRow.claim_generation,
      priorResponseId: "resp_background_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      now: new Date("2026-06-30T00:01:20Z")
    });

    expect(result).toMatchObject({ semantic_retry_attempts: 1, provider_status: "submitting" });
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(decodeURIComponent(patchUrl)).toContain("status=eq.processing");
    expect(decodeURIComponent(patchUrl)).toContain(`claim_generation=eq.${processingRow.claim_generation}`);
    expect(decodeURIComponent(patchUrl)).toContain("updated_at=eq.2026-06-30T00:01:15.000Z");
    expect(JSON.parse(String(patchInit.body))).toMatchObject({
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_first_123",
      provider_response_id: null,
      provider_status: "submitting"
    });
  });

  it("fences Supabase semantic retry finalization with claim and updated-at CAS", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const processingRow = {
      ...jobRow({ id: "job_semantic_finalization_123", status: "processing", attempts: 2 }),
      updated_at: "2026-06-30T00:01:20.000Z",
      locked_at: "2026-06-30T00:01:20.000Z",
      claim_generation: "123e4567-e89b-42d3-a456-426614174000",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_fence_first_123",
      prior_provider_submitted_at: "2026-06-30T00:01:00.000Z",
      prior_provider_expires_at: "2026-06-30T00:09:00.000Z",
      provider_response_id: null,
      provider_status: "submitting",
      provider_submitted_at: "2026-06-30T00:01:20.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return Response.json([{ ...processingRow, ...JSON.parse(String(init.body)) }]);
      }
      return Response.json([processingRow]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fenceAnalysisJobSemanticRetryFinalization({
      id: processingRow.id,
      claimGeneration: processingRow.claim_generation,
      now: new Date("2026-06-30T00:01:25Z")
    });
    const [patchUrl, patchInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const patchBody = JSON.parse(String(patchInit.body));

    expect(result).toMatchObject({
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_fence_first_123",
      provider_status: null,
      provider_submitted_at: null,
      provider_expires_at: null
    });
    expect(decodeURIComponent(patchUrl)).toContain("status=eq.processing");
    expect(decodeURIComponent(patchUrl)).toContain(`claim_generation=eq.${processingRow.claim_generation}`);
    expect(decodeURIComponent(patchUrl)).toContain("updated_at=eq.2026-06-30T00:01:20.000Z");
    expect(patchBody).toMatchObject({
      updated_at: "2026-06-30T00:01:25.000Z",
      locked_at: "2026-06-30T00:01:25.000Z",
      provider_response_id: null,
      provider_status: null,
      provider_poll_attempts: 0,
      provider_submitted_at: null,
      provider_expires_at: null
    });
    expect(patchBody).not.toHaveProperty("prior_provider_response_id");
    expect(patchBody).not.toHaveProperty("semantic_retry_attempts");
  });

  it("returns no Supabase semantic retry finalization fence when the CAS loses", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const processingRow = {
      ...jobRow({ id: "job_semantic_finalization_loser_123", status: "processing", attempts: 2 }),
      updated_at: "2026-06-30T00:01:20.000Z",
      locked_at: "2026-06-30T00:01:20.000Z",
      claim_generation: "123e4567-e89b-42d3-a456-426614174000",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_fence_first_123",
      prior_provider_submitted_at: "2026-06-30T00:01:00.000Z",
      prior_provider_expires_at: "2026-06-30T00:09:00.000Z",
      provider_response_id: null,
      provider_status: "submitting",
      provider_submitted_at: "2026-06-30T00:01:20.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    };
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      init?.method === "PATCH" ? Response.json([]) : Response.json([processingRow])
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fenceAnalysisJobSemanticRetryFinalization({
      id: processingRow.id,
      claimGeneration: processingRow.claim_generation,
      now: new Date("2026-06-30T00:01:25Z")
    });

    expect(result).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(1);
  });

  it("reclaims abandoned Supabase retry submission state with status and updated-at CAS fencing", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const uncertainRow = {
      ...jobRow({ id: "job_retry_reclaim_123", status: "processing", attempts: 1 }),
      updated_at: "2026-06-30T00:01:20.000Z",
      locked_at: "2026-06-30T00:01:20.000Z",
      claim_generation: "123e4567-e89b-42d3-a456-426614174000",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_reclaim_first_123",
      prior_provider_submitted_at: "2026-06-30T00:01:00.000Z",
      prior_provider_expires_at: "2026-06-30T00:09:00.000Z",
      provider_response_id: null,
      provider_status: "submitting",
      provider_submitted_at: "2026-06-30T00:01:20.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = decodeURIComponent(String(url));
      if (init?.method === "PATCH") {
        const update = JSON.parse(String(init.body));
        return Response.json([{ ...uncertainRow, ...update }]);
      }
      if (href.includes("semantic_retry_attempts=eq.1")) return Response.json([uncertainRow]);
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:50.001Z") });

    expect(result.job).toMatchObject({ id: uncertainRow.id, status: "processing", attempts: 2 });
    const specialUrl = decodeURIComponent(String(fetchMock.mock.calls[1]?.[0]));
    const patchUrl = decodeURIComponent(String(fetchMock.mock.calls[2]?.[0]));
    const patchBody = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(specialUrl).toContain("semantic_retry_attempts=eq.1");
    expect(specialUrl).toContain("provider_status=eq.submitting");
    expect(specialUrl).toContain("provider_response_id=is.null");
    expect(specialUrl).toContain("prior_provider_expires_at=gt.2026-06-30T00:01:50.001Z");
    expect(patchUrl).toContain("status=eq.processing");
    expect(patchUrl).toContain("updated_at=eq.2026-06-30T00:01:20.000Z");
    expect(patchBody).toMatchObject({
      provider_response_id: null,
      provider_status: "in_progress",
      provider_submitted_at: null,
      provider_expires_at: null,
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_reclaim_first_123"
    });
  });

  it("returns no Supabase retry reclaim when the CAS update loses", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const uncertainRow = {
      ...jobRow({ id: "job_retry_reclaim_loser_123", status: "processing", attempts: 1 }),
      updated_at: "2026-06-30T00:01:20.000Z",
      locked_at: "2026-06-30T00:01:20.000Z",
      claim_generation: "123e4567-e89b-42d3-a456-426614174000",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_reclaim_first_123",
      prior_provider_submitted_at: "2026-06-30T00:01:00.000Z",
      prior_provider_expires_at: "2026-06-30T00:09:00.000Z",
      provider_response_id: null,
      provider_status: "submitting",
      provider_submitted_at: "2026-06-30T00:01:20.000Z",
      provider_expires_at: "2026-06-30T00:09:00.000Z"
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = decodeURIComponent(String(url));
      if (init?.method === "PATCH") return Response.json([]);
      if (href.includes("semantic_retry_attempts=eq.1")) return Response.json([uncertainRow]);
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:50.001Z") });

    expect(result.job).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "PATCH")).toHaveLength(1);
  });

  it("clears active and prior continuation metadata when the semantic retry is exhausted", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_background_123",
      providerStatus: "queued",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const secondClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });
    await markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: secondClaim.job!.claim_generation!,
      priorResponseId: "resp_background_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:16Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z")
    });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: secondClaim.job!.claim_generation!,
      responseId: "resp_background_retry_123",
      providerStatus: "queued",
      submittedAt: new Date("2026-06-30T00:01:16Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:31Z")
    });
    const retryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:31Z") });
    await failAnalysisJob({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      retryable: true,
      code: "openai_background_failed",
      summary: "OpenAI background analysis failed.",
      now: new Date("2026-06-30T00:01:32Z"),
      maxAttempts: 1
    });

    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      prior_provider_submitted_at: null,
      prior_provider_expires_at: null,
      provider_response_id: null,
      provider_status: null,
      provider_poll_attempts: 0,
      provider_submitted_at: null,
      provider_expires_at: null,
      provider_webhook_id_hash: null,
      provider_webhook_received_at: null
    });
  });

  it("preserves provider continuation metadata for a bounded retryable poll failure", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_background_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const secondClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });
    await failAnalysisJob({
      id,
      claimGeneration: secondClaim.job!.claim_generation!,
      retryable: true,
      code: "openai_rate_limited",
      summary: "OpenAI semantic request is temporarily limited.",
      now: new Date("2026-06-30T00:01:16Z"),
      maxAttempts: 20
    });

    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      provider_response_id: "resp_background_123",
      provider_status: "in_progress",
      provider_poll_attempts: 1
    });
  });

  it("defines a service-role-only durable queue with bounded provider continuation columns", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/202608090002_analysis_jobs_openai_background.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("create table if not exists public.agentproof_analysis_jobs");
    expect(migration).toContain("provider_response_id text");
    expect(migration).toContain("claim_generation text");
    expect(migration).toContain("provider_status text");
    expect(migration).toContain("provider_poll_attempts integer");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.agentproof_analysis_jobs from anon, authenticated");
    expect(migration).toContain("grant select, insert, update, delete on table public.agentproof_analysis_jobs to service_role");

    const webhookMigration = readFileSync(
      new URL("../../supabase/migrations/202608100001_analysis_jobs_openai_webhook.sql", import.meta.url),
      "utf8"
    );
    expect(webhookMigration).toContain("create unique index if not exists agentproof_analysis_jobs_provider_response_id_idx");
    expect(webhookMigration).toContain("where provider_response_id is not null");

    const retryMigration = readFileSync(
      new URL("../../supabase/migrations/202608100002_analysis_jobs_openai_semantic_retry.sql", import.meta.url),
      "utf8"
    );
    expect(retryMigration).toContain("semantic_retry_attempts integer not null default 0");
    expect(retryMigration).toContain("prior_provider_response_id text");
    expect(retryMigration).toContain("prior_provider_submitted_at timestamptz");
    expect(retryMigration).toContain("prior_provider_expires_at timestamptz");
    expect(retryMigration).toContain("semantic_retry_attempts between 0 and 1");
    expect(retryMigration).toContain("prior_provider_response_id ~ '^resp_[A-Za-z0-9_-]{1,180}$'");
    expect(retryMigration).toContain("prior_provider_expires_at > prior_provider_submitted_at");
    expect(retryMigration).toContain("prior_provider_expires_at <= prior_provider_submitted_at + interval '10 minutes'");
    expect(retryMigration).toContain("revoke all on table public.agentproof_analysis_jobs from anon, authenticated");
    expect(retryMigration).toContain("grant select, insert, update, delete on table public.agentproof_analysis_jobs to service_role");
  });

  it("defines canonical revision RPCs and a Vault-backed one-minute recovery trigger", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/202608110001_analysis_jobs_canonical_recovery.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("canonical_key_hash text");
    expect(migration).toContain("desired_revision bigint");
    expect(migration).toContain("running_revision bigint");
    expect(migration).toContain("sealed_revision bigint");
    expect(migration).toContain("create unique index agentproof_analysis_jobs_canonical_key_idx");
    expect(migration).toContain("function public.agentproof_enqueue_analysis_job(job_payload jsonb)");
    expect(migration).toContain("function public.agentproof_fence_analysis_job_revision(");
    expect(migration).toContain("function public.agentproof_seal_analysis_job_revision(");
    expect(migration).toContain("function public.agentproof_complete_analysis_job(");
    expect(migration).toContain("function public.agentproof_fail_analysis_job(");
    expect(migration).toContain("from vault.decrypted_secrets");
    expect(migration).toContain("cron.schedule(");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain("net.http_get(");
    expect(migration).not.toContain("delete from public.agentproof_analysis_jobs");
    expect(migration).toContain("'legacy'");
    expect(migration).toContain("ranked.position > 1");
    expect(migration).not.toMatch(/Bearer\s+[A-Za-z0-9_-]{20,}/);
  });

  it("preserves duplicate upgrade rows while assigning only non-conflicting legacy identities", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/202608110001_analysis_jobs_canonical_recovery.sql", import.meta.url),
      "utf8"
    );
    const legacyRewrite = migration.match(/with ranked as \([\s\S]*?where jobs\.id = ranked\.id and ranked\.position > 1;/)?.[0];
    const rewrittenColumns = legacyRewrite?.match(/set ([\s\S]*?)from ranked/)?.[1] ?? "";

    expect(legacyRewrite).toBeDefined();
    expect(rewrittenColumns).toContain("canonical_key_hash =");
    expect(rewrittenColumns).not.toMatch(/\b(?:status|result_summary|claim_generation|provider_[a-z_]+)\s*=/);
    expect(migration).not.toMatch(/delete\s+from\s+public\.agentproof_analysis_jobs/i);
  });

  it("lists tenant analysis jobs as summary-only projections", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const tenantA = await enqueueAnalysisJob(jobInput());
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await completeAnalysisJob({
      id: tenantA.id,
      claimGeneration: claim.job!.claim_generation!,
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
        runAfter: "2026-06-30T00:00:15.000Z",
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

  it("deletes a tenant job populated with both prior and active semantic continuations", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");

    const { id } = await enqueueAnalysisJob(jobInput());
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      responseId: "resp_deletion_first_123",
      providerStatus: "in_progress",
      submittedAt: new Date("2026-06-30T00:01:00Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:15Z")
    });
    const retryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:15Z") });
    await markAnalysisJobSemanticRetrySubmission({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      priorResponseId: "resp_deletion_first_123",
      priorSubmittedAt: new Date("2026-06-30T00:01:00Z"),
      priorExpiresAt: new Date("2026-06-30T00:09:00Z"),
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      now: new Date("2026-06-30T00:01:20Z")
    });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: retryClaim.job!.claim_generation!,
      responseId: "resp_deletion_retry_123",
      providerStatus: "queued",
      submittedAt: new Date("2026-06-30T00:01:20Z"),
      expiresAt: new Date("2026-06-30T00:09:00Z"),
      runAfter: new Date("2026-06-30T00:01:35Z")
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      prior_provider_response_id: "resp_deletion_first_123",
      provider_response_id: "resp_deletion_retry_123"
    });

    const result = await purgeTenantAnalysisJobsForDeletion({ tenantId: "tenant_a" });

    expect(result).toMatchObject({ deletedCount: 1, store: "memory" });
    expect(getAnalysisJobsForTests()).toEqual([]);
  });

  it("purges durable Supabase tenant analysis jobs with count-first metadata and no row body", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
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
    expect(countUrl).toBe("https://agentproof-test.supabase.co/rest/v1/agentproof_analysis_jobs?tenant_id=eq.tenant_a&select=id");
    expect(countInit.method).toBe("HEAD");
    expect(countInit.body).toBeUndefined();
    expect(countInit.headers).toMatchObject({
      Prefer: "count=exact",
      Range: "0-0"
    });
    expect(deleteUrl).toBe("https://agentproof-test.supabase.co/rest/v1/agentproof_analysis_jobs?tenant_id=eq.tenant_a");
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteInit.body).toBeUndefined();
    expect(deleteInit.headers).toMatchObject({
      Prefer: "return=minimal"
    });
    expect(serializedResult).not.toContain("tenant_a");
    expect(serializedResult).not.toContain("agentproof_analysis_jobs");
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
      error_code: "stripe_cus_secret_should_not_leak",
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
        { errorCode: "unknown", count: 1 }
      ],
      oldestTerminalAgeSeconds: 300
    });
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("pull");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("stripe_cus");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("terminal-idempotency");
    expect(serialized).not.toContain("delivery_id");
    expect(serialized).not.toContain("idempotency");
  });

  it("queries durable dead-letter summaries with a narrow Supabase projection", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
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
    expect(serialized).not.toContain("agentproof_analysis_jobs");
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
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const retryable = await failAnalysisJob({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
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
      running_revision: null,
      locked_at: null,
      run_after: "2026-06-30T00:04:00.000Z",
      error_code: "github_fetch_failed"
    });
    expect(serializedRetryable).not.toContain("github_pat_");
    expect(serializedRetryable).not.toContain("sk-secret");
    expect(serializedRetryable).not.toContain("?token=");
    expect(serializedRetryable).not.toContain("Authorization");

    const secondClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:04:01Z") });
    const terminal = await failAnalysisJob({
      id,
      claimGeneration: secondClaim.job!.claim_generation!,
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
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
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
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_TABLE", "agentproof_analysis_jobs");
    const processingRow = {
      ...jobRow({ id: "job_2", status: "processing", attempts: 5 }),
      claim_generation: "123e4567-e89b-42d3-a456-426614174000"
    };
    const failedRow = {
      ...processingRow,
      status: "failed_terminal",
      updated_at: "2026-06-30T00:02:00.000Z",
      locked_at: null,
      error_code: "grant_denied",
      error_summary: "Grant denied for https://api.github.com/repos/RengGyu/AgentProof"
    };
    const fetchMock = vi.fn(async () => Response.json([failedRow]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await failAnalysisJob({
      id: "job_2",
      claimGeneration: processingRow.claim_generation,
      retryable: true,
      code: "grant_denied",
      summary: "Grant denied for https://api.github.com/repos/RengGyu/AgentProof?access_token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
      now: new Date("2026-06-30T00:02:00Z"),
      maxAttempts: 5
    });
    const [rpcUrl, rpcInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const rpcBody = JSON.parse(String(rpcInit.body));
    const serializedBody = JSON.stringify(rpcBody);

    expect(result).toBe(true);
    expect(rpcUrl).toContain("/rpc/agentproof_fail_analysis_job");
    expect(rpcBody).toMatchObject({
      retryable_failure: true,
      failure_code: "grant_denied",
      fail_time: "2026-06-30T00:02:00.000Z",
      maximum_attempts: 5
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
    canonical_key_hash: "e".repeat(64),
    desired_revision: 1,
    running_revision: overrides.status === "processing" ? 1 : null,
    sealed_revision: null,
    publication_sealed_at: null,
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
