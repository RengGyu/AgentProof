# General PR Automatic Assessment Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically run bounded semantic target discovery for eligible ordinary public PRs, report exact pipeline failure reasons, and distinguish partial from genuinely mixed evidence without changing strict contract outcomes.

**Architecture:** A single server rollout phase resolves into independent semantic-execution and result-projection policies. Existing deterministic parsing runs first; the existing structured semantic observer supplies ID-only candidate proposals when eligible; deterministic validation retains authority, freshness, and conclusion control. Public reports retain only a target-free assessment summary and closed reason codes.

**Tech Stack:** TypeScript, Next.js 15, Vitest, existing GitHub collector, existing OpenAI Responses structured-output adapter, existing report validators and projection allowlists.

**Spec:** `docs/superpowers/specs/2026-09-01-general-pr-automatic-assessment-routing-design.md`

## Global Constraints

- Add no user-facing analysis mode or request flag.
- Ordinary PR prose and semantic output remain author-claim or hypothesis only.
- Do not change Verification Contract V2 authority, strict `status`, or strict outcome aggregation.
- Do not create a new positive `evidence_supported`, `contradicted`, or `not_demonstrated` path in this package.
- Generic CI, changed tests, file-name similarity, and model relations cannot become target-local proof.
- Preserve public-source freshness checks before and after every semantic provider call.
- Keep raw source, spans, bindings, model input/output, tokens, patches, logs, and workflow identity out of public and tenant projections.
- Unknown configuration values and unknown schema fields fail closed.
- Follow RED -> GREEN for every task and commit only after the task's focused tests pass.

---

### Task 1: Separate runtime execution from projection policy

**Files:**
- Create: `src/lib/general-pr-runtime-policy.ts`
- Create: `src/lib/general-pr-runtime-policy.test.ts`
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`

**Interfaces:**
- Produces: `resolveGeneralPrAssessmentRuntimePolicyV1(value: string | undefined): GeneralPrAssessmentRuntimePolicyV1`.
- Consumed by: route and worker changes in Task 2.

- [ ] **Step 1: Write the runtime-policy RED test**

```ts
import { describe, expect, it } from "vitest";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";

describe("resolveGeneralPrAssessmentRuntimePolicyV1", () => {
  it.each([
    [undefined, "disabled", "disabled", "hidden"],
    ["unknown", "disabled", "disabled", "hidden"],
    ["disabled", "disabled", "disabled", "hidden"],
    ["shadow", "shadow", "eligible_public_pr", "hidden"],
    ["advisory", "advisory", "eligible_public_pr", "advisory"]
  ])("maps %s without exposing a user choice", (value, releasePhase, semanticObservation, assessmentProjection) => {
    expect(resolveGeneralPrAssessmentRuntimePolicyV1(value)).toEqual({
      version: 1,
      releasePhase,
      semanticObservation,
      assessmentProjection
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest run src/lib/general-pr-runtime-policy.test.ts
```

Expected: FAIL because `general-pr-runtime-policy.ts` does not exist.

- [ ] **Step 3: Implement the closed policy resolver**

```ts
export interface GeneralPrAssessmentRuntimePolicyV1 {
  version: 1;
  releasePhase: "disabled" | "shadow" | "advisory";
  semanticObservation: "disabled" | "eligible_public_pr";
  assessmentProjection: "hidden" | "advisory";
}

export function resolveGeneralPrAssessmentRuntimePolicyV1(
  value: string | undefined
): GeneralPrAssessmentRuntimePolicyV1 {
  if (value === "shadow") {
    return { version: 1, releasePhase: "shadow", semanticObservation: "eligible_public_pr", assessmentProjection: "hidden" };
  }
  if (value === "advisory") {
    return { version: 1, releasePhase: "advisory", semanticObservation: "eligible_public_pr", assessmentProjection: "advisory" };
  }
  return { version: 1, releasePhase: "disabled", semanticObservation: "disabled", assessmentProjection: "hidden" };
}
```

- [ ] **Step 4: Make the observation service consume independent decisions**

Replace the service option `mode` with `policy`, pass `policy.releasePhase` to telemetry-compatible bundle state, call the semantic observer when `policy.semanticObservation === "eligible_public_pr"`, and attach the summary only when `policy.assessmentProjection === "advisory"`.

Add a regression where the provider is called once in advisory mode while strict requirement statuses remain byte-equivalent.

- [ ] **Step 5: Run focused policy and service tests**

```bash
pnpm vitest run src/lib/general-pr-runtime-policy.test.ts src/lib/general-pr-observation-service.test.ts
```

Expected: PASS; advisory invokes a supplied provider and shadow still returns the original report object.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/general-pr-runtime-policy.ts src/lib/general-pr-runtime-policy.test.ts src/lib/general-pr-observation-service.ts src/lib/general-pr-observation-service.test.ts
git commit -m "refactor: separate general PR runtime policies"
```

---

### Task 2: Apply automatic semantic eligibility in both API and worker

**Files:**
- Modify: `src/app/api/analyze/route.ts`
- Modify: `src/app/api/analyze/route.test.ts`
- Modify: `src/lib/analysis-worker.ts`
- Modify: `src/lib/analysis-worker.test.ts`
- Test: `src/lib/general-pr-observation-worker.test.ts`

**Interfaces:**
- Consumes: `resolveGeneralPrAssessmentRuntimePolicyV1()` from Task 1.
- Produces: route/worker parity for public semantic observation in `shadow` and `advisory`.

- [ ] **Step 1: Write route RED tests for automatic advisory semantics**

Stub `submitGeneralPrSemanticObservationWithOpenAI` and a current public GitHub input. Assert:

```ts
expect(observationSpy).toHaveBeenCalledWith(expect.objectContaining({
  policy: expect.objectContaining({
    semanticObservation: "eligible_public_pr",
    assessmentProjection: "advisory"
  }),
  semantic: expect.objectContaining({ providerAvailable: true, privateRepository: false })
}));
expect(json.report.generalPrAssessmentSummary).toBeDefined();
expect(json.observation).toBeUndefined();
```

Also assert that the request body contains no new user mode field and an attempted unknown field cannot enable semantics.

- [ ] **Step 2: Write worker RED tests for the same policy**

Set `AGENTPROOF_GENERAL_PR_OBSERVATION_MODE=advisory`, provide public GitHub provenance and configured provider values, then assert the worker calls the observation service with identical semantic eligibility and never serializes the private bundle into the job or report.

- [ ] **Step 3: Run route and worker tests to verify RED**

```bash
pnpm vitest run src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts src/lib/general-pr-observation-worker.test.ts
```

Expected: FAIL because route and worker currently gate the provider with `releasePhase === "shadow"`.

- [ ] **Step 4: Replace the shadow-only provider condition**

In both route and worker, derive one server policy and build the provider only when:

```ts
const semanticEligible = policy.semanticObservation === "eligible_public_pr" &&
  input.repositoryPrivate === false &&
  input.sourceProvenance?.origin === "github_snapshot" &&
  Boolean(publicPrUrl && observerApiKey && observerModel);
```

Keep the existing pre/post `buildGitHubPullRequestInput` freshness read, exact expected head/base SHAs, `store: false`, redaction, and pinned model profile.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
pnpm vitest run src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts src/lib/general-pr-observation-worker.test.ts src/lib/general-pr-semantic-observer.test.ts
```

Expected: PASS for shadow/advisory parity, public eligibility, private fail-closed behavior, timeout, invalid output, and stale source.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/app/api/analyze/route.ts src/app/api/analyze/route.test.ts src/lib/analysis-worker.ts src/lib/analysis-worker.test.ts src/lib/general-pr-observation-worker.test.ts
git commit -m "fix: run bounded semantics for advisory PR assessment"
```

---

### Task 3: Make target-admission failures diagnosable

**Files:**
- Modify: `src/lib/general-pr-observation-source.ts`
- Modify: `src/lib/general-pr-observation-source.test.ts`
- Modify: `src/lib/general-pr-semantic-proposal.ts`
- Modify: `src/lib/general-pr-semantic-proposal.test.ts`
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`
- Modify: `src/lib/general-pr-observation-telemetry.ts`
- Modify: `src/lib/general-pr-observation-telemetry.test.ts`
- Modify: `src/lib/general-pr-assessment.ts`
- Modify: `src/lib/general-pr-assessment.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Produces: private `GeneralPrAssessmentDiagnosticsV1` on the observation bundle.
- Produces: closed summary reason codes without private IDs or source text.

- [ ] **Step 1: Add RED fixtures for each failure layer**

Create focused cases that assert these distinct outputs:

```ts
expect(diagnostics).toMatchObject({ sourceCollection: "available", deterministicAdmission: "no_candidate", semanticAdmission: "unavailable" });
expect(diagnostics).toMatchObject({ semanticAdmission: "invalid" });
expect(diagnostics).toMatchObject({ semanticAdmission: "stale" });
expect(diagnostics).toMatchObject({ semanticAdmission: "admitted", relationState: "hypothesis_only" });
```

For sources plus zero targets, assert `sourceState` reflects the source:

```ts
expect(assessment).toMatchObject({
  sourceState: "pr_author_claim",
  overallConclusion: "no_assessable_claims",
  reasonCodes: expect.arrayContaining(["deterministic_candidate_missing", "semantic_observer_unavailable"])
});
```

Add a linked-Issue fallback case: when the linked Issue yields no objective candidate but the PR body yields one, the admitted target must be `pr_author_claim`, retain `author_claim_requires_confirmation`, and never inherit linked-Issue authority. When the linked Issue yields an objective, it remains primary and the same PR-body candidate is not admitted as a competing behavioral target.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-observation-source.test.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.test.ts src/lib/general-pr-assessment.test.ts
```

Expected: FAIL because current zero-target behavior always emits `ambiguous` plus `unsupported_claim_type`.

- [ ] **Step 3: Add the diagnostics type and closed reason codes**

Add `GeneralPrAssessmentDiagnosticsV1` exactly as defined in the spec. Extend `GeneralPrAssessmentReasonV1` with the nine closed reason codes from the spec. Keep diagnostics on `GeneralPrObservationBundleV2`; do not add it to `VerificationReportV2`.

Add `admissionTier: "primary" | "fallback" | "context"` to private source units. A linked Issue is `primary`; PR title/body are `fallback` when a linked Issue exists and `primary` otherwise. This field controls candidate selection only and never changes `authority`.

- [ ] **Step 4: Compute diagnostics from actual pipeline states**

Count source units, eligible spans, deterministic candidates, semantic candidates, and admitted targets. Map the semantic observer state explicitly. Derive `relationState` from relation levels and collection completeness. Never infer the reason from target count alone.

Allow the semantic proposal validator to classify objective candidates from a `fallback` PR-author source, but make the finalizer admit fallback targets only when no primary linked-Issue target was admitted. Assert that source ordering, same-source grouping, seed ownership, and authority validation remain unchanged.

- [ ] **Step 5: Derive source state from source units**

Update `sourceStateFor()` so a source with zero targets remains `linked_issue` or `pr_author_claim`. Use `ambiguous` only for seed mismatch, conflicting source ownership, or stale source. Keep `no_assessable_claims` when target count is zero.

- [ ] **Step 6: Run focused diagnostics tests**

```bash
pnpm vitest run src/lib/general-pr-observation-source.test.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.test.ts src/lib/general-pr-assessment.test.ts
```

Expected: PASS with no raw source, ID, path, or provider output in serialized telemetry.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/lib/general-pr-observation-source.ts src/lib/general-pr-observation-source.test.ts src/lib/general-pr-semantic-proposal.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-observation-service.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.ts src/lib/general-pr-observation-telemetry.test.ts src/lib/general-pr-assessment.ts src/lib/general-pr-assessment.test.ts src/lib/types.ts
git commit -m "feat: expose bounded PR assessment diagnostics"
```

---

### Task 4: Distinguish partial evidence from mixed evidence

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/general-pr-assessment.ts`
- Modify: `src/lib/general-pr-assessment.test.ts`
- Modify: `src/lib/general-pr-assessment-presentation.ts`
- Modify: `src/lib/general-pr-assessment-presentation.test.ts`
- Modify: `src/lib/report-validation.ts`
- Modify: `src/lib/report-validation.test.ts`

**Interfaces:**
- Produces: report-level conclusion `evidence_partial`.
- Preserves: target-level `GeneralPrTargetConclusionV1` and strict requirement statuses.

- [ ] **Step 1: Write RED aggregation tests**

```ts
expect(assessmentWithTargets(["evidence_partial"]).overallConclusion).toBe("evidence_partial");
expect(assessmentWithTargets(["evidence_partial", "evidence_partial"]).overallConclusion).toBe("evidence_partial");
expect(assessmentWithTargets(["evidence_supported", "evidence_partial"]).overallConclusion).toBe("mixed_evidence");
```

Add copy assertion:

```ts
expect(presentGeneralPrAssessmentSummary(summary).conclusionLabel).toBe("Evidence partially supports the stated change");
```

- [ ] **Step 2: Run aggregation tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-assessment.test.ts src/lib/general-pr-assessment-presentation.test.ts src/lib/report-validation.test.ts
```

Expected: FAIL because all non-terminal target sets currently aggregate to `mixed_evidence`.

- [ ] **Step 3: Add the enum value and exact aggregation order**

Add `evidence_partial` to `GeneralPrAssessmentV1["overallConclusion"]`, validator allowlists, and expected-conclusion recomputation. Apply the six-step ordering from the spec. Do not add any new producer of target-level `evidence_supported`.

- [ ] **Step 4: Add neutral presentation copy**

Render `evidence_partial` as evidence about the stated change, not as requirement satisfaction, correctness, or readiness.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
pnpm vitest run src/lib/general-pr-assessment.test.ts src/lib/general-pr-assessment-presentation.test.ts src/lib/report-validation.test.ts
```

Expected: PASS; forged summary counts or conclusions remain invalid.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/lib/types.ts src/lib/general-pr-assessment.ts src/lib/general-pr-assessment.test.ts src/lib/general-pr-assessment-presentation.ts src/lib/general-pr-assessment-presentation.test.ts src/lib/report-validation.ts src/lib/report-validation.test.ts
git commit -m "fix: distinguish partial PR evidence from mixed evidence"
```

---

### Task 5: Close every projection and persistence boundary

**Files:**
- Modify: `src/lib/report-share.ts`
- Modify: `src/lib/report-share.test.ts`
- Modify: `src/lib/tenant-report-validation.ts`
- Modify: `src/lib/server-report-store.ts`
- Modify: `src/lib/server-report-store.test.ts`
- Modify: `src/lib/markdown.ts`
- Modify: `src/lib/markdown.test.ts`
- Modify: `src/lib/slack.ts`
- Modify: `src/lib/slack.test.ts`
- Modify: `src/lib/dashboard-report-export.ts`
- Modify: `src/lib/dashboard-report-export.test.ts`
- Modify: `src/components/ReportView.tsx`

**Interfaces:**
- Consumes: new conclusion and reason codes from Tasks 3–4.
- Produces: identical bounded summary semantics across API, share, tenant, Markdown, Slack, dashboard, and UI.

- [ ] **Step 1: Write projection RED tests**

For every surface, use a summary containing `overallConclusion: "evidence_partial"` and the new closed reason codes. Assert the safe fields survive and these strings never appear:

```ts
for (const forbidden of ["sourceSpanRefs", "sourceBindingRef", "ledgerDigest", "semantic output", "workflowIdentity", "github_pat_"]) {
  expect(serialized).not.toContain(forbidden);
}
```

Inject `diagnostics`, `targets`, and an unknown reason code into untrusted share/tenant payloads and assert validation rejection.

- [ ] **Step 2: Run boundary tests and verify RED**

```bash
pnpm vitest run src/lib/report-share.test.ts src/lib/server-report-store.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts src/lib/dashboard-report-export.test.ts
```

Expected: FAIL until all allowlists and renderers know the new bounded values.

- [ ] **Step 3: Update allowlists and renderers**

Copy only `version`, `mode`, `sourceState`, `overallConclusion`, `counts`, and closed `reasonCodes`. Do not project diagnostics or target records. Use the same presentation function for human-readable copy where an existing shared helper is already used.

- [ ] **Step 4: Run projection and runtime validation tests**

```bash
pnpm vitest run src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts src/lib/server-report-store.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts src/lib/dashboard-report-export.test.ts src/lib/report-runtime-validation.test.ts
```

Expected: PASS; legacy reports without the field remain valid.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/lib/report-share.ts src/lib/report-share.test.ts src/lib/tenant-report-validation.ts src/lib/server-report-store.ts src/lib/server-report-store.test.ts src/lib/markdown.ts src/lib/markdown.test.ts src/lib/slack.ts src/lib/slack.test.ts src/lib/dashboard-report-export.ts src/lib/dashboard-report-export.test.ts src/components/ReportView.tsx
git commit -m "feat: project partial PR assessment safely"
```

---

### Task 6: Upgrade the production-shaped 25-PR evaluation

**Files:**
- Modify: `scripts/smoke-analyze-pr-url.mjs`
- Modify: `scripts/smoke-analyze-pr-url.test.mjs`
- Modify: `scripts/external-pr-current-corpus-smoke.mjs`
- Modify: `scripts/external-pr-current-corpus-smoke.test.mjs`
- Modify: `docs/external-pr-current-corpus.md`

**Interfaces:**
- Consumes: validated, target-free assessment summaries.
- Produces: summary-only distributions for source, conclusion, reason-code, and bounded evidence-count states.

- [ ] **Step 1: Write runner RED tests**

Require every completed case to contain a valid assessment summary. Aggregate at least:

```js
{
  presentCount: 25,
  sourceStateCounts: {},
  overallConclusionCounts: {},
  reasonCodeCounts: {},
  assessmentCountTotals: {
    evidence_supported: 0,
    evidence_partial: 0,
    not_demonstrated: 0,
    contradicted: 0,
    blocked: 0,
    not_assessable: 0
  }
}
```

Assert that targets, source text, paths, provider output, and tokens are absent from the saved run artifact.

- [ ] **Step 2: Run smoke-runner tests and verify RED**

```bash
pnpm vitest run scripts/smoke-analyze-pr-url.test.mjs scripts/external-pr-current-corpus-smoke.test.mjs
```

Expected: FAIL because the current runner reports only source and conclusion aggregates.

- [ ] **Step 3: Implement bounded aggregation**

Use only closed values from the validated assessment summary. Mark a case `analysis_unavailable` when the required assessment is missing or invalid. Do not persist target records or private diagnostics. Semantic-state and admission-basis metrics are measured by the instrumented calibration/holdout runner in Task 8, not inferred from a public smoke response.

- [ ] **Step 4: Run focused smoke tests**

```bash
pnpm vitest run scripts/smoke-analyze-pr-url.test.mjs scripts/external-pr-current-corpus-smoke.test.mjs
```

Expected: PASS with no private field in the JSON artifact.

- [ ] **Step 5: Commit Task 6**

```bash
git add scripts/smoke-analyze-pr-url.mjs scripts/smoke-analyze-pr-url.test.mjs scripts/external-pr-current-corpus-smoke.mjs scripts/external-pr-current-corpus-smoke.test.mjs docs/external-pr-current-corpus.md
git commit -m "test: measure automatic PR assessment routing"
```

---

### Task 7: Run full engineering and release checks

**Files:**
- Modify only if a deterministic regression is found within this specification's scope.
- Do not change calibration or holdout expected labels after viewing implementation output.

**Interfaces:**
- Consumes: completed Tasks 1–6.
- Produces: exact candidate evidence for review and preview deployment.

- [ ] **Step 1: Run focused general-PR suites**

```bash
pnpm vitest run src/lib/general-pr-runtime-policy.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-assessment.test.ts src/lib/general-pr-observation-telemetry.test.ts src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run privacy and projection suites**

```bash
pnpm vitest run src/lib/report-validation.test.ts src/lib/report-runtime-validation.test.ts src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts src/lib/server-report-store.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts src/lib/dashboard-report-export.test.ts
```

Expected: PASS with unknown-field rejection and no private leakage.

- [ ] **Step 3: Run complete local gates**

```bash
pnpm test
```

```bash
pnpm typecheck
```

```bash
pnpm lint
```

```bash
pnpm build
```

```bash
git diff --check
```

Expected: every command exits 0. Passing establishes only the covered implementation and privacy boundaries.

- [ ] **Step 4: Perform exact-candidate review**

Review the final diff for these stop conditions:

- user-controlled mode added;
- advisory semantics bypass public/fresh-source checks;
- semantic proposal changes authority or strict status;
- new target-level positive conclusion path;
- diagnostics or private IDs reach a projection;
- current 25 PR URLs or outputs are encoded as classifier rules.

Expected: none present.

- [ ] **Step 5: Stop or return to the owning task on failure**

Do not patch a full-gate failure inside Task 7. Identify the first responsible task, add a focused RED regression there, implement the smallest in-scope correction, rerun that task's focused gate, and then restart Task 7 from Step 1.

---

### Task 8: Preview deploy, shadow evaluation, and advisory decision

**Files:**
- Generated outputs only under `eval/generated/`; never commit them.
- No production merge or default enablement is authorized by this task.

**Interfaces:**
- Consumes: exact candidate commit and existing deployment integration.
- Produces: preview smoke evidence and an explicit `GO_ADVISORY` or `NO_GO_ADVISORY` decision.

- [ ] **Step 1: Push the reviewed branch and wait for exact-head CI**

Verify the GitHub check is bound to the candidate SHA and concludes success. Do not treat an older successful run as candidate evidence.

- [ ] **Step 2: Run instrumented semantic calibration and untouched holdout evaluation**

Invoke `runGeneralPrObservationNowV2` through the controlled release-evaluation runner and aggregate only `bundle.diagnostics`. Record semantic states, deterministic/semantic candidate counts, admission precision/recall, and hard-safety counters. Do not persist source text, span IDs, target IDs, provider output, or repository identity.

- [ ] **Step 3: Score calibration and untouched holdout labels**

Require zero hard-safety failures and the existing lower-95% precision/recall thresholds. If thresholds fail, keep projection hidden and return `NO_GO_ADVISORY`.

- [ ] **Step 4: Deploy preview first in `shadow`, then in `advisory` only after Step 3 passes**

In `shadow`, run one controlled public PR and assert the returned report contains no ordinary-assessment field while the exact-candidate route integration test establishes provider invocation. Then switch the same preview to `advisory`.

Refresh all 25 source anchors immediately before analysis, execute the corpus, and require 25/25 completed summaries with zero privacy or quality-gate failures.

- [ ] **Step 5: Report distributions without claiming correctness**

Report:

- source-state distribution;
- reason-code distribution for deterministic/semantic admission failures;
- partial, mixed, blocked, and no-assessable distribution;
- relation-state distribution;
- strict outcome distribution separately; and
- quality/privacy failures.

- [ ] **Step 6: Decide rollout**

Return `GO_ADVISORY` only when hard safety and admission thresholds pass. Keep default ordinary-PR view disabled until three independent reviewer sessions reach at least 70% useful or partially useful and false blockers remain below 20%.

Do not merge, enable production default, or delete rollback settings without separate user authorization.
