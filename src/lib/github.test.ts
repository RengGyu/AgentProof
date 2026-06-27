import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPullRequestInput, parseGitHubPullUrl } from "./github";

afterEach(() => {
  vi.unstubAllGlobals();
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          title: "Example PR",
          body: "Adds validation.",
          url: "https://api.github.com/repos/acme/repo/pulls/12",
          user: { login: "ai-agent" },
          base: { ref: "main" },
          head: { ref: "agent/validation", sha: "abc123" }
        })
      )
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json({ total_count: 0, check_runs: [] }))
      .mockResolvedValueOnce(Response.json({ statuses: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({
      prUrl: "https://github.com/acme/repo/pull/12",
      taskText: "Acceptance criteria: add validation."
    });
    const firstFetchOptions = fetchMock.mock.calls[0]?.[1] as { headers?: Record<string, string> } | undefined;

    expect(input.title).toBe("Example PR");
    expect(firstFetchOptions?.headers?.Authorization).toBeUndefined();
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
            base: { ref: "main" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/check-runs")) {
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
    expect(input.logs[0]?.text).not.toContain("docs preview");
    expect(input.limitations?.join(" ")).toContain("raw log archives were not fetched or stored");
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
            base: { ref: "main" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/check-runs")) {
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

  it("does not fetch Actions job metadata from external or cross-repo details URLs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "CI metadata PR",
            body: "Adds validation.",
            url: "https://api.github.com/repos/acme/repo/pulls/12",
            user: { login: "ai-agent" },
            base: { ref: "main" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([]));
      }

      if (url.includes("/check-runs")) {
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
            base: { ref: "main" },
            head: { ref: "agent/large", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json(filePage));
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
            base: { ref: "main" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(new Response("forbidden", { status: 403 }));
      }

      if (url.includes("/check-runs")) {
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
            base: { ref: "main" },
            head: { ref: "agent/validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.reject(new Error("network timeout github_pat_1234567890abcdef1234567890"));
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

    expect(input.title).toBe("Partial PR");
    expect(input.changedFiles).toHaveLength(0);
    expect(input.limitations?.join(" ")).toContain("changed-file evidence unavailable");
    expect(JSON.stringify(input)).not.toContain("github_pat_1234567890abcdef1234567890");
  });
});
