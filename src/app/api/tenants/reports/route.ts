import { verifyTenantAdminAccess } from "@/lib/github-onboarding";
import { noStoreJson } from "@/lib/http";
import { listTenantSavedReports, SavedReportStoreError } from "@/lib/server-report-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const limit = normalizeLimit(url.searchParams.get("limit"));
  const access = verifyTenantAdminAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant saved reports require a valid tenant-bound invite token.",
      code: "tenant_reports_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const rows = await listTenantSavedReports({ tenantId: authorizedTenantId, limit: limit + 1 });
    const reports = rows.slice(0, limit);

    return noStoreJson({
      ok: true,
      tenantId: authorizedTenantId,
      reports,
      count: reports.length,
      truncated: rows.length > limit,
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
