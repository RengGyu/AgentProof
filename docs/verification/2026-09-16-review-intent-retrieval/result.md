# Review-intent retrieval — Phase A result

## Implemented

**VERIFIED:** Ordinary reports now use `ReviewIntentGraphV1`, nested additively in the existing `reviewCandidates` companion. Strict requirements and typed-contract generation are unchanged. Compatibility candidate rows are projected from this graph; the previous separate lexical search is removed.

- Source paragraphs/list items seed goals; headings supply structure. Explicit obligation cues can start another goal. Supporting prose stays with its goal, while conditions, exceptions, reproduction, acceptance and artifact hints retain source references. References contain offsets and SHA-256 hashes against the redacted, LF-normalized UTF-16 source; source text is not copied into the companion. Unmapped strict objectives retain their existing evidence.
- Retrieval searches changed diffs and supplied exact-head `verificationCriterionEvidenceV2.artifactBlobs`, including paths outside the changed-file set. Fixed 80-line windows, inverse-frequency lexical overlap, identifier/path anchors and a changed-declaration prior feed deterministic ranking. Each goal has independent candidate edges; a chunk can serve several goals. No retrieval edge becomes observed, verified or fulfilled.
- Existing observed/receipt-verified code and tests survive abstention and keep their grade. Receipt-derived relation metadata is captured before tenant receipt stripping and used by authenticated tenant projections. Existing semantic relations remain candidate links.
- Full, Dashboard and Markdown show Inspect first, More context, tests, execution, source references/facet kinds and unconnected state. Empty retrieval explicitly does not establish missing implementation.
- Full runtime validation reconstructs the graph from the transient source/snapshot. Unknown fields, stale/invented references and attempted verified candidate edges are rejected. Repository mismatch suppresses navigation; snapshots need matching repository binding for clickable links. Multiline secret masking preserves file-line coordinates. Secret-bearing paths are excluded.
- Signed tenant storage preserves the graph and relation grades; portable share summaries omit the companion. Newly persisted retrieval data consists of IDs, paths, positions, hashes, scores and enums, without raw source/code/tokens.

## Explicitly unavailable / bounded

Whole-repository ingestion, embeddings, new AI/model calls, semantic reranking, exact symbol resolution, AST/call graphs and dataflow are not implemented. Existing resolved-head-module collection is unchanged. Snapshot retrieval only uses artifact blobs already supplied to the generator; normal requests without those blobs honestly report zero snapshot chunks.

Grouping uses Markdown structure and bounded English cue rules, not a claim of general semantic intent understanding. Facet text is inspected through source offsets; it is not newly persisted. Declaration matching is a lexical prior, not verified symbol resolution. Retrieval limits are: source 64,000 characters, query 8,000, file text 16,000, 256 word features, 64 identifiers, 40 goals, 32 context references per goal, 256 facets, 128 chunks and 12 edges per goal. Capability metadata reports truncation and excluded snapshots. These constraints can omit relevant material.

## Validation

- Initial three regression tests failed RED for missing intent graph, erased observed evidence and unavailable artifact retrieval; subsequent RED tests covered inline facets, supporting prose, multiline secret coordinates, wrong-repository navigation and feature truncation.
- Frozen diagnostic corpus: strict producer equality **10/10**, tenant round-trip preservation **10/10**, external calls **0**; fixture/reference hashes unchanged. Three synthetic retrieval positives matched their expected paths; three negative queries abstained. Preserved deterministic observations are scored separately from new retrieval candidates.
- Full suite executed once at integration: **2,799 passed, 4 failed, 66 skipped**, across **213 files** (206 passed / 4 failed / 3 skipped). The final source-grouping and reference/privacy refinements were subsequently covered by focused tests and typecheck; this is not a claim that the final tree passed a second full-suite run.
- Remaining pre-existing failures: `ordinary-documentation-presentation.test.ts:35`, `ordinary-requirement-outcomes.test.ts:93`, `ordinary-static-types.test.ts:67` expect superseded UI text; `evaluation-pack.test.ts:597` requires the already absent `pr-evidence-review.synthetic.manifest.json`. These same four failures were documented before this task. No new failing test remains in the executed focused checks.
- Final focused run: **44 passed / 0 failed in 5 files** (`review-intent-retrieval`, `review-candidates`, `report-runtime-validation`, `review-candidates-evaluation`, `redact`). Earlier surface/boundary focused run: **184 passed / 0 failed in 9 files**; post-grouping producer/surface/evaluation run: **48 passed / 0 failed in 5 files**. These runs overlap and are not additive. Final `pnpm typecheck` and `git diff --check`: exit 0. No build, commit, push, deployment, paid evaluation or external provider call was performed.

**UNCLEAR:** Semantic relevance accuracy, human review success/time and whether the grouping matches human intent are unmeasured. The frozen corpus and synthetic examples are diagnostics, not human gold. No accuracy or release-readiness claim is made.

## Changed paths in this package

- New: `src/lib/review-intent.ts`, `src/lib/review-intent-retrieval.test.ts`.
- Retrieval/projection: `src/lib/review-candidates.ts`, `src/lib/pr-evidence-review.ts`, `src/lib/verifier.ts`, `src/lib/github-dashboard-view-model.ts`.
- Boundaries: `src/lib/server-report-store.ts`, `src/lib/report-runtime-validation.ts`, `src/lib/redact.ts`.
- Surfaces: `src/components/PrEvidenceReview.tsx`, `src/lib/markdown.ts`, `src/lib/dashboard-report-export.ts`.
- Related tests: `src/lib/review-candidates.test.ts`, `src/lib/review-candidates-evaluation.test.ts`, `src/lib/report-runtime-validation.test.ts`, `src/lib/markdown.test.ts`, `src/lib/dashboard-report-export.test.ts`.
- This note. Pre-existing worktree edits and prior evaluation artifacts were preserved.
