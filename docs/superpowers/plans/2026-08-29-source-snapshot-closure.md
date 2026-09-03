# Source Snapshot Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail closed when the live PR requirement source changes during collection, and prevent a pasted PR description from inheriting live GitHub authority.

**Architecture:** Keep raw GitHub source text transient. Capture the initial PR title/body and selected linked-Issue title/body, collect evidence, then re-fetch and compare those same source values before producing `PullRequestInput`. Treat source drift like head/base drift: do not silently fall back to pasted evidence. A pasted PR description changes the authority-bearing source, so it uses the existing conservative `pasted_evidence` provenance path and removes live contract/receipt inputs.

**Tech Stack:** TypeScript, Next.js server library, Vitest.

**Spec:** Approved Package A source-snapshot scope from the 2026-08-29 research; current candidate base is `origin/main@5ed9519c291b118d880bed538659fae8327aadb9`.

## Global Constraints

- Preserve existing `github_snapshot` behavior for a pure live GitHub input.
- Do not add a public typed-contract ingress, general-PR positive promotion, LLM decision path, UI change, or raw-source persistence.
- A source-drift error must not fall back to pasted evidence, even if a request also contains pasted fields.
- A pasted PR description must not retain live contract source/binding/artifact data, workflow identity, exact-head modules, or complete changed-file provenance.
- A compacted linked-Issue source must carry a bounded limitation and cannot silently imply a complete objective set.
- Existing v2 authority boundaries remain unchanged: provided/linked source can be authoritative; PR description is author claim; invalid contract stays invalid.

---

### Task 1: Specify source-drift and pasted-description behavior with RED tests

**Files:**
- Modify: `src/lib/github.test.ts`
- Modify: `src/lib/github-pasted-provenance.test.ts`

**Interfaces:**
- Consumes: `buildPullRequestInput()`, `mergePastedEvidenceForAnalysis()`.
- Produces: failing tests for PR-source drift, linked-Issue-source drift, no pasted fallback after source drift, and pasted-description authority downgrade.

- [x] **Step 1: Write the pasted-description authority test**

Add a test that merges `livePositiveInput()` with only `prDescription: "Updated PR description."` and asserts the observable conservative boundary:

```ts
expect(merged.sourceProvenance).toMatchObject({ origin: "pasted_evidence" });
expect(merged.verificationContractSourceV2).toBeUndefined();
expect(merged.verificationContractBindingV2).toBeUndefined();
expect(merged.verificationCriterionEvidenceV2).toBeUndefined();
expect(merged.requirementSourceIdentityHash).toBeUndefined();
expect(merged.executionSuites).toBeUndefined();
expect(merged.checks.every((check) => check.workflowExecutionIdentity === undefined)).toBe(true);
```

- [x] **Step 2: Run the pasted-description test to verify RED**

Run: `pnpm test src/lib/github-pasted-provenance.test.ts`

Expected: the new test fails because a description-only override currently retains `github_snapshot` provenance and live authority inputs.

- [x] **Step 3: Write the PR-source drift test**

In a GitHub fetch mock, return the same initial/final head and base SHAs but different PR bodies on the final `/pulls/12` response. Call `buildPullRequestInput()` with a pasted `changedFiles` field and assert rejection with `GitHub pull request source changed while AgentProof was collecting evidence.`

- [x] **Step 4: Write the linked-Issue-source drift test**

Use initial PR body `Fixes #42`. Return one Issue title/body when it is selected and a different body when it is rechecked; keep PR head/base/title/body unchanged. Assert the same source-drift rejection.

- [x] **Step 5: Run GitHub source-drift tests to verify RED**

Run: `pnpm test src/lib/github.test.ts`

Expected: both new tests fail because the collector currently rechecks only head/base.

- [x] **Step 6: Write the linked-Issue truncation test**

Return a linked Issue body longer than 5,000 characters for both initial selection and final recheck. Assert that the returned input has a limitation saying the Issue source was truncated and cannot establish a complete objective set; assert that the raw over-limit tail is absent from serialized input.

- [x] **Step 7: Run the truncation test to verify RED**

Run: `pnpm test src/lib/github.test.ts`

Expected: the test fails because bounded compaction currently has no explicit completeness limitation.

### Task 2: Close the source snapshot and pasted-description authority boundary

**Files:**
- Modify: `src/lib/github.ts`
- Test: `src/lib/github.test.ts`
- Test: `src/lib/github-pasted-provenance.test.ts`

**Interfaces:**
- Consumes: initial GitHub PR/Issue API responses and existing `GitHubPullRequestHeadChangedError` handling.
- Produces: `GitHubPullRequestSourceChangedError`, transient source comparison, and conservative pasted-description merge behavior.

- [x] **Step 1: Implement the pasted-description authority downgrade**

Make `hasPastedAuthorityOverride()` treat a non-empty `request.prDescription` as an override. Reuse the existing downgrade path; do not create a second provenance shape.

- [x] **Step 2: Add a bounded source-drift error**

Add `GitHubPullRequestSourceChangedError` with a fixed message only. Do not include title, body, Issue number, source text, token, or hash in the error. In `buildPullRequestInput()`, rethrow this error exactly as head/base drift is rethrown.

- [x] **Step 3: Capture and recheck PR source values**

Keep the initial title/body transient. Replace the final anchor-only helper with a final PR snapshot helper returning head SHA, base SHA, title, and body. After all evidence/artifact collection and before `PullRequestInput` is returned, compare initial and final title/body plus the existing head/base checks. Any difference throws the source-drift error.

- [x] **Step 4: Capture and recheck the selected linked Issue**

Keep the selected `SupportedIssueReference` and bounded title/body transient in `resolveLinkedIssueTaskText()`. After the final PR snapshot succeeds, fetch that same Issue once more. If re-fetch fails or its bounded title/body differs, throw the source-drift error. Do not select a different Issue or fall back to the PR description.

- [x] **Step 5: Mark bounded linked-Issue source text as incomplete**

Have `fetchLinkedIssue()` return whether its title or body was compacted. When a selected Issue was compacted, add one bounded limitation stating that it cannot establish a complete objective set. Keep the raw over-limit text transient and do not add a new report field.

- [x] **Step 6: Run focused tests to verify GREEN**

Run: `pnpm test src/lib/github.test.ts src/lib/github-pasted-provenance.test.ts src/lib/github-linked-issues.test.ts`

Expected: all tests pass; pure live GitHub input remains live and pasted-description input becomes conservative.

### Task 3: Verify Package A boundaries

**Files:**
- Verify: `src/lib/github.ts`
- Verify: `src/lib/github.test.ts`
- Verify: `src/lib/github-pasted-provenance.test.ts`

- [x] **Step 1: Run static checks**

Run: `pnpm typecheck && pnpm lint`

Expected: exit 0.

- [x] **Step 2: Run the full test suite**

Run: `pnpm test`

Expected: exit 0.

- [x] **Step 3: Run build and whitespace checks**

Run: `pnpm build && git diff --check`

Expected: exit 0.

- [x] **Step 4: Review scope before commit**

Confirm the diff contains only source snapshot/provenance behavior, tests, and this plan; it must not add a typed-contract request field, persist raw source/digest, modify report public schema, or enable new positive promotion.
