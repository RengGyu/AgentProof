import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests,
  listTenantAnalysisJobs
} from "./analysis-jobs";
import {
  authorizeTenantRepositoryGrantAsync,
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant
} from "./tenant-control-plane";
import {
  clearTenantDeletionStateForTests,
  markTenantDeletionStartedIfConfigured
} from "./tenant-deletion-state";
import {
  blockTenantDeletionNewWork,
  buildTenantDeletionExecutionPlan,
  purgeTenantDeletionAnalysisJobsWhenSafe,
  purgeTenantDeletionSavedReportsWhenSafe
} from "./tenant-deletion-execution";
import {
  clearSavedReportsForTests,
  createSavedReport,
  getSavedReport
} from "./server-report-store";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("tenant deletion execution boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
    clearTenantDeletionStateForTests();
    clearSavedReportsForTests();
  });

  it("blocks new tenant work by disabling repository grants without returning repository metadata", async () => {
    const env = memoryEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);
    await createTenantRepositoryGrant({
      tenantId: "tenant_b",
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private",
      saveReportsEnabled: true,
      commentEnabled: true
    }, env);

    const result = await blockTenantDeletionNewWork({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
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
      repositoryFullName: "Renamed/AgentProof"
    }, env)).resolves.toMatchObject({
      reason: "tenant-deletion-active"
    });
    await expect(authorizeTenantRepositoryGrantAsync({
      installationId: 999,
      repositoryId: 999,
      repositoryFullName: "Other/Private"
    }, env)).resolves.toHaveProperty("grant.tenantId", "tenant_b");
    await expect(enqueueAnalysisJob(jobInput(), env)).rejects.toThrow("Tenant deletion is in progress");
    await expect(createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 102,
      repositoryFullName: "RengGyu/NewRepo"
    }, env)).rejects.toThrow("Tenant deletion is in progress");
    expect(getAnalysisJobsForTests()).toEqual([]);
    expectNoPrivateDeletionFields(serialized);
  });

  it("marks env-backed grants as manual review instead of pretending to block new work", async () => {
    const result = await blockTenantDeletionNewWork({ tenantId: "tenant_a" }, envBackedGrantEnv());
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: true,
      privacy: "tenant-deletion-new-work-block-metadata-only",
      phase: "block_new_work",
      destructiveDataDeletion: false,
      status: "manual_review_required",
      reason: "manual_store_review_required",
      grantDisable: {
        matchedCount: 1,
        disabledCount: 0
      },
      next: "manual_review_repository_grants_before_deletion"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("builds a metadata-only plan that blocks purge before new work is blocked", async () => {
    const env = memoryEnv();
    await createTenantRepositoryGrant({
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof"
    }, env);
    await enqueueAnalysisJob(jobInput(), env);

    const plan = await buildTenantDeletionExecutionPlan({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(plan);

    expect(plan).toMatchObject({
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
    expect(plan.actions.map((action) => action.key)).toEqual([
      "review_retention_policy",
      "review_billing_retention",
      "block_new_work",
      "purge_saved_reports",
      "drain_analysis_jobs",
      "purge_analysis_jobs"
    ]);
    expect(plan.actions.find((action) => action.key === "purge_saved_reports")).toMatchObject({
      status: "blocked",
      reason: "block_new_work_first"
    });
    expect(plan.actions.find((action) => action.key === "drain_analysis_jobs")).toMatchObject({
      status: "blocked",
      reason: "active_analysis_jobs_present",
      counts: {
        activeJobs: 1,
        queuedJobs: 1,
        processingJobs: 0,
        retryingJobs: 0
      }
    });
    expect(plan.actions.find((action) => action.key === "purge_analysis_jobs")).toMatchObject({
      status: "blocked",
      reason: "block_new_work_first"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("keeps billing retention as manual review instead of implying deletion completion", async () => {
    const env = memoryEnv();

    const plan = await buildTenantDeletionExecutionPlan({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const serialized = JSON.stringify(plan);

    expect(plan.actions.find((action) => action.key === "review_billing_retention")).toEqual({
      key: "review_billing_retention",
      status: "manual_review_required",
      reason: "billing_legal_retention_required"
    });
    expect(plan.actions.find((action) => action.key === "review_billing_retention")).not.toMatchObject({
      status: "completed"
    });
    expect(serialized).not.toContain("providerCustomerId");
    expect(serialized).not.toContain("providerSubscriptionId");
    expect(serialized).not.toContain("invoice");
    expect(serialized).not.toContain("payment");
    expectNoPrivateDeletionFields(serialized);
  });

  it("marks saved-report purge ready after new work is blocked while keeping later job purge blocked", async () => {
    const env = queueOnlyEnv();
    await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    await enqueueAnalysisJob(jobInput(), env);

    const plan = await buildTenantDeletionExecutionPlan({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const serialized = JSON.stringify(plan);

    expect(plan.next).toBe("purge_saved_reports");
    expect(plan.actions.map((action) => action.key)).toEqual([
      "review_retention_policy",
      "review_billing_retention",
      "block_new_work",
      "purge_saved_reports",
      "drain_analysis_jobs",
      "purge_analysis_jobs"
    ]);
    expect(plan.actions.find((action) => action.key === "purge_saved_reports")).toMatchObject({
      status: "ready",
      reason: "saved_reports_ready",
      count: 1
    });
    expect(plan.actions.find((action) => action.key === "purge_analysis_jobs")).toMatchObject({
      status: "blocked",
      reason: "active_analysis_jobs_present"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("refuses saved-report purge before new work is explicitly blocked", async () => {
    const saved = await createSavedReport(savedReport(), { tenantId: "tenant_a" });

    const result = await purgeTenantDeletionSavedReportsWhenSafe({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: true,
      privacy: "tenant-deletion-saved-report-purge-metadata-only",
      phase: "purge_saved_reports",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "block_new_work_first",
      deletedCount: 0,
      next: "block_new_work_before_purge"
    });
    await expect(getSavedReport(saved.id, { tenantId: "tenant_a" })).resolves.toMatchObject({
      tenantId: "tenant_a"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("purges saved reports through the guarded execution wrapper after new work is blocked", async () => {
    const env = queueAndDeletionStateEnv();
    const tenantAFirst = await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    await createSavedReport(savedReport(), { tenantId: "tenant_a" });
    const tenantB = await createSavedReport(savedReport(), { tenantId: "tenant_b" });
    markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" }, env);

    const result = await purgeTenantDeletionSavedReportsWhenSafe({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
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
    await expect(getSavedReport(tenantAFirst.id, { tenantId: "tenant_a" })).resolves.toBeNull();
    await expect(getSavedReport(tenantB.id, { tenantId: "tenant_b" })).resolves.toMatchObject({
      tenantId: "tenant_b"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("refuses saved-report purge when new work is claimed blocked but deletion state is not active", async () => {
    const env = queueOnlyEnv();
    const saved = await createSavedReport(savedReport(), { tenantId: "tenant_a" });

    const result = await purgeTenantDeletionSavedReportsWhenSafe({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: true,
      privacy: "tenant-deletion-saved-report-purge-metadata-only",
      phase: "purge_saved_reports",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "block_new_work_first",
      deletedCount: 0,
      next: "block_new_work_before_purge"
    });
    await expect(getSavedReport(saved.id, { tenantId: "tenant_a" })).resolves.toMatchObject({
      tenantId: "tenant_a"
    });
    expectNoPrivateDeletionFields(serialized);
  });

  it("refuses analysis-job purge before new work is explicitly blocked", async () => {
    const env = queueOnlyEnv();
    const { id } = await enqueueAnalysisJob(jobInput(), env);
    setJobStatus(id, "completed");

    const result = await purgeTenantDeletionAnalysisJobsWhenSafe({ tenantId: "tenant_a" }, env);
    const jobs = await listTenantAnalysisJobs({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "block_new_work_first",
      deletedCount: 0,
      next: "block_new_work_before_purge"
    });
    expect(jobs).toHaveLength(1);
    expectNoPrivateDeletionFields(serialized);
  });

  it("refuses analysis-job purge when new work is claimed blocked but deletion state is not active", async () => {
    const env = queueOnlyEnv();
    const { id } = await enqueueAnalysisJob(jobInput(), env);
    setJobStatus(id, "completed");

    const result = await purgeTenantDeletionAnalysisJobsWhenSafe({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const jobs = await listTenantAnalysisJobs({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      ok: true,
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      phase: "purge_analysis_jobs",
      destructiveDataDeletion: true,
      status: "blocked",
      reason: "block_new_work_first",
      deletedCount: 0,
      next: "block_new_work_before_purge"
    });
    expect(jobs).toHaveLength(1);
    expectNoPrivateDeletionFields(serialized);
  });

  it("refuses analysis-job purge while queued, processing, or retryable jobs remain", async () => {
    const env = queueAndDeletionStateEnv();
    const queued = await enqueueAnalysisJob(jobInput({ headSha: "abc111" }), env);
    const processing = await enqueueAnalysisJob(jobInput({ headSha: "abc222", pullRequestNumber: 8 }), env);
    const retrying = await enqueueAnalysisJob(jobInput({ headSha: "abc333", pullRequestNumber: 9 }), env);
    setJobStatus(queued.id, "queued");
    setJobStatus(processing.id, "processing");
    setJobStatus(retrying.id, "failed_retryable");
    markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" }, env);

    const result = await purgeTenantDeletionAnalysisJobsWhenSafe({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const jobs = await listTenantAnalysisJobs({ tenantId: "tenant_a" }, env);
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      privacy: "tenant-deletion-analysis-job-purge-metadata-only",
      status: "blocked",
      reason: "active_analysis_jobs_present",
      deletedCount: 0,
      counts: {
        activeJobs: 3,
        queuedJobs: 1,
        processingJobs: 1,
        retryingJobs: 1
      },
      next: "drain_analysis_jobs_before_purge"
    });
    expect(jobs).toHaveLength(3);
    expectNoPrivateDeletionFields(serialized);
  });

  it("allows guarded analysis-job purge only after new work is blocked and active jobs are zero", async () => {
    const env = queueAndDeletionStateEnv();
    const completed = await enqueueAnalysisJob(jobInput(), env);
    const terminal = await enqueueAnalysisJob(jobInput({ headSha: "abc222", pullRequestNumber: 8 }), env);
    await enqueueAnalysisJob({
      ...jobInput({ tenantId: "tenant_b", headSha: "abc333", pullRequestNumber: 9 }),
      repositoryFullName: "Other/Private",
      pullRequestUrl: "https://github.com/Other/Private/pull/9"
    }, env);
    setJobStatus(completed.id, "completed");
    setJobStatus(terminal.id, "failed_terminal");
    markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" }, env);

    const result = await purgeTenantDeletionAnalysisJobsWhenSafe({
      tenantId: "tenant_a",
      newWorkBlocked: true
    }, env);
    const tenantAJobs = await listTenantAnalysisJobs({ tenantId: "tenant_a" }, env);
    const tenantBJobs = await listTenantAnalysisJobs({ tenantId: "tenant_b" }, env);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
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
});

function memoryEnv(): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
    AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY: "true",
    AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED: "true",
    AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY: "true",
    AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY: "true"
  } as unknown as NodeJS.ProcessEnv;
}

function queueOnlyEnv(): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED: "true",
    AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY: "true"
  } as unknown as NodeJS.ProcessEnv;
}

function queueAndDeletionStateEnv(): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED: "true",
    AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY: "true",
    AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY: "true"
  } as unknown as NodeJS.ProcessEnv;
}

function envBackedGrantEnv(): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
    AGENTPROOF_TENANT_REPOSITORY_GRANTS: JSON.stringify([
      {
        tenantId: "tenant_a",
        installationId: 321,
        repositoryId: 100,
        repositoryFullName: "RengGyu/AgentProof"
      }
    ])
  } as unknown as NodeJS.ProcessEnv;
}

function jobInput(overrides: Partial<{
  tenantId: string;
  headSha: string;
  pullRequestNumber: number;
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
  expect(serialized).not.toContain("tenant_b");
  expect(serialized).not.toContain("RengGyu");
  expect(serialized).not.toContain("Other/Private");
  expect(serialized).not.toContain("repositoryFullName");
  expect(serialized).not.toContain("repositoryId");
  expect(serialized).not.toContain("installation");
  expect(serialized).not.toContain("pull_request");
  expect(serialized).not.toContain("headSha");
  expect(serialized).not.toContain("delivery");
  expect(serialized).not.toContain("idempotency");
  expect(serialized).not.toContain("supabase");
  expect(serialized).not.toContain("memory");
  expect(serialized).not.toContain("configured");
  expect(serialized).not.toContain("durable");
  expect(serialized).not.toContain("table");
  expect(serialized).not.toContain("service-role");
  expect(serialized).not.toContain("token");
  expect(serialized).not.toContain("Patch excerpt");
  expect(serialized).not.toContain("diff");
  expect(serialized).not.toContain("logs");
  expect(serialized).not.toContain("claims");
  expect(serialized).not.toContain("reprompt");
}
