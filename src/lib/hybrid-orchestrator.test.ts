import { describe, expect, it, vi } from "vitest";
import { buildHybridPlannerPlan, HYBRID_PLANNER_CONTRACT_VERSION } from "./hybrid-planner";
import {
  runHybridPlannerAnalysis,
  type HybridPlannerGateDecision,
  type HybridPlannerTransport
} from "./hybrid-orchestrator";
import { generateHybridFallbackReport } from "./hybrid-report-finalizer";
import { generateVerificationReport } from "./verifier";
import type { PullRequestInput } from "./types";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const ENABLED_GATE: HybridPlannerGateDecision = { enabled: true };

describe("hybrid planner orchestration", () => {
  it.each([
    "repository-not-private",
    "analysis-mode-not-enhanced",
    "consent-not-granted",
    "tenant-not-allowlisted",
    "pilot-disabled"
  ] as const)("returns exact BASE with zero package or POST when the %s gate is missing", async (reason) => {
    const transport = transportDouble();
    const input = privateInput();

    const result = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue({ enabled: false, reason }),
      transport,
      clock: () => NOW
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(stripOperationalFields(result.report)).toEqual(stripOperationalFields(generateHybridFallbackReport(input, "disabled")));
    expect(result.telemetry).toMatchObject({ postCount: 0, outcomeCode: reason });
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.retrieve).not.toHaveBeenCalled();
  });

  it("suppresses an identical-content linked Issue relink during sync provider work", async () => {
    const before = { ...privateInput(), requirementSourceIdentityHash: "1".repeat(64) };
    const after = { ...privateInput(), requirementSourceIdentityHash: "2".repeat(64) };
    const transport = transportDouble({
      submit: vi.fn(async (request) => ({
        status: "completed" as const,
        candidate: buildHybridPlannerPlan(request.seed, before.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), before.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });

    const result = await runHybridPlannerAnalysis({
      phase: "sync",
      input: before,
      readCurrentInput: vi.fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport,
      clock: () => NOW
    });

    expect(result).toMatchObject({
      status: "ready",
      publicationSuppressed: true,
      telemetry: { postCount: 1, outcomeCode: "stale_source" }
    });
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(transport.retrieve).not.toHaveBeenCalled();
  });

  it("performs one sync POST with the strict Task 2 package and finalizes only the validated plan", async () => {
    const input = privateInput();
    const transport = transportDouble({
      submit: vi.fn(async (request) => ({
        status: "completed" as const,
        candidate: buildHybridPlannerPlan(request.seed, input.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), input.requirementSourceIdentityHash)!,
        outputBytes: 512,
        outputTokens: 123
      }))
    });
    const readGate = vi.fn().mockResolvedValue(ENABLED_GATE);

    const result = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: async () => input,
      readGate,
      transport,
      clock: () => NOW
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(result.report.planner).toMatchObject({ contractVersion: HYBRID_PLANNER_CONTRACT_VERSION });
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(transport.retrieve).not.toHaveBeenCalled();
    const submitted = vi.mocked(transport.submit).mock.calls[0]![0];
    expect(submitted.background).toBe(false);
    expect(submitted.package.request.store).toBe(false);
    expect(submitted.package.request.response_format.json_schema.strict).toBe(true);
    expect(JSON.stringify(submitted.package)).not.toContain(input.requirementSourceIdentityHash);
    expect(JSON.stringify(result.report)).not.toContain(input.requirementSourceIdentityHash);
    expect(JSON.stringify(result.telemetry)).not.toContain(input.requirementSourceIdentityHash);
    expect(readGate).toHaveBeenCalledTimes(3);
    expect(result.telemetry).toMatchObject({ postCount: 1, outcomeCode: "completed", outputBytes: 512, outputTokens: 123 });
  });

  it.each(["malformed", "partial", "oversized", "hash_mismatch"] as const)(
    "uses one whole-report fallback and never repairs or resubmits %s output",
    async (kind) => {
      const input = privateInput();
      const transport = transportDouble({
        submit: vi.fn(async (request) => {
          const valid = buildHybridPlannerPlan(request.seed, input.sourceProvenance!, request.seed.spans.map(() => ({
            disposition: "admit" as const,
            classification: "requirement" as const,
            expected_axes: []
          })), input.requirementSourceIdentityHash)!;
          if (kind === "malformed") return { status: "completed" as const, candidate: "not-json", outputBytes: 8, outputTokens: 1 };
          if (kind === "partial") return { status: "completed" as const, candidate: { ...valid, span_decisions: {} }, outputBytes: 32, outputTokens: 4 };
          if (kind === "oversized") return { status: "completed" as const, candidate: { ...valid, extra: "x".repeat(17_000) }, outputBytes: 17_100, outputTokens: 3_200 };
          return { status: "completed" as const, candidate: { ...valid, seed_hash: "f".repeat(64) }, outputBytes: 512, outputTokens: 123 };
        })
      });

      const result = await runHybridPlannerAnalysis({
        phase: "sync",
        input,
        readCurrentInput: async () => input,
        readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
        transport,
        clock: () => NOW
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("expected ready result");
      expect(stripOperationalFields(result.report)).toEqual(stripOperationalFields(generateHybridFallbackReport(input, "post_call_failure")));
      expect(result.telemetry).toMatchObject({ postCount: 1, outcomeCode: "invalid_output" });
      expect(transport.submit).toHaveBeenCalledTimes(1);
      expect(transport.retrieve).not.toHaveBeenCalled();
    }
  );

  it("treats an uncertain sync submission as final fallback without retry", async () => {
    const input = privateInput();
    const transport = transportDouble({
      submit: vi.fn().mockRejectedValue(new Error("submission acceptance unknown"))
    });

    const result = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport,
      clock: () => NOW
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(stripOperationalFields(result.report)).toEqual(stripOperationalFields(generateHybridFallbackReport(input, "post_call_failure")));
    expect(result.telemetry).toMatchObject({ postCount: 1, outcomeCode: "submission_uncertain" });
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it("binds the current seed before one background POST and returns only opaque continuation metadata", async () => {
    const input = privateInput();
    const order: string[] = [];
    const transport = transportDouble({
      submit: vi.fn(async () => {
        order.push("post");
        return { status: "pending" as const, responseId: "resp_hybrid_123", providerStatus: "queued" as const, outputBytes: 0, outputTokens: 0 };
      })
    });
    const bindBeforeSubmit = vi.fn(async () => { order.push("bind"); return true; });
    const beforePost = vi.fn(async () => { order.push("mark"); return true; });

    const result = await runHybridPlannerAnalysis({
      phase: "background_submit",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      bindBeforeSubmit,
      beforePost,
      checkBinding: vi.fn().mockReturnValue({ disposition: "ready" }),
      transport,
      clock: () => NOW
    });

    expect(result).toMatchObject({ status: "pending", responseId: "resp_hybrid_123", providerStatus: "queued" });
    expect(order).toEqual(["bind", "mark", "post"]);
    expect(bindBeforeSubmit).toHaveBeenCalledWith(expect.objectContaining({ contractVersion: HYBRID_PLANNER_CONTRACT_VERSION, inputHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(transport.submit).toHaveBeenCalledTimes(1);
  });

  it("uses same-ID GETs only and checks rebuilt/job/response hashes before background finalization", async () => {
    const input = privateInput();
    const transport = transportDouble({
      retrieve: vi.fn(async (responseId, request) => ({
        status: "completed" as const,
        responseId,
        candidate: buildHybridPlannerPlan(request.seed, input.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), input.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });
    const checkBinding = vi.fn().mockReturnValue({ disposition: "ready" });

    const result = await runHybridPlannerAnalysis({
      phase: "background_retrieve",
      responseId: "resp_hybrid_123",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      checkBinding,
      transport,
      clock: () => NOW
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(result.report.planner).toBeDefined();
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.retrieve).toHaveBeenCalledTimes(1);
    expect(transport.retrieve).toHaveBeenCalledWith("resp_hybrid_123", expect.any(Object));
    expect(checkBinding).toHaveBeenNthCalledWith(1, expect.objectContaining({ phase: "submit", rebuiltInputHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(checkBinding).toHaveBeenNthCalledWith(2, expect.objectContaining({ phase: "response", responseInputHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  });

  it("re-reads the kill switch after binding and makes zero POSTs if disabled before submit", async () => {
    const input = privateInput();
    const transport = transportDouble();
    const readGate = vi.fn()
      .mockResolvedValueOnce(ENABLED_GATE)
      .mockResolvedValueOnce({ enabled: false, reason: "pilot-disabled" });

    const result = await runHybridPlannerAnalysis({
      phase: "background_submit",
      input,
      readCurrentInput: async () => input,
      readGate,
      bindBeforeSubmit: vi.fn().mockResolvedValue(true),
      checkBinding: vi.fn().mockReturnValue({ disposition: "ready" }),
      transport,
      clock: () => NOW
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(stripOperationalFields(result.report)).toEqual(stripOperationalFields(generateHybridFallbackReport(input, "post_call_failure")));
    expect(result.telemetry).toMatchObject({ postCount: 0, outcomeCode: "pilot-disabled" });
    expect(transport.submit).not.toHaveBeenCalled();
  });

  it("re-reads the gate before finalization and makes a retrieved late result a safe no-op fallback", async () => {
    const input = privateInput();
    const transport = transportDouble({
      retrieve: vi.fn(async (responseId, request) => ({
        status: "completed" as const,
        responseId,
        candidate: buildHybridPlannerPlan(request.seed, input.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), input.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });
    const readGate = vi.fn()
      .mockResolvedValueOnce(ENABLED_GATE)
      .mockResolvedValueOnce(ENABLED_GATE)
      .mockResolvedValueOnce({ enabled: false, reason: "pilot-disabled" });

    const result = await runHybridPlannerAnalysis({
      phase: "background_retrieve",
      responseId: "resp_hybrid_123",
      input,
      readCurrentInput: async () => input,
      readGate,
      checkBinding: vi.fn().mockReturnValue({ disposition: "ready" }),
      transport,
      clock: () => NOW
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(stripOperationalFields(result.report)).toEqual(stripOperationalFields(generateHybridFallbackReport(input, "post_call_failure")));
    expect(result.telemetry).toMatchObject({ postCount: 0, outcomeCode: "pilot-disabled" });
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.retrieve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["linked Issue edit", {
      taskText: "Acceptance criteria:\n- Add retry handling.",
      taskSource: "issue" as const
    }, {
      taskText: "Acceptance criteria:\n- Add circuit breaking.",
      taskSource: "issue" as const
    }],
    ["PR description edit", {
      taskText: "",
      taskSource: undefined,
      description: "Add retry handling."
    }, {
      taskText: "",
      taskSource: undefined,
      description: "Add circuit breaking."
    }],
    ["Issue unlink", {
      taskText: "Acceptance criteria:\n- Add retry handling.",
      taskSource: "issue" as const
    }, {
      taskText: "",
      taskSource: undefined,
      description: "Add retry handling."
    }],
    ["source authority change", {
      taskText: "Acceptance criteria:\n- Add retry handling.",
      taskSource: "task" as const
    }, {
      taskText: "Acceptance criteria:\n- Add retry handling.",
      taskSource: "issue" as const
    }]
  ])("suppresses publication when a same-head %s changes during sync provider work", async (_name, beforePatch, afterPatch) => {
    const before = { ...privateInput(), ...beforePatch };
    const after = { ...privateInput(), ...afterPatch };
    const readCurrentInput = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const transport = transportDouble({
      submit: vi.fn(async (request) => ({
        status: "completed" as const,
        candidate: buildHybridPlannerPlan(request.seed, before.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), before.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });

    const result = await runHybridPlannerAnalysis({
      phase: "sync",
      input: before,
      readCurrentInput,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport,
      clock: () => NOW
    });

    expect(result).toMatchObject({
      status: "ready",
      publicationSuppressed: true,
      telemetry: { postCount: 1, outcomeCode: "stale_source" }
    });
    expect(readCurrentInput).toHaveBeenCalledTimes(2);
    expect(transport.submit).toHaveBeenCalledTimes(1);
    expect(transport.retrieve).not.toHaveBeenCalled();
  });

  it("re-reads linked Issue source around a background GET and suppresses stale output without a POST", async () => {
    const before = privateInput();
    const after = { ...privateInput(), taskText: "Acceptance criteria:\n- Add circuit breaking." };
    const readCurrentInput = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const transport = transportDouble({
      retrieve: vi.fn(async (responseId, request) => ({
        status: "completed" as const,
        responseId,
        candidate: buildHybridPlannerPlan(request.seed, before.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), before.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });

    const result = await runHybridPlannerAnalysis({
      phase: "background_retrieve",
      responseId: "resp_hybrid_123",
      input: before,
      readCurrentInput,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      checkBinding: vi.fn().mockReturnValue({ disposition: "ready" }),
      transport,
      clock: () => NOW
    });

    expect(result).toMatchObject({
      status: "ready",
      publicationSuppressed: true,
      telemetry: { postCount: 0, outcomeCode: "stale_source" }
    });
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.retrieve).toHaveBeenCalledTimes(1);
  });

  it("suppresses an identical-content linked Issue relink after a background GET without resubmitting", async () => {
    const before = { ...privateInput(), requirementSourceIdentityHash: "1".repeat(64) };
    const after = { ...privateInput(), requirementSourceIdentityHash: "2".repeat(64) };
    const transport = transportDouble({
      retrieve: vi.fn(async (responseId, request) => ({
        status: "completed" as const,
        responseId,
        candidate: buildHybridPlannerPlan(request.seed, before.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), before.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });

    const result = await runHybridPlannerAnalysis({
      phase: "background_retrieve",
      responseId: "resp_hybrid_123",
      input: before,
      readCurrentInput: vi.fn()
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce(after),
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      checkBinding: vi.fn().mockReturnValue({ disposition: "ready" }),
      transport,
      clock: () => NOW
    });

    expect(result).toMatchObject({
      status: "ready",
      publicationSuppressed: true,
      telemetry: { postCount: 0, outcomeCode: "stale_source" }
    });
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.retrieve).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", undefined],
    ["uppercase", "A".repeat(64)],
    ["short", "0".repeat(63)],
    ["numeric", 0 as unknown as string],
    ["coercible object", { toString: () => "0".repeat(64) } as unknown as string]
  ])("fails closed before transport for a %s GitHub source identity", async (_name, identityHash) => {
    const input = privateInput();
    if (identityHash === undefined) delete input.requirementSourceIdentityHash;
    else input.requirementSourceIdentityHash = identityHash;
    const transport = transportDouble();

    const result = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport,
      clock: () => NOW
    });

    expect(result).toMatchObject({
      status: "ready",
      publicationSuppressed: true,
      telemetry: { postCount: 0, outcomeCode: "stale_source" }
    });
    expect(transport.submit).not.toHaveBeenCalled();
    expect(transport.retrieve).not.toHaveBeenCalled();
  });

  it("fails closed when fresh source cannot be read before package or finalization", async () => {
    const input = privateInput();
    const transport = transportDouble();
    const beforePackage = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: vi.fn().mockResolvedValue(null),
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport,
      clock: () => NOW
    });
    expect(beforePackage).toMatchObject({
      publicationSuppressed: true,
      telemetry: { postCount: 0, outcomeCode: "stale_source" }
    });
    expect(transport.submit).not.toHaveBeenCalled();

    const completedTransport = transportDouble({
      submit: vi.fn(async (request) => ({
        status: "completed" as const,
        candidate: buildHybridPlannerPlan(request.seed, input.sourceProvenance!, request.seed.spans.map(() => ({
          disposition: "admit" as const,
          classification: "requirement" as const,
          expected_axes: []
        })), input.requirementSourceIdentityHash)!,
        outputBytes: 400,
        outputTokens: 100
      }))
    });
    const beforeFinalize = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: vi.fn()
        .mockResolvedValueOnce(input)
        .mockResolvedValueOnce(null),
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport: completedTransport,
      clock: () => NOW
    });
    expect(beforeFinalize).toMatchObject({
      publicationSuppressed: true,
      telemetry: { postCount: 1, outcomeCode: "stale_source" }
    });
    expect(completedTransport.submit).toHaveBeenCalledTimes(1);
  });

  it("produces structurally identical sync and background reports for the same fixed seed and plan", async () => {
    const input = privateInput();
    const completed = async (request: Parameters<HybridPlannerTransport["submit"]>[0]) => ({
      status: "completed" as const,
      candidate: buildHybridPlannerPlan(request.seed, input.sourceProvenance!, request.seed.spans.map(() => ({
        disposition: "admit" as const,
        classification: "requirement" as const,
        expected_axes: []
      })), input.requirementSourceIdentityHash)!,
      outputBytes: 400,
      outputTokens: 100
    });
    const sync = await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      transport: transportDouble({ submit: vi.fn(completed) }),
      clock: () => NOW
    });
    const background = await runHybridPlannerAnalysis({
      phase: "background_retrieve",
      responseId: "resp_hybrid_123",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue(ENABLED_GATE),
      checkBinding: vi.fn().mockReturnValue({ disposition: "ready" }),
      transport: transportDouble({
        retrieve: vi.fn(async (responseId, request) => ({ responseId, ...(await completed(request)) }))
      }),
      clock: () => NOW
    });

    expect(sync.status).toBe("ready");
    expect(background.status).toBe("ready");
    if (sync.status !== "ready" || background.status !== "ready") throw new Error("expected ready results");
    expect(stripOperationalFields(background.report)).toEqual(stripOperationalFields(sync.report));
  });

  it("emits telemetry with the exact bounded allowlist and no source, plan, response id, or hash", async () => {
    const input = privateInput();
    const telemetry = vi.fn();
    await runHybridPlannerAnalysis({
      phase: "sync",
      input,
      readCurrentInput: async () => input,
      readGate: vi.fn().mockResolvedValue({ enabled: false, reason: "tenant-not-allowlisted" }),
      transport: transportDouble(),
      telemetry,
      clock: () => NOW
    });

    const value = telemetry.mock.calls[0]![0];
    expect(Object.keys(value).sort()).toEqual([
      "contractVersion",
      "elapsedMs",
      "inputBytes",
      "model",
      "outcomeCode",
      "outputBytes",
      "outputTokens",
      "postCount",
      "promptVersion",
      "schemaVersion"
    ].sort());
    expect(JSON.stringify(value)).not.toContain(input.taskText);
    expect(JSON.stringify(value)).not.toContain("resp_");
    expect(JSON.stringify(value)).not.toMatch(/[a-f0-9]{64}/);
  });
});

function privateInput(): PullRequestInput {
  return {
    title: "Retry transient requests",
    description: "Implements retry handling.",
    taskText: "Acceptance criteria:\n- Add retry handling.",
    taskSource: "issue",
    requirementSourceIdentityHash: "d".repeat(64),
    changedFiles: [{ path: "src/retry.ts", status: "modified", patch: "+ export function retryRequest() {}" }],
    checks: [{ name: "retry tests", status: "passed", summary: "Retry tests passed." }],
    logs: [{ source: "retry tests", status: "passed", text: "retry tests passed" }],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
      evidenceCapturedAt: NOW.toISOString(),
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    }
  };
}

function transportDouble(overrides: Partial<HybridPlannerTransport> = {}): HybridPlannerTransport {
  return {
    submit: vi.fn().mockRejectedValue(new Error("unexpected submit")),
    retrieve: vi.fn().mockRejectedValue(new Error("unexpected retrieve")),
    ...overrides
  };
}

function stripOperationalFields<T extends { analysisId: string; createdAt: string }>(report: T) {
  const { analysisId: _analysisId, createdAt: _createdAt, ...structural } = report;
  return structural;
}
