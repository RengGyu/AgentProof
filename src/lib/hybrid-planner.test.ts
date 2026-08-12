import Ajv from "ajv";
import { describe, expect, it } from "vitest";
import type { RequirementSpanSeed, SourceProvenance } from "./types";
import {
  HYBRID_PLANNER_ALLOWED_AXIS_SUBJECTS,
  HYBRID_PLANNER_CONTRACT_VERSION,
  HYBRID_PLANNER_MAX_INPUT_BYTES,
  HYBRID_PLANNER_MAX_OUTPUT_BYTES,
  HYBRID_PLANNER_MAX_OUTPUT_TOKENS,
  HYBRID_PLANNER_SCHEMA_VERSION,
  bindHybridPlannerSeedHash,
  buildHybridPlannerPackage,
  buildHybridPlannerPlan,
  buildHybridPlannerSeedHash,
  encodeHybridPlannerExpectedAxes,
  validateHybridPlannerPlan
} from "./hybrid-planner";

const provenance: SourceProvenance = {
  version: 1,
  origin: "github_snapshot",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  evidenceCapturedAt: "2026-08-12T00:00:00.000Z",
  inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
};

function seed(overrides: Partial<RequirementSpanSeed> = {}): RequirementSpanSeed {
  return {
    version: 1,
    analysisContext: "linked_issue",
    spans: [
      { id: "sp_1_1", groupId: "grp_1", ordinal: 1, immediateParentSpanId: null, source: "issue", authority: "authoritative", sourceQuality: "explicit_acceptance_criteria", sourceSection: "acceptance_criteria", start: 0, end: 19, text: "Add retry handling.", priority: "must" },
      { id: "sp_1_2", groupId: "grp_1", ordinal: 2, immediateParentSpanId: "sp_1_1", source: "issue", authority: "authoritative", sourceQuality: "explicit_acceptance_criteria", sourceSection: "acceptance_criteria", start: 20, end: 39, text: "Document the retry.", priority: "must" },
      { id: "sp_1_3", groupId: "grp_1", ordinal: 3, immediateParentSpanId: "sp_1_2", source: "issue", authority: "authoritative", sourceQuality: "explicit_acceptance_criteria", sourceSection: "acceptance_criteria", start: 40, end: 56, text: "Add retry tests.", priority: "should" }
    ],
    contexts: [{ id: "ctx_1", source: "issue", role: "problem_context", sourceQuality: "problem_statement", sourceSection: "context", text: "Retries must remain observable." }],
    seedHash: "",
    ...overrides
  };
}

function boundSeed(overrides: Partial<RequirementSpanSeed> = {}): RequirementSpanSeed {
  const bound = bindHybridPlannerSeedHash(seed(overrides), provenance);
  if (!bound) throw new Error("test fixture must bind");
  return bound;
}

function validPlan(input = boundSeed()) {
  const plan = buildHybridPlannerPlan(input, provenance, input.spans.map(() => ({
    disposition: "admit" as const,
    classification: "requirement" as const,
    expected_axes: [{ subject: "implementation" as const, polarity: "present" as const }]
  })));
  if (!plan) throw new Error("test fixture must produce a plan");
  return plan;
}

function decision(plan: ReturnType<typeof validPlan>, index: number) {
  return plan.span_decisions[`d_${index}` as keyof typeof plan.span_decisions]!;
}

describe("seed binding boundary", () => {
  it("accepts a structurally valid bound seed and exact ordered plan", () => {
    const input = boundSeed();
    expect(buildHybridPlannerPackage(input, provenance)).not.toBeNull();
    expect(validateHybridPlannerPlan(validPlan(input), input, provenance)).toMatchObject({ valid: true });
  });

  it("rejects unbound, empty, stale, malformed, sparse, and JSON-unsafe seeds", () => {
    const base = seed();
    const bound = boundSeed();
    const sparse = [...base.spans];
    delete sparse[1];
    const malformed: unknown[] = [
      seed({ spans: [] }),
      seed({ contexts: Array.from({ length: 9 }, (_, index) => ({ ...base.contexts[0], id: `ctx_${index + 1}` })) }),
      seed({ contexts: [{ ...base.contexts[0] }, { ...base.contexts[0] }] }),
      seed({ contexts: [{ ...base.contexts[0], text: "x".repeat(161) }] }),
      seed({ spans: [{ ...base.spans[0], start: Number.NaN }] }),
      seed({ spans: [{ ...base.spans[0], text: undefined as unknown as string }] }),
      seed({ spans: sparse }),
      seed({ spans: [{ ...base.spans[0], end: base.spans[0].end + 1 }] }),
      seed({ spans: [{ ...base.spans[0], id: "sp_2_1" }] }),
      seed({ spans: [{ ...base.spans[0], immediateParentSpanId: "sp_1_9" }] }),
      seed({ spans: [{ ...base.spans[0], authority: "pr_author_claim" }] }),
      seed({ spans: [{ ...base.spans[0] }, { ...base.spans[1], start: 18, end: 37 }] })
    ];
    const stale = { ...bound, spans: [{ ...bound.spans[0], text: "CHANGED_AFTER_BIND", end: 18 }, ...bound.spans.slice(1)] };

    expect(buildHybridPlannerPackage(base, provenance)).toBeNull();
    expect(validateHybridPlannerPlan({ ...validPlan(bound), seed_hash: "" }, base, provenance).valid).toBe(false);
    expect(buildHybridPlannerPackage(stale, provenance)).toBeNull();
    expect(validateHybridPlannerPlan(validPlan(bound), stale, provenance).valid).toBe(false);
    expect(buildHybridPlannerPackage(bound, undefined as never)).toBeNull();
    for (const value of malformed) {
      expect(buildHybridPlannerSeedHash(value as RequirementSpanSeed, provenance)).toBeNull();
      expect(bindHybridPlannerSeedHash(value as RequirementSpanSeed, provenance)).toBeNull();
      expect(buildHybridPlannerPackage(value as RequirementSpanSeed, provenance)).toBeNull();
      expect(validateHybridPlannerPlan({}, value as RequirementSpanSeed, provenance).valid).toBe(false);
    }
  });

  it("requires one Task 1 source family and matching authority for every span and context", () => {
    const linked = seed();
    const unlinked = seed({ analysisContext: "unlinked_pr", spans: seed().spans.map((span) => ({ ...span, source: "pr_description", authority: "pr_author_claim" })), contexts: [{ ...seed().contexts[0], source: "pr_description" }] });
    const provided = seed({ analysisContext: "provided_requirement", spans: seed().spans.map((span) => ({ ...span, source: "task", authority: "authoritative" })), contexts: [{ ...seed().contexts[0], source: "task" }] });
    const malformed: RequirementSpanSeed[] = [
      { ...linked, spans: [{ ...linked.spans[0], source: "pr_description", authority: "pr_author_claim" }] },
      { ...unlinked, spans: [{ ...unlinked.spans[0], source: "issue", authority: "authoritative" }] },
      { ...provided, spans: [{ ...provided.spans[0], source: "manual" }] },
      { ...linked, contexts: [{ ...linked.contexts[0], source: "pr_description", text: "PRIVATE_PR_CONTEXT" }] },
      { ...linked, spans: [...linked.spans.slice(0, 2), { ...linked.spans[2], source: "pr_description", authority: "pr_author_claim" }] }
    ];

    for (const valid of [linked, unlinked, provided]) expect(bindHybridPlannerSeedHash(valid, provenance)).not.toBeNull();
    for (const invalid of malformed) {
      expect(bindHybridPlannerSeedHash(invalid, provenance)).toBeNull();
      expect(buildHybridPlannerPackage(invalid, provenance)).toBeNull();
    }
  });

  it("has stable canonical hashes and changes for every seed/provenance binding family", () => {
    const original = seed();
    const hash = buildHybridPlannerSeedHash(original, provenance);
    const span = original.spans[0]!;
    const context = original.contexts[0]!;
    const changedSpan = (overrides: Partial<typeof span>) => ({ ...original, spans: [{ ...span, ...overrides }, ...original.spans.slice(1)] });
    const changedContext = (overrides: Partial<typeof context>) => ({ ...original, contexts: [{ ...context, ...overrides }] });

    expect(buildHybridPlannerSeedHash(JSON.parse(JSON.stringify(original)), { ...provenance })).toBe(hash);
    for (const changed of [
      { ...original, analysisContext: "provided_requirement" as const }, { ...original, version: 2 as 1 },
      changedSpan({ id: "sp_9_9" }), changedSpan({ groupId: "grp_9" }), changedSpan({ ordinal: 9 }), changedSpan({ immediateParentSpanId: "sp_9_8" }), changedSpan({ source: "task" }), changedSpan({ authority: "pr_author_claim" }), changedSpan({ sourceQuality: "manual_check" }), changedSpan({ sourceSection: "summary" }), changedSpan({ start: 1 }), changedSpan({ end: 18 }), changedSpan({ text: "Changed." }), changedSpan({ priority: "could" }),
      changedContext({ id: "ctx_9" }), changedContext({ source: "task" }), changedContext({ role: "visual_context" }), changedContext({ sourceQuality: "manual_check" }), changedContext({ sourceSection: "summary" }), changedContext({ text: "Changed context." })
    ]) expect(buildHybridPlannerSeedHash(changed, provenance)).not.toBe(hash);
    expect(buildHybridPlannerSeedHash(original, { ...provenance, origin: "pasted_evidence" })).not.toBe(hash);
    expect(buildHybridPlannerSeedHash(original, { ...provenance, headSha: "d".repeat(40) })).not.toBe(hash);
    expect(buildHybridPlannerSeedHash(original, { ...provenance, baseSha: "e".repeat(40) })).not.toBe(hash);
  });

  it("binds an opaque selected-authority identity without exposing it in the provider package", () => {
    const issueOneIdentityHash = "1".repeat(64);
    const issueTwoIdentityHash = "2".repeat(64);
    const issueOne = bindHybridPlannerSeedHash(seed(), provenance, issueOneIdentityHash)!;
    const issueTwo = bindHybridPlannerSeedHash(seed(), provenance, issueTwoIdentityHash)!;
    const issueOnePlan = buildHybridPlannerPlan(issueOne, provenance, issueOne.spans.map(() => ({
      disposition: "admit" as const,
      classification: "requirement" as const,
      expected_axes: []
    })), issueOneIdentityHash)!;

    expect(issueOne.seedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issueTwo.seedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issueOne.seedHash).not.toBe(issueTwo.seedHash);
    expect(validateHybridPlannerPlan(issueOnePlan, issueOne, provenance, issueOneIdentityHash)).toMatchObject({ valid: true });
    expect(validateHybridPlannerPlan(issueOnePlan, issueTwo, provenance, issueTwoIdentityHash)).toMatchObject({ valid: false });

    const serializedPackage = JSON.stringify(buildHybridPlannerPackage(issueOne, provenance, issueOneIdentityHash));
    expect(serializedPackage).not.toContain(issueOneIdentityHash);
    expect(serializedPackage).not.toContain("github_issue:");
    expect(serializedPackage).not.toContain("acme/repo#1");
  });

  it.each([
    "",
    "A".repeat(64),
    "g".repeat(64),
    "0".repeat(63),
    "0".repeat(65),
    0 as unknown as string,
    { toString: () => "0".repeat(64) } as unknown as string
  ])(
    "rejects malformed selected-authority identity hash %j",
    (identityHash) => {
      expect(bindHybridPlannerSeedHash(seed(), provenance, identityHash)).toBeNull();
      expect(buildHybridPlannerSeedHash(seed(), provenance, identityHash)).toBeNull();
    }
  );
});

describe("seed-specific strict schema and runtime parity", () => {
  it("rejects version/hash echoes, extra root keys, and reordered fixed decision keys", () => {
    const input = boundSeed();
    const plan = validPlan(input);
    const candidates = [
      { ...plan, contract_version: "hybrid_requirement_planner.v0" },
      { ...plan, schema_version: "agentproof_requirement_span_plan_v0" },
      { ...plan, seed_hash: "0".repeat(64) },
      { ...plan, explanation: "forbidden" },
      { ...plan, span_decisions: { d_0: decision(plan, 1), d_1: decision(plan, 0), d_2: decision(plan, 2) } }
    ];

    for (const candidate of candidates) expect(validateHybridPlannerPlan(candidate, input, provenance).valid).toBe(false);
  });

  it("accepts only the per-seed ordered authority combinations in both AJV and runtime validation", () => {
    const input = boundSeed();
    const prInput = boundSeed({ analysisContext: "unlinked_pr", spans: seed().spans.map((span) => ({ ...span, source: "pr_description", authority: "pr_author_claim" })), contexts: [{ ...seed().contexts[0], source: "pr_description" }] });
    const plannerPackage = buildHybridPlannerPackage(input, provenance)!;
    const prPackage = buildHybridPlannerPackage(prInput, provenance)!;
    const schemaValidator = new Ajv({ allErrors: true }).compile(plannerPackage.request.response_format.json_schema.schema);
    const prSchemaValidator = new Ajv({ allErrors: true }).compile(prPackage.request.response_format.json_schema.schema);
    const plan = validPlan(input);
    const prPlan = validPlan(prInput);
    const authoritativeClassifications = ["requirement", "not_requirement", "mixed_or_uncertain"] as const;
    const prVariants = [
      { disposition: "admit" as const, classification: "requirement" as const, expected_axes: encodeHybridPlannerExpectedAxes([{ subject: "documentation", polarity: "present" }])! },
      { disposition: "exclude" as const, classification: "not_requirement" as const, expected_axes: encodeHybridPlannerExpectedAxes([])! },
      { disposition: "exclude" as const, classification: "mixed_or_uncertain" as const, expected_axes: encodeHybridPlannerExpectedAxes([])! }
    ];

    for (const classification of authoritativeClassifications) {
      const candidate = { ...plan, span_decisions: { ...plan.span_decisions, d_0: { ...decision(plan, 0), classification } } };
      expect(schemaValidator(candidate)).toBe(true);
      expect(validateHybridPlannerPlan(candidate, input, provenance).valid).toBe(true);
    }
    for (const variant of prVariants) {
      const candidate = { ...prPlan, span_decisions: { ...prPlan.span_decisions, d_2: { ...decision(prPlan, 2), ...variant } } };
      expect(prSchemaValidator(candidate)).toBe(true);
      expect(validateHybridPlannerPlan(candidate, prInput, provenance).valid).toBe(true);
    }
    for (const token of allAllowedAxisSetTokens()) {
      const authoritative = { ...plan, span_decisions: { ...plan.span_decisions, d_0: { ...decision(plan, 0), expected_axes: token } } };
      const prRequirement = { ...prPlan, span_decisions: { ...prPlan.span_decisions, d_2: { ...decision(prPlan, 2), expected_axes: token } } };
      expect(schemaValidator(authoritative)).toBe(true);
      expect(validateHybridPlannerPlan(authoritative, input, provenance).valid).toBe(true);
      expect(prSchemaValidator(prRequirement)).toBe(true);
      expect(validateHybridPlannerPlan(prRequirement, prInput, provenance).valid).toBe(true);
    }
  });

  it("rejects every reviewer-invalid shape in both AJV and runtime validation", () => {
    const input = boundSeed();
    const plannerPackage = buildHybridPlannerPackage(input, provenance)!;
    const schemaValidator = new Ajv({ allErrors: true }).compile(plannerPackage.request.response_format.json_schema.schema);
    const plan = validPlan(input);
    const illegalAbsent = "documentation:absent";
    const duplicate = "implementation:present,implementation:present";
    const candidates = [
      { ...plan, span_decisions: {} },
      { ...plan, span_decisions: { ...plan.span_decisions, d_2: { ...decision(plan, 2), disposition: "exclude", expected_axes: encodeHybridPlannerExpectedAxes([{ subject: "implementation", polarity: "present" }])! } } },
      { ...plan, span_decisions: { ...plan.span_decisions, d_0: { ...decision(plan, 0), expected_axes: illegalAbsent } } },
      { ...plan, span_decisions: { ...plan.span_decisions, d_0: { ...decision(plan, 0), expected_axes: duplicate } } },
      { ...plan, span_decisions: { ...plan.span_decisions, d_0: { ...decision(plan, 0), span_id: "sp_9_9", parent_span_id: "sp_9_8" } } },
      { ...plan, span_decisions: { ...plan.span_decisions, d_0: { ...decision(plan, 0), extra: "forbidden" } } }
    ];

    for (const candidate of candidates) {
      expect(schemaValidator(candidate)).toBe(false);
      expect(validateHybridPlannerPlan(candidate, input, provenance).valid).toBe(false);
    }
  });

  it("uses a production constructor whose emitted keys are exactly the dynamic schema-required keys", () => {
    const input = boundSeed();
    const plannerPackage = buildHybridPlannerPackage(input, provenance)!;
    const plan = validPlan(input);
    const schema = plannerPackage.request.response_format.json_schema.schema;

    expect(Object.keys(plan).sort()).toEqual([...schema.required].sort());
    expect(Object.keys(plan.span_decisions).sort()).toEqual([...schema.properties.span_decisions.required].sort());
    for (const key of schema.properties.span_decisions.required) {
      const decisionSchema = schema.properties.span_decisions.properties[key]!;
      const variant = decisionSchema.anyOf ? decisionSchema.anyOf[0]! : decisionSchema;
      expect(Object.keys(plan.span_decisions[key as keyof typeof plan.span_decisions]!).sort()).toEqual([...(variant.required ?? [])].sort());
    }
  });
});

describe("package limits and privacy", () => {
  it("contains bounded source/context fields and configuration only", () => {
    const input = boundSeed({ spans: [{ ...seed().spans[0], text: "SPAN_MARKER", start: 4, end: 15, sourceSection: "private/thing.ts" }], contexts: [{ ...seed().contexts[0], text: "CONTEXT_MARKER" }] });
    const plannerPackage = buildHybridPlannerPackage(input, provenance)!;
    const serialized = JSON.stringify(plannerPackage);

    expect(plannerPackage.request).toMatchObject({ model: "gpt-5-mini", store: false, max_output_tokens: HYBRID_PLANNER_MAX_OUTPUT_TOKENS });
    expect(serialized).toContain("SPAN_MARKER");
    expect(serialized).toContain("CONTEXT_MARKER");
    expect(serialized).not.toContain("private/thing.ts");
    expect(serialized).not.toContain(provenance.origin);
    expect(serialized).not.toContain(provenance.headSha!);
    expect(serialized).not.toContain(provenance.baseSha!);
    expect(serialized).not.toMatch(/evidence|patch|check|log|url|sha/i);
  });

  it("enforces the exact 12KB input boundary and 16KB output boundary", () => {
    let low = 0;
    let high = HYBRID_PLANNER_MAX_INPUT_BYTES;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = boundSeed({ spans: [{ ...seed().spans[0], text: "x".repeat(middle), end: middle }] });
      if (buildHybridPlannerPackage(candidate, provenance)) low = middle;
      else high = middle - 1;
    }
    const accepted = buildHybridPlannerPackage(boundSeed({ spans: [{ ...seed().spans[0], text: "x".repeat(low), end: low }] }), provenance);
    const rejected = buildHybridPlannerPackage(boundSeed({ spans: [{ ...seed().spans[0], text: "x".repeat(low + 1), end: low + 1 }] }), provenance);
    const plan = validPlan();

    expect(Buffer.byteLength(JSON.stringify(accepted?.input), "utf8")).toBe(HYBRID_PLANNER_MAX_INPUT_BYTES);
    expect(rejected).toBeNull();
    expect(validateHybridPlannerPlan({ ...plan, seed_hash: "0".repeat(HYBRID_PLANNER_MAX_OUTPUT_BYTES) }, boundSeed(), provenance)).toEqual({ valid: false, errors: ["output exceeds the parsed-output byte limit"] });
  });

  it("returns no package for a multi-byte UTF-8 payload above the input cap", () => {
    const oversized = boundSeed({ spans: [{ ...seed().spans[0], text: "😀".repeat(HYBRID_PLANNER_MAX_INPUT_BYTES), end: "😀".repeat(HYBRID_PLANNER_MAX_INPUT_BYTES).length }] });
    expect(buildHybridPlannerPackage(oversized, provenance)).toBeNull();
  });
});

describe("maximum compact plan shape", () => {
  it("constructs every valid Task 1 layout through production DTO helpers and stays within declared output bounds", () => {
    const axes = [...HYBRID_PLANNER_ALLOWED_AXIS_SUBJECTS].sort((left, right) => right.length - left.length).slice(0, 4).map((subject) => ({ subject, polarity: "present" as const }));
    const bytes = Array.from({ length: 2 ** 11 }, (_, mask) => {
      let group = 1;
      let ordinal = 0;
      const spans = Array.from({ length: 12 }, (_, index) => {
        const newGroup = index > 0 && Boolean(mask & (1 << (index - 1)));
        if (newGroup) { group += 1; ordinal = 0; }
        ordinal += 1;
        const id = `sp_${group}_${ordinal}` as const;
        return { id, groupId: `grp_${group}` as const, ordinal, immediateParentSpanId: newGroup || index === 0 ? null : `sp_${group}_${ordinal - 1}` as const, source: "issue" as const, authority: "authoritative" as const, sourceQuality: "explicit_acceptance_criteria" as const, sourceSection: null, start: index, end: index + 1, text: "x", priority: "must" as const };
      });
      const input = boundSeed({ spans, contexts: [] });
      const plan = buildHybridPlannerPlan(input, provenance, spans.map(() => ({ disposition: "admit" as const, classification: "mixed_or_uncertain" as const, expected_axes: axes })));
      if (!plan) throw new Error("valid layout must construct");
      return Buffer.byteLength(JSON.stringify(plan), "utf8");
    });

    expect(Math.max(...bytes)).toBe(2_884);
    expect(Math.max(...bytes)).toBeLessThanOrEqual(4_608);
    expect(Math.max(...bytes)).toBeLessThanOrEqual(HYBRID_PLANNER_MAX_OUTPUT_BYTES);
  });
});

describe("canonical axis-set encoding", () => {
  it("round-trips only canonical unique subsets of at most four allowed pairs", () => {
    expect(encodeHybridPlannerExpectedAxes([{ subject: "documentation", polarity: "present" }, { subject: "implementation", polarity: "absent" }])).toBe("implementation:absent,documentation:present");
    expect(encodeHybridPlannerExpectedAxes([{ subject: "documentation", polarity: "absent" }])).toBeNull();
    expect(encodeHybridPlannerExpectedAxes([{ subject: "implementation", polarity: "present" }, { subject: "implementation", polarity: "absent" }])).toBeNull();
    expect(encodeHybridPlannerExpectedAxes(Array.from({ length: 5 }, () => ({ subject: "documentation", polarity: "present" })))).toBeNull();
  });
});

describe("Structured Outputs schema limits", () => {
  it("deduplicates axis enums through definitions and remains below conservative request-size limits", () => {
    const allAuthoritative = twelveSpanSeed("linked_issue");
    const allPr = twelveSpanSeed("unlinked_pr");
    const packages = [
      buildHybridPlannerPackage(allAuthoritative, provenance)!,
      buildHybridPlannerPackage(allPr, provenance)!
    ];

    const observed = packages.map((plannerPackage) => {
      const schema = plannerPackage.request.response_format.json_schema.schema;
      const metrics = schemaMetrics(schema);
      expect(metrics.enumOccurrences).toBeLessThanOrEqual(1_000);
      expect(metrics.objectProperties).toBeLessThanOrEqual(5_000);
      expect(metrics.maxDepth).toBeLessThanOrEqual(10);
      expect(metrics.schemaStrings).toBeLessThanOrEqual(120_000);
      expect(Buffer.byteLength(JSON.stringify(schema), "utf8")).toBeLessThanOrEqual(20_000);
      expect(Buffer.byteLength(JSON.stringify(plannerPackage.request), "utf8")).toBeLessThanOrEqual(20_000);
      expect(new Ajv({ allErrors: true }).compile(schema)(validPlan(allAuthoritative))).toBe(plannerPackage.input.analysis_context === "linked_issue");
      return { ...metrics, schemaBytes: Buffer.byteLength(JSON.stringify(schema), "utf8"), requestBytes: Buffer.byteLength(JSON.stringify(plannerPackage.request), "utf8") };
    });
    expect(observed).toEqual([
      { enumOccurrences: 216, objectProperties: 76, maxDepth: 3, schemaStrings: 12_569, schemaBytes: 14_529, requestBytes: 14_716 },
      { enumOccurrences: 251, objectProperties: 136, maxDepth: 3, schemaStrings: 15_272, schemaBytes: 18_538, requestBytes: 18_725 }
    ]);
  });
});

describe("exhaustive generated-schema parity", () => {
  it("matches runtime validation for all 864 authority/token/disposition/classification combinations per source family", () => {
    const axisTokens = [...allAllowedAxisSetTokens(), "documentation:absent", "implementation:present,implementation:present", "implementation:present,implementation:absent"];
    const combinations = (["admit", "exclude"] as const).flatMap((disposition) =>
      (["requirement", "not_requirement", "mixed_or_uncertain"] as const).map((classification) => ({ disposition, classification }))
    );
    const sources = [twelveSpanSeed("linked_issue"), twelveSpanSeed("unlinked_pr")];
    const acceptedCounts: number[] = [];

    for (const input of sources) {
      const schema = buildHybridPlannerPackage(input, provenance)!.request.response_format.json_schema.schema;
      const schemaValidator = new Ajv({ allErrors: true }).compile(schema);
      const base = validPlan(input);
      let accepted = 0;
      for (const expected_axes of axisTokens) for (const combination of combinations) {
        const candidate = { ...base, span_decisions: { ...base.span_decisions, d_0: { ...decision(base, 0), ...combination, expected_axes } } };
        const schemaAccepted = schemaValidator(candidate);
        const runtimeAccepted = validateHybridPlannerPlan(candidate, input, provenance).valid;
        expect(schemaAccepted).toBe(runtimeAccepted);
        if (schemaAccepted) accepted += 1;
      }
      acceptedCounts.push(accepted);
    }

    expect(axisTokens).toHaveLength(144);
    expect(combinations).toHaveLength(6);
    expect(acceptedCounts).toEqual([423, 143]);
  });
});

function twelveSpanSeed(analysisContext: "linked_issue" | "unlinked_pr"): RequirementSpanSeed {
  const source = analysisContext === "linked_issue" ? "issue" as const : "pr_description" as const;
  const authority = analysisContext === "linked_issue" ? "authoritative" as const : "pr_author_claim" as const;
  return boundSeed({
    analysisContext,
    spans: Array.from({ length: 12 }, (_, index) => ({
      id: `sp_1_${index + 1}` as const,
      groupId: "grp_1" as const,
      ordinal: index + 1,
      immediateParentSpanId: index === 0 ? null : `sp_1_${index}` as const,
      source,
      authority,
      sourceQuality: analysisContext === "linked_issue" ? "explicit_acceptance_criteria" as const : "author_claim" as const,
      sourceSection: null,
      start: index,
      end: index + 1,
      text: "x",
      priority: "must" as const
    })),
    contexts: []
  });
}

function schemaMetrics(schema: unknown): { enumOccurrences: number; objectProperties: number; maxDepth: number; schemaStrings: number } {
  const metrics = { enumOccurrences: 0, objectProperties: 0, maxDepth: 0, schemaStrings: 0 };
  const visit = (value: unknown, depth: number) => {
    if (typeof value === "string") { metrics.schemaStrings += value.length; return; }
    if (Array.isArray(value)) { for (const item of value) visit(item, depth); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.type === "object") metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    if (Array.isArray(record.enum)) metrics.enumOccurrences += record.enum.length;
    if (record.properties && typeof record.properties === "object") metrics.objectProperties += Object.keys(record.properties as object).length;
    for (const [key, child] of Object.entries(record)) { metrics.schemaStrings += key.length; visit(child, depth + (key === "properties" ? 1 : 0)); }
  };
  visit(schema, 1);
  return metrics;
}

function allAllowedAxisSetTokens(): string[] {
  const tokens = new Set<string>();
  const subjects = [...HYBRID_PLANNER_ALLOWED_AXIS_SUBJECTS];
  for (const subset of allSubsets(subjects, 4)) tokens.add(encodeHybridPlannerExpectedAxes(subset.map((subject) => ({ subject, polarity: "present" as const })))!);
  for (const subset of allSubsets(subjects.filter((subject) => subject !== "implementation"), 3)) tokens.add(encodeHybridPlannerExpectedAxes([{ subject: "implementation", polarity: "absent" }, ...subset.map((subject) => ({ subject, polarity: "present" as const }))])!);
  return [...tokens];
}

function allSubsets<T>(items: readonly T[], max: number): T[][] {
  const result: T[][] = [[]];
  for (const item of items) for (const subset of [...result]) if (subset.length < max) result.push([...subset, item]);
  return result;
}
