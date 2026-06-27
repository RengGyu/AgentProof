import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/github/webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled until a webhook secret is configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        body: JSON.stringify({ action: "opened" })
      })
    );

    expect(response.status).toBe(501);
    const json = await response.json();
    expect(json).toEqual({
      error: "GitHub App webhook is not configured.",
      code: "github_webhook_not_configured"
    });
    expect(JSON.stringify(json)).not.toContain("privateKey");
  });

  it("rejects tampered signatures", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({ action: "opened" });
    const signature = `sha256=${createHmac("sha256", "secret").update(`${body}tampered`).digest("hex")}`;

    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "x-hub-signature-256": signature,
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery"
        },
        body
      })
    );

    expect(response.status).toBe(401);
  });

  it("rejects missing signatures", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({ action: "opened" });

    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery"
        },
        body
      })
    );

    expect(response.status).toBe(401);
  });

  it("accepts valid pull_request events as dry-run metadata only", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "RengGyu/AgentProof" },
      pull_request: {
        number: 4,
        html_url: "https://github.com/RengGyu/AgentProof/pull/4",
        title: "Sensitive title should not be echoed"
      },
      rawDiff: "Patch excerpt: + secret = 'do-not-return'",
      installation: { token: "do-not-return" }
    });

    const response = await POST(
      signedRequest(body, {
        event: "pull_request",
        delivery: "delivery-pr",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json).toEqual({
      ok: true,
      accepted: true,
      dryRun: true,
      event: "pull_request",
      delivery: "delivery-pr",
      action: "opened",
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      summary: {
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 4,
        pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/4"
      },
      note: "Webhook verified. Automated GitHub App actions stay disabled until installation-token handling and idempotency storage are added."
    });
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("Sensitive title");
  });

  it("accepts check_run and status events without enabling automation", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const checkBody = JSON.stringify({
      action: "completed",
      repository: { full_name: "RengGyu/AgentProof" },
      check_run: { name: "CI test/build evidence verification sk-secret1234" }
    });
    const statusBody = JSON.stringify({
      context: "CI test/build evidence verification token=ghp_123456789012345678901234",
      repository: { full_name: "RengGyu/AgentProof" }
    });

    const checkResponse = await POST(
      signedRequest(checkBody, {
        event: "check_run",
        delivery: "delivery-check",
        secret: "secret"
      })
    );
    const statusResponse = await POST(
      signedRequest(statusBody, {
        event: "status",
        delivery: "delivery-status",
        secret: "secret"
      })
    );

    await expect(checkResponse.json()).resolves.toEqual(expect.objectContaining({
      accepted: true,
      dryRun: true,
      automationEnabled: false,
      willAnalyze: false,
      willComment: false,
      summary: expect.objectContaining({
        repository: "RengGyu/AgentProof",
        checkRunName: "CI test/build evidence verification [redacted]"
      })
    }));
    await expect(statusResponse.json()).resolves.toEqual(expect.objectContaining({
      accepted: true,
      dryRun: true,
      automationEnabled: false,
      summary: expect.objectContaining({
        repository: "RengGyu/AgentProof",
        statusContext: "CI test/build evidence verification [redacted]"
      })
    }));
  });

  it("ignores unsupported signed events without parsing or taking action", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = "{not-json";

    const response = await POST(
      signedRequest(body, {
        event: "issues",
        delivery: "delivery-issues",
        secret: "secret"
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      ignored: true,
      dryRun: true,
      event: "issues",
      delivery: "delivery-issues",
      automationEnabled: false,
      note: "Event ignored. Automated GitHub App actions are disabled."
    });
  });

  it("rejects malformed JSON for supported events after signature verification", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const response = await POST(
      signedRequest("{not-json", {
        event: "pull_request",
        delivery: "delivery-bad-json",
        secret: "secret"
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub webhook payload must be a JSON object."
    });
  });

  it("rejects oversized payloads before accepting a signed webhook", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({ action: "opened", filler: "x".repeat(400_001) });
    const response = await POST(
      signedRequest(body, {
        event: "pull_request",
        delivery: "delivery-large",
        secret: "secret"
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub webhook payload is too large."
    });
  });

  it("rejects oversized content-length before requiring a valid signature", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        headers: {
          "content-length": "400001",
          "x-hub-signature-256": "sha256=not-a-real-signature",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-large-header"
        },
        body: JSON.stringify({ action: "opened" })
      })
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "GitHub webhook payload is too large."
    });
  });
});

function signedRequest(
  body: string,
  options: { event: string; delivery: string; secret: string }
): Request {
  const signature = `sha256=${createHmac("sha256", options.secret).update(body).digest("hex")}`;

  return new Request("http://localhost/api/github/webhook", {
    method: "POST",
    headers: {
      "x-hub-signature-256": signature,
      "x-github-event": options.event,
      "x-github-delivery": options.delivery
    },
    body
  });
}
