# Phase 3A — Exact Vitest JSON Test-Case Evidence

**Depends on:** `2026-08-25-phase-3-capability-evaluators-design.md` and
Phases 0–2

**Status:** Direct GitHub-artifact collection rejected; safe negative test
recorded

**Promotion state:** Off until every gate in this document passes

## 1. Bounded goal

Support one criterion type only: `artifact.test_case` from a Vitest JSON
result file produced by the exact analyzed GitHub Actions run. It would prove
only that one declared test case ran and passed. It would not certify product
behavior, generic CI, or other test runners.

**Current decision:** this direct GitHub-artifact route cannot create a
`satisfied` result. GitHub's artifact API binds an artifact to a workflow run
and head SHA, while the Actions jobs API separately binds a job to its run and
attempt. Neither supplies an authoritative artifact-to-producer-job join.
Supplying a `jobId` inside downloaded JSON would be a self-assertion, not
independent provenance. The existing collector must therefore return no
exact-test execution observation for this route; `test_case` remains
`unavailable`.

## 2. Reused components

- Vitest's existing JSON reporter writes a machine-readable result file.
- `JSON.parse` reads the bounded artifact payload; no XML, TAP, or new parser
  dependency is added.
- Existing Acorn/TypeScript relation parsing retains the static test-to-target
  binding check.
- Existing GitHub workflow/run/attempt/job identity binds a **Check** to the
  analyzed head, but not an Actions artifact to that producer job.
- Existing private receipt and `v2_full` validation close criterion ownership.

An artifact's run/head match is necessary but insufficient. Raw JSON, test
names, paths, and tuple values must remain transient even if a later,
separately approved producer-job attestation protocol supplies the missing
join.

## 3. Result mapping

| Input condition | Result |
| --- | --- |
| one exact declared ID, `passed`, and artifact run/head match but no independent producer-job join | `unavailable` |
| test declaration found but no exact execution result | `incomplete` |
| exact test is failed, skipped, todo, missing, duplicated, or ambiguous | `unavailable` |
| stale head, wrong run/attempt/job, malformed/oversized JSON, missing artifact, incomplete identity, or no artifact-to-job join | `unavailable` |
| generic CI/job success without the exact JSON result | `incomplete` |

## 4. RED test matrix

1. A caller-like result that merely declares a passed test ID and a complete
   job tuple remains `unavailable`; it does not provide the missing
   artifact-to-producer-job provenance.
2. The same static test binding without an execution result -> `incomplete`.
3. Failed, skipped, todo, missing, and duplicate IDs -> never `satisfied`.
4. Wrong head, run attempt, job, malformed JSON, and over-limit artifact ->
   `unavailable`.
5. A generic passed Check without per-test JSON -> `incomplete`.
6. Receipt deletion, mutation, or cross-criterion reuse -> `v2_full` invalid.
7. Public/share, tenant, Markdown, Slack, and stored summaries omit raw JSON
   and private receipts.

## 5. Acceptance boundary

Production implementation is blocked. Adding a ZIP reader or parsing Vitest
JSON does not repair the missing trust join. Capability enablement, artifact
collection, receipts, and persistence must not begin until a separately
approved, server-verifiable producer-job attestation protocol exists. A
future design must define its issuer, immutable artifact/source protocol,
signature or GitHub-native attestation verification, tuple and artifact-digest
binding, bounded archive/JSON limits, pagination/timeouts, replay fixtures,
and private receipt schema.

## Implementation evaluation record

**Rejected positive fixture (2026-08-25):**
`pnpm vitest run src/lib/verification-criterion-evaluator-v2.test.ts` added
an apparent positive fixture and failed as expected: the current evaluator
returned `unavailable`. Review found that the fixture was unsound because it
asserted its own job association and omitted capability, static declaration,
criterion-owned receipt, and independent provenance checks. It was replaced
with a passing negative regression: caller-like tuple data must not promote a
criterion.

**Scope still absent:** no production evaluator, artifact collector, ZIP
dependency, capability enablement, receipt, or projection behavior has been
added. This is deliberate.
