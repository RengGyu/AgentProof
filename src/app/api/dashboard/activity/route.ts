import { listTenantAnalysisJobs } from "@/lib/analysis-jobs";
import { buildDashboardActivity } from "@/lib/dashboard-activity";
import { noStoreJson } from "@/lib/http";
import { listTenantSavedReports, SavedReportStoreError } from "@/lib/server-report-store";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";
import { listTenantRepositoryGrants } from "@/lib/tenant-control-plane";

export async function GET(request: Request) {
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
    if (!access.authorized || !access.tenantId) {
      return noStoreJson({ error: "Dashboard activity requires a signed-in tenant session.", code: "dashboard_activity_unauthorized" }, { status: 401 });
    }

    const [reports, jobs, repositories] = await Promise.all([
      listTenantSavedReports({ tenantId: access.tenantId, limit: 25 }),
      listTenantAnalysisJobs({ tenantId: access.tenantId, limit: 25 }).catch(() => []),
      listTenantRepositoryGrants({ tenantId: access.tenantId }).catch(() => [])
    ]);

    return noStoreJson({
      ok: true,
      activity: buildDashboardActivity({ reports, jobs, repositories }),
      privacy: "dashboard-activity-metadata-only"
    });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof SavedReportStoreError) {
      return noStoreJson({ error: "Dashboard activity is unavailable.", code: "dashboard_activity_unavailable" }, { status: 503 });
    }
    throw error;
  }
}
