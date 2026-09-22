# Pro accuracy-10 retest — blocked preflight (2026-09-22)

## Requested comparison

Re-run the existing ten public PR cases against the current Pro-follow-up worktree, using the same source text, exact base/head revisions, and model settings as `docs/verification/2026-09-20-accuracy-10/authenticated/`. Preserve every outcome and compare goal interpretation, first location, core context, explanation grounding, provenance, usage, and failures without treating historical output as a new run.

## Preflight evidence

- **VERIFIED:** current source state is `e4046993f924a93e93810052fa6619ad1d96b2c8` plus the three authorized uncommitted Pro-follow-up files (`src/lib/review-intent.ts`, `src/components/PrEvidenceReview.tsx`, and `src/lib/review-navigation.test.ts`).
- **VERIFIED:** `/private/tmp/agentproof-accuracy-20260920/cases.json` contains all ten original case records, including title/description fields, declared base/head SHAs, changed-path lists, and local-repository paths. No raw source text was copied into this note.
- **REPORTED by historical authenticated results, not rechecked as a new run:** all ten Sep 20 rows record `sameRevision: true` and no error. Those values describe the historical run only.
- **FAILED current exact-code recovery:** every local repository path declared by the ten cases has a `.git` directory, but `git -C <path> rev-parse --is-inside-work-tree` returns `fatal: not a git repository (or any of the parent directories): .git`. Consequently neither the recorded base nor head object can be validated or read locally for any of the ten inputs.
- **FAILED current provider configuration:** the main checkout `.env.local` contains no nonempty `GEMINI_API_KEY` or `AI_GATEWAY_API_KEY`, and no `AGENTPROOF_LLM_MODEL` override. The current navigation resolver therefore cannot recreate the historical direct Gemini configuration (`gemini-3.8-flash`). Substituting OpenAI or a different model would invalidate the requested comparison.

## Result

**BLOCKED — provider calls: 0.** No actual PR/provider execution, model output, token usage, latency, or new case result exists. No comparison score or direction of change can be calculated.

The previously saved accuracy audit remains reference-only: 9 substantive source goals, supervisor-assessed 9/9 main-goal preservation, 8/9 useful first entries, and 98/98 exact historical references. It is not evidence about the current uncommitted Pro-follow-up source state and is not human gold, independent A/B agreement, or a general accuracy estimate.

## Required state to resume

1. A Gemini-compatible key and the exact historical model setting must be available to the local runner.
2. Each case's local repository must be restored as a valid Git repository containing its declared base and head objects, or equivalent fixed-revision input packets must be supplied.

No retry, case substitution, remote endpoint call, product edit, commit, push, deployment, or paid request was attempted.
