import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInstallationClaimsForTests, createPendingInstallationClaim } from "@/lib/github-installation-claims";
import { clearAuditEventsForTests, getAuditEventsForTests } from "@/lib/audit-log";
import { POST } from "./route";

describe("POST /api/ops/github-installation-claims", () => {
  afterEach(() => { vi.unstubAllEnvs(); clearInstallationClaimsForTests(); clearAuditEventsForTests(); });
  it("does not approve a pending installation claim without its dedicated operator token", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-token");
    const claim = await createPendingInstallationClaim({ tenantId: "tenant_a", installationId: 321 });
    const response = await POST(new Request("http://localhost/api/ops/github-installation-claims", { method: "POST", body: JSON.stringify({ requestCode: claim.operatorRequestCode, decision: "approve" }) }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "github_installation_claim_unavailable" });
  });

  it("records only bounded approval metadata, never the operator request code", async () => {
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIMS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_INSTALLATION_CLAIM_OPERATOR_TOKEN", "operator-token");
    const claim = await createPendingInstallationClaim({ tenantId: "tenant_a", installationId: 321 });
    const response = await POST(new Request("http://localhost/api/ops/github-installation-claims", {
      method: "POST",
      headers: { "x-agentproof-installation-claim-operator-token": "operator-token" },
      body: JSON.stringify({ requestCode: claim.operatorRequestCode, decision: "approve" })
    }));
    expect(response.status).toBe(200);
    const event = getAuditEventsForTests()[0];
    expect(event).toMatchObject({ action: "github_installation_claim_approved", tenant_id: "tenant_a", installation_id: 321 });
    expect(JSON.stringify(event)).not.toContain(claim.operatorRequestCode);
  });
});
