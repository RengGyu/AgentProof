import { describe, expect, it } from "vitest";
import {
  PROOF_AXIS_COLLECTION_BASES,
  PROOF_AXIS_SUBJECTS,
  isProofAxisCollectionBasisAllowed
} from "./proof-contract";

describe("proof contract", () => {
  it("includes existing interaction and suite execution values", () => {
    expect(PROOF_AXIS_SUBJECTS).toContain("interaction");
    expect(PROOF_AXIS_COLLECTION_BASES).toContain("passing_suite_execution");
    expect(PROOF_AXIS_COLLECTION_BASES).toContain("interaction_verification");
  });

  it("permits only compatible subject and collection basis pairs", () => {
    expect(isProofAxisCollectionBasisAllowed("interaction", "interaction_verification")).toBe(true);
    expect(isProofAxisCollectionBasisAllowed("execution", "passing_suite_execution")).toBe(true);
    expect(isProofAxisCollectionBasisAllowed("interaction", "passing_execution")).toBe(false);
  });
});
