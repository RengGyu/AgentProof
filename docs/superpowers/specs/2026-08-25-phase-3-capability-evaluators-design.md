# Phase 3 — Deferred Capability Record

**Depends on:** Phases 0–2

**Status:** Historical/deferred; do not execute under the current goal

**Superseded by:**
`2026-08-26-existing-github-evidence-release-scope-design.md`

**Promotion state:** `test_case`, `workflow_job`, and `return_value` remain
`unavailable`.

## Decision

The former Phase 3 proposed three non-static capability projects:

1. exact per-test execution proof;
2. exact workflow-job criterion proof; and
3. AgentProof-controlled return-value execution.

They are not required for the current AgentProof release goal. AgentProof will
reuse evidence already available from GitHub instead of becoming an evidence
producer or code-execution service.

No Phase 3 production capability was implemented. The common default-deny
boundary from Phases 0–2 remains useful and is retained.

## Evidence checked

The rejected Vitest artifact design is recorded in:

- `2026-08-25-phase-3-vitest-json-test-case-design.md`; and
- `2026-08-25-phase-3-test-case-provenance-decision.md`.

That review found that a GitHub Actions artifact can identify a workflow run
and head but does not by itself provide a trustworthy artifact-to-producer-job
and attempt join. Adding a parser would therefore add complexity without
closing the proof boundary.

The current GitHub collector already preserves useful check, status, job, and
workflow identity observations. Those observations remain visible in reports
but do not prove exact test behavior, a declared workflow command, or a return
value.

## Explicitly inactive work

Do not add any of the following from this historical phase:

- Actions artifact collection or per-test result parsing;
- workflow YAML command parsing;
- producer attestation, OIDC, Sigstore, or signing infrastructure;
- an AgentProof-controlled repository-code executor;
- execution consent, runtime provisioning, or key lifecycle;
- capability activation for `test_case`, `workflow_job`, or `return_value`; or
- a universal receipt intended to cover unrelated evidence types.

The three contract types remain parseable only for v2 compatibility and return
`unavailable`.

## Future re-entry rule

This phase may be reconsidered only after a new product decision establishes a
real customer need that existing GitHub evidence cannot meet. Re-entry requires
a separate approved goal, measured pilot demand, privacy and operating-cost
limits, and a capability-specific design. It must not be reopened merely to
turn current `unavailable` results into positive results.

## Completion record

```text
STATE: deferred
PRODUCTION CODE: none
ACTIVE RELEASE CAPABILITIES: documentation_literal, path_change_absence
OBSERVATIONS RETAINED: changed files, checks, statuses, Actions job metadata
NEW PARSERS / EXECUTORS / ATTESTATION: none
```
