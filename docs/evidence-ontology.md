# Evidence Ontology

AgentProof answers one narrow question: is there enough grounded evidence that an agent-authored PR satisfies the original request? This ontology defines the deterministic evidence classes used for test/build status and related limitations. It is intentionally not a generic code-review rubric.

## Source Of Truth

Requirement extraction must prefer original intent over implementation claims.

Source priority:

1. Explicit user task or pasted acceptance criteria.
2. Fetched linked issue or task body.
3. External issue references that identify where the original request lives, treated as context until fetched.
4. PR body text, treated as author claims only.

If no user task or linked issue/task body is available, PR body text must not become a confident requirement. The report may create a `manual_check` requirement that tells the reviewer the original request is unavailable.

Issue sections such as `Expected behavior`, acceptance criteria, and `should`/`must` body text can become core requirements. Sections such as `Actual behavior`, repro steps, environment, screenshots, debug output, and external ticket links should remain context for the proof plan.

`Suggested fix`, `Proposed solution`, `Possible fix`, and workaround sections are solution hints. They may help map likely implementation evidence, but they are not requirements by themselves.

## Test/Build Execution Evidence

Test/build execution evidence is public, deterministic metadata showing that a test or build step actually ran and produced a status.

Counts as execution evidence:

- GitHub Actions workflow, job, step, check-run, or commit status metadata with a name or summary that clearly indicates test/build execution.
- Bounded CI metadata such as `Build&Test`, `Tests`, `unit tests`, `pytest`, `tox`, `uv run tox`, `vitest`, `jest`, `playwright`, `cypress`, `pnpm test`, `npm run build`, `next build`, or similar test/build commands.
- Opaque matrix job failures may count only when they come from public GitHub Actions job metadata and the job name looks like a runtime/OS/env matrix rather than a policy/report gate.
- Coverage commands count only when tied to actual test execution, such as `coverage run -m pytest` or a test command with coverage flags.
- Bounded raw CI log excerpts, when fetched, that show a command/status for test/build execution.

Does not count by itself:

- A PR body saying tests passed.
- A changed test file.
- A docs build, deploy preview, stats check, Codecov/Coveralls coverage report, coverage threshold/project/patch gate, changelog/release-note check, optional/non-blocking check, code-owner gate, security scan, AI review, dependency report, license/provenance/policy check, or other non-execution gate.
- A broad `CI` label without execution-like job, step, command, or summary evidence.
- Static-only checks such as `lint`, `eslint`, `typecheck`, `type-check`, `tsc`, or static analysis. These may set separate lint/typecheck signals, but they must not make `testBuildStatus` passed.
- A cancelled or action-required status. If it was a real test/build workflow, it is not proof of success; if it was a policy/report gate, it must not become a blocker.

## Test Artifact Evidence

Test artifact evidence shows that test-related files or test cases changed. It is useful reviewer evidence, but it is not proof that tests ran.

Examples:

- Files under `test`, `tests`, `spec`, `e2e`, or similar directories.
- Files named with `.test.`, `.spec.`, `test_*.py`, or equivalent project test naming.
- Patch summaries or bounded excerpts indicating targeted test edits.

Test artifact evidence can support requirement mapping and missing-test analysis. It must not set `testBuildStatus` to `passed`.

## Self-Reported Testing

Self-reported testing is any human or agent claim that tests were run or passed without public execution metadata.

Examples:

- PR body text such as "Tests passed", "Ran pytest", or "All tests pass".
- Bot or comment text that is not connected to public workflow/check/job metadata.

Self-reported testing can be summarized as a lead for reviewers. It must not set `testBuildStatus` to `passed` or `failed`.

## Non-Execution Status

Non-execution statuses are public statuses that may matter operationally but do not prove test/build execution.

Examples:

- Documentation and Read the Docs checks.
- Deploy previews and preview comments.
- Stats, bundle-size reports, Codecov/Coveralls reports, coverage upload/threshold/project/patch gates without a test run status, changelog/release-note checks, optional/non-blocking checks, code-owner checks, merge gates, policy checks, dependency reports, license/provenance checks, AI review, SAST/security scans, secret scans, lint-only checks, typecheck-only checks, and `tsc`-only checks.
- Provider/pipeline-only labels such as a bare external CI provider name are non-execution until their name, summary, job, or step metadata shows test/build execution.

Non-execution failures can be surfaced as separate static or merge-gate risk. They must not become `testBuildStatus: failed` unless the status itself is also clear test/build execution evidence.

## Status Aggregation

Aggregate only execution evidence into `testBuildStatus`.

Rules:

1. If any test/build execution evidence failed, aggregate to `failed`.
2. Else if any test/build execution evidence is pending, aggregate to `pending`.
3. Else if at least one test/build execution evidence passed, aggregate to `passed`.
4. Else aggregate to `unknown`.

Non-execution statuses are excluded from this aggregation. A cancelled stats or changelog check plus a passing Build&Test job is `passed`. A Codecov-only failure is `unknown`. A provider-only failure without test/build summary is `unknown`. A docs-only success is `unknown`. A lint/typecheck-only success is `unknown` for test/build. Self-reported tests plus a changed test file is `unknown`.

When metadata collection times out:

- Known failed execution evidence still wins.
- If no known execution evidence remains, status is `unknown`.
- Timeout must never convert a case to `passed`.

## Limitation Generation

Limitations should describe the source condition, not hide it behind generic language.

Use source-specific limitations such as:

- `Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored.`
- `Public GitHub Actions metadata showed failing build/test jobs; raw log archives were not fetched or stored.`
- `Public commit status metadata was available, but only non-execution statuses were found.`
- `No public test/build workflow run, check, or raw CI log was available.`
- `Raw CI logs were not fetched or stored.`
- `GitHub Actions job-step metadata unavailable: request timed out after 2500 ms or network failed.`

If no execution evidence is found, confidence must reflect that the report is based only on issue, diff, and artifact evidence.

File or patch collection failures must be reported as evidence unavailable, not as proof that implementation is missing. For example, if changed-file fetch fails, requirement gaps should be `unclear` or `evidence_unavailable` rather than confidently `missing`.

`evidence_unavailable` is reserved for a source that could not be collected. When evidence was collected but only partially supports a requirement and no narrower gap can be derived, use `evidence_insufficient`. That distinction must not change deterministic status, priority, CI, test/build, correctness, or merge decisions; the generated insufficient-evidence fallback stays medium and non-blocking.

## Priority Calibration

Summary priority should combine risk type, source quality, execution status, and targeted proof gaps.

- Failed test/build execution remains `blocker`.
- Crash, security, auth, permissions, payment, data loss, or data corruption changes with missing targeted proof may be `high`.
- A normal bug with passing build/test evidence and a minor targeted-proof gap should usually remain `medium`.
- PR-body-only or manual-check requirements should not become `high` solely because original task evidence is unavailable.
- Evidence-unavailable gaps should guide reviewers to missing collection data without overstating correctness failure.

## What The LLM May And May Not Decide

Allowed LLM work:

- Summarize already-collected evidence.
- Rewrite evidence-backed gaps into readable reviewer notes.
- Generate re-prompt suggestions from deterministic gaps.
- Help group related evidence, while preserving provenance.

Not allowed LLM work:

- Decide `testBuildStatus`.
- Decide that tests passed without execution evidence.
- Decide that lint, typecheck, or `tsc` alone proves test/build execution.
- Decide that a PR is safe to merge.
- Decide correctness, security, or production readiness beyond the collected evidence.
- Override deterministic failed execution evidence.
- Convert self-reported tests or changed test files into execution evidence.

Safety-critical labels must be deterministic and reproducible. If evidence is missing, AgentProof should say `unknown` or `unclear`, not guess.
