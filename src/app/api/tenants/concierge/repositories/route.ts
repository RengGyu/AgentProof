import { NextResponse } from "next/server";
import { verifySameOriginMutationRequest } from "@/lib/csrf";
import { createGitHubInstallationAccessToken } from "@/lib/github-app";
import { getGitHubInstallationMetadataStoreStatus, listTenantGitHubInstallationStatuses } from "@/lib/github-installations";
import { conciergeRuntimeDefaults } from "@/lib/concierge-private-beta";
import { getTenantAccountStoreStatus } from "@/lib/tenant-accounts";
import { getTenantAuthSessionStoreStatus, verifyTenantAuthAccess } from "@/lib/tenant-auth";
import { getTenantRepositoryGrantStoreStatus, registerConciergeManualRepositoryGrant } from "@/lib/tenant-control-plane";
import { getConciergeStoreConfigurationStatus } from "@/lib/concierge-store-configuration";

const MAX_BODY_BYTES = 2_000;

export async function POST(request: Request) {
  if (!verifySameOriginMutationRequest(request).ok) return json({ code: "csrf_rejected" }, 403);
  const runtime = conciergeRuntimeDefaults();
  if (!runtime.manualAnalysisEnabled || runtime.globalKillSwitch) return json({ code: runtime.globalKillSwitch ? "global_kill_switch" : "concierge_disabled" }, 503);
  const body = await parseBody(request);
  if (!body) return json({ code: "invalid_request" }, 400);

  const stores = [
    getTenantAuthSessionStoreStatus(),
    getTenantAccountStoreStatus(),
    getGitHubInstallationMetadataStoreStatus(),
    getTenantRepositoryGrantStoreStatus()
  ];
  if (stores.some((store) => !store.configured || !store.durable)) return json({ code: "durable_store_required" }, 503);
  const configuration = getConciergeStoreConfigurationStatus();
  if (!configuration.configured) return json({ code: "durable_store_required" }, 503);
  if (!configuration.consistent) return json({ code: "durable_store_mismatch" }, 503);

  let session: Awaited<ReturnType<typeof verifyTenantAuthAccess>>;
  let statuses: Awaited<ReturnType<typeof listTenantGitHubInstallationStatuses>>;
  try {
    session = await verifyTenantAuthAccess({ tenantId: body.tenantId, cookieHeader: request.headers.get("cookie") });
    statuses = await listTenantGitHubInstallationStatuses({ tenantId: body.tenantId, installationIds: [body.installationId] });
  } catch {
    return json({ code: "authorization_unavailable" }, 503);
  }
  if (!session.authorized || session.method !== "durable-session") return json({ code: "session_invalid" }, 403);
  if (session.role !== "owner" && session.role !== "admin") return json({ code: "tenant_admin_required" }, 403);
  if (statuses.length !== 1 || statuses[0]?.installationId !== body.installationId || statuses[0]?.status !== "active") return json({ code: "installation_not_active" }, 403);

  try {
    const token = await createGitHubInstallationAccessToken(body.installationId);
    const installed = await findInstalledRepository(body.installationId, body.repositoryId, token);
    if (installed.kind === "provider_error") return json({ code: "concierge_repository_grant_unavailable" }, 502);
    if (installed.kind === "not_found" || installed.repository.fullName.toLowerCase() !== body.repositoryFullName.toLowerCase()) return json({ code: "repository_not_installed" }, 422);
    const registration = await registerConciergeManualRepositoryGrant({
      tenantId: body.tenantId,
      installationId: body.installationId,
      repositoryId: installed.repository.id,
      repositoryFullName: installed.repository.fullName
    });
    const grant = registration.grant;
    return json({
      ok: true,
      registration: registration.outcome,
      tenantId: grant.tenantId,
      installationId: grant.installationId,
      repositoryId: grant.repositoryId,
      repositoryFullName: grant.repositoryFullName,
      settings: {
        manualAnalysisEnabled: grant.enabled,
        analysisEnabled: grant.analysisEnabled,
        saveReportsEnabled: grant.saveReportsEnabled,
        commentEnabled: grant.commentEnabled,
        slackNotificationsEnabled: grant.slackNotificationsEnabled
      },
      conciergeCapabilities: { llmEnabled: false, webhookAutomationEnabled: false, saveReportsEnabled: false, publicShareEnabled: false, githubCommentEnabled: false, slackEnabled: false },
      privacy: "grant-metadata-only"
    });
  } catch {
    return json({ code: "concierge_repository_grant_unavailable" }, 502);
  }
}

async function parseBody(request: Request): Promise<{ tenantId: string; installationId: number; repositoryId: number; repositoryFullName: string } | null> {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    if (Object.keys(value).sort().join(",") !== "installationId,repositoryFullName,repositoryId,tenantId") return null;
    const tenantId = value.tenantId;
    const installationId = value.installationId;
    const repositoryId = value.repositoryId;
    const repositoryFullName = value.repositoryFullName;
    if (typeof tenantId !== "string" || typeof repositoryFullName !== "string" || typeof installationId !== "number" || typeof repositoryId !== "number" || !Number.isSafeInteger(installationId) || !Number.isSafeInteger(repositoryId)) return null;
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(tenantId) || installationId <= 0 || repositoryId <= 0 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryFullName)) return null;
    return { tenantId, installationId, repositoryId, repositoryFullName };
  } catch { return null; }
}

type RepositoryLookup =
  | { kind: "found"; repository: { id: number; fullName: string } }
  | { kind: "not_found" }
  | { kind: "provider_error" };

async function findInstalledRepository(installationId: number, repositoryId: number, token: string): Promise<RepositoryLookup> {
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`https://api.github.com/installation/repositories?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return { kind: "provider_error" };
    const body = await response.json().catch(() => null) as { repositories?: Array<{ id?: unknown; full_name?: unknown }> } | null;
    const repositories = body?.repositories;
    if (!Array.isArray(repositories)) return { kind: "provider_error" };
    const match = repositories.find((repository) => repository?.id === repositoryId && typeof repository.full_name === "string");
    if (match && typeof match.full_name === "string") return { kind: "found", repository: { id: repositoryId, fullName: match.full_name } };
    if (repositories.length < 100) break;
  }
  return { kind: "not_found" };
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
