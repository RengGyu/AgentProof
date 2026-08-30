import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  hardGates: ["zero_false_contract_supported", "zero_privacy_leak", "zero_shadow_report_change"],
  qualityThresholds: {
    objectiveAdmissionPrecisionLower95: 0.95,
    objectiveAdmissionRecallLower95: 0.9,
    testObservationExactMatchLower95: 0.9,
    scopeMappingExactMatchLower95: 0.9
  }
};

const quality = {
  sourceSelectionExactMatchLower95: 1,
  objectiveAdmissionPrecisionLower95: 1,
  objectiveAdmissionRecallLower95: 1,
  relationExactMatchLower95: 1,
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
    selectionPolicyHash: hash("policy"),
    rubricHash: hash("rubric"),
    toolchainHash: hash("toolchain"),
    sealHash: hash(`${cohort}:seal`),
    candidateSha,
    scoredCandidateManifestHash: manifestHash(manifest),
    score: {
      hardGates: { zero_false_contract_supported: 0, zero_privacy_leak: 0, zero_shadow_report_change: 0 },
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
      calibrationSeal: seal("calibration", 60, { scoredCandidateManifestHash: manifestHash(changedManifest), score: { hardGates: { zero_false_contract_supported: 0, zero_privacy_leak: 1, zero_shadow_report_change: 0 }, quality } }),
      holdoutSeal: seal("holdout", 60, { scoredCandidateManifestHash: manifestHash(changedManifest), score: { hardGates: { zero_false_contract_supported: 0, zero_privacy_leak: 1, zero_shadow_report_change: 0 }, quality } })
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

  it("keeps advisory release blocked when an evaluated quality axis is insufficient", () => {
    const lowQuality = { ...quality, scopeMappingExactMatchLower95: "UNKNOWN" };
    const result = evaluateGeneralPrObservationReleaseV1({
      manifest,
      policy,
      candidateSha,
      calibrationSeal: seal("calibration", 60, { score: { hardGates: { zero_false_contract_supported: 0, zero_privacy_leak: 0, zero_shadow_report_change: 0 }, quality: lowQuality } }),
      holdoutSeal: seal("holdout", 60, { score: { hardGates: { zero_false_contract_supported: 0, zero_privacy_leak: 0, zero_shadow_report_change: 0 }, quality: lowQuality } })
    });

    assert.deepEqual(result, { status: "NO_GO", reasons: ["insufficient_quality_evidence"] });
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
});
