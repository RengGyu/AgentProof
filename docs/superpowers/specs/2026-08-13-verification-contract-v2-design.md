# Verification Contract v2 Design

**Status:** Proposed for review. This document authorizes no production change,
deployment, migration, or rollout.

**Supersedes:** The unapproved outcome-assessability regex design dated
2026-08-13. Implementation must remove or replace that experimental approach;
it must not layer this design on top of a growing subjective-word list.

## 1. Decision

AgentProof will stop treating free-form requirement prose as a sufficient
machine-verifiable success contract.

The v2 model separates three concepts:

1. **Objective** — what a human source says should improve or change.
2. **Verification contract** — approved, typed, deterministic criteria that
   define what counts as success.
3. **Observed evidence** — implementation, test, execution, visual, and
   interaction facts collected for the analyzed PR head.

`Supported against approved contract` (`status: "met"`) is allowed only when an authoritative objective
has an approved v2 verification contract and every required criterion is
deterministically satisfied. Related code, a focused unit test, and passing CI
remain valuable observations, but they cannot by themselves prove an
unbounded outcome such as “make the repository overview more useful.”

This is a strict opt-in v2 policy. Existing v1 reports remain readable under
their original semantics and are never silently reinterpreted.

## 2. Problem being solved

PR #24 demonstrates the failure mode:

- objective: “The repository overview should be more useful for reviewers.”
- implementation observation: `overviewActionLabel()` exists;
- test observation: a unit test checks the literal return value;
- execution observation: the exact-head repository test suite passes;
- missing fact: no success definition for “more useful” and no
  reviewer-visible integration evidence.

The current v1 proof contract reduces most requirements to implementation and
execution axes. Once both axes are satisfied, aggregation and full validation
force `met`. Expanding a vague-word regex cannot solve this generally: it both
misses novel subjective phrasing and blocks measurable requirements containing
words such as “better,” “clearer,” or “reliable.”

The root problem is structural, not lexical. The report lacks an authoritative,
typed definition of the outcome being verified.

## 3. Product semantics

### 3.1 Objective authority

Objective authority and evidence coverage remain separate.

| Objective source | Authority | Maximum outcome without reviewer approval |
| --- | --- | --- |
| Linked Issue | authoritative | `met`, but only with an approved contract |
| Provided requirement | authoritative | `met`, but only with an approved contract |
| PR description | author claim | `partial`; evidence may be complete but still needs reviewer confirmation |
| Model proposal | advisory only | no status effect |

Markdown headings, checkboxes, `should`, `must`, `required`, and “Acceptance
criteria” labels affect source presentation or priority only. They never create
a verification contract.

### 3.2 Status meanings

| Status | v2 meaning |
| --- | --- |
| `met` | An authoritative approved contract exists and every required criterion is satisfied. |
| `partial` | A valid contract exists and some required criteria are satisfied while others are violated, incomplete, or unavailable; or all evidence is satisfied for a PR-author claim that still needs confirmation. |
| `missing` | A valid contract exists, no required criterion is satisfied, and complete collection proves required implementation or behavior is absent/violated. |
| `unclear` | No approved contract exists, the contract is invalid, collection cannot support a deterministic outcome, or the objective’s success definition still requires a human decision. |

The status describes the **objective outcome**. Existing proof axes and the
proof graph describe **observed evidence**. In v2 it is valid for observed
implementation/test/execution axes to be satisfied while outcome status is
`unclear`, but only when the signed v2 contract state is `absent` or `invalid`.
A valid PR-description contract has state `author_claim`, not `authoritative`.

### 3.3 Criterion state aggregation

Each required criterion has one server-computed state:

```ts
type VerificationCriterionState =
  | "satisfied"
  | "violated"
  | "incomplete"
  | "unavailable";
```

Aggregation is deterministic:

1. An `absent` or `invalid` contract → `unclear`.
2. All required criteria in an `authoritative` contract satisfied → `met`.
3. At least one satisfied and at least one non-satisfied → `partial`.
4. None satisfied and **every** required criterion violated on complete
   collection → `missing`.
5. None satisfied and any criterion is `incomplete` or `unavailable` →
   `unclear`, even when another criterion is violated.
6. A PR-description objective caps a computed `met` at `partial` and records
   `evidenceStatus: "met"` plus its existing source-authority notice.

Failed requirement-linked execution remains a blocker and cannot be hidden by
other satisfied criteria.

## 4. Verification contract schema

### 4.1 Source contract

Authors provide a complete strict JSON object, not report IDs or proof axes:

```ts
interface VerificationContractSourceV2 {
  version: 2;
  scope: "complete_objective_set";
  objectives: Array<{
    id: string; // [a-z][a-z0-9_]{0,31}, unique in the contract
    objective: string; // bounded human-readable objective
    criteria: VerificationCriterionSourceV2[];
  }>;
}
```

The accepted source criterion union is also closed and contains no report
state:

```ts
interface CriterionSourceBaseV2 {
  id: string; // [a-z][a-z0-9_]{0,31}, unique within its objective
  label: string;
}

type VerificationCriterionSourceV2 =
  | (CriterionSourceBaseV2 & {
      type: "return_value";
      adapter:
        | {
            id: "node_export_scalar.v1";
            modulePath: string;
            exportName: string;
            moduleFormat: "esm" | "commonjs";
          }
        | {
            id: "python_function_scalar.v1";
            modulePath: string;
            functionName: string;
          };
      cases: Array<{
        id: string;
        input?: string | number | boolean | null;
        expected: string | number | boolean | null;
      }>;
    })
  | (CriterionSourceBaseV2 & {
      type: "artifact";
      paths: string[];
      artifact:
        | { kind: "documentation_literal"; literal: string }
        | { kind: "workflow_job"; workflowName: string; jobName: string; runtimeName?: string; runtimeVersion?: string; packageScript?: string }
        | { kind: "test_case"; testId: string };
    })
  | (CriterionSourceBaseV2 & {
      type: "absence";
      prohibitedKind: "path_change";
      scope: Array<{ kind: "exact" | "prefix"; path: string }>;
    });
```

`return_value` requires exactly one closed adapter object. Module paths are
exact repository-relative files; export/function names use the bounded ID
grammar. The Node adapter invokes the named export with zero arguments when
`input` is absent or one scalar argument when present, in a fresh target
sandbox per case. The Python adapter uses the same zero/one-scalar rule. No
constructor, method chain, object argument, environment override, setup hook,
or arbitrary command is supported. `artifact` requires 1–8 exact paths.
`absence` uses 1–8 exact/prefix scopes. Empty targets and extra invocation
fields are invalid.

For a linked Issue the object is inside one exact fenced block:

````markdown
```agentproof-verification
{
  "version": 2,
  "scope": "complete_objective_set",
  "objectives": [
    {
      "id": "visibility_label",
      "objective": "Return the repository visibility label for both boolean states.",
      "criteria": [
        {
          "id": "boolean_labels",
          "type": "return_value",
          "label": "The helper returns the correct label for both boolean values.",
          "adapter": {
            "id": "node_export_scalar.v1",
            "modulePath": "src/repositories/repository-visibility.js",
            "exportName": "repositoryVisibilityLabel",
            "moduleFormat": "esm"
          },
          "cases": [
            { "id": "private", "input": true, "expected": "Private repository" },
            { "id": "public", "input": false, "expected": "Public repository" }
          ]
        }
      ]
    }
  ]
}
```
````

The server validates source IDs for uniqueness but derives neutral report IDs
by canonical order as `vc_o<ordinal>` and `vc_o<ordinal>_c<ordinal>`, then
derives proof obligations from each criterion type. Source IDs remain only in
the private canonical contract binding and are never copied to public report
IDs. Source JSON never contains `requirementId`, `proofAxes`,
`requiredEvidence`, criterion state, evidence refs, status, or confidence.

A valid contract objective materializes as an authoritative requirement.
For the initial strict pilot, a linked-Issue contract block must be the only
substantive Issue-body content outside permitted template headings/whitespace;
human context belongs in a separate linked document and is not accepted as a
contract field in the initial pilot. Any other prose makes the contract `invalid` and caps
the entire report at `unclear`. This conservative rule prevents a complete
typed objective set from hiding an uncontracted prose requirement. There is no
fuzzy text matching or best-effort partial contract acceptance.

“Permitted template content” is exact: Unicode whitespace plus an optional
single Markdown heading `## AgentProof verification` immediately preceding the
fence. Comments, additional headings, checklist items, prose, or a second fence
are substantive and make the contract invalid. CR, LF, and CRLF forms are
normalized before exact range validation.

When no contract exists, the report-level policy is `absent` and no extracted
objective can become `met`, even if the display-oriented prose extractor omits
or truncates a candidate. The summary must state that objective outcomes were
not assessed against an approved contract. Thus prose inventory quality affects
review UX, not the false-`met` safety boundary.

### 4.2 Report-level contract

New reports use an explicit normalized v2 contract object. Optional TypeScript
fields are permitted only for decoding legacy v1 reports. A full/private newly
signed v2 report must contain the complete object including integrity; a public
summary uses the explicitly hashless portable variant and is rejected in full
validation mode.

V2 has a required top-level discriminant and is a structural union, not a v1
object with optional v2 fields:

```ts
interface VerificationReportV2 extends VerificationReportBase {
  reportSchemaVersion: "verification-report.v2";
  verificationContract: VerificationContractV2;
}

type DecodedVerificationReport = LegacyVerificationReportV1 | VerificationReportV2;
```

Historical v1 reports have no top-level discriminant. Their absence is accepted
only by an explicit `legacy_read` decoder. Every new generation, finalization,
verified-save, comment, and publication entrypoint requires `v2_full` or
`v2_summary` validation and rejects a missing/unknown discriminant. The signing
function refuses to create a new signature for a legacy-shaped report. This
prevents deleting v2 fields to route a newly generated report through v1 rules.
The legacy decoder returns an internal read-only wrapper branded with a
non-serializable `Symbol`; write APIs accept only `VerificationReportV2`, and
runtime checks reject the branded wrapper even if a caller bypasses TypeScript.

```ts
interface VerificationContractV2 {
  version: 2;
  policy: "strict_typed_contract";
  state: "authoritative" | "author_claim" | "absent" | "invalid";
  source: {
    kind: "linked_issue" | "provided_requirement" | "pr_description";
  };
  objectives: VerificationObjectiveContractV2[];
  /** Private verified/tenant reports only; omitted from portable/public reports. */
  integrity?: {
    algorithm: "sha256";
    contractDigest: string;
    verificationBindingDigest: string;
  };
}

interface VerificationObjectiveContractV2 {
  requirementId: string;
  state: "authoritative" | "author_claim" | "absent" | "invalid";
  criteria: VerificationCriterionV2[];
  criterionResults: VerificationCriterionEvaluationV2[];
  invalidReason?: VerificationContractInvalidReason;
}
```

The report-level state must agree with every objective state: an
`authoritative` or `author_claim` contract contains only that same objective
state; `absent`/`invalid` reports contain no authoritative criteria and no
requirement may be `met`.

`requirementId` must map one-to-one to both `requirements[]` and the matching
proof-graph node. Duplicate, missing, extra, or reordered objective mappings
are invalid. `absent` and `invalid` objectives must have no criteria.
`authoritative` and `author_claim` objectives must contain 1–4 required
criteria. A zero-criterion objective is invalid; aggregation never applies
vacuous “all criteria satisfied” logic.

### 4.3 Criterion common fields

```ts
interface VerificationCriterionBaseV2 {
  criterionId: string;
  requirementId: string;
  required: true;
  approval: "source_explicit" | "reviewer_approved" | "author_claim";
  label: string; // bounded reviewer-facing summary, not executable text
  locators: {
    paths?: string[]; // exact bounded repository paths
    symbols?: string[]; // exact bounded symbols or stable test IDs
  };
  requiredEvidence: RequirementProofSubject[];
}
```

Every criterion ID is unique within the report. `requiredEvidence` is derived
by the server from the criterion type and exists only in the normalized report.
It is not an accepted source-contract key. A model, report payload, or client
cannot choose proof axes. Source criteria provide exact bounded locators; a
keyword-only file-name overlap can suggest `Inspect first` but cannot satisfy a
criterion. At least one exact path, symbol, or stable test ID is required.

The normalized union is the exact source payload plus server-owned fields; it
does not leave placeholder aliases:

```ts
type NormalizeCriterionV2<C extends VerificationCriterionSourceV2> =
  C extends unknown
    ? Omit<C, "id"> & VerificationCriterionBaseV2
    : never;

type VerificationCriterionV2 =
  NormalizeCriterionV2<VerificationCriterionSourceV2>;

interface VerificationCriterionEvaluationV2 {
  criterionId: string;
  state: VerificationCriterionState;
  proofAxisRefs: string[];
  evidenceRefs: string[];
  gapKinds: ProofGapKind[];
}

type RequirementProofAxisV2 =
  | (RequirementProofAxis & {
      axisId: string;
      role: "criterion";
      criterionId: string;
    })
  | (RequirementProofAxis & {
      axisId: string;
      role: "observation";
      criterionId?: never;
    });
```

Each normalized objective contains `criteria` plus a same-order, one-to-one
`criterionResults` array of `VerificationCriterionEvaluationV2`. Every
`proofAxisRef` resolves to a v2 proof axis owned by that criterion. Observation
axes can inform the reviewer but never affect criterion aggregation.
`axisId` uses `ax_<requirementId>_<criterionId>_<subject>_<polarity>` for
criterion axes and `obs_<requirementId>_<subject>_<ordinal>` for observations.
The validator requires global uniqueness, canonical order, exact ownership,
subject/polarity compatibility, and reference closure; arbitrary string refs,
duplicates, cross-criterion refs, and unreferenced criterion axes are invalid.

### 4.4 Supported criterion types

The initial v2 pilot supports exactly the three source-union variants defined
in section 4.1: `return_value`, `artifact`, and `absence`. UI rendering,
navigation, state transition, visual, HTTP, and threshold/benchmark contracts
are deferred to a separately reviewed v2.1 schema. They are unknown types in
v2 and make the whole source contract invalid rather than falling back to
heuristics.

#### `return_value`

Defines a symbol and bounded scalar input/output cases.

Required evidence: `implementation`, `targeted_test`, `execution`.

Example: `repositoryVisibilityLabel(true) -> "Private repository"` and
`repositoryVisibilityLabel(false) -> "Public repository"`.
Satisfaction additionally requires an exact criterion-bound structured result;
source inspection and a generic passing suite remain observations only.

Invocation is closed: `node_export_scalar.v1` resolves the exact repository
file URL using the declared ESM/CommonJS mode and invokes the exact named export;
`python_function_scalar.v1` loads the exact file by path in an isolated module
namespace and invokes the exact named function. Each case starts a fresh target
sandbox, passes zero or one scalar argument exactly as declared, accepts one
finite scalar/null return, and times out at five seconds. Stdout/stderr,
filesystem changes, thrown errors after a successful module load, process exit,
non-scalar returns, or timeout produce a closed `target_error` observation and
therefore `violated`. Missing runtime dependencies, loader/runtime
incompatibility, or executor/control-plane failure produce
`environment_unavailable` (or no signed result) and therefore `unavailable`,
never `violated`/`missing`. A missing declared module path is established from
the complete head inventory before execution and is `violated`; no import is
attempted. Neither path triggers command discovery, dependency installation,
setup scripts, or retry.

#### `artifact`

Uses the exact source-union variants and exhaustive mapping below. It does not
accept arbitrary regular expressions or shell commands.

| Source variant | Derived proof subjects | Satisfaction rule |
| --- | --- | --- |
| `documentation_literal` | `documentation` | Every exact path exists in the head diff/inventory and contains the bounded literal after deterministic newline normalization. |
| `workflow_job` | `ci_configuration`, `execution` | Exactly one workflow path is allowed. Its head blob parses to the exact workflow name, job name, runtime, and script fields. GitHub API metadata must bind that path/name/job to one workflow ID, run ID/attempt, job ID/name, head SHA, and passed conclusion. Missing or ambiguous identity is incomplete/unavailable. This proves only the workflow criterion, not application behavior. |
| `test_case` | `targeted_test`, `execution` | Exactly one test path is allowed. Its deterministic framework parser finds the exact stable test ID, and one normalized passed suite at the exact head lists that exact file in `testPaths`, with runner/scope/execution-source and GitHub run/job identity. Missing/ambiguous file, ID, suite, or identity is incomplete/unavailable. |

No other mapping is permitted. A repository-discovery suite without the exact
test path or a source file without the exact stable test ID cannot satisfy
`test_case` in v2. V2 normalized execution metadata adds the GitHub workflow
path/ID, run ID/attempt, job ID/name, head SHA, conclusion, runner, scope,
execution source, and test paths as one immutable tuple derived from GitHub API
and supported runner output; Check-name text alone is never used.

#### `absence`

The v2 pilot supports only structural `path_change` absence. Each scope is an
exact normalized repository path or a directory prefix ending in `/`. Matching
is byte-for-byte after GitHub path normalization; there are no globs, regexes,
extensions, generated-file guesses, dependency semantics, or keyword rules.

Required evidence is a complete head-bound changed-file inventory including
renames and removals. Any changed path whose old or new path equals an exact
scope or begins with a prefix scope makes the criterion `violated`. No match in
a complete inventory makes it `satisfied`. Capped, missing, pasted, or stale
inventories produce `unavailable`, never `satisfied`. Other prohibited kinds
are deferred to a separately specified schema version.

### 4.5 Contract bounds

The parser rejects the entire contract, with no partial acceptance, when any
bound is exceeded:

- 1–12 objectives for an authoritative/author-claim source contract;
- 1–4 criteria per contracted objective and 24 total criteria;
- maximum 16 KiB canonical UTF-8 contract JSON;
- maximum 500 characters per objective;
- maximum 8 cases per return-value criterion;
- maximum 240 characters per display label;
- maximum 200 characters per literal/path/identifier;
- no unknown keys, duplicate IDs, unsupported types, arbitrary regex, code,
  prompt instructions, URLs with query/credential data, or non-finite numbers.

Invalid reasons are the exact closed enum:

```ts
type VerificationContractInvalidReason =
  | "malformed"
  | "overflow"
  | "unsupported_type"
  | "duplicate_id"
  | "conflict"
  | "source_mismatch"
  | "extra_source_prose"
  | "policy_unavailable"
  | "policy_invalid";
```

Contract absence is represented by `state: "absent"`, not an invalid-reason
value. Public copy may render a neutral explanation; raw parser errors are not
persisted.

## 5. Contract sources and deterministic precedence

The pilot uses exactly one authoritative contract source per analysis:

1. explicitly provided typed contract;
2. strict `agentproof-verification` JSON block in the selected linked Issue;
3. otherwise no approved contract.

Sources are not merged. If an explicitly provided or linked-Issue source is
present but invalid, the analysis is `unclear`; it does not silently fall
through to a weaker source.
PR-description blocks are parsed only as author claims and cannot produce
authoritative `met` without a later reviewer-approval workflow.

The Issue block parser recognizes only its exact fence and strict JSON schema.
It does not classify surrounding natural language, split conjunctions, or infer
criteria from adjectives. Multilingual objective prose therefore does not
change contract semantics.

The complete authoritative envelope is source-specific:

- a linked-Issue contract is valid only when the Issue title is exactly
  `AgentProof verification contract` and the body satisfies the exact-content
  rule in section 4.1;
- an explicitly provided contract uses a distinct request variant that contains
  the typed contract and source identity only; sibling `taskText`, requirement
  prose, or a second contract field is rejected;
- a PR-description contract follows the same exact-body rule, but the PR title
  is metadata and the result remains an `author_claim` capped at `partial`;
- repository policy cannot provide objectives.

There is therefore no authoritative content container in the pilot from which
a typed subset can silently omit a sibling objective. Inputs outside these
envelopes fall back to report-level `absent`/`invalid` and globally prohibit
`met`.

The only pilot policy path is
`.agentproof/verification-policy.v2.json`. It is fetched by exact base commit,
with a 16 KiB byte cap and exact-key schema:

```ts
interface VerificationPolicyV2 {
  version: 2;
  executor: {
    version: "agentproof_external_executor.v1";
    imageDigest: string;
  };
  enabledAdapters: Array<
    | "node_export_scalar.v1"
    | "python_function_scalar.v1"
  >;
}
```

The base SHA, policy path, Git blob identity, and canonical policy digest are
part of `verificationBindingDigest` and are rechecked before publication. A
missing policy provides no executable adapter. Fetch failure is
`policy_unavailable`; oversized, unknown-key, or malformed content is
`policy_invalid`. Neither condition silently falls through to name-based Check
trust. Repository policy cannot define, replace, or suppress objectives in the
initial pilot. A head-only policy file is evidence under review and has no
authority for the same PR. Adapter implementations are versioned AgentProof
code baked into the allowlisted executor image; repository policy can only
enable the closed IDs above and cannot provide adapter/harness code. An
absent/incompatible adapter leaves its criteria `unavailable`.

## 6. Evidence evaluation

### 6.1 Server-owned mapping

The server derives proof obligations from criterion type and evaluates them
using existing deterministic evidence:

- exact-head diff and changed-file inventory;
- bounded path/symbol evidence;
- targeted test artifacts;
- normalized execution suites and Check results;
- completeness and source provenance.

V2 adds `attested_execution` to the execution collection-basis union and
`execution_result` to the evidence-kind union. They are valid only on v2
criterion axes and reference the bounded signed execution result. A generic
passing Check remains `passing_execution` observation evidence and cannot be
substituted for `attested_execution`. V1 validation rejects both new values.

Evidence relevance remains requirement- and criterion-local. Repository-wide
passing CI cannot satisfy a criterion unless the normalized suite covers the
criterion's exact locator and linked changed test/artifact at the analyzed
head. A file-name keyword match is an inspection hint, not proof of a
user-visible outcome. AgentProof execution results bind criterion ID, aggregate
verification binding, and head SHA. Repository Check summaries are observations
only.

The behavior-producing `return_value` criterion requires one strict
`agentproof-verification-results.v1` result produced by the AgentProof-owned
isolated execution service at the exact head. GitHub Actions and PR-controlled
workflows remain observations only and cannot authorize behavioral `met`.

The artifact contains observations, never a caller-authored pass/fail state:

```ts
interface VerificationResultArtifactV1 {
  version: "agentproof-verification-results.v1";
  verificationBindingDigest: string;
  headSha: string;
  observations: Array<{
    criterionId: string;
    observation: {
      type: "return_value";
      cases: Array<{
        caseId: string;
        input?: string | number | boolean | null;
        outcome:
          | { kind: "returned"; actual: string | number | boolean | null }
          | {
              kind: "target_error";
              code: "symbol_missing" | "syntax_error" | "threw" | "timeout" | "process_exit" | "non_scalar";
            }
          | {
              kind: "environment_unavailable";
              code: "dependency_missing" | "loader_incompatible" | "executor_runtime_missing";
            };
      }>;
    };
  }>;
}

interface AgentProofAttestedVerificationResultV1 {
  payload: VerificationResultArtifactV1;
  attestation: {
    version: "agentproof-result-attestation.v1";
    issuer: "agentproof";
    keyId: string;
    repositoryId: number;
    executionId: string;
    executorImageDigest: string;
    adapters: Array<{
      criterionId: string;
      adapterId: "node_export_scalar.v1" | "python_function_scalar.v1";
      adapterVersion: 1;
    }>;
    signature: string;
  };
}

interface NormalizedVerificationResultV1 extends VerificationResultArtifactV1 {
  executionId: string;
  executorImageDigest: string;
  adapters: Array<{
    criterionId: string;
    adapterId: "node_export_scalar.v1" | "python_function_scalar.v1";
    adapterVersion: 1;
  }>;
  attestationKeyId: string;
}
```

Execution results use one JSON message, never an archive. Uncompressed UTF-8
payload and signed envelope are each capped at 64 KiB; compressed payloads,
multiple files, links, and path-bearing containers are rejected. The schema
permits exactly 1–24 observations, exactly one per behavioral criterion;
return-value observations contain 1–8 unique contract case IDs. Every string
is at most 200 characters, arrays have no duplicates, and numbers are finite.
Unknown keys,
extra/missing criteria, invalid UTF-8, non-canonical duplicates, and any bound
failure are rejected before canonicalization or signing.

The attestation and normalized `adapters` arrays are in the same canonical
criterion order as `payload.observations` and the durable execution request.
They contain exactly one `{criterionId, adapterId, adapterVersion}` tuple per
observation. Missing, extra, duplicate, reordered, incompatible, or
version-mismatched tuples invalidate the whole result.

The attestation is returned through the internal execution-job boundary. Its
tuple must equal the durable execution request, current source binding,
base-policy adapter enablement and allowlisted executor image. The
server then compares each typed observation to the approved criterion and
computes `satisfied`/`violated`; it never accepts a result state from the
executor payload.

Result retrieval is complete only after the exact durable execution job is
terminal and its signed payload has been schema-validated. The
observation type, exact criterion set, fields, binding digest, and head must
agree with the approved contract. Missing, extra, duplicate, conflicting,
self-authorized, or unbound observations make the relevant criterion
`incomplete`/`unavailable`; they never fall back to keyword matching.

The digest and producer authority are implemented through an AgentProof-owned
external execution service, not GitHub Actions, a repository workflow, or a
process that gives untrusted PR code access to signing identity. The service:

1. accepts only a server-authenticated durable execution request containing
   execution ID, repository ID, head/base SHA, criterion IDs, adapter IDs, and
   aggregate verification binding;
2. independently fetches GitHub-resident selected sources, base policy,
   and PR-head repository snapshot. For an
   explicitly provided contract, the durable request carries the complete
   canonical bounded contract plus tenant/source identity under an internal
   authenticated envelope; the executor verifies its digest against the
   aggregate binding and never attempts to fetch it from GitHub;
3. verifies the rebuilt binding before execution;
4. runs each PR-head target in an unprivileged, network-denied, secret-free,
   resource-limited sandbox. AgentProof adapter/controller code and signing
   keys remain outside that sandbox;
5. collects typed observations over a length-bounded IPC protocol controlled
   by the AgentProof-owned adapter/controller;
6. destroys the sandbox, signs the canonical result outside it with an
   AgentProof key, and returns the attested result to the exact durable job.

At finalization AgentProof independently re-fetches current source/head/policy,
recomputes the binding, matches the durable execution ID, executor image,
exact-order per-criterion adapter tuple, and verifies the attestation with its configured public
key. Repositories without this base-authorized adapter
can still receive observation reports, but behavioral criteria remain
`incomplete`; existing generic CI is never upgraded to structured behavioral
proof. Adapter distribution, permissions, and canonical digest test vectors
are explicit implementation dependencies and must pass cross-runtime fixtures
before any behavioral `met` is enabled. If the attestation service is
unavailable or any identity/blob/signature check fails, the criterion is
`unavailable`; there is no unsigned fallback.

Static `artifact` criteria may be satisfied by deterministic parsed artifacts
at exact paths. `absence` criteria may be satisfied only by complete inventory.
Neither requires a behavioral result record unless its derived policy includes
execution.

### 6.2 Existing proof graph

The proof graph remains the observation layer. In v2:

- each authoritative axis carries `criterionId`;
- each criterion result names the exact axis/evidence references it used;
- axes not attached to an approved criterion are observations only;
- all references must exist in the evidence index and be compatible with the
  subject, collection basis, analyzed head, and source provenance;
- model output cannot add, remove, satisfy, or violate an authoritative axis.

This preserves useful facts when no contract exists. PR #24 can still show the
helper file, focused test, and passing suite without claiming usefulness was
proved.

## 7. Generation, validation, and trust boundaries

### 7.1 Generation order

1. Collect and normalize deterministic PR evidence.
2. Select the authoritative objective source.
3. Parse and validate the typed contract, if present.
4. Bind objective source identity, exact source content, contract, head/base
   SHA, and frozen engine/schema versions into a canonical digest.
5. Evaluate each criterion deterministically.
6. Aggregate criterion states into requirement status.
7. Build proof graph, gaps, reviewer copy, and report.
8. Full-validate the report.
9. Re-fetch current source/head before publication and require the digest to
   remain unchanged.
10. Sign and store only after all checks pass.

An Issue edit or relink at the same PR head changes the binding and suppresses
publication. Background resume uses the same aggregate verification binding and current-source
recheck. It never submits a second provider request.

### 7.2 Full validator invariants

The full validator independently enforces:

- v1 and v2 are explicit structural variants, not optional-field guesses;
- validation modes are `legacy_read`, `v2_full`, and `v2_summary`; no new-write
  path calls `legacy_read`;
- top-level `reportSchemaVersion` exactly equals
  `authenticity.generator.reportSchemaVersion`, and v2 verified reports require
  authenticity rather than treating it as optional;
- a v2 report has exact objective/requirement/node/criterion mappings;
- authoritative/author-claim contracts have at least one objective and every
  such objective has 1–4 criteria; neither `met` nor `evidenceStatus: "met"`
  can arise from an empty set;
- criterion type determines the exact required proof subjects;
- criterion state agrees with axes, evidence refs, collection basis, and gaps;
- `met` is forbidden when contract state is absent/invalid, authority is an
  author claim, any required criterion is non-satisfied, or relevant execution
  failed;
- `unclear` with all observation axes satisfied is allowed only when the bound
  v2 contract state is absent/invalid;
- report-controlled summaries, requirement text, gaps, or planner metadata
  cannot authorize that exception;
- a model proposal never participates in status validation;
- private verified persistence additionally requires a valid HMAC signature.

A generic structural validator cannot prove a caller-supplied report matches
GitHub. Canonical trust is established at generation/finalization and verified
storage through source rebinding plus HMAC. Portable/imported reports remain
explicitly unverified.

### 7.3 Gaps

V2 adds closed deterministic gap kinds:

- `verification_contract_missing`;
- `verification_contract_invalid`;
- `criterion_evidence_incomplete`;
- `criterion_evidence_unavailable`.

Existing evidence-specific gaps remain. `ambiguous_requirement` is retained for
legacy v1 and human-review cases but is not used as a substitute for an absent
v2 contract.

## 8. LLM role

Luna may propose a bounded typed contract or explain why evidence is
insufficient. It cannot approve criteria, choose authoritative proof axes,
change criterion state, remove deterministic gaps, or promote a status.

For the initial pilot:

- proposals are advisory and have no status effect;
- malformed/incomplete proposals are discarded as a whole;
- provider failure falls back to the same deterministic v2 report;
- at most one provider POST occurs per analysis and background retrieval uses
  only the same response ID;
- no raw diff, log, token, source identity, or private digest is sent or stored;
- proposal persistence is deferred until a reviewer-approval audit contract is
  separately designed.

The first shipping UI may therefore offer deterministic contract templates
instead of persisting model proposals.

## 9. Rendering

Dashboard, Markdown, GitHub comment, Slack, and copied JSON separate the layers.
The positive label is “Supported against approved contract,” not an unlimited
claim that the product outcome is universally true:

```text
Requirement outcome: Unclear

Why:
No approved verification contract defines how reviewer usefulness is measured.

Observed evidence:
- Implementation found: src/repositories/OverviewAction.js
- Focused test found: test/repository-overview-action.test.js
- Exact-head repository test suite passed

Still unverified:
- No reviewer-visible render or interaction criterion
- No baseline, target behavior, or measurement for “more useful”
```

For PR-description objectives whose approved evidence criteria all pass, copy
must say: “Evidence is satisfied, but the objective comes from the PR
description and needs reviewer confirmation.” It must not collapse this into a
generic `Supported` label.

## 10. Persistence, sharing, and compatibility

### 10.1 Report contract

- add `verification-report.v2` to the authenticity schema union;
- add `VerificationContractV2`, criterion results, and criterion IDs on v2 axes;
- bump the deterministic engine version;
- newly generated strict-contract reports must be v2;
- v1 reports remain read-only and retain their original displayed semantics;
- v1 reports are never silently upgraded or re-signed as v2;
- reanalysis creates a new v2 report.

The saved-report JSON column can store v2 without a table-shape migration, but
all tenant projection, hydration, canonical signing, validation, and copy paths
must preserve the exact v2 tuple.

### 10.2 Background job binding

Background jobs require nullable, paired
`verification_contract_version` and
`verification_binding_digest` fields. The digest is the aggregate
binding over the canonical contract (or explicit absent/invalid state), exact
selected source content, normalized source-authority identity including linked
Issue relation, origin, head/base SHA, and frozen engine/schema versions. A
contract-only digest is not sufficient.

The pair is written atomically before provider submission, echoed only through
the existing aggregate planner binding, compared against a freshly rebuilt
source binding before GET/finalization, and cleared with the full provider
continuation on a successor revision. Partial, missing, malformed, stale, or
legacy-misclassified pairs fail closed. A same-contract Issue edit or equal-text
Issue relink still changes the source binding and suppresses publication.

### 10.3 Public sharing

Public portable sharing uses exact-key envelope V4 and the following exact
hashless projection:

```ts
interface PortableVerificationContractV2 {
  version: 2;
  policy: "strict_typed_contract";
  state: "authoritative" | "author_claim" | "absent" | "invalid";
  source: {
    kind: "linked_issue" | "provided_requirement" | "pr_description";
  };
  objectives: Array<{
    requirementId: string;
    state: "authoritative" | "author_claim" | "absent" | "invalid";
    invalidReason?: VerificationContractInvalidReason;
    criteria: Array<{
      criterionId: string;
      type: VerificationCriterionSourceV2["type"];
      displayLabel:
        | "Return value criterion"
        | "Artifact criterion"
        | "Absence criterion";
      requiredEvidence: RequirementProofSubject[];
    }>;
    criterionResults: Array<{
      criterionId: string;
      state: VerificationCriterionState;
      gapKinds: ProofGapKind[];
    }>;
  }>;
}
```

V4 requires exactly these keys at every level, exact objective/criterion/result
order, and the same structural tuple as the portable requirements/proof graph.
`displayLabel` is generated only from the closed criterion-type mapping shown
above. Source-authored labels, objective/criterion source IDs, locators,
literals, paths, expected values, and conditions never enter V4. V4 includes
neutral contract type, labels, and result states
needed to understand the report, but omits:

- contract/source binding digests;
- planner input hashes;
- raw objective source bodies;
- model plans or proposals;
- provider IDs, prompts, tokens, logs, or code excerpts.

Historical portable versions remain decodable under their original trust
label. Unknown keys and private-only fields are rejected before sanitization,
not silently copied or dropped.

## 11. Privacy and performance

Private source and contract digests exist only in approved private processing,
signed tenant storage, and the job binding needed for stale-source fencing.
Telemetry is limited to version, counts, byte sizes, elapsed time, provider-call
count, status distribution, and closed failure codes. It contains no objective
text, criterion literals, paths, evidence text, IDs, or hashes.

Behavioral verification requires a separate versioned repository grant,
`verification_execution_consent_version`. Existing Luna/enhanced-planning
consent does not authorize repository checkout or code execution. The consent
copy states that the exact PR-head repository snapshot will be processed by
versioned AgentProof-owned adapters in the isolated executor. Revoking
the grant prevents new executions and causes pending unsigned results to become
`unavailable`; it never falls back to GitHub Actions evidence.

The executor uses an ephemeral encrypted workspace, no tenant/provider tokens,
no repository secrets, denied outbound network, read-only source mounts
where practical, separate controller and target sandboxes, CPU/memory/time/file
caps, and destruction after result extraction. It persists only the signed
bounded typed observation; stdout/stderr, filesystem changes, raw code, crash
dumps, and sandbox images are not stored in reports or telemetry. Infrastructure
audit logs contain execution ID, tenant/repository ID, image digest, sizes,
timings, and closed result code only.

Parsing and evaluation operate within the bounds in section 4.4. The target
complexity is linear in contract size plus indexed evidence and emitted matches;
there is no per-criterion full-evidence rescan. Benchmarks cover maximum 12
objectives, 24 criteria, and current production evidence caps.

## 12. Rollout and rollback

V2 ships behind a new global kill switch and repository-level opt-in. LLM
planning remains behind the existing private enhanced-analysis consent;
behavioral execution additionally requires the separate execution consent in
section 11. It is not enabled by changing the model name alone.

Rollout stages:

1. local fixtures and frozen blind evaluation;
2. one private allowlisted fixture repository;
3. PR #24 and explicit positive/negative canaries;
4. limited private pilot after manual review;
5. broader rollout only after measured acceptance gates pass.

Rollback disables new v2 generation and provider planning immediately. Stored
v2 reports remain readable and verifiable; jobs that have not published fall
back without a second POST. Rollback never rewrites signed historical reports.

## 13. Acceptance matrix

| Case | Expected result |
| --- | --- |
| PR #24 prose + helper diff + literal unit test + passing CI, no v2 contract | `unclear`; observations preserved; contract-missing gap |
| “Make onboarding intuitive,” no contract | `unclear` in every language/paraphrase |
| “Acceptance criteria: Improve reliability,” no contract | `unclear`; heading does not authorize proof |
| Explicit Node `return_value` contract + exact implementation/test + isolated attested observations for every case | `met` |
| Explicit Python `return_value` contract + exact implementation/test + isolated attested observations for every case | `met` |
| `return_value` contract + generic passing CI but no AgentProof execution | non-`met`; observations preserved; behavioral execution incomplete |
| UI/navigation/state/viewport/threshold type in a v2 contract | whole contract invalid as unsupported; `unclear`; no heuristic fallback |
| `documentation_literal` artifact at exact paths | `met` possible from deterministic parsed artifact evidence |
| `workflow_job` or `test_case` artifact + exact matching execution | `met` possible only for that artifact criterion |
| Absence contract with capped inventory | `unavailable`/`unclear`; never satisfied |
| Related implementation/test + unrelated passing Check | execution incomplete; never `met` |
| PR-description contract with all criteria satisfied | outcome capped `partial`, `evidenceStatus: met`, source notice shown |
| Model proposes a valid-looking contract without approval | no status change |
| Issue content/relation changes at same PR head during analysis | stale-source fallback, publication suppressed, no second POST |
| Forged v2 `met` with missing contract, wrong criterion axes, or mutable gap text | full validation rejects |
| V1 saved report | reads unchanged as legacy; never silently gains v2 trust |
| Public v2 share | round-trips neutral criteria/results; contains no private digest/hash/raw plan |

Every behavioral row requires four layers of tests where applicable:

1. strict contract parser/schema;
2. deterministic verifier/finalizer;
3. adversarial full validator and signed storage/share round-trip;
4. dashboard/Markdown/GitHub comment/Slack rendering.

## 14. Release gates

Implementation is not rollout-ready until all are true:

- zero false `met` results in the frozen must-not-support holdout set;
- all valid typed positive controls produce the expected criterion states;
- malformed, overflow, duplicate, conflicting, stale, and unsupported contracts
  fail closed with no partial acceptance;
- exact sync/background parity and one-POST invariant pass;
- source edit/relink and successor-revision races suppress stale publication;
- v1 read compatibility and v2 signed tenant/public-share boundaries pass;
- privacy scan finds no raw source, private digest, prompt, provider ID, token,
  or code/log leak;
- bounded performance benchmark shows no unbounded nested scan;
- full test suite, typecheck, lint, build, and diff checks pass;
- an independent reviewer reports zero open Critical or Important findings;
- live provider latency and production p95 remain explicitly unknown until the
  allowlisted pilot measures them.

## 15. Implementation boundary

This specification does not authorize implementation. After approval, a
separate executable plan must sequence the work as small reviewed slices:

1. remove/supersede the failed regex-based experimental diff;
2. add v2 types, strict parser, and source binding;
3. add deterministic criterion evaluation and full-validator invariants;
4. add signed persistence, job binding, and portable-share versioning;
5. update human-facing renderers;
6. add blind fixtures, privacy/performance gates, and controlled rollout.

No deployment, database migration, environment change, GitHub mutation,
commit, push, or pilot enablement is part of this design-only task.
