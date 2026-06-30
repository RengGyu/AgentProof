import {
  getTenantAnalysisJobRollup,
  listTenantAnalysisJobs,
  AnalysisJobQueueError,
  type AnalysisJobStatus
} from "@/lib/analysis-jobs";
import { verifyTenantAdminAccess } from "@/lib/github-onboarding";
import { noStoreJson } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const filter = parseStatusFilter(url.searchParams.get("status"));
  const access = verifyTenantAdminAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant analysis jobs require a valid tenant-bound invite token.",
      code: "tenant_analysis_jobs_unauthorized"
    }, { status: 401 });
  }

  if (!filter.valid) {
    return noStoreJson({
      error: "Tenant analysis job status filter is invalid.",
      code: "invalid_status_filter"
    }, { status: 400 });
  }

  try {
    const rows = await listTenantAnalysisJobs({
      tenantId: access.tenantId,
      limit: limit + 1,
      statuses: filter.statuses
    });
    const jobs = rows.slice(0, limit);
    const summary = await getTenantAnalysisJobRollup({ tenantId: access.tenantId });

    return noStoreJson({
      ok: true,
      tenantId: access.tenantId,
      filter: filter.label,
      jobs,
      count: jobs.length,
      truncated: rows.length > limit,
      page: {
        count: jobs.length,
        limit,
        truncated: rows.length > limit
      },
      summary,
      privacy: "analysis-job-summary-only",
      next: "monitor_async_analysis"
    });
  } catch (error) {
    if (error instanceof AnalysisJobQueueError) {
      return noStoreJson({
        error: "Tenant analysis jobs are unavailable.",
        code: "tenant_analysis_jobs_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function normalizeLimit(value: string | null): number {
  if (!value) return 10;
  if (!/^\d{1,3}$/.test(value)) return 10;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 25) : 10;
}

function parseStatusFilter(value: string | null): { valid: boolean; label: string; statuses: AnalysisJobStatus[] } {
  const explicit = value !== null && value.trim() !== "";
  const normalized = value?.trim().toLowerCase().replace(/[^a-z_-]/g, "") || "all";
  if (normalized === "failed") {
    return { valid: true, label: "failed", statuses: ["failed_retryable", "failed_terminal"] };
  }
  if (normalized === "active") {
    return { valid: true, label: "active", statuses: ["queued", "processing", "failed_retryable"] };
  }
  if (normalized === "completed") {
    return { valid: true, label: "completed", statuses: ["completed"] };
  }
  if (normalized === "all") {
    return { valid: true, label: "all", statuses: [] };
  }

  return { valid: !explicit, label: "all", statuses: [] };
}
