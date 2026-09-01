# General PR Claim-Conditioned Semantic Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-or-nothing ordinary-PR semantic package with an automatic two-stage claim/evidence selection pipeline that produces useful bounded proposals without changing strict verification authority.

**Architecture:** Keep the complete `GeneralPrObservationSeedV2` as the immutable parent. Deterministically select whole source spans for a claim-discovery call, then build redacted descriptors and claim-conditioned candidate allowlists for an optional evidence-linking call. Independently validate both provider outputs, merge them into the existing canonical `GeneralPrSemanticProposalV2`, and keep all selections, descriptors, receipts, and provider payloads transient.

**Tech Stack:** TypeScript, Next.js 15, Vitest, existing unified/remark structural parser, existing redaction and GitHub collectors, OpenAI Responses strict JSON Schema, existing report validators and projection allowlists.

**Spec:** `docs/superpowers/specs/2026-09-02-general-pr-claim-conditioned-semantic-packaging-design.md`

## Global Constraints

- Preserve the complete `GeneralPrObservationSeedV2`; never truncate or mutate it.
- Add no user-facing mode, request flag, or PR template.
- Keep model output hypothesis-only. It cannot create evidence, authority, strict `met`, Supported, merge readiness, or `evidence_supported`.
- Make at most two provider calls and no automatic retry.
- Use `store: false` for both calls.
- Do not add embeddings, a vector database, Tree-sitter, or another dependency.
- Do not send raw patch bodies, source files, logs, URLs, tokens, SHAs, workflow IDs, or complete paths to the provider.
- A sampled selection cannot prove global absence, missing test, missing implementation, or contradiction.
- Do not change public report, tenant, saved-report, share, Markdown, comment, Slack, dashboard, audit, or job schemas.
- Keep route and worker behavior equivalent.
- Follow RED -> GREEN for each task. Do not combine tasks before focused tests pass.
- Do not push, deploy, or run a credentialed production smoke without separate A3 authorization.

---

### Task 1: Add the deterministic claim-span selector and manifest

**Files:**
- Create: `src/lib/general-pr-semantic-selection.ts`
- Create: `src/lib/general-pr-semantic-selection.test.ts`
- Modify: `src/lib/general-pr-semantic-observer.ts`
- Test: `src/lib/general-pr-observation-source.test.ts`

**Interfaces:**

```ts
export const GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION =
  "general-pr-claim-evidence-selection.v1" as const;

export type GeneralPrSemanticSelectionCoverageV1 =
  | "complete"
  | "sampled"
  | "incomplete";

export interface GeneralPrSemanticClaimSelectionV1 {
  version: 1;
  parentSeedHash: string;
  claimSelectionHash: string;
  selectedSpanIds: string[];
  selectedSpans: Array<{
    spanId: string;
    sourceUnitId: string;
    authority: "authoritative" | "author_claim";
    sourceRole: "objective" | "context";
    structuralKind: string;
    deterministicRole: string;
    text: string;
  }>;
  coverage: GeneralPrSemanticSelectionCoverageV1;
  omittedReasonCounts: {
    spanBudget: number;
    inputByteBudget: number;
  };
}

export function selectGeneralPrSemanticClaimSpansV1(input: {
  pullRequest: PullRequestInput;
  seed: GeneralPrObservationSeedV2;
  maxSpans?: number;
  maxInputBytes?: number;
}): { ok: true; selection: GeneralPrSemanticClaimSelectionV1 }
  | { ok: false; reason: "seed_invalid" | "source_binding_invalid" | "selection_unavailable" };
```

- [ ] **Step 1: Write RED tests for stable whole-span selection**

Cover all of these cases in `general-pr-semantic-selection.test.ts`:

1. 20 legal spans produce at most 12 selected spans instead of a package failure.
2. The highest-ranked legal span from each objective-capable source is reserved.
3. Selected output is serialized in full-seed order even when rank order differs.
4. Repeating the same input produces byte-identical selection JSON.
5. Reordering unrelated `changedFiles` or `checks` does not change the selected span IDs or selected span payload. The parent-seed binding hash may change, because it correctly binds the selection to the exact full seed.
6. A span larger than the packet byte budget is omitted whole; its prefix is never present.
7. A stale or forged seed returns `seed_invalid` or `source_binding_invalid`.
8. If no whole legal span fits, the result is `selection_unavailable`.
9. Code, hidden HTML, `policy_only`, and template/process spans cannot become reserved objective spans.
10. Selection IDs are a strict subset of full-seed span IDs.

Use a fixture with a linked Issue, PR title, and PR body so source diversity is tested without repository-specific wording.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-selection.test.ts
```

Expected: FAIL because `general-pr-semantic-selection.ts` does not exist.

- [ ] **Step 3: Implement canonical source-view reconstruction**

Move the existing redacted source-view reconstruction from `general-pr-semantic-observer.ts` into the new module as a non-exported helper or a narrowly exported helper used only by the selector and observer.

Required checks:

- source count and kind match;
- redacted source hash equals `sourceContentHash`;
- every selected span range is within the rebuilt redacted source;
- selected span text hash equals the seed span’s `textHash`; and
- the full rebuilt seed hash equals the supplied seed hash.

Do not duplicate a second source-binding implementation in the observer.

- [ ] **Step 4: Implement the fixed ranking tuple**

Implement explicit rank functions:

```ts
function admissionTierRank(value: GeneralPrSourceAdmissionTierV1): number;
function roleCeilingRank(value: GeneralPrSourceUnitV2["roleCeiling"]): number;
function deterministicRoleRank(value: GeneralPrSemanticSpanV2["deterministicRole"]): number;
function structuralKindRank(value: GeneralPrSemanticSpanV2["structuralKind"]): number;
```

Compare rank fields in the order defined by the spec. Use source index, span start, then span ID as final stable tie-breaks.

Do not add a new keyword list.

- [ ] **Step 5: Implement count and byte budgeting**

Build candidate entries first, reserve source diversity, fill by rank, then serialize in full-seed order.

Use `Buffer.byteLength(JSON.stringify(candidateInput), "utf8")` for the final byte check. Remove only the lowest-ranked non-reserved span until the limit is satisfied. If a reserved span cannot fit by itself, mark it omitted and continue.

- [ ] **Step 6: Run claim selection and source regression tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-selection.test.ts src/lib/general-pr-observation-source.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/lib/general-pr-semantic-selection.ts src/lib/general-pr-semantic-selection.test.ts src/lib/general-pr-semantic-observer.ts
git commit -m "feat: add bounded general PR claim selection"
```

---

### Task 2: Build redacted evidence descriptors and deterministic RRF selection

**Files:**
- Create: `src/lib/general-pr-semantic-evidence-selection.ts`
- Create: `src/lib/general-pr-semantic-evidence-selection.test.ts`
- Modify: `src/lib/general-pr-semantic-selection.ts`
- Modify: `src/lib/general-pr-semantic-selection.test.ts`
- Test: `src/lib/redact.test.ts`

**Interfaces:**

```ts
export interface GeneralPrSemanticEvidenceDescriptorV1 {
  evidenceId: string;
  kind: "change" | "test_artifact" | "check" | "execution";
  roleCandidates: string[];
  language: string | null;
  changeStatus: string | null;
  tokenSketch: string[];
  completeness: "complete" | "incomplete" | "unknown";
  subjectBinding: "exact_head" | "incomplete" | "unknown";
  relationBasis:
    | "released_static_relation"
    | "released_build_relation"
    | "changed_artifact"
    | "exact_subject"
    | "observation_only"
    | "unresolved";
}

export interface GeneralPrSemanticEvidenceSelectionV1 {
  version: 1;
  parentSeedHash: string;
  claimSelectionHash: string;
  evidenceSelectionHash: string;
  objectiveGroups: Array<{
    objectiveSpanIds: string[];
    changeClusterIds: string[];
    evidenceIds: string[];
  }>;
  changeClusterDescriptors: GeneralPrSemanticChangeClusterDescriptorV1[];
  evidenceDescriptors: GeneralPrSemanticEvidenceDescriptorV1[];
  coverage: GeneralPrSemanticSelectionCoverageV1;
  omittedReasonCounts: {
    evidenceBudget: number;
    inputByteBudget: number;
    unsafeDescriptor: number;
    noDeterministicSignal: number;
  };
}

export type GeneralPrSemanticEvidenceSelectionResultV1 =
  | {
      status: "selected";
      selection: GeneralPrSemanticEvidenceSelectionV1;
    }
  | {
      status: "empty";
      coverage: GeneralPrSemanticSelectionCoverageV1;
      omittedReasonCounts: GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1;
    }
  | {
      status: "invalid";
      reason: "seed_invalid" | "claim_binding_invalid" | "descriptor_invalid";
    };

export function selectGeneralPrSemanticEvidenceV1(input: {
  pullRequest: PullRequestInput;
  seed: GeneralPrObservationSeedV2;
  claimSelection: GeneralPrSemanticClaimSelectionV1;
  objectiveGroups: Array<{ spanIds: string[]; disposition: "candidate" }>;
  maxPerObjective?: number;
  maxTotal?: number;
  maxInputBytes?: number;
}): GeneralPrSemanticEvidenceSelectionResultV1;
```

- [ ] **Step 1: Write token-sketch privacy RED tests**

Construct changed files and checks containing:

- a normal path such as `src/repositories/repository-visibility.ts`;
- a patch hunk header with a function-like name;
- a secret-like token;
- a 40-character SHA;
- a URL and email;
- a patch body sentinel; and
- a log/check-summary sentinel.

Assert:

- useful normalized tokens such as `repository` and `visibility` remain;
- the complete raw path does not appear;
- the patch body, log, URL, email, SHA, and secret do not appear;
- every token is at most 40 characters;
- every sketch has at most 16 tokens; and
- the same input produces the same order.

- [ ] **Step 2: Write RRF selection RED tests**

Cover:

1. token-overlap, released-relation, and subject/completeness ranks combine with `k = 60`;
2. a missing rank contributes zero;
3. stable full-seed order and ID break equal scores;
4. one candidate per available evidence kind is reserved before score fill;
5. no objective receives more than 12 candidates;
6. the global union contains at most 64 candidates;
7. descriptors are deduplicated across objective groups;
8. removing unrelated evidence does not change selected decisive candidates;
9. removing the only related candidate removes or downgrades that relation candidate;
10. no selected ID exists outside the full seed; and
11. sampled selection records count/byte omissions rather than claiming absence.

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-evidence-selection.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement descriptor binding from the rebuilt seed**

Rebuild `GeneralPrObservationSeedV2` from `PullRequestInput` and require the same seed hash before reading paths, hunk headers, or check names.

Map every descriptor to an existing seed ID and independently verify:

- expected atom kind count;
- subject digest;
- test-artifact evidence reference;
- change-fact/changed-file correspondence;
- check/execution index and exact-head binding; and
- cluster membership.

Do not accept array position without the full rebuilt-seed equality check.

- [ ] **Step 5: Implement token sketch normalization**

Use existing `redactSecrets()` first. Parse only patch lines beginning with `@@` and retain only the trailing hunk-header label after the second `@@`. Never inspect patch body lines for provider descriptors.

Keep normalization local and closed. Do not reuse broader requirement keyword extractors that include raw summaries or logs.

- [ ] **Step 6: Implement three rank lists and RRF**

Use:

```ts
const RRF_K = 60;
const score = ranks.reduce(
  (total, rank) => total + (rank === null ? 0 : 1 / (RRF_K + rank)),
  0
);
```

Ranks are one-based. The numeric score stays transient and never enters a provider response, report, telemetry, or receipt.

- [ ] **Step 7: Enforce diversity, per-objective, global, and byte limits**

Build objective allowlists separately, deduplicate the descriptor catalogs, then calculate the actual Stage B JSON byte size. Drop the lowest-ranked non-reserved candidate until the package fits.

If no safe descriptor remains, return `status: "empty"` with:

- `coverage: "sampled"` when complete legal candidates existed but count/byte budgets omitted all of them;
- `coverage: "incomplete"` when seed or descriptor completeness prevented safe inclusion; or
- `coverage: "complete"` only when the full legal candidate set was empty.

None of these states returns a global absence conclusion.

- [ ] **Step 8: Run focused selection and redaction tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-evidence-selection.test.ts src/lib/general-pr-semantic-selection.test.ts src/lib/redact.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add src/lib/general-pr-semantic-evidence-selection.ts src/lib/general-pr-semantic-evidence-selection.test.ts src/lib/general-pr-semantic-selection.ts src/lib/general-pr-semantic-selection.test.ts
git commit -m "feat: select claim-conditioned evidence descriptors"
```

---

### Task 3: Split provider schemas and independently validate each stage

**Files:**
- Modify: `src/lib/general-pr-semantic-proposal.ts`
- Modify: `src/lib/general-pr-semantic-proposal.test.ts`
- Modify: `src/lib/general-pr-semantic-selection.ts`
- Test: `src/lib/general-pr-semantic-evidence-selection.test.ts`

**Interfaces:**

```ts
export const GENERAL_PR_SEMANTIC_CLAIM_SCHEMA_NAME =
  "agentproof_general_pr_claim_candidate_v1" as const;
export const GENERAL_PR_SEMANTIC_EVIDENCE_SCHEMA_NAME =
  "agentproof_general_pr_evidence_candidate_v1" as const;

export function buildGeneralPrSemanticClaimJsonSchemaV1(
  selection: GeneralPrSemanticClaimSelectionV1
): Record<string, unknown>;

export function validateGeneralPrSemanticClaimCandidateV1(
  value: unknown,
  seed: GeneralPrObservationSeedV2,
  selection: GeneralPrSemanticClaimSelectionV1
): GeneralPrSemanticClaimValidationV1;

export function buildGeneralPrSemanticEvidenceJsonSchemaV1(
  selection: GeneralPrSemanticEvidenceSelectionV1
): Record<string, unknown>;

export function validateGeneralPrSemanticEvidenceCandidateV1(
  value: unknown,
  seed: GeneralPrObservationSeedV2,
  claim: GeneralPrSemanticClaimValidationV1,
  selection: GeneralPrSemanticEvidenceSelectionV1
): GeneralPrSemanticEvidenceValidationV1;

export function mergeGeneralPrSemanticStageCandidatesV1(
  seed: GeneralPrObservationSeedV2,
  claim: GeneralPrSemanticClaimValidationV1,
  evidence: GeneralPrSemanticEvidenceValidationV1 | null
): GeneralPrSemanticProposalValidation;
```

- [ ] **Step 1: Write strict-schema RED tests**

Recursively assert for both schemas:

```text
additionalProperties === false
sort(required) === sort(Object.keys(properties))
```

Also assert:

- claim schema enums contain only selected span IDs;
- evidence schema enums contain only objective-allowed cluster/evidence IDs;
- empty evidence catalogs do not emit an empty enum;
- dynamic IDs are array values, never object property names; and
- provider-owned versions, hashes, authority, and group IDs are absent.

- [ ] **Step 2: Write mutation RED tests for claim validation**

Reject:

- missing root field;
- extra field;
- unselected span;
- duplicate span decision;
- missing selected span decision;
- reordered or non-contiguous group;
- cross-source group;
- role-ceiling violation;
- objective span outside a candidate group; and
- changed parent seed or `claimSelectionHash`.

- [ ] **Step 3: Write mutation RED tests for evidence validation**

Reject:

- unknown cluster/evidence ID;
- ID selected for another objective but not this objective;
- duplicate relation;
- cross-objective relation reuse;
- changed objective span list;
- more than the output relation limit;
- output above the byte limit;
- changed parent seed or `evidenceSelectionHash`; and
- a forged exact-head binding.

- [ ] **Step 4: Run proposal tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-proposal.test.ts
```

Expected: FAIL because stage schemas and validators do not exist.

- [ ] **Step 5: Implement claim schema and validator**

Reuse the existing canonical role enums and group-contiguity logic, but do not call the selector’s validity function as the only check. Recompute selected-ID subset, source ownership, order, contiguity, and seed binding from the supplied values.

- [ ] **Step 6: Implement evidence schema and validator**

Use the objective-specific allowlists from `GeneralPrSemanticEvidenceSelectionV1`. Convert accepted `objectiveSpanIds` to deterministic canonical group IDs only after validation.

- [ ] **Step 7: Implement deterministic merge to canonical V2**

Merge:

```ts
{
  spanRoles: validatedClaim.spanRoles,
  objectiveGroups: validatedClaim.objectiveGroups,
  testApplicabilityProposals: validatedEvidence?.testApplicabilityProposals ?? [],
  scopeMappingProposals: validatedEvidence?.scopeMappingProposals ?? [],
  evidenceRelationProposals: validatedEvidence?.evidenceRelationProposals ?? []
}
```

Pass the merged object through the existing canonical V2 validator before returning it. Do not partially repair invalid entries.

- [ ] **Step 8: Run all stage contract tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-selection.test.ts src/lib/general-pr-semantic-evidence-selection.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/lib/general-pr-semantic-proposal.ts src/lib/general-pr-semantic-proposal.test.ts src/lib/general-pr-semantic-selection.ts src/lib/general-pr-semantic-evidence-selection.test.ts
git commit -m "refactor: split general PR semantic stage contracts"
```

---

### Task 4: Orchestrate at most two provider calls with V3 receipts

**Files:**
- Modify: `src/lib/general-pr-semantic-observer.ts`
- Modify: `src/lib/general-pr-semantic-observer.test.ts`
- Modify: `src/lib/general-pr-semantic-proposal.ts`
- Test: `src/lib/general-pr-semantic-proposal.test.ts`

**Interfaces:**

```ts
export type GeneralPrSemanticObserverPackageV3 =
  | {
      stage: "claim_discovery";
      system: string;
      input: GeneralPrSemanticClaimPackageInputV1;
      request: GeneralPrSemanticProviderRequestV1;
    }
  | {
      stage: "evidence_linking";
      system: string;
      input: GeneralPrSemanticEvidencePackageInputV1;
      request: GeneralPrSemanticProviderRequestV1;
    };

export interface GeneralPrSemanticObserverProviderV3 {
  observe: (request: GeneralPrSemanticObserverPackageV3) => Promise<unknown>;
}

export interface GeneralPrSemanticInvocationReceiptV3 {
  version: 3;
  seedHash: string;
  claimSelectionHash: string | null;
  evidenceSelectionHash: string | null;
  selectionHash: string | null;
  modelProfileHash: string;
  claimPromptHash: string;
  claimSchemaHash: string;
  claimOutputHash: string | null;
  evidencePromptHash: string | null;
  evidenceSchemaHash: string | null;
  evidenceOutputHash: string | null;
  claimState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  evidenceState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  durationBucket: GeneralPrSemanticDurationBucketV1;
}
```

- [ ] **Step 1: Write observer state-machine RED tests**

Assert exact provider call counts and stages:

| Scenario | Calls | Overall state | Evidence state |
|---|---:|---|---|
| claim selection unavailable | 0 | unavailable | not_run |
| claim timeout | 1 | timeout | not_run |
| claim invalid | 1 | invalid | not_run |
| valid no-candidate claim | 1 | valid | not_run |
| valid claim, empty legal evidence | 1 | valid | not_run |
| valid claim, evidence success | 2 | valid | valid |
| valid claim, evidence timeout | 2 | valid | timeout |
| valid claim, evidence invalid | 2 | valid | invalid |
| stale before claim | 0 | stale | not_run |
| stale after claim | 1 | stale | not_run |
| stale after evidence | 2 | stale | stale |

For evidence timeout/invalid, assert the returned canonical proposal retains valid claim groups and has empty relation arrays.

- [ ] **Step 2: Write receipt RED tests**

Assert:

- receipt version is 3;
- disabled or pre-selection failure has null selection hashes and `claimState: "not_run"`;
- selection hash changes when selected IDs or allowlists change;
- prompt/schema/output hashes are stage-specific;
- no raw source, path, token sketch, check name, provider output, or secret sentinel appears;
- `evidence*Hash` fields are null when Stage B does not run; and
- receipt hash changes on any stage binding mutation.

- [ ] **Step 3: Run observer tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts
```

Expected: FAIL because the observer still builds one V2 package and one receipt.

- [ ] **Step 4: Replace count rejection with claim selection**

Remove count-only package failures for:

- `span_limit_exceeded`;
- `change_cluster_limit_exceeded`; and
- `evidence_atom_limit_exceeded`.

Keep these enum values readable for historical telemetry, but do not emit them when a legal bounded selection exists.

Add `selection_unavailable` as the closed package reason for a seed with no legal whole claim packet.

- [ ] **Step 5: Implement claim call and freshness fences**

Flow:

```text
validate full seed
-> select claim spans
-> read current public input
-> provider claim call
-> read current public input
-> validate claim candidate
```

Use the existing timeout helper and provider failure mapping.

- [ ] **Step 6: Implement evidence selection and optional second call**

When the claim validation has admitted groups:

```text
build descriptors and allowlists
-> if none, return claims-only
-> read current public input
-> provider evidence call
-> read current public input
-> validate evidence candidate
-> merge canonical proposal
```

Any evidence-stage provider or validation failure returns claims-only. A stale or private current subject still returns overall stale/unavailable because the parent binding is no longer safe.

- [ ] **Step 7: Build the manifest and V3 receipt**

Hash stable JSON only. `claimSelectionHash` includes:

- parent seed hash;
- policy version;
- ordered selected span IDs;
- configured claim count/byte limits.

`evidenceSelectionHash` includes:

- parent seed hash;
- policy version;
- ordered objective-to-cluster allowlists;
- ordered objective-to-evidence allowlists; and
- configured evidence count/byte limits.

`selectionHash` binds the parent seed, policy, `claimSelectionHash`, and nullable `evidenceSelectionHash`. All hashes exclude raw text and token sketches.

- [ ] **Step 8: Run observer and proposal tests**

```bash
pnpm vitest run src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-semantic-proposal.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

```bash
git add src/lib/general-pr-semantic-observer.ts src/lib/general-pr-semantic-observer.test.ts src/lib/general-pr-semantic-proposal.ts src/lib/general-pr-semantic-proposal.test.ts
git commit -m "feat: orchestrate staged general PR semantics"
```

---

### Task 5: Adapt the OpenAI transport without broadening authority

**Files:**
- Modify: `src/lib/openai-semantic.ts`
- Modify: `src/lib/openai-semantic.test.ts`
- Modify imports in: `src/app/api/analyze/route.ts`
- Modify imports in: `src/lib/analysis-worker.ts`

**Interfaces:**

```ts
export async function submitGeneralPrSemanticObservationWithOpenAI(
  semanticPackage: GeneralPrSemanticObserverPackageV3,
  options: Pick<OpenAISemanticOptions, "apiKey" | "fetchFn">
): Promise<unknown>;
```

- [ ] **Step 1: Write transport RED tests for both stages**

For claim and evidence packages, assert:

- request model comes from the package;
- `store` is exactly `false`;
- `text.format.strict` is `true`;
- the stage-specific schema name is used;
- timeout and output tokens come from the package;
- no stage retries occur after a 429, timeout, invalid JSON, or missing output;
- provider errors map only to closed request/response categories; and
- error bodies are not returned or persisted.

- [ ] **Step 2: Run transport tests and verify RED**

```bash
pnpm vitest run src/lib/openai-semantic.test.ts
```

Expected: FAIL on the V3 package type and stage-specific schemas.

- [ ] **Step 3: Generalize the existing one-shot adapter**

The body format stays the same. Only the package union and stage-specific schema differ. Do not create two duplicated transport functions.

- [ ] **Step 4: Run transport and observer tests**

```bash
pnpm vitest run src/lib/openai-semantic.test.ts src/lib/general-pr-semantic-observer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/lib/openai-semantic.ts src/lib/openai-semantic.test.ts src/app/api/analyze/route.ts src/lib/analysis-worker.ts
git commit -m "refactor: transport staged general PR observations"
```

---

### Task 6: Integrate service, worker, route, and aggregate telemetry

**Files:**
- Modify: `src/lib/general-pr-observation-service.ts`
- Modify: `src/lib/general-pr-observation-service.test.ts`
- Modify: `src/lib/general-pr-observation-worker.ts`
- Modify: `src/lib/general-pr-observation-worker.test.ts`
- Modify: `src/lib/analysis-worker.ts`
- Modify: `src/lib/analysis-worker.test.ts`
- Modify: `src/app/api/analyze/route.ts`
- Modify: `src/app/api/analyze/route.test.ts`
- Modify: `src/lib/general-pr-observation-telemetry.ts`
- Modify: `src/lib/general-pr-observation-telemetry.test.ts`

**Private aggregate addition:**

```ts
interface GeneralPrSemanticStageDiagnosticsV1 {
  version: 1;
  claimState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  evidenceState: "not_run" | "valid" | "invalid" | "timeout" | "unavailable" | "stale";
  sourceCoverage: GeneralPrSemanticSelectionCoverageV1 | null;
  evidenceCoverage: GeneralPrSemanticSelectionCoverageV1 | null;
  providerCallCount: 0 | 1 | 2;
  selectedCountBuckets: {
    sourceSpans: "0" | "1_4" | "5_8" | "9_12";
    evidenceCandidates: "0" | "1_16" | "17_32" | "33_64";
  };
}
```

- [ ] **Step 1: Write service and worker RED tests**

Assert:

- advisory and shadow both use the staged provider when eligible;
- no request-body field enables or disables the stages;
- provider receives Stage A then Stage B in route and worker;
- a claim-only result produces the same hypothesis target in both paths;
- an evidence-stage failure keeps the same strict report as the baseline;
- queue records contain no selection, descriptor, receipt, source, or provider fields; and
- a one-attempt durable worker still performs no observer retry.

- [ ] **Step 2: Write operator-diagnostic and telemetry RED tests**

The authenticated operator boundary may expose only closed aggregate diagnostics:

```ts
{
  claimState,
  evidenceState,
  sourceCoverage,
  evidenceCoverage,
  providerCallCount,
  selectedCountBuckets,
  omittedReasonCounts
}
```

Assert it contains no IDs, hashes, paths, token sketches, source text, check names, repository name, PR number, or provider output.

- [ ] **Step 3: Run focused integration tests and verify RED**

```bash
pnpm vitest run \
  src/lib/general-pr-observation-service.test.ts \
  src/lib/general-pr-observation-worker.test.ts \
  src/lib/analysis-worker.test.ts \
  src/app/api/analyze/route.test.ts \
  src/lib/general-pr-observation-telemetry.test.ts
```

Expected: FAIL because bundle and operator diagnostics do not yet carry stage aggregates.

- [ ] **Step 4: Thread V3 provider and stage diagnostics**

Update type imports from V2 provider/run result to V3. Pass only aggregate stage diagnostics into the transient `GeneralPrObservationBundleV2`.

Do not add the manifest or receipt to the bundle. The observer run result owns them only long enough to build aggregate diagnostics.

- [ ] **Step 5: Preserve finalizer authority**

Keep `finalizeDeterministicGeneralPrObservationsV2()` behavior:

- semantic objective state remains `hypothesis`;
- semantic relation level remains `hypothesis`;
- strict report statuses are unchanged;
- no provider result creates `evidence_supported`; and
- sampled coverage blocks absence-based conclusions.

Add a byte-equality assertion for the strict requirement section before and after staged observation.

- [ ] **Step 6: Run integration tests**

```bash
pnpm vitest run \
  src/lib/general-pr-observation-service.test.ts \
  src/lib/general-pr-observation-worker.test.ts \
  src/lib/analysis-worker.test.ts \
  src/app/api/analyze/route.test.ts \
  src/lib/general-pr-observation-telemetry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add \
  src/lib/general-pr-observation-service.ts \
  src/lib/general-pr-observation-service.test.ts \
  src/lib/general-pr-observation-worker.ts \
  src/lib/general-pr-observation-worker.test.ts \
  src/lib/analysis-worker.ts \
  src/lib/analysis-worker.test.ts \
  src/app/api/analyze/route.ts \
  src/app/api/analyze/route.test.ts \
  src/lib/general-pr-observation-telemetry.ts \
  src/lib/general-pr-observation-telemetry.test.ts
git commit -m "feat: integrate staged general PR diagnostics"
```

---

### Task 7: Close privacy, projection, and authority regression gates

**Files:**
- Modify: `src/lib/report-share.test.ts`
- Modify: `src/lib/server-report-store.test.ts`
- Modify: `src/lib/general-pr-assessment.test.ts`
- Modify: `src/lib/general-pr-assessment-presentation.test.ts`
- Modify: `src/lib/report-validation.test.ts`
- Modify: `src/lib/markdown.test.ts`
- Modify: `src/lib/slack.test.ts`
- Modify: `src/lib/dashboard-report-export.test.ts`
- Modify: `src/lib/audit-export.test.ts`
- Modify: `src/app/api/github/comment/route.test.ts`
- Modify: `src/app/api/notifications/slack/route.test.ts`
- Modify: `src/app/api/tenants/audit-export/route.test.ts`

Do not modify production projection code unless a RED test proves a real leak.

- [ ] **Step 1: Add one shared selection privacy sentinel**

Use values such as:

```ts
const selectionSentinels = [
  "gpsp_private_selection",
  "gpea_private_evidence",
  "src/private/secret-handler.ts",
  "private-token-sketch",
  "provider-private-output",
  "selectionHash",
  "tokenSketch",
  "objectiveGroups"
];
```

Inject the sentinels only into transient observer fixtures, not the expected public object.

- [ ] **Step 2: Add projection RED tests**

Verify absence from:

- private report serialization;
- saved tenant report;
- public share;
- Markdown;
- GitHub comment;
- Slack;
- dashboard/export;
- audit record;
- analysis job payload/result; and
- operator aggregate telemetry.

Unknown fields on closed public validators must be rejected rather than silently displayed.

- [ ] **Step 3: Add authority and metamorphic tests**

Assert:

1. semantic-only target remains `evidence_partial`;
2. semantic-only relation remains hypothesis;
3. generic passed CI cannot produce target-local support;
4. changed test artifact cannot become passed execution;
5. sampled evidence cannot produce missing-test or contradiction;
6. removing selected decisive evidence removes/downgrades the relation;
7. removing unrelated evidence leaves the result unchanged; and
8. a copied relation for another objective is rejected.

- [ ] **Step 4: Run privacy and authority tests**

```bash
pnpm vitest run \
  src/lib/report-share.test.ts \
  src/lib/server-report-store.test.ts \
  src/lib/general-pr-assessment.test.ts \
  src/lib/general-pr-assessment-presentation.test.ts \
  src/lib/report-validation.test.ts \
  src/lib/markdown.test.ts \
  src/lib/slack.test.ts \
  src/lib/dashboard-report-export.test.ts \
  src/lib/audit-export.test.ts \
  src/app/api/github/comment/route.test.ts \
  src/app/api/notifications/slack/route.test.ts \
  src/app/api/tenants/audit-export/route.test.ts
```

Expected: PASS with zero sentinel occurrence.

- [ ] **Step 5: Commit Task 7**

```bash
git add \
  src/lib/report-share.test.ts \
  src/lib/server-report-store.test.ts \
  src/lib/general-pr-assessment.test.ts \
  src/lib/general-pr-assessment-presentation.test.ts \
  src/lib/report-validation.test.ts \
  src/lib/markdown.test.ts \
  src/lib/slack.test.ts \
  src/lib/dashboard-report-export.test.ts \
  src/lib/audit-export.test.ts \
  src/app/api/github/comment/route.test.ts \
  src/app/api/notifications/slack/route.test.ts \
  src/app/api/tenants/audit-export/route.test.ts
git commit -m "test: close staged semantic privacy boundaries"
```

---

### Task 8: Upgrade the 25-PR smoke to measure packaging health

**Files:**
- Modify: `scripts/smoke-analyze-pr-url.mjs`
- Modify: `scripts/smoke-analyze-pr-url.test.mjs`
- Modify: `scripts/external-pr-current-corpus-smoke.mjs`
- Modify: `scripts/external-pr-current-corpus-smoke.test.mjs`
- Modify: `docs/external-pr-current-corpus.md`

**Aggregate output additions:**

```ts
{
  claimStageStateCounts,
  evidenceStageStateCounts,
  sourceCoverageCounts,
  evidenceCoverageCounts,
  providerCallCountCounts,
  packageReadyCount,
  omissionReasonCounts
}
```

- [ ] **Step 1: Write smoke parser RED tests**

Add fixtures for:

- selected sampled claim package;
- valid claim/no evidence packet;
- valid two-stage result;
- evidence timeout with claims preserved;
- true `selection_unavailable`; and
- historical count-limit diagnostics.

Assert exact-key validation and summary-only privacy.

- [ ] **Step 2: Write release guard RED tests**

Release smoke must fail when:

- a legal selection exists but result reports `span_limit_exceeded` or `evidence_atom_limit_exceeded`;
- provider call count exceeds 2;
- semantic-only strict `met`, Supported, or `evidence_supported` appears;
- any private field appears;
- `completedCount !== caseCount`; or
- an unexpected server error occurs.

Do not fail only because a report remains `unclear`.

- [ ] **Step 3: Run script tests and verify RED**

```bash
pnpm vitest run scripts/smoke-analyze-pr-url.test.mjs scripts/external-pr-current-corpus-smoke.test.mjs
```

Expected: FAIL because the new aggregate fields and guards do not exist.

- [ ] **Step 4: Implement aggregate-only parsing and summaries**

The scripts may read only authenticated operator diagnostics. Persist only closed counts and state distributions in `eval/generated/external-pr-current-corpus-run.v1.json`.

Do not persist selected IDs, hashes, token sketches, raw paths, source text, or provider responses.

- [ ] **Step 5: Update corpus documentation**

State explicitly:

- the 25 URLs measure collection, packaging, provider-call, and privacy health;
- they are not semantic ground truth;
- a lower `unclear` rate does not prove accuracy; and
- labelled calibration/holdout gates remain required.

- [ ] **Step 6: Run script tests**

```bash
pnpm vitest run scripts/smoke-analyze-pr-url.test.mjs scripts/external-pr-current-corpus-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add \
  scripts/smoke-analyze-pr-url.mjs \
  scripts/smoke-analyze-pr-url.test.mjs \
  scripts/external-pr-current-corpus-smoke.mjs \
  scripts/external-pr-current-corpus-smoke.test.mjs \
  docs/external-pr-current-corpus.md
git commit -m "test: measure staged semantic packaging health"
```

---

### Task 9: Add labelled selection evaluation without tuning to the live 25

**Files:**
- Modify: `src/lib/general-pr-observation-evaluation.ts`
- Modify: `src/lib/general-pr-observation-evaluation.test.ts`
- Modify: `scripts/evaluate-general-pr-observations.mjs`
- Modify: `scripts/evaluate-general-pr-observations.test.mjs`
- Modify: `scripts/evaluate-general-pr-observation-release.mjs`
- Modify: `scripts/evaluate-general-pr-observation-release.test.mjs`

- [ ] **Step 1: Add evaluation RED tests for independent metrics**

Score separately:

- claim-selection recall and precision;
- admitted-objective recall and precision;
- evidence-candidate recall at the fixed budget;
- relation precision;
- package-ready rate;
- sampled-coverage rate; and
- privacy/authority hard violations.

Do not create one blended quality score.

- [ ] **Step 2: Add lower-confidence-bound gates**

Reuse the existing labelled calibration/holdout case format and Wilson lower-bound utilities where available.

Keep the approved objective-admission gates:

- precision lower 95% bound >= 0.95;
- recall lower 95% bound >= 0.90;
- false Supported = 0;
- authority elevation = 0;
- wrong-head/stale use = 0;
- cross-objective reuse = 0; and
- privacy leakage = 0.

Add evidence-candidate recall as a reported metric first. Do not invent a release threshold until the frozen labelled set has been measured.

- [ ] **Step 3: Run evaluation tests and verify RED**

```bash
pnpm vitest run src/lib/general-pr-observation-evaluation.test.ts
```

Expected: FAIL because selection and package metrics are absent.

- [ ] **Step 4: Implement metric extensions**

Keep calibration and holdout disjoint by repository/task family. Do not import current 25-live-PR outcomes as labels.

- [ ] **Step 5: Run evaluation tests**

```bash
pnpm vitest run src/lib/general-pr-observation-evaluation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 9**

```bash
git add \
  src/lib/general-pr-observation-evaluation.ts \
  src/lib/general-pr-observation-evaluation.test.ts \
  scripts/evaluate-general-pr-observations.mjs \
  scripts/evaluate-general-pr-observations.test.mjs \
  scripts/evaluate-general-pr-observation-release.mjs \
  scripts/evaluate-general-pr-observation-release.test.mjs
git commit -m "test: score general PR semantic selection"
```

---

### Task 10: Run the full local release gate and prepare an evidence report

**Files:**
- Review: every file changed in Tasks 1–9
- Create: none

Task 10 is verification-only. Any discovered defect returns to its owning task before another full-gate run.

- [ ] **Step 1: Run all focused staged-semantic tests**

```bash
pnpm vitest run \
  src/lib/general-pr-semantic-selection.test.ts \
  src/lib/general-pr-semantic-evidence-selection.test.ts \
  src/lib/general-pr-semantic-proposal.test.ts \
  src/lib/general-pr-semantic-observer.test.ts \
  src/lib/openai-semantic.test.ts \
  src/lib/general-pr-observation-service.test.ts \
  src/lib/general-pr-observation-worker.test.ts \
  src/lib/general-pr-observation-telemetry.test.ts \
  src/app/api/analyze/route.test.ts \
  scripts/smoke-analyze-pr-url.test.mjs \
  scripts/external-pr-current-corpus-smoke.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run the complete deterministic checks**

```bash
pnpm test
```

Expected: PASS.

```bash
pnpm typecheck
```

Expected: PASS.

```bash
pnpm lint
```

Expected: PASS.

```bash
pnpm build
```

Expected: PASS.

```bash
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 3: Audit changed files and dependency boundary**

```bash
git status --short
git diff --stat
git diff -- package.json pnpm-lock.yaml
```

Expected:

- only planned files are changed;
- `package.json` and `pnpm-lock.yaml` are unchanged; and
- no generated live corpus or provider payload is staged.

- [ ] **Step 4: Verify the safety invariants from test evidence**

Record only directly observed results:

```text
VERIFIED: maximum provider call count
VERIFIED: full-seed preservation
VERIFIED: sampled-coverage absence guard
VERIFIED: strict outcome byte-equivalence
VERIFIED: projection leak count
VERIFIED: focused/full/type/build/lint commands
UNKNOWN: production latency until a separately authorized deployment smoke
UNKNOWN: semantic accuracy until labelled holdout scoring completes
```

- [ ] **Step 5: Route any discovered defect back to its owning task**

If Task 10 finds an in-scope defect, return to Tasks 1–9, add a focused RED regression to the owning test file, apply the smallest correction, rerun that task’s exact command, and use that task’s exact `git add` and commit command. Task 10 does not create an unscoped catch-all commit.

- [ ] **Step 6: Stop before external actions**

Do not push, deploy, refresh live GitHub data, or run a credentialed production smoke under this plan. Report the local commit SHA, test evidence, remaining labelled-evaluation status, and the exact external actions that require separate user approval.

---

## Acceptance Traceability

| Spec acceptance criterion | Implemented by | Verified by |
|---|---|---|
| Full seed remains canonical | Tasks 1, 2, 4 | seed/hash mutation tests |
| Oversized seed yields bounded claim packet | Tasks 1, 4 | 20-span and package-state tests |
| At most 12 whole spans | Task 1 | count/byte/whole-span tests |
| Claim-conditioned evidence, max 64 | Task 2 | RRF/budget tests |
| Meaningful bounded descriptors | Task 2 | token/privacy/relevance tests |
| At most two calls, no retry | Tasks 4, 5 | state-machine and transport tests |
| Independent stage validation | Task 3 | forged/cross-objective/stale mutation tests |
| Claims survive evidence-stage failure | Task 4 | timeout/invalid claims-only tests |
| Sampled coverage cannot prove absence | Tasks 4, 7 | coverage metamorphic tests |
| No strict promotion or authority elevation | Tasks 6, 7, 9 | report byte-equality and release gates |
| No user configuration | Task 6 | route/request tests |
| No privacy leakage | Tasks 2, 7, 8 | sentinel and aggregate-only tests |
| Existing Contract V2 unchanged | Tasks 6, 7, 10 | full suite and strict report comparison |

## Scope Stop Conditions

Stop implementation and escalate to the supervisor if any of these occur:

- the full seed cannot remain the canonical parent without changing Verification Contract V2;
- useful descriptors require raw patch bodies, source files, or logs;
- an evidence-stage failure cannot be represented without changing a public report schema;
- the selector needs repository-specific rules to pass tests;
- the two-call limit cannot be preserved;
- privacy requires a new persisted identifier or receipt;
- an existing strict outcome changes; or
- labelled evaluation reveals any false Supported, authority elevation, stale-head use, cross-objective reuse, or leak.

Do not solve a stop condition by increasing limits, adding retries, or weakening validation.
