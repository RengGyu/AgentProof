# Ten new public PR review-navigation evaluation

## Result

**OBSERVED:** One fixed run per PR used **gpt-5.6-luna**, public Git snapshots, PR title/body as author-claim input, changed-file patches, and bounded exact-head reads. The model made **24 calls** over **10 PRs**: 98,737 input plus 19,009 output tokens (117,746 total). Total provider latency was 197.627 seconds; the sequential case latencies summed to 213.946 seconds. No retry, case replacement, model substitution, or prompt tuning occurred after results were observed.

The pre-call internal-silver reference is [silver-reference.json](silver-reference.json); fixed source revisions are [manifest.json](manifest.json). It was produced by the Terra supervisor from titles and changed-file inventories before Luna output, is never fed to the product model, and is **not human gold**.

| PR | Goal comparison | First location vs silver | Navigation result | Boundary |
| --- | --- | --- | --- | --- |
| Flask #5918 | aligned | hit / hit@3 | ready, partial | valid |
| HTTPX #3785 | missing: intent output rejected | miss / miss | unavailable, fallback | invalid |
| Starlette #3552 | aligned | hit / hit@3 | ready, complete | valid |
| FastAPI #16370 | aligned | hit / hit@3 | ready, partial | valid |
| Pydantic #13819 | aligned | miss / miss@3 | ready, partial | valid |
| Requests #7619 | aligned | hit / hit@3 | ready, complete | valid |
| Svelte #18835 | missing: intent output rejected | miss / miss | unavailable, fallback | valid |
| Express #7474 | aligned | hit / hit@3 | ready, partial | valid |
| Vite #23499 | aligned | hit / hit@3 | ready, partial | valid |
| Typer #1957 | aligned | hit / hit@3 | ready, partial | valid |

By the fixed case-level measure, goal alignment is **8/10**, First@1 is **7/10**, First@3 is **7/10**, navigation is ready for **8/10**, and the generated private runtime boundary validates for **9/10**. The HTTPX boundary failure is retained as an observation; its fallback report contained no model goal or code link, so it is not counted as a usable result.

## What this says

- The main failure is currently **intent-output reliability**, not an absence of changed-code candidates: HTTPX and Svelte both returned invalid intent JSON after a successful provider response, so the product correctly showed no invented goal or location.
- The Pydantic miss is a **ranking disagreement**, not a retrieval failure. The model chose detailed changed validator code first; the frozen silver expected the common GC helper or regression test. Its later candidate list did include both. This needs reviewer judgement before treating it as an actual bad recommendation.
- The eight ready reports show the desired limited flow: author claim → suggested review goal → exact-head code/test candidate. They do not verify the PR solution, CI execution, or merge readiness.

## Boundaries

- GitHub REST quota was unavailable, so execution/job status, linked Issue authority, and live freshness re-read were deliberately not claimed.
- The input was public PR description, therefore goals are author claims rather than maintainer-approved Issue requirements.
- These results measure navigation against a small model-authored silver set. They do not establish general accuracy, human-review time savings, or a regression/improvement against a matched ten-PR baseline.
- Raw source bodies, code contents, API keys, and raw provider responses were not written into this document. Per-run sanitized telemetry remains only in permission-restricted temporary files.

## Strict-schema rerun

**OBSERVED:** After changing the intent and ranking Requests API format from JSON mode to strict JSON Schema, the same ten PRs were run once again with gpt-5.6-luna. All ten head/base revisions and the collected title/description digests matched the earlier run. There was no retry, replacement, model substitution, or prompt change.

| Measure | Before | Strict-schema rerun |
| --- | ---: | ---: |
| Intent format failures | 2/10 | 0/10 |
| Ready navigation | 8/10 | 10/10 |
| Fallback navigation | 2/10 | 0/10 |
| First@1 against internal silver | 7/10 | 9/10 |
| First@3 against internal silver | 7/10 | 10/10 |
| Runtime boundary valid | 9/10 | 9/10 |
| Provider calls | 24 | 29 |
| Total tokens | 117,746 | 148,101 |
| Provider latency | 197.627 s | 239.472 s |

HTTPX and Svelte, the two prior intent-shape failures, now each produced a ready navigation card and a silver-matching first location. Vite had one refinement-stage invalid-shape failure, but the valid first-round selection was retained; its navigation remains ready. The unchanged HTTPX runtime-boundary failure remains a separate issue and is not explained by this rerun.

This is direct evidence that strict schema removed the observed intent-format failures for this fixed sample. It is not proof that the schema alone caused every First@1/3 change: model output and optional exact-head reads can vary between runs. The rerun also used five more provider calls and 25.8% more tokens, so the next decision must weigh reliability against that measured cost.
