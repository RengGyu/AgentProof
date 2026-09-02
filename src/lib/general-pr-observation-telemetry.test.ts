import { describe, expect, it } from "vitest";
import {
  buildGeneralPrObservationTelemetryV1,
  buildGeneralPrSemanticOperatorDiagnosticsV1
} from "./general-pr-observation-telemetry";
import type { GeneralPrObservationBundleV2 } from "./general-pr-observation-service";

const bundle: GeneralPrObservationBundleV2 = {
  version: 2,
  seedHash: "a".repeat(64),
  ledgerDigest: "b".repeat(64),
  objectives: [{
    id: "private-objective-id",
    sourceSpanIds: ["private-span-id"],
    authority: "author_claim",
    admissionBasis: "semantic_proposal",
    state: "hypothesis"
  }],
  relationLevelCounts: { verified: 0, observed: 0, hypothesis: 2, unresolved: 0, unavailable: 0 },
  testCoverage: [{
    version: 2,
    objectiveId: "private-objective-id",
    changeClusterId: "private-change-id",
    applicability: "hypothesized_required",
    relation: "hypothesis",
    execution: "not_observed",
    summaryState: "relation_unresolved"
  }],
  scopeMappings: [{
    version: 2,
    objectiveId: "private-objective-id",
    changeClusterId: "private-change-id",
    state: "plausibly_mapped"
  }],
  semanticState: "valid",
  semanticFailureStage: null,
  semanticClaimInvalidReason: "span_binding_invalid",
  semanticPackageFailureReasons: ["span_limit_exceeded"],
  semanticStageDiagnostics: {
    version: 1,
    claimState: "valid",
    evidenceState: "invalid",
    sourceCoverage: "sampled",
    evidenceCoverage: "complete",
    providerCallCount: 2,
    selectedCountBuckets: { sourceSpans: "9_12", evidenceCandidates: "17_32" }
  },
  semanticSelectionOmittedReasonCounts: {
    spanBudget: 3,
    evidenceBudget: 2,
    inputByteBudget: 1,
    unsafeDescriptor: 1,
    noDeterministicSignal: 4
  },
  diagnostics: {
    version: 1,
    sourceCollection: "available",
    deterministicAdmission: "no_candidate",
    semanticAdmission: "admitted",
    relationState: "hypothesis_only",
    counts: { sourceUnits: 2, eligibleSpans: 3, deterministicCandidates: 0, semanticCandidates: 1, admittedTargets: 1 }
  }
};

describe("general PR observation telemetry", () => {
  it("emits only bounded aggregate counts and no private observation identifiers", () => {
    const telemetry = buildGeneralPrObservationTelemetryV1({ mode: "shadow", bundle, elapsedMs: 712 });
    const serialized = JSON.stringify(telemetry);

    expect(telemetry).toEqual({
      version: 1,
      mode: "shadow",
      eligibility: "eligible",
      semanticState: "valid",
      semanticFailureStage: null,
      semanticStageDiagnostics: bundle.semanticStageDiagnostics,
      semanticSelectionOmittedReasonCounts: bundle.semanticSelectionOmittedReasonCounts,
      diagnostics: bundle.diagnostics,
      durationBucket: "lt_1s",
      objectiveCounts: { observed: 0, hypothesis: 1 },
      relationLevelCounts: { verified: 0, observed: 0, hypothesis: 2, unresolved: 0, unavailable: 0 },
      testSummaryCounts: {
        covered_by_verified_relation: 0,
        verified_test_failed: 0,
        related_test_observed: 0,
        missing_targeted_test: 0,
        test_not_applicable: 0,
        relation_unresolved: 1,
        execution_unresolved: 0,
        collection_unavailable: 0
      },
      scopeStateCounts: {
        mapped_by_verified_relation: 0,
        plausibly_mapped: 1,
        unmapped: 0,
        out_of_scope_by_contract: 0,
        collection_unavailable: 0
      }
    });
    expect(serialized).not.toContain("private-objective-id");
    expect(serialized).not.toContain("private-span-id");
    expect(serialized).not.toContain("private-change-id");
    expect(serialized).not.toContain(bundle.seedHash);
    expect(serialized).not.toContain("sourceSpanRefs");
    expect(serialized).not.toContain("provider output");
    expect(serialized).not.toContain("claimInvalidReason");
    expect(serialized).not.toContain("semanticClaimInvalidReason");
  });

  it("projects only closed stage aggregates across the operator boundary", () => {
    const diagnostics = buildGeneralPrSemanticOperatorDiagnosticsV1(bundle);
    const serialized = JSON.stringify(diagnostics);

    expect(diagnostics).toEqual({
      claimState: "valid",
      evidenceState: "invalid",
      sourceCoverage: "sampled",
      evidenceCoverage: "complete",
      providerCallCount: 2,
      selectedCountBuckets: { sourceSpans: "9_12", evidenceCandidates: "17_32" },
      claimInvalidReason: "span_binding_invalid",
      semanticPackageFailureReasons: ["span_limit_exceeded"],
      omittedReasonCounts: {
        spanBudget: 3,
        evidenceBudget: 2,
        inputByteBudget: 1,
        unsafeDescriptor: 1,
        noDeterministicSignal: 4
      }
    });
    expect(Object.keys(diagnostics).sort()).toEqual([
      "claimInvalidReason",
      "claimState",
      "evidenceCoverage",
      "evidenceState",
      "omittedReasonCounts",
      "providerCallCount",
      "selectedCountBuckets",
      "semanticPackageFailureReasons",
      "sourceCoverage"
    ]);
    expect(serialized).not.toMatch(/seedHash|selectionHash|path|tokenSketch|sourceText|checkName|repositoryName|pullRequestNumber|providerOutput/i);
  });

  it("preserves a third or later invocation only as the closed 3_plus bucket", () => {
    const diagnostics = buildGeneralPrSemanticOperatorDiagnosticsV1({
      ...bundle,
      semanticStageDiagnostics: { ...bundle.semanticStageDiagnostics, providerCallCount: "3_plus" }
    });

    expect(diagnostics.providerCallCount).toBe("3_plus");
    expect(JSON.stringify(diagnostics)).not.toMatch(/providerCallCount[^,}]*3(?!_plus)/);
  });

  it("records disabled and ineligible runs without inventing an observation state", () => {
    expect(buildGeneralPrObservationTelemetryV1({ mode: "disabled", bundle: null, elapsedMs: 0 })).toMatchObject({
      eligibility: "disabled",
      semanticState: null,
      semanticFailureStage: null,
      semanticStageDiagnostics: null,
      semanticSelectionOmittedReasonCounts: null,
      diagnostics: null,
      durationBucket: "lt_1s"
    });
    expect(buildGeneralPrObservationTelemetryV1({ mode: "shadow", bundle: null, elapsedMs: 8_001 })).toMatchObject({
      eligibility: "ineligible",
      semanticState: null,
      semanticFailureStage: null,
      semanticStageDiagnostics: null,
      semanticSelectionOmittedReasonCounts: null,
      diagnostics: null,
      durationBucket: "gte_8s"
    });
    expect(buildGeneralPrSemanticOperatorDiagnosticsV1(null)).toEqual({
      claimState: "not_run",
      evidenceState: "not_run",
      sourceCoverage: null,
      evidenceCoverage: null,
      providerCallCount: 0,
      selectedCountBuckets: { sourceSpans: "0", evidenceCandidates: "0" },
      claimInvalidReason: null,
      semanticPackageFailureReasons: [],
      omittedReasonCounts: { spanBudget: 0, evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 }
    });
  });
});
