import { describe, expect, it } from "vitest";
import {
  canonicalVerificationBindingV2,
  parseVerificationContractV2
} from "./verification-contract-v2";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReportV2, generateVerificationReportV2FromInput } from "./verifier";
import type { PullRequestInput } from "./types";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

const documentationContract = {
  version: 2,
  scope: "complete_objective_set",
  objectives: [{
    id: "reset_doc",
    objective: "Document the local reset command.",
    criteria: [{
      id: "reset_literal",
      type: "artifact",
      label: "The reset document includes the exact test command.",
      paths: ["docs/reset.md"],
      artifact: { kind: "documentation_literal", literal: "Run npm test." }
    }]
  }]
};

describe("verification-contract v2 evaluation closure", () => {
  it("keeps an exact no-contract helper objective unclear while retaining observed evidence", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);

    expect(report.verificationContract.state).toBe("absent");
    expect(report.requirements.some((requirement) => requirement.status === "unclear")).toBe(true);
    expect(report.requirements.some((requirement) => requirement.evidenceStatus === "met")).toBe(true);
  });

  it("materializes an authoritative documentation criterion only with its exact-head artifact", () => {
    const report = generateVerificationReportV2({
      input: contractInput(),
      contractSource: { kind: "provided_requirement", contract: documentationContract },
      binding: bindingFor("provided_requirement", JSON.stringify(documentationContract))
    });

    expect(report.requirements[0]).toMatchObject({ status: "met", gaps: [] });
    expect(report.verificationContract.objectives[0]?.criterionResults).toEqual([
      expect.objectContaining({ state: "satisfied", evidenceRefs: expect.any(Array) })
    ]);
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
  });

  it("caps an otherwise satisfied PR-description contract at partial", () => {
    const sourceContent = contractEnvelope(documentationContract);
    const report = generateVerificationReportV2({
      input: contractInput(),
      contractSource: {
        kind: "pr_description",
        title: "AgentProof verification contract",
        body: sourceContent
      },
      binding: bindingFor("pr_description", sourceContent)
    });

    expect(report.verificationContract.state).toBe("author_claim");
    expect(report.requirements[0]).toMatchObject({ status: "partial", gaps: [] });
  });

  it("keeps an authoritative contract unclear when its exact artifact was not collected", () => {
    const report = generateVerificationReportV2({
      input: contractInput({ verificationCriterionEvidenceV2: undefined }),
      contractSource: { kind: "provided_requirement", contract: documentationContract },
      binding: bindingFor("provided_requirement", JSON.stringify(documentationContract))
    });

    expect(report.requirements[0]).toMatchObject({
      status: "unclear",
      gaps: ["A required verification criterion was unavailable, incomplete, or not yet satisfied."]
    });
    expect(report.verificationContract.objectives[0]?.criterionResults[0]).toMatchObject({ state: "unavailable" });
  });

  it("keeps an absence criterion unclear when the changed-file inventory is incomplete", () => {
    const absenceContract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "runtime_scope",
        objective: "Do not modify runtime code.",
        criteria: [{
          id: "no_runtime_change",
          type: "absence",
          label: "No runtime path changes.",
          prohibitedKind: "path_change",
          scope: [{ kind: "prefix", path: "src/runtime/" }]
        }]
      }]
    };
    const report = generateVerificationReportV2({
      input: contractInput({
        changedFiles: [],
        verificationCriterionEvidenceV2: undefined,
        sourceProvenance: {
          ...contractInput().sourceProvenance!,
          changedFileInventory: { version: 1, completeness: "incomplete", headSha: HEAD_SHA }
        }
      }),
      contractSource: { kind: "provided_requirement", contract: absenceContract },
      binding: bindingFor("provided_requirement", JSON.stringify(absenceContract))
    });

    expect(report.requirements[0]?.status).toBe("unclear");
    expect(report.verificationContract.objectives[0]?.criterionResults[0]).toMatchObject({ state: "unavailable" });
  });

  it("satisfies a complete exact-head absence criterion without inventing a changed-file match", () => {
    const absenceContract = runtimeAbsenceContract();
    const report = generateVerificationReportV2({
      input: contractInput({ verificationCriterionEvidenceV2: undefined }),
      contractSource: { kind: "provided_requirement", contract: absenceContract },
      binding: bindingFor("provided_requirement", JSON.stringify(absenceContract))
    });

    expect(report.requirements[0]).toMatchObject({ status: "met", gaps: [] });
    expect(report.verificationContract.objectives[0]?.criterionResults[0]).toMatchObject({
      state: "satisfied",
      evidenceRefs: []
    });
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });

    const forged = structuredClone(report);
    delete forged.source.provenance?.changedFileInventory;
    expect(validateVerificationReport(forged, { mode: "v2_full" }).valid).toBe(false);
  });

  it("does not grant a live met outcome to a return-value contract without an attested observation", () => {
    const returnValueContract = {
      version: 2,
      scope: "complete_objective_set",
      objectives: [{
        id: "visibility_label",
        objective: "Return the private repository label.",
        criteria: [{
          id: "private_label",
          type: "return_value",
          label: "The private branch returns the expected label.",
          adapter: {
            id: "node_export_scalar.v1",
            modulePath: "src/repositories/repository-visibility.js",
            exportName: "repositoryVisibilityLabel",
            moduleFormat: "esm"
          },
          cases: [{ id: "private", input: true, expected: "Private repository" }]
        }]
      }]
    };
    const report = generateVerificationReportV2({
      input: contractInput(),
      contractSource: { kind: "provided_requirement", contract: returnValueContract },
      binding: bindingFor("provided_requirement", JSON.stringify(returnValueContract))
    });

    expect(report.requirements[0]?.status).toBe("unclear");
    expect(report.verificationContract.objectives[0]?.criterionResults[0]).toMatchObject({ state: "unavailable" });
  });

  it("rejects malformed contracts and preserves a contract-specific next gap", () => {
    const report = generateVerificationReportV2({
      input: contractInput(),
      contractSource: { kind: "provided_requirement", contract: { version: 2, scope: "complete_objective_set", objectives: [] } },
      binding: bindingFor("provided_requirement", "invalid-contract")
    });

    expect(report.verificationContract.state).toBe("invalid");
    expect(report.requirements.every((requirement) => requirement.status === "unclear")).toBe(true);
    expect(report.requirements.every((requirement) => requirement.gaps.includes("Verification contract could not be validated."))).toBe(true);
  });

  it("changes the binding when an equal-text Issue contract is relinked", () => {
    const parsed = parseVerificationContractV2({ kind: "provided_requirement", contract: documentationContract });
    if (parsed.state !== "authoritative") throw new Error("expected an authoritative contract");

    const first = canonicalVerificationBindingV2(bindingFor("linked_issue", JSON.stringify(documentationContract), "github:repository:42:issue:24"), parsed.contract);
    const relinked = canonicalVerificationBindingV2(bindingFor("linked_issue", JSON.stringify(documentationContract), "github:repository:42:issue:25"), parsed.contract);

    expect(first).not.toBe(relinked);
  });

  it("rejects a forged satisfied criterion after report generation", () => {
    const report = generateVerificationReportV2({
      input: contractInput(),
      contractSource: { kind: "provided_requirement", contract: documentationContract },
      binding: bindingFor("provided_requirement", JSON.stringify(documentationContract))
    });
    const forged = structuredClone(report);
    forged.verificationContract.objectives[0]!.criterionResults[0]!.evidenceRefs = [];

    expect(validateVerificationReport(forged, { mode: "v2_full" }).valid).toBe(false);
  });
});

function contractInput(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Document reset",
    description: "Documents the reset command.",
    taskText: "Document the local reset command.",
    taskSource: "issue",
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run npm test." }],
    checks: [],
    logs: [],
    verificationCriterionEvidenceV2: {
      artifactBlobs: [{ path: "docs/reset.md", content: "Stop the server.\nRun npm test." }]
    },
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
      evidenceCapturedAt: "2026-08-13T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    ...overrides
  };
}

function bindingFor(
  sourceKind: "linked_issue" | "provided_requirement" | "pr_description",
  sourceContent: string,
  sourceIdentity = "manual:verification-contract:1"
) {
  return { sourceKind, sourceIdentity, sourceContent, headSha: HEAD_SHA, baseSha: BASE_SHA } as const;
}

function contractEnvelope(contract: object): string {
  return `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``;
}

function runtimeAbsenceContract() {
  return {
    version: 2,
    scope: "complete_objective_set",
    objectives: [{
      id: "runtime_scope",
      objective: "Do not modify runtime code.",
      criteria: [{
        id: "no_runtime_change",
        type: "absence",
        label: "No runtime path changes.",
        prohibitedKind: "path_change",
        scope: [{ kind: "prefix", path: "src/runtime/" }]
      }]
    }]
  };
}
