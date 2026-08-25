# Phase 1 — Criterion Ownership and Evaluator Boundary Design

**Depends on:** Phase 0

**Status:** Implemented and locally verified on 2026-08-25

**Promotion state:** Off

## Implementation evaluation record

**State:** Implemented on the isolated branch; no commit, push, or deployment.

- Added a closed, server-only capability allowlist whose default is empty.
- Added criterion-owned axis metadata and private full-validation closure so
  observation axes cannot satisfy a typed criterion or be reused across one.
- Checked with capability-policy, criterion-axis, verifier, report-validation,
  and runtime-validation regressions, then the Phase 0–2 full verification
  commands recorded in the program design.

**Not implemented:** activation of `test_case`, `workflow_job`, or
`return_value`.

## 1. Goal

Connect every typed contract criterion to criterion-owned proof axes and one
server-selected evaluator boundary. Keep unrelated implementation, test, and
CI facts as observation axes that cannot affect contract aggregation.

## 2. Minimal architecture

Reuse the existing `criterionAxisIdV2`, `CriterionAxisV2`,
`CriterionAxisReferenceV2`, `VerificationCriterionEvaluationV2`, and
`validateCriterionAxisClosureV2` primitives.

Do not add a generic evaluator class or a universal receipt. Keep one closed
dispatch function:

```ts
interface VerificationCriterionEvaluationInputV2 {
  criterion: MaterializedVerificationCriterionV2;
  bindingDigest: string;
  evidence: VerificationCriterionEvidenceV2;
}

function evaluateMaterializedCriterionV2(
  input: VerificationCriterionEvaluationInputV2
): VerificationCriterionEvaluationV2;
```

The dispatcher selects a type-specific pure evaluator. Unsupported collection
returns `unavailable`; it never falls back to requirement prose, Check names,
or an LLM.

## 3. Axis ownership

Extend `RequirementProofAxis` compatibly for v1 reads:

```ts
interface RequirementProofAxis {
  axisId?: string;
  role?: "criterion" | "observation";
  criterionId?: string;
  // existing fields remain unchanged
}
```

For newly generated v2 reports these fields are mandatory:

- criterion axis: canonical `axisId`, `role="criterion"`, exact
  `criterionId`;
- observation axis: canonical observation ID, `role="observation"`, no
  `criterionId`;
- criterion result `proofAxisRefs`: exactly the criterion's required axes;
- no axis belongs to two criteria; and
- observation axes never appear in criterion result `proofAxisRefs`.

Required axes derive only from the typed criterion via
`requiredEvidenceForCriterionV2`. Objective wording cannot add or remove a
criterion axis.

Observation axes use the existing v2 design form
`obs_<requirementId>_<subject>_<ordinal>`. Within each requirement, candidates
are sorted by subject, polarity, collection basis, then the lexicographically
sorted evidence-ref tuple. `ordinal` is the one-based position within the
subject. The same input therefore produces the same ID regardless of discovery
iteration order.

Subject/collection-basis compatibility is not redefined here. The sole runtime
matrix remains `PROOF_AXIS_COLLECTION_BASES_BY_SUBJECT` in
`src/lib/proof-contract.ts`; generator and validator both consume it. A new
basis requires a separate spec and a change to that closed matrix.

## 4. Independent validation

The generator may create axes and references, but full validation must
independently recompute the expected criterion IDs, axis IDs, subjects,
polarity, ownership, and evidence compatibility from transient bound contract
context.

Extend the existing private `VerificationValidationContextV2` and
`createVerificationValidationContextV2` in `src/lib/report-validation.ts`;
do not create a second context type. The context must include the materialized
criterion plan and the type-specific transient evidence needed for the enabled
evaluator. Its only trusted caller is
`validateRuntimeReportBoundary({ boundary: "generated_private_full", ... })`
in `src/lib/report-runtime-validation.ts`, which rebuilds it from the original
`PullRequestInput`. `inbound_untrusted_full`, summary, tenant, share, and read
boundaries never accept caller-supplied validation context.

The validator must call criterion-axis closure for every active v2 objective
and reject:

- missing, duplicate, extra, or reordered criterion ownership;
- cross-requirement or cross-criterion axis reuse;
- observation axes referenced as criterion proof;
- criterion axes with unsupported evidence kind or collection basis;
- satisfied criteria with incomplete required axes; and
- outcome/result/axis disagreement.

The validator must not call a verifier helper that returns the generator's
boolean decision. Shared canonical hashing and schema parsing are allowed;
state evaluation must remain independent.

## 5. Expected files

- Modify `src/lib/types.ts` compatibly.
- Modify `src/lib/verification-contract-v2.ts` only where existing closure
  primitives need v2 report integration.
- Create `src/lib/criterion-axis-v2.ts` for construction only if keeping the
  logic in `verifier.ts` would add another large responsibility.
- Modify `src/lib/verifier.ts` to build criterion and observation axes from
  different inputs.
- Modify `src/lib/verification-criterion-evaluator-v2.ts` to dispatch from the
  materialized criterion boundary.
- Modify `src/lib/report-validation.ts` to recompute and enforce closure.
- Modify `src/lib/report-runtime-validation.ts` only to extend creation and
  routing of the existing private validation context.
- Add focused tests beside each changed module.

No new dependency is permitted.

## 6. RED acceptance matrix

1. Return-value objective text without the word “test” still receives the
   typed criterion's implementation, targeted-test, and execution axes.
2. Adding harmless prose to the objective does not change required axes.
3. Unrelated passing test and CI facts remain observation axes.
4. Copying an axis or result from another criterion makes `v2_full` invalid.
5. Removing one required axis makes `v2_full` invalid.
6. Changing `criterionId`, requirement ID, subject, polarity, or evidence ref
   makes `v2_full` invalid.
7. Absent and invalid contracts contain observation axes only and remain
   `unclear`.
8. Legacy v1 reports remain readable without new axis fields.

## 7. Completion gate

- production generation invokes criterion-axis construction;
- `v2_full` invokes independent criterion-axis closure;
- every active criterion result has one-to-one owned axis references;
- no positive promotion is enabled; and
- Phase 0 output consistency still passes.

## 8. Stop and rollback

Stop if satisfying closure requires treating observation evidence as
criterion evidence, adding fixture-specific matching, or changing source
authority. Rollback removes the new axis integration and keeps promotion off;
the report remains observation-only and conservative.
