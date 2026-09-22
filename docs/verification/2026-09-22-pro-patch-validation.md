# Pro patch validation — 2026-09-22

## Scope and revision

- **VERIFIED:** `HEAD` is `e4046993f924a93e93810052fa6619ad1d96b2c8`; the requested predecessor is `7841f5e`.
- **VERIFIED:** the Pro delta changes nine paths: navigation base-side context and local safe-field omission, snippet handling, evaluation/projection coverage, and Vitest include configuration. No product source or test expectation was edited for this validation.
- **VERIFIED:** before this result note, `git diff --quiet HEAD -- src scripts vitest.config.ts` exited 0. The temporary explicit evaluation config was deleted after use.

## Executed checks

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec vitest run src/lib/review-navigation.test.ts src/lib/review-navigation-boundaries.test.ts src/lib/review-snippets.test.ts src/lib/review-snippets.regression.test.ts src/lib/gemini-navigation.test.ts src/lib/openai-semantic.test.ts src/lib/analysis-worker.test.ts src/app/api/analyze/route.test.ts scripts/pr-evidence-review-projection.test.ts --maxWorkers=1` | 1 | 8 files passed, `review-navigation.test.ts` failed; 258 passed, 6 failed, 1 skipped (265 total). |
| `pnpm exec vitest run --config vitest.pro-eval.config.ts --maxWorkers=1` | 0 | Explicit-only `scripts/pr-evidence-review-evaluation.test.ts`: 9 passed, 1 skipped (10 total). The temporary config replicated the normal alias/JSX settings but replaced `test.include`; it was deleted afterwards. |
| `pnpm typecheck` | 0 | TypeScript typecheck passed. |
| `git diff --check` | 0 | No whitespace errors. |

The first attempt to make the explicit evaluation config by merging the default config retained its default `include` array and began running the default suite. It is not counted as the requested separate evaluation result; the corrected single-include config produced the recorded 9/1 result above.

## Previous evaluation failures

**VERIFIED:** the two failures documented in the Sep 21 handoff are no longer present in the explicit evaluation run:

- `evaluates all ten unmodified diverse fixtures and labels semantics and human usability as not evaluated`
- `runs the same ten cases with only the recorded issue source added as a separate profile`

The previous result was 7 passed, 2 failed, 1 skipped (exit 1), with `objectiveCount` 1 versus `generatedRequirementCount` 8. The current result is 9 passed, 1 skipped (exit 0). This establishes the current offline projection/evaluation assertions pass; it does not establish model navigation accuracy.

## Initial navigation regression failures (superseded by follow-up below)

**FAILED:** six expectations in `src/lib/review-navigation.test.ts` do not match the Pro behavior:

1. `retains independent same-file locations and the selected first artifact line` expects two candidates, but receives four because a modified deletion now supplies separate exact head and base artifacts.
2. `keeps unverified intent context through signed storage and rejects missing refs or raw copying` assumes a retained facet at the old index after unsafe-field handling.
3. `normalizes code facets and drops fenced questions while preserving safe siblings` expects the old replacement phrase `the referenced code`; the new behavior omits the unsafe field.
4. `retains candidate links and safe explanations despite an unsafe explanation in the same ranking` likewise expects replacement text, but receives an empty omitted field while the location remains.
5. `redacts only secrets and code while preserving safe surrounding explanations` expects a retained sentence fragment now omitted by the field-local guard.
6. `does not retain copied source code after whitespace normalization` expects the old rewritten sentence rather than omission.

These are local contract/expectation conflicts, not provider failures. The new `review-navigation-boundaries` tests passed inside the focused command: they cover exact base/head deletion references, renamed/removed files, missing-base refusal, bounded packet size, safe-field omission, credential redaction, private-repository refusal, and stale-source removal. The new projection test also passed inside that command, covering requirement identity, grouped-objective coverage, condition references, duplicate/unknown IDs, and empty input.

## Boundaries

- No actual PR/model run occurred; saved PR artifacts were not rerun and historical runs are not counted as this validation.
- Base/head reference preservation and safe-text omission are verified only by local tests. Their reviewer usefulness and live-model behavior remain unmeasured.
- No production build or full suite was run.

## Follow-up final verification

### Directly executed in this follow-up

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec vitest run src/lib/review-navigation.test.ts src/components/PrEvidenceReview.test.tsx --maxWorkers=1` | 0 | 2 files, 110 passed. |

**VERIFIED:** the six prior `review-navigation.test.ts` failures are absent from this direct run. The updated tests now assert the intended behavior rather than the superseded replacement phrase:

- A modified deletion can retain four independent candidate anchors: head and base at both changed ranges. The selected head anchor keeps its exact head SHA, line 40, and GitHub revision URL.
- For each `condition`, `exception`, `motivation`, and `implementation_claim` facet, an unsafe field is replaced only by the fixed omission notice while its kind and source range/hash remain; the safe sibling facet, open question, candidate, signed storage, Markdown/UI rendering, and runtime boundary are checked.
- Unsafe `whyInspect`, `reviewQuestion`, or uncertainty is omitted without removing the selected candidate. The current UI opens a candidate link as referenced lines even when `whyInspect` is omitted; base and head recommendations retain their corresponding revision URLs.

### Existing execution records read, not rerun here

- **REPORTED by** `/tmp/pro-regression-focused-final.log`: 10 files, 272 passed, 1 skipped, exit 0.
- **REPORTED by** `/tmp/pro-regression-evaluation-final.log`: explicit evaluation suite, 9 passed, 1 skipped, exit 0.
- **REPORTED by** `/tmp/pro-regression-typecheck-final.log`: `pnpm typecheck` exited 0.

Those records are distinguished from the direct two-file run above; this follow-up did not duplicate their broader test/typecheck execution.

### Remaining limits

- No actual PR or provider/model run occurred. These local results do not establish navigation accuracy, reviewer usefulness, or a live-model improvement.
- The full suite and production build remain unexecuted in this follow-up.
