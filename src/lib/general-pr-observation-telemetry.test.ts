import { describe, expect, it } from "vitest";
import { buildGeneralPrObservationTelemetryV1 } from "./general-pr-observation-telemetry";
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
  });

  it("records disabled and ineligible runs without inventing an observation state", () => {
    expect(buildGeneralPrObservationTelemetryV1({ mode: "disabled", bundle: null, elapsedMs: 0 })).toMatchObject({
      eligibility: "disabled",
      semanticState: null,
      semanticFailureStage: null,
      diagnostics: null,
      durationBucket: "lt_1s"
    });
    expect(buildGeneralPrObservationTelemetryV1({ mode: "shadow", bundle: null, elapsedMs: 8_001 })).toMatchObject({
      eligibility: "ineligible",
      semanticState: null,
      semanticFailureStage: null,
      diagnostics: null,
      durationBucket: "gte_8s"
    });
  });
});
