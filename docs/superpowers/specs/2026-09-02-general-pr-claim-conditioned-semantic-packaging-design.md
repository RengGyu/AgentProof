# General PR Claim-Conditioned Semantic Packaging Design

**Status:** Approved for implementation planning  
**Date:** 2026-09-02  
**Depends on:** `2026-09-01-general-pr-automatic-assessment-routing-design.md`, `2026-09-01-general-pr-semantic-schema-state-closure-design.md`  
**Product boundary:** Automatic, bounded evidence assessment for ordinary public pull requests; never strict verification authority

## 1. Problem

The current ordinary-PR semantic observer builds one package from the complete `GeneralPrObservationSeedV2`.

The live 25-PR run completed collection, but semantic packaging failed before useful interpretation in 23 cases:

- 17 cases exceeded the evidence-atom limit;
- 16 cases exceeded the source-span limit;
- the counts overlap because one case can exceed both limits;
- 1 additional case timed out; and
- 1 additional case returned an invalid provider result.

The current package also gives the provider full redacted source-span text but only coarse evidence records:

```ts
{ id, kind, completeness }
```

For changed-file clusters, it provides only:

```ts
{ id, roles, languages, completeness }
```

This produces two different failures:

1. **Capacity failure:** one oversized collection rejects the whole semantic package.
2. **Meaning failure:** opaque IDs and coarse metadata do not give enough bounded context to relate an admitted claim to a relevant change, test, check, or execution observation.

Simply raising the fixed limits moves the failure point, increases latency and privacy exposure, and still sends unrelated evidence. Truncating the first N records is also unsafe because input order is not relevance order and a truncated set cannot prove global absence.

## 2. Goal

Replace the single all-or-nothing semantic package with one automatic two-stage pipeline:

```text
complete deterministic seed
-> bounded claim-span selection
-> claim-discovery provider call
-> claim-conditioned deterministic evidence selection
-> evidence-linking provider call when useful
-> independent local validation
-> existing canonical proposal and finalizer
```

The system must:

- require no user mode or additional PR template;
- keep the complete seed as the canonical source of truth;
- make at most two provider calls per PR and perform no automatic retry;
- select evidence from deterministic signals before model judgment;
- give the provider enough bounded semantic descriptors to propose useful relations;
- keep every model relation at hypothesis level;
- preserve Verification Contract V2 authority and strict outcomes; and
- fail closed without turning sampled evidence into a global absence claim.

## 3. Non-goals

- Do not execute repository code.
- Do not add embeddings, a vector database, Tree-sitter, or another parser dependency in this package.
- Do not send the full diff, source file, log, URL, token, or raw workflow payload to the provider.
- Do not let the model create source authority, evidence IDs, statuses, receipts, or requirement outcomes.
- Do not infer support from global CI, changed-file proximity, file names alone, or model similarity.
- Do not add a user-facing deterministic/AI/strict mode.
- Do not change the public report, saved-report, tenant-summary, or share schema.
- Do not optimize directly for fewer `unclear` outcomes.
- Do not tune lexical rules or candidate weights against the current 25 public PR URLs.

## 4. Immutable boundaries

The following boundaries remain unchanged.

| Boundary | Rule |
|---|---|
| Canonical input | `GeneralPrObservationSeedV2` remains complete, deterministic, immutable, and exact-head bound. |
| Source authority | Linked Issue or provided contract authority is deterministic; PR title/body remain author claims. |
| Model authority | A provider output is a proposal only. It cannot produce verified evidence or strict `met`. |
| Freshness | The current public input is re-read before the first call and after every completed provider call. |
| Privacy | Provider packages are redacted, bounded, transient, and submitted with `store: false`. |
| Failure | Missing or sampled evidence never becomes a global “not implemented” or “test missing” conclusion. |
| Projection | Selection data, descriptors, provider output, and private receipts do not enter public or tenant outputs. |

## 5. Architecture

### 5.1 Full seed remains canonical

`buildGeneralPrObservationSeedV2()` continues to build the full source, change, test, check, and execution inventory.

The selector never mutates, truncates, or re-hashes the seed. It creates a transient view whose every ID is a subset of the full seed. The full seed hash is the parent binding for both provider calls.

```text
PullRequestInput
-> GeneralPrObservationSeedV2
   ├─ complete sources and spans
   ├─ complete change facts and clusters
   ├─ complete test artifacts
   ├─ complete check/execution observations
   └─ seedHash
-> transient selections
```

### 5.2 Two provider stages

Stage A answers only:

> Which selected source spans are plausible review objectives, claims, context, exclusions, or follow-up?

Stage B answers only:

> Which deterministically selected exact-seed observations are plausibly related to the admitted objective groups?

Stage B is skipped when Stage A admits no objective group or when no legal evidence descriptor can be selected. Skipping Stage B is a valid claims-only result, not a provider failure.

### 5.3 Maximum calls

| Condition | Claim call | Evidence call |
|---|---:|---:|
| Observer disabled or ineligible | 0 | 0 |
| Claim package cannot be safely built | 0 | 0 |
| Claim provider fails or returns invalid output | 1 | 0 |
| Valid claim output with no objective group | 1 | 0 |
| Valid objective group but no legal evidence candidate | 1 | 0 |
| Valid objective group and legal evidence candidates | 1 | 1 |

There are no retries. Each call uses the existing configured timeout and output limit. Runtime telemetry records aggregate stage and duration buckets so later performance work is based on measured data.

## 6. Stage A: bounded claim selection

### 6.1 Input

Stage A consumes:

- the validated full seed;
- redacted source views rebuilt from the current `PullRequestInput`; and
- the existing source authority, admission tier, role ceiling, structural kind, and deterministic claim role.

It selects at most `GENERAL_PR_SEMANTIC_OBSERVER_MAX_SPANS`, currently 12, whole spans. A span is never sliced to fit.

### 6.2 Eligibility

A span is eligible only when:

- its source and span bindings exist in the validated seed;
- the redacted text hash matches the seed;
- the source role ceiling is not `policy_only`;
- its structural kind is not excluded code or hidden HTML; and
- the complete serialized span entry can fit the claim packet byte budget.

An oversized individual span is omitted with `inputByteBudget`; it is not partially copied.

### 6.3 Deterministic selection order

Selection is stable and repository-independent.

1. Reserve the highest-ranked eligible span from each objective-capable source, in source precedence order.
2. Fill remaining slots from the global ranking.
3. If the byte budget is exceeded, remove the lowest-ranked non-reserved span.
4. If a reserved span alone cannot fit, omit it and continue with the next legal span.
5. Serialize selected spans in their original full-seed order, not rank order.

The rank is a fixed tuple, not a learned score:

1. source admission tier: `primary`, then `fallback`, then `context`;
2. source role ceiling: `objective`, then `context`;
3. existing deterministic role: objective/problem/change/test signals before unresolved/context/exclusion/process signals;
4. structural kind: title and list item before paragraph, table cell, heading, and blockquote;
5. original source order and span start offset as the final tie-break.

No new repository names, issue phrases, or case-specific keywords are introduced. Existing deterministic classification is only a ranking signal; it is not a semantic verdict.

### 6.4 Claim provider contract

Introduce a private strict-schema candidate:

```ts
interface GeneralPrSemanticClaimCandidateV1 {
  spanRoles: Array<{
    spanId: string;
    role: GeneralPrClaimRoleV2;
    abstained: boolean;
  }>;
  objectiveGroups: Array<{
    spanIds: string[];
    disposition: "candidate" | "not_objective" | "ambiguous";
  }>;
}
```

The provider receives only selected span IDs and selected redacted span text. It must decide every selected span exactly once. It cannot reference an unselected span or echo authority, hashes, versions, or group IDs.

The local validator independently enforces:

- exact root and item keys;
- all selected spans decided exactly once;
- no unselected or duplicate span ID;
- source ownership and authority ceiling;
- ordered, unique, contiguous objective groups;
- one source per group;
- objective-role/group consistency; and
- current parent seed hash.

The server derives canonical group IDs from ordered span IDs.

## 7. Stage B: claim-conditioned evidence selection

### 7.1 Why descriptors are required

An evidence ID plus `kind` and `completeness` is not enough to decide which claim it may relate to. Stage B therefore creates bounded descriptors from the already collected `PullRequestInput` and full seed.

Descriptors are transient hints for candidate selection and provider interpretation. They are not evidence receipts and never grant proof.

### 7.2 Descriptor contracts

```ts
type GeneralPrSemanticEvidenceKindV1 =
  | "change"
  | "test_artifact"
  | "check"
  | "execution";

interface GeneralPrSemanticEvidenceDescriptorV1 {
  evidenceId: string;
  kind: GeneralPrSemanticEvidenceKindV1;
  roleCandidates: string[];
  language: string | null;
  changeStatus: string | null;
  tokenSketch: string[];
  completeness: "complete" | "incomplete" | "unknown";
  subjectBinding: "exact_head" | "incomplete" | "unknown";
  relationBasis:
    | "released_static_relation"
    | "released_build_relation"
    | "changed_artifact"
    | "exact_subject"
    | "observation_only"
    | "unresolved";
}

interface GeneralPrSemanticChangeClusterDescriptorV1 {
  changeClusterId: string;
  roleCandidates: string[];
  languages: string[];
  tokenSketch: string[];
  completeness: "complete" | "incomplete" | "unknown";
  relationBasis: "released_static_relation" | "released_build_relation" | "rename" | "singleton";
}
```

Descriptor construction must rebuild and validate the seed binding. Array position alone is not accepted as identity proof.

### 7.3 Token sketch policy

`tokenSketch` gives bounded meaning without sending a raw path, patch, source file, or log.

Allowed inputs:

- redacted path segments and base name;
- redacted symbol-like tokens from patch hunk headers only;
- redacted check or job display names;
- existing language and role metadata.

Forbidden inputs:

- patch body lines;
- source code;
- log body or check summary;
- URL, email, token, SHA, secret-like value, or numeric run identity;
- complete raw path as one token.

Normalization is fixed:

1. run existing secret redaction;
2. Unicode-normalize and lowercase;
3. split on path, punctuation, camel-case, and digit boundaries;
4. remove empty, one-character, pure-number, SHA-like, and secret-placeholder tokens;
5. deduplicate in first-seen order;
6. cap each token at 40 characters; and
7. cap each descriptor at 16 tokens.

If a safe sketch cannot be produced, the descriptor remains legal with an empty sketch. Its relation basis stays the independently observed value when one exists; otherwise it is `unresolved`.

### 7.4 Candidate generation

For each admitted objective group, the server ranks legal change-cluster and evidence descriptors using three independent deterministic rankings:

1. token overlap between the objective’s selected redacted text and the descriptor sketch;
2. released static/build relation or existing cluster/test-artifact relation;
3. exact-subject binding and completeness.

The rankings are combined with Reciprocal Rank Fusion:

```text
RRF score(candidate) = sum(1 / (60 + rank_in_signal))
```

A missing rank contributes zero. The RRF score is only a selection score; it is never confidence, proof, or a report value.

Selection then:

1. reserves one highest-ranked candidate from each available evidence kind for an objective when it fits;
2. fills remaining per-objective slots by RRF score;
3. uses full-seed order and ID as deterministic tie-breaks;
4. deduplicates the descriptor catalog across objectives;
5. stops at 12 candidates per objective, 64 total relation candidates, and the existing input-byte budget; and
6. records every omission by a closed aggregate reason.

Evidence with no deterministic signal may still be included only through the diversity reserve. The provider may abstain or mark it unresolved. No candidate is selected solely because the model might find it useful.

### 7.5 Evidence provider contract

Stage B receives:

- admitted objective group IDs and their selected span IDs;
- redacted text only for spans in admitted groups;
- the selected change-cluster descriptor catalog;
- the selected evidence descriptor catalog; and
- an allowed-ID list per objective group.

It returns:

```ts
interface GeneralPrSemanticEvidenceCandidateV1 {
  testApplicabilityProposals: Array<{
    objectiveSpanIds: string[];
    changeClusterId: string;
    proposal: "likely_expected" | "likely_not_applicable" | "ambiguous";
  }>;
  scopeMappingProposals: Array<{
    objectiveSpanIds: string[];
    changeClusterId: string;
    proposal: "plausibly_mapped" | "unresolved";
  }>;
  evidenceRelationProposals: Array<{
    objectiveSpanIds: string[];
    evidenceId: string;
    proposal: "supports" | "tests" | "implements" | "contradicts" | "unresolved";
  }>;
}
```

The local validator rejects:

- unknown or unselected IDs;
- an ID selected for another objective but not the referenced objective;
- duplicate relations;
- cross-source objective groups;
- stale parent seed or selection hash;
- output above the existing byte or relation limits; and
- extra fields or partial repair.

The validated claim and evidence candidates are deterministically merged into the existing canonical `GeneralPrSemanticProposalV2`. When Stage B is skipped or fails, the claim candidate is merged with empty relation arrays.

## 8. Selection manifest and private receipt

### 8.1 Aggregate manifest

```ts
type GeneralPrSemanticSelectionCoverageV1 =
  | "complete"
  | "sampled"
  | "incomplete";

interface GeneralPrSemanticSelectionManifestV1 {
  version: 1;
  policyVersion: "general-pr-claim-evidence-selection.v1";
  parentSeedHash: string;
  claimSelectionHash: string;
  evidenceSelectionHash: string | null;
  selectionHash: string;
  mode: "full" | "selected";
  coverage: {
    sourceSpans: GeneralPrSemanticSelectionCoverageV1;
    evidenceCandidates: GeneralPrSemanticSelectionCoverageV1;
  };
  counts: {
    sourceSpansTotal: number;
    sourceSpansSelected: number;
    evidenceCandidatesTotal: number;
    evidenceCandidatesSelected: number;
    evidenceByKindSelected: {
      change: number;
      test_artifact: number;
      check: number;
      execution: number;
    };
  };
  omittedReasonCounts: {
    spanBudget: number;
    evidenceBudget: number;
    inputByteBudget: number;
    unsafeDescriptor: number;
    noDeterministicSignal: number;
  };
  claimPacketCount: 1;
  evidencePacketCount: 0 | 1;
}
```

`claimSelectionHash` binds the ordered selected source-span IDs, claim limits, policy version, and parent seed hash.

`evidenceSelectionHash` binds the ordered objective-to-candidate allowlists, evidence limits, policy version, and parent seed hash. It is null when Stage B is not constructed.

`selectionHash` is the final aggregate hash of the parent seed hash, policy version, `claimSelectionHash`, and nullable `evidenceSelectionHash`. All three hashes exclude raw text and token sketches.

### 8.2 Invocation receipt

Replace the transient V2 invocation receipt with a private V3 receipt:

```ts
interface GeneralPrSemanticInvocationReceiptV3 {
  version: 3;
  seedHash: string;
  claimSelectionHash: string | null;
  evidenceSelectionHash: string | null;
  selectionHash: string | null;
  modelProfileHash: string;
  claimPromptHash: string;
  claimSchemaHash: string;
  claimOutputHash: string | null;
  evidencePromptHash: string | null;
  evidenceSchemaHash: string | null;
  evidenceOutputHash: string | null;
  claimState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  evidenceState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  durationBucket: "lt_1s" | "1_3s" | "3_8s" | "gte_8s" | "unknown";
}
```

Selection hashes are null when selection never ran. The receipt is never stored in `VerificationReport`, tenant reports, public shares, jobs, Markdown, comments, Slack, dashboard exports, or audit exports.

## 9. Coverage and failure semantics

### 9.1 Coverage meanings

| Coverage | Meaning |
|---|---|
| `complete` | Every legal item in the full seed was included. |
| `sampled` | Legal items were omitted only by fixed count or byte budgets. |
| `incomplete` | The full seed or descriptor binding was incomplete or unsafe. |

A valid sampled claim result means:

> No candidate was found in the selected sample.

It never means:

> The PR has no requirement.

A sampled or incomplete evidence set cannot support a global missing-test, missing-implementation, contradiction, or absence claim.

### 9.2 Stage failure behavior

| Condition | Overall semantic result |
|---|---|
| Full seed invalid or stale | existing fail-closed unavailable/stale state |
| No legal whole source span fits | unavailable, package stage, `selection_unavailable` |
| Claim call unavailable/timeout/invalid | existing unavailable/timeout/invalid state |
| Valid claim output with no objective | valid `no_candidate` state |
| Evidence descriptor construction unavailable | valid claims-only proposal; evidence stage unavailable |
| Evidence call unavailable/timeout/invalid | valid claims-only proposal; evidence stage records exact failure |
| Evidence call valid | validated merged canonical proposal |

An evidence-stage failure does not erase a valid claim-stage result. It does prevent every relation-dependent promotion.

The legacy limit reasons remain readable for old telemetry but are no longer emitted merely because the full seed exceeds count limits. Count and byte pressure appear in the selection manifest’s aggregate omission counts.

## 10. Independent validation

The selector, provider candidate validators, and canonical finalizer have separate responsibilities:

```text
selector
-> chooses bounded IDs and builds descriptors

provider
-> proposes roles, groups, and relations using allowed IDs

stage validators
-> recompute ID ownership, bounds, hashes, and allowed relations

canonical validator/finalizer
-> applies existing authority and conclusion rules
```

The provider’s boolean, rank, or relation label is never trusted as proof. The finalizer continues to cap semantic-only targets at `evidence_partial`.

The stage validators must not call the selector’s “is valid” helper as their only check. They independently recompute:

- selected-ID subset membership;
- ordered source ownership and contiguity;
- objective-to-candidate allowlists;
- claim, evidence, and aggregate selection hashes;
- seed freshness; and
- output limits.

## 11. Privacy and observability

### 11.1 Transient-only data

The following must remain process-local and transient:

- selected span IDs and text;
- objective group IDs;
- token sketches;
- candidate allowlists and RRF scores;
- provider request and response bodies;
- selection and invocation receipts.

### 11.2 Allowed aggregate telemetry

Telemetry may contain only:

- `mode`;
- claim/evidence stage terminal states;
- total and selected count buckets;
- coverage enums;
- omission-reason counts;
- provider call count;
- duration buckets; and
- closed package/failure stages.

Telemetry must not contain IDs, hashes, paths, tokens, source text, check names, repository names, PR numbers, or provider output.

### 11.3 Projection guard

Unknown fields on public, tenant, share, storage, Markdown, Slack, dashboard, audit, and job-result projections remain rejected or omitted by their existing allowlists. Add sentinel tests for selection-specific names and representative secret/path values.

## 12. Evaluation

### 12.1 Engineering tests

- source selection is deterministic under repeated input;
- harmless input-array permutation does not change selection after canonical ordering;
- fixed ties resolve by full-seed order and ID;
- no packet exceeds count, byte, output, or call limits;
- every provider-referenced ID belongs to its stage allowlist;
- objective groups preserve source ownership and contiguity;
- stale head or changed source rejects both stages;
- evidence-stage failure returns claims-only, never proof;
- model-only relations cannot produce `evidence_supported`, strict `met`, or Supported; and
- route and worker behavior remain equivalent.

### 12.2 Metamorphic and mutation tests

- removing decisive candidate evidence downgrades or removes the relation;
- removing unrelated evidence leaves the proposal unchanged;
- changing seed, selection, span, cluster, evidence, or head binding fails closed;
- copying a relation to another objective is rejected;
- reordering selected IDs without updating the selection hash is rejected; and
- sampled coverage cannot produce an absence conclusion.

### 12.3 Privacy tests

Scan all projection surfaces for:

- selection and invocation field names;
- selected IDs;
- token sketches;
- raw path sentinels;
- source text sentinels;
- provider output sentinels; and
- secret sentinels.

Leak count must be zero.

### 12.4 25-PR production-shaped smoke

The current external corpus measures operational behavior, not semantic accuracy.

Required smoke properties:

- `completedCount === caseCount`;
- zero unexpected server errors;
- zero count-limit package failures when at least one legal selection exists;
- report every claim/evidence stage terminal and coverage distribution;
- report package-ready and provider-call rates;
- zero semantic-only strict `met`, Supported, or `evidence_supported`; and
- zero private-field leakage.

The smoke does not authorize a release based on a lower `unclear` count.

### 12.5 Labelled evaluation

Use frozen calibration and holdout cases that are disjoint by repository/task family.

Measure separately:

- claim-selection recall and precision;
- admitted-objective precision and recall;
- evidence-candidate recall at the fixed budget;
- relation precision;
- package-ready rate;
- sampled-coverage rate; and
- reviewer usefulness.

Hard gates remain:

- false Supported: 0;
- authority elevation: 0;
- cross-objective relation reuse: 0;
- stale/wrong-head use: 0; and
- privacy leakage: 0.

`unclear` reduction alone is not a success metric.

## 13. Rollout and rollback

### 13.1 Rollout

1. Implement selection and stage contracts behind the existing server rollout policy.
2. Run the new path in `shadow`; public report output remains byte-equivalent.
3. Compare baseline and candidate operational metrics on the 25-PR smoke.
4. Score labelled calibration and sealed holdout cases.
5. Enable advisory projection only after hard gates and labelled thresholds pass.

There is no user setting.

### 13.2 Rollback

Disable the server-side claim-conditioned selection policy and return to the existing semantic observer path or deterministic-only assessment.

Rollback does not require:

- report-schema rollback;
- database migration;
- saved-report backfill; or
- deletion of the complete deterministic seed.

## 14. Acceptance criteria

- Full `GeneralPrObservationSeedV2` remains the canonical, untruncated source.
- Oversized full seeds can produce a legal bounded claim packet instead of failing only on item count.
- Stage A selects at most 12 whole redacted spans with deterministic source diversity.
- Stage B is claim-conditioned, deterministic-first, bounded to 64 total candidates, and skipped when not useful.
- The provider receives bounded semantic descriptors rather than only opaque evidence IDs.
- At most two provider calls occur, with no retry and `store: false`.
- Both stage outputs are independently validated and bound to seed and selection hashes.
- Evidence-stage failure preserves a valid claims-only proposal but blocks relation-dependent conclusions.
- Sampled coverage never becomes global absence, contradiction, missing test, or missing implementation.
- Semantic-only results cannot produce strict `met`, Supported, merge readiness, or `evidence_supported`.
- No user configuration is added.
- Selection details and private receipts leak to no report, storage, share, tenant, Markdown, comment, Slack, dashboard, audit, job, or telemetry output.
- Existing Verification Contract V2 authority and outcome behavior remain unchanged.

## 15. Research basis

This design follows a common repository-navigation pattern: narrow the search space first, then inspect a claim-specific evidence neighborhood.

- Agentless localizes from file to symbol to edit location instead of sending an undifferentiated repository context: <https://lingming.cs.illinois.edu/publications/fse2025.pdf>
- AutoCodeRover combines issue terms with structure-aware repository search: <https://haifengruan.com/assets/pdf/autocoderover_issta24.pdf>
- RepoCoder uses iterative retrieval rather than one fixed retrieval pass: <https://aclanthology.org/2023.emnlp-main.151/>
- SWE-agent reports that overly broad search results confuse agents and recommends concise search output: <https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md>
- Reciprocal Rank Fusion combines independent rankings without training against the target corpus: <https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf>

These sources support the retrieval shape, not AgentProof verdict authority. All AgentProof authority, privacy, and validation boundaries remain local deterministic rules.
