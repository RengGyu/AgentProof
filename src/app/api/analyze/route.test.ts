import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { validateVerificationReport } from "@/lib/report-validation";
import type { VerificationReport } from "@/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(json.error).toContain("GitHub pull request URL");
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
  });

  it("redacts token-like values from analysis errors", async () => {
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
    expect(JSON.stringify(json)).not.toContain("github_pat_1234567890abcdef1234567890");
    expect(JSON.stringify(json)).toContain("[redacted]");
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

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.source.url).toBe("https://github.com/acme/app/pull/42");
    expect(json.report.evidenceIndex.some((item) => item.kind === "diff" && item.label === "src/features/auth/reset.ts")).toBe(true);
    expect(json.report.evidenceIndex.some((item) => item.kind === "test" && item.label === "src/features/auth/reset.test.ts")).toBe(true);
    expect(json.report.testing.ciStatus).toBe("unknown");
    expect(json.report.limitations.join(" ")).toContain("No CI or test logs were available");
    expect(json.report.requirements.some((requirement) => requirement.status === "met")).toBe(false);
    expect(serialized).not.toContain("github_pat_secret_should_not_leak_1234567890");
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
                name: "Socket Security: Project Report",
                status: "completed",
                conclusion: "success",
                output: { summary: "Project report passed" }
              },
              {
                name: "Vercel Agent Review",
                status: "completed",
                conclusion: "success",
                output: { summary: "Analysis completed successfully" }
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
    expect(json.report.limitations.join(" ")).toContain("Check status is unknown or incomplete");
    expect(json.report.evidenceIndex.filter((item) => item.kind === "check")).toHaveLength(3);
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

    expect(response.status).toBe(200);
    expect(validateVerificationReport(json.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(json.report.limitations.join(" ")).toContain("Live GitHub evidence could not be collected");
    expect(json.report.limitations.join(" ")).toContain("pasted evidence only");
    expect(json.report.evidenceIndex.some((item) => item.kind === "check" && item.summary.includes("passed"))).toBe(true);
    expect(serialized).not.toContain("ghp_secret_should_not_leak_1234567890");
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
