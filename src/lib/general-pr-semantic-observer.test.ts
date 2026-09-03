import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GENERAL_PR_SEMANTIC_OBSERVER_DEFAULT_TOTAL_BUDGET_MS,
  GeneralPrSemanticProviderFailure,
  runGeneralPrSemanticObserverV2,
  type GeneralPrSemanticObserverModelProfileV2,
  type GeneralPrSemanticObserverPackageV4
} from "./general-pr-semantic-observer";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  GitHubFetchError,
  GitHubPullRequestHeadChangedError,
  GitHubPullRequestSourceChangedError
} from "./github";
import { buildGeneralPrSemanticAggregateDiagnosticsV1 } from "./general-pr-observation-service";
import { submitGeneralPrSemanticObservationWithOpenAI } from "./openai-semantic";
import * as proposalContract from "./general-pr-semantic-proposal";
import type { PullRequestInput } from "./types";

afterEach(() => vi.useRealTimers());

const modelProfile: GeneralPrSemanticObserverModelProfileV2 = {
  model: "deployment-configured-model",
  promptVersion: "2026-08-31.v1",
  inputFieldPolicyVersion: "general_pr_observer_fields.v1"
};

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Return Ready when checks pass",
    description: "The service must return Ready when checks pass. Token: sk-123456789",
    taskText: "",
    changedFiles: [{ path: "src/private-status.ts", status: "modified", patch: "SECRET_PATCH_MUST_NOT_LEAVE_PROCESS" }],
    checks: [{ name: "PRIVATE CI CHECK", status: "passed", summary: "SECRET_LOG_MUST_NOT_LEAVE_PROCESS" }],
    logs: [{ source: "CI", text: "SECRET_LOG_MUST_NOT_LEAVE_PROCESS" }],
    repositoryPrivate: false,
    ...overrides
  };
}

function claimCandidate(request: Extract<GeneralPrSemanticObserverPackageV4, { stage: "claim_discovery" }>, withObjective = true) {
  const objective = request.input.spans.find((span) => span.deterministicRole === "objective_candidate") ?? request.input.spans[0];
  if (!objective) throw new Error("claim package must contain a span");
  return {
    spanRoles: request.input.spans.map((span) => ({
      spanId: span.id,
      role: withObjective && span.id === objective.id ? "objective_candidate" as const : "supporting_context" as const,
    }))
  };
}

const emptyEvidenceCandidate = {
  testApplicabilityProposals: [],
  scopeMappingProposals: [],
  evidenceRelationProposals: []
};

function stagedProvider(options: {
  claim?: (request: Extract<GeneralPrSemanticObserverPackageV4, { stage: "claim_discovery" }>) => unknown | Promise<unknown>;
  evidence?: (request: Extract<GeneralPrSemanticObserverPackageV4, { stage: "evidence_linking" }>) => unknown | Promise<unknown>;
} = {}) {
  return {
    observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => {
      if (request.stage === "claim_discovery") return options.claim ? options.claim(request) : claimCandidate(request);
      return options.evidence ? options.evidence(request) : emptyEvidenceCandidate;
    })
  };
}

const malformedProviderOutputs = [
  ["undefined", () => undefined],
  ["bigint", () => 1n],
  ["symbol", () => Symbol("MALFORMED_PROVIDER_SECRET")],
  ["cyclic object", () => {
    const value: Record<string, unknown> = { secret: "MALFORMED_PROVIDER_SECRET" };
    value.self = value;
    return value;
  }]
] as const;

function hostileProviderOutputs(stage: "claim" | "evidence") {
  const plain = () => stage === "claim"
    ? { spanRoles: [], objectiveGroups: [] }
    : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };
  const hostileKey = stage === "claim" ? "spanRoles" : "testApplicabilityProposals";
  return [
    ["throwing getter", () => {
      const value = plain() as Record<string, unknown>;
      Object.defineProperty(value, hostileKey, { enumerable: true, get: () => { throw new Error("HOSTILE_VALIDATOR_SECRET"); } });
      Object.defineProperty(value, "toJSON", { value: plain });
      return value;
    }],
    ["Proxy.get trap", () => new Proxy(plain(), {
      get(target, key, receiver) {
        if (key === "toJSON") return plain;
        if (key === hostileKey) throw new Error("HOSTILE_VALIDATOR_SECRET");
        return Reflect.get(target, key, receiver);
      }
    })],
    ["Proxy.ownKeys trap", () => {
      const target = plain();
      Object.defineProperty(target, "toJSON", { value: plain });
      return new Proxy(target, { ownKeys: () => { throw new Error("HOSTILE_VALIDATOR_SECRET"); } });
    }]
  ] as const;
}

function run(request: PullRequestInput, overrides: Partial<Parameters<typeof runGeneralPrSemanticObserverV2>[0]> = {}) {
  const seed = buildGeneralPrObservationSeedV2(request);
  return runGeneralPrSemanticObserverV2({
    mode: "shadow",
    input: request,
    seed,
    provider: stagedProvider(),
    providerAvailable: true,
    privateRepository: false,
    readCurrentInput: async () => request,
    modelProfile,
    ...overrides
  });
}

describe("GeneralPrSemanticObserverV3 staging", () => {
  it("sends a bounded redacted claim package instead of rejecting oversized full seeds", async () => {
    const request = input({
      title: "Return Ready with token sk-123456789",
      description: Array.from({ length: 20 }, (_, index) => `- The service must return Ready ${index}.`).join("\n"),
      changedFiles: Array.from({ length: 40 }, (_, index) => ({ path: `src/file-${index}.ts`, status: "modified" as const })),
      checks: Array.from({ length: 40 }, (_, index) => ({ name: `CI ${index}`, status: "passed" as const }))
    });
    const provider = stagedProvider();
    const result = await run(request, { provider });
    const semanticPackage = provider.observe.mock.calls[0]?.[0];

    expect(result.state).toBe("valid");
    expect(semanticPackage).toMatchObject({ stage: "claim_discovery", request: { store: false, maxOutputTokens: 3200 } });
    if (!semanticPackage || semanticPackage.stage !== "claim_discovery") throw new Error("claim package required");
    expect(semanticPackage.input.spans).toHaveLength(12);
    const serialized = JSON.stringify(semanticPackage);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toMatch(/sk-123456789|SECRET_PATCH_MUST_NOT_LEAVE_PROCESS|SECRET_LOG_MUST_NOT_LEAVE_PROCESS|src\/private-status\.ts/);
  });

  it("does not call the provider when no legal whole claim packet fits", async () => {
    const request = input({ title: "", description: `Requirement ${"x".repeat(13_000)}`, changedFiles: [], checks: [], logs: [] });
    const provider = stagedProvider();
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "unavailable",
      semanticFailureStage: "package",
      semanticPackageFailureReasons: ["selection_unavailable"],
      receipt: {
        version: 3,
        claimSelectionHash: null,
        evidenceSelectionHash: null,
        selectionHash: null,
        claimState: "not_run",
        evidenceState: "not_run"
      }
    });
    expect(provider.observe).toHaveBeenCalledTimes(0);
  });

  it("does not start claim discovery when its shared budget has already elapsed", async () => {
    const request = input();
    const provider = stagedProvider({ claim: async () => new Promise(() => undefined) });
    let now = 0;
    const result = await run(request, { provider, timeoutMs: 1, clock: () => now, readCurrentInput: async () => {
      now = 1;
      return request;
    } });

    expect(result).toMatchObject({ state: "timeout", semanticClaimInvalidReason: null, receipt: { claimState: "timeout", evidenceState: "not_run" } });
    expect(provider.observe).toHaveBeenCalledTimes(0);
  });

  it("gives the default claim call the full shared 60 second budget", async () => {
    const provider = stagedProvider();

    await run(input(), { provider, clock: () => 0 });

    expect(GENERAL_PR_SEMANTIC_OBSERVER_DEFAULT_TOTAL_BUDGET_MS).toBe(60_000);
    expect(provider.observe.mock.calls[0]?.[0].request.timeoutMs).toBe(60_000);
  });

  it("gives evidence only the time remaining after claim discovery", async () => {
    let now = 0;
    const provider = stagedProvider({ claim: (request) => {
      now += 40_000;
      return claimCandidate(request);
    } });

    await run(input(), { provider, clock: () => now });

    expect(provider.observe.mock.calls.map(([request]) => request.request.timeoutMs)).toEqual([60_000, 20_000]);
  });

  it("keeps valid claims when claim discovery exhausts the shared budget", async () => {
    let now = 0;
    const provider = stagedProvider({ claim: (request) => {
      now += 60_000;
      return claimCandidate(request);
    } });

    const result = await run(input(), { provider, clock: () => now });

    expect(result).toMatchObject({ state: "valid", semanticEvidenceInvalidReason: null, receipt: { claimState: "valid", evidenceState: "timeout" } });
    expect(provider.observe).toHaveBeenCalledTimes(1);
  });

  it("times out a never-settling claim exactly when the shared budget expires", async () => {
    vi.useFakeTimers();
    const provider = stagedProvider({ claim: async () => new Promise(() => undefined) });
    const result = run(input(), { provider });

    await vi.advanceTimersByTimeAsync(59_999);
    expect(provider.observe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toMatchObject({ state: "timeout", semanticProviderDiagnostic: { phase: "claim_discovery", category: "timeout" }, receipt: { claimState: "timeout", evidenceState: "not_run" } });
  });

  it("runs claim discovery once and rejects an invalid claim without starting evidence", async () => {
    const request = input();
    const provider = stagedProvider({ claim: async (claimPackage) => ({
      spanRoles: claimPackage.input.spans.slice(1).map((span) => ({ spanId: span.id, role: "supporting_context" }))
    }) });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "invalid",
      semanticClaimInvalidReason: "span_binding_invalid",
      receipt: { claimState: "invalid", evidenceState: "not_run" }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it.each(malformedProviderOutputs)("classifies malformed %s claim output without throwing or hashing raw data", async (_label, output) => {
    const request = input();
    const provider = stagedProvider({ claim: async () => output() });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "invalid",
      proposal: null,
      receipt: { claimState: "invalid", evidenceState: "not_run", claimOutputHash: null, evidenceOutputHash: null }
    });
    expect(JSON.stringify(result.receipt)).not.toContain("MALFORMED_PROVIDER_SECRET");
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it.each(hostileProviderOutputs("claim"))("contains claim validator exceptions from a %s", async (_label, output) => {
    const request = input();
    const provider = stagedProvider({ claim: async () => output() });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "invalid",
      proposal: null,
      receipt: { claimState: "invalid", evidenceState: "not_run", claimOutputHash: null }
    });
    expect(JSON.stringify(result.receipt)).not.toContain("HOSTILE_VALIDATOR_SECRET");
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it("runs claim discovery once and reports provider unavailability without starting evidence", async () => {
    const request = input();
    const provider = stagedProvider({ claim: async () => { throw new Error("provider unavailable"); } });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "unavailable",
      semanticFailureStage: "provider_request",
      semanticClaimInvalidReason: null,
      semanticEvidenceInvalidReason: null,
      receipt: { claimState: "unavailable", evidenceState: "not_run" }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it("returns a valid claims-only proposal for a valid no-candidate claim", async () => {
    const request = input();
    const provider = stagedProvider({ claim: (request) => claimCandidate(request, false) });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      semanticEvidenceInvalidReason: null,
      proposal: { objectiveGroups: {}, testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] },
      receipt: { claimState: "valid", evidenceState: "not_run", evidenceSelectionHash: null, evidencePromptHash: null, evidenceSchemaHash: null, evidenceOutputHash: null }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it("returns a valid claims-only proposal when no legal evidence packet exists", async () => {
    const request = input({ changedFiles: [], checks: [], logs: [] });
    const provider = stagedProvider();
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      proposal: { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] },
      receipt: { claimState: "valid", evidenceState: "not_run", evidenceSelectionHash: null }
    });
    expect(Object.keys(result.proposal?.objectiveGroups ?? {})).toHaveLength(1);
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it("budgets objective text before evidence selection so Stage B never exceeds the input limit", async () => {
    const request = input({
      title: "Status update",
      description: `The service must ${"remain ready ".repeat(700)}`,
      changedFiles: Array.from({ length: 30 }, (_, index) => ({ path: `src/feature-${index}/status-handler.ts`, status: "modified" as const })),
      checks: [],
      logs: []
    });
    const provider = stagedProvider({
      claim: (claimRequest) => {
        const objective = [...claimRequest.input.spans].sort((left, right) => right.text.length - left.text.length)[0]!;
        return {
          spanRoles: claimRequest.input.spans.map((span) => ({ spanId: span.id, role: span.id === objective.id ? "objective_candidate" as const : "supporting_context" as const }))
        };
      }
    });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      receipt: { claimState: "valid" },
      proposal: { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    const evidencePackage = provider.observe.mock.calls[1]?.[0];
    expect(evidencePackage?.stage).toBe("evidence_linking");
    expect(Buffer.byteLength(JSON.stringify(evidencePackage?.input), "utf8")).toBeLessThanOrEqual(12_000);
  });

  it("runs claim then evidence exactly once and merges a valid evidence response", async () => {
    const request = input();
    const provider = stagedProvider();
    const result = await run(request, { provider });

    expect(result).toMatchObject({ state: "valid", semanticEvidenceInvalidReason: null, receipt: { claimState: "valid", evidenceState: "valid" } });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(result.receipt.evidenceSelectionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("preserves claims-only output when evidence references an unselected ID", async () => {
    const request = input();
    const provider = stagedProvider({ evidence: (packet) => ({
      testApplicabilityProposals: [],
      scopeMappingProposals: [],
      evidenceRelationProposals: [{
        objectiveSpanIds: packet.input.objectiveGroups[0]!.objectiveSpanIds,
        evidenceId: "gpea_unselected",
        proposal: "supports"
      }]
    }) });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      semanticEvidenceInvalidReason: "reference_binding_invalid",
      receipt: { claimState: "valid", evidenceState: "invalid" },
      proposal: { evidenceRelationProposals: [] }
    });
  });

  it("records validator_exception without retaining a thrown validator detail", async () => {
    const request = input();
    const hostile = new Proxy({ ...emptyEvidenceCandidate }, { getPrototypeOf() { throw new Error("HOSTILE_VALIDATOR_SECRET"); } });
    const result = await run(request, { provider: stagedProvider({ evidence: () => hostile }) });

    expect(result).toMatchObject({ state: "valid", semanticEvidenceInvalidReason: "validator_exception", receipt: { claimState: "valid", evidenceState: "invalid" } });
    expect(JSON.stringify(result)).not.toContain("HOSTILE_VALIDATOR_SECRET");
  });

  it("records merge_binding_invalid while retaining validated claims", async () => {
    const original = proposalContract.mergeGeneralPrSemanticStageCandidatesV1;
    const spy = vi.spyOn(proposalContract, "mergeGeneralPrSemanticStageCandidatesV1").mockImplementation((seed, claim, evidence) => evidence === null
      ? original(seed, claim, evidence)
      : { valid: false, errors: ["forced merge rejection"] });
    try {
      const result = await run(input(), { provider: stagedProvider() });
      expect(result).toMatchObject({ state: "valid", semanticEvidenceInvalidReason: "merge_binding_invalid", receipt: { claimState: "valid", evidenceState: "invalid" }, proposal: { evidenceRelationProposals: [] } });
    } finally {
      spy.mockRestore();
    }
  });

  it("reads fresh input around each semantic stage in order", async () => {
    const request = input();
    const provider = stagedProvider();
    const events: string[] = [];
    provider.observe.mockImplementation(async (semanticPackage) => {
      events.push(semanticPackage.stage);
      return semanticPackage.stage === "claim_discovery" ? claimCandidate(semanticPackage) : emptyEvidenceCandidate;
    });
    const result = await run(request, { provider, readCurrentInput: async () => {
      events.push("read");
      return request;
    } });

    expect(result.state).toBe("valid");
    expect(events).toEqual(["read", "claim_discovery", "read", "read", "evidence_linking", "read"]);
  });

  it.each([
    ["head drift", () => new GitHubPullRequestHeadChangedError("a".repeat(40), "b".repeat(40), "final"), "stale", "head_changed"],
    ["base drift", () => new GitHubPullRequestHeadChangedError("a".repeat(40), "b".repeat(40), "final", "base"), "stale", "base_changed"],
    ["source drift", () => new GitHubPullRequestSourceChangedError(), "stale", "source_changed"],
    ["token rejection", () => new GitHubFetchError(401, "github_token_rejected", "private"), "unavailable", "auth_unavailable"],
    ["rate limit", () => new GitHubFetchError(429, "github_rate_limited", "private"), "unavailable", "rate_limited"],
    ["not found", () => new GitHubFetchError(404, "github_not_found", "private"), "unavailable", "fetch_failed"],
    ["unknown error", () => new Error("PRIVATE_FRESHNESS_ERROR"), "unavailable", "fetch_failed"]
  ] as const)("classifies %s at the before-claim freshness fence", async (_name, createError, state, reason) => {
    const provider = stagedProvider();
    const result = await run(input(), { provider, readCurrentInput: async () => { throw createError(); } });

    expect(result).toMatchObject({
      state,
      semanticFreshnessFailure: { phase: "before_claim", state, reason },
      proposal: null
    });
    expect(provider.observe).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("PRIVATE_FRESHNESS_ERROR");
  });

  it("discards claims when freshness is unavailable before evidence", async () => {
    const request = input();
    const provider = stagedProvider();
    let reads = 0;
    const result = await run(request, { provider, readCurrentInput: async () => {
      reads += 1;
      if (reads === 3) throw new GitHubFetchError(401, "github_auth_required", "private");
      return request;
    } });

    expect(result).toMatchObject({
      state: "unavailable",
      semanticFreshnessFailure: { phase: "before_evidence", state: "unavailable", reason: "auth_unavailable" },
      proposal: null,
      receipt: { claimState: "valid", evidenceState: "unavailable" }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it.each([
    ["timeout", async () => { throw new GeneralPrSemanticProviderFailure("provider_request", true); }, undefined],
    ["invalid", async () => ({}), undefined],
    ["unavailable", async () => { throw new Error("provider unavailable"); }, undefined]
  ] as const)("preserves valid claims when evidence is %s", async (evidenceState, evidence, timeoutMs) => {
    const request = input();
    const provider = stagedProvider({ evidence });
    const result = await run(request, { provider, timeoutMs });

    expect(result).toMatchObject({
      state: "valid",
      semanticEvidenceInvalidReason: evidenceState === "invalid" ? "root_shape_invalid" : null,
      receipt: { claimState: "valid", evidenceState },
      proposal: { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] }
    });
    expect(Object.keys(result.proposal?.objectiveGroups ?? {})).toHaveLength(1);
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
  });

  it.each(malformedProviderOutputs)("keeps valid claims when evidence output is malformed %s", async (_label, output) => {
    const request = input();
    const provider = stagedProvider({ evidence: async () => output() });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      semanticEvidenceInvalidReason: "output_limit_exceeded",
      receipt: { claimState: "valid", evidenceState: "invalid", evidenceOutputHash: null },
      proposal: { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] }
    });
    expect(Object.keys(result.proposal?.objectiveGroups ?? {})).toHaveLength(1);
    expect(JSON.stringify(result.receipt)).not.toContain("MALFORMED_PROVIDER_SECRET");
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
  });

  it.each(hostileProviderOutputs("evidence"))("keeps claims-only output when evidence validator meets a %s", async (_label, output) => {
    const request = input();
    const provider = stagedProvider({ evidence: async () => output() });
    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      receipt: { claimState: "valid", evidenceState: "invalid", evidenceOutputHash: null },
      proposal: { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] }
    });
    expect(Object.keys(result.proposal?.objectiveGroups ?? {})).toHaveLength(1);
    expect(JSON.stringify(result.receipt)).not.toContain("HOSTILE_VALIDATOR_SECRET");
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
  });

  it.each([
    ["before claim", 0, [input({ title: "Changed before claim" })]],
    ["after claim", 1, [input(), input({ title: "Changed after claim" })]],
    ["after evidence", 2, [input(), input(), input(), input({ title: "Changed after evidence" })]]
  ] as const)("fences stale input %s", async (_name, expectedCalls, reads) => {
    const request = input();
    const provider = stagedProvider();
    let readIndex = 0;
    const result = await run(request, { provider, readCurrentInput: async () => reads[readIndex++] ?? reads.at(-1)! });

    expect(result.state).toBe("stale");
    expect(provider.observe).toHaveBeenCalledTimes(expectedCalls);
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(expectedCalls === 2 ? ["claim_discovery", "evidence_linking"] : expectedCalls === 1 ? ["claim_discovery"] : []);
    expect(result.receipt).toMatchObject({
      claimState: expectedCalls === 0 ? "stale" : expectedCalls === 1 ? "stale" : "valid",
      evidenceState: expectedCalls === 2 ? "stale" : "not_run"
    });
    expect(result.proposal).toBeNull();
  });

  it("rechecks freshness before evidence and never starts Stage B on stale input", async () => {
    const request = input();
    const provider = stagedProvider();
    const reads = [request, request, input({ title: "Changed before evidence" })];
    let readIndex = 0;
    const result = await run(request, { provider, readCurrentInput: async () => reads[readIndex++]! });

    expect(result).toMatchObject({
      state: "stale",
      proposal: null,
      receipt: {
        claimState: "valid",
        evidenceState: "stale",
        evidenceSelectionHash: null,
        evidencePromptHash: null,
        evidenceSchemaHash: null,
        evidenceOutputHash: null
      }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it("reads freshness in order and stops after post-claim head drift", async () => {
    const request = input();
    const provider = stagedProvider();
    const events: string[] = [];
    const reads = [request, input({ title: "Changed after claim" })];
    let readIndex = 0;
    provider.observe.mockImplementation(async (semanticPackage) => {
      events.push(semanticPackage.stage);
      return semanticPackage.stage === "claim_discovery" ? claimCandidate(semanticPackage) : emptyEvidenceCandidate;
    });

    const result = await run(request, { provider, readCurrentInput: async () => {
      events.push(`read-${readIndex + 1}`);
      return reads[readIndex++]!;
    } });

    expect(events).toEqual(["read-1", "claim_discovery", "read-2"]);
    expect(result).toMatchObject({ state: "stale", semanticFreshnessFailure: { phase: "after_claim", state: "stale", reason: "seed_changed" }, receipt: { claimState: "stale", evidenceState: "not_run" } });
    expect(provider.observe).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["null snapshot", async (): Promise<null> => null, "snapshot_unavailable"],
    ["permission denial", async (): Promise<null> => { throw new GitHubFetchError(403, "github_permission_denied", "private"); }, "auth_unavailable"],
    ["secondary rate limit", async (): Promise<null> => { throw new GitHubFetchError(429, "github_secondary_rate_limited", "private"); }, "rate_limited"]
  ] as const)("classifies %s as unavailable without a provider call", async (_name, readCurrentInput, reason) => {
    const provider = stagedProvider();
    const result = await run(input(), { provider, readCurrentInput });

    expect(result).toMatchObject({ state: "unavailable", semanticFreshnessFailure: { phase: "before_claim", state: "unavailable", reason }, proposal: null });
    expect(provider.observe).not.toHaveBeenCalled();
  });

  it("records after-evidence seed drift when only a check changes", async () => {
    const request = input();
    const changed = input({ checks: [{ name: "PRIVATE CI CHECK", status: "failed", summary: "changed" }] });
    const provider = stagedProvider();
    let read = 0;
    const result = await run(request, { provider, readCurrentInput: async () => ++read === 4 ? changed : request });

    expect(result).toMatchObject({
      state: "stale",
      semanticFreshnessFailure: { phase: "after_evidence", state: "stale", reason: "seed_changed" },
      proposal: null,
      receipt: { claimState: "valid", evidenceState: "stale" }
    });
    expect(provider.observe).toHaveBeenCalledTimes(2);
  });

  it("discards both stages if the current subject becomes private after evidence", async () => {
    const request = input();
    const provider = stagedProvider();
    const reads = [request, request, request, { ...request, repositoryPrivate: true }];
    let readIndex = 0;
    const result = await run(request, { provider, readCurrentInput: async () => reads[readIndex++]! });

    expect(result).toMatchObject({
      state: "unavailable",
      semanticFailureStage: "privacy",
      semanticFreshnessFailure: { phase: "after_evidence", state: "unavailable", reason: "privacy_ineligible" },
      proposal: null,
      receipt: { claimState: "valid", evidenceState: "unavailable" }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
  });

  it("retains a closed evidence provider failure diagnostic while preserving valid claims", async () => {
    const request = input();
    const provider = stagedProvider();
    provider.observe.mockImplementation(async (semanticPackage) => {
      if (semanticPackage.stage === "claim_discovery") return claimCandidate(semanticPackage);
      throw new GeneralPrSemanticProviderFailure("provider_request", false, {
        phase: "evidence_linking", category: "rate_limited", httpStatus: 429
      });
    });

    const result = await run(request, { provider });

    expect(result).toMatchObject({
      state: "valid",
      semanticFailureStage: "provider_request",
      semanticProviderDiagnostic: { phase: "evidence_linking", category: "rate_limited", httpStatus: 429 },
      receipt: { claimState: "valid", evidenceState: "unavailable" }
    });
  });

  it.each([
    ["invalid schema", () => new Response(JSON.stringify({ error: { code: "invalid_json_schema", message: "PROVIDER_SECRET" } }), { status: 400 }), { category: "invalid_json_schema", httpStatus: 400 }],
    ["rate limited", () => new Response("PROVIDER_SECRET", { status: 429 }), { category: "rate_limited", httpStatus: 429 }],
    ["provider unavailable", () => new Response("PROVIDER_SECRET", { status: 503 }), { category: "provider_unavailable", httpStatus: 503 }],
    ["malformed JSON", () => new Response("not JSON"), { category: "response_invalid" }],
    ["incomplete max output", () => Response.json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output_text: "PROVIDER_SECRET" }), { category: "incomplete", incompleteReason: "max_output_tokens" }]
  ] as const)("carries closed %s diagnostics across the real observer-adapter HTTP boundary", async (_name, response, expected) => {
    let calls = 0;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1;
      if (calls > 1) return response();
      const requestInput = JSON.parse(JSON.parse(String(init.body)).input[1].content[0].text);
      return Response.json({ output_text: JSON.stringify({
        spanRoles: requestInput.spans.map((span: { id: string }, index: number) => ({ spanId: span.id, role: index === 0 ? "objective_candidate" : "supporting_context" }))
      }) });
    });
    const result = await run(input(), {
      provider: { observe: (semanticPackage) => submitGeneralPrSemanticObservationWithOpenAI(semanticPackage, { apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch }) }
    });

    expect(result).toMatchObject({
      state: "valid",
      semanticFailureStage: ["incomplete", "response_invalid"].includes(expected.category) ? "provider_response" : "provider_request",
      semanticProviderDiagnostic: { phase: "evidence_linking", ...expected },
      receipt: { claimState: "valid", evidenceState: "unavailable" }
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(buildGeneralPrSemanticAggregateDiagnosticsV1(result, 2).stageDiagnostics.providerFailure).toEqual({ phase: "evidence_linking", ...expected });
    expect(JSON.stringify(result)).not.toContain("PROVIDER_SECRET");
  });

  it("accepts a valid two-stage result across the real observer-adapter HTTP boundary", async () => {
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const input = JSON.parse(body.input[1].content[0].text);
      return Response.json({ output_text: JSON.stringify(body.text.format.name.includes("claim")
        ? { spanRoles: input.spans.map((span: { id: string }, index: number) => ({ spanId: span.id, role: index === 0 ? "objective_candidate" : "supporting_context" })) }
        : emptyEvidenceCandidate) });
    });
    const result = await run(input(), {
      provider: { observe: (semanticPackage) => submitGeneralPrSemanticObservationWithOpenAI(semanticPackage, { apiKey: "test-key", fetchFn: fetchFn as unknown as typeof fetch }) }
    });

    expect(result).toMatchObject({ state: "valid", semanticProviderDiagnostic: null, receipt: { claimState: "valid", evidenceState: "valid" } });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fails closed before either stage when current repository visibility is private", async () => {
    const request = input();
    const provider = stagedProvider();
    const result = await run(request, { provider, readCurrentInput: async () => ({ ...request, repositoryPrivate: true }) });

    expect(result).toMatchObject({ state: "unavailable", semanticFailureStage: "privacy", semanticFreshnessFailure: { phase: "before_claim", state: "unavailable", reason: "privacy_ineligible" }, receipt: { claimState: "unavailable", evidenceState: "not_run" } });
    expect(provider.observe).toHaveBeenCalledTimes(0);
  });
});

describe("GeneralPrSemanticInvocationReceiptV3", () => {
  it("uses null selection and stage hashes when disabled before selection", async () => {
    const request = input();
    const provider = stagedProvider();
    const result = await run(request, { mode: "disabled", provider });

    expect(result).toMatchObject({
      state: "disabled",
      receipt: {
        version: 3,
        claimSelectionHash: null,
        evidenceSelectionHash: null,
        selectionHash: null,
        claimState: "not_run",
        evidenceState: "not_run",
        claimOutputHash: null,
        evidencePromptHash: null,
        evidenceSchemaHash: null,
        evidenceOutputHash: null
      }
    });
    expect(provider.observe).toHaveBeenCalledTimes(0);
  });

  it("separates claim/evidence prompt, schema, and output hashes", async () => {
    const request = input();
    const result = await run(request);

    expect(result.receipt).toMatchObject({ version: 3, claimState: "valid", evidenceState: "valid" });
    for (const value of [
      result.receipt.claimPromptHash,
      result.receipt.claimSchemaHash,
      result.receipt.claimOutputHash,
      result.receipt.evidencePromptHash,
      result.receipt.evidenceSchemaHash,
      result.receipt.evidenceOutputHash,
      result.receipt.receiptHash
    ]) expect(value).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.claimPromptHash).not.toBe(result.receipt.evidencePromptHash);
    expect(result.receipt.claimSchemaHash).not.toBe(result.receipt.evidenceSchemaHash);
    expect(result.receipt.claimOutputHash).not.toBe(result.receipt.evidenceOutputHash);
  });

  it("changes safe aggregate selection bindings when selected IDs or allowlists change", async () => {
    const one = input({ description: "The service must return Ready." });
    const two = input({ description: "The service must return Ready.\n\nThe status must remain readable." });
    const noEvidence = input({ description: one.description, changedFiles: [], checks: [], logs: [] });
    const first = await run(one);
    const changedClaims = await run(two);
    const changedEvidence = await run(noEvidence);

    expect(first.receipt.claimSelectionHash).not.toBe(changedClaims.receipt.claimSelectionHash);
    expect(first.receipt.selectionHash).not.toBe(changedClaims.receipt.selectionHash);
    expect(first.receipt.evidenceSelectionHash).not.toBe(changedEvidence.receipt.evidenceSelectionHash);
    expect(first.receipt.selectionHash).not.toBe(changedEvidence.receipt.selectionHash);
  });

  it("contains hashes and closed states only, never source, descriptors, provider output, or secrets", async () => {
    const request = input();
    const provider = stagedProvider({ evidence: async () => ({ ...emptyEvidenceCandidate, privateProviderSentinel: "PROVIDER_PRIVATE_OUTPUT" }) });
    const result = await run(request, { provider });
    const serialized = JSON.stringify({ receipt: result.receipt, manifest: result.selectionManifest });

    expect(serialized).not.toMatch(/Return Ready|private-status|sk-123456789|PRIVATE CI CHECK|SECRET_|PROVIDER_PRIVATE_OUTPUT|tokenSketch|objectiveGroups|changeClusterId|evidenceId/);
    expect(result.selectionManifest).toMatchObject({ version: 1, claimPacketCount: 1, evidencePacketCount: 1 });
  });
});
