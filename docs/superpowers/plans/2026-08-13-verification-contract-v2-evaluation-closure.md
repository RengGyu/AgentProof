# Verification Contract v2 Evaluation Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use \`superpowers:executing-plans\` to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Enable contract-specific deterministic outcomes without weakening the no-contract \`unclear\` fallback, beginning with static artifact and changed-file criteria and a safe attested-observation seam for return values.

**Architecture:** A server-owned evaluator consumes a parsed v2 contract and bounded deterministic evidence. It computes static criteria locally and treats behavioral return-value execution as unavailable unless a valid signed observation arrives from the separately deployed executor. The verifier aggregates server-computed criterion results only; the validator checks every criterion-to-axis/evidence reference again.

**Tech Stack:** Next.js, TypeScript, Vitest, Node \`crypto\`, GitHub REST collection, AgentProof report validation.

## Global Constraints

- Preserve v1 reports and never reinterpret a v1 report as v2.
- \`absent\` and \`invalid\` contracts always produce outcome \`unclear\`.
- Only every satisfied criterion in an authoritative contract may produce \`met\`.
- PR-description contracts cap outcome at \`partial\`.
- Generic CI, LLM output, and caller-authored report state never satisfy a criterion.
- The web process never executes repository code.
- Public output never contains raw source, contract locators, expected/actual values, binding digests, executor logs, tokens, or provider IDs.
- An uncertain execution submission never causes a second request.

---

### Task 1: Add a pure criterion evaluator for static contract types

**Files:**

- Create: \`src/lib/verification-criterion-evaluator-v2.ts\`
- Create: \`src/lib/verification-criterion-evaluator-v2.test.ts\`
- Modify: \`src/lib/verification-contract-v2.ts\`

**Produces:** \`evaluateVerificationCriterionV2(criterion, evidence, observation?)\`, which returns a closed \`VerificationCriterionEvaluationV2\`.

- [ ] **Step 1: Write failing static criterion tests**

~~~ts
it("satisfies a documentation literal only from an exact head blob", () => {
  expect(evaluateVerificationCriterionV2(documentationCriterion, {
    headSha,
    artifactBlobs: [{ path: "docs/reset.md", content: "Run npm test." }],
    changedFileInventory: { complete: true, paths: [] }
  })).toMatchObject({ state: "satisfied" });
});

it("does not satisfy absence from an incomplete changed-file inventory", () => {
  expect(evaluateVerificationCriterionV2(absenceCriterion, {
    headSha,
    artifactBlobs: [],
    changedFileInventory: { complete: false, paths: [] }
  })).toMatchObject({ state: "unavailable" });
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
pnpm vitest run src/lib/verification-criterion-evaluator-v2.test.ts
~~~

Expected: module/function does not exist.

- [ ] **Step 3: Implement the minimal closed evaluator**

~~~ts
export function evaluateVerificationCriterionV2(
  criterion: VerificationCriterionV2,
  evidence: VerificationCriterionEvidenceV2,
  observation?: ValidatedReturnValueObservationV2
): VerificationCriterionEvaluationV2 {
  if (criterion.type === "artifact" && criterion.artifact.kind === "documentation_literal") {
    return evaluateDocumentationLiteralV2(criterion, evidence);
  }
  if (criterion.type === "absence") return evaluatePathChangeAbsenceV2(criterion, evidence);
  return unavailable(criterion.id);
}
~~~

Use exact normalized path comparison and newline-normalized literal matching. Workflow and test-case criteria are unavailable until immutable workflow/run/job/test identity collection exists.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
pnpm vitest run src/lib/verification-criterion-evaluator-v2.test.ts src/lib/verification-contract-v2.test.ts
git add src/lib/verification-criterion-evaluator-v2.ts src/lib/verification-criterion-evaluator-v2.test.ts src/lib/verification-contract-v2.ts
git commit -m "feat: evaluate static verification criteria"
~~~

### Task 2: Correct the attested return-value observation boundary

**Files:**

- Modify: \`src/lib/verification-execution-v2.ts\`
- Modify: \`src/lib/verification-execution-v2.test.ts\`

**Produces:** a signed observation envelope. The executor reports actual results only; AgentProof derives the criterion state.

- [ ] **Step 1: Write failing observation tests**

~~~ts
it("rejects an executor-authored satisfied case state", () => {
  expect(validateAttestedExecutionResultV2({
    ...signedEnvelope,
    results: [{ criterionId, adapterId: "node_export_scalar.v1", cases: [{ id: "private", state: "satisfied" }] }]
  }, request, publicKey).ok).toBe(false);
});

it("marks a mismatched returned scalar violated on the server", () => {
  expect(evaluateReturnValueCriterionV2(criterion, validObservation("Public repository")))
    .toMatchObject({ state: "violated" });
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
pnpm vitest run src/lib/verification-execution-v2.test.ts
~~~

Expected: old DTO accepts \`state\` and cannot compare an actual return value.

- [ ] **Step 3: Implement observation DTO and server comparison**

~~~ts
type ReturnValueObservationV2 =
  | { kind: "returned"; actual: Scalar }
  | { kind: "target_error"; code: TargetErrorCodeV2 }
  | { kind: "environment_unavailable"; code: EnvironmentUnavailableCodeV2 };
~~~

Validate exact keys, request binding, criterion/case order, adapter tuple, byte cap, and signature before comparison. Returned mismatch and target error are \`violated\`; environment failures and missing/invalid attestation are \`unavailable\`.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
pnpm vitest run src/lib/verification-execution-v2.test.ts src/lib/verification-contract-v2.test.ts
git add src/lib/verification-execution-v2.ts src/lib/verification-execution-v2.test.ts
git commit -m "fix: derive return value outcomes on the server"
~~~

### Task 3: Materialize criterion results into v2 reports

**Files:**

- Modify: \`src/lib/types.ts\`
- Modify: \`src/lib/verifier.ts\`
- Modify: \`src/lib/verifier.test.ts\`
- Modify: \`src/lib/report-validation.ts\`
- Modify: \`src/lib/report-validation.test.ts\`

**Produces:** transient \`verificationCriterionEvidenceV2\` on \`PullRequestInput\`; a v2 report whose criterion results and canonical criterion-owned axes determine requirement/node status.

- [ ] **Step 1: Write failing positive and forged-report tests**

~~~ts
it("produces met for an authoritative documentation contract with exact evidence", () => {
  expect(generateVerificationReportV2(contractedDocumentationInput).requirements[0])
    .toMatchObject({ status: "met" });
});

it("rejects a forged satisfied v2 criterion without required evidence closure", () => {
  expect(validateVerificationReport(forgedV2Report, { mode: "v2_full" }).valid).toBe(false);
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
pnpm vitest run src/lib/verifier.test.ts src/lib/report-validation.test.ts
~~~

Expected: reports remain unavailable and full validation rejects every satisfied result.

- [ ] **Step 3: Implement result materialization and validator closure**

~~~ts
const results = materialized.objectives.flatMap((objective) =>
  objective.criteria.map((criterion) => evaluateMaterializedCriterionV2(criterion, input))
);
const contract = toVerificationContractReportV2(parsed, args.binding.sourceKind, materialized, results);
~~~

Create canonical criterion axis IDs with exact evidence references. Replace the unconditional satisfied-result rejection with criterion-type-specific closure checks. Uncollected types remain unavailable.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
pnpm vitest run src/lib/verifier.test.ts src/lib/report-validation.test.ts src/lib/verification-criterion-evaluator-v2.test.ts
git add src/lib/types.ts src/lib/verifier.ts src/lib/verifier.test.ts src/lib/report-validation.ts src/lib/report-validation.test.ts
git commit -m "feat: materialize verified contract results"
~~~

### Task 4: Collect bounded exact documentation blobs from GitHub

**Files:**

- Modify: \`src/lib/github.ts\`
- Modify: \`src/lib/github.test.ts\`
- Modify: \`src/lib/types.ts\`

**Produces:** transient exact head blobs only for contract-declared documentation paths.

- [ ] **Step 1: Write failing GitHub collector tests**

~~~ts
it("fetches only contract-declared documentation paths at the head SHA", async () => {
  const input = await buildGitHubPullRequestInput(url, token);
  expect(input.verificationCriterionEvidenceV2?.artifactBlobs)
    .toEqual([{ path: "docs/reset.md", content: "Run npm test." }]);
});

it("does not fetch content paths when a contract is absent or invalid", async () => {
  await buildGitHubPullRequestInput(url, token);
  expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/contents/"), expect.anything());
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
pnpm vitest run src/lib/github.test.ts
~~~

Expected: no bounded artifact collection exists.

- [ ] **Step 3: Implement bounded content collection**

Parse the selected contract, deduplicate up to eight documentation paths, fetch each exact GitHub content blob at the analyzed head, reject oversized/non-text content, and return a neutral limitation on failure. Content remains transient and excluded from evidence index, report JSON, storage, public sharing, telemetry, and errors. Fresh finalization rebuilds this input.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
pnpm vitest run src/lib/github.test.ts src/lib/verifier.test.ts
git add src/lib/github.ts src/lib/github.test.ts src/lib/types.ts
git commit -m "feat: collect contract artifact evidence"
~~~

### Task 5: Render contract-specific gaps and preserve baseline wording

**Files:**

- Modify: \`src/lib/verifier.ts\`
- Modify: \`src/lib/dashboard-requirement-view-model.ts\`
- Modify: \`src/lib/dashboard-requirement-view-model.test.ts\`
- Modify: \`src/lib/dashboard-report-export.ts\`
- Modify: \`src/lib/dashboard-report-export.test.ts\`
- Modify: \`src/lib/markdown.ts\`
- Modify: \`src/lib/markdown.test.ts\`

**Produces:** exact next actions for absent/invalid/unavailable contracts. Legacy v1 text remains unchanged.

- [ ] **Step 1: Write failing output tests**

~~~ts
it("asks for an approved contract rather than prose clarification when absent", () => {
  expect(toDashboardRequirementViewModels(absentContractReport)[0]?.nextAction)
    .toBe("Add or approve a typed verification contract, then rerun the analysis.");
});

it("labels a satisfied authoritative contract as supported against approved contract", () => {
  expect(toDashboardRequirementViewModels(satisfiedContractReport)[0]?.outcomeLabel)
    .toBe("Supported against approved contract");
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
pnpm vitest run src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts src/lib/markdown.test.ts
~~~

Expected: generic remediation says “Clarify the requirement.”

- [ ] **Step 3: Implement state-specific copy**

Select copy only from v2 contract/criterion state. Show policy once at report level and local contract/evaluator action on each requirement. Preserve existing v1 wording.

- [ ] **Step 4: Verify GREEN and commit**

~~~bash
pnpm vitest run src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.test.ts src/lib/markdown.test.ts
git add src/lib/verifier.ts src/lib/dashboard-requirement-view-model.ts src/lib/dashboard-requirement-view-model.test.ts src/lib/dashboard-report-export.ts src/lib/dashboard-report-export.test.ts src/lib/markdown.ts src/lib/markdown.test.ts
git commit -m "fix: explain strict contract outcomes accurately"
~~~

### Task 6: Freeze the full outcome matrix

**Files:**

- Create: \`src/lib/verification-contract-v2-evaluation.test.ts\`

**Produces:** regression coverage for strict no-contract, static positive, behavioral unavailable/forged, PR-author cap, failed execution, stale binding, and requirement-local Check association.

- [ ] **Step 1: Write the initial matrix assertion**

~~~ts
it("keeps an exact no-contract helper objective unclear while retaining observed evidence", () => {
  const report = generateVerificationReportV2(noContractVisibilityInput);
  expect(report.requirements[0]).toMatchObject({ status: "unclear", evidenceStatus: "met" });
});
~~~

- [ ] **Step 2: Verify its state honestly**

~~~bash
pnpm vitest run src/lib/verification-contract-v2-evaluation.test.ts
~~~

Record whether the assertion is RED or a pre-existing GREEN invariant. Do not claim a RED test for existing behavior.

- [ ] **Step 3: Add the bounded regression matrix**

Cover: #24-style no-contract prose, authoritative static met, PR-author partial, absent artifact, incomplete inventory, unsigned/wrong return observation, relevant failed execution, malformed contract, source relink, forged v2 report, and the #22 requirement-to-Check association rule.

- [ ] **Step 4: Run release verification and commit**

~~~bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
git add src/lib/verification-contract-v2-evaluation.test.ts
git commit -m "test: freeze v2 evaluation closure matrix"
~~~

## External Delivery Gate

This repository plan does not deploy the AgentProof-owned sandbox executor, provision a signing key, apply infrastructure migration, change tenant consent, or enable a pilot. Those operations need a separate security and infrastructure approval package. A live behavioral \`return_value\` criterion may produce `met` only after the executor endpoint, key rotation procedure, durable execution job, versioned execution consent, and private allowlisted canary are approved.
