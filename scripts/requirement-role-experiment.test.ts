import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { prepareAblationCase, type AblationCorpus } from "./requirement-source-ablation";
import {
  decideRequirementRoleAuthority,
  runRequirementRoleExperiment,
  validateResearchRoleOutput,
  type RequirementRoleExperimentProviderRequest,
} from "./requirement-role-experiment";

const profile = { model: "test-model", promptVersion: "role-research.v1", inputFieldPolicyVersion: "source-role-experiment.v1" };
const description = [
  "# Goal",
  "The server must preserve query parameters.",
  "",
  "---",
  "",
  "## Notes",
  "Maybe this needs context.",
  "",
  "The surrounding section explains the first condition.",
  "",
  "The surrounding section also explains the second condition.",
  "",
  "## Checklist",
  "- [ ] Please review this change.",
  "",
  "<!-- internal template -->",
  "",
  "```ts",
  "const example = true;",
  "```",
  "",
  "| Key | Value |",
  "| --- | --- |",
  "| mode | safe |",
].join("\n");

function corpusWith(body = description): AblationCorpus {
  return {
    schemaVersion: "requirement_source_ablation.v1",
    labelProvenance: "unlabeled research input",
    cases: [{
      id: "research-1",
      cohort: "controlled",
      input: { title: "Preserve query parameters", description: body, taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] },
      labels: [],
    }],
  };
}

const outputFor = (request: RequirementRoleExperimentProviderRequest) => ({
  spanRoles: request.packet.input.spans.map(span => ({
    spanId: span.id,
    role: request.pass === "expanded"
      ? "objective_candidate"
      : request.version === "V4" && span.text.includes("Maybe")
        ? "mixed_or_ambiguous"
        : request.version !== "V0" && request.version !== "V1" && span.deterministicRole === "template_or_process"
          ? "objective_candidate"
          : span.deterministicRole === "template_or_process"
            ? "template_or_process"
            : "supporting_context",
  })),
  unionMemberCandidates: [],
});

describe("source-role research experiment", () => {
  it("accounts for every structural unit and non-whitespace gap without persisting source text", async () => {
    const result = await runRequirementRoleExperiment(corpusWith(), { modelProfile: profile });
    const item = result.cases[0]!;
    expect(result.actualCallCount).toBe(0);
    const kinds = new Set(item.registry.map(unit => unit.structuralKind));
    for (const kind of ["title", "heading", "paragraph", "code", "html", "table_cell", "gap"]) expect(kinds.has(kind)).toBe(true);
    for (const [sourceKind, text] of [["pr_title", "Preserve query parameters"], ["pr_body", description]] as const) {
      const units = item.registry.filter(unit => unit.sourceKind === sourceKind);
      for (let index = 0; index < text.length; index++) if (/\S/.test(text[index]!)) expect(units.some(unit => unit.start <= index && index < unit.end)).toBe(true);
    }
    for (const version of ["V0", "V1", "V2", "V3", "V4"] as const) {
      expect(item.versions[version].ledger).toHaveLength(item.registry.length);
      expect(item.versions[version].calls.every(call => call.inputBytes <= 12_000 && call.unitIds.length <= 12 && call.attempted === false)).toBe(true);
    }
    const persisted = JSON.stringify(result);
    expect(persisted).not.toContain("The server must preserve");
    expect(persisted).not.toContain("const example");
    expect(persisted).not.toContain("internal template");
  });

  it("keeps V0 byte-identical and changes one approved variable between adjacent versions", async () => {
    const captures: RequirementRoleExperimentProviderRequest[] = [];
    const corpus = corpusWith();
    const baseline = await prepareAblationCase(corpus.cases[0]!, profile);
    const result = await runRequirementRoleExperiment(corpus, {
      modelProfile: profile,
      provider: { observe: async request => {
        captures.push(structuredClone(request));
        return { output: outputFor(request), telemetry: { latencyMs: 7, inputTokens: 11, outputTokens: 3, totalTokens: 14 } };
      } },
    });
    const initial = (version: RequirementRoleExperimentProviderRequest["version"]) => captures.find(request => request.version === version && request.pass === "initial")!;
    const requestPolicy = (request: RequirementRoleExperimentProviderRequest["packet"]["request"]) => ({ ...request, responseFormat: { ...request.responseFormat, schema: undefined } });
    expect(initial("V0").packet).toEqual(baseline.baseline);
    expect(initial("V1").packet.system).toBe(initial("V0").packet.system);
    expect(requestPolicy(initial("V1").packet.request)).toEqual(requestPolicy(initial("V0").packet.request));
    expect(initial("V1").packet.input.spans.length).toBeGreaterThanOrEqual(initial("V0").packet.input.spans.length);
    expect(initial("V2").packet.input).toEqual(initial("V1").packet.input);
    expect(initial("V2").packet.request).toEqual(initial("V1").packet.request);
    expect(initial("V2").packet.system).not.toBe(initial("V1").packet.system);
    expect(initial("V3").packet.system).toBe(initial("V2").packet.system);
    expect(initial("V3").packet.input.spans).toEqual(initial("V2").packet.input.spans);
    expect(initial("V3").packet.input.sourceContext?.length).toBeGreaterThan(0);
    expect(initial("V4").packet).toEqual(initial("V3").packet);
    const boundaries = (version: "V1" | "V2" | "V3") => captures
      .filter(request => request.version === version && request.pass === "initial")
      .map(request => request.packet.input.spans.map(span => span.id));
    expect(boundaries("V2")).toEqual(boundaries("V1"));
    expect(boundaries("V3")).toEqual(boundaries("V1"));
    for (const capture of captures) {
      expect(capture.packet.input.spans.length).toBeLessThanOrEqual(12);
      expect(Buffer.byteLength(JSON.stringify(capture.packet.input))).toBeLessThanOrEqual(12_000);
      for (const context of capture.packet.input.sourceContext ?? []) {
        expect(context.references.every(reference => reference.sourceUnitId === context.sourceUnitId)).toBe(true);
      }
    }
    expect(result.actualCallCount).toBeLessThanOrEqual(30);
  });

  it("separates experimental semantic roles from immutable source authority and product validation", async () => {
    const result = await runRequirementRoleExperiment(corpusWith(), {
      modelProfile: profile,
      provider: { observe: async request => ({ output: outputFor(request) }) },
    });
    const v2 = result.cases[0]!.versions.V2.ledger.find(entry => entry.semanticRole === "objective_candidate" && entry.productValidator.reason === "role_ceiling_violation");
    expect(v2).toMatchObject({ semanticRole: "objective_candidate", status: "decided" });
    expect(v2!.authorityDecision).toMatch(/^eligible_/);
    expect(decideRequirementRoleAuthority("objective_candidate", "author_claim", "context")).toBe("blocked_context");
    expect(decideRequirementRoleAuthority("objective_candidate", "authoritative", "policy_only")).toBe("blocked_policy_only");
    expect(decideRequirementRoleAuthority("supporting_context", "authoritative", "objective")).toBe("not_objective");
  });

  it("preserves model roles when V0/V1 product constraints reject validation", async () => {
    const result = await runRequirementRoleExperiment(corpusWith(), {
      modelProfile: profile,
      provider: { observe: async request => ({
        output: request.version === "V1"
          ? { spanRoles: request.packet.input.spans.map(span => ({ spanId: span.id, role: "objective_candidate" })), unionMemberCandidates: [] }
          : outputFor(request),
      }) },
    });
    const entry = result.cases[0]!.versions.V1.ledger.find(item => item.productValidator.reason === "role_ceiling_violation")!;
    expect(entry).toMatchObject({ semanticRole: "objective_candidate", validatedOutcome: null, status: "invalid" });
  });

  it("keeps V0 legacy validator outcome while reporting stricter research schema diagnostics", async () => {
    const result = await runRequirementRoleExperiment(corpusWith(), {
      modelProfile: profile,
      provider: { observe: async request => {
        const output = outputFor(request);
        return { output: request.version === "V0" ? { ...output, unionMemberCandidates: null } : output };
      } },
    });
    const v0 = result.cases[0]!.versions.V0;
    expect(v0.outputValidationPolicy).toBe("product_legacy");
    expect(v0.calls[0]).toMatchObject({ state: "valid", researchSchema: { state: "invalid", reason: "root_shape_invalid" }, productValidator: { state: "valid" } });
    expect(v0.ledger.filter(entry => entry.selected).every(entry => entry.status === "decided" && entry.validatedOutcome !== null)).toBe(true);
    expect(result.cases[0]!.versions.V2.outputValidationPolicy).toBe("research_strict_with_product_diagnostic");
  });

  it("expands same-section context only once for units still ambiguous", async () => {
    const captures: RequirementRoleExperimentProviderRequest[] = [];
    const result = await runRequirementRoleExperiment(corpusWith(), {
      modelProfile: profile,
      provider: { observe: async request => { captures.push(request); return { output: outputFor(request) }; } },
    });
    const expanded = captures.filter(request => request.version === "V4" && request.pass === "expanded");
    expect(expanded).toHaveLength(1);
    expect(expanded[0]!.packet.input.spans).toHaveLength(1);
    expect(expanded[0]!.packet.input.spans[0]!.text).toContain("Maybe");
    const ledger = result.cases[0]!.versions.V4.ledger.find(entry => entry.expansionCount === 1)!;
    expect(ledger).toMatchObject({ initialSemanticRole: "mixed_or_ambiguous", semanticRole: "objective_candidate", status: "decided", expansionCount: 1 });
    expect(result.cases[0]!.versions.V4.ledger.every(entry => entry.expansionCount <= 1)).toBe(true);
  });

  it("reserves the global budget for every case's initial V0-V4 comparison before V4 expansion", async () => {
    const corpus = corpusWith();
    corpus.cases.push(structuredClone(corpus.cases[0]!));
    corpus.cases[1]!.id = "research-2";
    const offline = await runRequirementRoleExperiment(corpus, { modelProfile: profile });
    const initialCallCount = offline.cases.flatMap(item => Object.values(item.versions).flatMap(version => version.calls)).length;
    const captures: RequirementRoleExperimentProviderRequest[] = [];
    const result = await runRequirementRoleExperiment(corpus, {
      modelProfile: profile,
      maxCalls: initialCallCount,
      provider: { observe: async request => {
        captures.push(request);
        return { output: outputFor(request) };
      } },
    });
    expect(initialCallCount).toBeLessThanOrEqual(30);
    expect(captures).toHaveLength(initialCallCount);
    expect(captures.every(request => request.pass === "initial")).toBe(true);
    expect(new Set(captures.map(request => `${request.caseId}:${request.version}`))).toEqual(new Set([
      "research-1:V0", "research-1:V1", "research-1:V2", "research-1:V3", "research-1:V4",
      "research-2:V0", "research-2:V1", "research-2:V2", "research-2:V3", "research-2:V4",
    ]));
    expect(result.cases.flatMap(item => item.versions.V4.calls).filter(call => call.pass === "expanded")).toHaveLength(2);
    expect(result.cases.flatMap(item => item.versions.V4.calls).filter(call => call.pass === "expanded").every(call => call.reason === "total_call_budget")).toBe(true);
  });

  it("keeps the initial abstention when the single V4 expansion fails", async () => {
    const result = await runRequirementRoleExperiment(corpusWith(), {
      modelProfile: profile,
      provider: { observe: async request => {
        if (request.version === "V4" && request.pass === "expanded") throw new Error("PRIVATE EXPANSION ERROR");
        return { output: outputFor(request) };
      } },
    });
    const entry = result.cases[0]!.versions.V4.ledger.find(item => item.expansionCount === 1)!;
    expect(entry).toMatchObject({ initialSemanticRole: "mixed_or_ambiguous", semanticRole: "mixed_or_ambiguous", status: "abstained", reason: "ambiguous_initial", expansionReason: "provider_error", expansionCount: 1 });
    expect(JSON.stringify(result)).not.toContain("PRIVATE EXPANSION ERROR");
  });

  it("omits over-budget V3 context without changing V1 batch boundaries", async () => {
    const body = ["# Context", ...Array.from({ length: 12 }, (_, index) => `${String(index).padStart(2, "0")} ${"background ".repeat(70)}`)].join("\n\n");
    const result = await runRequirementRoleExperiment(corpusWith(body), { modelProfile: profile });
    const item = result.cases[0]!;
    expect(item.versions.V3.calls.map(call => call.unitIds)).toEqual(item.versions.V1.calls.map(call => call.unitIds));
    expect(item.versions.V3.calls.some(call => call.contextOmittedUnitIds.length > 0)).toBe(true);
    expect(item.versions.V3.calls.every(call => call.inputBytes <= 12_000)).toBe(true);
  });

  it("rejects missing, duplicate, stale and unknown IDs before using roles", () => {
    const expected = ["one", "two"];
    const known = new Set(["one", "two", "stale"]);
    expect(validateResearchRoleOutput({ spanRoles: [{ spanId: "one", role: "supporting_context" }], unionMemberCandidates: [] }, expected, known)).toMatchObject({ valid: false, reason: "missing_span_id" });
    expect(validateResearchRoleOutput({ spanRoles: [{ spanId: "one", role: "supporting_context" }, { spanId: "one", role: "supporting_context" }], unionMemberCandidates: [] }, expected, known)).toMatchObject({ valid: false, reason: "duplicate_span_id" });
    expect(validateResearchRoleOutput({ spanRoles: [{ spanId: "one", role: "supporting_context" }, { spanId: "stale", role: "supporting_context" }], unionMemberCandidates: [] }, expected, known)).toMatchObject({ valid: false, reason: "stale_span_id" });
    expect(validateResearchRoleOutput({ spanRoles: [{ spanId: "one", role: "supporting_context" }, { spanId: "unknown", role: "supporting_context" }], unionMemberCandidates: [] }, expected, known)).toMatchObject({ valid: false, reason: "unknown_span_id" });
    expect(validateResearchRoleOutput(undefined, expected, known)).toMatchObject({ valid: false, reason: "root_shape_invalid" });
    expect(validateResearchRoleOutput({ spanRoles: expected.map(spanId => ({ spanId, role: "objective_candidate" })), unionMemberCandidates: Array.from({ length: 9 }, () => ({ spanId: "one", aliasName: "Alias", member: "string" })) }, expected, known)).toMatchObject({ valid: false, reason: "union_candidate_invalid" });
    expect(validateResearchRoleOutput({ spanRoles: expected.map(spanId => ({ spanId, role: "objective_candidate" })), unionMemberCandidates: [{ spanId: "one", aliasName: "A".repeat(201), member: "string" }] }, expected, known)).toMatchObject({ valid: false, reason: "union_candidate_invalid" });
    expect(validateResearchRoleOutput({ spanRoles: expected.map(spanId => ({ spanId, role: "objective_candidate" })), unionMemberCandidates: [{ spanId: "one", aliasName: "Alias", member: null }] }, expected, known)).toMatchObject({ valid: false, reason: "union_candidate_invalid" });
    const circular: Record<string, unknown> = { spanRoles: [], unionMemberCandidates: [] };
    circular.self = circular;
    expect(validateResearchRoleOutput(circular, expected, known)).toMatchObject({ valid: false, reason: "output_size_exceeded" });
  });

  it("does not retry provider failures and leaves over-budget or oversized units unreviewed", async () => {
    let calls = 0;
    const failed = await runRequirementRoleExperiment(corpusWith(), {
      modelProfile: profile,
      provider: { observe: async () => { calls++; throw new Error("PRIVATE BODY"); } },
      maxCalls: 3,
    });
    expect(calls).toBe(3);
    expect(failed.actualCallCount).toBe(3);
    expect(failed.cases[0]!.versions.V4.ledger.some(entry => entry.reason === "total_call_budget")).toBe(true);
    expect(JSON.stringify(failed)).not.toContain("PRIVATE BODY");
    expect(failed.cases.flatMap(item => Object.values(item.versions).flatMap(version => version.calls)).every(call => call.retryCount === 0)).toBe(true);

    const oversized = await runRequirementRoleExperiment(corpusWith("A".repeat(13_000)), { modelProfile: profile });
    const bodyUnit = oversized.cases[0]!.registry.find(unit => unit.sourceKind === "pr_body" && unit.structuralKind === "paragraph")!;
    expect(Object.values(oversized.cases[0]!.versions).every(version => version.ledger.find(entry => entry.unitId === bodyUnit.id)!.reason === "input_byte_budget" || version.version === "V0")).toBe(true);
  }, 10_000);

  it("continues beyond 60 seconds and exits immediately when the comparison finishes", async () => {
    vi.useFakeTimers();
    try {
      let delayedCalls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      const requestTimeouts: number[] = [];
      const running = runRequirementRoleExperiment(corpusWith(), {
        modelProfile: profile,
        totalTimeoutMs: 2_100_000,
        provider: { observe: request => {
          requestTimeouts.push(request.packet.request.timeoutMs);
          if (delayedCalls >= 3) return Promise.resolve({ output: outputFor(request) });
          delayedCalls++;
          if (delayedCalls === 1) markStarted();
          return new Promise(resolve => setTimeout(() => resolve({ output: outputFor(request) }), 20_001));
        } },
      });
      await Promise.race([started, running.then(() => { throw new Error("run finished before first provider call"); })]);
      await vi.advanceTimersByTimeAsync(60_003);
      const result = await running;
      expect(result).toMatchObject({ timedOut: false, totalTimeoutMs: 2_100_000, comparisonCompletion: { status: "complete", unexecutedCalls: 0 } });
      expect(requestTimeouts.length).toBeGreaterThan(1);
      expect(requestTimeouts.every(timeout => timeout === 60_000)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts the in-flight cycle at 35 minutes and starts no later calls", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let markStarted!: () => void;
      const started = new Promise<void>(resolve => { markStarted = resolve; });
      const running = runRequirementRoleExperiment(corpusWith(), {
        modelProfile: profile,
        totalTimeoutMs: 2_100_000,
        provider: { observe: request => {
          calls++;
          markStarted();
          return new Promise((_, reject) => request.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
        } },
      });
      await Promise.race([started, running.then(() => { throw new Error("run finished before first provider call"); })]);
      await vi.advanceTimersByTimeAsync(2_100_000);
      const result = await running;
      expect(calls).toBe(1);
      expect(result).toMatchObject({ actualCallCount: 1, timedOut: true, totalTimeoutMs: 2_100_000, comparisonCompletion: { status: "partial_timeout", attemptedCalls: 1 } });
      const records = result.cases.flatMap(item => Object.values(item.versions).flatMap(version => version.calls));
      expect(records.filter(call => call.attempted)).toHaveLength(1);
      expect(records.some(call => call.reason === "total_timeout")).toBe(true);
      expect(result.comparisonCompletion.unexecutedCalls).toBe(records.filter(call => !call.attempted).length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a bounded reason and makes zero calls when no V0 package can be built", async () => {
    const corpus = corpusWith("");
    corpus.cases[0]!.input.title = "T".repeat(13_000);
    const result = await runRequirementRoleExperiment(corpus, { modelProfile: profile, provider: { observe: async () => { throw new Error("MUST_NOT_CALL"); } } });
    expect(result.actualCallCount).toBe(0);
    expect(result.cases[0]!.registry).toHaveLength(1);
    for (const version of Object.values(result.cases[0]!.versions)) {
      expect(version.calls).toHaveLength(0);
      expect(version.ledger[0]).toMatchObject({ status: "unreviewed", reason: "input_byte_budget" });
    }
  });

  it("rejects private or secret-bearing input before any provider call", async () => {
    let calls = 0;
    for (const mutate of [
      (corpus: AblationCorpus) => { corpus.cases[0]!.input.repositoryPrivate = true; },
      (corpus: AblationCorpus) => { corpus.cases[0]!.input.description = "token sk-123456789"; },
    ]) {
      const corpus = corpusWith();
      mutate(corpus);
      await expect(runRequirementRoleExperiment(corpus, { modelProfile: profile, provider: { observe: async () => { calls++; return null; } } })).rejects.toThrow(/corpus/);
    }
    expect(calls).toBe(0);
  });
});
