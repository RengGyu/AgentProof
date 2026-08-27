# Closed Reference Oracle V2 Design

**Status:** Implemented and locally verified; release remains `NO_GO` pending
a freshly custodian-created protected corpus/seal, current production gates,
and independent exact-SHA review

**Depends on:**

- `2026-08-25-evidence-outcome-backbone-program-design.md`
- `2026-08-25-phase-4-release-closure-design.md`
- `2026-08-21-executable-release-evaluation-pre-freeze-design.md`

## 1. Decision

Replace the manually authored release-oracle tuples with one closed,
dependency-free reference policy over the protected input corpus.

The candidate runner and production report schema remain separate and
unchanged in authority. Only the evaluation transport is versioned to V2.
The current V1 freeze is invalidated and cannot establish a release result.

The goal is intentionally narrow:

- release-positive evaluation covers only `documentation_literal` and
  `path_change_absence`;
- `test_case`, `workflow_job`, and `return_value` always evaluate as
  `unavailable`;
- unsupported or ambiguous inputs are rejected before sealing;
- no manually authored per-case expected result survives in the release path.

## 2. Root cause

The V1 oracle asks its author to reproduce low-level candidate projections:

- source vocabulary and authority;
- manually selected requirement ordinals;
- observation-owned axis states;
- criterion-owned states;
- receipt counts and local-CI ownership;
- requirement outcome; and
- projection leak count.

Those values belong to different semantic layers. A structurally valid V1
oracle can therefore be semantically wrong. Reviewing the same tuples in
natural language does not close the gap because the reviewer repeats the same
manual interpretation.

## 3. Non-goals

This design does not:

- change `VerificationReportV2`, runtime validation, persistence, UI, share,
  Slack, Markdown, or export schemas;
- add a new production capability;
- execute repository code in a separate sandbox;
- promote generic tests, jobs, return values, or passing CI;
- make an LLM part of the release decision;
- claim general correctness, security, merge readiness, or reviewer value; or
- preserve any previous protected freeze as release evidence.

## 4. Alternatives considered

### A. Add more V1 tuple validators

This is the smallest diff, but it keeps arbitrary expected tuples and requires
their author to duplicate production semantics. It treats the symptom.

### B. Closed input-derived reference policy

The protected evaluator derives expected semantics directly from the same
sealed input using an implementation that imports no candidate verifier,
report validator, criterion evaluator, or report projection helper. This
removes authored expected tuples while keeping the holdout cases private.

**Selected.**

### C. Score only zero-count safety metrics

This avoids brittle structural comparisons but no longer proves positive and
negative static criterion behavior. It is too weak for release approval.

## 5. Trust boundary

```text
protected input-only corpus ─────────────┐
                                        ├─> independent reference policy
sealed policy/corpus binding ────────────┘               │
                                                        ▼
candidate tree + protected input -> candidate runner -> candidate projection
                                                        │
reference projection + candidate projection ------------┤
                                                        ▼
                                              aggregate-only release gate
```

The candidate runner never receives the seal, reference policy bundle, or a
derived reference projection. The evaluator receives the protected input,
seal, candidate result, and reference bundle. It emits aggregate metrics only.

## 6. V2 protected contracts

### 6.1 Input-only corpora

```ts
interface ReleaseCandidateCaseV2 {
  version: 2;
  caseId: string; // lowercase SHA-256
  input: PullRequestInput;
}

interface ReleaseCandidateCorpusV2 {
  version: 2;
  cases: ReleaseCandidateCaseV2[]; // exactly 12 for this release
}

interface ProductionBoundaryCorpusV2 {
  version: 2;
  cases: ProductionBoundaryCaseV2[]; // exactly 8 for this release
}

type ProductionBoundaryCaseV2 =
  | {
      version: 2;
      kind: "inbound_untrusted_v2";
      caseId: string;
      report: VerificationReport;
    }
  | {
      version: 2;
      kind: "pasted_merge";
      caseId: string;
      liveInput: PullRequestInput;
      pastedOverride: AnalyzeRequest;
    };
```

V2 removes `requirementOrdinals`. Every materialized objective and criterion is
enumerated in canonical contract order. A corpus containing `expected`, an
ordinal selector, an unknown field, duplicate ID, unsupported contract shape,
or an unbounded value is invalid.

Absent and invalid contracts do not enter the requirement projection corpus
because they have no materialized objective set. They remain mandatory in the
existing route/production replay gates.

### 6.2 Reference-policy seal

```ts
interface ReferencePolicySealV2 {
  version: 2;
  policyId: "agentproof-static-reference.v1";
  capabilities: ["documentation_literal", "path_change_absence"];
  referencePolicySha256: string;
  evidenceCorpusSha256: string;
  evidenceCaseCount: 12;
  boundaryCorpusSha256: string;
  boundaryCaseCount: 8;
  coverageSummary: CoverageSummaryV2;
  coverageSummarySha256: string;
}
```

The seal contains no expected result. `coverageSummary` is a closed derived
value: it has exactly 23 ordered, positive named entries and exact counts of
12 evidence cases plus 8 boundary cases. The reference policy derives it from
the input; it is not authored. The seal is invalid if a corpus hash, policy
hash, capability order, count, coverage entry, or coverage hash changes.

### 6.3 Candidate semantic projection

```ts
interface CandidateSemanticProjectionV2 {
  contract: {
    sourceKind: "linked_issue" | "provided_requirement" | "pr_description";
    state: "authoritative" | "author_claim";
  };
  objectives: Array<{
    requirementId: string;
    outcome: "met" | "partial" | "missing" | "unclear";
    criteria: Array<{
      criterionId: string;
      capability:
        | "documentation_literal"
        | "path_change_absence"
        | "test_case"
        | "workflow_job"
        | "return_value";
      requiredEvidence: string[];
      state: "satisfied" | "violated" | "unavailable";
    }>;
  }>;
  axes: Array<{
    requirementId: string;
    criterionId?: string;
    role: "criterion" | "observation";
    subject: string;
    state: "satisfied" | "violated" | "incomplete";
  }>;
  receipts: Array<{
    id: string; // opaque per-run handle
    requirementId: string;
    criterionId?: string;
    kind: "test" | "execution";
  }>;
  criterionLocalCi: Array<{
    requirementId: string;
    criterionId: string;
    association: "local" | "associated";
  }>;
  projection: {
    privateReceiptLeakCount: number;
  };
}
```

The projection deliberately excludes raw source, paths, literals, blobs,
patches, logs, workflow tuples, tokens, and source bindings. Generic
observation states are retained only so the evaluator can verify ownership;
they are never used as authored criterion expectations.

## 7. Closed reference rules

### 7.1 Source and authority

| Selected source | Contract state | Reference source kind | Outcome authority |
| --- | --- | --- | --- |
| provided contract | authoritative | `provided_requirement` | authoritative |
| linked Issue | authoritative | `linked_issue` | authoritative |
| PR description | author claim | `pr_description` | author claim |
| absent or invalid | excluded from requirement corpus | none | replay-only unclear |

The reference policy never uses report `analysisContext` vocabulary as the
contract source kind. It compares contract source and contract state directly.

### 7.2 Criterion capability

| Criterion | Capability | Allowed reference states |
| --- | --- | --- |
| documentation literal | `documentation_literal` | satisfied, violated, unavailable |
| path-change absence | `path_change_absence` | satisfied, violated, unavailable |
| test case | `test_case` | unavailable only |
| workflow job | `workflow_job` | unavailable only |
| return value | `return_value` | unavailable only |

No check, log, test path, job name, or execution suite can change a deferred
criterion from `unavailable`.

### 7.3 Documentation literal

The reference result is:

- `unavailable` when a declared path has no bounded exact-head blob, a blob is
  over 64 KiB, or the source/head binding is incomplete;
- `satisfied` when every declared exact-head blob contains the normalized
  literal; and
- `violated` when every blob is available but at least one lacks the literal.

Newlines normalize from CRLF/CR to LF. No fuzzy matching, symbol matching,
patch matching, or model interpretation is allowed.

### 7.4 Path-change absence

The reference result is:

- `unavailable` unless provenance is a complete exact-head GitHub snapshot;
- `unavailable` for pasted/mixed evidence or an incomplete rename record;
- `violated` when a prohibited exact path or prefix appears in a current path
  or previous rename path; and
- `satisfied` only when the complete current and previous-path inventory has
  no prohibited match.

### 7.5 Objective outcome

```text
absent/invalid contract or zero criteria -> unclear
all satisfied + authoritative            -> met
all satisfied + author claim             -> partial
some satisfied                            -> partial
all violated                              -> missing
otherwise                                 -> unclear
```

### 7.6 Axis ownership and safety

- Every criterion-owned axis must name exactly one criterion and match its
  `requiredEvidence` subjects.
- An observation-owned axis cannot carry a criterion ID.
- Observation state cannot replace criterion state or objective outcome.
- Any satisfied deferred criterion, satisfied deferred execution axis,
  non-empty `criterionLocalCi`, receipt reuse, unknown projection field, or
  private projection value is a zero-tolerance failure.
- `criterionLocalCi` is derived only from criterion-owned execution axes. A
  generic observation execution axis cannot create an entry.
- Receipt and privacy results are calculated from the candidate projection;
  they are not supplied by the seal or a human-authored expected record.

### 7.7 Boundary rules

- Inbound active V2 reports at the untrusted boundary are rejected.
- A non-empty pasted changed-files, checks, or logs override produces
  `pasted_evidence`, incomplete local axes, and unknown local-CI ownership.
- An empty evidence override preserves the bounded live provenance; it is not
  treated as pasted authority.
- Incomplete live collection never becomes complete.
- Unknown fields or private material fail corpus parsing before candidate
  execution.

## 8. Reference-policy independence

`scripts/evidence-release-reference-policy-v2.mjs` is a pure reference module.
It may import Node built-ins only. It must not import:

- `src/lib/verifier.ts`;
- `src/lib/report-validation.ts`;
- `src/lib/report-runtime-validation.ts`;
- `src/lib/verification-criterion-evaluator-v2.ts`;
- `src/lib/verification-contract-v2.ts`; or
- candidate runner modules.

The module duplicates only the closed public rule table above. Its static
closure and hash are recorded separately from the candidate runner bundle.
Repeated evaluation of the same bytes must produce byte-identical reference
output.

## 9. Custodian seal creation

The holdout custodian follows the closed public authoring contract in
[`2026-08-27-public-holdout-authoring-contract-v2-design.md`](2026-08-27-public-holdout-authoring-contract-v2-design.md)
and its versioned
[`holdout-authoring-v2.schema.json`](../../../schemas/reference-policy/holdout-authoring-v2.schema.json).
The custodian uses these candidate-independent commands in order:

```text
pnpm eval:reference:init
pnpm eval:reference:validate
pnpm eval:reference:seal
```

The broad `PullRequestInput`, `AnalyzeRequest`, and `VerificationReport` names
in this document are conceptual only. For authoring, they are superseded by
the closed public subset in that schema and design. It initializes protected
drafts, validates both input-only corpora through the authoritative reference
policy, then writes one `ReferencePolicySealV2`. The output path must be new
and different from both inputs. These commands never read a candidate tree or
candidate result, write a per-case expected projection, or provide a completed
example corpus.

Running only `seal` twice against identical bytes and different empty output
paths must produce byte-identical seal JSON. Invalid coverage, unsupported
cases, existing output, hash drift, or a V1 input fails before any seal is
written.

## 10. Coverage preflight

Before sealing, the reference policy derives a named coverage summary. The
evidence corpus must contain all of:

- documentation satisfied, violated, and unavailable;
- path absence satisfied, current-path violation, previous-path violation,
  and unavailable inventory;
- authoritative provided and linked sources;
- PR author-claim source;
- all three deferred capabilities as unavailable;
- at least one multi-objective contract preserving canonical order.

The boundary corpus must contain all of:

- authoritative and author-claim active V2 inbound rejection;
- pasted files, checks, and logs authority downgrade;
- empty override live-authority preservation;
- task-text or PR-description-only override live-evidence preservation;
- incomplete live collection remaining conservative; and
- private projection leakage remaining zero.

Unknown-field and secret-pattern corpus rejection stays in deterministic
development regression tests. An invalid case cannot be placed inside a
sealed multi-case corpus because the whole corpus must fail closed before any
candidate case runs.

The evidence corpus contains exactly 12 cases and the boundary corpus exactly
8 cases. Coverage entries may overlap; their names and counts are derived and
hashed. A missing coverage entry rejects the draft before sealing.

## 11. CLI and migration

The historical V1 release CLI used:

```text
--oracle <path> --candidates <path>
```

The V2 release CLI instead uses:

```text
--cases <path> --seal <path> --candidates <path>
```

The evaluator derives its own reference output in memory. It never writes a
per-case oracle or reference result.

V1 functions remain importable only for development regression tests. The
release CLI rejects V1 input, oracle, candidate, and seal artifacts. No V1
aggregate can satisfy the production-authority release gate.

Create
`2026-08-22-production-authority-blind-evaluation-rubric.v2.json` as the only
release-authority rubric. The V1 rubric remains historical/development-only.
The V2 rubric removes oracle bindings and anonymous category arrays and
requires the policy, seal, corpus, named coverage, candidate-result,
runner/evaluator bundle, separate runner/evaluator sandbox-profile, and V2
rubric-file hashes declared here.

The signed freeze bindings replace oracle hashes with:

- reference-policy hash;
- reference-policy seal hash;
- evidence and boundary corpus hashes;
- candidate-result hashes; and
- derived coverage-summary hash.

Hard-coded anonymous category arrays and hard-coded `totalCases === 4` checks
are removed. The authority gate requires exactly 12 requirement cases, 8
boundary cases, and all 23 named coverage entries from the signed V2 seal.

## 12. Runner and evaluator isolation

The frozen toolchain contains separate runner and evaluator bundles and two
separate sandbox profiles.

Runner attestations exist for the requirement and boundary surfaces. Their
read-only mounts are exactly:

```text
candidate_sut, protected_input, runner_bundle, runtime_profile
```

Their only writable mount is `result`. A runner cannot mount the policy seal,
reference policy, evaluator, rubric, development worktree, secret, or host.

Evaluator attestations also exist for the requirement and boundary surfaces.
Their read-only mounts are exactly:

```text
protected_input, policy_seal, candidate_result,
reference_policy, evaluator_bundle, runtime_profile
```

Their only writable mount is `aggregate_result`. An evaluator cannot mount the
candidate SUT tree, runner worktree, rubric, development worktree, secret, or
host. All four attestations require `networkMode: "disabled"` and bind their
exact mount-set hash, runtime image, input/result hashes, bundle hash, policy
hash, seal hash, and candidate SHA where applicable.

The toolchain manifest records `runnerSandboxProfile` and
`evaluatorSandboxProfile` separately, plus requirement/boundary runner
bundles, requirement/boundary evaluator bundles, the reference-policy bundle,
the V2 rubric file, and the seal-builder source closure. It rejects a candidate
runner that reaches the reference policy directly or through any transitive
tooling import.

## 13. Privacy and storage

- Protected input and transient blobs remain read-only evaluator mounts.
- Candidate output contains bounded structural identifiers only.
- Reference output exists in memory only.
- CLI stdout remains one aggregate JSON line.
- No case ID, path, source text, literal, blob, patch, log, token, workflow
  identity, or receipt ID appears in stdout, stderr, signed aggregate evidence,
  tenant storage, public share, Markdown, Slack, or export.

## 14. Failure behavior

The release gate returns non-zero and aggregate `UNKNOWN` when:

- the corpus, seal, candidate, or policy hash is missing or malformed;
- V1 or unknown versions are supplied;
- an input falls outside the total closed rule table;
- case sets differ or contain duplicates;
- reference coverage is incomplete;
- candidate generation fails before privacy projection;
- an unknown projection field appears; or
- any required runtime metric is absent.

Non-zero safety counts remain blocking. Latency and request/page counts remain
observable and cannot override a binary failure.

## 15. Compatibility and rollback

Production behavior and report schemas do not change. The evaluation V2
transition invalidates all previous freezes and requires an independently
created corpus and seal.

Rollback disables static positive promotion and returns conservative
`partial`, `unclear`, or `unknown` results. It does not restore V1 release
authority and does not backfill saved reports.

## 16. Acceptance

Implementation is complete only when:

- V2 rejects every authored `expected` tuple and ordinal selector;
- the reference policy imports Node built-ins only;
- every rule and coverage item above has a RED/GREEN test;
- source, criterion, outcome, axis-ownership, receipt, CI, and boundary states
  are derived from the closed rule table;
- V1 remains development-only and is rejected by release CLI/authority gates;
- output remains aggregate-only and privacy-safe;
- the custodian seal command is deterministic and candidate-independent;
- two runner and two evaluator attestations bind distinct exact mount sets;
- the V2 authority rubric requires every new policy/seal/evaluator binding;
- test, typecheck, lint, build, toolchain closure, and diff checks pass; and
- a new exact-SHA protected corpus is sealed only after the V2 implementation
  and independent review are complete.
