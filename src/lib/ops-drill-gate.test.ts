import { describe, expect, it } from "vitest";
import {
  OpsDrillGateError,
  readOpsDrillGateSummary
} from "./ops-drill-gate";

describe("ops drill gate", () => {
  it("blocks launch readiness until all required drill evidence is present", () => {
    const summary = readOpsDrillGateSummary({} as NodeJS.ProcessEnv, new Date("2026-07-01T00:00:00Z"));

    expect(summary).toEqual({
      privacy: "ops-drill-gate-summary-only",
      status: "blocked",
      categories: [
        {
          key: "deletion_drill",
          label: "Deletion drill",
          status: "missing",
          maxAgeDays: 30
        },
        {
          key: "restore_drill",
          label: "Restore drill",
          status: "missing",
          maxAgeDays: 30
        },
        {
          key: "incident_runbook_review",
          label: "Incident runbook review",
          status: "missing",
          maxAgeDays: 30
        },
        {
          key: "production_smoke",
          label: "Production smoke evidence",
          status: "missing",
          maxAgeDays: 30
        }
      ],
      counts: {
        required: 4,
        passed: 0,
        blocked: 4,
        missing: 4,
        stale: 0,
        failed: 0,
        unclear: 0
      },
      next: "run_missing_ops_drills"
    });
  });

  it("returns ready only for fresh bounded evidence refs", () => {
    const summary = readOpsDrillGateSummary(env([
      record("deletion_drill", "docs/tenant-data-retention.md#before-destructive-deletion"),
      record("restore_drill", "manual-record:restore-summary-only-2026-07-01"),
      record("incident_runbook_review", "docs/github-app-webhook.md#incident-readiness"),
      record("production_smoke", "github-actions:28518325851")
    ]), new Date("2026-07-01T12:00:00Z"));
    const serialized = JSON.stringify(summary);

    expect(summary.status).toBe("ready");
    expect(summary.counts).toEqual({
      required: 4,
      passed: 4,
      blocked: 0,
      missing: 0,
      stale: 0,
      failed: 0,
      unclear: 0
    });
    expect(summary.next).toBe("ready_for_launch_review");
    expect(summary.categories.every((category) => category.status === "passed")).toBe(true);
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("table");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("raw");
  });

  it("marks stale and failed drill evidence as blocked without inventing readiness", () => {
    const summary = readOpsDrillGateSummary(env([
      record("deletion_drill", "docs/tenant-data-retention.md#before-destructive-deletion", {
        completedAt: "2026-05-01T00:00:00Z"
      }),
      record("restore_drill", "manual-record:restore-summary-only-2026-06-30", {
        status: "failed"
      }),
      record("incident_runbook_review", "docs/github-app-webhook.md#incident-readiness"),
      record("production_smoke", "github-actions:28518325851")
    ]), new Date("2026-07-01T00:00:00Z"));

    expect(summary.status).toBe("blocked");
    expect(summary.categories.find((category) => category.key === "deletion_drill")).toMatchObject({
      status: "stale",
      ageDays: 61
    });
    expect(summary.categories.find((category) => category.key === "restore_drill")).toMatchObject({
      status: "failed"
    });
    expect(summary.counts).toMatchObject({
      blocked: 2,
      stale: 1,
      failed: 1
    });
    expect(summary.next).toBe("review_failed_ops_drills");
  });

  it("rejects unsafe evidence refs and secret-like raw evidence", () => {
    expect(() => readOpsDrillGateSummary(env([
      record("deletion_drill", "https://github.com/RengGyu/AgentProof/actions/runs/1?token=secret")
    ]))).toThrow(OpsDrillGateError);

    expect(() => readOpsDrillGateSummary(testEnv({
      AGENTPROOF_OPS_DRILL_EVIDENCE: JSON.stringify([
        {
          key: "production_smoke",
          status: "passed",
          completedAt: "2026-07-01T00:00:00Z",
          evidenceRef: "github-actions:28518325851",
          rawLogs: "token=github_pat_secret_should_not_leak_1234567890"
        }
      ])
    }))).toThrow(OpsDrillGateError);
  });
});

function env(records: unknown[]): NodeJS.ProcessEnv {
  return testEnv({
    AGENTPROOF_OPS_DRILL_EVIDENCE: JSON.stringify(records)
  });
}

function record(
  key: string,
  evidenceRef: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    key,
    status: "passed",
    completedAt: "2026-07-01T00:00:00Z",
    evidenceRef,
    ...overrides
  };
}

function testEnv(input: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ...input
  } as NodeJS.ProcessEnv;
}
