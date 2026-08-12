import { describe, expect, it } from "vitest";
import {
  HYBRID_PLANNER_CONSENT_VERSION,
  evaluateHybridPlannerGate
} from "./hybrid-planner-consent";

const grant = {
  tenantId: "tenant_a",
  llmAnalysisMode: "enhanced" as const,
  hybridPlannerConsentVersion: HYBRID_PLANNER_CONSENT_VERSION
};

describe("hybrid planner consent gate", () => {
  it("requires private enhanced exact-version consent, tenant allowlist, and the per-call kill-switch value", () => {
    const enabled = () => evaluateHybridPlannerGate({
      repositoryPrivate: true,
      grant,
      tenantAllowlist: ["tenant_a"],
      env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" }
    });

    expect(enabled()).toEqual({ enabled: true });
    expect(evaluateHybridPlannerGate({ ...enabled(), repositoryPrivate: false, grant, tenantAllowlist: ["tenant_a"], env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" } })).toEqual({ enabled: false, reason: "repository-not-private" });
    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant: { ...grant, llmAnalysisMode: "essential" }, tenantAllowlist: ["tenant_a"], env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" } })).toEqual({ enabled: false, reason: "analysis-mode-not-enhanced" });
    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant: { ...grant, hybridPlannerConsentVersion: "wrong" }, tenantAllowlist: ["tenant_a"], env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" } })).toEqual({ enabled: false, reason: "consent-not-granted" });
    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant, tenantAllowlist: [], env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" } })).toEqual({ enabled: false, reason: "tenant-not-allowlisted" });
    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant, tenantAllowlist: ["tenant_a"], env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "false" } })).toEqual({ enabled: false, reason: "pilot-disabled" });
  });

  it("fails closed for malformed allowlists and re-evaluates mutable input on every call", () => {
    const env = { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" };
    const allowlist = ["tenant_a"];

    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant, tenantAllowlist: allowlist, env })).toEqual({ enabled: true });
    allowlist.splice(0, 1);
    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant, tenantAllowlist: allowlist, env })).toEqual({ enabled: false, reason: "tenant-not-allowlisted" });
    expect(evaluateHybridPlannerGate({ repositoryPrivate: true, grant, tenantAllowlist: ["not a tenant id"], env })).toEqual({ enabled: false, reason: "tenant-not-allowlisted" });
  });

  it("fails closed when no repository grant is available", () => {
    expect(evaluateHybridPlannerGate({
      repositoryPrivate: true,
      tenantAllowlist: ["tenant_a"],
      env: { AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED: "true" }
    })).toEqual({ enabled: false, reason: "analysis-mode-not-enhanced" });
  });
});
