# Current-State External PR Corpus

This run evaluates 25 public PR URLs against the GitHub state observed now. It measures collection, staged packaging, provider-call, and privacy health; it is not a correctness benchmark or a release-authority dataset.

## What stays fixed

- Unit and regression fixtures stay fixed. They test deterministic rules and must not change when GitHub changes.
- The 25 source URLs and cohort IDs stay fixed: 5 pilot, 10 blind, and 10 role-proof candidates.

## What refreshes

Immediately before a live run, AgentProof fetches each public PR's current head SHA and base SHA. The generated snapshot also keeps only state, draft flag, timestamps, changed-file count, and hashes that bind those values.

It does not retain or print PR title/body, diffs, paths, logs, review labels, or tokens. Generated snapshots and run summaries stay under `eval/generated/` and are not committed.

## Run order

## E1 local preparation boundary

E1 local preparation does **not** refresh, open, or run the 25-PR corpus. Its
only corpus preflight is an existence check, which does not read manifest
contents:

```bash
test -f eval/generated/external-pr-live-corpus.v1.json
```

The current runners accept no CLI flags. Their confirmed interface and help are:

```bash
pnpm smoke:analyze-pr --help
pnpm smoke:external-pr-current-corpus --help
```

Use the existing environment variables below only after separate approval for a
live run. Do not put token values in shell history, docs, output files, or
command lines. A prior result is comparable to a new run only when the PR URL,
head SHA, base SHA, input anchor, and policy anchor all match; do not combine
partial batches or reused results into one batch count. The emitted aggregate
rows omit the input and policy anchors, so they are not independent cross-run
comparison evidence.

First refresh the 25 SHA anchors. This uses the existing local GitHub CLI session only to call GitHub; its token is never written to the snapshot.

```bash
AGENTPROOF_EXTERNAL_CORPUS_USE_GH_AUTH=1 pnpm refresh:external-pr-corpus
```

Then evaluate the same 25 URLs. The runner refuses a snapshot older than 30 minutes, an incomplete capture, or a report whose source SHA no longer matches the captured SHA.

```bash
AGENTPROOF_SMOKE_BASE_URL=https://your-preview.example pnpm smoke:external-pr-current-corpus
```

The release packaging-health guard additionally requires the authenticated
`AGENTPROOF_SMOKE_OPS_TOKEN`; without that aggregate diagnostic boundary it
fails closed.

Provider calls are represented only as the closed buckets `0`, `1`, `2`, or
`3_plus`. `3_plus` is a safety violation that blocks the release guard, not a
performance metric or a retained raw count.

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

The saved run keeps only the opaque case ID and completion/failure status per case. It does not retain assessment targets, source text, paths, PR URLs, provider output, tokens, or diagnostics. Authenticated operator output keeps only closed aggregate stage, coverage, call, selection-bucket, package-ready, and omission counts. These distributions are smoke-observation signals only; they do not infer semantic-state or admission-basis metrics from the public response.

This live corpus does not replace the existing pilot's separate human-label process, and it cannot by itself authorize release promotion. In particular, a lower `unclear` rate does not prove accuracy: labelled calibration and holdout gates remain required.

## Optional local per-PR diagnostics

Set `AGENTPROOF_EXTERNAL_CORPUS_DETAILS_OUTPUT` to a file under the ignored
`eval/generated/` directory to retain local operator-only details. Product
save/share schemas stay unchanged; the public run artifact may include optional
closed aggregate fields, while older v1 artifacts remain readable without them.

Each case records its public PR URL and expected head/base SHA, requirement
verdicts, bounded requirement text and gap notes, proof-axis states, evidence
IDs linked to kind/label/locator descriptors, ordinary-PR target reasons, and
the authenticated operator diagnostic. Evidence IDs are local to that PR's
report. Raw evidence summaries, source bindings, receipts, code/log bodies,
provider responses and credentials are excluded. Text uses the existing secret
redactor and additionally removes the credentials supplied to that run.

Files are replaced atomically after each case with owner-only permissions. A
failure after analysis (for example summary storage) still keeps the analyzed
detail and the failing stage/HTTP status, without retaining raw error bodies.
Progress output includes only case count and completion status. Release guard
failure still exits nonzero, but no longer discards collected results.

The operator response accepts both the previous eight-field shape and the
current shape with the closed `claimInvalidReason` field. Unknown fields and
unknown reason values remain rejected. Supply `AGENTPROOF_SMOKE_OPS_TOKEN` only
in the process environment; it must match the tested deployment's
`AGENTPROOF_OPS_TOKEN`. A GitHub token is not an operator token.

```bash
AGENTPROOF_EXTERNAL_CORPUS_DETAILS_OUTPUT=eval/generated/external-pr-details.v1.json pnpm smoke:external-pr-current-corpus:release
```

These details are for local investigation, not public sharing or source truth
for correctness labels. A zero Supported count alone does not establish safety.
