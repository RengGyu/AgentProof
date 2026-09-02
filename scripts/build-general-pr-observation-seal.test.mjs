import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runGeneralPrObservationSealCliV1 } from "./general-pr-observation-seal.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const stableJson = (value) => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const approvedSelectionPolicy = {
  version: 1,
  policyVersion: "general-pr-claim-evidence-selection.v1",
  claim: { maxSpans: 12, maxInputBytes: 12_000 },
  evidence: { maxPerObjective: 12, maxTotal: 64, maxInputBytes: 12_000 }
};
const approvedSelectionPolicyHash = hash(stableJson({ domain: "agentproof.general-pr.selection-policy.v1", policy: approvedSelectionPolicy }));

describe("build-general-pr-observation-seal", () => {
  it("requires every explicit external input path and never uses a default corpus path", () => {
    assert.equal(runGeneralPrObservationSealCliV1([]), 2);
    assert.equal(runGeneralPrObservationSealCliV1(["--corpus", "external.json"]), 2);
  });

  it("runs the trusted seal-score-release path and blocks overlap, live reuse, and policy drift", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-general-pr-trusted-path-"));
    try {
      const calibration = labelledCorpus("calibration");
      const holdout = labelledCorpus("holdout");
      const liveSmoke = { version: 1, caseIds: [hash("live-smoke-only")] };
      const manifest = candidateManifest();
      const calibrationPath = writeJson(root, "calibration.json", calibration);
      const holdoutPath = writeJson(root, "holdout.json", holdout);
      const liveSmokePath = writeJson(root, "live-smoke.json", liveSmoke);
      const manifestPath = writeJson(root, "manifest.json", manifest);
      const policyPath = writeJson(root, "policy.json", releasePolicy(manifest));
      const calibrationSeal = runSeal(root, "calibration", calibrationPath, holdoutPath, liveSmokePath);
      const holdoutSeal = runSeal(root, "holdout", holdoutPath, calibrationPath, liveSmokePath);

      assert.equal(calibrationSeal.child.status, 0, calibrationSeal.child.stderr);
      assert.equal(holdoutSeal.child.status, 0, holdoutSeal.child.stderr);
      assert.equal(calibrationSeal.value.cohortPartitionWitnessHash, holdoutSeal.value.cohortPartitionWitnessHash);
      for (const privateToken of [calibration.cases[0].caseId, calibration.cases[0].repositoryFamilyHash, liveSmoke.caseIds[0]]) {
        assert.equal(JSON.stringify(calibrationSeal.value).includes(privateToken), false);
      }

      const calibrationScore = runScore(root, "calibration", calibrationPath, holdoutPath, liveSmokePath, calibrationSeal.path, manifestPath, calibration, calibrationSeal.value, manifest);
      const holdoutScore = runScore(root, "holdout", holdoutPath, calibrationPath, liveSmokePath, holdoutSeal.path, manifestPath, holdout, holdoutSeal.value, manifest);
      assert.equal(calibrationScore.child.status, 0, calibrationScore.child.stderr);
      assert.equal(holdoutScore.child.status, 0, holdoutScore.child.stderr);
      const release = runRelease(root, "approved", manifestPath, policyPath, calibrationScore.path, holdoutScore.path);
      assert.equal(release.child.status, 0, release.child.stderr);
      assert.deepEqual(release.value, { version: 1, status: "GO", reasons: [] });

      const overlapping = structuredClone(holdout);
      overlapping.cases[0].repositoryFamilyHash = calibration.cases[0].repositoryFamilyHash;
      const overlapPath = writeJson(root, "overlap.json", overlapping);
      const overlapSeal = runSeal(root, "overlap", calibrationPath, overlapPath, liveSmokePath);
      assert.equal(overlapSeal.child.status, 1);
      assert.equal(existsSync(overlapSeal.path), false);

      const liveDerivedPath = writeJson(root, "live-derived.json", { version: 1, caseIds: [calibration.cases[0].caseId] });
      const liveDerivedSeal = runSeal(root, "live-derived", calibrationPath, holdoutPath, liveDerivedPath);
      assert.equal(liveDerivedSeal.child.status, 1);
      assert.equal(existsSync(liveDerivedSeal.path), false);

      const substitutedSelectionPolicy = {
        version: 1,
        policyVersion: "general-pr-claim-evidence-selection.v1",
        claim: { maxSpans: 1, maxInputBytes: 1 },
        evidence: { maxPerObjective: 1, maxTotal: 1, maxInputBytes: 1 }
      };
      const substitutedSelectionPolicyHash = hash(stableJson({
        domain: "agentproof.general-pr.selection-policy.v1",
        policy: substitutedSelectionPolicy
      }));
      const mislabeledSeal = runSeal(root, "mislabeled", holdoutPath, calibrationPath, liveSmokePath, substitutedSelectionPolicy, approvedSelectionPolicyHash);
      assert.equal(mislabeledSeal.child.status, 1);
      assert.equal(existsSync(mislabeledSeal.path), false);
      const mislabeledScore = runScore(root, "mislabeled", calibrationPath, holdoutPath, liveSmokePath, calibrationSeal.path, manifestPath, calibration, calibrationSeal.value, manifest, substitutedSelectionPolicy);
      assert.equal(mislabeledScore.child.status, 1);
      assert.equal(existsSync(mislabeledScore.path), false);

      const substitutedPolicyPath = writeJson(root, "substituted-policy.json", {
        ...releasePolicy(manifest),
        approvedSelectionPolicy: substitutedSelectionPolicy,
        approvedSelectionPolicyHash: substitutedSelectionPolicyHash
      });
      const substitutedCalibrationSeal = runSeal(root, "substituted-calibration", calibrationPath, holdoutPath, liveSmokePath, substitutedSelectionPolicy, substitutedSelectionPolicyHash);
      const substitutedHoldoutSeal = runSeal(root, "substituted-holdout", holdoutPath, calibrationPath, liveSmokePath, substitutedSelectionPolicy, substitutedSelectionPolicyHash);
      assert.equal(substitutedCalibrationSeal.child.status, 0, substitutedCalibrationSeal.child.stderr);
      assert.equal(substitutedHoldoutSeal.child.status, 0, substitutedHoldoutSeal.child.stderr);
      const substitutedCalibrationScore = runScore(root, "substituted-calibration", calibrationPath, holdoutPath, liveSmokePath, substitutedCalibrationSeal.path, manifestPath, calibration, substitutedCalibrationSeal.value, manifest, substitutedSelectionPolicy);
      const substitutedHoldoutScore = runScore(root, "substituted-holdout", holdoutPath, calibrationPath, liveSmokePath, substitutedHoldoutSeal.path, manifestPath, holdout, substitutedHoldoutSeal.value, manifest, substitutedSelectionPolicy);
      assert.equal(substitutedCalibrationScore.child.status, 0, substitutedCalibrationScore.child.stderr);
      assert.equal(substitutedHoldoutScore.child.status, 0, substitutedHoldoutScore.child.stderr);
      const substitutedRelease = runRelease(root, "substituted", manifestPath, substitutedPolicyPath, substitutedCalibrationScore.path, substitutedHoldoutScore.path);
      assert.equal(substitutedRelease.child.status, 1);
      assert.deepEqual(substitutedRelease.value, { version: 1, status: "NO_GO", reasons: ["release_inputs_invalid"] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function labelledCorpus(cohort) {
  return {
    version: 1,
    cases: Array.from({ length: 60 }, (_, index) => {
      const prefix = `${cohort}:${index}`;
      const binary = (reviewer) => ({ version: 1, reviewerId: hash(`${prefix}:${reviewer}`), decision: "positive", rubricHash: hash("rubric") });
      return {
        version: 1,
        caseId: hash(`${prefix}:case`),
        cohort,
        repositoryFamilyHash: hash(`${prefix}:repo`),
        taskFamilyHash: hash(`${prefix}:task`),
        timeWindowHash: hash(`${prefix}:time`),
        sourceHash: hash(`${prefix}:source`),
        contentHash: hash(`${prefix}:content`),
        headHash: hash(`${prefix}:head`),
        inventoryHash: hash(`${prefix}:inventory`),
        normalizerHash: hash(`${prefix}:normalizer`),
        axis: "span_role",
        labels: [binary("reviewer-one"), binary("reviewer-two")]
      };
    })
  };
}

function candidateManifest() {
  return {
    version: 1,
    baseSha: "a".repeat(40),
    candidateBranch: "codex/trusted-path",
    reportSchemaVersion: "verification-report.v2",
    featurePolicy: {
      semanticObserverShadow: false,
      reviewerAdvisoryObservations: false,
      deterministicRelationConsumption: false,
      positiveProofPromotion: false
    }
  };
}

function releasePolicy(manifest) {
  return {
    version: 1,
    minimumCalibrationCases: 60,
    minimumHoldoutCases: 60,
    approvedSelectionPolicy,
    approvedSelectionPolicyHash,
    requiredFeaturePolicy: manifest.featurePolicy,
    hardGates: ["zero_false_contract_supported", "zero_authority_elevation", "zero_stale_subject_binding", "zero_receipt_reuse", "zero_privacy_leak"],
    qualityThresholds: { objectiveAdmissionPrecisionLower95: 0.95, objectiveAdmissionRecallLower95: 0.9 }
  };
}

function runSeal(root, name, corpusPath, peerPath, liveSmokePath, selectionPolicy = approvedSelectionPolicy, selectionPolicyHash = approvedSelectionPolicyHash) {
  const output = join(root, `${name}-seal.json`);
  const selectionPolicyPath = writeJson(root, `${name}-selection-policy.json`, selectionPolicy);
  const child = run("general-pr-observation-seal.mjs", [
    "--corpus", corpusPath,
    "--peer-corpus", peerPath,
    "--live-smoke-case-ids", liveSmokePath,
    "--schema-hashes", [hash("source"), hash("span"), hash("relation"), hash("observation")].join(","),
    "--selection-policy", selectionPolicyPath,
    "--selection-policy-hash", selectionPolicyHash,
    "--rubric-hash", hash("rubric"),
    "--toolchain-hash", hash("toolchain"),
    "--output", output
  ]);
  return { child, path: output, value: existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : null };
}

function runScore(root, name, corpusPath, peerPath, liveSmokePath, sealPath, manifestPath, corpus, seal, manifest, selectionPolicy = approvedSelectionPolicy) {
  const resultsPath = writeJson(root, `${name}-results.json`, candidateResults(corpus, seal, manifest, selectionPolicy));
  const output = join(root, `${name}-score.json`);
  const child = run("evaluate-general-pr-observations.mjs", [
    "--gold-corpus", corpusPath,
    "--peer-corpus", peerPath,
    "--live-smoke-case-ids", liveSmokePath,
    "--gold-seal", sealPath,
    "--candidate-manifest", manifestPath,
    "--candidate-results", resultsPath,
    "--candidate-sha", "d".repeat(40),
    "--output", output
  ]);
  return { child, path: output };
}

function candidateResults(corpus, seal, manifest, selectionPolicy) {
  const hardGateNames = [
    "zero_false_contract_supported", "zero_false_decisive_relation", "zero_false_local_ci_association", "zero_authority_elevation",
    "zero_stale_subject_binding", "zero_receipt_reuse", "zero_incomplete_as_complete", "zero_privacy_leak", "zero_shadow_report_change",
    "zero_template_test_risk_follow_up_objective_admission", "zero_false_missing_targeted_test", "zero_false_out_of_scope_by_contract"
  ];
  return {
    version: 1,
    goldSealHash: seal.sealHash,
    candidateManifestHash: hash(stableJson(manifest)),
    selectionPolicy,
    hardGates: Object.fromEntries(hardGateNames.map((gate) => [gate, 0])),
    cases: corpus.cases.map((item) => ({
      version: 1,
      caseId: item.caseId,
      sourceHash: item.sourceHash,
      contentHash: item.contentHash,
      headHash: item.headHash,
      inventoryHash: item.inventoryHash,
      normalizerHash: item.normalizerHash,
      decision: "positive",
      packageReady: true,
      coverage: "complete"
    }))
  };
}

function runRelease(root, name, manifestPath, policyPath, calibrationScore, holdoutScore) {
  const output = join(root, `${name}-release.json`);
  const child = run("evaluate-general-pr-observation-release.mjs", [
    "--candidate-manifest", manifestPath,
    "--calibration-seal", calibrationScore,
    "--holdout-seal", holdoutScore,
    "--policy", policyPath,
    "--candidate-sha", "d".repeat(40),
    "--output", output
  ]);
  return { child, value: JSON.parse(readFileSync(output, "utf8")) };
}

function run(script, args) {
  return spawnSync(process.execPath, [new URL(`./${script}`, import.meta.url).pathname, ...args], { encoding: "utf8" });
}

function writeJson(root, name, value) {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
