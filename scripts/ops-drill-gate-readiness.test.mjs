import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  extractEvidenceJsonFromMarkdown,
  runOpsDrillGateReadiness,
  validateOpsDrillEvidence
} from "./ops-drill-gate-readiness.mjs";

describe("ops-drill-gate-readiness", () => {
  it("validates the checked-in launch evidence as ready without widening refs", () => {
    const markdown = readFileSync(new URL("../docs/ops-drill-evidence-2026-07-01.md", import.meta.url), "utf8");
    const evidenceText = extractEvidenceJsonFromMarkdown(markdown);
    const summary = validateOpsDrillEvidence({
      evidenceText,
      now: new Date("2026-07-01T17:00:00Z")
    });

    expect(summary).toMatchObject({
      privacy: "ops-drill-evidence-validation-summary-only",
      status: "ready",
      counts: {
        required: 4,
        passed: 4,
        blocked: 0,
        missing: 0,
        stale: 0,
        failed: 0,
        unclear: 0
      },
      next: "ready_for_launch_review"
    });
    expect(summary.categories.map((item) => `${item.key}:${item.status}`)).toEqual([
      "deletion_drill:passed",
      "restore_drill:passed",
      "incident_runbook_review:passed",
      "production_smoke:passed"
    ]);
    expect(JSON.stringify(summary)).not.toContain("token");
    expect(JSON.stringify(summary)).not.toContain("repositoryFullName");
  });

  it("requires all four fresh bounded categories for local readiness", async () => {
    const evidenceText = JSON.stringify([
      record("deletion_drill", "manual-record:deletion-summary-only-2026-07-01"),
      record("restore_drill", "manual-record:restore-summary-only-2026-07-01"),
      record("incident_runbook_review", "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"),
      record("production_smoke", "github-actions:28521840530")
    ]);

    const result = await runOpsDrillGateReadiness({
      evidenceText,
      now: new Date("2026-07-01T13:40:00Z"),
      requireReady: true
    });

    expect(result.evidence).toMatchObject({
      status: "ready",
      counts: {
        required: 4,
        passed: 4,
        blocked: 0
      },
      next: "ready_for_launch_review"
    });
    expect(result.production).toBeUndefined();
  });

  it("rejects duplicate categories before claiming readiness", () => {
    expect(() => validateOpsDrillEvidence({
      evidenceText: JSON.stringify([
        record("deletion_drill", "manual-record:deletion-summary-only-2026-07-01"),
        record("deletion_drill", "manual-record:deletion-summary-only-duplicate"),
        record("restore_drill", "manual-record:restore-summary-only-2026-07-01"),
        record("incident_runbook_review", "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"),
        record("production_smoke", "github-actions:28521840530")
      ]),
      now: new Date("2026-07-01T13:40:00Z")
    })).toThrow("duplicate category deletion_drill");
  });

  it("fails require-ready for partial evidence before any production call", async () => {
    const fetchMock = vi.fn();

    await expect(runOpsDrillGateReadiness({
      evidenceText: JSON.stringify([
        record("production_smoke", "github-actions:28521840530"),
        record("incident_runbook_review", "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review")
      ]),
      now: new Date("2026-07-01T13:40:00Z"),
      requireReady: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("Local ops drill evidence is not launch-ready");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires an operator token before production verification", async () => {
    const fetchMock = vi.fn();

    await expect(runOpsDrillGateReadiness({
      evidenceText: JSON.stringify([
        record("deletion_drill", "manual-record:deletion-summary-only-2026-07-01"),
        record("restore_drill", "manual-record:restore-summary-only-2026-07-01"),
        record("incident_runbook_review", "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"),
        record("production_smoke", "github-actions:28521840530")
      ]),
      requireProduction: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("Set AGENTPROOF_OPS_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks production metadata-only shape and ready status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      privacy: "ops-drill-gate-summary-only",
      status: "ready",
      categories: [
        category("deletion_drill", "passed", "manual-record:deletion-summary-only-2026-07-01"),
        category("restore_drill", "passed", "manual-record:restore-summary-only-2026-07-01"),
        category("incident_runbook_review", "passed", "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"),
        category("production_smoke", "passed", "github-actions:28521840530")
      ],
      counts: {
        required: 4,
        passed: 4,
        blocked: 0,
        missing: 0,
        stale: 0,
        failed: 0,
        unclear: 0
      },
      next: "ready_for_launch_review"
    }));

    const result = await runOpsDrillGateReadiness({
      evidenceText: JSON.stringify([
        record("deletion_drill", "manual-record:deletion-summary-only-2026-07-01"),
        record("restore_drill", "manual-record:restore-summary-only-2026-07-01"),
        record("incident_runbook_review", "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"),
        record("production_smoke", "github-actions:28521840530")
      ]),
      opsToken: "ops-secret-value",
      requireProduction: true,
      requireReady: true,
      fetchImpl: fetchMock,
      now: new Date("2026-07-01T13:40:00Z")
    });

    expect(result.production).toEqual({
      privacy: "ops-drill-gate-summary-only",
      status: "ready",
      counts: {
        required: 4,
        passed: 4,
        blocked: 0,
        missing: 0,
        stale: 0,
        failed: 0,
        unclear: 0
      },
      next: "ready_for_launch_review",
      categoryStatuses: [
        {
          key: "deletion_drill",
          status: "passed",
          evidenceRef: "manual-record:deletion-summary-only-2026-07-01"
        },
        {
          key: "restore_drill",
          status: "passed",
          evidenceRef: "manual-record:restore-summary-only-2026-07-01"
        },
        {
          key: "incident_runbook_review",
          status: "passed",
          evidenceRef: "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"
        },
        {
          key: "production_smoke",
          status: "passed",
          evidenceRef: "github-actions:28521840530"
        }
      ]
    });
    expect(fetchMock).toHaveBeenCalledWith("https://agentproof-pearl.vercel.app/api/ops/drill-gate", expect.objectContaining({
      headers: expect.objectContaining({
        "x-agentproof-ops-token": "ops-secret-value"
      })
    }));
    expect(JSON.stringify(result)).not.toContain("ops-secret-value");
  });

  it("fails if production returns raw or sensitive fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      privacy: "ops-drill-gate-summary-only",
      status: "ready",
      categories: [],
      counts: {},
      next: "ready_for_launch_review",
      rawLogs: "token=github_pat_secret_should_not_leak_1234567890"
    }));

    await expect(runOpsDrillGateReadiness({
      opsToken: "ops-secret-value",
      requireProduction: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("leaked sensitive or raw fields");
  });
});

function record(key, evidenceRef, overrides = {}) {
  return {
    key,
    status: "passed",
    completedAt: "2026-07-01T13:37:08Z",
    evidenceRef,
    ...overrides
  };
}

function category(key, status, evidenceRef) {
  return {
    key,
    label: key,
    status,
    completedAt: "2026-07-01T13:37:08Z",
    evidenceRef,
    maxAgeDays: 30,
    ageDays: 0
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store"
    }
  });
}
