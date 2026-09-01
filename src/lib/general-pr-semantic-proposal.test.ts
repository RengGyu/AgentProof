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
}
