# Closed Reference Oracle V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manually authored release-oracle tuples with a closed, input-derived V2 reference policy while preserving production report behavior and limiting release-positive evaluation to the two static capabilities.

**Architecture:** A dependency-free reference module interprets the protected input corpus under a closed static rule table. The candidate runner emits criterion-owned semantic projections without authored ordinals, and the release evaluator derives reference expectations in memory from the sealed corpus before producing aggregate-only gates. V1 remains development-only and cannot satisfy release authority.

**Execution record (2026-08-26):** Tasks 1–4 are committed as `5e333f3`,
`0f2eaa4`, `02a3a61`, and `9d1d220`. Task 5 is committed as `a784ef7` after
independent security re-review confirmed exact 12/8 named coverage and
transitive runner-to-policy isolation. Task 6 records specification migration
and full local verification; no protected corpus, deployment, or promotion is
created by this plan.

**Tech Stack:** Node.js 22, TypeScript 5.9, Vitest 4, Node test runner, existing SHA-256/toolchain manifest utilities

**Spec:** `docs/superpowers/specs/2026-08-26-closed-reference-oracle-v2-design.md`

## Global Constraints

- Do not modify production `VerificationReportV2`, persistence, share, tenant, UI, Markdown, Slack, or export schemas.
- Release-positive capabilities are exactly `documentation_literal` and `path_change_absence`.
- `test_case`, `workflow_job`, and `return_value` always remain `unavailable`.
- The reference module imports Node built-ins only and never imports candidate verifier or validator code.
- Protected input, paths, literals, blobs, patches, logs, tokens, workflow tuples, case IDs, and receipt IDs never enter aggregate output.
- V1 evaluation remains development-only and is rejected by release CLI and production-authority evidence.
- Every implementation task follows RED, observed failure, minimal GREEN, and focused regression verification.

---

### Task 1: Closed reference policy and V2 seal

**Files:**
- Create: `scripts/evidence-release-reference-policy-v2.mjs`
- Create: `scripts/evidence-release-reference-policy-v2.test.mjs`
- Create: `scripts/build-reference-policy-seal-v2.mjs`
- Create: `scripts/build-reference-policy-seal-v2.test.mjs`

**Interfaces:**
- Produces: `parseReferencePolicySealV2(value)`, `deriveEvidenceReferenceV2(corpus, seal)`, `deriveBoundaryReferenceV2(corpus, seal)`, `deriveCoverageSummaryV2(evidenceCorpus, boundaryCorpus)`, `referencePolicySha256V2()`, `buildReferencePolicySealV2({ evidenceCorpus, boundaryCorpus })`
- Consumes: JSON-compatible protected corpus values and the exact V2 seal described in the spec

- [ ] **Step 1: Write failing closed-envelope tests**

```js
it("rejects V1, authored expected tuples, ordinal selectors, and unknown keys", () => {
  assert.equal(deriveEvidenceReferenceV2({ version: 1, cases: [] }, validSeal()), null);
  assert.equal(deriveEvidenceReferenceV2(corpusWith({ expected: {} }), validSeal()), null);
  assert.equal(deriveEvidenceReferenceV2(corpusWith({ requirementOrdinals: [0] }), validSeal()), null);
  assert.equal(deriveEvidenceReferenceV2(corpusWith({ unknown: true }), validSeal()), null);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
node --test scripts/evidence-release-reference-policy-v2.test.mjs
```

Expected: FAIL because `evidence-release-reference-policy-v2.mjs` does not exist.

- [ ] **Step 3: Implement exact V2 corpus/seal parsing and canonical SHA-256**

Implement the six exported functions using only `node:crypto` and local pure
helpers. Require evidence count `12`, boundary count `8`, exact ordered
capabilities, lowercase SHA-256 IDs, exact key sets, byte bounds, unique case
IDs, corpus hashes, policy hash, and coverage-summary hash.

- [ ] **Step 4: Add RED tests for every closed semantic rule**

Add one independent fixture assertion for:

```text
documentation: satisfied / violated / unavailable
absence: satisfied / current-path violation / previous-path violation / unavailable
source: provided authoritative / linked authoritative / PR author claim
deferred: test_case / workflow_job / return_value -> unavailable
outcome: met / partial / missing / unclear
boundary: two inbound rejections / three pasted downgrades / empty preservation / text-only preservation / incomplete
```

Assert that repeated derivation produces byte-identical stable JSON and that
absent/invalid contracts are rejected from the evidence corpus. Keep
unknown-field and secret-pattern corpus rejection in development tests; use a
task-text or PR-description-only override as the eighth valid boundary case.

- [ ] **Step 5: Implement the minimum total reference interpreter**

Use exact contract envelopes, bounded newline normalization, 64 KiB artifact
limits, exact-head source binding, current/previous-path inventory, and the
outcome table from the spec. Return `null` for every unsupported or ambiguous
input; never guess.

- [ ] **Step 6: Write failing custodian seal CLI tests**

Test the exact command contract:

```text
--evidence-cases <path> --boundary-cases <path> --output <new-path>
```

Assert two identical builds are byte-identical. Assert existing output, V1
input, unsupported coverage, an input/output path collision, and an unknown
flag exit non-zero without writing a partial seal.

- [ ] **Step 7: Run the seal CLI test and verify RED**

```bash
node --test scripts/build-reference-policy-seal-v2.test.mjs
```

Expected: FAIL because `build-reference-policy-seal-v2.mjs` does not exist.

- [ ] **Step 8: Implement the custodian-only deterministic seal CLI**

Parse the exact three flags, call `buildReferencePolicySealV2`, and write
canonical stable JSON only after both corpora, coverage, policy hash, counts,
and output-path isolation pass. Do not accept a candidate or result path.

- [ ] **Step 9: Verify Task 1 GREEN**

```bash
node --test scripts/evidence-release-reference-policy-v2.test.mjs scripts/build-reference-policy-seal-v2.test.mjs
```

Expected: all reference-policy tests pass with no protected fixture access.

- [ ] **Step 10: Commit Task 1**

```bash
git add scripts/evidence-release-reference-policy-v2.mjs scripts/evidence-release-reference-policy-v2.test.mjs scripts/build-reference-policy-seal-v2.mjs scripts/build-reference-policy-seal-v2.test.mjs
git commit -m "add closed release reference policy"
```

### Task 2: Criterion-owned candidate projection V2

**Files:**
- Modify: `src/lib/release-evaluation-runner.ts`
- Modify: `src/lib/release-evaluation-runner.test.ts`
- Modify: `src/lib/release-evaluation-runner-cli.test.ts`

**Interfaces:**
- Produces: `parseReleaseCandidateCorpusV2(value)`, `runReleaseCandidateCorpusV2(corpus)`, `writeReleaseCandidateResultV2(inputPath, outputPath)`
- Consumes: `ReleaseCandidateCorpusV2` with no `requirementOrdinals`

- [ ] **Step 1: Write failing V2 runner contract tests**

```ts
it("projects every objective and criterion without authored ordinals", () => {
  const result = runReleaseCandidateCorpusV2(twoObjectiveStaticCorpus());
  expect(result.version).toBe(2);
  expect(result.cases[0]?.actual.objectives.map((item) => item.requirementId))
    .toEqual(["vc_o1", "vc_o2"]);
});

it("keeps deferred criteria unavailable even when checks and tests are present", () => {
  const result = runReleaseCandidateCorpusV2(deferredCapabilityCorpus());
  expect(result.cases[0]?.actual.objectives.flatMap((item) => item.criteria)
    .every((item) => item.state === "unavailable")).toBe(true);
});
```

Also assert V2 rejects `expected`, `requirementOrdinals`, duplicate IDs,
unknown keys, absent/invalid active-contract cases, and an output path equal to
the input path.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm exec vitest run src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts
```

Expected: FAIL because V2 exports and projection do not exist.

- [ ] **Step 3: Implement the minimal V2 projection**

Read the runtime-validated report and emit only:

```ts
{
  contract: { sourceKind, state },
  objectives: [{ requirementId, outcome, criteria }],
  axes: [{ requirementId, criterionId?, role, subject, state }],
  receipts: [{ id: opaqueHandle, requirementId, criterionId?, kind }],
  criterionLocalCi: [{ requirementId, criterionId, association }],
  projection: { privateReceiptLeakCount }
}
```

Enumerate all report contract objectives and results in canonical order. Do not
derive expected values, import the reference module, or expose raw private
receipt IDs.

- [ ] **Step 4: Add ownership and failure-path tests**

Assert observation axes never gain criterion IDs, every criterion-owned axis
maps to one required subject, receipt handles are opaque, failed generation
sets a bounded failure stage, and failed privacy projection remains `UNKNOWN`
at the evaluator boundary rather than a fabricated zero. Derive
`criterionLocalCi` only from criterion-owned execution axes; generic execution
observations must not create an entry.

- [ ] **Step 5: Verify Task 2 GREEN**

```bash
pnpm exec vitest run src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts
pnpm typecheck
```

- [ ] **Step 6: Commit Task 2**

```bash
git add src/lib/release-evaluation-runner.ts src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts
git commit -m "project closed release candidate semantics"
```

### Task 3: V2 evidence release evaluator

**Files:**
- Modify: `scripts/evaluate-evidence-release-gate.mjs`
- Modify: `scripts/evaluate-evidence-release-gate.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `evaluateEvidenceReleaseGateV2({ cases, seal, candidates })`, `releaseGatePasses(result)`
- Consumes: reference functions from `scripts/evidence-release-reference-policy-v2.mjs`
- Preserves: existing aggregate output key set

- [ ] **Step 1: Write failing V2 comparison and CLI tests**

```js
it("derives reference expectations from cases and seal instead of an oracle", () => {
  const result = evaluateEvidenceReleaseGateV2({
    cases: staticCorpusV2(),
    seal: matchingSealV2(),
    candidates: matchingCandidatesV2()
  });
  assert.equal(result.structuralMismatchCount, 0);
});

it("release CLI rejects V1 and the --oracle flag", () => {
  assert.notEqual(runReleaseCli(["--oracle", "oracle.json", "--candidates", "result.json"]).status, 0);
});
```

Add failures for corpus/seal hash drift, missing/extra candidate cases,
criterion order drift, source/authority drift, criterion state drift,
observation/criterion ownership crossover, deferred satisfaction, receipt
reuse, any non-empty `criterionLocalCi`, unknown projection fields, and privacy
leaks.

- [ ] **Step 2: Run evaluator tests and verify RED**

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
```

- [ ] **Step 3: Implement V2 evaluation and release CLI**

Parse exactly:

```text
--cases <path> --seal <path> --candidates <path>
```

Derive the reference projection in memory, compare contract/criterion/outcome
structure, compute ownership/receipt/CI/privacy counters from candidate data,
and print one aggregate JSON line. Keep the V1 comparator exported under the
explicit development-only name `evaluateEvidenceReleaseGateV1`; never route it
through the release CLI.

- [ ] **Step 4: Verify aggregate-only and fail-closed behavior**

Assert stdout/stderr never contain case IDs, paths, literals, receipt handles,
or per-field diffs. Malformed or incomplete input must return aggregate
`UNKNOWN` and exit non-zero.

- [ ] **Step 5: Verify Task 3 GREEN**

```bash
node --test scripts/evidence-release-reference-policy-v2.test.mjs scripts/evaluate-evidence-release-gate.test.mjs
```

- [ ] **Step 6: Commit Task 3**

```bash
git add scripts/evaluate-evidence-release-gate.mjs scripts/evaluate-evidence-release-gate.test.mjs package.json
git commit -m "gate release evidence through reference policy"
```

### Task 4: V2 production-boundary reference comparison

**Files:**
- Modify: `src/lib/production-boundary-evaluation-runner.ts`
- Modify: `src/lib/production-boundary-evaluation-runner.test.ts`
- Modify: `scripts/evaluate-production-boundary-release-gate.mjs`
- Modify: `scripts/evaluate-production-boundary-release-gate.test.mjs`

**Interfaces:**
- Produces: `runProductionBoundaryCorpusV2(corpus)`, `writeProductionBoundaryResultV2(inputPath, outputPath)`, `evaluateProductionBoundaryReleaseGateV2({ cases, seal, candidates })`
- Consumes: boundary reference derivation from Task 1

- [ ] **Step 1: Write failing boundary V2 tests**

```ts
it("downgrades only non-empty pasted evidence overrides", () => {
  const output = runProductionBoundaryCorpusV2(boundaryCorpusWithPastedFiles());
  expect(output.cases[0]).toMatchObject({
    provenanceOrigin: "pasted_evidence",
    localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
    requirementLocalCiOwnership: "unknown"
  });
});

it("preserves live authority for an empty evidence override", () => {
  expect(runProductionBoundaryCorpusV2(boundaryCorpusWithEmptyOverride()).cases[0]?.provenanceOrigin)
    .toBe("github_snapshot");
});
```

Add active-authoritative/author-claim inbound rejection, incomplete live
collection, previous-path handling, text-only override preservation, parser
privacy rejection as a separate invalid-corpus regression, exact case-set,
hash drift, and aggregate-only tests.

- [ ] **Step 2: Run boundary tests and verify RED**

```bash
pnpm exec vitest run src/lib/production-boundary-evaluation-runner.test.ts
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
```

- [ ] **Step 3: Implement the minimal V2 boundary projection and evaluator**

Keep production calls unchanged. Version only the evaluation envelope, derive
the reference from the sealed boundary corpus, and remove the release path's
manually authored boundary oracle.

- [ ] **Step 4: Verify Task 4 GREEN**

```bash
pnpm exec vitest run src/lib/production-boundary-evaluation-runner.test.ts
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
pnpm typecheck
```

- [ ] **Step 5: Commit Task 4**

```bash
git add src/lib/production-boundary-evaluation-runner.ts src/lib/production-boundary-evaluation-runner.test.ts scripts/evaluate-production-boundary-release-gate.mjs scripts/evaluate-production-boundary-release-gate.test.mjs
git commit -m "derive production boundary reference results"
```

### Task 5: Freeze, toolchain, and production-authority bindings

**Files:**
- Modify: `scripts/evaluation-toolchain-production-closure.test.mjs`
- Modify: `scripts/build-evaluation-toolchain-manifest.mjs`
- Modify: `scripts/build-evaluation-toolchain-manifest.test.mjs`
- Modify: `scripts/evaluate-production-authority-release.mjs`
- Modify: `scripts/evaluate-production-authority-release.test.mjs`
- Modify: `scripts/evaluate-production-authority-release-cli.mjs`
- Modify: `package.json`
- Create: `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v2.json`

**Interfaces:**
- Produces: signed V2 bindings for policy, seal, corpus, coverage, candidate results, and runner/evaluator bundles
- Consumes: V2 aggregate outputs and seal counts from Tasks 1, 3, and 4

- [ ] **Step 1: Write failing binding and closure tests**

Assert the authority gate rejects:

```text
V1 aggregate evidence
V1 authority rubric
missing or changed referencePolicySha256
missing or changed referencePolicySealSha256
corpus/coverage hash drift
totalCases not equal to the signed seal count
anonymous hard-coded category arrays
reference policy imported by a candidate runner
reference module with any non-built-in import
missing requirement/boundary evaluator bundle hash
missing evaluator sandbox profile hash or evaluator attestation
runner mount containing seal/reference/evaluator
evaluator mount containing candidate_sut/runner/rubric
```

- [ ] **Step 2: Run release-authority/toolchain tests and verify RED**

```bash
node --test scripts/build-evaluation-toolchain-manifest.test.mjs scripts/evaluation-toolchain-production-closure.test.mjs scripts/evaluate-production-authority-release.test.mjs
```

- [ ] **Step 3: Bind the reference policy separately from candidate runners**

Add the reference and seal-builder modules to evaluator tooling files, not
candidate runner imports. Add requirement/boundary evaluator bundles and a
separate evaluator sandbox profile to the manifest. Replace oracle bindings
and anonymous expected category arrays with the signed V2
policy/seal/corpus/coverage bindings. Validate aggregate case counts against
the seal instead of `totalCases === 4`.

- [ ] **Step 4: Create and require the V2 authority rubric**

Copy no V1 oracle binding. The V2 rubric must require exact bindings for:

```text
referencePolicySha256, referencePolicySealSha256,
evidenceCorpusSha256, boundaryCorpusSha256, coverageSummarySha256,
requirementResultSha256, boundaryResultSha256,
requirementRunnerBundleSha256, boundaryRunnerBundleSha256,
requirementEvaluatorBundleSha256, boundaryEvaluatorBundleSha256,
referencePolicyBundleSha256,
runnerSandboxProfileSha256, evaluatorSandboxProfileSha256,
four exact mount-set hashes, candidateSha, runtime and toolchain hashes
```

Update authority parsing to accept only rubric version/id V2 for release.
Keep the V1 JSON file unchanged and historical.

- [ ] **Step 5: Verify frozen isolation**

Require four signed attestations:

```text
requirement_runner, boundary_runner,
requirement_evaluator, boundary_evaluator
```

Runner read-only mounts are exactly `candidate_sut`, `protected_input`,
`runner_bundle`, `runtime_profile`; writable is exactly `result`. Evaluator
read-only mounts are exactly `protected_input`, `policy_seal`,
`candidate_result`, `reference_policy`, `evaluator_bundle`,
`runtime_profile`; writable is exactly `aggregate_result`. All four have
network disabled and distinct signed mount-set hashes.

- [ ] **Step 6: Verify Task 5 GREEN**

```bash
node --test scripts/build-evaluation-toolchain-manifest.test.mjs scripts/evaluation-toolchain-production-closure.test.mjs scripts/evaluate-production-authority-release.test.mjs
```

- [ ] **Step 7: Commit Task 5**

```bash
git add scripts/evaluation-toolchain-production-closure.test.mjs scripts/build-evaluation-toolchain-manifest.mjs scripts/build-evaluation-toolchain-manifest.test.mjs scripts/evaluate-production-authority-release.mjs scripts/evaluate-production-authority-release.test.mjs scripts/evaluate-production-authority-release-cli.mjs docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v2.json package.json
git commit -m "bind closed reference policy to release authority"
```

### Task 6: Specification migration and full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-21-executable-release-evaluation-pre-freeze-design.md`
- Modify: `docs/superpowers/specs/2026-08-25-phase-4-release-closure-design.md`
- Modify: `docs/superpowers/specs/2026-08-25-evidence-outcome-backbone-program-design.md`
- Modify: `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-design.md`
- Verify: `docs/superpowers/specs/2026-08-26-closed-reference-oracle-v2-design.md`

**Interfaces:**
- Produces: one non-contradictory release-evaluation specification set
- Consumes: implemented V2 CLI names, hashes, counts, and rollback behavior

- [x] **Step 1: Update superseded V1 language**

Mark manually authored V1 tuple oracles as development-only, document that the
failed freeze is invalidated, and replace `--oracle` release examples with:

```bash
pnpm eval:evidence:release -- --cases /protected/evidence-cases.v2.json --seal /protected/reference-policy-seal.v2.json --candidates /result/evidence-candidates.v2.json
```

Document the equivalent boundary command with the same seal.

Update the authority design to name the V2 rubric, four attestations, distinct
runner/evaluator profiles, and policy/seal bindings. Preserve the V1 rubric as
historical only.

- [x] **Step 2: Run specification consistency checks**

```bash
rg -n -- '--oracle|totalCases === 4|manually authored oracle|requirementOrdinals' docs/superpowers/specs docs/superpowers/plans package.json scripts src/lib
```

Expected: remaining matches occur only in explicitly labeled V1 development
compatibility tests or historical sections.

- [x] **Step 3: Run focused V2 evaluation verification**

```bash
node --test scripts/evidence-release-reference-policy-v2.test.mjs scripts/build-reference-policy-seal-v2.test.mjs scripts/evaluate-evidence-release-gate.test.mjs scripts/evaluate-production-boundary-release-gate.test.mjs scripts/build-evaluation-toolchain-manifest.test.mjs scripts/evaluation-toolchain-production-closure.test.mjs scripts/evaluate-production-authority-release.test.mjs
pnpm exec vitest run src/lib/release-evaluation-runner.test.ts src/lib/release-evaluation-runner-cli.test.ts src/lib/production-boundary-evaluation-runner.test.ts
```

- [x] **Step 4: Run complete engineering gates**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

- [x] **Step 5: Run an independent scope/privacy review**

The reviewer verifies production report schemas are unchanged, only the two
static capabilities are release-positive, V1 cannot establish release
authority, aggregate output contains no protected content, and the reference
module has no candidate-code imports.

**Task 6 completion evidence (2026-08-26):** The consistency scan found V1
tokens only in explicitly labeled historical V1 documents/plans and V1
compatibility tests; V2 documents use `--cases`, `--seal`, and `--candidates`.
Focused V2 verification passed 69 Node-test assertions and 56 Vitest tests.
The full suite passed 163 files / 2,236 tests (2 skipped); typecheck, lint,
build, and `git diff --check` passed. Independent scope/privacy review found
one V1-wording residue, corrected it to “input-only corpora, V2 seal, and
derived coverage,” then verified the remaining scope/privacy conditions.

- [ ] **Step 6: Commit Task 6**

```bash
git add docs/superpowers/specs/2026-08-21-executable-release-evaluation-pre-freeze-design.md docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-design.md docs/superpowers/specs/2026-08-25-phase-4-release-closure-design.md docs/superpowers/specs/2026-08-25-evidence-outcome-backbone-program-design.md docs/superpowers/specs/2026-08-26-closed-reference-oracle-v2-design.md docs/superpowers/plans/2026-08-26-closed-reference-oracle-v2.md
git commit -m "document closed reference oracle v2"
```

## Post-implementation release sequence

1. Push the exact implementation SHA and require GitHub CI plus independent review.
2. Have a holdout custodian create fresh V2 input-only corpora and the seal without running the candidate.
3. Run coverage preflight and seal validation before candidate execution.
4. Execute V2 candidate runners in the frozen no-network sandbox.
5. Execute V2 aggregate gates with the protected reference bundle.
6. Require every binary count to be zero and every required metric to be known.
7. Run exact-SHA production-shaped replay and current production smoke.
8. Seek separate merge/deployment approval; a passing holdout alone does not deploy.
