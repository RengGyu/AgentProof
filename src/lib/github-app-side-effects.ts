import { reportToGitHubComment } from "./markdown";
import { redactSecrets } from "./redact";
import { createVerifiedSavedReport, getSavedReportStoreStatus } from "./server-report-store";
import type { VerificationReport } from "./types";

const AGENTPROOF_APP_COMMENT_MARKER = "<!-- agentproof:github-app:evidence-check:v1 -->";
const COMMENTS_PAGE_SIZE = 100;
const MAX_COMMENT_PAGES = 5;

export interface GitHubAppPullRequestTarget {
  repositoryFullName: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
}

export interface AutomationSavedReportResult {
  id: string;
  url: string;
  expiresAt: string;
  privacy: "summary-only";
  durability: string;
}

export interface AutomationCommentResult {
  action: "created" | "updated";
  url: string;
}

export async function createAutomationSavedReport(
  report: VerificationReport,
  options: {
    requestUrl: string;
    tenantId?: string;
  }
): Promise<AutomationSavedReportResult | undefined> {
  if (!/^(1|true|yes|on)$/i.test(process.env.AGENTPROOF_GITHUB_APP_SAVE_REPORTS?.trim() ?? "")) {
    return undefined;
  }

  const status = getSavedReportStoreStatus();
  const saved = await createVerifiedSavedReport(report, { tenantId: options.tenantId });
  const url = new URL(`/reports/${saved.id}`, options.requestUrl);
  if (saved.accessToken) {
    url.searchParams.set("key", saved.accessToken);
  }

  return {
    id: saved.id,
    url: url.toString(),
    expiresAt: saved.expiresAt,
    privacy: "summary-only",
    durability: status.durability
  };
}

export async function postGitHubAppMarkerComment(
  target: GitHubAppPullRequestTarget,
  token: string,
  report: VerificationReport
): Promise<AutomationCommentResult> {
  const [owner, repo] = target.repositoryFullName.split("/");
  if (!owner || !repo) {
    throw new Error("Repository full name is invalid.");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
  const commentsUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${target.pullRequestNumber}/comments`;
  const existing = await findExistingGitHubAppComment(commentsUrl, headers);
  const body = `${AGENTPROOF_APP_COMMENT_MARKER}\n${reportToGitHubComment(report, { includeMarker: false })}`;
  const response = existing
    ? await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
      method: "PATCH",
      headers,
      cache: "no-store",
      body: JSON.stringify({ body: redactSecrets(body) })
    })
    : await fetch(commentsUrl, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({ body: redactSecrets(body) })
    });

  if (!response.ok) {
    throw new GitHubAppCommentError(
      response.status,
      `GitHub App could not ${existing ? "update" : "create"} the AgentProof marker comment: HTTP ${response.status}.`
    );
  }

  const json = (await response.json()) as { html_url?: unknown };
  return {
    action: existing ? "updated" : "created",
    url: typeof json.html_url === "string" ? redactSecrets(json.html_url) : target.pullRequestUrl
  };
}

export class GitHubAppCommentError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GitHubAppCommentError";
  }
}

async function findExistingGitHubAppComment(commentsUrl: string, headers: Record<string, string>) {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const response = await fetch(`${commentsUrl}?per_page=${COMMENTS_PAGE_SIZE}&page=${page}`, {
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new GitHubAppCommentError(response.status, `GitHub App could not read PR comments: HTTP ${response.status}.`);
    }

    const comments = (await response.json()) as Array<{ id?: unknown; body?: unknown }>;
    const existing = comments.find((comment) =>
      typeof comment.id === "number" &&
      typeof comment.body === "string" &&
      comment.body.includes(AGENTPROOF_APP_COMMENT_MARKER)
    );

    if (existing && typeof existing.id === "number") {
      return { id: existing.id };
    }

    if (comments.length < COMMENTS_PAGE_SIZE) {
      return null;
    }
  }

  return null;
}
