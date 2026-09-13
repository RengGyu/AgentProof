import { describe, expect, it } from "vitest";
import { prepareAblationCase, runSourceAblation, scoreSourceLabels, validateAblationCorpus, type AblationCorpus } from "./requirement-source-ablation";
import { runGeneralPrSemanticObserverV2 } from "../src/lib/general-pr-semantic-observer";

const profile = { model: "test-model", promptVersion: "frozen", inputFieldPolicyVersion: "frozen" };
const body = "## Expected behavior\nThe server must preserve query parameters.\n\n## Background\nThe old server dropped them.";
const corpus: AblationCorpus = {
  schemaVersion: "requirement_source_ablation.v1", labelProvenance: "human-frozen-before-run",
  cases: [{ id: "controlled-1", cohort: "controlled", input: { title: "Query handling", description: body, taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] }, labels: [
    { id: "req", sourceKind: "pr_body", start: 21, end: 63, text: "The server must preserve query parameters.", label: "requirement" }
  ] }]
};

function responseFor(bodyText: string, role = "supporting_context") {
  const wire = JSON.parse(bodyText);
  const input = JSON.parse(wire.input[1].content[0].text);
  return Response.json({ model: "test-model", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ spanRoles: input.spans.map((span: { id: string; deterministicRole: string }) => ({ spanId: span.id, role: span.deterministicRole === "template_or_process" ? "template_or_process" : role })), unionMemberCandidates: [] }) }] }] });
}

describe("source-only controlled ablation", () => {
  it("adds whitespace-insensitive coverage without forgiving missing content or double counting overlaps", () => {
    const label = { id: "r", sourceKind: "pr_body" as const, start: 0, end: 8, text: "One\n\nOK!", label: "requirement" as const };
    const spans = [{ id: "one", sourceKind: "pr_body" as const, start: 0, end: 3, role: "objective_candidate" as const }, { id: "two", sourceKind: "pr_body" as const, start: 5, end: 8, role: "objective_candidate" as const }];
    const scored = scoreSourceLabels([label], [...spans, spans[0]!], "valid");
    expect(scored.rows[0]!.prediction).toBe("partial");
    expect(scored.rows[0]!.selectedCharacters).toBe(6);
    expect(scored.rows[0]!.contentCoverage).toEqual({ labelCharacters: 6, selectedCharacters: 6, objectiveCharacters: 6, ambiguousCharacters: 0, selectedFraction: 1, selectionState: "full", prediction: "requirement" });
    expect(scored.metrics.preservedRequirement.numerator).toBe(0);
    expect(scored.contentMetrics.preservedRequirement.numerator).toBe(1);
    for (const end of [6, 7]) expect(scoreSourceLabels([label], [spans[0]!, { ...spans[1]!, end }], "valid").rows[0]!.contentCoverage.prediction).toBe("partial");
  });

  it("keeps empty labels and failed arms in operational content denominators", () => {
    const labels = [{ id: "blank", sourceKind: "pr_body" as const, start: 0, end: 2, text: " \n", label: "requirement" as const }];
    const spans = [{ id: "s", sourceKind: "pr_body" as const, start: 0, end: 2, role: "objective_candidate" as const }];
    const scored = scoreSourceLabels(labels, spans, "valid");
    expect(scored.rows[0]!.contentCoverage).toMatchObject({ labelCharacters: 0, selectedFraction: null, selectionState: "empty", prediction: "not_evaluable" });
    expect(scored.contentMetrics.notEvaluable).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(scored.contentMetrics.missedRequirement.numerator).toBe(1);
    for (const state of ["invalid", "unavailable", "not_run"] as const) {
      const failed = scoreSourceLabels(labels, [], state, spans);
      expect(failed.rows[0]!.contentCoverage.prediction).toBe(state);
      expect(failed.contentMetrics.missedRequirement.denominator).toBe(1);
      expect(failed.rows).toHaveLength(1);
    }
  });

  it("rejects mislabeled offsets, duplicate IDs, overlap and unstable source coordinates", () => {
    expect(() => validateAblationCorpus(corpus)).not.toThrow();
    for (const mutate of [
      (c: AblationCorpus) => { c.cases[0]!.labels[0]!.end--; },
      (c: AblationCorpus) => { c.cases[0]!.labels.push({ ...c.cases[0]!.labels[0]!, id: "another" }); },
      (c: AblationCorpus) => { c.cases.push(c.cases[0]!); },
      (c: AblationCorpus) => { c.cases[0]!.input.title = "CR\r\nLF"; },
      (c: AblationCorpus) => { c.cases[0]!.input.title = "Token sk-123456789"; }
    ]) {
      const changed = structuredClone(corpus); mutate(changed);
      expect(() => validateAblationCorpus(changed)).toThrow(/corpus/);
    }
  });

  it("captures actual Stage A only, retaining identical candidates/settings/schema in C", async () => {
    const prepared = await prepareAblationCase(corpus.cases[0]!, profile);
    expect(prepared.baseline).not.toBeNull();
    const captures: unknown[] = [];
    await runGeneralPrSemanticObserverV2({ mode: "shadow", input: corpus.cases[0]!.input, seed: prepared.seed, providerAvailable: true, privateRepository: false, readCurrentInput: async () => corpus.cases[0]!.input, modelProfile: profile, clock: () => 0, provider: { observe: async request => { captures.push(request); return null; } } });
    expect(captures).toEqual([prepared.baseline]);
    expect(prepared.contextual!.input.spans).toEqual(prepared.baseline!.input.spans);
    expect(prepared.contextual!.request).toEqual(prepared.baseline!.request);
    expect(prepared.contextual!.system.startsWith(prepared.baseline!.system)).toBe(true);
    expect(JSON.stringify(prepared.contextual)).not.toContain("human-frozen");
    const context = prepared.contextual!.input.sourceContext;
    expect(context.some(entry => entry.headingChain.some(ref => ref.text === "## Expected behavior"))).toBe(true);
    for (const entry of context) for (const ref of [...entry.headingChain, ...entry.adjacent, ...(entry.title ? [entry.title] : [])]) {
      const original = ref.sourceKind === "pr_title" ? "Query handling" : body;
      expect(original.slice(ref.start, ref.end)).toBe(ref.text);
      expect(ref.authority).toBe("author_claim");
    }
  });

  it("retains partial/omitted/ambiguous labels and separates unlabeled selection from noise", () => {
    const labels = [
      { id: "r", sourceKind: "pr_body" as const, start: 0, end: 10, text: "0123456789", label: "requirement" as const },
      { id: "n", sourceKind: "pr_body" as const, start: 10, end: 20, text: "0123456789", label: "non_requirement" as const },
      { id: "a", sourceKind: "pr_body" as const, start: 20, end: 30, text: "0123456789", label: "ambiguous" as const },
      { id: "o", sourceKind: "pr_body" as const, start: 30, end: 40, text: "0123456789", label: "requirement" as const }
    ];
    const scored = scoreSourceLabels(labels, [
      { id: "tiny", sourceKind: "pr_body", start: 0, end: 1, role: "objective_candidate" },
      { id: "false", sourceKind: "pr_body", start: 10, end: 20, role: "objective_candidate" },
      { id: "abstain", sourceKind: "pr_body", start: 20, end: 30, role: "mixed_or_ambiguous" },
      { id: "extra", sourceKind: "pr_body", start: 40, end: 45, role: "objective_candidate" }
    ], "valid");
    expect(scored.rows.map(row => row.prediction)).toEqual(["partial", "requirement", "ambiguous", "omitted"]);
    expect(scored.metrics.missedRequirement).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(scored.metrics.falsePositive).toEqual({ numerator: 1, denominator: 1, rate: 1 });
    expect(scored.metrics.abstention).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
    expect(scored.unlabeledSelectedCharacters).toBe(5);
    expect(scoreSourceLabels(labels, [], "invalid").rows).toHaveLength(4);
    expect(scoreSourceLabels(labels, [], "invalid").metrics.missedRequirement.denominator).toBe(2);
  });

  it("defaults to no live requests and never emits raw sources or changes input", async () => {
    const original = JSON.stringify(corpus);
    const result = await runSourceAblation(corpus, { modelProfile: profile, fetchFn: async () => { throw new Error("MUST_NOT_CALL"); } });
    expect(result.actualRequestCount).toBe(0);
    expect(result.cases[0]!.arms.B.state).toBe("not_run");
    expect(result.cases[0]!.arms.B.rows[0]!.selectionState).toBe("full");
    expect(result.cases[0]!.arms.C.state).toBe("not_run");
    expect(JSON.stringify(result)).not.toContain("The server");
    expect(JSON.stringify(corpus)).toBe(original);
  });

  it("requires explicit live acknowledgement/key and rejects excessive budget before transport", async () => {
    const transport: typeof fetch = async () => { throw new Error("MUST_NOT_CALL"); };
    await expect(runSourceAblation(corpus, { modelProfile: profile, live: true, fetchFn: transport })).rejects.toThrow(/acknowledgement/);
    const many = { ...corpus, cases: Array.from({ length: 16 }, (_, i) => ({ ...corpus.cases[0]!, id: `case-${i}` })) };
    await expect(runSourceAblation(many, { modelProfile: profile, live: true, acknowledgement: true, apiKey: "test-only", fetchFn: transport })).rejects.toThrow(/budget/);
  });

  it("uses actual adapter transport, bounded metadata and validator for missing/unknown IDs", async () => {
    for (const output of [{ spanRoles: [], unionMemberCandidates: [] }, { spanRoles: [{ spanId: "unknown", role: "supporting_context" }], unionMemberCandidates: [] }]) {
      const result = await runSourceAblation(corpus, { modelProfile: profile, live: true, acknowledgement: true, apiKey: "test-only", fetchFn: async () => Response.json({ model: "test-model", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] }) });
      expect(result.actualRequestCount).toBe(2);
      expect(result.cases[0]!.arms.B.state).toBe("invalid");
      expect(result.cases[0]!.arms.B.rows).toHaveLength(1);
    }
    const wireBodies: string[] = [];
    const result = await runSourceAblation(corpus, { modelProfile: profile, live: true, acknowledgement: true, apiKey: "test-only", fetchFn: async (_, init) => { wireBodies.push(String(init!.body)); return responseFor(String(init!.body)); } });
    expect(wireBodies).toHaveLength(2);
    expect(wireBodies.join("")).not.toContain("human-frozen");
    expect(result.cases[0]!.arms.B.state).toBe("valid");
    expect(result.cases[0]!.arms.B.telemetry.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(JSON.stringify(result)).not.toContain("test-only");
  });

  it("records unavailable failures without retries or provider error bodies", async () => {
    const result = await runSourceAblation(corpus, { modelProfile: profile, live: true, acknowledgement: true, apiKey: "test-only", fetchFn: async () => new Response("PRIVATE_PROVIDER_ERROR", { status: 429 }) });
    expect(result.actualRequestCount).toBe(2);
    expect(result.cases[0]!.arms.B.state).toBe("unavailable");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PROVIDER_ERROR");
  });

  it("omits bounded context without changing candidates and keeps template hard ceilings", async () => {
    const changed = structuredClone(corpus.cases[0]!);
    changed.input.taskText = "The server must preserve all query parameters.";
    changed.input.description = Array.from({ length: 20 }, (_, index) => `## Section ${index}\n${"background ".repeat(55)}`).join("\n\n");
    const prepared = await prepareAblationCase(changed, profile);
    expect(prepared.contextual).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(prepared.contextual!.input))).toBeLessThanOrEqual(15000);
    expect(prepared.contextual!.input.spans).toEqual(prepared.baseline!.input.spans);
    expect(prepared.contextOmissions.byteBudget).toBeGreaterThan(0);
    changed.input.description = "## Checklist\nPlease review this change.";
    const allObjective: typeof fetch = async (_, init) => {
      const wire = JSON.parse(String(init!.body));
      const packet = JSON.parse(wire.input[1].content[0].text);
      return Response.json({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ spanRoles: packet.spans.map((span: { id: string }) => ({ spanId: span.id, role: "objective_candidate" })), unionMemberCandidates: [] }) }] }] });
    };
    changed.labels = [];
    const result = await runSourceAblation({ ...corpus, cases: [changed] }, { modelProfile: profile, live: true, acknowledgement: true, apiKey: "test-only", fetchFn: allObjective });
    expect(result.cases[0]!.arms.B.state).toBe("invalid");
    expect(result.cases[0]!.arms.C.state).toBe("invalid");
  });
});
