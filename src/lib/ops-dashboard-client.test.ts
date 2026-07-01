import { describe, expect, it } from "vitest";
import {
  opsDeadLetterUrl,
  opsDrillGateUrl,
  opsGitHubAppStatusUrl,
  opsTenantDeletionPlanUrl,
  opsTokenHeaders
} from "./ops-dashboard-client";

describe("ops dashboard client helpers", () => {
  it("sends operator tokens only through the operator header", () => {
    expect(opsTokenHeaders("  ops-secret-value  ")).toEqual({
      "x-agentproof-ops-token": "ops-secret-value"
    });
    expect(opsTokenHeaders("   ")).toEqual({});
  });

  it("builds read-only operator URLs without query-string tokens", () => {
    expect(opsGitHubAppStatusUrl()).toBe("/api/ops/github-app/status");
    expect(opsDeadLetterUrl(25)).toBe("/api/ops/analysis-jobs/dead-letter?limit=25");
    expect(opsDrillGateUrl()).toBe("/api/ops/drill-gate");
    expect(opsTenantDeletionPlanUrl(" tenant_demo ")).toBe("/api/ops/tenants/deletion?tenantId=tenant_demo");
    expect(opsDeadLetterUrl(9999)).toBe("/api/ops/analysis-jobs/dead-letter?limit=100");
    expect(opsDeadLetterUrl(Number.NaN)).toBe("/api/ops/analysis-jobs/dead-letter?limit=25");
    expect(opsGitHubAppStatusUrl()).not.toContain("token=");
    expect(opsDeadLetterUrl()).not.toContain("token=");
    expect(opsDrillGateUrl()).not.toContain("token=");
    expect(opsTenantDeletionPlanUrl("tenant_demo")).not.toContain("token=");
  });
});
