import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runGeneralPrObservationSealCliV1 } from "./general-pr-observation-seal.mjs";

describe("build-general-pr-observation-seal", () => {
  it("requires every explicit external input path and never uses a default corpus path", () => {
    assert.equal(runGeneralPrObservationSealCliV1([]), 2);
    assert.equal(runGeneralPrObservationSealCliV1(["--corpus", "external.json"]), 2);
  });
});
