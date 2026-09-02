import { describe, expect, it, vi } from "vitest";
import {
  buildGeneralPrSemanticObserverPackageV2,
  GeneralPrSemanticProviderFailure,
  runGeneralPrSemanticObserverV2,
  type GeneralPrSemanticObserverModelProfileV2,
  type GeneralPrSemanticObserverPackageV3
} from "./general-pr-semantic-observer";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type { PullRequestInput } from "./types";

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

function claimCandidate(request: Extract<GeneralPrSemanticObserverPackageV3, { stage: "claim_discovery" }>, withObjective = true) {
  const objective = request.input.spans.find((span) => span.deterministicRole === "objective_candidate") ?? request.input.spans[0];
  if (!objective) throw new Error("claim package must contain a span");
  return {
    spanRoles: request.input.spans.map((span) => ({
      spanId: span.id,
      role: withObjective && span.id === objective.id ? "objective_candidate" as const : "supporting_context" as const,
      abstained: false
    })),
    objectiveGroups: withObjective ? [{ spanIds: [objective.id], disposition: "candidate" as const }] : []
  };
}

const emptyEvidenceCandidate = {
  testApplicabilityProposals: [],
  scopeMappingProposals: [],
  evidenceRelationProposals: []
};

function stagedProvider(options: {
  claim?: (request: Extract<GeneralPrSemanticObserverPackageV3, { stage: "claim_discovery" }>) => unknown | Promise<unknown>;
  evidence?: (request: Extract<GeneralPrSemanticObserverPackageV3, { stage: "evidence_linking" }>) => unknown | Promise<unknown>;
} = {}) {
  return {
    observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV3) => {
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
  it("builds a bounded redacted claim package instead of rejecting oversized full seeds", () => {
    const request = input({
      title: "Return Ready with token sk-123456789",
      description: Array.from({ length: 20 }, (_, index) => `- The service must return Ready ${index}.`).join("\n"),
      changedFiles: Array.from({ length: 40 }, (_, index) => ({ path: `src/file-${index}.ts`, status: "modified" as const })),
      checks: Array.from({ length: 40 }, (_, index) => ({ name: `CI ${index}`, status: "passed" as const }))
    });
    const semanticPackage = buildGeneralPrSemanticObserverPackageV2(request, buildGeneralPrObservationSeedV2(request), modelProfile);

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

  it("runs claim discovery once and reports timeout without starting evidence", async () => {
    const request = input();
    const provider = stagedProvider({ claim: async () => new Promise(() => undefined) });
    const result = await run(request, { provider, timeoutMs: 1 });

    expect(result).toMatchObject({ state: "timeout", receipt: { claimState: "timeout", evidenceState: "not_run" } });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery"]);
  });

  it("runs claim discovery once and rejects an invalid claim without starting evidence", async () => {
    const request = input();
    const provider = stagedProvider({ claim: async () => ({}) });
    const result = await run(request, { provider });

    expect(result).toMatchObject({ state: "invalid", receipt: { claimState: "invalid", evidenceState: "not_run" } });
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
          spanRoles: claimRequest.input.spans.map((span) => ({ spanId: span.id, role: span.id === objective.id ? "objective_candidate" as const : "supporting_context" as const, abstained: false })),
          objectiveGroups: [{ spanIds: [objective.id], disposition: "candidate" as const }]
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

    expect(result).toMatchObject({ state: "valid", receipt: { claimState: "valid", evidenceState: "valid" } });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(result.receipt.evidenceSelectionHash).toMatch(/^[a-f0-9]{64}$/);
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

  it("discards both stages if the current subject becomes private after evidence", async () => {
    const request = input();
    const provider = stagedProvider();
    const reads = [request, request, request, { ...request, repositoryPrivate: true }];
    let readIndex = 0;
    const result = await run(request, { provider, readCurrentInput: async () => reads[readIndex++]! });

    expect(result).toMatchObject({
      state: "unavailable",
      semanticFailureStage: "privacy",
      proposal: null,
      receipt: { claimState: "valid", evidenceState: "unavailable" }
    });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
  });

  it("fails closed before either stage when current repository visibility is private", async () => {
    const request = input();
    const provider = stagedProvider();
    const result = await run(request, { provider, readCurrentInput: async () => ({ ...request, repositoryPrivate: true }) });

    expect(result).toMatchObject({ state: "unavailable", semanticFailureStage: "privacy", receipt: { claimState: "unavailable", evidenceState: "not_run" } });
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
