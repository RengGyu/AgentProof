import { describe, expect, it } from "vitest";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  isGeneralPrSemanticClaimSpanEligibleV1,
  isGeneralPrSemanticClaimSpanReservableV1,
  selectGeneralPrSemanticClaimSpansV1
} from "./general-pr-semantic-selection";
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
    taskText: ["## Requirements", ...Array.from({ length: 18 }, (_, index) => `- The service must expose requirement ${index + 1}.`)].join("\n"),
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
    const selection = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxInputBytes: 2_000 }));

    expect(seed.spans.length).toBeGreaterThanOrEqual(20);
    expect(selection.selectedSpans.length).toBeLessThanOrEqual(12);
    expect(selection.selectedSpanIds).toEqual(expect.arrayContaining(["gpsp_1_2", "gpsp_2_1", "gpsp_3_2"]));
    expect(Buffer.byteLength(JSON.stringify(selection), "utf8")).toBeLessThanOrEqual(2_000);
    expect(selection.selectedSpanIds).toEqual([...selection.selectedSpanIds].sort((left, right) => seed.spans.findIndex((span) => span.id === left) - seed.spans.findIndex((span) => span.id === right)));
    expect(selection.selectedSpanIds).not.toEqual(seed.spans.map((span) => span.id));
    expect(selection.coverage).toBe("sampled");
  });

  it("reserves the ranked list item while serializing a preceding heading first", () => {
    const request = input({ taskText: "## Requirements\n- The service must expose a current state." });
    const seed = buildGeneralPrObservationSeedV2(request);
    const selection = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxSpans: 4 }));

    expect(selection.selectedSpanIds).toEqual(expect.arrayContaining(["gpsp_1_2", "gpsp_2_1", "gpsp_3_2"]));
    expect(selection.selectedSpanIds.indexOf("gpsp_1_1")).toBeLessThan(selection.selectedSpanIds.indexOf("gpsp_1_2"));
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
    const bounded = selected(selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed, maxInputBytes: 1_500 }));
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
    expect(selection.selectedSpans.map((span) => span.structuralKind)).not.toEqual(expect.arrayContaining(["code", "html"]));
  });

  it("excludes code, HTML, and policy-only spans at the pure eligibility boundary", () => {
    const seed = buildGeneralPrObservationSeedV2(input());
    const source = seed.sources[0]!;
    const span = seed.spans[0]!;

    expect(isGeneralPrSemanticClaimSpanEligibleV1(source, { ...span, structuralKind: "code" })).toBe(false);
    expect(isGeneralPrSemanticClaimSpanEligibleV1(source, { ...span, structuralKind: "html" })).toBe(false);
    expect(isGeneralPrSemanticClaimSpanEligibleV1({ ...source, roleCeiling: "policy_only" }, span)).toBe(false);
    expect(isGeneralPrSemanticClaimSpanReservableV1(source, { ...span, deterministicRole: "template_or_process" })).toBe(false);
  });

  it("returns unavailable when every canonical source span is excluded", () => {
    const request = input({ title: "", taskText: "", description: "<!-- hidden -->\n\n```ts\nconst state = 'private';\n```" });
    const result = selectGeneralPrSemanticClaimSpansV1({ pullRequest: request, seed: buildGeneralPrObservationSeedV2(request) });

    expect(result).toEqual({ ok: false, reason: "selection_unavailable" });
  });
});
