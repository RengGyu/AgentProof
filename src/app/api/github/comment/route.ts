import { NextResponse } from "next/server";
import { AGENTPROOF_COMMENT_MARKER, reportToGitHubComment } from "@/lib/markdown";
import { parseGitHubPullUrl } from "@/lib/github";
import { validateVerificationReport } from "@/lib/report-validation";
import type { PostGitHubCommentRequest, VerificationReport } from "@/lib/types";

const MAX_BODY_BYTES = 220_000;
const COMMENTS_PAGE_SIZE = 100;
const MAX_COMMENT_PAGES = 5;

interface GitHubIssueComment {
  id: number;
  body?: string;
  html_url?: string;
}

interface ExistingCommentResult {
  comment: GitHubIssueComment | null;
  capped: boolean;
  errorStatus?: number;
}

export async function POST(request: Request) {
  try {
    const rawText = await request.text();

    if (new TextEncoder().encode(rawText).length > MAX_BODY_BYTES) {
      return jsonNoStore({ error: "Request is too large to post as a PR comment." }, 413);
    }

    const body = JSON.parse(rawText) as Partial<PostGitHubCommentRequest>;

    if (!body.prUrl || !body.githubToken || !body.report) {
      return jsonNoStore({ error: "PR URL, write token, and report are required." }, 400);
    }

    const validation = validateVerificationReport(body.report);
    if (!validation.valid) {
      return jsonNoStore({ error: "Report failed validation.", details: validation.errors }, 422);
    }

    const parsed = parseGitHubPullUrl(body.prUrl);

    if (!parsed) {
      return jsonNoStore({ error: "PR URL must be a GitHub pull request URL." }, 400);
    }

    const report = body.report as VerificationReport;
    const reportSource = report.source.url ? parseGitHubPullUrl(report.source.url) : null;

    if (report.source.url && !reportSource) {
      return jsonNoStore({ error: "Report source URL must be a GitHub pull request URL before posting to GitHub." }, 422);
    }

    if (
      reportSource &&
      (reportSource.owner !== parsed.owner || reportSource.repo !== parsed.repo || reportSource.number !== parsed.number)
    ) {
      return jsonNoStore({ error: "Report source PR does not match the target PR URL." }, 422);
    }

    const commentBody = reportToGitHubComment(report);
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${body.githubToken.trim()}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const commentsUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments`;
    const existingResult = await findExistingAgentProofComment(commentsUrl, headers);

    if (existingResult.errorStatus) {
      return jsonNoStore(
        { error: mapGitHubError(existingResult.errorStatus, "read PR comments") },
        existingResult.errorStatus
      );
    }

    const existing = existingResult.comment;
    const response = existing
      ? await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/comments/${existing.id}`, {
          method: "PATCH",
          headers,
          cache: "no-store",
          body: JSON.stringify({ body: commentBody })
        })
      : await fetch(commentsUrl, {
          method: "POST",
          headers,
          cache: "no-store",
          body: JSON.stringify({ body: commentBody })
        });

    if (!response.ok) {
      return jsonNoStore({ error: mapGitHubError(response.status, existing ? "update PR comment" : "create PR comment") }, response.status);
    }

    const json = (await response.json()) as GitHubIssueComment;
    return jsonNoStore({
      action: existing ? "updated" : "created",
      url: json.html_url ?? body.prUrl,
      warning: existingResult.capped
        ? "AgentProof checked 500 existing comments and did not find a prior marker comment."
        : undefined
    });
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "GitHub comment post failed." },
      400
    );
  }
}

async function findExistingAgentProofComment(
  commentsUrl: string,
  headers: Record<string, string>
): Promise<ExistingCommentResult> {
  for (let page = 1; page <= MAX_COMMENT_PAGES; page += 1) {
    const response = await fetch(`${commentsUrl}?per_page=${COMMENTS_PAGE_SIZE}&page=${page}`, {
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      return { comment: null, capped: false, errorStatus: response.status };
    }

    const comments = (await response.json()) as GitHubIssueComment[];
    const existing = comments.find((comment) => comment.body?.includes(AGENTPROOF_COMMENT_MARKER));

    if (existing) {
      return { comment: existing, capped: false };
    }

    if (comments.length < COMMENTS_PAGE_SIZE) {
      return { comment: null, capped: false };
    }
  }

  return { comment: null, capped: true };
}

function jsonNoStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}

function mapGitHubError(status: number, action: string): string {
  if (status === 401) return `GitHub could not ${action}: token is invalid.`;
  if (status === 403) return `GitHub could not ${action}: token lacks permission or rate limit was reached.`;
  if (status === 404) return `GitHub could not ${action}: repo or PR was not found for this token.`;
  return `GitHub could not ${action}: HTTP ${status}.`;
}
