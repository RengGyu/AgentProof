import { describe, expect, it } from "vitest";
import {
  buildGeneralPrSemanticClaimJsonSchemaV1,
  buildGeneralPrSemanticEvidenceJsonSchemaV1,
  buildGeneralPrSemanticProposalJsonSchemaV2,
  deriveGeneralPrObjectiveGroupIdV2,
  mergeGeneralPrSemanticStageCandidatesV1,
  validateGeneralPrSemanticClaimCandidateV1,
  validateGeneralPrSemanticEvidenceCandidateV1,
  validateGeneralPrSemanticProposalV2
} from "./general-pr-semantic-proposal";
import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  computeGeneralPrSemanticEvidenceSelectionHashV1,
  selectGeneralPrSemanticEvidenceV1,
  type GeneralPrSemanticEvidenceSelectionV1
} from "./general-pr-semantic-evidence-selection";
import {
  selectGeneralPrSemanticClaimSpansV1,
  type GeneralPrSemanticClaimSelectionV1
} from "./general-pr-semantic-selection";
import type { PullRequestInput } from "./types";

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Return Ready when checks pass",
    description: "This PR adds a status label.",
    taskSource: "issue",
    taskText: "The service must return Ready when checks pass.",
    changedFiles: [{ path: "src/status.ts", status: "modified", patch: "export const status = 'Ready';" }],
    checks: [],
    logs: [],
    ...overrides
  };
}

function seed(overrides: Partial<PullRequestInput> = {}): GeneralPrObservationSeedV2 {
  return buildGeneralPrObservationSeedV2(input(overrides));
}

const HEAD_SHA = "b".repeat(40);

function stageInput(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return input({
    url: "https://github.com/example/agentproof/pull/42",
    title: "Return Ready when checks pass",
    description: "This PR keeps status output readable.",
    taskText: [
      "## Requirements",
      "- Return Ready when checks pass.",
      "- Keep the status readable.",
      "- Preserve error details.",
      "",
      "Please review the checklist."
    ].join("\n"),
    changedFiles: [
      { path: "src/status.ts", status: "modified" },
      { path: "tests/status.test.ts", status: "added" }
    ],
    checks: [{ name: "status unit", status: "passed" }],
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
  });
}

function claimSelection(request: PullRequestInput, observationSeed = buildGeneralPrObservationSeedV2(request)): GeneralPrSemanticClaimSelectionV1 {
  const result = selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed: observationSeed, maxSpans: 12, maxInputBytes: 12_000 });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.selection;
}

function claimCandidate(selection: GeneralPrSemanticClaimSelectionV1, objectiveTexts = ["Return Ready"]) {
  const objectiveIds = objectiveTexts.map((text) => {
    const span = selection.selectedSpans.find((candidate) => candidate.text.includes(text));
    if (!span) throw new Error(`missing objective span containing ${text}`);
    return span.spanId;
  });
  return {
    spanRoles: selection.selectedSpans.map((span) => {
      const objective = objectiveIds.includes(span.spanId);
      const role = objective
        ? "objective_candidate" as const
        : span.deterministicRole === "template_or_process"
          ? "template_or_process" as const
          : span.deterministicRole === "unresolved"
            ? "mixed_or_ambiguous" as const
            : "supporting_context" as const;
      return { spanId: span.spanId, role, abstained: role === "mixed_or_ambiguous" };
    }),
    objectiveGroups: objectiveIds.map((spanId) => ({ spanIds: [spanId], disposition: "candidate" as const }))
  };
}

function selectedEvidence(
  request: PullRequestInput,
  observationSeed: GeneralPrObservationSeedV2,
  selection: GeneralPrSemanticClaimSelectionV1,
  candidate: ReturnType<typeof claimCandidate>
): GeneralPrSemanticEvidenceSelectionV1 {
  const result = selectGeneralPrSemanticEvidenceV1({
    pullRequest: request,
    seed: observationSeed,
    claimSelection: selection,
    objectiveGroups: candidate.objectiveGroups
  });
  expect(result.status).toBe("selected");
  if (result.status !== "selected") throw new Error(result.status);
  return result.selection;
}

function rehashEvidenceSelection(selection: GeneralPrSemanticEvidenceSelectionV1): GeneralPrSemanticEvidenceSelectionV1 {
  const { evidenceSelectionHash: _hash, ...unsigned } = selection;
  return { ...unsigned, evidenceSelectionHash: computeGeneralPrSemanticEvidenceSelectionHashV1(unsigned) };
}

function validCandidate(observationSeed: GeneralPrObservationSeedV2) {
  const objective = observationSeed.spans.find((span) => span.deterministicRole === "objective_candidate");
  if (!objective) throw new Error("fixture must include an objective candidate");
  return {
    spanRoles: observationSeed.spans.map((span) => ({
      spanId: span.id,
      role: span.id === objective.id
        ? "objective_candidate"
        : span.deterministicRole === "unresolved"
          ? "mixed_or_ambiguous"
          : span.deterministicRole === "objective_candidate"
            ? "supporting_context"
            : span.deterministicRole,
      abstained: span.deterministicRole === "unresolved"
    })),
    objectiveGroups: [{ spanIds: [objective.id], disposition: "candidate" as const }],
    testApplicabilityProposals: [],
    scopeMappingProposals: [],
    evidenceRelationProposals: []
  };
}

function nonObjectiveCandidate(observationSeed: GeneralPrObservationSeedV2) {
  return {
    spanRoles: observationSeed.spans.map((span) => ({
      spanId: span.id,
      role: span.deterministicRole === "template_or_process" ? "template_or_process" : "supporting_context",
      abstained: false
    })),
    objectiveGroups: [],
    testApplicabilityProposals: [],
    scopeMappingProposals: [],
    evidenceRelationProposals: []
  };
}

describe("GeneralPr semantic provider candidate", () => {
  it("normalizes a valid fixed-array candidate into the canonical V2 proposal", () => {
    const observationSeed = seed();
    const candidate = validCandidate(observationSeed);
    const objectiveSpanId = candidate.objectiveGroups[0]!.spanIds[0]!;
    const groupId = deriveGeneralPrObjectiveGroupIdV2([objectiveSpanId]);

    expect(validateGeneralPrSemanticProposalV2(candidate, observationSeed)).toEqual(expect.objectContaining({
      valid: true,
      proposal: expect.objectContaining({
        contractVersion: "general_pr_semantic_proposal.v2",
        schemaVersion: "agentproof_general_pr_observer_v2",
        seedHash: observationSeed.seedHash,
        objectiveGroups: {
          [groupId]: { groupId, spanIds: [objectiveSpanId], disposition: "candidate" }
        }
      })
    }));
  });

  it("accepts an explicit empty candidate as semantic non-detection", () => {
    const observationSeed = seed();

    expect(validateGeneralPrSemanticProposalV2(nonObjectiveCandidate(observationSeed), observationSeed)).toEqual(expect.objectContaining({
      valid: true,
      proposal: expect.objectContaining({ objectiveGroups: {} })
    }));
  });

  it("rejects a missing required field instead of treating it as an empty candidate", () => {
    const observationSeed = seed();
    const { objectiveGroups: _objectiveGroups, ...missingObjectiveGroups } = nonObjectiveCandidate(observationSeed);

    expect(validateGeneralPrSemanticProposalV2(missingObjectiveGroups, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
  });

  it("rejects duplicate or incomplete span decisions and unapproved fields", () => {
    const observationSeed = seed();
    const candidate = validCandidate(observationSeed);
    const duplicateSpan = { ...candidate, spanRoles: [...candidate.spanRoles, candidate.spanRoles[0]] };
    const missingSpan = { ...candidate, spanRoles: candidate.spanRoles.slice(1) };
    const addedAuthority = {
      ...candidate,
      spanRoles: candidate.spanRoles.map((span, index) => index === 0 ? { ...span, authority: "authoritative" } : span)
    };

    expect(validateGeneralPrSemanticProposalV2(duplicateSpan, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticProposalV2(missingSpan, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticProposalV2(addedAuthority, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
  });

  it("derives relation group identity only from a submitted objective group", () => {
    const observationSeed = seed();
    const candidate = validCandidate(observationSeed);
    const objectiveSpanIds = candidate.objectiveGroups[0]!.spanIds;
    const cluster = observationSeed.changeClusters[0]!;
    const atom = observationSeed.evidenceAtoms[0]!;
    const related = {
      ...candidate,
      testApplicabilityProposals: [{ objectiveSpanIds, changeClusterId: cluster.id, proposal: "likely_expected" as const }],
      scopeMappingProposals: [{ objectiveSpanIds, changeClusterId: cluster.id, proposal: "plausibly_mapped" as const }],
      evidenceRelationProposals: [{ objectiveSpanIds, evidenceId: atom.id, proposal: "supports" as const }]
    };
    const unknownGroup = {
      ...candidate,
      evidenceRelationProposals: [{ objectiveSpanIds: [observationSeed.spans.at(-1)!.id], evidenceId: atom.id, proposal: "supports" as const }]
    };

    expect(validateGeneralPrSemanticProposalV2(related, observationSeed)).toEqual(expect.objectContaining({ valid: true }));
    expect(validateGeneralPrSemanticProposalV2(unknownGroup, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
  });

  it("rejects cross-source, reordered, duplicate, and stale groups", () => {
    const observationSeed = seed({ taskText: "The service must return Ready.\n\nThe service must show status." });
    const candidate = validCandidate(observationSeed);
    const authoritative = observationSeed.spans.filter((span) => observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.authority === "authoritative");
    const title = observationSeed.spans.find((span) => observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.kind === "pr_title");
    if (authoritative.length < 2 || !title) throw new Error("fixture must include source-local spans and a title span");
    const ordered = authoritative.slice(0, 2).map((span) => span.id);
    const crossSource = {
      ...candidate,
      objectiveGroups: [{ spanIds: [ordered[0]!, title.id], disposition: "candidate" as const }]
    };
    const reordered = {
      ...candidate,
      objectiveGroups: [{ spanIds: [...ordered].reverse(), disposition: "candidate" as const }]
    };
    const duplicate = {
      ...candidate,
      objectiveGroups: [
        { spanIds: [ordered[0]!], disposition: "candidate" as const },
        { spanIds: [ordered[0]!], disposition: "candidate" as const }
      ]
    };

    expect(validateGeneralPrSemanticProposalV2(crossSource, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticProposalV2(reordered, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticProposalV2(duplicate, observationSeed)).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticProposalV2(candidate, observationSeed, { currentSeedHash: "0".repeat(64) })).toEqual(expect.objectContaining({ valid: false }));
  });

  it("creates an OpenAI strict schema with fixed array collections", () => {
    const schema = buildGeneralPrSemanticProposalJsonSchemaV2(seed());

    expect(schema).not.toBeNull();
    expectOpenAiStrictObjects(schema);
    const properties = (schema as { properties: Record<string, unknown> }).properties;
    expect(properties.objectiveGroups).toEqual(expect.objectContaining({ type: "array" }));
    expect(JSON.stringify(schema)).not.toContain('"enum":[]');
  });
});

describe("GeneralPr split semantic stage contracts", () => {
  it("builds recursively strict selection-bound claim and evidence schemas", () => {
    const request = stageInput();
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request, observationSeed);
    const candidate = claimCandidate(claims);
    const evidence = selectedEvidence(request, observationSeed, claims, candidate);
    const claimSchema = buildGeneralPrSemanticClaimJsonSchemaV1(claims);
    const evidenceSchema = buildGeneralPrSemanticEvidenceJsonSchemaV1(evidence);

    expectOpenAiStrictObjects(claimSchema);
    expectOpenAiStrictObjects(evidenceSchema);
    expect(schemaEnums(claimSchema).flat()).toEqual(expect.arrayContaining(claims.selectedSpanIds));
    expect(schemaEnums(claimSchema).flat().filter((value) => typeof value === "string" && value.startsWith("gpsp_")))
      .toEqual(expect.arrayContaining(claims.selectedSpanIds));
    expect(JSON.stringify(evidenceSchema)).not.toContain('"enum":[]');
    for (const id of [...claims.selectedSpanIds, ...evidence.changeClusterDescriptors.map((item) => item.changeClusterId), ...evidence.evidenceDescriptors.map((item) => item.evidenceId)]) {
      expect(schemaPropertyNames(claimSchema).concat(schemaPropertyNames(evidenceSchema))).not.toContain(id);
    }
    for (const forbidden of ["version", "parentSeedHash", "claimSelectionHash", "evidenceSelectionHash", "authority", "groupId", "rawPath", "source", "logs", "url", "token", "sha"]) {
      expect(schemaPropertyNames(claimSchema).concat(schemaPropertyNames(evidenceSchema))).not.toContain(forbidden);
    }

    const allowedClustersByObjective = new Map(evidence.objectiveGroups.map((group) => [JSON.stringify(group.objectiveSpanIds), new Set(group.changeClusterIds)]));
    const allowedEvidenceByObjective = new Map(evidence.objectiveGroups.map((group) => [JSON.stringify(group.objectiveSpanIds), new Set(group.evidenceIds)]));
    for (const variant of relationVariants(evidenceSchema, "testApplicabilityProposals").concat(relationVariants(evidenceSchema, "scopeMappingProposals"))) {
      const objective = enumValues(variant, "objectiveSpanIds")[0];
      const allowed = allowedClustersByObjective.get(JSON.stringify(objective));
      expect(allowed).toBeDefined();
      expect(enumValues(variant, "changeClusterId").every((id) => allowed!.has(String(id)))).toBe(true);
    }
    for (const variant of relationVariants(evidenceSchema, "evidenceRelationProposals")) {
      const objective = enumValues(variant, "objectiveSpanIds")[0];
      const allowed = allowedEvidenceByObjective.get(JSON.stringify(objective));
      expect(allowed).toBeDefined();
      expect(enumValues(variant, "evidenceId").every((id) => allowed!.has(String(id)))).toBe(true);
    }
  });

  it("omits empty relation enums when one selected evidence catalog is empty", () => {
    const request = stageInput();
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const claims = claimSelection(request, observationSeed);
    const candidate = claimCandidate(claims);
    const result = selectGeneralPrSemanticEvidenceV1({
      pullRequest: request,
      seed: observationSeed,
      claimSelection: claims,
      objectiveGroups: candidate.objectiveGroups,
      maxPerObjective: 4
    });
    expect(result.status).toBe("selected");
    if (result.status !== "selected") throw new Error(result.status);
    expect(result.selection.changeClusterDescriptors).toEqual([]);

    const schema = buildGeneralPrSemanticEvidenceJsonSchemaV1(result.selection);
    expect(JSON.stringify(schema)).not.toContain('"enum":[]');
    expect(relationVariants(schema, "testApplicabilityProposals")).toEqual([]);
    expect(relationVariants(schema, "scopeMappingProposals")).toEqual([]);
  });

  it("validates a complete selected claim stage and rejects root and span-decision mutations", () => {
    const request = stageInput();
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const selection = claimSelection(request, observationSeed);
    const candidate = claimCandidate(selection);
    const { objectiveGroups: _groups, ...missingRoot } = candidate;
    const extraRoot = { ...candidate, version: 1 };
    const unselected = observationSeed.spans.find((span) => !selection.selectedSpanIds.includes(span.id));
    const unknownDecision = { ...candidate, spanRoles: [...candidate.spanRoles.slice(1), { ...candidate.spanRoles[0]!, spanId: unselected?.id ?? "gpsp_unselected" }] };
    const duplicateDecision = { ...candidate, spanRoles: [...candidate.spanRoles.slice(1), candidate.spanRoles[1]!] };
    const missingDecision = { ...candidate, spanRoles: candidate.spanRoles.slice(1) };

    expect(validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, selection)).toEqual(expect.objectContaining({ valid: true }));
    for (const mutation of [missingRoot, extraRoot, unknownDecision, duplicateDecision, missingDecision]) {
      expect(validateGeneralPrSemanticClaimCandidateV1(mutation, observationSeed, selection)).toEqual(expect.objectContaining({ valid: false }));
    }
    expect(validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, { ...selection, parentSeedHash: "0".repeat(64) })).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, { ...selection, claimSelectionHash: "0".repeat(64) })).toEqual(expect.objectContaining({ valid: false }));
  });

  it("rejects reordered, non-contiguous, cross-source, role-ceiling, and ungrouped objective claims", () => {
    const request = stageInput();
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const selection = claimSelection(request, observationSeed);
    const firstSourceId = selection.selectedSpans.find((span) => span.deterministicRole !== "template_or_process")?.sourceUnitId;
    const authoritative = selection.selectedSpans.filter((span) => span.sourceUnitId === firstSourceId && span.deterministicRole !== "template_or_process");
    const otherSource = selection.selectedSpans.find((span) => span.sourceUnitId !== firstSourceId);
    const ceilingSpan = selection.selectedSpans.find((span) => span.deterministicRole === "template_or_process");
    if (authoritative.length < 3 || !otherSource || !ceilingSpan) throw new Error("fixture must contain three source-local spans, another source, and one role-ceiling span");
    const withObjectiveRoles = (ids: string[]) => ({
      spanRoles: claimCandidate(selection).spanRoles.map((role) => ids.includes(role.spanId) ? { ...role, role: "objective_candidate" as const, abstained: false } : role),
      objectiveGroups: [] as Array<{ spanIds: string[]; disposition: "candidate" }>
    });
    const adjacent = authoritative.slice(0, 2).map((span) => span.spanId);
    const nonContiguous = [authoritative[0]!.spanId, authoritative[2]!.spanId];
    const crossSourceIds = [authoritative[0]!.spanId, otherSource.spanId];
    const reordered = withObjectiveRoles(adjacent);
    reordered.objectiveGroups = [{ spanIds: [...adjacent].reverse(), disposition: "candidate" }];
    const skipped = withObjectiveRoles(nonContiguous);
    skipped.objectiveGroups = [{ spanIds: nonContiguous, disposition: "candidate" }];
    const crossSource = withObjectiveRoles(crossSourceIds);
    crossSource.objectiveGroups = [{ spanIds: crossSourceIds, disposition: "candidate" }];
    const ceiling = withObjectiveRoles([ceilingSpan.spanId]);
    ceiling.objectiveGroups = [{ spanIds: [ceilingSpan.spanId], disposition: "candidate" }];
    const ungrouped = withObjectiveRoles([authoritative[0]!.spanId]);

    for (const mutation of [reordered, skipped, crossSource, ceiling, ungrouped]) {
      expect(validateGeneralPrSemanticClaimCandidateV1(mutation, observationSeed, selection)).toEqual(expect.objectContaining({ valid: false }));
    }
  });

  it("validates objective-specific evidence choices and rejects ID, duplicate, binding, and limit mutations", () => {
    const request = stageInput();
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const selection = claimSelection(request, observationSeed);
    const candidate = claimCandidate(selection, ["Return Ready", "status readable"]);
    const claim = validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, selection);
    expect(claim.valid).toBe(true);
    const selected = selectedEvidence(request, observationSeed, selection, candidate);
    const sharedClusterId = selected.objectiveGroups[0]?.changeClusterIds.find((id) => selected.objectiveGroups[1]?.changeClusterIds.includes(id));
    if (!sharedClusterId) throw new Error("fixture must contain a cluster selected for both objectives");
    const crossKindObjectiveReuse = {
      testApplicabilityProposals: [{ objectiveSpanIds: selected.objectiveGroups[0]!.objectiveSpanIds, changeClusterId: sharedClusterId, proposal: "likely_expected" as const }],
      scopeMappingProposals: [{ objectiveSpanIds: selected.objectiveGroups[1]!.objectiveSpanIds, changeClusterId: sharedClusterId, proposal: "plausibly_mapped" as const }],
      evidenceRelationProposals: []
    };
    expect(validateGeneralPrSemanticEvidenceCandidateV1(crossKindObjectiveReuse, observationSeed, claim, selected)).toEqual(expect.objectContaining({ valid: false }));

    const evidenceIds = selected.evidenceDescriptors.slice(0, 2).map((item) => item.evidenceId);
    if (evidenceIds.length < 2) throw new Error("fixture must contain two evidence descriptors");
    const objectiveGroups = selected.objectiveGroups.map((group, index) => ({
      objectiveSpanIds: group.objectiveSpanIds,
      changeClusterIds: [],
      evidenceIds: [evidenceIds[index] ?? evidenceIds[0]!]
    }));
    const boundedSelection = rehashEvidenceSelection({
      ...selected,
      objectiveGroups,
      changeClusterDescriptors: [],
      evidenceDescriptors: selected.evidenceDescriptors.filter((item) => evidenceIds.includes(item.evidenceId))
    });
    const valid = {
      testApplicabilityProposals: [],
      scopeMappingProposals: [],
      evidenceRelationProposals: objectiveGroups.map((group, index) => ({
        objectiveSpanIds: group.objectiveSpanIds,
        evidenceId: evidenceIds[index] ?? evidenceIds[0]!,
        proposal: "supports" as const
      }))
    };
    expect(validateGeneralPrSemanticEvidenceCandidateV1(valid, observationSeed, claim, boundedSelection)).toEqual(expect.objectContaining({ valid: true }));

    const unknownId = { ...valid, evidenceRelationProposals: [{ ...valid.evidenceRelationProposals[0]!, evidenceId: "gpea_unknown" }] };
    const otherObjectiveId = { ...valid, evidenceRelationProposals: [{ ...valid.evidenceRelationProposals[0]!, evidenceId: evidenceIds[1]! }] };
    const duplicate = { ...valid, evidenceRelationProposals: [valid.evidenceRelationProposals[0]!, valid.evidenceRelationProposals[0]!] };
    const changedObjective = { ...valid, evidenceRelationProposals: [{ ...valid.evidenceRelationProposals[0]!, objectiveSpanIds: selection.selectedSpanIds.slice(-1) }] };
    for (const mutation of [unknownId, otherObjectiveId, duplicate, changedObjective]) {
      expect(validateGeneralPrSemanticEvidenceCandidateV1(mutation, observationSeed, claim, boundedSelection)).toEqual(expect.objectContaining({ valid: false }));
    }

    const sharedSelection = rehashEvidenceSelection({
      ...boundedSelection,
      objectiveGroups: boundedSelection.objectiveGroups.map((group) => ({ ...group, evidenceIds: [evidenceIds[0]!] })),
      evidenceDescriptors: boundedSelection.evidenceDescriptors.filter((item) => item.evidenceId === evidenceIds[0])
    });
    const crossObjective = {
      ...valid,
      evidenceRelationProposals: sharedSelection.objectiveGroups.map((group) => ({ objectiveSpanIds: group.objectiveSpanIds, evidenceId: evidenceIds[0]!, proposal: "supports" as const }))
    };
    expect(validateGeneralPrSemanticEvidenceCandidateV1(crossObjective, observationSeed, claim, sharedSelection)).toEqual(expect.objectContaining({ valid: false }));

    const overLimit = { ...valid, evidenceRelationProposals: Array.from({ length: 65 }, () => valid.evidenceRelationProposals[0]!) };
    expect(validateGeneralPrSemanticEvidenceCandidateV1(overLimit, observationSeed, claim, boundedSelection)).toEqual({ valid: false, errors: ["evidence relation limit exceeded"] });
    const overBytes = { ...valid, evidenceRelationProposals: [{ ...valid.evidenceRelationProposals[0]!, evidenceId: "x".repeat(20_000) }] };
    expect(validateGeneralPrSemanticEvidenceCandidateV1(overBytes, observationSeed, claim, boundedSelection)).toEqual({ valid: false, errors: ["evidence output byte limit exceeded"] });
    expect(validateGeneralPrSemanticEvidenceCandidateV1(valid, observationSeed, claim, { ...boundedSelection, parentSeedHash: "0".repeat(64) })).toEqual(expect.objectContaining({ valid: false }));
    expect(validateGeneralPrSemanticEvidenceCandidateV1(valid, observationSeed, claim, { ...boundedSelection, evidenceSelectionHash: "0".repeat(64) })).toEqual(expect.objectContaining({ valid: false }));
  });

  it("rejects a recomputed forged exact-head evidence binding", () => {
    const request = stageInput({ sourceProvenance: undefined });
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const selection = claimSelection(request, observationSeed);
    const candidate = claimCandidate(selection);
    const claim = validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, selection);
    const evidence = selectedEvidence(request, observationSeed, selection, candidate);
    const target = evidence.evidenceDescriptors.find((descriptor) => descriptor.subjectBinding !== "exact_head");
    if (!target) throw new Error("fixture must contain non-exact evidence");
    const forged = rehashEvidenceSelection({
      ...evidence,
      evidenceDescriptors: evidence.evidenceDescriptors.map((descriptor) => descriptor.evidenceId === target.evidenceId ? { ...descriptor, subjectBinding: "exact_head" as const } : descriptor)
    });
    const emptyCandidate = { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };

    expect(validateGeneralPrSemanticEvidenceCandidateV1(emptyCandidate, observationSeed, claim, forged)).toEqual(expect.objectContaining({ valid: false }));
  });

  it("deterministically merges independently valid stages through canonical V2 validation", () => {
    const request = stageInput();
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const selection = claimSelection(request, observationSeed);
    const candidate = claimCandidate(selection);
    const claim = validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, selection);
    const evidenceSelection = selectedEvidence(request, observationSeed, selection, candidate);
    const group = evidenceSelection.objectiveGroups[0]!;
    const clusterId = group.changeClusterIds[0];
    const evidenceId = group.evidenceIds[0];
    const evidenceCandidate = {
      testApplicabilityProposals: clusterId ? [{ objectiveSpanIds: group.objectiveSpanIds, changeClusterId: clusterId, proposal: "likely_expected" as const }] : [],
      scopeMappingProposals: clusterId ? [{ objectiveSpanIds: group.objectiveSpanIds, changeClusterId: clusterId, proposal: "plausibly_mapped" as const }] : [],
      evidenceRelationProposals: evidenceId ? [{ objectiveSpanIds: group.objectiveSpanIds, evidenceId, proposal: "supports" as const }] : []
    };
    const evidence = validateGeneralPrSemanticEvidenceCandidateV1(evidenceCandidate, observationSeed, claim, evidenceSelection);
    const first = mergeGeneralPrSemanticStageCandidatesV1(observationSeed, claim, evidence);
    const second = mergeGeneralPrSemanticStageCandidatesV1(observationSeed, claim, evidence);

    expect(first).toEqual(second);
    expect(first).toEqual(expect.objectContaining({ valid: true }));
    if (first.valid) expect(validateGeneralPrSemanticProposalV2({
      spanRoles: Object.values(first.proposal.spanRoles),
      objectiveGroups: Object.values(first.proposal.objectiveGroups).map(({ spanIds, disposition }) => ({ spanIds, disposition })),
      testApplicabilityProposals: evidence.valid ? evidence.testApplicabilityProposals : [],
      scopeMappingProposals: evidence.valid ? evidence.scopeMappingProposals : [],
      evidenceRelationProposals: evidence.valid ? evidence.evidenceRelationProposals : []
    }, observationSeed)).toEqual(first);
  });

  it("expands a sampled claim selection to the canonical full-seed span contract", () => {
    const request = stageInput({
      taskText: ["## Requirements", ...Array.from({ length: 20 }, (_, index) => `- Return state ${index + 1}.`)].join("\n")
    });
    const observationSeed = buildGeneralPrObservationSeedV2(request);
    const selection = claimSelection(request, observationSeed);
    const candidate = claimCandidate(selection, ["Return state 1."]);
    const claim = validateGeneralPrSemanticClaimCandidateV1(candidate, observationSeed, selection);
    const merged = mergeGeneralPrSemanticStageCandidatesV1(observationSeed, claim, null);

    expect(observationSeed.spans.length).toBeGreaterThan(12);
    expect(selection.selectedSpanIds.length).toBe(12);
    expect(merged).toEqual(expect.objectContaining({ valid: true }));
    if (merged.valid) expect(Object.keys(merged.proposal.spanRoles)).toHaveLength(observationSeed.spans.length);
  });
});

function expectOpenAiStrictObjects(value: unknown, path = "schema"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    expect(record.additionalProperties, path).toBe(false);
    const properties = Object.keys((record.properties ?? {}) as Record<string, unknown>).sort();
    const required = [...((record.required ?? []) as string[])].sort();
    expect(required, `${path}.required`).toEqual(properties);
  }
  for (const [key, child] of Object.entries((record.properties ?? {}) as Record<string, unknown>)) {
    expectOpenAiStrictObjects(child, `${path}.properties.${key}`);
  }
  if (record.items) expectOpenAiStrictObjects(record.items, `${path}.items`);
  for (const [index, child] of ((record.anyOf ?? []) as unknown[]).entries()) expectOpenAiStrictObjects(child, `${path}.anyOf[${index}]`);
}

function schemaPropertyNames(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [
    ...Object.keys((record.properties ?? {}) as Record<string, unknown>),
    ...Object.values((record.properties ?? {}) as Record<string, unknown>).flatMap(schemaPropertyNames),
    ...(record.items ? schemaPropertyNames(record.items) : []),
    ...((record.anyOf ?? []) as unknown[]).flatMap(schemaPropertyNames)
  ];
}

function schemaEnums(value: unknown): unknown[][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const record = value as Record<string, unknown>;
  return [
    ...(Array.isArray(record.enum) ? [record.enum] : []),
    ...Object.values((record.properties ?? {}) as Record<string, unknown>).flatMap(schemaEnums),
    ...(record.items ? schemaEnums(record.items) : []),
    ...((record.anyOf ?? []) as unknown[]).flatMap(schemaEnums)
  ];
}

function relationVariants(schema: unknown, field: string): Array<Record<string, unknown>> {
  const root = schema as { properties: Record<string, { items?: { anyOf?: Array<Record<string, unknown>> } | false }> };
  const items = root.properties[field]?.items;
  return items && typeof items === "object" ? items.anyOf ?? [] : [];
}

function enumValues(variant: Record<string, unknown>, field: string): unknown[] {
  const properties = variant.properties as Record<string, { enum?: unknown[] }>;
  return properties[field]?.enum ?? [];
}
