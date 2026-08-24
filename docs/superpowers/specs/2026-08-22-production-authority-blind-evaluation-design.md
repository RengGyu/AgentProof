# AgentProof production authority and blind release evaluation design

**Date:** 2026-08-22
**Status:** proposed implementation specification
**Evaluation contract:** `production-authority-blind-evaluation-rubric.v1`
**Predecessor:** `2026-08-21-executable-release-evaluation-pre-freeze-design.md`

## 1. Purpose lock

AgentProof remains an evidence-report product for AI-generated pull requests.
It does not become a general code reviewer or merge gate. Deterministic GitHub
metadata, diff, test, check, and execution evidence remain primary; model
interpretation cannot promote a requirement outcome.

This milestone has three goals:

1. close the remaining production authority and pasted-evidence provenance
   gaps without weakening conservative `Partial`, `Unclear`, or `Unknown`
   behavior; and
2. freeze the runner, evaluator, rubric executor, schemas, and rubric before
   any protected case is authored; and
3. evaluate the resulting candidate against a protected, independently frozen
   corpus using that fixed scoring contract.

The weighted score measures implementation completeness. It never overrides a
binary safety gate.

## 2. Current state

The pre-freeze candidate runner and aggregate evaluator have passed their
synthetic contract tests and independent review. They provide:

- exact candidate receipt-ID arrays rather than self-reported receipt counts;
- corpus-global opaque receipt handles;
- bounded inputs and per-case failure containment;
- closed share and tenant projection validation; and
- explicit runner and evaluator paths with no default holdout access.

This is not release evidence. No protected oracle has been created, inspected,
or scored by the implementation workers.

Two production defects remain in scope:

1. an untrusted full v2 report can carry active contract outcomes that were not
   rematerialized from transient server evidence; and
2. a logs-only pasted override can retain live GitHub provenance and execution
   authority even though the final evidence is mixed.

## 3. Scope

### Included

- harden the `inbound_untrusted_full` boundary;
- make every pasted files, checks, or logs override conservative and
  provenance-correct;
- preserve the generated-private server path for valid receipt-backed reports;
- independently freeze input-only cases and a separate expected oracle;
- add a closed release-assessment executor for this rubric, then freeze it with
  the existing candidate runner and aggregate evaluator;
- add a bounded production-boundary replay runner/evaluator for untrusted-v2
  and pasted-merge cases that the existing requirement runner cannot execute;
- score implementation quality with the predeclared rubric; and
- run engineering, compatibility, privacy, endpoint replay, and operational
  release gates.

### Excluded

- enabling `receipt_v2` globally before every release gate passes;
- accepting LLM-only evidence as verified;
- a VerificationReport V3 rewrite;
- field-level mixed-provenance schema migration;
- changing public/share or tenant schema for convenience;
- adapting the incompatible development holdout in place;
- fabricating missing external-pilot or production metrics;
- commit, push, deploy, or external PR mutation without a later explicit
  approval for the exact candidate SHA.

## 4. Non-negotiable invariants

1. `generated_private_full` is the only boundary allowed to preserve an active
   v2 contract outcome backed by transient source and receipt context.
2. `inbound_untrusted_full` never establishes an active v2 contract outcome.
3. Any non-empty pasted files, checks, or logs override removes GitHub-complete
   authority from the combined input.
4. Missing, incomplete, mixed, or contradictory provenance produces
   `Partial`, `Unclear`, or `Unknown`; it never produces a new positive.
5. Public/share and tenant projections contain no private source bindings,
   receipts, raw source, patches, logs, tokens, or workflow identity tuples.
6. The protected runner never receives the oracle. Implementation workers do
   not receive per-case expected outcomes or failing case contents.
7. Runner/oracle isolation, aggregate-only output, frozen-tool integrity,
   production smoke, exact-SHA independent review, and external regression are
   binary safety gates rather than weighted preferences.
8. A weighted score cannot convert a failed safety gate into a release.

## 5. Target architecture

```text
Untrusted report
      |
      v
inbound_untrusted_full
      |-- active v2 contract/outcome ----------> reject
      `-- receipt-free conservative summary ---> validate/import as unverified

Live GitHub input + any pasted override
      |
      v
conservative pasted-evidence rebuild
      |-- origin: pasted_evidence
      |-- no complete GitHub inventory authority
      |-- no workflow/execution identity authority
      `-- no live v2 criterion/source binding reuse

Frozen tooling manifest ----------------------------------------\
Protected requirement cases -> candidate runner -> requirement evaluator \
Protected boundary cases ---> boundary runner ---> boundary evaluator -----> release-assessment executor
Protected expected oracle -----------------------------------------------/
CI, smoke, review evidence ----------------------------------------------/
                                                       |
                                                       v
                                             binary gates + 100-point score
```

## 6. Workstream A — untrusted v2 authority boundary

### Required behavior

`validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full" })` must
reject a v2 full report when its contract state is `authoritative` or
`author_claim`. This rejection applies even when the positive claim is an
artifact or absence criterion and no targeted-test receipt is present.

An active v2 report is accepted only through `generated_private_full`, with the
original `PullRequestInput` and a freshly constructed validation context.

Receipt-free legacy or conservative imported reports may continue through the
existing untrusted validation path, but they remain imported/unverified and
cannot acquire active contract authority.

### Runtime callers

The rule must be enforced consistently for:

- report save/import;
- LLM verification input;
- GitHub comment publication; and
- Slack publication.

Callers must receive a bounded validation error. Raw report contents, source
text, or private validation details must not appear in the response.

### Compatibility gates

- Linked-Issue authoritative reports generated by the server may still reach
  `met` through `generated_private_full`.
- PR-description author claims remain overall partial even when evidence is
  supported.
- absent or invalid contracts remain exactly `unclear`.
- v1 conservative summary/import behavior remains unchanged.

## 7. Workstream B — pasted-evidence provenance

### Policy

The current provenance schema has one origin and cannot truthfully represent
field-level mixed authority. Therefore any non-empty pasted override is treated
as a conservative authority replacement for this milestone.

This includes pasted:

- changed files;
- checks; or
- logs.

### Required rebuild

After the final merged evidence is known:

- set `sourceProvenance.origin` to `pasted_evidence`;
- remove complete GitHub changed-file inventory authority;
- clear live execution suites and resolved-head modules used for positive
  promotion;
- remove workflow execution identities from retained observations;
- clear live verification-contract source, binding, and criterion evidence;
- rebuild the input fingerprint from the final evidence; and
- retain useful evidence only as non-authoritative observation metadata.

Pure live GitHub collection with no pasted override must retain its existing
head/base anchors and complete provenance when collection is complete.

### Failure behavior

- A logs-only override must not preserve requirement-local CI association.
- Mixed evidence must not satisfy absence criteria.
- Mixed evidence must not generate exact-head or changed-target positive
  receipts.
- Global CI may remain an observation when supported, but its local ownership
  is `Unknown`.

### Closed transition table

| Final input state | Provenance | Local proof axes | Requirement evidence status | Contract outcome | Global CI |
| --- | --- | --- | --- | --- | --- |
| Pure live, complete GitHub snapshot | `github_snapshot` | May be `satisfied` only through the existing receipt/context validators | Existing deterministic result | Existing authority rules | Existing collected result |
| Any non-empty pasted files/checks/logs override with bounded observations | `pasted_evidence` | `implementation`, `targeted_test`, and `execution` are all `incomplete` | `partial` | `unclear`; author claim remains non-authoritative | May be shown globally without requirement evidence refs |
| Any pasted override with unusable or contradictory observations | `pasted_evidence` | All local axes `incomplete` | `unclear` | `unclear` | `unknown` |
| GitHub collection incomplete with no pasted override | Existing incomplete origin | Existing fail-closed behavior; no new satisfied axis | `partial` or `unclear` | Existing fail-closed behavior | Collected global state or `unknown` |

No implementation may preserve a previously satisfied local axis after a
pasted override. Pasted evidence can remain visible as an observation, but it
cannot establish requirement-local ownership or a contract outcome.

## 8. Workstream C — protected freeze and blind evaluation

### Protected execution surfaces

The existing requirement candidate runner continues to execute normal
`PullRequestInput` cases for requirement, receipt, execution, and projection
behavior. It must not be stretched to pretend it exercises HTTP trust
boundaries or GitHub input merging.

Before the freeze, add a separate bounded production-boundary replay contract:

```ts
type ProductionBoundaryCaseV1 =
  | {
      version: 1;
      kind: "inbound_untrusted_v2";
      caseId: string;
      report: VerificationReport;
    }
  | {
      version: 1;
      kind: "pasted_merge";
      caseId: string;
      liveInput: PullRequestInput;
      pastedOverride: AnalyzeRequest;
    };
```

The boundary runner invokes the real `inbound_untrusted_full` adapter or the
real final pasted-merge adapter. It emits only opaque structural results:

- accepted or rejected disposition;
- final provenance origin;
- local proof-axis states;
- requirement-local CI ownership state; and
- private/output leak count.

It emits no report text, paths, source, patches, logs, receipts, validation
prose, or case details. A separate boundary oracle/evaluator derives at least:

- `untrustedActiveV2AcceptanceCount`;
- `pastedEvidenceGithubAuthorityCount`;
- `falseBoundaryLocalPositiveCount`;
- `boundaryPrivacyLeakCount`; and
- `boundaryStructuralMismatchCount`.

Every metric must be a known integer and zero for release. The boundary runner
never receives expected values.

Both runner inputs use closed, versioned envelopes. Unknown keys are rejected,
not ignored. The requirement corpus and boundary corpus are each limited to
400 KiB (409,600 serialized bytes), and each individual case is limited to
96 KiB. The separate oracle files are each limited to 128 KiB. Tests must cover
the exact limit and one-byte-over rejection. Boundary fixtures use synthetic,
sanitized data only and cannot contain tokens, credentials, real private
repository URLs, or raw private source/log payloads.

The pasted replay must call one exported production adapter after the final
evidence merge. It must not copy the merge policy into test-only code. Likewise,
the inbound replay must call the same runtime boundary used by production
save/import and publication callers.

### Freeze ownership

An independent reviewer creates protected input and oracle artifacts outside
the candidate worktree for both execution surfaces:

1. an input-only requirement corpus;
2. an input-only boundary corpus;
3. a separate requirement oracle; and
4. a separate boundary oracle.

The reviewer receives this contract and the public runner/oracle schemas, but
not implementation prompts, known fixture answers, or preferred case results.

Before production fixes start, the rubric executor and its tests are completed
and independently reviewed. The reviewer then publishes only:

- schema version;
- total case count;
- high-level category balance; and
- SHA-256 hashes of all four protected artifacts; and
- a tooling manifest containing SHA-256 hashes for the candidate runner,
  requirement schema/evaluator, boundary runner/schema/evaluator,
  release-assessment executor, rubric JSON, relevant package scripts, lockfile,
  and Node/pnpm versions.

### Frozen tooling closure and runner isolation

Hashing entry files is not sufficient. Before freeze, a deterministic tooling
manifest builder walks the static import graph from every evaluation runner,
schema, evaluator, and rubric-executor entry point. It records a sorted closed
list of tooling paths and SHA-256 values, then hashes that list and reproducible
runner/evaluator bundles. Dynamic imports, generated runtime code, and imports
outside that closure are rejected, except for fixed production SUT module
entry points declared in a separately hashed allowlist. The production SUT is
not frozen before its fix; its complete tree is instead bound later by the
immutable candidate SHA.

Protected runners execute in a clean, attested sandbox with network disabled.
Its read-only mounts are exactly:

- the frozen runner bundle and runtime profile;
- the appropriate protected input corpus; and
- the immutable production SUT tree at the candidate SHA.

Only the result location is writable. Oracle files, evaluators, the release
rubric, the development worktree, environment secrets, and unrelated host
paths are not mounted. The signed CI attestation records the sandbox-profile
hash, image/runtime digest, candidate SHA, mounted-file-set hash, network mode,
input hash, runner hash, and result hash. Runner/oracle isolation is therefore
established by unavailable authority, not by trusting a self-reported counter
or searching source text for the word `oracle`.

After this tooling freeze, none of those files may change. If a defect requires
a tooling or rubric change, the freeze is invalidated and a new version of the
tooling manifest, input corpus, and oracle must be created independently.

### Corpus quality

The combined protected corpora must:

- contain exactly 12 cases;
- place exactly four untrusted-authority cases and four pasted-provenance cases
  in the boundary corpus, plus four receipt/privacy cases in the requirement
  corpus;
- contain exactly two accept/preserve cases and two reject/downgrade cases in
  each category;
- use task and repository families not copied from development regressions;
- use opaque case IDs; and
- contain no secrets or real private repository content.

### Contamination rule

Implementation workers may see only aggregate evaluator output. If the frozen
evaluation fails, an independent reviewer first classifies whether the failure
is a product defect, oracle defect, collection limitation, or ambiguous case.

A case used to guide a code fix becomes a development regression and is removed
from future holdout scoring. A new independently frozen holdout version is then
required.

## 9. Evaluation contract

The machine-readable rubric is stored beside this specification as
`2026-08-22-production-authority-blind-evaluation-rubric.v1.json`.

Before protected artifacts are authored, implement a closed
`ReleaseAssessmentEvidenceV1` envelope and rubric executor. The envelope may
reference only:

- the existing aggregate evaluator JSON;
- the production-boundary aggregate evaluator JSON;
- the frozen tooling manifest;
- a signed runner-sandbox attestation for each execution surface;
- exact named command results produced at the candidate SHA;
- current production-smoke and external-regression artifacts; and
- an independent-review record bound to that SHA.

The executor validates exact keys and evidence bindings, awards points, applies
binary gates, and emits aggregate category totals plus the final decision. It
does not execute the protected runner, inspect case contents, accept manual
metric overrides, or infer missing values as zero.

Every command-backed evidence source is accepted only as a CI attestation bound
to the immutable candidate SHA and the frozen command/tool hashes. Caller-written
`passed: true` JSON is not evidence. Duplicate evidence-source IDs, duplicate
case IDs, unknown fields, missing bindings, stale hashes, and extra candidate
cases fail closed.

### Privacy validation is two-layered

Closed-field validation alone is insufficient: a known field such as `content`
could still carry raw source or a secret. Therefore privacy acceptance requires
both layers:

1. construct share and tenant results through the real production projection
   and sanitizer paths, then reject every unknown key; and
2. apply field-specific value validation to every allowed string. IDs, hashes,
   enums, counts, and bounded labels must match their declared formats; no
   generic arbitrary-text field is allowed in aggregate output. A recursive
   secret/raw-material detector remains defense in depth, not the primary
   proof of safety.

Aggregate output uses a strict closed schema. Scalar counters are numbers or
`UNKNOWN`. The existing requirement evaluator may retain only these exact
nested metric groups:

- `unexpectedFailure: { count, rate }`; and
- `durationMs`, `githubRequestCount`, `githubPageCount`, and
  `githubRetryCount`: `{ p50, p95 }`.

Each group has exact keys and numeric-or-`UNKNOWN` values. The boundary
evaluator uses scalar counters only. No output may contain nested arbitrary
objects, generic `content`/`message`/`details` fields, paths, prose, code,
patches, logs, receipt payloads, or source excerpts. This is a pre-freeze
compatibility migration with explicit tests for the existing evaluator output;
flattening its public aggregate contract is not required.

### Binary safety gates

Every item must be zero or passing:

- false Supported outcomes;
- untrusted active-v2 acceptance;
- pasted evidence reported as GitHub-authoritative;
- false requirement-local CI associations;
- cross-requirement receipt reuse;
- private projection leakage;
- structural mismatch or missing/extra protected cases;
- unexpected runner failures;
- unknown or non-zero production-boundary aggregate metrics;
- any required aggregate evaluator value reported as `UNKNOWN`;
- runner/oracle isolation and aggregate-only output;
- frozen tooling and artifact hash integrity;
- failing engineering, compatibility, endpoint replay, or external-regression
  commands;
- missing or failing current production smoke;
- missing independent approval bound to the exact candidate SHA.

Any failed binary gate means `NO-GO`, regardless of weighted score.

### Weighted implementation score

| Category | Weight | What it measures |
| --- | ---: | --- |
| Trust-boundary correctness | 30 | Untrusted rejection, valid server-generated preservation, contract compatibility |
| Provenance correctness | 20 | Pasted downgrade, authority clearing, pure-live preservation |
| Blind evaluation integrity | 20 | Frozen hashes, isolation, exact envelopes, aggregate-only evaluation |
| Privacy | 15 | Share/tenant omission, closed projections, no raw output |
| Regression and compatibility | 10 | Full gates, contract canaries, endpoint replay |
| Operational readiness | 5 | Correct CLI exits, real metrics, rollback record |

Each weighted criterion is all-or-nothing. Its points are awarded only when
every `requiredEvidenceSourceId` declared in the JSON rubric exists, is bound
to the exact candidate SHA where applicable, and satisfies its stated pass
rule. Partial credit, reviewer discretion, and inferred evidence are forbidden.

The independent release assessor is the scoring authority. The rubric executor
performs the calculation; the assessor verifies input authenticity and signs
the result. Implementation workers cannot self-award points.

Score interpretation after all binary gates pass:

- **95–100:** release candidate may proceed to deployment approval;
- **90–94:** conditional candidate; close scored gaps and rerun affected gates;
- **below 90:** `NO-GO`.

If a binary gate fails, the score is diagnostic only and must be displayed with
`NO-GO`.

## 10. Required evidence matrix

| Area | Required evidence |
| --- | --- |
| Untrusted v2 | RED/GREEN validator test plus route tests for save, LLM, comment, and Slack |
| Generated-private v2 | Positive server-generated receipt-backed report remains valid |
| Pasted provenance | files-only, checks-only, logs-only, and combined override regressions |
| Pure live provenance | exact-head complete GitHub replay remains unchanged |
| Contract compatibility | authoritative linked Issue, PR author claim, absent/invalid contract canaries |
| Privacy | share and tenant mutation tests, private receipt/raw-field absence |
| Protected evaluation | tooling and four artifact hashes, exact 12-case balance, two aggregate evaluator JSON objects, no case output |
| Engineering | full test, typecheck, lint, build, diff check, exact candidate-head CI |
| Operations | current production smoke, latency/failure metrics, external-pilot evidence |

## 11. Engineering sequence

1. Implement and independently review the boundary replay runner/evaluator,
   deterministic tooling-closure builder, sandbox profile, and closed
   release-assessment evidence envelope/rubric executor using synthetic
   development data only. Add compatibility tests for the requirement
   evaluator's exact closed nested aggregate groups.
2. Freeze both evaluation surfaces, their complete dependency closures and
   bundles, schemas/evaluators, sandbox profile, rubric executor, and rubric;
   publish the signed tooling manifest.
3. Independently create, freeze, and hash the four protected artifacts covering
   the exact 12-case balance. Do not run or reveal them yet.
4. Add RED tests for untrusted active-v2 reports and logs-only pasted authority.
5. Implement the two minimal production fixes.
6. Run focused tests, compatibility canaries, endpoint replay, full engineering
   gates, and an independent code review.
7. Create an immutable candidate commit only after explicit approval.
8. Run the requirement and boundary runners against their protected inputs in
   the attested no-network sandboxes, without mounting either oracle.
9. Run both frozen evaluators against their protected oracles and candidate
   outputs.
10. Restore authoritative external-pilot evidence, run current production
   smoke, and complete manual reviewer validation at the exact candidate SHA.
11. Feed only the declared evidence sources to the frozen rubric executor;
   apply binary gates, then calculate the weighted implementation score.
12. Have the independent release assessor verify and sign the result.
13. Seek explicit deployment approval for the exact candidate SHA.

## 12. Rollback

If any false Supported, authority leak, receipt reuse, privacy leak, protected
case mismatch, or production replay discrepancy appears:

- keep canonical parsing, receipt collection, and validators;
- turn positive promotion off;
- return affected results as `Partial`, `Unclear`, or `Unknown`;
- do not backfill legacy reports as verified; and
- require a new candidate and rerun every affected gate.

No report-schema or database rollback should be necessary.

## 13. Completion definition

This milestone is complete only when:

- both production defects are closed with RED/GREEN evidence;
- the protected artifacts remain sealed and hash-matched;
- the evaluation tooling matches the frozen tooling manifest;
- every binary safety gate passes;
- the weighted score is at least 95;
- full engineering, privacy, compatibility, endpoint replay, and production
  smoke gates pass;
- at least one independent reviewer approves the candidate diff; and
- the exact candidate SHA receives explicit deployment approval.

Until then the release status remains `NO-GO`.
