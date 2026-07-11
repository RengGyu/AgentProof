import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { validateVerificationReport } from "@/lib/report-validation";
import type { VerificationReport } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function expectServerTiming(response: Response, phases: string[]) {
  const header = response.headers.get("Server-Timing") ?? "";
  const fallbackHeader = response.headers.get("X-AgentProof-Timing") ?? "";
  const metrics = header.split(",").map((item) => item.trim()).filter(Boolean);
  const metricNames = metrics.map((item) => item.split(";")[0]);

  expect(fallbackHeader).toBe(header);

  for (const phase of phases) {
    expect(header).toMatch(new RegExp(`\\bap_${phase};dur=\\d+\\b`));
  }

  expect(header).toMatch(/\bap_total;dur=\d+\b/);
  expect(metricNames.every((name) => ["ap_input", "ap_evidence", "ap_report", "ap_validation", "ap_total"].includes(name))).toBe(true);
  expect(metrics.every((item) => /^ap_(input|evidence|report|validation|total);dur=\d+$/.test(item))).toBe(true);

  return header;
}

function expectGitHubEvidenceTiming(response: Response, phases: string[]) {
  const header = response.headers.get("X-AgentProof-Evidence-Timing") ?? "";
  const metrics = header.split(",").map((item) => item.trim()).filter(Boolean);
  const metricNames = metrics.map((item) => item.split(";")[0]);

  expect(header).not.toBe("");

  for (const phase of phases) {
    expect(header).toMatch(new RegExp(`\\bap_${phase};dur=\\d+\\b`));
  }

  expect(metricNames).toEqual(phases.map((phase) => `ap_${phase}`));
  expect(metrics.every((item) => /^ap_github_(pr|files|checks|statuses|annotations|jobs);dur=\d+$/.test(item))).toBe(true);

  return header;
}

function expectNoGitHubEvidenceTiming(response: Response) {
  expect(response.headers.get("X-AgentProof-Evidence-Timing")).toBeNull();
}

describe("POST /api/analyze", () => {
  it("rejects invalid PR URLs before producing a report", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: "https://example.com/org/repo/pull/1" })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expectServerTiming(response, ["input"]);
    expectNoGitHubEvidenceTiming(response);
    expect(json.error).toContain("GitHub pull request URL");
  });

  it("adds bounded server timing without exposing request evidence or tokens", async () => {
    const token = "github_pat_secret_should_not_leak_1234567890";
    const taskText = `Acceptance criteria: preserve summary-only reports with token ${token}.`;
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskText,
          prDescription: "Implemented summary-only saved reports.",
          changedFiles: "src/lib/report-share.ts\nsrc/app/api/reports/route.ts",
          checks: "unit tests: passed",
          githubToken: token
        })
      })
    );
    const json = await response.json() as { report: VerificationReport; timing?: unknown };
    const serverTiming = expectServerTiming(response, ["input", "evidence", "report", "validation"]);

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expectNoGitHubEvidenceTiming(response);
    expect(json).not.toHaveProperty("timing");
    expect(serverTiming).not.toContain(token);
    expect(serverTiming).not.toContain("summary-only reports");
    expect(JSON.stringify(json)).not.toContain(token);
  });

  it("adds server timing on malformed JSON errors without echoing the raw body", async () => {
    const rawBody = "{\"taskText\":\"token ghp_secret_should_not_leak\"";
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: rawBody
      })
    );
    const json = await response.json();
    const serverTiming = expectServerTiming(response, ["input"]);

    expect(response.status).toBe(400);
    expect(json.error).toBe("Request body must be valid JSON.");
    expectNoGitHubEvidenceTiming(response);
    expect(serverTiming).not.toContain("ghp_secret_should_not_leak");
    expect(JSON.stringify(json)).not.toContain(rawBody);
  });

  it("rejects oversized request bodies even without a content-length header", async () => {
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ logs: "x".repeat(82_000) })
      })
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expectServerTiming(response, ["input"]);
    expectNoGitHubEvidenceTiming(response);
  });

  it("does not leak token-like values from GitHub network errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream failed with github_pat_1234567890abcdef1234567890")));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: "https://github.com/acme/repo/pull/1" })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expectNoGitHubEvidenceTiming(response);
    expect(JSON.stringify(json)).not.toContain("github_pat_1234567890abcdef1234567890");
    expect(JSON.stringify(json)).not.toContain("upstream failed");
    expect(json.category).toBe("github_unavailable");
    expect(json.hint).toContain("Retry the PR URL");
  });

  it("returns bounded GitHub guidance for private or permission-blocked PRs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: "https://github.com/acme/private-repo/pull/12" })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expectNoGitHubEvidenceTiming(response);
    expect(json.category).toBe("github_access");
    expect(json.error).toContain("private or require a fine-grained token");
    expect(json.guidance).toEqual(expect.arrayContaining([
      expect.stringContaining("read access")
    ]));
    expect(JSON.stringify(json)).not.toContain("forbidden");
  });

  it("returns token-permission guidance without leaking the provided token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("forbidden", { status: 403 })));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/private-repo/pull/12",
          githubToken: "github_pat_secret_should_not_leak_1234567890"
        })
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(400);
    expectNoGitHubEvidenceTiming(response);
    expect(json.category).toBe("github_access");
    expect(json.guidance).toEqual(expect.arrayContaining([
      expect.stringContaining("pull request, contents, checks, statuses, and Actions metadata read access")
    ]));
    expect(serialized).not.toContain("github_pat_secret_should_not_leak_1234567890");
    expect(serialized).not.toContain("forbidden");
  });

  it("returns URL visibility guidance for GitHub 404 failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: "https://github.com/acme/missing-repo/pull/12" })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expectNoGitHubEvidenceTiming(response);
    expect(json.category).toBe("github_access");
    expect(json.guidance).toEqual(expect.arrayContaining([
      expect.stringContaining("publicly visible")
    ]));
  });

  it("returns token visibility guidance for GitHub 404 failures when a token is provided", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not found", { status: 404 })));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/missing-repo/pull/12",
          githubToken: "github_pat_secret_should_not_leak_1234567890"
        })
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(400);
    expectNoGitHubEvidenceTiming(response);
    expect(json.category).toBe("github_access");
    expect(json.guidance).toEqual(expect.arrayContaining([
      expect.stringContaining("provided GitHub token")
    ]));
    expect(serialized).not.toContain("github_pat_secret_should_not_leak_1234567890");
  });

  it("returns rate-limit guidance for GitHub API throttling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1893456000"
        }
      })
    ));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: "https://github.com/acme/repo/pull/12" })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expectNoGitHubEvidenceTiming(response);
    expect(json.category).toBe("github_rate_limit");
    expect(json.guidance).toEqual(expect.arrayContaining([
      expect.stringContaining("rate limit to reset")
    ]));
  });

  it("returns a full-valid report from mocked GitHub PR evidence without overclaiming execution", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/42")) {
        return Promise.resolve(
          Response.json({
            title: "Fix password reset validation",
            body: "Implemented validation for expired reset links.",
            url: "https://api.github.com/repos/acme/app/pulls/42",
            user: { login: "coding-agent" },
            base: { ref: "main" },
            head: { ref: "agent/reset-validation", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(
          Response.json([
            {
              filename: "src/features/auth/reset.ts",
              additions: 4,
              deletions: 1,
              status: "modified",
              patch: [
                "@@ -1,2 +1,5 @@",
                "-return acceptReset(token)",
                "+if (isExpired(token)) {",
                "+  return rejectReset(token)",
                "+}",
                "+return acceptReset(token)"
              ].join("\n")
            },
            {
              filename: "src/features/auth/reset.test.ts",
              additions: 8,
              deletions: 0,
              status: "modified",
              patch: [
                "@@ -1,2 +1,8 @@",
                "+it('rejects expired reset links', () => {",
                "+  expect(validateReset(expiredToken)).toBe(false)",
                "+})"
              ].join("\n")
            }
          ])
        );
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

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/app/pull/42",
          githubToken: "github_pat_secret_should_not_leak_1234567890",
          taskText: "Acceptance criteria: reject expired password reset links and add regression tests."
        })
      })
    );
    const json = await response.json() as { report: VerificationReport };
    const serialized = JSON.stringify(json);
    const githubEvidenceTiming = expectGitHubEvidenceTiming(response, [
      "github_pr",
      "github_files",
      "github_checks",
      "github_statuses",
      "github_annotations",
      "github_jobs"
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.source.url).toBe("https://github.com/acme/app/pull/42");
    expect(json.report.evidenceIndex.some((item) => item.kind === "diff" && item.label === "src/features/auth/reset.ts")).toBe(true);
    expect(json.report.evidenceIndex.some((item) => item.kind === "test" && item.label === "src/features/auth/reset.test.ts")).toBe(true);
    expect(json.report.testing.ciStatus).toBe("unknown");
    expect(json.report.limitations.join(" ")).toContain("No public test/build workflow run, check, or raw CI log was available");
    expect(json.report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
    expect(serialized).not.toContain("github_pat_secret_should_not_leak_1234567890");
    expect(githubEvidenceTiming).not.toContain("github_pat_secret_should_not_leak_1234567890");
    expect(githubEvidenceTiming).not.toContain("acme/app");
    expect(githubEvidenceTiming).not.toContain("reset.ts");
  });

  it("does not treat non-execution GitHub checks as passed CI", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/76")) {
        return Promise.resolve(
          Response.json({
            title: "fix(server-actions): handle malformed Origin headers",
            body: "Handled malformed Origin headers and added regression coverage.",
            url: "https://api.github.com/repos/vercel/next.js/pulls/76",
            user: { login: "coding-agent" },
            base: { ref: "canary" },
            head: { ref: "agent/malformed-origin", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(
          Response.json([
            {
              filename: "packages/next/src/server/app-render/action-handler.ts",
              additions: 6,
              deletions: 2,
              status: "modified",
              patch: "+ if (!isValidOriginHeader(origin)) return rejectAction()"
            },
            {
              filename: "test/e2e/app-dir/actions-allowed-origins/app-action-malformed-origin.test.ts",
              additions: 18,
              deletions: 0,
              status: "modified",
              patch: "+ it('handles malformed origin headers', async () => {})"
            }
          ])
        );
      }

      if (url.includes("/check-runs")) {
        return Promise.resolve(
          Response.json({
            total_count: 3,
            check_runs: [
              {
                name: "Socket Security coverage tests report",
                status: "completed",
                conclusion: "success",
                output: { summary: "Project report passed after policy tests" }
              },
              {
                name: "Vercel Preview tests",
                status: "completed",
                conclusion: "success",
                output: { summary: "Preview smoke tests completed" }
              },
              {
                name: "Vercel - Code Owners",
                status: "completed",
                conclusion: "success",
                output: { summary: "There are no code owners defined" }
              }
            ]
          })
        );
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({ statuses: [] }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/vercel/next.js/pull/76",
          taskText: "Acceptance criteria: handle malformed Origin headers and include regression coverage."
        })
      })
    );
    const json = await response.json() as { report: VerificationReport };

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.testing.ciStatus).toBe("unknown");
    expect(json.report.limitations.join(" ")).toContain("No public test/build workflow run, check, or raw CI log was available from the collected metadata.");
    expect(json.report.evidenceIndex.filter((item) => item.kind === "check")).toHaveLength(3);
  });

  it("uses a single linked issue title and body before PR description for live PR reports", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/142")) {
        return Promise.resolve(
          Response.json({
            title: "Fix reset expiry",
            body: "Fixes #77",
            url: "https://api.github.com/repos/acme/app/pulls/142",
            user: { login: "coding-agent" },
            base: { ref: "main" },
            head: { ref: "agent/reset-expiry", sha: "abc123" }
          })
        );
      }

      if (url.endsWith("/issues/77")) {
        return Promise.resolve(
          Response.json({
            title: "Expired reset links should be rejected",
            body: "Acceptance criteria:\n- Reject expired reset links.\n- Add a regression test for expired tokens."
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([
          {
            filename: "src/features/auth/reset.ts",
            additions: 8,
            deletions: 2,
            status: "modified",
            patch: "+ if (token.expiresAt < now) return rejectExpiredToken()"
          },
          {
            filename: "src/features/auth/reset.test.ts",
            additions: 10,
            deletions: 0,
            status: "modified",
            patch: "+ it('rejects expired reset tokens', () => {})"
          }
        ]));
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

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prUrl: "https://github.com/acme/app/pull/142" })
      })
    );
    const json = await response.json() as { report: VerificationReport };
    const taskEvidence = json.report.evidenceIndex.find((item) => item.kind === "task");

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(taskEvidence?.label).toBe("Linked issue");
    expect(taskEvidence?.summary).toContain("Expired reset links should be rejected");
    expect(json.report.requirements.some((requirement) =>
      requirement.requirementText.includes("Reject expired reset links")
    )).toBe(true);
    expect(json.report.limitations.join(" ")).not.toContain("No original task text was provided");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/issues/77"))).toBe(true);
  });

  it("preserves legacy commit-status timing and evidence when check-runs are present", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/88")) {
        return Promise.resolve(
          Response.json({
            title: "Use check runs before legacy statuses",
            body: "Added regression coverage.",
            url: "https://api.github.com/repos/acme/app/pulls/88",
            user: { login: "coding-agent" },
            base: { ref: "main" },
            head: { ref: "agent/check-runs", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([
          {
            filename: "src/features/auth/reset.test.ts",
            additions: 8,
            deletions: 0,
            status: "modified",
            patch: "+ it('rejects expired reset links', () => {})"
          }
        ]));
      }

      if (url.includes("/check-runs")) {
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
              context: "legacy integration tests",
              state: "failure",
              description: "legacy integration suite failed"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/app/pull/88",
          taskText: "Acceptance criteria: add regression coverage."
        })
      })
    );
    const json = await response.json() as { report: VerificationReport };
    const githubEvidenceTiming = expectGitHubEvidenceTiming(response, [
      "github_pr",
      "github_files",
      "github_checks",
      "github_statuses",
      "github_annotations",
      "github_jobs"
    ]);

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.testing.ciStatus).toBe("failed");
    expect(json.report.evidenceIndex.some((item) =>
      item.kind === "check" &&
      item.label === "legacy integration tests" &&
      item.summary.includes("Status: failed")
    )).toBe(true);
    expect(json.report.limitations.join(" ")).not.toContain("legacy commit-status evidence was skipped");
    expect(githubEvidenceTiming).toContain("github_statuses");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/status"))).toBe(true);
  });

  it("returns a valid report with limitations when check-run evidence times out but legacy status remains", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/89")) {
        return Promise.resolve(
          Response.json({
            title: "Keep legacy status fallback",
            body: "Added regression coverage.",
            url: "https://api.github.com/repos/acme/app/pulls/89",
            user: { login: "coding-agent" },
            base: { ref: "main" },
            head: { ref: "agent/check-runs-timeout", sha: "abc123" }
          })
        );
      }

      if (url.includes("/files?")) {
        return Promise.resolve(Response.json([
          {
            filename: "src/features/auth/reset.test.ts",
            additions: 8,
            deletions: 0,
            status: "modified",
            patch: "+ it('rejects expired reset links', () => {})"
          }
        ]));
      }

      if (url.includes("/check-runs")) {
        return Promise.reject(new Error("timed out with token=github_pat_secret_should_not_leak"));
      }

      if (url.endsWith("/status")) {
        return Promise.resolve(Response.json({
          statuses: [
            {
              context: "legacy unit tests",
              state: "success",
              description: "legacy unit tests passed"
            }
          ]
        }));
      }

      return Promise.resolve(new Response("unexpected url", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/app/pull/89",
          githubToken: "github_pat_secret_should_not_leak",
          taskText: "Acceptance criteria: add regression coverage."
        })
      })
    );
    const json = await response.json() as { report: VerificationReport };
    const serialized = JSON.stringify(json);
    const githubEvidenceTiming = expectGitHubEvidenceTiming(response, [
      "github_pr",
      "github_files",
      "github_checks",
      "github_statuses",
      "github_annotations",
      "github_jobs"
    ]);

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.testing.ciStatus).toBe("passed");
    expect(json.report.summary.confidence).toBeLessThanOrEqual(0.85);
    expect(json.report.limitations.join(" ")).toContain("GitHub check-run evidence unavailable: request timed out after 5000 ms or network failed.");
    expect(json.report.evidenceIndex.some((item) =>
      item.kind === "check" &&
      item.label === "legacy unit tests" &&
      item.summary.includes("Status: passed")
    )).toBe(true);
    expect(githubEvidenceTiming).toMatch(/^ap_github_(pr|files|checks|statuses|annotations|jobs);dur=\d+/);
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("timed out with token");
  });

  it("returns a full-valid fallback report when live GitHub evidence is rate-limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("rate limited", {
        status: 403,
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1893456000"
        }
      })
    ));

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/private-app/pull/9",
          githubToken: "ghp_secret_should_not_leak_1234567890",
          taskText: "Acceptance criteria: preserve summary-only sharing.",
          prDescription: "Implemented summary-only saved reports.",
          changedFiles: "src/lib/report-share.ts\nsrc/app/api/reports/route.ts",
          checks: "unit tests: passed"
        })
      })
    );
    const json = await response.json() as { report: VerificationReport };
    const serialized = JSON.stringify(json);
    const githubEvidenceTiming = expectGitHubEvidenceTiming(response, ["github_pr"]);

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.limitations.join(" ")).toContain("Live GitHub evidence could not be collected");
    expect(json.report.limitations.join(" ")).toContain("pasted evidence only");
    expect(json.report.evidenceIndex.some((item) => item.kind === "check" && item.summary.includes("passed"))).toBe(true);
    expect(serialized).not.toContain("ghp_secret_should_not_leak_1234567890");
    expect(githubEvidenceTiming).not.toContain("ghp_secret_should_not_leak_1234567890");
    expect(githubEvidenceTiming).not.toContain("private-app");
  });

  it("caps large GitHub PR evidence before full report validation", async () => {
    const filePage = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/generated/file-${index}.ts`,
      additions: 1,
      deletions: 0,
      status: "modified",
      patch: "+ export const value = true"
    }));
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith("/pulls/77")) {
        return Promise.resolve(
          Response.json({
            title: "Large generated PR",
            body: "Updated generated files.",
            url: "https://api.github.com/repos/acme/app/pulls/77",
            user: { login: "coding-agent" },
            base: { ref: "main" },
            head: { ref: "agent/generated", sha: "abc123" }
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

    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prUrl: "https://github.com/acme/app/pull/77",
          taskText: "Acceptance criteria: update generated files."
        })
      })
    );
    const json = await response.json() as { report: VerificationReport };

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.evidenceIndex.length).toBeLessThanOrEqual(200);
    expect(json.report.limitations.join(" ")).toContain("capped at 120 files");
  });
});
