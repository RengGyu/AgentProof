import { resolveWorkspaceAccess, validWorkspaceMutation, type WorkspaceSource } from "./access";
import { listTenantAnalysisJobs } from "@/lib/analysis-jobs";
import { buildDashboardActivity } from "@/lib/dashboard-activity";
import { noStoreJson } from "@/lib/http";
import { listTenantSavedReports, SavedReportStoreError } from "@/lib/server-report-store";
import { TenantAuthStoreError } from "@/lib/tenant-auth";
import { listTenantRepositoryGrants } from "@/lib/tenant-control-plane";
import { readTenantInboxDismissedThrough, dismissTenantInbox, TenantAccountStoreError } from "@/lib/tenant-accounts";
import { csrfFailureResponse } from "@/lib/csrf";

export async function GET(request: Request, source: WorkspaceSource = "web") {
  try {
    const access = await resolveWorkspaceAccess(request, source);
    if (!access.authorized || !access.tenantId || !access.memberId) {
      return noStoreJson({ error: "Dashboard activity requires a signed-in tenant session.", code: "dashboard_activity_unauthorized" }, { status: 401 });
    }

    const [reports, jobs, repositories, dismissedThrough] = await Promise.all([
      listTenantSavedReports({ tenantId: access.tenantId, limit: 25 }),
      listTenantAnalysisJobs({ tenantId: access.tenantId, limit: 25 }).catch(() => []),
      listTenantRepositoryGrants({ tenantId: access.tenantId }).catch(() => []),
      readTenantInboxDismissedThrough({ tenantId: access.tenantId, memberId: access.memberId })
    ]);

    return noStoreJson({
      ok: true,
      activity: buildDashboardActivity({ reports, jobs, repositories }).filter(event => !dismissedThrough || Date.parse(event.occurredAt) > Date.parse(dismissedThrough)),
      dismissedThrough,
      privacy: "dashboard-activity-metadata-only"
    });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof SavedReportStoreError || error instanceof TenantAccountStoreError) {
      return noStoreJson({ error: "Dashboard activity is unavailable.", code: "dashboard_activity_unavailable" }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request, source: WorkspaceSource = "web") {
  try {
    const access = await resolveWorkspaceAccess(request, source);
    if (!access.authorized || !access.tenantId || !access.memberId) return noStoreJson({ error: "Sign in again to clear your inbox." }, { status: 401 });
    if (!validWorkspaceMutation(request, source)) return csrfFailureResponse();
    const text = await request.text();
    if (text.length > 1000) return noStoreJson({ error: "Invalid inbox request." }, { status: 400 });
    const body: unknown = JSON.parse(text || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length) return noStoreJson({ error: "Invalid inbox request." }, { status: 400 });
    const dismissedThrough = await dismissTenantInbox({ tenantId: access.tenantId, memberId: access.memberId });
    return noStoreJson({ ok: true, dismissedThrough });
  } catch (error) {
    return noStoreJson({ error: "Inbox could not be cleared. Your reports and notifications are unchanged. Try again." }, { status: error instanceof SyntaxError ? 400 : 503 });
  }
}
