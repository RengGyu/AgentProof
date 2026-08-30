import { describe, expect, it, vi } from "vitest";
import {
  buildGeneralPrSemanticObserverPackageV2,
  runGeneralPrSemanticObserverV2,
  type GeneralPrSemanticObserverModelProfileV2
} from "./general-pr-semantic-observer";
import { deriveGeneralPrObjectiveGroupIdV2 } from "./general-pr-semantic-proposal";
import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
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
    checks: [{ name: "CI", status: "passed", summary: "SECRET_LOG_MUST_NOT_LEAVE_PROCESS" }],
    logs: [{ source: "CI", text: "SECRET_LOG_MUST_NOT_LEAVE_PROCESS" }],
    ...overrides
  };
}

function validProposal(seed: GeneralPrObservationSeedV2) {
  const objectives = seed.spans.filter((span) => span.deterministicRole === "objective_candidate");
  if (objectives.length === 0) throw new Error("fixture must include an objective candidate");
  return {
    contractVersion: "general_pr_semantic_proposal.v2" as const,
    schemaVersion: "agentproof_general_pr_observer_v2" as const,
    seedHash: seed.seedHash,
    spanRoles: Object.fromEntries(seed.spans.map((span) => [span.id, {
      spanId: span.id,
      role: span.deterministicRole === "unresolved" ? "mixed_or_ambiguous" : span.deterministicRole,
      abstained: span.deterministicRole === "unresolved"
    }])),
    objectiveGroups: Object.fromEntries(objectives.map((objective) => {
      const groupId = deriveGeneralPrObjectiveGroupIdV2([objective.id]);
      return [groupId, { groupId, spanIds: [objective.id], disposition: "candidate" as const }];
    })),
    testApplicabilityProposals: [],
    scopeMappingProposals: [],
    evidenceRelationProposals: []
  };
}

describe("GeneralPrSemanticObserverV2", () => {
  it("builds an ID-only bounded package with redacted source spans and no patch, log, or raw path", () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const semanticPackage = buildGeneralPrSemanticObserverPackageV2(request, seed, modelProfile);

    expect(semanticPackage).not.toBeNull();
    const serialized = JSON.stringify(semanticPackage);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("sk-123456789");
    expect(serialized).not.toContain("SECRET_PATCH_MUST_NOT_LEAVE_PROCESS");
    expect(serialized).not.toContain("SECRET_LOG_MUST_NOT_LEAVE_PROCESS");
    expect(serialized).not.toContain("src/private-status.ts");
    expect(semanticPackage?.request).toMatchObject({ store: false, maxOutputTokens: 3200 });
  });

  it("fails closed instead of truncating when package limits are exceeded", () => {
    const tooManySpans = input({
      description: Array.from({ length: 13 }, (_, index) => `- The service must return Ready ${index}.`).join("\n")
    });
    const tooManyChanges = input({
      changedFiles: Array.from({ length: 33 }, (_, index) => ({ path: `src/file-${index}.ts`, status: "modified" as const }))
    });

    expect(buildGeneralPrSemanticObserverPackageV2(tooManySpans, buildGeneralPrObservationSeedV2(tooManySpans), modelProfile)).toBeNull();
    expect(buildGeneralPrSemanticObserverPackageV2(tooManyChanges, buildGeneralPrObservationSeedV2(tooManyChanges), modelProfile)).toBeNull();
  });

  it("returns typed disabled, unavailable, timeout, invalid, and stale states without throwing", async () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const provider = { observe: vi.fn(async () => validProposal(seed)) };

    await expect(runGeneralPrSemanticObserverV2({ mode: "disabled", input: request, seed, provider, providerAvailable: true, readCurrentInput: async () => request, modelProfile })).resolves.toMatchObject({ state: "disabled", receipt: { state: "unavailable" } });
    await expect(runGeneralPrSemanticObserverV2({ mode: "shadow", input: request, seed, provider, providerAvailable: false, readCurrentInput: async () => request, modelProfile })).resolves.toMatchObject({ state: "unavailable" });
    await expect(runGeneralPrSemanticObserverV2({ mode: "shadow", input: request, seed, provider: { observe: async () => new Promise(() => undefined) }, providerAvailable: true, privateRepository: false, timeoutMs: 1, readCurrentInput: async () => request, modelProfile })).resolves.toMatchObject({ state: "timeout" });
    await expect(runGeneralPrSemanticObserverV2({ mode: "shadow", input: request, seed, provider: { observe: async () => ({}) }, providerAvailable: true, privateRepository: false, readCurrentInput: async () => request, modelProfile })).resolves.toMatchObject({ state: "invalid" });
    await expect(runGeneralPrSemanticObserverV2({ mode: "shadow", input: request, seed, provider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => ({ ...request, description: "The service must return Changed." }), modelProfile })).resolves.toMatchObject({ state: "stale" });
    expect(provider.observe).toHaveBeenCalled();
  });

  it("binds the final current source and subject before accepting a semantic proposal", async () => {
    const request = input({
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        baseSha: "b".repeat(40),
        headSha: "a".repeat(40),
        changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
        evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
      }
    });
    const seed = buildGeneralPrObservationSeedV2(request);
    const result = await runGeneralPrSemanticObserverV2({
      mode: "shadow",
      input: request,
      seed,
      provider: { observe: async () => validProposal(seed) },
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => request,
      modelProfile
    });

    expect(result).toMatchObject({ state: "valid" });
    expect(JSON.stringify(result.receipt)).not.toContain("private-status");
    expect(JSON.stringify(result.receipt)).not.toContain("Return Ready");
  });

  it("changes the receipt when its model, prompt, schema, or input-field policy changes", async () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const run = (profile: GeneralPrSemanticObserverModelProfileV2) => runGeneralPrSemanticObserverV2({
      mode: "shadow",
      input: request,
      seed,
      provider: { observe: async () => validProposal(seed) },
      providerAvailable: true,
      privateRepository: false,
      readCurrentInput: async () => request,
      modelProfile: profile
    });

    const first = await run(modelProfile);
    const second = await run({ ...modelProfile, promptVersion: "2026-09-01.v1" });

    expect(first.receipt.promptHash).not.toBe(second.receipt.promptHash);
    expect(first.receipt.modelProfileHash).not.toBe(second.receipt.modelProfileHash);
  });

  it("requires explicit consent and retention approval before processing a private repository", async () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const provider = { observe: vi.fn(async () => validProposal(seed)) };

    const result = await runGeneralPrSemanticObserverV2({
      mode: "shadow",
      input: request,
      seed,
      provider,
      providerAvailable: true,
      privateRepository: true,
      privateRepositoryConsent: false,
      providerRetentionApproved: false,
      readCurrentInput: async () => request,
      modelProfile
    });

    expect(result).toMatchObject({ state: "unavailable" });
    expect(provider.observe).not.toHaveBeenCalled();
  });

  it("fails closed when repository visibility is unavailable instead of treating it as public", async () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const provider = { observe: vi.fn(async () => validProposal(seed)) };

    const result = await runGeneralPrSemanticObserverV2({
      mode: "shadow",
      input: request,
      seed,
      provider,
      providerAvailable: true,
      readCurrentInput: async () => request,
      modelProfile
    });

    expect(result).toMatchObject({ state: "unavailable" });
    expect(provider.observe).not.toHaveBeenCalled();
  });
});
