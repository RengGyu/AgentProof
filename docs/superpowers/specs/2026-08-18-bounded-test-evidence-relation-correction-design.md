# Bounded Test Evidence Relation Correction

**Status:** Proposed for user review. This document authorizes no implementation,
deployment, migration, or fixture-specific rule.

**Extends:** `2026-08-16-english-evidence-relation-closure-design.md`.

## Goal

Correct the remaining English test-evidence false negatives without merging
requirements broadly or weakening cross-requirement receipt isolation.

## Required behavior

1. A subjectless test objective may cross at most one identifier-free behavior
   continuation when all three requirements are consecutive, in the same selected
   source group, and exactly one earlier requirement names the code identifier
   resolved by the test's direct static import.
2. The intervening requirement must map to the same unique implementation
   artifact and must not introduce another code identifier, target, heading, or
   source boundary. Otherwise the relation stays incomplete.
3. Targeted-test evidence requires a direct imported-binding call inside an
   assertion and an exact-head suite covering the changed test path. Import reach
   alone and generic passing CI are insufficient.
4. The assertion parser may recognize scalars and bounded flat object literals
   with static keys and scalar values. It rejects spreads, computed keys,
   identifiers, calls, interpolation, nesting, deleted/commented code, and more
   than eight fields or cases. Parsing never executes code.
5. For an unchanged implementation, only the unique test requirement that
   explicitly names the resolved identifier may own the exact-head relation.
   Other requirements may not reuse its target/test receipt.
6. A semantic claim such as "returns the value unchanged" remains Partial unless
   a separate closed semantic assertion relation proves that comparison. This
   change does not infer that meaning from one related test.

## Private proof boundary

Add closed, versioned private receipts for the bounded subject chain and the
changed-target assertion relation. They contain requirement/source-binding refs,
test and implementation evidence refs, relation kind, and assertion case count.
They contain no source text, identifiers, paths, arguments, expected values, or
raw assertions. Public share, tenant summary, Markdown, telemetry, and generic
errors omit these receipts; existing cross-requirement reuse validation remains
mandatory.

## Acceptance

- One explicit identifier, one compatible continuation, one direct test, and a
  matching exact-head suite satisfy targeted-test and execution observations.
- A direct unchanged-helper test using a bounded flat object literal can satisfy
  the uniquely identified test objective.
- Multiple identifiers, multiple targets, two or more intervening requirements,
  headings, source boundaries, barrels, re-exports, aliases that do not resolve,
  mocks, dynamic imports, stale heads, and filtered or mismatched suites fail
  closed.
- Existing ambiguous-antecedent and cross-requirement receipt-reuse holdouts
  remain rejected.
- Contract outcomes do not change: absent or invalid remains Unclear, and
  PR-description contracts remain capped at Partial.
- Multilingual classification, general JavaScript evaluation, and semantic
  return-value proof are out of scope.

## Validation

Use RED/GREEN tests for every acceptance row, then run the focused relation,
parser, validator, privacy, frozen English corpus, external holdouts, full test,
typecheck, lint, build, and `git diff --check` gates. Production evaluation PRs
must be rerun from fresh heads before claiming the correction works live.
