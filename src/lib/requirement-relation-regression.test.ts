import { describe, expect, it } from "vitest";
import {
  deriveDeterministicRequirementRelations,
  extractRequirementEvidence,
  extractRequirementSpanSeed
} from "./extractors";
import { distinctDirectAssertionCallCount, testImportMatchesImplementation } from "./evidence-relation";
import {
  bindHybridPlannerSeedHash,
  buildHybridPlannerPlan,
  validateHybridPlannerPlan,
  type HybridPlannerSemanticDecision
} from "./hybrid-planner";
import { finalizeHybridVerificationReport } from "./hybrid-report-finalizer";
import { validateVerificationReport } from "./report-validation";
import type {
  PullRequestInput,
  RequirementFinding,
  RequirementProofAxis,
  SourceProvenance,
  VerificationReport
} from "./types";
import { generateVerificationReport } from "./verifier";
import { requirementProofAxisExpectations } from "./verifier-proof-expectations";

const provenance: SourceProvenance = {
  version: 1,
  origin: "github_snapshot",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  changedFileInventory: {
    version: 1,
    completeness: "complete",
    headSha: "a".repeat(40)
  },
  evidenceCapturedAt: "2026-08-13T00:00:00.000Z",
  inputFingerprint: {
    version: 1,
    algorithm: "sha256",
    value: "c".repeat(64),
    coverage: "github_metadata"
  }
};

const SOURCE_IDENTITY_HASH = "d".repeat(64);

describe("exact changed-test import relationships", () => {
  it("links a test only when its direct relative import resolves to the implementation file", () => {
    expect(testImportMatchesImplementation(
      {
        path: "test/customer-display-name.test.js",
        patch: "import { customerDisplayName } from '../src/customers/display-name.js';"
      },
      { path: "src/customers/display-name.js", patch: "" }
    )).toBe(true);
  });

  it("does not link a barrel import to a transitive implementation file", () => {
    expect(testImportMatchesImplementation(
      {
        path: "test/customer-display-name.test.js",
        patch: "import { customerDisplayName } from '../src/index.js';"
      },
      { path: "src/customers/display-name.js", patch: "" }
    )).toBe(false);
  });

  it("ignores a deleted direct import when resolving the implementation edge", () => {
    expect(testImportMatchesImplementation(
      {
        path: "test/customer-display-name.test.js",
        patch: [
          "-import { customerDisplayName } from '../src/customers/display-name.js';",
          "+import { customerDisplayName } from '../src/index.js';"
        ].join("\n")
      },
      { path: "src/customers/display-name.js", patch: "" }
    )).toBe(false);
  });

  it("ignores direct imports and asserted calls inside a multi-line block comment", () => {
    const testFile = {
      path: "test/customer-display-name.test.js",
      patch: [
        "+/*",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+expect(customerDisplayName(false)).toBe('Ada');",
        "+expect(customerDisplayName(true)).toBe('Ada Lovelace');",
        "+*/"
      ].join("\n")
    };
    const implementationFile = { path: "src/customers/display-name.js", patch: "" };

    expect(testImportMatchesImplementation(testFile, implementationFile)).toBe(false);
    expect(distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(0);
  });

  it("ignores apparent imports and asserted calls inside a multi-line template literal", () => {
    const testFile = {
      path: "test/customer-display-name.test.js",
      patch: [
        "+const fixture = `",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+expect(customerDisplayName(false)).toBe('Ada');",
        "+expect(customerDisplayName(true)).toBe('Ada Lovelace');",
        "+`;",
        "+test('unrelated smoke', () => { expect(true).toBe(true); });"
      ].join("\n")
    };
    const implementationFile = { path: "src/customers/display-name.js", patch: "" };

    expect(testImportMatchesImplementation(testFile, implementationFile)).toBe(false);
    expect(distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(0);
  });

  it("fails closed for a mid-file hunk whose initial lexical state is unavailable", () => {
    const testFile = {
      path: "test/customer-display-name.test.js",
      patch: [
        "@@ -40,3 +40,7 @@",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+expect(customerDisplayName(false)).toBe('Ada');",
        "+expect(customerDisplayName(true)).toBe('Ada Lovelace');",
        "+`;",
        "+test('unrelated smoke', () => { expect(true).toBe(true); });"
      ].join("\n")
    };
    const implementationFile = { path: "src/customers/display-name.js", patch: "" };

    expect(testImportMatchesImplementation(testFile, implementationFile)).toBe(false);
    expect(distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(0);
  });

  it("resets an unclosed quote before a later hunk independently marked as file-start safe", () => {
    const testFile = {
      path: "test/customer-display-name.test.js",
      patch: [
        "@@ -20,1 +20,1 @@",
        "+const fixture = `",
        "@@ -0,0 +1,4 @@",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+expect(customerDisplayName(false)).toBe('Ada');",
        "+expect(customerDisplayName(true)).toBe('Ada Lovelace');"
      ].join("\n")
    };
    const implementationFile = { path: "src/customers/display-name.js", patch: "" };

    expect(testImportMatchesImplementation(testFile, implementationFile)).toBe(true);
    expect(distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(2);
  });

  it("parses static import and assertion evidence from a hunk starting at the file beginning", () => {
    const testFile = {
      path: "test/customer-display-name.test.js",
      patch: [
        "@@ -0,0 +1,3 @@",
        "+import { customerDisplayName } from '../src/customers/display-name.js';",
        "+expect(customerDisplayName(false)).toBe('Ada');",
        "+expect(customerDisplayName(true)).toBe('Ada Lovelace');"
      ].join("\n")
    };
    const implementationFile = { path: "src/customers/display-name.js", patch: "" };

    expect(testImportMatchesImplementation(testFile, implementationFile)).toBe(true);
    expect(distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(2);
  });

  it("counts distinct literal calls to one directly imported export inside assertions", () => {
    expect(distinctDirectAssertionCallCount(
      {
        path: "test/retry.test.ts",
        patch: [
          "+ import assert from 'node:assert/strict';",
          "+ import { retryRequest } from '../src/retry';",
          "+ test('first', () => { assert.equal(retryRequest(true), undefined); });",
          "+ test('second', () => { assert.equal(retryRequest(false), undefined); });"
        ].join("\n")
      },
      { path: "src/retry.ts", patch: "+ export function retryRequest() {}" }
    )).toBe(2);
  });
});

function axis(
  finding: RequirementFinding | undefined,
  subject: RequirementProofAxis["subject"]
): RequirementProofAxis | undefined {
  return finding?.proofAxes?.find((candidate) => candidate.subject === subject);
}

function finalizeAllAuthoritative(
  input: PullRequestInput,
  decisions?: readonly HybridPlannerSemanticDecision[]
): VerificationReport {
  const extracted = extractRequirementSpanSeed(input.taskText, input.description, input.taskSource);
  if (!extracted.seed) throw new Error("fixture must produce a planner seed");
  const seed = bindHybridPlannerSeedHash(
    extracted.seed,
    provenance,
    input.requirementSourceIdentityHash
  );
  if (!seed) throw new Error("fixture seed must bind");
  const plan = buildHybridPlannerPlan(
    seed,
    provenance,
    decisions ?? seed.spans.map(() => ({
      disposition: "admit" as const,
      classification: "requirement" as const,
      expected_axes: []
    })),
    input.requirementSourceIdentityHash
  );
  if (!plan) throw new Error("fixture plan must build");
  const validated = validateHybridPlannerPlan(
    plan,
    seed,
    provenance,
    input.requirementSourceIdentityHash
  );
  const result = finalizeHybridVerificationReport({
    input,
    seed,
    provenance,
    requirementSourceIdentityHash: input.requirementSourceIdentityHash,
    planValidation: validated
  });

  expect(result.disposition).toBe("hybrid");
  expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({
    valid: true,
    errors: []
  });
  return result.report;
}

function linkedInput(overrides: Partial<PullRequestInput>): PullRequestInput {
  return {
    title: "Requirement relation regression",
    description: "Verifies requirement axes and evidence relationships.",
    taskText: "",
    taskSource: "issue",
    requirementSourceIdentityHash: SOURCE_IDENTITY_HASH,
    changedFiles: [],
    checks: [],
    logs: [],
    sourceProvenance: provenance,
    ...overrides
  };
}

describe("requirement relation regression matrix", () => {
  function deterministicRelations(taskText: string) {
    const input = linkedInput({ taskText });
    const extraction = extractRequirementEvidence(input.taskText, input.description, input.taskSource);
    return {
      requirements: extraction.requirements,
      relations: deriveDeterministicRequirementRelations(input, extraction.requirements)
    };
  }

  it("derives a visual obligation only for reviewer-visible UI presentation wording", () => {
    const { requirements, relations } = deterministicRelations(
      "Important checks should be visible before review starts."
    );

    expect(relations.proofExpectationsByRequirement.get(requirements[0]!.id)).toMatchObject({
      visual: true,
      interaction: false
    });
    expect(relations.evidenceContextRequirementIdsByRequirement.size).toBe(0);
  });

  it("does not treat non-UI visibility wording as presentation evidence", () => {
    const { requirements, relations } = deterministicRelations(
      "The deployment should remain visible to network monitors."
    );
    const requirement = requirements[0]!;

    expect(relations.proofExpectationsByRequirement.get(requirement.id))
      .toEqual(requirementProofAxisExpectations(requirement.text));
    expect(relations.evidenceContextRequirementIdsByRequirement.size).toBe(0);
  });

  it("inherits workflow modality from one explicit immediately preceding antecedent", () => {
    const { requirements, relations } = deterministicRelations([
      "Acceptance criteria:",
      "- Add the validation CI workflow.",
      "- It must use Node.js 22 and run npm test."
    ].join("\n"));
    const [workflow, continuation] = requirements;

    expect(relations.proofExpectationsByRequirement.get(continuation!.id)).toMatchObject({
      ci: true,
      implementation: false,
      execution: true
    });
    expect(relations.evidenceContextRequirementIdsByRequirement.get(continuation!.id))
      .toEqual([workflow!.id]);
  });

  it.each([
    {
      name: "a heading break",
      taskText: [
        "## Workflow",
        "Add the validation CI workflow.",
        "## Runtime",
        "It must use Node.js 22 and run npm test."
      ].join("\n")
    },
    {
      name: "two possible workflows",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- Add the release CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n")
    },
    {
      name: "a non-anaphoric sentence",
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- The validation runner must use Node.js 22 and run npm test."
      ].join("\n")
    }
  ])("keeps sentence-local proof for $name", ({ taskText }) => {
    const { requirements, relations } = deterministicRelations(taskText);
    const continuation = requirements.at(-1)!;

    expect(relations.proofExpectationsByRequirement.get(continuation.id))
      .toEqual(requirementProofAxisExpectations(continuation.text));
    expect(relations.evidenceContextRequirementIdsByRequirement.has(continuation.id)).toBe(false);
  });

  it("keeps reviewer presentation incomplete without browser or visual evidence", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Important checks should be visible before review starts.",
      changedFiles: [
        { path: "src/review/ChecksPanel.tsx", status: "modified", patch: "+ return <section>Important checks</section>" },
        { path: "src/review/ChecksPanel.test.tsx", status: "modified", patch: "+ it('shows important checks', () => {})" }
      ],
      checks: [{ name: "Checks panel unit tests", status: "passed", summary: "Checks panel unit tests passed." }]
    }));
    const visual = axis(report.requirements[0], "visual");

    expect(visual).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(report.requirements[0]?.gaps.join(" ")).toMatch(/visual/i);
  });

  it("uses CI plus execution axes for a resolved workflow continuation", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: ".github/workflows/validation.yml",
        status: "modified",
        patch: "+ name: Validation CI\n+ uses: actions/setup-node@v4\n+ node-version: 22\n+ run: npm test"
      }],
      checks: [{ name: "Validation CI", status: "passed", summary: "Node.js 22 npm test passed." }]
    }));
    const continuation = report.requirements[1];

    expect(continuation?.proofAxes?.map((item) => item.subject)).toEqual([
      "ci_configuration",
      "execution"
    ]);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps a workflow-like continuation sentence-local after a blank-line group break", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: [
        "Acceptance criteria:",
        "- Add the validation CI workflow.",
        "",
        "- It must use Node.js 22 and run npm test."
      ].join("\n"),
      changedFiles: [{
        path: "src/validation-runner.ts",
        status: "modified",
        patch: "+ export const validationRunner = { node: 22, command: 'npm test' };"
      }],
      checks: [{ name: "Validation runner tests", status: "passed", summary: "Node.js 22 npm test passed." }]
    }));
    const continuation = report.requirements[1];

    expect(continuation?.proofAxes?.map((item) => item.subject)).toEqual([
      "implementation",
      "execution"
    ]);
    expect(report.proofGraph.nodes[1]?.deterministicRelation).toBeUndefined();
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("treats flat list items as siblings instead of an implicit parent chain", () => {
    const result = extractRequirementSpanSeed([
      "Acceptance criteria:",
      "- Add repository visibility labels.",
      "- Return Public repository when false.",
      "- Add focused tests for both paths."
    ].join("\n"), "", "issue");

    expect(result.seed?.spans.map((span) => span.immediateParentSpanId)).toEqual([
      null,
      null,
      null
    ]);
  });

  it("uses indentation, not mere adjacency, for a real nested child relation", () => {
    const result = extractRequirementSpanSeed([
      "Acceptance criteria:",
      "- Add repository visibility labels.",
      "  - Add focused tests for both paths.",
      "- Document repository visibility."
    ].join("\n"), "", "issue");
    const spans = result.seed?.spans ?? [];

    expect(spans).toHaveLength(3);
    expect(spans[0]?.immediateParentSpanId).toBeNull();
    expect(spans[1]?.immediateParentSpanId).toBe(spans[0]?.id);
    expect(spans[2]?.immediateParentSpanId).toBeNull();
  });

  it("inherits proof context only for the truly nested child and not the following sibling", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: [
        "Acceptance criteria:",
        "- Add retry handling.",
        "  - Add regression tests for both retry paths.",
        "- Document retry setup."
      ].join("\n"),
      changedFiles: [
        { path: "src/retry.ts", status: "modified", patch: "+ export function retryRequest() {}" },
        {
          path: "test/retry.test.ts",
          status: "modified",
          patch: [
            "+ import assert from 'node:assert/strict';",
            "+ import { retryRequest } from '../src/retry';",
            "+ test('first retry path', () => { assert.equal(retryRequest(true), undefined); });",
            "+ test('second retry path', () => { assert.equal(retryRequest(false), undefined); });"
          ].join("\n")
        },
        { path: "docs/retry.md", status: "modified", patch: "+ Retry setup" }
      ],
      checks: [{ name: "retry tests", status: "passed", summary: "Both retry paths passed." }],
      logs: [{ source: "retry tests", status: "passed", text: "npm test passed." }],
      executionSuites: [{
        headSha: "a".repeat(40),
        status: "passed",
        executionSource: "retry tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/retry.test.ts"]
      }]
    }));
    const nestedTest = report.requirements[1];
    const documentationSibling = report.requirements[2];

    expect(nestedTest?.proofAxes?.map((item) => item.subject)).toEqual([
      "implementation",
      "targeted_test",
      "execution"
    ]);
    expect(axis(nestedTest, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(nestedTest, "execution")).toMatchObject({ state: "satisfied" });
    expect(nestedTest?.plannerAxisSubjects).toBeUndefined();
    expect(report.proofGraph.nodes[1]?.targetedTestEvidenceRefs.length).toBeGreaterThan(0);
    expect(report.proofGraph.nodes[1]?.executionEvidenceRefs.length).toBeGreaterThan(0);
    expect(documentationSibling?.proofAxes?.map((item) => item.subject)).toEqual([
      "documentation"
    ]);
    expect(axis(documentationSibling, "documentation")).toMatchObject({ state: "satisfied" });
    expect(documentationSibling?.status).toBe("met");
  });

  it.each([
    {
      name: "repository visibility booleans",
      taskText: [
        "Acceptance criteria:",
        "- Add repositoryVisibilityLabel(true) that returns Private repository.",
        "- Return Public repository when the value is false.",
        "- Add focused automated tests for both boolean paths."
      ].join("\n"),
      sourcePath: "src/repositories/repository-visibility.js",
      testPath: "test/repository-visibility.test.js",
      patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }",
      testPatch: [
        "+ import assert from 'node:assert/strict';",
        "+ import { repositoryVisibilityLabel } from '../src/repositories/repository-visibility.js';",
        "+ test('private repository', () => { assert.equal(repositoryVisibilityLabel(true), 'Private repository'); });",
        "+ test('public repository', () => { assert.equal(repositoryVisibilityLabel(false), 'Public repository'); });"
      ].join("\n"),
      check: "repository visibility tests"
    },
    {
      name: "invoice reference branches",
      taskText: [
        "Acceptance criteria:",
        "- Normalize an invoice reference to uppercase.",
        "- Return UNKNOWN when the reference is empty.",
        "- Add regression tests for both branches."
      ].join("\n"),
      sourcePath: "src/billing/invoice-reference.js",
      testPath: "test/invoice-reference.test.js",
      patch: "+ export const invoiceReference = value => value.trim().toUpperCase() || 'UNKNOWN';",
      testPatch: [
        "+ import assert from 'node:assert/strict';",
        "+ import { invoiceReference } from '../src/billing/invoice-reference.js';",
        "+ test('normal reference', () => { assert.equal(invoiceReference('ab'), 'AB'); });",
        "+ test('empty reference', () => { assert.equal(invoiceReference(''), 'UNKNOWN'); });"
      ].join("\n"),
      check: "invoice reference tests"
    },
    {
      name: "Korean connection states",
      taskText: [
        "수용 기준:",
        "- 만료되지 않은 연결은 Connected를 반환한다.",
        "- 만료된 연결은 Expired를 반환한다.",
        "- 두 상태에 대한 회귀 테스트를 추가한다."
      ].join("\n"),
      sourcePath: "src/connections/connection-label.js",
      testPath: "test/연결-라벨.test.js",
      patch: "+ export const connectionLabel = expired => expired ? 'Expired' : 'Connected';",
      testPatch: [
        "+ import assert from 'node:assert/strict';",
        "+ import { connectionLabel } from '../src/connections/connection-label.js';",
        "+ test('연결 상태', () => { assert.equal(connectionLabel(false), 'Connected'); });",
        "+ test('만료 상태', () => { assert.equal(connectionLabel(true), 'Expired'); });"
      ].join("\n"),
      check: "연결 라벨 회귀 테스트"
    }
  ])("links a referential test-only sibling to $name without adding implementation proof", (fixture) => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: fixture.taskText,
      changedFiles: [
        { path: fixture.sourcePath, status: "modified", patch: fixture.patch },
        { path: fixture.testPath, status: "modified", patch: fixture.testPatch }
      ],
      checks: [{ name: fixture.check, status: "passed", summary: `${fixture.check} passed.` }],
      logs: [{ source: fixture.check, status: "passed", text: `${fixture.check} passed.` }],
      executionSuites: [{
        headSha: "a".repeat(40),
        status: "passed",
        executionSource: fixture.check,
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: [fixture.testPath]
      }]
    }));
    const testFinding = report.requirements.at(-1);

    expect({
      subjects: testFinding?.proofAxes?.map((item) => item.subject),
      targetedTestState: axis(testFinding, "targeted_test")?.state,
      executionState: axis(testFinding, "execution")?.state,
      status: testFinding?.status
    }).toEqual({
      subjects: ["targeted_test", "execution"],
      targetedTestState: "satisfied",
      executionState: "satisfied",
      status: "met"
    });
  });

  it("keeps PR30 behavior and test-only proof contracts deterministic when the planner suggests implementation", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: [
        "## Requirements",
        "- Add repositoryVisibilityLabel(isPrivate) that returns Private repository when isPrivate is true.",
        "- Return Public repository when isPrivate is false.",
        "- Add focused automated tests for both boolean paths.",
        "",
        "## Verification",
        "",
        "- npm test",
        "",
        "## Canary scope",
        "",
        "This is an unmerged private AgentProof code-and-test canary. It changes only the new visibility helper and its focused test."
      ].join("\n"),
      changedFiles: [
        {
          path: "src/repositories/repository-visibility.js",
          status: "added",
          patch: [
            "+export function repositoryVisibilityLabel(isPrivate) {",
            "+  return isPrivate ? \"Private repository\" : \"Public repository\";",
            "+}"
          ].join("\n")
        },
        {
          path: "test/repository-visibility.test.js",
          status: "added",
          patch: [
            "+import test from \"node:test\";",
            "+import assert from \"node:assert/strict\";",
            "+import { repositoryVisibilityLabel } from \"../src/repositories/repository-visibility.js\";",
            "+test(\"labels a private repository\", () => { assert.equal(repositoryVisibilityLabel(true), \"Private repository\"); });",
            "+test(\"labels a public repository\", () => { assert.equal(repositoryVisibilityLabel(false), \"Public repository\"); });"
          ].join("\n")
        }
      ],
      checks: [{ name: "unit-tests", status: "passed" }],
      logs: [{
        source: "GitHub Actions job: unit-tests",
        status: "passed",
        text: "GitHub Actions job unit-tests: passed. Steps: npm test"
      }],
      executionSuites: [{
        headSha: "a".repeat(40),
        status: "passed",
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/repository-visibility.test.js"]
      }]
    }), [
      { disposition: "admit", classification: "requirement", expected_axes: [] },
      { disposition: "admit", classification: "requirement", expected_axes: [] },
      {
        disposition: "admit",
        classification: "requirement",
        expected_axes: [{ subject: "implementation", polarity: "present" }]
      }
    ]);
    const [privateLabel, publicLabel, focusedTests] = report.requirements;

    expect(axis(privateLabel, "implementation")).toMatchObject({ state: "satisfied" });
    expect(axis(publicLabel, "implementation")).toMatchObject({ state: "satisfied" });
    expect(focusedTests?.proofAxes?.map((item) => item.subject)).toEqual(["targeted_test", "execution"]);
    expect(axis(focusedTests, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(focusedTests?.gaps.join(" ")).not.toMatch(/implementation evidence/i);
  });

  it("keeps PR30's PR-description test requirement partial without rejecting its satisfied proof axes", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskSource: undefined,
      taskText: "",
      description: [
        "## Requirements",
        "- Add repositoryVisibilityLabel(isPrivate) that returns Private repository when isPrivate is true.",
        "- Return Public repository when isPrivate is false.",
        "- Add focused automated tests for both boolean paths.",
        "",
        "## Verification",
        "",
        "- npm test",
        "",
        "## Canary scope",
        "",
        "This is an unmerged private AgentProof code-and-test canary. It changes only the new visibility helper and its focused test."
      ].join("\n"),
      changedFiles: [
        {
          path: "src/repositories/repository-visibility.js",
          status: "added",
          patch: "+ export function repositoryVisibilityLabel(isPrivate) { return isPrivate ? 'Private repository' : 'Public repository'; }"
        },
        {
          path: "test/repository-visibility.test.js",
          status: "added",
          patch: [
            "+ import { repositoryVisibilityLabel } from '../src/repositories/repository-visibility.js';",
            "+ test('returns one repository visibility label', () => { expect(repositoryVisibilityLabel(true)).toBe('Private repository'); });"
          ].join("\n")
        }
      ],
      checks: [{ name: "repository visibility tests", status: "passed", summary: "repository visibility tests passed." }],
      logs: [{ source: "repository visibility tests", status: "passed", text: "repository visibility tests passed." }]
    }));

    expect(report.requirements.map((requirement) => requirement.requirementText).join("\n"))
      .toContain("repositoryVisibilityLabel(isPrivate)");
    expect(report.requirements.map((requirement) => requirement.requirementText).join("\n"))
      .not.toMatch(/canary|changes only/i);
    expect(report.requirements.map((requirement) => ({
      status: requirement.status,
      evidenceStatus: requirement.evidenceStatus,
      sourceAuthority: requirement.sourceAuthority
    }))).toEqual([
      { status: "partial", evidenceStatus: "met", sourceAuthority: "pr_description" },
      { status: "partial", evidenceStatus: "met", sourceAuthority: "pr_description" },
      { status: "partial", evidenceStatus: "partial", sourceAuthority: "pr_description" }
    ]);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps an explicit-subject test-only objective independent from implementation proof", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add regression tests for retry queue synchronization.",
      changedFiles: [
        { path: "src/retry-queue.ts", status: "modified", patch: "+ export function retryQueue() {}" },
        {
          path: "test/retry-queue.test.ts",
          status: "modified",
          patch: "+ import { retryQueue } from '../src/retry-queue';\n+ test('retry queue synchronization', () => { retryQueue(); })"
        }
      ],
      checks: [{ name: "retry queue tests", status: "passed", summary: "Retry queue tests passed." }]
    }));
    const finding = report.requirements[0];

    expect(axis(finding, "implementation")).toBeUndefined();
    expect(axis(finding, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(finding, "execution")).toMatchObject({ state: "satisfied" });
  });

  it("keeps combined behavior-and-test wording on all three proof axes", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: retry failed synchronization jobs and add regression tests.",
      changedFiles: [
        { path: "src/retry-queue.ts", status: "modified", patch: "+ export function retryFailedJobs() {}" },
        {
          path: "test/retry-queue.test.ts",
          status: "modified",
          patch: "+ import { retryFailedJobs } from '../src/retry-queue';\n+ test('retry failed jobs', () => { retryFailedJobs(); })"
        }
      ],
      checks: [{ name: "retry queue tests", status: "passed", summary: "Retry failed job tests passed." }]
    }));
    const finding = report.requirements[0];

    expect(axis(finding, "implementation")).toMatchObject({ polarity: "present", state: "satisfied" });
    expect(axis(finding, "targeted_test")).toMatchObject({ polarity: "present", state: "satisfied" });
    expect(axis(finding, "execution")).toMatchObject({ polarity: "present", state: "satisfied" });
    expect(finding?.status).toBe("met");
    expect(finding?.evidenceRefs.length).toBeGreaterThan(0);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps documentation and CI objectives on their own artifact contracts", () => {
    const documentation = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: document retry queue setup.",
      changedFiles: [{ path: "docs/retry-queue.md", status: "added", patch: "+ Retry queue setup" }]
    }));
    const ci = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add a retry queue CI workflow.",
      changedFiles: [{ path: ".github/workflows/retry-queue.yml", status: "added", patch: "+ name: retry queue" }],
      checks: [{ name: "retry queue CI tests", status: "passed", summary: "Retry queue CI tests passed." }]
    }));

    expect(documentation.requirements[0]).toMatchObject({ status: "met" });
    expect(documentation.requirements[0]?.proofAxes).toEqual([
      expect.objectContaining({ subject: "documentation", state: "satisfied" })
    ]);
    expect(ci.requirements[0]).toMatchObject({ status: "met" });
    expect(ci.requirements[0]?.proofAxes).toEqual([
      expect.objectContaining({ subject: "ci_configuration", state: "satisfied" }),
      expect.objectContaining({ subject: "execution", state: "satisfied" })
    ]);
    expect(validateVerificationReport(documentation, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(validateVerificationReport(ci, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not materialize planner-suggested axes in report provenance", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: "Acceptance criteria: document the retry status.",
      changedFiles: []
    }), [{
      disposition: "admit",
      classification: "requirement",
      expected_axes: [{ subject: "visual", polarity: "present" }]
    }]);
    const finding = report.requirements[0];

    expect(finding?.proofAxes?.map((item) => item.subject)).toEqual(["documentation"]);
    expect(finding).toMatchObject({
      classificationBasis: "enhanced_plan"
    });
    expect(finding?.plannerAxisSubjects).toBeUndefined();
    expect(report.proofGraph.nodes[0]).toMatchObject({
      classificationBasis: "enhanced_plan"
    });
  });

  it("does not let planner suggestions alter a parent or child proof contract", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: [
        "Acceptance criteria:",
        "- Add retry handling.",
        "  - Add regression tests for both retry paths."
      ].join("\n"),
      changedFiles: []
    }), [
      {
        disposition: "admit",
        classification: "requirement",
        expected_axes: [{ subject: "documentation", polarity: "present" }]
      },
      {
        disposition: "admit",
        classification: "requirement",
        expected_axes: []
      }
    ]);
    const parent = report.requirements[0];
    const child = report.requirements[1];

    expect(parent?.plannerAxisSubjects).toBeUndefined();
    expect(child?.proofAxes?.map((item) => item.subject)).toEqual([
      "implementation",
      "targeted_test",
      "execution"
    ]);
    expect(child?.plannerAxisSubjects).toBeUndefined();
  });

  it("keeps a test-only negative implementation constraint explicit", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add regression tests for retry queue without changing implementation code.",
      changedFiles: [{
        path: "test/retry-queue.test.ts",
        status: "added",
        patch: "+ test('retry queue', () => {})"
      }],
      checks: [{ name: "retry queue tests", status: "passed", summary: "Retry queue tests passed." }]
    }));
    const finding = report.requirements[0];

    expect(axis(finding, "implementation")).toMatchObject({
      polarity: "absent",
      state: "satisfied"
    });
    expect(axis(finding, "targeted_test")).toMatchObject({ state: "violated" });
    expect(axis(finding, "execution")).toMatchObject({ state: "satisfied" });
    expect(finding?.status).not.toBe("met");
  });

  it("violates a test-only negative implementation constraint when source code changes", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add regression tests for retry queue without changing implementation code.",
      changedFiles: [
        { path: "src/retry-queue.ts", status: "modified", patch: "+ export function retryQueue() {}" },
        { path: "test/retry-queue.test.ts", status: "added", patch: "+ test('retry queue', () => {})" }
      ],
      checks: [{ name: "retry queue tests", status: "passed", summary: "Retry queue tests passed." }]
    }));
    const finding = report.requirements[0];

    expect(axis(finding, "implementation")).toMatchObject({
      polarity: "absent",
      state: "violated"
    });
    expect(finding?.status).not.toBe("met");
  });

  it("does not use an unrelated passing test to satisfy a targeted-test requirement", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add regression tests for retry queue synchronization.",
      changedFiles: [{
        path: "test/customer-export.test.ts",
        status: "added",
        patch: "+ test('exports customers', () => {})"
      }],
      checks: [{ name: "customer export tests", status: "passed", summary: "Customer export tests passed." }]
    }));
    const finding = report.requirements[0];

    expect(axis(finding, "targeted_test")?.state).not.toBe("satisfied");
    expect(axis(finding, "execution")?.state).not.toBe("satisfied");
  });

  it("keeps execution incomplete when the targeted test exists but only an unrelated check passes", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add regression tests for retry queue synchronization.",
      changedFiles: [
        { path: "src/retry-queue.ts", status: "modified", patch: "+ export function retryQueue() {}" },
        {
          path: "test/retry-queue.test.ts",
          status: "added",
          patch: "+ import { retryQueue } from '../src/retry-queue';\n+ test('retry queue synchronization', () => { retryQueue(); })"
        }
      ],
      checks: [{ name: "customer export tests", status: "passed", summary: "Customer export tests passed." }]
    }));
    const finding = report.requirements[0];

    expect(axis(finding, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(finding, "execution")).toMatchObject({ state: "incomplete", evidenceRefs: [] });
    expect(finding?.status).not.toBe("met");
  });

  it("keeps ambiguous referential wording unproven when multiple sibling subjects compete", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: [
        "Acceptance criteria:",
        "- Normalize invoice references.",
        "- Format repository visibility labels.",
        "- Add tests for both paths."
      ].join("\n"),
      changedFiles: [
        { path: "test/invoice-reference.test.js", status: "added", patch: "+ test('invoice paths', () => {})" },
        { path: "test/repository-visibility.test.js", status: "added", patch: "+ test('visibility paths', () => {})" }
      ],
      checks: [{ name: "unit tests", status: "passed", summary: "All unit tests passed." }]
    }));
    const finding = report.requirements.at(-1);

    expect(finding?.proofAxes?.map((item) => item.subject)).toEqual([
      "targeted_test",
      "execution"
    ]);
    expect(axis(finding, "targeted_test")?.state).not.toBe("satisfied");
    expect(axis(finding, "execution")?.state).not.toBe("satisfied");
    expect(finding?.status).not.toBe("met");
  });
});
