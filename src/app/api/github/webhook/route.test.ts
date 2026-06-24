import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/github/webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled until a webhook secret is configured", async () => {
    const response = await POST(
      new Request("http://localhost/api/github/webhook", {
        method: "POST",
        body: JSON.stringify({ action: "opened" })
      })
    );

    expect(response.status).toBe(501);
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
});
