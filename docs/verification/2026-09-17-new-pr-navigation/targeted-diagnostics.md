# Targeted navigation diagnostics — 2026-09-17

## Scope

One sequential `gpt-5.6-luna` pass tested only the three previously uncertain public PR types: Vite refinement stability, HTTPX runtime-boundary validity, and Pydantic ranking/intent stability. The fixed base/head revisions were reused from `manifest.json`. Inputs used the current public GitHub API title/body and local fixed-revision Git snapshots.

This is not an exact replay of the earlier collection packet: the title/body digests differ from the earlier public-collection path. Therefore it can reproduce behavior for the same code revisions, but cannot prove that a prior failure was fixed rather than avoided by changed source text or nondeterministic model output.

## Observed result

| Case | Calls | Navigation | Safe failure reason | Runtime boundary |
| --- | ---: | --- | --- | --- |
| Vite #23499 | 3 | ready / partial | none | valid |
| HTTPX #3785 | 3 | ready / partial | none | valid |
| Pydantic #13819 | 1 | fallback / partial | `intent: unsafe_summary` | valid |

- Vite completed the bounded second read/ranking round. The implementation and test were first inspection locations; the earlier refinement failure did not recur.
- HTTPX selected `requirements.txt` first and passed the generated-private-full runtime boundary. The earlier boundary failure did not recur.
- Pydantic failed before ranking because the intent summary triggered the local source/code-copy guard. This is the first run that identifies the reason instead of only reporting `invalid_json_or_shape`.

Usage for the durable pass: 7 calls, 27,345 input tokens, 5,401 output tokens, 32,746 total tokens, and 84.765 seconds accumulated provider latency. The persisted result contains only revision IDs, SHA-256 title/body digests, paths, state, closed reason codes, boundary codes, and usage. A scan found no credential or rejected raw-content markers.

## Interpretation

The current evidence does not support a broad ranking or validator change. Vite and HTTPX are not reproducibly failing under this packet. Pydantic supplies one concrete, privacy-safe target for future reliability work: reduce source/code copying in intent summaries without weakening the copy guard.
