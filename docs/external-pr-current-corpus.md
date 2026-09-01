# Current-State External PR Corpus

This run evaluates 25 public PR URLs against the GitHub state observed now. It is a live evidence-collection check, not a correctness benchmark or a release-authority dataset.

## What stays fixed

- Unit and regression fixtures stay fixed. They test deterministic rules and must not change when GitHub changes.
- The 25 source URLs and cohort IDs stay fixed: 5 pilot, 10 blind, and 10 role-proof candidates.

## What refreshes

Immediately before a live run, AgentProof fetches each public PR's current head SHA and base SHA. The generated snapshot also keeps only state, draft flag, timestamps, changed-file count, and hashes that bind those values.

It does not retain or print PR title/body, diffs, paths, logs, review labels, or tokens. Generated snapshots and run summaries stay under `eval/generated/` and are not committed.

## Run order

First refresh the 25 SHA anchors. This uses the existing local GitHub CLI session only to call GitHub; its token is never written to the snapshot.

```bash
AGENTPROOF_EXTERNAL_CORPUS_USE_GH_AUTH=1 pnpm refresh:external-pr-corpus
```

Then evaluate the same 25 URLs. The runner refuses a snapshot older than 30 minutes, an incomplete capture, or a report whose source SHA no longer matches the captured SHA.

```bash
AGENTPROOF_SMOKE_BASE_URL=https://your-preview.example pnpm smoke:external-pr-current-corpus
```

If the deployed app needs GitHub credentials to collect the public PR evidence,
set `AGENTPROOF_SMOKE_GITHUB_TOKEN` for this local command. The runner forwards
it only with each analysis request; snapshots and run summaries never store or
print the token. Remote Preview or production-like URLs also require the
explicit `AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN=1` acknowledgement.

## Reading the result

- `completed`: all 25 reports used the captured source anchors.
- `source_drift`: a PR changed between capture and analysis; refresh and rerun it.
- `analysis_unavailable`: the report could not be produced. This is not a requirement verdict and must not be converted into `met` or `unmet`.

For completed reports, `generalPrAssessmentSummary` is aggregate-only: it records the count of present summaries, closed `sourceState`, overall-conclusion, and reason-code distributions, plus totals for the six bounded assessment-count states. A missing or invalid summary makes that case `analysis_unavailable`.

The saved run keeps only the opaque case ID and completion/failure status per case. It does not retain assessment targets, source text, paths, PR URLs, provider output, tokens, or diagnostics. These distributions are smoke-observation signals only; they do not infer semantic-state or admission-basis metrics from the public response.

This live corpus does not replace the existing pilot's separate human-label process, and it cannot by itself authorize release promotion.
