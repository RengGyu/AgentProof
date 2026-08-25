# Evidence–Outcome Backbone Program Design

**Date:** 2026-08-25

**Status:** Phases 0–2 implemented and locally verified on the isolated branch;
the former Phase 3 expansion is deferred and Phase 4 is the next active phase

**Current scope:**
`2026-08-26-existing-github-evidence-release-scope-design.md`. It supersedes
the former Phase 3 implementation order without changing v2 schema
compatibility.

**Release state:** `NO_GO` for new requirement-level `met` promotion until all mandatory gates pass

**Implementation baseline:** `origin/main` at or after
`78736c2b7bbda9069edaf75ab7d5b4a2a3f75544`. If the baseline lacks
`VerificationValidationContextV2`, `createVerificationValidationContextV2`, or
`validateRuntimeReportBoundary`, stop as `BASELINE_MISMATCH`; do not recreate a
parallel boundary from an older worktree.

## Implementation evaluation record

This record is intentionally short so a later evaluator can distinguish work
that exists from planned work.

| Segment | State | Minimum evidence | Deliberately not claimed |
| --- | --- | --- | --- |
| Phase 0 | implemented | strict outcome projection and renderer regressions | a new supported criterion |
| Phase 1 | implemented | default-deny capability policy and criterion-axis closure tests | any enabled non-static capability |
| Phase 2 | implemented | exact-head artifact and rename-aware absence tests | broad product correctness or release readiness |
| Phase 3 | deferred | historical architecture only; excluded by the current scope | test, workflow, or return-value promotion |
| Phase 4 | not started | release gates defined only | release approval |

The Phase 0–2 branch evidence was: `pnpm test` (163 files, 2,205 passed, 2
skipped), `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
These commands establish the exercised implementation only; they do not
establish a production release or general correctness.

## 1. Purpose lock

AgentProof answers one bounded question: whether deterministic evidence is
sufficient to show that an AI-generated pull request satisfies its original,
authoritative request. It remains an evidence report and human decision aid.
It does not become a generic code reviewer, correctness certificate, security
scanner, or merge gate.

This program closes the connection between:

```text
authoritative request
  -> typed criterion
  -> compatible existing GitHub evidence
  -> independently validated criterion result
  -> requirement outcome
  -> every saved and rendered projection
```

The goal is not to increase the number of `met` results. The goal is to make
every result mean exactly one thing and to keep useful observations visible
when an authoritative outcome cannot be established.

## 2. Verified current problem

Current v2 generation first creates the legacy prose/heuristic report and then
overlays strict-contract status. The overlay does not make the legacy summary,
coverage, gaps, re-prompt, proof-axis ownership, UI, Slack, storage, and export
derive from one post-evaluation model.

The repository already contains the correct design primitives:

- closed v2 contract states and criterion types;
- deterministic source and head/base binding;
- criterion axis IDs and a closure validator;
- fail-closed static criterion evaluation;
- private runtime validation and privacy-safe projections; and
- a default-off requirement-local promotion policy.

The missing work is integration. The implementation must not replace this
skeleton with a report v3 rewrite or repair individual fixtures with more prose
heuristics.

## 3. Target architecture

```text
GitHub snapshot / pasted input
            |
            v
  Canonical evidence ledger ---------------------> Observation graph
            |                                            |
            |                                            | reviewer context only
            v                                            v
  Authoritative source -> bound criterion plan -> criterion evaluator registry
                                                    |
                                                    v
                                      validated criterion results
                                                    |
                                                    v
                                    requirement outcome aggregation
                                                    |
                                                    v
                                      one presentation derivation
                                                    |
                   API / dashboard / storage / share / Markdown / Slack / export
```

The evidence ledger and lifecycle are common. Satisfaction rules are not.
Each criterion type consumes only evidence that can prove that type.

## 4. Common backbone versus evaluator-owned logic

### Common backbone

- source precedence and authority;
- repository, PR, base SHA, head SHA, source digest, and policy binding;
- bounded evidence IDs, provenance, completeness, and limitations;
- criterion ownership and axis/reference closure;
- closed result states: `satisfied`, `violated`, `incomplete`, `unavailable`;
- author-claim cap and requirement aggregation;
- independent full validation;
- authenticity, storage, privacy, and projection policies; and
- presentation derivation for every output surface.

### Evaluator-owned logic

- documentation: exact-head blob and literal comparison;
- path absence: complete current and previous-path inventory;
- test case, workflow job, and return value: schema-compatible but
  `unavailable` in the current release scope; and
- future UI/visual behavior: browser/component evidence, not source heuristics.

There is no universal proof receipt. A criterion evaluator may use a private
receipt only when its proof must survive an asynchronous or trust-boundary
handoff. Static evidence may instead be recomputed from transient validation
context before the report is signed.

## 5. Global invariants

1. Observation evidence never promotes a criterion unless the criterion's
   evaluator explicitly accepts that evidence type.
2. A missing or invalid contract keeps the outcome `unclear` while preserving
   safe observations.
3. PR-description author claims never produce authoritative `met`.
4. Generic passing CI is an observation, not return-value proof.
5. Incomplete inventory cannot satisfy absence.
6. Missing workflow identity remains global-only.
7. Every satisfied criterion has recomputable existing evidence and exact
   criterion-owned axis closure.
8. Requirement outcome is derived only from criterion results.
9. Proof-graph observation state is never overwritten by contract outcome.
10. UI, Slack, storage, share, Markdown, and export use one common
    presentation derivation for outcome language.
11. Private source bindings, receipts, raw source, patches, logs, tokens, and
    workflow identity tuples never enter public or tenant projections.
12. LLM output may explain deterministic evidence but cannot add evidence,
    change an axis, or promote an outcome.
13. New writes remain v2. Existing v1 reports remain readable as
    legacy/unverified and cannot establish a new verified outcome.
14. Existing report schema is extended compatibly; no v3 rewrite is allowed in
    this program.

## 6. Ordered specifications

| Order | Specification | Deliverable | Positive promotion |
| --- | --- | --- | --- |
| 0 | `2026-08-25-phase-0-authoritative-output-safety-design.md` | One authoritative outcome presentation; observations remain separate | Off |
| 1 | `2026-08-25-phase-1-criterion-ownership-design.md` | Criterion-owned axes, evaluator dispatch, and independent closure | Off |
| 2 | `2026-08-25-phase-2-static-evaluator-closure-design.md` | Correct documentation and absence evaluation across runtime and storage | Static types only after gates |
| 3 | `2026-08-26-existing-github-evidence-release-scope-design.md` | Freeze the release scope to existing GitHub evidence and defer non-static promotion | Deferred types stay unavailable |
| 4 | `2026-08-25-phase-4-release-closure-design.md` | Reuse existing replay, holdout, production smoke, privacy, and reviewer gates | Static release decision only |

Each phase is a separate reviewable work package. A later phase may not repair
or bypass a failed earlier phase.

### Capability enablement policy

Keep the existing `AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE` as the lower-
level receipt gate. Add one server-only closed capability allowlist:

```ts
type VerificationCapabilityV2 =
  | "documentation_literal"
  | "path_change_absence"
  | "test_case"
  | "workflow_job"
  | "return_value";

function readEnabledVerificationCapabilitiesV2(): ReadonlySet<VerificationCapabilityV2>;
```

The source is `AGENTPROOF_VERIFICATION_CAPABILITIES_V2`, a comma-separated
list of exact release-eligible tokens. Missing, blank, duplicated, unknown, or
deferred tokens produce an empty set. This policy is read only by server
generation/runtime validation; callers cannot send it in an API payload. A
criterion may return `satisfied` only when its capability token is enabled.
The current release-eligible tokens are only `documentation_literal` and
`path_change_absence`.

Rollback removes only the affected token. Setting the capability list empty
and receipt mode `off` disables every new positive while preserving collection,
observations, and conservative results.

## 7. Compatibility locks

The following expected boundaries must not change:

| Case | Expected outcome |
| --- | --- |
| Authoritative linked-Issue documentation contract | May become `met` only through its static evaluator |
| PR-description contract with satisfied evidence | Overall `partial`, `sourceAuthority=author_claim` |
| Unsupported visual/browser criterion | Invalid or `unavailable`; never synthesized satisfaction |
| No approved contract | `unclear` outcome with useful observations |
| Pasted/live mixed evidence | Conservative provenance; no live-authority reuse |

PR #114, #115, and #116 are development regressions for indirect, missing,
and direct test observations. They are not performance evidence and must not be
shown to independent holdout authors as the complete problem domain.

## 8. Program-wide stop and rollback rules

Stop the current phase if any of the following occurs:

- an observation promotes an unrelated criterion;
- an absent/invalid/author-claim contract becomes authoritative `met`;
- a full report and its tenant projection disagree on criterion state;
- a private field reaches a public or tenant projection;
- an output surface presents legacy coverage as the strict outcome;
- an incomplete GitHub collection is treated as complete; or
- a phase requires a v3 rewrite or broad schema migration to pass.

Rollback keeps collection, observations, and validators, but sets
`AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE=off`. Reports return conservative
`partial`, `unclear`, or `unknown` results. Existing saved reports are not
backfilled.

## 9. Program completion

The program is complete only when:

- all phase-specific binary gates pass on the exact candidate SHA;
- every output surface agrees on authoritative outcome and separately labels
  observed evidence;
- false `met` and cross-criterion evidence reuse are zero in protected cases;
- public and tenant private-field leakage is zero;
- production-shaped replay has zero unexpected failures;
- a current production smoke succeeds; and
- at least one independent reviewer approves the exact candidate.

Passing these gates establishes bounded release readiness for the supported
criterion types only. It does not establish general correctness, merge
readiness, security, reviewer usefulness, or market fit.
