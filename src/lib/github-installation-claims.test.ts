import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInstallationClaimsForTests, consumeApprovedInstallationClaim, createPendingInstallationClaim, decidePendingInstallationClaim } from "./github-installation-claims";

describe("github installation claims", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearInstallationClaimsForTests(); });

  it("requires a separate operator credential and consumes an approved browser claim once", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-token");
    const claim = await createPendingInstallationClaim({ tenantId: "tenant_a", installationId: 321 });

    await expect(decidePendingInstallationClaim({ operatorRequestCode: claim.operatorRequestCode, operatorToken: "wrong", decision: "approve" })).resolves.toEqual({ valid: false });
    await expect(consumeApprovedInstallationClaim({ cookieHeader: claim.claimCookie })).resolves.toBeNull();
    await expect(decidePendingInstallationClaim({ operatorRequestCode: claim.operatorRequestCode, operatorToken: "operator-token", decision: "approve" })).resolves.toMatchObject({ valid: true, status: "approved", tenantId: "tenant_a", installationId: 321 });
    await expect(consumeApprovedInstallationClaim({ cookieHeader: claim.claimCookie })).resolves.toEqual({ tenantId: "tenant_a", installationId: 321 });
    await expect(consumeApprovedInstallationClaim({ cookieHeader: claim.claimCookie })).resolves.toBeNull();
  });

  it("uses the activation RPC with only hashes and durable session metadata", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    let row: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/agentproof_github_installation_claims") && init?.method === "POST") {
        row = JSON.parse(String(init.body));
        return new Response(null, { status: 201 });
      }
      if (url.includes("agentproof_github_installation_claims?") && init?.method === "GET") return Response.json([row]);
      if (url.includes("agentproof_github_installation_claims?") && init?.method === "PATCH") {
        row = { ...row, status: "approved" };
        return Response.json([row]);
      }
      if (url.endsWith("/rpc/agentproof_activate_github_installation_claim")) return Response.json([{ tenant_id: "tenant_a", installation_id: 321 }]);
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const claim = await createPendingInstallationClaim({ tenantId: "tenant_a", installationId: 321 });
    await expect(decidePendingInstallationClaim({ operatorRequestCode: claim.operatorRequestCode, operatorToken: "", decision: "approve" })).resolves.toEqual({ valid: false });
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-token");
    await decidePendingInstallationClaim({ operatorRequestCode: claim.operatorRequestCode, operatorToken: "operator-token", decision: "approve" });
    await expect(consumeApprovedInstallationClaim({
      cookieHeader: claim.claimCookie,
      activationSession: { id: "session_id", tokenHash: "session_hash", expiresAt: "2026-06-30T00:15:00.000Z", createdAt: "2026-06-30T00:00:00.000Z" }
    })).resolves.toEqual({ tenantId: "tenant_a", installationId: 321 });

    const rpc = fetchMock.mock.calls.find(([url]) => String(url).includes("/rpc/agentproof_activate_github_installation_claim"));
    const payload = JSON.parse(String(rpc?.[1]?.body));
    expect(payload).toMatchObject({ activation_session_id: "session_id", activation_session_token_hash: "session_hash" });
    expect(JSON.stringify(payload)).not.toContain(claim.operatorRequestCode);
    expect(JSON.stringify(payload)).not.toContain("agentproof_github_installation_claim=");
  });
});
