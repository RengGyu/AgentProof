# Grounded Requirement Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and execute each task with a RED/GREEN cycle.

**Goal:** Preserve safe objective labels and reject unsupported semantic guidance while keeping tenant reports private, compatible, and concise.

**Architecture:** Extend the signed tenant projection with optional bounded metadata, carry deterministic proof gaps in the server-only semantic validator catalog, and make the dashboard consume complete accepted sentences only. No raw provider or repository content is added to public or tenant projections.

**Tech Stack:** TypeScript, Vitest, Next.js, signed JSON tenant report contract.

## Global Constraints

- Deterministic evidence remains authoritative.
- No raw Issue/PR body, patch, source file, log, provider payload, token, or URL persistence.
- Existing version-1 persisted reports remain valid.
- No fixture, repository, PR number, path, or exact known output is used as product logic.

---

### Task 1: Signed objective label and analysis context

**Files:**
- Modify: `src/lib/tenant-report-validation.ts`
- Modify: `src/lib/server-report-store.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/report-validation.ts`
- Test: `src/lib/server-report-store.test.ts`
- Test: `src/lib/tenant-report-language.test.ts`

**Interfaces:**
- Produces: optional `VerificationReport.analysisContext` and `TenantPersistedReport.requirements[].objectiveLabel`.
- Consumes: deterministic requirement text before tenant sanitization.

- [ ] Add tests proving a safe short objective survives persistence and hydration, unsafe/raw text does not, a legacy report without the field remains valid, and no-objective unlinked context survives storage.
- [ ] Run the focused tests and confirm they fail for missing fields or the current `provided_requirement` fallback.
- [ ] Add the optional signed fields and strict validation with bounded label admission.
- [ ] Re-run focused tests until green.

### Task 2: Deterministic semantic gap mapping

**Files:**
- Modify: `src/lib/llm-semantic-package.ts`
- Test: `src/lib/llm-semantic-package.test.ts`

**Interfaces:**
- Produces: server-only proof entries containing exact deterministic gap kinds.
- Consumes: proof-graph nodes and semantic candidate units.

- [ ] Add table-driven tests for every semantic gap/request type against matching, non-matching, and empty deterministic gap sets.
- [ ] Run tests and confirm unsupported gaps/remediations currently survive.
- [ ] Implement exact mapping and drop unsupported units independently.
- [ ] Add raw/full source-file and file-content request cases to the privacy filter.
- [ ] Re-run focused tests until green.

### Task 3: Complete concise text

**Files:**
- Modify: `src/lib/dashboard-requirement-view-model.ts`
- Test: `src/lib/dashboard-requirement-view-model.test.ts`
- Test: `src/lib/dashboard-report-export.test.ts`

**Interfaces:**
- Consumes: accepted semantic text and persisted objective labels.
- Produces: complete bounded dashboard and Markdown strings.

- [ ] Add tests showing an overlong single sentence is omitted instead of cut and punctuated, while a complete short sentence is retained.
- [ ] Run tests and confirm current clipping behavior fails the contract.
- [ ] Replace clipping with complete-text admission and deterministic fallback.
- [ ] Verify dashboard and Markdown parity.

### Task 4: Integration and release verification

**Files:**
- Test existing report storage, semantic runtime, dashboard, export, worker, and privacy suites.

- [ ] Run focused regression tests.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm lint`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check` and inspect the final diff for unrelated/user-owned files.
- [ ] Obtain independent skeptical and privacy reviews, resolve P0/P1 findings, then repeat the full verification gate.
