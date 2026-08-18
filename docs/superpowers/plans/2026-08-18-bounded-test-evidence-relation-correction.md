# Bounded Test Evidence Relation Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove narrowly related English test objectives without broad requirement grouping or receipt reuse.

**Architecture:** A versioned subject-chain relation binds one explicit behavior subject, one identifier-free continuation, and one subjectless test objective. Direct assertion parsing accepts only bounded static literals; verifier receipts bind the assertion to either a changed implementation or an unchanged exact-head target. Validators keep all source, head, and ownership boundaries closed.

**Tech Stack:** TypeScript, Vitest, existing deterministic verifier and report validator.

**Spec:** `docs/superpowers/specs/2026-08-18-bounded-test-evidence-relation-correction-design.md`

## Global Constraints

- English-only; do not alter contract outcomes or multilingual classification.
- Never use PR numbers, filenames, or fixture-specific text as a production rule.
- No generic CI fallback; execution must be exact-head and test-path bound.
- Do not persist raw source, paths, identifiers, arguments, or expected values in new receipts.
- Keep public/share/tenant-summary projections free of private relation receipts.

---

### Task 1: Bounded source-chain relation

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/extractors.ts`, `src/lib/verifier-proof-expectations.ts`
- Test: `src/lib/requirement-relation-regression.test.ts`

**Interfaces:**
- Produces `DeterministicRequirementRelation` variant `test_subject_chain` with subject, bridge, current IDs and source-binding refs.
- Consumes ordered requirement spans and existing proof expectations.

```ts
{ version: 1, kind: "test_subject_chain", subjectRequirementId, bridgeRequirementId,
  currentSourceBindingRef, subjectSourceBindingRef, bridgeSourceBindingRef }
```

- [x] Write failing tests for one explicit identifier + one identifier-free continuation + one test sibling, and for conflicting identifiers, two bridges, and a heading boundary.
- [x] Run `pnpm vitest run src/lib/requirement-relation-regression.test.ts` and confirm RED.
- [x] Add the closed relation only for three consecutive spans in one group; require one explicit subject identifier and record all three binding refs.
- [x] Run the focused relation suite and confirm GREEN.
- [x] Commit the source-chain change.

### Task 2: Bounded direct assertion evidence

**Files:**
- Modify: `src/lib/evidence-relation.ts`, `src/lib/verifier.ts`
- Test: `src/lib/evidence-relation.test.ts`, `src/lib/english-observation-evidence-regression.test.ts`

**Interfaces:**
- Extends direct assertion signatures with bounded flat-object literals.
- Produces a changed-target relation only when one static import, one resolved subject binding, one direct assertion, and one exact-head suite agree.

```ts
expect(distinctDirectAssertionCallCount(testFile, implementationFile)).toBeGreaterThan(0);
expect(axis(finding, "targeted_test")?.state).toBe("satisfied");
```

- [x] Write failing tests for flat object arguments and reject spreads, computed keys, nested objects, calls, dynamic values, comments, multiple imports, and stale suites.
- [x] Run `pnpm vitest run src/lib/evidence-relation.test.ts src/lib/english-observation-evidence-regression.test.ts` and confirm RED.
- [x] Implement non-evaluating canonical literal parsing and require direct assertion evidence for changed-target targeted-test proof.
- [x] Run the focused suites and confirm GREEN.
- [x] Commit the parser and verifier change.

### Task 3: Receipt validation and privacy closure

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/report-validation.ts`, `src/lib/verifier.ts`, `src/lib/report-share.ts`
- Test: `src/lib/report-validation.test.ts`, `src/lib/report-share.test.ts`, `src/lib/server-report-store.test.ts`

**Interfaces:**
- Produces versioned private source-chain and changed-target receipts with IDs, refs, enum, and assertion count only.
- Rejects malformed chains, cross-requirement reuse, unresolved refs, and private receipt leakage.

```ts
expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: false, errors: expect.any(Array) });
expect(JSON.stringify(sanitizeReportForShare(report))).not.toContain("test_subject_chain");
```

- [x] Write failing validator and projection tests for forged chain fields, cloned target/test relations, and raw-data leakage.
- [x] Run `pnpm vitest run src/lib/report-validation.test.ts src/lib/report-share.test.ts src/lib/server-report-store.test.ts` and confirm RED.
- [x] Add closed schemas, full-validator invariants, and summary/share omission.
- [x] Run the focused privacy and validation suites and confirm GREEN.
- [x] Commit the receipt boundary change.

### Task 4: Corpus integration and regression gates

**Files:**
- Modify: `src/lib/english-observation-evidence-regression.test.ts`, `src/lib/external-verifier-regression.test.ts` only if an expected generalized holdout must be added.

```ts
expect(axis(testSibling, "targeted_test")?.state).toBe("satisfied");
expect(semanticContinuation?.evidenceStatus).not.toBe("met");
```

- [x] Add generated-report tests for the accepted subject-chain shape, unique unchanged-helper owner, and semantic-return claim remaining Partial.
- [x] Run the exact focused relation, parser, verifier, validator, privacy, and external holdout suite.
- [x] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check`.
- [x] Re-read the spec against the diff; verify no fixture IDs, raw evidence fields, or contract-outcome changes appear.
- [x] Commit integration tests and documentation.
