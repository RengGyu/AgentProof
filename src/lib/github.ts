import type { AnalyzeRequest, ChangedFile, CheckRun, LogSnippet, PullRequestInput } from "./types";
import { compactText, redactSecrets } from "./redact";

const GITHUB_FETCH_TIMEOUT_MS = 8000;
const GITHUB_PAGE_SIZE = 100;
const GITHUB_MAX_PAGES = 3;

interface GitHubPullUrl {
  owner: string;
  repo: string;
  number: number;
}

interface GitHubFileResponse {
  filename: string;
  additions: number;
  deletions: number;
  status: ChangedFile["status"];
  patch?: string;
}

interface GitHubCheckRunResponse {
  name: string;
  status: string;
  conclusion: string | null;
  html_url?: string;
  output?: {
    title?: string;
    summary?: string;
  };
}

interface GitHubStatusResponse {
  context: string;
  state: string;
  target_url?: string;
  description?: string;
}

export function parseGitHubPullUrl(url: string): GitHubPullUrl | null {
  try {
    const normalizedUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
    const parsed = new URL(normalizedUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const [owner, repo, pull, number] = parts;

    if (
      parsed.hostname.toLowerCase() !== "github.com" ||
      !["http:", "https:"].includes(parsed.protocol) ||
      parts.length !== 4 ||
      !owner ||
      !repo ||
      pull !== "pull" ||
      !number ||
      !Number.isInteger(Number(number)) ||
      Number(number) <= 0
    ) {
      return null;
    }

    return { owner, repo, number: Number(number) };
  } catch {
    return null;
  }
}

export async function buildPullRequestInput(request: AnalyzeRequest): Promise<PullRequestInput> {
  if (request.prUrl) {
    if (!parseGitHubPullUrl(request.prUrl)) {
      throw new Error("PR URL must be a GitHub pull request URL, for example https://github.com/org/repo/pull/123.");
    }

    try {
      const live = await fetchGitHubPullRequest(request.prUrl, request.githubToken, request.taskText ?? "");

      if (live) {
        return mergePastedOverrides(live, request);
      }
    } catch (error) {
      if (!hasPastedEvidence(request)) {
        throw error;
      }
    }
  }

  return {
    url: request.prUrl,
    title: request.prUrl ? `PR analysis for ${request.prUrl}` : "Pasted PR evidence",
    description: redactSecrets(request.prDescription ?? ""),
    taskText: redactSecrets(request.taskText ?? ""),
    changedFiles: parseChangedFiles(request.changedFiles ?? ""),
    checks: parseChecks(request.checks ?? ""),
    logs: parseLogs(request.logs ?? ""),
    limitations: request.inputLimitations ?? []
  };
}

async function fetchGitHubPullRequest(
  prUrl: string,
  token: string | undefined,
  taskText: string
): Promise<PullRequestInput | null> {
  const parsed = parseGitHubPullUrl(prUrl);

  if (!parsed) {
    return null;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };

  if (token?.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const prResponse = await githubFetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    headers
  );

  if (!prResponse.ok) {
    throw new Error(
      token?.trim()
        ? `GitHub PR fetch failed: ${prResponse.status}`
        : `GitHub PR fetch failed: ${prResponse.status}. Public PRs work without a token, but private repos require a fine-grained token.`
    );
  }

  const pr = await prResponse.json();
  const limitations: string[] = [];
  const [files, checkRuns, statuses] = await Promise.all([
    fetchPullFiles(pr.url + "/files", headers, limitations),
    fetchCheckRuns(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${pr.head.sha}/check-runs`, headers, limitations),
    fetchCommitStatuses(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${pr.head.sha}/status`, headers, limitations)
  ]);

  return {
    url: prUrl,
    title: pr.title ?? `PR #${parsed.number}`,
    description: redactSecrets(pr.body ?? ""),
    author: pr.user?.login,
    baseBranch: pr.base?.ref,
    headBranch: pr.head?.ref,
    taskText: redactSecrets(taskText),
    changedFiles: files.map((file) => ({
      path: file.filename,
      additions: file.additions,
      deletions: file.deletions,
      status: file.status,
      patch: file.patch ? compactText(file.patch, 1000) : undefined
    })),
    checks: checkRuns.map((check) => ({
      name: check.name,
      status: mapGitHubCheckStatus(check.status, check.conclusion),
      summary: check.output?.summary || check.output?.title,
      url: check.html_url
    })).concat(statuses.map((status) => ({
      name: status.context,
      status: mapGitHubCommitStatus(status.state),
      summary: status.description,
      url: status.target_url
    }))),
    logs: [],
    limitations
  };
}

function mergePastedOverrides(live: PullRequestInput, request: AnalyzeRequest): PullRequestInput {
  return {
    ...live,
    taskText: request.taskText ? redactSecrets(request.taskText) : live.taskText,
    description: request.prDescription?.trim() ? redactSecrets(request.prDescription) : live.description,
    changedFiles: request.changedFiles?.trim() ? parseChangedFiles(request.changedFiles) : live.changedFiles,
    checks: request.checks?.trim() ? parseChecks(request.checks) : live.checks,
    logs: request.logs?.trim() ? parseLogs(request.logs) : live.logs,
    limitations: [
      ...(live.limitations ?? []),
      ...(request.inputLimitations ?? []),
      ...(request.changedFiles?.trim() ? ["Pasted changed files replaced live GitHub file evidence."] : []),
      ...(request.checks?.trim() ? ["Pasted checks replaced live GitHub check evidence."] : []),
      ...(request.logs?.trim() ? [] : [])
    ]
  };
}

function hasPastedEvidence(request: AnalyzeRequest): boolean {
  return Boolean(
    request.prDescription?.trim() ||
      request.changedFiles?.trim() ||
      request.checks?.trim() ||
      request.logs?.trim()
  );
}

function githubFetch(url: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS)
  });
}

async function fetchPullFiles(
  baseUrl: string,
  headers: Record<string, string>,
  limitations: string[]
): Promise<GitHubFileResponse[]> {
  const files: GitHubFileResponse[] = [];

  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const response = await githubFetch(`${baseUrl}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`, headers);

    if (!response.ok) {
      limitations.push(`GitHub changed-file fetch failed with status ${response.status}; file evidence may be incomplete.`);
      return files;
    }

    const pageItems = (await response.json()) as GitHubFileResponse[];
    files.push(...pageItems);

    if (pageItems.length < GITHUB_PAGE_SIZE) {
      return files;
    }
  }

  limitations.push(`GitHub changed-file fetch was capped at ${GITHUB_PAGE_SIZE * GITHUB_MAX_PAGES} files.`);
  return files;
}

async function fetchCheckRuns(
  baseUrl: string,
  headers: Record<string, string>,
  limitations: string[]
): Promise<GitHubCheckRunResponse[]> {
  const checks: GitHubCheckRunResponse[] = [];
  let totalCount: number | undefined;

  for (let page = 1; page <= GITHUB_MAX_PAGES; page += 1) {
    const response = await githubFetch(`${baseUrl}?per_page=${GITHUB_PAGE_SIZE}&page=${page}`, headers);

    if (!response.ok) {
      limitations.push(`GitHub check-run fetch failed with status ${response.status}; CI evidence may be incomplete.`);
      return checks;
    }

    const pageJson = await response.json();
    totalCount = typeof pageJson.total_count === "number" ? pageJson.total_count : totalCount;
    const pageItems = (pageJson.check_runs ?? []) as GitHubCheckRunResponse[];
    checks.push(...pageItems);

    if (pageItems.length < GITHUB_PAGE_SIZE || (totalCount !== undefined && checks.length >= totalCount)) {
      return checks;
    }
  }

  if (totalCount === undefined || checks.length < totalCount) {
    limitations.push(`GitHub check-run fetch was capped at ${GITHUB_PAGE_SIZE * GITHUB_MAX_PAGES} checks.`);
  }

  return checks;
}

async function fetchCommitStatuses(
  url: string,
  headers: Record<string, string>,
  limitations: string[]
): Promise<GitHubStatusResponse[]> {
  const response = await githubFetch(url, headers);

  if (!response.ok) {
    limitations.push(`GitHub commit-status fetch failed with status ${response.status}; legacy status evidence may be incomplete.`);
    return [];
  }

  const json = await response.json();
  return (json.statuses ?? []) as GitHubStatusResponse[];
}

function parseChangedFiles(input: string): ChangedFile[] {
  return input
    .split(/\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 120)
    .map((path) => ({ path, status: "modified" }));
}

function parseChecks(input: string): CheckRun[] {
  return input
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((line) => {
      const lowered = line.toLowerCase();
      const status = lowered.includes("fail")
        ? "failed"
        : lowered.includes("pass") || lowered.includes("success")
          ? "passed"
          : lowered.includes("pending")
            ? "pending"
            : "unknown";

      return { name: line.split(":")[0] || "check", status, summary: line };
    });
}

function parseLogs(input: string): LogSnippet[] {
  if (!input.trim()) {
    return [];
  }

  const status = /fail|error/i.test(input) ? "failed" : /pass|success/i.test(input) ? "passed" : "unknown";

  return [{ source: "pasted logs", status, text: compactText(input, 1600) }];
}

function mapGitHubCheckStatus(status: string, conclusion: string | null): CheckRun["status"] {
  if (status !== "completed") {
    return status === "queued" || status === "in_progress" ? "pending" : "unknown";
  }

  if (conclusion === "success") {
    return "passed";
  }

  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled" || conclusion === "action_required") {
    return "failed";
  }

  return "unknown";
}

function mapGitHubCommitStatus(state: string): CheckRun["status"] {
  if (state === "success") return "passed";
  if (state === "failure" || state === "error") return "failed";
  if (state === "pending") return "pending";
  return "unknown";
}
