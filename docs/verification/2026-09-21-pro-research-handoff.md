# AgentProof — current code and execution handoff

Prepared: 2026-09-21 (KST). This is a research checkpoint, not a release or an all-tests-passing claim.

## Start here

- Repository: `RengGyu/AgentProof`.
- Working branch: `codex/recover-bounded-target-20260913`. Use the commit containing this document, not `main`.
- Previous published checkpoint: `639cba137dc96652c5abd052ee4a1d187429acda` (2026-09-18). This checkpoint publishes the subsequent local changes and saved execution results. Compare against that commit to inspect the code delta.
- Remote `main` was still `5ed9519c291b118d880bed538659fae8327aadb9` when checked on 2026-09-21. Its date is not the last development date.
- No new live PR/model evaluation or production deployment was performed for this handoff. A Git push may independently trigger the repository's configured CI/Preview integration; that is not verified here.

Product objective: help a reviewer find and understand the code, tests and execution observations relevant to a PR's goals. Recommend where to inspect and what to check. Do not turn model relevance judgments into proof of correctness, requirement satisfaction or merge readiness.

Product entry paths include GitHub App webhook/worker automation and a separate manual analysis endpoint. Recent live evaluations called the analysis endpoint; they do not certify the complete installation-to-comment/dashboard workflow. See [the corrected product map](../learning/02-project-map.md).

## Code published in this checkpoint

These are existing local changes now being published, not new fixes made in response to the remaining accuracy issues:

| Area | Changes / where to read |
| --- | --- |
| Model context and retained candidates | `src/lib/review-intent.ts`: shared bounded packet, goal IDs as retrieval hints rather than authorization, retained candidate identity by artifact rather than path, automatic reads for incomplete diff context |
| Snippet construction | `src/lib/review-snippets.ts`: shared snippet budget, bounded Python indentation scanner, structural/fallback ranges and goal-term matching |
| Diagnostic metadata | `src/lib/review-navigation-diagnostics.ts`, `review-intent.ts`: request/output hashes, supplied range metadata, lifecycle/freshness/read events, usage/finish metadata; not full raw packets |
| Providers and endpoint | `src/lib/gemini-navigation.ts`, `src/lib/openai-semantic.ts`, `src/app/api/analyze/route.ts`: transport observations and operator-gated public-repository diagnostics |
| Evaluation | `scripts/pr-evidence-review-evaluation.ts`: optional separate local diagnostic output; related tests also included |

The Gemini adapter directly uses `@google/genai`. Its compatibility environment-variable name does not imply Vercel AI Gateway transport. Existing code still contains bounded supplied-artifact search, not complete repository-wide retrieval. Inspect actual code before deciding which limitation causes a particular failure.

## Saved live execution evidence

| Run | Read first | Meaning / limitation |
| --- | --- | --- |
| Sep 18 | [result](2026-09-18-gemini-contract-retest/result.md), [comparison](2026-09-18-gemini-contract-retest/comparison.json) | Flask/Starlette retest. Initial Starlette freshness failure and separate successful retry must both remain visible. Previous Luna comparisons changed more than the model. |
| Sep 19 | [result](2026-09-19-gemini-context-retest/result.md), [comparison](2026-09-19-gemini-context-retest/comparison.json) | Same two PR revisions, more context recovered. Per-case JSON includes `operatorNavigationDiagnostics`. |
| Sep 20 authenticated | [accuracy review](2026-09-20-accuracy-10/accuracy-review.md), [results](2026-09-20-accuracy-10/authenticated/results.json) | Ten PR results and individual report JSON. These are the primary current accuracy observations. |
| Sep 20 unauthenticated | [initial results](2026-09-20-accuracy-10/results.json) | Initial access/rate-limit failures, not ten model-semantic failures. Do not mix these with the authenticated run. |

Sep 19/20 saved results identify Preview `https://agentproof-gr8dslzh4-renggyus-projects.vercel.app` and model `gemini-3.8-flash`. Sep 19's record identifies deployment `dpl_Fx59M2G5e6uVHuj2P4gprtYynxrB`. The runs were made from an uploaded dirty worktree at the time; they are historical observations, not a fresh live run of this new commit. An immutable deployment-to-current-source-tree equivalence has not been independently established in this handoff.

On Sep 21, a local read of the authenticated summary confirmed 10 cases, no recorded request errors, 10 matching prepared base/head pairs, 9 returned goals and 98 artifact references. The earlier supervisor audit reports 98/98 exact-reference checks, main goal preservation 9/9 substantive cases and useful first entry 8/9. Those source-level checks were not rerun during publication. They are supervisor judgments, not independent A/B consensus or human gold; HTTPX counted as a useful entry despite insufficient supplied context. Express is a separate no-substantive-goal case. No general accuracy percentage or reviewer time saving is established.

## Remaining observed problems — do not assume their cause

| Observation | Evidence | What remains unknown |
| --- | --- | --- |
| Svelte #18839 selected `css-prune.js:23–33` and described it as the removed `:export` handling, while the relevant `137–214` range was another candidate | [saved report](2026-09-20-accuracy-10/authenticated/svelte-18839.json), accuracy review | Why selection/explanation failed; not proof of total retrieval failure. Base/deletion information, ordering and model variation are hypotheses. |
| HTTPX #3783 selected `_redirect_method` at 492–511, but the important condition was at 515–516 | [saved report](2026-09-20-accuracy-10/authenticated/httpx-3783.json), accuracy review | Which extraction, selection or budget step excluded the condition. A changed model alone cannot isolate this. |
| Flask/Vite sentences were damaged by replacement with `the referenced code`, while useful recommendations survived | [Flask](2026-09-20-accuracy-10/authenticated/flask-5918.json), [Vite](2026-09-20-accuracy-10/authenticated/vite-23534.json), `safeSummary` in `review-intent.ts` | A general correction that preserves privacy without distorting readable explanations has not been validated. |
| Two offline evaluation assertions fail in the current checkpoint | Fresh local verification below | Whether the expected count is stale, grouping behavior is wrong, or both. Do not change assertions only to make the run green. |

All known cases are development/diagnostic cases, not fresh holdouts. Do not add PR-, repository- or filename-specific exceptions. Decide what additional evidence distinguishes competing causes before choosing a fix. Token reduction is not a reason to sacrifice the core review context; no new token-reduction acceptance target is imposed here.

## Fresh local verification — Sep 21

### Focused product tests

```sh
pnpm exec vitest run src/lib/review-navigation.test.ts src/lib/review-snippets.test.ts src/lib/gemini-navigation.test.ts src/lib/openai-semantic.test.ts src/lib/analysis-worker.test.ts src/app/api/analyze/route.test.ts
```

Observed: **6 test files passed; 241 tests passed, 1 skipped**; exit 0. These are local focused tests, not live model evaluations. `pnpm typecheck` also exited 0.

### Separate evaluation tests

`scripts/pr-evidence-review-evaluation.test.ts` is not included by the default `vitest.config.ts` patterns. Naming it on the default command line did not run it. A temporary configuration inherited the normal configuration and replaced `test.include` with `['scripts/pr-evidence-review-evaluation.test.ts']`; it was then run explicitly.

Observed: **7 passed, 2 failed, 1 skipped**; exit 1. Failures:

- `evaluates all ten unmodified diverse fixtures and labels semantics and human usability as not evaluated`
- `runs the same ten cases with only the recorded issue source added as a separate profile`

Both fail `expect(item.objectiveCount).toBe(item.generatedRequirementCount)` (lines 153 and 195 at this checkpoint): observed objective count 1, expected generated requirement count 8. This is an offline projection/evaluation assertion, not a newly observed Gemini failure. No test expectation or product logic was changed to conceal it.

To reproduce, use the existing configuration with only that `test.include` override; keep the root at the repository. Do not claim this suite ran merely because it appeared in a default Vitest filter. The full suite and production build were not rerun for publication.

## Available data and gaps

- Saved report JSON contains PR URLs, analyzed base/head commits, summaries, recommendation text, references, hashes and limitations. Use the exact commits when inspecting the evaluated repositories, not their latest branches.
- Sep 19 has stage diagnostics; the authenticated Sep 20 per-case JSON does **not** retain detailed stage packets/transport traces. Full original model inputs and raw provider responses are not supplied. Hashes alone cannot reconstruct missing text.
- PR/Issue text can change independently of a code commit. Fetching today's PR text is not proof of reproducing the frozen historical source. Use recorded source hashes to check identity, or label the comparison as a new-source run.
- Local temporary clones/input packets referenced in the accuracy audit are not GitHub-accessible and are not included here. Ask for a specific missing input if indispensable; do not claim to have read those paths.
- Results were scanned for common credential patterns and populated credential fields before publication; none were detected. No environment files, credentials, raw provider response bodies or full source-code dumps were added. This is not a guarantee that every possible secret format has been detected.

## Requested research outcome

Read the current code and the relevant saved results, distinguish observed failures from hypotheses, and propose the next direction. Implement justified general fixes against this checkpoint if the available tools permit; otherwise return an applicable unified diff, full contents of new files, and tests to run. Clearly separate executed verification from proposed verification. Do not return the whole repository. Do not invent missing traces, test outcomes or deployment state.
