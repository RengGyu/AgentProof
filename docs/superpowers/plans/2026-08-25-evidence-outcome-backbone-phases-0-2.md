# Evidence–Outcome Backbone Phases 0–2 Implementation Plan

**Status:** Completed locally on the isolated branch; no commit, push, or deployment performed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement safe authoritative outcome presentation, criterion-owned axis closure, and the deterministic documentation/path-absence evaluators without enabling new behavioral promotion.

**Architecture:** Preserve `VerificationReportV2` and its default-off local-promotion policy. Add a pure presentation projection used by every renderer; derive v2 criterion axes from materialized criteria rather than prose; then make documentation and absence results use exact-head and complete-inventory evidence through the existing generated-private validation boundary.

**Tech Stack:** TypeScript, Next.js, Vitest, existing GitHub collector/runtime validator/tenant projection.

**Spec:**
- `docs/superpowers/specs/2026-08-25-evidence-outcome-backbone-program-design.md`
- `docs/superpowers/specs/2026-08-25-phase-0-authoritative-output-safety-design.md`
- `docs/superpowers/specs/2026-08-25-phase-1-criterion-ownership-design.md`
- `docs/superpowers/specs/2026-08-25-phase-2-static-evaluator-closure-design.md`

## Global Constraints

- Work only on baseline `origin/main` at or after `78736c2b7bbda9069edaf75ab7d5b4a2a3f75544`.
- `AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE` remains `off`; no Phase 0–2 task enables `receipt_v2` in production.
- Add the closed server-only capability allowlist with an empty default; API callers cannot set it.
- Preserve v1 reads and the v2 report schema with additive fields only.
- Observations never promote a typed criterion; LLM output cannot alter criteria, axes, or outcomes.
- `generated_private_full` is the sole trusted creator of a new satisfied v2 criterion result.
- Public/share, tenant, Markdown, Slack, comment, export, and telemetry omit raw source, blobs, inventories, receipts, tokens, and workflow tuples.
- Do not commit, push, deploy, or mutate external GitHub/Supabase state in this plan.

---

### Task 1: Phase 0 outcome presentation

**Files:**
- Create: `src/lib/requirement-presentation-v2.ts`
- Test: `src/lib/requirement-presentation-v2.test.ts`
- Modify: `src/lib/verifier.ts`, `src/components/ReportView.tsx`, `src/lib/dashboard-requirement-view-model.ts`, `src/lib/dashboard-report-export.ts`, `src/lib/markdown.ts`, `src/lib/slack.ts`
- Test: existing renderer/verifier tests plus focused tests

**Interfaces:**

```ts
export interface RequirementPresentationV2 {
  requirementId: string;
  outcome: RequirementStatus;
  observedEvidence: RequirementStatus;
  authority: VerificationContractStateV2;
  outcomeLabel: string;
  outcomeBasis: string;
  observationLabel: string;
  primaryGap: string | null;
}

export function deriveRequirementPresentationV2(
  report: VerificationReportV2,
  requirementId: string
): RequirementPresentationV2;
```

- [ ] **Step 1: Write failing presentation tests**

Test the closed authoritative/author-claim/absent/invalid mappings and the primary-gap ordering from the phase-0 specification. Add a regression where observations are `met` but the authoritative outcome is `unclear`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm vitest run src/lib/requirement-presentation-v2.test.ts`

Expected: FAIL because the projection module does not exist.

- [ ] **Step 3: Implement the pure projection**

Create the module with closed label/basis tables. Read `report.verificationContract.gaps` first, then criterion results in stored objective/criterion order. Do not read legacy summary, LLM content, raw evidence, or environment.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `pnpm vitest run src/lib/requirement-presentation-v2.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing renderer integration tests**

Add one v2 fixture with high observation coverage and `unclear` strict outcome. Assert dashboard, Markdown, Slack, and ReportView use the strict outcome and separately label observed evidence.

- [ ] **Step 6: Run renderer tests to verify RED**

Run the exact focused test files before renderer changes. Expected: at least one assertion fails because a legacy field still supplies the answer.

- [ ] **Step 7: Wire the projection into renderers and preserve observation nodes**

Keep `requirements[].status` as strict outcome and `evidenceStatus` as observation. In `applyStrictContractOutcomeV2`, do not overwrite `proofGraph.nodes[].status`; renderers must use `deriveRequirementPresentationV2` instead of priority/coverage/CI to form an authoritative answer.

- [ ] **Step 8: Run focused Phase 0 tests**

Run: `pnpm vitest run src/lib/requirement-presentation-v2.test.ts src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts src/lib/slack.test.ts src/lib/verifier.test.ts`

Expected: PASS.

### Task 2: Phase 1 capability policy and criterion-owned axes

**Files:**
- Create: `src/lib/verification-capability-policy-v2.ts`
- Test: `src/lib/verification-capability-policy-v2.test.ts`
- Modify: `src/lib/types.ts`, `src/lib/verification-contract-v2.ts`, `src/lib/verifier.ts`, `src/lib/report-validation.ts`, `src/lib/report-runtime-validation.ts`
- Test: `src/lib/verification-contract-v2.test.ts`, `src/lib/report-validation.test.ts`, `src/lib/report-runtime-validation.test.ts`, `src/lib/verifier.test.ts`

**Interfaces:**

```ts
export type VerificationCapabilityV2 =
  | "documentation_literal"
  | "path_change_absence"
  | "test_case"
  | "workflow_job"
  | "return_value";

export function readEnabledVerificationCapabilitiesV2(
  value?: string | undefined
): ReadonlySet<VerificationCapabilityV2>;
```

For newly generated v2 axes, `axisId`, `role`, and `criterionId` are required;
legacy v1 reads keep them optional.

- [ ] **Step 1: Write failing capability-policy and axis-closure tests**

Cover empty/unknown/duplicate capability configuration, return-value required axes derived without objective keyword matching, cross-criterion axis reuse, missing required axis, and observation axis reuse as proof.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `pnpm vitest run src/lib/verification-capability-policy-v2.test.ts src/lib/verification-contract-v2.test.ts src/lib/report-validation.test.ts`

Expected: FAIL because the policy and v2 axis integration are absent.

- [ ] **Step 3: Implement closed capability policy**

Default to an empty set. Treat blank, duplicated, or unknown tokens as an empty set. Gate `satisfied` criterion results by capability. Keep `receipt_v2` as the additional lower-level gate for test/execution capabilities.

- [ ] **Step 4: Build v2 criterion axes from materialized criteria**

Extend the current proof-axis representation additively. For typed contracts, construct criterion axes from `requiredEvidenceForCriterionV2`, use `criterionAxisIdV2`, keep prose-derived facts as observation axes, and populate criterion `proofAxisRefs` only with their owned axes.

- [ ] **Step 5: Extend private runtime validation context and independent closure**

Extend the existing `VerificationValidationContextV2` with the materialized criterion plan and evaluator context. `generated_private_full` rebuilds this context from `PullRequestInput`; reduced/untrusted boundaries do not accept it. Full validation recomputes axis IDs, ownership, subject/basis compatibility, references, and result/outcome agreement.

- [ ] **Step 6: Run focused Phase 1 tests**

Run: `pnpm vitest run src/lib/verification-capability-policy-v2.test.ts src/lib/verification-contract-v2.test.ts src/lib/report-validation.test.ts src/lib/report-runtime-validation.test.ts src/lib/verifier.test.ts`

Expected: PASS with no enabled capability by default.

### Task 3: Phase 2 exact-head documentation evaluator

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/github.ts`, `src/lib/verifier.ts`, `src/lib/verification-criterion-evaluator-v2.ts`, `src/lib/report-validation.ts`
- Test: `src/lib/verification-criterion-evaluator-v2.test.ts`, `src/lib/github.test.ts`, `src/lib/report-validation.test.ts`, `src/lib/verifier.test.ts`

**Interfaces:**

```ts
type EvidenceKind = /* existing kinds */ | "artifact";

interface VerificationCriterionEvidenceV2 {
  artifactBlobs: Array<{ path: string; content: string }>;
  evidenceRefsByPath: Record<string, string[]>;
}
```

- [ ] **Step 1: Write failing exact-head artifact tests**

Cover unchanged exact-head documentation with a literal, missing literal, head/blob mismatch, over-limit blob, and forged artifact evidence reference.

- [ ] **Step 2: Run evaluator/collector tests to verify RED**

Run: `pnpm vitest run src/lib/verification-criterion-evaluator-v2.test.ts src/lib/github.test.ts src/lib/report-validation.test.ts`

Expected: FAIL because unchanged blobs have no report-safe artifact evidence ref and capability default is disabled.

- [ ] **Step 3: Add bounded artifact evidence**

Reuse collector limits of 8 declared paths and 64 KiB UTF-8 per path. Emit one `artifact` evidence-index item per successfully fetched exact-head path, but retain blob content only in transient input. Require exact head and capability enablement before `satisfied`.

- [ ] **Step 4: Run focused documentation tests**

Run the command from Step 2. Expected: PASS.

### Task 4: Phase 2 rename-aware absence and trusted persistence

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/github.ts`, `src/lib/verifier.ts`, `src/lib/verification-criterion-evaluator-v2.ts`, `src/lib/report-validation.ts`, `src/lib/tenant-report-validation.ts`, `src/lib/server-report-store.ts`
- Test: `src/lib/github.test.ts`, `src/lib/verification-criterion-evaluator-v2.test.ts`, `src/lib/report-validation.test.ts`, `src/lib/tenant-report-validation.test.ts`, `src/lib/server-report-store.test.ts`

- [ ] **Step 1: Write failing rename/persistence tests**

Cover prohibited `previous_filename`, missing previous name for a rename, incomplete/pasted inventory, satisfied absence with no fake evidence refs, and trusted save/read preserving a validated satisfied absence.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `pnpm vitest run src/lib/github.test.ts src/lib/verification-criterion-evaluator-v2.test.ts src/lib/report-validation.test.ts src/lib/tenant-report-validation.test.ts src/lib/server-report-store.test.ts`

Expected: FAIL because prior paths are not collected and tenant validation rejects a valid ref-free absence result.

- [ ] **Step 3: Preserve current and prior paths and evaluate absence**

Add normalized optional prior path to changed-file collection. Missing prior name for a GitHub rename makes inventory incomplete. Only a complete pure-GitHub inventory can satisfy absence. Pasted/mixed, stale, capped, or permission-limited inventory is unavailable.

- [ ] **Step 4: Align trusted persistence**

Allow a ref-free satisfied absence only after `generated_private_full` validation and report authenticity. Tenant/read validators verify the signed projection structurally but never recompute absence from reduced data. Do not retain raw inventories or blobs.

- [ ] **Step 5: Run focused Phase 2 tests**

Run the command from Step 2. Expected: PASS.

### Task 5: Cross-phase verification

**Files:**
- Test only; no feature expansion

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run type and production build checks**

Run:

```bash
pnpm typecheck
pnpm build
git diff --check
```

Expected: all exit 0.

- [ ] **Step 3: Run targeted privacy/projection regression checks**

Run: `pnpm vitest run src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts src/lib/server-report-store.test.ts src/lib/dashboard-report-export.test.ts src/lib/slack.test.ts`

Expected: PASS with no raw artifact blob, inventory, receipt, source binding, or workflow tuple in a reduced projection.
