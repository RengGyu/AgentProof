# General PR Semantic Observer Reliability Design

**Status:** Approved and frozen for implementation planning

**Date:** 2026-09-02

**Depends on:** `2026-09-02-general-pr-claim-conditioned-semantic-packaging-design.md`

**Product boundary:** Automatic evidence assessment for ordinary pull requests; never a substitute for Verification Contract V2 authority

## 1. Decision

Keep the deterministic observer as the high-precision first path. When it cannot identify an objective from ordinary PR prose, use one bounded semantic classification stage whose provider output contains only a role for each selected span. Derive objective groups locally instead of asking the provider to describe the same decision twice.

Give the complete semantic observer one shared budget of **60,000 ms**. Claim classification consumes the budget first; evidence linking receives only the remaining time. Do not retry.

The ordinary-PR assessment may explain an observed objective, related evidence, and remaining gap. It must not change a strict requirement outcome to `Supported`, `met`, or an equivalent verified state without an approved verification contract and released deterministic proof.

## 2. Evidence behind the decision

The latest fixed 25-PR preview run completed all 25 inputs, but all 64 strict requirement outcomes remained `unclear`. The useful ordinary-PR assessment also admitted no assessable claim in 20 cases.

The closed reason counts were:

| Reason | Count |
|---|---:|
| `deterministic_candidate_missing` | 22 |
| `semantic_observer_timeout` | 11 |
| `semantic_proposal_invalid` | 9 |
| `target_relation_unresolved` | 5 |
| `verified_relation_missing` | 3 |
| `semantic_relation_only` | 2 |
| `author_claim_requires_confirmation` | 12 |

A same-input diagnostic run forced claim classification for all 25 cases:

| Claim-stage result | Count |
|---|---:|
| Timeout | 17 |
| Invalid | 6 |
| Valid | 1 |
| Unavailable | 1 |

All six invalid outputs violated the duplicated role/group contract. Five were `candidate_group_role_mismatch`; one also crossed objective-group source ownership. This does not prove every production failure has the same cause, but it does show that the current contract asks the provider to own one semantic fact twice:

```text
span role decision
+ provider-authored objective group
-> local cross-field consistency check
```

The current 8-second timeout is applied independently to claim and evidence calls. Raising that value to 60 seconds per call would allow roughly 120 seconds of provider time and therefore does not meet the requested one-minute boundary.

## 3. Problem statement

The current pipeline has three separable problems.

### 3.1 Ordinary language is outside the deterministic vocabulary

The deterministic classifier intentionally requires strong requirement markers and a narrow set of observable verbs. This is appropriate for high precision, but ordinary PR descriptions often state an objective without those exact markers.

Adding repository-specific verbs or phrases to the regular expressions would improve the current corpus while increasing overfitting risk. The static vocabulary therefore remains narrow.

### 3.2 The claim contract has duplicated ownership

The provider returns both:

- a role for every selected span; and
- objective groups that must contain exactly the spans assigned `objective_candidate`.

JSON Schema validates each collection's shape, but the relationship between those collections is a semantic invariant. The local validator correctly rejects contradictions, yet the provider can create a contradiction even when it understood the prose.

### 3.3 Runtime policy does not express a total budget

Claim and evidence stages each receive the full configured timeout. That makes total latency proportional to the number of stages. The policy needs one deadline shared by both calls.

## 4. Goals

1. Admit plausible ordinary-PR objectives without expanding repository-specific lexical rules.
2. Remove role/group contradictions by giving each semantic fact one owner.
3. Bound both semantic calls to one total provider budget of 60,000 ms.
4. Skip semantic calls when deterministic objective admission already succeeded.
5. Expose closed, privacy-safe failure categories to authenticated operator diagnostics.
6. Preserve deterministic-first ordering, exact-head freshness, privacy, and fail-closed behavior.
7. Measure usefulness with independently labeled target admission and evidence relevance, not merely a lower `unclear` count.

## 5. Non-goals

- Do not execute repository code or tests in a new sandbox.
- Do not create a new evidence collector.
- Do not broaden the deterministic classifier with phrases learned from the 25-PR corpus.
- Do not let the provider author objective groups, authority, evidence, receipts, or outcomes.
- Do not infer multi-span objectives in this release.
- Do not retry a failed or timed-out provider call.
- Do not add a user-selectable analysis mode or require a PR template.
- Do not promote PR-description author claims or semantic hypotheses to strict `Supported`.
- Do not change the public report, saved report, tenant summary, share, Markdown, GitHub comment, Slack, or audit-export schema.
- Do not add a parser, embedding service, vector database, or other dependency.
- Do not tune acceptance thresholds after reading protected evaluation labels.

## 6. Immutable product and safety rules

| Boundary | Frozen rule |
|---|---|
| Deterministic first | Build and validate the deterministic report and seed before any provider call. |
| Strict authority | An absent or invalid approved contract keeps strict requirement outcomes `unclear`. |
| Semantic authority | Provider decisions remain `hypothesis`; they cannot create verification proof. |
| Exact head | Re-read the public subject before and after every completed provider call. A mismatch returns `stale`. |
| Privacy | Packages are bounded, redacted, transient, and sent with `store: false`. |
| Persistence | Raw span text, provider output, span IDs, selection hashes, and detailed invalid reasons are not stored or projected publicly. |
| Calls | Maximum two provider calls; zero automatic retries. |
| Time | Claim and evidence share one 60,000 ms provider deadline. |
| Absence | Sampled or incomplete evidence cannot establish global absence or a missing test. |
| Failure | Timeout, invalid output, unavailable provider, and stale input remain distinct closed states. |

## 7. Target architecture

```text
PullRequestInput
-> deterministic report validation
-> GeneralPrObservationSeedV2
-> deterministic objective admission
   -> objective exists: finalize without provider call
   -> no objective: bounded claim selection
      -> provider role decisions V2
      -> independent local validation
      -> local singleton objective groups
      -> claim-conditioned evidence selection
      -> remaining time > 0: optional evidence-linking call
      -> canonical GeneralPrSemanticProposalV2
-> existing GeneralPrAssessment summary
```

The existing canonical `GeneralPrSemanticProposalV2` remains the downstream interface. Only the private claim-stage provider contract changes.

## 8. Claim-stage provider contract V2

### 8.1 Provider output

```ts
export interface GeneralPrSemanticClaimCandidateV2 {
  spanRoles: Array<{
    spanId: string;
    role: GeneralPrClaimRoleV2;
  }>;
}
```

The provider must return exactly one role decision for every selected span and nothing else.

Removed provider-owned fields:

- `objectiveGroups`
- `abstained`

`mixed_or_ambiguous` already represents abstention. A second boolean permits contradictory states and has no independent product meaning.

### 8.2 Strict JSON Schema

The schema root contains only `spanRoles`. Each item contains only `spanId` and `role`.

The schema must enforce:

- `additionalProperties: false` at every object level;
- `minItems` and `maxItems` equal to the selected span count;
- `spanId` restricted to selected IDs;
- `role` restricted to the closed `GeneralPrClaimRoleV2` enum; and
- the existing maximum output byte limit.

Schema validity is necessary but not sufficient. Local validation remains authoritative for selection binding and role ceilings.

### 8.3 Local validation

The validator must reject:

- a non-object root or unexpected key;
- a missing, duplicate, or unselected span ID;
- an unknown role;
- a stale or forged seed/selection hash;
- `objective_candidate` assigned above the source's role ceiling;
- `objective_candidate` assigned to a deterministic `template_or_process` span; and
- output over the byte limit.

It must return a recursively frozen normalized result.

### 8.4 Local group derivation

For this release, every validated `objective_candidate` span produces one singleton group:

```ts
{
  spanIds: [spanId],
  disposition: "candidate"
}
```

The canonical group ID continues to use `deriveGeneralPrObjectiveGroupIdV2([spanId])`.

Non-objective roles produce no group. The implementation must not combine adjacent spans, infer cross-paragraph intent, or create a group across sources.

This deliberately trades recall for a contract that cannot become internally contradictory. Multi-span grouping may be introduced only after a separate independently scored design demonstrates value without false admission.

## 9. Deterministic fast path

After building and validating the seed, finalize deterministic observations once before invoking the semantic observer.

If at least one objective has `admissionBasis: "explicit_structure"`:

- return that deterministic bundle;
- make zero provider calls;
- keep `diagnostics.semanticAdmission: "not_needed"`;
- keep claim/evidence stage states `not_run`; and
- attach the same advisory assessment projection that the current deterministic result would produce.

Use an existing internal semantic state (`disabled`) for the bypassed semantic stage rather than adding a new public state. The decisive operator signal is `semanticAdmission: "not_needed"` plus `providerCallCount: 0`.

The fast path changes cost and latency only. It must not change admitted deterministic objectives, assessment conclusions, authority, or projection fields.

## 10. Shared 60-second budget

### 10.1 Definition

```ts
export const GENERAL_PR_SEMANTIC_OBSERVER_DEFAULT_TOTAL_BUDGET_MS = 60_000;
```

`timeoutMs` remains the external option name for compatibility, but its meaning becomes total semantic provider budget for one observer run.

At observer start:

```ts
const deadlineMs = now() + totalBudgetMs;
```

Before each provider call:

```ts
const remainingMs = Math.max(0, deadlineMs - now());
```

Both the local timeout wrapper and provider request receive the same `remainingMs` for that call.

### 10.2 Stage behavior

| Situation | Result |
|---|---|
| Claim has no remaining time | Overall `timeout`; claim `timeout`; evidence `not_run` |
| Claim call times out | Overall `timeout`; claim `timeout`; evidence `not_run` |
| Claim is valid and no group is admitted | Overall `valid`; evidence `not_run` |
| Evidence has no remaining time | Preserve claims-only proposal; overall `valid`; evidence `timeout` |
| Evidence call times out | Preserve claims-only proposal; overall `valid`; evidence `timeout` |

Provider execution time must not exceed 60,000 ms in total. Because the deadline starts at observer entry, deterministic packaging and freshness reads also reduce the time left for provider calls. They are not provider execution, but this conservative accounting keeps the complete semantic observer inside one elapsed-time boundary. Full route latency remains a separate measurement in preview deployment.

No release claim may assume the hosting platform permits this duration. Preview validation must confirm the effective deployment function duration and observe a full request completing without platform termination.

## 11. Closed operator diagnostics

Public assessment reason codes stay stable. `semantic_proposal_invalid` remains the reviewer-safe public explanation.

Authenticated operator diagnostics may add one private closed field:

```ts
type GeneralPrSemanticClaimInvalidReasonV2 =
  | "root_shape_invalid"
  | "span_decision_invalid"
  | "span_binding_invalid"
  | "role_ceiling_violation"
  | "output_limit_exceeded";
```

The detailed category is produced by validation, propagated transiently through the observer and bundle, and emitted only through the existing authenticated operator diagnostic response.

It must never include or expose:

- span IDs;
- source text;
- paths or repository identifiers;
- provider output;
- hashes or receipts; or
- exception messages.

It must be absent from public reports, saved reports, tenant summaries, shares, Markdown, GitHub comments, Slack, dashboards, and audit exports.

## 12. Compatibility and migration

- Keep `GeneralPrSemanticProposalV2` and its downstream finalizer unchanged.
- Introduce `GeneralPrSemanticClaimCandidateV2`, claim schema name V2, and claim validator V2.
- Bump the claim package contract/schema and semantic prompt profile to a new version.
- Keep the evidence-stage contract V1 unless a required type reference changes mechanically.
- Do not backfill saved reports.
- Do not migrate the database.
- Old receipts remain readable as historical private artifacts; new runs use the new prompt/schema hashes.
- Route and worker must use the same model profile and timeout semantics.

## 13. Validation strategy

### 13.1 Unit and mutation tests

The implementation is not complete until tests prove:

1. Claim schema V2 accepts role-only output.
2. Missing, duplicate, unknown, and unselected IDs are rejected.
3. Objective role above a source ceiling is rejected.
4. Template/process spans cannot become objectives.
5. Each accepted objective span creates exactly one singleton group.
6. No objective roles create no groups and skip evidence linking.
7. A deterministic objective causes zero provider calls.
8. Deterministic fast-path output matches the existing deterministic result.
9. The claim call receives 60,000 ms with a fresh clock.
10. Time consumed by claim is subtracted from evidence timeout.
11. Exhausted remaining budget skips the evidence provider call and records evidence timeout.
12. Operator diagnostics contain only a closed invalid category.
13. Public and stored projections do not contain the new private category or provider data.
14. Route and worker send the same V2 claim contract and use the same budget semantics.

### 13.2 Fixed-corpus evaluation

After local gates pass, deploy an authorized preview and re-run the same 25 URLs at their fixed head SHAs. Compare with the saved baseline; do not replace or silently refresh the inputs.

Required aggregate output:

- collection completion;
- deterministic objective admission;
- semantic claim `valid` / `invalid` / `timeout` / `unavailable`;
- claim invalid reason counts;
- provider call counts;
- admitted target counts;
- evidence relation states;
- total/report/evidence latency p50 and p95; and
- strict outcome changes.

### 13.3 Release gates

| Gate | Required result |
|---|---|
| Strict authority | False `Supported` = 0; no strict outcome changes caused by semantic proposals |
| Contract consistency | Removed role/group mismatch category = 0 by construction |
| Provider calls | Maximum 2; deterministic fast path = 0; retries = 0 |
| Privacy | Raw source/provider output/private reason leakage = 0 |
| Binding | Unknown, duplicate, or cross-selection IDs accepted = 0 |
| Time | Total provider budget never exceeds 60,000 ms |
| Freshness | Head mismatch remains `stale`; accepted stale proposal = 0 |
| Usefulness | Independently labeled objective precision does not regress; coverage is reported, not forced |
| Deployment | Effective function duration and one full 60-second-bound request verified in preview |

A lower `no_assessable_claims` count alone is not a success condition. Every new admitted objective must be supported by an independent label or a deterministic structural oracle in the evaluation set.

## 14. Rollback

Rollback must disable semantic fallback or restore the previous provider contract while leaving deterministic collection, canonical seed construction, strict report generation, and saved-report schemas intact.

Trigger rollback when any of these occurs:

- one semantic proposal changes a strict outcome;
- one private detail leaks into a public or stored projection;
- one stale or unselected span is admitted;
- provider calls exceed two or an automatic retry occurs;
- preview execution is terminated by the hosting duration limit; or
- independently labeled target precision regresses.

## 15. Known ceiling

Singleton groups can split one objective written across multiple paragraphs or list items. That is an accepted first-release limitation. It is safer and easier to audit than provider-authored grouping, and it does not prevent later evidence linkage per span.

The next grouping design, if needed, must be evaluated as a separate capability. It may not be introduced as a hidden heuristic inside this implementation.
