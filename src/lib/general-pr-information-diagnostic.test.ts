import { describe, expect, it } from "vitest";
import { isValidGeneralPrTargetDiagnosticV1, runGeneralPrInformationDiagnosticV1 } from "./general-pr-information-diagnostic";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";
import type { PullRequestInput, VerificationReport } from "./types";

const input: PullRequestInput = {
  title: "Public maintenance", description: "- Repair the public status endpoint.", taskText: "", changedFiles: [{ path: "src/status.ts", status: "modified", patch: "export const status = 'ready'" }], checks: [], logs: [], repositoryPrivate: false,
  sourceProvenance: { version: 1, origin: "github_snapshot", baseSha: "b".repeat(40), headSha: "a".repeat(40), changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) }, evidenceCapturedAt: "2026-09-07T00:00:00.000Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } }
};

describe("general PR information diagnostic", () => {
  it("keeps a bounded opaque target chain across proposal, validation, and proof gaps", async () => {
    const observed = await runGeneralPrInformationDiagnosticV1({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input,
      generateReport: () => ({ reportSchemaVersion: "verification-report.v2" } as unknown as VerificationReport), validateDeterministicReport: () => true,
      semantic: { providerAvailable: true, privateRepository: false, readCurrentInput: async () => input, modelProfile: { model: "test", promptVersion: "test", inputFieldPolicyVersion: "test" }, provider: { observe: async (request) => request.stage === "claim_discovery"
        ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "objective_candidate" })) }
        : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: request.input.objectiveGroups.slice(0, 1).map((group) => ({ objectiveSpanIds: group.objectiveSpanIds, evidenceId: group.allowedEvidenceIds[0], proposal: "supports" })) } } }
    });
    const row = observed.diagnostic.targets[0]!;
    expect(observed.diagnostic).toMatchObject({ version: 1, targetCount: 2, omittedTargetCount: 0, rejectedProviderProposalCount: 0, projectionOmissionCounts: { targetLimit: 0, sourceRefLimit: 0, changeClusterRefLimit: 0, evidenceRefLimit: 0, proposalLimit: 0 } });
    expect(isValidGeneralPrTargetDiagnosticV1(observed.diagnostic)).toBe(true);
    expect(row).toMatchObject({ targetRef: "target_1", selectedSourceSpanRefs: ["span_1"], sourceObligation: "author_claim_confirmation", currentAssessmentEligibility: "eligible", objectiveState: "semantic_candidate", admissionDisposition: "admitted", nonAdmissionReason: "not_applicable", proposedRelations: [{ kind: "evidence_relation", proposal: "supports", referenceRef: "evidence_1", validatorDisposition: "accepted", finalizerDisposition: "used" }], validator: { scope: "global_stage", claimState: "valid", evidenceState: "valid", capability: "semantic_relation_validation_only" }, currentAssessmentCeiling: "evidence_partial", missingProofReasons: ["author_claim_confirmation_required", "verified_objective_change_relation_not_evaluated", "targeted_test_requirement_not_evaluated", "exact_head_execution_not_evaluated"] });
    expect(JSON.stringify(observed.diagnostic)).not.toMatch(/Public maintenance|status\.ts|export const|sourceText|providerOutput|seedHash/i);

    const malformed = JSON.parse(JSON.stringify(observed.diagnostic));
    malformed.targets[0].proposedRelations[0].referenceRef = "evidence_240";
    expect(isValidGeneralPrTargetDiagnosticV1(malformed)).toBe(false);
    malformed.targets[0].proposedRelations[0].referenceRef = "evidence_1";
    malformed.targets[0].selectedSourceSpanRefs = ["span_241"];
    expect(isValidGeneralPrTargetDiagnosticV1(malformed)).toBe(false);
    malformed.targets[0].selectedSourceSpanRefs = ["span_1"];
    malformed.targets[0].missingProofReasons = ["arbitrary_reason"];
    expect(isValidGeneralPrTargetDiagnosticV1(malformed)).toBe(false);
    malformed.targets[0].missingProofReasons = ["author_claim_confirmation_required"];
    malformed.extra = true;
    expect(isValidGeneralPrTargetDiagnosticV1(malformed)).toBe(false);
    delete malformed.extra;
    malformed.targets[0].validator.extra = true;
    expect(isValidGeneralPrTargetDiagnosticV1(malformed)).toBe(false);

    for (const mutate of [
      (v: any) => { v.targets[0].validator.claimState = "invalid"; },
      (v: any) => { v.targets[0].validator.claimState = "invalid"; v.targets[0].validator.claimInvalidReason = "span_binding_invalid"; v.targets[0].validator.evidenceState = "valid"; },
      (v: any) => { v.targets[0].validator.capability = "collection_only"; },
      (v: any) => { v.targets[0].proposedRelations[0].finalizerDisposition = "not_applicable"; },
      (v: any) => { v.targets[0].validator.evidenceState = "invalid"; v.targets[0].validator.evidenceInvalidReason = "root_shape_invalid"; v.targets[0].proposedRelations[0].validatorDisposition = "rejected"; v.targets[0].proposedRelations[0].finalizerDisposition = "not_used"; },
      (v: any) => { v.targets[0].admissionDisposition = "not_admitted"; v.targets[0].nonAdmissionReason = "finalizer_not_admitted"; v.targets[0].currentAssessmentCeiling = "not_assessable"; v.targets[0].missingProofReasons.push("candidate_not_admitted"); },
      (v: any) => { v.targets[0].currentAssessmentCeiling = "not_assessable"; },
      (v: any) => { v.targets[0].missingProofReasons = v.targets[0].missingProofReasons.filter((x: string) => x !== "author_claim_confirmation_required"); },
      (v: any) => { v.targets[0].missingProofReasons.push("candidate_not_admitted"); },
      (v: any) => { v.targets[0].sourceObligation = "unavailable"; },
      (v: any) => { v.targets[0].currentAssessmentEligibility = "unavailable"; },
      (v: any) => { v.targets[0].sourceObligation = "authoritative_requirement"; v.targets[0].currentAssessmentEligibility = "unavailable"; },
      (v: any) => { v.targets[0].admissionDisposition = "not_admitted"; v.targets[0].nonAdmissionReason = "finalizer_not_admitted"; v.targets[0].currentAssessmentCeiling = "not_assessable"; v.targets[0].missingProofReasons.push("candidate_not_admitted"); v.targets[0].sourceObligation = "unavailable"; },
      (v: any) => { v.targets[0].admissionDisposition = "not_admitted"; v.targets[0].nonAdmissionReason = "finalizer_not_admitted"; v.targets[0].currentAssessmentCeiling = "not_assessable"; v.targets[0].missingProofReasons.push("candidate_not_admitted"); v.targets[0].missingProofReasons = v.targets[0].missingProofReasons.filter((x: string) => x !== "author_claim_confirmation_required"); },
      (v: any) => { const a: any = [v.targets[0]]; a.extra = true; v.targets = a; },
      (v: any) => { v.targets = []; v.targetCount = 0; v.omittedTargetCount = 100; v.projectionOmissionCounts.targetLimit = 100; }
    ]) { const candidate = structuredClone(observed.diagnostic); mutate(candidate); expect(isValidGeneralPrTargetDiagnosticV1(candidate)).toBe(false); }
    const cross = structuredClone(observed.diagnostic);
    cross.targets[1].validator.capability = "collection_incomplete";
    expect(isValidGeneralPrTargetDiagnosticV1(cross)).toBe(false);
    cross.targets[1].validator.capability = cross.targets[0].validator.capability;
    cross.targets[1].missingProofReasons.push("exact_head_subject_required");
    expect(isValidGeneralPrTargetDiagnosticV1(cross)).toBe(false);
    cross.targets[1].missingProofReasons = [...cross.targets[0].missingProofReasons];
    cross.targets[1].currentAssessmentEligibility = "ineligible_provided_requirement";
    expect(isValidGeneralPrTargetDiagnosticV1(cross)).toBe(false);
    const ownership = structuredClone(observed.diagnostic);
    ownership.targets[1].selectedSourceSpanRefs = ["span_1"];
    expect(isValidGeneralPrTargetDiagnosticV1(ownership)).toBe(false);
    ownership.targets[1].selectedSourceSpanRefs = ["span_2"];
    ownership.targets[1].selectedEvidenceRefs = ["evidence_1"];
    ownership.targets[1].proposedRelations = [{ ...ownership.targets[0].proposedRelations[0] }];
    expect(isValidGeneralPrTargetDiagnosticV1(ownership)).toBe(false);
    const encounter = structuredClone(observed.diagnostic);
    encounter.targets[0].selectedSourceSpanRefs = ["span_2", "span_1"];
    expect(isValidGeneralPrTargetDiagnosticV1(encounter)).toBe(false);
  });

  it("preserves request-bound selected refs when Stage B rejects", async () => {
    const observed = await runGeneralPrInformationDiagnosticV1({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input,
      generateReport: () => ({ reportSchemaVersion: "verification-report.v2" } as unknown as VerificationReport), validateDeterministicReport: () => true,
      semantic: { providerAvailable: true, privateRepository: false, readCurrentInput: async () => input, modelProfile: { model: "test", promptVersion: "test", inputFieldPolicyVersion: "test" }, provider: { observe: async (request) => request.stage === "claim_discovery" ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "objective_candidate" })) } : Promise.reject(new Error("closed")) } }
    });
    expect(observed.diagnostic.targets).toHaveLength(2);
    expect(observed.diagnostic.targets[0]).toMatchObject({ selectedSourceSpanRefs: ["span_1"], selectedEvidenceRefs: ["evidence_1"], proposedRelations: [] });
    expect(isValidGeneralPrTargetDiagnosticV1(observed.diagnostic)).toBe(true);
  });

  it("does not count missing Stage-B proposal collections as rejected entries", async () => {
    const observed = await runGeneralPrInformationDiagnosticV1({ policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input, generateReport: () => ({ reportSchemaVersion: "verification-report.v2" } as unknown as VerificationReport), validateDeterministicReport: () => true, semantic: { providerAvailable: true, privateRepository: false, readCurrentInput: async () => input, modelProfile: { model: "test", promptVersion: "test", inputFieldPolicyVersion: "test" }, provider: { observe: async (request) => request.stage === "claim_discovery" ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "objective_candidate" })) } : {} } } });
    expect(observed.diagnostic.rejectedProviderProposalCount).toBe(0);
    expect(observed.diagnostic.targets[0]?.validator.evidenceInvalidReason).toBe("root_shape_invalid");
    expect(isValidGeneralPrTargetDiagnosticV1(observed.diagnostic)).toBe(true);
  });

  it("accepts a saturated target-limit omission count for a bounded parser projection", async () => {
    const observed = await runGeneralPrInformationDiagnosticV1({ policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input, generateReport: () => ({ reportSchemaVersion: "verification-report.v2" } as unknown as VerificationReport), validateDeterministicReport: () => true, semantic: { providerAvailable: true, privateRepository: false, readCurrentInput: async () => input, modelProfile: { model: "test", promptVersion: "test", inputFieldPolicyVersion: "test" }, provider: { observe: async (request) => request.stage === "claim_discovery" ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "objective_candidate" })) } : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] } } } });
    const row = structuredClone(observed.diagnostic.targets[0]!);
    const diagnostic = { ...observed.diagnostic, targetCount: 20, omittedTargetCount: 100, projectionOmissionCounts: { targetLimit: 100, sourceRefLimit: 0, changeClusterRefLimit: 0, evidenceRefLimit: 0, proposalLimit: 0 }, targets: Array.from({ length: 20 }, (_, index) => ({ ...row, targetRef: `target_${index + 1}`, selectedSourceSpanRefs: [`span_${index + 1}`] })) };
    expect(isValidGeneralPrTargetDiagnosticV1(diagnostic)).toBe(true);
  });

  it("retains primary and fallback request groups when Stage B rejects", async () => {
    const linked: PullRequestInput = { ...input, taskText: "- The linked requirement must remain available.", taskSource: "issue" };
    const observed = await runGeneralPrInformationDiagnosticV1({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input: linked,
      generateReport: () => ({ reportSchemaVersion: "verification-report.v2" } as unknown as VerificationReport), validateDeterministicReport: () => true,
      semantic: { providerAvailable: true, privateRepository: false, readCurrentInput: async () => linked, modelProfile: { model: "test", promptVersion: "test", inputFieldPolicyVersion: "test" }, provider: { observe: async (request) => request.stage === "claim_discovery" ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "objective_candidate" })) } : Promise.reject(new Error("closed")) } }
    });
    expect(observed.diagnostic.targets).toHaveLength(3);
    expect(observed.diagnostic.targets.every((row) => row.selectedSourceSpanRefs.length > 0 && row.selectedEvidenceRefs.length > 0 && row.selectedChangeClusterRefs.length > 0)).toBe(true);
    expect(observed.diagnostic.targets.filter((row) => row.admissionDisposition === "admitted")).toHaveLength(1);
    expect(observed.diagnostic.targets.filter((row) => row.nonAdmissionReason === "finalizer_not_admitted")).toHaveLength(2);
    expect(isValidGeneralPrTargetDiagnosticV1(observed.diagnostic)).toBe(true);
  });

  it("records accepted and finalizer-used evidence, test, and scope proposals", async () => {
    const observed = await runGeneralPrInformationDiagnosticV1({
      policy: resolveGeneralPrAssessmentRuntimePolicyV1("shadow"), input,
      generateReport: () => ({ reportSchemaVersion: "verification-report.v2" } as unknown as VerificationReport), validateDeterministicReport: () => true,
      semantic: { providerAvailable: true, privateRepository: false, readCurrentInput: async () => input, modelProfile: { model: "test", promptVersion: "test", inputFieldPolicyVersion: "test" }, provider: { observe: async (request) => request.stage === "claim_discovery" ? { spanRoles: request.input.spans.map((span) => ({ spanId: span.id, role: "objective_candidate" })) } : (() => { const group = request.input.objectiveGroups[0]!; return { testApplicabilityProposals: [{ objectiveSpanIds: group.objectiveSpanIds, changeClusterId: group.allowedChangeClusterIds[0], proposal: "ambiguous" }], scopeMappingProposals: [{ objectiveSpanIds: group.objectiveSpanIds, changeClusterId: group.allowedChangeClusterIds[0], proposal: "unresolved" }], evidenceRelationProposals: [{ objectiveSpanIds: group.objectiveSpanIds, evidenceId: group.allowedEvidenceIds[0], proposal: "supports" }] }; })() } }
    });
    const row = observed.diagnostic.targets[0]!;
    expect(row.proposedRelations).toHaveLength(3);
    expect(row.proposedRelations.every((relation) => relation.validatorDisposition === "accepted" && relation.finalizerDisposition === "used")).toBe(true);
    expect(row.proposedRelations.every((relation) => relation.kind === "evidence_relation" ? row.selectedEvidenceRefs.includes(relation.referenceRef) : row.selectedChangeClusterRefs.includes(relation.referenceRef))).toBe(true);
    expect(row.missingProofReasons).toContain("verified_objective_change_relation_not_evaluated");
  });

});
