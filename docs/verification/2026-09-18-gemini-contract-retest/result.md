# Existing PR retest — 2026-09-18

Preview: https://agentproof-2ioupab05-renggyus-projects.vercel.app

Deployment includes the current uncommitted navigation contract/snippet/diagnostics package, authenticated public-PR navigation diagnostics in `/api/analyze`, and a `node:crypto` → `crypto` import fix required by the Next.js client import graph. Preview build passed. Operator diagnostics remain authenticated; ordinary responses do not include the new diagnostics. Focused transport/route tests: 3 passed. Typecheck passed before the import-only correction; deployment typecheck passed after it.

## Observed results

| Case | Prior Luna | Current Gemini |
| --- | --- | --- |
| Flask #5918 | 5 goals; unknown_artifact_ref during refinement | 5 goals; no reference failures; first location src/flask/app.py; additional CLI and test locations retained |
| Starlette #3552 | 4 goals; unknown_artifact_ref during ranking | Initial request: stale_snapshot, 0 model calls. One retry: 1 goal + 4 facets; no reference failures; first location starlette/endpoints.py:104, test location tests/test_endpoints.py:222 |

Both PRs match prior full head/base commits. This is not a controlled model-only or implementation-only comparison: old model was Luna, current model is Gemini, execution environments differ, and prior complete input packets were not retained. Current source hashes are saved; some differ from old input hashes, and raw-versus-normalized source equivalence has not been established. Do not describe this as identical full input or a measured accuracy improvement.

Flask authenticated response and two stage diagnostics are saved in `flask-5918.json`; initial Starlette response is in `starlette-3552.json`. Successful Starlette retry used the ordinary endpoint and is saved in `starlette-3552-retry.json`, without detailed operator traces. `comparison.json` contains the initial runs; the Starlette retry file supersedes its initial outcome for the successful-result comparison while the initial failure must remain counted.

## Concrete remaining gap

Flask ranking received only six diff excerpts (5,105 artifact JSON bytes); only intent and ranking calls were observed. The selected sansio/app.py excerpt covers lines 612–631. Exact-head local Git inspection confirms automatic-options configuration logic and route creation continue after line 631. The model explicitly reports missing branches. The new Python expansion therefore did not supply those ranges in this Flask run. No reference error does not imply sufficient evidence.

Starlette retry preserves missing-payload, invalid-UTF-8, close code 1003, and author-reported test results in one goal and facets. Its artifacts include a 44-line snapshot test range (222–265), showing expanded test context is available. Full semantic accuracy and repeated-run stability remain unmeasured.

Flask current recorded provider time is 14.725 seconds across two calls; prior Luna provider time was 37.746 seconds across three calls. Current CLI roundtrip was 22.573 seconds. Different call counts and inputs prevent treating this as a model speed benchmark. Starlette initial snapshot failure cause remains unresolved; retry success alone does not establish the cause.

No new PR, production deployment, commit, or push was performed.
