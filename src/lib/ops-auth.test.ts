import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyOpsRequest } from "./ops-auth";

describe("ops auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed when the operator token is not configured", async () => {
    const result = verifyOpsRequest(new Request("http://localhost/api/ops/test"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(501);
      expectNoStoreHeaders(result.response);
      expect(await result.response.json()).toEqual({
        error: "Operator diagnostics are not configured.",
        code: "ops_diagnostics_not_configured"
      });
    }
  });

  it("treats whitespace-only operator token env as unconfigured", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "   ");

    const result = verifyOpsRequest(new Request("http://localhost/api/ops/test", {
      headers: { "x-agentproof-ops-token": "anything" }
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(501);
      expectNoStoreHeaders(result.response);
      expect(await result.response.json()).toEqual({
        error: "Operator diagnostics are not configured.",
        code: "ops_diagnostics_not_configured"
      });
    }
  });

  it("authenticates only the operator header and trims configured env", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "  ops-secret-value  ");

    expect(verifyOpsRequest(new Request("http://localhost/api/ops/test", {
      headers: { "x-agentproof-ops-token": "ops-secret-value" }
    }))).toEqual({ ok: true });

    const queryToken = verifyOpsRequest(new Request("http://localhost/api/ops/test?token=ops-secret-value"));
    expect(queryToken.ok).toBe(false);
    if (!queryToken.ok) {
      const serialized = JSON.stringify(await queryToken.response.json());
      expect(queryToken.response.status).toBe(401);
      expectNoStoreHeaders(queryToken.response);
      expect(serialized).not.toContain("ops-secret-value");
    }
  });

  it("rejects same-length, wrong-length, and comma-combined tokens without exposing the configured token", async () => {
    vi.stubEnv("AGENTPROOF_OPS_TOKEN", "ops-secret-value");

    const cases: Request[] = [
      new Request("http://localhost/api/ops/test", {
        headers: { "x-agentproof-ops-token": "ops-secret-valuf" }
      }),
      new Request("http://localhost/api/ops/test", {
        headers: { "x-agentproof-ops-token": "ops-secret-value-extra" }
      }),
      new Request("http://localhost/api/ops/test", {
        headers: { "x-agentproof-ops-token": "wrong-token" }
      })
    ];
    const duplicateHeader = new Headers();
    duplicateHeader.append("x-agentproof-ops-token", "ops-secret-value");
    duplicateHeader.append("x-agentproof-ops-token", "wrong-token");
    cases.push(new Request("http://localhost/api/ops/test", { headers: duplicateHeader }));

    for (const request of cases) {
      const result = verifyOpsRequest(request);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        const serialized = JSON.stringify(await result.response.json());
        expect(result.response.status).toBe(401);
        expectNoStoreHeaders(result.response);
        expect(serialized).not.toContain("ops-secret-value");
      }
    }
  });
});

function expectNoStoreHeaders(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
}
