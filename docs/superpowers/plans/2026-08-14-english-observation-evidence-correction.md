# English Observation Evidence Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep strict-contract outcomes fail-closed while making English observed-evidence gaps, UI proof obligations, workflow continuations, and related tests deterministic and visible.

**Architecture:** The verifier keeps contract-state guidance at report level and preserves local proof gaps. A deterministic BASE relation resolver derives only bounded English context before the proof graph is built; it never uses planner output. Test-file relevance is resolved through exact import/export relationships, while case coverage remains a distinct, fail-closed observation.

**Tech Stack:** TypeScript, Vitest, existing deterministic evidence index, report validation, dashboard Markdown export.

## Global Constraints

- Contract state never changes from evidence association; absent or invalid contracts always yield `unclear`.
- English only; do not add multilingual rules or new v2 contract criterion types.
- No provider call, raw-code persistence, token storage, or public-share field expansion.
- Context must be provenance-bound to the selected source and can never change objective authority.
- Generic CI, a symbol-name match, a barrel with multiple targets, or an ambiguous antecedent must fail closed.
- Every behavior change begins with a focused failing test and ends with the relevant focused suite passing.

---

### Task 1: Preserve report-level contract guidance and local observation gaps

**Files:**
- Modify: `src/lib/types.ts:310-335`
- Modify: `src/lib/verification-contract-v2.ts:146-180`
- Modify: `src/lib/verifier.ts:160-260`
- Modify: `src/lib/report-validation.ts:55-75, 191-290`
- Modify: `src/lib/dashboard-requirement-view-model.ts:56-125, 169-188`
- Modify: `src/lib/dashboard-report-export.ts:14-70`
- Modify: `src/lib/markdown.ts:234-252`
- Modify: `src/lib/report-share.ts`
- Test: `src/lib/verification-contract-v2-evaluation.test.ts`
- Test: `src/lib/dashboard-requirement-view-model.test.ts`
- Test: `src/lib/dashboard-report-export.test.ts`
- Test: `src/lib/markdown.test.ts`
- Test: `src/lib/report-share.test.ts`

**Interfaces:**
- Produces `verificationContract.gaps`, a bounded report-level array of closed contract gap signals.
- Preserves `RequirementFinding.gaps` and `ProofGraphNode.gapSignals` as local observations.
- Consumes the existing `VerificationContractStateV2`; neither existing report shape nor public share gains raw evidence.

- [ ] **Step 1: Write failing contract-gap isolation tests**

```ts
expect(report.verificationContract.gaps).toEqual([
  expect.objectContaining({ kind: "verification_contract_missing" })
]);
expect(report.proofGraph.nodes[0]?.gapSignals.map((gap) => gap.kind))
  .toContain("interaction_proof_missing");
expect(report.requirements[0]?.gaps).not.toContain("Approved verification contract is missing.");
```

Add a dashboard/export test asserting the contract guidance appears once in
report-level copy while a card renders its own observation gap.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run src/lib/verification-contract-v2-evaluation.test.ts src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts`

Expected: FAIL because `verificationContract.gaps` does not exist and strict
guidance replaces the local gap.

- [ ] **Step 3: Implement the minimum separation**

```ts
// strict finalization
const requirements = report.requirements.map((requirement) => ({
  ...requirement,
  evidenceStatus: requirement.evidenceStatus ?? requirement.status,
  status: outcome.status
}));

const nodes = report.proofGraph.nodes.map((node) => ({ ...node, status: outcome.status }));
```

Add the four v2 closed gap kinds, materialize absent/invalid guidance only on
`verificationContract.gaps`, validate it, and make the view/export layer render
contract guidance once without replacing `requirement.gaps`. Keep the portable
share projection schema-compatible by omitting report-level operational guidance
unless its existing allowlist explicitly supports a safe summary.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm vitest run src/lib/verification-contract-v2-evaluation.test.ts src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts src/lib/markdown.test.ts src/lib/report-share.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the completed task**

```bash
git add src/lib/types.ts src/lib/verification-contract-v2.ts src/lib/verifier.ts src/lib/report-validation.ts src/lib/dashboard-requirement-view-model.ts src/lib/dashboard-report-export.ts src/lib/markdown.ts src/lib/report-share.ts src/lib/verification-contract-v2-evaluation.test.ts src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts src/lib/markdown.test.ts src/lib/report-share.test.ts
git commit -m "fix: preserve observation gaps in strict reports"
```

### Task 2: Derive bounded English presentation and workflow obligations in BASE

**Files:**
- Modify: `src/lib/extractors.ts:137-180, 480-515`
- Modify: `src/lib/verifier-proof-expectations.ts:13-64`
- Modify: `src/lib/verifier.ts:57-65, 269-285, 1190-1255`
- Modify: `src/lib/report-validation.ts:1423-1505`
- Test: `src/lib/verifier-proof-expectations.test.ts`
- Test: `src/lib/requirement-relation-regression.test.ts`
- Test: `src/lib/report-validation.test.ts`

**Interfaces:**
- Add `deriveDeterministicRequirementRelations(input, requirements)` in
  `extractors.ts`, returning `proofExpectationsByRequirement` and
  `evidenceContextRequirementIdsByRequirement` keyed by existing requirement ID.
- Add `requirementProofAxisExpectationsWithContext(text, context)` in
  `verifier-proof-expectations.ts`; context is a closed relation descriptor, not
  free text or planner data.
- `generateVerificationReport()` passes both maps into
  `generateVerificationReportFromRequirements()`.

- [ ] **Step 1: Write failing relation tests**

```ts
expect(requirementProofAxisExpectationsWithContext(
  "Important checks should be visible before review starts.",
  { kind: "review_presentation" }
)).toMatchObject({ visual: true, interaction: false });

expect(requirementProofAxisExpectationsWithContext(
  "It must use Node.js 22 and run npm test.",
  { kind: "workflow_antecedent" }
)).toMatchObject({ ci: true, implementation: false, execution: true });
```

Add negative cases for non-UI `visible`, a heading break, two possible
workflows, and a non-anaphoric sentence. Each must retain its sentence-local
expectation and no context evidence map.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run src/lib/verifier-proof-expectations.test.ts src/lib/requirement-relation-regression.test.ts src/lib/report-validation.test.ts`

Expected: FAIL because no contextual expectation API or BASE relation map exists.

- [ ] **Step 3: Implement the closed resolver**

```ts
type DeterministicProofContext =
  | { kind: "none" }
  | { kind: "review_presentation" }
  | { kind: "workflow_antecedent"; requirementId: string };
```

Match spans only when their selected-source order and normalized text match the
BASE requirements. Admit a workflow antecedent only for an explicit anaphor,
one immediately preceding same-group workflow requirement, and no competitor.
Recognize presentation only through the versioned review/user + UI-surface +
presentation-verb predicate. Update full validation so a valid resolved
workflow continuation requires CI plus execution rather than its fallback
implementation axis; all other text keeps the existing deterministic floor.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm vitest run src/lib/verifier-proof-expectations.test.ts src/lib/requirement-relation-regression.test.ts src/lib/report-validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the completed task**

```bash
git add src/lib/extractors.ts src/lib/verifier-proof-expectations.ts src/lib/verifier.ts src/lib/report-validation.ts src/lib/verifier-proof-expectations.test.ts src/lib/requirement-relation-regression.test.ts src/lib/report-validation.test.ts
git commit -m "fix: derive bounded English proof context"
```

### Task 3: Link exact test imports and keep case coverage fail-closed

**Files:**
- Modify: `src/lib/evidence-relation.ts`
- Modify: `src/lib/verifier.ts:1670-1735, 2152-2215`
- Modify: `src/lib/proof-contract.ts:1-80`
- Modify: `src/lib/report-validation.ts:1515-1610`
- Test: `src/lib/requirement-relation-regression.test.ts`
- Test: `src/lib/verifier.test.ts`

**Interfaces:**
- Export `testImportMatchesImplementation(testFile, implementationFile)` from
  `evidence-relation.ts`; it resolves only a direct relative import/require to
  one changed implementation path.
- `targetedTestEvidenceRefsForRequirement()` uses the exact import edge after
  deterministic source context identifies one implementation subject.
- A related test can be cited while a generic `both paths` observation remains
  incomplete until two distinct direct invocation/assertion cases and exact-head
  suite execution are available.

- [ ] **Step 1: Write failing test-relationship tests**

```ts
expect(testImportMatchesImplementation(
  { path: "test/customer-display-name.test.js", patch: 'import { customerDisplayName } from "../src/customers/display-name.js";' },
  { path: "src/customers/display-name.js", patch: "" }
)).toBe(true);

expect(testImportMatchesImplementation(
  { path: "test/customer-display-name.test.js", patch: 'import { value } from "../src/index.js";' },
  { path: "src/customers/display-name.js", patch: "" }
)).toBe(false);
```

Add a #22-shaped report test: the focused test file is linked; one direct
assertion leaves `both paths` incomplete; two distinct direct calls plus an
exact-head suite make its observation complete. Add stale-head and filtered
suite negatives.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run src/lib/requirement-relation-regression.test.ts src/lib/verifier.test.ts`

Expected: FAIL because import edges and case coverage are not distinguished.

- [ ] **Step 3: Implement minimum deterministic relation and coverage checks**

```ts
const directImports = importedModuleSpecifiers(testFile.patch ?? "");
return directImports.some((specifier) => resolveRelativeImport(testFile.path, specifier) === implementationFile.path);
```

Only accept a related test for a uniquely resolved implementation path. For
`both paths` language, count distinct literal direct calls to the resolved
export inside assertions; require at least two and an existing exact-head suite
that includes the test path. Otherwise retain the related evidence reference
and emit an incomplete local evidence gap.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm vitest run src/lib/requirement-relation-regression.test.ts src/lib/verifier.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the completed task**

```bash
git add src/lib/evidence-relation.ts src/lib/verifier.ts src/lib/proof-contract.ts src/lib/report-validation.ts src/lib/requirement-relation-regression.test.ts src/lib/verifier.test.ts
git commit -m "fix: distinguish related tests from case coverage"
```

### Task 4: Freeze English regression behavior and verify public rendering

**Files:**
- Create: `src/lib/english-observation-evidence-regression.test.ts`
- Modify: `src/lib/dashboard-report-export.test.ts`
- Modify: `docs/superpowers/specs/2026-08-14-english-observation-evidence-correction-design.md`
- Test: `src/lib/english-observation-evidence-regression.test.ts`

**Interfaces:**
- Regression tests consume only local synthetic inputs shaped like #5, #7, #18,
  and #22; they do not call GitHub or branch on PR number.
- The test reports outcomes, observation axes, local gaps, and report-level
  contract guidance separately.

- [ ] **Step 1: Write the frozen cross-boundary test**

```ts
expect(noContract.requirements.every((item) => item.status === "unclear")).toBe(true);
expect(visualOnly.requirements[0]?.evidenceStatus).toBe("partial");
expect(workflowContinuation.requirements[1]?.proofAxes)
  .toEqual(expect.arrayContaining([expect.objectContaining({ subject: "ci_configuration", state: "satisfied" })]));
expect(ambiguousBarrel.requirements.at(-1)?.evidenceStatus).not.toBe("met");
```

Include explicit checks that #5-shaped observation gaps survive rendering,
#7-shaped helper-only evidence is incomplete, #18-shaped exact identity is
accepted, and #22-shaped ambiguity, stale head, and filtered suite fail closed.

- [ ] **Step 2: Run the new test and verify RED**

Run: `pnpm vitest run src/lib/english-observation-evidence-regression.test.ts`

Expected: FAIL until Tasks 1–3 are complete.

- [ ] **Step 3: Complete only fixture wiring and public-copy assertions**

Use existing report constructors and dashboard export APIs. Do not add runtime
branches, network calls, or fixture-specific production logic.

- [ ] **Step 4: Run focused and project verification**

Run:

```bash
pnpm vitest run src/lib/verification-contract-v2-evaluation.test.ts src/lib/verifier-proof-expectations.test.ts src/lib/requirement-relation-regression.test.ts src/lib/verifier.test.ts src/lib/report-validation.test.ts src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts src/lib/english-observation-evidence-regression.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Commit the completed task**

```bash
git add src/lib/english-observation-evidence-regression.test.ts src/lib/dashboard-report-export.test.ts docs/superpowers/specs/2026-08-14-english-observation-evidence-correction-design.md
git commit -m "test: freeze English observation evidence regressions"
```

## Plan self-review

- Spec coverage: Tasks 1–4 cover gap ownership, BASE-only English context,
  bounded workflow identity, test relevance/case coverage, rendering, privacy,
  and frozen negative holdouts.
- Placeholder scan: no deferred implementation steps or unnamed checks remain.
- Type consistency: relation maps use existing requirement IDs; the only new
  relation API is defined in Task 2 before Task 3 consumes it.
