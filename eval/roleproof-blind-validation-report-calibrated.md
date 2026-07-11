# AgentProof Role-Proof Blind Validation Report - Calibrated

Status: roleproof_blind_reports_need_human_labeling

## Privacy Boundary

- Public GitHub metadata only.
- No raw diffs, raw CI logs, tokens, private data, raw prompts, evidenceIndex, or claims are stored.
- AgentProof output is not a correctness label. Human review is still required.

## Summary

- Candidates: 10
- Completed: 1
- Failed: 9
- Possible false pass: 0
- Possible false blocker: 0
- Role extraction needs review: 0
- ProofGraph used in judgment: 1

Note: this calibrated live rerun hit the unauthenticated GitHub API rate limit after the first candidate. Failed rows are fetch failures, not AgentProof validation failures. The earlier calibrated rerun before the final solution-hint refinement completed all 10 candidates and showed priority changes from high to medium for roleproof-blind-001 and roleproof-blind-004, with the failed-CI case remaining blocker. The final solution-hint refinement is covered by synthetic regression tests until the GitHub API limit resets.

## Candidate Results

| Candidate | PR | Analysis | Test/build | Priority before -> after | Role extraction | Notable change |
| --- | --- | --- | --- | --- | --- | --- |
| roleproof-blind-001 | sveltejs/svelte#18388 | completed | unknown | high -> medium | looks_clean | high -> medium |
| roleproof-blind-002 | sveltejs/svelte#18425 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-003 | tailwindlabs/tailwindcss#20310 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-004 | tailwindlabs/tailwindcss#20292 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-005 | microsoft/TypeScript#62923 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-006 | rust-lang/rust#150102 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-007 | golang/go#54390 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-008 | sympy/sympy#30015 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-009 | numpy/numpy#31771 | failed | n/a | n/a -> n/a | n/a | none |
| roleproof-blind-010 | ansible/ansible#86660 | failed | n/a | n/a -> n/a | n/a | none |

## Extraction And Proof Notes

### roleproof-blind-001 sveltejs/svelte#18388

- Role extraction: looks_clean
- Context role counts: {"problem_context":9,"reproduction_context":4,"external_reference":1,"author_claim":16}
- Gap kinds: {"evidence_unavailable":4,"ambiguous_requirement":4}
- Top risks: Some implementation proof is unavailable because file or patch evidence could not be collected. | Some requirements are too vague or weakly evidenced.
- Limitations: GitHub changed-file fetch failed: GitHub API rate limit was reached until 2026-07-09T13:59:37.000Z. File evidence may be incomplete. | GitHub check-run fetch failed: GitHub API rate limit was reached until 2026-07-09T13:59:37.000Z. CI evidence may be incomplete. | GitHub commit-status fetch failed: GitHub API rate limit was reached until 2026-07-09T13:59:37.000Z. Legacy status evidence may be incomplete. | No public test/build workflow run, check, or raw CI log was available. | Raw CI logs were not fetched or stored. | Confidence is based only on issue, diff, and test-artifact evidence because no public test/build execution evidence was found. | At least one requirement needs human interpretation.

## Failed Analyses

roleproof-blind-002 through roleproof-blind-010 failed because GitHub returned API rate limit responses. Results were not fabricated or backfilled.
