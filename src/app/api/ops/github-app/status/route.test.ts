import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/ops/github-app/status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when operator diagnostics are not configured", async () => {
    const response = await GET(new Request("http://localhost/api/ops/github-app/status"));
    const json = await response.json();

    expect(response.status).toBe(501);
    expect(json).toEqual({
      error: "Operator diagnostics are not configured.",
      code: "ops_diagnostics_not_configured"
    });
  });

  it("rejects invalid operator tokens", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "wrong-token" }
    }));
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid operator diagnostics token.",
      code: "ops_diagnostics_unauthorized"
    });
    expect(JSON.stringify(json)).not.toContain("ops-secret-value");
  });

  it("returns bounded operator diagnostics without secret values, repo names, or table names", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
    vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_ALLOWED_REPOS", "RengGyu/AgentProof");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_COMMENT_ENABLED", "false");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "false");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE", "private_delivery_table");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual({
      mode: "analysis-ready",
      signedIntake: "ready",
      appCredentials: "ready",
      automation: "enabled",
      repoScope: "configured",
      commentOptIn: "disabled",
      savedReportOptIn: "disabled",
      idempotency: "durable-supabase",
      cautions: []
    });
    expect(serialized).not.toContain("ops-secret-value");
    expect(serialized).not.toContain("webhook-secret-value");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("RengGyu/AgentProof");
    expect(serialized).not.toContain("private_delivery_table");
    expect(serialized).not.toContain("service-role-secret");
  });

  it("reports incomplete durable idempotency without exposing missing env names", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret-value");
    vi.stubEnv("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL", "https://agentproof-test.supabase.co");

    const response = await GET(new Request("http://localhost/api/ops/github-app/status", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json.githubApp).toEqual(expect.objectContaining({
      mode: "dry-run",
      signedIntake: "ready",
      appCredentials: "not-ready",
      automation: "disabled",
      repoScope: "missing",
      idempotency: "config-incomplete",
      cautions: expect.arrayContaining([
        "Durable duplicate suppression is partially configured and should fail closed."
      ])
    }));
    expect(serialized).not.toContain("AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL");
    expect(serialized).not.toContain("SERVICE_ROLE_KEY");
  });
});

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}
