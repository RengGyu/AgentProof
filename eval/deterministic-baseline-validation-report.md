# AgentProof Deterministic Baseline Validation Report

Status: deterministic_baseline_needs_human_review_before_llm_ab

## Privacy Boundary

- Summary-only output.
- No raw diffs, raw CI logs, tokens, private data, raw prompts, evidenceIndex, or claims are stored.
- AgentProof output is not a correctness label; human labeling remains required.

## Summary

- Candidates: 10
- Completed: 10
- Failed: 0
- Skipped: 0
- Possible false pass: 0
- Possible false blocker: 0
- Priority may be too narrow: 1
- ProofGraph used: 10
- Used transient GitHub token: false

## Candidate Results

| Candidate | PR | Status | Test/build | Priority | Manual check reqs | Solution hints | Obvious problem |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| roleproof-blind-001 | sveltejs/svelte#18388 | completed | passed | medium | 0 | 0 | none |
| roleproof-blind-002 | sveltejs/svelte#18425 | completed | passed | medium | 1 | 0 | none |
| roleproof-blind-003 | tailwindlabs/tailwindcss#20310 | completed | unknown | medium | 0 | 5 | none |
| roleproof-blind-004 | tailwindlabs/tailwindcss#20292 | completed | unknown | medium | 0 | 1 | none |
| roleproof-blind-005 | microsoft/TypeScript#62923 | completed | passed | medium | 0 | 0 | none |
| roleproof-blind-006 | rust-lang/rust#150102 | completed | failed | blocker | 1 | 0 | none |
| roleproof-blind-007 | golang/go#54390 | completed | unknown | medium | 0 | 0 | none |
| roleproof-blind-008 | sympy/sympy#30015 | completed | passed | medium | 0 | 0 | none |
| roleproof-blind-009 | numpy/numpy#31771 | completed | passed | medium | 1 | 0 | none |
| roleproof-blind-010 | ansible/ansible#86660 | completed | passed | medium | 1 | 0 | none |

## Baseline Judgment

- Baseline can be used for LLM A/B comparison, with human labels still required.

## Known Anomalies

- roleproof-blind-007 is marked `priorityMayBeTooNarrow` in the JSON result. The issue text includes path traversal/security-like language and high-severity proofGraph gaps, but summary priority remains `medium` because no changed-file evidence mapped cleanly and test/build status is `unknown`. Do not fix this in the deterministic baseline run; use it as a useful LLM A/B probe for whether model-assisted interpretation improves reviewer signal without creating false blockers.

## Notes

- roleproof-blind-001: medium/passed; sourceQuality={"problem_statement":4}; contextRoles={"problem_context":9,"reproduction_context":4,"external_reference":1,"author_claim":16}; topRisks=Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.
- roleproof-blind-002: medium/passed; sourceQuality={"manual_check":1}; contextRoles={"author_claim":21,"external_reference":1}; topRisks=Some requirements are too vague or weakly evidenced.
- roleproof-blind-003: medium/unknown; sourceQuality={"problem_statement":4}; contextRoles={"problem_context":17,"environment_context":2,"reproduction_context":1,"solution_hint":5,"author_claim":5}; topRisks=Some requirements have only partial evidence. | Behavior changed without strong test evidence.
- roleproof-blind-004: medium/unknown; sourceQuality={"problem_statement":4}; contextRoles={"problem_context":22,"environment_context":7,"solution_hint":1}; topRisks=Some requirements have only partial evidence. | Potential scope creep in changed files.
- roleproof-blind-005: medium/passed; sourceQuality={"expected_behavior":1}; contextRoles={"problem_context":5,"environment_context":3,"external_reference":1}; topRisks=Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.
- roleproof-blind-006: blocker/failed; sourceQuality={"manual_check":1}; contextRoles={"author_claim":13,"external_reference":1}; topRisks=Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced. | Behavior changed without strong test evidence.
- roleproof-blind-007: medium/unknown; sourceQuality={"problem_statement":4}; contextRoles={"problem_context":5,"external_reference":1}; topRisks=Some requirements are too vague or weakly evidenced.
- roleproof-blind-008: medium/passed; sourceQuality={"requirement_language":2}; contextRoles={"problem_context":1,"external_reference":1,"author_claim":8}; topRisks=Some requirements have only partial evidence.
- roleproof-blind-009: medium/passed; sourceQuality={"manual_check":1}; contextRoles={"external_reference":1,"author_claim":4}; topRisks=Some requirements are too vague or weakly evidenced.
- roleproof-blind-010: medium/passed; sourceQuality={"manual_check":1}; contextRoles={"external_reference":1,"author_claim":2}; topRisks=Some requirements are too vague or weakly evidenced. | Some changed files have broad test evidence, but no targeted test mapping.
