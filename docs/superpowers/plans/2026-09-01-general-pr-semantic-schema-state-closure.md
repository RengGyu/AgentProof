# General PR Semantic Schema and State Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ordinary-PR semantic provider contract OpenAI strict-compatible and preserve an exact distinction between valid non-detection, invalid output, and provider failure.

**Architecture:** Replace the dynamic provider-output maps with a private fixed-array candidate, then deterministically normalize it into the existing canonical `GeneralPrSemanticProposalV2`. Add one transient aggregate failure-stage enum for unavailable runs, keep all model output hypothesis-only, and verify the route, worker, privacy projections, and 25-PR smoke without changing strict contract outcomes.

**Tech Stack:** TypeScript 5.9, Next.js 15, Vitest 4, OpenAI Responses API structured outputs, existing AgentProof validators and smoke scripts.

**Spec:** `docs/superpowers/specs/2026-09-01-general-pr-semantic-schema-state-closure-design.md`

## Global Constraints

- Do not change Verification Contract V2 authority or strict outcomes.
- Do not add a user-facing mode, request field, or PR author template.
- Keep `GeneralPrSemanticProposalV2` as the canonical finalizer input.
- Model output remains hypothesis-only and cannot create Supported, strict `met`, or verified relations.
- `objectiveGroups: []` means valid non-detection in the selected source, not proven global absence.
- Missing required fields mean invalid analysis output, not valid empty analysis.
- Keep raw provider input/output/errors, source spans, paths, PR identifiers, tokens, patches, and logs out of reports and persistence.
- Reuse existing validators, hashing, redaction, runtime policy, and smoke machinery; add no dependency.
- Follow RED -> GREEN for each task.

---

### Task 1: Replace the dynamic provider schema with a fixed candidate contract

**Files:**
- Modify: `src/lib/general-pr-semantic-proposal.ts`
- Modify: `src/lib/general-pr-semantic-proposal.test.ts`

**Interfaces:**
- Produces: `GeneralPrSemanticProviderCandidateV1`.
- Preserves: `GeneralPrSemanticProposalV2` and `validateGeneralPrSemanticProposalV2(...): GeneralPrSemanticProposalValidation`.
- Changes: `validateGeneralPrSemanticProposalV2()` accepts the provider candidate and returns the canonical V2 proposal.

- [ ] **Step 1: Add a recursive OpenAI strict-schema RED test**

Replace the current strict-object helper with a helper that checks both strict invariants:

```ts
function expectOpenAiStrictObjects(value: unknown, path = "schema"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (record.type === "object") {
    expect(record.additionalProperties, path).toBe(false);
    const properties = Object.keys((record.properties ?? {}) as Record<string, unknown>).sort();
    const required = [...((record.required ?? []) as string[])].sort();
    expect(required, `${path}.required`).toEqual(properties);
  }
  for (const [key, child] of Object.entries((record.properties ?? {}) as Record<string, unknown>)) {
    expectOpenAiStrictObjects(child, `${path}.properties.${key}`);
  }
  if (record.items) expectOpenAiStrictObjects(record.items, `${path}.items`);
}
```

Assert that both the minimum valid seed and maximum-span seed pass, including seeds with zero change clusters or zero evidence atoms. Assert that `objectiveGroups` is an array, not a dynamic object, and that no schema contains an empty `enum`.

- [ ] **Step 2: Run the schema test and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-proposal.test.ts
```

Expected: FAIL because the current `objectiveGroups` object declares properties without a matching `required` list.

- [ ] **Step 3: Add provider-candidate types and fixed keys**

Add the provider type from the spec. Use these root keys only:

```ts
const PROVIDER_ROOT_KEYS = [
  "spanRoles",
  "objectiveGroups",
  "testApplicabilityProposals",
  "scopeMappingProposals",
  "evidenceRelationProposals"
] as const;
```

Use fixed entry keys. Relation entries use `objectiveSpanIds`; they do not accept `objectiveGroupId` from the provider.

- [ ] **Step 4: Build only fixed-property array schemas**

Make `buildGeneralPrSemanticProposalJsonSchemaV2(seed)` return a fixed root object whose five required properties are arrays. Use:

```ts
spanRoles: {
  type: "array",
  minItems: seed.spans.length,
  maxItems: seed.spans.length,
  items: exactObjectSchema(SPAN_ROLE_KEYS, {
    spanId: enumSchema(seed.spans.map((span) => span.id)),
    role: enumSchema(ROLES),
    abstained: { type: "boolean" }
  })
}
```

Use `objectiveGroups` with `maxItems: GENERAL_PR_SEMANTIC_PROPOSAL_MAX_SPANS`. Use existing relation limits and bounded ID schemas. Never generate an empty `enum`: if a change/evidence ID catalog is empty, keep the array valid and rely on the independent validator to reject every non-empty relation. Remove `possibleContiguousGroupIds()` and all seed-derived object properties.

- [ ] **Step 5: Write provider-candidate normalization RED tests**

Add independent tests for:

```text
valid fixed-array candidate -> existing canonical map-shaped V2 proposal
objectiveGroups [] + all non-objective span roles -> valid canonical objectiveGroups {}
missing objectiveGroups -> invalid
duplicate or missing span decision -> invalid
duplicate objective group -> invalid
forged, reordered, non-contiguous, or cross-source group -> invalid
relation objectiveSpanIds without a submitted objective group -> invalid
empty change/evidence catalogs -> schema valid, every submitted relation invalid
extra root or entry key -> invalid
stale seed -> invalid
oversized output -> invalid
```

- [ ] **Step 6: Implement deterministic normalization**

Keep current ownership and authority checks. Derive every canonical group ID:

```ts
const groupId = deriveGeneralPrObjectiveGroupIdV2(rawGroup.spanIds);
normalizedGroups[groupId] = {
  groupId,
  spanIds: [...rawGroup.spanIds],
  disposition: rawGroup.disposition
};
```

For each relation, derive the same group ID from `objectiveSpanIds`, require that group in `normalizedGroups`, and return the existing canonical relation with `objectiveGroupId`.

Inject canonical `contractVersion`, `schemaVersion`, and `seedHash` only after validation succeeds.

Change the private response format name to `agentproof_general_pr_observer_candidate_v1`. Keep the canonical V2 constants unchanged and update route/worker `promptVersion` to `general-pr-observer.v3` so invocation hashes identify the changed output contract.

- [ ] **Step 7: Run focused tests and typecheck**

```bash
pnpm vitest run src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts
```

```bash
pnpm typecheck
```

Expected: all pass; canonical consumers remain unchanged except their provider-candidate test helpers.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/lib/general-pr-semantic-proposal.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts
git commit -m "fix: close general PR semantic provider schema"
```

---

### Task 2: Make failure stage and empty-result semantics explicit

**Files:**
- Modify: `src/lib/general-pr-semantic-observer.ts`
- Modify: `src/lib/general-pr-semantic-observer.test.ts`
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`
- Modify: `src/lib/general-pr-observation-telemetry.ts`
- Modify: `src/lib/general-pr-observation-telemetry.test.ts`
- Modify: `src/lib/openai-semantic.ts`
- Modify: `src/lib/openai-semantic.test.ts`

**Interfaces:**
- Produces: `GeneralPrSemanticFailureStageV1` and nullable `semanticFailureStage` on the transient run result, bundle, and aggregate telemetry.
- Preserves: public `GeneralPrAssessmentSummaryV1` and all report schemas.

- [ ] **Step 1: Write the state-matrix RED tests**

Cover this exact matrix:

```text
provider/model absent -> unavailable + configuration
package construction fails -> unavailable + package
privacy gate blocks -> unavailable + privacy
provider HTTP/schema rejection -> unavailable + provider_request
response envelope/text/JSON invalid -> unavailable + provider_response
observer timer -> timeout + null stage
parsed candidate missing objectiveGroups -> invalid + null stage
valid objectiveGroups [] -> valid + null stage
stale subject -> stale + null stage
```

Assert `stage !== null` only when state is `unavailable`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/openai-semantic.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.test.ts
```

Expected: FAIL because the failure-stage field and mapping do not exist.

- [ ] **Step 3: Add the closed failure-stage type**

```ts
export type GeneralPrSemanticFailureStageV1 =
  | "configuration"
  | "package"
  | "privacy"
  | "provider_request"
  | "provider_response";
```

Add `semanticFailureStage: GeneralPrSemanticFailureStageV1 | null` to `GeneralPrSemanticObserverRunResultV2`.

Do not change invocation receipt V2 merely for this diagnostic.

- [ ] **Step 4: Translate OpenAI errors without retaining provider data**

Add a provider-neutral error type or typed result owned by the observer boundary. In `submitGeneralPrSemanticObservationWithOpenAI()` translate only closed failure classes:

```text
auth/rate/network/5xx/request invalid -> provider_request
response envelope/missing text/invalid JSON -> provider_response
```

Preserve the observer's own timeout state. Never attach status text, response body, prompt, token, request payload, or model output to the stage.

- [ ] **Step 5: Propagate only transient and aggregate diagnostics**

Copy `semanticFailureStage` into `GeneralPrObservationBundleV2` and `GeneralPrObservationTelemetryV1`. Update finalization calls so normal valid, invalid, timeout, stale, disabled, and ineligible runs carry `null`.

Do not copy the field into report generation or summary projection.

- [ ] **Step 6: Freeze the reviewer-facing meaning**

Add service/assessment tests asserting:

```text
valid empty candidate -> semantic_candidate_missing, not semantic_proposal_invalid
missing objectiveGroups -> semantic_proposal_invalid, not semantic_candidate_missing
provider_request failure -> semantic_observer_unavailable, not semantic_candidate_missing
```

Also assert no case changes strict requirement status, source authority, or `evidence_supported` counts.

- [ ] **Step 7: Run focused state and privacy tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/openai-semantic.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-assessment.test.ts src/lib/general-pr-observation-telemetry.test.ts src/lib/report-share.test.ts src/lib/server-report-store.test.ts src/lib/tenant-report-validation.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts src/lib/dashboard-report-export.test.ts
```

Expected: all pass; serialized report/share/store/export values do not contain `semanticFailureStage` or provider failure stages as fields.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/lib/general-pr-semantic-observer.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.ts src/lib/general-pr-observation-telemetry.test.ts src/lib/openai-semantic.ts src/lib/openai-semantic.test.ts
git commit -m "fix: distinguish semantic non-detection from provider failure"
```

---

### Task 3: Exercise valid provider output through route and worker

**Files:**
- Modify: `src/app/api/analyze/route.test.ts`
- Modify: `src/lib/analysis-worker.test.ts`
- Create only if it removes real duplication: `src/lib/general-pr-semantic-test-fixtures.ts`

**Interfaces:**
- Consumes: provider-candidate V1 from Task 1.
- Proves: route and worker reach the valid observer path without retaining the private bundle.

- [ ] **Step 1: Replace `{}` provider responses with a valid candidate**

For each OpenAI fetch mock, parse the bounded user input and return a valid candidate using only supplied IDs:

```ts
const requestBody = JSON.parse(String(init?.body));
const observerInput = JSON.parse(requestBody.input[1].content[0].text);
const [first] = observerInput.spans;
const candidate = {
  spanRoles: observerInput.spans.map((span: { id: string }) => ({
    spanId: span.id,
    role: span.id === first.id ? "objective_candidate" : "supporting_context",
    abstained: false
  })),
  objectiveGroups: [{ spanIds: [first.id], disposition: "candidate" }],
  testApplicabilityProposals: [],
  scopeMappingProposals: [],
  evidenceRelationProposals: []
};
return Response.json({ output_text: JSON.stringify(candidate) });
```

Use a fixture whose first span is objective-eligible and deterministic admission is `no_candidate`.

- [ ] **Step 2: Assert the route's bounded result**

Require:

```text
HTTP 200
one OpenAI request
generalPrAssessmentSummary.overallConclusion === evidence_partial
reasonCodes includes semantic_relation_only and target_relation_unresolved
reasonCodes excludes semantic_observer_unavailable and semantic_proposal_invalid
generalPrAssessmentSummary.counts.evidence_supported === 0
no observation bundle, diagnostics, span IDs, ledger digest, or provider metadata in JSON
```

- [ ] **Step 3: Assert worker parity**

Require the worker to call the same provider path, complete the job, retain only the bounded report summary when applicable, and omit the private bundle from result summaries, saved reports, comments, and audit payloads.

- [ ] **Step 4: Run route and worker tests**

```bash
pnpm vitest run src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts
```

Expected: all pass with schema-valid provider output.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts
git commit -m "test: exercise valid semantic output through production paths"
```

Add the optional shared fixture file to the commit only if it was created.

---

### Task 4: Freeze the boundary-health release checks

**Files:**
- Modify: `scripts/external-pr-current-corpus-smoke.test.mjs`
- Modify only if a closed guard cannot be expressed from existing aggregates: `scripts/external-pr-current-corpus-smoke.mjs`

**Interfaces:**
- Consumes: existing aggregate `generalPrAssessmentSummary` and quality gates.
- Produces: no semantic-accuracy score and no PR-specific tuning.

- [ ] **Step 1: Add aggregate safety RED tests using existing fields**

Create one healthy aggregate and independent mutation cases. The healthy case must satisfy:

```text
completedCount === caseCount
qualityGateSummary.ok === true
semantic_observer_unavailable === 0
semantic_observer_timeout === 0
semantic_proposal_invalid === 0
semantic_candidate_missing + semantic_relation_only > 0
assessmentCountTotals.evidence_supported === 0
```

Each mutation must fail independently. Do not assert that `no_assessable_claims` must decrease.

- [ ] **Step 2: Prefer a pure test helper over a new artifact field**

Implement the guard over the current aggregate only if needed. Do not add per-case provider state, URLs, source IDs, target IDs, diagnostics, or model metadata to the saved run artifact.

- [ ] **Step 3: Run smoke-script tests**

```bash
pnpm vitest run scripts/external-pr-current-corpus-smoke.test.mjs scripts/smoke-analyze-pr-url.test.mjs
```

Expected: the healthy aggregate passes and every safety mutation fails closed.

- [ ] **Step 4: Run the complete local engineering gate**

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

Expected: every command exits 0. Passing establishes only the behavior covered by these gates.

- [ ] **Step 5: Commit Task 4**

```bash
git add scripts/external-pr-current-corpus-smoke.mjs scripts/external-pr-current-corpus-smoke.test.mjs
git commit -m "test: gate semantic observer boundary health"
```

Omit unchanged paths from `git add`.

---

### Task 5: Deploy and run controlled boundary validation

**Files:**
- Runtime output only: `eval/generated/external-pr-current-corpus-run.v1.json`
- Do not commit refreshed live artifacts unless the existing release process explicitly requires them.

**Interfaces:**
- Requires: exact candidate deployment SHA, existing Vercel environment, existing public-PR smoke inputs.
- Produces: boundary-health evidence, not semantic correctness evidence.

- [ ] **Step 1: Verify candidate SHA and CI before deployment**

```bash
git rev-parse HEAD
```

Record the exact SHA. Confirm GitHub CI for that SHA passes and obtain independent review before advisory rollout.

- [ ] **Step 2: Deploy using the existing deployment path**

Do not change model, retention, privacy, tenant, comment, or save-report settings as part of this fix. Confirm the deployed commit equals the candidate SHA.

- [ ] **Step 3: Run one controlled positive provider-path smoke**

Confirm a public, fresh PR produces a valid semantic terminal signal and no Supported/`met` promotion. A valid empty candidate is acceptable for non-positive fixtures; the focused positive fixture must admit one hypothesis.

- [ ] **Step 4: Refresh and run the 25-PR corpus**

```bash
pnpm refresh:external-pr-corpus
```

```bash
pnpm smoke:external-pr-current-corpus
```

Expected boundary results:

```text
25/25 completed
all quality gates green
zero semantic unavailable/timeout/invalid reasons
at least one valid semantic terminal signal
zero evidence_supported from semantic-only targets
strict contract distributions unchanged except changes caused by refreshed upstream PR state
```

- [ ] **Step 5: Report uncertainty honestly**

```text
VERIFIED: provider schema accepted and route/worker boundary worked
VERIFIED: no false positive promotion or privacy leak in tested paths
UNKNOWN until labelled holdout: objective accuracy and reviewer usefulness
```

Do not tune rules based on individual corpus PR text.

## Plan self-review

- Spec coverage: provider schema, normalization, state meanings, diagnostics, integration, privacy, smoke, and rollback are covered.
- Scope: one failure boundary and its release evidence; no claim-classifier expansion.
- Compatibility: canonical proposal and public report schemas remain stable.
- Overfitting guard: no PR-specific strings, headings, repositories, or required reduction in `no_assessable_claims`.
- Placeholders: none; implementation decisions and commands are fixed above.
