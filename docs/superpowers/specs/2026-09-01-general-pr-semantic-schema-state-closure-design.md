# General PR Semantic Schema and State Closure Design

**Status:** Ready for implementation review
**Date:** 2026-09-01
**Depends on:** `docs/superpowers/specs/2026-09-01-general-pr-automatic-assessment-routing-design.md`
**Product boundary:** Bounded semantic target discovery for ordinary public PR evidence reports; never strict verification authority

## 1. Problem

The ordinary-PR semantic observer can fail before model inference because its OpenAI strict JSON Schema is not fully strict-compatible.

The current `objectiveGroups` schema generates every possible contiguous group ID as an object property. Those generated properties are not listed in that object's `required` array. OpenAI Structured Outputs requires every property of every object to be required when `strict: true`; an unsupported schema causes an API error rather than a semantic result.

This creates a dangerous interpretation ambiguity:

```text
provider rejected the schema
-> semantic observer unavailable
-> no objective admitted
```

That path must never be reported as:

```text
the PR has no requirement
```

The current public report already avoids a positive or negative strict verdict, but the provider contract and private diagnostics do not make the failure boundary sufficiently explicit.

Official constraint: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) states that all fields must be required for strict schemas and that unsupported schemas cause an error.

## 2. Goal

Close the provider schema and state semantics with the smallest compatible change:

1. replace dynamic provider-output objects with fixed-property arrays;
2. keep the existing canonical `GeneralPrSemanticProposalV2` used by the finalizer;
3. deterministically normalize a valid provider candidate into that canonical proposal;
4. distinguish valid non-detection from request/response failure; and
5. prove the route, worker, privacy boundary, and 25-PR smoke cannot turn either state into false Supported or strict `met`.

## 3. Non-goals

- Do not change Verification Contract V2 authority or outcomes.
- Do not create a new strict requirement from model output.
- Do not claim that an empty model result proves requirements are truly absent.
- Do not broaden PR keyword, heading, or repository-specific extraction rules.
- Do not add a user mode or configuration field.
- Do not execute repository code.
- Do not persist provider requests, responses, source spans, identifiers, raw text, or provider error bodies.
- Do not add a new public report schema field for private failure stages.
- Do not tune against the current 25 public PRs.

## 4. Required semantic distinction

The following meanings are immutable.

| Observed condition | Internal state | Reviewer-safe meaning | Forbidden interpretation |
|---|---|---|---|
| Provider candidate contains one or more admitted objective groups | `semanticState: valid`, `semanticAdmission: admitted` | A bounded objective hypothesis was found | Requirement verified or satisfied |
| Provider candidate is structurally valid and `objectiveGroups` is `[]` | `semanticState: valid`, `semanticAdmission: no_candidate` | No assessable semantic candidate was identified in the selected source | The PR truly has no requirement |
| Root `objectiveGroups` field is missing | `semanticState: invalid` | Provider output did not satisfy the local contract | No requirement exists |
| OpenAI rejects the request/schema before candidate decoding | `semanticState: unavailable`, failure stage `provider_request` | Semantic analysis did not run successfully | Empty semantic result |
| Response envelope/text/JSON cannot be decoded | `semanticState: unavailable`, failure stage `provider_response` | Semantic response could not be decoded | Empty semantic result |
| Provider/model configuration is absent | `semanticState: unavailable`, failure stage `configuration` | Semantic observation was not configured | No requirement exists |
| Local bounded package cannot be constructed | `semanticState: unavailable`, failure stage `package` | Semantic package construction failed closed | No requirement exists |
| Public-source/privacy/freshness gate blocks submission | existing `unavailable` or `stale` state; privacy failure stage only when applicable | Semantic submission was blocked safely | No requirement exists |

`required` is a schema-format rule. It guarantees that a field is present, but it does not guarantee that an array is non-empty or that a requirement exists.

## 5. Provider candidate contract

### 5.1 Separate provider shape from canonical shape

Keep `GeneralPrSemanticProposalV2` unchanged as the canonical, validator-approved object consumed by `general-pr-observation-service.ts`.

Introduce a private provider-facing candidate:

```ts
interface GeneralPrSemanticProviderCandidateV1 {
  spanRoles: Array<{
    spanId: string;
    role: GeneralPrClaimRoleV2;
    abstained: boolean;
  }>;
  objectiveGroups: Array<{
    spanIds: string[];
    disposition: "candidate" | "not_objective" | "ambiguous";
  }>;
  testApplicabilityProposals: Array<{
    objectiveSpanIds: string[];
    changeClusterId: string;
    proposal: "likely_expected" | "likely_not_applicable" | "ambiguous";
  }>;
  scopeMappingProposals: Array<{
    objectiveSpanIds: string[];
    changeClusterId: string;
    proposal: "plausibly_mapped" | "unresolved";
  }>;
  evidenceRelationProposals: Array<{
    objectiveSpanIds: string[];
    evidenceId: string;
    proposal: "supports" | "tests" | "implements" | "contradicts" | "unresolved";
  }>;
}
```

The provider does not echo `contractVersion`, `schemaVersion`, `seedHash`, or `groupId`.

Those values are deterministic observer-owned data:

- contract and schema versions come from checked-in constants;
- `seedHash` comes from the fresh validated seed;
- `groupId` is derived from ordered `spanIds` by `deriveGeneralPrObjectiveGroupIdV2()`.

Removing echoed integrity values reduces output size and prevents the model from appearing to authorize deterministic bindings.

### 5.2 Strict schema invariant

For every object in the provider JSON Schema:

```text
additionalProperties === false
sort(required) === sort(Object.keys(properties))
```

The root requires all five arrays. Empty arrays are permitted except `spanRoles`, which must contain exactly one decision per seed span.

Dynamic data is allowed only as bounded enum values and array entries. Seed-derived IDs must not become object property names.

The schema must also remain valid when `changeClusters` or `evidenceAtoms` is empty. Do not emit an empty `enum`. When an ID catalog is empty, the corresponding relation array is expected to be empty and the independent validator rejects every submitted reference; the provider schema may use a bounded string item solely to keep the strict schema structurally valid.

The response format name becomes `agentproof_general_pr_observer_candidate_v1`. The canonical proposal contract remains V2; no report or database migration is required.

## 6. Deterministic normalization and validation

`validateGeneralPrSemanticProposalV2()` continues to return the existing canonical proposal but consumes the provider candidate shape.

Validation must independently enforce:

1. exact root and entry keys;
2. output byte and collection limits;
3. every seed span is decided exactly once;
4. every span ID, cluster ID, and evidence ID exists in the seed;
5. abstention uses only `mixed_or_ambiguous`;
6. template/context ceilings cannot become objective candidates;
7. grouped spans are ordered, unique, contiguous, and belong to one source and authority;
8. every `objective_candidate` span belongs to exactly one `candidate` group;
9. relation `objectiveSpanIds` derive a group that was submitted in `objectiveGroups`;
10. duplicate groups and relations are rejected;
11. stale seed bindings are rejected; and
12. no partial repair of malformed provider output occurs.

After validation, the normalizer injects deterministic versions and seed hash, derives group IDs, and returns the existing map-shaped `GeneralPrSemanticProposalV2`.

## 7. Empty, missing, and invalid behavior

### 7.1 Valid empty candidate

This is valid:

```json
{
  "spanRoles": [
    { "spanId": "known-span", "role": "supporting_context", "abstained": false }
  ],
  "objectiveGroups": [],
  "testApplicabilityProposals": [],
  "scopeMappingProposals": [],
  "evidenceRelationProposals": []
}
```

Expected flow:

```text
valid provider response
-> canonical objectiveGroups {}
-> semanticState valid
-> semanticAdmission no_candidate
-> semantic_candidate_missing
-> no_assessable_claims
```

The user-facing meaning is: “No assessable candidate was identified in the selected source.”

### 7.2 Missing required field

This is invalid:

```json
{
  "spanRoles": [],
  "testApplicabilityProposals": [],
  "scopeMappingProposals": [],
  "evidenceRelationProposals": []
}
```

Expected flow:

```text
missing objectiveGroups
-> local validation invalid
-> semantic_proposal_invalid
-> no semantic candidate admitted
```

It must not emit `semantic_candidate_missing`, because the semantic analysis did not produce a valid empty result.

### 7.3 Provider request rejection

An HTTP schema/request rejection happens before a candidate exists.

Expected flow:

```text
OpenAI request rejected
-> semanticState unavailable
-> semanticFailureStage provider_request
-> semantic_observer_unavailable
```

It must not emit `semantic_candidate_missing` or any requirements-absent conclusion.

## 8. Minimal private failure diagnostics

Add one nullable closed enum to the transient observer result and observation bundle:

```ts
type GeneralPrSemanticFailureStageV1 =
  | "configuration"
  | "package"
  | "privacy"
  | "provider_request"
  | "provider_response";

semanticFailureStage: GeneralPrSemanticFailureStageV1 | null;
```

Invariant:

```text
semanticFailureStage !== null only when semanticState === "unavailable"
```

Existing states remain authoritative for `disabled`, `ineligible`, `timeout`, `invalid`, and `stale`. Do not add a separate `schema` stage: locally parsed schema mismatch is already `invalid`; provider rejection of the submitted schema is `provider_request`.

The field may enter existing aggregate-only server telemetry. It must not enter:

- `VerificationReportV2`;
- `GeneralPrAssessmentSummaryV1`;
- saved tenant reports;
- public shares;
- Markdown, GitHub comments, Slack, dashboard exports; or
- provider-error logs or raw error persistence.

## 9. Integration behavior

Route and worker tests must return a schema-valid provider candidate, not `{}`. Both paths must demonstrate:

```text
public fresh PR
-> provider request made once
-> strict candidate decoded
-> local validation valid
-> semantic state valid
-> public report contains only bounded summary
```

The valid candidate may produce either `semantic_candidate_missing` or an admitted hypothesis depending on the fixture. At least one focused integration fixture must admit a hypothesis and end at `evidence_partial`, never `evidence_supported`.

## 10. Evaluation and release guard

### 10.1 Engineering gate

- recursive strict-schema invariant test passes;
- valid-empty, missing-field, duplicate, forged, cross-source, and stale mutations pass;
- route and worker use schema-valid provider responses;
- observer failure-stage mapping tests pass;
- report/share/tenant/Markdown/comment/Slack privacy tests pass;
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check` pass.

### 10.2 25-PR boundary-health rerun

The existing 25-PR corpus is a production-shaped smoke, not semantic ground truth.

Required:

- `completedCount === caseCount`;
- every existing quality check has `failedCount === 0`;
- zero `semantic_observer_unavailable`;
- zero `semantic_observer_timeout`;
- zero `semantic_proposal_invalid`;
- at least one valid semantic terminal signal across the corpus: `semantic_candidate_missing` or `semantic_relation_only`;
- zero `evidence_supported` from semantic-only targets;
- zero strict requirement `met` attributable to this change; and
- no change to source authority or Verification Contract V2 outcomes.

A nonzero admitted semantic count proves only that the provider path works. It does not prove semantic accuracy.

### 10.3 Accuracy remains separate

Do not optimize the 25-PR corpus toward fewer `no_assessable_claims`. Accuracy requires independently labelled calibration and holdout cases defined by the parent routing design.

## 11. Rollout and rollback

1. Implement and verify locally with no network requirement.
2. Deploy with the existing server-side rollout policy.
3. Run one controlled valid-candidate smoke.
4. Refresh and run the 25-PR corpus.
5. Keep semantic targets advisory and hypothesis-only.

Rollback changes the rollout phase to `shadow` or `disabled`. The canonical proposal, deterministic report, strict contract, and stored report schemas remain compatible.

## 12. Acceptance criteria

- Every provider-schema object has all declared properties required.
- The provider schema has no seed-derived object property names.
- Minimum and maximum valid seeds both produce a strict-compatible schema, including empty change/evidence catalogs.
- `objectiveGroups: []` is a valid explicit non-detection result.
- A missing `objectiveGroups` field is invalid and never becomes candidate-missing.
- Provider request rejection is unavailable/provider-request and never becomes candidate-missing.
- A valid candidate is normalized to the existing canonical V2 proposal.
- Model output cannot raise authority, create verified relations, or produce Supported/`met`.
- Private failure-stage diagnostics do not cross report, persistence, share, or export boundaries.
- Route, worker, focused tests, and the 25-PR boundary-health rerun satisfy the gates above.
