# Executable Release Evaluation — Pre-freeze Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed candidate-result runner and comparator envelope without creating, reading, or scoring a protected holdout.

**Architecture:** A typed runner invokes the same generated-private runtime boundary as production and emits a bounded candidate artifact. The comparator accepts only closed oracle/candidate envelopes, reports aggregate-only differences, and rejects missing, duplicate, extra, or privacy-unsafe material. The protected oracle is deliberately outside this repository and is not an input to runner development tests.

**Tech Stack:** TypeScript, Vitest, Node.js 22, existing AgentProof verifier/runtime validator/share and tenant projection code.

**Spec:** `docs/superpowers/specs/2026-08-21-executable-release-evaluation-pre-freeze-design.md`

## Global Constraints

- Preserve AgentProof as a deterministic evidence-report product; no LLM-based promotion.
- Keep `AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE` default-off; runner-scoped `receipt_v2` must restore its prior environment value.
- Never create, inspect, list, rewrite, or score a protected holdout/oracle in this phase.
- Do not use the incompatible `eval/evidence-release-holdout.v1.json` as release evidence or adapt it in place.
- Candidate and evaluator output must contain no raw source, path, symbol, log, token, GitHub workflow tuple, or receipt handle.
- Unknown, missing, malformed, duplicate, or extra data must fail closed; do not fabricate zero metrics.
- `privateReceiptBundleV2` and execution receipts remain private; public/share and tenant projections must omit them.
- A1 only: do not commit, push, deploy, modify external artifacts, or change production promotion configuration.

---

### Task 1: Close the release-comparator envelope

**Files:**
- Modify: `scripts/evaluate-evidence-release-gate.mjs`
- Modify: `scripts/evaluate-evidence-release-gate.test.mjs`

**Interfaces:**
- Consumes: `ReleaseEvaluationOracleV1` and `ReleaseCandidateResultCorpusV1` JSON supplied by explicit paths.
- Produces: aggregate-only gate output with `totalCases`, `structuralMismatchCount`, false-positive counters, reuse/privacy counters, and observable metrics.
- Rule: an evaluator corpus is valid only when every object uses its exact allowed key set and the candidate case-ID set equals the oracle case-ID set exactly once.

- [ ] **Step 1: Write failing closed-envelope tests**

Add four isolated tests to `scripts/evaluate-evidence-release-gate.test.mjs`:

```js
it("rejects an undeclared projection field even when privateReceiptLeakCount is zero", () => {
  const result = evaluateEvidenceReleaseGate({ oracle: validOracle(), candidates: candidateWithProjection({ privateReceiptLeakCount: 0, content: "hidden" }) });
  assert.equal(result.privacyLeakCount, "UNKNOWN");
  assert.equal(releaseGatePasses(result), false);
});

it("rejects duplicate candidate case IDs instead of using the last value", () => {
  const result = evaluateEvidenceReleaseGate({ oracle: validOracle(), candidates: duplicateCandidateCorpus() });
  assert.equal(result.structuralMismatchCount, "UNKNOWN");
});

it("rejects a candidate corpus with an extra case", () => {
  const result = evaluateEvidenceReleaseGate({ oracle: validOracle(), candidates: candidateCorpusWithExtraCase() });
  assert.equal(result.totalCases, "UNKNOWN");
});

it("rejects unknown keys in an oracle requirement and candidate receipt", () => {
  assert.equal(releaseGatePasses(evaluateEvidenceReleaseGate({ oracle: oracleWithUnknownRequirementKey(), candidates: validCandidates() })), false);
  assert.equal(releaseGatePasses(evaluateEvidenceReleaseGate({ oracle: validOracle(), candidates: candidateWithUnknownReceiptKey() })), false);
});
```

- [ ] **Step 2: Run the evaluator tests and record RED**

Run:

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
```

Expected: the four new tests fail because the comparator currently accepts unknown projection keys and collapses duplicate IDs through `Map`.

- [ ] **Step 3: Implement exact envelope validation**

In `scripts/evaluate-evidence-release-gate.mjs`:

```js
function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function indexCandidateCases(candidates, oracleCaseIds) {
  // Return null unless candidates.version is 1, all cases have exact keys,
  // IDs are unique, and the ID set equals oracleCaseIds exactly.
}
```

Use exact-key checks for oracle/candidate envelopes, case records, `actual`,
requirements, receipts, metrics, GitHub metrics, and projection. Permit only
`privateReceiptLeakCount` in projection. If candidate indexing or any closed
shape check fails, return `unavailableReleaseGateResult()`; do not reduce any
safety metric to zero.

- [ ] **Step 4: Run evaluator tests and verify GREEN**

Run:

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
```

Expected: all existing tests plus the four envelope tests pass; every invalid
case exits through aggregate-only `UNKNOWN` output.

- [ ] **Step 5: Run static verification**

Run:

```bash
pnpm typecheck
git diff --check
```

Expected: both commands exit 0.

### Task 2: Add the source-level candidate runner

**Files:**
- Create: `src/lib/release-evaluation-runner.ts`
- Create: `src/lib/release-evaluation-runner.test.ts`
- Create: `src/lib/release-evaluation-runner-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes:

```ts
export interface ReleaseCandidateCaseV1 {
  version: 1;
  caseId: string;
  input: PullRequestInput;
  requirementOrdinals: number[];
}

export interface ReleaseCandidateCorpusV1 {
  version: 1;
  cases: ReleaseCandidateCaseV1[];
}
```

- Produces:

```ts
export interface ReleaseCandidateResultCorpusV1 {
  version: 1;
  cases: ReleaseCandidateResultV1[];
}

export function parseReleaseCandidateCorpusV1(value: unknown): ReleaseCandidateCorpusV1 | null;
export function runReleaseCandidateCorpusV1(corpus: ReleaseCandidateCorpusV1): ReleaseCandidateResultCorpusV1;
export function writeReleaseCandidateResultV1(inputPath: string, outputPath: string): void;
```

- Rule: each case invokes `generateVerificationReportV2FromInput` then
`validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report, requireV2: true })`. No direct verifier-only shortcut is allowed.

- [ ] **Step 1: Write failing runner tests**

In `src/lib/release-evaluation-runner.test.ts`, add real production-path tests
using a synthetic, visible development corpus:

```ts
it("runs a receipt-complete case through generated-private validation and emits opaque IDs", () => {
  const result = runReleaseCandidateCorpusV1(receiptCompleteDevelopmentCorpus());
  expect(result.cases).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("repositoryName");
  expect(result.cases[0]!.actual.requirements[0]!.testReceiptIds).toHaveLength(1);
});

it("downgrades a receipt-less local positive rather than emitting a positive candidate axis", () => {
  const result = runReleaseCandidateCorpusV1(receiptlessDevelopmentCorpus());
  expect(result.cases[0]!.actual.requirements[0]!.axisStates.targeted_test).toBe("incomplete");
});

it("fails closed for duplicate case IDs, unknown payload keys, and invalid requirement ordinals", () => {
  expect(parseReleaseCandidateCorpusV1(duplicateCasePayload())).toBeNull();
  expect(parseReleaseCandidateCorpusV1(payloadWithUnknownKey())).toBeNull();
  expect(parseReleaseCandidateCorpusV1(payloadWithInvalidOrdinal())).toBeNull();
});

it("counts private material in real share and tenant projections without retaining it in output", () => {
  const result = runReleaseCandidateCorpusV1(receiptCompleteDevelopmentCorpus());
  expect(result.cases[0]!.actual.projection.privateReceiptLeakCount).toBe(0);
  expect(JSON.stringify(result)).not.toContain("privateReceiptBundleV2");
});
```

In `src/lib/release-evaluation-runner-cli.test.ts`, write a failing CLI-harness
test that writes a temporary visible development payload, invokes
`writeReleaseCandidateResultV1`, and validates a version-1 output file with
one case and no raw source text.

- [ ] **Step 2: Run the focused runner tests and record RED**

Run:

```bash
pnpm vitest run src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts
```

Expected: FAIL because the runner module and CLI harness do not exist.

- [ ] **Step 3: Implement bounded candidate generation**

In `src/lib/release-evaluation-runner.ts`:

1. Parse only the two exact corpus keys and four exact case keys.
2. Require 1–12 unique case IDs and unique, in-range requirement ordinals.
3. Temporarily set `AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE=receipt_v2`,
   invoke the v2 generated-private boundary, and restore the environment in a
   `finally` block.
4. Build each requirement output from public report fields only. Derive its
   opaque stable ID as `case:${caseId}:ordinal:${ordinal}`; do not copy source
   text, evidence locators, receipt internals, paths, symbols, or logs.
5. Derive receipt IDs from local sequential handles (`test:1`, `execution:1`)
   after counting the private bundle; never serialize actual private receipt
   IDs.
6. Call `sanitizeReportForShare` and `projectTenantPersistedReport` with a
   test-only generated signing key. Compute leak count by recursively checking
   their serialized values against an allowlist: neither serialized value may
   contain any proof-receipt collection key or a private receipt handle.
7. Measure case duration with `performance.now()`. Set unavailable GitHub
   request/page/retry and provider metrics to omitted rather than zero; the
   evaluator must report those values as `UNKNOWN`.

The CLI harness writes only to its explicit output path and rejects an output
path outside the temporary caller-selected directory in tests. Add package
script:

```json
"eval:evidence:candidates": "vitest run src/lib/release-evaluation-runner-cli.test.ts"
```

The CLI test is the source-execution adapter because Vitest resolves the
project TypeScript aliases. It must require explicit
`AGENTPROOF_RELEASE_EVAL_CASES` and `AGENTPROOF_RELEASE_EVAL_OUTPUT` variables
before writing; ordinary `pnpm test` must not write artifacts.

- [ ] **Step 4: Run the focused runner tests and verify GREEN**

Run:

```bash
pnpm vitest run src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts
```

Expected: all runner and harness tests pass. The artifact remains a synthetic
development result and is not a frozen holdout result.

- [ ] **Step 5: Run privacy and runtime boundary regression tests**

Run:

```bash
pnpm vitest run src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts src/lib/report-runtime-validation.test.ts src/lib/evidence-receipt-validation.test.ts
```

Expected: all selected tests pass; public/share and tenant projections remain
receipt-free.

### Task 3: Verify the pre-freeze handoff without an oracle

**Files:**
- Modify: `scripts/evaluate-evidence-release-gate.test.mjs`
- Modify: `src/lib/release-evaluation-runner-cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: only temporary synthetic development candidate payload/result
  paths created by tests.
- Produces: a documented explicit command pair; it does not add a default
  holdout path or a protected-oracle read.

- [ ] **Step 1: Write the failing handoff test**

Add a test that:

```js
// 1. creates an input-compatible synthetic case payload;
// 2. uses the runner harness to create candidates;
// 3. passes a separately created matching synthetic oracle to the evaluator;
// 4. asserts totalCases === 1 and aggregate stdout contains no case ID.
```

The test must also assert that invoking either `eval:evidence:candidates` or
`eval:evidence:release` without explicit required paths exits non-zero.

- [ ] **Step 2: Run the handoff test and record RED**

Run:

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
```

Expected: FAIL until the runner CLI has explicit path plumbing and the
evaluator validates the exact candidate envelope.

- [ ] **Step 3: Implement explicit-only handoff plumbing**

Keep `eval:evidence:release` as an explicit comparator:

```bash
pnpm eval:evidence:release -- --oracle /protected/oracle.json --candidates /tmp/candidates.json
```

Add a separate explicit runner invocation using environment variables rather
than a default artifact path:

```bash
AGENTPROOF_RELEASE_EVAL_CASES=/protected/cases.json \
AGENTPROOF_RELEASE_EVAL_OUTPUT=/tmp/candidates.json \
pnpm eval:evidence:candidates
```

Do not reference `eval/evidence-release-holdout.v1.json` anywhere in code or
package scripts.

- [ ] **Step 4: Run handoff and static checks**

Run:

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
pnpm vitest run src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all commands exit 0. This proves synthetic plumbing only, not
holdout accuracy, external regression, production performance, or deploy
readiness.

## Pre-freeze completion checklist

- [ ] Comparator has closed envelopes and rejects unknown/duplicate/extra data.
- [ ] Runner uses the production generated-private runtime boundary.
- [ ] Runner output is bounded and contains no private receipt material.
- [ ] No release command has a default holdout path.
- [ ] Existing incompatible holdout has not been modified, read by the runner,
  or used as release evidence.
- [ ] Focused RED/GREEN evidence, typecheck, lint, and diff check are recorded.
- [ ] An independent reviewer approves the pre-freeze diff.

## 2026-08-21 pre-freeze hardening evidence

- **RED:** `node --test scripts/evaluate-evidence-release-gate.test.mjs`
  failed because a count-only candidate returned zero mismatches instead of
  `UNKNOWN`. The evaluator now admits only exact `testReceiptIds` and
  `executionReceiptIds` arrays.
- **RED:** focused runner tests failed with four generated handles collapsing
  to two, a missing serialized-projection contract checker, and one generated
  exception aborting the corpus. A separate embedded-handle mutation also
  initially escaped leak counting.
- **GREEN:** the evaluator suite passed 17/17. Runner and CLI tests passed
  10/10. The focused share, tenant, runtime, report-validation, receipt, and
  server-store regression set passed 182/182.
- **GREEN:** `pnpm typecheck`, `pnpm lint`, and `git diff --check` exited zero
  after correcting the projection scanner's read-only set type.
- **VERIFIED:** the runner reuses the production tenant-detail sanitizer,
  serializer, and persisted-report validator; the sanitizer's behavior and
  persistence callers were not changed.
- **VERIFIED:** an independent read-only skeptical audit reported no blocking
  findings across exact receipt admission, whole-run handle uniqueness,
  400,000-byte input bounds, per-case failure containment, environment
  restoration, closed projection validation, aggregate-only output, and the
  explicit cross-directory handoff.
- **BOUNDARY:** this is synthetic pre-freeze plumbing evidence only. No
  protected artifact was opened, created, changed, or scored, and this record
  is not release approval.
