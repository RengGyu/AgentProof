# General PR Automatic Assessment Routing Design

**Status:** Approved for implementation planning
**Date:** 2026-09-01
**Product boundary:** Evidence assessment for ordinary pull requests; not a merge gate or generic AI code review

## 1. Problem

The deployed 25-public-PR run completed collection and produced an ordinary-PR assessment summary for every case, but 23 reports ended as `ambiguous` plus `no_assessable_claims`. The other two reports ended as `mixed_evidence`.

The current output does not mean that 23 PR sources were missing. It means that no assessment target survived the target-admission path. Three implementation facts explain why useful output is structurally unlikely:

1. `/api/analyze` and the background worker provide the semantic observer only when the rollout mode is exactly `shadow`. The deployed mode is `advisory`, so advisory reports expose a summary while the semantic observer is not called.
2. The deterministic classifier admits an objective only when a narrow explicit-oracle pattern and a narrow observable-action pattern both match. Ordinary PR prose such as “Fix X”, “Add support for Y”, or a sentence containing both the problem and the change often does not qualify.
3. Any non-empty target set currently resolves to `evidence_partial` unless collection is blocked. Therefore a target-bearing report normally aggregates to `mixed_evidence`, even when there are no conflicting target conclusions.

The assessment also derives `sourceState: ambiguous` from `targets.length === 0`, rather than from the actual source state. This hides whether the failure was source collection, parsing, deterministic classification, semantic availability, semantic validation, target admission, or relation availability.

## 2. Goal

For an ordinary PR URL, AgentProof automatically chooses the safest useful analysis path without any per-analysis user setting:

```text
GitHub source and linked-Issue collection
-> deterministic structure and claim classification
-> bounded semantic proposal when deterministic admission is insufficient
-> deterministic source, freshness, authority, and schema validation
-> target-local evidence assessment
-> reviewer-safe summary
```

The change must improve assessable-target and reviewer-usefulness rates without creating any new path from PR prose or model output to strict `met`, `Supported`, merge readiness, correctness, or production readiness.

## 3. Non-goals

- Do not ask the user to choose `shadow`, `advisory`, AI, deterministic, or strict modes.
- Do not require PR authors to adopt an AgentProof template.
- Do not widen lexical rules one phrase at a time to fit the current 25 PRs.
- Do not execute untrusted repository code.
- Do not treat a changed test file as a passed test.
- Do not treat global CI as requirement-local proof.
- Do not promote a semantic proposal to a verified relation.
- Do not change Verification Contract V2 authority or strict outcome semantics.
- Do not persist raw PR/Issue text, model input/output, source spans, tokens, patches, logs, or workflow identity in public or tenant summaries.

## 4. User and operator behavior

### 4.1 User behavior

The user supplies the same inputs as today, normally a PR URL. No new toggle or mode selector is added to the UI or API request.

The server automatically applies this precedence:

1. valid typed verification contract;
2. linked Issue objective source;
3. PR title/body as an author claim;
4. check, scope, and collection observations when no assessable objective exists.

If a linked Issue exists but does not yield an assessable objective, the PR title/body may be assessed as a separate `pr_author_claim`. It must not inherit linked-Issue authority.

### 4.2 Operator rollout behavior

`AGENTPROOF_GENERAL_PR_OBSERVATION_MODE` remains a server deployment policy, not a user setting. The resolver converts the single rollout phase into two independent internal decisions:

```ts
interface GeneralPrAssessmentRuntimePolicyV1 {
  version: 1;
  releasePhase: "disabled" | "shadow" | "advisory";
  semanticObservation: "disabled" | "eligible_public_pr";
  assessmentProjection: "hidden" | "advisory";
}
```

The mapping is fixed:

| Release phase | Semantic observation | Assessment projection |
|---|---|---|
| `disabled` | `disabled` | `hidden` |
| `shadow` | `eligible_public_pr` | `hidden` |
| `advisory` | `eligible_public_pr` | `advisory` |

An unknown value resolves to the `disabled` row. This fixes the current contradiction where `shadow` runs semantics but `advisory` displays a deterministic-only summary.

## 5. Semantic eligibility

The semantic observer is an optional proposal layer, not an authority layer. It is automatically eligible only when all of these server-observed conditions hold:

- runtime policy is `eligible_public_pr`;
- repository visibility is explicitly public;
- input provenance is a live GitHub snapshot;
- exact base and head SHAs are available;
- source parsing completed;
- bounded semantic package construction succeeds;
- provider key and pinned model configuration are available; and
- the source is re-read as public and unchanged immediately before and after the provider call.

The existing private-repository consent boundary remains unchanged. This design does not add a per-request bypass.

Semantic output may only:

- classify existing bounded source-span IDs into closed claim roles;
- group eligible span IDs into objective candidates;
- propose target-to-change/test/evidence relations; and
- abstain.

Semantic output may not create source text, source authority, evidence, verified relations, conclusions, status, or reason codes. JSON Schema conformance is necessary but never sufficient; the deterministic validator recomputes ownership, ordering, eligibility, source ceiling, seed hash, and freshness.

## 6. Claim admission

### 6.1 Deterministic path

Keep the current high-precision deterministic path for explicit acceptance criteria and observable requirements. Do not broaden it using a growing list of repository-specific verbs or headings.

### 6.2 Semantic fallback

When eligible source spans exist but deterministic admission does not produce a target, the semantic observer may propose:

- `acceptance_criterion` from a linked Issue;
- `behavioral_objective` from PR title/body;
- `implementation_claim` from PR title/body;
- `test_claim` from PR title/body; or
- non-target roles such as scope, limitation, risk, follow-up, process, and context.

An admitted semantic target remains a hypothesis and has a maximum conclusion of `evidence_partial` until a separately validated deterministic relation exists.

Multiple linked Issues remain separate source groups. PR-author claims never replace or gain the authority of a linked Issue or typed contract.

Source eligibility and source authority remain separate. Private source units use an admission tier:

```ts
type GeneralPrSourceAdmissionTierV1 = "primary" | "fallback" | "context";
```

A linked Issue is `primary`. PR title/body are `fallback` when a linked Issue exists and `primary` otherwise. The finalizer admits fallback author-claim targets only when no primary linked-Issue target was admitted. The tier never changes `authority`, and a fallback target always retains `pr_author_claim` plus reviewer-confirmation wording.

## 7. Diagnostic state

The private observation bundle gains aggregate-only diagnostic information. It contains no raw text, path, source ID, span ID, PR number, or model output.

```ts
interface GeneralPrAssessmentDiagnosticsV1 {
  version: 1;
  sourceCollection:
    | "available"
    | "missing"
    | "parse_incomplete"
    | "collection_unavailable";
  deterministicAdmission:
    | "admitted"
    | "no_candidate"
    | "context_only";
  semanticAdmission:
    | "not_needed"
    | "disabled"
    | "ineligible"
    | "unavailable"
    | "timeout"
    | "invalid"
    | "stale"
    | "no_candidate"
    | "admitted";
  relationState:
    | "not_attempted"
    | "unresolved"
    | "hypothesis_only"
    | "verified"
    | "collection_blocked";
  counts: {
    sourceUnits: number;
    eligibleSpans: number;
    deterministicCandidates: number;
    semanticCandidates: number;
    admittedTargets: number;
  };
}
```

Public, tenant, Markdown, Slack, comment, and dashboard surfaces receive only existing bounded counts plus closed reason codes. Add these reason codes compatibly:

- `deterministic_candidate_missing`;
- `semantic_observer_disabled`;
- `semantic_observer_ineligible`;
- `semantic_observer_unavailable`;
- `semantic_observer_timeout`;
- `semantic_proposal_invalid`;
- `semantic_candidate_missing`;
- `semantic_candidate_rejected`; and
- `target_relation_unresolved`.

`sourceState` is derived from valid collected source units, not from target count:

- a valid linked-Issue source -> `linked_issue`;
- only valid PR title/body sources -> `pr_author_claim`;
- both source classes used by admitted targets -> `mixed`;
- no valid source -> `missing`;
- conflicting, stale, or unresolvable source ownership -> `ambiguous`.

A source may therefore be `linked_issue` or `pr_author_claim` while the conclusion is `no_assessable_claims`.

## 8. Assessment conclusions

Add `evidence_partial` to the report-level conclusion enum. Aggregate in this order:

1. any target `contradicted` -> `attention_required`;
2. every admitted target `blocked` -> `collection_blocked`;
3. every admitted target `evidence_supported` -> `evidence_supports_stated_change`;
4. every admitted target `evidence_partial` -> `evidence_partial`;
5. two or more different non-terminal target conclusions -> `mixed_evidence`;
6. no admitted target -> `no_assessable_claims`.

This prevents a single partial target from being presented as mixed evidence.

The first implementation package must not add a new way to produce `evidence_supported`, `contradicted`, or `not_demonstrated`. Those conclusions remain gated by target-local deterministic relation and receipt work. Semantic-only targets stop at `evidence_partial`.

## 9. Evidence relation boundary

Target admission and evidence relation are separate release capabilities.

- Target admission answers: “What stated change or objective should the reviewer inspect?”
- Evidence relation answers: “Which exact-head artifact or execution result is demonstrably related to that target?”
- Strict contract evaluation answers: “Did an approved criterion pass or fail?”

This implementation may expose `target_relation_unresolved` and hypothesis-only relations. It must not infer support from global CI, changed-file proximity, file names alone, or model similarity.

A later relation package may consume only independently validated, target-local relations with complete head binding and closed evidence references. That package is not required to enable semantic target admission.

## 10. Privacy and storage

- Model input remains bounded, redacted, transient, and public-source-only.
- Provider requests use `store: false` and a pinned model/profile.
- Raw model output is validated and discarded.
- Private diagnostic data stays transient or aggregate-only.
- Public and tenant projections remain allowlists.
- Unknown assessment or diagnostic fields are rejected.
- Existing summary-only save/delete behavior remains unchanged.
- Legacy reports without the new conclusion or reason codes remain valid.

## 11. Failure behavior

Every failure remains useful and specific:

| Failure | Output behavior |
|---|---|
| No source | `sourceState: missing`, `no_assessable_claims` |
| Parser incomplete | deterministic report completes; closed parse reason reported |
| Provider unavailable/timeout/invalid | deterministic assessment remains; exact semantic reason reported |
| Source/head changes during call | semantic proposal discarded as stale |
| Semantic proposal has invalid ownership | proposal rejected; no target admitted from it |
| Target admitted but no verified relation | `evidence_partial` plus `target_relation_unresolved` |
| Strict contract absent | strict status stays `unclear`; ordinary assessment remains separate |

No failure silently becomes `Supported`, `met`, `missing implementation`, or `requirement violated`.

## 12. Evaluation

### 12.1 Engineering gates

- runtime policy mapping tests;
- route/worker parity tests;
- advisory semantic provider invocation tests;
- source-state and diagnostic reason tests;
- semantic proposal ownership/freshness mutation tests;
- report validation and all projection privacy tests;
- full test, typecheck, lint, build, and whitespace checks.

### 12.2 Safety gates

All must remain zero:

- false strict `met` or Supported;
- false `evidence_supported`;
- authority elevation;
- stale or wrong-head binding;
- generic-CI-to-target promotion;
- changed-test-as-passed promotion;
- incomplete inventory treated as absence;
- private-field leakage; and
- route/worker/projection disagreement.

### 12.3 Usefulness gates

Do not optimize only for fewer `no_assessable_claims`. Measure independently:

- objective-admission precision and recall on labelled calibration and holdout sets;
- assessable-target rate;
- semantic abstention and rejection rates by reason;
- target-local relation coverage;
- useful or partially useful reviewer rating; and
- false-blocker rate.

Keep the existing minimum evaluation sizes and thresholds:

- at least 60 calibration cases and 60 holdout cases;
- objective-admission precision lower 95% bound >= 0.95;
- objective-admission recall lower 95% bound >= 0.90;
- three independent reviewer sessions;
- at least 70% useful or partially useful; and
- false-blocker rate below 20%.

The 25-public-PR corpus is a production-shaped smoke and distribution check, not ground truth. It must report the diagnostic breakdown and cannot authorize release by itself.

## 13. Rollout

1. Implement diagnostics and policy separation with projection hidden.
2. Run semantic observation on public PRs in `shadow`; compare admitted candidates with independent labels.
3. Enable `advisory` only after hard safety gates and objective-admission thresholds pass.
4. Re-run the current 25-PR corpus and report source, admission, relation, and conclusion distributions.
5. Keep the ordinary assessment secondary until reviewer usefulness gates pass.

Rollback changes only the server rollout phase to `disabled` or `shadow`. Strict reports, saved schemas, and evidence collection remain usable without a database rollback.

## 14. Acceptance criteria

- Users do not receive or configure analysis modes.
- `advisory` automatically runs the eligible public semantic observer and exposes only the bounded summary.
- `shadow` runs the same observer but does not alter the returned report.
- A semantic proposal cannot change source authority, strict status, or a relation to `verified`.
- Zero-target reports identify the failing stage instead of always reporting source ambiguity.
- One or more all-partial targets aggregate to `evidence_partial`, not `mixed_evidence`.
- Existing strict Verification Contract V2 outcomes remain byte-equivalent except for the optional ordinary-assessment companion.
- Public and tenant outputs contain no targets, bindings, spans, raw source, model output, token, patch, log, or workflow identity.
- The 25-PR smoke requires the assessment summary on all completed reports and reports the new diagnostic distribution.
