import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/ops/drill-gate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("requires an operator token before reading drill evidence", async () => {
    const response = await GET(new Request("http://localhost/api/ops/drill-gate"));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
  });

  it("returns metadata-only ops drill readiness without evidence internals", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_OPS_DRILL_EVIDENCE", JSON.stringify([
      record("deletion_drill", "docs/tenant-data-retention.md#before-destructive-deletion"),
      record("restore_drill", "manual-record:restore-summary-only-2026-07-01"),
      record("incident_runbook_review", "docs/github-app-webhook.md#incident-readiness"),
      record("production_smoke", "github-actions:28518325851")
    ]));

    const response = await GET(new Request("http://localhost/api/ops/drill-gate", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toMatchObject({
      ok: true,
      privacy: "ops-drill-gate-summary-only",
      status: "ready",
      counts: {
        required: 4,
        passed: 4,
        blocked: 0
      },
      next: "ready_for_launch_review"
    });
    expect(json.categories).toHaveLength(4);
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("github_pat");
    expect(serialized).not.toContain("rawLogs");
    expect(serialized).not.toContain("service-role");
    expect(serialized).not.toContain("AGENTPROOF");
    expect(serialized).not.toContain("table");
    expect(serialized).not.toContain("repositoryFullName");
    expect(serialized).not.toContain("pullRequestNumber");
  });

  it("fails closed for malformed drill evidence without echoing env values", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("AGENTPROOF_OPS_DRILL_EVIDENCE", "{not-json");

    const response = await GET(new Request("http://localhost/api/ops/drill-gate", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Ops drill gate evidence is unavailable.",
      code: "ops_drill_gate_unavailable"
    });
    expect(serialized).not.toContain("not-json");
    expect(serialized).not.toContain("AGENTPROOF_OPS_DRILL_EVIDENCE");
    expect(serialized).not.toContain("ops-secret-value");
  });
});

function record(key: string, evidenceRef: string) {
  return {
    key,
    status: "passed",
    completedAt: "2026-07-01T00:00:00Z",
    evidenceRef
  };
}
