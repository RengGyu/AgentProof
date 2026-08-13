import { describe, expect, it } from "vitest";
import {
  canonicalVerificationBindingV2,
  criterionAxisIdV2,
  aggregateVerificationCriteriaV2,
  materializeVerificationContractV2,
  parseVerificationContractV2,
  selectVerificationContractV2,
  validateCriterionAxisClosureV2
} from "./verification-contract-v2";
import { generateVerificationReportV2FromInput } from "./verifier";
import { demoScenarios } from "./sample-data";

const contract = {
  version: 2,
  scope: "complete_objective_set",
  objectives: [
    {
      id: "visibility_label",
      objective: "Return a repository visibility label for both boolean states.",
      criteria: [
        {
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
        }
      ]
    }
  ]
};

describe("parseVerificationContractV2", () => {
  it("returns absent for PR #24-style prose without using subjective-word classification", () => {
    expect(parseVerificationContractV2({
      kind: "linked_issue",
      title: "The repository overview should be more useful for reviewers.",
      body: ""
    })).toEqual({ state: "absent" });
  });

  it("rejects a contract fence under the wrong linked-Issue title", () => {
    const result = parseVerificationContractV2({
      kind: "linked_issue",
      title: "Other objective",
      body: `\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``
    });

    expect(result).toEqual({ state: "invalid", invalidReason: "source_mismatch" });
  });

  it("parses the exact linked-Issue contract envelope", () => {
    const result = parseVerificationContractV2({
      kind: "linked_issue",
      title: "AgentProof verification contract",
      body: `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``
    });

    expect(result.state).toBe("authoritative");
    if (result.state !== "authoritative") throw new Error("expected an authoritative contract");
    expect(result.contract.objectives[0].criteria[0]).toMatchObject({
      type: "return_value",
      adapter: { id: "node_export_scalar.v1" }
    });
  });

  it("rejects sibling Issue prose instead of silently omitting an objective", () => {
    const result = parseVerificationContractV2({
      kind: "linked_issue",
      title: "AgentProof verification contract",
      body: `Context the contract does not contain.\n\n\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``
    });

    expect(result).toEqual({ state: "invalid", invalidReason: "extra_source_prose" });
  });

  it("does not let a PR-description contract override the linked Issue authority", () => {
    const result = selectVerificationContractV2({
      linkedIssue: {
        title: "AgentProof verification contract",
        body: `\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``
      },
      prDescription: {
        title: "AgentProof verification contract",
        body: `\`\`\`agentproof-verification\n${JSON.stringify({ ...contract, objectives: [] })}\n\`\`\``
      }
    });

    expect(result.state).toBe("authoritative");
  });

  it("rejects unsupported behavior criteria as a whole", () => {
    const result = parseVerificationContractV2({
      kind: "provided_requirement",
      contract: {
        ...contract,
        objectives: [{
          ...contract.objectives[0],
          criteria: [{ id: "ui", type: "ui_render" }]
        }]
      }
    });

    expect(result).toEqual({ state: "invalid", invalidReason: "unsupported_type" });
  });

  it("binds exact source content and source identity so equal contract text cannot survive an Issue relink", () => {
    const parsed = parseVerificationContractV2({
      kind: "provided_requirement",
      contract
    });
    if (parsed.state !== "authoritative") throw new Error("expected an authoritative contract");

    const first = canonicalVerificationBindingV2({
      sourceKind: "linked_issue",
      sourceIdentity: "github:repository:42:issue:24",
      sourceContent: JSON.stringify(contract),
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40)
    }, parsed.contract);
    const relinked = canonicalVerificationBindingV2({
      sourceKind: "linked_issue",
      sourceIdentity: "github:repository:42:issue:25",
      sourceContent: JSON.stringify(contract),
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40)
    }, parsed.contract);

    expect(first).not.toBe(relinked);
  });

  it("materializes a non-vacuous criterion set with server-owned report IDs and axis subjects", () => {
    const parsed = parseVerificationContractV2({ kind: "provided_requirement", contract });
    if (parsed.state !== "authoritative") throw new Error("expected an authoritative contract");

    const materialized = materializeVerificationContractV2(parsed, "c".repeat(64));

    expect(materialized.objectives).toEqual([
      expect.objectContaining({
        requirementId: "vc_o1",
        criteria: [expect.objectContaining({
          criterionId: "vc_o1_c1",
          requiredEvidence: ["implementation", "targeted_test", "execution"]
        })]
      })
    ]);
  });

  it("rejects a cross-criterion axis reference instead of accepting an arbitrary proof-axis string", () => {
    const parsed = parseVerificationContractV2({ kind: "provided_requirement", contract });
    if (parsed.state !== "authoritative") throw new Error("expected an authoritative contract");
    const materialized = materializeVerificationContractV2(parsed, "c".repeat(64));
    const criterion = materialized.objectives[0]!.criteria[0]!;
    const axisId = criterionAxisIdV2("vc_o1", "vc_o1_c1", "implementation", "present");

    expect(validateCriterionAxisClosureV2({
      criteria: [{
        criterionId: criterion.criterionId,
        requirementId: criterion.requirementId,
        requiredEvidence: criterion.requiredEvidence,
        proofAxisRefs: [axisId.replace("vc_o1_c1", "vc_o1_c2")]
      }],
      axes: [{
        axisId,
        role: "criterion",
        criterionId: criterion.criterionId,
        subject: "implementation",
        polarity: "present"
      }]
    }).ok).toBe(false);
  });

  it("never treats an empty authoritative criterion set as a vacuous met result", () => {
    expect(aggregateVerificationCriteriaV2("authoritative", [])).toBe("unclear");
    expect(aggregateVerificationCriteriaV2("authoritative", ["satisfied"])).toBe("met");
    expect(aggregateVerificationCriteriaV2("author_claim", ["satisfied"])).toBe("partial");
  });

  it("keeps observed deterministic coverage when no approved contract leaves the outcome unclear", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);

    expect(report.verificationContract.state).toBe("absent");
    expect(report.requirements.some((requirement) => requirement.status === "unclear")).toBe(true);
    expect(report.requirements.some((requirement) => requirement.evidenceStatus === "met")).toBe(true);
  });
});
