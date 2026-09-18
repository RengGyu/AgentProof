# Public PR source corpus — 60 cases

Offline preparation passed: 60 unique public merged PRs, six from each of ten repositories, zero frozen known-case overlap, 511 valid source labels, and zero model API calls. Human review is still pending for every label. This is a source-extraction benchmark package, not implementation-correctness evidence or a release decision.

## Start here

- `REVIEW.md`: original title/body plus per-label offsets, preliminary class, and rationale, grouped by PR.
- `review-pack.json`: directly inspectable labels with text, class, UTF16 offsets, rationale, and pending human acceptance.
- `corpus.json`: unchanged `requirement_source_ablation.v1` contract for the existing runner.
- `sources.json`: LF-normalized snapshots, public visibility receipts, merged status/date, head/base SHAs, and collection times. Null body status is recorded separately; no non-null empty body was manufactured.
- `validation-receipt.json`: counts, exact offline command, observed outcomes, and limitations.
- `integrity-and-coverage.json`: exact source hashes, lengths, and every unlabeled whitespace gap. `manifest.json` records final artifact-file hashes.

## Sampling and reproducibility

`protocol.json` was written before any source fetch. Each fixed repository was searched for `is:pr is:merged merged:2026-01-01..2026-09-09`, top 30 sorted by creation time descending. The frozen frame contains 17 Flask results and 30 for each other successful repository. Rank each canonical PR URL by ascending hexadecimal SHA256 of `agentproof-public60-v1|` plus URL. Exclude the 69 historical URLs frozen from root `docs/verification` and `eval`; take the first six eligible URLs per repository. `selection-ledger.json` records every ranked URL/hash and exclusion flag. Selection did not depend on title/body labels, product output, or model output. No selected case required privacy/size quarantine or replacement.

The original `golang/go` frame returned zero candidates, confirmed with an explicit repo-scoped search. Before fetching another repository, the supervisor approved replacing only that repository with `gofiber/fiber`. `protocol-amendment.json` records this feasibility-only change; `candidate-frames.json` preserves the original empty Go frame; `replacement-frame.json` preserves the Fiber frame. `status.json` is the historical shortfall receipt, not current failure status. The original protocol was not overwritten.

GitHub connector metadata-only operations used: `search_prs`, `get_pr_info`, `get_repo`. Only title/body and provenance/status fields were retained; unrelated actor metadata was discarded. Public source metadata may change after collection. Reproduce selection from the frozen frames rather than assuming a later live search returns the same frame.

## Label rubric and limits

All 511 labels are PRELIMINARY machine-proposed annotations, created by original-source reading before the existing runner executed. No evaluated-model or product-selector output was consulted for selection or labeling. They are not human gold. `annotation-decisions.json` preserves the explicit substantive decision spans.

- `requirement` (85): explicit change request, normative invariant, concrete dependency update, or action-oriented title describing proposed scope. This is author-stated intent, not external requirement authority and not verified implementation.
- `ambiguous` (41): retrospective/result description with possible normative intent, mixed context and behavior, or underspecified/qualified intent. Rationale is attached to each span.
- `non_requirement` (385): background, references, templates/process, disclosures, examples, execution claims, upstream release history, or out-of-scope future suggestions.

Seven cases naturally contain no positive requirement label; they were retained, not created to satisfy a quota. There was no label-driven resampling. All 95,390 non-whitespace UTF16 source positions are covered once, with exact source text and non-overlapping offsets. Whitespace gaps are explicitly enumerated. Full character coverage is not a claim of semantically perfect labels: paragraph/list/block grouping can still mix subroles, and humans must refine boundaries and accept/reject labels before gold use.

Only PR title and body were fetched. Linked issues, diffs, code, CI, comments, and linked documents were not fetched. Source-embedded code/test reports remain unverified author content. In particular, source-only title intent may be ineligible under the product's current source authority rules; any resulting miss must not automatically be attributed to semantic-model quality. This fixed repository/recent-time sample is not representative of all public PRs.

## Offline verification

Run from the recovery worktree:

```sh
node scripts/run-requirement-source-ablation.mjs --input docs/verification/2026-09-14-public-60/corpus.json --output docs/verification/2026-09-14-public-60/offline-result.json --model gpt-5.6-luna
```

Observed: exit 0; one test file passed, one test passed, one live test skipped; caseCount 60; actualRequestCount 0; liveRequested false. The runner refuses to overwrite output, so use a fresh output path for a rerun. Do not add `--live` or API-key settings. Offline arm diagnostics do not establish live semantic accuracy.

Future live evaluation was not authorized or executed. With two arms per case and the unchanged 30-call guard, 60 cases would need four batches of 15 and separate approval. No runtime model setting, dependency, product file, prior restoration artifact, test expectation, or guard was changed. No commit was made.

