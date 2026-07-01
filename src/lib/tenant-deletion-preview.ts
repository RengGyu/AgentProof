import { countTenantAnalysisJobs } from "./analysis-jobs";
import { countTenantAuditEvents } from "./audit-log";
import { countTenantGitHubWebhookDeliveries } from "./github-app";
import { countTenantGitHubInstallations } from "./github-installations";
import { countTenantSavedReports } from "./server-report-store";
import { countTenantRepositoryGrants } from "./tenant-control-plane";
import {
  getTenantRetentionDeletionPlan,
  getTenantRetentionPolicyCoverage,
  TENANT_DATA_RETENTION_POLICY,
  type TenantDataDeletionReadiness,
  type TenantDeletionPreviewCountedCategoryKey,
  type TenantRetentionDeletionPlanCategory,
  type TenantRetentionPolicyCoverage
} from "./tenant-retention-policy";
import { countTenantUsageRecords } from "./usage-quota";

export type TenantDeletionPreviewCategoryKey = TenantDeletionPreviewCountedCategoryKey;

export interface TenantDeletionPreviewCategory {
  key: TenantDeletionPreviewCategoryKey;
  status: "ready" | "disabled" | "unavailable" | "manual_review_required";
  count?: number;
  reason?: "store-disabled" | "store-unavailable" | "manual-removal-required" | "policy-review-required" | "policy-blocked";
}

export interface TenantDeletionPreview {
  ok: true;
  privacy: "tenant-deletion-preview-counts-only";
  mode: "dry-run";
  destructive: false;
  tenantId: string;
  categories: TenantDeletionPreviewCategory[];
  totals: {
    knownCount: number;
    unavailableCategories: number;
  };
  retentionPolicy: {
    status: "draft";
    version: string;
    note: "Review the documented retention policy before destructive deletion.";
    coverage: TenantRetentionPolicyCoverage;
    deletionPlan: TenantRetentionDeletionPlanCategory[];
  };
  next: "review_retention_policy_before_delete";
}

type TenantDeletionPreviewInternalStore = "none" | "env" | "memory" | "supabase";

export async function buildTenantDeletionPreview(
  input: { tenantId: string },
  env = process.env
): Promise<TenantDeletionPreview> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new Error("Tenant id is invalid.");
  }

  const countedCategoryKeys = [
    "saved_reports",
    "repository_grants",
    "github_installations",
    "webhook_deliveries",
    "analysis_jobs",
    "audit_events",
    "usage_records"
  ] satisfies TenantDeletionPreviewCategoryKey[];
  const deletionPlan = getTenantRetentionDeletionPlan();
  const categories = await Promise.all([
    previewCategory("saved_reports", async () => countTenantSavedReports({ tenantId }), readinessFor(deletionPlan, "saved_reports")),
    previewCategory("repository_grants", async () => countTenantRepositoryGrants({ tenantId }, env), readinessFor(deletionPlan, "repository_grants")),
    previewCategory("github_installations", async () => countTenantGitHubInstallations({ tenantId }, env), readinessFor(deletionPlan, "github_installations")),
    previewCategory("webhook_deliveries", async () => countTenantGitHubWebhookDeliveries({ tenantId }, env), readinessFor(deletionPlan, "webhook_deliveries")),
    previewCategory("analysis_jobs", async () => countTenantAnalysisJobs({ tenantId }, env), readinessFor(deletionPlan, "analysis_jobs")),
    previewCategory("audit_events", async () => countTenantAuditEvents({ tenantId }, env), readinessFor(deletionPlan, "audit_events")),
    previewCategory("usage_records", async () => countTenantUsageRecords({ tenantId }, env), readinessFor(deletionPlan, "usage_records"))
  ]);

  return {
    ok: true,
    privacy: "tenant-deletion-preview-counts-only",
    mode: "dry-run",
    destructive: false,
    tenantId,
    categories,
    totals: {
      knownCount: categories.reduce((total, item) => total + (item.count ?? 0), 0),
      unavailableCategories: categories.filter((item) => item.status === "unavailable").length
    },
    retentionPolicy: {
      status: TENANT_DATA_RETENTION_POLICY.status,
      version: TENANT_DATA_RETENTION_POLICY.version,
      note: TENANT_DATA_RETENTION_POLICY.note,
      coverage: getTenantRetentionPolicyCoverage(countedCategoryKeys),
      deletionPlan
    },
    next: "review_retention_policy_before_delete"
  };
}

async function previewCategory(
  key: TenantDeletionPreviewCategoryKey,
  count: () => Promise<{
    count: number;
    store: TenantDeletionPreviewInternalStore;
    durable: boolean;
    configured: boolean;
    disabled?: boolean;
  }>,
  readiness: TenantDataDeletionReadiness
): Promise<TenantDeletionPreviewCategory> {
  try {
    const result = await count();
    if (result.disabled) {
      return {
        key,
        status: "disabled",
        count: result.count,
        reason: "store-disabled"
      };
    }

    if (readiness === "blocked") {
      return {
        key,
        status: "manual_review_required",
        count: result.count,
        reason: "policy-blocked"
      };
    }

    if (result.store === "env") {
      return {
        key,
        status: "manual_review_required",
        count: result.count,
        reason: "manual-removal-required"
      };
    }

    if (readiness === "manual-review-required") {
      return {
        key,
        status: "manual_review_required",
        count: result.count,
        reason: "policy-review-required"
      };
    }

    return {
      key,
      status: result.disabled ? "disabled" : "ready",
      count: result.count,
      reason: result.disabled ? "store-disabled" : undefined
    };
  } catch {
    return {
      key,
      status: "unavailable",
      reason: "store-unavailable"
    };
  }
}

function readinessFor(
  deletionPlan: TenantRetentionDeletionPlanCategory[],
  key: TenantDeletionPreviewCategoryKey
): TenantDataDeletionReadiness {
  return deletionPlan.find((item) => item.key === key)?.deletionReadiness ?? "blocked";
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(trimmed) ? trimmed : null;
}
