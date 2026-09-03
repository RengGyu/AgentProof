import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { buildGeneralPrObservationSealV1 } from "./general-pr-observation-seal.mjs";

const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function corpus(overrides = {}) {
  return {
    version: 1,
    cases: [{
      version: 1,
      caseId: hash("case"),
      cohort: "holdout",
      repositoryFamilyHash: hash("repo"),
      taskFamilyHash: hash("task"),
      timeWindowHash: hash("time"),
      sourceHash: hash("source"),
      contentHash: hash("content"),
      headHash: hash("head"),
      inventoryHash: hash("inventory"),
      normalizerHash: hash("normalizer"),
      axis: "relation",
      labels: [
        { version: 1, reviewerId: hash("reviewer-one"), decision: "negative", rubricHash: hash("rubric") },
        { version: 1, reviewerId: hash("reviewer-two"), decision: "negative", rubricHash: hash("rubric") }
      ]
    }],
    ...overrides
  };
}

function peerCorpus(value) {
  return {
    version: 1,
    cases: value.cases.map((item, index) => ({
      ...item,
      caseId: hash(`peer:${index}:case`),
      cohort: item.cohort === "holdout" ? "calibration" : "holdout",
      repositoryFamilyHash: hash(`peer:${index}:repo`),
      taskFamilyHash: hash(`peer:${index}:task`),
      timeWindowHash: hash(`peer:${index}:time`),
      sourceHash: hash(`peer:${index}:source`),
      contentHash: hash(`peer:${index}:content`),
      headHash: hash(`peer:${index}:head`),
      inventoryHash: hash(`peer:${index}:inventory`),
      normalizerHash: hash(`peer:${index}:normalizer`)
    }))
  };
}

function sealInput(value) {
  return { corpus: value, peerCorpus: peerCorpus(value), liveSmokeCaseIds: [hash("live-smoke")], schemaHashes: [hash("source")], rubricHash: hash("rubric"), toolchainHash: hash("toolchain") };
}

describe("general PR observation seal", () => {
  it("seals hashes and selection metadata without serializing case labels or source bindings", () => {
    const result = buildGeneralPrObservationSealV1({ ...sealInput(corpus()), schemaHashes: [hash("source"), hash("span"), hash("relation"), hash("observation")] });
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "sealed");
    assert.equal(result.seal.caseCount, 1);
    assert.equal(result.seal.cohort, "holdout");
    assert.match(result.seal.sealHash, /^[a-f0-9]{64}$/);
    assert.equal(serialized.includes("reviewer-one"), false);
    assert.equal(serialized.includes("taskFamilyHash"), false);
  });

  it("rejects an unadjudicated corpus or a mixed cohort", () => {
    const disagreement = corpus({ cases: [{ ...corpus().cases[0], labels: [
      { version: 1, reviewerId: hash("one"), decision: "positive", rubricHash: hash("rubric") },
      { version: 1, reviewerId: hash("two"), decision: "negative", rubricHash: hash("rubric") }
    ] }] });
    const mixed = corpus({ cases: [corpus().cases[0], { ...corpus().cases[0], caseId: hash("second"), cohort: "calibration" }] });
    const input = { schemaHashes: [hash("source")], rubricHash: hash("rubric"), toolchainHash: hash("toolchain") };

    assert.deepEqual(buildGeneralPrObservationSealV1({ ...sealInput(disagreement), ...input }), { status: "invalid" });
    assert.deepEqual(buildGeneralPrObservationSealV1({ ...sealInput(mixed), ...input }), { status: "invalid" });
  });

  it("seals independently agreed test-observation states but rejects an ambiguous state disagreement", () => {
    const state = (reviewerId, value) => ({ version: 1, reviewerId: hash(reviewerId), rubricHash: hash("rubric"), observationKind: "test_coverage", state: value });
    const observation = corpus({ cases: [{
      ...corpus().cases[0],
      axis: "observation",
      labels: [state("one", "related_test_observed"), state("two", "related_test_observed")]
    }] });
    const conflict = corpus({ cases: [{
      ...observation.cases[0],
      labels: [state("one", "related_test_observed"), state("two", "relation_unresolved")]
    }] });
    const input = { schemaHashes: [hash("observation")], rubricHash: hash("rubric"), toolchainHash: hash("toolchain") };

    assert.equal(buildGeneralPrObservationSealV1({ ...sealInput(observation), ...input }).status, "sealed");
    assert.deepEqual(buildGeneralPrObservationSealV1({ ...sealInput(conflict), ...input }), { status: "invalid" });
  });
});
