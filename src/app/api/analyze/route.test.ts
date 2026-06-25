import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

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
});
