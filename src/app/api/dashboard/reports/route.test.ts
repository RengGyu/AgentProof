import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSavedReportsForTests, createVerifiedSavedReport } from "@/lib/server-report-store";
import * as savedReportStore from "@/lib/server-report-store";
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember } from "@/lib/tenant-auth";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { claimAnalysisJobById, clearAnalysisJobsForTests, completeAnalysisJob, enqueueAnalysisJob, failAnalysisJob, resolveAnalysisJobFreshness } from "@/lib/analysis-jobs";
import { GET } from "./route";

describe("/api/dashboard/reports", () => {
  beforeEach(() => {
    vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      { tenantId: "tenant_a", name: "A", status: "active", plan: "beta", members: [{ memberId: "github:1", role: "owner", status: "active" }] },
      { tenantId: "tenant_b", name: "B", status: "active", plan: "beta", members: [{ memberId: "github:2", role: "owner", status: "active" }] }
    ]));
  });

  afterEach(() => {
    clearSavedReportsForTests();
    clearAnalysisJobsForTests();
    clearTenantAuthSessionsForTests();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("requires a tenant session", async () => {
    const response = await GET(new Request("http://localhost/api/dashboard/reports"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "dashboard_reports_unauthorized" });
  });

  it("lists identifying metadata and blocks another tenant report detail", async () => {
    const sessionA = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const reportA = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "a".repeat(40)
    });
    const reportB = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_b",
      installationId: 654,
      repositoryId: 200,
      pullRequestNumber: 9,
      headSha: "b".repeat(40)
    });

    const listResponse = await GET(new Request("http://localhost/api/dashboard/reports", {
      headers: { cookie: sessionA.sessionCookie }
    }));
    const list = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(list.reports).toEqual([
      expect.objectContaining({
        id: reportA.id,
        repositoryId: 100,
        pullRequestNumber: 8,
        headSha: "a".repeat(40),
        createdAt: expect.any(String),
        priority: expect.any(String)
      })
    ]);
    expect(JSON.stringify(list)).not.toContain(reportB.id);

    const crossTenantResponse = await GET(new Request(`http://localhost/api/dashboard/reports?id=${reportB.id}`, {
      headers: { cookie: sessionA.sessionCookie }
    }));
    expect(crossTenantResponse.status).toBe(404);
    await expect(crossTenantResponse.json()).resolves.toMatchObject({ code: "dashboard_report_not_found" });
  });

  it("returns report priority and safe analysis metadata with tenant-authorized detail", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const source = {
      ...demoScenarios.clean,
      taskSource: "issue" as const,
      sourceProvenance: {
        version: 1 as const,
        origin: "github_snapshot" as const,
        headSha: "a".repeat(40),
        evidenceCapturedAt: "2026-08-09T01:02:03.000Z",
        inputFingerprint: {
          version: 1 as const,
          algorithm: "sha256" as const,
          value: "b".repeat(64),
          coverage: "github_metadata" as const
        }
      }
    };
    const report = generateVerificationReport(source);
    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "a".repeat(40)
    });

    const response = await GET(new Request(`http://localhost/api/dashboard/reports?id=${saved.id}`, {
      headers: { cookie: session.sessionCookie }
    }));

    await expect(response.json()).resolves.toMatchObject({
      priority: report.summary.priority,
      evidenceCapturedAt: "2026-08-09T01:02:03.000Z",
      analysisContext: "linked_issue"
    });
  });

  it("returns one tenant-scoped bundle of current reports for a repository", async () => {
    const sessionA = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const firstHead = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 10,
      headSha: "a".repeat(40)
    });
    const currentHead = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 10,
      headSha: "b".repeat(40)
    });
    await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 200,
      pullRequestNumber: 11,
      headSha: "c".repeat(40)
    });
    const otherTenant = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_b",
      installationId: 654,
      repositoryId: 100,
      pullRequestNumber: 12,
      headSha: "d".repeat(40)
    });

    const response = await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", {
      headers: { cookie: sessionA.sessionCookie }
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      privacy: "tenant-sanitized-detail-bundle",
      reports: [{
        repositoryId: 100,
        pullRequestNumber: 10,
        headSha: "b".repeat(40),
        report: expect.any(Object)
      }]
    });
    expect(body.reports[0]).not.toHaveProperty("staleAt");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(firstHead.id);
    expect(serialized).not.toContain(otherTenant.id);
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("rawLog");
  });

  it("does not let a historical unavailable report block a current copy bundle", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const current = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 10,
      headSha: "b".repeat(40)
    });
    const historicalUnavailable = {
      ...current,
      id: "report_historical_unavailable",
      availability: "unavailable" as const,
      staleAt: "2026-08-12T00:00:00.000Z"
    };
    vi.spyOn(savedReportStore, "listTenantSavedReportDetails").mockResolvedValue([historicalUnavailable, current]);

    const response = await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", {
      headers: { cookie: session.sessionCookie }
    }));
    const body = await response.json();

    expect(body).toMatchObject({
      bundle: { complete: true, truncated: false },
      reports: [{ headSha: current.headSha, copyEligible: true }]
    });
  });

  it("never returns an older saved report as copy eligible while a newer exact PR analysis is refreshing", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const oldHead = "a".repeat(40);
    const newerHead = "b".repeat(40);
    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 10, headSha: oldHead
    });
    await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "dashboard-newer-head",
      deliveryId: "123e4567-e89b-12d3-a456-426614174388",
      event: "pull_request",
      action: "synchronize",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 10,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10",
      headSha: newerHead,
      saveReport: true,
      comment: false
    });
    await expect(resolveAnalysisJobFreshness({ tenantId: "tenant_a", repositoryId: 100, pullRequestNumber: 10, reportHeadSha: oldHead })).resolves.toEqual({ freshness: "refreshing", copyEligible: false });

    const detailResponse = await GET(new Request(`http://localhost/api/dashboard/reports?id=${saved.id}`, { headers: { cookie: session.sessionCookie } }));
    const bundleResponse = await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", { headers: { cookie: session.sessionCookie } }));
    const detail = await detailResponse.json();
    const bundle = await bundleResponse.json();

    expect(detail).toMatchObject({ freshness: "refreshing", copyEligible: false });
    expect(bundle).toMatchObject({ reports: [], bundle: { complete: true, truncated: false, excluded: 1 } });
    const serialized = JSON.stringify({ detail, bundle });
    expect(serialized).not.toContain(newerHead);
    expect(serialized).not.toContain("provider_status");
    expect(serialized).not.toContain("canonical_key_hash");
  });

  it("returns a bounded refresh-failure explanation for the signed-in tenant's saved report", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const oldHead = "a".repeat(40);
    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 10, headSha: oldHead
    });
    const queued = await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "dashboard-failed-refresh",
      deliveryId: "123e4567-e89b-12d3-a456-426614174389",
      event: "pull_request",
      action: "synchronize",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 10,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10",
      headSha: "b".repeat(40),
      saveReport: true,
      comment: false
    });
    const claim = await claimAnalysisJobById(queued.id, { now: new Date(Date.now() + 60_000) });
    await failAnalysisJob({
      id: queued.id,
      claimGeneration: claim.job!.claim_generation!,
      retryable: false,
      code: "github_fetch_failed",
      summary: "GitHub request could not be completed."
    });

    const response = await GET(new Request(`http://localhost/api/dashboard/reports?id=${saved.id}`, {
      headers: { cookie: session.sessionCookie }
    }));
    const body = await response.json();

    expect(body).toMatchObject({
      freshness: "refresh_failed",
      copyEligible: false,
      failure: {
        code: "github_fetch_failed",
        summary: "GitHub request could not be completed."
      }
    });
    expect(JSON.stringify(body)).not.toContain("provider_response_id");
    expect(JSON.stringify(body)).not.toContain("tenant_a");
  });

  it("keeps an unavailable report visible while blocking its detail content and copy bundle", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const unavailable = {
      id: "report_unavailable",
      createdAt: "2026-08-12T00:00:00.000Z",
      expiresAt: "2026-08-13T00:00:00.000Z",
      tenantId: "tenant_a",
      repositoryId: 100,
      pullRequestNumber: 5,
      headSha: "a".repeat(40),
      availability: "unavailable" as const,
      report: generateVerificationReport(demoScenarios.clean)
    };
    vi.spyOn(savedReportStore, "listTenantSavedReports").mockResolvedValue([{
      id: unavailable.id,
      createdAt: unavailable.createdAt,
      expiresAt: unavailable.expiresAt,
      repositoryId: 100,
      pullRequestNumber: 5,
      headSha: unavailable.headSha,
      sourceTitle: "Saved report unavailable",
      priority: "low",
      evidenceCoverage: 0,
      requirementCounts: { met: 0, partial: 0, missing: 0, unclear: 0 },
      testing: { ciStatus: "unknown", lintStatus: "unknown", typecheckStatus: "unknown", missingTestCount: 0 },
      reviewPriorityCount: 0,
      scopeCreepSuspected: false,
      availability: "unavailable",
      privacy: "summary-only"
    }]);
    vi.spyOn(savedReportStore, "getSavedReport").mockResolvedValue(unavailable);
    vi.spyOn(savedReportStore, "listTenantSavedReportDetails").mockResolvedValue([unavailable]);

    const headers = { cookie: session.sessionCookie };
    const list = await (await GET(new Request("http://localhost/api/dashboard/reports", { headers }))).json();
    const detail = await (await GET(new Request(`http://localhost/api/dashboard/reports?id=${unavailable.id}`, { headers }))).json();
    const bundle = await (await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", { headers }))).json();

    expect(list.reports).toEqual([expect.objectContaining({ id: unavailable.id, availability: "unavailable", copyEligible: false })]);
    expect(detail).toMatchObject({ ok: true, availability: "unavailable" });
    expect(detail).not.toHaveProperty("report");
    expect(bundle).toMatchObject({ reports: [], bundle: { complete: false, excluded: 1 } });
  });

  it("keeps the newer completed head current across list, detail, and bundle when an older report saves last", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const oldHead = "a".repeat(40);
    const newHead = "b".repeat(40);
    const old = await enqueueAnalysisJob({ tenantId: "tenant_a", idempotencyKey: "out-of-order-old", deliveryId: "123e4567-e89b-12d3-a456-426614174396", event: "pull_request", installationId: 321, repositoryId: 100, repositoryFullName: "RengGyu/AgentProof", pullRequestNumber: 10, pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10", headSha: oldHead, saveReport: true, comment: false, now: new Date("2026-06-30T00:00:00Z") });
    const oldClaim = await claimAnalysisJobById(old.id, { now: new Date("2026-06-30T00:00:15Z") });
    const newer = await enqueueAnalysisJob({ tenantId: "tenant_a", idempotencyKey: "out-of-order-new", deliveryId: "123e4567-e89b-12d3-a456-426614174395", event: "pull_request", installationId: 321, repositoryId: 100, repositoryFullName: "RengGyu/AgentProof", pullRequestNumber: 10, pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/10", headSha: newHead, saveReport: true, comment: false, now: new Date("2026-06-30T00:01:00Z") });
    const newClaim = await claimAnalysisJobById(newer.id, { now: new Date("2026-06-30T00:01:15Z") });
    await completeAnalysisJob({ id: newer.id, claimGeneration: newClaim.job!.claim_generation!, now: new Date("2026-06-30T00:01:16Z") });
    const savedNew = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), { tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 10, headSha: newHead });
    await completeAnalysisJob({ id: old.id, claimGeneration: oldClaim.job!.claim_generation!, now: new Date("2026-06-30T00:02:00Z") });
    await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), { tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 10, headSha: oldHead });

    const list = await (await GET(new Request("http://localhost/api/dashboard/reports", { headers: { cookie: session.sessionCookie } }))).json();
    const detail = await (await GET(new Request(`http://localhost/api/dashboard/reports?id=${savedNew.id}`, { headers: { cookie: session.sessionCookie } }))).json();
    const bundle = await (await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", { headers: { cookie: session.sessionCookie } }))).json();

    expect(list.reports.find((report: { id: string }) => report.id === savedNew.id)).toMatchObject({ freshness: "current", copyEligible: true });
    expect(detail).toMatchObject({ headSha: newHead, staleAt: expect.any(String), freshness: "current", copyEligible: true });
    expect(bundle).toMatchObject({ bundle: { complete: true, truncated: false }, reports: [{ headSha: newHead, freshness: "current", copyEligible: true }] });
  });

  it("fails closed to unknown when the exact job lookup is unavailable", async () => {
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), { tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 10, headSha: "a".repeat(40) });

    const detail = await (await GET(new Request(`http://localhost/api/dashboard/reports?id=${saved.id}`, { headers: { cookie: session.sessionCookie } }))).json();
    const bundle = await (await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", { headers: { cookie: session.sessionCookie } }))).json();

    expect(detail).toMatchObject({ freshness: "unknown", copyEligible: false });
    expect(bundle).toMatchObject({ reports: [], bundle: { complete: false, truncated: false } });
  });

  it("marks candidate-limit bundles truncated and supplies no copy payload", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), { tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 10, headSha: "a".repeat(40) });
    vi.spyOn(savedReportStore, "listTenantSavedReportDetails").mockResolvedValue(Array.from({ length: 101 }, () => saved));

    const response = await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=100&scope=current", { headers: { cookie: session.sessionCookie } }));
    await expect(response.json()).resolves.toMatchObject({ reports: [], bundle: { complete: false, truncated: true } });
  });

  it("rejects an invalid repository bundle selector", async () => {
    const session = await createTenantAuthSessionForMember({ tenantId: "tenant_a", memberId: "github:1" });
    const response = await GET(new Request("http://localhost/api/dashboard/reports?repositoryId=not-a-number&scope=current", {
      headers: { cookie: session.sessionCookie }
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "dashboard_reports_repository_invalid" });
  });
});
