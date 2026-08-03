import { noStoreJson } from "@/lib/http";
import { getSavedReport, listTenantSavedReports, SavedReportStoreError } from "@/lib/server-report-store";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";

export async function GET(request: Request) {
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
    if (!access.authorized || !access.tenantId) return noStoreJson({ error: "Dashboard reports require a signed-in tenant session.", code: "dashboard_reports_unauthorized" }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const saved = await getSavedReport(id, { tenantId: access.tenantId });
      if (!saved) return noStoreJson({ error: "Report was not found.", code: "dashboard_report_not_found" }, { status: 404 });
      return noStoreJson({
        ok: true,
        report: saved.report,
        createdAt: saved.createdAt,
        repositoryId: saved.repositoryId,
        pullRequestNumber: saved.pullRequestNumber,
        headSha: saved.headSha,
        staleAt: saved.staleAt,
        privacy: "tenant-sanitized-detail"
      });
    }
    const reports = await listTenantSavedReports({ tenantId: access.tenantId, limit: 25 });
    return noStoreJson({ ok: true, reports, privacy: "tenant-report-metadata-only" });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof SavedReportStoreError) return noStoreJson({ error: "Dashboard reports are unavailable.", code: "dashboard_reports_unavailable" }, { status: 503 });
    throw error;
  }
}
