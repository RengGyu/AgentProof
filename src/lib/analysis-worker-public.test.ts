import { describe, expect, it } from "vitest";
import { toPublicAnalysisWorkerRunResult } from "./analysis-worker-public";

describe("analysis worker public projection", () => {
  it("exposes a safe waiting state without provider continuation metadata", () => {
    const result = toPublicAnalysisWorkerRunResult({
      status: "waiting_provider",
      job: {
        id: "job_1",
        status: "processing",
        tenant_id: "tenant_a",
        idempotency_key_hash: "f".repeat(64),
        event: "pull_request",
        installation_id: 321,
        repository_id: 100,
        repository_full_name: "RengGyu/AgentProof",
        pull_request_number: 7,
        pull_request_url: "https://github.com/RengGyu/AgentProof/pull/7",
        head_sha: "a".repeat(40),
        save_report: true,
        comment: false,
        attempts: 2,
        created_at: "2026-06-30T00:00:00.000Z",
        updated_at: "2026-06-30T00:01:00.000Z",
        run_after: "2026-06-30T00:01:15.000Z",
        claim_generation: "123e4567-e89b-42d3-a456-426614174300",
        provider_response_id: "resp_background_123",
        provider_status: "in_progress",
        provider_poll_attempts: 2,
        provider_submitted_at: "2026-06-30T00:01:00.000Z",
        provider_expires_at: "2026-06-30T00:09:00.000Z"
      },
      sideEffects: { saveReport: true, comment: false }
    });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      status: "waiting_provider",
      job: { id: "job_1", pullRequestNumber: 7, attempts: 2 }
    });
    expect(serialized).not.toContain("resp_background_123");
    expect(serialized).not.toContain("provider_");
    expect(serialized).not.toContain("claim_generation");
    expect(serialized).not.toContain("123e4567-e89b-42d3-a456-426614174300");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("RengGyu/AgentProof");
  });
});
