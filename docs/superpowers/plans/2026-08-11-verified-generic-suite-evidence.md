# Verified Generic Suite Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link a generic passing test suite to a requirement only when bounded GitHub Actions metadata proves it covers a changed, requirement-linked test artifact.

**Architecture:** GitHub collection emits normalized, non-raw suite observations. The verifier consumes those observations to produce a requirement-local execution link, and the full validator verifies the exact source and artifact chain. UI copy uses the existing proof axes and gap order.

**Tech Stack:** Next.js, TypeScript, Vitest, GitHub REST API.

## Global Constraints

- Preserve deterministic-first report generation and the signed v1 report contract.
- Store only normalized runner/scope metadata, safe paths, and existing evidence references; never raw logs, workflow YAML, or manifest content.
- Fail closed for unknown command scopes, filtered suites, missing Actions permission, timeout, or capped metadata.
- A suite-level link proves test execution coverage only; it cannot prove interaction, visual quality, correctness, safety, or merge readiness.

---

### Task 1: Normalize bounded suite observations

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/github.ts`
- Test: `src/lib/github.test.ts`

**Interfaces:**
- Produces `ExecutionSuiteObservation` on `PullRequestInput.executionSuites` with a successful job source, normalized runner, unfiltered scope, and changed test paths.

- [x] Write a failing GitHub collector test for `Run npm test` resolved to `node --test` at the PR head and a changed `test/*.test.js` path.
- [x] Run `pnpm vitest run src/lib/github.test.ts` and confirm the test fails because no suite observation exists.
- [x] Add the minimal normalized observation type and bounded collector/parser.
- [x] Run the focused test and confirm it passes.

### Task 2: Build requirement-local verified-suite links

**Files:**
- Modify: `src/lib/verifier.ts`
- Modify: `src/lib/report-validation.ts`
- Test: `src/lib/verifier.test.ts`
- Test: `src/lib/report-validation.test.ts`

**Interfaces:**
- Consumes `PullRequestInput.executionSuites`.
- Produces a `passing_suite_execution` execution proof axis only with a same-head supported suite and requirement-linked changed test artifact.

- [x] Write failing verifier tests for linked generic suite success, unrelated suite rejection, and filtered-suite rejection.
- [x] Run the focused verifier tests and confirm the expected execution assertions fail.
- [x] Implement requirement-local suite linking and add the collection basis.
- [x] Add full-validator tests rejecting forged or incomplete suite links.
- [x] Run focused verifier and validator tests until green.

### Task 3: Preserve interaction/visual boundaries and concise gaps

**Files:**
- Modify: `src/lib/verifier-proof-expectations.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/verifier.ts`
- Modify: `src/lib/tenant-report-language.ts`
- Test: `src/lib/verifier.test.ts`

**Interfaces:**
- Adds `interaction` only for explicit UI action/surface requirements.
- Emits interaction evidence gap before generic execution absence when the suite execution link already exists.

- [x] Write a failing PR #5-shaped generic test: suite execution is satisfied while interaction is incomplete.
- [x] Run the focused verifier test and confirm it fails.
- [x] Add the interaction axis and deterministic gap ordering.
- [x] Run the focused verifier test until green.

### Task 4: Verify integration and document operator prerequisite

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-verified-generic-suite-evidence-design.md`
- Test: `src/lib/github.test.ts`, `src/lib/verifier.test.ts`, `src/lib/report-validation.test.ts`

- [x] Add regression cases for missing Actions metadata, docs-only objectives, test-only objectives, related failed execution, and unrelated failures.
- [x] Run `pnpm vitest run src/lib/github.test.ts src/lib/verifier.test.ts src/lib/report-validation.test.ts`.
- [x] Run `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check`.
- [x] Record that GitHub App `Actions: Read` is required for live suite links and that all other cases fail closed.
