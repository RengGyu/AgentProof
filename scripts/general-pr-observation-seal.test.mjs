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

describe("general PR observation seal", () => {
  it("seals hashes and selection metadata without serializing case labels or source bindings", () => {
    const result = buildGeneralPrObservationSealV1({
      corpus: corpus(),
      schemaHashes: [hash("source"), hash("span"), hash("relation"), hash("observation")],
      selectionPolicyHash: hash("selection"),
      rubricHash: hash("rubric"),
      toolchainHash: hash("toolchain")
    });
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
    const input = { schemaHashes: [hash("source")], selectionPolicyHash: hash("selection"), rubricHash: hash("rubric"), toolchainHash: hash("toolchain") };

    assert.deepEqual(buildGeneralPrObservationSealV1({ corpus: disagreement, ...input }), { status: "invalid" });
    assert.deepEqual(buildGeneralPrObservationSealV1({ corpus: mixed, ...input }), { status: "invalid" });
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
    const input = { schemaHashes: [hash("observation")], selectionPolicyHash: hash("selection"), rubricHash: hash("rubric"), toolchainHash: hash("toolchain") };

    assert.equal(buildGeneralPrObservationSealV1({ corpus: observation, ...input }).status, "sealed");
    assert.deepEqual(buildGeneralPrObservationSealV1({ corpus: conflict, ...input }), { status: "invalid" });
  });
});
