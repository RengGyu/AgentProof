import { describe, expect, it } from "vitest";
import { extractRequirementSpanSeed } from "./extractors";
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
        { path: "test/retry.test.ts", status: "modified", patch: "+ test('both retry paths', () => {})" },
        { path: "docs/retry.md", status: "modified", patch: "+ Retry setup" }
      ],
      checks: [{ name: "retry tests", status: "passed", summary: "Both retry paths passed." }]
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
      testPatch: "+ test('returns both repository visibility labels', () => {})",
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
      testPatch: "+ test('normal and empty invoice references', () => {})",
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
      testPatch: "+ test('연결의 두 상태를 검증한다', () => {})",
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
      logs: [{ source: fixture.check, status: "passed", text: `${fixture.check} passed.` }]
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

  it("keeps an explicit-subject test-only objective independent from implementation proof", () => {
    const report = generateVerificationReport(linkedInput({
      taskText: "Acceptance criteria: add regression tests for retry queue synchronization.",
      changedFiles: [{
        path: "test/retry-queue.test.ts",
        status: "modified",
        patch: "+ test('retry queue synchronization', () => {})"
      }],
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
        { path: "test/retry-queue.test.ts", status: "modified", patch: "+ test('retry failed jobs', () => {})" }
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

  it("records only planner-added axes in planner provenance", () => {
    const report = finalizeAllAuthoritative(linkedInput({
      taskText: "Acceptance criteria: document the retry status.",
      changedFiles: []
    }), [{
      disposition: "admit",
      classification: "requirement",
      expected_axes: [{ subject: "visual", polarity: "present" }]
    }]);
    const finding = report.requirements[0];

    expect(finding?.proofAxes?.map((item) => item.subject)).toEqual([
      "documentation",
      "visual"
    ]);
    expect(finding).toMatchObject({
      classificationBasis: "enhanced_plan",
      plannerAxisSubjects: ["visual"]
    });
    expect(report.proofGraph.nodes[0]).toMatchObject({
      classificationBasis: "enhanced_plan"
    });
  });

  it("does not report a planner axis inherited from a real parent as the child's own addition", () => {
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

    expect(parent?.plannerAxisSubjects).toEqual(["documentation"]);
    expect(child?.proofAxes?.map((item) => item.subject)).toEqual([
      "implementation",
      "documentation",
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
    expect(axis(finding, "targeted_test")).toMatchObject({ state: "satisfied" });
    expect(axis(finding, "execution")).toMatchObject({ state: "satisfied" });
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
      changedFiles: [{
        path: "test/retry-queue.test.ts",
        status: "added",
        patch: "+ test('retry queue synchronization', () => {})"
      }],
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
