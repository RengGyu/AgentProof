# 10 PR Pro Preview navigation comparison

## Scope and evidence boundary

This compares the authenticated Preview run in this directory with
`../2026-09-20-accuracy-10/authenticated/`. The current deployment was
`dpl_BygYLKfWpgwazGT8sTvSKJhUGsP9`, built from `e4046993f924a93e93810052fa6619ad1d96b2c8`
plus the active Pro follow-up diff (`d72618770c3bda1d22a76cbdb2f3abdba2f223965066e96857e8a426ccba7cc0`).

- **VERIFIED:** all 10 current requests returned HTTP 200 with `error: null`,
  the expected base/head pair, and `gemini-3.8-flash` in navigation metadata.
- **VERIFIED:** all 120 current artifact references name either that case's
  expected base or expected head revision. This is anchor provenance; source
  lines and reported hashes were not independently re-fetched in this run.
- **VERIFIED:** the source-unit id/hash/length fingerprint equals the 9/20
  baseline in 9/10 cases. Pydantic #13836's PR-description source changed
  from 1,293 to 1,709 characters while its title and code revisions remained
  the same. It is therefore not a strict same-input semantic comparison.
- **UNCLEAR:** provider token usage and monetary cost. Neither response exposes
  them, so this report does not estimate either value.

The individual current reports retain the bounded report/recommendation output
needed for review. No GitHub token, raw provider transport response, or raw code
dump is included in this comparison.

## Outcome summary

| Set | Exact base/head | Same source fingerprint | Ready rankings | No-goal case |
| --- | ---: | ---: | ---: | ---: |
| 9/20 baseline | 10/10 | baseline | 9/10 | Express #7477 |
| Current Preview | 10/10 | 9/10 | 8/10 | Express #7477 |

The current non-ready cases are not equivalent:

- **Flask #5918 — FAILED navigation ranking:** source goals were produced, but
  ranking failed with `invalid_json_or_shape` / `provider_invalid_json`.
  There is no first inspection artifact or candidate, so this must not be
  counted as a successful recommendation.
- **Express #7477 — VERIFIED no-goal handling:** both runs return no goal with
  `no_interpreted_goal`; it remains outside recommendation-success counts.

For the eight substantive cases with unchanged source fingerprints, the current
run preserves the principal source goal in supervisor review (8/8), but only
seven have a usable first candidate because Flask has none. The prior audit had
seven useful first candidates in the corresponding source-stable set: Flask was
useful while Svelte was wrong. This is no aggregate first-location gain; the
failure moved from Svelte to Flask. Including the input-changed Pydantic case,
the headline count is 8/9 first candidates in both runs.

## Recommendation, context, and explanation comparison

| PR | Current result versus 9/20 baseline | Evidence-limited judgment |
| --- | --- | --- |
| Flask #5918 | Main OPTIONS goals are split into three goals, but ranking is unavailable and no first location is emitted. | **FAILED:** a usable recommendation regressed because provider output did not validate. Goal text alone is not a replacement. |
| Starlette #3552 | Same `starlette/endpoints.py:104–118` diff location; current explanation directly names bytes checking, Unicode handling, close, and raise path. | **SUPERVISOR JUDGMENT:** stable and useful. |
| HTTPX #3783 | First location changes from `httpx/_client.py:492–511` to `496–528`, now including the prior missing `keep_method_for_redirects` branch. | **SUPERVISOR JUDGMENT:** targeted improvement in context completeness; this corrects the prior slice limitation. |
| FastAPI #16372 | Same `fastapi/types.py:10–29` diff location and TypedDict/backward-compatibility goal. | **SUPERVISOR JUDGMENT:** stable type-definition entry; caller context is needed before treating the compatibility claim as fully reviewable. |
| Pydantic #13836 | Same first location and code revisions, but PR-description fingerprint changed. | **UNCLEAR:** the result appears consistent, but it is excluded from strict A/B semantic scoring. |
| Requests #7589 | First location broadens from `utils.py:930–935` to `911–939`; all five change facets remain represented. | **SUPERVISOR JUDGMENT:** still a useful proxy-resolution starting point; broader range is not evidence of better precision. |
| Svelte #18839 | First location moves from the previously wrong `css-prune.js:23–33` to changed lines `146–153`, the known removal site. | **SUPERVISOR JUDGMENT:** concrete first-location correction. |
| Express #7477 | No goal in either run. | **VERIFIED:** correct no-goal separation; not a code recommendation. |
| Vite #23534 | Same `rolldownDepPlugin.ts:112–155` location, with the bare-versus-suffixed sentinel distinction retained. | **SUPERVISOR JUDGMENT:** stable. The prior visibly damaged secondary wording is absent from the current first question, but this is readability evidence, not an accuracy metric. |
| Typer #1956 | First location changes from class setup (`suggestions.py:1–35`) to matching logic (`37–67`). | **UNCLEAR:** the new location is plausibly relevant, but this run did not independently re-audit its full helper context. |

The current report has 11 goals and 120 artifact references versus 9 and 98 in
the baseline. Those are output-shape differences, not recall or accuracy
metrics. The same caveat applies to facet-count changes: they may reflect model
variation, normalization, or the Pro safety boundary rather than a semantic
improvement.

## Timing and cost boundary

| Metric | 9/20 baseline | Current Preview | Delta |
| --- | ---: | ---: | ---: |
| Total wall time | 240,470 ms | 271,933 ms | +31,463 ms (+13.1%) |
| Mean per request | 24,047 ms | 27,193 ms | +3,146 ms |
| Median | 26,593 ms | 23,232 ms | -3,361 ms |
| P95 | 30,872 ms | 40,823 ms | +9,951 ms |

This is one sequential run of a remote model and GitHub collection path. It is
not a latency regression conclusion, and it contains no token-usage or dollar
comparison.

## Interpretation and next decision

The current run fixes two observed reviewer-facing defects from the baseline:
Svelte now starts at the actual removal, and HTTPX includes the key condition.
It also introduces one material availability regression: Flask has no ranked
recommendation because the provider output failed shape validation. The strict
input mismatch for Pydantic prevents a full ten-case semantic A/B claim.

**NO-GO:** do not claim a general accuracy, explanation-quality, cost, or
performance improvement from this run.

**RECOMMENDATION:** if a follow-up evaluation is authorized, freeze Pydantic's
PR description before replay and investigate the Flask `provider_invalid_json`
failure with a deterministic fixture. Both are separate actions; neither was
performed here.

## Follow-up exact-revision utility audit

This follow-up is separate from the single-run comparison above. It fetched the
public base/head Git objects for the nine non-Flask repositories and read only
the first recommended range plus the minimum changed helper, caller, or test
context needed to evaluate reviewer usefulness. No tests were run, and a changed
test is evidence of coverage intent, not execution success.

| PR | Exact code evidence read | Utility judgment |
| --- | --- | --- |
| Flask #5918 | No current first artifact exists because ranking failed. | **FAILED:** no reviewer starting point to audit. |
| Starlette #3552 | `starlette/endpoints.py:104–121` contains the missing-payload branch, UTF-8 decode catch, 1003 close, and JSON parse catch. `tests/test_endpoints.py` adds direct missing-payload and invalid-UTF-8 cases. | **Useful:** the recommendation describes the actual changed branch and leads directly to the two failure modes. |
| HTTPX #3783 | `httpx/_client.py:496–528` contains the 303 override, 301/302 gate, `keep_method_for_redirects` branch, and browser fallback. `tests/client/test_redirects.py` adds 301/302 preservation and 303 non-preservation cases. | **Useful:** unlike the earlier slice, this one contains the core condition and the immediate status-code boundary. |
| FastAPI #16372 | `fastapi/types.py:15–29` defines optional and required TypedDict fields. The backward-compatible union is at `fastapi/applications.py:219`, outside the first range. | **Partially useful:** it is the right type-definition entry, but a reviewer must follow the caller to verify the compatibility claim. |
| Pydantic #13836 | `pydantic/v1/_hypothesis_plugin.py:33–36` changes the V1 alias/import root; later same-file uses include `pydantic.EmailStr` and `pydantic.PyObject`. `tests/test_v1_hypothesis_plugin.py` adds import and strategy-registration cases. | **Useful:** the first range identifies the causal import change; it does not prove the tests were executed. |
| Requests #7589 | `src/requests/utils.py:911–939` replaces `get_environ_proxies` with `getproxies` after an outer bypass check. The minimal helper at `873–882` shows the removed wrapper only repeats that bypass decision before calling `getproxies`. | **Useful with helper context:** the candidate is a valid start, but the semantic equivalence question cannot be answered from the first range alone. |
| Svelte #18839 | `css-prune.js:146–153` removes the `is_icss_export` predicate from the `ComplexSelector` used decision. The retained comment still says “ICSS export rules.” | **Useful:** it names the actual removal and correctly flags the stale comment as the next review item. |
| Express #7477 | The exact diff is one added README sentence; the source description has no substantive requirement. | **VERIFIED no-goal:** no code recommendation is warranted, and no behavior claim follows. |
| Vite #23534 | `rolldownDepPlugin.ts:124–134` sends the bare browser-external sentinel to the empty namespace and suffixed IDs to the warning namespace. The changed optimize-deps test asserts no property-access warning in serve mode. | **Useful:** the location and explanation match the resolution split; the test supplies focused follow-up context without proving a run. |
| Typer #1956 | `typer/suggestions.py:37–67` implements matching/ranking. The same new file defines standalone `SmartTyperApp` at `135–179`; only `suggestions.py` and its test file change, and `typer/__init__.py` does not export `SmartTyperApp`. | **Partially useful:** the first range is the matching-algorithm entry, but it cannot establish integration into Typer’s normal command-execution path. |

**VERIFIED:** these are exact fetched base/head objects, not merely report
metadata. **UNCLEAR:** this is a bounded reviewer-tool audit, not a human-gold
accuracy score, full caller-graph review, or behavioral/execution validation.
