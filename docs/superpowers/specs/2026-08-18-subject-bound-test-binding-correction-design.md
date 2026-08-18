# Subject-Bound Test Binding Correction

**Status:** Implemented locally and verified; uncommitted. This document does
not authorize a commit, deployment, or fixture-specific rule.

**Extends:**

- `2026-08-16-english-evidence-relation-closure-design.md`
- `2026-08-18-bounded-test-evidence-relation-correction-design.md`

## Goal

Remove the remaining English targeted-test false negative when one test file
imports the required function together with unrelated functions from the same
module.

The correction must bind evidence to one resolved requirement subject, not to
the total number of imports in the module.

## Verified problem

The requirement relation and implementation target are selected correctly, but
`distinctDirectAssertionCallCount()` returns zero whenever the target module has
more than one imported binding. A valid subject assertion is therefore rejected
when the test also imports an unrelated existing helper.

The current synthetic positive test contains only one imported binding, so it
does not reproduce the deployed mixed-binding shape.

## Required behavior

1. Resolve exactly one code subject from the closed requirement relation:
   - `test_subject_chain`: use its subject requirement;
   - unchanged exact-head test: use the explicitly named current test
     requirement.
2. Parse static bindings for the one resolved implementation target as bounded
   descriptors: exported name, local name, import kind, and direct-assertion
   count.
3. Select bindings by the resolved subject before applying uniqueness:
   - one matching binding: continue;
   - zero or multiple matching bindings: remain incomplete;
   - unrelated bindings from the same module do not invalidate the match.
4. Named or CommonJS aliases are valid only when the exported identifier matches
   the subject and the resolved local alias is called directly in an assertion.
   Default or module exports remain incomplete unless the existing export-edge
   rules prove one unambiguous subject binding.
5. At least one added, live assertion must invoke the selected local binding.
   Deleted code, comments, string contents, unchanged unrelated assertions, and
   import reach alone are not proof.
6. Use the same subject-aware selector for changed implementations and unchanged
   exact-head implementations. Do not add a fallback based on filenames,
   keywords, or generic passing CI.
7. Subject names and assertion contents remain transient. Existing private
   receipts keep only bounded refs, enums, and counts; public share, tenant
   summary, Markdown, telemetry, and generic errors receive no new fields.

## Expected outcomes

| Shape | Expected observation |
| --- | --- |
| One required binding plus unrelated imports, required binding directly asserted | Targeted test and exact-path execution may be Supported |
| Required binding imported through a valid alias and alias directly asserted | Supported when the export edge is unique |
| Two bindings match the subject | Partial / incomplete |
| Required binding is not directly asserted | Partial / missing targeted test |
| Subject exists only in unchanged context while unrelated lines change | Partial / incomplete |
| Competing behavior subjects with no unique resolved subject | Partial / incomplete |
| Barrel, re-export, mock, dynamic import, second target module, stale head, or mismatched suite | Partial / incomplete |
| No approved contract | Requirement outcome remains Unclear |

The existing conservative cases remain unchanged:

- a multi-behavior test objective without one resolved subject stays Partial;
- an explicitly named unchanged-helper test may own its receipt;
- a following semantic return-value claim stays Partial without a separate
  semantic assertion relation;
- global failed CI is not attached locally without the complete workflow
  identity tuple.

## Implementation boundary

- `src/lib/evidence-relation.ts`: return and filter bounded binding descriptors,
  then count assertions for the selected local binding.
- `src/lib/verifier.ts`: resolve the transient subject from the deterministic
  relation and pass it to both changed-target and exact-head selection.
- Focused relation/verifier tests: add production-shaped mixed-binding positives
  and ambiguous negative holdouts.

No report schema, contract outcome, multilingual classification, workflow
identity collection, or UI copy change is included.

## Validation

1. Record RED with a shape-based fixture containing one required and one
   unrelated binding from the same module.
2. Add positive coverage for changed-target and unchanged exact-head paths.
3. Add negative coverage for zero/multiple subject matches, missing direct
   assertion, unchanged-context-only assertion, invalid alias, barrel, mock,
   dynamic import, multiple targets, and mismatched suite/head.
4. Keep the existing ambiguous-subject, cross-requirement receipt-reuse,
   privacy, and contract-outcome holdouts green.
5. Run focused suites, frozen English and external holdouts, full tests,
   typecheck, lint, build, and `git diff --check`.
6. Obtain an independent skeptical review, deploy, rerun fresh English fixture
   heads, and compare the report structure with this table.

Production code and test names must not contain fixture PR numbers, repository
IDs, or branch names. A broader Supported result without one subject-bound
direct assertion is a rollback condition.
