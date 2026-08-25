# Existing GitHub Evidence Release Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task by task with review
> checkpoints.

**Goal:** Enforce AgentProof's current release scope: reuse existing GitHub
evidence, allow only the two static criterion capabilities to promote, and keep
`test_case`, `workflow_job`, and `return_value` unavailable.

**Architecture:** Preserve contract v2, the GitHub collector, outcome backbone,
runtime validator, storage, and projections. Add one fail-closed release-eligible
capability boundary. Do not add a new evidence producer or parser.

**Tech Stack:** TypeScript, Vitest, Next.js, existing GitHub REST collection,
existing AgentProof release tooling.

**Spec:**
`docs/superpowers/specs/2026-08-26-existing-github-evidence-release-scope-design.md`

## Global constraints

- Work only in the assigned isolated worktree and preserve all existing user
  changes.
- Use test-first changes. Show the RED failure before production code changes.
- Do not modify `src/lib/github.ts` unless an existing-evidence invariant test
  proves it is necessary.
- Do not add dependencies, artifact downloads, test-result parsers, workflow
  YAML parsers, attestation, signing, code execution, schema v3, or migrations.
- Do not infer commands or application behavior from check/job/step names.
- Do not expose raw code, paths beyond existing bounded locators, logs, tokens,
  receipts, or workflow identity tuples in reduced projections.
- Do not commit, push, deploy, or change production configuration without
  separate user authorization.
- Any unsupported or incomplete evidence stays `unavailable`, `unknown`, or
  `unclear`; never weaken it to make a positive case pass.

## Task 1: Close the production capability allowlist

**Files:**

- Modify: `src/lib/verification-capability-policy-v2.ts`
- Modify: `src/lib/verification-capability-policy-v2.test.ts`

### Step 1: Write the failing policy tests

Add exact assertions that:

```ts
readEnabledVerificationCapabilitiesV2("test_case")
readEnabledVerificationCapabilitiesV2("workflow_job")
readEnabledVerificationCapabilitiesV2("return_value")
readEnabledVerificationCapabilitiesV2("documentation_literal,test_case")
```

all return an empty set. Retain the positive assertion for exactly:

```ts
"documentation_literal,path_change_absence"
```

Run:

```bash
pnpm vitest run src/lib/verification-capability-policy-v2.test.ts
```

Expected RED: at least the deferred-token assertions fail because the current
reader accepts all schema-compatible tokens.

### Step 2: Implement the smallest fail-closed boundary

Keep `VERIFICATION_CAPABILITIES_V2` and `VerificationCapabilityV2` unchanged
for compatibility. Add an internal or exported release-eligible set containing
only:

```ts
documentation_literal
path_change_absence
```

Make `readEnabledVerificationCapabilitiesV2` validate against that set.
Unknown, deferred, blank, duplicated, or mixed valid/deferred input fails as a
whole.

### Step 3: Re-run the focused test

Run the same command. Expected GREEN: all policy tests pass.

## Task 2: Lock non-static criteria to observations only

**Files:**

- Modify: `src/lib/verification-criterion-evaluator-v2.test.ts`
- Modify: `src/lib/verification-contract-v2-evaluation.test.ts`
- Modify only if a test proves a real gap:
  `src/lib/verification-criterion-evaluator-v2.ts`

### Step 1: Add evaluator regressions

For each compatible non-static criterion, add one focused case:

- `artifact.test_case` with matching changed test and a passing-looking suite;
- `artifact.workflow_job` with a complete-looking GitHub workflow identity and
  successful conclusion; and
- `return_value` with matching implementation/test observations and passing
  global CI.

Assert that every evaluator result remains:

```ts
state: "unavailable"
gapKinds: ["evidence_unavailable"]
```

The observations may remain in the report. They must not become criterion
evidence refs or satisfied proof axes.

### Step 2: Add integrated contract regression

Materialize an authoritative v2 objective containing the three deferred
criteria. Set `AGENTPROOF_VERIFICATION_CAPABILITIES_V2` once per deferred token
and verify that no requirement becomes `met`.

Run:

```bash
pnpm vitest run src/lib/verification-criterion-evaluator-v2.test.ts src/lib/verification-contract-v2-evaluation.test.ts
```

Expected: GREEN without production evaluator changes. If it fails, change only
the minimum evaluator dispatch required to return `unavailable`; do not add a
new evaluator.

## Task 3: Verify the reused GitHub and privacy boundaries

**Files:**

- Test only: `src/lib/github.test.ts`
- Test only: `src/lib/github-pasted-provenance.test.ts`
- Test only: `src/lib/report-runtime-validation-authority.test.ts`
- Test only: `src/lib/report-share.test.ts`
- Test only: `src/lib/tenant-report-validation.ts` and its existing callers

No new collector behavior is planned. Run the existing focused regression
pack:

```bash
pnpm vitest run \
  src/lib/github.test.ts \
  src/lib/github-pasted-provenance.test.ts \
  src/lib/report-runtime-validation-authority.test.ts \
  src/lib/report-share.test.ts \
  src/lib/server-report-store.test.ts \
  src/lib/markdown.test.ts \
  src/lib/slack.test.ts
```

Accept only evidence already checked by these paths:

- exact head/base binding;
- incomplete collection stays incomplete;
- mixed pasted/live input loses GitHub authority;
- private-only fields are absent from reduced outputs; and
- every output surface uses the same strict outcome language.

If a test fails because of an unrelated pre-existing worktree change, record
the exact failure and stop that subtask. Do not repair unrelated behavior.

## Task 4: Run the bounded engineering gate

Run in this order:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Record command, exit code, and test counts. Do not summarize a skipped or
blocked command as passed.

Then run the already-existing release-tool unit tests; do not create another
runner:

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
node --test scripts/evaluate-production-authority-release.test.mjs
```

Actual protected holdout, candidate-SHA evaluation, credentialed production
smoke, independent review, deployment, and live latency remain external gates.
If their inputs or authority are unavailable, record them as `UNKNOWN` and keep
the release decision `NO_GO`.

## Task 5: Produce the bounded completion report

Create a short task record using exactly the fields from Section 9 of the
specification:

```text
SCOPE:
FILES:
REUSED:
EXCLUDED:
TESTS:
BEHAVIOR:
PRIVACY:
RELEASE:
```

Verify the record against `git diff --stat`, `git diff`, and the actual command
output. Do not claim general correctness, exact-test proof, return-value proof,
or production readiness.

## Implementation evaluation

All four binary gates must pass before scoring:

1. no deferred criterion becomes `satisfied`;
2. static capability behavior and source authority do not regress;
3. privacy/reduced projections do not leak private fields; and
4. every claimed test result has actual command evidence.

After those gates pass, evaluate implementation quality:

| Area | Weight | Full-credit condition |
| --- | ---: | --- |
| Scope discipline | 35 | no new collector, parser, executor, attestation, dependency, or schema |
| Safety behavior | 30 | deferred tokens fail closed; static tokens still work only when enabled |
| Regression evidence | 25 | focused and full local gates pass with recorded output |
| Handoff clarity | 10 | completion record matches the actual diff and lists all external unknowns |

Any failed binary gate is `NO_GO` regardless of score. A score is not evidence
of production readiness.
