import { describe, expect, it } from "vitest";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { selectGeneralPrSemanticClaimSpansV1 } from "./general-pr-semantic-selection";
import type { PullRequestInput } from "./types";

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Show a current service state",
    description: [
      "## Change",
      "- Display a current service state.",
      "- Preserve a readable status message.",
      "<!-- hidden template instruction -->",
      "```ts\nconst sentinel = 'code';\n```",
      "Risk: review before rollout."
    ].join("\n\n"),
    taskSource: "issue",
    taskText: Array.from({ length: 18 }, (_, index) => `- The service must expose requirement ${index + 1}.`).join("\n"),
    changedFiles: [{ path: "src/state.ts", status: "modified" }],
    checks: [{ name: "unit", status: "passed" }],
    logs: [],
    ...overrides
  };
}

function selected(result: ReturnType<typeof selectGeneralPrSemanticClaimSpansV1>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.selection;
}

describe("selectGeneralPrSemanticClaimSpansV1", () => {
  it("bounds twenty legal spans, reserves objective-capable sources, and serializes in seed order", () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const selection = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed }));
    const objectiveSources = seed.sources.filter((source) => source.roleCeiling === "objective").map((source) => source.id);

    expect(seed.spans.length).toBeGreaterThanOrEqual(20);
    expect(selection.selectedSpans).toHaveLength(12);
    expect(objectiveSources.every((sourceId) => selection.selectedSpans.some((span) => span.sourceUnitId === sourceId))).toBe(true);
    expect(selection.selectedSpanIds).toEqual([...selection.selectedSpanIds].sort((left, right) => seed.spans.findIndex((span) => span.id === left) - seed.spans.findIndex((span) => span.id === right)));
    expect(selection.selectedSpanIds).not.toEqual(seed.spans.map((span) => span.id));
    expect(selection.coverage).toBe("sampled");
  });

  it("is byte-identical for repeated input and source-selection invariant to unrelated evidence ordering", () => {
    const request = input({
      changedFiles: [{ path: "src/one.ts", status: "modified" }, { path: "src/two.ts", status: "modified" }],
      checks: [{ name: "one", status: "passed" }, { name: "two", status: "passed" }]
    });
    const seed = buildGeneralPrObservationSeedV2(request);
    const first = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed }));
    const second = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed }));
    const reordered = { ...request, changedFiles: [...request.changedFiles].reverse(), checks: [...request.checks].reverse() };
    const reorderedSelection = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: reordered, seed: buildGeneralPrObservationSeedV2(reordered) }));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(reorderedSelection.selectedSpanIds).toEqual(first.selectedSpanIds);
    expect(reorderedSelection.selectedSpans).toEqual(first.selectedSpans);
  });

  it("omits oversize spans whole and reports unavailable when no complete span fits", () => {
    const request = input({ taskText: "The service must expose ".concat("a".repeat(4_000)) });
    const seed = buildGeneralPrObservationSeedV2(request);
    const bounded = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxInputBytes: 500 }));
    const unavailable = selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxInputBytes: 1 });

    expect(bounded.selectedSpans.some((span) => span.text.includes("a".repeat(100)))).toBe(false);
    expect(bounded.omittedReasonCounts.inputByteBudget).toBeGreaterThan(0);
    expect(unavailable).toEqual({ ok: false, reason: "selection_unavailable" });
  });

  it("rejects stale or forged bindings and does not reserve hidden or code/template spans", () => {
    const request = input();
    const seed = buildGeneralPrObservationSeedV2(request);
    const forged = { ...seed, seedHash: "0".repeat(64) };
    const result = selectGeneralPrSemanticClaimSpansV1({ pullRequest: { ...request, title: "Changed title" }, seed });
    const forgedResult = selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed: forged });
    const selection = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxSpans: 3 }));

    expect(result.ok ? null : result.reason).toMatch(/seed_invalid|source_binding_invalid/);
    expect(forgedResult).toEqual({ ok: false, reason: "seed_invalid" });
    expect(selection.selectedSpans.map((span) => span.deterministicRole)).not.toContain("template_or_process");
  });
});
