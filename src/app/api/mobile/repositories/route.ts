import { noStoreJson } from "@/lib/http";
import { mobileCookieFromRequest } from "@/lib/mobile-auth";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";
import { getTenantControlPlaneSettings, listTenantRepositoryGrants, TenantControlPlaneStoreError } from "@/lib/tenant-control-plane";

export async function GET(request: Request) {
  const cookie = mobileCookieFromRequest(request);
  if (!cookie) return noStoreJson({ code: "mobile_auth_required" }, { status: 401 });
  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: cookie, expectedSource: "mobile" });
    if (!access.authorized || !access.tenantId) return noStoreJson({ code: "mobile_auth_required" }, { status: 401 });
    if (!getTenantControlPlaneSettings().enabled) return noStoreJson({ code: "dashboard_repositories_not_configured" }, { status: 409 });
    const repositories = await listTenantRepositoryGrants({ tenantId: access.tenantId });
    return noStoreJson({ ok: true, repositories: repositories.map(repository => ({ installationId: repository.installationId, repositoryId: repository.repositoryId, repositoryFullName: repository.repositoryFullName, enabled: repository.enabled, analysisEnabled: repository.analysisEnabled, saveReportsEnabled: repository.saveReportsEnabled, commentEnabled: repository.commentEnabled, llmAnalysisMode: repository.llmAnalysisMode ?? "essential", repositoryPrivate: repository.repositoryPrivate === true })), privacy: "grant-metadata-only" });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof TenantControlPlaneStoreError) return noStoreJson({ code: "dashboard_repositories_unavailable" }, { status: 503 });
    throw error;
  }
}
