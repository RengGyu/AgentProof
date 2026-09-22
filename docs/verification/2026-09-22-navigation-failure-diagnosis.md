# Same-PR rerun: failure and variation diagnosis

## Conclusion

**VERIFIED:** Flask's first ranking response failed JSON text parsing before local ranking-field, enum, or reference validation. All three interpreted goals survive, but have no candidates. The report and saved summary agree; this is not a recommendation lost by storage or rendering. **UNCLEAR:** why that response was not parseable. No response text, finish reason, usage, actual model version, or request trace from this invocation is saved in the inspected run directories.

**VERIFIED:** the diagnostic gap has a concrete runner cause. “Authenticated” here means GitHub authentication. The latest runner does not request operator diagnostics, and its saved-object allowlist also excludes them. The existing application can return text-free traces when the separate operator authorization is supplied. No new product instrumentation is needed merely to collect those existing traces.

## Evidence and boundaries

Compared `2026-09-20-accuracy-10/authenticated/` and `2026-09-22-accuracy-10-authenticated/`, including each results file and Flask report. Inspected current `e404699` plus the existing three-file follow-up, both local runners, and prior Flask diagnostics only. No product/test edits, deployment, network/model call, new raw-output logging, or external recovery were performed. The deployment/source association comes from the saved deployment review; deployed binaries were not independently recovered.

### Failure categories are not interchangeable

| Observation | Code path / certainty | Impact and minimum next check |
|---|---|---|
| Flask: `stage=ranking`, `category=invalid_json_or_shape`, `reason=provider_invalid_json` | `src/lib/gemini-navigation.ts:43–46`: nonempty text within the 48,000-character guard reaches `JSON.parse`; parse exception produces this reason. **VERIFIED code interpretation.** | First ranking never reaches local candidate processing. Raw syntax defect, wrapping text, incomplete JSON, etc. remain indistinguishable without the failed response or a safe parser diagnostic. |
| Same broad category can mean missing fields, enum violations, bad references, or unsafe explanations | `src/lib/review-intent.ts:175–197,504–524`: specific reasons distinguish `local_shape`, `unknown_artifact_ref`, `first_not_candidate`, `unsafe_summary`. | Do not diagnose this Flask failure from the broad category alone. The specific reason rules out these downstream checks as the recorded failure point. |
| Possible output truncation | Gemini sends `maxOutputTokens:6000` (`gemini-navigation.ts:36`), but a `MAX_TOKENS` response can still parse; malformed text with any finish reason becomes `provider_invalid_json`. | **HYPOTHESIS, not confirmed.** Next authorized run should retain `transport.finishReasons`, output/thought tokens, output bytes/hash. A limit setting alone does not prove exhaustion. |
| SDK/network/provider call exception | `gemini-navigation.ts:39–41` maps all generateContent exceptions to `provider_unavailable`; original status/message is not retained. | Such errors are conflated with each other, but do not produce this parse-specific reason. No evidence of transport-call failure in this Flask invocation. |
| Empty or oversized text | `gemini-navigation.ts:45` emits `provider_output_unavailable`. | Different from Flask's recorded reason. Character limit and transport UTF-8 byte count are different measurements. |
| No recommendations despite HTTP 200 | `review-intent.ts:470–481,499–540`: intent succeeds, first ranking throws, outer catch preserves goals and records semantic failure. `/api/analyze` returns a structurally valid report at `route.ts:184–206`. | HTTP 200 establishes response/report availability, not ranking success. `pr-evidence-review.ts:455–468` projects empty candidates faithfully. Saved report equals the saved navigation summary. |

The prior Flask run had `unsafe_summary` within the same broad category and retained a useful recommendation. That is a different failure mechanism. Sep 18/19 Flask traces exist, but are from successful older invocations and cannot explain the latest parse failure.

### Why the useful trace is missing

- Latest runner `/private/tmp/agentproof-approved-preview-retest.mjs:12,16` sends JSON containing the PR URL and GitHub token, without the operator diagnostic/version and ops authorization headers. Lines 22–25 save selected result fields and `report`, excluding `operatorNavigationDiagnostics` even if returned.
- Baseline runner `/private/tmp/agentproof-accuracy-live.mjs` likewise omitted those headers. It attempted to save a diagnostic field, but it was absent and JSON serialization omitted it.
- `src/app/api/analyze/route.ts:51–56,124–136,199–205` requires separate operator authorization and connects `onDiagnostics` only on that path. `review-intent.ts:399–402` attaches transport metadata before provider failure unwinds; `318–328` emits it on completion.
- `review-navigation-diagnostics.ts:10–21` retains metadata in a WeakMap, not durable raw provider output. Neither inspected ten-case directory contains request hashes, stage traces, actual response model versions, or token/finish data. An older raw response is not a substitute for the failed invocation.

**Minimum next check (requires separately authorized execution/operator access):** request and save the existing text-free operator diagnostics for the single failing case, including both successful and failed stages. This can identify truncation/finish behavior and packet differences; it cannot retroactively identify the old malformed character sequence. If syntax remains ambiguous, any new safe parser classification instrumentation requires separate code-change authority. No raw response collection is proposed or performed here.

## Why the reruns do not isolate model versus code effects

All base/head pairs and configured model names match. Source-unit metadata matches in nine cases; Pydantic's description length changes 1,293→1,709. Model name is configuration, not proof of identical serving model version or sampling state.

| Case | Goals old→new | Cumulative artifact refs old→new | Exact artifact tuples shared | Base refs old→new |
|---|---:|---:|---:|---:|
| Flask | 1→3 | 13→16 | 12 | 0→3 |
| Starlette | 1→1 | 11→12 | 11 | 0→1 |
| HTTPX | 1→1 | 4→10 | 3 | 0→0 |
| FastAPI | 1→1 | 10→17 | 7 | 0→7 |
| Pydantic | 1→1 | 2→3 | 2 | 0→1 |
| Requests | 1→1 | 15→22 | 6 | 0→5 |
| Svelte | 1→1 | 11→6 | 3 | 0→3 |
| Express | 0→0 | 0→0 | 0 | 0→0 |
| Vite | 1→1 | 16→18 | 16 | 0→2 |
| Typer | 1→1 | 16→16 | 9 | 0→0 |

Tuples compare path, side, revision, range and content hash. These are final cumulative supplied references, not reconstructed ordered per-call packets. Counts above 16 do **not** demonstrate a per-packet budget violation: `returned` accumulates across ranking/refinement and `finish()` projects that union (`review-intent.ts:320`).

**VERIFIED mechanisms:** Pro adds deleted base context (`review-intent.ts:297–304`) and parses original transient source for boundaries before output redaction (`review-snippets.ts:19–28,47–51`). Thus unchanged source prose/revisions do not imply unchanged model ranking input. Goal/facet wording, retrieval associations, readPaths and shared-budget selection can also change subsequent context. These mechanisms explain why an input-controlled comparison is needed; they do not prove which mechanism caused each better/worse recommendation.

Flask's 1→3 goal split precedes ranking: intent sends no artifact content (`review-intent.ts:394–397`); local normalization does not split one valid goal into several (`470–481`). Added base-side ranking context therefore is not a direct explanation for the split. Provider variation/version/settings remain possible, but exact request hashes and raw intent outputs are absent. The Svelte/HTTPX improvements and unchanged source-stable 7/8 first-location judgment are supervisor assessments from a single pair of runs, not causal or general accuracy evidence.

**Minimum comparisons:** first compare exact stage request hashes, goals/facets, ordered artifact IDs/ranges/hashes, read lifecycle and actual response model versions. Freeze Pydantic's description before any paired scoring. To isolate retrieval code, replay the same frozen input and fixed intent/read decisions locally through old/new collection logic. To measure model variance, only a separately authorized repeated run with identical packets/configuration can help. A new successful run alone would not establish the old failure's cause.

## Later single-case diagnostic — separate result, not a resolution

The records in `2026-09-22-flask-diagnostic/` were created after the ten-case
run and must not be folded into its outcome.

- `result.json` is **VERIFIED operator-authentication failure**: HTTP 401 with
  `ops_diagnostics_unauthorized`. It reaches no report, revision confirmation,
  or model stage, so it is neither a GitHub collection nor a model failure.
- `result-1790051998612.json` is a separate **VERIFIED successful diagnostic**:
  HTTP 200; actual base/head equal the expected Flask anchors; ranking is
  `ready`; and navigation `failures` is empty. It retains two bounded,
  text-free stage diagnostics. Both stages report a provider call; ranking's
  lifecycle records unchanged freshness, supplied reads, and a `STOP` finish.
- The successful diagnostic has bounded accounting metadata (intent:
  1,515 input / 629 output / 1,121 thought tokens; ranking: 9,466 / 1,284 /
  2,225; both `STOP`). These figures describe only that invocation and do not
  establish the cost, serving model identity, or malformed cause of the earlier
  ten-case Flask ranking response.

**UNCLEAR:** why the first Flask ranking response was malformed. A later
successful response proves that the same public PR and anchor can complete; it
does not reconstruct the earlier provider text or isolate model variation from
packet/retrieval differences.

## Timing and diagnostic validation

Saved end-to-end totals are 240,470→271,933 ms (+31,463 ms); Flask is 26,593→40,823 ms. The runner timer includes CLI startup, network and server work. No stage latency/usage data was saved, so neither more goals, more context, a token cap, nor model slowness is an established time/cost cause.

Read-only JSON comparison confirmed the counts above and Flask report/summary identity. Existing mocked adapter checks were run with `pnpm exec vitest run src/lib/gemini-navigation.test.ts --maxWorkers=1`: **10 passed**, log `/tmp/navigation-diagnosis-adapter.log`. They validate configured schema use, safe metadata handling, and acceptance of parseable `MAX_TOKENS` text; they do not reproduce or explain the actual Flask malformed response. No further execution is required to complete this evidence-limited diagnosis.
