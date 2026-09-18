import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { AblationCorpus } from "./requirement-source-ablation";
import { runRequirementRoleExperiment } from "./requirement-role-experiment";
import {
  exportRequirementRoleObjectiveReviewTemplate,
  runRequirementRoleObjectiveExperiment,
  validateRequirementRoleObjectiveReview,
  validateSeparatedObjectiveOutput,
  type RequirementRoleObjectiveProviderRequest,
  type RequirementRoleObjectiveReviewTemplate,
} from "./requirement-role-experiment-objectives";

const profile = { model: "test-model", promptVersion: "objective-separation.v1", inputFieldPolicyVersion: "v0-source-units.v1" };
const body = ["# Goal", "The cache is implemented for this PR.", "", "## Notes", "Background only.", "", "Maybe this is a target."].join("\n");

function corpusWith(labels = false): AblationCorpus {
  return {
    schemaVersion: "requirement_source_ablation.v1",
    labelProvenance: labels ? "existing machine labels that must not seed review" : "unlabeled synthetic fixture",
    cases: [{
      id: "objective-fixture",
      cohort: "controlled",
      input: { title: "Add cache behavior", description: body, taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] },
      labels: labels ? [{ id: "old-label", sourceKind: "pr_title", start: 0, end: 18, text: "Add cache behavior", label: "requirement" }] : [],
    }],
  };
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const judgment = (objectivePresence: "yes" | "no" | "unresolved", semanticRole: "implementation_claim" | "supporting_context" | "mixed_or_ambiguous") => ({ objectivePresence, semanticRole, subspans: [], goalIds: [], contextUnitIds: [] });

function fillAdjudication(template: RequirementRoleObjectiveReviewTemplate) {
  const review = structuredClone(template);
  review.labelProvenance = { kind: "synthetic_fixture", description: "hand-authored test labels", humanIdentityVerified: false };
  for (const item of review.adjudication.cases) {
    item.decisions.forEach((decision, index) => { decision.judgment = index === 0 ? judgment("yes", "implementation_claim") : judgment("no", "supporting_context"); });
  }
  return review;
}

const providerOutput = (request: RequirementRoleObjectiveProviderRequest) => request.arm === "legacy_v0"
  ? { spanRoles: request.packet.input.spans.map((span, index) => ({ spanId: span.id, role: index === 0 ? "objective_candidate" : "supporting_context" })), unionMemberCandidates: [] }
  : { spanDecisions: request.packet.input.spans.map((span, index) => ({ spanId: span.id, semanticRole: index === 0 ? "implementation_claim" : "supporting_context", objectivePresence: index === 0 ? "yes" : "no" })) };

describe("objective/claim separation experiment", () => {
  it("versions the fixed V0 boundary contract and exports empty independent review slots", async () => {
    const unlabeled = await exportRequirementRoleObjectiveReviewTemplate(corpusWith(), { modelProfile: profile });
    const prelabelled = await exportRequirementRoleObjectiveReviewTemplate(corpusWith(true), { modelProfile: profile });
    expect(unlabeled).toMatchObject({
      schemaVersion: "requirement_role_objective_review.v1",
      contract: {
        schemaVersion: "requirement_role_objective_contract.v1",
        targetAxis: ["yes", "no", "unresolved"],
        inputLabelsUsed: false,
        denominatorPolicy: "fixed_v0_selected_source_units",
      },
      annotators: [{ slotId: "annotator_1", humanIdentityVerified: false }, { slotId: "annotator_2", humanIdentityVerified: false }],
      labelProvenance: null,
    });
    expect(unlabeled.contractHash).toMatch(/^[a-f0-9]{64}$/);
    expect(unlabeled.templateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(unlabeled.contractHash).toBe(prelabelled.contractHash);
    expect(unlabeled.templateHash).toBe(prelabelled.templateHash);
    expect(unlabeled.annotators.flatMap(slot => slot.cases.flatMap(item => item.decisions)).every(decision => decision.judgment === null)).toBe(true);
    expect(unlabeled.adjudication.cases.flatMap(item => item.decisions).every(decision => decision.judgment === null)).toBe(true);
    expect(JSON.stringify(unlabeled)).not.toContain("The cache is implemented");
    expect(unlabeled.contract.rubric.objectivePresence.yes).toContain("current PR");
    expect(unlabeled.contract.rubric.independence).toContain("implementation_claim");
  });

  it("validates exact separated decisions and rejects missing, duplicate, stale, unknown, and output authority fields", () => {
    const expected = ["one", "two"];
    const known = new Set(["one", "two", "stale"]);
    const valid = { spanDecisions: [
      { spanId: "one", semanticRole: "implementation_claim", objectivePresence: "yes" },
      { spanId: "two", semanticRole: "supporting_context", objectivePresence: "no" },
    ] };
    expect(validateSeparatedObjectiveOutput(valid, expected, known)).toMatchObject({ valid: true });
    expect(validateSeparatedObjectiveOutput({ spanDecisions: valid.spanDecisions.slice(0, 1) }, expected, known)).toMatchObject({ valid: false, reason: "missing_span_id" });
    expect(validateSeparatedObjectiveOutput({ spanDecisions: [valid.spanDecisions[0], valid.spanDecisions[0]] }, expected, known)).toMatchObject({ valid: false, reason: "duplicate_span_id" });
    expect(validateSeparatedObjectiveOutput({ spanDecisions: [valid.spanDecisions[0], { ...valid.spanDecisions[1], spanId: "stale" }] }, expected, known)).toMatchObject({ valid: false, reason: "stale_span_id" });
    expect(validateSeparatedObjectiveOutput({ spanDecisions: [valid.spanDecisions[0], { ...valid.spanDecisions[1], spanId: "unknown" }] }, expected, known)).toMatchObject({ valid: false, reason: "unknown_span_id" });
    expect(validateSeparatedObjectiveOutput({ spanDecisions: [{ ...valid.spanDecisions[0], authority: "authoritative" }, valid.spanDecisions[1]] }, expected, known)).toMatchObject({ valid: false, reason: "span_decision_invalid" });
  });

  it("round-trips source-bound annotations and reports agreement, disagreement, and unresolved separately", async () => {
    const corpus = corpusWith();
    const review = await exportRequirementRoleObjectiveReviewTemplate(corpus, { modelProfile: profile });
    const firstCase = review.annotators[0]!.cases[0]!;
    expect(firstCase.decisions.length).toBeGreaterThanOrEqual(3);
    for (const slot of review.annotators) {
      const item = slot.cases[0]!;
      item.goalDefinitions.push({ goalId: "goal-1" });
      item.decisions[0]!.judgment = judgment("yes", "implementation_claim");
      item.decisions[0]!.judgment!.goalIds = ["goal-1"];
      item.decisions[0]!.judgment!.contextUnitIds = [item.decisions[1]!.ref.unitId];
      const ref = item.decisions[0]!.ref;
      const source = ref.sourceKind === "pr_title" ? corpus.cases[0]!.input.title : corpus.cases[0]!.input.description;
      const end = Math.min(ref.end, ref.start + 3);
      item.decisions[0]!.judgment!.subspans = [{ sourceUnitId: ref.sourceUnitId, sourceKind: ref.sourceKind, start: ref.start, end, textHash: hash(source.slice(ref.start, end)) }];
      item.decisions[1]!.judgment = judgment(slot.slotId === "annotator_1" ? "no" : "yes", "supporting_context");
      item.decisions[2]!.judgment = judgment("unresolved", "mixed_or_ambiguous");
    }
    const validation = await validateRequirementRoleObjectiveReview(review, corpus, { modelProfile: profile });
    expect(validation).toMatchObject({ valid: true, summary: { agreement: 1, disagreement: 1, unresolved: 1 } });

    const stale = structuredClone(review);
    stale.contractHash = "0".repeat(64);
    expect(await validateRequirementRoleObjectiveReview(stale, corpus, { modelProfile: profile })).toMatchObject({ valid: false, reason: "contract_hash_mismatch" });
    const crossSource = structuredClone(review);
    crossSource.annotators[0]!.cases[0]!.decisions[0]!.ref.sourceUnitId = crossSource.annotators[0]!.cases[0]!.decisions[1]!.ref.sourceUnitId;
    expect(await validateRequirementRoleObjectiveReview(crossSource, corpus, { modelProfile: profile })).toMatchObject({ valid: false, reason: "source_binding_mismatch" });
    const badContext = structuredClone(review);
    badContext.annotators[0]!.cases[0]!.decisions[0]!.judgment!.contextUnitIds = ["unknown-unit"];
    expect(await validateRequirementRoleObjectiveReview(badContext, corpus, { modelProfile: profile })).toMatchObject({ valid: false, reason: "context_link_invalid" });
  });

  it("uses identical V0 units for both arms while allowing a target to coexist with an implementation claim", async () => {
    const corpus = corpusWith();
    const requests: RequirementRoleObjectiveProviderRequest[] = [];
    const baseline = await runRequirementRoleExperiment(corpus, { modelProfile: profile });
    const result = await runRequirementRoleObjectiveExperiment(corpus, {
      modelProfile: profile,
      provider: { observe: async request => { requests.push(structuredClone(request)); return providerOutput(request); } },
    });
    expect(result.actualCallCount).toBe(2);
    expect(result.cases[0]!.registry).toEqual(baseline.cases[0]!.registry);
    const v0Selected = baseline.cases[0]!.versions.V0.ledger.filter(entry => entry.selected).map(entry => entry.unitId);
    expect(result.cases[0]!.arms.legacy_v0.ledger.filter(entry => entry.selected).map(entry => entry.unitId)).toEqual(v0Selected);
    expect(result.cases[0]!.arms.separated_v1.ledger.filter(entry => entry.selected).map(entry => entry.unitId)).toEqual(v0Selected);
    expect(result.cases[0]!.arms.separated_v1.ledger.find(entry => entry.selected)).toMatchObject({ semanticRole: "implementation_claim", objectivePresence: "yes", status: "decided" });
    expect(result.cases[0]!.arms.legacy_v0.ledger.find(entry => entry.selected)).toMatchObject({ semanticRole: "objective_candidate", objectivePresence: "yes" });
    expect(requests[0]!.packet.input).toEqual(requests[1]!.packet.input);
    expect(requests.every(request => !("sourceContext" in request.packet.input))).toBe(true);
    expect(requests.flatMap(request => request.packet.input.spans).every(span => !Object.hasOwn(span, "objectivePresence"))).toBe(true);
    expect(JSON.stringify(result)).not.toContain("The cache is implemented");
  });

  it("scores only compatible adjudication and keeps unavailable metrics explicit", async () => {
    const corpus = corpusWith();
    const review = fillAdjudication(await exportRequirementRoleObjectiveReviewTemplate(corpus, { modelProfile: profile }));
    const evaluated = await runRequirementRoleObjectiveExperiment(corpus, { modelProfile: profile, review, provider: { observe: async request => providerOutput(request) } });
    expect(evaluated.evaluation).toMatchObject({
      status: "evaluated",
      denominatorPolicy: "fixed_v0_selected_source_units",
      labelProvenanceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      labelSetHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      arms: {
        legacy_v0: { target: { denominator: expect.any(Number), accuracy: 1 }, semanticRole: { exactMatch: { accuracy: expect.any(Number) } } },
        separated_v1: { target: { denominator: expect.any(Number), accuracy: 1 }, semanticRole: { exactMatch: { accuracy: 1 } } },
      },
      unavailable: { goalLevelRecall: null, subspanFidelity: null, generalization: null },
    });
    if (evaluated.evaluation.status !== "evaluated" || !evaluated.evaluation.arms) throw new Error("expected evaluated result");
    expect(evaluated.evaluation.arms.separated_v1.target.byCase[0]).toMatchObject({ caseId: "objective-fixture" });
    expect(evaluated.evaluation.arms.separated_v1.semanticRole.macroF1).toMatchObject({ status: "not_evaluated", value: null, reason: "all_11_roles_not_represented" });

    const noLabels = await runRequirementRoleObjectiveExperiment(corpus, { modelProfile: profile, provider: { observe: async request => providerOutput(request) } });
    expect(noLabels.evaluation).toMatchObject({ status: "not_evaluated", reason: "adjudicated_labels_not_supplied", denominator: 0, arms: null });

    const empty: AblationCorpus = { schemaVersion: "requirement_source_ablation.v1", labelProvenance: "empty fixture", cases: [{ id: "empty", cohort: "controlled", input: { title: "", description: "", taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] }, labels: [] }] };
    const emptyReview = fillAdjudication(await exportRequirementRoleObjectiveReviewTemplate(empty, { modelProfile: profile }));
    const emptyResult = await runRequirementRoleObjectiveExperiment(empty, { modelProfile: profile, review: emptyReview, provider: { observe: async () => { throw new Error("must not call"); } } });
    expect(emptyResult).toMatchObject({ actualCallCount: 0, evaluation: { status: "not_evaluated", reason: "empty_denominator", denominator: 0, arms: null } });
  });

  it("runs the dedicated CLI offline, writes no raw text, and refuses clobber", () => {
    const dir = mkdtempSync(join(tmpdir(), "objective-experiment-cli-"));
    const input = join(dir, "input.json");
    const output = join(dir, "output.json");
    writeFileSync(input, JSON.stringify(corpusWith()));
    const cli = resolve("scripts/run-requirement-role-experiment-objectives.mjs");
    const args = [cli, "--input", input, "--output", output, "--model", "test-model"];
    const first = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "MUST_NOT_READ" } });
    expect(first.status, first.stdout + first.stderr).toBe(0);
    const result = JSON.parse(readFileSync(output, "utf8"));
    expect(result).toMatchObject({ schemaVersion: "requirement_role_objective_result.v1", shadowOnly: true, offline: true, actualCallCount: 0, evaluation: { status: "not_evaluated" } });
    expect(JSON.stringify(result)).not.toContain("The cache is implemented");
    const original = readFileSync(output, "utf8");
    expect(spawnSync(process.execPath, args, { encoding: "utf8" }).status).not.toBe(0);
    expect(readFileSync(output, "utf8")).toBe(original);
    expect(existsSync(`${output}.calls.jsonl`)).toBe(false);
  }, 30_000);
});
