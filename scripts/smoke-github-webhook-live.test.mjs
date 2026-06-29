import { describe, expect, it, vi } from "vitest";
import { runGitHubWebhookLiveSmoke } from "./smoke-github-webhook-live.mjs";

describe("smoke-github-webhook-live", () => {
  it("fails closed before fetch without explicit live automation confirmation", async () => {
    const fetchMock = vi.fn();

    await expect(runGitHubWebhookLiveSmoke({
      webhookSecret: "webhook-secret",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "123",
      allowLiveAutomation: false,
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed before fetch without required live smoke inputs", async () => {
    const fetchMock = vi.fn();

    await expect(runGitHubWebhookLiveSmoke({
      webhookSecret: "",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "123",
      allowLiveAutomation: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_WEBHOOK_SMOKE_SECRET");
    await expect(runGitHubWebhookLiveSmoke({
      webhookSecret: "webhook-secret",
      prUrl: undefined,
      installationId: "123",
      allowLiveAutomation: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_WEBHOOK_LIVE_PR_URL");
    await expect(runGitHubWebhookLiveSmoke({
      webhookSecret: "webhook-secret",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "",
      allowLiveAutomation: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses to send a PR webhook when public status is not event-mode", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      githubApp: {
        mode: "signed-intake",
        label: "Signed intake",
        description: "Signed webhook events can be verified.",
        capabilities: [],
        cautions: []
      }
    }));

    await expect(runGitHubWebhookLiveSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "123",
      allowLiveAutomation: true,
      fetchImpl: fetchMock
    })).rejects.toThrow("requires public status mode event-mode");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://agentproof.example/api/github/webhook/status");
  });

  it("sends one signed pull_request automation event and returns bounded analysis metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse("event-mode", "Event mode ready"))
      .mockResolvedValueOnce(githubPrResponse())
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        accepted: true,
        dryRun: false,
        event: "pull_request",
        delivery: "agentproof-live-smoke-test",
        action: "synchronize",
        automationEnabled: true,
        willAnalyze: true,
        willComment: false,
        analysis: {
          status: "completed",
          repository: "RengGyu/AgentProof",
          pullRequestNumber: 22,
          headSha: "abc123def4567890",
          priority: "medium",
          evidenceCoverage: 67
        }
      }));

    const result = await runGitHubWebhookLiveSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret-should-not-leak",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "98765",
      action: "synchronize",
      githubToken: "github_pat_metadata_token_should_not_leak",
      allowLiveAutomation: true,
      deliveryId: "agentproof-live-smoke-test",
      fetchImpl: fetchMock
    });

    expect(result).toEqual({
      ok: true,
      baseUrl: "https://agentproof.example",
      status: {
        mode: "event-mode",
        label: "Event mode ready"
      },
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      repository: "RengGyu/AgentProof",
      pullRequestNumber: 22,
      action: "synchronize",
      headSha: "abc123def456",
      willAnalyze: true,
      willComment: false,
      commentSuppressed: true,
      saveReportSuppressed: true,
      priority: "medium",
      evidenceCoverage: 67,
      savedReport: undefined
    });
    expect(JSON.stringify(result)).not.toContain("webhook-secret-should-not-leak");
    expect(JSON.stringify(result)).not.toContain("github_pat_metadata_token_should_not_leak");

    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.github.com/repos/RengGyu/AgentProof/pulls/22");
    expect(fetchMock.mock.calls[1][1].headers.authorization).toBe("Bearer github_pat_metadata_token_should_not_leak");

    const webhookCall = fetchMock.mock.calls[2];
    expect(String(webhookCall[0])).toBe("https://agentproof.example/api/github/webhook");
    expect(webhookCall[1].headers["x-github-event"]).toBe("pull_request");
    expect(webhookCall[1].headers["x-hub-signature-256"]).toMatch(/^sha256=[a-f0-9]+$/);

    const body = JSON.parse(String(webhookCall[1].body));
    expect(body).toEqual(expect.objectContaining({
      action: "synchronize",
      repository: { full_name: "RengGyu/AgentProof" },
      installation: expect.objectContaining({ id: 98765 }),
      agentproofSmoke: {
        mode: "live-analysis",
        suppressComment: true,
        suppressSavedReport: true,
        sentinel: "github_pat_live_smoke_should_not_leak_1234567890"
      }
    }));
    expect(body.pull_request).toEqual(expect.objectContaining({
      number: 22,
      html_url: "https://github.com/RengGyu/AgentProof/pull/22",
      head: { sha: "abc123def4567890" }
    }));
  });

  it("rejects dry-run, duplicate, comment, and unexpected saved-report responses", async () => {
    await expect(liveSmokeWithWebhookPayload({
      ok: true,
      accepted: true,
      dryRun: true,
      event: "pull_request",
      action: "synchronize",
      automationEnabled: false,
      willAnalyze: false,
      willComment: false
    })).rejects.toThrow("did not reach enabled PR analysis");

    await expect(liveSmokeWithWebhookPayload({
      ok: true,
      accepted: true,
      duplicate: true,
      dryRun: false,
      event: "pull_request",
      action: "synchronize",
      automationEnabled: true,
      willAnalyze: false,
      willComment: false,
      analysis: { status: "skipped" }
    })).rejects.toThrow("duplicate-delivery guard");

    await expect(liveSmokeWithWebhookPayload({
      ok: true,
      accepted: true,
      dryRun: false,
      event: "pull_request",
      action: "synchronize",
      automationEnabled: true,
      willAnalyze: true,
      willComment: true,
      analysis: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 22,
        headSha: "abc123def4567890",
        priority: "medium",
        evidenceCoverage: 67,
        comment: { action: "created", url: "https://github.com/RengGyu/AgentProof/pull/22#issuecomment-1" }
      }
    })).rejects.toThrow("unexpectedly planned or created a GitHub comment");

    await expect(liveSmokeWithWebhookPayload({
      ok: true,
      accepted: true,
      dryRun: false,
      event: "pull_request",
      action: "synchronize",
      automationEnabled: true,
      willAnalyze: true,
      willComment: false,
      analysis: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 22,
        headSha: "abc123def4567890",
        priority: "medium",
        evidenceCoverage: 67,
        savedReport: { privacy: "summary-only", url: "https://agentproof.example/reports/abc" }
      }
    })).rejects.toThrow("save reports were suppressed");
  });

  it("allows summary-only saved report metadata when explicitly enabled", async () => {
    const result = await liveSmokeWithWebhookPayload({
      ok: true,
      accepted: true,
      dryRun: false,
      event: "pull_request",
      action: "synchronize",
      automationEnabled: true,
      willAnalyze: true,
      willComment: false,
      analysis: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 22,
        headSha: "abc123def4567890",
        priority: "medium",
        evidenceCoverage: 67,
        savedReport: {
          privacy: "summary-only",
          durability: "summary-only-supabase",
          url: "https://agentproof.example/reports/abc"
        }
      }
    }, { allowSaveReports: true });

    expect(result.saveReportSuppressed).toBe(false);
    expect(result.savedReport).toEqual({
      privacy: "summary-only",
      durability: "summary-only-supabase",
      url: "https://agentproof.example/reports/abc"
    });
  });

  it("sends suppressSavedReport false only when saved reports are explicitly allowed while keeping suppressComment true", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse("event-mode", "Event mode ready"))
      .mockResolvedValueOnce(githubPrResponse())
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        accepted: true,
        dryRun: false,
        event: "pull_request",
        delivery: "agentproof-live-smoke-save-test",
        action: "synchronize",
        automationEnabled: true,
        willAnalyze: true,
        willComment: false,
        analysis: {
          status: "completed",
          repository: "RengGyu/AgentProof",
          pullRequestNumber: 22,
          headSha: "abc123def4567890",
          priority: "medium",
          evidenceCoverage: 67,
          savedReport: {
            privacy: "summary-only",
            durability: "summary-only-supabase",
            url: "https://agentproof.example/reports/abc"
          }
        }
      }));

    const result = await runGitHubWebhookLiveSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret-should-not-leak",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "98765",
      action: "synchronize",
      githubToken: "github_pat_metadata_token_should_not_leak",
      allowLiveAutomation: true,
      allowSaveReports: true,
      deliveryId: "agentproof-live-smoke-save-test",
      fetchImpl: fetchMock
    });
    const webhookCall = fetchMock.mock.calls[2];
    const body = JSON.parse(String(webhookCall[1].body));
    const serializedResult = JSON.stringify(result);

    expect(body.agentproofSmoke).toEqual({
      mode: "live-analysis",
      suppressComment: true,
      suppressSavedReport: false,
      sentinel: "github_pat_live_smoke_should_not_leak_1234567890"
    });
    expect(result.commentSuppressed).toBe(true);
    expect(result.saveReportSuppressed).toBe(false);
    expect(result.savedReport).toEqual({
      privacy: "summary-only",
      durability: "summary-only-supabase",
      url: "https://agentproof.example/reports/abc"
    });
    expect(serializedResult).not.toContain("webhook-secret-should-not-leak");
    expect(serializedResult).not.toContain("github_pat_metadata_token_should_not_leak");
    expect(serializedResult).not.toContain("sha256=");
    expect(serializedResult).not.toContain("github_pat_live_smoke_should_not_leak");
    expect(serializedResult).not.toContain("sk-live-smoke");
    expect(serializedResult).not.toContain("installation-token-live-smoke");
  });

  it("fails if status or webhook responses echo sensitive probe values", async () => {
    await expect(runGitHubWebhookLiveSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "98765",
      allowLiveAutomation: true,
      fetchImpl: vi.fn().mockResolvedValueOnce(statusResponse("event-mode", "Event mode ready", {
        leaked: "github_pat_live_smoke_should_not_leak_1234567890"
      }))
    })).rejects.toThrow("leaked sensitive probe values");

    await expect(liveSmokeWithWebhookPayload({
      ok: true,
      accepted: true,
      dryRun: false,
      event: "pull_request",
      action: "synchronize",
      automationEnabled: true,
      willAnalyze: true,
      willComment: false,
      analysis: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 22,
        headSha: "abc123def4567890",
        priority: "medium",
        evidenceCoverage: 67,
        reprompt: "do not echo me"
      }
    })).rejects.toThrow("leaked sensitive probe values");
  });

  it("redacts secret-shaped webhook error messages before throwing", async () => {
    await expect(liveSmokeWithWebhookPayload({
      error: "failed token=github_pat_error_should_not_leak_1234567890 secret=another-secret-value",
      code: "github_app_automation_failed"
    }, {
      webhookSecret: "webhook-secret-should-not-leak",
      githubToken: "github_pat_metadata_token_should_not_leak",
      webhookStatus: 502
    })).rejects.toThrow(/failed \[redacted\] \[redacted\]/);

    await expect(liveSmokeWithWebhookPayload({
      error: "failed token=github_pat_error_should_not_leak_1234567890 secret=another-secret-value",
      code: "github_app_automation_failed"
    }, {
      webhookSecret: "webhook-secret-should-not-leak",
      githubToken: "github_pat_metadata_token_should_not_leak",
      webhookStatus: 502
    })).rejects.not.toThrow(/github_pat_error|webhook-secret-should-not-leak/);
  });

  it("redacts secret-shaped GitHub metadata error messages before throwing", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(statusResponse("event-mode", "Event mode ready"))
      .mockResolvedValueOnce(jsonResponse({
        message: "Bad credentials token=github_pat_error_should_not_leak_1234567890 secret=another-secret-value"
      }, 403));

    await expect(runGitHubWebhookLiveSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret-should-not-leak",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "98765",
      githubToken: "github_pat_actual_input_should_not_leak_1234567890",
      allowLiveAutomation: true,
      fetchImpl: fetchMock
    })).rejects.toThrow(/Bad credentials \[redacted\] \[redacted\]/);

    await expect(runGitHubWebhookLiveSmoke({
      baseUrl: "https://agentproof.example",
      webhookSecret: "webhook-secret-should-not-leak",
      prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
      installationId: "98765",
      githubToken: "github_pat_actual_input_should_not_leak_1234567890",
      allowLiveAutomation: true,
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(statusResponse("event-mode", "Event mode ready"))
        .mockResolvedValueOnce(jsonResponse({
          message: "Bad credentials token=github_pat_error_should_not_leak_1234567890 secret=another-secret-value"
        }, 403))
    })).rejects.not.toThrow(/github_pat_error|another-secret-value|github_pat_actual_input/);
  });
});

async function liveSmokeWithWebhookPayload(webhookPayload, options = {}) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(statusResponse("event-mode", "Event mode ready"))
    .mockResolvedValueOnce(githubPrResponse())
    .mockResolvedValueOnce(jsonResponse(webhookPayload, options.webhookStatus ?? 200));

  return runGitHubWebhookLiveSmoke({
    baseUrl: "https://agentproof.example",
    webhookSecret: "webhook-secret",
    prUrl: "https://github.com/RengGyu/AgentProof/pull/22",
    installationId: "98765",
    action: "synchronize",
    allowLiveAutomation: true,
    fetchImpl: fetchMock,
    ...options
  });
}

function statusResponse(mode, label, extra = {}) {
  return jsonResponse({
    githubApp: {
      mode,
      label,
      description: "GitHub App event mode can generate evidence reports for configured PR events.",
      capabilities: [],
      cautions: [],
      ...extra
    }
  });
}

function githubPrResponse() {
  return jsonResponse({
    number: 22,
    html_url: "https://github.com/RengGyu/AgentProof/pull/22",
    head: { sha: "abc123def4567890" }
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store"
    }
  });
}
