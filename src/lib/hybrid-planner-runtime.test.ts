import { describe, expect, it, vi } from "vitest";
import {
  createHybridPlannerGateReader,
  readHybridPlannerTenantAllowlist
} from "./hybrid-planner-runtime";

describe("hybrid planner runtime gate reader", () => {
  it("re-reads private visibility, repository grant, allowlist, and kill switch on every phase", async () => {
    const env = {
      AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true",
      AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST: "tenant_a"
    };
    const readRepositoryPrivate = vi.fn().mockResolvedValue(true);
    const readGrant = vi.fn().mockResolvedValue({
      tenantId: "tenant_a",
      llmAnalysisMode: "enhanced",
      hybridPlannerConsentVersion: "2026-08-12.v1"
    });
    const readGate = createHybridPlannerGateReader({ readRepositoryPrivate, readGrant, env });

    await expect(readGate()).resolves.toEqual({ enabled: true });
    env.AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED = "false";
    await expect(readGate()).resolves.toEqual({ enabled: false, reason: "pilot-disabled" });

    expect(readRepositoryPrivate).toHaveBeenCalledTimes(2);
    expect(readGrant).toHaveBeenCalledTimes(2);
  });

  it("fails closed for malformed or oversized tenant allowlists", () => {
    expect(readHybridPlannerTenantAllowlist({ AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST: "tenant_a, tenant-b" })).toEqual(["tenant_a", "tenant-b"]);
    expect(readHybridPlannerTenantAllowlist({ AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST: "tenant_a,,tenant_b" })).toEqual([]);
    expect(readHybridPlannerTenantAllowlist({ AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST: Array.from({ length: 501 }, (_, index) => `tenant_${index}`).join(",") })).toEqual([]);
  });
});
