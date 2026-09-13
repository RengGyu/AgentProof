import { describe, expect, it } from "vitest";
import { compileOrdinaryDocumentationPlans, evaluateOrdinaryDocumentationPlan, validateOrdinaryDocumentationResult } from "./general-pr-documentation";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { finalizeDeterministicGeneralPrObservationsV2 } from "./general-pr-observation-service";
import type { PullRequestInput } from "./types";

const input: PullRequestInput = {
  title: "Documentation", description: "## Requirements\n- `README.md` must contain `ready now`.\n- `README.md` must include `other text`.", taskText: "",
  changedFiles: [], checks: [], logs: [], repositoryPrivate: false,
  sourceProvenance: { version: 1, origin: "github_snapshot", headSha: "a".repeat(40), baseSha: "b".repeat(40), evidenceCapturedAt: "2026-09-08T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } }
};
function plansFor(value = input) {
  const seed = buildGeneralPrObservationSeedV2(value);
  const bundle = finalizeDeterministicGeneralPrObservationsV2(seed);
  bundle.objectives = seed.spans.filter(span => span.structuralKind === "list_item").map(span => ({ id: span.id, sourceSpanIds: [span.id], authority: "author_claim", admissionBasis: "semantic_proposal", state: "hypothesis" }));
  return compileOrdinaryDocumentationPlans(value, seed, bundle);
}

describe("ordinary documentation source plans", () => {
  it("binds distinct goals sharing an artifact and evaluates only the explicit presence predicate", () => {
    const plans = plansFor();
    expect(plans.map(plan => plan.legacyRequirementId)).toEqual(["req_1", "req_2"]);
    expect(plans).toHaveLength(2);
    expect(plans[0].targetId).not.toBe(plans[1].targetId);
    const blobs = [{ path: "README.md", headSha: input.sourceProvenance!.headSha!, content: "ready now" }];
    expect(plans.map(plan => evaluateOrdinaryDocumentationPlan(plan, blobs).state)).toEqual(["supported", "contradicted"]);
    expect(evaluateOrdinaryDocumentationPlan(plans[0], []).state).toBe("unavailable");
    expect(plansFor({ ...input, checks: [{ name: "unrelated", status: "failed" }] }).map(plan => plan.targetId)).toEqual(plans.map(plan => plan.targetId));
  });
  it("rejects changed operands, target, head, source and cross-target result reuse", () => {
    const plans = plansFor();
    const blobs = [{ path: "README.md", headSha: input.sourceProvenance!.headSha!, content: "ready now" }];
    const result = evaluateOrdinaryDocumentationPlan(plans[0], blobs);
    const context = { input, plans, artifactBlobs: blobs };
    expect(validateOrdinaryDocumentationResult(result, context)).toBe(true);
    for (const patch of [{ targetId: plans[1].targetId }, { headSha: "b".repeat(40) }, { state: "contradicted" }]) expect(validateOrdinaryDocumentationResult({ ...result, ...patch }, context)).toBe(false);
    expect(validateOrdinaryDocumentationResult(result, { ...context, plans: [{ ...plans[0], literal: "invented" }] })).toBe(false);
    expect(validateOrdinaryDocumentationResult(result, { ...context, input: { ...input, description: input.description + " changed" } })).toBe(false);
    expect(validateOrdinaryDocumentationResult(result, { ...context, input: { ...input, url: "https://github.com/other/repo/pull/1" } })).toBe(false);
    expect(validateOrdinaryDocumentationResult(result, { ...context, input: { ...input, requirementSourceIdentityHash: "d".repeat(64) } })).toBe(false);
  });
  it.each(["Add `ready now` to `README.md`.", "`README.md` must not contain `ready now`.", "If deployed, `README.md` must contain `ready now`.", "`README.md` must contain `ready now` and explain deployment."])("does not compile unsupported wording: %s", description => {
    expect(plansFor({ ...input, description: `## Requirements\n- ${description}` })).toEqual([]);
  });
});
