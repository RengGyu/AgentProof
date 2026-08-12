# Hybrid Requirement-Proof Pilot Design

**Date:** 2026-08-12  
**Status:** Final implementation contract; no product code has changed.

## Goal and immutable boundaries

The private enhanced pilot replaces the uncommitted failed token/meta parser
with one strict provider plan over deterministic source spans. The server alone
creates evidence links, axis states, gaps, statuses, confidence, coverage, and
publication. The planner selects only pre-existing span IDs and applicable axis
pairs; it cannot send text, evidence, state, gap, remediation, or status.

Essential analysis is exact repository **BASE HEAD** behavior. The uncommitted
extractor/parser and its related contextual/vague changes are reverted in full;
they are pilot-finalizer behavior only after separate implementation. Disabled,
ineligible, overflowed, or failed pilot analysis never uses an experimental
parser as a fallback.

There is at most one provider POST per pilot analysis. Polling GETs for its one
background response are allowed. The pilot has no narrative semantic appendix.

## Deterministic span seed

Source classification first applies BASE HEAD redaction, source precedence,
section/template/external-reference/solution-hint filtering, and authoritative
vague handling. `linked_issue` and `provided_requirement` spans are
authoritative; `unlinked_pr` spans are candidate-only author claims.

Segmentation deliberately does **not** perform lexical-predicate or conjunction
NLP. It uses only deterministic source boundaries:

1. list item boundaries;
2. terminal sentence punctuation; and
3. a complete remaining line/paragraph when neither boundary exists.

Spans are non-overlapping and never rewritten or syntactically subdivided.
Each span has an opaque source-order ID, group ID, exact UTF-16 offsets into the
redacted source, and the previous source span ID in its group. Groups reset at
headings, blank lines, source changes, or section changes. Offset range and
whitespace/punctuation token-boundary validation re-extract exact span text on
the server.

This pilot tests admission/applicability, not semantic rewriting. A mixed
objective/meta sentence that lacks punctuation/list separation remains one span.
For a PR span, the planner classifies it `mixed_or_uncertain` and the server
omits it with one bounded “PR objective candidate was uncertain” limitation.
For an authoritative span, the server always materializes its exact text;
existing deterministic vague/manual rules alone may produce `manual_check`, an
ambiguity gap, and final `unclear` status.

The known limitation is deliberate: the pilot avoids a false requirement rather
than inventing a clause boundary or asking the provider to rewrite source text.

```ts
type HybridAnalysisContext = "linked_issue" | "unlinked_pr" | "provided_requirement";
type RequirementSpanId = `sp_${number}_${number}`;
type PlannerDisposition = "admit" | "exclude";
type PlannerClassification = "requirement" | "not_requirement" | "mixed_or_uncertain";

interface RequirementSourceSpan {
  id: RequirementSpanId;
  groupId: `grp_${number}`;
  ordinal: number;
  immediateParentSpanId: RequirementSpanId | null;
  source: Requirement["source"];
  authority: "authoritative" | "pr_author_claim";
  sourceQuality: RequirementSourceQuality;
  sourceSection: string | null;
  start: number;
  end: number;
  text: string;
  priority: Requirement["priority"];
}

interface RequirementSpanSeed {
  version: 1;
  analysisContext: HybridAnalysisContext;
  spans: RequirementSourceSpan[]; // max 12
  contexts: RequirementContextSignal[]; // max 8, each text max 160 chars
  seedHash: string;
}
```

`immediateParentSpanId` is immutable original source adjacency, never an
admitted-list index. A contextual child may inherit only when that exact parent
is admitted in the same valid plan. Excluded or non-requirement intervening spans block
inheritance; no backward scan is permitted.

## One-call plan DTO and allowed-axis matrix

```ts
const HYBRID_PLANNER_CONTRACT_VERSION = "hybrid_requirement_planner.v1" as const;
const HYBRID_PLANNER_PROMPT_VERSION = "2026-08-12.v1" as const;
const HYBRID_PLANNER_SCHEMA_VERSION = "agentproof_requirement_span_plan_v1" as const;
const HYBRID_PLANNER_MODEL = "gpt-5-mini" as const;

interface LlmRequirementSpanDecision {
  span_id: RequirementSpanId;
  disposition: PlannerDisposition;
  classification: PlannerClassification;
  parent_span_id: RequirementSpanId | null;
  // A generated canonical enum token ("none" or ordered subject:polarity pairs).
  // The server deterministically decodes it to the same allowed axis-pair set.
  expected_axes: PlannerAxisSet;
}
interface LlmRequirementSpanPlan {
  contract_version: typeof HYBRID_PLANNER_CONTRACT_VERSION;
  schema_version: typeof HYBRID_PLANNER_SCHEMA_VERSION;
  seed_hash: string;
  // The seed-specific keys d_0 ... d_n preserve source order without an
  // unsupported heterogeneous array tuple schema.
  span_decisions: Record<`d_${number}`, LlmRequirementSpanDecision>;
}
```

The provider schema is generated only from a valid, currently hash-bound seed.
It permits exactly these four root keys, exact `d_0 ... d_n` decision keys, and
exact decision keys. Each fixed decision schema binds its span ID and parent,
and encodes its authority combinations. The canonical axis-set enum represents
only valid unique axis subsets of at most four pairs. It has no text-bearing
field. The server decodes the enum back to the same semantic axis pairs and
still validates the full plan before use.

| Subject | Allowed polarity |
| --- | --- |
| `implementation`, `documentation`, `ci_configuration`, `targeted_test`, `visual`, `interaction`, `execution` | `present` only |
| `implementation` | `absent` also, but never together with `present` |

All other pairs, duplicate subjects, duplicate pairs, and opposing
implementation polarities are rejected. `admit` may carry an allowed canonical
axis-set enum; `exclude` requires the `none` enum. Authoritative spans must always use `admit`; their
classification is non-status planning metadata and cannot remove or change
source materialization. `exclude` is legal only for `pr_author_claim`. A PR
span is materialized only when `classification` is `requirement` and disposition
is `admit`; `not_requirement` and `mixed_or_uncertain` require `exclude` and
yield the bounded limitation.
`parent_span_id` must exactly echo the seed parent. Unknown, duplicate, missing,
reordered, wrong-parent, wrong-version, wrong-hash, or extra-key output
invalidates the whole plan.

The package contains only exact bounded redacted span text, source authority,
source-quality/section category, bounded context metadata, versions, and seed
hash. It contains no evidence, code excerpt, path, check, URL, SHA, patch, log,
or token. The system prompt treats every input field as untrusted data and
requests IDs/enums only. It uses `store:false`, 12,000 serialized UTF-8 input
bytes maximum, 3,200 output tokens, and a 16,384-byte parsed-output limit.

Worst-case compact output is feasible: 12 fixed-key decisions with exact IDs,
the longest classification, and the longest valid four-axis canonical enum
currently measure 2,884 UTF-8 bytes including root fields when exhaustively
constructed from valid Task 1 span/group layouts. The plan test constructs this
maximum from the schema constants and asserts its serialized
size is at most 4,608 bytes. The 16,384-byte validator limit leaves more than
3× margin;
the 3,200-token provider cap is therefore nonbinding rather than truncating a
valid maximum response. Candidate 13 or input-byte overflow makes zero POST.

## Finalization and explicit authority

Only a fully valid plan is finalized. Planner classification is admission
metadata, not a requirement status. The server assigns final proof status:

| Valid plan decision | Materialization |
| --- | --- |
| authoritative `admit` with any classification | exact source requirement; server proof and deterministic vague/manual rules decide status |
| PR `admit` + `requirement` | exact author-claim requirement; server proof decides status, capped `partial` |
| PR `exclude` + `not_requirement` or `mixed_or_uncertain` | no requirement; one bounded limitation per report |

The server builds the mandatory deterministic floor with
`requirementProofAxisExpectations(exactSpanText)`, including explicit
documentation/CI/test/no-implementation/visual/interaction and risk-triggered
test/execution obligations. For an admitted span the effective set is:

```text
deterministic mandatory floor
UNION valid planner expected_axes
UNION server execution companion for implementation/CI/targeted_test
UNION contextual axes only from the original direct admitted parent
```

This closes the authority boundary: planner-selected allowed axes are enhanced
applicability authority and may cause server-generated gaps/status changes.
Mandatory deterministic axes cannot be removed; the model cannot name a gap or
state. `plannerAxisSubjects` records only added planner axes. `unclear` is
never `met`; author claims are never above `partial`; met-plus-gap is invalid.

Before union, the server cross-validates planner pairs against the deterministic
floor. A plan is rejected if the combined set contains opposite polarities for
one subject. `implementation:absent` is valid only when the floor has no
`implementation:present` and the deterministic no-implementation policy applies
to that exact span; otherwise the whole plan uses BASE HEAD fallback. Tests
cover floor-present plus planner-absent and planner-present plus floor-absent
conflicts.

## Single fallback matrix

| Condition | Provider POST | Output |
| --- | ---: | --- |
| disabled, ineligible, consent absent, no spans | 0 | exact BASE HEAD report |
| candidate 13 / input-byte overflow | 0 | exact BASE HEAD report + bounded overflow limitation |
| valid pilot seed, then provider/timeout/JSON/schema/hash/stale/finalization failure | 1 | exact BASE HEAD report + bounded pilot-fallback limitation |
| fully valid plan | 1 | hybrid finalizer output; authoritative spans are server-materialized and PR mixed/uncertain spans are omitted with limitation |

“Exact BASE HEAD report” means the unchanged deterministic report for the same
input and fixed clock, plus only the specified bounded limitation. No untrusted
plan can materialize or remove an authoritative requirement. No fallback may
retry/re-submit. Background expiry, uncertain submit, missing job hash, and
retrieval mismatch use the third row.

## Seed binding, provenance, and compatibility

`seedHash` is SHA-256 over canonical UTF-8 JSON containing seed version,
analysis context, ordered span IDs/group/ordinal/parent/authority/source
quality/section/offsets/exact redacted text, bounded contexts, source
provenance origin/head/base SHA, a transient SHA-256 identity for the selected
requirement-authority object, and frozen contract/schema/prompt/model versions.
GitHub ingestion derives that identity from the normalized lower-case
repository plus selected Issue number, PR-description identity, or provided-task
identity. Only its digest enters the seed binding; the raw reference and digest
are absent from the provider package, report, telemetry, and logs. A GitHub
pilot input with a missing or malformed identity fails closed. The plan must
echo only the aggregate seed hash.

The seed has exactly one selected source family: `linked_issue` has only
authoritative `issue` spans/contexts, `provided_requirement` has only
authoritative `task` spans/contexts, and `unlinked_pr` has only
`pr_description` / `pr_author_claim` spans/contexts. The seed-only extractor
filters essential-extraction contexts to this selected source before its 8 ×
160 caps; essential extraction itself remains unchanged. Hashing, packaging,
schema generation, and response validation reject a source/authority/context
that violates this invariant.

The provider schema defines the shared 141 admitted axis-set enum once under
`$defs` and uses `$ref` from decision branches. A 12-span generated schema is
bounded below 1,000 aggregate enum occurrences, 5,000 object properties, 10
nesting levels, 120,000 aggregate schema-string characters, and a conservative
20KB schema/request-config byte cap.

New migration `supabase/migrations/202608120001_hybrid_planner_pilot.sql` adds
`hybrid_planner_requested boolean not null default false` plus nullable
`planner_contract_version` and `planner_input_hash` to analysis jobs. The
boolean is a privacy-safe enqueue-time protocol discriminator: migrated/active
legacy jobs remain `false`, while a newly eligible pilot enqueue atomically
sets `true` before dispatch. A claimed requested job binds the version/hash
pair before the sole background POST. Each GET/finalization rebuilds
the selected-authority identity and seed and requires job hash == rebuilt hash
== response hash. Mismatch falls back; no re-submit. Only `requested=false`
with explicit null fields marks an active legacy job. `requested=true` with
null fields is a not-yet-bound pilot intent and cannot cross the provider
boundary until binding succeeds.

Pilot reports persist no plan or span text, but add optional signed/sanitized
provenance:

```ts
interface HybridPlannerProvenance {
  version: 1;
  contractVersion: typeof HYBRID_PLANNER_CONTRACT_VERSION;
  schemaVersion: typeof HYBRID_PLANNER_SCHEMA_VERSION;
  promptVersion: typeof HYBRID_PLANNER_PROMPT_VERSION;
  model: typeof HYBRID_PLANNER_MODEL;
  inputHash: string;
}
type RequirementClassificationBasis = "deterministic" | "enhanced_plan";
VerificationReport.planner?: HybridPlannerProvenance;
RequirementFinding.classificationBasis?: RequirementClassificationBasis;
RequirementFinding.plannerAxisSubjects?: RequirementProofSubject[];
RequirementProofNode.classificationBasis?: RequirementClassificationBasis;
```

The canonical signature, validation, tenant sanitizer, dashboard, comment, and
Slack copy preserve these optional fields. UI copy says “Enhanced planning
policy,” not “AI,” and never presents planning provenance as evidence. Legacy
reports without optional fields remain valid and readable.

## Consent, control plane, telemetry, and rollback

The same migration adds nullable
`hybrid_planner_consent_version text` to `agentproof_tenant_repository_grants`.
The only accepted value is `2026-08-12.v1`. `TenantRepositoryGrant`, grant
creation/update normalization, repository settings API, and repository settings
UI expose an explicit checkbox with this disclosure:

> Allow AgentProof to send bounded redacted private Issue and pull-request
> source spans to the configured provider for enhanced planning.

Revocation or switching away from enhanced mode clears the version atomically.
The worker checks exact version, enhanced mode, tenant allowlist, and global
`AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED === "true"` on **every** analysis before
building a package. The env variable is a global kill switch, not a rollout
default.

Telemetry uses a bounded aggregate in the existing audit/usage path: contract/
schema/prompt/model versions, input bytes, output bytes/tokens, elapsed ms, POST
count, and outcome/fallback code only. It stores no text, span ID, response ID,
prompt, or evidence. An operator immediately rolls back by setting
`AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED=false` and removing tenant IDs from the
allowlist; no automatic disable is promised. Expansion pauses for manual review
at p95 >35s or invalid/overflow fallback >5% of 100 eligible attempts.

## Verification gates

1. Punctuation/list/sentence boundaries only; no lexical predicate parser.
2. Mixed unlinked span uncertainty produces no requirement; authoritative span
   status remains entirely server-determined by deterministic source rules.
3. Axis pair matrix, four-axis limit, measured 2,884-byte generated maximum
   bounded by 4,608 bytes, 16KB output validation, and 12-span cap are tested.
4. Every fallback matrix row produces exact BASE HEAD plus its one limitation;
   only a valid plan can add planner applicability axes.
5. Hash-binding protects resumed background analysis; old jobs/reports and
   signatures remain compatible.
6. Explicit consent creation/update/revocation, kill switch, allowlist, API/UI
   disclosure, telemetry aggregation, and manual rollback are tested.
7. Full suite/typecheck/lint/build/diff/privacy scan and blind synthetic set
   pass before any allowlist expansion.
