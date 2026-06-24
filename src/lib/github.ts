import type { AnalyzeRequest, ChangedFile, CheckRun, LogSnippet, PullRequestInput } from "./types";
import { compactText } from "./redact";

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

export function parseGitHubPullUrl(url: string): GitHubPullUrl | null {
  try {
    const parsed = new URL(url);
    const [, owner, repo, pull, number] = parsed.pathname.split("/");

    if (!owner || !repo || pull !== "pull" || !number || Number.isNaN(Number(number))) {
      return null;
    }

    return { owner, repo, number: Number(number) };
  } catch {
    return null;
  }
}

export async function buildPullRequestInput(request: AnalyzeRequest): Promise<PullRequestInput> {
  if (request.prUrl && request.githubToken) {
    const live = await fetchGitHubPullRequest(request.prUrl, request.githubToken, request.taskText ?? "");

    if (live) {
      return mergePastedOverrides(live, request);
    }
  }

  return {
    url: request.prUrl,
    title: request.prUrl ? `PR analysis for ${request.prUrl}` : "Pasted PR evidence",
    description: request.prDescription ?? "",
    taskText: request.taskText ?? "",
    changedFiles: parseChangedFiles(request.changedFiles ?? ""),
    checks: parseChecks(request.checks ?? ""),
    logs: parseLogs(request.logs ?? "")
  };
}

async function fetchGitHubPullRequest(
  prUrl: string,
  token: string,
  taskText: string
): Promise<PullRequestInput | null> {
  const parsed = parseGitHubPullUrl(prUrl);

  if (!parsed) {
    return null;
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };

  const prResponse = await fetch(
    `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/pulls/${parsed.number}`,
    { headers, cache: "no-store" }
  );

  if (!prResponse.ok) {
    throw new Error(`GitHub PR fetch failed: ${prResponse.status}`);
  }

  const pr = await prResponse.json();
  const [filesResponse, checksResponse] = await Promise.all([
    fetch(pr.url + "/files", { headers, cache: "no-store" }),
    fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${pr.head.sha}/check-runs`,
      { headers, cache: "no-store" }
    )
  ]);

  const files = filesResponse.ok ? ((await filesResponse.json()) as GitHubFileResponse[]) : [];
  const checksJson = checksResponse.ok ? await checksResponse.json() : { check_runs: [] };
  const checkRuns = (checksJson.check_runs ?? []) as GitHubCheckRunResponse[];

  return {
    url: prUrl,
    title: pr.title ?? `PR #${parsed.number}`,
    description: pr.body ?? "",
    author: pr.user?.login,
    baseBranch: pr.base?.ref,
    headBranch: pr.head?.ref,
    taskText,
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
    })),
    logs: []
  };
}

function mergePastedOverrides(live: PullRequestInput, request: AnalyzeRequest): PullRequestInput {
  return {
    ...live,
    taskText: request.taskText ?? live.taskText,
    description: request.prDescription?.trim() ? request.prDescription : live.description,
    changedFiles: request.changedFiles?.trim() ? parseChangedFiles(request.changedFiles) : live.changedFiles,
    checks: request.checks?.trim() ? parseChecks(request.checks) : live.checks,
    logs: request.logs?.trim() ? parseLogs(request.logs) : live.logs
  };
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

  if (conclusion === "success" || conclusion === "neutral" || conclusion === "skipped") {
    return "passed";
  }

  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled" || conclusion === "action_required") {
    return "failed";
  }

  return "unknown";
}
