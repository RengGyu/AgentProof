# General PR Shadow Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the stage 2–7 general-PR analysis pipeline as private, deterministic, default-off shadow artifacts without admitting ordinary PR prose as requirements or enabling new positive outcomes.

**Architecture:** The pipeline is one-way: a selected source snapshot is parsed into GFM structural spans, spans receive an eight-role read-only classification, and those classifications can produce advisory-only plans. Existing typed verification contracts continue to materialize executable plans only through a fixed released-capability registry. Evidence validation, presentation, and release evaluation reuse existing receipt/projection mechanisms, adding strict checks and fixtures without changing report requirement membership, outcome, authority, proof axes, or public report schema.

**Tech Stack:** TypeScript, Vitest, `unified`, `remark-parse`, `remark-gfm`, existing AgentProof V2 contract/evaluator/receipt code.

**Spec:** Research documents `docs/research/2026-08-29-general-pr-{structural-span,claim-classification,automatic-verification-plan-generation,evidence-linking-structure,report-ui-export-semantics,evaluation-release-criteria}-research.md` in the user workspace; Package A plan is `docs/superpowers/plans/2026-08-29-source-snapshot-closure.md`.

## Global Constraints

- Ordinary PR prose remains author-claim/advisory-only; this work must not create a general-PR `Supported`, `met`, or requirement-admission path.
- Parser, classifier, and planner outputs are private transient data; raw source, raw spans, model prompts/results, receipts, tokens, and arbitrary unknown fields must not enter report/share/tenant/Markdown/comment/Slack/audit surfaces.
- Existing authoritative/author-claim/absent/invalid V2 contract behavior, #16/#29/#19 compatibility boundaries, and current public JSON must remain stable.
- Reuse existing typed contract, evidence index, receipt, validation, and projection components. Do not add arbitrary code execution, generic contradiction inference, or a new generic evidence graph.
- Each new general-PR positive-capability decision is default-off. General-PR planning can materialize only existing `documentation_literal.v1`; `path_change_absence`, `return_value`, `workflow_job`, and `test_case` remain unavailable for that new path. Existing typed V2 contracts retain their already-released `documentation_literal` and `path_change_absence` capabilities.

---

### Package B: GFM structural spans — shadow only

**Files:**
- Create: `src/lib/general-pr-structure.ts`
- Create: `src/lib/general-pr-structure.test.ts`
- Modify: `package.json`, `pnpm-lock.yaml`

**Interface:**

```ts
export type GeneralPrStructuralKindV1 =
  | "heading" | "paragraph" | "list_item" | "table_cell"
  | "blockquote" | "code" | "html";

export interface GeneralPrStructuralSpanV1 {
  version: 1;
  id: string;
  kind: GeneralPrStructuralKindV1;
  start: number;
  end: number;
  headingPath: string[];
  excluded: boolean;
  textHash: string;
}

export interface GeneralPrStructureResultV1 {
  version: 1;
  parseState: "complete" | "incomplete";
  spans: GeneralPrStructuralSpanV1[];
}
```

- [x] Write tests proving GFM list nesting, table cells, quotes, fenced code, HTML/comments, CRLF, and emoji have exact UTF-16 slice bindings.
- [x] Run the new tests RED because no parser adapter exists.
- [x] Add the standard GFM parser dependencies and implement a one-pass AST adapter that emits only structural spans and bounded hashes. Code/comment/HTML spans must be `excluded: true`; no semantic filtering or requirement IDs.
- [x] Run the focused tests GREEN and add an invariance test proving this module cannot alter `extractRequirementEvidence()` output.

### Package C: eight-role classification — read-only shadow

**Files:**
- Create: `src/lib/general-pr-claim-classifier.ts`
- Create: `src/lib/general-pr-claim-classifier.test.ts`
- Modify: `src/lib/types.ts` only if private internal types cannot remain local.

**Interface:**

```ts
export type GeneralPrClaimRoleV1 =
  | "objective_candidate" | "problem_observation" | "change_claim"
  | "test_or_validation_claim" | "supporting_context" | "scope_or_follow_up"
  | "process_or_template_meta" | "mixed_or_unknown";

export interface GeneralPrClaimClassificationV1 {
  version: 1;
  structuralSpanId: string;
  textHash: string;
  role: GeneralPrClaimRoleV1;
  abstained: boolean;
}
```

- [x] Write deterministic tests for explicit heading/template signals, test claims, scope/follow-up, process metadata, ambiguous clauses, quoted context, and abstention.
- [x] Run RED because classifier does not exist.
- [x] Implement classification over structural spans only. It must never emit authority, requirement IDs, priority, proof axes, evidence refs, status, outcome, or rationale.
- [x] Run focused tests GREEN and assert identical legacy report JSON before/after calling the classifier.

### Package D: advisory/executable plan separation

**Files:**
- Create: `src/lib/general-pr-verification-plan.ts`
- Create: `src/lib/general-pr-verification-plan.test.ts`
- Modify: `src/lib/verification-capability-policy-v2.ts` and its tests only to expose an explicit released-capability lookup.

**Interfaces:**

```ts
export interface GeneralPrAdvisoryPlanV1 {
  version: 1;
  classificationRef: string;
  suggestionCode: "confirm_acceptance_criterion" | "collect_external_execution_evidence" | "clarify_scope";
  resultCeiling: "none";
}

export interface TypedExecutablePlanV1 {
  version: 1;
  criterionId: string;
  capabilityId: "documentation_literal.v1";
  sourceBindingDigest: string;
}
```

- [x] Write RED tests: ordinary candidate produces advisory-only plan; test/scope/process roles produce no executable plan; author claim produces no executable plan; deferred capability criteria are unavailable.
- [x] Implement a fixed general-PR registry with only `documentation_literal.v1` executable. Materialize executable plans only from existing authoritative typed V2 contracts and source-owned parameters; retain the two existing typed V2 capabilities unchanged.
- [x] Verify no diff/check/log value is ever used as an oracle and current V2 report outcomes are unchanged.

### Package E: receipt ownership and independent validation

**Files:**
- Modify: `src/lib/evidence-receipts.ts`, `src/lib/report-validation.ts`, `src/lib/evidence-relation.ts`
- Modify or create focused tests under `src/lib/*receipt*.test.ts` and `src/lib/report-validation.test.ts`

- [x] Verify existing mutation coverage for receipt owner mismatch, cross-requirement receipt reuse, forged receipt digest, missing receipt on positive targeted-test/execution axis, and incomplete workflow identity.
- [x] Reuse the existing separate receipt recomputation helper, which consumes transient validation context rather than verifier booleans.
- [x] Verify static documentation literal remains closed-evaluator based, generic contradiction remains absent, and ordinary PR advisory data never reaches receipt validation.
- [x] Verify public/share/tenant/Markdown projections reject or omit private receipt payloads.

### Package F: canonical presentation and projections

**Files:**
- Modify: `src/lib/requirement-presentation-v2.ts`, `src/lib/markdown.ts`, `src/lib/report-share.ts`, relevant tests
- Create: `src/lib/requirement-presentation-v2-projection.test.ts` if needed

- [x] Write RED parity tests for unavailable and omitted-private-evidence combinations; existing tests cover authoritative, author-claim, absent, and invalid contract states.
- [x] Extend the private canonical presentation DTO with explicit `observation`, `outcome`, `authority`, `reasonCode`, and evidence-visibility state. Use it in dashboard-copy and Slack projections without changing report schema.
- [x] Verify a privacy omission never renders as zero evidence; existing share-boundary tests continue to reject unknown fields and raw/long receipt content.

### Package G: three-axis evaluation and release closure

**Files:**
- Create: `src/lib/general-pr-evaluation.ts`, `src/lib/general-pr-evaluation.test.ts`
- Modify: `scripts/evaluate-evidence-release-gate.mjs` and its test
- Modify: `src/lib/release-evaluation-runner.ts` and its test only if needed to carry a separate objective false-met counter

**Interfaces:**

```ts
export type GeneralPrEvaluationAxisV1 = "goal_extraction" | "evidence_linking" | "contract_outcome";
export interface GeneralPrAxisMetricsV1 {
  axis: GeneralPrEvaluationAxisV1;
  falseGoalCount?: number;
  falseDecisiveLinkCount?: number;
  falseSupportedCount?: number;
  falseMetCount?: number;
  wrongHeadCount: number;
  authorityElevationCount: number;
  privacyLeakCount: number;
}
```

- [x] Write RED fixtures proving axes are scored separately, missing gold is `unknown` rather than pass, false `met` is counted separately from criterion false Supported, and hard-safety counters fail a release gate.
- [x] Implement only schema/metric/gate plumbing; do not author a protected holdout corpus or claim a GO decision.
- [x] Verify existing production-shaped replay coverage for stale head, incomplete pagination/identity, pasted/live mixture, and source drift. Keep smoke execution as an external post-deploy step.
- [x] Run full regression, typecheck, lint, build, whitespace, and exact-candidate review before any commit request.

## Review Checkpoints

1. After Package B/C: structural/classification outputs have no path to reports.
2. After Package D/E: executable authority is still typed-contract-only; receipt mutations fail closed.
3. After Package F/G: projections are privacy-safe; evaluation reports `NO_GO` absent sealed gold/replay/smoke evidence.

## Completion Evidence

- Package-focused RED→GREEN test output for B–G.
- Existing report fixtures remain byte-equivalent where shadow artifacts are not explicitly called.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check` exit 0.
- Independent review sees no path from ordinary PR free text to `Supported`/`met`, no new raw private data in a public projection, and no bypass of source/head/authority boundaries.
