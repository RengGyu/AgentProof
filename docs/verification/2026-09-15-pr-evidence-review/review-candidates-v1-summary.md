# Review candidates v1 — implementation result

## Outcome

**VERIFIED:** Ordinary reports now carry a separate deterministic review-candidate companion. Strict requirement IDs, text, counts, statuses, proof axes, proof graph and receipts match the unchanged strict producer on all 10 frozen PRs (excluding generated ID/time and the additive companion). Typed-contract generation takes its existing path.

Source context uses the enclosing source paragraph/list item; section labels may include the immediately adjacent paragraph. Separate identifier features and diff features are collected before display excerpt compaction. Ranking uses exact source path, identifier overlap, then bounded token overlap. Weak matches abstain. These are candidate links, never observed/verified proof.

The companion stores IDs, bounded ranks, basis enums and SHA-256 hashes; no source text or diff text. Full and Dashboard projections preserve candidate order/basis; Markdown surfaces show the same basis. Signed tenant save/hydrate preserves the companion on 10/10 PRs. Legacy reports without it remain readable; portable summaries omit it.

## Frozen diagnostic comparison

Baseline: [evaluation-linked-first-inspection.json](evaluation-linked-first-inspection.json). Current: [evaluation-review-candidates-v1.json](evaluation-review-candidates-v1.json).

| Metric | Before | Current |
|---|---:|---:|
| Objectives with code candidates | 16/26 | 17/26 |
| Objectives with any code/test/execution link | 19/26 | 17/26 |
| Objectives with no link | 7/26 | 9/26 |
| Code/test candidate items | 36 | 42 |
| First inspection hit@1, provisional file proxy | 7/10 | 7/10 |
| First inspection presented | 8/10 | 7/10 |
| Proxy hit among presented | 7/8 | 7/7 |
| No first inspection | 2/10 | 3/10 |
| Strict producer comparison unchanged | — | 10/10 |
| Candidate order/basis preserved after save/hydrate | — | 10/10 |

**UNCLEAR:** Frozen false-link rate, semantic accuracy and human review accuracy/time remain UNKNOWN. References are provisional file-level proxies, not complete relevance gold; 7/7 is not a claim of 100% semantic accuracy. Coverage regressed when weak links were withheld. No case-specific thresholds or reference edits were made.

## Separate synthetic and perturbation checks

Three positives cover direct identifiers, late identifiers and a feature in the middle of a long patch. Three negatives cover common words, unrelated identifiers and a different explicit path. Positive code presentation: 2/3→3/3. False links against these explicit synthetic expectations: 5→0. Correct negative abstentions: 0/3→3/3. Reverse file order preserves all six outputs. These small authored diagnostics are not a holdout or an accuracy estimate.

Focused regression tests also cover heading/bold/list variants, repeated mentions, deduplication, removed/base and renamed/head navigation, missing revisions, unknown fields/IDs, legacy absence, signature tampering and absence of raw source text in the companion. Existing six-assessment-state, zero-requirement and typed-contract surface tests passed in the full run.

## Cost and bounds

- Offline evaluation recorded 0 external calls and 0 validation fallbacks. No provider/token cost was incurred by this feature evaluation.
- Frozen pipeline p50/p95: 24.06/71.57 ms before, 19.20/46.24 ms current.
- Projection + SSR p50/p95: 13.25/20.25 ms before, 8.09/11.40 ms current. Separate local runs, 1 warmup + 3 measured passes (30 samples); timing differences are not an isolated speedup claim.
- Persisted reports total 41,502 bytes; companions total 9,396 bytes across 10 cases (JSON bytes, not database storage accounting).
- Limits: source 64,000 characters; context 4,000; patch 16,000 per file; 256 word features; 64 identifiers; 8 candidates per objective. Beyond these bounds features are omitted. Missing/ambiguous source-span mapping uses requirement text. No AST, embeddings, LLM indexing or complete semantic relation recovery.

## Validation and remaining failures

- Four initial feature tests failed RED before implementation. Current focused regression rerun: 288 tests passed in 8 files, including candidate/storage boundaries and the previously timed-out tests run with one worker. Final offline evaluation: 1 test passed; all three frozen fixture/reference SHA-256 values match the prior artifact.
- Full suite run once: **2,786 passed, 10 failed, 66 skipped** (212 files). Two companion-related failures were fixed: the production-boundary allowlist and a test fabricating an invalid contract while retaining ordinary-only metadata. Four timeouts passed in the focused single-worker rerun.
- **FAILED / remaining outside this feature:** three legacy surface expectations in `ordinary-documentation-presentation.test.ts:35`, `ordinary-requirement-outcomes.test.ts:93`, `ordinary-static-types.test.ts:67`; each reproduces with the pre-companion producer. Diagnostic run: 13 passed / 3 failed; producer restored byte-for-byte afterward.
- **FAILED / remaining fixture issue:** `evaluation-pack.test.ts:597` expects `eval/fixtures/pr-evidence-review.synthetic.manifest.json`, which is absent. The existing synthetic fixture and gold files were left unchanged.
- Final `pnpm typecheck` and `git diff --check`: exit 0.
- Full-suite green is therefore not claimed. No build, commit, push, deployment or paid/provider evaluation was performed.

## Changed paths in this package

- Retrieval and integration: `src/lib/review-candidates.ts`, `src/lib/verifier.ts`, `src/lib/types.ts`.
- Projections/rendering: `src/lib/pr-evidence-review.ts`, `src/components/PrEvidenceReview.tsx`, `src/lib/github-dashboard-view-model.ts`, `src/lib/markdown.ts`, `src/lib/dashboard-report-export.ts`.
- Boundaries/storage: `src/lib/report-validation.ts`, `src/lib/server-report-store.ts`, `src/lib/tenant-report-validation.ts`, `src/lib/production-boundary-evaluation-runner.ts`.
- Tests: `src/lib/review-candidates.test.ts`, `src/lib/review-candidates-evaluation.test.ts`, `src/lib/markdown.test.ts`, `src/lib/dashboard-report-export.test.ts`, `src/lib/report-validation.test.ts`, `src/app/api/dashboard/reports/route.test.ts`.
- This summary and current evaluation JSON. Existing worktree changes and previous result artifacts were preserved.
