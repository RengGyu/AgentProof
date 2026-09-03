# General PR Bounded Evidence Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a validated, privacy-safe ordinary-PR evidence assessment to V2 reports without altering strict Verification Contract outcomes.

**Architecture:** A pure deterministic derivation consumes the existing General PR observation seed and bundle, producing only closed assessment states. The assessment is attached only after the strict V2 report is generated, then it crosses the existing full, summary, and tenant validation boundaries through explicit projections. UI and export surfaces render the bounded companion section without changing strict requirement status.

**Tech Stack:** TypeScript, Next.js, Vitest, existing V2 report/runtime validators.

**Spec:** `docs/superpowers/specs/2026-08-31-general-pr-bounded-evidence-assessment-design.md`

**Implementation status (2026-08-31):** Tasks 1–4 and the verification part
of Task 5 are implemented locally and remain uncommitted. The implemented V1
is deliberately safer than the initial full-record sketch: the shared
observation service emits only `generalPrAssessmentSummary`, never target
records. `analysis-worker.ts` requires no dedicated branch because it already
uses that shared service result as its deterministic report; the existing
worker regression suite covers the integration path. Commit, push, deployment,
external-PR replay, and reviewer-usefulness gates remain outside this task.

## Global Constraints

- Leave `requirements[].status`, `requirements[].evidenceStatus`, V2 contract authority, and capability policy unchanged.
- Never infer a passed test, behavioral correctness, or target contradiction from generic CI, a changed test file, or model output.
- Attach no raw PR/Issue text, patches, logs, prompts, model output, workflow identities, source-span IDs, or binding digests to public or tenant projections.
- Use only closed assessment enums and reason codes; unknown keys are rejected at every report boundary.
- Keep the assessment optional so pre-existing stored and shared reports remain readable.

---

### Task 1: Closed assessment model and deterministic derivation

**Files:**
- Create: `src/lib/general-pr-assessment.ts`
- Create: `src/lib/general-pr-assessment.test.ts`
- Modify: `src/lib/types.ts`

**Interfaces:**
- Consumes: `GeneralPrObservationSeedV2`, `GeneralPrObservationBundleV2`, and `VerificationReport`.
- Produces: `GeneralPrAssessmentV1` and `deriveGeneralPrAssessmentV1(seed, bundle, report)`.

- [ ] **Step 1: Write failing derivation tests**

```ts
expect(deriveGeneralPrAssessmentV1({ seed, bundle, report }).targets[0]).toMatchObject({
  conclusion: "evidence_partial",
  reasonCodes: expect.arrayContaining(["verified_relation_missing"])
});
expect(deriveGeneralPrAssessmentV1({ seed: incompleteSeed, bundle, report }).overallConclusion)
  .toBe("collection_blocked");
```

- [ ] **Step 2: Run the focused test to verify the missing module fails**

Run: `pnpm exec vitest run src/lib/general-pr-assessment.test.ts`

Expected: FAIL because `general-pr-assessment` has not been implemented.

- [ ] **Step 3: Define the additive V2 types and minimal derivation**

```ts
export function deriveGeneralPrAssessmentV1({ seed, bundle, report }: GeneralPrAssessmentInputV1): GeneralPrAssessmentV1 {
  // Targets originate only from bundle objectives and exact seed spans.
  // Hypothesis or unexecuted test observations are capped at evidence_partial.
  // Incomplete/head-unbound collection yields blocked, never not_demonstrated.
}
```

- [ ] **Step 4: Run the focused test to verify the derivation passes**

Run: `pnpm exec vitest run src/lib/general-pr-assessment.test.ts`

Expected: PASS.

### Task 2: Attach the companion assessment on both report paths

**Files:**
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-worker.ts`
- Modify: `src/app/api/analyze/route.ts`
- Modify: `src/lib/analysis-worker.ts`
- Test: `src/lib/general-pr-observation-service.test.ts`
- Test: `src/lib/general-pr-observation-worker.test.ts`
- Test: `src/app/api/analyze/route.test.ts`

**Interfaces:**
- Consumes: `deriveGeneralPrAssessmentV1` from Task 1.
- Produces: V2 reports with optional `generalPrAssessment`; raw observation bundles stay private.

- [ ] **Step 1: Write failing parity and strict-compatibility tests**

```ts
expect(result.report.requirements.map(({ status }) => status)).toEqual(beforeStatuses);
expect(result.report.generalPrAssessment?.overallConclusion).toBe("mixed_evidence");
expect(JSON.stringify(routeBody)).not.toContain("sourceSpanIds");
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm exec vitest run src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-worker.test.ts src/app/api/analyze/route.test.ts`

Expected: FAIL because the assessment is not attached.

- [ ] **Step 3: Attach only validator-ready assessment records after deterministic report generation**

```ts
const baseReport = generateReport(input);
const bundle = finalizeDeterministicGeneralPrObservationsV2(seed, proposal, semanticState);
const report = attachGeneralPrAssessmentV1(baseReport, seed, bundle);
```

- [ ] **Step 4: Run the focused parity tests to verify they pass**

Run: `pnpm exec vitest run src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-worker.test.ts src/app/api/analyze/route.test.ts`

Expected: PASS.

### Task 3: Validate full reports and bounded projections

**Files:**
- Modify: `src/lib/report-validation.ts`
- Modify: `src/lib/report-share.ts`
- Modify: `src/lib/tenant-report-validation.ts`
- Test: `src/lib/report-validation.test.ts`
- Test: `src/lib/report-share.test.ts`
- Test: `src/lib/tenant-report-validation.test.ts`

**Interfaces:**
- Consumes: optional `generalPrAssessment` from Task 2.
- Produces: full target validation plus public and tenant `GeneralPrAssessmentSummaryV1` projections.

- [ ] **Step 1: Write failing boundary tests**

```ts
expect(validateVerificationReport({ ...report, generalPrAssessment: { ...assessment, unexpected: true } })).toMatchObject({ valid: false });
expect(JSON.stringify(sanitizeReportForShare(report))).not.toContain("sourceBindingRef");
expect(JSON.stringify(projectTenantPersistedReport(report, secret))).not.toContain("sourceSpanRefs");
```

- [ ] **Step 2: Run the focused boundary tests to verify they fail**

Run: `pnpm exec vitest run src/lib/report-validation.test.ts src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts`

Expected: FAIL because the new assessment keys and projections are absent.

- [ ] **Step 3: Add strict enum, aggregation, closure, and privacy validation**

```ts
validateGeneralPrAssessment(report.generalPrAssessment, report.evidenceIndex, report.source.provenance, mode, errors);
// Summary and tenant modes admit only { version, mode, sourceState, overallConclusion, counts, reasonCodes }.
```

- [ ] **Step 4: Run the focused boundary tests to verify they pass**

Run: `pnpm exec vitest run src/lib/report-validation.test.ts src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts`

Expected: PASS.

### Task 4: Render bounded reviewer-facing evidence assessment

**Files:**
- Create: `src/lib/general-pr-assessment-presentation.ts`
- Create: `src/lib/general-pr-assessment-presentation.test.ts`
- Modify: `src/lib/markdown.ts`
- Modify: `src/lib/slack.ts`
- Modify: `src/components/ReportView.tsx`
- Test: `src/lib/markdown.test.ts`
- Test: `src/lib/slack.test.ts`

**Interfaces:**
- Consumes: validated full or summary `generalPrAssessment`.
- Produces: closed labels and action copy; never maps ordinary evidence to strict `met` or merge readiness.

- [ ] **Step 1: Write failing presentation tests**

```ts
expect(presentGeneralPrAssessment(summary).heading).toBe("Evidence assessment");
expect(reportToMarkdown(report)).toContain("Evidence supports the stated objective");
expect(reportToSlackPayload(report).blocks).not.toContain("sourceBindingRef");
```

- [ ] **Step 2: Run the focused renderer tests to verify they fail**

Run: `pnpm exec vitest run src/lib/general-pr-assessment-presentation.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts`

Expected: FAIL because the bounded assessment is not rendered.

- [ ] **Step 3: Render closed presentation values and a single missing-contract notice**

```ts
export function presentGeneralPrAssessment(assessment: GeneralPrAssessmentSummaryV1): GeneralPrAssessmentPresentationV1 {
  return { heading: "Evidence assessment", conclusionLabel: CONCLUSION_LABELS[assessment.overallConclusion], reasonLabels: assessment.reasonCodes.map(reasonCodeLabel) };
}
```

- [ ] **Step 4: Run the focused renderer tests to verify they pass**

Run: `pnpm exec vitest run src/lib/general-pr-assessment-presentation.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts`

Expected: PASS.

### Task 5: Integrate, verify regression boundaries, and inspect the diff

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-general-pr-bounded-evidence-assessment-design.md`
- Test: all focused tests from Tasks 1–4.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a test-backed V2 companion assessment with no raw-bundle response surface.

- [ ] **Step 1: Add a release-note section recording implemented V1 boundaries**

```md
## Implementation record

- [x] Strict V2 outcomes remain unchanged.
- [x] Ordinary PR evidence is rendered as a bounded companion assessment.
- [x] Public and tenant projections omit target bindings and raw observation data.
```

- [ ] **Step 2: Run focused regression suites**

Run: `pnpm exec vitest run src/lib/general-pr-assessment.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-worker.test.ts src/app/api/analyze/route.test.ts src/lib/report-validation.test.ts src/lib/report-share.test.ts src/lib/tenant-report-validation.test.ts src/lib/general-pr-assessment-presentation.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts`

Expected: PASS.

- [ ] **Step 3: Run repository verification commands**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && git diff --check`

Expected: every command exits 0.

- [ ] **Step 4: Review the exact diff and leave the branch uncommitted**

Run: `git diff --check && git status --short && git diff --stat`

Expected: only plan/spec and implementation files from this scope are modified; no commit, push, or deployment occurs.
