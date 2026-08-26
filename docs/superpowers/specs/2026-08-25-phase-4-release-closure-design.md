# Phase 4 — Release Closure Design

**Depends on:** Phases 0–2 and
`2026-08-26-existing-github-evidence-release-scope-design.md`

**Status:** Release evaluation specification; V2 closed-reference migration in
progress

**Release state:** `NO_GO` until all binary gates pass

## Implementation evaluation record

**State:** The V2 release-evaluation implementation is locally complete, but
no protected corpus, current production smoke, independent exact-SHA review,
or deployment evidence exists. This remains a specification, not a release
record.

- The current candidate scope contains only the existing static documentation
  and path-absence capabilities. Non-static Phase 3 capabilities are deferred.
- No fresh production smoke, frozen holdout, independent SHA review, or
  deployment evidence is recorded here.

**Decision:** `NO_GO` remains in force for any new requirement-level
`met` promotion or release claim.

## 1. Goal

Evaluate the integrated production path rather than isolated verifier helpers.
This phase decides whether the two bounded static criterion capabilities and
the existing observation pipeline are ready for release. It does not prove
general correctness, merge readiness, security, reviewer usefulness, or market
fit.

## 2. Production path under evaluation

```text
request/webhook
  -> bounded input normalization
  -> GitHub collection and source binding
  -> canonical evidence and observation graph
  -> typed criterion dispatch
  -> independent v2_full validation
  -> strict outcome and presentation derivation
  -> trusted save/sign
  -> tenant read
  -> dashboard/share/Markdown/Slack/export projections
```

Direct verifier calls alone are not release evidence.

## 3. Development regression pack

Known failures move into ordinary regression tests:

- direct, indirect, and missing test observations;
- harmless objective prose invariance;
- cross-criterion axis and receipt reuse;
- unchanged exact-head documentation;
- rename-aware absence;
- incomplete workflow identity;
- rerun/head mismatch;
- mixed live/pasted provenance;
- full/tenant result consistency; and
- contradictory output surfaces.

These cases guide development and are not holdout performance evidence.

## 4. Production-shaped replay

Use versioned, sanitized snapshots containing the actual response shapes needed
by production:

- PR start and end metadata;
- linked Issue or PR-description source;
- file pages including rename metadata;
- check-run and status pages;
- workflow, run, attempt, job, and pagination metadata;
- exact-head repository file/blob responses;
- permission, rate-limit, pagination-cap, and head-drift failures; and
- mixed pasted/live input.

Required source cases are provided task, linked Issue, PR-description fallback,
absent contract, and invalid contract. Repository names, user IDs, PR numbers,
paths, and content are synthetic or opaque.

Replay output must match the normal route/worker result and trusted projection.
No fixture may inject a precomputed criterion result.

## 5. Protected holdout

Freeze input-only cases and a V2 reference-policy seal after runner/evaluator
interfaces are fixed. The seal binds corpus hashes, exact case counts, and the
input-derived named coverage summary; it contains no per-case expected result.
Implementation workers receive neither derived outcomes nor failing case
contents.

Minimum categories:

- authority/source selection;
- criterion ownership and observation isolation;
- each release-eligible static evaluator's positive and negative cases;
- execution identity and head binding;
- persistence/output consistency; and
- privacy projection.

Cases must use task/repository families distinct from development regressions.
A holdout case used to repair code becomes a regression and is replaced before
the next release claim.

Reuse the sealed contracts and custody boundary already defined by:

- `2026-08-21-executable-release-evaluation-pre-freeze-design.md`; and
- Sections 8–10 of
  `2026-08-22-production-authority-blind-evaluation-design.md`.

The independent reviewer is the holdout custodian and creates the input-only
requirement and boundary corpora plus the V2 seal outside the implementation
worktree. The candidate runner receives only input and the immutable candidate
tree; the evaluator alone receives protected input, the seal, candidate
results, and the reference-policy bundle. Both run in a frozen no-network
sandbox. Four signed attestations cover the requirement/boundary runners and
evaluators, with distinct exact mount sets. The signed aggregate artifact
binds candidate SHA, V2 policy/seal/corpus/coverage hashes, runner and
evaluator bundle/profile hashes, result hashes, and aggregate gate counts.
Implementation workers receive aggregate results only.

This phase extends the existing closed candidate result schema only with the
enabled capability tokens and criterion-owned result/axis states required by
this program. It does not introduce another runner, evaluator, or per-case
expected-result format. Any required tooling/schema change invalidates the
freeze and requires independently recreated input-only corpora, V2 seal, and
derived coverage.

## 6. Binary release gates

### Correctness boundary

- false `met` / false `satisfied`: 0;
- cross-requirement or cross-criterion reuse: 0;
- incomplete collection promoted as complete: 0;
- contract authority boundary changes: 0;
- contradictory output surfaces: 0.

### Privacy boundary

- private receipt leakage: 0;
- raw source, patch, log, token, inventory, or workflow tuple leakage: 0;
- unknown fields in public or tenant allowlist projections: 0.

### Production replay

- unexpected 500 responses: 0;
- source-selection mismatches: 0;
- head/base drift mixtures: 0;
- false-complete pagination: 0;
- direct verifier versus route/worker disagreement: 0.

### Engineering

- `pnpm test`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm build`;
- `git diff --check`;
- exact candidate-head GitHub CI; and
- at least one independent review of the exact candidate.

A weighted score cannot override any failed or unknown binary gate.

## 7. Production smoke

After candidate deployment, run fresh credentialed smoke checks for:

- authoritative linked-Issue static positive and negative;
- PR-description author-claim cap;
- absent and invalid contracts;
- `documentation_literal` and `path_change_absence` when enabled;
- head drift, permission failure, rate limit, and pagination limit;
- save/read/dashboard/export consistency; and
- public/tenant privacy.

Record only aggregate operational metrics. Do not use repository, PR, path,
user, or receipt identifiers as metric labels.

Suggested initial operational guardrails retain the existing release budget:

- total p95 <= 3,000 ms;
- evidence collection p95 <= 2,500 ms;
- checks/status/jobs collection p95 <= 1,500 ms;
- default provider calls = 0;
- default retries = 0; and
- p95 regression from the measured baseline <= 20%.

These are provisional engineering budgets, not product SLAs. If stronger
evidence exceeds a budget, optimize collection or return `unavailable`; never
weaken proof.

## 8. Release decision

Release only the criterion capabilities whose complete evaluator-specific
gates pass. Other accepted contract types remain `unavailable` and visible as
such.

Rollback is capability-scoped:

```text
keep collection + observations + validators + projections
set affected promotion capability off
return incomplete / unavailable / unclear
```

Do not backfill legacy reports. Read them as legacy/unverified, and never use
them as evidence for a new verified outcome.

## 9. Required final report

The release report states:

- exact candidate and deployed SHA;
- enabled criterion types;
- every binary gate result with command or artifact reference;
- aggregate holdout counts without case disclosure;
- aggregate latency, request, retry, and downgrade metrics;
- privacy result;
- independent review result; and
- all remaining `UNKNOWN` items.

If any mandatory item is missing, the release decision remains `NO_GO`.
