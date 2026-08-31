# General PR Bounded Evidence Assessment Design

**Date:** 2026-08-31

**Status:** Implemented locally; awaiting user review, commit, and deployment approval

**Product decision:** Keep strict verification-contract outcomes unchanged and
add a separate, bounded evidence assessment for ordinary pull requests.

**Depends on:**

- `2026-08-25-evidence-outcome-backbone-program-design.md`
- `2026-08-25-phase-0-authoritative-output-safety-design.md`
- `2026-08-26-existing-github-evidence-release-scope-design.md`

**Does not supersede:** Verification Contract V2, its authority rules, or its
static-capability release boundary.

## 1. Purpose lock

AgentProof must remain useful on ordinary pull requests that were not written
for AgentProof. Users must not have to add a special contract, template, or
label before AgentProof can summarize the available evidence.

The product must answer two different questions without mixing them:

1. **Strict contract outcome:** Did approved deterministic evidence satisfy an
   authoritative typed verification contract?
2. **Ordinary PR evidence assessment:** How strongly does the evidence collected
   from this exact PR revision support, fail to demonstrate, or contradict the
   stated Issue or PR objective?

The second question is useful reviewer support. It is not a correctness
certificate, merge approval, or substitute for the first question.

## 2. Verified problem statement

The current 25-public-PR run produced 64 extracted requirement-like items:

- strict requirement outcome `unclear`: 64 of 64;
- observed evidence `partial`: 46 of 64;
- observed evidence `unclear`: 18 of 64; and
- CI: 19 passed, 2 failed, and 4 unknown.

This is not explained by evidence collection failure alone. The current flow
preserves the legacy observation in `evidenceStatus`, then replaces
`requirements[].status` with the strict contract result. An absent or invalid
typed contract must produce `status: "unclear"` under the current validator.

The general-PR observation pipeline also returns a deterministic report and a
separate observation bundle, but `/api/analyze` currently validates and returns
only the report. The bundle therefore cannot improve the saved or displayed
result.

The product defect is the final presentation and decision boundary:

```text
ordinary PR / linked Issue
  -> objectives extracted
  -> evidence collected
  -> evidenceStatus calculated
  -> typed contract absent
  -> strict status becomes unclear
  -> useful ordinary-PR assessment is not returned
```

## 3. Design decision

Add one optional, additive ordinary-PR assessment to a V2 report. It is
derived from the existing bounded observation pipeline and validated before the
report is returned, signed, stored, shared, or rendered.

**V1 release boundary:** production attaches only
`generalPrAssessmentSummary`: a target-free projection with a conclusion,
counts, source state, and closed reason codes. The `generalPrAssessment` full
shape exists only for private-validator compatibility and is not emitted by the
current service. This removes source bindings and span references before every
API, storage, share, dashboard, Markdown, Slack, and GitHub-comment surface.

Do not change these existing meanings:

- `requirements[].status` remains the strict verification-contract outcome;
- `requirements[].evidenceStatus` remains observed evidence coverage;
- an absent or invalid contract cannot produce authoritative `met`;
- a PR-description source remains an author claim; and
- unsupported V2 criteria remain `unavailable`.

When no approved typed contract exists, the ordinary-PR assessment becomes the
primary reviewer-facing result. The missing-contract notice is shown once at
report level, not repeated as the main result for every extracted item.

## 4. Source selection and authority

AgentProof consumes normal GitHub data as written. It does not require the PR
author to rewrite the PR.

### 4.1 Source precedence

1. A valid supplied or linked typed contract owns the strict contract outcome.
2. Linked Issues supply ordinary-PR objectives with `linked_issue` authority.
3. PR title and description supply `pr_author_claim` objectives.
4. If none contains an objective, AgentProof produces a scope/check evidence
   summary without inventing a requirement.

PR text cannot override a linked Issue or elevate itself to authoritative
contract status.

### 4.2 Multiple linked Issues

Every collected linked Issue remains a separate source unit with its own stable
source identity. AgentProof must not concatenate several Issues into one
synthetic contract.

- One objective-bearing Issue: assess its objectives normally.
- Several objective-bearing Issues: create separate objective groups and show
  their source Issue references.
- Ambiguous or unavailable Issue collection: keep the affected source group
  blocked and continue with independently valid PR observations.

### 4.3 Claim roles

The existing `GeneralPrClaimRoleV1` remains the structural classifier. The
assessment derives a separate, narrower role from it. No existing classifier
enum is renamed or reinterpreted.

```ts
type GeneralPrAssessmentClaimRoleV1 =
  | "acceptance_criterion"
  | "behavioral_objective"
  | "implementation_claim"
  | "test_claim"
  | "scope_exclusion"
  | "known_limitation"
  | "risk_claim"
  | "follow_up"
  | "context";
```

The mapping is closed:

| Existing structural role | Assessment role | Can become a target |
| --- | --- | --- |
| `objective_candidate` | `acceptance_criterion` or `behavioral_objective` | Yes |
| `change_claim` | `implementation_claim` | Yes, only for artifact evidence |
| `test_or_validation_claim` | `test_claim` | Yes, only for test/execution evidence |
| `problem_observation` | `context` | No |
| `scope_or_follow_up` | `scope_exclusion` or `follow_up` | No objective promotion |
| `supporting_context` | `context` | No |
| `process_or_template_meta` | `context` | No |
| `mixed_or_unknown` | `context` | No |

Known limitations and risk claims are retained only when an existing
deterministic source rule identifies them. They remain visible metadata and
cannot lower or raise an objective conclusion.

## 5. Bounded assessment contract

The new section is optional and additive. It does not create report V3 or
require a database migration.

```ts
interface GeneralPrAssessmentV1 {
  version: 1;
  mode: "ordinary_pr" | "typed_contract_companion";
  sourceState:
    | "linked_issue"
    | "pr_author_claim"
    | "mixed"
    | "missing"
    | "ambiguous";
  overallConclusion:
    | "evidence_supports_stated_change"
    | "mixed_evidence"
    | "attention_required"
    | "collection_blocked"
    | "no_assessable_claims";
  counts: Record<GeneralPrTargetConclusionV1, number>;
  targets: GeneralPrAssessmentTargetV1[];
  reasonCodes: GeneralPrAssessmentReasonV1[];
}

type GeneralPrTargetConclusionV1 =
  | "evidence_supported"
  | "evidence_partial"
  | "not_demonstrated"
  | "contradicted"
  | "blocked"
  | "not_assessable";

interface GeneralPrAssessmentTargetV1 {
  version: 1;
  targetId: string;
  sourceBindingRef: string;
  sourceAuthority: "linked_issue" | "pr_author_claim";
  sourceSpanRefs: string[];
  requirementId?: string;
  admissionBasis: "explicit_structure" | "semantic_span_proposal";
  claimRole: GeneralPrAssessmentClaimRoleV1;
  conclusion: GeneralPrTargetConclusionV1;
  reasonCodes: GeneralPrAssessmentReasonV1[];
  evidenceRefs: string[];
  relationLevels: Array<"verified" | "observed" | "hypothesis" | "unresolved" | "unavailable">;
  headBound: boolean;
}
```

`requirementId` is present only when the target maps to an existing canonical
report requirement. A future private full-report producer may contain target
records only after a release-approved evaluator exists. The current V1
producer emits only the summary projection: bounded counts, labels, and reason
codes.

### 5.1 Deterministic assessment-plan mapping

AI cannot decide what evidence is sufficient. The target's claim role and a
closed capability mapping define the minimum observations:

| Target kind | Minimum for `evidence_supported` | Ceiling when minimum is absent |
| --- | --- | --- |
| Documentation literal | Exact declared path and literal evaluated at head | partial or not demonstrated |
| Path presence/absence | Complete head-bound inventory and exact path/prefix rule | blocked if inventory incomplete |
| Implementation claim | Verified relation to the exact declared artifact or symbol change | partial for merely related diff |
| Test claim | Verified test-artifact relation plus exact-head execution binding | partial when only a test file changed |
| Behavioral objective | Verified implementation relation plus requirement-local execution, or a compatible supported static criterion | partial without execution/static proof |
| Scope exclusion | Complete changed-file inventory and exact declared scope | blocked if scope or inventory is ambiguous |

An ordinary prose claim that cannot be converted into one of these closed
plans is `not_assessable`. The implementation must not create a custom plan
from model prose just to obtain a positive result.

## 6. Closed conclusion rules

### `evidence_supported`

Allowed only when every observation required by the bounded target has a
verified relation, exact-head evidence, complete required collection, and no
contradiction.

The UI label is **“Evidence supports the stated objective.”** It must never be
rendered as “requirement satisfied,” “correct,” or “ready to merge.”

### `evidence_partial`

Use when relevant evidence exists but at least one required relation,
execution result, or collection element is unresolved. Hypothesis-only
relations can produce at most this state.

### `not_demonstrated`

Use only when the source makes a concrete observable claim and complete
collection shows the claimed artifact or result was not observed. Absence of
evidence from an incomplete collection is never `not_demonstrated`.

### `contradicted`

Use only for direct, requirement-local conflicting evidence, such as an exact
declared path condition that is false or an exact-head execution result bound
to the same named target that failed. Generic failed CI is not a contradiction
to every objective.

### `blocked`

Use for permission failure, head drift, incomplete required inventory,
unavailable linked source, invalid evidence identity, or a collection timeout
that prevents the bounded assessment.

### `not_assessable`

Use when the claim requires evidence AgentProof does not collect or support,
such as unspecified runtime behavior, broad product correctness, visual
quality without visual evidence, business intent, security completeness, or
test-suite adequacy.

Every non-supported state has at least one closed reason code. Its user-facing
next action is derived from that code through closed copy. Do not use a generic
`unclear` label or model-written action inside this assessment.

## 7. Evidence capability boundary

| Evidence | Allowed statement | Prohibited statement |
| --- | --- | --- |
| PR/Issue link | The PR is linked to this Issue | The Issue is fully satisfied |
| Exact-head changed-file inventory | These paths changed at this head | The change is behaviorally correct |
| Exact path or literal evaluator | The declared artifact condition is true or false | Broader product correctness |
| Changed test artifact | A related test artifact changed | The test passed |
| Exact-head Check | This named Check reported this conclusion | All tests or the requirement passed |
| Verified execution binding | This bound execution passed or failed | Unspecified behavior is correct |
| Check/SARIF annotation | This tool reported this finding at this location | No unreported defect exists |
| LLM/Copilot observation | A possible objective or relation was proposed | Verified evidence or outcome |

Checks, statuses, files, annotations, and source references reuse existing
GitHub collection. AgentProof does not execute customer code, download new
test artifacts, infer shell commands from display names, or build a new
attestation system in this scope.

## 8. AI boundary

The semantic observer may:

- select exact source spans;
- assign a closed claim-role proposal;
- group spans that appear to describe one objective;
- propose evidence relations; and
- write bounded reviewer explanations.

It may not:

- create or rewrite source text;
- choose source authority;
- create evidence;
- mark a relation `verified`;
- decide a target conclusion;
- change strict contract status; or
- supply a reason code that deterministic validation did not approve.

Invalid, stale, unavailable, or timed-out model output is ignored. The
deterministic report still completes. Semantic-only relations remain
`hypothesis`, so they cannot produce `evidence_supported` by themselves.

## 9. Aggregation and presentation

### 9.1 Overall conclusion

Derive the report-level conclusion in this order:

1. any `contradicted` target -> `attention_required`;
2. otherwise a collection failure affecting every assessable target ->
   `collection_blocked`;
3. at least one admitted target exists and every admitted target is
   `evidence_supported` ->
   `evidence_supports_stated_change`;
4. at least one supported, partial, not-demonstrated, blocked, or
   not-assessable target -> `mixed_evidence`; and
5. no admitted assessable target -> `no_assessable_claims`.

This aggregation does not produce merge readiness.

### 9.2 Primary UI order

For a report without an approved typed contract:

1. ordinary-PR evidence conclusion;
2. exact source used: linked Issue or PR author claim;
3. supported, partial, contradicted, blocked, and not-assessable counts;
4. requirement/objective cards with evidence and next action; and
5. one secondary notice: “No approved typed verification contract was
   supplied; AgentProof assessed only the observable evidence.”

For a valid typed contract, strict contract outcome stays first and the
ordinary-PR assessment is a companion evidence section.

For an invalid typed contract, show the invalid-contract warning first. The
ordinary assessment may still describe observations but cannot replace or
repair the contract.

### 9.3 Example copy

```text
Evidence conclusion: Partially supported

The linked Issue asks for session-token rotation to avoid a race. Relevant
implementation and test files changed, and the named Check succeeded on this
head. AgentProof did not collect a requirement-local execution result, so the
runtime behavior is not independently demonstrated.
```

This is more useful than repeating `Unclear`, while making the unverified
boundary explicit.

## 10. API, validation, storage, and privacy

1. `/api/analyze` and the background worker must finalize the same deterministic
   assessment from the same head-bound observation inputs.
2. The current observation bundle is not returned raw. A validator-approved
   assessment projection is attached to the V2 report.
3. Runtime validation checks enum closure, target/source ownership, evidence
   reference closure, exact-head binding, conclusion ceilings, and aggregation.
4. Report authenticity covers the assessment projection.
5. Existing saved-report readers accept the optional field. Old reports are
   not backfilled and display “assessment not recorded.”
6. Full private storage may retain bounded source bindings and digests. It does
   not add raw PR bodies, Issues, patches, logs, prompts, model output, function
   names, assertions, tokens, or workflow identity tuples.
7. Public share, tenant summary, Markdown, Slack, GitHub comment, and audit
   export use explicit allowlists. Unknown assessment fields fail validation;
   they are not silently copied.
8. Public and tenant projections contain only approved labels, counts, source
   kinds, reason codes, and already-shareable evidence references.

## 11. Required reason codes

The first version supports a closed minimum set:

```ts
type GeneralPrAssessmentReasonV1 =
  | "implementation_evidence_observed"
  | "test_artifact_observed"
  | "exact_execution_passed"
  | "exact_execution_failed"
  | "verified_relation_missing"
  | "execution_not_observed"
  | "claimed_artifact_not_observed"
  | "unsupported_claim_type"
  | "source_missing"
  | "source_ambiguous"
  | "source_unavailable"
  | "collection_incomplete"
  | "head_mismatch"
  | "evidence_identity_incomplete"
  | "semantic_relation_only"
  | "author_claim_requires_confirmation";
```

Adding a reason code requires a validator rule, presentation copy, privacy
review, and regression test. Renderers cannot accept arbitrary model text as a
reason code.

## 12. Acceptance matrix

Write RED tests before implementation.

| Case | Strict outcome | Ordinary assessment |
| --- | --- | --- |
| No contract, one linked Issue, implementation evidence and exact execution | unchanged `unclear` | supported when every bounded relation is verified |
| No contract, PR-description claim and changed implementation only | unchanged `unclear` | partial; author confirmation shown |
| No contract, passing global CI only | unchanged `unclear` | no behavioral support promotion |
| Generic failed CI with no objective relation | unchanged | global attention only; no target contradiction |
| Exact objective-bound failed execution | unchanged unless typed criterion owns it | target contradicted |
| Changed test without execution | unchanged | test artifact observed; execution unresolved |
| Semantic objective plus hypothesis-only relation | unchanged | partial at most |
| Unsupported visual or business claim | unchanged | not assessable with exact reason |
| Complete inventory disproves an exact path claim | unchanged unless typed criterion owns it | contradicted |
| Incomplete collection or head drift | unchanged | blocked, never not-demonstrated |
| Several linked Issues | unchanged | separate source-bound target groups |
| Invalid typed contract plus useful observations | invalid/unclear | companion assessment only |
| No objective found | no synthetic requirement | scope/check summary and no assessable claims |

## 13. Evaluation and release gates

### 13.1 Existing 25-PR replay

The current public corpus is a production-shaped regression set, not a gold
oracle. Replaying it must establish:

- 25 of 25 requests complete without unexpected error;
- head/base freshness and privacy behavior remain unchanged;
- existing strict contract statuses remain byte-for-byte unchanged;
- a missing contract no longer collapses the primary UI into repeated
  per-item `Unclear` labels;
- every assessment target has a source binding, conclusion, reason code, and
  valid evidence references; and
- the distribution of supported, partial, not-demonstrated, contradicted,
  blocked, and not-assessable states is reported rather than optimized.

### 13.2 Independently labelled cases

Release-positive evaluation requires cases not used to tune the implementation.
The hard gates are:

- false `evidence_supported`: 0;
- false authoritative `met`: 0;
- wrong source authority: 0;
- wrong or stale head association: 0;
- generic CI incorrectly mapped to a requirement: 0;
- incomplete collection treated as absence: 0;
- private-field leakage: 0; and
- sync/background/report-surface disagreement: 0.

Measure and report, but do not game, these product metrics:

- assessable-target rate;
- useful conclusion rate;
- not-assessable rate by reason;
- blocked rate by collection cause;
- linked-Issue versus PR-claim source mix; and
- reviewer useful / partially useful / not useful labels.

The first advisory-to-default usefulness gate requires at least three
independent reviewer sessions, at least 70% `useful` or `partially useful`
ratings, and a false-blocker rate below 20%. These product thresholds cannot
compensate for any non-zero hard safety failure above.

### 13.3 Mandatory engineering checks

- focused source, claim, relation, assessment, validator, and renderer tests;
- route and background-worker parity tests;
- share, tenant, storage, Markdown, Slack, comment, and audit privacy tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm build`; and
- `git diff --check`.

Passing these checks establishes only the tested bounded behavior.

## 14. Rollout and rollback

1. **Shadow:** calculate and validate assessment; return no user-facing field;
   record aggregate counts only.
2. **Advisory:** return and render assessment on selected public PR analyses;
   strict status remains unchanged.
3. **Default ordinary-PR view:** enable only after the independent safety gates
   and reviewer usefulness gate pass.

Rollback disables the advisory/default projection with one server policy. It
keeps collection, strict contracts, reports, and existing saved data intact.
No schema rollback or backfill is required.

## 15. Stop conditions

Stop implementation and return to this design if any change:

- promotes a PR description or model proposal to authoritative contract;
- changes existing strict contract outcome semantics;
- uses generic CI as requirement satisfaction;
- treats a changed test as a passed test;
- treats incomplete evidence as absence;
- executes customer code or adds an artifact/attestation platform;
- requires report V3 or a database migration;
- persists raw semantic output or expands raw source retention;
- produces a stronger result only to reduce the `Unclear` count; or
- repairs named fixtures with repository-specific wording rules.

## 16. Expected implementation surface

Likely files, subject to the implementation plan:

- `src/lib/types.ts`
- new `src/lib/general-pr-assessment.ts`
- `src/lib/general-pr-observation-service.ts`
- `src/lib/report-validation.ts`
- `src/lib/report-runtime-validation.ts`
- `src/app/api/analyze/route.ts`
- `src/lib/analysis-worker.ts`
- `src/lib/requirement-presentation-v2.ts`
- dashboard, Markdown, Slack, GitHub comment, share, tenant, storage, and audit
  projection files and tests
- existing general-PR observation and evaluation tests
- current external-PR smoke summary scripts

Do not create a second collector, report generator, storage system, or release
framework.

## 17. Completion record for later AI evaluation

The implementation handoff must contain exactly these evidence sections:

```text
SCOPE: implemented design sections and deliberate exclusions
FILES: changed files grouped by source, assessment, validation, and presentation
SEMANTICS: proof that strict status and authority rules did not change
ASSESSMENT: supported states, ceilings, reason codes, and aggregation behavior
AI_BOUNDARY: proof that model output cannot set evidence, authority, or conclusion
PRIVACY: full/private and every summary projection result
REPLAY: 25-PR state distribution and unexpected-error count
INDEPENDENT_EVAL: false-supported and other hard-gate counts, or UNKNOWN
TESTS: exact commands, exit codes, and counts
RELEASE: GO/NO_GO and every remaining external gate
```

Self-reported completion is not evidence. A later evaluator must compare this
record with the actual diff, runtime validator behavior, test output, and exact
candidate SHA.

## 18. Implementation record (2026-08-31)

### Scope completed

- Strict V2 requirement outcomes, evidence status, source authority, and
  capability policy remain unchanged.
- Advisory ordinary-PR analysis attaches a target-free
  `generalPrAssessmentSummary` after deterministic report generation.
- Current emitted conclusions are deliberately capped at `evidence_partial`,
  `blocked`, or `no_assessable_claims`. Generic CI, a changed test file, and
  semantic proposals cannot yield `evidence_supported` or `contradicted`.
- Public API, share links, tenant storage, dashboard detail/export, Markdown,
  GitHub comment, Slack, and report views render only the closed summary.

### Privacy and validation boundary

- The API response and persisted/share projections omit targets, source
  bindings, source spans, raw source, patches, logs, workflow identities, and
  evidence references from this companion assessment.
- Runtime, tenant, and share validators reject unknown summary fields.
- A target-free summary attempting `evidence_supported` or `contradicted` is
  rejected; PR-author claims require the reviewer-confirmation reason code.

### Verification evidence

- `pnpm test`: 185 files passed; 2355 tests passed; 2 skipped.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm build`: passed.
- `git diff --check`: passed at the implementation review point.

### Deliberate exclusions

- No behavioral code execution was added.
- No generic CI-to-requirement promotion was added.
- No LLM output can set authority, evidence support, or a conclusion.
- No commit, push, deployment, or live external-PR rerun has been performed.

## 19. External design references

- GitHub linked Issues provide traceability and automatic closure behavior, not
  proof of requirement satisfaction:
  <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
- GitHub Checks provide commit-scoped status, logs, annotations, and details;
  skipped checks may still appear successful:
  <https://docs.github.com/en/pull-requests/reference/status-checks>
- Check-run annotations provide structured path and line evidence:
  <https://docs.github.com/en/rest/checks/runs>
- SARIF separates rules, results, fingerprints, and source locations:
  <https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support>
- GitHub states that Copilot review can miss problems or make mistakes and must
  be validated and supplemented by human review:
  <https://docs.github.com/en/copilot/concepts/agents/code-review>
