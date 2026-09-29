import { mobileCookieFromRequest } from "@/lib/mobile-auth";
import { noStoreJson } from "@/lib/http";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";
import { getSavedReport, listTenantSavedReports, SavedReportStoreError } from "@/lib/server-report-store";
import { resolveAnalysisJobFreshness } from "@/lib/analysis-jobs";

export async function GET(request: Request) {
  const cookie = mobileCookieFromRequest(request);
  if (!cookie) return noStoreJson({ code: "mobile_auth_required" }, { status: 401 });
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: cookie, expectedSource: "mobile" });
    if (!access.authorized || !access.tenantId) return noStoreJson({ code: "mobile_auth_required" }, { status: 401 });
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      const saved = await getSavedReport(id, { tenantId: access.tenantId });
      if (!saved) return noStoreJson({ code: "dashboard_report_not_found" }, { status: 404 });
      const freshness = saved.availability === "unavailable" ? { freshness: "unknown", copyEligible: false } : await safeFreshness(saved, access.tenantId);
      return noStoreJson({ ok: true, availability: saved.availability, report: saved.availability === "available" ? saved.report : undefined, createdAt: saved.createdAt, priority: saved.report?.summary.priority, repositoryId: saved.repositoryId, pullRequestNumber: saved.pullRequestNumber, headSha: saved.headSha, ...freshness, privacy: "tenant-sanitized-detail" });
    }
    const savedReports = await listTenantSavedReports({ tenantId: access.tenantId, limit: 25 });
    const reports = await Promise.all(savedReports.map(async report => ({ ...report, ...(report.availability === "unavailable" ? { freshness: "unknown", copyEligible: false } : await safeFreshness(report, access.tenantId!)) })));
    return noStoreJson({ ok: true, reports, privacy: "tenant-report-metadata-only" });
  } catch (error) {
    if (error instanceof SavedReportStoreError || error instanceof TenantAuthStoreError) return noStoreJson({ code: "dashboard_reports_unavailable" }, { status: 503 });
    throw error;
  }
}
async function safeFreshness(report: { repositoryId?: number; pullRequestNumber?: number; headSha?: string; staleAt?: string }, tenantId: string) {
  if (!report.repositoryId || !report.pullRequestNumber || !report.headSha) return { freshness: "unknown", copyEligible: false };
  try { return await resolveAnalysisJobFreshness({ tenantId, repositoryId: report.repositoryId, pullRequestNumber: report.pullRequestNumber, reportHeadSha: report.headSha, staleAt: report.staleAt }); }
  catch { return { freshness: "unknown", copyEligible: false }; }
}
