import { describe, expect, it, vi } from "vitest";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  finalizeDeterministicGeneralPrObservationsV2,
  runGeneralPrObservationNowV2
} from "./general-pr-observation-service";
import { advanceQueuedGeneralPrObservationV2 } from "./general-pr-observation-worker";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";
import * as semanticObserver from "./general-pr-semantic-observer";
import type {
  GeneralPrSemanticObserverModelProfileV2,
  GeneralPrSemanticObserverPackageV4
} from "./general-pr-semantic-observer";
import type { PullRequestInput, VerificationReport } from "./types";

const input: PullRequestInput = {
  title: "Document the reset procedure",
  description: "The local reset procedure must be documented.",
  taskText: "",
  changedFiles: [{ path: "docs/reset.md", status: "modified" }],
  checks: [],
  logs: [],
  repositoryPrivate: false,
  sourceProvenance: {
    version: 1,
    origin: "github_snapshot",
    baseSha: "b".repeat(40),
    headSha: "a".repeat(40),
    changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
    evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
    inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
  }
};

const report = { schemaVersion: "verification-report.v2", analysisId: "worker-test" } as unknown as VerificationReport;
const modelProfile: GeneralPrSemanticObserverModelProfileV2 = {
  model: "test-model",
  promptVersion: "test-prompt.v1",
  inputFieldPolicyVersion: "test-fields.v1"
};

function validProposal(request: GeneralPrSemanticObserverPackageV4) {
  if (request.stage === "evidence_linking") {
    return { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };
  }
  const objective = request.input.spans.find((span) => span.deterministicRole === "objective_candidate") ?? request.input.spans[0];
  if (!objective) throw new Error("fixture must include an objective candidate");
  return {
    spanRoles: request.input.spans.map((span) => ({
      spanId: span.id,
      role: span.id === objective.id ? "objective_candidate" as const : "supporting_context" as const,
    }))
  };
}

describe("advanceQueuedGeneralPrObservationV2", () => {
  it("does not construct a bundle or call a provider while the rollout is disabled", async () => {
    const seed = buildGeneralPrObservationSeedV2(input);
    const provider = { observe: vi.fn(async () => ({})) };

    const result = await advanceQueuedGeneralPrObservationV2({
      mode: "disabled",
      input,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider,
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => input
    });

    expect(result).toMatchObject({ status: "completed", bundle: null, semantic: null });
    expect(provider.observe).not.toHaveBeenCalled();
  });

  it("uses the same deterministic bundle as the synchronous adapter without retaining source text", async () => {
    const seed = buildGeneralPrObservationSeedV2(input);
    const result = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      providerAvailable: false,
      readCurrentInput: async () => input
    });

    expect(result).toMatchObject({ status: "completed", current: { status: "completed", attempt: 1 } });
    expect(result.bundle?.ledgerDigest).toBe(finalizeDeterministicGeneralPrObservationsV2(seed).ledgerDigest);
    expect(result.semantic).toMatchObject({ state: "unavailable" });
    expect(JSON.stringify(result.current)).not.toContain("reset procedure");
  });

  it("bypasses semantics for an explicit deterministic objective", async () => {
    const objectiveInput = {
      ...input,
      title: "Return Ready when checks pass",
      description: "The service must return Ready when checks pass."
    };
    const seed = buildGeneralPrObservationSeedV2(objectiveInput);
    const provider = { observe: vi.fn(async () => ({})) };
    const result = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input: objectiveInput,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider,
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => objectiveInput,
      modelProfile
    });

    expect(provider.observe).not.toHaveBeenCalled();
    expect(result.semantic).toBeNull();
    expect(result.bundle).toEqual(finalizeDeterministicGeneralPrObservationsV2(seed, null, "disabled"));
    expect(result.bundle).toMatchObject({
      semanticState: "disabled",
      semanticStageDiagnostics: { claimState: "not_run", evidenceState: "not_run", providerCallCount: 0 },
      diagnostics: { semanticAdmission: "not_needed" }
    });
  });

  it("keeps an ineligible explicit objective on the existing observer-derived path", async () => {
    const objectiveInput = {
      ...input,
      title: "Return Ready when checks pass",
      description: "The service must return Ready when checks pass.",
      repositoryPrivate: true
    };
    const seed = buildGeneralPrObservationSeedV2(objectiveInput);
    const provider = { observe: vi.fn(async () => ({})) };
    const result = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input: objectiveInput,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider,
      providerAvailable: true,
      privateRepository: true,
      readCurrentInput: async () => objectiveInput,
      modelProfile
    });

    expect(provider.observe).not.toHaveBeenCalled();
    expect(result.semantic).toBeNull();
    expect(result.bundle).toMatchObject({ semanticState: "ineligible" });
  });

  it("finalizes the same private hypothesis bundle in sync and worker adapters", async () => {
    const semanticInput: PullRequestInput = {
      ...input,
      title: "Maintenance notes",
      description: "Internal cleanup only.",
      changedFiles: []
    };
    const seed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = { observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => validProposal(request)) };
    const sync = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"),
      input: semanticInput,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: {
        provider,
        providerAvailable: true,
        privateRepository: false,
        readCurrentInput: async () => semanticInput,
        modelProfile
      }
    });
    const worker = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input: semanticInput,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider,
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => semanticInput,
      modelProfile
    });

    expect(sync.bundle).toEqual(worker.bundle);
    expect(worker.semantic).toMatchObject({ state: "valid", receipt: { claimState: "valid", evidenceState: "not_run" } });
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "claim_discovery"]);
    expect(worker.bundle?.objectives).toEqual([expect.objectContaining({ state: "hypothesis" })]);
    expect(worker.bundle?.semanticStageDiagnostics).toMatchObject({ providerCallCount: 1, claimState: "valid", evidenceState: "not_run" });
  });

  it.each(["shadow", "advisory"] as const)("runs Stage A then Stage B once for an eligible %s worker", async (mode) => {
    const semanticInput: PullRequestInput = {
      ...input,
      title: "Maintenance notes",
      description: "Internal cleanup only.",
      changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+ Ready" }]
    };
    const seed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = { observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => validProposal(request)) };

    const result = await advanceQueuedGeneralPrObservationV2({
      mode,
      input: semanticInput,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider,
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => semanticInput,
      modelProfile
    });

    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(result.bundle?.semanticStageDiagnostics).toMatchObject({ providerCallCount: 2, claimState: "valid", evidenceState: "valid" });
    expect(result.bundle?.objectives).toEqual([expect.objectContaining({ state: "hypothesis" })]);
    expect(result.bundle?.relationLevelCounts.verified).toBe(0);
  });

  it("records a third observer invocation as the closed 3_plus bucket", async () => {
    const seed = buildGeneralPrObservationSeedV2(input);
    const baseline = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider: { observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => validProposal(request)) },
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => input,
      modelProfile
    });
    if (!baseline.semantic) throw new Error("fixture must produce an observer result");

    const observe = vi.spyOn(semanticObserver, "runGeneralPrSemanticObserverV2").mockImplementationOnce(async (options) => {
      await options.provider?.observe({} as GeneralPrSemanticObserverPackageV4);
      await options.provider?.observe({} as GeneralPrSemanticObserverPackageV4);
      await options.provider?.observe({} as GeneralPrSemanticObserverPackageV4);
      return baseline.semantic!;
    });
    const provider = { observe: vi.fn(async () => ({})) };

    try {
      const result = await advanceQueuedGeneralPrObservationV2({
        mode: "shadow",
        input,
        current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
        provider,
        providerAvailable: true,
        privateRepository: false,
        readCurrentInput: async () => input,
        modelProfile
      });

      expect(provider.observe).toHaveBeenCalledTimes(3);
      expect(result.bundle?.semanticStageDiagnostics.providerCallCount).toBe("3_plus");
    } finally {
      observe.mockRestore();
    }
  });

  it("carries a closed provider failure stage into the private worker bundle", async () => {
    const seed = buildGeneralPrObservationSeedV2(input);
    const result = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider: { observe: async () => { throw new Error("provider unavailable"); } },
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => input,
      modelProfile
    });

    expect(result.semantic).toMatchObject({ state: "unavailable", semanticFailureStage: "provider_request" });
    expect(result.bundle).toMatchObject({ semanticState: "unavailable", semanticFailureStage: "provider_request" });
  });

  it("carries a closed invalid claim reason into the private worker bundle", async () => {
    const seed = buildGeneralPrObservationSeedV2(input);
    const result = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider: { observe: async () => ({ spanRoles: [] }) },
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => input,
      modelProfile
    });

    expect(result.semantic).toMatchObject({ state: "invalid", semanticClaimInvalidReason: "span_binding_invalid" });
    expect(result.bundle).toMatchObject({ semanticState: "invalid", semanticClaimInvalidReason: "span_binding_invalid" });
  });

  it("fences a stale response and does not retry a completed or exhausted job", async () => {
    const seed = buildGeneralPrObservationSeedV2(input);
    const stale = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      providerAvailable: true,
      privateRepository: false,
      provider: { observe: vi.fn(async () => ({})) },
      readCurrentInput: async () => ({ ...input, description: "The procedure changed." })
    });
    const completed = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input,
      current: stale.current,
      providerAvailable: false,
      readCurrentInput: async () => input
    });

    expect(stale).toMatchObject({ status: "stale", current: { status: "stale", attempt: 1 } });
    expect(completed).toMatchObject({ status: "terminal", current: { status: "stale", attempt: 1 } });
  });

  it("stores no staged observer details in the queue record and never retries a failed Stage B", async () => {
    const semanticInput: PullRequestInput = {
      ...input,
      changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+ reset" }]
    };
    const seed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = {
      observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => {
        if (request.stage === "evidence_linking") throw new Error("provider unavailable");
        return validProposal(request);
      })
    };
    const first = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input: semanticInput,
      current: { version: 2, seedHash: seed.seedHash, attempt: 0, status: "pending" },
      provider,
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => semanticInput,
      modelProfile
    });
    const second = await advanceQueuedGeneralPrObservationV2({
      mode: "shadow",
      input: semanticInput,
      current: first.current,
      provider,
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => semanticInput,
      modelProfile
    });

    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(first).toMatchObject({
      status: "completed",
      current: { version: 2, seedHash: seed.seedHash, attempt: 1, status: "completed" },
      bundle: { semanticState: "valid", semanticStageDiagnostics: { evidenceState: "unavailable", providerCallCount: 2 } }
    });
    expect(second).toMatchObject({ status: "terminal", bundle: null, semantic: null });
    expect(Object.keys(first.current).sort()).toEqual(["attempt", "seedHash", "status", "version"]);
    expect(JSON.stringify(first.current)).not.toMatch(/selection|descriptor|receipt|source|provider/i);
  });
});
