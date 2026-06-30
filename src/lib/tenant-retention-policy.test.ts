import { describe, expect, it } from "vitest";
import {
  getTenantRetentionDeletionPlan,
  getTenantRetentionPolicyCoverage,
  TENANT_DATA_RETENTION_POLICY,
  type TenantDataRetentionCategoryKey,
  type TenantDeletionPreviewCountedCategoryKey
} from "./tenant-retention-policy";
import { SERVER_REPORT_TTL_MS } from "./server-report-store";
import { GITHUB_WEBHOOK_IDEMPOTENCY_DURABLE_TTL_MS } from "./github-app";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("tenant data retention policy", () => {
  it("defines a stable draft policy matrix for SaaS deletion planning", () => {
    const keys = TENANT_DATA_RETENTION_POLICY.categories.map((category) => category.key);
    const expectedKeys = [
      "transient_pr_evidence",
      "saved_reports",
      "repository_grants",
      "github_installations",
      "onboarding_states",
      "webhook_deliveries",
      "analysis_jobs",
      "audit_events",
      "usage_records",
      "billing_account_records",
      "backups",
      "tenant_tombstones"
    ] satisfies TenantDataRetentionCategoryKey[];

    expect(TENANT_DATA_RETENTION_POLICY.status).toBe("draft");
    expect(TENANT_DATA_RETENTION_POLICY.version).toBe("2026-06-30-concrete-windows-draft");
    expect(keys).toEqual(expectedKeys);
    expect(new Set(keys).size).toBe(expectedKeys.length);
  });

  it("keeps preview coverage explicit without adding raw storage categories", () => {
    const counted = [
      "saved_reports",
      "repository_grants",
      "github_installations",
      "webhook_deliveries",
      "analysis_jobs",
      "audit_events",
      "usage_records"
    ] satisfies TenantDeletionPreviewCountedCategoryKey[];
    const coverage = getTenantRetentionPolicyCoverage(counted);
    const serialized = JSON.stringify(coverage);

    expect(coverage.countedCategories).toEqual(counted);
    expect(coverage.uncountedCategories).toEqual([
      { key: "transient_pr_evidence", reason: "not-stored" },
      { key: "onboarding_states", reason: "not-yet-counted" },
      { key: "billing_account_records", reason: "not-yet-counted" },
      { key: "backups", reason: "not-yet-counted" },
      { key: "tenant_tombstones", reason: "not-yet-counted" }
    ]);
    expect(coverage.totalCategories).toBe(TENANT_DATA_RETENTION_POLICY.categories.length);
    expect(serialized).not.toContain("diff");
    expect(serialized).not.toContain("log");
    expect(serialized).not.toContain("reportBody");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
  });

  it("marks each policy category with stored, prohibited, retention, deletion, backup, and concrete window guidance", () => {
    for (const category of TENANT_DATA_RETENTION_POLICY.categories) {
      expect(category.label).not.toHaveLength(0);
      expect(category.storedFields).not.toHaveLength(0);
      expect(category.prohibitedFields).not.toHaveLength(0);
      expect(category.retention).not.toHaveLength(0);
      expect(category.deletionBehavior).not.toHaveLength(0);
      expect(category.backupBehavior).not.toHaveLength(0);
      expect(Number.isInteger(category.retentionWindowDays)).toBe(true);
      expect(category.retentionWindowDays).toBeGreaterThanOrEqual(0);
      expect(category.retentionWindowTrigger).not.toHaveLength(0);
      expect(["not-stored", "ttl-only", "automatic", "manual-review", "tombstone"]).toContain(category.deletionMode);
      expect(["not-applicable", "ready", "manual-review-required", "blocked"]).toContain(category.deletionReadiness);
      if (category.deletionReadiness === "blocked" || category.deletionReadiness === "manual-review-required") {
        expect(category.deletionBlockers.length).toBeGreaterThan(0);
      }
      expect(["counted", "not-counted", "not-stored"]).toContain(category.previewCounting);
    }
  });

  it("keeps policy windows aligned with implemented TTL constants", () => {
    const byKey = Object.fromEntries(TENANT_DATA_RETENTION_POLICY.categories.map((category) => [category.key, category]));

    expect(byKey.saved_reports.retentionWindowDays).toBe(SERVER_REPORT_TTL_MS / DAY_MS);
    expect(byKey.webhook_deliveries.retentionWindowDays).toBe(GITHUB_WEBHOOK_IDEMPOTENCY_DURABLE_TTL_MS / DAY_MS);
    expect(byKey.transient_pr_evidence.retentionWindowDays).toBe(0);
    expect(byKey.onboarding_states.retentionWindowDays).toBe(1);
    expect(byKey.analysis_jobs.deletionReadiness).toBe("blocked");
    expect(byKey.backups.deletionReadiness).toBe("blocked");
    expect(byKey.tenant_tombstones.deletionReadiness).toBe("blocked");
  });

  it("returns a bounded deletion plan without raw evidence categories", () => {
    const plan = getTenantRetentionDeletionPlan();
    const serialized = JSON.stringify(plan);

    expect(plan).toHaveLength(TENANT_DATA_RETENTION_POLICY.categories.length);
    expect(plan.find((item) => item.key === "github_installations")).toMatchObject({
      deletionMode: "manual-review",
      deletionReadiness: "manual-review-required",
      retentionWindowDays: 0
    });
    expect(plan.filter((item) => item.deletionReadiness === "blocked").map((item) => item.key)).toEqual([
      "analysis_jobs",
      "backups",
      "tenant_tombstones"
    ]);
    expect(serialized).not.toContain("repository_full_name");
    expect(serialized).not.toContain("pull_request_url");
    expect(serialized).not.toContain("reportBody");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
  });
});
