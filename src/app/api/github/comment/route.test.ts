import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTPROOF_COMMENT_MARKER } from "@/lib/markdown";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { POST } from "./route";

describe("POST /api/github/comment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects invalid PR URLs before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://example.com/org/repo/pull/1",
          githubToken: "token",
          report: generateVerificationReport(demoScenarios["scope-creep"])
        })
      })
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid report shapes before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "token",
          report: { analysisId: "bad" }
        })
      })
    );

    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates an existing AgentProof marker comment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([{ id: 100, body: `${AGENTPROOF_COMMENT_MARKER}\nold`, html_url: "old" }]))
      .mockResolvedValueOnce(jsonResponse({ id: 100, html_url: "https://github.com/org/repo/pull/1#issuecomment-100" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "write-token",
          report: generateVerificationReport(demoScenarios["scope-creep"])
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.action).toBe("updated");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/org/repo/issues/comments/100",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).not.toContain("write-token");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
