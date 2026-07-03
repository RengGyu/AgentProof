# External PR 5-Case Pilot

AgentProof should not scale evaluation to 20 public PRs until a smaller five-case pilot proves the workflow and fixture boundary. The first pilot is stored at `eval/fixtures/external-pr-pilot.v1.json`.

## Pilot Cases

| Case | Public PR | Why it is in the pilot |
| --- | --- | --- |
| clean PR | https://github.com/vercel/next.js/pull/95403 | Small issue-linked fix with targeted test file evidence. |
| missing tests | https://github.com/vercel/next.js/pull/95441 | Bot data update candidate where the reviewer must decide whether targeted validation is visible. |
| scope creep | https://github.com/vercel/next.js/pull/95426 | Broad config, docs, runtime, and test surface for scope-creep calibration. |
| failed CI | https://github.com/vercel/next.js/pull/95432 | Public check rollup had failed lint/final summary evidence when observed. |
| vague task or visual-proof gap | https://github.com/vercel/next.js/pull/95054 | Claims layout verification across screen sizes; the pilot should verify whether visual proof is present or only asserted. |

## Boundary

- AgentProof PRs do not count as P0 quality proof.
- `reportInput` contains public PR metadata and bounded public signals only.
- `manualLabels` are stored beside, not inside, `reportInput`.
- Manual labels start as `pending_reviewer_confirmation`; they are not completed until a reviewer session records the expected first inspection path.
- The report generator must never receive manual verdicts such as requirement status, missing test evidence, scope creep, or top files to inspect.
- The fixture does not store tokens, raw diffs, raw logs, full PR bodies, or private provider identifiers.

## Reviewer Session Protocol

For each PR, run the report first using only the public PR URL path. Then fill the manual labels:

- requirement met / partial / missing / unclear
- missing targeted test evidence: yes / no
- scope creep: yes / no
- top files the reviewer should inspect first
- whether the reviewer understood top risk, missing proof, first files, and next re-prompt within 30 seconds

If no external reviewer is available, mark the session `biased and insufficient`; do not treat internal review as real-user validation.

## Scale Rule

Do not expand to 20 external PRs until:

- all five pilot cases have been run from the public PR URL path,
- manual labels were filled after report generation,
- at least one reviewer session or target-reviewer outreach record exists,
- oracle/manual labels were not found in generated report inputs,
- summary-only privacy checks still pass.
