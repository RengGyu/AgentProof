import { NextResponse } from "next/server";
import { AGENTPROOF_COMMENT_MARKER, reportToGitHubComment } from "@/lib/markdown";
import { parseGitHubPullUrl } from "@/lib/github";
import { validateVerificationReport } from "@/lib/report-validation";
import type { PostGitHubCommentRequest } from "@/lib/types";

const MAX_BODY_BYTES = 220_000;

interface GitHubIssueComment {
  id: number;
  body?: string;
  html_url?: string;
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

    const commentBody = reportToGitHubComment(body.report);
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${body.githubToken.trim()}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const commentsUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments`;
    const commentsResponse = await fetch(`${commentsUrl}?per_page=100`, {
      headers,
      cache: "no-store"
    });

    if (!commentsResponse.ok) {
      return jsonNoStore({ error: mapGitHubError(commentsResponse.status, "read PR comments") }, commentsResponse.status);
    }

    const comments = (await commentsResponse.json()) as GitHubIssueComment[];
    const existing = comments.find((comment) => comment.body?.includes(AGENTPROOF_COMMENT_MARKER));
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
    return jsonNoStore({ action: existing ? "updated" : "created", url: json.html_url ?? body.prUrl });
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "GitHub comment post failed." },
      400
    );
  }
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
