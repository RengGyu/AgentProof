import { describe, expect, it, vi } from "vitest";
import {
  finalizeDeterministicGeneralPrObservationsV2,
  runGeneralPrObservationNowV2
} from "./general-pr-observation-service";
import { deriveGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";
import { deriveGeneralPrObjectiveGroupIdV2, type GeneralPrSemanticProposalV2 } from "./general-pr-semantic-proposal";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type {
  GeneralPrSemanticObserverModelProfileV2,
  GeneralPrSemanticObserverPackageV4
} from "./general-pr-semantic-observer";
import type { PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";

const report = { schemaVersion: "verification-report.v2", analysisId: "test" } as unknown as VerificationReport;
const input: PullRequestInput = {
  title: "Return Ready when checks pass",
  description: "The service must return Ready when checks pass.",
  taskText: "",
  changedFiles: [{ path: "src/status.ts", status: "modified" }],
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

const modelProfile: GeneralPrSemanticObserverModelProfileV2 = {
  model: "test-model",
  promptVersion: "test-prompt.v1",
  inputFieldPolicyVersion: "test-fields.v1"
};

function semanticProviderCandidate(
  observationSeed: ReturnType<typeof buildGeneralPrObservationSeedV2>,
  sourceKind: "linked_issue" | "pr_title" | "pr_body",
  request: GeneralPrSemanticObserverPackageV4
) {
  const targetSpan = observationSeed.spans.find((span) => (
    observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.kind === sourceKind
  ));
  if (!targetSpan) throw new Error("fixture must include a target span");
  if (request.stage === "evidence_linking") {
    const objective = request.input.objectiveGroups[0];
    if (!objective) throw new Error("fixture must include an evidence objective");
    const clusterId = objective.allowedChangeClusterIds[0];
    const evidenceId = objective.allowedEvidenceIds[0];
    return {
      testApplicabilityProposals: clusterId ? [{ objectiveSpanIds: objective.objectiveSpanIds, changeClusterId: clusterId, proposal: "likely_expected" as const }] : [],
      scopeMappingProposals: clusterId ? [{ objectiveSpanIds: objective.objectiveSpanIds, changeClusterId: clusterId, proposal: "plausibly_mapped" as const }] : [],
      evidenceRelationProposals: evidenceId ? [{ objectiveSpanIds: objective.objectiveSpanIds, evidenceId, proposal: "supports" as const }] : []
    };
  }
  return {
    spanRoles: request.input.spans.map((span) => ({
      spanId: span.id,
      role: span.id === targetSpan.id ? "objective_candidate" : "supporting_context",
    }))
  };
}

function semanticCandidateProposal(
  observationSeed: ReturnType<typeof buildGeneralPrObservationSeedV2>,
  sourceKind: "linked_issue" | "pr_title" | "pr_body"
): GeneralPrSemanticProposalV2 {
  const targetSpan = observationSeed.spans.find((span) => (
    observationSeed.sources.find((source) => source.id === span.sourceUnitId)?.kind === sourceKind
  ));
  const evidence = observationSeed.evidenceAtoms[0];
  const cluster = observationSeed.changeClusters[0];
  if (!targetSpan || !evidence || !cluster) throw new Error("fixture must include a target span and bounded evidence");
  const groupId = deriveGeneralPrObjectiveGroupIdV2([targetSpan.id]);
  return {
    contractVersion: "general_pr_semantic_proposal.v2" as const,
    schemaVersion: "agentproof_general_pr_observer_v2" as const,
    seedHash: observationSeed.seedHash,
    spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
      spanId: span.id,
      role: span.id === targetSpan.id ? "objective_candidate" : "supporting_context",
      abstained: false
    }])),
    objectiveGroups: { [groupId]: { groupId, spanIds: [targetSpan.id], disposition: "candidate" as const } },
    testApplicabilityProposals: [{ objectiveGroupId: groupId, changeClusterId: cluster.id, proposal: "likely_expected" as const }],
    scopeMappingProposals: [{ objectiveGroupId: groupId, changeClusterId: cluster.id, proposal: "plausibly_mapped" as const }],
    evidenceRelationProposals: [{ objectiveGroupId: groupId, evidenceId: evidence.id, proposal: "supports" as const }]
  };
}

describe("runGeneralPrObservationNowV2", () => {
  it("retains a claim-invalid reason only for invalid semantic state", () => {
    const observationSeed = buildGeneralPrObservationSeedV2(input);

    expect(finalizeDeterministicGeneralPrObservationsV2(
      observationSeed,
      null,
      "invalid",
      null,
      [],
      undefined,
      undefined,
      "span_binding_invalid"
    ).semanticClaimInvalidReason).toBe("span_binding_invalid");
    expect(finalizeDeterministicGeneralPrObservationsV2(
      observationSeed,
      null,
      "valid",
      null,
      [],
      undefined,
      undefined,
      "span_binding_invalid"
    ).semanticClaimInvalidReason).toBeNull();
    expect(finalizeDeterministicGeneralPrObservationsV2(
      observationSeed,
      null,
      "valid",
      null,
      [],
      undefined,
      undefined,
      null,
      null,
      { evidenceInvalidReason: "reference_binding_invalid" }
    ).semanticEvidenceInvalidReason).toBe("reference_binding_invalid");
    expect(finalizeDeterministicGeneralPrObservationsV2(
      observationSeed,
      null,
      "unavailable",
      null,
      [],
      undefined,
      undefined,
      null,
      null,
      { freshnessFailure: { phase: "before_claim", state: "unavailable", reason: "auth_unavailable" } }
    ).semanticFreshnessFailure).toEqual({ phase: "before_claim", state: "unavailable", reason: "auth_unavailable" });
  });

  it("returns the exact deterministic report when the feature is disabled", async () => {
    const generateReport = vi.fn(() => report);
    const result = await runGeneralPrObservationNowV2({ policy: resolveGeneralPrAssessmentRuntimePolicyV1("disabled"), input, generateReport, validateDeterministicReport: () => true });

    expect(result.report).toBe(report);
    expect(result.bundle).toBeNull();
    expect(generateReport).toHaveBeenCalledTimes(1);
  });

  it("keeps the deterministic report unchanged in shadow mode while returning only private observations", async () => {
    const result = await runGeneralPrObservationNowV2({ policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input, generateReport: () => report, validateDeterministicReport: () => true });

    expect(result.report).toBe(report);
    expect(result.bundle).toMatchObject({ version: 2, semanticState: "disabled" });
    expect(JSON.stringify(result.bundle)).not.toContain("Return Ready when checks pass");
  });

  it("bypasses semantics for an explicit deterministic objective without changing the advisory assessment", async () => {
    const v2Report = {
      ...report,
      reportSchemaVersion: "verification-report.v2",
      verificationContract: { state: "absent" },
      requirements: [{ requirementId: "req_1", status: "unclear" }]
    } as unknown as VerificationReportV2;
    const provider = { observe: vi.fn(async () => null) };
    const result = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
      input,
      generateReport: () => v2Report,
      validateDeterministicReport: () => true,
      semantic: {
        provider,
        providerAvailable: true,
        privateRepository: false,
        readCurrentInput: async () => input,
        modelProfile
      }
    });

    const deterministicBundle = finalizeDeterministicGeneralPrObservationsV2(
      buildGeneralPrObservationSeedV2(input),
      null,
      "disabled"
    );

    expect(provider.observe).not.toHaveBeenCalled();
    expect(result.bundle).toEqual(deterministicBundle);
    expect(result.bundle).toMatchObject({
      semanticState: "disabled",
      semanticStageDiagnostics: { claimState: "not_run", evidenceState: "not_run", providerCallCount: 0 },
      diagnostics: { semanticAdmission: "not_needed" }
    });
    expect(result.report).not.toBe(v2Report);
    expect(JSON.stringify(result.report.requirements)).toBe(JSON.stringify(v2Report.requirements));
    expect((result.report as VerificationReportV2).generalPrAssessmentSummary).toMatchObject({
      overallConclusion: "evidence_partial",
      counts: expect.objectContaining({ evidence_supported: 0, evidence_partial: 2 }),
      observations: {
        inventory: { state: "complete", changedArtifacts: 1, changedTestCandidates: 0 },
        links: { state: "not_attempted", linkedObjectives: 0, supports: 0, tests: 0, implements: 0, contradicts: 0 }
      }
    });
    expect(JSON.stringify(result.report)).not.toContain("ledgerDigest");
    expect(JSON.stringify(result.report)).not.toContain("diagnostics");
    expect(JSON.stringify(result.report)).not.toContain("sourceSpanRefs");
  });

  it("returns the deterministic report when runtime validation or collection fails", async () => {
    const invalid = await runGeneralPrObservationNowV2({ policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input, generateReport: () => report, validateDeterministicReport: () => false });
    const oversized = await runGeneralPrObservationNowV2({ policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input: { ...input, description: "x".repeat(64_001) }, generateReport: () => report, validateDeterministicReport: () => true });

    expect(invalid).toMatchObject({ report, bundle: null });
    expect(oversized).toMatchObject({
      report,
      bundle: { diagnostics: { sourceCollection: "parse_incomplete", semanticAdmission: "not_needed" } }
    });
  });

  it("records a valid semantic proposal only as private hypothesis observations", async () => {
    const semanticInput = {
      ...input,
      title: "Maintenance notes",
      description: "Internal cleanup only.",
      changedFiles: [{ path: "src/status.ts", status: "modified" as const, patch: "+ return Ready;" }]
    };
    const observationSeed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = { observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => semanticProviderCandidate(observationSeed, "pr_title", request)) };
    const result = await runGeneralPrObservationNowV2({
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

    expect(result.report).toBe(report);
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(result.bundle).toMatchObject({
      semanticState: "valid",
      semanticStageDiagnostics: {
        claimState: "valid",
        evidenceState: "valid",
        providerCallCount: 2,
        sourceCoverage: "complete",
        evidenceCoverage: "complete"
      }
    });
    expect(result.bundle?.objectives).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "hypothesis", admissionBasis: "semantic_proposal" })
    ]));
    expect(result.bundle?.testCoverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ applicability: "hypothesized_required", relation: "hypothesis", summaryState: "relation_unresolved" })
    ]));
    expect(result.bundle?.scopeMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "plausibly_mapped" })
    ]));
    expect(result.bundle?.ledgerDigest).not.toBe(finalizeDeterministicGeneralPrObservationsV2(observationSeed).ledgerDigest);
    expect(JSON.stringify(result.bundle)).not.toContain("test-model");
    expect(result.bundle).not.toHaveProperty("selectionManifest");
    expect(result.bundle).not.toHaveProperty("receipt");
    expect(JSON.stringify(result.bundle)).not.toMatch(/claimSelectionHash|evidenceSelectionHash|tokenSketch|changeClusterDescriptors|evidenceDescriptors/i);
  });

  it("distinguishes unavailable, invalid, stale, and admitted semantic pipeline states", async () => {
    const noCandidateInput = { ...input, title: "Maintenance notes", description: "Internal cleanup only." };
    const unavailable = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"),
      input: noCandidateInput,
      generateReport: () => report,
      validateDeterministicReport: () => true
    });
    const invalid = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"),
      input: noCandidateInput,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: { provider: { observe: async () => ({}) }, providerAvailable: true, privateRepository: false, readCurrentInput: async () => noCandidateInput, modelProfile }
    });
    const staleProvider = { observe: vi.fn(async () => ({})) };
    const stale = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"),
      input: noCandidateInput,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: { provider: staleProvider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => ({ ...noCandidateInput, title: "Changed title" }), modelProfile }
    });
    const semanticSeed = buildGeneralPrObservationSeedV2(noCandidateInput);
    const admitted = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"),
      input: noCandidateInput,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: { provider: { observe: async (request) => semanticProviderCandidate(semanticSeed, "pr_title", request) }, providerAvailable: true, privateRepository: false, readCurrentInput: async () => noCandidateInput, modelProfile }
    });

    expect(unavailable.bundle?.diagnostics).toMatchObject({ sourceCollection: "available", deterministicAdmission: "no_candidate", semanticAdmission: "unavailable" });
    expect(invalid.bundle?.diagnostics).toMatchObject({ semanticAdmission: "invalid" });
    expect(invalid.bundle?.semanticClaimInvalidReason).toBe("root_shape_invalid");
    expect(JSON.stringify(invalid.report)).not.toMatch(/claimInvalidReason|semanticClaimInvalidReason/);
    expect(stale.bundle?.diagnostics).toMatchObject({ semanticAdmission: "stale" });
    expect(staleProvider.observe).not.toHaveBeenCalled();
    expect(admitted.bundle?.diagnostics).toMatchObject({
      semanticAdmission: "admitted",
      relationState: "hypothesis_only",
      counts: { sourceUnits: 2, eligibleSpans: 2, deterministicCandidates: 0, semanticCandidates: 1, admittedTargets: 1 }
    });
  });

  it("projects semantic no-candidate, invalid output, and provider failure with distinct reasons", async () => {
    const semanticInput = { ...input, title: "Maintenance notes", description: "Internal cleanup only." };
    const v2Report = {
      ...report,
      reportSchemaVersion: "verification-report.v2",
      verificationContract: { state: "absent" },
      requirements: [{ requirementId: "req_1", status: "unclear" }]
    } as unknown as VerificationReportV2;
  const run = (provider: { observe: (request: GeneralPrSemanticObserverPackageV4) => Promise<unknown> }) => runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
      input: semanticInput,
      generateReport: () => v2Report,
      validateDeterministicReport: () => true,
      semantic: { provider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => semanticInput, modelProfile }
    });

    const empty = await run({
      observe: async (request) => request.stage === "claim_discovery"
        ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "supporting_context" })) }
        : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] }
    });
    const invalid = await run({ observe: async () => ({ spanRoles: [], objectiveGroups: undefined }) });
    const failed = await run({ observe: async () => { throw new Error("provider unavailable"); } });

    expect((empty.report as VerificationReportV2).generalPrAssessmentSummary?.reasonCodes).toContain("semantic_candidate_missing");
    expect((empty.report as VerificationReportV2).generalPrAssessmentSummary?.reasonCodes).not.toContain("semantic_proposal_invalid");
    expect((invalid.report as VerificationReportV2).generalPrAssessmentSummary?.reasonCodes).toContain("semantic_proposal_invalid");
    expect((failed.report as VerificationReportV2).generalPrAssessmentSummary?.reasonCodes).toContain("semantic_observer_unavailable");
    expect((failed.report as VerificationReportV2).generalPrAssessmentSummary?.reasonCodes).not.toContain("semantic_candidate_missing");
    for (const result of [empty, invalid, failed]) {
      expect(JSON.stringify(result.report.requirements)).toBe(JSON.stringify(v2Report.requirements));
      expect((result.report as VerificationReportV2).generalPrAssessmentSummary?.counts.evidence_supported).toBe(0);
      expect(JSON.stringify(result.report)).not.toContain("semanticFailureStage");
      expect(JSON.stringify(result.report)).not.toContain("semanticPackageFailureReasons");
    }
  });

  it.each(["shadow", "advisory"] as const)("automatically stages eligible %s runs and keeps sampled effects hypothesis-only", async (mode) => {
    const semanticInput: PullRequestInput = {
      ...input,
      title: "Maintenance notes",
      description: Array.from({ length: 16 }, (_, index) => `- Requirement ${index}: return status ${index}.`).join("\n"),
      changedFiles: Array.from({ length: 20 }, (_, index) => ({
        path: `src/status-${index}.ts`,
        status: "modified" as const,
        patch: `+ return status${index};`
      }))
    };
    const seed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = { observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => semanticProviderCandidate(seed, "pr_title", request)) };
    const result = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1(mode),
      input: semanticInput,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: { provider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => semanticInput, modelProfile }
    });

    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(result.bundle?.semanticStageDiagnostics).toMatchObject({
      claimState: "valid",
      evidenceState: "valid",
      providerCallCount: 2,
      sourceCoverage: "sampled",
      evidenceCoverage: "sampled"
    });
    expect(result.bundle?.objectives.every((objective) => objective.state !== "observed")).toBe(true);
    expect(result.bundle?.relationLevelCounts).toMatchObject({ verified: 0, observed: 0 });
    expect(result.bundle?.diagnostics).toMatchObject({ semanticAdmission: "admitted", relationState: "hypothesis_only" });
    expect(Object.values(result.bundle?.semanticSelectionOmittedReasonCounts ?? {}).some((count) => count > 0)).toBe(true);
  });

  it("keeps the strict requirement section byte-identical when Stage B fails", async () => {
    const semanticInput: PullRequestInput = {
      ...input,
      title: "Maintenance notes",
      description: "Internal cleanup only.",
      changedFiles: [{ path: "src/status.ts", status: "modified", patch: "+ return Ready;" }]
    };
    const seed = buildGeneralPrObservationSeedV2(semanticInput);
    const strictReport = {
      ...report,
      reportSchemaVersion: "verification-report.v2",
      verificationContract: { state: "absent" },
      requirements: [{ requirementId: "req_1", status: "unclear", evidence: ["baseline"] }]
    } as unknown as VerificationReportV2;
    const provider = {
      observe: vi.fn(async (request: GeneralPrSemanticObserverPackageV4) => {
        if (request.stage === "evidence_linking") throw new Error("stage B unavailable");
        return semanticProviderCandidate(seed, "pr_title", request);
      })
    };

    const result = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
      input: semanticInput,
      generateReport: () => strictReport,
      validateDeterministicReport: () => true,
      semantic: { provider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => semanticInput, modelProfile }
    });

    expect(JSON.stringify(result.report.requirements)).toBe(JSON.stringify(strictReport.requirements));
    expect(provider.observe.mock.calls.map(([request]) => request.stage)).toEqual(["claim_discovery", "evidence_linking"]);
    expect(result.bundle).toMatchObject({
      semanticState: "valid",
      semanticStageDiagnostics: { claimState: "valid", evidenceState: "unavailable", providerCallCount: 2 }
    });
    expect(result.bundle?.objectives).toEqual([expect.objectContaining({ state: "hypothesis" })]);
    expect(result.bundle?.relationLevelCounts.verified).toBe(0);
    const assessment = deriveGeneralPrAssessmentV1({ seed, bundle: result.bundle!, report: result.report });
    expect(assessment).toMatchObject({ counts: { evidence_supported: 0, evidence_partial: 1 } });
    expect(assessment.observations?.links).toMatchObject({
      state: "unavailable", linkedObjectives: 0, supports: 0, tests: 0, implements: 0, contradicts: 0
    });
  });

  it("rejects provided requirements and non-GitHub inputs before semantic provider submission", async () => {
    const provider = { observe: vi.fn(async () => null) };
    const providedRequirement = {
      ...input,
      title: "Maintenance notes",
      description: "Internal cleanup only.",
      taskText: "Acceptance criteria: send this request text to the provider.",
      taskSource: "task" as const
    };
    const pastedEvidence = {
      ...input,
      title: "Maintenance notes",
      description: "Internal cleanup only.",
      sourceProvenance: {
        ...input.sourceProvenance!,
        origin: "pasted_evidence" as const
      }
    };

    const provided = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
      input: providedRequirement,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: { provider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => providedRequirement, modelProfile }
    });
    const pasted = await runGeneralPrObservationNowV2({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
      input: pastedEvidence,
      generateReport: () => report,
      validateDeterministicReport: () => true,
      semantic: { provider, providerAvailable: true, privateRepository: false, readCurrentInput: async () => pastedEvidence, modelProfile }
    });

    expect(provider.observe).not.toHaveBeenCalled();
    expect(provided.bundle).toMatchObject({
      semanticState: "ineligible",
      diagnostics: { semanticAdmission: "ineligible" }
    });
    expect(pasted.bundle).toMatchObject({
      semanticState: "ineligible",
      diagnostics: { semanticAdmission: "ineligible" }
    });
    expect(deriveGeneralPrAssessmentV1({ seed: buildGeneralPrObservationSeedV2(pastedEvidence), bundle: pasted.bundle!, report }).reasonCodes)
      .toContain("semantic_observer_ineligible");
  });

  it("marks semantic observation not needed when a deterministic target is already admitted", () => {
    const observationSeed = buildGeneralPrObservationSeedV2(input);
    const observationBundle = finalizeDeterministicGeneralPrObservationsV2(observationSeed, null, "unavailable");
    const assessment = deriveGeneralPrAssessmentV1({ seed: observationSeed, bundle: observationBundle, report });

    expect(observationBundle.diagnostics.semanticAdmission).toBe("not_needed");
    expect(assessment.reasonCodes).not.toContain("semantic_observer_unavailable");
  });

  it("reports deterministic candidates even when a primary semantic target wins tier selection", () => {
    const observationSeed = buildGeneralPrObservationSeedV2({
      ...input,
      title: "Maintenance notes",
      description: "The service must return Ready when checks pass.",
      taskSource: "issue",
      taskText: "Background information about the current status page."
    });
    const observationBundle = finalizeDeterministicGeneralPrObservationsV2(
      observationSeed,
      semanticCandidateProposal(observationSeed, "linked_issue"),
      "valid"
    );
    const assessment = deriveGeneralPrAssessmentV1({ seed: observationSeed, bundle: observationBundle, report });

    expect(observationBundle.diagnostics).toMatchObject({
      deterministicAdmission: "admitted",
      semanticAdmission: "admitted",
      counts: { deterministicCandidates: 1, semanticCandidates: 1, admittedTargets: 1 }
    });
    expect(assessment.reasonCodes).not.toContain("deterministic_candidate_missing");
  });

  it("admits a fallback PR author target only when the linked Issue has no primary target", () => {
    const fallbackSeed = buildGeneralPrObservationSeedV2({
      ...input,
      title: "Maintenance notes",
      description: "Desired outcome: Ready status is visible.",
      taskSource: "issue",
      taskText: "Background information about the current status page."
    });
    const fallbackProposal = semanticCandidateProposal(fallbackSeed, "pr_body");
    const fallbackBundle = finalizeDeterministicGeneralPrObservationsV2(fallbackSeed, fallbackProposal, "valid");
    const primarySeed = buildGeneralPrObservationSeedV2({
      ...input,
      title: "Maintenance notes",
      description: "Desired outcome: Ready status is visible.",
      taskSource: "issue",
      taskText: "The service must return Ready when checks pass."
    });
    const primaryBundle = finalizeDeterministicGeneralPrObservationsV2(primarySeed, semanticCandidateProposal(primarySeed, "pr_body"), "valid");

    expect(fallbackBundle.objectives).toHaveLength(1);
    expect(fallbackBundle.objectives[0]).toMatchObject({ authority: "author_claim", state: "hypothesis" });
    expect(primaryBundle.objectives).toHaveLength(1);
    expect(primaryBundle.objectives[0]).toMatchObject({ authority: "authoritative", admissionBasis: "explicit_structure" });
  });
});
