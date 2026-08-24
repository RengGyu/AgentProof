import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import { sanitizeReportForShare } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import type { PullRequestInput, RequirementFinding, RequirementProofAxis } from "./types";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

function withReceiptV2<T>(run: () => T): T {
  const previous = process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
  process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = "receipt_v2";
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
    else process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = previous;
  }
}

describe("frozen English observation evidence regressions", () => {
  it("extracts zero objectives from an evidence-inventory-only PR", () => {
    const report = generateVerificationReport(syntheticInput({
      title: "Supply evaluation evidence",
      description: [
        "## Requirements",
        "- This PR only provides changed-file and test evidence."
      ].join("\n"),
      taskText: "",
      taskSource: undefined,
      changedFiles: [{
        path: "test/evidence-fixture.test.js",
        status: "modified",
        patch: "+ test('supplies evidence', () => { expect(true).toBe(true); });"
      }],
      checks: [{ name: "fixture tests", status: "passed", summary: "Fixture tests passed." }]
    }));

    expect(report.requirements).toEqual([]);
    expect(report.proofGraph.nodes).toEqual([]);
    expect(report.proofGraph.summary.requirementCount).toBe(0);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it.each([
    { source: "selected issue text", taskSource: "issue" as const, expectedStatus: "missing" as const, expectedEvidenceStatus: undefined },
    { source: "PR-description fallback", taskSource: undefined, expectedStatus: "missing" as const, expectedEvidenceStatus: "partial" as const }
  ])("resolves an unqualified test sibling only through its predecessor for $source", ({ taskSource, expectedStatus, expectedEvidenceStatus }) => {
    const report = generateVerificationReport(changedSiblingInput(taskSource));
    const [behavior, testSibling] = report.requirements;
    const relation = report.proofGraph.nodes[1]?.deterministicRelation;

    expect(report.requirements).toHaveLength(2);
    expect(relation).toMatchObject({
      version: 1,
      kind: "test_antecedent",
      antecedentRequirementId: behavior?.requirementId
    });
    expect(testSibling?.proofAxes?.map((item) => item.subject)).toEqual([
      "targeted_test",
      "execution"
    ]);
    expect(axis(testSibling, "targeted_test")).toMatchObject({ state: "incomplete" });
    expect(axis(testSibling, "execution")).toMatchObject({ state: "incomplete" });
    expect(testSibling).toMatchObject({ status: expectedStatus });
    expect(testSibling?.evidenceStatus).toBe(expectedEvidenceStatus);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not promote an imported subject-chain test without a direct assertion", () => {
    const testPath = "test/repository-slug.test.js";
    const report = generateVerificationReport(syntheticInput({
      title: "Add repository slug behavior",
      description: "Adds repository slug behavior and coverage.",
      taskText: [
        "## Requirements",
        "- Add repositorySlug(repository) for owner/name values.",
        "- Return unknown/repository when owner/name is unavailable.",
        "- Add focused tests for normal and fallback paths."
      ].join("\n"),
      changedFiles: [{
        path: "src/repositories/repository-slug.js",
        status: "modified",
        patch: "+export function repositorySlug(repository) { return `${repository.owner}/${repository.name}`; }"
      }, {
        path: testPath,
        status: "modified",
        patch: [
          "+import assert from 'node:assert/strict';",
          "+import { repositorySlug } from '../src/repositories/repository-slug.js';",
          "+test('keeps an unrelated assertion', () => { assert.equal(true, true); });"
        ].join("\n")
      }],
      checks: [{ name: "repository slug tests", status: "passed", summary: "Repository slug tests passed." }],
      logs: [{ source: "repository slug tests", status: "passed", text: "Repository slug tests passed." }],
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "repository slug tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    }));
    const testSibling = report.requirements.at(-1);

    expect(report.proofGraph.nodes.at(-1)?.deterministicRelation).toMatchObject({ kind: "test_subject_chain" });
    expect(axis(testSibling, "targeted_test")).toMatchObject({ state: "violated", evidenceRefs: [] });
    expect(axis(testSibling, "execution")).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(sanitizeReportForShare(report))).not.toContain("test_subject_chain");
  });

  it("supports one bounded subject chain with direct flat-object assertions", () => {
    const testPath = "test/repository-slug.test.js";
    const report = generateVerificationReport(syntheticInput({
      title: "Add repository slug behavior",
      description: "Adds repository slug behavior and coverage.",
      taskText: [
        "## Requirements",
        "- Add repositorySlug(repository) for owner/name values.",
        "- Return unknown/repository when owner/name is unavailable.",
        "- Add focused tests for normal and fallback paths."
      ].join("\n"),
      changedFiles: [{
        path: "src/repositories/repository-slug.js",
        status: "modified",
        patch: "+export function repositorySlug(repository) { return repository.owner && repository.name ? `${repository.owner}/${repository.name}` : 'unknown/repository'; }"
      }, {
        path: testPath,
        status: "modified",
        patch: [
          "+import assert from 'node:assert/strict';",
          "+import { repositorySlug } from '../src/repositories/repository-slug.js';",
          "+test('formats a repository', () => { assert.equal(repositorySlug({ owner: 'RengGyu', name: 'AgentProof' }), 'RengGyu/AgentProof'); });",
          "+test('falls back without values', () => { assert.equal(repositorySlug({}), 'unknown/repository'); });"
        ].join("\n")
      }],
      checks: [{ name: "repository slug tests", status: "passed", summary: "Repository slug tests passed." }],
      logs: [{ source: "repository slug tests", status: "passed", text: "Repository slug tests passed." }],
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "repository slug tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    }));
    const testSibling = report.requirements.at(-1);

    expect(report.proofGraph.nodes.at(-1)?.deterministicRelation).toMatchObject({ kind: "test_subject_chain" });
    expect(axis(testSibling, "targeted_test")).toMatchObject({ state: "incomplete" });
    expect(axis(testSibling, "execution")).toMatchObject({ state: "incomplete" });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("supports one named subject-chain binding plus an unrelated sibling binding from the same module", () => {
    const testPath = "test/labels.test.js";
    const report = generateVerificationReport(syntheticInput({
      title: "Add label formatting behavior",
      description: "Adds label formatting coverage.",
      taskText: [
        "## Requirements",
        "- Add formatLabel(repository) for owner/name values.",
        "- Return the owner/name label string.",
        "- Add focused tests for the normal path."
      ].join("\n"),
      changedFiles: [{
        path: "src/labels.js",
        status: "modified",
        patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
      }, {
        path: testPath,
        status: "modified",
        patch: [
          "+import assert from 'node:assert/strict';",
          "+import { legacyLabel, formatLabel } from '../src/labels.js';",
          "+test('legacyLabel keeps legacy labels', () => { assert.equal(legacyLabel({ name: 'old' }), 'old'); });",
          "+test('formatLabel normal path formats owner/name labels', () => { assert.equal(formatLabel({ owner: 'acme', name: 'app' }), 'acme/app'); });"
        ].join("\n")
      }],
      checks: [{ name: "format tests", status: "passed", summary: "Format tests passed." }],
      logs: [{ source: "format tests", status: "passed", text: "Format tests passed." }],
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "format tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    }));
    const testSibling = report.requirements.at(-1);

    expect(report.proofGraph.nodes.at(-1)?.deterministicRelation).toMatchObject({ kind: "test_subject_chain" });
    expect(axis(testSibling, "targeted_test")).toMatchObject({ state: "incomplete" });
    expect(axis(testSibling, "execution")).toMatchObject({ state: "incomplete" });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not use an explicit code subject from a non-subject-chain test objective to relax changed-target binding selection", () => {
    const testPath = "test/labels.test.js";
    const report = generateVerificationReport(syntheticInput({
      title: "Add label formatting behavior",
      description: "Adds label formatting coverage.",
      taskText: [
        "## Requirements",
        "- Add label formatting behavior.",
        "- Add focused automated tests for `formatLabel` normal path."
      ].join("\n"),
      changedFiles: [{
        path: "src/labels.js",
        status: "modified",
        patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
      }, {
        path: testPath,
        status: "modified",
        patch: [
          "+import assert from 'node:assert/strict';",
          "+import { legacyLabel, formatLabel } from '../src/labels.js';",
          "+test('legacyLabel keeps legacy labels', () => { assert.equal(legacyLabel({ name: 'old' }), 'old'); });",
          "+test('formatLabel formats owner/name labels', () => { assert.equal(formatLabel({ owner: 'acme', name: 'app' }), 'acme/app'); });"
        ].join("\n")
      }],
      checks: [{ name: "format tests", status: "passed", summary: "Format tests passed." }],
      logs: [{ source: "format tests", status: "passed", text: "Format tests passed." }],
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "format tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    }));
    const requirement = report.requirements.at(-1);

    expect(report.proofGraph.nodes.at(-1)?.deterministicRelation).toMatchObject({ kind: "test_antecedent" });
    expect(axis(requirement, "targeted_test")).toMatchObject({ state: "violated", evidenceRefs: [] });
    expect(report.proofGraph.exactHeadTargetReceipts).toBeUndefined();
    expect(report.proofGraph.testRelationReceipts).toBeUndefined();
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps a subject-chain test incomplete when the selected subject exists only in unchanged context", () => {
    const testPath = "test/labels.test.js";
    const report = generateVerificationReport(syntheticInput({
      title: "Add label formatting behavior",
      description: "Adds unrelated assertion coverage.",
      taskText: [
        "## Requirements",
        "- Add formatLabel(repository) for owner/name values.",
        "- Return the owner/name label string.",
        "- Add focused tests for the normal path."
      ].join("\n"),
      changedFiles: [{
        path: "src/labels.js",
        status: "modified",
        patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
      }, {
        path: testPath,
        status: "modified",
        patch: [
          "@@ -1,3 +1,4 @@",
          " import assert from 'node:assert/strict';",
          " import { legacyLabel, formatLabel } from '../src/labels.js';",
          " test('formatLabel normal path formats owner/name labels', () => { assert.equal(formatLabel({ owner: 'acme', name: 'app' }), 'acme/app'); });",
          "+test('legacyLabel keeps legacy labels', () => { assert.equal(legacyLabel({ name: 'old' }), 'old'); });"
        ].join("\n")
      }],
      checks: [{ name: "format tests", status: "passed", summary: "Format tests passed." }],
      logs: [{ source: "format tests", status: "passed", text: "Format tests passed." }],
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "format tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [testPath]
      }]
    }));
    const testSibling = report.requirements.at(-1);

    expect(axis(testSibling, "targeted_test")).toMatchObject({ state: "violated", evidenceRefs: [] });
    expect(axis(testSibling, "execution")).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("assigns an unchanged-helper receipt only to its explicitly named test objective", () => {
    const input = unchangedHelperInput();
    input.taskText = [
      "## Requirements",
      "- Add a regression test for the existing `repositoryName` helper.",
      "- The test must confirm that the helper returns the repository name unchanged."
    ].join("\n");
    const report = withReceiptV2(() => generateVerificationReport(input));
    const [namedTest, semanticClaim] = report.requirements;

    expect(axis(namedTest, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(namedTest, "execution")).toMatchObject({ state: "satisfied" });
    expect(axis(semanticClaim, "targeted_test")).toMatchObject({ state: "violated" });
    expect(axis(semanticClaim, "execution")).toMatchObject({ state: "incomplete" });
    expect(semanticClaim?.status).toBe("partial");
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts[0]).toMatchObject({
      version: 2,
      requirementId: namedTest?.requirementId
    });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not assign an unchanged-helper receipt through a subjectless test antecedent", () => {
    const input = unchangedHelperInput();
    input.taskText = [
      "## Requirements",
      "- Add `repositoryName` helper behavior.",
      "- Add focused tests."
    ].join("\n");
    const report = generateVerificationReport(input);
    const testObjective = report.requirements.at(-1);

    expect(report.proofGraph.nodes.at(-1)?.deterministicRelation).toMatchObject({ kind: "test_antecedent" });
    expect(axis(testObjective, "targeted_test")).toMatchObject({ state: "violated", evidenceRefs: [] });
    expect(axis(testObjective, "execution")).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(report.proofGraph.exactHeadTargetReceipts).toBeUndefined();
    expect(report.proofGraph.testRelationReceipts).toBeUndefined();
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("supports a direct test-only regression of an unchanged helper only with exact receipts", () => {
    const withExactTarget = withReceiptV2(() => generateVerificationReport(unchangedHelperInput()));
    const withoutExactTarget = generateVerificationReport(unchangedHelperInput({ resolvedHeadModules: [] }));
    const supported = withExactTarget.requirements.at(-1);
    const unsupported = withoutExactTarget.requirements.at(-1);

    expect(axis(supported, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(supported, "execution")).toMatchObject({ state: "satisfied" });
    expect(withExactTarget.proofGraph.exactHeadTargetReceipts).toHaveLength(1);
    expect(withExactTarget.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(axis(unsupported, "targeted_test")).toMatchObject({ state: "incomplete" });
    expect(axis(unsupported, "execution")).toMatchObject({ state: "incomplete" });
    expect(withoutExactTarget.proofGraph.exactHeadTargetReceipts).toBeUndefined();
    expect(withoutExactTarget.proofGraph.testRelationReceipts).toBeUndefined();
    expect(validateVerificationReport(withExactTarget, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(validateVerificationReport(withoutExactTarget, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps an unchanged mixed-binding helper receipt bound only to its named export", () => {
    const report = withReceiptV2(() => generateVerificationReport(unchangedHelperInput({
      testPatch: [
        "+import assert from 'node:assert/strict';",
        "+import { legacyLabel, repositoryName } from '../src/repositories/name.js';",
        "+assert.equal(legacyLabel('AgentProof'), 'AgentProof');",
        "+test('formats repository names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
      ].join("\n"),
      moduleSource: [
        "export function legacyLabel(value) { return String(value); }",
        "export function repositoryName(value) { return String(value).toLowerCase(); }"
      ].join("\n")
    })));
    const namedTest = report.requirements.at(-1);

    expect(axis(namedTest, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(namedTest, "execution")).toMatchObject({ state: "satisfied" });
    expect(report.proofGraph.exactHeadTargetReceipts).toHaveLength(1);
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps an unchanged alias-bound helper receipt on its named export with an unrelated sibling import", () => {
    const report = withReceiptV2(() => generateVerificationReport(unchangedHelperInput({
      testPatch: [
        "+import assert from 'node:assert/strict';",
        "+import { legacyLabel, repositoryName as formatName } from '../src/repositories/name.js';",
        "+assert.equal(legacyLabel('AgentProof'), 'AgentProof');",
        "+test('formats repository names', () => { expect(formatName('AgentProof')).toBe('agentproof'); });"
      ].join("\n"),
      moduleSource: [
        "export function legacyLabel(value) { return String(value); }",
        "export function repositoryName(value) { return String(value).toLowerCase(); }"
      ].join("\n")
    })));
    const namedTest = report.requirements.at(-1);

    expect(axis(namedTest, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(namedTest, "execution")).toMatchObject({ state: "satisfied" });
    expect(report.proofGraph.exactHeadTargetReceipts).toHaveLength(1);
    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps an absent-contract outcome unclear without replacing the local observation gap", () => {
    const noContract = generateVerificationReportV2FromInput(searchEmptyStateInput());

    expect(noContract.verificationContract.state).toBe("absent");
    expect(noContract.requirements.every((item) => item.status === "unclear")).toBe(true);
    expect(noContract.verificationContract.gaps).toEqual([
      expect.objectContaining({ kind: "verification_contract_missing" })
    ]);
    expect(noContract.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .toContain("interaction_proof_missing");
    expect(noContract.requirements[0]?.gaps.join(" ")).toMatch(/interaction/i);
    expect(noContract.requirements[0]?.gaps).not.toContain("Approved verification contract is missing.");
  });

  it("keeps an invalid-contract outcome unclear without replacing the local observation gap", () => {
    const invalidContract = generateVerificationReportV2FromInput(searchEmptyStateInput({
      verificationContractSourceV2: {
        kind: "provided_requirement",
        contract: { version: 2, scope: "complete_objective_set", objectives: [] }
      },
      verificationContractBindingV2: {
        sourceKind: "provided_requirement",
        sourceIdentity: "manual:synthetic-requirement:1",
        sourceContent: "invalid synthetic contract",
        headSha: HEAD_SHA,
        baseSha: BASE_SHA
      }
    }));

    expect(invalidContract.verificationContract.state).toBe("invalid");
    expect(invalidContract.requirements.every((item) => item.status === "unclear")).toBe(true);
    expect(invalidContract.verificationContract.gaps).toEqual([
      expect.objectContaining({ kind: "verification_contract_invalid" })
    ]);
    expect(invalidContract.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .toContain("interaction_proof_missing");
    expect(invalidContract.requirements[0]?.gaps.join(" ")).toMatch(/interaction/i);
    expect(invalidContract.requirements[0]?.gaps).not.toContain("Verification contract could not be validated.");
  });

  it("keeps helper-only reviewer visibility incomplete without visual evidence", () => {
    const visualOnly = generateVerificationReportV2FromInput(syntheticInput({
      title: "Show important review checks",
      description: "Adds a checks-panel helper and unit test.",
      taskText: "Important checks should be visible before review starts.",
      changedFiles: [
        {
          path: "src/review/ChecksPanel.tsx",
          status: "modified",
          patch: "+ export function ChecksPanel() { return <section>Important checks</section>; }"
        },
        {
          path: "test/checks-panel.test.tsx",
          status: "modified",
          patch: [
            "+ import { ChecksPanel } from '../src/review/ChecksPanel';",
            "+ test('returns the important checks helper', () => { expect(ChecksPanel()).toBeTruthy(); });"
          ].join("\n")
        }
      ],
      checks: [{ name: "checks panel unit tests", status: "passed", summary: "Checks panel unit tests passed." }]
    }));

    expect(visualOnly.requirements[0]?.status).toBe("unclear");
    expect(visualOnly.requirements[0]?.evidenceStatus).toBe("partial");
    expect(axis(visualOnly.requirements[0], "visual")).toMatchObject({
      state: "incomplete",
      evidenceRefs: []
    });
    expect(visualOnly.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .toContain("visual_proof_missing");
  });

  it("keeps generic passing execution incomplete for a resolved workflow antecedent", () => {
    const workflowContinuation = generateVerificationReport(syntheticInput({
      title: "Pin the validation workflow runtime",
      description: "Updates the validation workflow.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }, {
        path: "test/validation-workflow.test.js",
        status: "modified",
        patch: "+ test('validation workflow command', () => { expect('npm test').toBe('npm test'); });"
      }],
      checks: [{ name: "Validation CI", status: "passed", summary: "Node.js 22 npm test passed." }],
      executionSuites: [{
        headSha: HEAD_SHA,
        status: "passed",
        executionSource: "Validation CI",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/validation-workflow.test.js"]
      }]
    }));
    const continuation = workflowContinuation.requirements[1];

    expect(continuation?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "ci_configuration", state: "satisfied" }),
      expect.objectContaining({ subject: "execution", state: "incomplete", evidenceRefs: [] })
    ]));
    expect(continuation?.proofAxes?.some((item) => item.subject === "implementation")).toBe(false);
    expect(workflowContinuation.proofGraph.nodes[1]?.deterministicRelation).toEqual({
      version: 1,
      kind: "workflow_antecedent",
      antecedentRequirementId: workflowContinuation.requirements[0]!.requirementId
    });
    expect(validateVerificationReport(workflowContinuation, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps an unrelated failed Check global while exact test execution remains local", () => {
    const report = generateVerificationReport(changedSiblingInput("issue", [{
      name: "UNRELATED_MATRIX=0",
      status: "failed",
      summary: "Status: failed. An unrelated matrix suite failed.",
      url: "https://github.com/example/project/actions/runs/10/job/20"
    }]));
    const testSibling = report.requirements[1];
    const failedCheckRef = report.evidenceIndex.find((item) =>
      item.kind === "check" && item.label === "UNRELATED_MATRIX=0"
    )!.id;

    expect(report.testing.ciStatus).toBe("failed");
    expect(axis(testSibling, "targeted_test")).toMatchObject({ state: "incomplete" });
    expect(axis(testSibling, "execution")).toMatchObject({ state: "incomplete" });
    expect(testSibling?.evidenceRefs).not.toContain(failedCheckRef);
    expect(report.proofGraph.nodes[1]?.executionEvidenceRefs).not.toContain(failedCheckRef);
    expect(report.proofGraph.nodes[1]?.gapSignals.map((gap) => gap.kind)).not.toContain("failed_execution");
    expect(report.proofGraph.failedCheckAssociations).toContainEqual({
      version: 1,
      kind: "failed_check_association",
      requirementId: testSibling!.requirementId,
      checkEvidenceRef: failedCheckRef,
      state: "unknown",
      basis: "identity_incomplete"
    });
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("omits every private relation receipt from the public share projection", () => {
    const failedCheck = {
      name: "UNRELATED_MATRIX=0",
      status: "failed" as const,
      summary: "Status: failed. An unrelated matrix suite failed.",
      url: "https://github.com/example/project/actions/runs/10/job/20"
    };
    const relationReport = generateVerificationReport(changedSiblingInput("issue", [failedCheck]));
    const exactTargetReport = generateVerificationReport(unchangedHelperInput({ checks: [failedCheck] }));
    const serializedShare = JSON.stringify([
      sanitizeReportForShare(relationReport),
      sanitizeReportForShare(exactTargetReport)
    ]);

    expect(relationReport.proofGraph.sourceBindings).toHaveLength(2);
    expect(exactTargetReport.proofGraph.exactHeadTargetReceipts).toHaveLength(1);
    expect(exactTargetReport.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(relationReport.proofGraph.failedCheckAssociations?.length).toBeGreaterThan(0);
    for (const privateField of [
      "sourceBindings",
      "exactHeadTargetReceipts",
      "testRelationReceipts",
      "privateReceiptBundleV2",
      "executionBindingReceipts",
      "failedCheckAssociations",
      "targetBlobSha",
      "canonicalBindingDigest",
      "UNRELATED_MATRIX=0",
      "An unrelated matrix suite failed"
    ]) {
      expect(serializedShare).not.toContain(privateField);
    }
    expect(relationReport.testing.ciStatus).toBe("failed");
    expect(exactTargetReport.testing.ciStatus).toBe("failed");
    expect(validateVerificationReport(relationReport, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(validateVerificationReport(exactTargetReport, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps a generic failed workflow Check global and records an incomplete association", () => {
    const workflowFailure = generateVerificationReport(syntheticInput({
      title: "Configure validation workflow",
      description: "Updates validation CI.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must configure the validation CI workflow to use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{ name: "Validation CI", status: "failed", summary: "Status: failed. npm test failed." }]
    }));
    const continuation = workflowFailure.requirements[1];
    const execution = axis(continuation, "execution");
    const associations = (workflowFailure.proofGraph as typeof workflowFailure.proofGraph & {
      failedCheckAssociations?: Array<Record<string, unknown>>;
    }).failedCheckAssociations;
    const failedCheckRef = workflowFailure.evidenceIndex.find((item) => item.kind === "check")!.id;

    expect(workflowFailure.testing.ciStatus).toBe("failed");
    expect(execution).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(workflowFailure.proofGraph.nodes[1]?.executionEvidenceRefs).toEqual([]);
    expect(workflowFailure.proofGraph.nodes[1]?.gapSignals.map((gap) => gap.kind)).not.toContain("failed_execution");
    expect(continuation?.evidenceRefs).not.toContain(failedCheckRef);
    expect(associations).toContainEqual({
      version: 1,
      kind: "failed_check_association",
      requirementId: continuation!.requirementId,
      checkEvidenceRef: failedCheckRef,
      state: "unknown",
      basis: "identity_incomplete"
    });
  });

  it("links failed workflow execution only from a complete matching identity tuple", () => {
    const workflowFailure = generateVerificationReport(syntheticInput({
      title: "Configure validation workflow",
      description: "Updates validation CI.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must configure the validation CI workflow to use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{
        name: "Validation CI",
        status: "failed",
        summary: "Status: failed. npm test failed.",
        workflowExecutionIdentity: {
          version: 1,
          kind: "workflow_execution_identity",
          workflowPath: ".github/workflows/validation.yml",
          workflowName: "Validation CI",
          workflowId: 101,
          runId: 202,
          runAttempt: 1,
          jobId: 303,
          jobName: "test",
          headSha: HEAD_SHA,
          checkEvidenceRef: "ev_4"
        }
      }]
    } as Partial<PullRequestInput> & { checks: Array<Record<string, unknown>> }) as PullRequestInput);
    const continuation = workflowFailure.requirements[1];
    const execution = axis(continuation, "execution");
    const associations = (workflowFailure.proofGraph as typeof workflowFailure.proofGraph & {
      failedCheckAssociations?: Array<Record<string, unknown>>;
    }).failedCheckAssociations;
    const failedCheckRef = workflowFailure.evidenceIndex.find((item) => item.kind === "check")!.id;

    expect(workflowFailure.testing.ciStatus).toBe("failed");
    expect(execution).toMatchObject({
      state: "violated",
      collectionBasis: "failed_execution",
      evidenceRefs: [failedCheckRef]
    });
    expect(workflowFailure.proofGraph.nodes[1]?.executionEvidenceRefs).toEqual([failedCheckRef]);
    expect(workflowFailure.proofGraph.nodes[1]?.gapSignals.map((gap) => gap.kind)).toContain("failed_execution");
    expect(associations).toContainEqual({
      version: 1,
      kind: "failed_check_association",
      requirementId: continuation!.requirementId,
      checkEvidenceRef: failedCheckRef,
      state: "linked",
      basis: "complete_identity_match"
    });
    const serializedAssociations = JSON.stringify(associations);
    expect(serializedAssociations).not.toContain("workflowExecutionIdentity");
    expect(serializedAssociations).not.toContain("workflowPath");
    expect(serializedAssociations).not.toContain("workflowId");
    expect(serializedAssociations).not.toContain("runId");
    expect(serializedAssociations).not.toContain("jobId");
    expect(serializedAssociations).not.toContain("npm test failed");
  });

  it("keeps a forged collector evidence reference global-only and unknown", () => {
    const report = generateVerificationReport(syntheticInput({
      title: "Configure validation workflow",
      description: "Updates validation CI.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must configure the validation CI workflow to use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{
        name: "Validation CI",
        status: "failed",
        summary: "Status: failed. npm test failed.",
        workflowExecutionIdentity: {
          version: 1,
          kind: "workflow_execution_identity",
          workflowPath: ".github/workflows/validation.yml",
          workflowName: "Validation CI",
          workflowId: 101,
          runId: 202,
          runAttempt: 1,
          jobId: 303,
          jobName: "test",
          headSha: HEAD_SHA,
          checkEvidenceRef: "ev_3"
        }
      }]
    } as Partial<PullRequestInput> & { checks: Array<Record<string, unknown>> }) as PullRequestInput);
    const continuation = report.requirements[1]!;
    const failedCheckRef = report.evidenceIndex.find((item) => item.kind === "check")!.id;

    expect(failedCheckRef).toBe("ev_4");
    expect(axis(continuation, "execution")).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(report.proofGraph.failedCheckAssociations).toContainEqual({
      version: 1,
      kind: "failed_check_association",
      requirementId: continuation.requirementId,
      checkEvidenceRef: "ev_4",
      state: "unknown",
      basis: "identity_incomplete"
    });
    expect(report.testing.ciStatus).toBe("failed");
  });

  it("does not inherit CI identity from competing workflow antecedents", () => {
    const ambiguousContinuation = generateVerificationReport(syntheticInput({
      title: "Configure validation workflows",
      description: "Updates two workflows.",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- Add the release CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: "src/validation-runner.ts",
        status: "modified",
        patch: "+ export const validationRunner = { node: 22, command: 'npm test' };"
      }],
      checks: [{ name: "Validation runner tests", status: "passed", summary: "Node.js 22 npm test passed." }]
    }));
    const ambiguous = ambiguousContinuation.requirements.at(-1);

    expect(ambiguousContinuation.proofGraph.nodes.at(-1)?.deterministicRelation).toBeUndefined();
    expect(ambiguous?.proofAxes?.some((item) => item.subject === "ci_configuration")).toBe(false);
    expect(ambiguous?.proofAxes?.map((item) => item.subject)).toEqual([
      "implementation",
      "execution"
    ]);
  });

  it("accepts an exact import with two literal cases and exact-head discovered execution", () => {
    const exactIdentity = generateVerificationReportV2FromInput(bothPathsInput());
    const exactFinding = exactIdentity.requirements.at(-1);

    expect(exactIdentity.verificationContract.state).toBe("absent");
    expect(exactFinding).toMatchObject({ status: "unclear", evidenceStatus: "partial" });
    expect(axis(exactFinding, "targeted_test")).toMatchObject({ state: "incomplete" });
    expect(axis(exactFinding, "execution")).toMatchObject({ state: "incomplete" });
    expect(exactIdentity.proofGraph.nodes.at(-1)).toMatchObject({
      caseCoverageReceipt: expect.objectContaining({
        version: 1,
        distinctLiteralCaseCount: 2
      })
    });
  });

  it.each([
    {
      name: "no direct import",
      overrides: { testPatch: twoCaseTestPatch("", "repositoryVisibilityLabel") }
    },
    {
      name: "a barrel import",
      overrides: {
        testPatch: twoCaseTestPatch(
          "import { repositoryVisibilityLabel } from '../src/repositories/index.js';",
          "repositoryVisibilityLabel"
        )
      }
    },
    {
      name: "ambiguous implementation identity",
      overrides: {
        additionalChangedFiles: [{
          path: "src/repositories/repository-visibility-legacy.js",
          status: "modified" as const,
          patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }"
        }]
      }
    },
    {
      name: "stale-head suite execution",
      overrides: { suiteHeadSha: "f".repeat(40) }
    },
    {
      name: "filtered suite execution",
      overrides: { suiteScope: "explicit_paths" as const }
    }
  ])("fails closed for $name", ({ overrides }) => {
    const report = generateVerificationReportV2FromInput(bothPathsInput(overrides));
    const finding = report.requirements.at(-1);

    expect(finding?.status).toBe("unclear");
    expect(finding?.evidenceStatus).not.toBe("met");
    expect(finding?.proofAxes?.some((item) => item.state === "incomplete")).toBe(true);
    expect(report.proofGraph.nodes.at(-1)?.gapSignals.map((gap) => gap.kind))
      .toContain("missing_targeted_test");
    expect(report.proofGraph.nodes.at(-1)).not.toHaveProperty("caseCoverageReceipt");
  });
});

function axis(
  finding: RequirementFinding | undefined,
  subject: RequirementProofAxis["subject"]
): RequirementProofAxis | undefined {
  return finding?.proofAxes?.find((candidate) => candidate.subject === subject);
}

function syntheticInput(overrides: Partial<PullRequestInput>): PullRequestInput {
  return {
    title: "Synthetic observation evidence regression",
    description: "Local synthetic evidence only.",
    taskText: "",
    taskSource: "issue",
    changedFiles: [],
    checks: [],
    logs: [],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: {
        version: 1,
        completeness: "complete",
        headSha: HEAD_SHA
      },
      evidenceCapturedAt: "2026-08-14T00:00:00.000Z",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "c".repeat(64),
        coverage: "github_metadata"
      }
    },
    ...overrides
  };
}

function changedSiblingInput(
  taskSource: "issue" | undefined,
  additionalChecks: PullRequestInput["checks"] = []
): PullRequestInput {
  const selectedSource = [
    "## Requirements",
    "- Add repositoryVisibilityLabel(isPrivate) for Private and Public repository values.",
    "- Add focused automated tests for both boolean paths."
  ].join("\n");
  const testPath = "test/repository-visibility.test.js";

  return syntheticInput({
    title: "Cover repository visibility behavior",
    description: taskSource ? "Adds repository visibility behavior and tests." : selectedSource,
    taskText: taskSource ? selectedSource : "",
    taskSource,
    changedFiles: [
      {
        path: "src/repositories/repository-visibility.js",
        status: "modified",
        patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }"
      },
      {
        path: testPath,
        status: "modified",
        patch: twoCaseTestPatch(
          "import { repositoryVisibilityLabel } from '../src/repositories/repository-visibility.js';",
          "repositoryVisibilityLabel"
        )
      }
    ],
    checks: [
      { name: "repository visibility tests", status: "passed", summary: "Repository visibility tests passed." },
      ...additionalChecks
    ],
    logs: [{ source: "repository visibility tests", status: "passed", text: "Repository visibility tests passed." }],
    executionSuites: [{
      headSha: HEAD_SHA,
      status: "passed",
      executionSource: "repository visibility tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [testPath]
    }]
  });
}

function unchangedHelperInput(
  overrides: Partial<Pick<PullRequestInput, "checks" | "resolvedHeadModules">> & {
    testPatch?: string;
    moduleSource?: string;
  } = {}
): PullRequestInput {
  const targetPath = "src/repositories/name.js";
  const testPath = "test/repository-name-regression.test.js";
  const moduleSource = overrides.moduleSource ?? "export function repositoryName(value) { return String(value).toLowerCase(); }";
  const sourceText = [
    "## Requirements",
    "- Add repositoryName(value) formatting.",
    "- Add a focused regression test for repositoryName(value)."
  ].join("\n");

  return syntheticInput({
    title: "Add focused formatting regression coverage",
    description: "Adds a direct regression test for an existing helper.",
    taskText: sourceText,
    changedFiles: [{
      path: testPath,
      status: "added",
      patch: overrides.testPatch ?? [
        "+import { repositoryName } from '../src/repositories/name.js';",
        "+test('formats repository names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
      ].join("\n")
    }],
    checks: overrides.checks ?? [{ name: "unit tests", status: "passed", summary: "Unit tests passed." }],
    logs: [{ source: "unit tests", status: "passed", text: "Unit tests passed." }],
    executionSuites: [{
      headSha: HEAD_SHA,
      status: "passed",
      executionSource: "unit tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [testPath]
    }],
    resolvedHeadModules: overrides.resolvedHeadModules ?? [{
      version: 1,
      kind: "resolved_head_module",
      headSha: HEAD_SHA,
      path: targetPath,
      blobSha: gitBlobSha(moduleSource),
      source: moduleSource
    }]
  });
}

function gitBlobSha(source: string): string {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(source, "utf8")}\0`)
    .update(source)
    .digest("hex");
}

function searchEmptyStateInput(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return syntheticInput({
    title: "Add repository search empty state",
    description: "Adds empty-state behavior and a focused logic test.",
    taskText: "Search results must show an empty-state message when no repositories match.",
    changedFiles: [
      {
        path: "src/repositories/RepositorySearch.js",
        status: "modified",
        patch: "+ export function emptyStateMessage() { return 'No repositories found'; }"
      },
      {
        path: "test/repository-search.test.js",
        status: "modified",
        patch: [
          "+ import { emptyStateMessage } from '../src/repositories/RepositorySearch.js';",
          "+ test('returns the empty state message', () => { expect(emptyStateMessage()).toBe('No repositories found'); });"
        ].join("\n")
      }
    ],
    checks: [{ name: "repository search tests", status: "passed", summary: "Repository search tests passed." }],
    logs: [{ source: "repository search tests", status: "passed", text: "Repository search tests passed." }],
    executionSuites: [{
      headSha: HEAD_SHA,
      status: "passed",
      executionSource: "repository search tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: ["test/repository-search.test.js"]
    }],
    ...overrides
  });
}

interface BothPathsOverrides {
  testPatch?: string;
  additionalChangedFiles?: PullRequestInput["changedFiles"];
  suiteHeadSha?: string;
  suiteScope?: "repository_discovery" | "explicit_paths" | "unknown";
}

function bothPathsInput(overrides: BothPathsOverrides = {}): PullRequestInput {
  const implementationPath = "src/repositories/repository-visibility.js";
  const testPath = "test/repository-visibility.test.js";
  const testPatch = overrides.testPatch ?? twoCaseTestPatch(
    "import { repositoryVisibilityLabel } from '../src/repositories/repository-visibility.js';",
    "repositoryVisibilityLabel"
  );

  return syntheticInput({
    title: "Cover both repository visibility paths",
    description: "Adds repository visibility behavior and focused tests.",
    taskText: [
      "Acceptance criteria:",
      "- Add repositoryVisibilityLabel(isPrivate) for Private and Public repository values and add focused automated tests for both boolean paths."
    ].join("\n"),
    changedFiles: [
      {
        path: implementationPath,
        status: "modified",
        patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }"
      },
      ...(overrides.additionalChangedFiles ?? []),
      { path: testPath, status: "modified", patch: testPatch }
    ],
    checks: [{ name: "repository visibility tests", status: "passed", summary: "Repository visibility tests passed." }],
    logs: [{ source: "repository visibility tests", status: "passed", text: "Repository visibility tests passed." }],
    executionSuites: [{
      headSha: overrides.suiteHeadSha ?? HEAD_SHA,
      status: "passed",
      executionSource: "repository visibility tests",
      runner: "node_test",
      scope: overrides.suiteScope ?? "repository_discovery",
      testPaths: [testPath]
    }]
  });
}

function twoCaseTestPatch(importLine: string, exportName: string): string {
  return [
    "+ import assert from 'node:assert/strict';",
    ...(importLine ? [`+ ${importLine}`] : []),
    `+ test('private repository', () => { assert.equal(${exportName}(true), 'Private repository'); });`,
    `+ test('public repository', () => { assert.equal(${exportName}(false), 'Public repository'); });`
  ].join("\n");
}
