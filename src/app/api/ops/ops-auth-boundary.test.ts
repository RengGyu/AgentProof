import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  enqueueAnalysisJob,
  getAnalysisJobsForTests
} from "@/lib/analysis-jobs";
import { GET as getStatus } from "./github-app/status/route";
import { POST as postPreflight } from "./analysis-jobs/preflight/route";
import { POST as postRun } from "./analysis-jobs/run/route";
import { POST as postRunBatch } from "./analysis-jobs/run-batch/route";
import { GET as getDeadLetter } from "./analysis-jobs/dead-letter/route";
import { POST as postSlackAlerts } from "./analysis-jobs/alerts/slack/route";
import { GET as getDrillGate } from "./drill-gate/route";

describe("ops route auth boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
  });

  it("returns no-store auth errors across ops routes", async () => {
    const routes = [
      () => getStatus(new Request("http://localhost/api/ops/github-app/status")),
      () => postPreflight(new Request("http://localhost/api/ops/analysis-jobs/preflight", { method: "POST" })),
      () => postRun(new Request("http://localhost/api/ops/analysis-jobs/run", { method: "POST" })),
      () => postRunBatch(new Request("http://localhost/api/ops/analysis-jobs/run-batch", { method: "POST" })),
      () => getDeadLetter(new Request("http://localhost/api/ops/analysis-jobs/dead-letter")),
      () => postSlackAlerts(new Request("http://localhost/api/ops/analysis-jobs/alerts/slack", { method: "POST" })),
      () => getDrillGate(new Request("http://localhost/api/ops/drill-gate"))
    ];

    for (const callRoute of routes) {
      const response = await callRoute();
      const json = await response.json();

      expect(response.status).toBe(501);
      expectNoStoreHeaders(response);
      expect(json).toEqual({
        error: "Operator diagnostics are not configured.",
        code: "ops_diagnostics_not_configured"
      });
    }
  });

  it("rejects query-string tokens across ops routes before side effects", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());

    const routes = [
      () => getStatus(new Request("http://localhost/api/ops/github-app/status?token=ops-secret-value")),
      () => postPreflight(new Request(
        "http://localhost/api/ops/analysis-jobs/preflight?token=ops-secret-value",
        { method: "POST" }
      )),
      () => postRun(new Request(
        "http://localhost/api/ops/analysis-jobs/run?token=ops-secret-value",
        { method: "POST" }
      )),
      () => postRunBatch(new Request(
        "http://localhost/api/ops/analysis-jobs/run-batch?limit=1&token=ops-secret-value",
        { method: "POST" }
      )),
      () => getDeadLetter(new Request("http://localhost/api/ops/analysis-jobs/dead-letter?token=ops-secret-value")),
      () => postSlackAlerts(new Request(
        "http://localhost/api/ops/analysis-jobs/alerts/slack?token=ops-secret-value&includeInfo=true",
        { method: "POST" }
      )),
      () => getDrillGate(new Request("http://localhost/api/ops/drill-gate?token=ops-secret-value"))
    ];

    for (const callRoute of routes) {
      const response = await callRoute();
      const json = await response.json();
      const serialized = JSON.stringify(json);

      expect(response.status).toBe(401);
      expectNoStoreHeaders(response);
      expect(json).toEqual({
        error: "Invalid operator diagnostics token.",
        code: "ops_diagnostics_unauthorized"
      });
      expect(serialized).not.toContain("ops-secret-value");
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      locked_at: null
    });
  });
});

function expectNoStoreHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}

function jobInput() {
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
    headSha: "abc123",
    saveReport: true,
    comment: true,
    now: new Date("2026-06-30T00:00:00Z")
  };
}
