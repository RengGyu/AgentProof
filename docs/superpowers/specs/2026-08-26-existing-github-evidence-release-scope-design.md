# Existing GitHub Evidence Release Scope Design

**Date:** 2026-08-26

**Status:** Approved active scope

**Supersedes:** The active implementation order in
`2026-08-25-phase-3-capability-evaluators-design.md`. That document remains a
historical record only.

**Release state:** `NO_GO` until the Phase 4 gates pass for the bounded scope
defined here.

## 1. Decision

AgentProof will collect and verify evidence that already exists in GitHub. It
will not execute repository code or build a new evidence-production platform.

The current release scope is:

```text
authoritative request
  -> GitHub PR metadata, diff/files, checks, statuses, and Actions job metadata
  -> bounded deterministic normalization
  -> static criterion evaluation where the existing evidence is sufficient
  -> conservative result for every other criterion
  -> evidence report for human review
```

The goal is not to maximize `satisfied`. The goal is to prevent false
`satisfied` while preserving useful observations.

## 2. Product boundary

AgentProof is an evidence report for AI-generated pull requests. It is not:

- a customer-code runner;
- a replacement for GitHub Actions or Copilot;
- a generic code reviewer, correctness certificate, or merge gate;
- an artifact attestation or signing platform; or
- a system that infers executed commands from human-written job or step names.

LLM output may summarize collected evidence. It cannot create evidence or
promote a requirement outcome.

## 3. Active support matrix

| Input or criterion | Current treatment | Positive requirement promotion |
| --- | --- | --- |
| Linked Issue / provided contract | authoritative source when existing source rules pass | governed by its supported criteria |
| PR-description contract | author claim | capped at `partial` |
| Exact-head documentation literal | existing static evaluator | eligible behind `documentation_literal` |
| Complete changed-path absence | existing static evaluator | eligible behind `path_change_absence` |
| Changed files, tests, checks, statuses | report observations | no direct promotion |
| GitHub workflow/run/attempt/job identity | report observation and provenance | no `workflow_job` criterion promotion |
| `artifact.test_case` | compatible contract type | `unavailable` |
| `artifact.workflow_job` | compatible contract type | `unavailable` |
| `return_value` | compatible contract type | `unavailable` |
| UI/browser behavior | unsupported contract behavior | invalid or `unavailable` |

`test_case`, `workflow_job`, and `return_value` remain readable in v2 contracts
for schema compatibility. They are not release capabilities and must not be
accepted by the production capability allowlist.

## 4. Evidence rules

1. Use official GitHub API data already collected by `src/lib/github.ts`.
2. Bind collection to the analyzed head; head drift remains `unknown` or
   `unavailable`.
3. Incomplete pagination, permission failure, missing identity, or mixed
   pasted/live authority never becomes complete GitHub evidence.
4. Check, status, job, and step names are observation labels, not command or
   behavioral proof.
5. Passing CI is useful context but does not prove an exact test case, return
   value, or general correctness.
6. A static positive is allowed only through its existing deterministic
   evaluator, capability token, runtime validation, and presentation boundary.
7. Unsupported evidence stays visible as an observation without being forced
   into `satisfied` or `violated`.

## 5. Reuse and removal decisions

### Reuse unchanged

- GitHub PR, files, checks, statuses, and Actions job collection;
- exact head/base anchoring and pasted-evidence provenance downgrade;
- verification contract v2 and source-authority boundaries;
- static documentation and absence evaluators;
- default-deny capability policy;
- full runtime validation and private/public projection rules;
- existing regression, production-boundary, release-gate, and smoke commands.

### Do not build in this scope

- Actions artifact download or ZIP parsing;
- Vitest/JUnit/per-test result parsers;
- producer-job attestation, OIDC, Sigstore, or signing-key lifecycle;
- AgentProof-controlled Node/Python execution;
- workflow YAML command inference or a new workflow parser;
- new report schema, database migration, or report v3;
- another holdout runner, release evaluator, or metrics backend; and
- a new dependency for any deferred capability.

Historical designs may describe those options. They are not instructions for
the active goal.

## 6. Minimal implementation delta

Only the following production behavior change is required:

1. Keep all v2 contract types parseable.
2. Add a release-eligible capability set containing only
   `documentation_literal` and `path_change_absence`.
3. Make the environment capability reader reject the three deferred tokens as
   fail-closed input.
4. Keep their evaluator result `unavailable`, even when related GitHub
   observations exist.

No GitHub collector, execution receipt, parser, or storage schema is added.

## 7. Release evaluation

Reuse the existing test and release tooling. Do not create another framework.

Required development evidence:

- capability policy rejects each deferred token and mixed static/deferred
  lists;
- static capability positives still require explicit enablement;
- a complete workflow identity remains an observation and cannot satisfy a
  `workflow_job`, `test_case`, or `return_value` criterion;
- source authority, head drift, incomplete collection, mixed pasted/live
  provenance, runtime validation, and privacy regressions pass;
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and
  `git diff --check` pass.

Required release evidence:

- reuse the existing production-boundary and evidence-release tools with a
  candidate SHA;
- use existing protected holdout custody instead of exposing or rebuilding an
  oracle in the implementation worktree;
- run fresh production smoke only after candidate deployment and credentials
  are available;
- record missing external evidence as `UNKNOWN`, never as passed.

The binary quality boundary remains:

- false `satisfied` / false `met`: 0;
- incomplete evidence promoted as complete: 0;
- private projection leakage: 0;
- contradictory outcome wording across outputs: 0.

## 8. Stop conditions

Stop and return to this specification if implementation requires any of the
following:

- downloading or trusting a new result artifact;
- executing customer code;
- interpreting a job/step display name as a shell command;
- adding a new parser, signing protocol, schema version, service, or database;
- weakening `unavailable` to obtain more positive results; or
- changing the authoritative/author-claim boundary.

## 9. Completion record for later AI evaluation

The implementation report must contain only these fields:

```text
SCOPE: exact tasks completed
FILES: changed files
REUSED: existing collectors, validators, and test/release tools used
EXCLUDED: confirmation that executor/artifact/attestation work was not added
TESTS: exact commands, exit codes, and counts
BEHAVIOR: static positives retained; deferred criteria remain unavailable
PRIVACY: projection tests and any remaining unknown
RELEASE: GO/NO_GO plus missing external gates
```

A later evaluator must compare that record with the actual diff and command
output. Self-reported completion alone is not evidence.
