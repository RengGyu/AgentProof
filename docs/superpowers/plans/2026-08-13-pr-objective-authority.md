# PR Objective Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Present PR-body objectives with independent evidence coverage and source authority, while excluding evaluation-only prose from requirements.

**Architecture:** Keep the existing requirement status as the deterministic evidence result. Add an optional source-authority label derived solely from existing requirement provenance. Filter evaluation-only PR prose before it enters requirement extraction; preserve real behavioral and scope constraints.

**Tech Stack:** TypeScript, Vitest, Next.js report view models, JSON report validation.

## Global Constraints

- Deterministic evidence remains authoritative for coverage.
- A PR description never becomes an authoritative linked requirement.
- Preserve existing saved-report JSON compatibility with optional fields.
- Do not retain raw code, logs, tokens, or new provider content.

---

### Task 1: Classify PR-body evaluation prose

**Files:**
- Modify: `src/lib/extractors.ts`
- Test: `src/lib/extractors.test.ts`

- [x] Add a failing extraction test covering PR30-style requirements plus canary/evaluation prose, real scope constraints, and mixed headings.
- [x] Run the focused test and observe evaluation prose is incorrectly admitted.
- [x] Add minimal section-and-sentence role filtering so evaluation descriptions are not requirements but scope constraints remain.
- [x] Run the focused extraction suite.

### Task 2: Expose source authority independently of proof status

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/dashboard-requirement-view-model.ts`
- Modify: `src/lib/dashboard-report-export.ts`
- Test: `src/lib/dashboard-requirement-view-model.test.ts`
- Test: `src/lib/dashboard-report-export.test.ts`

- [x] Add failing view-model/export tests for a PR-stated objective with satisfied evidence and reviewer-confirmation authority.
- [x] Add an optional provenance-derived authority field without changing status semantics.
- [x] Render the authority label separately from evidence coverage.
- [x] Run focused presentation tests.

### Task 3: Preserve reports and test the behavior matrix

**Files:**
- Modify: `src/lib/report-validation.ts`
- Modify: `src/lib/server-report-store.ts` only if projection drops the optional field
- Test: `src/lib/report-validation.test.ts`
- Test: `src/lib/server-report-store.test.ts` only if storage changes

- [x] Add failing schema/storage regression tests for optional authority data and legacy reports.
- [x] Implement compatible validation/projection.
- [x] Run extractor, verifier, schema, presentation, and full regression suites; then typecheck, lint, build, and diff check.
