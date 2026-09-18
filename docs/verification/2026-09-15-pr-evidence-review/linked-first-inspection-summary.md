# Requirement-linked first inspection and ordinary review UI

## VERIFIED behavior

- Full ordinary PR review no longer shows Agent Claims/SUPPORTED/UNPROVEN or Agent Re-prompt. Full, Dashboard, Markdown, comment, and Dashboard copy Markdown stay independent of the six assessment variants. Typed-contract UI remains unchanged; zero requirements stay a neutral collected-change summary.
- Explicit requirement, proof-axis, proof-node, and semantic evidence references take precedence. Only when linked code is absent, exact path matches between that requirement's proofGraph firstFiles and file/test evidenceIndex entries are added as candidates. Mismatched canonical locations are excluded; no global changed-file or reviewPriority fallback is treated as requirement-linked evidence. Missing or unavailable proofGraph metadata creates no guessed fallback.
- Each objective's next inspection names its first displayed code, then test, then execution item. No linked item produces `Link unconfirmed; inspect collected changes separately.` Dashboard's ordinary next step uses that same first objective recommendation.
- Dashboard copy Markdown now displays the review projection rather than its legacy assessment/contract verdict section. JSON export contracts and portable-summary omission labels are preserved. Exact SHA/path URL guards and the existing redaction utility are unchanged.

## Frozen evaluation

Baseline: `evaluation-assessment-independent.json`. New artifact: `evaluation-linked-first-inspection.json`. Diverse, synthetic, and reference SHA-256 hashes match exactly. The scorer and reference/gold inputs were not modified.

| Profile | Objectives with code | Objectives with any evidence | First-inspection hit@1 | Current path coverage | External calls |
| --- | --- | --- | --- | --- | --- |
| asIs | 16/26 → 16/26 | 19/26 → 19/26 | 0/10 → 7/10 | 8/10 | 0 |
| sourceAdapted | 16/26 → 16/26 | 19/26 → 19/26 | 0/10 → 7/10 | 8/10 | 0 |

Both profiles still show 26 objectives in all ten cases, with displayed-source match 10/10. Precision when an inspection path is shown is 7/8 (87.5%); two cases have no predicted file path and count as misses. The older first-changed-file baseline remains 9/10, above this requirement-linked score. No ranking, case wording, or model tuning was performed.

**Remaining limitation:** ten objectives still have no code link and seven have no linked evidence of any kind. The permitted exact firstFiles fallback did not recover those previously unlinked objectives in this frozen corpus. Available changed files remain separately collected evidence; their existence does not authorize a requirement relationship. This is a structural connection/inspection metric on AI-reviewed provisional references, not semantic accuracy, human usability, or holdout performance. Missing PR URL/head/base SHA in these fixtures still prevents exact commit navigation.

## Validation and changed paths

- RED: three regressions failed before implementation (ordinary legacy UI, local firstFiles fallback, and inspection order).
- `pnpm exec vitest run src/lib/pr-evidence-review.test.ts src/components/pr-evidence-review-flow.test.tsx src/components/PrEvidenceReview.test.tsx src/lib/markdown.test.ts src/lib/dashboard-report-export.test.ts src/lib/dashboard-copy-revalidation.test.ts src/components/PublicGitHubDashboard.test.ts src/app/api/github/comment/route.test.ts`: 8 files, 93 tests passed.
- `AGENTPROOF_PR_EVIDENCE_EVAL_OUTPUT=docs/verification/2026-09-15-pr-evidence-review/evaluation-linked-first-inspection.json pnpm exec vitest run --config scripts/pr-evidence-review-evaluation-vitest.config.ts`: 9 tests passed, synthetic 3/3 and 18 product checks without failures, both frozen 10-case profiles complete, external calls 0. Use a fresh output path to reproduce (exclusive-write artifact creation).
- `pnpm typecheck` and `git diff --check`: exit 0. Own incremental diff reviewed against the captured dirty-worktree baseline; existing changes preserved. No full-suite/build rerun or network/provider call.
- Changed: `src/lib/pr-evidence-review.ts`, `src/lib/pr-evidence-review.test.ts`, `src/components/ReportView.tsx`, `src/components/pr-evidence-review-flow.test.tsx`, `src/lib/dashboard-report-export.ts`, `src/lib/dashboard-report-export.test.ts`, and these two new result files. No schema, verifier, classifier, observer, admission, general-assessment, privacy utility, fixture, policy, model, or configuration edits. No commit/push/deploy or additional task started.
- No implementation blocker. The remaining unlinked objectives and the 7/10 versus 9/10 baseline limitation are explicitly retained above.
