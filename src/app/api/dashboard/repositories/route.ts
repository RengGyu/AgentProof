import { noStoreJson } from "@/lib/http";
import {
  getTenantControlPlaneSettings,
  listTenantRepositoryGrants,
  TenantControlPlaneStoreError
} from "@/lib/tenant-control-plane";
import { resolveTenantAuthAccess, TenantAuthStoreError } from "@/lib/tenant-auth";

export async function GET(request: Request) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Repository connections are not configured.",
      code: "dashboard_repositories_not_configured"
    }, { status: 409 });
  }

  try {
    const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
    if (!access.authorized || !access.tenantId) {
      return noStoreJson({
        error: "Dashboard repositories require a signed-in tenant session.",
        code: "dashboard_repositories_unauthorized"
      }, { status: 401 });
    }

    const repositories = await listTenantRepositoryGrants({ tenantId: access.tenantId });
    return noStoreJson({
      ok: true,
      repositories: repositories.map((repository) => ({
        installationId: repository.installationId,
        repositoryId: repository.repositoryId,
        repositoryFullName: repository.repositoryFullName,
        enabled: repository.enabled,
        analysisEnabled: repository.analysisEnabled,
        saveReportsEnabled: repository.saveReportsEnabled,
        commentEnabled: repository.commentEnabled
      })),
      privacy: "grant-metadata-only"
    });
  } catch (error) {
    if (error instanceof TenantAuthStoreError || error instanceof TenantControlPlaneStoreError) {
      return noStoreJson({
        error: "Dashboard repositories are unavailable.",
        code: "dashboard_repositories_unavailable"
      }, { status: 503 });
    }
    throw error;
  }
}
