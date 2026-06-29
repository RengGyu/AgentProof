import { createHmac, generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGitHubWebhookDeliveriesForTests } from "@/lib/github-app";
import { clearSavedReportsForTests } from "@/lib/server-report-store";
import { POST } from "./route";

describe("POST /api/github/webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearGitHubWebhookDeliveriesForTests();
    clearSavedReportsForTests();
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
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock).not.toHaveBeenCalled();
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
      note: "Webhook verified. Automated GitHub App actions stay disabled until automation is explicitly enabled for an allowed repository."
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

  it("keeps dry-run behavior when App credentials exist but automation is not enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-dry-run",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.automationEnabled).toBe(false);
    expect(json.dryRun).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when automation is enabled but App credentials are incomplete", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-missing-app",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.code).toBe("github_app_not_ready");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores automation for repositories outside the allowlist before fetching tokens", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "other/repo");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-not-allowed",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ignored).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores unsupported pull_request actions before fetching tokens", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({ action: "closed" })), {
        event: "pull_request",
        delivery: "delivery-closed",
        secret: "secret"
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.ignored).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("analyzes signed pull_request events with an installation token and saves summary-only reports", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload({
        rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890",
        installation: { id: 321, token: "payload-token-should-not-leak" }
      })), {
        event: "pull_request",
        delivery: "delivery-analyze",
        secret: "secret"
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.dryRun).toBe(false);
    expect(json.automationEnabled).toBe(true);
    expect(json.willAnalyze).toBe(true);
    expect(json.willComment).toBe(false);
    expect(json.analysis.status).toBe("completed");
    expect(json.analysis.repository).toBe("RengGyu/AgentProof");
    expect(json.analysis.savedReport.privacy).toBe("summary-only");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("payload-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/app/installations/321/access_tokens",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("skips duplicate pull_request automation for the same PR head SHA and action", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);
    const body = JSON.stringify(automationPayload());

    const first = await POST(signedRequest(body, {
      event: "pull_request",
      delivery: "delivery-duplicate-1",
      secret: "secret"
    }));
    const callCount = fetchMock.mock.calls.length;
    const second = await POST(signedRequest(body, {
      event: "pull_request",
      delivery: "delivery-duplicate-2",
      secret: "secret"
    }));
    const json = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(json.duplicate).toBe(true);
    expect(json.willAnalyze).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(callCount);
  });

  it("creates a GitHub App marker comment only when comment opt-in is enabled", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "secret");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    const fetchMock = mockAutomationFetch();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      signedRequest(JSON.stringify(automationPayload()), {
        event: "pull_request",
        delivery: "delivery-comment",
        secret: "secret"
      })
    );
    const json = await response.json();
    const commentPost = fetchMock.mock.calls.find((call) =>
      String(call[0]) === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" &&
      (call[1] as RequestInit | undefined)?.method === "POST"
    );

    expect(response.status).toBe(200);
    expect(json.analysis.comment.action).toBe("created");
    expect(json.analysis.comment.url).toContain("issuecomment-777");
    expect(String((commentPost?.[1] as RequestInit).body)).toContain("agentproof:github-app:evidence-check:v1");
    expect(String((commentPost?.[1] as RequestInit).body)).not.toContain("Agent re-prompt");
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

function automationPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    repository: {
      id: 100,
      full_name: "RengGyu/AgentProof"
    },
    pull_request: {
      number: 7,
      html_url: "https://github.com/RengGyu/AgentProof/pull/7",
      title: "Webhook title should not be trusted",
      head: { sha: "abc123" }
    },
    installation: { id: 321 },
    ...overrides
  };
}

function mockAutomationFetch() {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";

    if (href === "https://api.github.com/app/installations/321/access_tokens") {
      return jsonResponse({ token: "installation-token" });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7") {
      return jsonResponse({
        title: "Fetched PR title",
        body: "Acceptance criteria: add signed webhook-triggered AgentProof analysis. Save only summary reports. Keep automated comments opt-in.",
        url: "https://api.github.com/repos/RengGyu/AgentProof/pulls/7",
        user: { login: "agent-author" },
        base: { ref: "main" },
        head: { ref: "feature/app-automation", sha: "abc123" }
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7/files?per_page=100&page=1") {
      return jsonResponse([
        {
          filename: "src/app/api/github/webhook/route.ts",
          additions: 30,
          deletions: 2,
          status: "modified",
          patch: "@@ -1 +1 @@\n+ signed webhook-triggered AgentProof analysis"
        }
      ]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123/check-runs?per_page=100&page=1") {
      return jsonResponse({
        total_count: 1,
        check_runs: [
          {
            id: 999,
            name: "CI test/build evidence verification",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/RengGyu/AgentProof/actions/runs/1",
            details_url: "https://github.com/RengGyu/AgentProof/actions/runs/1",
            output: { summary: "pnpm test, typecheck, and build passed" }
          }
        ]
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/abc123/status") {
      return jsonResponse({ statuses: [] });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/actions/runs/1/jobs?per_page=100") {
      return jsonResponse({
        jobs: [
          {
            name: "CI test/build evidence verification",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/RengGyu/AgentProof/actions/runs/1/job/2",
            steps: [
              { name: "Test", status: "completed", conclusion: "success" },
              { name: "Build", status: "completed", conclusion: "success" }
            ]
          }
        ]
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments?per_page=100&page=1") {
      return jsonResponse([]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && method === "POST") {
      return jsonResponse({ html_url: "https://github.com/RengGyu/AgentProof/pull/7#issuecomment-777" });
    }

    return new Response(JSON.stringify({ message: `Unhandled ${method} ${href}` }), { status: 404 });
  });
}

function jsonResponse(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init
  });
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
