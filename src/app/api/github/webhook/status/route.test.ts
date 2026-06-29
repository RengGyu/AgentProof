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
});
