# Phase 0 — Authoritative Output Safety Design

**Depends on:** `2026-08-25-evidence-outcome-backbone-program-design.md`

**Status:** Implemented and locally verified on 2026-08-25

**Promotion state:** Off

## Implementation evaluation record

**State:** Implemented on the isolated branch; no commit, push, or deployment.

- Added the pure `deriveRequirementPresentationV2` projection and used it in
  report, dashboard, Markdown, Slack, and export rendering paths.
- Kept `requirements[].status` as the strict contract outcome and
  `evidenceStatus` as the separate observed-evidence value.
- Checked with focused presentation/renderer tests, then the Phase 0–2 full
  verification commands recorded in the program design.

**Not implemented:** a new criterion evaluator or any new `met` promotion.

## 1. Goal

Make every output surface present one authoritative requirement outcome while
keeping observed evidence clearly separate. This phase changes no criterion
satisfaction capability and must not create a new `met` result.

## 2. Required semantic model

For each requirement, preserve two distinct values:

- `status`: strict contract outcome (`met`, `partial`, `missing`, `unclear`);
- `evidenceStatus`: observation coverage produced by the evidence graph.

The proof graph remains observational. Its node state must reflect observed
evidence, not the strict contract overlay. Contract objective results remain
the sole authority for `status`.

Introduce one pure, isomorphic presentation derivation, using the existing v2
report as input:

```ts
interface RequirementPresentationV2 {
  requirementId: string;
  outcome: "met" | "partial" | "missing" | "unclear";
  observedEvidence: "met" | "partial" | "missing" | "unclear";
  authority: "authoritative" | "author_claim" | "absent" | "invalid";
  outcomeLabel: string;
  outcomeBasis: string;
  observationLabel: string;
  primaryGap: string | null;
}

function deriveRequirementPresentationV2(
  report: VerificationReportV2,
  requirementId: string
): RequirementPresentationV2;
```

The function is a projection only. It cannot inspect raw source, patches,
logs, process environment, or caller-provided copy.

### Closed label mapping

`outcomeLabel` is derived from authority and outcome exactly as follows:

| Authority | Outcome | Label |
| --- | --- | --- |
| `authoritative` | `met` | `Supported against approved contract` |
| `authoritative` | `partial` | `Partially supported against approved contract` |
| `authoritative` | `missing` | `Not supported against approved contract` |
| `authoritative` | `unclear` | `Unclear against approved contract` |
| `author_claim` | `partial` | `Partially supported against PR-description contract` |
| `author_claim` | `missing` | `Not supported against PR-description contract` |
| `author_claim` | `unclear` | `Unclear against PR-description contract` |
| `absent` | `unclear` | `Unclear — approved verification contract missing` |
| `invalid` | `unclear` | `Unclear — verification contract invalid` |

`author_claim + met` and `absent/invalid + non-unclear` are invalid reports,
not additional display cases.

`observationLabel` maps only `evidenceStatus`: `met -> Supported`, `partial ->
Partially supported`, `missing -> Not supported`, and `unclear -> Unclear`.

`outcomeBasis` comes from a closed template selected by the same two fields; it
does not copy objective, criterion label, evidence summary, or LLM text.
`primaryGap` is selected deterministically:

| Authority | Outcome | `outcomeBasis` template |
| --- | --- | --- |
| `authoritative` | `met` | `All required criteria were satisfied by approved evidence.` |
| `authoritative` | `partial` | `At least one required criterion was satisfied and at least one was not satisfied.` |
| `authoritative` | `missing` | `All required criteria were violated by the collected approved evidence.` |
| `authoritative` | `unclear` | `Required criterion evidence was incomplete or unavailable.` |
| `author_claim` | `partial` | `This result uses a PR-description contract and requires reviewer confirmation.` |
| `author_claim` | `missing` | `All required criteria were violated, but the contract source remains an author claim.` |
| `author_claim` | `unclear` | `The PR-description contract could not be decided from the available evidence.` |
| `absent` | `unclear` | `No approved verification contract defined the requirement outcome.` |
| `invalid` | `unclear` | `The supplied verification contract could not be validated.` |

1. first entry of `report.verificationContract.gaps` in stored order;
2. otherwise the first non-satisfied entry of
   `report.verificationContract.objectives[].criterionResults[]` in objective
   and criterion order;
3. within that result, the first `gapKinds` entry in stored order; or
4. a closed state fallback when `gapKinds` is empty.

Renderers may localize these closed keys, but cannot choose a different gap or
stronger status.

## 3. Required output behavior

- `/api/analyze`, dashboard, saved detail, Markdown/JSON export, Slack, and
  GitHub comment use the same outcome label and basis.
- Evidence coverage remains visible but is labelled as observation coverage.
- `getVerificationAnswer` cannot infer a strict answer from legacy priority,
  coverage percentage, or global CI.
- A contract-missing report may say that implementation/test/CI observations
  were found, but its requirement outcome remains `unclear`.
- Re-prompt text may name only validator-approved criterion gaps. Legacy risk
  observations may be displayed separately and cannot imply criterion failure.
- LLM-enhanced copy cannot replace the derived outcome or basis.

## 4. Expected files

- Create `src/lib/requirement-presentation-v2.ts`.
- Create `src/lib/requirement-presentation-v2.test.ts`.
- Modify `src/lib/verifier.ts` to stop overwriting observational proof-node
  state.
- Modify `src/components/ReportView.tsx`.
- Modify `src/lib/dashboard-requirement-view-model.ts`.
- Modify `src/lib/dashboard-report-export.ts`.
- Modify `src/lib/markdown.ts`, `src/lib/slack.ts`, and the GitHub comment
  renderer that consumes requirement outcomes.
- Modify the corresponding renderer and projection tests.

Do not split unrelated verifier logic or rename public schema fields in this
phase.

## 5. RED acceptance matrix

Write failing tests before production changes:

1. authoritative contract + unavailable criterion + high observation coverage
   -> every output says outcome `Unclear` and observation `Supported` or
   `Partially supported` separately;
2. PR-description author claim + satisfied static criterion -> outcome remains
   `Partial` on every surface;
3. absent contract + implementation/test/passing CI observations -> no surface
   says the requirement is met;
4. contract outcome `missing` + unrelated passing CI -> no surface says mostly
   supported;
5. proof graph observation state remains unchanged when strict contract status
   is applied; and
6. LLM copy attempts to introduce a stronger status -> runtime finalization
   keeps the deterministic status and basis.

## 6. Mandatory validation

- focused tests for the presentation derivation;
- route, dashboard, Markdown, Slack, GitHub comment, share, and tenant tests;
- `pnpm test`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm build`;
- `git diff --check`.

## 7. Stop and rollback

Stop if this phase changes criterion evaluator states, contract authority,
evidence collection, report schema version, or privacy projection fields.

Rollback restores the old renderers but leaves requirement-local promotion
off. No data migration is allowed for Phase 0.

## 8. Completion gate

Phase 0 passes only when all output surfaces agree on strict outcome and
separately expose observation coverage. Renderer agreement is binary; a
weighted score cannot compensate for one contradictory surface.
