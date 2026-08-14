# English Observation Evidence Correction Design

**Status:** Approved design; implementation in progress on the isolated branch.
This document does not authorize deployment, migration, or repository setting
changes.

**Extends:**
`2026-08-13-verification-contract-v2-design.md` and
`2026-08-13-verification-contract-v2-evaluation-closure-design.md`.

## Goal

Correct English-only observed-evidence classification and association without
changing verification-contract outcomes. A missing or invalid contract still
produces `unclear`.

## Required behavior

1. **Keep outcome and observation gaps separate.** Absent/invalid contract basis
   and its closed v2 gap are report-level and rendered once. Requirement and
   proof-node collections retain only local observation or criterion gaps. The
   layers never overwrite, duplicate, or authorize each other.
2. **Build deterministic English proof obligations in BASE.** Use the current
   requirement plus bounded, provenance-bound context from the same selected
   source. Context relationships never change objective authority or contract
   state. Optional planner output must not change axes, evidence links, gaps, or
   status.
3. **Treat reviewer-visible UI claims as presentation evidence.** A closed,
   versioned English predicate combines recognized review/user context, UI
   surface, and presentation verb. It maps #7-shaped `visible before review`
   wording to the existing `visual` observation axis, rejects non-UI visibility
   wording, and never creates a contract criterion. Helper code and unit tests
   alone do not satisfy it.
4. **Resolve antecedents narrowly.** `it`, `this workflow`, or `the job` may
   inherit CI modality only from one unique, immediately preceding requirement
   in the same source group. Headings, competing subjects, or missing identity
   keep the association incomplete.
5. **Separate test relevance from case coverage.** Relevance requires an
   unambiguous, deterministically resolved test-to-exact-head implementation
   path/export edge. Symbol-name coincidence, shared helpers, multi-target
   barrels, or multiple antecedents remain incomplete. `Both paths` observation
   may be satisfied only when every unique case maps to closed parser evidence
   and exact-head execution; this never creates or satisfies a contract criterion.

## Data flow

```text
source spans + bounded context
-> English proof obligations
-> deterministic artifact relationships
-> observation axes and local gaps
-> independent contract outcome
-> dashboard / Markdown with both layers
```

Workflow evidence must match the complete workflow-job identity tuple defined
by the evaluation-closure design §6.3. A subset or generic Check identity is
insufficient.

## Implementation boundaries

- `extractors.ts` and `verifier-proof-expectations.ts`: produce bounded English
  context and proof obligations.
- `verifier.ts`: build artifact relationships and preserve observation gaps
  before applying the independent contract outcome.
- `types.ts`, `proof-contract.ts`, and `report-validation.ts`: enforce the
  compatible gap/axis schema and reject inconsistent evidence.
- Dashboard/Markdown view models and frozen regression tests: render both layers
  and lock the English acceptance cases.

## Acceptance

- A missing contract never hides a local visual, interaction, test, or execution
  gap and never promotes an outcome beyond `unclear`.
- A #7-shaped helper plus unit test remains visual-evidence incomplete.
- A #18-shaped explicit workflow antecedent links Node 22 and `npm test` only to
  the uniquely identified exact-head workflow job.
- A #22-shaped related test is linked, but its targeted-test/case-coverage
  observation is satisfied only when both cases and their execution are
  deterministically established.
- Planner available, unavailable, or contradictory produces identical
  deterministic observations.
- Frozen English regressions and existing holdouts pass with no PR-number-based
  branches.
- Negative holdouts for non-UI `visible`, interrupted or ambiguous antecedents,
  symbol collisions, multi-target barrels, and filtered, mismatched, or stale
  suite execution all fail closed.

## Frozen local regression suite

`src/lib/english-observation-evidence-regression.test.ts` uses only local,
synthetic requirement and evidence inputs. The fixtures are representative of
the acceptance shapes without embedding real pull-request payloads, branching
on pull-request numbers, or making GitHub, provider, or planner calls.

The suite freezes these boundaries independently:

- absent and invalid contracts keep every requirement outcome `unclear`, while
  report-level contract guidance and requirement-local observation gaps both
  remain present;
- helper and unit-test evidence for reviewer-visible UI remains incomplete on
  the `visual` axis without bounded visual or browser evidence;
- a unique adjacent workflow antecedent produces satisfied CI-configuration and
  execution observations, while competing workflow antecedents do not inherit
  CI identity;
- a direct import, two distinct literal assertion cases, exact-head discovered
  suite path, and passing execution satisfy the test observation only as a
  complete set; missing imports, barrel imports, ambiguous implementation
  identity, stale heads, and filtered suites remain incomplete.

`src/lib/dashboard-report-export.test.ts` separately asserts the public report
header's contract guidance and each requirement card's local gap, including the
bounded machine export. Neither layer is allowed to replace or duplicate the
other.

## Non-goals

- multilingual classification;
- new v2 contract criterion types;
- LLM-authored axes, evidence links, or statuses;
- trusting generic CI or import reachability as behavioral proof;
- new provider calls, raw-code persistence, or public privacy expansion.
