# Production Authority and Blind Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close untrusted-v2 and pasted-evidence authority gaps, then create the pre-freeze tooling that can evaluate those fixes without exposing protected cases or allowing a score to bypass safety gates.

**Architecture:** Production behavior is fixed in two places: the one runtime report-boundary adapter and the one final pasted-evidence merge adapter. Evaluation remains separate: a normal requirement runner and a production-boundary runner each emit closed, opaque candidate results; frozen evaluators and one rubric executor consume only aggregate data and signed evidence bindings. Runner isolation is enforced by an attested no-network sandbox profile, not a self-reported metric.

**Tech Stack:** TypeScript, Vitest, Node.js 22, pnpm, existing Next.js route tests, Node built-in test runner, SHA-256.

**Spec:** `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-design.md`

## Global Constraints

- Preserve AgentProof as a deterministic-first evidence-report product; do not convert it into a merge gate or general code review product.
- `generated_private_full` is the only boundary that may preserve active v2 contract outcomes; `inbound_untrusted_full` must reject every authoritative or author-claim v2 report.
- Any non-empty pasted changed-files, checks, or logs override produces `pasted_evidence`, clears positive local authority, and cannot preserve a previously satisfied local axis.
- Preserve pure-live GitHub behavior and v1 conservative import/summary behavior.
- No LLM-only promotion; weak or mixed evidence is `Partial`, `Unclear`, or `Unknown`.
- Public share, tenant projection, aggregate runner output, and logs must not expose source, patches, logs, paths, tokens, private receipts, or workflow identity tuples.
- Every new behavior follows RED → GREEN before production code is written.
- Do not read, list, create, modify, or score any protected `eval/` corpus/oracle artifact. Use synthetic development fixtures only.
- Do not commit, push, merge, deploy, publish, or mutate external systems. An immutable candidate commit and deployment require later explicit authorization.
- All protected-runner tooling must stay default-off and must not enable `receipt_v2` outside its scoped runner process.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/report-runtime-validation.ts` | Enforce generated-private versus inbound-untrusted report authority. |
| `src/lib/report-runtime-validation-authority.test.ts` | Synthetic authority-boundary and route-independent regressions. |
| `src/app/api/{reports,llm/verify,github/comment,notifications/slack}/route.test.ts` | Prove every untrusted publication/import caller rejects active v2 input. |
| `src/lib/github.ts` | Own the final live-plus-pasted merge policy; expose a narrow production adapter for replay. |
| `src/lib/github-pasted-provenance.test.ts` | Exercise files-only, checks-only, logs-only, combined, and pure-live transitions. |
| `src/lib/production-boundary-evaluation-runner.ts` | Run opaque synthetic untrusted-v2 and pasted-merge boundary cases against real adapters. |
| `src/lib/production-boundary-evaluation-runner.test.ts` | Closed input/output, cap, no-leak, and real-adapter behavior tests. |
| `scripts/evaluate-production-boundary-release-gate.mjs` | Compare boundary runner output to a boundary oracle and emit closed aggregate counters. |
| `scripts/evaluate-production-boundary-release-gate.test.mjs` | Test missing/duplicate/extra cases, mismatches, and aggregate-only output. |
| `scripts/build-evaluation-toolchain-manifest.mjs` | Build the reproducible static evaluation-tool closure/bundle manifest and sandbox profile binding. |
| `scripts/build-evaluation-toolchain-manifest.test.mjs` | Test undeclared imports, dynamic imports, closure changes, and exact manifest schema. |
| `scripts/evaluate-production-authority-release.mjs` | Validate `ReleaseAssessmentEvidenceV1`, apply binary gates, then calculate rubric points. |
| `scripts/evaluate-production-authority-release.test.mjs` | Test unknown/missing/stale evidence, bad sandbox attestation, invalid output schema, and score override. |
| `package.json` | Add explicit pre-freeze toolchain, boundary-candidate, boundary-evaluation, and rubric-executor scripts; never add a default protected path. |

## Task 1: Reject active v2 authority at every untrusted boundary

**Files:**

- Create: `src/lib/report-runtime-validation-authority.test.ts`
- Modify: `src/lib/report-runtime-validation.ts`
- Modify: `src/lib/report-runtime-validation.test.ts`
- Modify tests only as needed: `src/app/api/reports/route.test.ts`, `src/app/api/llm/verify/route.test.ts`, `src/app/api/github/comment/route.test.ts`, `src/app/api/notifications/slack/route.test.ts`

**Interfaces:**

- Consumes: `validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report })`.
- Produces: an invalid result for all v2 reports whose contract is active (`authoritative` or `author_claim`), regardless of proof-axis or receipt presence.
- Preserves: `validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report, requireV2: true })` for a server-generated, receipt-complete v2 report.

- [ ] **Step 1: Write focused failing authority tests.**

Create synthetic v2 reports for an authoritative artifact criterion and an author-claim absence criterion. Each report has no satisfied targeted-test or execution axis, so the test proves contract authority—not receipt presence—causes rejection.

```ts
it("rejects an inbound authoritative v2 report even without receipt-gated axes", () => {
  const result = validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report: authoritativeArtifactReport() });
  expect(result).toMatchObject({ valid: false });
});

it("keeps a server-generated receipt-complete v2 report on the generated-private path", () => {
  const result = validateRuntimeReportBoundary({ boundary: "generated_private_full", input: validInput(), report: generatedV2Report(), requireV2: true });
  expect(result).toMatchObject({ valid: true, usedDeterministicFallback: false });
});
```

Add one route test per listed inbound caller using the same synthetic active v2 input. Assert bounded validation failure, no publication/save side effect, and no raw report text in the response.

- [ ] **Step 2: Run RED.**

Run:

```bash
pnpm vitest run src/lib/report-runtime-validation-authority.test.ts src/lib/report-runtime-validation.test.ts src/app/api/reports/route.test.ts src/app/api/llm/verify/route.test.ts src/app/api/github/comment/route.test.ts src/app/api/notifications/slack/route.test.ts
```

Expected: new inbound authoritative/author-claim tests fail because inbound validation currently checks only receipt-gated positive axes.

- [ ] **Step 3: Implement the minimum central rejection.**

In `report-runtime-validation.ts`, add one private predicate that recognizes a v2 report with active contract authority from report schema/state—not from receipt collection shape. Invoke it only for `inbound_untrusted_full`, before schema validation. Keep `signed_summary_read`, v1 reports, and generated-private validation unchanged.

```ts
if (input.boundary === "inbound_untrusted_full" && hasActiveV2ContractAuthority(input.report)) {
  return { valid: false, errors: ["An inbound untrusted full v2 report cannot carry an active contract outcome."] };
}
```

- [ ] **Step 4: Run GREEN and compatibility tests.**

Run the Step 2 command plus:

```bash
pnpm vitest run src/lib/verification-contract-v2-evaluation.test.ts src/lib/report-validation.test.ts
pnpm typecheck
```

Expected: active inbound v2 reports reject; server-generated v2, v1 import/summary, authoritative linked-Issue, PR-author-claim partial, and absent/invalid unclear cases retain their specified behavior.

---

## Task 2: Make every pasted override conservative and replayable

**Files:**

- Create: `src/lib/github-pasted-provenance.test.ts`
- Modify: `src/lib/github.ts`
- Modify: `src/lib/github.test.ts`
- Modify: `src/lib/verifier.ts`
- Modify: `src/lib/verifier.test.ts`
- Modify: `src/app/api/analyze/route.test.ts`

**Interfaces:**

- Consumes: a live `PullRequestInput` and an `AnalyzeRequest` with optional pasted `changedFiles`, `checks`, or `logs`.
- Produces: exported `mergePastedEvidenceForAnalysis(live, request): PullRequestInput` for production and boundary replay; this is the only final merge implementation.
- Produces: a report generated from `sourceProvenance.origin === "pasted_evidence"` whose local `implementation`, `targeted_test`, and `execution` axes are all `incomplete`.

- [ ] **Step 1: Write failing transition-table tests.**

Use one complete live GitHub input with a generated local positive. Create five cases: pasted files only, pasted checks only, pasted logs only, all three pasted, and pure-live control.

```ts
for (const request of pastedOverrides()) {
  const merged = mergePastedEvidenceForAnalysis(liveInput(), request);
  const report = generateVerificationReportV2FromInput(merged);
  expect(merged.sourceProvenance?.origin).toBe("pasted_evidence");
  expect(report.requirements[0].proofAxes.filter(isLocalAxis).every((axis) => axis.state === "incomplete")).toBe(true);
  expect(report.requirements[0].status).not.toBe("met");
}
```

Assert that each pasted case clears contract source/binding/criterion evidence, resolved modules, execution suites, workflow identities, complete changed-file inventory authority, and requirement-local CI references. Assert pure-live leaves all of them intact.

- [ ] **Step 2: Run RED.**

Run:

```bash
pnpm vitest run src/lib/github-pasted-provenance.test.ts src/lib/github.test.ts src/lib/verifier.test.ts src/app/api/analyze/route.test.ts
```

Expected: logs-only retains live authority; at least one pasted path can retain a satisfied local axis.

- [ ] **Step 3: Implement one final merge policy and one verifier downgrade.**

Rename/export the current private merger as `mergePastedEvidenceForAnalysis`. Define `hasPastedAuthorityOverride` from exactly `changedFiles`, `checks`, or `logs`; PR-description/task-text edits alone do not trigger this transition. For any override, rebuild metadata-only `pasted_evidence` provenance from final evidence, clear the listed live-positive inputs, add a precise limitation, and remove workflow identity from every retained check.

In `verifier.ts`, add one provenance guard immediately before requirement outcome aggregation. When origin is `pasted_evidence`, rewrite every local proof axis to `incomplete`, preserve only non-authoritative observation refs, set evidence status to `partial` or `unclear` according to the transition table, and prevent a contract outcome from remaining active. Do not duplicate merge logic in the verifier.

- [ ] **Step 4: Run GREEN and pure-live regression.**

Run the Step 2 command plus:

```bash
pnpm vitest run src/app/api/analyze/github-replay.test.ts src/lib/verification-contract-v2-evaluation.test.ts
pnpm typecheck
```

Expected: all four pasted forms downgrade; pure-live complete replay retains receipt-backed local evidence; no pasted result holds GitHub-complete authority.

---

## Task 3: Add the production-boundary replay runner and aggregate evaluator

**Files:**

- Create: `src/lib/production-boundary-evaluation-runner.ts`
- Create: `src/lib/production-boundary-evaluation-runner.test.ts`
- Create: `scripts/evaluate-production-boundary-release-gate.mjs`
- Create: `scripts/evaluate-production-boundary-release-gate.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: closed `ProductionBoundaryCaseV1` input cases with `kind: "inbound_untrusted_v2"` or `kind: "pasted_merge"`.
- Produces: `ProductionBoundaryResultCorpusV1` containing only `caseId`, disposition, provenance origin, local-axis state tuple, local-CI ownership, and leak count.
- Produces: aggregate-only counters `untrustedActiveV2AcceptanceCount`, `pastedEvidenceGithubAuthorityCount`, `falseBoundaryLocalPositiveCount`, `boundaryPrivacyLeakCount`, and `boundaryStructuralMismatchCount`.

- [ ] **Step 1: Write failing closed-envelope runner tests.**

Test that unknown keys, duplicate IDs, more than 12 cases, a corpus above 409,600 bytes, a case above 98,304 bytes, token fields, and raw private URL/source/log values are rejected. Test that runner output serializes without report text, paths, patches, logs, receipts, or validation prose.

```ts
it("executes the real inbound adapter and returns only a rejected disposition", () => {
  const result = runProductionBoundaryCorpusV1(untrustedActiveV2Corpus());
  expect(result.cases[0]).toEqual(expect.objectContaining({ disposition: "rejected" }));
  expect(JSON.stringify(result)).not.toContain("private source");
});
```

Write evaluator tests using synthetic oracle/candidate fixtures for each non-zero counter, missing/extra/duplicate cases, and a clean all-zero result. Assert CLI stdout has no case ID.

- [ ] **Step 2: Run RED.**

Run:

```bash
pnpm vitest run src/lib/production-boundary-evaluation-runner.test.ts
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
```

Expected: module and CLI are missing.

- [ ] **Step 3: Implement runner and evaluator without oracle access.**

The runner invokes only `validateRuntimeReportBoundary` and `mergePastedEvidenceForAnalysis`, then derives opaque structural results. It cannot import, accept, or discover an oracle path. The evaluator validates exact input/output schemas, rejects duplicate/missing/extra cases, derives all five counters from oracle versus candidate output, emits a closed aggregate JSON object, and exits non-zero for an unknown or non-zero release metric.

Add explicit package scripts that require caller-provided input/output paths and never contain a default `eval/` path.

- [ ] **Step 4: Run GREEN.**

Run the Step 2 command plus:

```bash
pnpm typecheck
git diff --check
```

Expected: runner/evaluator process only synthetic development fixtures; all output is aggregate-only.

---

## Task 4: Freeze the evaluation-tool closure, sandbox contract, and rubric executor

**Files:**

- Create: `scripts/build-evaluation-toolchain-manifest.mjs`
- Create: `scripts/build-evaluation-toolchain-manifest.test.mjs`
- Create: `scripts/evaluate-production-authority-release.mjs`
- Create: `scripts/evaluate-production-authority-release.test.mjs`
- Modify: `scripts/evaluate-evidence-release-gate.mjs`
- Modify: `scripts/evaluate-evidence-release-gate.test.mjs`
- Modify: `package.json`
- Modify only if a factual correction is needed: `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v1.json`

**Interfaces:**

- Consumes: fixed evaluation entry points and a declared production-SUT external-import allowlist.
- Produces: exact `EvaluationToolchainManifestV1` containing sorted static closure file hashes, bundle hashes, profile hash, script/lock/runtime hashes, and no self-reported safety counters.
- Consumes: `ReleaseAssessmentEvidenceV1` with named signed evidence sources.
- Produces: an aggregate score, binary-gate states, and `eligible_for_deployment_approval`, `conditional_candidate`, or `no_go`.

- [ ] **Step 1: Write failing manifest and release-assessment tests.**

Create synthetic temporary tooling trees. Assert that a static helper import changes the closure hash, an undeclared import fails, dynamic import fails, a changed bundle/profile/hash fails, and fixed SUT imports are accepted only when allowlisted. Test a runner-sandbox attestation with enabled network, an oracle/evaluator/rubric mount, writable candidate input, missing result hash, or wrong candidate SHA; each must fail.

Write release-assessment tests for: missing evidence, duplicate evidence ID, unknown evidence field, stale closure hash, bad aggregate nested schema, bad boundary scalar schema, score 100 with one failed binary gate, and correct 95/100 all-gates-pass decision.

- [ ] **Step 2: Run RED.**

Run:

```bash
node --test scripts/build-evaluation-toolchain-manifest.test.mjs
node --test scripts/evaluate-production-authority-release.test.mjs
```

Expected: modules are missing or tests fail because the current evaluator output/schema and evidence envelope do not enforce the new frozen-tool and sandbox contracts.

- [ ] **Step 3: Implement deterministic closure and closed assessment.**

Use a sorted static import walker for frozen tooling entries. Reject `import()` and `require()` expressions that are not literal allowlisted fixed SUT imports. Hash every tooling file and the sorted path/hash list; do not include candidate production modules in the tooling closure. Validate exact manifest and sandbox-attestation keys. The sandbox validator checks declared mounts and hashes, disabled network, read-only inputs/SUT, writable result only, and no oracle/evaluator/rubric/worktree/secret mount.

Preserve the existing evaluator's exact aggregate schema: scalar counters plus only `{ count, rate }` and `{ p50, p95 }` nested groups. Reject arbitrary nested objects or generic text fields. The rubric executor validates named evidence, applies every binary gate before score interpretation, awards criterion points all-or-nothing, and emits no evidence payloads or protected case identifiers.

- [ ] **Step 4: Run GREEN.**

Run the Step 2 commands plus:

```bash
node --test scripts/evaluate-evidence-release-gate.test.mjs
pnpm typecheck
pnpm lint
git diff --check
```

Expected: synthetic malformed manifests, attestations, aggregate payloads, and binary-gate bypass attempts fail closed.

---

## Task 5: Integrate pre-freeze commands and verify the local candidate

**Files:**

- Modify: `package.json`
- Modify tests only as needed from Tasks 1–4.
- Create: `.superpowers/sdd/2026-08-22-production-authority-blind-evaluation/task-5-verification.md` (git-ignored execution evidence only)

**Interfaces:**

- Consumes: local synthetic test fixtures and declared explicit CLI paths.
- Produces: no protected corpus, no candidate commit, and a truthful local pre-freeze verification record.

- [ ] **Step 1: Write failing package-script forwarding tests.**

Add tests that each new CLI fails without explicit input/output paths, accepts the normal `pnpm <script> -- --input … --output …` forwarding form, and does not contain an `eval/` default path.

- [ ] **Step 2: Run RED.**

Run each new script with no arguments.

Expected: non-zero exit without reading a protected path.

- [ ] **Step 3: Add explicit scripts and record local evidence.**

Add `eval:production-boundary:candidates`, `eval:production-boundary:release`, `eval:toolchain:manifest`, and `eval:production-authority:release`. Each requires explicit caller paths; none creates, reads, or scores protected artifacts by default. Record command, exit code, and test count in the git-ignored task verification file.

- [ ] **Step 4: Run full local verification.**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Then run all new unit commands with synthetic development fixtures only. Record actual output. Do not claim protected-evaluation, external-pilot, production-smoke, independent-review, candidate-commit, or deployment gates pass; they remain `NO-GO` until their separately authorized evidence exists.

## Plan Self-Review

- Spec coverage: Task 1 covers untrusted authority; Task 2 covers every pasted form and pure-live preservation; Task 3 covers real-adapter boundary replay; Task 4 covers closure hashes, sandbox isolation, closed aggregate schema, binary gates, and scoring; Task 5 covers explicit command wiring and full local verification.
- Dependency order: Task 2 exports the merge adapter before Task 3 consumes it. Tasks 1 and 2 complete before boundary replay verifies the final production behavior. Task 4 consumes both evaluator contracts. Task 5 only wires already-tested artifacts.
- Privacy: every task prohibits protected artifact access and validates only synthetic data. Task 4 rejects arbitrary aggregate payloads; Task 5 ensures no default protected path.
- Authority: no task commits, pushes, deploys, publishes, or creates protected cases. The plan ends in a local pre-freeze `NO-GO`, not a release claim.
- Placeholder scan: no deferred implementation markers are present.
