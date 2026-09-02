import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { evaluateGeneralPrObservationReleaseV1 } from "./evaluate-general-pr-observation-release.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const stableJson = (value) => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const manifestHash = (value) => hash(stableJson(value));
const candidateSha = "d".repeat(40);
const approvedSelectionPolicy = {
  version: 1,
  policyVersion: "general-pr-claim-evidence-selection.v1",
  claim: { maxSpans: 12, maxInputBytes: 12_000 },
  evidence: { maxPerObjective: 12, maxTotal: 64, maxInputBytes: 12_000 }
};
const approvedSelectionPolicyHash = hash(stableJson({
  domain: "agentproof.general-pr.selection-policy.v1",
  policy: approvedSelectionPolicy
}));
const requiredHardGates = [
  "zero_false_contract_supported",
  "zero_authority_elevation",
  "zero_stale_subject_binding",
  "zero_receipt_reuse",
  "zero_privacy_leak"
];
const allHardGates = [
  "zero_false_contract_supported",
  "zero_false_decisive_relation",
  "zero_false_local_ci_association",
  "zero_authority_elevation",
  "zero_stale_subject_binding",
  "zero_receipt_reuse",
  "zero_incomplete_as_complete",
  "zero_privacy_leak",
  "zero_shadow_report_change",
  "zero_template_test_risk_follow_up_objective_admission",
  "zero_false_missing_targeted_test",
  "zero_false_out_of_scope_by_contract"
];
const passingHardGates = Object.fromEntries(allHardGates.map((key) => [key, 0]));

const manifest = {
  version: 1,
  baseSha: "a".repeat(40),
  candidateBranch: "codex/candidate",
  reportSchemaVersion: "verification-report.v2",
  packageLockSha256: hash("lock"),
  featurePolicy: {
    semanticObserverShadow: false,
    reviewerAdvisoryObservations: false,
    deterministicRelationConsumption: false,
    positiveProofPromotion: false
  }
};

const policy = {
  version: 1,
  minimumCalibrationCases: 60,
  minimumHoldoutCases: 60,
  approvedSelectionPolicy,
  approvedSelectionPolicyHash,
  requiredFeaturePolicy: manifest.featurePolicy,
  hardGates: requiredHardGates,
  qualityThresholds: {
    objectiveAdmissionPrecisionLower95: 0.95,
    objectiveAdmissionRecallLower95: 0.9
  }
};

const quality = {
  claimSelectionPrecisionLower95: 1,
  claimSelectionRecallLower95: 1,
  objectiveAdmissionPrecisionLower95: 1,
  objectiveAdmissionRecallLower95: 1,
  evidenceCandidateRecallLower95: 1,
  relationPrecisionLower95: 1,
  packageReadyRate: 1,
  sampledCoverageRate: 0,
  testObservationExactMatchLower95: 1,
  scopeMappingExactMatchLower95: 1
};

function seal(cohort, caseCount, overrides = {}) {
  const unsigned = {
    version: 1,
    cohort,
    caseCount,
    corpusHash: hash(cohort),
    sourceBindingDigest: hash(`${cohort}:source`),
    schemaDigest: hash(`${cohort}:schema`),
    cohortPartitionWitnessHash: hash("partition"),
    selectionPolicyHash: approvedSelectionPolicyHash,
    rubricHash: hash("rubric"),
    toolchainHash: hash("toolchain"),
    sealHash: hash(`${cohort}:seal`),
    candidateSha,
    scoredCandidateManifestHash: manifestHash(manifest),
    score: {
      hardGates: passingHardGates,
      quality
    },
    ...overrides
  };
  return { ...unsigned, scoredSealHash: hash(stableJson({ domain: "agentproof.general-pr.scored-seal.v1", seal: unsigned })) };
}

describe("general PR observation release evaluator", () => {
  it("fails closed when sealed independent scores are unavailable", () => {
    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({ manifest, policy, candidateSha, calibrationSeal: null, holdoutSeal: null }), {
      status: "NO_GO",
      reasons: ["independent_scored_seals_unavailable"]
    });
  });

  it("does not allow a feature-policy change or a failed hard gate to be compensated by quality metrics", () => {
    const changedManifest = { ...manifest, featurePolicy: { ...manifest.featurePolicy, reviewerAdvisoryObservations: true } };
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest: changedManifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { scoredCandidateManifestHash: manifestHash(changedManifest), score: { hardGates: { ...passingHardGates, zero_privacy_leak: 1 }, quality } }),
      holdoutSeal: seal("holdout", 60, { scoredCandidateManifestHash: manifestHash(changedManifest), score: { hardGates: { ...passingHardGates, zero_privacy_leak: 1 }, quality } })
    });

    assert.equal(result.status, "NO_GO");
    assert.deepEqual(result.reasons, ["feature_policy_mismatch", "hard_gate_failed"]);
  });

  it("rejects sealed scores produced for a different candidate manifest", () => {
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { scoredCandidateManifestHash: hash("different candidate") }),
      holdoutSeal: seal("holdout", 60, { scoredCandidateManifestHash: hash("different candidate") })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["candidate_binding_mismatch"] });
  });

  it("keeps advisory release blocked when approved objective admission evidence is insufficient", () => {
    const lowQuality = { ...quality, objectiveAdmissionRecallLower95: "UNKNOWN" };
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { score: { hardGates: passingHardGates, quality: lowQuality } }),
      holdoutSeal: seal("holdout", 60, { score: { hardGates: passingHardGates, quality: lowQuality } })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["insufficient_quality_evidence"] });
  });

  it("requires both independent cohorts to meet the approved Wilson bounds", () => {
    const belowPrecision = { ...quality, objectiveAdmissionPrecisionLower95: 0.949999 };
    const belowRecall = { ...quality, objectiveAdmissionRecallLower95: 0.899999 };

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { score: { hardGates: passingHardGates, quality: belowPrecision } }),
      holdoutSeal: seal("holdout", 60, { score: { hardGates: passingHardGates, quality: belowRecall } })
    }), { status: "NO_GO", reasons: ["quality_gate_failed"] });
  });

  it("reports evidence-candidate recall without turning it into a release threshold", () => {
    const reportedOnly = { ...quality, evidenceCandidateRecallLower95: "UNKNOWN" };

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { score: { hardGates: passingHardGates, quality: reportedOnly } }),
      holdoutSeal: seal("holdout", 60, { score: { hardGates: passingHardGates, quality: reportedOnly } })
    }), { status: "GO", reasons: [] });
  });

  it("accepts existing legacy observation threshold fields as non-gating metadata", () => {
    const legacyPolicy = {
      ...policy,
      qualityThresholds: {
        ...policy.qualityThresholds,
        testObservationExactMatchLower95: 0.9,
        scopeMappingExactMatchLower95: 0.9
      }
    };
    const reportedOnly = { ...quality, testObservationExactMatchLower95: "UNKNOWN", scopeMappingExactMatchLower95: "UNKNOWN" };

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy: legacyPolicy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { score: { hardGates: passingHardGates, quality: reportedOnly } }),
      holdoutSeal: seal("holdout", 60, { score: { hardGates: passingHardGates, quality: reportedOnly } })
    }), { status: "GO", reasons: [] });
  });

  it("accepts the checked-in release policy only with its exact approved budget digest", () => {
    const checkedInPolicy = JSON.parse(readFileSync(new URL("../eval/general-pr-observation-release-policy.v1.json", import.meta.url), "utf8"));

    assert.equal(checkedInPolicy.approvedSelectionPolicyHash, approvedSelectionPolicyHash);
    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy: checkedInPolicy,
      candidateSha,
      calibrationSeal: seal("calibration", 60),
      holdoutSeal: seal("holdout", 60)
    }), { status: "GO", reasons: [] });
  });

  it("rejects policies that relax mandatory authority/privacy gates or add an unapproved quality threshold", () => {
    const relaxed = { ...policy, hardGates: requiredHardGates.filter((key) => key !== "zero_receipt_reuse") };
    const evidenceThreshold = { ...policy, qualityThresholds: { ...policy.qualityThresholds, evidenceCandidateRecallLower95: 0.9 } };
    const missingSelectionBinding = { ...policy };
    delete missingSelectionBinding.approvedSelectionPolicyHash;
    const input = { manifest, candidateSha, calibrationSeal: seal("calibration", 60), holdoutSeal: seal("holdout", 60) };

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({ ...input, policy: relaxed }), { status: "NO_GO", reasons: ["release_inputs_invalid"] });
    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({ ...input, policy: evidenceThreshold }), { status: "NO_GO", reasons: ["release_inputs_invalid"] });
    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({ ...input, policy: missingSelectionBinding }), { status: "NO_GO", reasons: ["release_inputs_invalid"] });
  });

  it("rejects scores from a different candidate commit even when the manifest matches", () => {
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { candidateSha: "e".repeat(40) }),
      holdoutSeal: seal("holdout", 60, { candidateSha: "e".repeat(40) })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["candidate_binding_mismatch"] });
  });

  it("rejects cohort scores from different validated partitions", () => {
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60),
      holdoutSeal: seal("holdout", 60, { cohortPartitionWitnessHash: hash("other-partition") })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["cohort_partition_mismatch"] });
  });

  it("rejects old scored artifacts with no partition witness", () => {
    const oldCalibration = seal("calibration", 60);
    delete oldCalibration.cohortPartitionWitnessHash;
    const { scoredSealHash: _discarded, ...unsigned } = oldCalibration;
    oldCalibration.scoredSealHash = hash(stableJson({ domain: "agentproof.general-pr.scored-seal.v1", seal: unsigned }));

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: oldCalibration,
      holdoutSeal: seal("holdout", 60)
    }), { status: "NO_GO", reasons: ["independent_scored_seals_unavailable"] });
  });

  it("requires one explicitly approved fixed-budget selection policy across both cohorts", () => {
    const calibrationMismatch = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { selectionPolicyHash: hash("other-selection") }),
      holdoutSeal: seal("holdout", 60)
    });
    const bothUnapproved = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { selectionPolicyHash: hash("other-selection") }),
      holdoutSeal: seal("holdout", 60, { selectionPolicyHash: hash("other-selection") })
    });

    assert.deepEqual(calibrationMismatch, { status: "NO_GO", reasons: ["selection_policy_binding_mismatch"] });
    assert.deepEqual(bothUnapproved, { status: "NO_GO", reasons: ["selection_policy_binding_mismatch"] });
  });
});
