import { describe, expect, it, vi } from "vitest";
import { runGitHubCommentSmoke } from "./smoke-github-comment.mjs";

describe("smoke-github-comment", () => {
  it("fails closed without a target PR URL", async () => {
    const fetchMock = vi.fn();

    await expect(runGitHubCommentSmoke({
      prUrl: undefined,
      commentToken: "github_pat_comment_token_should_not_leak",
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_COMMENT_SMOKE_PR_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without a comment write token", async () => {
    const fetchMock = vi.fn();

    await expect(runGitHubCommentSmoke({
      prUrl: "https://github.com/org/repo/pull/1",
      commentToken: undefined,
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_COMMENT_SMOKE_GITHUB_TOKEN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("analyzes the target PR then posts a marker comment without leaking token values in the result", async () => {
    const report = reportFixture("https://github.com/org/repo/pull/1");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report }))
      .mockResolvedValueOnce(jsonResponse({
        action: "updated",
        url: "https://github.com/org/repo/pull/1#issuecomment-123"
      }));

    const result = await runGitHubCommentSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      taskText: "Acceptance criteria: verify comment posting.",
      commentToken: "github_pat_comment_token_should_not_leak",
      fetchImpl: fetchMock
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      action: "updated",
      commentUrl: "https://github.com/org/repo/pull/1#issuecomment-123",
      priority: "medium",
      evidenceCoverage: 74,
      ciStatus: "passed"
    }));
    expect(JSON.stringify(result)).not.toContain("github_pat_comment_token_should_not_leak");

    const analyzeBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(analyzeBody).toEqual({
      prUrl: "https://github.com/org/repo/pull/1",
      taskText: "Acceptance criteria: verify comment posting."
    });

    const commentBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(commentBody.githubToken).toBe("github_pat_comment_token_should_not_leak");
    expect(commentBody.report).toEqual(report);
  });

  it("passes an analyze token only when explicitly provided", async () => {
    const report = reportFixture("https://github.com/org/repo/pull/1");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report }))
      .mockResolvedValueOnce(jsonResponse({
        action: "created",
        url: "https://github.com/org/repo/pull/1#issuecomment-124"
      }));

    await runGitHubCommentSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      commentToken: "github_pat_comment_token_should_not_leak",
      analyzeToken: "github_pat_analyze_token_should_not_leak",
      fetchImpl: fetchMock
    });

    const analyzeBody = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(analyzeBody.githubToken).toBe("github_pat_analyze_token_should_not_leak");
    expect(String(fetchMock.mock.calls[1][1].body)).not.toContain("github_pat_analyze_token_should_not_leak");
  });

  it("fails if the comment endpoint echoes token values", async () => {
    const token = "github_pat_comment_token_should_not_leak";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ report: reportFixture("https://github.com/org/repo/pull/1") }))
      .mockResolvedValueOnce(jsonResponse({
        action: "updated",
        url: `https://github.com/org/repo/pull/1#issuecomment-125?token=${token}`
      }));

    await expect(runGitHubCommentSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      commentToken: token,
      fetchImpl: fetchMock
    })).rejects.toThrow("leaked a token value");
  });

  it("redacts secret-like error text before throwing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      error: "GitHub token github_pat_secret_should_not_leak_1234567890 was rejected"
    }, 401));

    await expect(runGitHubCommentSmoke({
      baseUrl: "https://agentproof.example",
      prUrl: "https://github.com/org/repo/pull/1",
      commentToken: "github_pat_comment_token_should_not_leak",
      fetchImpl: fetchMock
    })).rejects.toThrow("[redacted]");
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store"
    }
  });
}

function reportFixture(prUrl) {
  return {
    analysisId: "ap_comment_smoke",
    createdAt: "2026-06-28T00:00:00.000Z",
    source: {
      title: "Comment smoke PR",
      url: prUrl
    },
    summary: {
      oneLine: "Evidence is sufficient for comment smoke validation.",
      confidence: 0.82,
      priority: "medium",
      evidenceCoverage: 74,
      topRisks: ["Some requirements have only partial evidence."]
    },
    requirements: [
      {
        requirementId: "req_1",
        requirementText: "verify GitHub comment posting",
        status: "met",
        evidenceRefs: ["ev_1"],
        gaps: [],
        reviewerNote: "Passing execution evidence is present.",
        confidence: 0.85
      }
    ],
    claims: [],
    scope: {
      suspected: false,
      outOfScopeFiles: [],
      reasons: [],
      evidenceRefs: []
    },
    testing: {
      ciStatus: "passed",
      lintStatus: "unknown",
      typecheckStatus: "unknown",
      missingTests: []
    },
    reviewPriority: [
      {
        path: "Changed files",
        reason: "No blocker found from deterministic evidence; spot-check requirement mapping.",
        priority: "low",
        evidenceRefs: ["ev_1"]
      }
    ],
    reprompt: {
      targetAgent: "codex",
      prompt: "Summarize how each acceptance criterion maps to changed files and test evidence."
    },
    evidenceIndex: [
      {
        id: "ev_1",
        kind: "check",
        label: "unit tests",
        summary: "Status: passed. unit tests completed",
        confidence: 0.9
      }
    ],
    limitations: []
  };
}
