import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { clearAuditEventsForTests } from "@/lib/audit-log";
import { clearSavedReportsForTests } from "@/lib/server-report-store";
import { clearTenantRepositoryGrantsForTests } from "@/lib/tenant-control-plane";
import { POST } from "./route";

describe("POST /api/ops/analysis-jobs/run", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearSavedReportsForTests();
    clearAuditEventsForTests();
    clearTenantRepositoryGrantsForTests();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run", { method: "POST" }));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
  });

  it("rejects invalid operator tokens without exposing the configured token", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "wrong-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    });
    expect(JSON.stringify(json)).not.toContain("ops-secret-value");
  });

  it("does not authenticate with query-string operator tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await POST(new Request(
      "http://localhost/api/ops/analysis-jobs/run?token=ops-secret-value",
      { method: "POST" }
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

  it("executes one job and returns metadata-only completion status", async () => {
    stubReadyWorkerEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput());

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-run-metadata-only",
      status: "completed",
      job: {
        id,
        pullRequestNumber: 7,
        headShaPrefix: "aaaaaaaaaaaa",
        attempts: 1
      },
      result: {
        priority: expect.any(String),
        evidenceCoverage: expect.any(Number)
      },
      sideEffects: {
        saveReport: false,
        comment: false
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "completed",
      result_summary: {
        status: "completed",
        repository: "RengGyu/AgentProof"
      }
    });
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("key=");
  });

  it("ignores stray query tokens when a valid ops header runs saved-report side effects", async () => {
    stubReadyWorkerEnv({ saveReportsEnabled: true });
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true }));

    const response = await POST(new Request(
      "http://localhost/api/ops/analysis-jobs/run?token=ops-secret-value&key=should_not_leak",
      {
        method: "POST",
        headers: { "x-agentproof-ops-token": "ops-secret-value" }
      }
    ));
    const json = await response.json();
    const serialized = JSON.stringify(json);
    const serializedJob = JSON.stringify(getAnalysisJobsForTests()[0]);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      privacy: "analysis-worker-run-metadata-only",
      status: "completed",
      result: {
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        }
      },
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(serialized).not.toContain("token=");
    expect(serialized).not.toContain("key=");
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("should_not_leak");
    expect(serializedJob).not.toContain("token=");
    expect(serializedJob).not.toContain("key=");
    expect(serializedJob).not.toContain("ops-secret-value");
    expect(serializedJob).not.toContain("should_not_leak");
  });

  it("returns metadata-only failure status without fetching evidence when preflight blocks", async () => {
    stubQueueOnlyEnv();
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ enabled: false });

    const response = await POST(new Request("http://localhost/api/ops/analysis-jobs/run", {
      method: "POST",
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "analysis-worker-run-metadata-only",
      status: "failed_terminal",
      reason: "grant-disabled"
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("ops-secret-value");
  });
});

function stubQueueOnlyEnv() {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
}

function stubReadyWorkerEnv(grantOverrides: Partial<ReturnType<typeof grantRecord>> = {}) {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
  vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
    grantRecord(grantOverrides)
  ]));
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
    commentEnabled: false,
    saveReportsEnabled: false,
    ...overrides
  };
}

function jobInput(overrides: Partial<{
  saveReport: boolean;
  comment: boolean;
}> = {}) {
  return {
    tenantId: "tenant_a",
    idempotencyKey: "raw-idempotency-key-should-not-store",
    deliveryId: "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "synchronize",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber: 7,
    pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7",
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    saveReport: overrides.saveReport ?? false,
    comment: overrides.comment ?? false,
    now: new Date("2026-06-30T00:00:00Z")
  };
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function mockWorkerFetch() {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);

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
        head: { ref: "feature/app-automation", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
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

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?per_page=100&page=1") {
      return Response.json({
        total_count: 0,
        check_runs: []
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/status") {
      return Response.json({ statuses: [] });
    }

    return new Response(`unexpected url: ${href}`, { status: 500 });
  });
}
