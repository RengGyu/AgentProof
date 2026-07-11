# ProofGraph Validation Report

Generated: 2026-07-09T11:12:00.000+09:00

## Source Policy

- Public GitHub PR metadata only.
- No raw diffs, full CI logs, tokens, private data, raw prompts, or completed correctness labels are stored.
- AgentProof output is treated as a verifier report candidate, not as truth.

## Existing Blind Rerun Summary

Completed 10/10; failed 0; statuses {"passed":9,"failed":1}; priorities {"medium":5,"high":4,"blocker":1}. Possible false pass: 0. Possible false blocker: 0.

| Candidate | PR | Before status | After status | Before priority | After priority | Missing tests delta | Proof gaps | Assertion |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| blind-001 | eslint/eslint#20958 | passed | passed | medium | medium | 0 | none | not evaluated |
| blind-002 | prettier/prettier#19565 | passed | passed | medium | medium | 0 | none | not evaluated |
| blind-003 | microsoft/playwright#41681 | passed | passed | medium | high | 0 | self_reported_test_gap, missing_implementation | not evaluated |
| blind-004 | rollup/rollup#6403 | passed | passed | medium | medium | 0 | missing_implementation, visual_proof_missing | not evaluated |
| blind-005 | webpack/webpack#21340 | passed | passed | high | high | 0 | none | not evaluated |
| blind-006 | axios/axios#11040 | passed | passed | medium | medium | 0 | none | not evaluated |
| blind-007 | pytest-dev/pytest#14639 | passed | passed | high | high | 0 | missing_targeted_test | not evaluated |
| blind-008 | pandas-dev/pandas#63908 | passed | failed | high | blocker | 0 | failed_execution, visual_proof_missing | passed |
| blind-009 | nodejs/node#64287 | passed | passed | medium | medium | 0 | missing_implementation, ambiguous_requirement | not evaluated |
| blind-010 | electron/electron#52248 | passed | passed | medium | high | 2 | missing_targeted_test, self_reported_test_gap, missing_implementation, ambiguous_requirement | passed |

## Focus Cases

### blind-008 pandas-dev/pandas#63908

- Before: testBuildStatus=passed, priority=high, missingTestCount=0.
- After: testBuildStatus=failed, priority=blocker, missingTestCount=0.
- ProofGraph gaps: failed_execution, visual_proof_missing.
- Failed workflow hidden as passed: false.
- Assertion: passed.
- Notes: No assertion notes.

### blind-010 electron/electron#52248

- Before: testBuildStatus=passed, priority=medium, missingTestCount=0.
- After: testBuildStatus=passed, priority=high, missingTestCount=2.
- ProofGraph gaps: missing_targeted_test, self_reported_test_gap, missing_implementation, ambiguous_requirement.
- Failed workflow hidden as passed: false.
- Assertion: passed.
- Notes: No assertion notes.

## New Blind Summary

Completed 7/7; failed 0; statuses {"passed":6,"failed":1}; priorities {"medium":4,"high":2,"blocker":1}. Possible false pass: 0. Possible false blocker: 0.

| Candidate | PR | Class | Analysis | Status | Priority | Missing tests | Proof gaps | 30s card |
| --- | --- | --- | --- | --- | --- | ---: | --- | --- |
| proofgraph-blind-001 | django/django#21121 | crash_regression_clean_fix | completed | passed | medium | 1 | missing_implementation, ambiguous_requirement | yes / compact |
| proofgraph-blind-002 | scikit-learn/scikit-learn#33048 | normal_clean_fix | completed | passed | medium | 0 | none | yes / compact |
| proofgraph-blind-003 | matplotlib/matplotlib#31353 | visual_proof_mixed_status | completed | passed | high | 0 | missing_implementation, ambiguous_requirement | yes / compact |
| proofgraph-blind-004 | rails/rails#57451 | crash_regression_failed_or_unclear_ci | completed | failed | blocker | 1 | failed_execution, visual_proof_missing | yes / compact |
| proofgraph-blind-005 | hashicorp/terraform#38770 | regression_clean_fix | completed | passed | medium | 1 | none | yes / compact |
| proofgraph-blind-006 | go-gitea/gitea#38274 | auth_flow_clean_fix | completed | passed | high | 3 | none | yes / compact |
| proofgraph-blind-007 | django/django#20312 | no_new_test_claim_with_test_artifact | completed | passed | medium | 0 | missing_implementation, ambiguous_requirement | yes / compact |

## Initial Cause Analysis

- Improvements are attributed only when the rerun output changed visible report fields and proofGraph diagnostics show corresponding gap signals.
- Contradictions are categorized as GitHub fetch, evidence classification, proofGraph mapping, aggregation/reportSummary, UI/report display, or fixture overfitting in the final human review.
- This run does not change product logic and does not finalize manual labels.

## Remaining Review Questions

- Continue checking whether failed statuses are true test/build executions or non-execution gates for mixed providers. Codecov/docs/changelog/optional gates are now separated; provider summaries still need human review when they claim test/build failure.
- Review whether missing targeted proof is too aggressive on broad CI-passed PRs with changed tests that are weakly mapped to requirements.
- Confirm that firstReviewPriorityFiles remains concrete enough for a 30-second reviewer scan.

## Detailed Findings

### blind-008: pandas-dev/pandas#63908

- Before: `testBuildStatus=passed`, `priority=high`, and the failed matrix job was summarized as a static/merge-gate risk.
- After: `testBuildStatus=failed`, `priority=blocker`, `topRisks` includes failed test/build execution, and `reviewPriority` starts with `Test/build checks`.
- `proofGraph` was used in requirement gaps, review priority, top risks, and re-prompt. The run produced `failed_execution` gaps for 8 requirements, so a failed relevant workflow is no longer hidden by passing sub-signals.
- Remaining issue: none in test/build aggregation. Limitation text now keeps the failing build/test metadata and suppresses weaker passing sub-signal wording when failure wins.

### blind-010: electron/electron#52248

- Before: `priority=medium`, `missingTestCount=0`; the native crash fix had no changed test file but the gap was not surfaced.
- After: `priority=high`, `missingTestCount=2`, and top risks include missing targeted proof. `proofGraph` shows `missing_targeted_test` and `self_reported_test_gap` connected to `shell/browser/api/electron_api_menu.cc` and `.h`.
- `testBuildStatus` remains `passed`, which is appropriate for broad execution metadata, while targeted proof gap is shown separately. This is the main proofGraph improvement.
- Remaining issue: requirement extraction still includes some PR template/checklist text as requirements, adding proofGraph noise. `firstReviewPriorityFiles` no longer starts with the generic label `Requirement evidence`; it points to concrete files.

### New Blind Candidates

- `proofgraph-blind-002` (`scikit-learn/scikit-learn#33048`) is the cleanest new baseline: linked issue fetched, changed implementation/test files mapped, public unit-test execution found, and no proofGraph gaps.
- `proofgraph-blind-001` and `proofgraph-blind-007` use Django Trac tickets rather than GitHub issues, so `issueFetched=false`; AgentProof falls back to PR description and extracts template headings such as "Trac ticket number" as requirements. This creates missing/ambiguous requirement noise even when useful files and public test metadata exist.
- `proofgraph-blind-003` (`matplotlib/matplotlib#31353`) now reports `testBuildStatus=passed` with high priority because static/merge-gate failures remain separate from test/build execution. This is the intended false-blocker reduction for docs/codecov/merge-prevention-style statuses.
- `proofgraph-blind-004` (`rails/rails#57451`) was marked failed/blocker due to a public `buildkite/rails` failure. That may be a real broad execution failure, but without raw logs it should stay a verification blocker, not a correctness judgment.
- `proofgraph-blind-005` (`hashicorp/terraform#38770`) now reports `testBuildStatus=passed` and `priority=medium`; cancelled changelog metadata no longer becomes failed execution. It still surfaces one missing targeted-test lead and scope risk for human review.
- `proofgraph-blind-006` (`go-gitea/gitea#38274`) passed execution but still reported 3 missing tests even though an integration test file changed. This suggests targeted test mapping is too local/path-based for multi-file auth flows.

## Cause Analysis

- GitHub fetch problem: resolved by using a transient `gh auth token` in memory only; no token value was stored in output files.
- Evidence classification problem: improved for cancelled checks, Codecov/docs/report gates, optional/non-blocking checks, and provider-only labels. `buildkite/rails` remains a blocker only when the public status summary is classified as actual test/build execution.
- ProofGraph mapping problem: improved targeted proof visibility, but requirement extraction noise causes checklist/template headings to receive proof gaps.
- Aggregation/reportSummary problem: improved for blind-008 and mixed-status blind cases; failed execution still wins, while non-execution failures are separated as static/merge-gate risk.
- UI/report display problem: `Requirement evidence` and Actions URLs no longer appear in first-review file lists in the rerun outputs.
- Fixture overfitting risk: no product-code PR/candidate hardcoding was added in this run. New blind failures show the system is not merely tuned to the prior two cases; it still has general evidence-classification edges to solve.

## Reviewer Readiness

This is suitable to show to external reviewers as a beta evidence report, with an explicit caveat that failed/missing-proof signals are prompts for human inspection, not final correctness labels. It is still not an automated merge verdict; remaining beta risks are template-noisy requirement extraction and targeted-test mapping for broad multi-file changes.
