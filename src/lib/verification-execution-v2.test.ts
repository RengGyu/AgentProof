import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildVerificationExecutionRequestV2,
  evaluateReturnValueCriterionV2,
  validateAttestedExecutionResultV2
} from "./verification-execution-v2";
import { parseVerificationContractV2 } from "./verification-contract-v2";

const sourceContract = {
  version: 2,
  scope: "complete_objective_set",
  objectives: [{
    id: "visibility_label",
    objective: "Return a repository visibility label for both boolean states.",
    criteria: [{
      id: "boolean_labels",
      type: "return_value",
      label: "Return the label for each visibility value.",
      adapter: {
        id: "node_export_scalar.v1",
        modulePath: "src/repositories/repository-visibility.js",
        exportName: "repositoryVisibilityLabel",
        moduleFormat: "esm"
      },
      cases: [
        { id: "private", input: true, expected: "Private repository" },
        { id: "public", input: false, expected: "Public repository" }
      ]
    }]
  }]
};

describe("verification execution v2", () => {
  it("marks a return-value criterion unavailable without a signed executor result", () => {
    const criterion = returnValueCriterion();

    expect(evaluateReturnValueCriterionV2(criterion, undefined)).toEqual({
      state: "unavailable",
      evidenceRefs: [],
      gapKinds: ["evidence_unavailable"]
    });
  });

  it("builds a bounded source-free request and rejects a result with reordered cases before evaluation", () => {
    const criterion = returnValueCriterion();
    const request = buildVerificationExecutionRequestV2("a".repeat(64), criterion);

    expect(JSON.stringify(request)).not.toContain("Return the label");
    expect(validateAttestedExecutionResultV2({
      version: 1,
      bindingDigest: "a".repeat(64),
      results: [{
        criterionId: criterion.id,
        adapterId: "node_export_scalar.v1",
        cases: [
          { id: "public", state: "satisfied" },
          { id: "private", state: "satisfied" }
        ]
      }],
      signature: "not-a-real-signature"
    }, request, undefined).ok).toBe(false);
  });

  it("rejects an executor-authored satisfied case state even when the envelope is correctly signed", () => {
    const criterion = returnValueCriterion();
    const request = buildVerificationExecutionRequestV2("a".repeat(64), criterion);
    const keys = generateKeyPairSync("ed25519");
    const payload = {
      version: 1,
      bindingDigest: request.bindingDigest,
      results: [{
        criterionId: criterion.id,
        adapterId: criterion.adapter.id,
        cases: criterion.cases.map((testCase) => ({ id: testCase.id, state: "satisfied" }))
      }]
    };
    const signed = {
      ...payload,
      signature: sign(null, Buffer.from(stableJson(payload), "utf8"), keys.privateKey).toString("base64")
    };

    expect(validateAttestedExecutionResultV2(signed, request, keys.publicKey.export({ type: "spki", format: "pem" }).toString()).ok).toBe(false);
  });

  it("derives violation from a signed returned value that differs from the contract", () => {
    const criterion = returnValueCriterion();
    const result = {
      version: 1,
      bindingDigest: "a".repeat(64),
      results: [{
        criterionId: criterion.id,
        adapterId: criterion.adapter.id,
        cases: [
          { id: "private", outcome: { kind: "returned", actual: "Public repository" } },
          { id: "public", outcome: { kind: "returned", actual: "Public repository" } }
        ]
      }],
      signature: "validated-by-boundary"
    };

    expect(evaluateReturnValueCriterionV2(criterion, result as never)).toMatchObject({
      state: "violated",
      gapKinds: ["missing_execution"]
    });
  });
});

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function returnValueCriterion() {
  const parsed = parseVerificationContractV2({ kind: "provided_requirement", contract: sourceContract });
  if (parsed.state !== "authoritative") throw new Error("expected an authoritative contract");
  const criterion = parsed.contract.objectives[0]?.criteria[0];
  if (!criterion || criterion.type !== "return_value") throw new Error("expected a return-value criterion");
  return criterion;
}
