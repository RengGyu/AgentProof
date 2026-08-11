import { noStoreJson } from "@/lib/http";
import { getSavedReport, listTenantSavedReportDetails, listTenantSavedReports, SavedReportStoreError, TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT, type StoredServerReport } from "@/lib/server-report-store";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";
import { tenantReportAnalysisContext } from "@/lib/tenant-report-language";

export async function GET(request: Request) {
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
    if (!access.authorized || !access.tenantId) return noStoreJson({ error: "Dashboard reports require a signed-in tenant session.", code: "dashboard_reports_unauthorized" }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get("id");
    if (id) {
      const saved = await getSavedReport(id, { tenantId: access.tenantId });
      if (!saved) return noStoreJson({ error: "Report was not found.", code: "dashboard_report_not_found" }, { status: 404 });
      return noStoreJson({ ok: true, ...toDashboardReportDetail(saved), privacy: "tenant-sanitized-detail" });
    }
    const repositorySelector = searchParams.get("repositoryId");
    if (repositorySelector !== null) {
      const repositoryId = normalizeRepositorySelector(repositorySelector);
      if (!repositoryId || searchParams.get("scope") !== "current") {
        return noStoreJson({ error: "Repository report selection is invalid.", code: "dashboard_reports_repository_invalid" }, { status: 400 });
      }
      const savedReports = await listTenantSavedReportDetails({
        tenantId: access.tenantId,
        repositoryId,
        currentOnly: true,
        limit: TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT
      });
      return noStoreJson({
        ok: true,
        reports: savedReports.map(toDashboardReportDetail),
        privacy: "tenant-sanitized-detail-bundle"
      });
    }
    const reports = await listTenantSavedReports({ tenantId: access.tenantId, limit: 25 });
    return noStoreJson({ ok: true, reports, privacy: "tenant-report-metadata-only" });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof SavedReportStoreError) return noStoreJson({ error: "Dashboard reports are unavailable.", code: "dashboard_reports_unavailable" }, { status: 503 });
    throw error;
  }
}

function toDashboardReportDetail(saved: StoredServerReport) {
  return {
    report: saved.report,
    createdAt: saved.createdAt,
    priority: saved.report.summary.priority,
    evidenceCapturedAt: saved.report.source.provenance?.evidenceCapturedAt,
    analysisContext: tenantReportAnalysisContext(saved.report),
    repositoryId: saved.repositoryId,
    pullRequestNumber: saved.pullRequestNumber,
    headSha: saved.headSha,
    staleAt: saved.staleAt
  };
}

function normalizeRepositorySelector(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  const repositoryId = Number(value);
  return Number.isSafeInteger(repositoryId) ? repositoryId : null;
}
