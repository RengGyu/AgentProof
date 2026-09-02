import { describe, expect, it } from "vitest";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  computeGeneralPrSemanticEvidenceSelectionHashV1,
  generalPrSemanticRelationPriorityV1,
  reciprocalRankFusionScoreV1,
  selectGeneralPrSemanticEvidenceV1
} from "./general-pr-semantic-evidence-selection";
import { selectGeneralPrSemanticClaimSpansV1 } from "./general-pr-semantic-selection";
import type { GeneralPrSemanticClaimSelectionV1 } from "./general-pr-semantic-selection";
import type { PullRequestInput } from "./types";

const HEAD_SHA = "b".repeat(40);

function completeInput(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    url: "https://github.com/example/agentproof/pull/42",
    title: "Preserve repository visibility",
    description: "The change keeps repository visibility readable.",
    taskSource: "issue",
    taskText: "## Requirements\n- Preserve repository visibility.",
    changedFiles: [
      { path: "src/repositories/repository-visibility.ts", status: "modified" },
      { path: "tests/repository-visibility.test.ts", status: "added" }
    ],
    checks: [{ name: "repository visibility unit", status: "passed" }],
    logs: [],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      baseSha: "a".repeat(40),
      headSha: HEAD_SHA,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
      evidenceCapturedAt: "2026-09-02T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    ...overrides
  };
}

function claimSelection(request: PullRequestInput): GeneralPrSemanticClaimSelectionV1 {
  const seed = buildGeneralPrObservationSeedV2(request);
  const result = selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxSpans: 12, maxInputBytes: 12_000 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.selection;
}

function objectiveGroup(selection: GeneralPrSemanticClaimSelectionV1, text: string) {
  const span = selection.selectedSpans.find((candidate) => candidate.text.toLowerCase().includes(text.toLowerCase()));
  if (!span) throw new Error(`missing objective span containing ${text}`);
  return [{ spanIds: [span.spanId], disposition: "candidate" as const }];
}

function selected(request: PullRequestInput, overrides: Partial<Parameters<typeof selectGeneralPrSemanticEvidenceV1>[0]> = {}) {
  const seed = buildGeneralPrObservationSeedV2(request);
  const claims = claimSelection(request);
  const result = selectGeneralPrSemanticEvidenceV1({
    pullRequest: request,
    seed,
    claimSelection: claims,
    objectiveGroups: objectiveGroup(claims, "repository visibility"),
    ...overrides
  });
  expect(result.status).toBe("selected");
  if (result.status !== "selected") throw new Error(result.status);
  return { seed, selection: result.selection };
}

describe("selectGeneralPrSemanticEvidenceV1", () => {
  it("builds deterministic redacted sketches only from paths, hunk labels, and display names", () => {
    const secret = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
    const request = completeInput({
      changedFiles: [{
        path: "src/repositories/repository-visibility.ts",
        status: "modified",
        patch: [
          `@@ -1,2 +1,3 @@ export function ensureRepositoryVisibility ${secret} https://private.example/path owner@example.com ${"d".repeat(40)}`,
          "+PATCH_BODY_SENTINEL repositoryVisibility"
        ].join("\n")
      }],
      checks: [{ name: `RepositoryVisibility ${secret}`, status: "passed", summary: "CHECK_SUMMARY_SENTINEL", url: "https://checks.example/secret" }],
      logs: [{ source: "unit", text: "LOG_BODY_SENTINEL", url: "https://logs.example/secret" }]
    });
    const first = selected(request).selection;
    const second = selected(request).selection;
    const serialized = JSON.stringify(first);
    const tokens = first.evidenceDescriptors.flatMap((descriptor) => descriptor.tokenSketch);

    expect(tokens).toEqual(expect.arrayContaining(["repository", "visibility"]));
    expect(first).toEqual(second);
    expect(first.evidenceDescriptors.every((descriptor) => descriptor.tokenSketch.length <= 16)).toBe(true);
    expect(tokens.every((token) => token.length <= 40)).toBe(true);
    for (const forbidden of [
      "src/repositories/repository-visibility.ts",
      "PATCH_BODY_SENTINEL",
      "CHECK_SUMMARY_SENTINEL",
      "LOG_BODY_SENTINEL",
      "private.example",
      "owner@example.com",
      "d".repeat(40),
      secret
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("retains descriptors with unsafe source fragments after producing empty safe sketches", () => {
    const cases: Array<{
      name: string;
      request: PullRequestInput;
      forbidden: string[];
      retainedKinds: Array<"change" | "check" | "execution">;
    }> = [
      {
        name: "ftp path",
        request: completeInput({ changedFiles: [{ path: "ftp://private.example/secret.ts", status: "modified" }] }),
        forbidden: ["ftp", "private", "example", "secret"],
        retainedKinds: ["change"]
      },
      {
        name: "file URI hunk label",
        request: completeInput({ changedFiles: [{ path: "src/repositories/repository-visibility.ts", status: "modified", patch: "@@ -1 +1 @@ file:///private/secret.ts" }] }),
        forbidden: ["file", "private", "secret"],
        retainedKinds: ["change"]
      },
      {
        name: "www check display name",
        request: completeInput({ checks: [{ name: "www.private.example/secret", status: "passed" }] }),
        forbidden: ["www", "private", "example", "secret"],
        retainedKinds: ["check", "execution"]
      },
      {
        name: "opaque magnet path",
        request: completeInput({ changedFiles: [{ path: "magnet:?xt=urn:btih:magnetprivatevalue", status: "modified" }] }),
        forbidden: ["magnetprivatevalue"],
        retainedKinds: ["change"]
      },
      {
        name: "opaque URN hunk label",
        request: completeInput({ changedFiles: [{ path: "src/repositories/repository-visibility.ts", status: "modified", patch: "@@ -1 +1 @@ urn:agentproof:urnprivatevalue" }] }),
        forbidden: ["urnprivatevalue"],
        retainedKinds: ["change"]
      },
      {
        name: "opaque telephone check display name",
        request: completeInput({ checks: [{ name: "tel:+821012345678 privatetelvalue", status: "passed" }] }),
        forbidden: ["privatetelvalue"],
        retainedKinds: ["check", "execution"]
      }
    ];

    for (const fixture of cases) {
      const seed = buildGeneralPrObservationSeedV2(fixture.request);
      const claims = claimSelection(fixture.request);
      const result = selectGeneralPrSemanticEvidenceV1({
        pullRequest: fixture.request,
        seed,
        claimSelection: claims,
        objectiveGroups: objectiveGroup(claims, "repository visibility")
      });
      expect(result.status, fixture.name).toBe("selected");
      if (result.status !== "selected") throw new Error(`${fixture.name}: ${result.status}`);
      expect(result.selection.omittedReasonCounts.unsafeDescriptor, fixture.name).toBe(0);
      for (const kind of fixture.retainedKinds) {
        const descriptors = result.selection.evidenceDescriptors.filter((descriptor) => descriptor.kind === kind);
        expect(descriptors, `${fixture.name}: ${kind}`).not.toEqual([]);
      }
      const tokens = result.selection.evidenceDescriptors.flatMap((descriptor) => descriptor.tokenSketch)
        .concat(result.selection.changeClusterDescriptors.flatMap((descriptor) => descriptor.tokenSketch));
      const serialized = JSON.stringify(result.selection).toLowerCase();
      for (const forbidden of fixture.forbidden) {
        expect(tokens, `${fixture.name}: ${forbidden}`).not.toContain(forbidden);
        expect(serialized, `${fixture.name}: serialized ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("retains the observed relation basis when an unsafe source leaves no safe sketch", () => {
    const request = completeInput({ changedFiles: [{ path: "ftp://private.example/secret.ts", status: "modified" }] });
    const { selection } = selected(request);
    const descriptor = selection.evidenceDescriptors.find((candidate) => candidate.kind === "change");

    expect(descriptor).toMatchObject({ tokenSketch: [], relationBasis: "observation_only" });
  });

  it("admits safe normal path, hunk-label, and check-name descriptor sources", () => {
    const request = completeInput({
      changedFiles: [{ path: "src/repositories/repository-visibility.ts", status: "modified", patch: "@@ -1 +1 @@ ensureRepositoryVisibility" }],
      checks: [{ name: "Repository visibility unit", status: "passed" }]
    });
    const { selection } = selected(request);
    const kinds = new Set(selection.evidenceDescriptors.map((descriptor) => descriptor.kind));
    const tokens = selection.evidenceDescriptors.flatMap((descriptor) => descriptor.tokenSketch);

    expect(selection.omittedReasonCounts.unsafeDescriptor).toBe(0);
    expect(kinds).toEqual(new Set(["change", "check", "execution"]));
    expect(tokens).toEqual(expect.arrayContaining(["repository", "visibility", "ensure"]));
  });

  it("uses RRF k=60 and contributes zero for a missing signal rank", () => {
    const tokenRank = 1;
    const releasedRelationRank = 2;
    const missingSubjectRank = null;

    expect(reciprocalRankFusionScoreV1([tokenRank, releasedRelationRank, missingSubjectRank]))
      .toBeCloseTo(1 / 61 + 1 / 62, 12);
    expect(reciprocalRankFusionScoreV1([null])).toBe(0);
  });

  it("ranks released relations ahead of changed-artifact relations without treating singleton observations as relations", () => {
    expect([
      generalPrSemanticRelationPriorityV1("released_static_relation"),
      generalPrSemanticRelationPriorityV1("released_build_relation"),
      generalPrSemanticRelationPriorityV1("changed_artifact"),
      generalPrSemanticRelationPriorityV1("singleton")
    ]).toEqual([4, 3, 2, null]);
  });

  it("reserves one candidate per available evidence kind before score fill", () => {
    const request = completeInput();
    const { selection } = selected(request, { maxPerObjective: 4 });
    const selectedIds = new Set(selection.objectiveGroups[0]!.evidenceIds);
    const kinds = selection.evidenceDescriptors.filter((descriptor) => selectedIds.has(descriptor.evidenceId)).map((descriptor) => descriptor.kind);

    expect(new Set(kinds)).toEqual(new Set(["change", "test_artifact", "check", "execution"]));
    expect(selection.objectiveGroups[0]!.changeClusterIds).toEqual([]);
  });

  it("uses full-seed order to break otherwise equal change scores", () => {
    const request = completeInput({
      taskText: "## Requirements\n- Preserve an opaque setting.",
      title: "Preserve an opaque setting",
      description: "Keep the setting stable.",
      changedFiles: [
        { path: "src/alpha.ts", status: "modified" },
        { path: "src/beta.ts", status: "modified" }
      ],
      checks: []
    });
    const claims = claimSelection(request);
    const seed = buildGeneralPrObservationSeedV2(request);
    const result = selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed,
      claimSelection: claims,
      objectiveGroups: objectiveGroup(claims, "opaque setting"),
      maxPerObjective: 1
    });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") throw new Error(result.status);
    const descriptor = result.selection.evidenceDescriptors.find((candidate) => candidate.evidenceId === result.selection.objectiveGroups[0]!.evidenceIds[0]);
    expect(descriptor?.tokenSketch).toContain("alpha");
  });

  it("enforces per-objective and global limits while deduplicating descriptor catalogs", () => {
    const objectives = Array.from({ length: 12 }, (_, index) => `- Preserve feature${index + 10} behavior.`).join("\n");
    const request = completeInput({
      taskText: `## Requirements\n${objectives}`,
      title: "Preserve feature behavior",
      description: "Preserve all listed features.",
      changedFiles: Array.from({ length: 80 }, (_, index) => ({ path: `src/feature${index + 10}.ts`, status: "modified" as const })),
      checks: Array.from({ length: 16 }, (_, index) => ({ name: `feature${index + 10} check`, status: "passed" as const }))
    });
    const seed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request);
    const groups = claims.selectedSpans
      .filter((span) => /feature\d+/i.test(span.text))
      .map((span) => ({ spanIds: [span.spanId], disposition: "candidate" as const }));
    const result = selectGeneralPrSemanticEvidenceV1({ pullRequest: request, seed, claimSelection: claims, objectiveGroups: groups, maxPerObjective: 99, maxTotal: 999, maxInputBytes: 200_000 });

    expect(result.status).toBe("selected");
    if (result.status !== "selected") throw new Error(result.status);
    expect(result.selection.objectiveGroups.every((group) => group.changeClusterIds.length + group.evidenceIds.length <= 12)).toBe(true);
    const relationIds = new Set(result.selection.objectiveGroups.flatMap((group) => [...group.changeClusterIds, ...group.evidenceIds]));
    expect(relationIds.size).toBeLessThanOrEqual(64);
    expect(new Set(result.selection.evidenceDescriptors.map((descriptor) => descriptor.evidenceId)).size).toBe(result.selection.evidenceDescriptors.length);
    expect(new Set(result.selection.changeClusterDescriptors.map((descriptor) => descriptor.changeClusterId)).size).toBe(result.selection.changeClusterDescriptors.length);

    const globallyBounded = selectGeneralPrSemanticEvidenceV1({ pullRequest: request, seed, claimSelection: claims, objectiveGroups: groups, maxPerObjective: 12, maxTotal: 5, maxInputBytes: 12_000 });
    expect(globallyBounded.status).toBe("selected");
    if (globallyBounded.status !== "selected") throw new Error(globallyBounded.status);
    expect(new Set(globallyBounded.selection.objectiveGroups.flatMap((group) => [...group.changeClusterIds, ...group.evidenceIds])).size).toBeLessThanOrEqual(5);
  });

  it("keeps a decisive related candidate stable when unrelated evidence is removed", () => {
    const withUnrelated = completeInput({
      changedFiles: [
        { path: "src/repositories/repository-visibility.ts", status: "modified" },
        { path: "src/unrelated-clock.ts", status: "modified" }
      ]
    });
    const withoutUnrelated = completeInput({ changedFiles: [{ path: "src/repositories/repository-visibility.ts", status: "modified" }] });
    const first = selected(withUnrelated, { maxPerObjective: 4 }).selection;
    const second = selected(withoutUnrelated, { maxPerObjective: 4 }).selection;
    const firstRelated = first.evidenceDescriptors.find((descriptor) => descriptor.kind === "change" && descriptor.tokenSketch.includes("visibility"));
    const secondRelated = second.evidenceDescriptors.find((descriptor) => descriptor.kind === "change" && descriptor.tokenSketch.includes("visibility"));

    expect(firstRelated?.evidenceId).toBe(secondRelated?.evidenceId);
    expect(first.objectiveGroups[0]!.evidenceIds).toContain(firstRelated?.evidenceId);
    expect(second.objectiveGroups[0]!.evidenceIds).toContain(secondRelated?.evidenceId);
  });

  it("removes the relation candidate when its only changed artifact is removed", () => {
    const withTest = completeInput();
    const withoutTest = completeInput({ changedFiles: [{ path: "src/repositories/repository-visibility.ts", status: "modified" }] });
    const first = selected(withTest).selection;
    const second = selected(withoutTest).selection;
    const relatedTest = first.evidenceDescriptors.find((descriptor) => descriptor.kind === "test_artifact");

    expect(relatedTest?.relationBasis).toBe("changed_artifact");
    expect(first.objectiveGroups[0]!.evidenceIds).toContain(relatedTest?.evidenceId);
    expect(second.evidenceDescriptors.some((descriptor) => descriptor.evidenceId === relatedTest?.evidenceId)).toBe(false);
  });

  it("binds every selected descriptor ID to the rebuilt full seed", () => {
    const request = completeInput();
    const { seed, selection } = selected(request);
    const evidenceIds = new Set(seed.evidenceAtoms.map((atom) => atom.id));
    const clusterIds = new Set(seed.changeClusters.map((cluster) => cluster.id));

    expect(selection.evidenceDescriptors.every((descriptor) => evidenceIds.has(descriptor.evidenceId))).toBe(true);
    expect(selection.changeClusterDescriptors.every((descriptor) => clusterIds.has(descriptor.changeClusterId))).toBe(true);
    expect(selection.objectiveGroups.every((group) => group.evidenceIds.every((id) => evidenceIds.has(id)) && group.changeClusterIds.every((id) => clusterIds.has(id)))).toBe(true);
  });

  it("authenticates the complete returned selection with declared policy and effective limits", () => {
    const request = completeInput();
    const { selection } = selected(request, { maxPerObjective: 6, maxTotal: 9, maxInputBytes: 4_000 });
    const { evidenceSelectionHash, ...unsigned } = selection;

    expect(selection.policyVersion).toBe("general-pr-claim-evidence-selection.v1");
    expect(selection.limits).toEqual({ maxPerObjective: 6, maxTotal: 9, maxInputBytes: 4_000 });
    expect(computeGeneralPrSemanticEvidenceSelectionHashV1(unsigned)).toBe(evidenceSelectionHash);

    const mutations = [
      { ...unsigned, policyVersion: "changed-policy" as typeof unsigned.policyVersion },
      { ...unsigned, limits: { ...unsigned.limits, maxTotal: unsigned.limits.maxTotal - 1 } },
      { ...unsigned, coverage: unsigned.coverage === "complete" ? "sampled" as const : "complete" as const },
      { ...unsigned, omittedReasonCounts: { ...unsigned.omittedReasonCounts, unsafeDescriptor: unsigned.omittedReasonCounts.unsafeDescriptor + 1 } },
      { ...unsigned, objectiveGroups: unsigned.objectiveGroups.map((group, index) => index === 0 ? { ...group, evidenceIds: group.evidenceIds.slice(1) } : group) },
      { ...unsigned, changeClusterDescriptors: unsigned.changeClusterDescriptors.map((descriptor, index) => index === 0 ? { ...descriptor, tokenSketch: [...descriptor.tokenSketch, "mutated"] } : descriptor) },
      { ...unsigned, evidenceDescriptors: unsigned.evidenceDescriptors.map((descriptor, index) => index === 0 ? { ...descriptor, tokenSketch: [...descriptor.tokenSketch, "mutated"] } : descriptor) }
    ];
    for (const mutation of mutations) {
      expect(computeGeneralPrSemanticEvidenceSelectionHashV1(mutation)).not.toBe(evidenceSelectionHash);
    }
  });

  it("rejects stale seeds and forged claim bindings", () => {
    const request = completeInput();
    const seed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request);

    expect(selectGeneralPrSemanticEvidenceV1({
      pullRequest: { ...request, title: "Changed title" },
      seed,
      claimSelection: claims,
      objectiveGroups: objectiveGroup(claims, "repository visibility")
    })).toEqual({ status: "invalid", reason: "seed_invalid" });
    expect(selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed,
      claimSelection: { ...claims, claimSelectionHash: "0".repeat(64) },
      objectiveGroups: objectiveGroup(claims, "repository visibility")
    })).toEqual({ status: "invalid", reason: "claim_binding_invalid" });
  });

  it("rejects an empty objective-group binding instead of returning complete empty", () => {
    const request = completeInput();
    const seed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request);

    expect(selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed,
      claimSelection: claims,
      objectiveGroups: []
    })).toEqual({ status: "invalid", reason: "claim_binding_invalid" });
  });

  it("returns explicit sampled empty outcomes without constructing a packet or hash", () => {
    const request = completeInput();
    const seed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request);
    const countEmpty = selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed,
      claimSelection: claims,
      objectiveGroups: objectiveGroup(claims, "repository visibility"),
      maxTotal: 0
    });
    const byteEmpty = selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed,
      claimSelection: claims,
      objectiveGroups: objectiveGroup(claims, "repository visibility"),
      maxInputBytes: 1
    });

    expect(countEmpty).toMatchObject({ status: "empty", coverage: "sampled", omittedReasonCounts: { evidenceBudget: expect.any(Number) } });
    expect(byteEmpty).toMatchObject({ status: "empty", coverage: "sampled", omittedReasonCounts: { inputByteBudget: expect.any(Number) } });
    expect(JSON.stringify([countEmpty, byteEmpty])).not.toContain("evidenceSelectionHash");
    if (countEmpty.status === "empty") expect(countEmpty.omittedReasonCounts.evidenceBudget).toBeGreaterThan(0);
    if (byteEmpty.status === "empty") expect(byteEmpty.omittedReasonCounts.inputByteBudget).toBeGreaterThan(0);
  });

  it("reports complete empty only when the full legal candidate set is empty", () => {
    const request = completeInput({ changedFiles: [], checks: [] });
    const seed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request);
    const result = selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed,
      claimSelection: claims,
      objectiveGroups: objectiveGroup(claims, "repository visibility")
    });

    expect(result).toEqual({
      status: "empty",
      coverage: "complete",
      omittedReasonCounts: { evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 }
    });
  });

  it("keeps selected packets within the actual JSON byte budget and records sampling", () => {
    const request = completeInput({
      changedFiles: Array.from({ length: 20 }, (_, index) => ({ path: `src/repositories/repository-visibility-${index}.ts`, status: "modified" as const }))
    });
    const { selection } = selected(request, { maxInputBytes: 4_000 });

    expect(Buffer.byteLength(JSON.stringify(selection), "utf8")).toBeLessThanOrEqual(4_000);
    expect(selection.coverage).toBe("sampled");
    expect(selection.omittedReasonCounts.inputByteBudget + selection.omittedReasonCounts.evidenceBudget).toBeGreaterThan(0);
  });
});
