import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSavedReportsForTests, createVerifiedSavedReport } from "@/lib/server-report-store";
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember } from "@/lib/tenant-auth";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
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
    clearTenantAuthSessionsForTests();
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
});
