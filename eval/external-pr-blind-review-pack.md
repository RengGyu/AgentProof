# External PR Blind Review Pack

Status: `blind_reports_need_human_labeling`.

This pack is summary-only public GitHub metadata plus AgentProof report summaries. It is not a correctness label, manual validation, or quality proof.

## Privacy Boundary

- No raw diffs stored.
- No full logs stored.
- No tokens stored.
- No private repository data stored.
- No manual labels completed.

## Summary

- Candidates: 10
- Completed analyses: 10
- Failed analyses: 0
- Skipped analyses: 0
- Repositories: eslint/eslint, prettier/prettier, microsoft/playwright, rollup/rollup, webpack/webpack, axios/axios, pytest-dev/pytest, pandas-dev/pandas, nodejs/node, electron/electron

## Recommended First Comparison Cases

1. blind-001 - eslint/eslint - https://github.com/eslint/eslint/pull/20958 - eslint/eslint PR #20958 links to issue #20950 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists
2. blind-003 - microsoft/playwright - https://github.com/microsoft/playwright/pull/41681 - microsoft/playwright PR #41681 links to issue #41679 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata
3. blind-004 - rollup/rollup - https://github.com/rollup/rollup/pull/6403 - rollup/rollup PR #6403 links to issue #6401 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists.
4. blind-005 - webpack/webpack - https://github.com/webpack/webpack/pull/21340 - webpack/webpack PR #21340 links to issue #8079 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exist
5. blind-006 - axios/axios - https://github.com/axios/axios/pull/11040 - axios/axios PR #11040 links to issue #6878 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists.

## Contradictions To Review

- blind-008: candidate metadata saw a failed public check/status item (`PANDAS_FUTURE_INFER_STRING=0`), but AgentProof reported `testBuildStatus: passed` and framed failed checks as static/merge-gate risk. This is not a correctness label; it is a blind generalization finding for human review.

## Candidate Table

| ID | Repo | PR | Classification | Files | Candidate checks | Analysis | Priority | Test/build | Why useful |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| blind-001 | eslint/eslint | [#20958](https://github.com/eslint/eslint/pull/20958) | clean_issue_fix | 2 | passed | completed | medium | passed | eslint/eslint PR #20958 links to issue #20950 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-002 | prettier/prettier | [#19565](https://github.com/prettier/prettier/pull/19565) | clean_issue_fix | 4 | passed | completed | medium | passed | prettier/prettier PR #19565 links to issue #19564 and includes public PR metadata. The issue has bounded task context. Changed files include tests. Public check/status metadata exists. |
| blind-003 | microsoft/playwright | [#41681](https://github.com/microsoft/playwright/pull/41681) | clean_issue_fix | 2 | passed | completed | medium | passed | microsoft/playwright PR #41681 links to issue #41679 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-004 | rollup/rollup | [#6403](https://github.com/rollup/rollup/pull/6403) | visual_proof_candidate | 10 | passed | completed | medium | passed | rollup/rollup PR #6403 links to issue #6401 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-005 | webpack/webpack | [#21340](https://github.com/webpack/webpack/pull/21340) | large_pr_capped_evidence_candidate | 23 | passed | completed | high | passed | webpack/webpack PR #21340 links to issue #8079 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-006 | axios/axios | [#11040](https://github.com/axios/axios/pull/11040) | visual_proof_candidate | 4 | passed | completed | medium | passed | axios/axios PR #11040 links to issue #6878 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-007 | pytest-dev/pytest | [#14639](https://github.com/pytest-dev/pytest/pull/14639) | clean_issue_fix | 4 | passed | completed | high | passed | pytest-dev/pytest PR #14639 links to issue #14637 and includes public PR metadata. The issue has bounded task context. Changed files include tests. Public check/status metadata exists. |
| blind-008 | pandas-dev/pandas | [#63908](https://github.com/pandas-dev/pandas/pull/63908) | failed_or_unclear_ci_candidate | 4 | failed | completed | high | passed | pandas-dev/pandas PR #63908 links to issue #63899 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-009 | nodejs/node | [#64287](https://github.com/nodejs/node/pull/64287) | clean_issue_fix | 2 | passed | completed | medium | passed | nodejs/node PR #64287 links to issue #64286 and includes public PR metadata. The issue has reproduction or steps. Changed files include tests. Public check/status metadata exists. |
| blind-010 | electron/electron | [#52248](https://github.com/electron/electron/pull/52248) | missing_tests_candidate | 2 | passed | completed | medium | passed | electron/electron PR #52248 links to issue #52247 and includes public PR metadata. The issue has reproduction or steps. Changed files do not clearly include tests, useful for missing-proof behavior. Public check/status metadata exists. |

## Failures

- None.
