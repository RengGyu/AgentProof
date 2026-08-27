# Public Holdout Authoring Contract V2 Design

**Status:** Implemented locally; independent protected-corpus authorability and
release remain `NO_GO` pending custodian execution and current production gates

**Depends on:**

- `2026-08-26-closed-reference-oracle-v2-design.md`
- `2026-08-25-phase-4-release-closure-design.md`
- `2026-08-21-executable-release-evaluation-pre-freeze-design.md`

## 1. Decision

Publish one closed JSON authoring subset for the V2 protected evidence and
boundary corpora. Give an independent custodian three deterministic commands:

```text
init -> validate -> seal
```

The contract describes the smallest closed subset needed to create the V2
release corpus. Every public-authoring input is accepted by the V2
reference-policy boundary after semantic validation, but the internal parser
may continue accepting broader legacy observation records. The contract does
not expose candidate results, generate reference outcomes, or interpret case
meaning for the custodian.

Use the already installed Ajv 6 dependency with JSON Schema draft-07 for the
authoring-time structural check. Keep the dependency-free reference policy as
the release authority. Add parity checks so the public schema and authoritative
parser cannot silently diverge.

Do not add a second authoring DSL or a semantic bridge in this change. A thin
deterministic bridge may be reconsidered only if an independent custodian still
cannot complete the corpus after this contract is available and the remaining
failures are proven to be mechanical rather than semantic.

## 2. Problem

The closed reference policy is implemented, but an independent custodian cannot
currently create valid V2 input from the public design and `src/lib/types.ts`.

There are three concrete causes:

1. The public design names broad production types such as `PullRequestInput`,
   `AnalyzeRequest`, and `VerificationReport`, while the seal boundary accepts a
   narrower wire format.
2. Some referenced TypeScript types are imported from other internal modules,
   so `src/lib/types.ts` is not a self-contained authoring contract.
3. The seal CLI collapses syntax, shape, cross-field, privacy, and coverage
   failures into `REFERENCE_POLICY_SEAL_INVALID`, so an author cannot correct a
   draft without reading implementation code or tests.

The existing automated tests do not prove public authorability because their
seal fixtures are built by helper functions defined next to the private parser
tests. Those tests prove the internal fixture and parser agree; they do not
prove an independent author can use the published contract.

This is a release-evaluation authoring gap. It does not by itself establish a
production verifier defect, and it does not justify changing production report
semantics.

## 3. Goal

An independent custodian who receives only the public authoring bundle must be
able to:

1. create the required 12 evidence-case and 8 boundary-case draft files;
2. learn which bounded structural or cross-field rule a draft violates without
   seeing its protected values in diagnostics;
3. satisfy the already published 23 named coverage requirements;
4. create a deterministic V2 seal; and
5. do all of the above without reading the reference-policy implementation,
   candidate runner, candidate output, or test fixture builders.

The public authoring bundle consists only of:

- this design and the closed-reference-oracle V2 design;
- one versioned JSON Schema file;
- the `init` and `validate` commands and their short usage text; and
- the existing `seal` command.

The custodian may execute these commands but is not given the implementation
source of the reference policy or its tests.

For authoring only, this document replaces the broad type aliases shown in
Section 6.1 of the closed-reference-oracle V2 design. The reference rules,
coverage names, capability limits, seal format, and release authority in that
design remain unchanged.

## 4. Non-goals

This design does not:

- change `/api/analyze`, report generation, runtime report validation,
  persistence, UI, public share, Markdown, Slack, or export;
- add or promote a production verification capability;
- make `test_case`, `workflow_job`, or `return_value` release-positive;
- execute repository code or workflows;
- create case meaning, reference expected states, requirement ordinals, or candidate
  projections for the custodian;
- publish a completed protected corpus or a completed sealable example corpus;
- add CUE, JTD, a schema generator, or another dependency;
- overwrite existing custodian files; or
- mark the current release `GO`.

## 5. Public contract boundary

### 5.1 Normative schema

Add one public, versioned schema:

```text
schemas/reference-policy/holdout-authoring-v2.schema.json
```

It uses JSON Schema draft-07 and contains named definitions for:

- `evidenceCorpusV2`;
- `boundaryCorpusV2`;
- `releaseCandidateCaseV2`;
- `productionBoundaryCaseV2`;
- the accepted `pullRequestInputV2` wire shape;
- the three accepted contract-source variants;
- the accepted verification contract, objective, and criterion variants;
- the binding, provenance, changed-file, and artifact-blob shapes;
- the minimal inbound active-V2 report marker; and
- the restricted pasted-override shape.

Every object exposed by the public authoring subset is closed with
`additionalProperties: false`. Required keys, array bounds, string character
limits where expressible, enumerations, and safe identifier/path patterns are
explicit. The schema must describe a sealable subset directly, not reference
broader production TypeScript aliases.

The subset requires `checks` and `logs` as empty arrays because the internal
parser requires those fields but the current reference policy does not use
their contents. It excludes `executionSuites`, `resolvedHeadModules`, patches,
line counts, and other unused PR metadata entirely. Public changed-file entries
contain only `path`, optional `previousPath`, and optional `status`. Public
source provenance uses only the exact GitHub snapshot shape needed for complete
and conservative-incomplete cases. Exposing broader observation records would
add author surface without adding evaluation value. Existing internal callers
may remain broader; the new public commands accept only the closed subset.

The two important boundary shapes are deliberately narrow:

```ts
interface InboundUntrustedV2Case {
  version: 2;
  kind: "inbound_untrusted_v2";
  caseId: Sha256;
  report: {
    reportSchemaVersion: "verification-report.v2";
    verificationContract: {
      state: "authoritative" | "author_claim";
    };
  };
}

interface PastedOverrideV2 {
  prUrl?: string;
  taskText?: string;
  prDescription?: string;
  changedFiles?: string;
  checks?: string;
  logs?: string;
  inputLimitations?: string[];
}
```

They are not serialized `VerificationReport` or general `AnalyzeRequest`
objects. The public schema must say this directly.

For `linked_issue` and `pr_description`, the public subset accepts one
canonical envelope only:

````text
title: AgentProof verification contract
body:
  ## AgentProof verification

  ```agentproof-verification
  <one JSON object matching verificationContractV2>
  ```
````

Newlines normalize to LF. There is no prose before or after the fenced object.
The embedded value must be one JSON object, not an array or free text.

### 5.2 Authoritative semantic boundary

JSON Schema handles local structure. The existing reference-policy parser
remains authoritative for rules JSON Schema cannot safely express, including:

- UTF-8 serialized byte limits;
- duplicate case, objective, criterion, and artifact-path identities;
- source-kind and binding-kind equality;
- recursive private-material rejection;
- exact contract-envelope extraction;
- canonical coverage derivation; and
- presence of all 23 required named coverage entries.

The validator must call the same reference-policy parsing and coverage path
used by sealing. It must not recreate a second semantic parser in the CLI.

Head mismatches, incomplete inventories, and inconsistent rename/previous-path
pairs are not validation errors. The closed V2 policy deliberately accepts
them and derives conservative `unavailable` evidence. Public validation must
preserve that behavior.

### 5.3 Source-of-truth order

The sources of truth are:

1. the public JSON Schema for the closed release-authoring subset;
2. the dependency-free reference policy for cross-field, privacy, coverage,
   canonicalization, and sealing semantics; and
3. this document for intent and operational use.

Any change to the public subset must update its schema and authoring tests in
the same commit and pass the one-way parity gate in Section 10. Broadening the
internal parser does not automatically broaden the public contract. A
TypeScript production type alone cannot change either boundary.

## 6. Commands

### 6.1 Initialize drafts

```bash
pnpm eval:reference:init -- \
  --evidence-cases <evidence.json> \
  --boundary-cases <boundary.json>
```

The command creates exactly two new UTF-8 JSON files with a final newline.
Their initial values are:

```json
{"version":2,"cases":[{"version":2,"caseId":"","input":null}]}
```

The evidence `cases` array repeats that case slot exactly 12 times. The
boundary draft is:

```json
{"version":2,"cases":[{"version":2,"kind":null,"caseId":""}]}
```

Its `cases` array repeats that boundary slot exactly 8 times. Files are written
with two-space indentation; the compact values above only define their exact
data shape.

Therefore the command creates:

- an evidence document with `version: 2` and 12 case slots; and
- a boundary document with `version: 2` and 8 case slots.

Slots contain only the explicit non-sealable placeholders shown above. The
initializer does not:

- choose source kinds, criteria, evidence, boundary kinds, or coverage cases;
- generate expected states or requirement ordinals;
- copy test fixtures;
- create a seal; or
- overwrite either file if it already exists.

Its purpose is to remove repetitive array/count setup, not to author the
holdout.

Before writing, initialization verifies that neither target exists. On a
handled write failure it removes only new files created by that invocation and
never changes a pre-existing file. A process or machine crash is not claimed to
be an atomic cross-filesystem transaction; any leftover draft remains
non-sealable and the next run fails closed because the path exists. New files
use owner-only permissions where the platform supports them. The custodian
stores both files in a protected directory outside the repository; the command
does not copy or move them into the worktree.

On success, `init` exits `0`, writes this fixed JSON to stdout, and writes
nothing to stderr:

```json
{"version":2,"status":"initialized","evidenceCaseCount":12,"boundaryCaseCount":8}
```

Invalid usage, an existing target, or an I/O failure exits `2`, writes nothing
to stdout, and writes one fixed code to stderr:

```text
REFERENCE_POLICY_INIT_FAILED
```

### 6.2 Validate drafts

```bash
pnpm eval:reference:validate -- \
  --evidence-cases <evidence.json> \
  --boundary-cases <boundary.json>
```

Validation runs four ordered stages:

```text
JSON syntax -> schema -> cross-field/privacy -> coverage
```

Later stages do not run when an earlier stage fails. The command performs no
write and emits no derived reference result.

Exit codes are fixed:

| Exit | Meaning |
| --- | --- |
| `0` | both corpora are valid and coverage-complete |
| `1` | author-correctable validation failure |
| `2` | invalid CLI usage or unreadable input file |
| `3` | unexpected internal validation failure |

For exits `0` and `1`, stdout contains exactly one diagnostic JSON line and
stderr is empty. For exit `2`, stdout is empty and stderr contains only
`REFERENCE_POLICY_VALIDATE_FAILED` plus a newline. No command prints an input
or output path. For exit `3`, stdout contains the fixed internal diagnostic
defined below and stderr is empty.

### 6.3 Seal validated inputs

```bash
pnpm eval:reference:seal -- \
  --evidence-cases <evidence.json> \
  --boundary-cases <boundary.json> \
  --output <seal.json>
```

The seal command uses the same authoritative validation result, writes only
after all four stages pass, and preserves the existing deterministic V2 seal
format. It refuses an existing output path. On a handled write failure it
removes only the new output created by that invocation; a crash-left output is
not trusted because later authority gates still require an exact valid seal.

Running it twice over byte-equivalent canonical inputs to two different empty
output paths must produce byte-identical seal content.

On success, `seal` exits `0`, writes only the seal file, emits
`{"version":2,"status":"sealed"}` plus a newline to stdout, and leaves stderr
empty. An author-correctable validation failure exits `1`, writes no seal, and
emits the same bounded invalid diagnostic as `validate` to stdout. Invalid
usage, unreadable input, an existing output, or an I/O failure exits `2`,
writes no seal, leaves stdout empty, and writes only
`REFERENCE_POLICY_SEAL_FAILED` plus a newline to stderr. An unexpected internal
validation failure exits `3`, writes no seal, emits the fixed internal
diagnostic to stdout, and leaves stderr empty.

## 7. Safe diagnostic contract

The validator emits one bounded JSON object. Example shape:

```json
{
  "version": 2,
  "status": "invalid",
  "stage": "schema",
  "errors": [
    {
      "document": "evidence",
      "caseIndex": 3,
      "path": "/cases/3/input/sourceProvenance/headSha",
      "code": "invalid_sha"
    }
  ],
  "truncated": false
}
```

A successful validation emits exactly:

```json
{"version":2,"status":"valid","stage":"complete","errors":[],"truncated":false}
```

Diagnostics contain only:

- document kind: `evidence` or `boundary`;
- zero-based case index when known;
- a bounded JSON Pointer made only from schema field names and array indexes;
- a closed error code; and
- an optional `coverageName` that is allowed only for coverage errors and must
  be one of the 23 already published coverage categories; and
- a truncation flag.

Diagnostics never contain:

- the invalid value;
- case ID;
- repository, PR, author, path, literal, source, blob, patch, log, workflow,
  token, receipt, or expected content;
- a stack trace or filesystem path; or
- a reference or candidate projection.

Return at most 50 errors, sort them deterministically by document, case index,
path, and code, and cap each pointer at 256 characters. Unknown internal
failures return one `internal_validation_failure` code without details.

The fixed internal diagnostic is:

```json
{"version":2,"status":"invalid","stage":"internal","errors":[{"code":"internal_validation_failure"}],"truncated":false}
```

Ajv messages, schema fragments, rejected values, and JavaScript exceptions are
never forwarded. The CLI maps them into the closed diagnostic contract.

The closed error-code families are:

```text
syntax_invalid
required_field
unknown_field
wrong_type
wrong_constant
out_of_bounds
invalid_identifier
invalid_sha
invalid_safe_path
duplicate_identity
source_binding_mismatch
private_material_rejected
contract_envelope_invalid
coverage_missing
internal_validation_failure
```

Coverage diagnostics may set `coverageName` to a published category such as
`documentation:violated`, but they must not identify the case intended to
satisfy it.

## 8. Privacy and independence

The authoring tools are local, deterministic, and network-free. They do not
retain input, send telemetry, or log protected values. The schema is public;
the authored corpus and seal remain protected artifacts.

The independent custodian may read:

- the public authoring bundle in Section 3;
- the 23 published coverage category names; and
- generic command usage.

The custodian may not read:

- reference-policy implementation source;
- candidate runner, candidate report, or candidate projection;
- seal or parser test fixtures;
- a previously completed protected corpus;
- supervisor-preferred case content; or
- per-case expected outcomes.

The validator helps the custodian repair format and coverage gaps. It does not
tell the custodian how the candidate behaved or which state the candidate
should produce.

## 9. Minimal implementation boundary

The implementation should add only:

1. the public schema;
2. one small authoring CLI module supporting `init` and `validate`, or two thin
   CLI entry points over one shared module;
3. bounded diagnostic support at the existing reference-policy parsing
   boundary;
4. package scripts for `init`, `validate`, and `seal`; and
5. focused tests and short command documentation.

Ajv remains in the authoring CLI only. The dependency-free reference-policy
module must continue to import Node built-ins only. Validation does not
transform an author's valid input and therefore does not add a compiler or
bridge to the frozen release toolchain.

Do not refactor unrelated production types or move production verification
logic into the authoring tools.

## 10. Evaluation before implementation

Implementation quality is scored against the following fixed checks. Passing
tests establish only these behaviors.

### 10.1 Deterministic automated gates

| Gate | Required result |
| --- | --- |
| Schema closure | unknown fields fail at every closed object boundary |
| Public-subset parity | every schema-valid input either passes authoritative semantic validation or receives a specific bounded semantic/coverage error |
| Diagnostic completeness | every schema-valid parser rejection maps to a bounded cross-field, privacy, or coverage code |
| No opaque repair loop | an author-correctable failure never returns only `REFERENCE_POLICY_SEAL_INVALID` |
| No reference generation | tools add no authored reference result, requirement ordinal, derived state, or candidate projection |
| Privacy | mutations containing secret-like material fail without echoing the value |
| Determinism | same invalid input gives byte-identical diagnostics; same valid input gives byte-identical seals |
| Safe file behavior | init and seal refuse existing outputs and leave no partial file |
| V1 rejection | V1 and unknown versions remain invalid |
| Capability boundary | only documentation literal and path-change absence remain release-positive |

Parity mutations must cover at least:

- missing and unknown keys;
- wrong primitive and array types;
- all size/count limits;
- unsafe path and malformed digest;
- duplicate IDs and artifact paths;
- source/binding mismatch;
- malformed linked-Issue/PR-description envelope;
- recursive secret-like material;
- incomplete coverage;
- accepted head/inventory mismatch and malformed rename relationships that remain conservative `unavailable`; and
- the narrow inbound-report and pasted-override shapes.

The word `expected` has two different meanings and the tests must keep them
separate. An authored release-oracle `expected` result is prohibited. A
`return_value` verification criterion still requires `cases[].expected`
because it states the requirement being checked; that criterion remains
release-deferred and always evaluates as `unavailable`.

Tests must build their authoring inputs without importing fixture builders from
`evidence-release-reference-policy-v2.test.mjs`.

### 10.2 Independent authorability gate

After automated tests pass, start a new independent custodian task with only
the public authoring bundle. The custodian passes only when it can:

1. initialize two drafts;
2. author distinct 12/8 corpora;
3. make `validate` exit `0`;
4. make `seal` exit `0`; and
5. return only artifact hashes and command status, not corpus content.

If this gate fails, classify the reason before changing the design:

| Failure class | Action |
| --- | --- |
| missing or contradictory public rule | fix schema/docs/diagnostic contract |
| validator/parser drift | fix parity at the shared boundary |
| merely repetitive deterministic binding | consider a thin bridge in a new design |
| semantic case-design difficulty | do not auto-generate; assign a more capable independent custodian |
| tool/environment/authority problem | fix the environment or permission, not the corpus rules |

The protected corpus and seal created by this gate are not viewed by the
supervisor before release scoring.

### 10.3 Score

The implementation is acceptable only if all blocking gates pass:

| Measure | Weight | Blocking condition |
| --- | ---: | --- |
| public authorability | 30 | independent custodian cannot validate and seal |
| public-subset/parser parity | 25 | any schema-valid input ends in an opaque parser rejection |
| privacy-safe diagnostics | 20 | any protected value or filesystem path leaks |
| deterministic behavior | 15 | diagnostics or seal differ for equivalent input |
| scope discipline | 10 | production semantics, capability set, or candidate output changes |

A weighted score is informational. One blocking condition makes the result
`NO_GO` even if the numeric score is otherwise high.

## 11. Acceptance criteria

The implementation phase is complete only when:

- the public schema exactly describes the closed V2 release-authoring subset;
- `init`, `validate`, and `seal` have stable commands and exit codes;
- validation errors are useful, bounded, deterministic, and value-free;
- the one-way public-subset/parser parity gates pass;
- no completed public corpus, authored release-oracle expected result, or
  semantic bridge is introduced;
- reference-policy dependency closure remains Node built-ins only;
- the three deferred capabilities remain always `unavailable`;
- focused tests, full tests, typecheck, lint, build, and `git diff --check`
  pass;
- an independent custodian validates and seals a fresh 12/8 protected corpus
  using only the public bundle; and
- an independent exact-SHA reviewer confirms scope and privacy boundaries.

Until all criteria pass, the release remains `NO_GO`. Even after they pass,
current production smoke and the remaining release gates are still required.

## 12. Rollback

This change adds authoring support and does not change production behavior.
Rollback removes or disables the public authoring commands and rejects new
seal creation. It does not restore V1 authority, alter existing reports, or
turn deferred capabilities on.

If the public subset and parser drift in release tooling, fail closed:

```text
new protected input -> validation UNKNOWN -> no seal -> no release authority
```

## 13. Explicitly deferred work

Do not add a bridge now. Open a separate design only if post-implementation
evidence shows all of the following:

1. the public contract is complete and internally consistent;
2. one-way public-subset/parser parity is passing;
3. the independent custodian's remaining failures are repetitive mechanical
   bindings, not semantic case decisions; and
4. a bridge can derive only IDs, digests, or duplicated bindings without
   deriving criterion states, expected outcomes, or coverage meaning.

That later bridge would need its own frozen specification, deterministic
tests, privacy review, and release-toolchain binding. It is outside this work.
