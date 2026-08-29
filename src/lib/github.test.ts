import { createHash } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPullRequestInput,
  GITHUB_EVIDENCE_TIMING_PHASES,
  normalizeGitHubPullUrl,
  parseGitHubPullUrl,
  type GitHubEvidenceTimingPhase
} from "./github";
import { generateVerificationReportV2FromInput } from "./verifier";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseGitHubPullUrl", () => {
  it("parses a GitHub pull request URL", () => {
    expect(parseGitHubPullUrl("https://github.com/vercel/next.js/pull/95118")).toEqual({
      owner: "vercel",
      repo: "next.js",
      number: 95118
    });
  });

  it("accepts copied GitHub PR URLs without an explicit protocol", () => {
    expect(parseGitHubPullUrl("github.com/vercel/next.js/pull/95118")).toEqual({
      owner: "vercel",
      repo: "next.js",
      number: 95118
    });
  });

  it("rejects non-pull URLs", () => {
    expect(parseGitHubPullUrl("https://github.com/vercel/next.js/issues/1")).toBeNull();
    expect(parseGitHubPullUrl("https://example.com/vercel/next.js/pull/1")).toBeNull();
    expect(parseGitHubPullUrl("https://github.com/vercel/next.js/pull/1/files")).toBeNull();
    expect(parseGitHubPullUrl("not a url")).toBeNull();
  });

  it("canonicalizes PR URLs before they are persisted in reports", () => {
    expect(
      normalizeGitHubPullUrl("https://user:ghp_secret_should_not_leak@github.com/acme/repo/pull/12?token=sk-secret#files")
    ).toBe("https://github.com/acme/repo/pull/12");
  });
});

describe("buildPullRequestInput", () => {
  it("rejects invalid PR URLs instead of producing a fallback report", async () => {
    await expect(buildPullRequestInput({ prUrl: "https://example.com/o/r/pull/1" })).rejects.toThrow(
      "GitHub pull request URL"
    );
  });

  it("surfaces live GitHub fetch failures when falling back to pasted evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("rate limit", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1893456000"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/private-repo/pull/12",
      githubToken: "ghp_secret_should_not_leak",
      prDescription: "Implemented reset validation.",
      changedFiles: "src/features/auth/PasswordResetForm.tsx"
    });

    expect(input.changedFiles).toEqual([
      { path: "src/features/auth/PasswordResetForm.tsx", status: "modified" }
    ]);
    expect(input.limitations?.join(" ")).toContain("Live GitHub evidence could not be collected");
    expect(input.limitations?.join(" ")).toContain("rate limit");
    expect(input.limitations?.join(" ")).toContain("pasted evidence only");
    expect(JSON.stringify(input)).not.toContain("ghp_secret_should_not_leak");
  });

  it("strips userinfo, query, and hash from pasted fallback PR source URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("rate limit", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://user:ghp_secret_should_not_leak@github.com/acme/private-repo/pull/12?token=sk-secret#files",
      changedFiles: "src/features/auth/PasswordResetForm.tsx"
    });

    expect(input.url).toBe("https://github.com/acme/private-repo/pull/12");
    expect(input.title).toBe("PR analysis for https://github.com/acme/private-repo/pull/12");
    expect(JSON.stringify(input)).not.toContain("ghp_secret_should_not_leak");
    expect(JSON.stringify(input)).not.toContain("sk-secret");
    expect(JSON.stringify(input)).not.toContain("#files");
  });

  it("classifies private or missing PR failures when no pasted evidence is available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      buildPullRequestInput({ prUrl: "https://github.com/acme/private-repo/pull/12" })
    ).rejects.toThrow("not found or is not visible");
  });

  it("classifies 429 rate-limit fallback without leaking token values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("too many requests", {
        status: 429,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1893456000"
        }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/private-repo/pull/12",
      githubToken: "github_pat_secret_should_not_leak",
      changedFiles: "src/features/auth/PasswordResetForm.tsx"
    });

    expect(input.limitations?.join(" ")).toContain("rate limit");
    expect(JSON.stringify(input)).not.toContain("github_pat_secret_should_not_leak");
  });

  it("does not send an Authorization header for public PR fetches without a token", async () => {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          title: "Example PR",
          body: "Adds validation.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          user: { login: "ai-agent" },
          base: { ref: "main", sha: baseSha },
          head: { ref: "agent/validation", sha: headSha }
        })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ total_count: 0, check_runs: [] }))
      .mockResolvedValueOnce(Response.json({ statuses: [] }))
      .mockResolvedValue(Response.json({
        base: { sha: baseSha },
        head: { sha: headSha }
      }));
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: add validation."
    });
    const firstFetchOptions = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;

    expect(input.title).toBe("Example PR");
    expect(input.requirementSourceIdentityHash).toBe("e18db433eecb9b75f83ca8b6702dec388f020188aa49b99c15f4fe206ebe722c");
    expect(firstFetchOptions?.headers?.Authorization).toBeUndefined();
    expect(input.sourceProvenance?.changedFileInventory).toEqual({
      version: 1,
      completeness: "complete",
      headSha
    });
  });

  it.each([
    { anchor: "head" as const, finalHeadSha: "changed123", finalBaseSha: "def456" },
    { anchor: "base" as const, finalHeadSha: "abc123", finalBaseSha: "changed456" }
  ])("fails closed when the PR $anchor anchor drifts during collection", async ({
    anchor,
    finalHeadSha,
    finalBaseSha
  }) => {
    let pullReads = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        pullReads += 1;
        return Promise.resolve(Response.json({
          title: "Drifting PR",
          body: "Implemented validation.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          base: { ref: "main", sha: pullReads === 1 ? "def456" : finalBaseSha },
          head: { ref: "agent/validation", sha: pullReads === 1 ? "abc123" : finalHeadSha }
        }));
      }
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      changedFiles: "src/fallback-should-not-be-used.ts"
    })).rejects.toThrow(`GitHub pull request ${anchor} changed`);
  });

  it("fails closed instead of falling back when the PR source body drifts during collection", async () => {
    let pullReads = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        pullReads += 1;
        return Promise.resolve(Response.json({
          title: "Source snapshot PR",
          body: pullReads === 1 ? "Document the reset behavior." : "Document a different reset behavior.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          base: { ref: "main", sha: "def456" },
          head: { ref: "agent/source-snapshot", sha: "abc123" }
        }));
      }
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      changedFiles: "src/fallback-should-not-be-used.ts"
    })).rejects.toThrow("GitHub pull request source changed while AgentProof was collecting evidence.");
  });

  it("fails closed when the selected linked Issue source drifts during collection", async () => {
    let issueReads = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(Response.json({
          title: "Fix expired reset links",
          body: "Fixes #42",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          base: { ref: "main", sha: "def456" },
          head: { ref: "agent/reset", sha: "abc123" }
        }));
      }
      if (url.endsWith("/issues/42")) {
        issueReads += 1;
        return Promise.resolve(Response.json({
          title: "Reject expired password reset links",
          body: issueReads === 1
            ? "Acceptance criteria: reject expired reset links."
            : "Acceptance criteria: reject reset links after a different expiry window."
        }));
      }
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12"
    })).rejects.toThrow("GitHub pull request source changed while AgentProof was collecting evidence.");
  });

  it("redacts token-looking values from GitHub check and status summaries", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Redacted metadata PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "unit tests",
              status: "completed",
              conclusion: "success",
              output: {
                summary: "Tests passed with token=github_pat_secret_should_not_leak"
              }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({
          statuses: [
            {
              context: "legacy unit tests",
              state: "success",
              description: "legacy CI passed with Authorization: Bearer sk-should_not_leak"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      githubToken: "github_pat_request_token_should_not_leak"
    });
    const serialized = JSON.stringify(input);

    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("github_pat_request_token_should_not_leak");
    expect(serialized).not.toContain("sk-should_not_leak");
    expect(serialized).toContain("[redacted]");
  });

  it("uses a single supported linked issue as the requirement source", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Fix expired reset links",
            body: "Fixes #42",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "coding-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/reset", sha: "abc123" }
          })
        );
      }

      if (url.endsWith("/issues/42")) {
        return Promise.resolve(
          Response.json({
            title: "Reject expired password reset links",
            body: "Acceptance criteria:\n- Reject expired reset links.\n- Add regression coverage."
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/check-runs")) {
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.taskSource).toBe("issue");
    expect(input.requirementSourceIdentityHash).toBe("ae85626be4db3b2a46ca6dc258a047f4098c84fb27214c829740086bd629f23c");
    expect(input.taskText).toContain("Linked issue acme/repo#42: Reject expired password reset links");
    expect(input.taskText).toContain("Reject expired reset links");
    expect(input.description).toBe("Fixes #42");
    expect(input.limitations?.join(" ") ?? "").not.toContain("No original task text");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/issues/42"))).toBe(true);
    expect(JSON.stringify(input.requirementSourceIdentityHash)).not.toContain("42");
  });

  it("marks a compacted linked Issue source as incomplete without retaining its tail", async () => {
    const hiddenTail = "LINKED_ISSUE_SOURCE_TAIL_MUST_NOT_BE_RETAINED";
    const longBody = `${"A".repeat(5_100)}${hiddenTail}`;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(Response.json({
          title: "Long linked Issue source",
          body: "Fixes #42",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          base: { ref: "main", sha: "def456" },
          head: { ref: "agent/long-source", sha: "abc123" }
        }));
      }
      if (url.endsWith("/issues/42")) {
        return Promise.resolve(Response.json({ title: "Long source", body: longBody }));
      }
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.limitations?.join(" ")).toContain("Linked issue source text was truncated");
    expect(input.limitations?.join(" ")).toContain("cannot establish a complete objective set");
    expect(JSON.stringify(input)).not.toContain(hiddenTail);
  });

  it("collects only an authoritative contract's documentation path at the exact PR head", async () => {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const contract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "reset",
        objective: "Document the reset command.",
        criteria: [{
          id: "reset_literal",
          type: "artifact",
          label: "The reset guide contains the command.",
          paths: ["docs/reset.md"],
          artifact: { kind: "documentation_literal", literal: "Run npm test." }
        }]
      }]
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Document reset", body: "Fixes #42", url: "https://api.github.com/repos/acme/repo/pulls/12",
        user: { login: "coding-agent" }, base: { ref: "main", sha: baseSha }, head: { ref: "agent/reset", sha: headSha }
      }));
      if (url.endsWith("/issues/42")) return Promise.resolve(Response.json({
        title: "AgentProof verification contract",
        body: `\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([
        { filename: "docs/reset.md", additions: 1, deletions: 0, status: "modified", patch: "+Run npm test." }
      ]));
      if (url.includes("/commits/") && url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/contents/docs/reset.md") && url.includes(`ref=${headSha}`)) return Promise.resolve(Response.json({
        encoding: "base64", content: Buffer.from("Stop the server.\nRun npm test.", "utf8").toString("base64")
      }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.verificationCriterionEvidenceV2).toEqual({
      artifactBlobs: [{ path: "docs/reset.md", headSha, content: "Stop the server.\nRun npm test." }]
    });
    const contentUrls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/contents/"));
    expect(contentUrls).toEqual([`https://api.github.com/repos/acme/repo/contents/docs/reset.md?ref=${headSha}`]);
  });

  it("does not fetch documentation content when the selected source has no valid contract", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "No contract", body: "Fixes #42", url: "https://api.github.com/repos/acme/repo/pulls/12",
        user: { login: "coding-agent" }, base: { ref: "main", sha: "def456" }, head: { ref: "agent/reset", sha: "abc123" }
      }));
      if (url.endsWith("/issues/42")) return Promise.resolve(Response.json({ title: "Ordinary issue", body: "Document the reset command." }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.verificationCriterionEvidenceV2).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/contents/"))).toBe(false);
  });

  it.each([
    { name: "files", override: { changedFiles: "docs/pasted-reset.md" } },
    { name: "checks", override: { checks: "pasted unit tests: passed" } },
    { name: "logs", override: { logs: "pasted unit tests: passed" } }
  ])("does not retain a live documentation-literal criterion after pasted $name replace the GitHub snapshot", async ({ override }) => {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const contract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "reset",
        objective: "Document the reset command.",
        criteria: [{
          id: "reset_literal",
          type: "artifact",
          label: "The reset guide contains the command.",
          paths: ["docs/reset.md"],
          artifact: { kind: "documentation_literal", literal: "Run npm test." }
        }]
      }]
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Document reset", body: "Fixes #42", url: "https://api.github.com/repos/acme/repo/pulls/12",
        user: { login: "coding-agent" }, base: { ref: "main", sha: baseSha }, head: { ref: "agent/reset", sha: headSha }
      }));
      if (url.endsWith("/issues/42")) return Promise.resolve(Response.json({
        title: "AgentProof verification contract",
        body: `\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([
        { filename: "docs/reset.md", additions: 1, deletions: 0, status: "modified", patch: "+Run npm test." }
      ]));
      if (url.includes("/commits/") && url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/contents/docs/reset.md") && url.includes(`ref=${headSha}`)) return Promise.resolve(Response.json({
        encoding: "base64", content: Buffer.from("Stop the server.\nRun npm test.", "utf8").toString("base64")
      }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      ...override
    });
    const report = generateVerificationReportV2FromInput(input);

    expect(input.sourceProvenance?.origin).toBe("pasted_evidence");
    expect(input.verificationContractSourceV2).toBeUndefined();
    expect(input.verificationContractBindingV2).toBeUndefined();
    expect(input.verificationCriterionEvidenceV2).toBeUndefined();
    expect(report.verificationContract.objectives.flatMap((objective) => objective.criterionResults))
      .not.toContainEqual(expect.objectContaining({ state: "satisfied" }));
    expect(report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
  });

  it("changes only the opaque authority identity hash when an identical linked Issue is relinked", async () => {
    let linkedNumber = 1;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Same content relink",
        body: `Fixes #${linkedNumber}`,
        url: "https://api.github.com/repos/acme/repo/pulls/12",
        user: { login: "coding-agent" },
        base: { ref: "main", sha: "b".repeat(40) },
        head: { ref: "agent/relink", sha: "a".repeat(40) }
      }));
      if (/\/issues\/[12]$/.test(url)) return Promise.resolve(Response.json({
        title: "Identical issue",
        body: "Acceptance criteria:\n- Preserve identity fencing."
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const issueOne = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    linkedNumber = 2;
    const issueTwo = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(issueOne.taskText.replace("#1", "#2")).toBe(issueTwo.taskText);
    expect(issueOne.requirementSourceIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issueTwo.requirementSourceIdentityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issueOne.requirementSourceIdentityHash).not.toBe(issueTwo.requirementSourceIdentityHash);
    expect(JSON.stringify({ issueOne, issueTwo })).not.toContain("github_issue:");
  });

  it("keeps pasted task text ahead of linked issue text", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Fix expired reset links",
            body: "Fixes #42",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "coding-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/reset", sha: "abc123" }
          })
        );
      }

      if (url.endsWith("/issues/42")) {
        return Promise.resolve(
          Response.json({
            title: "Issue title should not override pasted task",
            body: "Acceptance criteria: do something else."
          })
        );
      }

      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: preserve the pasted task."
    });

    expect(input.taskSource).toBe("task");
    expect(input.taskText).toBe("Acceptance criteria: preserve the pasted task.");
    expect(JSON.stringify(input)).not.toContain("Issue title should not override pasted task");
  });

  it("does not choose a requirement source when multiple issue refs are ambiguous", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Ambiguous linked work",
            body: "Fixes #1. Closes #2. Resolves owner/other#3. docs/site#4.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "coding-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/ambiguous", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const limitations = input.limitations?.join(" ") ?? "";

    expect(input.taskText).toBe("");
    expect(input.taskSource).toBeUndefined();
    expect(input.requirementSourceIdentityHash).toBe("23acfef206191405faa4cd9977e412f0a3f3c4f8a07110a4887c073d9531c2aa");
    expect(limitations).toContain("Multiple supported issue references found");
    expect(limitations).toContain("acme/repo#1, acme/repo#2, owner/other#3");
    expect(limitations).toContain("capped at 3");
    expect(limitations).toContain("ambiguous");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/issues/"))).toBe(false);
  });

  it("keeps inaccessible linked issues as limitations instead of verified task evidence", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Fix expired reset links",
            body: "Fixes #42",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "coding-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/reset", sha: "abc123" }
          })
        );
      }

      if (url.endsWith("/issues/42")) {
        return Promise.resolve(new Response("not found with github_pat_secret_should_not_leak", { status: 404 }));
      }

      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      githubToken: "github_pat_secret_should_not_leak"
    });
    const serialized = JSON.stringify(input);

    expect(input.taskText).toBe("");
    expect(input.taskSource).toBeUndefined();
    expect(input.limitations?.join(" ")).toContain("Linked issue acme/repo#42 could not be fetched");
    expect(input.limitations?.join(" ")).toContain("Original requirement remains unavailable");
    expect(input.limitations?.join(" ")).toContain("PR description is author context only");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("not found with");
  });

  it("records bounded GitHub evidence timing phases without source details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          title: "Timed PR",
          body: "Adds validation.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          user: { login: "ai-agent" },
          base: { ref: "main", sha: "def456" },
          head: { ref: "agent/validation", sha: "abc123" }
        })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ total_count: 0, check_runs: [] }))
      .mockResolvedValueOnce(Response.json({ statuses: [] }))
      .mockResolvedValue(Response.json({
        base: { sha: "def456" },
        head: { sha: "abc123" }
      }));
    const records: Array<{ phase: GitHubEvidenceTimingPhase; durationMs: number }> = [];
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput(
      {
        prUrl: "https://github.com/acme/repo/pull/12",
        githubToken: "github_pat_secret_should_not_leak",
        taskText: "Acceptance criteria: add validation."
      },
      {
        record(phase, durationMs) {
          records.push({ phase, durationMs });
        }
      }
    );

    expect(input.title).toBe("Timed PR");
    expect(new Set(records.map((item) => item.phase))).toEqual(new Set(GITHUB_EVIDENCE_TIMING_PHASES));
    expect(records).toHaveLength(GITHUB_EVIDENCE_TIMING_PHASES.length);
    expect(records.every((item) => Number.isFinite(item.durationMs) && item.durationMs >= 0)).toBe(true);
    expect(JSON.stringify(records)).not.toContain("github_pat_secret_should_not_leak");
    expect(JSON.stringify(records)).not.toContain("acme/repo");
    expect(JSON.stringify(records)).not.toContain("validation");
  });

  it("does not let GitHub evidence timing sink failures change evidence collection", async () => {
    const successFetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          title: "Sink-safe PR",
          body: "Adds validation.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          user: { login: "ai-agent" },
          base: { ref: "main", sha: "def456" },
          head: { ref: "agent/validation", sha: "abc123" }
        })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ total_count: 0, check_runs: [] }))
      .mockResolvedValueOnce(Response.json({ statuses: [] }))
      .mockResolvedValue(Response.json({
        base: { sha: "def456" },
        head: { sha: "abc123" }
      }));
    const throwingSink = {
      record() {
        throw new Error("timing sink exploded");
      }
    };
    vi.stubGlobal("fetch", successFetchMock);

    await expect(
      buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" }, throwingSink)
    ).resolves.toEqual(expect.objectContaining({ title: "Sink-safe PR" }));

    const failureFetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", failureFetchMock);

    await expect(
      buildPullRequestInput({ prUrl: "https://github.com/acme/private-repo/pull/99" }, throwingSink)
    ).rejects.toThrow("not found or is not visible");
    await expect(
      buildPullRequestInput({ prUrl: "https://github.com/acme/private-repo/pull/99" }, throwingSink)
    ).rejects.not.toThrow("timing sink exploded");
  });

  it("uses bounded phase-specific timeouts for GitHub evidence fetches", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Timeout budget PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 1234,
              name: "unit tests",
              status: "completed",
              conclusion: "failure",
              details_url: "https://github.com/acme/repo/actions/runs/456/job/999",
              output: { summary: "Vitest failed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/1234/annotations")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/actions/runs/456/jobs")) {
        return Promise.resolve(Response.json({ jobs: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual(expect.arrayContaining([
      8000,
      5000,
      2500,
      2000
    ]));
    expect(timeoutSpy.mock.calls.filter(([timeoutMs]) => timeoutMs === 2500)).toHaveLength(3);
  });

  it("keeps primary check-run evidence when annotation and Actions job metadata time out", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Timed-out enrichment PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 1234,
              name: "unit tests",
              status: "completed",
              conclusion: "failure",
              details_url: "https://github.com/acme/repo/actions/runs/456/job/999",
              output: { summary: "Vitest failed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/1234/annotations") || url.includes("/actions/runs/456/jobs")) {
        return Promise.reject(new Error("timed out with secret=sk-should_not_leak"));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const serialized = JSON.stringify(input);

    expect(input.checks).toEqual([
      expect.objectContaining({
        name: "unit tests",
        status: "failed",
        summary: "Vitest failed."
      })
    ]);
    expect(input.logs).toEqual([]);
    expect(input.limitations?.join(" ")).toContain("GitHub check annotation metadata unavailable: request timed out after 2500 ms or network failed.");
    expect(input.limitations?.join(" ")).toContain("GitHub Actions job-step metadata unavailable: request timed out after 2500 ms or network failed.");
    expect(serialized).not.toContain("sk-should_not_leak");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/456/logs"))).toBe(false);
  });

  it("keeps legacy commit-status fallback when check-run evidence times out", async () => {
    const records: Array<{ phase: GitHubEvidenceTimingPhase; durationMs: number }> = [];
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Check-run timeout PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.reject(new Error("timed out"));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({
          statuses: [
            {
              context: "legacy unit tests",
              state: "failure",
              description: "legacy unit tests failed"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput(
      {
        prUrl: "https://github.com/acme/repo/pull/12",
        githubToken: "github_pat_secret_should_not_leak"
      },
      {
        record(phase, durationMs) {
          records.push({ phase, durationMs });
        }
      }
    );
    const serialized = JSON.stringify(input);

    expect(input.checks).toEqual([
      expect.objectContaining({ name: "legacy unit tests", status: "failed" })
    ]);
    expect(input.limitations?.join(" ")).toContain("GitHub check-run evidence unavailable: request timed out after 5000 ms or network failed.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/status"))).toBe(true);
    expect(records.some((item) => item.phase === "github_checks" && item.durationMs >= 0)).toBe(true);
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
  });

  it("bounds check-run page size to the internal evidence cap", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Bounded check-run page PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 100,
          check_runs: Array.from({ length: 60 }, (_, index) => ({
            name: `preview deployment ${index + 1}`,
            status: "completed",
            conclusion: "success",
            output: { summary: "Preview deployment completed." }
          }))
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const checkRunUrl = String(fetchMock.mock.calls.find(([url]) => String(url).includes("/check-runs"))?.[0] ?? "");

    expect(checkRunUrl).toContain("per_page=100");
    expect(checkRunUrl).toContain("page=1");
    expect(input.checks).toHaveLength(60);
    expect(input.limitations?.join(" ")).toContain("GitHub check-run evidence was capped at 60 checks.");
  });

  it("does not report check-run evidence as capped when total count equals the internal cap", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Exact check-run cap PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 60,
          check_runs: Array.from({ length: 60 }, (_, index) => ({
            name: `preview deployment ${index + 1}`,
            status: "completed",
            conclusion: "success",
            output: { summary: "Preview deployment completed." }
          }))
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.checks).toHaveLength(60);
    expect(input.limitations?.join(" ")).not.toContain("GitHub check-run evidence was capped at 60 checks.");
  });

  it("keeps changed-file pagination offsets stable while capping collected evidence", async () => {
    const allFiles = Array.from({ length: 150 }, (_, index) => ({
      filename: `src/generated/file-${index + 1}.ts`,
      additions: 1,
      deletions: 0,
      status: "modified",
      patch: "+ export const value = true"
    }));
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Bounded file page PR",
            body: "Adds generated files.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/generated", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        const parsedUrl = new URL(url);
        const perPage = Number(parsedUrl.searchParams.get("per_page"));
        const page = Number(parsedUrl.searchParams.get("page"));
        const startIndex = (page - 1) * perPage;

        return Promise.resolve(Response.json(allFiles.slice(startIndex, startIndex + perPage)));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const fileUrls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("/files?"));

    expect(fileUrls).toEqual([
      "https://api.github.com/repos/acme/repo/pulls/12/files?per_page=100&page=1",
      "https://api.github.com/repos/acme/repo/pulls/12/files?per_page=100&page=2"
    ]);
    expect(input.changedFiles).toHaveLength(120);
    expect(new Set(input.changedFiles.map((file) => file.path)).size).toBe(120);
    expect(input.changedFiles.at(99)?.path).toBe("src/generated/file-100.ts");
    expect(input.changedFiles.at(100)?.path).toBe("src/generated/file-101.ts");
    expect(input.changedFiles.at(119)?.path).toBe("src/generated/file-120.ts");
    expect(input.limitations?.join(" ")).toContain("GitHub changed-file evidence was capped at 120 files.");
    expect(input.sourceProvenance?.changedFileInventory?.completeness).toBe("incomplete");
  });

  it("keeps legacy commit statuses when execution check-run evidence is available", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Check-run covered PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "unit tests",
              status: "completed",
              conclusion: "success",
              output: { summary: "pnpm test passed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({
          statuses: [
            {
              context: "legacy e2e tests",
              state: "failure",
              description: "legacy e2e failed"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: add validation with tests."
    });

    expect(input.checks).toEqual([
      expect.objectContaining({ name: "unit tests", status: "passed" }),
      expect.objectContaining({ name: "legacy e2e tests", status: "failed" })
    ]);
    expect(input.limitations?.join(" ")).not.toContain("legacy commit-status evidence was skipped");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/status"))).toBe(true);
  });

  it("does not let pending check-runs suppress completed legacy commit statuses", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Pending check-run PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "unit tests",
              status: "in_progress",
              conclusion: null,
              output: { summary: "pnpm test is still running." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({
          statuses: [
            {
              context: "legacy unit tests",
              state: "failure",
              description: "legacy unit tests failed"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: add validation with tests."
    });

    expect(input.checks).toEqual([
      expect.objectContaining({ name: "unit tests", status: "pending" }),
      expect.objectContaining({ name: "legacy unit tests", status: "failed" })
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/status"))).toBe(true);
  });

  it("keeps legacy commit statuses as fallback when execution check-runs are absent", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Legacy status PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({
          statuses: [
            {
              context: "legacy unit tests",
              state: "success",
              description: "legacy CI passed"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: add validation with tests."
    });

    expect(input.checks).toEqual([
      expect.objectContaining({ name: "legacy unit tests", status: "passed" })
    ]);
    expect(input.limitations?.join(" ")).not.toContain("legacy commit-status evidence was skipped");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/status"))).toBe(true);
  });

  it("keeps pasted historical passing text as unknown status", async () => {
    const input = await buildPullRequestInput({
      prDescription: "Added invoice export.",
      changedFiles: "src/billing/invoiceExport.ts\nsrc/billing/invoiceExport.test.ts",
      checks: "unit tests: passed on a previous branch, but current status is unknown",
      logs: "unit tests passed on a previous branch; current status is unknown"
    });

    expect(input.checks[0]?.status).toBe("unknown");
    expect(input.logs[0]?.status).toBe("unknown");
  });

  it("parses explicit pasted current status lines", async () => {
    const input = await buildPullRequestInput({
      prDescription: "Added invoice export.",
      changedFiles: "src/billing/invoiceExport.ts",
      checks: "unit tests: passed\nbuild status: failed",
      logs: "result: passed\nunit tests completed"
    });

    expect(input.checks.map((check) => check.status)).toEqual(["passed", "failed"]);
    expect(input.logs[0]?.status).toBe("passed");
  });

  it("collects bounded GitHub Actions job-step metadata for execution check runs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "CI metadata PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "unit tests",
              status: "completed",
              conclusion: "success",
              steps: [
                { name: "checkout", status: "completed", conclusion: "success" },
                { name: "pnpm test", status: "completed", conclusion: "success" },
                { name: "pnpm build", status: "completed", conclusion: "success" }
              ]
            },
            {
              name: "docs preview",
              status: "completed",
              conclusion: "success",
              steps: [{ name: "upload preview", status: "completed", conclusion: "success" }]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: add validation and tests."
    });

    expect(input.logs).toEqual([
      expect.objectContaining({
        source: "GitHub Actions job: unit tests",
        status: "passed",
        text: expect.stringContaining("pnpm test: passed")
      })
    ]);
    expect(input.logs[0]?.text).toContain("pnpm build: passed");
    expect(input.logs[0]?.text).not.toContain("checkout");
    expect(input.logs[0]?.url).toBeUndefined();
    expect(input.logs[0]?.text).not.toContain("docs preview");
    expect(input.limitations?.join(" ")).toContain("raw log archives were not fetched or stored");
  });

  it("records a changed test as verified generic-suite coverage for an unfiltered runner", async () => {
    const headSha = "a".repeat(40);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(Response.json({
          title: "Search empty state",
          body: "Adds search behavior.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          user: { login: "ai-agent" },
          base: { ref: "main", sha: "b".repeat(40) },
          head: { ref: "agent/search", sha: headSha }
        }));
      }
      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([
          { filename: "test/repository-search.test.js", status: "added", additions: 12, deletions: 0, patch: "+ test('empty state', () => {})" }
        ]));
      }
      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [{
            name: "unit-tests",
            status: "completed",
            conclusion: "success",
            details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
          }]
        }));
      }
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({ jobs: [{
          name: "unit-tests",
          status: "completed",
          conclusion: "success",
          steps: [{ name: "Run node --test", status: "completed", conclusion: "success" }]
        }] }));
      }
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.executionSuites).toEqual([{
      headSha,
      status: "passed",
      executionSource: "GitHub Actions job: unit-tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: ["test/repository-search.test.js"]
    }]);
    expect(input.sourceProvenance?.executionSuites).toEqual(input.executionSuites);
    expect(input.limitations?.join(" ")).toContain("linked a passing generic test suite to changed test artifacts");
    expect(input.limitations?.join(" ")).not.toContain("success remains an unverified observation");
  });

  it("downgrades live provenance and execution authority when pasted changed files replace the GitHub inventory", async () => {
    const headSha = "a".repeat(40);
    const moduleSource = "export function repositoryName(value) { return String(value).toLowerCase(); }";
    const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(moduleSource, "utf8")}\0`).update(moduleSource).digest("hex");
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Live inventory",
        body: "Adds a test.",
        url: "https://api.github.com/repos/acme/repo/pulls/12",
        base: { ref: "main", sha: "b".repeat(40) },
        head: { ref: "agent/inventory", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{
        filename: "test/repository-name-regression.test.js",
        status: "added",
        additions: 2,
        deletions: 0,
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+test('live', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
        ].join("\n")
      }]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({
        total_count: 1,
        check_runs: [{
          name: "unit-tests",
          status: "completed",
          conclusion: "success",
          details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
        }]
      }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/actions/runs/123456/jobs")) return Promise.resolve(Response.json({ jobs: [{
        name: "unit-tests",
        status: "completed",
        conclusion: "success",
        steps: [{ name: "Run node --test", status: "completed", conclusion: "success" }]
      }] }));
      if (url.includes("/contents/src/repositories/name.js?ref=")) return Promise.resolve(Response.json({
        type: "file",
        path: "src/repositories/name.js",
        sha: blobSha,
        encoding: "base64",
        content: Buffer.from(moduleSource).toString("base64")
      }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      changedFiles: "test/pasted.test.js"
    });

    expect(input.sourceProvenance?.origin).toBe("pasted_evidence");
    expect(input.sourceProvenance?.inputFingerprint.coverage).toBe("pasted_metadata");
    expect(input.sourceProvenance?.changedFileInventory?.completeness).not.toBe("complete");
    expect(input.sourceProvenance?.executionSuites).toBeUndefined();
    expect(input.executionSuites).toBeUndefined();
    expect(input.resolvedHeadModules).toBeUndefined();
  });

  it("removes live execution suites when pasted checks replace GitHub checks", async () => {
    const headSha = "c".repeat(40);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Live checks",
        body: "Adds a test.",
        url: "https://api.github.com/repos/acme/repo/pulls/12",
        base: { ref: "main", sha: "d".repeat(40) },
        head: { ref: "agent/checks", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{
        filename: "test/live.test.js",
        status: "added",
        additions: 1,
        deletions: 0,
        patch: "+ test('live', () => {})"
      }]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({
        total_count: 1,
        check_runs: [{
          name: "unit-tests",
          status: "completed",
          conclusion: "success",
          details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
        }]
      }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/actions/runs/123456/jobs")) return Promise.resolve(Response.json({ jobs: [{
        name: "unit-tests",
        status: "completed",
        conclusion: "success",
        steps: [{ name: "Run node --test", status: "completed", conclusion: "success" }]
      }] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      checks: "pasted unit tests: passed"
    });

    expect(input.sourceProvenance?.origin).toBe("pasted_evidence");
    expect(input.sourceProvenance?.inputFingerprint.coverage).toBe("pasted_metadata");
    expect(input.sourceProvenance?.executionSuites).toBeUndefined();
    expect(input.executionSuites).toBeUndefined();
    expect(input.resolvedHeadModules).toBeUndefined();
  });

  it("collects one bounded unchanged module only after a direct changed-test target is selected", async () => {
    const headSha = "6".repeat(40);
    const baseSha = "5".repeat(40);
    const source = "export function repositoryName(value) { return String(value).toLowerCase(); } // transient-source-marker";
    const blobSha = createHash("sha1").update(`blob ${Buffer.byteLength(source, "utf8")}\0`).update(source).digest("hex");
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Repository name regression",
        body: "Adds focused regression coverage.",
        url: "https://api.github.com/repos/acme/repo/pulls/12",
        user: { login: "ai-agent" },
        base: { ref: "main", sha: baseSha },
        head: { ref: "agent/name-test", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{
        filename: "test/repository-name-regression.test.js",
        status: "added",
        additions: 3,
        deletions: 0,
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+test('formats names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
        ].join("\n")
      }]));
      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      }
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/contents/src/repositories/name.js?ref=")) return Promise.resolve(Response.json({
        type: "file",
        path: "src/repositories/name.js",
        sha: blobSha,
        encoding: "base64",
        content: Buffer.from(source).toString("base64")
      }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.resolvedHeadModules).toEqual([{
      version: 1,
      kind: "resolved_head_module",
      headSha,
      path: "src/repositories/name.js",
      blobSha,
      source
    }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/contents/")).length).toBe(1);
    expect(String(fetchMock.mock.calls.find(([url]) => String(url).includes("/contents/"))?.[0])).toContain(`ref=${headSha}`);
    expect(JSON.stringify(input.sourceProvenance)).not.toContain("transient-source-marker");
    expect(JSON.stringify(input.sourceProvenance)).not.toContain("src/repositories/name.js");
  });

  it("does not fetch an unchanged module when a changed test asserts ambiguous direct targets", async () => {
    const headSha = "3".repeat(40);
    const baseSha = "2".repeat(40);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Ambiguous regression",
        body: "Adds regression coverage.",
        url: "https://api.github.com/repos/acme/repo/pulls/12",
        base: { ref: "main", sha: baseSha },
        head: { ref: "agent/name-test", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{
        filename: "test/repository-name-regression.test.js",
        status: "added",
        additions: 4,
        deletions: 0,
        patch: [
          "+import assert from 'node:assert/strict';",
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+import { legacyName } from '../src/repositories/legacy-name.js';",
          "+test('formats names', () => { assert.equal(repositoryName('AgentProof'), legacyName('AgentProof')); });"
        ].join("\n")
      }]));
      if (url.includes("/commits/") && url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.resolvedHeadModules).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/contents/"))).toBe(false);
  });

  it("does not fetch an unchanged module when a second changed test file has no surviving target", async () => {
    const headSha = "1".repeat(40);
    const baseSha = "0".repeat(40);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Two changed tests",
        body: "Adds regression coverage.",
        url: "https://api.github.com/repos/acme/repo/pulls/12",
        base: { ref: "main", sha: baseSha },
        head: { ref: "agent/name-tests", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([
        {
          filename: "test/repository-name-regression.test.js",
          status: "added",
          additions: 2,
          deletions: 0,
          patch: [
            "+import { repositoryName } from '../src/repositories/name.js';",
            "+test('formats names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
          ].join("\n")
        },
        {
          filename: "test/unrelated-regression.test.js",
          status: "added",
          additions: 1,
          deletions: 0,
          patch: "+test('unrelated', () => { expect(true).toBe(true); });"
        }
      ]));
      if (url.includes("/commits/") && url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.resolvedHeadModules).toBeUndefined();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/contents/"))).toBe(false);
  });

  it("resolves npm test only when the head package script is an unfiltered supported runner", async () => {
    const headSha = "d".repeat(40);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(Response.json({
          title: "Search empty state",
          body: "Adds search behavior.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          user: { login: "ai-agent" },
          base: { ref: "main", sha: "b".repeat(40) },
          head: { ref: "agent/search", sha: headSha }
        }));
      }
      if (url.includes("/files?")) return Promise.resolve(Response.json([
        { filename: "test/repository-search.test.js", status: "added", additions: 12, deletions: 0 }
      ]));
      if (url.includes("/commits/") && url.includes("/check-runs")) return Promise.resolve(Response.json({
        total_count: 1,
        check_runs: [{ name: "unit-tests", status: "completed", conclusion: "success", details_url: "https://github.com/acme/repo/actions/runs/123456/job/999" }]
      }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/actions/runs/123456/jobs")) return Promise.resolve(Response.json({ jobs: [{
        name: "unit-tests", status: "completed", conclusion: "success",
        steps: [{ name: "Run npm test", status: "completed", conclusion: "success" }]
      }] }));
      if (url.includes("/contents/package.json?ref=")) return Promise.resolve(Response.json({
        encoding: "base64",
        content: Buffer.from(JSON.stringify({ scripts: { test: "node --test" } })).toString("base64")
      }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.executionSuites?.[0]).toMatchObject({ headSha, runner: "node_test", scope: "repository_discovery" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/contents/package.json?ref="))).toBe(true);
    expect(JSON.stringify(input)).not.toContain('"scripts"');
  });

  it("does not link a generic npm test job when the resolved script filters to a path", async () => {
    const headSha = "e".repeat(40);
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) return Promise.resolve(Response.json({
        title: "Filtered tests", body: "Adds tests.", url: "https://api.github.com/repos/acme/repo/pulls/12",
        user: { login: "ai-agent" }, base: { ref: "main", sha: "b".repeat(40) }, head: { ref: "agent/tests", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{ filename: "test/repository-search.test.js", status: "added", additions: 4, deletions: 0 }]));
      if (url.includes("/commits/") && url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 1, check_runs: [{ name: "unit-tests", status: "completed", conclusion: "success", details_url: "https://github.com/acme/repo/actions/runs/123456/job/999" }] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/actions/runs/123456/jobs")) return Promise.resolve(Response.json({ jobs: [{ name: "unit-tests", status: "completed", conclusion: "success", steps: [{ name: "Run npm test", status: "completed", conclusion: "success" }] }] }));
      if (url.includes("/contents/package.json?ref=")) return Promise.resolve(Response.json({ encoding: "base64", content: Buffer.from(JSON.stringify({ scripts: { test: "node --test test/other.test.js" } })).toString("base64") }));
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.executionSuites).toEqual([]);
  });

  it("fetches Actions job metadata for multiple workflow runs concurrently", async () => {
    let activeJobFetches = 0;
    let maxActiveJobFetches = 0;
    const jobFetchResolvers = new Map<number, () => void>();
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Parallel job metadata PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 3,
          check_runs: [1, 2, 3].map((runId) => ({
            name: `unit tests ${runId}`,
            status: "completed",
            conclusion: "success",
            details_url: `https://github.com/acme/repo/actions/runs/${runId}/job/999`
          }))
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/")) {
        const runId = Number(url.match(/actions\/runs\/(\d+)/)?.[1] ?? 0);
        activeJobFetches += 1;
        maxActiveJobFetches = Math.max(maxActiveJobFetches, activeJobFetches);

        return new Promise<Response>((resolve) => {
          const complete = () => {
            activeJobFetches -= 1;
            resolve(Response.json({
              jobs: [
                {
                  name: `unit tests ${runId}`,
                  status: "completed",
                  conclusion: "success",
                  steps: [{ name: "pnpm test", status: "completed", conclusion: "success" }]
                }
              ]
            }));
          };

          jobFetchResolvers.set(runId, complete);

          if (jobFetchResolvers.size === 3) {
            jobFetchResolvers.get(3)?.();
            jobFetchResolvers.get(2)?.();
            jobFetchResolvers.get(1)?.();
          }
        });
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(maxActiveJobFetches).toBeGreaterThan(1);
    expect(input.logs.map((log) => log.source)).toEqual([
      "GitHub Actions job: unit tests 1",
      "GitHub Actions job: unit tests 2",
      "GitHub Actions job: unit tests 3"
    ]);
    expect(input.limitations?.join(" ")).toContain("raw log archives were not fetched or stored");
  });

  it("fetches annotation and Actions job enrichment concurrently with stable limitation order", async () => {
    let activeEnrichmentFetches = 0;
    let maxActiveEnrichmentFetches = 0;
    const enrichmentResolvers = new Map<string, () => void>();
    const releaseEnrichmentFetches = () => {
      if (enrichmentResolvers.size === 2) {
        enrichmentResolvers.get("jobs")?.();
        enrichmentResolvers.get("annotations")?.();
      }
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Parallel enrichment PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 1234,
              name: "unit tests",
              status: "completed",
              conclusion: "failure",
              details_url: "https://github.com/acme/repo/actions/runs/456/job/999",
              output: { summary: "Vitest failed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/1234/annotations")) {
        activeEnrichmentFetches += 1;
        maxActiveEnrichmentFetches = Math.max(maxActiveEnrichmentFetches, activeEnrichmentFetches);

        return new Promise<Response>((resolve) => {
          enrichmentResolvers.set("annotations", () => {
            activeEnrichmentFetches -= 1;
            resolve(Response.json([
              {
                path: "src/app/api/analyze/route.test.ts",
                start_line: 42,
                annotation_level: "failure",
                raw_details: "secret=sk-should_not_leak"
              }
            ]));
          });
          releaseEnrichmentFetches();
        });
      }

      if (url.includes("/actions/runs/456/jobs")) {
        activeEnrichmentFetches += 1;
        maxActiveEnrichmentFetches = Math.max(maxActiveEnrichmentFetches, activeEnrichmentFetches);

        return new Promise<Response>((resolve) => {
          enrichmentResolvers.set("jobs", () => {
            activeEnrichmentFetches -= 1;
            resolve(Response.json({
              jobs: [
                {
                  name: "unit tests",
                  status: "completed",
                  conclusion: "failure",
                  steps: [{ name: "pnpm test", status: "completed", conclusion: "failure" }]
                }
              ]
            }));
          });
          releaseEnrichmentFetches();
        });
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const annotationLimitationIndex = input.limitations?.findIndex((item) => item.includes("check annotation metadata was collected")) ?? -1;
    const jobLimitationIndex = input.limitations?.findIndex((item) => item.includes("Public GitHub Actions metadata showed failing build/test jobs")) ?? -1;

    expect(maxActiveEnrichmentFetches).toBeGreaterThan(1);
    expect(input.checks[0]?.summary).toContain("failure at src/app/api/analyze/route.test.ts:42");
    expect(input.logs[0]?.text).toContain("pnpm test: failed");
    expect(annotationLimitationIndex).toBeGreaterThanOrEqual(0);
    expect(jobLimitationIndex).toBeGreaterThan(annotationLimitationIndex);
    expect(JSON.stringify(input)).not.toContain("sk-should_not_leak");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/456/logs"))).toBe(false);
  });

  it("does not keep Actions job metadata when generic CI jobs only contain preview steps", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Preview summary PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999",
              output: {
                summary: "Vercel Preview tests passed after deployment."
              }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              steps: [
                { name: "Deploy preview", status: "completed", conclusion: "success" },
                { name: "Upload test report", status: "completed", conclusion: "success" }
              ]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/123456/jobs"))).toBe(true);
  });

  it("keeps only execution-like Actions steps for generic CI jobs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "CI step PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/acme/repo/actions/runs/123456/job/999?token=ghp_secret#step",
              steps: [
                { name: "Checkout", status: "completed", conclusion: "success" },
                { name: "Upload test report", status: "completed", conclusion: "success" },
                { name: "pnpm test src/app/api/analyze/route.test.ts", status: "completed", conclusion: "success" },
                { name: "pnpm build", status: "completed", conclusion: "success" }
              ]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([
      expect.objectContaining({
        source: "GitHub Actions job: CI",
        status: "passed",
        url: "https://github.com/acme/repo/actions/runs/123456/job/999",
        text: expect.stringContaining("pnpm test src/app/api/analyze/route.test.ts: passed")
      })
    ]);
    expect(input.logs[0]?.text).toContain("pnpm build: passed");
    expect(input.logs[0]?.text).not.toContain("Checkout");
    expect(input.logs[0]?.text).not.toContain("Upload test report");
    expect(JSON.stringify(input)).not.toContain("ghp_secret");
  });

  it("collects Build&Test job metadata from a generic CI workflow check", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "CSS preload PR",
            body: "Fixes CSS preload handling.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/css-preload", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "Build&Test: node-24, ubuntu-latest",
              status: "completed",
              conclusion: "success",
              html_url: "https://github.com/acme/repo/actions/runs/123456/job/999",
              steps: [
                { name: "Checkout", status: "completed", conclusion: "success" },
                { name: "Test unit", status: "completed", conclusion: "success" },
                { name: "pnpm build", status: "completed", conclusion: "success" }
              ]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([
      expect.objectContaining({
        source: "GitHub Actions job: Build&Test: node-24, ubuntu-latest",
        status: "passed",
        text: expect.stringContaining("Test unit: passed")
      })
    ]);
    expect(input.logs[0]?.text).toContain("pnpm build: passed");
    expect(input.limitations?.join(" ")).toContain("success remains unverified");
  });

  it("collects Build&Test job metadata from generic workflow and checks check-runs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Generic workflow metadata PR",
            body: "Fixes #42.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/build-test", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/issues/42")) {
        return Promise.resolve(Response.json({ title: "Fix build test behavior", body: "Expected build and test to pass." }));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 2,
          check_runs: [
            {
              name: "workflow",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/111/job/1"
            },
            {
              name: "checks",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/222/job/2"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/111/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "Build&Test",
              status: "completed",
              conclusion: "success",
              steps: [{ name: "Test unit", status: "completed", conclusion: "success" }]
            }
          ]
        }));
      }

      if (url.includes("/actions/runs/222/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "checks",
              status: "completed",
              conclusion: "success",
              steps: [{ name: "pnpm build", status: "completed", conclusion: "success" }]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs.map((log) => log.source)).toEqual([
      "GitHub Actions job: Build&Test",
      "GitHub Actions job: checks"
    ]);
    expect(input.logs.map((log) => log.status)).toEqual(["passed", "passed"]);
    expect(input.limitations?.join(" ")).toContain("success remains unverified");
  });

  it("keeps failed execution check-runs when check-run evidence is capped", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Capped checks PR",
            body: "Fixes #42.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/capped-checks", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/issues/42")) {
        return Promise.resolve(Response.json({ title: "Fix cache behavior", body: "Expected cache accounting to be correct." }));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 65,
          check_runs: [
            ...Array.from({ length: 64 }, (_value, index) => ({
              name: `docs preview ${index}`,
              status: "completed",
              conclusion: "success",
              output: { summary: "Documentation preview passed." }
            })),
            {
              name: "Build&Test",
              status: "completed",
              conclusion: "failure",
              output: { summary: "Workflow-level Build&Test failed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.checks.some((check) => check.name === "Build&Test" && check.status === "failed")).toBe(true);
    expect(input.limitations?.join(" ")).toContain("GitHub check-run evidence was capped at 60 checks.");
  });

  it("collects tox failure from GitHub Actions job metadata", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Python tests PR",
            body: "Fixes #42.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/python-tests", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/issues/42")) {
        return Promise.resolve(Response.json({ title: "Fix pytest compatibility", body: "Expected tox tests to pass." }));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "failure",
              details_url: "https://github.com/acme/repo/actions/runs/333/job/1"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/333/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "Tests",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/acme/repo/actions/runs/333/job/1",
              steps: [{ name: "uv run tox", status: "completed", conclusion: "failure" }]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([
      expect.objectContaining({
        source: "GitHub Actions job: Tests",
        status: "failed",
        text: expect.stringContaining("uv run tox: failed")
      })
    ]);
    expect(input.limitations?.join(" ")).toContain("Public GitHub Actions metadata showed failing build/test jobs");
  });

  it("collects bounded failed check annotations without raw details or secrets", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Failed test annotation PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 1234,
              name: "unit tests",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/acme/repo/actions/runs/123456/job/999",
              output: {
                summary: "Vitest failed."
              }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/1234/annotations")) {
        return Promise.resolve(Response.json([
          {
            path: "src/app/api/analyze/route.test.ts",
            start_line: 42,
            annotation_level: "failure",
            title: "Assertion failed",
            message: "expected status 400 with token=ghp_secret_should_not_leak",
            raw_details: "raw stack trace with sk-secret_should_not_leak"
          },
          {
            path: "src/lib/verifier.test.ts",
            start_line: 77,
            annotation_level: "failure",
            message: "expected missing test evidence to include route"
          },
          {
            path: "src/ignored-1.test.ts",
            start_line: 1,
            annotation_level: "warning",
            message: "extra annotation 1"
          },
          {
            path: "src/ignored-2.test.ts",
            start_line: 2,
            annotation_level: "warning",
            message: "extra annotation 2"
          },
          {
            path: "src/ignored-3.test.ts",
            start_line: 3,
            annotation_level: "warning",
            message: "extra annotation 3"
          },
          {
            path: "src/ignored-4.test.ts",
            start_line: 4,
            annotation_level: "warning",
            message: "extra annotation 4"
          }
        ]));
      }

      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({ jobs: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const summary = input.checks[0]?.summary ?? "";
    const serialized = JSON.stringify(input);

    expect(summary).toContain("Check annotations:");
    expect(summary).toContain("failure at src/app/api/analyze/route.test.ts:42");
    expect(summary).toContain("failure at src/lib/verifier.test.ts:77");
    expect(summary).not.toContain("expected status 400");
    expect(summary).not.toContain("Assertion failed");
    expect(summary).not.toContain("extra annotation");
    expect(serialized).not.toContain("raw_details");
    expect(serialized).not.toContain("raw stack trace");
    expect(serialized).not.toContain("expected status 400");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(input.limitations?.join(" ")).toContain("check annotation metadata was collected");
    expect(input.limitations?.join(" ")).toContain("raw annotation details and raw log archives were not fetched or stored");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/123456/logs"))).toBe(false);
  });

  it("fetches failed check annotations concurrently while preserving the total annotation cap", async () => {
    let activeAnnotationFetches = 0;
    let maxActiveAnnotationFetches = 0;
    const annotationFetchResolvers = new Map<number, () => void>();
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Parallel annotation PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 3,
          check_runs: [1, 2, 3].map((checkId) => ({
            id: checkId,
            name: `unit tests ${checkId}`,
            status: "completed",
            conclusion: "failure",
            output: { summary: "Tests failed." }
          }))
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/") && url.includes("/annotations")) {
        const checkId = Number(url.match(/check-runs\/(\d+)/)?.[1] ?? 0);
        activeAnnotationFetches += 1;
        maxActiveAnnotationFetches = Math.max(maxActiveAnnotationFetches, activeAnnotationFetches);

        return new Promise<Response>((resolve) => {
          const complete = () => {
            activeAnnotationFetches -= 1;
            resolve(Response.json(Array.from({ length: 10 }, (_, index) => ({
              path: `src/check-${checkId}-${index}.test.ts`,
              start_line: index + 1,
              annotation_level: "failure"
            }))));
          };

          annotationFetchResolvers.set(checkId, complete);

          if (annotationFetchResolvers.size === 3) {
            annotationFetchResolvers.get(3)?.();
            annotationFetchResolvers.get(2)?.();
            annotationFetchResolvers.get(1)?.();
          }
        });
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const summaries = input.checks.map((check) => check.summary ?? "").join(" ");
    const annotationMatches = summaries.match(/failure at src\/check-/g) ?? [];

    expect(maxActiveAnnotationFetches).toBeGreaterThan(1);
    expect(annotationMatches).toHaveLength(20);
    expect(input.checks[0]?.summary).toContain("failure at src/check-1-0.test.ts:1");
    expect(input.checks[1]?.summary).toContain("failure at src/check-2-9.test.ts:10");
    expect(input.checks[2]?.summary).not.toContain("Check annotations:");
    expect(summaries).not.toContain("src/check-3-");
    expect(input.limitations?.join(" ")).toContain("raw annotation details and raw log archives were not fetched or stored");
  });

  it("does not fetch annotations for failed non-execution check runs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Security annotation PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 5678,
              name: "Socket Security coverage tests report",
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/acme/repo/actions/runs/123456/job/999",
              output: {
                summary: "Dependency report failed."
              }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.checks[0]?.summary).toBe("Dependency report failed.");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/check-runs/5678/annotations"))).toBe(false);
  });

  it("keeps check evidence when annotation metadata fetch fails", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Annotation failure PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 1234,
              name: "unit tests",
              status: "completed",
              conclusion: "failure",
              output: { summary: "Vitest failed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/1234/annotations")) {
        return Promise.resolve(new Response("forbidden", { status: 403 }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.checks[0]).toEqual(expect.objectContaining({
      name: "unit tests",
      status: "failed",
      summary: "Vitest failed."
    }));
    expect(input.limitations?.join(" ")).toContain("check annotation metadata fetch failed");
  });

  it("drops unsafe annotation paths before adding check summaries", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Unsafe annotation path PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              id: 1234,
              name: "unit tests",
              status: "completed",
              conclusion: "failure",
              output: { summary: "Vitest failed." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/check-runs/1234/annotations")) {
        return Promise.resolve(Response.json([
          { path: "../secret.ts", start_line: 1, annotation_level: "failure", message: "bad" },
          { path: "/tmp/secret.ts", start_line: 2, annotation_level: "failure", message: "bad" },
          { path: "https://evil.example/file.ts", start_line: 3, annotation_level: "failure", message: "bad" },
          { path: "src/safe.test.ts", start_line: 4, annotation_level: "failure", message: "ok" }
        ]));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const summary = input.checks[0]?.summary ?? "";

    expect(summary).toContain("failure at src/safe.test.ts:4");
    expect(summary).not.toContain("../secret.ts");
    expect(summary).not.toContain("/tmp/secret.ts");
    expect(summary).not.toContain("evil.example");
  });

  it("does not collect generic CI jobs with only preview or report steps", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Preview step PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      if (url.includes("/actions/runs/123456/jobs")) {
        return Promise.resolve(Response.json({
          jobs: [
            {
              name: "CI",
              status: "completed",
              conclusion: "success",
              steps: [
                { name: "Deploy preview", status: "completed", conclusion: "success" },
                { name: "Upload test report", status: "completed", conclusion: "success" }
              ]
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([]);
  });

  it("does not fetch Actions job metadata for non-execution check runs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Security report PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "Socket Security coverage tests report",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/123456/jobs"))).toBe(false);
  });

  it("keeps cancelled changelog check-runs unknown and out of Actions job metadata", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Changelog gate PR",
            body: "Fixes #42.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/changelog", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/issues/42")) {
        return Promise.resolve(Response.json({ title: "Fix schema parsing", body: "Expected parser behavior to be correct." }));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 1,
          check_runs: [
            {
              name: "Check Changelog Entry",
              status: "completed",
              conclusion: "cancelled",
              details_url: "https://github.com/acme/repo/actions/runs/123456/job/999",
              output: { summary: "Changelog validation was cancelled." }
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.checks[0]).toEqual(expect.objectContaining({
      name: "Check Changelog Entry",
      status: "unknown"
    }));
    expect(input.logs).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/123456/jobs"))).toBe(false);
    expect(input.limitations?.join(" ")).toContain("No public test/build workflow run, check, or raw CI log was available");
  });

  it("does not fetch Actions job metadata from external or cross-repo details URLs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "CI metadata PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({
          total_count: 2,
          check_runs: [
            {
              name: "unit tests",
              status: "completed",
              conclusion: "success",
              details_url: "https://evil.example/acme/repo/actions/runs/123456/job/999"
            },
            {
              name: "build",
              status: "completed",
              conclusion: "success",
              details_url: "https://github.com/other/repo/actions/runs/999999/job/111"
            }
          ]
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/123456/jobs"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/999999/jobs"))).toBe(false);
  });

  it("records capped file evidence and missing patch limitations", async () => {
    const filePage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      additions: 1,
      deletions: 0,
      status: "modified"
    }));
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Large PR",
            body: "Touches many files.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/large", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json(filePage));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });
    const limitations = input.limitations?.join(" ");

    expect(input.changedFiles).toHaveLength(120);
    expect(limitations).toContain("capped at 120 files");
    expect(limitations).toContain("did not return patch text for 120 changed file");
  });

  it("classifies subfetch permission and secondary rate-limit failures", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Subfetch failures",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(new Response("forbidden", { status: 403 }));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(new Response("secondary limit", {
          status: 403,
          headers: { "retry-after": "30" }
        }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(new Response("not found", { status: 404 }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      githubToken: "ghs_secret_should_not_leak_1234567890"
    });
    const limitations = input.limitations?.join(" ") ?? "";

    expect(limitations).toContain("provided GitHub token may lack permission");
    expect(limitations).toContain("secondary rate limit");
    expect(limitations).toContain("not found or is not visible");
    expect(JSON.stringify(input)).not.toContain("ghs_secret_should_not_leak_1234567890");
  });

  it("keeps partial live evidence when GitHub subfetches fail", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Partial PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main", sha: "def456" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.reject(new Error("network timeout github_pat_1234567890abcdef1234567890"));
      }

      if (url.includes("/commits/") && url.includes("/check-runs")) {
        return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.title).toBe("Partial PR");
    expect(input.changedFiles).toHaveLength(0);
    expect(input.limitations?.join(" ")).toContain("changed-file evidence unavailable");
    expect(input.sourceProvenance?.changedFileInventory?.completeness).toBe("incomplete");
    expect(JSON.stringify(input)).not.toContain("github_pat_1234567890abcdef1234567890");
  });

  it("attaches a complete transient workflow identity only through the exact REST join", async () => {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const checkRun = {
      id: 6101,
      name: "unit-test",
      status: "completed",
      conclusion: "failure",
      head_sha: headSha,
      check_suite: { id: 5101 },
      details_url: "https://github.com/opaque-owner/opaque-repo/actions/runs/4101/attempts/2/job/7101"
    };
    const job = {
      id: 7101,
      run_id: 4101,
      run_attempt: 2,
      head_sha: headSha,
      name: "unit-test",
      workflow_name: "Verification",
      check_run_url: "https://api.github.com/repos/opaque-owner/opaque-repo/check-runs/6101",
      status: "completed",
      conclusion: "failure",
      steps: [{ name: "Run npm test", status: "completed", conclusion: "failure" }]
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/17")) return Promise.resolve(Response.json({
        title: "Opaque replay",
        body: "Adds verification.",
        url: "https://api.github.com/repos/opaque-owner/opaque-repo/pulls/17",
        base: { ref: "main", sha: baseSha },
        head: { ref: "agent/verify", sha: headSha }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([]));
      if (url.includes(`/commits/${headSha}/check-runs`)) {
        return Promise.resolve(Response.json({ total_count: 1, check_runs: [checkRun] }));
      }
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      if (url.includes("/check-runs/6101/annotations")) return Promise.resolve(Response.json([]));
      if (url.includes("/actions/runs/4101/attempts/2/jobs")) {
        return Promise.resolve(Response.json({ total_count: 1, jobs: [job] }));
      }
      if (url.endsWith("/actions/runs/4101/attempts/2")) return Promise.resolve(Response.json({
        id: 4101,
        name: "Verification",
        path: ".github/workflows/verify.yml",
        workflow_id: 3101,
        run_attempt: 2,
        head_sha: headSha,
        check_suite_id: 5101
      }));
      if (url.includes("/actions/runs/4101/jobs")) {
        return Promise.resolve(Response.json({ jobs: [job] }));
      }
      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/opaque-owner/opaque-repo/pull/17",
      taskText: "Acceptance criteria: add the verification CI workflow."
    });

    expect(input.checks[0]?.workflowExecutionIdentity).toEqual({
      version: 1,
      kind: "workflow_execution_identity",
      workflowPath: ".github/workflows/verify.yml",
      workflowName: "Verification",
      workflowId: 3101,
      runId: 4101,
      runAttempt: 2,
      jobId: 7101,
      jobName: "unit-test",
      headSha,
      checkEvidenceRef: "ev_3"
    });
    expect(JSON.stringify(input.sourceProvenance)).not.toContain("workflowExecutionIdentity");
  });

  it.each(["missing job head", "malformed job join"])(
    "keeps an incomplete sibling Check global-only when the run also contains a complete Check: %s",
    async (fault) => {
      const headSha = "a".repeat(40);
      const baseSha = "b".repeat(40);
      const checks = [6101, 6102].map((id, index) => ({
        id,
        name: `unit-test-${index + 1}`,
        status: "completed",
        conclusion: "failure",
        head_sha: headSha,
        check_suite: { id: 5101 },
        details_url: `https://github.com/opaque-owner/opaque-repo/actions/runs/4101/attempts/2/job/${7101 + index}`
      }));
      const jobs = [6101, 6102].map((checkId, index) => ({
        id: 7101 + index,
        run_id: 4101,
        run_attempt: 2,
        head_sha: fault === "missing job head" && index === 1 ? undefined : headSha,
        name: `unit-test-${index + 1}`,
        workflow_name: "Verification",
        check_run_url: `https://api.github.com/repos/opaque-owner/opaque-repo/check-runs/${fault === "malformed job join" && index === 1 ? 9999 : checkId}`,
        status: "completed",
        conclusion: "failure",
        steps: [{ name: "Run npm test", status: "completed", conclusion: "failure" }]
      }));
      const fetchMock = vi.fn((url: string) => {
        if (url.endsWith("/pulls/17")) return Promise.resolve(Response.json({
          title: "Opaque sibling replay",
          body: "Adds verification.",
          url: "https://api.github.com/repos/opaque-owner/opaque-repo/pulls/17",
          base: { ref: "main", sha: baseSha },
          head: { ref: "agent/verify", sha: headSha }
        }));
        if (url.includes("/files?")) return Promise.resolve(Response.json([{
          filename: ".github/workflows/verify.yml",
          status: "modified",
          additions: 2,
          deletions: 0,
          patch: "+ name: Verification\n+ run: npm test"
        }]));
        if (url.includes(`/commits/${headSha}/check-runs`)) {
          return Promise.resolve(Response.json({ total_count: 2, check_runs: checks }));
        }
        if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
        if (url.includes("/annotations")) return Promise.resolve(Response.json([]));
        if (url.includes("/actions/runs/4101/attempts/2/jobs")) {
          return Promise.resolve(Response.json({ total_count: 2, jobs }));
        }
        if (url.endsWith("/actions/runs/4101/attempts/2")) return Promise.resolve(Response.json({
          id: 4101,
          name: "Verification",
          path: ".github/workflows/verify.yml",
          workflow_id: 3101,
          run_attempt: 2,
          head_sha: headSha,
          check_suite_id: 5101
        }));
        if (url.includes("/actions/runs/4101/jobs")) return Promise.resolve(Response.json({ jobs }));
        return Promise.resolve(new Response("unexpected url", { status: 500 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const input = await buildPullRequestInput({
        prUrl: "https://github.com/opaque-owner/opaque-repo/pull/17",
        taskText: [
          "Acceptance criteria:",
          "- Add the verification CI workflow.",
          "- It must configure the verification CI workflow to run npm test."
        ].join("\n")
      });
      const report = generateVerificationReportV2FromInput(input);

      expect(input.checks[0]?.workflowExecutionIdentity).toEqual(expect.objectContaining({ checkEvidenceRef: "ev_4" }));
      expect(input.checks[1]?.workflowExecutionIdentity).toBeUndefined();
      expect(input.limitations?.join(" ")).toContain("COLLECTOR_LIMITATION");
      expect(report.testing.ciStatus).toBe("failed");
      expect(report.proofGraph.failedCheckAssociations).toContainEqual(expect.objectContaining({
        checkEvidenceRef: "ev_4",
        state: "linked",
        basis: "complete_identity_match"
      }));
      expect(report.proofGraph.failedCheckAssociations).toContainEqual(expect.objectContaining({
        checkEvidenceRef: "ev_5",
        state: "unknown",
        basis: "identity_incomplete"
      }));
      expect(report.proofGraph.failedCheckAssociations).not.toContainEqual(expect.objectContaining({
        checkEvidenceRef: "ev_5",
        state: "linked"
      }));
    }
  );
});
