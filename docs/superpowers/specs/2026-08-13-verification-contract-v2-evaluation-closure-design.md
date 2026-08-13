# Verification Contract v2 Evaluation Closure Design

**Status:** Proposed for user review. This document authorizes no production
deployment, migration, executor rollout, or repository setting change.

**Extends:**
`docs/superpowers/specs/2026-08-13-verification-contract-v2-design.md`.
The base v2 design remains authoritative except for the explicit post-rerun
deltas in this document: observation-only executor output, positive evaluator
enablement, contract-specific guidance, and the contracted canary matrix. Any
other conflict requires a spec revision and user approval before implementation.

## 1. Decision

Keep the current strict no-contract behavior, but complete the missing positive
verification path.

AgentProof must support all three of these states without mixing them:

1. **Observed evidence only** — code, tests, checks, and files were found, but
   no approved verification contract exists. Outcome remains `unclear`.
2. **Approved contract, incomplete evaluation** — a valid contract exists, but
   one or more required criteria are violated, incomplete, or unavailable.
   Outcome is derived from those criterion states.
3. **Approved contract, completed evaluation** — every required criterion is
   deterministically satisfied. Only this state may produce authoritative
   `met`.

The current deployment proves state 1. This design closes states 2 and 3 and
corrects the guidance shown for state 1.

## 2. Evidence from the 20-report rerun

The following facts are verified from the supplied repository report export:

- 20 current reports were generated with `Strict verification contract`.
- 19 reports contained requirements; PR #25 contained no explicit objective.
- The 19 reports contained 38 requirements in total.
- All 38 requirement outcomes were `Unclear` because no approved contract was
  present.
- Observed evidence remained differentiated: 21 `Supported`, 15 `Partially
  supported`, and 2 `Unclear`.
- PR #24 no longer converted helper code, a literal unit test, and passing CI
  into proof that the repository overview became more useful.
- Failed CI remained visible for PRs #9, #21, and #22.
- Missing interaction or visual evidence remained visible for PRs #5, #6, #9,
  and #19.

These results verify the fail-closed no-contract branch. They do **not** verify
that a valid authoritative contract can produce `met`.

## 3. Problems to solve

### 3.1 No positive outcome path is enabled

The current full validator rejects every `satisfied` v2 criterion until an
attested evaluator is configured. This prevents false positives, but also
means the deployed policy cannot produce an authoritative positive outcome.

### 3.2 Executor output currently expresses conclusions, not observations

The current `verification-execution-v2.ts` boundary accepts per-case values
such as `satisfied` and `target_error`. A trusted executor may report what was
observed, but it must not author the final criterion state.

For example, the executor must return:

```json
{
  "caseId": "private",
  "outcome": { "kind": "returned", "actual": "Private repository" }
}
```

The AgentProof server compares `actual` with the approved contract's
`expected` value and computes `satisfied` or `violated`.

### 3.3 Guidance incorrectly says the requirement needs clarification

A precise objective such as `Return Public repository when isPrivate is false`
is not ambiguous merely because it has no approved contract. The current copy
conflates these two conditions:

- unclear objective meaning;
- missing approval/evaluation contract.

The next action must identify the actual missing boundary.

### 3.4 Observed evidence anomalies need independent regression checks

The rerun contains cases that should not be silently accepted as correct:

- PR #22 has overall failed CI while one requirement still reports observed
  evidence as `Supported`. This may be correct only if the failed Check is
  provably unrelated to that requirement.
- PR #18 and PR #29 use generic implementation-gap language for workflow or
  documentation artifacts. Criterion-specific evidence rules must replace
  generic implementation wording when a typed contract exists.

These are evidence-linking and presentation checks. They must not weaken the
strict outcome gate.

## 4. Alternatives considered

### A. Keep every no-contract requirement `Unclear` permanently

This is safest but makes AgentProof an observation viewer rather than a
verification product. Rejected as the final state; retained only as fallback.

### B. Promote precise prose plus focused tests and passing CI to `met`

This restores positive outcomes quickly but recreates the original false
positive class. A helper test does not prove a UI outcome, usefulness claim, or
other unexpressed behavior. Rejected.

### C. Complete the typed contract and evaluator path

This keeps observations useful, enables deterministic positive outcomes, and
preserves a closed trust boundary. Selected.

## 5. Outcome model

Outcome and evidence coverage remain separate fields.

| Contract state | Criterion state | Objective authority | Outcome |
| --- | --- | --- | --- |
| `absent` | none | any | `unclear` |
| `invalid` | none | any | `unclear` |
| `authoritative` | all satisfied | linked Issue/provided | `met` |
| `authoritative` | mixed satisfied/non-satisfied | linked Issue/provided | `partial` |
| `authoritative` | all violated on complete collection | linked Issue/provided | `missing` |
| `authoritative` | any incomplete/unavailable, none satisfied | linked Issue/provided | `unclear` |
| `author_claim` | all satisfied | PR description | `partial`, with `evidenceStatus: met` |

Observed implementation, test, execution, visual, and interaction facts never
change these rules. They remain available to explain what was found.

## 6. Architecture

```text
GitHub source snapshot
  -> strict contract selection and source binding
  -> criterion-specific deterministic evaluator
       -> static artifact/inventory evaluator
       -> isolated return-value observation executor
  -> server-owned expected-vs-actual comparison
  -> criterion result aggregation
  -> adversarial full validation
  -> signed storage and reviewer output

Any missing, stale, malformed, unsigned, or unsupported step
  -> unavailable/invalid/unclear
  -> never generic-CI fallback
```

### 6.1 Contract source and binding

Reuse the v2 source precedence and complete-objective-set rules:

1. explicitly provided typed contract;
2. exact linked-Issue contract envelope;
3. exact PR-description contract envelope as `author_claim`;
4. otherwise `absent`.

The aggregate binding includes:

- source kind and immutable source identity;
- complete normalized source content;
- canonical contract;
- repository identity;
- head and base SHA;
- base-policy blob/digest;
- report, evaluator, adapter, and deterministic-engine versions.

The binding is recomputed from freshly fetched data before finalization. An
Issue edit, unlink, relink, policy edit, head change, or base change suppresses
publication. Equal-text relinks still fail because source identity changes.

### 6.2 Criterion evaluator registry

Create one server-owned registry keyed by the closed criterion type and adapter
version. No caller, LLM, or report payload may select arbitrary code.

```ts
interface CriterionEvaluatorV2<TCriterion, TObservation> {
  evaluate(input: {
    criterion: TCriterion;
    evidence: IndexedDeterministicEvidence;
    observation?: TObservation;
    binding: VerifiedEvaluationBinding;
  }): VerificationCriterionEvaluationV2;
}
```

The evaluator returns only a server-derived criterion result with closed gap
kinds and exact evidence/axis references.

### 6.3 Static criteria

Static evaluation runs inside the AgentProof server over bounded, normalized
evidence.

#### Documentation literal

`satisfied` only when every exact path exists in the complete head tree and its
exact head blob contains the bounded literal after newline normalization. A
truncated diff patch or changed-file summary cannot satisfy this criterion.

#### Workflow job

`satisfied` only when the parsed workflow blob and GitHub metadata form one
exact tuple:

- workflow path and blob;
- workflow name and ID;
- run ID and attempt;
- job name and job ID;
- head SHA and successful conclusion;
- declared runtime and package script when required.

A matching Check name alone is insufficient.

#### Test case

`satisfied` only when a deterministic test parser finds the exact stable test
ID in the exact head blob at the exact path and a head-bound normalized suite
reports that path and test identity as passed.

#### Path-change absence

`satisfied` only from a complete changed-file inventory. Capped, stale, or
unavailable inventories produce `unavailable`, never a satisfied absence.

Static criteria provide the first deployable positive controls because they do
not require execution of PR code.

### 6.4 Return-value execution

Return-value criteria require an AgentProof-owned external execution service.
GitHub Actions, PR workflows, local child processes in the web service, and LLM
output cannot substitute for this service.

The durable request contains no status and includes:

- execution ID, tenant and repository IDs;
- head/base SHA and aggregate binding digest;
- exact criterion IDs and adapter versions;
- bounded module/function locators;
- bounded scalar inputs;
- approved executor image digest.

The executor independently rebuilds the binding, fetches the exact snapshot,
and runs each case in a fresh secret-free, network-denied sandbox. It returns
observations, not judgments:

```ts
type ReturnValueObservationV2 =
  | { kind: "returned"; actual: string | number | boolean | null }
  | {
      kind: "target_error";
      code: "symbol_missing" | "syntax_error" | "threw" | "timeout" |
        "process_exit" | "non_scalar";
    }
  | {
      kind: "environment_unavailable";
      code: "dependency_missing" | "loader_incompatible" |
        "executor_runtime_missing";
    };
```

The controller outside the target sandbox signs the canonical observation
envelope. The application verifies signature, key ID, image digest, execution
ID, binding, head, criterion order, case order, and adapter tuple before using
it.

Server evaluation is exact:

- every returned scalar equals the approved expected scalar -> `satisfied`;
- a loaded target returns a wrong value or produces a target error ->
  `violated`;
- an environment/control-plane error or absent valid attestation ->
  `unavailable`.

There is no retry that changes the evidence source and no unsigned fallback.

### 6.5 Aggregation and proof graph

For every criterion:

- create canonical criterion-owned proof axes;
- attach exact compatible evidence references;
- store the server-derived criterion state;
- retain unrelated implementation/test/CI facts as observation axes.

Only criterion axes affect outcome aggregation. Observation axes explain the
report but cannot promote status.

### 6.6 Full validator

Replace the temporary unconditional `satisfied` rejection with a positive
validation rule that is at least as strict:

- static `satisfied` requires exact deterministic evidence and collection
  completeness;
- behavioral `satisfied` requires a valid attested observation tuple and the
  server's expected-vs-actual comparison;
- criterion, requirement, and proof-node states agree;
- every criterion-owned axis and evidence reference resolves one-to-one;
- absent/invalid contracts cannot contain `met`;
- author claims cannot produce authoritative `met`;
- failed relevant execution cannot be hidden by another criterion;
- report-controlled text, gaps, or summaries cannot authorize an exception.

The validator independently recomputes all structural invariants. Verified
private storage additionally requires authenticity verification.

## 7. Sync and background flow

Both paths use the same orchestrator and finalizer.

### Static-only contract

1. Fetch current source, head/base, policy, files, tests, and Checks.
2. Parse and bind the contract.
3. Evaluate static criteria.
4. Re-fetch current source/head/policy.
5. Finalize, full-validate, sign, store, and publish.

### Contract containing return-value criteria

1. Perform the same initial fetch and binding.
2. Persist the execution intent and exact binding before dispatch.
3. Submit exactly one execution request.
4. Retrieve only the same execution ID.
5. Validate the signed observation envelope.
6. Re-fetch and rebuild the current binding.
7. Finalize only when every identity and binding still matches.

Uncertain submission never causes an automatic second execution. A late result
for a superseded job is ignored.

## 8. Reviewer guidance and output

Guidance is selected from contract and criterion state, not from requirement
wording alone.

### Contract absent

```text
Requirement outcome: Unclear
Outcome basis: No approved verification contract was provided.
Key gap: Approved verification contract is missing.
Next: Add or approve a typed verification contract, then rerun the analysis.
```

Do not say the objective itself needs clarification unless a separate
deterministic rule proves that condition.

### Contract invalid

```text
Requirement outcome: Unclear
Outcome basis: The supplied verification contract was invalid.
Key gap: Verification contract could not be validated.
Next: Correct the contract structure or unsupported criterion and rerun.
```

### Evaluator unavailable

```text
Requirement outcome: Unclear
Outcome basis: The approved criterion could not be evaluated.
Key gap: Attested verification execution was unavailable.
Next: Restore the approved evaluator and rerun; generic passing CI is not a substitute.
```

### Contract satisfied

```text
Requirement outcome: Supported against approved contract
Outcome basis: Every required criterion was deterministically satisfied.
```

PR-description contracts retain the reviewer-confirmation cap and never use
the authoritative positive label.

At repository level, the outcome policy is shown once. Requirement rows show
only their local basis and gap, avoiding the current repeated boilerplate.

## 9. Evaluation corpus

Do not modify all historical fixtures merely to force positive outcomes.
Preserve the current 20-report run as the no-contract baseline and add a small
contracted canary matrix.

| Canary | Contract/evidence | Expected |
| --- | --- | --- |
| PR #24 baseline | no contract; helper/test/passing CI | outcome `unclear`, observed evidence supported |
| PR #30 authoritative canary | explicitly provided or linked-Issue return-value contract for both booleans; valid attestation | `met` |
| PR #30 author claim | same contract only in PR description | `partial`, evidence status `met` |
| Documentation canary | exact path and literal | `met` from static evaluation |
| Workflow canary | exact workflow/job/runtime/script and GitHub identity | `met` only with complete successful tuple |
| Test-case canary | exact path/test ID/suite identity | `met` only with exact-head execution |
| PR #21-style failure | relevant failed execution | non-`met`; blocker remains visible |
| PR #19-style visual contract | unsupported v2 type | whole contract invalid, outcome `unclear` |
| Stale source | Issue edit or equal-text relink after evaluation | publication suppressed |
| Forged positive | missing/wrong attestation, axis, evidence, or binding | validator rejects |

PR #22 receives a separate requirement-local Check association test:

- if the failed Check is linked to the requirement, observed evidence cannot
  remain `Supported`;
- if it is unrelated, the report must expose enough Check identity and
  provenance to justify why the requirement-local evidence remained
  supported;
- overall failed CI must always remain visible at report level.

## 10. Acceptance gates

The closure is complete only when all gates pass:

1. The frozen 20-report no-contract corpus produces no `met` and preserves its
   evidence observations.
2. At least one authoritative static criterion produces a valid `met`.
3. PR #30's two return-value cases produce `met` only from a valid AgentProof
   attestation and server comparison.
4. Wrong returned values produce `violated`; unavailable infrastructure
   produces `unavailable`, never `missing`.
5. PR-description contracts are capped at `partial` even when all criteria are
   satisfied.
6. Missing-contract output never recommends clarifying an already precise
   objective.
7. Unsupported, malformed, duplicate, overflow, stale, and forged contracts
   fail closed with no partial acceptance.
8. Sync and background reports are identical for the same bound evidence.
9. Source edits, relinks, successor revisions, and late results cannot publish
   stale outcomes or trigger a second execution.
10. V1 reads, V2 private storage, public hashless sharing, and report signatures
    remain compatible.
11. No raw source, expected/actual private value, repository path, binding
    digest, executor log, token, or provider ID leaks to public share,
    telemetry, Slack, or generic error messages.
12. Full tests, typecheck, lint, build, and diff checks pass, followed by a
    skeptical independent review with zero open Critical or Important findings.

Passing unit tests prove only their covered boundary. Production rollout also
requires a private allowlisted execution canary and measured latency/error
evidence.

## 11. Implementation boundaries

Likely code boundaries are:

- `src/lib/verification-execution-v2.ts`: observation envelope, request,
  signature, and server comparison;
- `src/lib/verification-contract-v2.ts`: closed contract and criterion types;
- `src/lib/verifier.ts`: evaluator injection, materialization, and aggregation;
- `src/lib/report-validation.ts`: positive attestation/static-evidence
  invariants;
- `src/lib/github.ts`: source, policy, workflow/job, and stable test identity;
- `src/lib/analysis-jobs.ts`, `src/lib/analysis-worker.ts`, and migration:
  execution intent, binding, execution ID, and stale-result fencing;
- dashboard/Markdown/export view models: contract-specific basis, gap, and next
  action;
- fixture/evaluation suites: frozen baseline plus contracted canaries.

The implementation plan must split these into reviewed slices. The web service
must not execute repository code locally.

## 12. Explicit non-goals

This closure does not:

- infer or auto-approve contracts from natural-language prose;
- let Luna/Terra determine criterion state or final status;
- trust generic passing CI as behavioral proof;
- add UI, navigation, viewport, performance, HTTP, or state-transition
  criterion types to v2;
- migrate old v1 reports into v2 outcomes;
- rewrite existing saved reports;
- enable public or all-tenant execution rollout;
- persist raw executor stdout/stderr or repository source.

## 13. Rollout and rollback

Rollout order:

1. local parser/evaluator/validator fixtures;
2. static contracted canaries;
3. private allowlisted return-value executor canary;
4. PR #30 positive and negative result matrix;
5. full 20-report no-contract regression;
6. limited repository opt-in only after privacy and latency review.

One global kill switch disables new behavioral execution. Repository-level
versioned consent is required separately from LLM planning consent. Disabling
execution leaves observations available and criteria `unavailable`; it never
reverts to heuristic `met`.

## 14. Remaining unknowns

The following remain unknown until implementation and live canary testing:

- executor platform and operational ownership;
- signing-key rotation and incident procedure;
- production execution latency, queue depth, failure rate, and cost;
- language/runtime coverage beyond the two closed Node/Python scalar adapters;
- the exact cause of PR #22's requirement-local supported status;
- whether existing fixture workflows expose enough immutable job/test identity
  for workflow and test-case positive controls.

These unknowns block broad rollout, not the writing of an implementation plan
or local static-evaluator work.
