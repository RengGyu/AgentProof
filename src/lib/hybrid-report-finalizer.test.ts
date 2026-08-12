import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractRequirementSpanSeed } from "./extractors";
import {
  bindHybridPlannerSeedHash,
  buildHybridPlannerPlan,
  validateHybridPlannerPlan,
  type HybridPlannerSemanticDecision
} from "./hybrid-planner";
import {
  HYBRID_OVERFLOW_LIMITATION,
  HYBRID_PLAN_FALLBACK_LIMITATION,
  finalizeHybridVerificationReport,
  generateHybridFallbackReport
} from "./hybrid-report-finalizer";
import { validateVerificationReport } from "./report-validation";
import type { PullRequestInput, RequirementSpanSeed, SourceProvenance } from "./types";
import { generateVerificationReport } from "./verifier";

const provenance: SourceProvenance = {
  version: 1,
  origin: "github_snapshot",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
  evidenceCapturedAt: "2026-08-12T00:00:00.000Z",
  inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
};
const SOURCE_IDENTITY_HASH = "d".repeat(64);

const input: PullRequestInput = {
  title: "Retry report",
  description: "Adds retry behavior and reports the test result.",
  taskText: "Add retry handling.",
  taskSource: "issue",
  requirementSourceIdentityHash: SOURCE_IDENTITY_HASH,
  changedFiles: [
    { path: "src/retry.ts", status: "modified", patch: "+ export function retryRequest() {}" },
    { path: "src/retry.test.ts", status: "modified", patch: "+ test('retry request', () => {})" }
  ],
  checks: [{ name: "retry tests", status: "passed", summary: "Retry request tests passed." }],
  logs: [{ source: "retry tests", status: "passed", text: "npm test retry: passed" }],
  sourceProvenance: provenance
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function unboundSeed(overrides: Partial<RequirementSpanSeed> = {}): RequirementSpanSeed {
  return {
    version: 1,
    analysisContext: "linked_issue",
    spans: [
      { id: "sp_1_1", groupId: "grp_1", ordinal: 1, immediateParentSpanId: null, source: "issue", authority: "authoritative", sourceQuality: "explicit_acceptance_criteria", sourceSection: "acceptance_criteria", start: 0, end: 19, text: "Add retry handling.", priority: "must" }
    ],
    contexts: [],
    seedHash: "",
    ...overrides
  };
}

function boundSeed(overrides: Partial<RequirementSpanSeed> = {}): RequirementSpanSeed {
  const result = bindHybridPlannerSeedHash(unboundSeed(overrides), provenance, SOURCE_IDENTITY_HASH);
  if (!result) throw new Error("fixture seed must bind");
  return result;
}

function extractedBoundSeed(currentInput: PullRequestInput, currentProvenance: SourceProvenance = provenance): RequirementSpanSeed {
  const extracted = extractRequirementSpanSeed(currentInput.taskText, currentInput.description, currentInput.taskSource);
  if (!extracted.seed) throw new Error("fixture input must produce a seed");
  const result = bindHybridPlannerSeedHash(
    extracted.seed,
    currentProvenance,
    currentInput.requirementSourceIdentityHash
  );
  if (!result) throw new Error("fixture extracted seed must bind");
  return result;
}

function validation(seed: RequirementSpanSeed, decisions: readonly HybridPlannerSemanticDecision[]) {
  const plan = buildHybridPlannerPlan(seed, provenance, decisions, SOURCE_IDENTITY_HASH);
  if (!plan) throw new Error("fixture plan must validate");
  return validateHybridPlannerPlan(plan, seed, provenance, SOURCE_IDENTITY_HASH);
}

describe("hybrid report fallback matrix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.123456);
  });

  it("keeps disabled, ineligible, consent-absent, and no-span output exactly BASE", () => {
    const base = generateVerificationReport(input);
    for (const reason of ["disabled", "ineligible", "consent_absent", "no_spans"] as const) {
      expect(generateHybridFallbackReport(input, reason)).toEqual(base);
    }
  });

  it("adds only the one allowlisted limitation for overflow or post-call failure", () => {
    const base = generateVerificationReport(input);
    expect(generateHybridFallbackReport(input, "overflow")).toEqual({
      ...base,
      limitations: [...base.limitations, HYBRID_OVERFLOW_LIMITATION]
    });
    expect(generateHybridFallbackReport(input, "post_call_failure")).toEqual({
      ...base,
      limitations: [...base.limitations, HYBRID_PLAN_FALLBACK_LIMITATION]
    });
  });

  it("routes invalid and stale validation through exact post-call BASE fallback without partial decisions", () => {
    const seed = boundSeed();
    const valid = validation(seed, [{ disposition: "admit", classification: "requirement", expected_axes: [{ subject: "documentation", polarity: "present" }] }]);
    if (!valid.valid) throw new Error("fixture validation must pass");
    for (const forbidden of [
      { status: "met" },
      { gaps: ["model gap"] },
      { evidence_refs: ["ev_model"] },
      { priority: "blocker" },
      { confidence: 1 },
      { narrative: "model explanation" }
    ]) {
      const malformed = { ...valid.plan, span_decisions: { ...valid.plan.span_decisions, d_0: { ...valid.plan.span_decisions.d_0!, ...forbidden } } };
      const invalid = validateHybridPlannerPlan(malformed, seed, provenance);
      expect(finalizeHybridVerificationReport({ input, seed, provenance, planValidation: invalid })).toEqual({
        disposition: "fallback",
        reason: "invalid_plan",
        report: generateHybridFallbackReport(input, "post_call_failure")
      });
    }
    const staleSeed = { ...seed, spans: [{ ...seed.spans[0]!, text: "Changed after validation", end: 24 }] };

    expect(finalizeHybridVerificationReport({ input, seed: staleSeed, provenance, planValidation: valid }).report)
      .toEqual(generateHybridFallbackReport(input, "post_call_failure"));
  });

  it("rejects same-head authoritative text, source, and context changes against the current Task 1 seed", () => {
    const originalInput = { ...input };
    const seed = extractedBoundSeed(originalInput);
    const valid = validation(seed, seed.spans.map(() => ({ disposition: "admit", classification: "requirement", expected_axes: [] })));
    const changedInputs: PullRequestInput[] = [
      { ...originalInput, taskText: "Document an unrelated release note." },
      { ...originalInput, taskSource: "task" },
      { ...originalInput, taskText: "Add retry handling.\n\nBackground: preserve audit visibility." }
    ];

    for (const changedInput of changedInputs) {
      expect(finalizeHybridVerificationReport({ input: changedInput, seed, provenance, planValidation: valid })).toEqual({
        disposition: "fallback",
        reason: "invalid_plan",
        report: generateHybridFallbackReport(changedInput, "post_call_failure")
      });
    }

    const providedInput: PullRequestInput = { ...originalInput, taskSource: "task" };
    const providedSeed = extractedBoundSeed(providedInput);
    const providedPlan = validation(providedSeed, providedSeed.spans.map(() => ({ disposition: "admit", classification: "requirement", expected_axes: [] })));
    const changedProvidedInput = { ...providedInput, taskText: "Document an unrelated release note." };
    expect(finalizeHybridVerificationReport({ input: changedProvidedInput, seed: providedSeed, provenance, planValidation: providedPlan })).toEqual({
      disposition: "fallback",
      reason: "invalid_plan",
      report: generateHybridFallbackReport(changedProvidedInput, "post_call_failure")
    });
  });

  it("rejects same-head unlinked PR description edits", () => {
    const originalInput: PullRequestInput = { ...input, taskText: "", taskSource: undefined, description: "Add retry handling." };
    const seed = extractedBoundSeed(originalInput);
    const valid = validation(seed, seed.spans.map(() => ({ disposition: "admit", classification: "requirement", expected_axes: [] })));
    const changedInput = { ...originalInput, description: "Document an unrelated release note." };

    expect(finalizeHybridVerificationReport({ input: changedInput, seed, provenance, planValidation: valid })).toEqual({
      disposition: "fallback",
      reason: "invalid_plan",
      report: generateHybridFallbackReport(changedInput, "post_call_failure")
    });
  });

  it("revalidates the transient selected-authority identity before materialization", () => {
    const issueOneIdentityHash = "1".repeat(64);
    const issueTwoIdentityHash = "2".repeat(64);
    const originalInput = { ...input, requirementSourceIdentityHash: issueOneIdentityHash };
    const extracted = extractRequirementSpanSeed(
      originalInput.taskText,
      originalInput.description,
      originalInput.taskSource
    );
    if (!extracted.seed) throw new Error("fixture input must produce a seed");
    const seed = bindHybridPlannerSeedHash(extracted.seed, provenance, issueOneIdentityHash)!;
    const plan = buildHybridPlannerPlan(seed, provenance, seed.spans.map(() => ({
      disposition: "admit" as const,
      classification: "requirement" as const,
      expected_axes: []
    })), issueOneIdentityHash)!;
    const valid = validateHybridPlannerPlan(plan, seed, provenance, issueOneIdentityHash);

    expect(finalizeHybridVerificationReport({
      input: originalInput,
      seed,
      provenance,
      requirementSourceIdentityHash: issueOneIdentityHash,
      planValidation: valid
    }).disposition).toBe("hybrid");

    const relinkedInput = { ...originalInput, requirementSourceIdentityHash: issueTwoIdentityHash };
    expect(finalizeHybridVerificationReport({
      input: relinkedInput,
      seed,
      provenance,
      requirementSourceIdentityHash: issueOneIdentityHash,
      planValidation: valid
    })).toEqual({
      disposition: "fallback",
      reason: "invalid_plan",
      report: generateHybridFallbackReport(relinkedInput, "post_call_failure")
    });

    const {
      requirementSourceIdentityHash: _identity,
      ...missingIdentityInput
    } = originalInput;
    expect(finalizeHybridVerificationReport({
      input: missingIdentityInput,
      seed,
      provenance,
      planValidation: valid
    })).toEqual({
      disposition: "fallback",
      reason: "invalid_plan",
      report: generateHybridFallbackReport(missingIdentityInput, "post_call_failure")
    });
  });

  it.each([
    { label: "origin", change: { origin: "pasted_evidence" as const } },
    { label: "head", change: { headSha: "d".repeat(40) } },
    { label: "base", change: { baseSha: "e".repeat(40) } }
  ])("rejects args provenance that differs from current input provenance: $label", ({ change }) => {
    const seed = extractedBoundSeed(input);
    const valid = validation(seed, seed.spans.map(() => ({ disposition: "admit", classification: "requirement", expected_axes: [] })));
    const changedProvenance = { ...provenance, ...change };
    const changedInput = { ...input, sourceProvenance: changedProvenance };

    expect(finalizeHybridVerificationReport({ input: changedInput, seed, provenance, planValidation: valid })).toEqual({
      disposition: "fallback",
      reason: "invalid_plan",
      report: generateHybridFallbackReport(changedInput, "post_call_failure")
    });
  });
});

describe("valid hybrid finalization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.123456);
  });

  it.each(["requirement", "not_requirement", "mixed_or_uncertain"] as const)(
    "always materializes exact authoritative span text for %s planning metadata",
    (classification) => {
      const seed = extractedBoundSeed(input);
      const result = finalizeHybridVerificationReport({
        input,
        seed,
        provenance,
        planValidation: validation(seed, [{ disposition: "admit", classification, expected_axes: [] }])
      });

      expect(result.disposition).toBe("hybrid");
      expect(result.report.requirements.map((item) => item.requirementText)).toEqual([seed.spans[0]!.text]);
      expect(result.report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
        expect.objectContaining({ subject: "implementation", polarity: "present" }),
        expect.objectContaining({ subject: "execution", polarity: "present" })
      ]));
      expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
    }
  );

  it("keeps authoritative vague/manual status unclear using deterministic rules only", () => {
    const vagueText = "Improve reliability.";
    const vagueInput: PullRequestInput = {
      ...input,
      taskText: vagueText,
      changedFiles: [{ path: "src/reliability.ts", status: "modified", patch: "+ export function improveReliability() {}" }],
      checks: [{ name: "reliability tests", status: "passed", summary: "Reliability tests passed." }],
      logs: [{ source: "reliability tests", status: "passed", text: "npm test reliability: passed" }]
    };
    const seed = extractedBoundSeed(vagueInput);
    const result = finalizeHybridVerificationReport({
      input: vagueInput, seed, provenance,
      planValidation: validation(seed, [{ disposition: "admit", classification: "requirement", expected_axes: [] }])
    });

    expect(result.report.requirements[0]?.status).toBe("unclear");
    expect(result.report.requirements[0]?.gaps.join(" ")).toContain("human interpretation");
    expect(result.report.requirements[0]?.proofAxes?.every((axis) => axis.state === "satisfied")).toBe(false);
    expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("materializes admitted PR requirements at exact text and caps them below met", () => {
    const prInput: PullRequestInput = { ...input, taskText: "", taskSource: undefined };
    const seed = extractedBoundSeed(prInput);
    const result = finalizeHybridVerificationReport({
      input: prInput, seed, provenance,
      planValidation: validation(seed, [{ disposition: "admit", classification: "requirement", expected_axes: [] }])
    });

    expect(result.report.requirements[0]?.requirementText).toBe(seed.spans[0]!.text);
    expect(result.report.requirements[0]?.status).not.toBe("met");
    expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it.each(["not_requirement", "mixed_or_uncertain"] as const)("omits excluded PR %s once with one bounded limitation", (classification) => {
    const prInput: PullRequestInput = { ...input, taskText: "", taskSource: undefined };
    const seed = extractedBoundSeed(prInput);
    const result = finalizeHybridVerificationReport({
      input: prInput, seed, provenance,
      planValidation: validation(seed, [{ disposition: "exclude", classification, expected_axes: [] }])
    });

    expect(result.report.requirements).toEqual([]);
    expect(result.report.limitations.filter((item) => /objective candidate/i.test(item))).toHaveLength(1);
    expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("keeps the deterministic floor when the planner suggests an extra axis", () => {
    const seed = extractedBoundSeed(input);
    const result = finalizeHybridVerificationReport({
      input, seed, provenance,
      planValidation: validation(seed, [{ disposition: "admit", classification: "requirement", expected_axes: [{ subject: "documentation", polarity: "present" }] }])
    });
    const axes = result.report.requirements[0]?.proofAxes ?? [];

    expect(axes.map((axis) => `${axis.subject}:${axis.polarity}`)).toEqual([
      "implementation:present", "execution:present"
    ]);
    expect(axes.some((axis) => axis.subject === "documentation")).toBe(false);
    expect(result.report.requirements[0]?.gaps.join(" ")).not.toContain("documentation artifact");
    expect(result.report.planner).toMatchObject({ inputHash: seed.seedHash, version: 1 });
    expect(result.report.requirements[0]).toMatchObject({ classificationBasis: "enhanced_plan" });
    expect(result.report.requirements[0]?.plannerAxisSubjects).toBeUndefined();
    expect(result.report.proofGraph.nodes[0]).toMatchObject({ classificationBasis: "enhanced_plan" });
    expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not add a targeted-test axis solely from a planner suggestion", () => {
    const text = "Document retry behavior.";
    const documentInput: PullRequestInput = { ...input, taskText: text, changedFiles: [], checks: [], logs: [] };
    const seed = extractedBoundSeed(documentInput);
    const result = finalizeHybridVerificationReport({
      input: documentInput, seed, provenance,
      planValidation: validation(seed, [{
        disposition: "admit",
        classification: "requirement",
        expected_axes: [{ subject: "targeted_test", polarity: "present" }]
      }])
    });
    const subjects = result.report.requirements[0]?.proofAxes?.map((axis) => axis.subject);

    expect(subjects).toEqual(["documentation"]);
    expect(result.report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("missing_targeted_test");
    expect(result.report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("visual_proof_missing");
    expect(result.report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind)).not.toContain("interaction_proof_missing");
    expect(validateVerificationReport(result.report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not let a planner implementation suggestion change a test-only proof contract", () => {
    const testOnlyInput: PullRequestInput = {
      ...input,
      taskText: "Add focused automated tests for both boolean paths.",
      changedFiles: [{
        path: "test/repository-visibility.test.js",
        status: "added",
        patch: "+ test('both boolean paths', () => {})"
      }],
      checks: [],
      logs: []
    };
    const seed = extractedBoundSeed(testOnlyInput);
    const result = finalizeHybridVerificationReport({
      input: testOnlyInput,
      seed,
      provenance,
      planValidation: validation(seed, [{
        disposition: "admit",
        classification: "requirement",
        expected_axes: [{ subject: "implementation", polarity: "present" }]
      }])
    });
    const finding = result.report.requirements[0];

    expect(finding?.proofAxes?.map((axis) => axis.subject)).toEqual([
      "targeted_test",
      "execution"
    ]);
    expect(result.report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
      .not.toContain("missing_implementation");
  });

  it("does not inherit planner-only axes through an admitted parent", () => {
    const parentInput: PullRequestInput = {
      ...input,
      taskText: "Acceptance criteria:\n- Add retry documentation.\n  - Show retry status in the UI.\n    - Add retry handling."
    };
    const seed = extractedBoundSeed(parentInput);
    expect(seed.spans).toHaveLength(3);
    const result = finalizeHybridVerificationReport({
      input: parentInput, seed, provenance,
      planValidation: validation(seed, [
        { disposition: "admit", classification: "requirement", expected_axes: [] },
        { disposition: "admit", classification: "requirement", expected_axes: [{ subject: "visual", polarity: "present" }] },
        { disposition: "admit", classification: "requirement", expected_axes: [] }
      ])
    });

    expect(result.report.requirements[1]?.proofAxes?.some((axis) => axis.subject === "documentation")).toBe(true);
    expect(result.report.requirements[2]?.proofAxes?.some((axis) => axis.subject === "visual")).toBe(false);
    expect(result.report.requirements[2]?.proofAxes?.some((axis) => axis.subject === "documentation")).toBe(false);
  });

  it("blocks inheritance when the exact intervening PR parent is excluded", () => {
    const prInput: PullRequestInput = {
      ...input,
      taskText: "",
      taskSource: undefined,
      description: "Document retries. Document retries. Add retry handling."
    };
    const seed = extractedBoundSeed(prInput);
    expect(seed.spans).toHaveLength(3);
    const result = finalizeHybridVerificationReport({
      input: prInput, seed, provenance,
      planValidation: validation(seed, [
        { disposition: "admit", classification: "requirement", expected_axes: [] },
        { disposition: "exclude", classification: "mixed_or_uncertain", expected_axes: [] },
        { disposition: "admit", classification: "requirement", expected_axes: [] }
      ])
    });

    expect(result.report.requirements).toHaveLength(2);
    expect(result.report.requirements[1]?.proofAxes?.some((axis) => axis.subject === "documentation")).toBe(false);
  });

  it.each([
    ["Add retry handling.", { subject: "implementation", polarity: "absent" }],
    ["Do not change implementation code.", { subject: "implementation", polarity: "present" }]
  ] as const)("ignores a planner polarity conflict for %s", (text, axis) => {
    const conflictInput = { ...input, taskText: text };
    const seed = extractedBoundSeed(conflictInput);
    const result = finalizeHybridVerificationReport({
      input: conflictInput, seed, provenance,
      planValidation: validation(seed, [{ disposition: "admit", classification: "requirement", expected_axes: [axis] }])
    });

    expect(result.disposition).toBe("hybrid");
    expect(result.report.requirements[0]?.proofAxes?.some((item) =>
      item.subject === axis.subject && item.polarity === axis.polarity
    )).toBe(false);
  });
});
