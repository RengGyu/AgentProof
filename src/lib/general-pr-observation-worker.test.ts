import { describe, expect, it, vi } from "vitest";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  finalizeDeterministicGeneralPrObservationsV2,
  runGeneralPrObservationNowV2
} from "./general-pr-observation-service";
import { advanceQueuedGeneralPrObservationV2 } from "./general-pr-observation-worker";
import { deriveGeneralPrObjectiveGroupIdV2 } from "./general-pr-semantic-proposal";
import type { GeneralPrSemanticObserverModelProfileV2 } from "./general-pr-semantic-observer";
import type { PullRequestInput, VerificationReport } from "./types";

const input: PullRequestInput = {
  title: "Document the reset procedure",
  description: "The local reset procedure must be documented.",
  taskText: "",
  changedFiles: [{ path: "docs/reset.md", status: "modified" }],
  checks: [],
  logs: []
};

const report = { schemaVersion: "verification-report.v2", analysisId: "worker-test" } as unknown as VerificationReport;
const modelProfile: GeneralPrSemanticObserverModelProfileV2 = {
  model: "test-model",
  promptVersion: "test-prompt.v1",
  inputFieldPolicyVersion: "test-fields.v1"
};

function validProposal(observationSeed: ReturnType<typeof buildGeneralPrObservationSeedV2>) {
  const objectives = observationSeed.spans.filter((span) => span.deterministicRole === "objective_candidate");
  if (objectives.length === 0) throw new Error("fixture must include an objective candidate");
  const groups = objectives.map((objective) => {
    const groupId = deriveGeneralPrObjectiveGroupIdV2([objective.id]);
    return [groupId, { groupId, spanIds: [objective.id], disposition: "candidate" as const }];
  });
  return {
    contractVersion: "general_pr_semantic_proposal.v2" as const,
    schemaVersion: "agentproof_general_pr_observer_v2" as const,
    seedHash: observationSeed.seedHash,
    spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
      spanId: span.id,
      role: span.deterministicRole === "unresolved" ? "mixed_or_ambiguous" : span.deterministicRole,
      abstained: span.deterministicRole === "unresolved"
    }])),
    objectiveGroups: Object.fromEntries(groups),
    testApplicabilityProposals: [],
    scopeMappingProposals: [],
    evidenceRelationProposals: []
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

  it("finalizes the same private hypothesis bundle in sync and worker adapters", async () => {
    const semanticInput: PullRequestInput = {
      ...input,
      title: "Return Ready when checks pass",
      description: "The service must return Ready when checks pass."
    };
    const seed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = { observe: vi.fn(async () => validProposal(seed)) };
    const sync = await runGeneralPrObservationNowV2({
      mode: "shadow",
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
    expect(worker.semantic).toMatchObject({ state: "valid" });
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
});
