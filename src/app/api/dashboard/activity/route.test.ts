import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimAnalysisJobById, clearAnalysisJobsForTests, enqueueAnalysisJob, failAnalysisJob } from "@/lib/analysis-jobs";
import { clearSavedReportsForTests, createVerifiedSavedReport } from "@/lib/server-report-store";
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember } from "@/lib/tenant-auth";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { GET } from "./route";

describe("GET /api/dashboard/activity", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      { tenantId: "tenant_a", name: "A", status: "active", plan: "beta", members: [{ memberId: "github:1", role: "owner", status: "active" }] },
      { tenantId: "tenant_b", name: "B", status: "active", plan: "beta", members: [{ memberId: "github:2", role: "owner", status: "active" }] }
    ]));
  });

  afterEach(() => {
    clearAnalysisJobsForTests();
    clearSavedReportsForTests();
    clearTenantAuthSessionsForTests();
    vi.unstubAllEnvs();
  });

  it("returns only the signed-in tenant's bounded report and job activity", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const report = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 14,
      headSha: "a".repeat(40)
    });
    await enqueueAnalysisJob(jobInput({
      tenantId: "tenant_a",
      pullRequestNumber: 15,
      pullRequestUrl: "https://github.com/RengGyu/dongo/pull/15",
      headSha: "b".repeat(40)
    }));
    await enqueueAnalysisJob(jobInput({
      tenantId: "tenant_b",
      repositoryFullName: "Other/private",
      pullRequestNumber: 99,
      pullRequestUrl: "https://github.com/Other/private/pull/99",
      headSha: "c".repeat(40)
    }));

    const response = await GET(new Request("http://localhost/api/dashboard/activity", {
      headers: { cookie: session.sessionCookie }
    }));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      privacy: "dashboard-activity-metadata-only",
      activity: expect.arrayContaining([
        expect.objectContaining({ id: `report:${report.id}`, reportId: report.id, pullRequestNumber: 14 }),
        expect.objectContaining({ id: expect.stringMatching(/^job:/), pullRequestNumber: 15, state: "Analysis pending" })
      ])
    });
    expect(serialized).not.toContain("Other/private");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("raw");
  });

  it("requires a signed-in tenant session", async () => {
    const response = await GET(new Request("http://localhost/api/dashboard/activity"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "dashboard_activity_unauthorized" });
  });

  it("returns a bounded failure explanation only for the signed-in tenant", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const queued = await enqueueAnalysisJob(jobInput({
      tenantId: "tenant_a",
      pullRequestNumber: 30,
      pullRequestUrl: "https://github.com/RengGyu/dongo/pull/30",
      headSha: "d".repeat(40)
    }));
    const claim = await claimAnalysisJobById(queued.id, { now: new Date(Date.now() + 60_000) });
    await failAnalysisJob({
      id: queued.id,
      claimGeneration: claim.job!.claim_generation!,
      retryable: false,
      code: "github_fetch_failed",
      summary: "GitHub request could not be completed."
    });

    const response = await GET(new Request("http://localhost/api/dashboard/activity", {
      headers: { cookie: session.sessionCookie }
    }));
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(body.activity).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "analysis_needs_attention",
        pullRequestNumber: 30,
        failure: { code: "github_fetch_failed", summary: "GitHub request could not be completed." }
      })
    ]));
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("provider_response_id");
    expect(serialized).not.toContain("canonical_key_hash");
  });
});

function jobInput(overrides: Partial<Parameters<typeof enqueueAnalysisJob>[0]> = {}) {
  return {
    tenantId: "tenant_a",
    idempotencyKey: "safe-idempotency-key",
    deliveryId: "123e4567-e89b-12d3-a456-426614174000",
    event: "pull_request",
    action: "opened",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/dongo",
    pullRequestNumber: 14,
    pullRequestUrl: "https://github.com/RengGyu/dongo/pull/14",
    headSha: "a".repeat(40),
    saveReport: true,
    comment: false,
    ...overrides
  };
}
