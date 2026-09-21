# 10 PR navigation accuracy review

## Scope and evidence

Supervisor source/code audit of the saved authenticated Gemini responses, not an independent A/B silver consensus or human-gold evaluation. No product changes or additional model calls were made for this review.

Inputs: `authenticated/results.json`, the per-case responses, `/private/tmp/agentproof-accuracy-20260920/cases.json`, and exact base/head Git objects in the local repositories identified by those packets.

Assess only source-goal understanding, a useful first inspection location, and factual grounding of the first recommendation. Secondary explanations were spot-checked, not exhaustively scored. Do not infer implementation correctness, test execution, merge readiness, repository-wide recall, or reviewer time savings.

The two regression cases are Flask #5918 and Starlette #3552. The other eight are new cases from repositories already used previously, not unseen-repository holdouts. Express has no substantive source goal and is retained as a separate no-goal case, not silently dropped or counted as a successful code recommendation.

## Results

| PR | Source interpretation | First recommendation | Qualification |
|---|---|---|---|
| Flask #5918 | Main goal and associated changes preserved | Useful: `src/flask/sansio/app.py:604–671` | OPTIONS registration is at 660–671. One uncertainty sentence was visibly damaged by text replacement. |
| Starlette #3552 | Missing payload and invalid UTF-8 cases preserved | Useful: `starlette/endpoints.py:104–118` | Both relevant error branches are present. |
| HTTPX #3783 | Method-preserving redirect option preserved | Useful function entry, incomplete slice: `httpx/_client.py:492–511` | Actual `keep_method_for_redirects` condition is at 515–516, outside the supplied slice. The model explicitly admits truncation. A secondary candidate incorrectly calls BaseClient.__init__ Client.__init__. |
| FastAPI #16372 | TypedDict purpose and backward compatibility preserved | Useful: `fastapi/types.py:10–29` | Required/optional tag and external-doc fields are visible. This does not prove IDE or type-checker behavior. |
| Pydantic #13836 | V1/V2 import distinction preserved | Useful: `pydantic/v1/_hypothesis_plugin.py:32–38` | V1 alias/import directly visible. |
| Requests #7589 | All five described changes retained as facets | Useful: `src/requests/utils.py:930–935` | Proxy optimization is a legitimate starting point; it is not the only acceptable first location. Other four changes are separately linked. No measured speedup is established. |
| Svelte #18839 | Removal of special :export handling understood | Wrong first location: `css-prune.js:23–33` | Line 23 closes whitelist_attribute_selector, not a pseudo-class set. The actual removal is in prune/ComplexSelector, base 146–161 → head around 146–154. That relevant region already exists as a secondary candidate (137–214). |
| Express #7477 | No goal invented from template-only description | Not applicable: no navigation goal | No-goal handling is appropriate; this audit does not establish the quality of the separate change-summary UI. |
| Vite #23534 | Explicit false mapping versus ordinary builtin warnings preserved | Useful: `rolldownDepPlugin.ts:112–155` | The exact sentinel/suffixed-sentinel branch is at 124–133. A secondary review question was visibly damaged by text replacement. |
| Typer #1956 | Command-typo suggestion goal preserved | Useful entry: `typer/suggestions.py:1–35` | Class setup and typo classification are shown; ranking and runtime integration require the linked additional locations. Uncertainty about unseen helpers is not evidence they are absent: format_suggestion_message exists at 101–102. |

## Bounded counts

- 10/10 responses use the prepared base/head revisions.
- All 98 returned artifact references were read from the exact Git revision. Path, line range and SHA-256 of the referenced LF-joined lines matched: 98/98. This checks provenance, not relevance.
- Of 9 cases with substantive goals, the main goal is preserved in 9/9 by supervisor judgment. This is not exhaustive condition/exception recall.
- Useful first inspection entry by supervisor judgment: 8/9. Svelte fails. HTTPX is included only as a useful function entry, not sufficient in-card context.
- Seven of those nine avoid the observed Svelte wrong-location and HTTPX missing-core-branch problems. Do not equate this count with full context completeness or general accuracy.
- The first-location explanations have one clear semantic fabrication in nine: Svelte. At least one additional naming error exists in secondary text (HTTPX BaseClient). No all-explanations precision is claimed.
- Express is reported separately; no 9/10 or 10/10 overall accuracy claim is justified.

## Comparison with previous runs

Against `../2026-09-19-gemini-context-retest/comparison.json`, Flask and Starlette retain the same first location, revision and snippet hash, with semantically equivalent main goals. No first-location improvement or regression was observed in those two repeated cases. Wording and candidate lists still vary.

The eight new cases differ from the old ten-PR Luna set. A model-to-model accuracy delta cannot be computed from these runs. The earlier unauthenticated GitHub failures are collection failures, not model semantic failures, and are not mixed into this semantic comparison.

## Interpretation

The strongest concrete remaining issue is not failure to understand every goal: it is choosing and describing the right code within the available candidates. Svelte had the relevant code available but chose another range and invented its connection. HTTPX found the correct function but its provided range omitted the key condition. These are different observed failure classes; this audit alone does not establish their deeper algorithmic cause or justify tuning to these cases.

The unsafe_summary warnings in Flask/Vite did not remove their useful first recommendations, but substitutions such as “the referenced code” made two sentences ungrammatical. This is output readability loss, separate from first-location accuracy.

Remaining uncertainty: independent blinded A/B judgments, human reviewer usefulness, repeated-run variance, full secondary-explanation precision and generalization beyond these cases have not been measured here.
