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

function oppositeCorpus(value = corpus()) {
  return {
    version: 1,
    cases: value.cases.map((item, index) => ({
      ...item,
      caseId: hash(`peer:${index}:case`),
      cohort: item.cohort === "calibration" ? "holdout" : "calibration",
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

function sealInput(value = corpus()) {
  return {
    corpus: value,
    peerCorpus: oppositeCorpus(value),
    liveSmokeCaseIds: [hash("live-smoke-only")],
    schemaHashes: [hash("source"), hash("span"), hash("relation"), hash("observation")],
    selectionPolicyHash: hash("selection"),
    rubricHash: hash("rubric"),
    toolchainHash: hash("toolchain")
  };
}

describe("general PR observation seal", () => {
  it("seals hashes and selection metadata without serializing case labels or source bindings", () => {
    const value = corpus();
    const result = buildGeneralPrObservationSealV1(sealInput(value));
    const serialized = JSON.stringify(result);

    assert.equal(result.status, "sealed");
    assert.equal(result.seal.caseCount, 1);
    assert.equal(result.seal.cohort, "holdout");
    assert.match(result.seal.cohortPartitionWitnessHash, /^[a-f0-9]{64}$/);
    assert.match(result.seal.sealHash, /^[a-f0-9]{64}$/);
    assert.equal(serialized.includes("reviewer-one"), false);
    assert.equal(serialized.includes("taskFamilyHash"), false);
    assert.equal(serialized.includes(value.cases[0].caseId), false);
    assert.equal(serialized.includes(value.cases[0].repositoryFamilyHash), false);
    assert.equal(serialized.includes(hash("live-smoke-only")), false);
  });

  it("rejects an unadjudicated corpus or a mixed cohort", () => {
    const disagreement = corpus({ cases: [{ ...corpus().cases[0], labels: [
      { version: 1, reviewerId: hash("one"), decision: "positive", rubricHash: hash("rubric") },
      { version: 1, reviewerId: hash("two"), decision: "negative", rubricHash: hash("rubric") }
    ] }] });
    const mixed = corpus({ cases: [corpus().cases[0], { ...corpus().cases[0], caseId: hash("second"), cohort: "calibration" }] });
    const input = sealInput();

    assert.deepEqual(buildGeneralPrObservationSealV1({ ...input, corpus: disagreement, peerCorpus: oppositeCorpus(disagreement) }), { status: "invalid" });
    assert.deepEqual(buildGeneralPrObservationSealV1({ ...input, corpus: mixed, peerCorpus: oppositeCorpus(mixed) }), { status: "invalid" });
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
    const input = { ...sealInput(observation), schemaHashes: [hash("observation")] };

    assert.equal(buildGeneralPrObservationSealV1(input).status, "sealed");
    assert.deepEqual(buildGeneralPrObservationSealV1({ ...input, corpus: conflict, peerCorpus: oppositeCorpus(conflict) }), { status: "invalid" });
  });

  it("requires a validated opposite cohort and live-smoke exclusion witness", () => {
    const value = corpus();

    assert.deepEqual(buildGeneralPrObservationSealV1({
      corpus: value,
      schemaHashes: [hash("source")],
      selectionPolicyHash: hash("selection"),
      rubricHash: hash("rubric"),
      toolchainHash: hash("toolchain")
    }), { status: "invalid" });
  });

  it("rejects cross-cohort family overlap and live-smoke-derived labelled cases before sealing", () => {
    const value = corpus();
    const overlapping = oppositeCorpus(value);
    overlapping.cases[0].repositoryFamilyHash = value.cases[0].repositoryFamilyHash;
    const overlappingTask = oppositeCorpus(value);
    overlappingTask.cases[0].taskFamilyHash = value.cases[0].taskFamilyHash;
    const liveDerived = [value.cases[0].caseId];

    assert.deepEqual(buildGeneralPrObservationSealV1({ ...sealInput(value), peerCorpus: overlapping }), { status: "invalid" });
    assert.deepEqual(buildGeneralPrObservationSealV1({ ...sealInput(value), peerCorpus: overlappingTask }), { status: "invalid" });
    assert.deepEqual(buildGeneralPrObservationSealV1({ ...sealInput(value), liveSmokeCaseIds: liveDerived }), { status: "invalid" });
  });
});
