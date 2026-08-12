import { describe, expect, it } from "vitest";
import { resolveHybridWorkerProtocol } from "./hybrid-worker-routing";

describe("hybrid worker protocol routing", () => {
  it("keeps active null/null provider continuations on the legacy path", () => {
    expect(resolveHybridWorkerProtocol(job({
      planner_contract_version: null,
      planner_input_hash: null,
      provider_response_id: "resp_legacy_123",
      provider_status: "in_progress"
    }), true)).toBe("legacy");
  });

  it("keeps an unbound null/null analysis on the legacy path", () => {
    expect(resolveHybridWorkerProtocol(job(), true)).toBe("legacy");
  });

  it("starts an explicitly requested null/null analysis at the hybrid submit phase", () => {
    expect(resolveHybridWorkerProtocol(job({ hybrid_planner_requested: true }), true)).toBe("hybrid_submit");
  });

  it("starts only an explicitly pre-bound analysis at the hybrid submit phase", () => {
    expect(resolveHybridWorkerProtocol(job({
      hybrid_planner_requested: true,
      planner_contract_version: "hybrid_requirement_planner.v1",
      planner_input_hash: "a".repeat(64)
    }), true)).toBe("hybrid_submit");
  });

  it("retrieves only a bound hybrid response and never resubmits a submitting/uncertain job", () => {
    expect(resolveHybridWorkerProtocol(job({
      hybrid_planner_requested: true,
      planner_contract_version: "hybrid_requirement_planner.v1",
      planner_input_hash: "a".repeat(64),
      provider_response_id: "resp_hybrid_123",
      provider_status: "queued"
    }), true)).toBe("hybrid_retrieve");
    expect(resolveHybridWorkerProtocol(job({
      hybrid_planner_requested: true,
      planner_contract_version: "hybrid_requirement_planner.v1",
      planner_input_hash: "a".repeat(64),
      provider_response_id: null,
      provider_status: "submitting"
    }), true)).toBe("hybrid_fallback");
  });

  it("leaves non-tenant and malformed rows out of the hybrid protocol", () => {
    expect(resolveHybridWorkerProtocol(job(), false)).toBe("legacy");
    expect(resolveHybridWorkerProtocol(job({ planner_input_hash: undefined }), true)).toBe("hybrid_fallback");
  });

  it.each([
    ["missing", Symbol("missing")],
    ["undefined", undefined],
    ["null", null],
    ["string", "false"],
    ["number", 0]
  ])("fails closed for %s hybrid intent instead of converting it to legacy", (_name, intent) => {
    const candidate = job({ hybrid_planner_requested: intent });
    if (typeof intent === "symbol") delete (candidate as Record<string, unknown>).hybrid_planner_requested;
    expect(resolveHybridWorkerProtocol(candidate, true)).toBe("hybrid_fallback");
  });
});

function job(overrides: Record<string, unknown> = {}) {
  return {
    hybrid_planner_requested: false,
    planner_contract_version: null,
    planner_input_hash: null,
    provider_response_id: null,
    provider_status: null,
    provider_poll_attempts: 0,
    provider_submitted_at: null,
    provider_expires_at: null,
    provider_webhook_id_hash: null,
    provider_webhook_received_at: null,
    semantic_retry_attempts: 0,
    prior_provider_response_id: null,
    prior_provider_submitted_at: null,
    prior_provider_expires_at: null,
    ...overrides
  };
}
