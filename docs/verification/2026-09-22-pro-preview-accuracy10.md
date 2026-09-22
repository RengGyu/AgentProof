# Pro Preview 10-case reevaluation attempt — 2026-09-22

> Superseded as the final evaluation record by
> `docs/verification/2026-09-22-accuracy-10-authenticated/accuracy-review.md`.
> This document preserves the earlier unauthenticated collection failure;
> it does not describe the later, explicitly authorized authenticated rerun.

## Scope and deployment evidence

- Current Preview deployment: `dpl_BygYLKfWpgwazGT8sTvSKJhUGsP9` (`agentproof-hy1rvlmf2-renggyus-projects.vercel.app`), target Preview only.
- Deployment source was the active recovery worktree at `e4046993f924a93e93810052fa6619ad1d96b2c8`, including the three uncommitted Pro follow-up files. Their combined diff digest was `d72618770c3bda1d22a76cbdb2f3abdba2f223965066e96857e8a426ccba7cc0`.
- Remote Preview build completed successfully, including its production type check. Protected Preview access returned HTTP 200 through the existing Vercel session.
- Preview environment metadata confirmed configured Gemini/gateway, model, and operator-token variable names. No values were read, copied, or recorded.

## Request results (provenance, not semantic scoring)

Ten primary requests used the historical public PR URLs and expected base/head SHAs. Each response was reduced in-process to status, timing, revision/model metadata, and bounded navigation counts; response bodies and provider text were discarded.

| Outcome | Count | Meaning |
| --- | ---: | --- |
| HTTP 200, exact base/head, completed navigation ranking | 1 | Flask #5918; Gemini model `gemini-3.8-flash`, navigation `partial` / `ready`. |
| HTTP 200, exact base/head, fallback navigation | 1 | Starlette #3552; no completed ranking or goals. This is not evidence of a usable model result. |
| HTTP 400 before report/revision metadata | 8 | Not comparable: no report provenance, semantic output, or model-success evidence was returned. |

One bounded diagnostic retry of an HTTP-400 case classified the failure as `github_rate_limit`. It did not produce a report and is not counted as a model result. The public endpoint receives no GitHub token, so its server-side public GitHub collection cannot be repaired by local exact-object re-fetch alone.

Thus only **1/10** cases has both exact-revision provenance and a completed current model navigation result. The requested ten-case accuracy/context/explanation comparison is incomplete and must not be generalized.

## Bounded Flask structural comparison

The only comparable case is Flask #5918. Its old authenticated baseline is `docs/verification/2026-09-20-accuracy-10/authenticated/results.json`; both runs used the same base/head and `gemini-3.8-flash`.

| Metadata | Historical | Current Preview |
| --- | ---: | ---: |
| Wall time | 26,593 ms | 31,280 ms |
| Goals | 1 | 1 |
| Goal source references | 3 | 4 |
| Motivation facets | 1 | 1 |
| Context facets | 2 | 1 |
| Implementation-claim facets | 4 | 4 |
| Processed source characters | 2,708 | 2,708 |
| Candidate artifacts | 13 | 20 |
| Navigation failures / limitations | 1 / 6 | 1 / 6 |

This is a structural report-shape comparison only. It does not establish semantic accuracy, explanation quality, or a model-quality improvement. In particular, the reduced context-facet count may reflect the Pro safety behavior, but no raw text or manual adjudication was retained to make that attribution.

## Cost and timing boundary

- The ten primary requests consumed 68,771 ms wall time in aggregate, but this includes eight early HTTP-400 failures; it is not comparable with the historical successful ten-case total of 240,470 ms.
- The public response does not expose provider token usage or a reliable provider-call count. Cost cannot be calculated from this run.
- No code, Vercel settings, environment variables, commits, pushes, production deployment, or external publication changed.

## Completion blocker

The remaining nine comparable model runs require the Preview runtime to collect the exact public GitHub snapshots without anonymous rate limiting. A safe continuation needs either a narrowly authorized GitHub credential for these public reads (not export of unrelated Preview secrets) or a later retry after the rate limit resets. The already-authorized local/mktemp public Git-object fetch cannot supply the Preview route's required live GitHub evidence or its `github_snapshot` provenance.
