import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests,
  listTenantAnalysisJobs
} from "@/lib/analysis-jobs";
import {
  clearSavedReportsForTests,
  createSavedReport,
  getSavedReport
} from "@/lib/server-report-store";
import {
  authorizeTenantRepositoryGrantAsync,
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant
} from "@/lib/tenant-control-plane";
import { clearTenantDeletionStateForTests } from "@/lib/tenant-deletion-state";
import { demoScenarios } from "@/lib/sample-data";
import { TENANT_DATA_RETENTION_POLICY } from "@/lib/tenant-retention-policy";
import { generateVerificationReport } from "@/lib/verifier";
import { GET, POST } from "./route";

describe("/api/ops/tenants/deletion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
    clearTenantDeletionStateForTests();
    clearSavedReportsForTests();
  });

  it("requires operator authentication without accepting query-string tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await GET(new Request(
      "http://localhost/api/ops/tenants/deletion?tenantId=tenant_a&token=ops-secret-value"
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

  it("returns a metadata-only deletion plan without exposing tenant, repository, or storage internals", async () => {
    stubDeletionOpsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    });
    await enqueueAnalysisJob(jobInput());

    const response = await GET(new Request("http://localhost/api/ops/tenants/deletion?tenantId=tenant_a", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "tenant-deletion-execution-plan-metadata-only",
      mode: "internal-execution-plan",
      destructiveDataDeletion: false,
      guardrails: {
        returnsMetadataOnly: true,
        requiresNewWorkBlockedBeforePurge: true,
        requiresActiveJobsDrainedBeforePurge: true,
        requiresRetentionPolicyReview: true
      }
    });
    expect(json.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "purge_analysis_jobs",
        status: "blocked",
        reason: "block_new_work_first"
      }),
      expect.objectContaining({
        key: "drain_analysis_jobs",
        status: "blocked",
        reason: "active_analysis_jobs_present"
      })
    ]));
    expectNoPrivateDeletionFields(serialized);
  });

  it("runs only the block-new-work phase and leaves queued jobs unpurged", async () => {
    stubDeletionOpsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    });
    await enqueueAnalysisJob(jobInput());

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "block_new_work"
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "tenant-deletion-new-work-block-metadata-only",
      phase: "block_new_work",
      destructiveDataDeletion: false,
      status: "completed",
      reason: "tenant_repository_grants_disabled",
      grantDisable: {
        matchedCount: 1,
        disabledCount: 1
      },
      next: "drain_analysis_jobs_before_purge"
    });
    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    })).resolves.toMatchObject({
      reason: "tenant-deletion-active"
    });
    await expect(enqueueAnalysisJob(jobInput({ pullRequestNumber: 8, headSha: "abc888" }))).rejects.toThrow("Tenant deletion is in progress");
    expect(getAnalysisJobsForTests()).toHaveLength(1);
    expectNoPrivateDeletionFields(serialized);
  });

  it("refuses saved-report purge through the operator route when new-work block cannot be verified", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const saved = await createSavedReport(savedReport(), { tenantId: "tenant_a" });

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "purge_saved_reports",
        ...reviewedRetentionPolicy()
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "tenant-deletion-new-work-block-metadata-only",
      phase: "block_new_work",
      destructiveDataDeletion: false,
      status: "manual_review_required",
      reason: "manual_store_review_required",
      grantDisable: {
        matchedCount: 0,
        disabledCount: 0
      },
      next: "manual_review_repository_grants_before_deletion"
    });
    await expect(getSavedReport(saved.id, { tenantId: "tenant_a" })).resolves.toMatchObject({
      tenantId: "tenant_a"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("requires explicit retention policy review before destructive deletion actions", async () => {
    stubDeletionOpsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const saved = await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    const job = await enqueueAnalysisJob(jobInput());
    setJobStatus(job.id, "completed");

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "purge_saved_reports"
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(409);
    expect(json).toEqual({
      error: "Tenant deletion requires explicit retention policy review before destructive work.",
      code: "tenant_deletion_retention_policy_review_required",
      policyVersion: TENANT_DATA_RETENTION_POLICY.version,
      privacy: "tenant-deletion-policy-review-metadata-only"
    });
    await expect(getSavedReport(saved.id, { tenantId: "tenant_a" })).resolves.toMatchObject({
      tenantId: "tenant_a"
    });
    expect(getAnalysisJobsForTests()).toHaveLength(1);
    expectNoPrivateDeletionFields(serialized);
  });

  it("purges saved reports through the operator route after block-new-work activates deletion state", async () => {
    stubDeletionOpsEnv();
    const tenantA = await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    const tenantB = await createSavedReport(savedReport(), { tenantId: "tenant_b" });
    await blockNewWork("tenant_a");

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "purge_saved_reports",
        ...reviewedRetentionPolicy()
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "tenant-deletion-saved-report-purge-metadata-only",
      phase: "purge_saved_reports",
      destructiveDataDeletion: true,
      status: "completed",
      reason: "saved_report_purge_completed",
      deletedCount: 2,
      countBasis: "exact-delete-count",
      next: "continue_deletion_workflow"
    });
    await expect(getSavedReport(tenantA.id, { tenantId: "tenant_a" })).resolves.toBeNull();
    await expect(getSavedReport(tenantB.id, { tenantId: "tenant_b" })).resolves.toMatchObject({
      tenantId: "tenant_b"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("blocks analysis-job purge while active jobs remain", async () => {
    stubDeletionOpsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    const queued = await enqueueAnalysisJob(jobInput({ headSha: "abc111" }));
    const retrying = await enqueueAnalysisJob(jobInput({ headSha: "abc222", pullRequestNumber: 8 }));
    setJobStatus(queued.id, "queued");
    setJobStatus(retrying.id, "failed_retryable");
    await blockNewWork("tenant_a");

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "purge_analysis_jobs",
        ...reviewedRetentionPolicy()
      })
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "active_analysis_jobs_present",
      deletedCount: 0,
      counts: {
        activeJobs: 2,
        queuedJobs: 1,
        retryingJobs: 1
      },
      next: "drain_analysis_jobs_before_purge"
    });
    expect(getAnalysisJobsForTests()).toHaveLength(2);
    expectNoPrivateDeletionFields(serialized);
  });

  it("purges completed analysis jobs through the operator route without exposing job internals", async () => {
    stubDeletionOpsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    await createTenantRepositoryGrant({
      tenantId: "tenant_b",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private"
    });
    const completed = await enqueueAnalysisJob(jobInput());
    const terminal = await enqueueAnalysisJob(jobInput({ headSha: "abc222", pullRequestNumber: 8 }));
    await enqueueAnalysisJob({
      ...jobInput({ headSha: "abc333", pullRequestNumber: 9 }),
      tenantId: "tenant_b",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private",
      pullRequestUrl: "https://github.com/Other/Private/pull/9"
    });
    setJobStatus(completed.id, "completed");
    setJobStatus(terminal.id, "failed_terminal");
    await blockNewWork("tenant_a");

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "purge_analysis_jobs",
        ...reviewedRetentionPolicy()
      })
    }));
    const json = await response.json();
    const tenantAJobs = await listTenantAnalysisJobs({ tenantId: "tenant_a" });
    const tenantBJobs = await listTenantAnalysisJobs({ tenantId: "tenant_b" });
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "completed",
      reason: "analysis_job_purge_completed",
      deletedCount: 2,
      countBasis: "exact-delete-count",
      next: "continue_deletion_workflow"
    });
    expect(tenantAJobs).toEqual([]);
    expect(tenantBJobs).toHaveLength(1);
    expectNoPrivateDeletionFields(serialized);
  });

  it("runs one guarded deletion step at a time from the operator route", async () => {
    stubDeletionOpsEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    });
    await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    const completed = await enqueueAnalysisJob(jobInput());
    setJobStatus(completed.id, "completed");

    const first = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "run_guarded_deletion_step",
        ...reviewedRetentionPolicy()
      })
    }));
    const firstJson = await first.json();
    const second = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "run_guarded_deletion_step",
        ...reviewedRetentionPolicy()
      })
    }));
    const secondJson = await second.json();
    const third = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "run_guarded_deletion_step",
        ...reviewedRetentionPolicy()
      })
    }));
    const thirdJson = await third.json();
    const serialized = JSON.stringify([firstJson, secondJson, thirdJson]);

    expect(firstJson).toMatchObject({
      privacy: "tenant-deletion-new-work-block-metadata-only",
      phase: "block_new_work",
      status: "completed"
    });
    expect(secondJson).toMatchObject({
      privacy: "tenant-deletion-saved-report-purge-metadata-only",
      phase: "purge_saved_reports",
      status: "completed",
      deletedCount: 1
    });
    expect(thirdJson).toMatchObject({
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      status: "completed",
      deletedCount: 1
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("rejects unsupported deletion actions", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" },
      body: JSON.stringify({
        tenantId: "tenant_a",
        action: "delete_everything"
      })
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: "Tenant deletion action is not supported.",
      code: "tenant_deletion_action_unsupported"
    });
  });
});

function stubDeletionOpsEnv() {
  vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
}

function jobInput(overrides: Partial<{
  tenantId: string;
  pullRequestNumber: number;
  headSha: string;
}> = {}) {
  const tenantId = overrides.tenantId ?? "tenant_a";
  const pullRequestNumber = overrides.pullRequestNumber ?? 7;

  return {
    tenantId,
    idempotencyKey: `raw-idempotency-key-${tenantId}-${pullRequestNumber}`,
    deliveryId: "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "opened",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber,
    pullRequestUrl: `https://github.com/RengGyu/AgentProof/pull/${pullRequestNumber}`,
    headSha: overrides.headSha ?? "abc123",
    saveReport: true,
    comment: false,
    now: new Date("2026-06-30T00:00:00Z")
  };
}

function savedReport() {
  const report = generateVerificationReport(demoScenarios["scope-creep"]);
  report.reprompt.prompt = "raw saved report deletion prompt with sk-secret_should_not_leak";
  report.evidenceIndex.push({
    id: "ev_saved_report_deletion_secret",
    kind: "diff",
    label: "Patch excerpt",
    summary: "Patch excerpt with github_pat_secret_should_not_leak",
    confidence: 0.9
  });
  return report;
}

function reviewedRetentionPolicy() {
  return {
    retentionPolicyReviewed: true,
    retentionPolicyVersion: TENANT_DATA_RETENTION_POLICY.version
  };
}

async function blockNewWork(tenantId: string) {
  return POST(new Request("http://localhost/api/ops/tenants/deletion", {
    method: "POST",
    headers: { "x-agentproof-ops-token": "ops-secret-value" },
    body: JSON.stringify({
      tenantId,
      action: "block_new_work"
    })
  }));
}

function setJobStatus(
  id: string,
  status: "queued" | "processing" | "completed" | "failed_retryable" | "failed_terminal"
) {
  const row = getAnalysisJobsForTests().find((job) => job.id === id);
  Object.assign(row ?? {}, {
    status,
    updated_at: "2026-06-30T00:01:00.000Z"
  });
}

function expectNoPrivateDeletionFields(serialized: string) {
  expect(serialized).not.toContain("tenant_a");
  expect(serialized).not.toContain("RengGyu");
  expect(serialized).not.toContain("repositoryFullName");
  expect(serialized).not.toContain("repositoryId");
  expect(serialized).not.toContain("installationId");
  expect(serialized).not.toContain("pull_request");
  expect(serialized).not.toContain("delivery");
  expect(serialized).not.toContain("idempotency");
  expect(serialized).not.toContain("supabase");
  expect(serialized).not.toContain("memory");
  expect(serialized).not.toContain("configured");
  expect(serialized).not.toContain("durable");
  expect(serialized).not.toContain("table");
  expect(serialized).not.toContain("token");
  expect(serialized).not.toContain("Patch excerpt");
  expect(serialized).not.toContain("diff");
  expect(serialized).not.toContain("logs");
  expect(serialized).not.toContain("claims");
  expect(serialized).not.toContain("reprompt");
}
