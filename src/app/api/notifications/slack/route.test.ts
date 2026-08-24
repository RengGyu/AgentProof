import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "@/lib/verifier";
import { POST } from "./route";

describe("POST /api/notifications/slack", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled unless Slack env and a notification token are configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );

    expect(response.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the notification token before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps manual Slack notifications disabled unless explicitly allowed", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "Manual Slack notifications are disabled.",
      code: "manual_slack_notifications_disabled"
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks manual Slack notifications when tenant control is enabled", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.code).toBe("manual_slack_notifications_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects oversized notification payloads before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: "x".repeat(121_000)
      })
    );
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.error).toContain("too large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects full reports with missing provenance before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("scope.evidenceRefs is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects inbound author-claim absence reports before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const marker = "raw-slack-author-claim-marker";
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report: authorClaimAbsenceReport(marker) })
      })
    );
    const serialized = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(serialized)).toEqual({
      error: "Report failed validation.",
      details: ["An inbound untrusted full report cannot carry active v2 contract authority."]
    });
    expect(serialized).not.toContain(marker);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redacts validation details before returning them", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.requirements[0].evidenceRefs = ["github_pat_secret_should_not_leak_1234567890"];

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report })
      })
    );
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(422);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_secret");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts summary-only reports for summary notifications", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const report = decodeSharedReport(encodeReportForShare(generateVerificationReport(demoScenarios["scope-creep"])));

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({ report })
      })
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects unsafe report URLs before sending", async () => {
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_NOTIFY_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/notifications/slack", {
        method: "POST",
        headers: { "x-agentproof-notify-token": "secret" },
        body: JSON.stringify({
          report: generateVerificationReport(demoScenarios.clean),
          reportUrl: "javascript:alert(1)"
        })
      })
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function authorClaimAbsenceReport(marker: string) {
  const headSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const contract = {
    version: 2 as const,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "runtime_scope",
      objective: marker,
      criteria: [{
        id: "no_runtime_change",
        type: "absence" as const,
        label: "No runtime path changes.",
        prohibitedKind: "path_change" as const,
        scope: [{ kind: "prefix" as const, path: "src/runtime/" }]
      }]
    }]
  };
  const sourceContent = `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``;
  return generateVerificationReportV2FromInput({
    ...demoScenarios.clean,
    title: marker,
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run pnpm test." }],
    checks: [],
    logs: [],
    verificationContractSourceV2: {
      kind: "pr_description",
      title: "AgentProof verification contract",
      body: sourceContent
    },
    verificationContractBindingV2: {
      sourceKind: "pr_description",
      sourceIdentity: "synthetic:slack-authority:1",
      sourceContent,
      headSha,
      baseSha
    },
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha,
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-22T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    }
  });
}
