import { afterEach, describe, expect, it, vi } from "vitest";
import { AGENTPROOF_COMMENT_MARKER } from "@/lib/markdown";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
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

  it("rejects full reports with missing provenance before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = reportFor("https://github.com/org/repo/pull/1");
    delete report.scope.evidenceRefs;

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "token",
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("scope.evidenceRefs is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects reports without a source PR URL before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = reportFor("https://github.com/org/repo/pull/1");
    delete report.source.url;

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "token",
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toContain("source URL is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects summary-only reports before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fullReport = reportFor("https://github.com/org/repo/pull/1");
    const summaryOnlyReport = decodeSharedReport(encodeReportForShare(fullReport));
    summaryOnlyReport.source.url = "https://github.com/org/repo/pull/1";

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "token",
          report: summaryOnlyReport
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("evidenceIndex must contain evidence items for full reports");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("updates an existing AgentProof marker comment", async () => {
    const report = reportFor("https://github.com/org/repo/pull/1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse([{ id: 100, body: `${AGENTPROOF_COMMENT_MARKER}\nold`, html_url: "old", user: { login: "agentproof-user" } }]))
      .mockResolvedValueOnce(jsonResponse({ id: 100, html_url: "https://github.com/org/repo/pull/1#issuecomment-100" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "write-token",
          report
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

  it("rejects report source PR mismatches before calling GitHub", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "token",
          report: reportFor("https://github.com/org/repo/pull/2")
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.error).toContain("does not match");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts report source PR matches with different owner and repo casing", async () => {
    const report = reportFor("https://github.com/RengGyu/AgentProof/pull/1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 300, html_url: "https://github.com/renggyu/agentproof/pull/1#issuecomment-300" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/renggyu/agentproof/pull/1",
          githubToken: "write-token",
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.action).toBe("created");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/renggyu/agentproof/issues/1/comments?per_page=100&page=1",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("canonicalizes source URLs before posting or returning comment metadata", async () => {
    const report = reportFor(
      "https://user:ghp_secret_should_not_leak@github.com/org/repo/pull/1?token=sk-secret#files"
    );
    report.source.title = "Fix auth token=source_secret_should_not_leak";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 301 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://user:ghp_secret_should_not_leak@github.com/org/repo/pull/1?token=sk-secret#files",
          githubToken: "write-token",
          report
        })
      })
    );
    const json = await response.json();
    const postedBody = String(fetchMock.mock.calls.at(-1)?.[1]?.body);

    expect(response.status).toBe(200);
    expect(json.url).toBe("https://github.com/org/repo/pull/1");
    expect(postedBody).not.toContain("ghp_secret_should_not_leak");
    expect(postedBody).not.toContain("sk-secret");
    expect(postedBody).not.toContain("source_secret_should_not_leak");
  });

  it("redacts the full rendered comment body before posting", async () => {
    const report = reportFor("https://github.com/org/repo/pull/1");
    report.requirements[0].requirementText = "verify token=comment_secret_should_not_leak";
    report.evidenceIndex[0].summary = "Status: passed. Authorization: Bearer comment-secret-value";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ id: 302, html_url: "https://github.com/org/repo/pull/1#issuecomment-302" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "write-token",
          report
        })
      })
    );
    const postedBody = String(fetchMock.mock.calls.at(-1)?.[1]?.body);

    expect(response.status).toBe(200);
    expect(postedBody).not.toContain("comment_secret_should_not_leak");
    expect(postedBody).not.toContain("comment-secret-value");
    expect(postedBody).toContain("[redacted]");
  });

  it("does not patch marker comments owned by a different GitHub user", async () => {
    const report = reportFor("https://github.com/org/repo/pull/1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse([
        { id: 303, body: `${AGENTPROOF_COMMENT_MARKER}\nold`, html_url: "old", user: { login: "someone-else" } }
      ]))
      .mockResolvedValueOnce(jsonResponse({ id: 304, html_url: "https://github.com/org/repo/pull/1#issuecomment-304" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "write-token",
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.action).toBe("created");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/org/repo/issues/1/comments",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("patches an existing AgentProof marker comment found on page 2", async () => {
    const report = reportFor("https://github.com/org/repo/pull/1");
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: "ordinary comment" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse([{ id: 200, body: `${AGENTPROOF_COMMENT_MARKER}\nold`, html_url: "old", user: { login: "agentproof-user" } }]))
      .mockResolvedValueOnce(jsonResponse({ id: 200, html_url: "https://github.com/org/repo/pull/1#issuecomment-200" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "write-token",
          report
        })
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.github.com/repos/org/repo/issues/1/comments?per_page=100&page=2",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.github.com/repos/org/repo/issues/comments/200",
      expect.objectContaining({ method: "PATCH" })
    );
  });

  it("returns a warning when comment pagination is capped without finding a marker", async () => {
    const report = reportFor("https://github.com/org/repo/pull/1");
    const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: index + 1, body: "ordinary comment" }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ login: "agentproof-user" }))
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse(fullPage))
      .mockResolvedValueOnce(jsonResponse({ id: 999, html_url: "https://github.com/org/repo/pull/1#issuecomment-999" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/github/comment", {
        method: "POST",
        body: JSON.stringify({
          prUrl: "https://github.com/org/repo/pull/1",
          githubToken: "write-token",
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.action).toBe("created");
    expect(json.warning).toContain("500 existing comments");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function reportFor(url: string) {
  const report = generateVerificationReport(demoScenarios["scope-creep"]);
  report.source.url = url;
  return report;
}
