import { createGitHubInstallationAccessToken } from "./github-app";
import { listTenantGitHubInstallationStatuses } from "./github-installations";
import { getGitHubUserCredentialForSession } from "./tenant-auth";
import { parseGitHubPullUrl } from "./github";
import { listTenantRepositoryGrants, type TenantRepositoryGrant } from "./tenant-control-plane";
import { PRIVATE_ANALYSIS_CONSENT_VERSION } from "./tenant-control-plane";

type OAuthAccess = { accessToken: string; githubUserId: string };
type OAuthRead = OAuthAccess | null | { status: "reauth" | "unavailable" };
type InstallationStatus = { installationId: number; status: "active" | "suspended" | "deleted" };
type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

export type GitHubAnalysisCredential =
  | { ok: true; token: string; kind: "installation" | "user"; privateAnalysisApproved?: true; installationId?: number; repositoryId?: number }
  | { ok: false; status: 401 | 403 | 409 | 503; code: string; error: string; hint: string };

interface Dependencies {
  listGrants: () => Promise<TenantRepositoryGrant[]>;
  listStatuses: (installationIds: number[]) => Promise<InstallationStatus[]>;
  issueToken: (installationId: number) => Promise<string>;
  readOAuth: () => OAuthRead | Promise<OAuthRead>;
  fetchGitHub: GitHubFetch;
}

export async function resolveGitHubAnalysisCredential(input: {
  prUrl: string;
  tenantId: string;
  memberId: string;
  cookieHeader?: string | null;
  dependencies?: Dependencies;
}): Promise<GitHubAnalysisCredential> {
  const parsed = parseGitHubPullUrl(input.prUrl);
  if (!parsed) return failure(403, "github_pr_invalid", "The pull request URL is invalid.", "Enter a GitHub pull request URL.");
  const fullName = `${parsed.owner}/${parsed.repo}`.toLowerCase();
  const dependencies: Dependencies = input.dependencies ?? {
    listGrants: () => listTenantRepositoryGrants({ tenantId: input.tenantId }),
    listStatuses: (installationIds) => listTenantGitHubInstallationStatuses({ tenantId: input.tenantId, installationIds }),
    issueToken: (installationId) => createGitHubInstallationAccessToken(installationId),
    readOAuth: async () => {
      const access = await getGitHubUserCredentialForSession({ cookieHeader: input.cookieHeader, tenantId: input.tenantId, memberId: input.memberId });
      return access.status === "ready" ? { accessToken: access.accessToken, githubUserId: access.githubUserId } : access;
    },
    fetchGitHub: (url, init) => fetch(url, init)
  };

  let grants: TenantRepositoryGrant[];
  try {
    grants = await dependencies.listGrants();
  } catch {
    return failure(503, "github_grants_unavailable", "Repository connections are temporarily unavailable.", "Retry after repository connections are available.");
  }
  if (grants.length >= 500) return failure(503, "github_grants_unavailable", "Repository connections could not be checked completely.", "Retry after repository connections are available.");
  const matches = grants.filter((grant) => grant.tenantId === input.tenantId && grant.repositoryFullName.toLowerCase() === fullName);
  if (matches.length > 0) {
    const active = matches.filter((grant) => grant.enabled && grant.analysisEnabled);
    if (active.length !== 1) return failure(409, "github_connection_required", "This repository needs a valid AgentProof connection.", "Open the dashboard and connect or enable this repository.");
    const selected = active[0];
    if (selected.repositoryPrivate === true && selected.privateAnalysisConsentVersion !== PRIVATE_ANALYSIS_CONSENT_VERSION) {
      return failure(409, "github_private_consent_required", "Private repository analysis is off until its code-analysis notice is accepted.", "Open repository settings and turn on AgentProof analysis.");
    }
    try {
      const statuses = await dependencies.listStatuses([selected.installationId]);
      if (!statuses.some((status) => status.installationId === selected.installationId && status.status === "active")) {
        return failure(409, "github_connection_required", "This GitHub App installation is not active.", "Open the dashboard and reconnect this repository.");
      }
      if (!Number.isSafeInteger(selected.repositoryId) || !selected.repositoryId || selected.repositoryId <= 0) {
        return failure(409, "github_connection_required", "This repository connection needs to be refreshed.", "Open the dashboard and reconnect this repository.");
      }
      const token = await dependencies.issueToken(selected.installationId);
      if (!token) throw new Error("Empty installation token");
      const response = await dependencies.fetchGitHub(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" }
      );
      if (response.status === 404) return failure(409, "github_connection_required", "This repository connection needs to be refreshed.", "Open the dashboard and reconnect this repository.");
      if (!response.ok) throw new Error("Repository identity lookup failed");
      const repository = await response.json().catch(() => null) as { id?: unknown; private?: unknown } | null;
      if (repository?.id !== selected.repositoryId) {
        return failure(409, "github_connection_required", "This repository connection needs to be refreshed.", "Open the dashboard and reconnect this repository.");
      }
      if (repository.private === true && (selected.repositoryPrivate !== true || selected.privateAnalysisConsentVersion !== PRIVATE_ANALYSIS_CONSENT_VERSION)) {
        return failure(409, "github_private_consent_required", "Private repository analysis is off until its code-analysis notice is accepted.", "Open repository settings and turn on AgentProof analysis.");
      }
      if (repository.private === false && selected.repositoryPrivate === true) {
        return failure(409, "github_connection_required", "Repository visibility changed.", "Reconnect this repository from the dashboard.");
      }
      return { ok: true, token, kind: "installation", ...(selected.repositoryPrivate === true ? { privateAnalysisApproved: true as const, installationId: selected.installationId, repositoryId: selected.repositoryId } : {}) };
    } catch {
      return failure(503, "github_installation_unavailable", "GitHub App access is temporarily unavailable.", "Retry after the installation is available.");
    }
  }

  let oauthResult: OAuthRead;
  try {
    oauthResult = await dependencies.readOAuth();
  } catch {
    return failure(503, "github_oauth_unavailable", "GitHub authorization is temporarily unavailable.", "Retry after GitHub sign-in is configured.");
  }
  if (oauthResult && "status" in oauthResult && oauthResult.status === "unavailable") {
    return failure(503, "github_oauth_unavailable", "GitHub authorization is temporarily unavailable.", "Retry after GitHub access is available.");
  }
  const oauth = oauthResult && "accessToken" in oauthResult ? oauthResult : null;
  if (!oauth || input.memberId !== `github:${oauth.githubUserId}`) {
    return failure(401, "github_reauth_required", "Reconnect GitHub to analyze this repository.", "Your AgentProof session is still active; GitHub authorization must be renewed for this request.");
  }
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${oauth.accessToken}`, "X-GitHub-Api-Version": "2022-11-28" };
  const fetchJson = async (path: string): Promise<{ status: number; body: Record<string, unknown> | null }> => {
    const response = await dependencies.fetchGitHub(`https://api.github.com${path}`, { headers, cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, body: body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null };
  };
  try {
    const owner = await fetchJson(`/users/${encodeURIComponent(parsed.owner)}`);
    if (owner.status === 401) return failure(401, "github_reauth_required", "Reconnect GitHub to analyze this repository.", "GitHub authorization has expired or was revoked.");
    if (owner.status !== 200 || !owner.body) return failure(503, "github_classification_unavailable", "Repository ownership could not be verified.", "Retry when GitHub is available.");
    if (owner.body.type === "User" && String(owner.body.id) === oauth.githubUserId) {
      return failure(409, "github_install_required", "Install AgentProof for your repository before analysis.", "Open the dashboard to install the GitHub App and connect this repository.");
    }

    if (owner.body.type === "Organization") {
      let complete = false;
      for (let page = 1; page <= 10; page += 1) {
        const response = await dependencies.fetchGitHub(`https://api.github.com/user/memberships/orgs?per_page=100&page=${page}`, { headers, cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (response.status === 401) return failure(401, "github_reauth_required", "Reconnect GitHub to analyze this repository.", "GitHub authorization has expired or was revoked.");
        if (!response.ok || !Array.isArray(body)) return failure(503, "github_classification_unavailable", "Organization ownership could not be verified.", "Retry when GitHub organization access is available.");
        if (body.some((membership) => membership?.state === "active" && membership?.role === "admin" && membership?.organization?.id === owner.body?.id)) {
          return failure(409, "github_install_required", "Install AgentProof for this organization before analysis.", "Open the dashboard to install the GitHub App and connect this repository.");
        }
        if (body.length < 100) { complete = true; break; }
      }
      if (!complete) return failure(503, "github_classification_unavailable", "Organization ownership could not be verified completely.", "Retry when GitHub organization access is available.");
    } else if (owner.body.type !== "User") {
      return failure(503, "github_classification_unavailable", "Repository ownership could not be classified safely.", "Retry when GitHub provides account details.");
    }

    const repository = await fetchJson(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
    if (repository.status === 401) return failure(401, "github_reauth_required", "Reconnect GitHub to analyze this repository.", "GitHub authorization has expired or was revoked.");
    if (repository.status === 404 || repository.status === 403) return failure(403, "github_repository_unavailable", "GitHub could not show this repository to AgentProof.", "Check the URL and your GitHub access. If you administer it, install or reconnect the GitHub App from the dashboard.");
    if (repository.status !== 200 || !repository.body) return failure(503, "github_classification_unavailable", "Repository access could not be verified.", "Retry when GitHub is available.");
    const permissions = repository.body.permissions as { admin?: unknown } | undefined;
    if (permissions?.admin === true) return failure(409, "github_install_required", "Install AgentProof for a repository you administer before analysis.", "Open the dashboard to install the GitHub App and connect this repository.");
    if (repository.body.private === true) return failure(403, "github_private_denied", "This private repository is not connected for PR URL analysis.", "Install or connect the GitHub App if you administer it; otherwise use a public PR URL.");
    if (repository.body.private !== false) return failure(503, "github_classification_unavailable", "Repository visibility could not be verified.", "Retry when GitHub provides repository visibility.");
    return { ok: true, token: oauth.accessToken, kind: "user" };
  } catch {
    return failure(503, "github_classification_unavailable", "GitHub access could not be verified.", "Retry when GitHub is available.");
  }
}

/** Uncached gate for each private model/read phase. A prior token never grants lasting authority. */
export async function isPrivateAnalysisGrantCurrent(input: { tenantId: string; repositoryFullName: string; installationId: number; repositoryId: number }): Promise<boolean> {
  try {
    const grants = await listTenantRepositoryGrants({ tenantId: input.tenantId });
    const matches = grants.filter(grant => grant.tenantId === input.tenantId && grant.installationId === input.installationId && grant.repositoryId === input.repositoryId && grant.repositoryFullName.toLowerCase() === input.repositoryFullName.toLowerCase());
    if (matches.length !== 1) return false;
    const grant = matches[0];
    if (!grant.enabled || !grant.analysisEnabled || grant.repositoryPrivate !== true || grant.privateAnalysisConsentVersion !== PRIVATE_ANALYSIS_CONSENT_VERSION) return false;
    const statuses = await listTenantGitHubInstallationStatuses({ tenantId: input.tenantId, installationIds: [input.installationId] });
    return statuses.some(status => status.installationId === input.installationId && status.status === "active");
  } catch { return false; }
}

function failure(status: 401 | 403 | 409 | 503, code: string, error: string, hint: string): GitHubAnalysisCredential {
  return { ok: false, status, code, error, hint };
}
