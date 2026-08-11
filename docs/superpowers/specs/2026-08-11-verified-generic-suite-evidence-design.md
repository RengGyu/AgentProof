# Verified Generic Suite Evidence Design

## Goal

Recognize a passing generic test suite as requirement execution evidence only
when AgentProof can prove that the PR's changed test artifact is inside that
suite's declared discovery scope. Keep user-interaction and visual evidence
separate from unit-test execution.

## Decision

AgentProof will use three execution strengths:

1. **Direct execution** — a check or job explicitly identifies the
   requirement, test path, or target.
2. **Verified suite execution** — the exact PR head has a successful Actions
   job, its normalized command has a supported unfiltered discovery scope,
   and that scope contains a changed, requirement-linked test artifact.
3. **Unlinked generic execution** — a generic check passed, but one of those
   links is unavailable. It remains reportable but cannot satisfy a
   requirement execution axis.

No raw CI logs, raw workflow YAML, or package manifests are persisted. The
collector derives and retains only normalized runner/scope metadata and safe
file paths already present in the report.

## Requirement Axes

A requirement may need several independent proofs. Existing implementation,
test-artifact, execution, documentation, CI, visual, and absence axes remain
independent. Add an `interaction` axis only for explicit user-action and UI
surface requirements. A passing unit suite can satisfy execution but never
satisfies interaction or visual proof by itself.

For PR #5 this means: implementation + test artifact + verified suite
execution may be satisfied; rendering and clearing the actual search control
remain incomplete without a component or browser test.

## Collection and Linking

For GitHub snapshots only, capture bounded Action job metadata for the exact
head. Parse only recognized command forms. Start with direct discovery
commands (`node --test`, `pytest`, `go test ./...`, `cargo test`) and resolve
the repository-root `npm test` script only when it reduces to one of those
forms without filters. Supported command metadata creates a normalized
execution observation with status, scope, job evidence, and covered changed
test paths.

Custom commands, path filters, unknown scripts, matrix shards with unresolved
coverage, missing Actions permission, caps, and timeouts are fail-closed:
they produce no requirement-linked suite execution proof.

## Operator Prerequisite

The installed GitHub App needs repository **Actions: Read** permission and
must be reinstalled or have its installation permissions refreshed after that
permission is added. Without it, AgentProof keeps generic suite execution
unlinked and reports the collection limitation; it does not request or store
raw logs as a workaround.

## Validation and UI

Full validation must require a passing execution item plus a generated,
requirement-local suite link to a changed test artifact. It must reject a
generic pass that lacks the exact-head, supported-runner, or path-scope chain.
The dashboard copy distinguishes `Test suite execution linked` from `Direct
test execution linked`; it never describes either as a correctness or
merge-readiness verdict.

Gap ordering is: relevant failed execution, missing interaction/visual proof,
missing execution link, evidence collection limitation. Unrelated failed
checks must remain separate.

## Acceptance Matrix

- PR #5: generic `npm test -> node --test` links its changed test file, but
  interaction proof remains incomplete.
- Test-only PRs: a changed discoverable test + successful suite does not
  demand implementation evidence.
- Docs-only and CI-only PRs: no unrelated execution gap is invented.
- An unrelated successful or failed suite never links to a requirement.
- A filtered or unknown suite never upgrades execution.
- Missing GitHub Actions permission leaves suite execution incomplete without
  requesting raw logs.
