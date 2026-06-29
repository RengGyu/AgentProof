import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPullRequestInput, normalizeGitHubPullUrl, parseGitHubPullUrl } from "./github";

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
            base: { ref: "main" },
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

  it("does not fetch Actions job metadata when generic CI summaries only mention preview tests", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Preview summary PR",
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

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const input = await buildPullRequestInput({ prUrl: "https://github.com/acme/repo/pull/12" });

    expect(input.logs).toEqual([]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/actions/runs/123456/jobs"))).toBe(false);
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
            base: { ref: "main" },
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

  it("collects bounded failed check annotations without raw details or secrets", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/12")) {
        return Promise.resolve(
          Response.json({
            title: "Failed test annotation PR",
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
            base: { ref: "main" },
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
    expect(JSON.stringify(input)).not.toContain("github_pat_1234567890abcdef1234567890");
  });
});
