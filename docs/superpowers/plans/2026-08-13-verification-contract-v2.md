# Verification Contract v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a report say `Supported against approved contract` only when a source-bound, typed v2 criterion is deterministically satisfied; otherwise retain observed evidence while reporting an outcome as `unclear`, `partial`, or `missing`.

**Architecture:** Introduce a strict, bounded v2 contract parser and a separate criterion evaluator. The verifier materializes observed evidence as it does today, but v2 status aggregation consumes only server-derived criterion results. A v2 report is structurally distinct from legacy v1, signed/private data keeps the source binding, and portable sharing uses a neutral hashless projection. Behavioural return-value proof is an attested execution seam that fails closed until the AgentProof-owned executor is deployed.

**Tech Stack:** TypeScript, Vitest, Next.js server routes, Supabase SQL migrations, GitHub API metadata, HMAC report signatures.

## Global Constraints

- Do not build on the unapproved subjective-keyword/regex experiment currently dirty in `src/lib/verifier*.ts`; remove or supersede it in Task 1.
- V2 accepts only `return_value`, `artifact`, and structural `absence` criteria. Unknown/UI/navigation/state/threshold types invalidate the whole contract.
- A model, report input, GitHub Check name, or PR-controlled workflow can never author a v2 criterion state or proof axis.
- V2 `met` requires an authoritative contract with 1–12 objectives, 1–4 criteria/objective, and every required criterion satisfied.
- No contract, invalid contract, stale binding, incomplete collection, unavailable executor, or malformed result must fail closed; never silently route through v1.
- V1 reports are decoded only through `legacy_read`; no new write/sign/publish path may create or re-sign v1.
- Private binding digests, source IDs/text, objective/criterion labels, locators, literals, raw code, logs, provider data, and execution output never enter telemetry or portable sharing.
- Keep existing exact-head relevance, CI-failure, absence-completeness, HMAC, one-provider-POST, and source-relink fencing invariant.
- Run focused RED then GREEN before production code for every task. Do not claim live executor, Supabase migration, provider, or production validation unless actually run.

---

### Task 1: Remove the failed assessability experiment and establish the v2 pure contract boundary

**Files:**
- Create: `src/lib/verification-contract-v2.ts`
- Test: `src/lib/verification-contract-v2.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/verifier-proof-expectations.ts`
- Modify: `src/lib/verifier-proof-expectations.test.ts`

**Interfaces:**
- Produces `parseVerificationContractV2(source)`, `selectVerificationContractV2(input)`, `canonicalVerificationBindingV2(input, contract)`, and closed source/normalized types.
- Produces `VerificationContractStateV2 = "authoritative" | "author_claim" | "absent" | "invalid"`.
- Removes the experimental lexical assessability status override; existing v1 expectation calculation is unchanged for legacy reports.

- [ ] **Step 1: Write failing parser/selection tests**

```ts
it("rejects an Issue contract when title or body has substantive sibling prose", () => {
  expect(parseLinkedIssueVerificationContract({
    title: "Other objective",
    body: "```agentproof-verification\n{\"version\":2,\"scope\":\"complete_objective_set\",\"objectives\":[]}\n```"
  }).state).toBe("invalid");
});

it("returns absent for PR #24-style prose while preserving no lexical classification", () => {
  expect(selectVerificationContractV2({ taskText: "The repository overview should be more useful for reviewers." }).state).toBe("absent");
});
```

- [ ] **Step 2: Run the new parser test file and confirm RED**

Run: `pnpm vitest run src/lib/verification-contract-v2.test.ts`

Expected: failure because the parser module does not exist.

- [ ] **Step 3: Implement the strict source union and canonical binding**

```ts
export function parseVerificationContractV2(source: VerificationContractSourceInput): ParsedVerificationContractV2 {
  // Normalize CR/LF, require the exact envelope, reject unknown keys and any
  // overflow, then return authoritative/author_claim/absent/invalid.
}

export function canonicalVerificationBindingV2(input: PullRequestInput, contract: ParsedVerificationContractV2): string {
  return sha256(stableJson({ version: 2, contract, source: canonicalSource(input) }));
}
```

Implement only the three pilot criteria and exact source envelopes. Remove the dirty regex assessability branches rather than retaining them as a fallback.

- [ ] **Step 4: Run parser and expectation regression tests and confirm GREEN**

Run: `pnpm vitest run src/lib/verification-contract-v2.test.ts src/lib/verifier-proof-expectations.test.ts`

Expected: parser tests pass; legacy v1 expectation tests preserve their pre-v2 behavior.

### Task 2: Add v2 report discriminants, proof-axis identity, and criterion evaluation types

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/proof-contract.ts`
- Test: `src/lib/proof-contract.test.ts`
- Test: `src/lib/verification-contract-v2.test.ts`

**Interfaces:**
- Produces `VerificationReportV2`, `PortableVerificationContractV2`, `VerificationCriterionEvaluationV2`, `RequirementProofAxisV2`, `axisId`, and v2-only `attested_execution` basis.
- V1 types retain current JSON shape and reject v2-only fields.

- [ ] **Step 1: Write failing structural tests**

```ts
it("requires a nonempty criterion set before a v2 objective can be met", () => {
  expect(validateVerificationContractV2(emptyAuthoritativeObjective).ok).toBe(false);
});

it("creates canonical criterion axis IDs and rejects cross-criterion references", () => {
  expect(validateCriterionAxisClosure(forgedAxisReference).ok).toBe(false);
});
```

- [ ] **Step 2: Run the structural tests and confirm RED**

Run: `pnpm vitest run src/lib/verification-contract-v2.test.ts src/lib/proof-contract.test.ts`

Expected: failure because v2 axis identity and validation do not exist.

- [ ] **Step 3: Implement the discriminated union and canonical axis helpers**

```ts
export interface VerificationReportV2 extends VerificationReportBase {
  reportSchemaVersion: "verification-report.v2";
  verificationContract: VerificationContractV2;
}

export function criterionAxisId(requirementId: string, criterionId: string, subject: RequirementProofSubject, polarity: RequirementProofPolarity): string {
  return `ax_${requirementId}_${criterionId}_${subject}_${polarity}`;
}
```

Keep public-only types hashless and prohibit v2 subjects/bases in v1 validators.

- [ ] **Step 4: Run the structural tests and confirm GREEN**

Run: `pnpm vitest run src/lib/verification-contract-v2.test.ts src/lib/proof-contract.test.ts`

Expected: canonical IDs, cardinality, and v1/v2 type separation pass.

### Task 3: Materialize v2 objectives and aggregate deterministic status in the verifier

**Files:**
- Modify: `src/lib/verifier.ts`
- Test: `src/lib/verifier.test.ts`
- Test: `src/lib/hybrid-report-finalizer.test.ts`

**Interfaces:**
- Consumes parsed v2 contract and deterministic observation index.
- Produces requirement status, criterion results, observation axes, and v2 gaps.

- [ ] **Step 1: Write failing end-to-end verifier tests**

```ts
it("keeps PR #24 implementation, test, and execution observations but reports unclear without a contract", () => {
  const report = generateVerificationReport(pr24Input, { verificationContractV2: true });
  expect(report.requirements[0]).toMatchObject({ status: "unclear" });
  expect(report.requirements[0].proofAxes).toEqual(expect.arrayContaining([
    expect.objectContaining({ subject: "implementation", state: "satisfied" }),
    expect.objectContaining({ subject: "execution", state: "satisfied" })
  ]));
});

it("does not allow an unbound passing Check to satisfy a return-value criterion", () => {
  expect(generateVerificationReport(returnValueInput).requirements[0].status).not.toBe("met");
});
```

- [ ] **Step 2: Run verifier/finalizer tests and confirm RED**

Run: `pnpm vitest run src/lib/verifier.test.ts src/lib/hybrid-report-finalizer.test.ts`

Expected: current aggregation incorrectly returns `met` or lacks v2 criterion state.

- [ ] **Step 3: Implement v2 materialization and total aggregation**

```ts
export function aggregateVerificationCriteriaV2(state: VerificationContractStateV2, criteria: VerificationCriterionEvaluationV2[]): RequirementStatus {
  if (state === "absent" || state === "invalid") return "unclear";
  if (criteria.length === 0) throw new Error("authoritative v2 objective requires criteria");
  if (criteria.every((item) => item.state === "satisfied")) return "met";
  if (criteria.some((item) => item.state === "satisfied")) return "partial";
  if (criteria.every((item) => item.state === "violated")) return "missing";
  return "unclear";
}
```

Derive status only from criterion results. Preserve pre-existing implementation/test/CI facts as `role: "observation"` axes. Cap PR-author claims at `partial` with `evidenceStatus: "met"` when applicable. Make hybrid finalization consume the same evaluator; planner output stays advisory.

- [ ] **Step 4: Run verifier/finalizer tests and confirm GREEN**

Run: `pnpm vitest run src/lib/verifier.test.ts src/lib/hybrid-report-finalizer.test.ts`

Expected: no-contract subjective outcome is `unclear`; positive/negative/PR-author cases match the truth table.

### Task 4: Build the isolated return-value execution request/result validator, fail closed until executor deployment

**Files:**
- Create: `src/lib/verification-execution-v2.ts`
- Test: `src/lib/verification-execution-v2.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/verifier.ts`

**Interfaces:**
- Produces `buildVerificationExecutionRequestV2`, `validateAttestedExecutionResultV2`, and `evaluateReturnValueCriterionV2`.
- No local child-process execution, GitHub Action output, or repository code is trusted as an attested result.

- [ ] **Step 1: Write failing result-boundary tests**

```ts
it("marks a criterion unavailable when an attestation is missing", () => {
  expect(evaluateReturnValueCriterionV2(contract, undefined).state).toBe("unavailable");
});

it("rejects reordered, duplicate, or cross-contract adapter tuples before status aggregation", () => {
  expect(validateAttestedExecutionResultV2(forgedResult, request).ok).toBe(false);
});
```

- [ ] **Step 2: Run execution-boundary tests and confirm RED**

Run: `pnpm vitest run src/lib/verification-execution-v2.test.ts`

Expected: failure because execution request/result validation does not exist.

- [ ] **Step 3: Implement the pure request/result boundary**

```ts
export function buildVerificationExecutionRequestV2(binding: string, criterion: ReturnValueCriterionV2): VerificationExecutionRequestV2 {
  return { version: 1, binding, criteria: [toExecutionTarget(criterion)] };
}

export function validateAttestedExecutionResultV2(value: unknown, request: VerificationExecutionRequestV2): ValidationResult {
  // Exact keys, 64KiB cap, one-to-one adapter tuples/cases, binding/head match,
  // public-key signature verification, and no caller-authored status.
}
```

The production transport returns `unavailable` until the separately deployed AgentProof executor endpoint and public key are configured. This is deliberate fail-closed behavior.

- [ ] **Step 4: Run execution-boundary tests and confirm GREEN**

Run: `pnpm vitest run src/lib/verification-execution-v2.test.ts src/lib/verifier.test.ts`

Expected: forged result variants reject; missing transport cannot yield `met`.

### Task 5: Harden full validation, authenticity, storage, and share boundaries

**Files:**
- Modify: `src/lib/report-validation.ts`
- Modify: `src/lib/report-authenticity.ts`
- Modify: `src/lib/server-report-store.ts`
- Modify: `src/lib/report-share.ts`
- Test: `src/lib/report-validation.test.ts`
- Test: `src/lib/report-authenticity.test.ts`
- Test: `src/lib/server-report-store.test.ts`
- Test: `src/lib/report-share.test.ts`

**Interfaces:**
- Consumes `VerificationReportV2` only at new write paths.
- Produces `legacy_read`, `v2_full`, and `v2_summary` validation behavior plus V4 portable envelope.

- [ ] **Step 1: Write failing trust-boundary tests**

```ts
it("rejects a v2 met report whose contract was deleted to resemble v1", () => {
  expect(validateVerificationReport(forgedDeletedContract, { mode: "v2_full" }).valid).toBe(false);
});

it("omits binding digest, labels, locators, literals, and source IDs from V4 shares", () => {
  expect(JSON.stringify(toShareableReport(v2Report))).not.toContain(v2Report.verificationContract.integrity!.verificationBindingDigest);
});
```

- [ ] **Step 2: Run report/storage/share tests and confirm RED**

Run: `pnpm vitest run src/lib/report-validation.test.ts src/lib/report-authenticity.test.ts src/lib/server-report-store.test.ts src/lib/report-share.test.ts`

Expected: v2 variants and V4 projection do not yet exist.

- [ ] **Step 3: Implement explicit v2 validation and persistence variants**

```ts
export type ReportValidationMode = "legacy_read" | "v2_full" | "v2_summary";

export function assertNewWritableReport(report: VerificationReportV2): void {
  if (report.reportSchemaVersion !== "verification-report.v2") throw new Error("v2 report required");
}
```

Require v2 full reports to carry integrity and valid HMAC. Keep legacy decoder read-only and reject it in write/sign/comment/publication APIs. Add V4 exact-key portable projection with neutral type labels only; decode V1–V3 under existing labels without re-signing as v2.

- [ ] **Step 4: Run report/storage/share tests and confirm GREEN**

Run: `pnpm vitest run src/lib/report-validation.test.ts src/lib/report-authenticity.test.ts src/lib/server-report-store.test.ts src/lib/report-share.test.ts`

Expected: all forge, unknown-key, digest-leak, and legacy-write cases reject; valid v1 reads remain available.

### Task 6: Add source-binding job persistence and stale-source fences

**Files:**
- Create: `supabase/migrations/202608130001_verification_contract_v2.sql`
- Modify: `src/lib/analysis-jobs.ts`
- Modify: `src/lib/analysis-worker.ts`
- Modify: `src/app/api/github/webhook/route.ts`
- Test: `src/lib/analysis-jobs.test.ts`
- Test: `src/lib/analysis-worker.test.ts`
- Test: `src/app/api/github/webhook/route.test.ts`

**Interfaces:**
- Adds paired nullable `verification_contract_version` and `verification_binding_digest` to active jobs.
- Produces a current-source rebind check before execution result retrieval/finalization/publication.

- [ ] **Step 1: Write failing job/freshness tests**

```ts
it("falls back without publication when an equal-text Issue is relinked after an execution request", async () => {
  const result = await finalizeAfterRelink(job, "issue-1", "issue-2");
  expect(result).toMatchObject({ disposition: "stale_source", publicationSuppressed: true });
});

it("clears v2 binding and every continuation field when desired revision advances", () => {
  expect(successorJob).toMatchObject({ verificationContractVersion: null, verificationBindingDigest: null, providerResponseId: null });
});
```

- [ ] **Step 2: Run job/worker/webhook tests and confirm RED**

Run: `pnpm vitest run src/lib/analysis-jobs.test.ts src/lib/analysis-worker.test.ts src/app/api/github/webhook/route.test.ts`

Expected: contract binding does not exist and stale execution result could be resumed.

- [ ] **Step 3: Implement migration, paired CAS updates, and source fence**

```sql
alter table public.agentproof_analysis_jobs
  add column if not exists verification_contract_version text,
  add column if not exists verification_binding_digest text;
```

Use an exact pair constraint and successor-revision trigger that clears the pair with all provider/execution continuation fields. Rebuild selected source identity/content + contract + base/head before retrieving a result and before finalizing; mismatch suppresses publication and never re-executes/re-submits.

- [ ] **Step 4: Run job/worker/webhook tests and confirm GREEN**

Run: `pnpm vitest run src/lib/analysis-jobs.test.ts src/lib/analysis-worker.test.ts src/app/api/github/webhook/route.test.ts`

Expected: same-head edits/relinks, partial pairs, successor rows, and malformed intents fail closed with no second POST.

### Task 7: Render the two evidence layers and add fixtures/evaluation gates

**Files:**
- Modify: `src/lib/github-dashboard-view-model.ts`
- Modify: `src/lib/markdown.ts`
- Modify: `src/lib/github-app-side-effects.ts`
- Modify: dashboard requirement components/routes that consume these models
- Test: `src/lib/github-dashboard-view-model.test.ts`
- Test: `src/lib/markdown.test.ts`
- Test: relevant GitHub comment/Slack tests
- Create: `eval/fixture-prs/verification-contract-v2/`

**Interfaces:**
- Renders `Requirement outcome`, `Contract`, `Observed evidence`, and `Still unverified` separately.
- Emits no raw contract/private/executor fields to public/Slack/comment channels.

- [ ] **Step 1: Write failing rendering/fixture tests**

```ts
it("labels PR #24 evidence as observed while outcome is unclear", () => {
  expect(toRequirementViewModel(pr24V2).outcomeLabel).toBe("Unclear");
  expect(toRequirementViewModel(pr24V2).observedEvidence).toContain("Implementation found");
});

it("does not expose a contract literal or binding digest in Markdown/Slack/comment copy", () => {
  expect(renderMarkdown(v2Report)).not.toContain(secretContractLiteral);
});
```

- [ ] **Step 2: Run rendering tests and confirm RED**

Run: `pnpm vitest run src/lib/github-dashboard-view-model.test.ts src/lib/markdown.test.ts`

Expected: v2 contract state is not rendered separately.

- [ ] **Step 3: Implement neutral two-layer copy and fixtures**

Render `Supported against approved contract` only for v2 `met`; show PR-description author-claim confirmation separately. Add frozen fixtures for PR #24, pure scalar positive/negative cases, absence completeness, malformed contracts, legacy reports, relink races, privacy leakage, and unsupported v2.1 criterion types.

- [ ] **Step 4: Run rendering/fixture tests and confirm GREEN**

Run: `pnpm vitest run src/lib/github-dashboard-view-model.test.ts src/lib/markdown.test.ts`

Expected: public surfaces display neutral outcomes and never leak private contract data.

### Task 8: Full verification and release handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-verification-contract-v2-design.md` only if a verified implementation constraint changes the approved design.
- Create: `docs/superpowers/reports/2026-08-13-verification-contract-v2-implementation.md`

- [ ] **Step 1: Run focused contract, verifier, validator, storage, job, and renderer suites**

Run: `pnpm vitest run src/lib/verification-contract-v2.test.ts src/lib/verification-execution-v2.test.ts src/lib/verifier.test.ts src/lib/report-validation.test.ts src/lib/report-authenticity.test.ts src/lib/report-share.test.ts src/lib/server-report-store.test.ts src/lib/analysis-jobs.test.ts src/lib/analysis-worker.test.ts`

Expected: all focused suites pass.

- [ ] **Step 2: Run full quality gates**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && git diff --check`

Expected: all commands exit 0. If a failure is outside the scoped diff, document it with exact evidence and do not claim a clean release gate.

- [ ] **Step 3: Write the implementation evidence report**

Record exact command outputs, fixture outcomes, unverified infrastructure (executor/Supabase/production), privacy checks, migration status, and no-provider/no-second-POST evidence.

- [ ] **Step 4: Request independent review before commit/deployment**

Provide the final scoped diff, test evidence, and report to a reviewer. Do not stage, commit, push, migrate, deploy, or enable the v2 flag until review is GO and the user authorizes those external changes.

## Plan self-review

- **Spec coverage:** Tasks 1–3 cover source authority, contract parsing, aggregation, and PR #24; Task 4 covers the isolated execution boundary; Task 5 covers v1/v2/schema/sign/share privacy; Task 6 covers job freshness; Task 7 covers human output; Task 8 covers evaluation and rollout gates.
- **No-placeholder check:** all tasks name concrete files, interfaces, RED/GREEN commands, and closed behavior. External executor deployment remains explicitly outside this repository implementation and fails closed until separately provisioned.
- **Type consistency:** `VerificationContractV2`, `VerificationCriterionEvaluationV2`, `VerificationReportV2`, `verificationBindingDigest`, `criterionAxisId`, and `VerificationExecutionRequestV2` are defined before their consumers.
