# PR #30 Proof-Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep enhanced planning advisory for proof requirements and report GitHub patch collection failures accurately.

**Architecture:** The verifier retains sole authority over required proof axes. Hybrid finalization retains planner suggestions only as bounded metadata. Evidence indexing carries a non-sensitive patch collection state so a missing patch is classified as unavailable evidence rather than missing implementation.

**Tech Stack:** Next.js, TypeScript, Vitest.

## Global Constraints

- No raw patch, GitHub token, or provider content is persisted.
- Existing report JSON fields remain backward compatible.
- Final requirement status remains deterministic.

---

### Task 1: Make planner-added axes non-blocking

**Files:**
- Modify: `src/lib/hybrid-report-finalizer.ts`
- Test: `src/lib/hybrid-report-finalizer.test.ts`

**Interfaces:**
- Consumes: `HybridPlannerPlanValidation` and deterministic `RequirementProofExpectations`.
- Produces: requirements with deterministic proof axes and optional planner suggestion metadata.

- [ ] **Step 1: Write the failing test**

```ts
it("does not let a planner implementation suggestion change a test-only contract", () => {
  // A test-only span gets a planner implementation suggestion.
  // Its final proof axes remain targeted_test and execution only.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/hybrid-report-finalizer.test.ts`

- [ ] **Step 3: Write minimal implementation**

Keep `requirementProofAxisExpectations(span.text)` as the effective contract.
Do not union planner axis suggestions into the expectations passed to the
verifier; retain suggestions only in existing bounded metadata if applicable.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/hybrid-report-finalizer.test.ts`

### Task 2: Distinguish absent patch collection from absent implementation

**Files:**
- Modify: `src/lib/verifier.ts`
- Test: `src/lib/verifier.test.ts`

**Interfaces:**
- Consumes: changed files with optional `patch` evidence.
- Produces: `evidence_unavailable` when a requirement-relevant source file has no patch.

- [ ] **Step 1: Write failing tests**

```ts
it("keeps a matching source file without a patch inconclusive", () => {
  // No missing_implementation gap; evidence_unavailable is present.
});

it("maps a collected source patch to the matching implementation requirement", () => {
  // Implementation proof is satisfied.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/verifier.test.ts`

- [ ] **Step 3: Write minimal implementation**

Detect relevant source-file metadata without a patch before emitting artifact
gaps. Convert the artifact state to incomplete and emit the existing
`evidence_unavailable` gap kind.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/verifier.test.ts`

### Task 3: Lock the PR #30 regression matrix

**Files:**
- Modify: `src/lib/requirement-relation-regression.test.ts`

- [ ] **Step 1: Add the PR #30 exact wording and evidence fixture**

Assert behavior requirements receive implementation proof, the test-only
requirement receives targeted-test proof without implementation proof, and a
generic successful check does not falsely satisfy execution.

- [ ] **Step 2: Run focused suite**

Run: `pnpm vitest run src/lib/requirement-relation-regression.test.ts src/lib/hybrid-report-finalizer.test.ts src/lib/verifier.test.ts`

- [ ] **Step 3: Run safety verification**

Run: `pnpm typecheck && pnpm lint && pnpm test && git diff --check`
