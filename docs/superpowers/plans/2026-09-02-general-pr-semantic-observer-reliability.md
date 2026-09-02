# General PR Semantic Observer Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ordinary-PR semantic objective admission reliable by replacing the duplicated role/group provider contract, enforcing one shared 60-second provider budget, and preserving strict verification authority.

**Architecture:** Keep the deterministic report and `GeneralPrObservationSeedV2` as the source of truth. Use the provider only when deterministic admission finds no objective; ask it for one role per selected span, validate those roles locally, derive singleton objective groups in code, and spend any remaining deadline on optional evidence linking. Keep the canonical downstream `GeneralPrSemanticProposalV2` and all public report schemas unchanged.

**Tech Stack:** TypeScript, Next.js 15, Vitest, OpenAI Responses strict JSON Schema, existing AgentProof source selection, evidence selection, report validation, and privacy projections.

**Spec:** `docs/superpowers/specs/2026-09-02-general-pr-semantic-observer-reliability-design.md`

## Global Constraints

- The deterministic report and seed are built and validated before any provider call.
- The private claim provider contract contains only one role decision per selected span.
- Every accepted `objective_candidate` becomes one singleton group; do not infer multi-span groups.
- The total semantic provider budget is exactly `60_000` ms by default, shared by claim and evidence calls.
- Make at most two provider calls and zero automatic retries.
- Provider packages remain bounded, redacted, transient, and use `store: false`.
- Semantic output remains hypothesis-only and cannot change a strict outcome to `Supported` or `met`.
- Do not broaden deterministic keyword or verb lists.
- Do not add a user mode, dependency, execution sandbox, evidence collector, database migration, or public schema field.
- Detailed invalid reasons are closed operator-only values. They must not contain IDs, hashes, text, paths, or provider output.
- Keep exact-head reads before and after every completed provider call.
- Do not push, deploy, call a credentialed provider, or run the 25-PR preview without separate A3 authorization.
- Follow RED -> GREEN within each task. Do not begin the next task while focused tests fail.

---

### Task 1: Replace the duplicated claim contract with role-only V2

**Files:**
- Modify: `src/lib/general-pr-semantic-proposal.ts`
- Modify: `src/lib/general-pr-semantic-proposal.test.ts`
- Modify: `src/lib/general-pr-semantic-observer.ts`
- Modify: `src/lib/general-pr-semantic-observer.test.ts`
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`
- Modify: `src/lib/openai-semantic.ts`
- Modify: `src/lib/openai-semantic.test.ts`
- Modify: `src/app/api/analyze/route.ts`
- Modify: `src/lib/analysis-worker.ts`
- Modify: `src/lib/general-pr-observation-worker.ts`
- Modify: `src/app/api/analyze/route.test.ts`
- Modify: `src/lib/analysis-worker.test.ts`
- Modify: `src/lib/general-pr-observation-worker.test.ts`

**Interfaces:**

```ts
export const GENERAL_PR_SEMANTIC_CLAIM_SCHEMA_NAME =
  "agentproof_general_pr_claim_candidate_v2" as const;

export type GeneralPrSemanticClaimInvalidReasonV2 =
  | "root_shape_invalid"
  | "span_decision_invalid"
  | "span_binding_invalid"
  | "role_ceiling_violation"
  | "output_limit_exceeded";

export interface GeneralPrSemanticClaimCandidateV2 {
  spanRoles: Array<{
    spanId: string;
    role: GeneralPrClaimRoleV2;
  }>;
}

export interface GeneralPrSemanticClaimPackageInputV2 {
  contractVersion: "general_pr_semantic_claim.v2";
  schemaVersion: "agentproof_general_pr_claim_observer_v2";
  seedHash: string;
  claimSelectionHash: string;
  coverage: GeneralPrSemanticSelectionCoverageV1;
  spans: Array<{
    id: string;
    authority: "authoritative" | "author_claim";
    sourceRole: "objective" | "context";
    structuralKind: string;
    deterministicRole: string;
    text: string;
  }>;
}

export type GeneralPrSemanticObserverPackageV4 =
  | {
      stage: "claim_discovery";
      system: string;
      input: GeneralPrSemanticClaimPackageInputV2;
      request: GeneralPrSemanticProviderRequestV1;
    }
  | {
      stage: "evidence_linking";
      system: string;
      input: GeneralPrSemanticEvidencePackageInputV1;
      request: GeneralPrSemanticProviderRequestV1;
    };

export interface GeneralPrSemanticObserverProviderV4 {
  observe: (request: GeneralPrSemanticObserverPackageV4) => Promise<unknown>;
}

export type GeneralPrSemanticClaimValidationV2 =
  | {
      valid: true;
      parentSeedHash: string;
      claimSelectionHash: string;
      spanRoles: GeneralPrSemanticSpanRoleV2[];
      objectiveGroups: Array<{ spanIds: string[]; disposition: "candidate" }>;
      errors: [];
    }
  | {
      valid: false;
      invalidReason: GeneralPrSemanticClaimInvalidReasonV2;
      errors: string[];
    };

export function buildGeneralPrSemanticClaimJsonSchemaV2(
  selection: GeneralPrSemanticClaimSelectionV1
): Record<string, unknown>;

export function validateGeneralPrSemanticClaimCandidateV2(
  value: unknown,
  seed: GeneralPrObservationSeedV2,
  selection: GeneralPrSemanticClaimSelectionV1
): GeneralPrSemanticClaimValidationV2;
```

The canonical `GeneralPrSemanticSpanRoleV2` still contains `abstained`. The V2 validator derives it locally as `role === "mixed_or_ambiguous"` so downstream proposal types do not change.

- [ ] **Step 1: Write RED schema tests for the V2 root**

In `general-pr-semantic-proposal.test.ts`, replace the claim-schema expectations with assertions that the root requires only `spanRoles`, each decision requires only `spanId` and `role`, and `objectiveGroups` / `abstained` are absent from the serialized schema.

```ts
const schema = buildGeneralPrSemanticClaimJsonSchemaV2(selection);
const serialized = JSON.stringify(schema);

expect(serialized).toContain('"required":["spanRoles"]');
expect(serialized).not.toContain("objectiveGroups");
expect(serialized).not.toContain("abstained");
expectOpenAiStrictObjects(schema);
```

- [ ] **Step 2: Write RED validator tests for singleton group derivation**

Use a selected claim fixture containing two legal objective spans and one context span.

```ts
const candidate = {
  spanRoles: selection.selectedSpanIds.map((spanId, index) => ({
    spanId,
    role: index < 2 ? "objective_candidate" as const : "supporting_context" as const
  }))
};
const result = validateGeneralPrSemanticClaimCandidateV2(candidate, seed, selection);

expect(result).toMatchObject({
  valid: true,
  objectiveGroups: [
    { spanIds: [selection.selectedSpanIds[0]], disposition: "candidate" },
    { spanIds: [selection.selectedSpanIds[1]], disposition: "candidate" }
  ]
});
```

Add mutations for:

- missing selected ID -> `span_binding_invalid`;
- duplicate selected ID -> `span_binding_invalid`;
- unselected ID -> `span_binding_invalid`;
- extra root key -> `root_shape_invalid`;
- unknown role or malformed decision -> `span_decision_invalid`;
- objective role above source ceiling -> `role_ceiling_violation`;
- objective role on a `template_or_process` span -> `role_ceiling_violation`;
- serialized output over 16,384 bytes -> `output_limit_exceeded`; and
- no objective roles -> valid result with `objectiveGroups: []`.

- [ ] **Step 3: Run the focused proposal tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-proposal.test.ts
```

Expected: FAIL because the V2 schema and validator do not exist.

- [ ] **Step 4: Implement the minimal V2 schema**

Replace the claim-only root constants with:

```ts
const CLAIM_V2_ROOT_KEYS = ["spanRoles"] as const;
const CLAIM_V2_SPAN_ROLE_KEYS = ["spanId", "role"] as const;

export function buildGeneralPrSemanticClaimJsonSchemaV2(
  selection: GeneralPrSemanticClaimSelectionV1
): JsonSchema {
  const spanIds = selection.selectedSpanIds;
  return exactObjectSchema(CLAIM_V2_ROOT_KEYS, {
    spanRoles: {
      type: "array",
      minItems: spanIds.length,
      maxItems: spanIds.length,
      items: exactObjectSchema(CLAIM_V2_SPAN_ROLE_KEYS, {
        spanId: enumSchema(spanIds),
        role: enumSchema(ROLES)
      })
    }
  });
}
```

Do not retain a provider-facing V1 fallback. Route and worker are upgraded atomically in this task.

- [ ] **Step 5: Implement V2 validation and local group derivation**

Validate selection and output bounds before normalizing. Iterate the decisions once, reject duplicates or illegal objective roles, and derive canonical-compatible values:

```ts
const normalizedRole: GeneralPrSemanticSpanRoleV2 = {
  spanId: value.spanId,
  role: value.role,
  abstained: value.role === "mixed_or_ambiguous"
};

const objectiveGroups = selection.selectedSpanIds.flatMap((spanId) => {
  const decision = normalizedById.get(spanId);
  return decision?.role === "objective_candidate"
    ? [{ spanIds: [spanId], disposition: "candidate" as const }]
    : [];
});
```

Fill unselected full-seed spans with the existing deterministic fallback. Register the validated result in the existing provenance `WeakMap` before the evidence stage consumes it.

- [ ] **Step 6: Update observer packages and prompt profile versions**

Replace `GeneralPrSemanticClaimPackageInputV1` with `GeneralPrSemanticClaimPackageInputV2` and bump the package/provider wrapper types from V3 to V4. Change the claim literals to:

```ts
contractVersion: "general_pr_semantic_claim.v2";
schemaVersion: "agentproof_general_pr_claim_observer_v2";
```

Update every import and annotation of `GeneralPrSemanticObserverPackageV3` and `GeneralPrSemanticObserverProviderV3` in the files listed for this task to V4. Update `RunGeneralPrSemanticObserverOptionsV2.provider` and `RunGeneralPrObservationNowOptionsV2.semantic.provider` to the V4 provider type.

Keep `GeneralPrSemanticProviderRequestV1` unchanged: it is the stage-neutral transport envelope, and its fields did not change. Its `responseFormat.name` union automatically accepts the new claim schema constant plus the existing evidence schema constant.

Set the claim system instruction to:

```ts
const CLAIM_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT} Assign exactly one closed role to every selected source span. Do not group spans or infer verification.`;
```

Update route, analysis worker, and observation worker model profiles from `general-pr-observer.v3` to `general-pr-observer.v4`. Keep the deployment-configured model name unchanged.

- [ ] **Step 7: Update observer and adapter tests**

Change test providers to return:

```ts
return {
  spanRoles: request.input.spans.map((span) => ({
    spanId: span.id,
    role: span.id === objective.id
      ? "objective_candidate"
      : "supporting_context"
  }))
};
```

Assert that route and worker claim requests use `general_pr_semantic_claim.v2`, the V2 schema name, `store: false`, and the same prompt profile. Keep evidence-stage assertions unchanged.

- [ ] **Step 8: Run all claim-contract tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts src/lib/openai-semantic.test.ts src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts src/lib/general-pr-observation-worker.test.ts
```

Expected: PASS. Existing evidence-link validation, stale-head checks, privacy assertions, and maximum-call assertions must remain green.

- [ ] **Step 9: Commit Task 1**

```bash
git add src/lib/general-pr-semantic-proposal.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-observer.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.ts src/lib/general-pr-observation-service.test.ts src/lib/openai-semantic.ts src/lib/openai-semantic.test.ts src/app/api/analyze/route.ts src/app/api/analyze/route.test.ts src/lib/analysis-worker.ts src/lib/analysis-worker.test.ts src/lib/general-pr-observation-worker.ts src/lib/general-pr-observation-worker.test.ts
git commit -m "fix: simplify general PR claim contract"
```

---

### Task 2: Enforce one shared 60-second semantic budget

**Files:**
- Modify: `src/lib/general-pr-semantic-observer.ts`
- Modify: `src/lib/general-pr-semantic-observer.test.ts`
- Modify: `src/lib/openai-semantic.test.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`

**Interfaces:**

```ts
export const GENERAL_PR_SEMANTIC_OBSERVER_DEFAULT_TOTAL_BUDGET_MS = 60_000;

function remainingBudgetMs(deadlineMs: number, now: () => number): number {
  return Math.max(0, deadlineMs - now());
}

function withPackageTimeout<T extends GeneralPrSemanticObserverPackageV4>(
  semanticPackage: T,
  timeoutMs: number
): T {
  return {
    ...semanticPackage,
    request: { ...semanticPackage.request, timeoutMs }
  } as T;
}
```

`RunGeneralPrSemanticObserverOptionsV2.timeoutMs` stays source compatible, but represents the total provider budget for the observer run.

- [ ] **Step 1: Write RED tests for remaining-time propagation**

Use a mutable fake clock and a staged provider that advances it after claim resolution.

```ts
let elapsedMs = 0;
const provider = stagedProvider({
  claim: (request) => {
    expect(request.request.timeoutMs).toBe(60_000);
    elapsedMs = 40_000;
    return claimCandidateV2(request);
  },
  evidence: (request) => {
    expect(request.request.timeoutMs).toBe(20_000);
    return emptyEvidenceCandidate;
  }
});

await run(input(), {
  provider,
  timeoutMs: 60_000,
  clock: () => elapsedMs
});
```

Add a second test where claim advances the clock to `60_000`. Expected result:

```ts
expect(result).toMatchObject({
  state: "valid",
  receipt: { claimState: "valid", evidenceState: "timeout" }
});
expect(provider.observe).toHaveBeenCalledTimes(1);
```

Add a default-budget assertion that omitting `timeoutMs` sends 60,000 ms to the claim request.

Add a local-wrapper timer test with Vitest fake timers. A never-resolving claim must remain pending at 59,999 ms and become claim `timeout` at 60,000 ms:

```ts
vi.useFakeTimers();
vi.setSystemTime(0);
const provider = stagedProvider({
  claim: async () => new Promise(() => undefined)
});
const pending = run(input(), {
  provider,
  timeoutMs: 60_000,
  clock: Date.now
});
let settled = false;
pending.finally(() => { settled = true; });

await vi.advanceTimersByTimeAsync(59_999);
expect(settled).toBe(false);
await vi.advanceTimersByTimeAsync(1);
expect(await pending).toMatchObject({
  state: "timeout",
  receipt: { claimState: "timeout", evidenceState: "not_run" }
});
vi.useRealTimers();
```

Place timer restoration in `afterEach(() => vi.useRealTimers())` so a failed assertion cannot leak fake timers into another test.

- [ ] **Step 2: Write RED exact-head call-order tests**

Record freshness reads and provider calls in one array for a successful two-stage run:

```ts
expect(events).toEqual([
  "read:before-claim",
  "provider:claim_discovery",
  "read:after-claim",
  "read:before-evidence",
  "provider:evidence_linking",
  "read:after-evidence"
]);
```

The `readCurrentInput` test double should return the same exact-head input four times and label calls by index. Add a drift mutation on the second read; expected result is `stale`, with only the claim provider call observed and no evidence call.

- [ ] **Step 3: Run observer tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/openai-semantic.test.ts
```

Expected: FAIL because the current default is 8,000 ms and evidence receives the full timeout again.

- [ ] **Step 4: Implement a single deadline**

At observer entry:

```ts
const totalBudgetMs = options.timeoutMs
  ?? GENERAL_PR_SEMANTIC_OBSERVER_DEFAULT_TOTAL_BUDGET_MS;
const deadlineMs = startedAt + totalBudgetMs;
```

The package builder may use `totalBudgetMs` while it computes the bounded schema and input. Immediately before each `provider.observe` call, recalculate remaining time, create an immutable package copy with `withPackageTimeout()`, and pass the same positive integer to `withTimeout`.

```ts
const claimRemainingMs = remainingBudgetMs(deadlineMs, now);
if (claimRemainingMs <= 0) {
  return finish("timeout", null, "timeout", "not_run");
}
const timedClaimPackage = withPackageTimeout(claimPackage, claimRemainingMs);
claimOutput = await withTimeout(
  options.provider.observe(timedClaimPackage),
  claimRemainingMs
);
```

Do not use two independent deadline objects. Do not reset the deadline after freshness reads or claim validation.

- [ ] **Step 5: Implement exhausted-budget behavior without moving freshness reads**

Before claim:

```ts
if (claimRemainingMs <= 0) {
  return finish("timeout", null, "timeout", "not_run");
}
```

Before evidence:

```ts
if (evidenceRemainingMs <= 0) {
  return finish("valid", claimsOnly.proposal, "valid", "timeout");
}
```

Keep claims-only output when evidence runs out of time. Do not start a second provider call with zero or negative timeout.

Retain the exact call order already present in the observer:

```text
read before claim -> claim call -> read after claim
-> read before evidence -> evidence call -> read after evidence
```

Calculate each remaining timeout immediately after its corresponding pre-call freshness read. Do not remove, merge, cache, or move any of the four reads.

- [ ] **Step 6: Verify the provider adapter uses the per-call remaining value**

In `openai-semantic.test.ts`, spy on `AbortSignal.timeout`, submit a V4 package with `request.timeoutMs: 20_000`, and assert `AbortSignal.timeout` receives `20_000`. Also assert `store: false` remains present. Do not add another adapter-level retry or outer 60-second timer.

- [ ] **Step 7: Run focused timeout and service tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/openai-semantic.test.ts src/lib/general-pr-observation-service.test.ts
```

Expected: PASS, including claim timeout, evidence timeout with preserved claims, provider error, stale-head, and maximum-two-call cases.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/lib/general-pr-semantic-observer.ts src/lib/general-pr-semantic-observer.test.ts src/lib/openai-semantic.test.ts src/lib/general-pr-observation-service.test.ts
git commit -m "fix: share semantic observer time budget"
```

---

### Task 3: Skip semantic calls after deterministic objective admission

**Files:**
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`
- Modify: `src/lib/general-pr-observation-worker.test.ts`
- Modify: `src/app/api/analyze/route.test.ts`

**Interfaces:**

No new public interface. Add one private predicate:

```ts
function hasDeterministicObjective(
  bundle: GeneralPrObservationBundleV2
): boolean {
  return bundle.objectives.some(
    (objective) => objective.admissionBasis === "explicit_structure"
  );
}
```

- [ ] **Step 1: Write RED zero-call service test**

Use a complete eligible public input whose deterministic span classifier already admits an explicit objective.

```ts
const provider = { observe: vi.fn() };
const result = await runGeneralPrObservationNowV2({
  policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
  input: deterministicObjectiveInput,
  generateReport: () => report,
  validateDeterministicReport: () => true,
  semantic: {
    provider,
    providerAvailable: true,
    privateRepository: false,
    readCurrentInput: async () => deterministicObjectiveInput,
    modelProfile
  }
});

expect(provider.observe).not.toHaveBeenCalled();
expect(result.bundle).toMatchObject({
  semanticState: "disabled",
  semanticStageDiagnostics: {
    claimState: "not_run",
    evidenceState: "not_run",
    providerCallCount: 0
  },
  diagnostics: { semanticAdmission: "not_needed" }
});
```

Compare `objectives`, `testCoverage`, `scopeMappings`, and `generalPrAssessmentSummary` with `finalizeDeterministicGeneralPrObservationsV2(seed, null, "disabled")` so the optimization cannot alter the product result.

- [ ] **Step 2: Write RED fallback-call test**

Use ordinary prose that produces no deterministic objective. Assert the provider is called once for claim discovery and, when an objective is returned and evidence is selectable, once for evidence linking.

```ts
expect(provider.observe.mock.calls.map(([request]) => request.stage))
  .toEqual(["claim_discovery", "evidence_linking"]);
```

- [ ] **Step 3: Run service tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-observation-service.test.ts
```

Expected: the zero-call test FAILS because the current service always starts the semantic observer for eligible complete seeds.

- [ ] **Step 4: Implement the deterministic fast path**

After seed validation, eligibility, and complete-parse checks, finalize once:

```ts
const deterministicBundle = finalizeDeterministicGeneralPrObservationsV2(
  seed,
  null,
  "disabled"
);

if (hasDeterministicObjective(deterministicBundle)) {
  return {
    report: options.policy.assessmentProjection === "advisory"
      ? attachGeneralPrAssessmentV1(report, seed, deterministicBundle)
      : report,
    bundle: deterministicBundle
  };
}
```

Then run the existing semantic observer unchanged for the no-candidate path. Do not inspect repository names, objective text, or evidence kinds in the bypass predicate.

- [ ] **Step 5: Run service, route, and worker regressions**

```bash
pnpm vitest run src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-worker.test.ts src/app/api/analyze/route.test.ts
```

Expected: PASS. Confirm route and worker both report zero provider calls for deterministic admission and retain automatic fallback for ordinary prose.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lib/general-pr-observation-service.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-worker.test.ts src/app/api/analyze/route.test.ts
git commit -m "perf: bypass semantic observer for deterministic claims"
```

---

### Task 4: Add closed operator-only invalid diagnostics

**Files:**
- Modify: `src/lib/general-pr-semantic-observer.ts`
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-telemetry.ts`
- Modify: `src/lib/general-pr-semantic-observer.test.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`
- Modify: `src/lib/general-pr-observation-telemetry.test.ts`
- Modify: `src/app/api/analyze/route.test.ts`

**Interfaces:**

Add a transient field to observer result and bundle:

```ts
export type GeneralPrSemanticObserverRunResultV3 = {
  state: "disabled" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  semanticFailureStage: GeneralPrSemanticFailureStageV1 | null;
  semanticPackageFailureReasons: GeneralPrSemanticPackageFailureReasonV1[];
  semanticClaimInvalidReason: GeneralPrSemanticClaimInvalidReasonV2 | null;
  proposal: GeneralPrSemanticProposalV2 | null;
  selectionManifest: GeneralPrSemanticSelectionManifestV1 | null;
  receipt: GeneralPrSemanticInvocationReceiptV3 & { receiptHash: string };
};

```

In the existing `GeneralPrObservationBundleV2` declaration, add this exact private field without changing its other fields:

```ts
/** Private closed reason only; not copied into reports or general telemetry. */
semanticClaimInvalidReason: GeneralPrSemanticClaimInvalidReasonV2 | null;
```

Add one operator-only projection field:

```ts
export type GeneralPrSemanticOperatorDiagnosticsV1 =
  Omit<GeneralPrSemanticStageDiagnosticsV1, "version"> & {
    semanticPackageFailureReasons: GeneralPrObservationBundleV2["semanticPackageFailureReasons"];
    omittedReasonCounts: GeneralPrSemanticSelectionOmittedReasonCountsV1;
    claimInvalidReason: GeneralPrSemanticClaimInvalidReasonV2 | null;
  };
```

Do not add the field to `GeneralPrObservationTelemetryV1`, `VerificationReportV2`, or any saved/report projection.

- [ ] **Step 1: Write RED observer propagation tests**

Return a valid-shaped decision array with one selected ID replaced by another selected ID, creating a duplicate and a missing binding.

```ts
expect(result).toMatchObject({
  state: "invalid",
  semanticClaimInvalidReason: "span_binding_invalid",
  receipt: { claimState: "invalid", evidenceState: "not_run" }
});
```

For a provider exception or timeout, assert `semanticClaimInvalidReason` is `null`; those failures already have their own stage/state.

- [ ] **Step 2: Write RED operator projection and privacy tests**

In `route.test.ts`, request the existing authenticated operator diagnostics header and assert:

```ts
expect(json.operatorDiagnostics?.claimInvalidReason)
  .toBe("span_binding_invalid");
expect(JSON.stringify(json.operatorDiagnostics)).not.toMatch(
  /gpsp_|seedHash|selectionHash|sourceText|providerOutput|repositoryName|pullRequestNumber/i
);
```

Repeat the request without the operator header and assert `operatorDiagnostics` is absent and the public report JSON does not contain `claimInvalidReason` or `semanticClaimInvalidReason`.

- [ ] **Step 3: Run focused diagnostics tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.test.ts src/app/api/analyze/route.test.ts
```

Expected: FAIL because no closed claim-invalid category is propagated today.

- [ ] **Step 4: Propagate only the closed validation category**

Extend the observer's private `finish` helper with a final optional argument defaulting to `null`. On claim validation failure, pass only `claim.invalidReason`:

```ts
if (!claim.valid) {
  return finish(
    "invalid",
    null,
    "invalid",
    "not_run",
    null,
    [],
    claim.invalidReason
  );
}
```

Update the declared `GeneralPrSemanticObserverRunResultV3` and `GeneralPrObservationBundleV2` types exactly as shown in the Interfaces section. Add a `semanticClaimInvalidReason` parameter, defaulting to `null`, to `finalizeDeterministicGeneralPrObservationsV2()`. Pass the observer result field through `runGeneralPrObservationNowV2()` into that parameter. Do not route it through `GeneralPrSemanticStageDiagnosticsV1` or public telemetry. Do not copy `errors`, caught exception messages, output fragments, or IDs.

- [ ] **Step 5: Project the category only for authenticated operators**

Update `buildGeneralPrSemanticOperatorDiagnosticsV1()`:

```ts
return {
  ...diagnostics,
  semanticPackageFailureReasons: [
    ...(bundle?.semanticPackageFailureReasons ?? [])
  ],
  omittedReasonCounts: bundle?.semanticSelectionOmittedReasonCounts ?? {
    spanBudget: 0,
    evidenceBudget: 0,
    inputByteBudget: 0,
    unsafeDescriptor: 0,
    noDeterministicSignal: 0
  },
  claimInvalidReason: bundle?.semanticClaimInvalidReason ?? null
};
```

Keep `buildGeneralPrObservationTelemetryV1()` unchanged so general telemetry receives only current aggregate stage states and counts.

- [ ] **Step 6: Run privacy and projection regression suites**

```bash
pnpm vitest run src/lib/general-pr-observation-telemetry.test.ts src/app/api/analyze/route.test.ts src/lib/report-share.test.ts src/lib/server-report-store.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts src/lib/audit-export.test.ts
```

Expected: PASS. The closed category appears only in authenticated operator diagnostics; no report/export snapshot changes.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/lib/general-pr-semantic-observer.ts src/lib/general-pr-observation-service.ts src/lib/general-pr-observation-telemetry.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.test.ts src/app/api/analyze/route.test.ts
git commit -m "feat: expose closed semantic invalid diagnostics"
```

---

### Task 5: Close local verification and prepare fixed-corpus evaluation

**Files:**
- Read: `eval/generated/external-pr-current-corpus-run.v1.json`
- Read: existing fixed external-PR corpus and release-gate inputs used by `smoke:external-pr-current-corpus`
- Verify: production and test files changed by Tasks 1-4

**Interfaces:**

No new production interface. This task verifies the implementation and records no new corpus labels.

- [ ] **Step 1: Run the complete focused semantic package**

```bash
pnpm vitest run src/lib/general-pr-semantic-selection.test.ts src/lib/general-pr-semantic-evidence-selection.test.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-observation-service.test.ts src/lib/general-pr-observation-telemetry.test.ts src/lib/openai-semantic.test.ts src/lib/general-pr-assessment.test.ts src/lib/general-pr-observation-worker.test.ts src/app/api/analyze/route.test.ts src/lib/analysis-worker.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run strict authority and privacy regressions**

```bash
pnpm vitest run src/lib/report-validation.test.ts src/lib/report-runtime-validation.test.ts src/lib/report-share.test.ts src/lib/server-report-store.test.ts src/lib/tenant-report-validation.test.ts src/lib/markdown.test.ts src/lib/slack.test.ts src/lib/audit-export.test.ts
```

Expected: PASS with no new strict outcome promotion or private-field snapshot.

- [ ] **Step 3: Run repository gates**

```bash
pnpm test
```

Expected: PASS.

```bash
pnpm typecheck
```

Expected: exit 0.

```bash
pnpm lint
```

Expected: exit 0. This repository currently maps lint to TypeScript checking; do not add a linter in this package.

```bash
pnpm build
```

Expected: exit 0.

```bash
git diff --check
```

Expected: no output and exit 0.

- [ ] **Step 4: Inspect the diff for forbidden scope**

```bash
git diff --name-only origin/main...HEAD
git status --short
```

Expected: only the files listed in Tasks 1-4 and the two approved documentation files. Reject the change if it adds a dependency, broadens deterministic keyword lists, changes a public report schema, adds a user mode, or introduces a provider retry.

- [ ] **Step 5: Stop at the external authorization boundary**

Do not push or deploy in this implementation session unless the user separately authorizes it. After authorization, deploy the exact candidate SHA to preview and confirm the effective function duration supports the one-minute observer budget before running external inputs.

- [ ] **Step 6: Re-run the fixed 25-PR corpus after authorized preview deployment**

Use the existing fixed input set and exact head SHAs. Supply deployment URL and credentials through the established environment; never place them in the command, plan, log artifact, or repository.

```bash
pnpm smoke:external-pr-current-corpus:release
```

Expected hard gates:

- 25 completed inputs and zero unexpected request failures;
- strict false `Supported` count = 0;
- provider call count never exceeds 2;
- deterministic-admitted cases use 0 provider calls;
- removed provider role/group mismatch count = 0;
- accepted stale proposals = 0;
- private diagnostic leakage = 0; and
- total provider time never exceeds 60,000 ms.

Report, but do not optimize blindly for:

- target admission coverage;
- independently labeled target precision;
- claim valid / invalid / timeout / unavailable counts;
- closed invalid-reason counts;
- evidence relation coverage; and
- total/report/evidence latency p50 and p95.

- [ ] **Step 7: Apply the release decision**

Release remains **NO-GO** if any hard gate fails or preview hosting terminates a request before AgentProof's deadline. A lower `no_assessable_claims` count is useful only when independently labeled target precision does not regress.

If usefulness coverage remains low but all safety gates pass, keep the feature advisory and record the remaining ceiling. Do not broaden regexes or add multi-span grouping within this package.
