import { describe, expect, it } from "vitest";
import {
  canonicalRequirementSourceBindingV2,
  completePrivateProofReceiptBundleV2,
  validatePrivateProofReceiptBundleV2
} from "./evidence-receipts";
import type { CanonicalRequirementSetV1, CanonicalRequirementUnitV1, PrivateProofReceiptBundleV2 } from "./types";

const SOURCE_CONTENT_HASH = "a".repeat(64);

function canonicalUnit(overrides: Partial<CanonicalRequirementUnitV1> = {}): CanonicalRequirementUnitV1 {
  return {
    reportRequirementId: "req_1",
    stableBindingKey: "binding_one",
    source: "issue",
    authority: "authoritative",
    groupId: "grp_4",
    ordinal: 2,
    normalizedTextHash: "b".repeat(64),
    text: "Add the private receipt helper.",
    priority: "must",
    sourceQuality: "explicit_acceptance_criteria",
    ...overrides
  };
}

function emptyBundle(): PrivateProofReceiptBundleV2 {
  return {
    sourceBindings: [],
    exactHeadTargetReceipts: [],
    testRelationReceipts: [],
    executionBindingReceipts: [],
    failedCheckAssociations: []
  };
}

describe("private evidence receipts", () => {
  it("derives a bounded canonical source binding without requirement text", () => {
    const binding = canonicalRequirementSourceBindingV2(canonicalUnit(), SOURCE_CONTENT_HASH);

    expect(binding).toEqual({
      version: 1,
      kind: "requirement_source_binding",
      id: "rsb_binding_one",
      requirementId: "req_1",
      spanId: "sp_4_2",
      seedId: SOURCE_CONTENT_HASH,
      groupId: "grp_4",
      source: "issue",
      ordinal: 2
    });
    expect(JSON.stringify(binding)).not.toContain("private receipt helper");
  });

  it("replaces relation-only bindings with the complete canonical owner set", () => {
    const second = canonicalUnit({
      reportRequirementId: "req_2",
      stableBindingKey: "binding_two",
      groupId: "grp_5",
      ordinal: 1
    });
    const canonical: CanonicalRequirementSetV1 = {
      version: 1,
      inputKind: "selected_source",
      sourceIdentityHash: "c".repeat(64),
      sourceContentHash: SOURCE_CONTENT_HASH,
      requirements: [canonicalUnit(), second]
    };
    const bundle = emptyBundle();
    bundle.sourceBindings = [{
      version: 1,
      kind: "requirement_source_binding",
      id: "rsb_sp_4_2",
      requirementId: "req_1",
      spanId: "sp_4_2",
      seedId: SOURCE_CONTENT_HASH,
      groupId: "grp_4",
      source: "issue",
      ordinal: 2
    }];

    const completed = completePrivateProofReceiptBundleV2(bundle, canonical);

    expect(completed.sourceBindings).toEqual([
      canonicalRequirementSourceBindingV2(canonical.requirements[0]!, SOURCE_CONTENT_HASH),
      canonicalRequirementSourceBindingV2(canonical.requirements[1]!, SOURCE_CONTENT_HASH)
    ]);
    expect(completed.exactHeadTargetReceipts).toBe(bundle.exactHeadTargetReceipts);
    expect(completed.testRelationReceipts).toBe(bundle.testRelationReceipts);
    expect(completePrivateProofReceiptBundleV2(completed, canonical)).toEqual(completed);
  });

  it("rejects private raw fields and an unclosed v2 execution reference without echoing it", () => {
    const bundle = emptyBundle();
    bundle.testRelationReceipts = [{
      id: "relation_1",
      version: 2,
      kind: "targeted_test_relation",
      requirementId: "req_1",
      subjectSource: "current_requirement",
      targetMode: "changed_target",
      implementationEvidenceRef: "ev_implementation",
      testEvidenceRef: "ev_test",
      subjectDigest: "c".repeat(64),
      importBindingDigest: "d".repeat(64),
      assertionShape: "direct_argument",
      directAssertionCount: 1,
      executionReceiptRef: "PRIVATE_UNCLOSED_REF"
    }];
    (bundle.testRelationReceipts[0] as unknown as Record<string, unknown>).rawAssertion = "private source";

    const errors = validatePrivateProofReceiptBundleV2(bundle).join("\n");

    expect(errors).toContain("test relation receipt.rawAssertion is not allowed");
    expect(errors).toContain("test relation receipts cite a missing execution binding receipt");
    expect(errors).not.toContain("PRIVATE_UNCLOSED_REF");
  });
});
