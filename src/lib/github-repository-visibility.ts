const SAFE_REPOSITORY_FULL_NAME = /^[-.A-Za-z0-9_]+\/[-.A-Za-z0-9_]+$/;

/**
 * Reads only GitHub's visibility flag for a legacy repository grant. The full
 * response is never returned, logged, or persisted. Any uncertainty is private.
 */
export async function isGitHubRepositoryPublic(repositoryFullName: string, installationToken: string): Promise<boolean> {
  if (!SAFE_REPOSITORY_FULL_NAME.test(repositoryFullName) || !installationToken) return false;

  try {
    const response = await fetch(`https://api.github.com/repos/${repositoryFullName}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${installationToken}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      cache: "no-store"
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && (payload as { private?: unknown }).private === false);
  } catch {
    return false;
  }
}
