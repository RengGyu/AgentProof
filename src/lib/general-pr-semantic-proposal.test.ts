import { describe, expect, it } from "vitest";
import {
  buildGeneralPrSemanticProposalJsonSchemaV2,
  deriveGeneralPrObjectiveGroupIdV2,
  validateGeneralPrSemanticProposalV2
} from "./general-pr-semantic-proposal";
import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
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

function validProposal(observationSeed: GeneralPrObservationSeedV2) {
  const objective = observationSeed.spans.find((span) => span.deterministicRole === "objective_candidate");
  if (!objective) throw new Error("fixture must include an objective candidate");
  const groupId = deriveGeneralPrObjectiveGroupIdV2([objective.id]);
  return {
    contractVersion: "general_pr_semantic_proposal.v2" as const,
    schemaVersion: "agentproof_general_pr_observer_v2" as const,
    seedHash: observationSeed.seedHash,
    spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
      spanId: span.id,
      role: span.id === objective.id
        ? "objective_candidate"
        : span.deterministicRole === "unresolved" ? "mixed_or_ambiguous" : span.deterministicRole === "objective_candidate" ? "supporting_context" : span.deterministicRole,
      abstained: span.deterministicRole === "unresolved"
    }])),
    objectiveGroups: {
      [groupId]: { groupId, spanIds: [objective.id], disposition: "candidate" as const }
    },
    testApplicabilityProposals: [],
    scopeMappingProposals: [],
    evidenceRelationProposals: []
  };
}

describe("GeneralPrSemanticProposalV2", () => {
  it("accepts one role decision for every eligible span and a deterministic objective group", () => {
    const observationSeed = seed();
    const proposal = validProposal(observationSeed);

    expect(validateGeneralPrSemanticProposalV2(proposal, observationSeed)).toMatchObject({ valid: true });
  });

  it("rejects unknown references and all unapproved output fields", () => {
    const observationSeed = seed();
    const proposal = validProposal(observationSeed);
    const group = Object.values(proposal.objectiveGroups)[0]!;
    const unknownEvidence = {
      ...proposal,
      evidenceRelationProposals: [{ objectiveGroupId: group.groupId, evidenceId: "gpea_unknown", proposal: "supports" }]
    };
    const addedAuthority = {
      ...proposal,
      spanRoles: {
        ...proposal.spanRoles,
        [observationSeed.spans[0]!.id]: { ...proposal.spanRoles[observationSeed.spans[0]!.id]!, authority: "authoritative" }
      }
    };

    expect(validateGeneralPrSemanticProposalV2(unknownEvidence, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(addedAuthority, observationSeed)).toMatchObject({ valid: false });
  });

  it("rejects conflicting duplicate relation proposals instead of selecting one by array order", () => {
    const observationSeed = seed();
    const proposal = validProposal(observationSeed);
    const group = Object.values(proposal.objectiveGroups)[0]!;
    const cluster = observationSeed.changeClusters[0]!;
    const atom = observationSeed.evidenceAtoms[0]!;
    const duplicateTest = {
      ...proposal,
      testApplicabilityProposals: [
        { objectiveGroupId: group.groupId, changeClusterId: cluster.id, proposal: "likely_expected" as const },
        { objectiveGroupId: group.groupId, changeClusterId: cluster.id, proposal: "likely_not_applicable" as const }
      ]
    };
    const duplicateScope = {
      ...proposal,
      scopeMappingProposals: [
        { objectiveGroupId: group.groupId, changeClusterId: cluster.id, proposal: "plausibly_mapped" as const },
        { objectiveGroupId: group.groupId, changeClusterId: cluster.id, proposal: "unresolved" as const }
      ]
    };
    const duplicateEvidence = {
      ...proposal,
      evidenceRelationProposals: [
        { objectiveGroupId: group.groupId, evidenceId: atom.id, proposal: "supports" as const },
        { objectiveGroupId: group.groupId, evidenceId: atom.id, proposal: "contradicts" as const }
      ]
    };

    expect(validateGeneralPrSemanticProposalV2(duplicateTest, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(duplicateScope, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(duplicateEvidence, observationSeed)).toMatchObject({ valid: false });
  });

  it("allows a fallback PR span to be classified as an objective without changing its authority", () => {
    const observationSeed = seed();
    const proposal = validProposal(observationSeed);
    const prTitleSpan = observationSeed.spans.find((span) => {
      const source = observationSeed.sources.find((candidate) => candidate.id === span.sourceUnitId);
      return source?.kind === "pr_title";
    });
    if (!prTitleSpan) throw new Error("fixture must include a title span");
    const replacementId = deriveGeneralPrObjectiveGroupIdV2([prTitleSpan.id]);
    const fallbackProposal = {
      ...proposal,
      spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
        spanId: span.id,
        role: span.id === prTitleSpan.id ? "objective_candidate" : "supporting_context",
        abstained: false
      }])),
      objectiveGroups: {
        [replacementId]: { groupId: replacementId, spanIds: [prTitleSpan.id], disposition: "candidate" as const }
      }
    };

    expect(validateGeneralPrSemanticProposalV2(fallbackProposal, observationSeed)).toMatchObject({
      valid: true,
      proposal: { objectiveGroups: { [replacementId]: { spanIds: [prTitleSpan.id] } } }
    });
    expect(observationSeed.sources.find((source) => source.id === prTitleSpan.sourceUnitId)).toMatchObject({
      authority: "author_claim",
      admissionTier: "fallback"
    });
  });

  it("rejects mixed authorities, reordered spans, duplicate ownership, and forged group IDs", () => {
    const observationSeed = seed({ taskText: "The service must return Ready.\n\nThe service must show status." });
    const proposal = validProposal(observationSeed);
    const authoritative = observationSeed.spans.filter((span) => {
      const source = observationSeed.sources.find((candidate) => candidate.id === span.sourceUnitId);
      return source?.authority === "authoritative" && span.deterministicRole === "objective_candidate";
    });
    const title = observationSeed.spans.find((span) => observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.kind === "pr_title");
    if (authoritative.length < 2 || !title) throw new Error("fixture must include two authoritative and one title span");
    const orderedIds = authoritative.map((span) => span.id);
    const mixedId = deriveGeneralPrObjectiveGroupIdV2([orderedIds[0]!, title.id]);
    const mixed = {
      ...proposal,
      objectiveGroups: { [mixedId]: { groupId: mixedId, spanIds: [orderedIds[0]!, title.id], disposition: "candidate" as const } }
    };
    const reorderedIds = [...orderedIds].reverse();
    const reorderedId = deriveGeneralPrObjectiveGroupIdV2(reorderedIds);
    const reordered = {
      ...proposal,
      objectiveGroups: { [reorderedId]: { groupId: reorderedId, spanIds: reorderedIds, disposition: "candidate" as const } }
    };
    const duplicateId = deriveGeneralPrObjectiveGroupIdV2([orderedIds[0]!]);
    const duplicate = {
      ...proposal,
      objectiveGroups: {
        [duplicateId]: { groupId: duplicateId, spanIds: [orderedIds[0]!], disposition: "candidate" as const },
        another: { groupId: duplicateId, spanIds: [orderedIds[0]!], disposition: "candidate" as const }
      }
    };
    const forged = {
      ...proposal,
      objectiveGroups: { forged: { groupId: "forged", spanIds: [orderedIds[0]!], disposition: "candidate" as const } }
    };

    expect(validateGeneralPrSemanticProposalV2(mixed, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(reordered, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(duplicate, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(forged, observationSeed)).toMatchObject({ valid: false });
  });

  it("rejects an objective group spanning two same-authority source units", () => {
    const observationSeed = seed({ taskText: "" });
    const title = observationSeed.spans.find((span) => observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.kind === "pr_title");
    const body = observationSeed.spans.find((span) => observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.kind === "pr_body");
    if (!title || !body) throw new Error("fixture must include title and body spans");
    const groupId = deriveGeneralPrObjectiveGroupIdV2([title.id, body.id]);
    const proposal = {
      ...validProposal(observationSeed),
      spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
        spanId: span.id,
        role: span.id === title.id || span.id === body.id ? "objective_candidate" : "supporting_context",
        abstained: false
      }])),
      objectiveGroups: {
        [groupId]: { groupId, spanIds: [title.id, body.id], disposition: "candidate" as const }
      }
    };

    expect(validateGeneralPrSemanticProposalV2(proposal, observationSeed)).toMatchObject({ valid: false });
  });

  it("rejects an incomplete span decision, oversized output, and stale seeds without partial repair", () => {
    const observationSeed = seed();
    const proposal = validProposal(observationSeed);
    const [firstSpanId] = Object.keys(proposal.spanRoles);
    const missingSpan = { ...proposal, spanRoles: Object.fromEntries(Object.entries(proposal.spanRoles).filter(([id]) => id !== firstSpanId)) };
    const group = Object.values(proposal.objectiveGroups)[0]!;
    const evidenceId = observationSeed.evidenceAtoms[0]!.id;
    const oversized = {
      ...proposal,
      evidenceRelationProposals: Array.from(
        { length: 1_000 },
        () => ({ objectiveGroupId: group.groupId, evidenceId, proposal: "supports" as const })
      )
    };

    expect(validateGeneralPrSemanticProposalV2(missingSpan, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(oversized, observationSeed)).toMatchObject({ valid: false });
    expect(validateGeneralPrSemanticProposalV2(proposal, observationSeed, { currentSeedHash: "0".repeat(64) })).toMatchObject({ valid: false });
  });

  it("creates a strict provider schema with no free-form object properties", () => {
    const schema = buildGeneralPrSemanticProposalJsonSchemaV2(seed());

    expect(schema).not.toBeNull();
    expectStrictObjects(schema);
  });
});

function expectStrictObjects(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") expect(record.additionalProperties).toBe(false);
  if (record.properties && typeof record.properties === "object") {
    for (const child of Object.values(record.properties as Record<string, unknown>)) expectStrictObjects(child);
  }
  if (record.items) expectStrictObjects(record.items);
  if (record.$defs && typeof record.$defs === "object") {
    for (const child of Object.values(record.$defs as Record<string, unknown>)) expectStrictObjects(child);
  }
}
