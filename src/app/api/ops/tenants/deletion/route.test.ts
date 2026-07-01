import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import {
  authorizeTenantRepositoryGrantAsync,
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant
} from "@/lib/tenant-control-plane";
import { clearTenantDeletionStateForTests } from "@/lib/tenant-deletion-state";
import { GET, POST } from "./route";

describe("/api/ops/tenants/deletion", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
    clearTenantDeletionStateForTests();
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

  it("does not expose destructive purge through the operator route", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    for (const action of ["purge_saved_reports", "purge_analysis_jobs"]) {
      const response = await POST(new Request("http://localhost/api/ops/tenants/deletion", {
        method: "POST",
        headers: { "x-agentproof-ops-token": "ops-secret-value" },
        body: JSON.stringify({
          tenantId: "tenant_a",
          action
        })
      }));

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({
        error: "Tenant deletion action is not supported.",
        code: "tenant_deletion_action_unsupported"
      });
    }
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
  pullRequestNumber: number;
  headSha: string;
}> = {}) {
  const pullRequestNumber = overrides.pullRequestNumber ?? 7;

  return {
    tenantId: "tenant_a",
    idempotencyKey: `raw-idempotency-key-${pullRequestNumber}`,
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

function expectNoPrivateDeletionFields(serialized: string) {
  expect(serialized).not.toContain("tenant_a");
  expect(serialized).not.toContain("RengGyu");
  expect(serialized).not.toContain("repositoryFullName");
  expect(serialized).not.toContain("repositoryId");
  expect(serialized).not.toContain("installation");
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
