import { verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson } from "@/lib/http";
import {
  filterTenantSavedReportSummaries,
  listTenantSavedReports,
  normalizeTenantSavedReportFilters,
  SavedReportStoreError,
  TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT
} from "@/lib/server-report-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const filters = normalizeTenantSavedReportFilters({
    priority: url.searchParams.get("priority"),
    status: url.searchParams.get("status"),
    query: url.searchParams.get("query")
  });
  const hasFilters = filters.priority !== "all" || filters.status !== "all" || Boolean(filters.query);
  const access = await verifyTenantAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant saved reports require valid tenant authorization.",
      code: "tenant_reports_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const candidateLimit = hasFilters ? TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT + 1 : limit + 1;
    const rows = await listTenantSavedReports({ tenantId: authorizedTenantId, limit: candidateLimit });
    const filteredRows = filterTenantSavedReportSummaries(rows, filters);
    const reports = filteredRows.slice(0, limit);

    return noStoreJson({
      ok: true,
      tenantId: authorizedTenantId,
      reports,
      count: reports.length,
      limit,
      truncated: hasFilters
        ? filteredRows.length > limit || rows.length > TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT
        : rows.length > limit,
      filters,
      filterBasis: hasFilters ? "tenant_recent_summary_sample" : "tenant_recent_summary",
      privacy: "saved-report-summary-only",
      next: "review_recent_reports"
    });
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({
        error: "Tenant saved reports are unavailable.",
        code: "tenant_reports_unavailable"
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
