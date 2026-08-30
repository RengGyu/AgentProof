import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildGeneralPrObservationSealV1 } from "./general-pr-observation-seal.mjs";
import { evaluateGeneralPrObservationsV1 } from "./evaluate-general-pr-observations.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const stableJson = (value) => Array.isArray(value)
  ? `[${value.map(stableJson).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const manifestHash = (value) => hash(stableJson(value));
const gates = {
  zero_false_contract_supported: 0,
  zero_false_decisive_relation: 0,
  zero_false_local_ci_association: 0,
  zero_authority_elevation: 0,
  zero_stale_subject_binding: 0,
  zero_receipt_reuse: 0,
  zero_incomplete_as_complete: 0,
  zero_privacy_leak: 0,
  zero_shadow_report_change: 0,
  zero_template_test_risk_follow_up_objective_admission: 0,
  zero_false_missing_targeted_test: 0,
  zero_false_out_of_scope_by_contract: 0
};

function goldCase(caseId, axis, labels) {
  return {
    version: 1,
    caseId: hash(caseId),
    cohort: "calibration",
    repositoryFamilyHash: hash(`${caseId}:repo`),
    taskFamilyHash: hash(`${caseId}:task`),
    timeWindowHash: hash(`${caseId}:time`),
    sourceHash: hash(`${caseId}:source`),
    contentHash: hash(`${caseId}:content`),
    headHash: hash(`${caseId}:head`),
    inventoryHash: hash(`${caseId}:inventory`),
    normalizerHash: hash(`${caseId}:normalizer`),
    axis,
    labels
  };
}

function fixture() {
  const binary = (reviewerId) => ({ version: 1, reviewerId: hash(reviewerId), decision: "positive", rubricHash: hash("rubric") });
  const state = (reviewerId) => ({ version: 1, reviewerId: hash(reviewerId), observationKind: "test_coverage", state: "related_test_observed", rubricHash: hash("rubric") });
  const corpus = { version: 1, cases: [goldCase("span", "span_role", [binary("one"), binary("two")]), goldCase("test", "observation", [state("three"), state("four")])] };
  const sealInput = { corpus, schemaHashes: [hash("source"), hash("span"), hash("relation"), hash("observation")], selectionPolicyHash: hash("selection"), rubricHash: hash("rubric"), toolchainHash: hash("toolchain") };
  const goldSeal = buildGeneralPrObservationSealV1(sealInput).seal;
  const manifest = { version: 1, baseSha: "a".repeat(40), candidateBranch: "codex/test", reportSchemaVersion: "verification-report.v2", featurePolicy: { semanticObserverShadow: false, reviewerAdvisoryObservations: false, deterministicRelationConsumption: false, positiveProofPromotion: false } };
  const results = {
    version: 1,
    goldSealHash: goldSeal.sealHash,
    candidateManifestHash: manifestHash(manifest),
    hardGates: gates,
    cases: corpus.cases.map((item) => ({
      version: 1,
      caseId: item.caseId,
      sourceHash: item.sourceHash,
      contentHash: item.contentHash,
      headHash: item.headHash,
      inventoryHash: item.inventoryHash,
      normalizerHash: item.normalizerHash,
      ...(item.axis === "observation" ? { observationKind: "test_coverage", state: "related_test_observed" } : { decision: "positive" })
    }))
  };
  return { corpus, goldSeal, manifest, results, candidateSha: "d".repeat(40) };
}

describe("evaluate-general-pr-observations", () => {
  it("creates an aggregate candidate-bound score without returning case identifiers or labels", () => {
    const value = fixture();
    const result = evaluateGeneralPrObservationsV1(value);
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "scored");
    assert.equal(result.seal.caseCount, 2);
    assert.equal(result.seal.scoredCandidateManifestHash, value.results.candidateManifestHash);
    assert.equal(result.seal.candidateSha, value.candidateSha);
    assert.equal(result.seal.score.hardGates.zero_privacy_leak, 0);
    assert.equal(serialized.includes(value.corpus.cases[0].caseId), false);
    assert.equal(serialized.includes("reviewerId"), false);
  });

  it("fails closed when a candidate row is not bound to the sealed source snapshot", () => {
    const value = fixture();
    value.results.cases[0].headHash = hash("different head");

    assert.deepEqual(evaluateGeneralPrObservationsV1(value), { status: "unavailable" });
  });

  it("fails closed when the exact candidate commit is absent or malformed", () => {
    const value = fixture();

    assert.deepEqual(evaluateGeneralPrObservationsV1({ ...value, candidateSha: null }), { status: "unavailable" });
    assert.deepEqual(evaluateGeneralPrObservationsV1({ ...value, candidateSha: "not-a-sha" }), { status: "unavailable" });
  });
});
