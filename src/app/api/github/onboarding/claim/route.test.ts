import { afterEach, describe, expect, it, vi } from "vitest";
import { clearGitHubOnboardingSessionsForTests } from "@/lib/github-onboarding";
import { clearInstallationClaimsForTests, createPendingInstallationClaim, decidePendingInstallationClaim } from "@/lib/github-installation-claims";
import { clearTenantGitHubInstallationsForTests, countTenantGitHubInstallations } from "@/lib/github-installations";
import { POST } from "./route";

describe("POST /api/github/onboarding/claim", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); clearInstallationClaimsForTests(); clearGitHubOnboardingSessionsForTests(); clearTenantGitHubInstallationsForTests(); });

  it("does not activate a pending claim, then creates activation only after operator approval", async () => {
    stubEnv();
    const claim = await createPendingInstallationClaim({ tenantId: "tenant_a", installationId: 321 });
    const pending = await POST(request(claim.claimCookie));
    expect(pending.status).toBe(409);
    await expect(countTenantGitHubInstallations({ tenantId: "tenant_a" })).resolves.toMatchObject({ count: 0 });

    await decidePendingInstallationClaim({ operatorRequestCode: claim.operatorRequestCode, operatorToken: "operator-token", decision: "approve" });
    const activated = await POST(request(claim.claimCookie));
    expect(activated.status).toBe(200);
    expect(activated.headers.get("Set-Cookie")).toContain("agentproof_github_activation=");
    await expect(countTenantGitHubInstallations({ tenantId: "tenant_a" })).resolves.toMatchObject({ count: 1 });
  });

  it("rejects cross-origin activation before consuming approval", async () => {
    stubEnv();
    const claim = await createPendingInstallationClaim({ tenantId: "tenant_a", installationId: 321 });
    await decidePendingInstallationClaim({ operatorRequestCode: claim.operatorRequestCode, operatorToken: "operator-token", decision: "approve" });
    const response = await POST(new Request("http://localhost/api/github/onboarding/claim", { method: "POST", headers: { origin: "https://attacker.example", cookie: claim.claimCookie } }));
    expect(response.status).toBe(403);
    await expect(countTenantGitHubInstallations({ tenantId: "tenant_a" })).resolves.toMatchObject({ count: 0 });
  });
});

function request(cookie: string) { return new Request("http://localhost/api/github/onboarding/claim", { method: "POST", headers: { cookie, "x-agentproof-csrf": "same-origin" } }); }
function stubEnv() { vi.stubEnv("AGENTPROOF_ONBOARDING_STATE_SECRET", "state-secret-value-with-enough-entropy"); vi.stubEnv("AGENTPROOF_ONBOARDING_ALLOW_MEMORY", "true"); vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY", "true"); vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "true"); vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-token"); }
