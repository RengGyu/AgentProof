import { noStoreJson } from "@/lib/http";
import { getSavedReport, listTenantSavedReportDetails, listTenantSavedReports, SavedReportStoreError, TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT, type StoredServerReport } from "@/lib/server-report-store";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";
import { tenantReportAnalysisContext } from "@/lib/tenant-report-language";
import { listTenantAnalysisJobs, resolveAnalysisJobFreshness, type AnalysisJobFreshness, type TenantAnalysisJobSummary } from "@/lib/analysis-jobs";
import type { DashboardSavedReport } from "@/lib/github-dashboard-view-model";

export async function GET(request: Request) {
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
    const tenantId = access.tenantId;
    if (!access.authorized || !tenantId) return noStoreJson({ error: "Dashboard reports require a signed-in tenant session.", code: "dashboard_reports_unauthorized" }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    const id = searchParams.get("id");
    if (id) {
      const saved = await getSavedReport(id, { tenantId: access.tenantId });
      if (!saved) return noStoreJson({ error: "Report was not found.", code: "dashboard_report_not_found" }, { status: 404 });
      return noStoreJson({ ok: true, ...await toDashboardReportDetail(saved, tenantId), privacy: "tenant-sanitized-detail" });
    }
    const repositorySelector = searchParams.get("repositoryId");
    if (repositorySelector !== null) {
      const repositoryId = normalizeRepositorySelector(repositorySelector);
      if (!repositoryId || searchParams.get("scope") !== "current") {
        return noStoreJson({ error: "Repository report selection is invalid.", code: "dashboard_reports_repository_invalid" }, { status: 400 });
      }
      const savedReports = await listTenantSavedReportDetails({
        tenantId,
        repositoryId,
        limit: TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT + 1
      });
      const truncated = savedReports.length > TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT;
      const candidates = savedReports.slice(0, TENANT_SAVED_REPORT_FILTER_CANDIDATE_LIMIT);
      const details = await Promise.all(candidates.map((saved) => toDashboardReportDetail(saved, tenantId)));
      const currentDetails = details.filter((detail, index) => {
        const saved = candidates[index];
        return detail.freshness !== "stale" && !(detail.freshness === "unknown" && saved?.staleAt);
      });
      const complete = !truncated && currentDetails.every((detail) => detail.availability !== "unavailable" && detail.freshness !== "unknown");
      return noStoreJson({
        ok: true,
        reports: complete ? currentDetails.filter((detail) => detail.copyEligible) : [],
        bundle: {
          complete,
          truncated,
          excluded: currentDetails.filter((detail) => !detail.copyEligible).length
        },
        privacy: "tenant-sanitized-detail-bundle"
      });
    }
    const [savedReports, jobs] = await Promise.all([
      listTenantSavedReports({ tenantId, limit: 25 }),
      listTenantAnalysisJobs({ tenantId, limit: 25 }).catch(() => [])
    ]);
    const reports: DashboardSavedReport[] = await Promise.all(savedReports.map(async (report) => ({
      ...report,
      ...(report.availability === "unavailable"
        ? { freshness: "unknown" as const, copyEligible: false }
        : await resolveSavedReportFreshness(report, tenantId))
    })));
    const failedAnalysisRows = failedAnalysisRowsForDashboard(jobs, reports);
    return noStoreJson({
      ok: true,
      reports: [...reports, ...failedAnalysisRows].sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      privacy: "tenant-report-metadata-only"
    });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof SavedReportStoreError) return noStoreJson({ error: "Dashboard reports are unavailable.", code: "dashboard_reports_unavailable" }, { status: 503 });
    throw error;
  }
}

function failedAnalysisRowsForDashboard(
  jobs: TenantAnalysisJobSummary[],
  reports: DashboardSavedReport[]
): DashboardSavedReport[] {
  return jobs
    .filter((job) => job.status === "failed_retryable" || job.status === "failed_terminal")
    .filter((job) => typeof job.repositoryId === "number")
    .filter((job) => !reports.some((report) =>
      report.repositoryId === job.repositoryId &&
      report.pullRequestNumber === job.pullRequestNumber &&
      report.freshness === "refresh_failed"
    ))
    .map((job) => ({
      id: `analysis-failure:${job.id}`,
      repositoryId: job.repositoryId,
      pullRequestNumber: job.pullRequestNumber,
      headSha: job.headShaPrefix,
      priority: "high",
      createdAt: job.completedAt ?? job.updatedAt,
      freshness: "refresh_failed" as const,
      copyEligible: false,
      availability: "analysis_failed" as const,
      failure: {
        ...(job.errorCode ? { code: job.errorCode } : {}),
        ...(job.errorSummary ? { summary: job.errorSummary } : {})
      }
    }));
}

async function toDashboardReportDetail(saved: StoredServerReport, tenantId: string) {
  const freshness = saved.availability === "unavailable"
    ? { freshness: "unknown" as const, copyEligible: false }
    : await resolveSavedReportFreshness(saved, tenantId);
  if (saved.availability === "unavailable") {
    return {
      availability: "unavailable" as const,
      createdAt: saved.createdAt,
      priority: "low",
      repositoryId: saved.repositoryId,
      pullRequestNumber: saved.pullRequestNumber,
      headSha: saved.headSha,
      staleAt: saved.staleAt,
      ...freshness
    };
  }
  return {
    availability: "available" as const,
    report: saved.report,
    createdAt: saved.createdAt,
    priority: saved.report.summary.priority,
    evidenceCapturedAt: saved.report.source.provenance?.evidenceCapturedAt,
    analysisContext: tenantReportAnalysisContext(saved.report),
    repositoryId: saved.repositoryId,
    pullRequestNumber: saved.pullRequestNumber,
    headSha: saved.headSha,
    staleAt: saved.staleAt,
    ...freshness
  };
}

async function resolveSavedReportFreshness(
  saved: Pick<StoredServerReport, "repositoryId" | "pullRequestNumber" | "headSha" | "staleAt">,
  tenantId: string
): Promise<AnalysisJobFreshness> {
  if (!saved.repositoryId || !saved.pullRequestNumber || !saved.headSha) {
    return { freshness: "unknown", copyEligible: false };
  }
  try {
    return await resolveAnalysisJobFreshness({
      tenantId,
      repositoryId: saved.repositoryId,
      pullRequestNumber: saved.pullRequestNumber,
      reportHeadSha: saved.headSha,
      staleAt: saved.staleAt
    });
  } catch {
    return { freshness: "unknown", copyEligible: false };
  }
}

function normalizeRepositorySelector(value: string): number | null {
  if (!/^[1-9]\d{0,15}$/.test(value)) return null;
  const repositoryId = Number(value);
  return Number.isSafeInteger(repositoryId) ? repositoryId : null;
}
