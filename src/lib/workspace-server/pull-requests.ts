import { resolveWorkspaceAccess, type WorkspaceSource } from "./access";
import { getTenantControlPlaneSettings, listTenantRepositoryGrants } from "@/lib/tenant-control-plane";
import { listTenantGitHubInstallationStatuses } from "@/lib/github-installations";
import { createGitHubInstallationAccessToken } from "@/lib/github-app";
import { noStoreJson } from "@/lib/http";

class HistoryError extends Error {
  constructor(readonly status: number) { super("Repository history is unavailable."); }
}

export async function GET(request: Request, source: WorkspaceSource = "web") {
  const query = new URL(request.url).searchParams;
  const repositoryId = positiveInteger(query.get("repositoryId"));
  const rawPr = query.get("pullRequestNumber");
  const pullRequestNumber = positiveInteger(rawPr);
  if (!repositoryId || (rawPr !== null && !pullRequestNumber)) return failure(400);
  if (!getTenantControlPlaneSettings().enabled) return failure(409);
  try {
    const access = await resolveWorkspaceAccess(request, source);
    if (!access.authorized || !access.tenantId) return failure(401);
    const grants = await listTenantRepositoryGrants({ tenantId: access.tenantId });
    const grant = grants.find(item => item.repositoryId === repositoryId && item.enabled);
    if (!grant) return failure(404);
    const installations = await listTenantGitHubInstallationStatuses({ tenantId: access.tenantId, installationIds: [grant.installationId] });
    if (!installations.some(item => item.installationId === grant.installationId && item.status === "active")) return failure(403);
    const token = await createGitHubInstallationAccessToken(grant.installationId);
    // Check live installation access by immutable ID before reading private PRs.
    const { data: repo } = await github(`/repositories/${repositoryId}`, token);
    if (repo?.id !== repositoryId || typeof repo.full_name !== "string"
      || !/^[\w.-]+\/[\w.-]+$/.test(repo.full_name)
      || repo.full_name.toLowerCase() !== grant.repositoryFullName.toLowerCase()) return failure(403);
    const path = `/repos/${repo.full_name}/pulls`;
    if (!pullRequestNumber) {
      const { data } = await github(`${path}?state=all&sort=updated&direction=desc&per_page=20`, token);
      if (!Array.isArray(data)) throw new HistoryError(503);
      const pullRequests = data.slice(0, 20).map(normalizePr);
      return noStoreJson({ repositoryId, pullRequests });
    }
    const { data: prData } = await github(`${path}/${pullRequestNumber}`, token);
    const pr = normalizePr(prData);
    if (pr.number !== pullRequestNumber) throw new HistoryError(503);
    const { data, hasNext } = await github(`${path}/${pullRequestNumber}/commits?per_page=100`, token);
    if (!Array.isArray(data)) throw new HistoryError(503);
    const commits = data.slice(0, 100).map(item => {
      if (!validSha(item?.sha) || typeof item.commit?.message !== "string") throw new HistoryError(503);
      return { sha: item.sha as string, message: item.commit.message.split("\n")[0].slice(0, 240) as string };
    }).reverse();
    // GitHub caps this endpoint. Always include the exact observed head; do not
    // label a partial response as the complete history or invent saved reports.
    if (!commits.some(item => item.sha === pr.headSha)) commits.unshift({ sha: pr.headSha, message: "Current PR head" });
    return noStoreJson({ repositoryId, pullRequestNumber, pullRequest: pr, analysisPrUrl: `https://github.com/${repo.full_name}/pull/${pullRequestNumber}`, headSha: pr.headSha, commits: commits.map(item => ({ ...item, url: `https://github.com/${repo.full_name}/commit/${item.sha}` })), truncated: hasNext, pullRequestUrl: `https://github.com/${repo.full_name}/pull/${pullRequestNumber}/commits` });
  } catch (error) {
    return failure(error instanceof HistoryError ? error.status : 503);
  }
}

function positiveInteger(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function validSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value); }
function normalizePr(item: any) {
  if (!Number.isSafeInteger(item?.number) || item.number <= 0 || typeof item.title !== "string" || !validSha(item.head?.sha) || !["open", "closed"].includes(item.state)) throw new HistoryError(503);
  return { number: item.number as number, title: item.title.slice(0, 240) as string, state: item.state as string, headSha: item.head.sha as string };
}
async function github(path: string, token: string) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new HistoryError(response.status === 403 || response.status === 404 ? 403 : 503);
  return { data: await response.json(), hasNext: /rel="next"/.test(response.headers.get("link") ?? "") };
}
function failure(status: number) {
  return noStoreJson({ error: status === 401 ? "Sign in to browse repository history." : "Repository history could not be loaded. Check the connection and GitHub App access, then try again." }, { status });
}
