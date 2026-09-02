import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { evaluateGeneralPrObservationReleaseV1 } from "./evaluate-general-pr-observation-release.mjs";
import { GENERAL_PR_OBSERVATION_APPROVED_SELECTION_POLICY_HASH_V1 } from "./general-pr-observation-selection-policy-anchor.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const stableJson = (value) => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const manifestHash = (value) => hash(stableJson(value));
const candidateSha = "d".repeat(40);
const hardGates = [
  "zero_false_contract_supported", "zero_false_decisive_relation", "zero_false_local_ci_association", "zero_authority_elevation",
  "zero_stale_subject_binding", "zero_receipt_reuse", "zero_incomplete_as_complete", "zero_privacy_leak", "zero_shadow_report_change",
  "zero_template_test_risk_follow_up_objective_admission", "zero_false_missing_targeted_test", "zero_false_out_of_scope_by_contract"
];

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
  requiredFeaturePolicy: manifest.featurePolicy,
  hardGates,
  qualityThresholds: {
    objectiveAdmissionPrecisionLower95: 0.95,
    objectiveAdmissionRecallLower95: 0.9,
    testObservationExactMatchLower95: 0.9,
    scopeMappingExactMatchLower95: 0.9
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
    selectionPolicyHash: GENERAL_PR_OBSERVATION_APPROVED_SELECTION_POLICY_HASH_V1,
    rubricHash: hash("rubric"),
    toolchainHash: hash("toolchain"),
    sealHash: hash(`${cohort}:seal`),
    candidateSha,
    scoredCandidateManifestHash: manifestHash(manifest),
    score: {
      hardGates: Object.fromEntries(hardGates.map((gate) => [gate, 0])),
      quality
    },
    ...overrides
  };
  return { ...unsigned, scoredSealHash: hash(stableJson({ domain: "agentproof.general-pr.scored-seal.v1", seal: unsigned })) };
}

describe("general PR observation release evaluator", () => {
  it("never issues GO from self-attested scored seals without independently bound execution evidence", () => {
    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60),
      holdoutSeal: seal("holdout", 60)
    }), { status: "NO_GO", reasons: ["independently_bound_execution_unavailable"] });
  });

  it("fails closed for forged policy or cohort-partition artifacts", () => {
    const forgedPolicy = evaluateGeneralPrObservationReleaseV1({
      manifest, policy, candidateSha,
      calibrationSeal: seal("calibration", 60, { selectionPolicyHash: hash("forged-policy") }),
      holdoutSeal: seal("holdout", 60, { selectionPolicyHash: hash("forged-policy") })
    });
    const mismatchedPartition = evaluateGeneralPrObservationReleaseV1({
      manifest, policy, candidateSha,
      calibrationSeal: seal("calibration", 60),
      holdoutSeal: seal("holdout", 60, { cohortPartitionWitnessHash: hash("other-partition") })
    });

    assert.deepEqual(forgedPolicy, { status: "NO_GO", reasons: ["selection_policy_binding_mismatch", "independently_bound_execution_unavailable"] });
    assert.deepEqual(mismatchedPartition, { status: "NO_GO", reasons: ["cohort_partition_mismatch", "independently_bound_execution_unavailable"] });
  });

  it("rejects a caller policy that weakens approved admission or hard-zero gates", () => {
    const weakened = { ...policy, hardGates: ["zero_false_contract_supported"], qualityThresholds: { objectiveAdmissionPrecisionLower95: 0.1, objectiveAdmissionRecallLower95: 0.1 } };

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest, policy: weakened, candidateSha, calibrationSeal: seal("calibration", 60), holdoutSeal: seal("holdout", 60)
    }), { status: "NO_GO", reasons: ["release_inputs_invalid"] });
  });

  it("rejects a caller policy that lowers the approved cohort minimums", () => {
    const weakened = { ...policy, minimumCalibrationCases: 1, minimumHoldoutCases: 1 };

    assert.deepEqual(evaluateGeneralPrObservationReleaseV1({
      manifest, policy: weakened, candidateSha, calibrationSeal: seal("calibration", 1), holdoutSeal: seal("holdout", 1)
    }), { status: "NO_GO", reasons: ["release_inputs_invalid"] });
  });

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
      calibrationSeal: seal("calibration", 60, { scoredCandidateManifestHash: manifestHash(changedManifest), score: { hardGates: { ...Object.fromEntries(hardGates.map((gate) => [gate, 0])), zero_privacy_leak: 1 }, quality } }),
      holdoutSeal: seal("holdout", 60, { scoredCandidateManifestHash: manifestHash(changedManifest), score: { hardGates: { ...Object.fromEntries(hardGates.map((gate) => [gate, 0])), zero_privacy_leak: 1 }, quality } })
    });

    assert.equal(result.status, "NO_GO");
    assert.deepEqual(result.reasons, ["feature_policy_mismatch", "hard_gate_failed", "independently_bound_execution_unavailable"]);
  });

  it("rejects sealed scores produced for a different candidate manifest", () => {
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { scoredCandidateManifestHash: hash("different candidate") }),
      holdoutSeal: seal("holdout", 60, { scoredCandidateManifestHash: hash("different candidate") })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["candidate_binding_mismatch", "independently_bound_execution_unavailable"] });
  });

  it("keeps advisory release blocked when an evaluated quality axis is insufficient", () => {
    const lowQuality = { ...quality, objectiveAdmissionRecallLower95: "UNKNOWN" };
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { score: { hardGates: Object.fromEntries(hardGates.map((gate) => [gate, 0])), quality: lowQuality } }),
      holdoutSeal: seal("holdout", 60, { score: { hardGates: Object.fromEntries(hardGates.map((gate) => [gate, 0])), quality: lowQuality } })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["insufficient_quality_evidence", "independently_bound_execution_unavailable"] });
  });

  it("rejects scores from a different candidate commit even when the manifest matches", () => {
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { candidateSha: "e".repeat(40) }),
      holdoutSeal: seal("holdout", 60, { candidateSha: "e".repeat(40) })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["candidate_binding_mismatch", "independently_bound_execution_unavailable"] });
  });
});
