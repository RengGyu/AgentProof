import { describe, expect, it } from "vitest";
import { deriveGeneralPrAssessmentV1, summarizeGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { finalizeDeterministicGeneralPrObservationsV2 } from "./general-pr-observation-service";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { buildObjectiveEvidenceRelationLedgerV1 } from "./objective-evidence-relation-ledger";
import { deriveGeneralPrObjectiveGroupIdV2, type GeneralPrSemanticProposalV2 } from "./general-pr-semantic-proposal";
import { expectNoSelectionSentinels, transientSelectionFixture } from "./general-pr-selection-sentinels.test-fixture";
import { validateVerificationReport } from "./report-validation";
import { generateVerificationReportV2FromInput } from "./verifier";
import type { PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";

const report = { requirements: [], evidenceIndex: [] } as unknown as VerificationReport;

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Return the repository label",
    description: "",
    taskText: "",
    changedFiles: [
      { path: "src/repository-label.ts", status: "modified" },
      { path: "test/repository-label.test.ts", status: "modified" }
    ],
    checks: [{ name: "CI", status: "passed" }],
    logs: [],
    repositoryPrivate: false,
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      changedFileInventory: { version: 1, completeness: "complete", headSha: "b".repeat(40) },
      evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    ...overrides
  };
}

function semanticOnlyInput(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return input({
    title: "Maintenance notes",
    description: "Internal cleanup only.",
    changedFiles: [{ path: "src/status.ts", status: "modified", patch: "+ return Ready;" }],
    ...overrides
  });
}

function semanticProposal(seed: ReturnType<typeof buildGeneralPrObservationSeedV2>): GeneralPrSemanticProposalV2 {
  const span = seed.spans.find((candidate) => seed.sources.find((source) => source.id === candidate.sourceUnitId)?.kind === "pr_title");
  const cluster = seed.changeClusters[0];
  const evidence = seed.evidenceAtoms[0];
  if (!span || !cluster || !evidence) throw new Error("semantic fixture requires bounded source and evidence");
  const groupId = deriveGeneralPrObjectiveGroupIdV2([span.id]);
  return {
    contractVersion: "general_pr_semantic_proposal.v2",
    schemaVersion: "agentproof_general_pr_observer_v2",
    seedHash: seed.seedHash,
    spanRoles: Object.fromEntries(seed.spans.map((candidate) => [candidate.id, {
      spanId: candidate.id,
      role: candidate.id === span.id ? "objective_candidate" as const : "supporting_context" as const,
      abstained: false
    }])),
    objectiveGroups: { [groupId]: { groupId, spanIds: [span.id], disposition: "candidate" } },
    testApplicabilityProposals: [{ objectiveGroupId: groupId, changeClusterId: cluster.id, proposal: "likely_expected" }],
    scopeMappingProposals: [{ objectiveGroupId: groupId, changeClusterId: cluster.id, proposal: "plausibly_mapped" }],
    evidenceRelationProposals: [{ objectiveGroupId: groupId, evidenceId: evidence.id, proposal: "supports" }]
  };
}

function relevantResult(
  assessment: ReturnType<typeof deriveGeneralPrAssessmentV1>,
  bundle: ReturnType<typeof finalizeDeterministicGeneralPrObservationsV2>,
  proposal: GeneralPrSemanticProposalV2
) {
  return {
    assessment: {
      sourceState: assessment.sourceState,
      overallConclusion: assessment.overallConclusion,
      counts: assessment.counts,
      targets: assessment.targets.map(({ targetId: _targetId, sourceBindingRef: _sourceBindingRef, sourceSpanRefs: _sourceSpanRefs, ...target }) => target),
      reasonCodes: assessment.reasonCodes
    },
    proposal: {
      objectiveGroups: Object.values(proposal.objectiveGroups).map(({ groupId: _groupId, ...group }) => group),
      testApplicability: proposal.testApplicabilityProposals.map(({ objectiveGroupId: _objectiveGroupId, changeClusterId: _changeClusterId, ...item }) => item),
      scopeMappings: proposal.scopeMappingProposals.map(({ objectiveGroupId: _objectiveGroupId, changeClusterId: _changeClusterId, ...item }) => item),
      evidenceRelations: proposal.evidenceRelationProposals.map(({ objectiveGroupId: _objectiveGroupId, evidenceId: _evidenceId, ...item }) => item)
    },
    relationLevelCounts: bundle.relationLevelCounts,
    testCoverage: bundle.testCoverage
      .filter((item) => item.relation === "hypothesis")
      .map(({ objectiveId: _objectiveId, changeClusterId: _changeClusterId, ...item }) => item),
    scopeMappings: bundle.scopeMappings
      .filter((item) => item.state === "plausibly_mapped")
      .map(({ objectiveId: _objectiveId, changeClusterId: _changeClusterId, ...item }) => item)
  };
}

describe("deriveGeneralPrAssessmentV1", () => {
  it("caps a PR author objective at partial when only changed artifacts and global CI are observed", () => {
    const seed = buildGeneralPrObservationSeedV2(input());
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);
    Object.assign(bundle as unknown as Record<string, unknown>, { transientObserver: transientSelectionFixture() });

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report })).toMatchObject({
      sourceState: "pr_author_claim",
      overallConclusion: "evidence_partial",
      counts: {
        evidence_supported: 0,
        evidence_partial: 1,
        not_demonstrated: 0,
        contradicted: 0,
        blocked: 0,
        not_assessable: 0
      },
      targets: [expect.objectContaining({
        conclusion: "evidence_partial",
        reasonCodes: expect.arrayContaining(["verified_relation_missing", "author_claim_requires_confirmation"]),
        evidenceRefs: [],
        headBound: true
      })]
    });
    expectNoSelectionSentinels(deriveGeneralPrAssessmentV1({ seed, bundle, report }));
  });

  it("keeps a semantic-only target evidence-partial and its relation hypothesis-only", () => {
    const seed = buildGeneralPrObservationSeedV2(semanticOnlyInput());
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, semanticProposal(seed), "valid");
    const assessment = deriveGeneralPrAssessmentV1({ seed, bundle, report });

    expect(assessment.targets).toEqual([expect.objectContaining({
      admissionBasis: "semantic_span_proposal",
      conclusion: "evidence_partial",
      relationLevels: ["hypothesis"],
      evidenceRefs: []
    })]);
    expect(bundle.relationLevelCounts).toMatchObject({ verified: 0, observed: 0, hypothesis: 1 });
  });

  it("does not turn generic passed CI or a changed test artifact into target-local passed execution", () => {
    const seed = buildGeneralPrObservationSeedV2(input());
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);
    const assessment = deriveGeneralPrAssessmentV1({ seed, bundle, report });

    expect(assessment.targets[0]).toMatchObject({ conclusion: "evidence_partial", evidenceRefs: [] });
    expect(bundle.testCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ execution: "not_observed", summaryState: "relation_unresolved" })
    ]));
  });

  it("does not convert sampled semantic evidence into missing-test or contradiction findings", () => {
    const seed = buildGeneralPrObservationSeedV2(semanticOnlyInput());
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, semanticProposal(seed), "valid", null, [], {
      version: 1,
      claimState: "valid",
      evidenceState: "valid",
      sourceCoverage: "sampled",
      evidenceCoverage: "sampled",
      providerCallCount: 2,
      selectedCountBuckets: { sourceSpans: "1_4", evidenceCandidates: "1_16" }
    });

    expect(bundle.testCoverage).toEqual([expect.objectContaining({
      applicability: "hypothesized_required",
      relation: "hypothesis",
      execution: "not_observed",
      summaryState: "relation_unresolved"
    })]);
    expect(bundle.scopeMappings).toEqual([expect.objectContaining({ state: "plausibly_mapped" })]);
  });

  it("downgrades selected evidence but leaves the complete relevant result unchanged when unrelated evidence is removed", () => {
    const withUnrelated = semanticOnlyInput({ changedFiles: [
      { path: "src/status.ts", status: "modified", patch: "+ return Ready;" },
      { path: "src/unrelated.ts", status: "modified", patch: "+ export const unrelated = true;" }
    ] });
    const selectedSeed = buildGeneralPrObservationSeedV2(withUnrelated);
    const selectedProposal = semanticProposal(selectedSeed);
    const selected = finalizeDeterministicGeneralPrObservationsV2(selectedSeed, selectedProposal, "valid");
    const removedSelected = finalizeDeterministicGeneralPrObservationsV2(selectedSeed, { ...selectedProposal, evidenceRelationProposals: [] }, "valid");
    const withoutUnrelatedSeed = buildGeneralPrObservationSeedV2(semanticOnlyInput({ changedFiles: [withUnrelated.changedFiles[0]!] }));
    const withoutUnrelated = finalizeDeterministicGeneralPrObservationsV2(withoutUnrelatedSeed, semanticProposal(withoutUnrelatedSeed), "valid");
    const baselineAssessment = deriveGeneralPrAssessmentV1({ seed: selectedSeed, bundle: selected, report });
    const withoutUnrelatedAssessment = deriveGeneralPrAssessmentV1({ seed: withoutUnrelatedSeed, bundle: withoutUnrelated, report });

    expect(selected.diagnostics.relationState).toBe("hypothesis_only");
    expect(removedSelected.diagnostics.relationState).toBe("unresolved");
    expect(relevantResult(withoutUnrelatedAssessment, withoutUnrelated, semanticProposal(withoutUnrelatedSeed)))
      .toEqual(relevantResult(baselineAssessment, selected, selectedProposal));
  });

  it("rejects a verified relation copied to another objective", () => {
    const copied = buildObjectiveEvidenceRelationLedgerV1({
      nodes: [
        ...["objective_a", "objective_b"].map((id) => ({ version: 1 as const, id, kind: "objective_group" as const, subjectDigest: "a".repeat(64) })),
        { version: 1 as const, id: "evidence", kind: "evidence_atom" as const, subjectDigest: "a".repeat(64) }
      ],
      edges: ["objective_a", "objective_b"].map((fromNodeId) => ({
        fromNodeId,
        toNodeId: "evidence",
        kind: "syntax_imports" as const,
        level: "verified" as const,
        basis: "typescript_ast_relation" as const,
        subjectDigest: "a".repeat(64),
        evidenceRefs: ["evidence"],
        completeness: "complete" as const
      }))
    });

    expect(copied).toEqual({ valid: false, errors: ["verified evidence cannot be copied across objectives"] });
  });

  it("blocks a target when complete exact-head collection is unavailable", () => {
    const seed = buildGeneralPrObservationSeedV2(input({ sourceProvenance: undefined }));
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report })).toMatchObject({
      overallConclusion: "collection_blocked",
      counts: expect.objectContaining({ blocked: 1 }),
      targets: [expect.objectContaining({
        conclusion: "blocked",
        reasonCodes: expect.arrayContaining(["collection_incomplete"]),
        headBound: false
      })]
    });
  });

  it("retains PR-author source state and diagnostic reasons when no target is admitted", () => {
    const noCandidateInput = input({ title: "Maintenance notes", description: "Internal cleanup only." });
    const seed = buildGeneralPrObservationSeedV2(noCandidateInput);
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");
    const assessment = deriveGeneralPrAssessmentV1({ seed, bundle, report });
    const runtimeReport = generateVerificationReportV2FromInput(noCandidateInput) as VerificationReportV2;
    runtimeReport.generalPrAssessmentSummary = summarizeGeneralPrAssessmentV1(assessment);

    expect(assessment).toMatchObject({
      sourceState: "pr_author_claim",
      overallConclusion: "no_assessable_claims",
      reasonCodes: expect.arrayContaining([
        "author_claim_requires_confirmation",
        "deterministic_candidate_missing",
        "semantic_observer_unavailable"
      ])
    });
    expect(validateVerificationReport(runtimeReport, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
  });

  it("retains linked-Issue source state with zero targets and marks stale ownership ambiguous", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      title: "Maintenance notes",
      taskSource: "issue",
      taskText: "Background information about the current status page."
    }));
    const available = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");
    const stale = finalizeDeterministicGeneralPrObservationsV2(seed, null, "stale");

    expect(deriveGeneralPrAssessmentV1({ seed, bundle: available, report }).sourceState).toBe("linked_issue");
    expect(deriveGeneralPrAssessmentV1({ seed, bundle: stale, report })).toMatchObject({
      sourceState: "ambiguous",
      reasonCodes: expect.arrayContaining(["head_mismatch"])
    });
    expect(deriveGeneralPrAssessmentV1({ seed, bundle: stale, report }).reasonCodes).not.toContain("source_ambiguous");
  });

  it("keeps fallback PR targets as author claims requiring reviewer confirmation", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      title: "Maintenance notes",
      description: "The service must return Ready when checks pass.",
      taskSource: "issue",
      taskText: "Background information about the current status page."
    }));
    const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, null, "unavailable");

    expect(deriveGeneralPrAssessmentV1({ seed, bundle, report }).targets).toEqual([
      expect.objectContaining({
        sourceAuthority: "pr_author_claim",
        reasonCodes: expect.arrayContaining(["author_claim_requires_confirmation"])
      })
    ]);
  });
});
