import { noStoreJson } from "@/lib/http";
import { readConciergeGitHubSession } from "@/lib/concierge-github-auth";
import { listTenantEnabledRepositoryGrantScope } from "@/lib/tenant-control-plane";
import { listTenantGitHubInstallationStatuses } from "@/lib/github-installations";
import { getConciergeStoreConfigurationStatus } from "@/lib/concierge-store-configuration";

export async function GET(request: Request) {
  // Do this before reading the OAuth session: a cross-project deployment is
  // not an authenticated state and must not issue any store/provider request.
  const stores = getConciergeStoreConfigurationStatus();
  if (!stores.configured) return noStoreJson({ code: "durable_store_required" }, { status: 503 });
  if (!stores.consistent) return noStoreJson({ code: "durable_store_mismatch" }, { status: 503 });
  try {
    const session = await readConciergeGitHubSession(request.headers.get("cookie"));
    if (!session) return noStoreJson({ code: "session_invalid" }, { status: 401 });
    const statuses = await listTenantGitHubInstallationStatuses({ tenantId: session.tenantId, installationIds: [session.installationId] });
    if (statuses.length !== 1 || statuses[0]?.status !== "active") return noStoreJson({ code: "installation_not_active" }, { status: 403 });
    const grants = await listTenantEnabledRepositoryGrantScope({ tenantId: session.tenantId });
    // Privacy was verified during the OAuth user/App intersection. The durable
    // grant does not repeat GitHub visibility metadata, so do not invent it.
    const repositories = grants.filter((grant) => grant.installationId === session.installationId && typeof grant.repositoryId === "number" && session.repositoryIds.includes(grant.repositoryId)).map((grant) => ({ fullName: grant.repositoryFullName })).slice(0, 1);
    return noStoreJson({ repositories, state: repositories.length ? "ready" : "no_granted_personal_repository" });
  } catch { return noStoreJson({ code: "auth_unavailable" }, { status: 503 }); }
}
