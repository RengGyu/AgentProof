export interface RepositorySelectionRepository {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch?: string;
}

export type RepositorySelectionLoadStatus = "idle" | "loading" | "ready" | "empty" | "error";

export interface RepositorySelectionLoadResult {
  status: RepositorySelectionLoadStatus;
  repositories: RepositorySelectionRepository[];
  message: string;
}

export function resolveRepositorySelectionLoad(input: {
  status: number;
  payload: unknown;
}): RepositorySelectionLoadResult {
  const repositories = normalizeRepositories(input.payload);

  if (input.status >= 200 && input.status < 300 && repositories) {
    if (repositories.length > 0) {
      return {
        status: "ready",
        repositories,
        message: "Choose a repository. Reports retain no raw diffs, logs, or tokens."
      };
    }
    return {
      status: "empty",
      repositories: [],
      message: "This GitHub App installation has no accessible repositories. Update the App repository access, then try again."
    };
  }

  return {
    status: "error",
    repositories: [],
    message: "Repositories could not be loaded. Try again."
  };
}

function normalizeRepositories(payload: unknown): RepositorySelectionRepository[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const repositories = (payload as { repositories?: unknown }).repositories;
  if (!Array.isArray(repositories)) return null;

  const normalized = repositories.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const repository = item as {
      id?: unknown;
      fullName?: unknown;
      private?: unknown;
      defaultBranch?: unknown;
    };
    if (!Number.isInteger(repository.id) || (repository.id as number) <= 0 || typeof repository.fullName !== "string" || typeof repository.private !== "boolean") {
      return [];
    }
    return [{
      id: repository.id as number,
      fullName: repository.fullName,
      private: repository.private,
      ...(typeof repository.defaultBranch === "string" ? { defaultBranch: repository.defaultBranch } : {})
    }];
  });

  return normalized.slice(0, 100);
}
