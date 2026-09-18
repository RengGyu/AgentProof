# Assessment-independent review candidate display

## VERIFIED result

Ordinary v2 reports use displayed requirements and evidence for review candidates, including when the assessment is absent, missing, ambiguous, no-assessable-claims, or collection-blocked. Zero requirements render a neutral collected-change summary. An existing typed contract or explicit typed-contract companion keeps the prior UI. Source labels use requirement authority and report analysis context only; missing provenance is not filled from assessment state. No schema, verifier, classifier, observer, admission, privacy utility, prompt, model, or policy changes.

The shared projection reaches Full and Dashboard; Markdown and GitHub comments now render the same review model. Candidate exposure does not change report status, receipt authority, or execution meaning. Markdown keeps existing redaction, suppresses a link if its URL requires redaction, and escapes URL parentheses.

## Fixed 10-case comparison

Baseline: `evaluation-source-and-first-inspection.json`. Current: `evaluation-assessment-independent.json`. Diverse, synthetic, and reference fixture SHA-256 hashes match the baseline. Both profiles contain the same ten cases; `sourceAdapted` changes only `taskSource=issue`.

| Profile | Cases displaying cards | Total cards | Source match | First-inspection hit@1 | External calls |
| --- | --- | --- | --- | --- | --- |
| asIs | 0/10 → 10/10 | 0 → 26 | 0/10 → 10/10 | 9/10 → 0/10 | 0 |
| sourceAdapted | 0/10 → 10/10 | 0 → 26 | 0/10 → 10/10 | 9/10 → 0/10 | 0 |

**Known regression:** first-inspection coverage is 0/10 in both profiles (10 missing recommendations; precision when presented is null). The objective-mode next-inspection text does not identify a linked file path on these fixtures. The existing change-summary baseline and first-changed-file baseline each score 9/10. Scoring and ranking were not tuned to these cases. Card/source availability improved; first-inspection performance did not.

Source match measures displayed report provenance against the pre-existing provisional references. The as-is fixtures still lack recorded `taskSource`, PR URL, and exact head/base SHA; generated report context is `linked_issue`. A matching label does not recover missing original metadata. All ten cases still lack exact commit navigation inputs. No claim of semantic correctness, human usability, or improved review speed is supported: references are AI-reviewed provisional, not human gold or holdout. The strict assessment still has zero targets and `no_assessable_claims`; this change does not turn those into supported outcomes.

## Verification

- TDD: two surface regressions failed before the display change; a candidate-link redaction regression failed before the renderer fix.
- `pnpm exec vitest run src/components/pr-evidence-review-flow.test.tsx src/lib/pr-evidence-review.test.ts src/components/PrEvidenceReview.test.tsx src/lib/markdown.test.ts src/components/PublicGitHubDashboard.test.ts src/app/api/github/comment/route.test.ts`: 6 files, 74 tests passed.
- `AGENTPROOF_PR_EVIDENCE_EVAL_OUTPUT=docs/verification/2026-09-15-pr-evidence-review/evaluation-assessment-independent.json pnpm exec vitest run --config scripts/pr-evidence-review-evaluation-vitest.config.ts`: 9 tests passed; 3 synthetic cases, 18 product expectation checks, zero failures; both 10-case profiles complete; external call count zero. Artifact creation uses exclusive-write mode; use a fresh output path to reproduce.
- `pnpm typecheck`: exit 0. Own incremental diff reviewed against the captured dirty-worktree baseline; existing changes preserved. `git diff --check`: exit 0.
- No full-suite/build rerun, network/provider call, commit, push, or deployment. No implementation blocker; first-inspection regression remains explicitly reported above.
