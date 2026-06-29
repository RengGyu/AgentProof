import { describe, expect, it, vi } from "vitest";
import { runGitHubWebhookSmoke } from "./smoke-github-webhook.mjs";

describe("smoke-github-webhook", () => {
  it("fails closed before fetch without a webhook smoke secret", async () => {
    const fetchMock = vi.fn();

    await expect(runGitHubWebhookSmoke({
      webhookSecret: undefined,
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_WEBHOOK_SMOKE_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("checks public status, invalid signature rejection, signed ping, and non-analyzing PR smoke", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        githubApp: {
          mode: "signed-intake",
          label: "Signed intake",
          description: "Signed webhook events can be verified.",
          capabilities: [],
          cautions: []
        }
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid GitHub webhook signature." }, 401))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        accepted: true,
        dryRun: true,
        event: "ping",
        delivery: "agentproof-smoke-ping",
        automationEnabled: false,
        willAnalyze: false,
        willComment: false,
        summary: {}
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        ignored: true,
        dryRun: false,
        event: "pull_request",
        delivery: "agentproof-smoke-pr-closed",
        action: "closed",
        automationEnabled: true,
        willAnalyze: false,
        willComment: false
      }));

    const result = await runGitHubWebhookSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret-should-not-leak",
      fetchImpl: fetchMock
    });

    expect(result).toEqual({
      ok: true,
      baseUrl: "https://agentproof.example",
      status: {
        mode: "signed-intake",
        label: "Signed intake"
      },
      invalidSignatureRejected: true,
      ping: {
        accepted: true,
        dryRun: true,
        willAnalyze: false,
        willComment: false
      },
      pullRequest: {
        accepted: false,
        ignored: true,
        dryRun: false,
        action: "closed",
        willAnalyze: false,
        willComment: false
      }
    });
    expect(JSON.stringify(result)).not.toContain("webhook-secret-should-not-leak");

    const signedPingHeaders = fetchMock.mock.calls[2][1].headers;
    expect(signedPingHeaders["x-hub-signature-256"]).toMatch(/^sha256=[a-f0-9]+$/);
    expect(String(fetchMock.mock.calls[2][1].body)).toContain("github_pat_secret_should_not_leak_1234567890");
    expect(String(fetchMock.mock.calls[3][1].body)).toContain("installation-token-should-not-leak");
  });

  it("fails if the public status endpoint exposes detailed configuration fields", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      githubApp: {
        mode: "signed-intake",
        label: "Signed intake",
        signedIntakeReady: true,
        allowedRepoCount: 2
      }
    }));

    await expect(runGitHubWebhookSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret",
      fetchImpl: fetchMock
    })).rejects.toThrow("detailed configuration fields");
  });

  it("fails if a webhook response echoes sensitive probe values", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        githubApp: {
          mode: "signed-intake",
          label: "Signed intake"
        }
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid GitHub webhook signature." }, 401))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        accepted: true,
        dryRun: true,
        event: "ping",
        willAnalyze: false,
        willComment: false,
        leaked: "github_pat_secret_should_not_leak_1234567890"
      }));

    await expect(runGitHubWebhookSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret",
      fetchImpl: fetchMock
    })).rejects.toThrow("leaked sensitive probe values");
  });

  it("fails if the closed PR smoke plans analysis or comments", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        githubApp: {
          mode: "event-mode",
          label: "Event mode ready"
        }
      }))
      .mockResolvedValueOnce(jsonResponse({ error: "Invalid GitHub webhook signature." }, 401))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        accepted: true,
        dryRun: true,
        event: "ping",
        willAnalyze: false,
        willComment: false
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        accepted: true,
        dryRun: false,
        event: "pull_request",
        action: "closed",
        willAnalyze: true,
        willComment: true
      }));

    await expect(runGitHubWebhookSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret",
      fetchImpl: fetchMock
    })).rejects.toThrow("unexpectedly planned analysis or comments");
  });
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store"
    }
  });
}
