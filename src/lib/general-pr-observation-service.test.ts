import { describe, expect, it, vi } from "vitest";
import {
  finalizeDeterministicGeneralPrObservationsV2,
  runGeneralPrObservationNowV2
} from "./general-pr-observation-service";
import { deriveGeneralPrAssessmentV1 } from "./general-pr-assessment";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";
import { deriveGeneralPrObjectiveGroupIdV2, type GeneralPrSemanticProposalV2 } from "./general-pr-semantic-proposal";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type { GeneralPrSemanticObserverModelProfileV2 } from "./general-pr-semantic-observer";
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

function validProposal(observationSeed: ReturnType<typeof buildGeneralPrObservationSeedV2>) {
  const objectives = observationSeed.spans.filter((span) => span.deterministicRole === "objective_candidate");
  if (objectives.length === 0) throw new Error("fixture must include an objective candidate");
  const groups = objectives.map((objective) => {
    const groupId = deriveGeneralPrObjectiveGroupIdV2([objective.id]);
    return { groupId, spanIds: [objective.id], disposition: "candidate" as const };
  });
  const firstGroup = groups[0];
  const firstCluster = observationSeed.changeClusters[0];
  const firstEvidence = observationSeed.evidenceAtoms[0];
  if (!firstGroup || !firstCluster || !firstEvidence) throw new Error("fixture must include bounded change evidence");
  return {
    contractVersion: "general_pr_semantic_proposal.v2" as const,
    schemaVersion: "agentproof_general_pr_observer_v2" as const,
    seedHash: observationSeed.seedHash,
    spanRoles: Object.fromEntries(observationSeed.spans.map((span) => [span.id, {
      spanId: span.id,
      role: span.deterministicRole === "unresolved" ? "mixed_or_ambiguous" : span.deterministicRole,
      abstained: span.deterministicRole === "unresolved"
    }])),
    objectiveGroups: Object.fromEntries(groups.map((group) => [group.groupId, group])),
    testApplicabilityProposals: [{ objectiveGroupId: firstGroup.groupId, changeClusterId: firstCluster.id, proposal: "likely_expected" as const }],
    scopeMappingProposals: [{ objectiveGroupId: firstGroup.groupId, changeClusterId: firstCluster.id, proposal: "plausibly_mapped" as const }],
    evidenceRelationProposals: [{ objectiveGroupId: firstGroup.groupId, evidenceId: firstEvidence.id, proposal: "supports" as const }]
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
    expect(result.bundle).toMatchObject({ version: 2, semanticState: "unavailable" });
    expect(JSON.stringify(result.bundle)).not.toContain("Return Ready when checks pass");
  });

  it("adds only a bounded companion assessment in advisory mode without changing strict requirement status", async () => {
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

    expect(provider.observe).toHaveBeenCalledTimes(1);
    expect(result.report).not.toBe(v2Report);
    expect(result.report.requirements.map((requirement) => requirement.status)).toEqual(["unclear"]);
    expect((result.report as VerificationReportV2).generalPrAssessmentSummary).toMatchObject({
      overallConclusion: "mixed_evidence",
      counts: expect.objectContaining({ evidence_supported: 0, evidence_partial: 2 })
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
    const semanticInput = { ...input, title: "Maintenance notes", description: "Internal cleanup only." };
    const observationSeed = buildGeneralPrObservationSeedV2(semanticInput);
    const provider = { observe: vi.fn(async () => semanticCandidateProposal(observationSeed, "pr_title")) };
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
    expect(provider.observe).toHaveBeenCalledTimes(1);
    expect(result.bundle).toMatchObject({ semanticState: "valid" });
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
      semantic: { provider: { observe: async () => semanticCandidateProposal(semanticSeed, "pr_title") }, providerAvailable: true, privateRepository: false, readCurrentInput: async () => noCandidateInput, modelProfile }
    });

    expect(unavailable.bundle?.diagnostics).toMatchObject({ sourceCollection: "available", deterministicAdmission: "no_candidate", semanticAdmission: "unavailable" });
    expect(invalid.bundle?.diagnostics).toMatchObject({ semanticAdmission: "invalid" });
    expect(stale.bundle?.diagnostics).toMatchObject({ semanticAdmission: "stale" });
    expect(staleProvider.observe).not.toHaveBeenCalled();
    expect(admitted.bundle?.diagnostics).toMatchObject({
      semanticAdmission: "admitted",
      relationState: "hypothesis_only",
      counts: { sourceUnits: 2, eligibleSpans: 2, deterministicCandidates: 0, semanticCandidates: 1, admittedTargets: 1 }
    });
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
