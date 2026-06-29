import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/github/webhook/status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns non-secret dry-run readiness metadata", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("GITHUB_APP_ID", "");
    vi.stubEnv("GITHUB_PRIVATE_KEY", "");

    const response = await GET();
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json.githubApp).toEqual(expect.objectContaining({
      mode: "signed-intake",
      label: "Signed intake",
      capabilities: expect.arrayContaining([
        "Manual PR URL analysis remains available from the main workspace."
      ]),
      cautions: expect.arrayContaining([
        "Public readiness status does not expose secret names, values, allowlists, or private-key validity."
      ])
    }));
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("GITHUB_PRIVATE_KEY");
    expect(serialized).not.toContain("signedIntakeReady");
    expect(serialized).not.toContain("appCredentialsReady");
    expect(serialized).not.toContain("allowedRepoCount");
    expect(serialized).not.toContain("allowAllRepos");
  });

  it("returns non-secret event-mode readiness metadata", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");

    const response = await GET();
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      mode: "event-mode",
      label: "Event mode ready",
      capabilities: expect.arrayContaining([
        "Signed PR events can trigger AgentProof evidence reports for configured repositories."
      ])
    }));
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("allowedRepoCount");
    expect(serialized).not.toContain("appCredentialsReady");
    expect(serialized).not.toContain("saveReportsEnabled");
    expect(serialized).not.toContain("commentEnabled");
  });
});

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
