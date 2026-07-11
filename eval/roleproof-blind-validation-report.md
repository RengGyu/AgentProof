# AgentProof Role-Proof Blind Validation Report

Status: roleproof_blind_reports_need_human_labeling

## Privacy Boundary

- Public GitHub metadata only.
- No raw diffs, raw CI logs, tokens, private data, raw prompts, evidenceIndex, or claims are stored.
- AgentProof output is not a correctness label. Human review is still required.

## Summary

- Candidates: 10
- Completed: 10
- Failed: 0
- Possible false pass: 0
- Possible false blocker: 0
- Role extraction needs review: 0
- ProofGraph used in judgment: 8

## Repository Distribution

- sveltejs/svelte: 2
- tailwindlabs/tailwindcss: 2
- microsoft/TypeScript: 1
- rust-lang/rust: 1
- golang/go: 1
- sympy/sympy: 1
- numpy/numpy: 1
- ansible/ansible: 1

## Candidate Results

| Candidate | PR | Analysis | Test/build | Priority | Role extraction | Obvious problem |
| --- | --- | --- | --- | --- | --- | --- |
| roleproof-blind-001 | sveltejs/svelte#18388 | completed | passed | high | looks_clean | none |
| roleproof-blind-002 | sveltejs/svelte#18425 | completed | passed | medium | looks_clean | none |
| roleproof-blind-003 | tailwindlabs/tailwindcss#20310 | completed | unknown | medium | looks_clean | none |
| roleproof-blind-004 | tailwindlabs/tailwindcss#20292 | completed | unknown | high | looks_clean | none |
| roleproof-blind-005 | microsoft/TypeScript#62923 | completed | passed | medium | looks_clean | none |
| roleproof-blind-006 | rust-lang/rust#150102 | completed | failed | blocker | looks_clean | none |
| roleproof-blind-007 | golang/go#54390 | completed | unknown | medium | looks_clean | none |
| roleproof-blind-008 | sympy/sympy#30015 | completed | passed | medium | looks_clean | none |
| roleproof-blind-009 | numpy/numpy#31771 | completed | passed | medium | looks_clean | none |
| roleproof-blind-010 | ansible/ansible#86660 | completed | passed | medium | looks_clean | none |

## Extraction Quality Notes

### roleproof-blind-001 sveltejs/svelte#18388

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"problem_context":9,"reproduction_context":4,"external_reference":1,"author_claim":16}
- Top risks: Requirement-level proof graph found missing targeted proof. | Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.
- Limitations: Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored.

### roleproof-blind-002 sveltejs/svelte#18425

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"author_claim":19,"environment_context":2,"external_reference":1}
- Top risks: Some requirements are too vague or weakly evidenced.
- Limitations: Multiple supported issue references found (sveltejs/svelte#17218, sveltejs/kit#16031); did not choose a single issue as requirement source. Original request mapping is ambiguous. | Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored. | No original task text was provided; criteria were inferred from PR description. | At least one requirement needs human interpretation.

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"problem_context":21,"environment_context":2,"reproduction_context":1,"author_claim":5,"external_reference":1}
- Top risks: Some requirements have only partial evidence. | Behavior changed without strong test evidence.
- Limitations: No public test/build workflow run, check, or raw CI log was available from the collected metadata. | Raw CI logs were not fetched or stored. | Confidence is based only on issue, diff, and test-artifact evidence because no public test/build execution evidence was found.

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"problem_context":23,"environment_context":7}
- Top risks: Requirement-level proof graph found missing targeted proof. | Some requirements have only partial evidence. | Potential scope creep in changed files.
- Limitations: No public test/build workflow run, check, or raw CI log was available from the collected metadata. | Raw CI logs were not fetched or stored. | Confidence is based only on issue, diff, and test-artifact evidence because no public test/build execution evidence was found.

### roleproof-blind-005 microsoft/TypeScript#62923

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"problem_context":5,"environment_context":3,"external_reference":1}
- Top risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.
- Limitations: Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored.

### roleproof-blind-006 rust-lang/rust#150102

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"author_claim":13,"external_reference":1}
- Top risks: Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced. | Behavior changed without strong test evidence.
- Limitations: Public GitHub Actions metadata was collected for build/test jobs; raw log archives were not fetched or stored. | Public GitHub Actions metadata showed failing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored. | No original task text was provided; criteria were inferred from PR description. | At least one requirement needs human interpretation.

### roleproof-blind-007 golang/go#54390

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"problem_context":5,"external_reference":1}
- Top risks: Some requirements are too vague or weakly evidenced.
- Limitations: No public test/build workflow run, check, or raw CI log was available. | Raw CI logs were not fetched or stored. | Confidence is based only on issue, diff, and test-artifact evidence because no public test/build execution evidence was found. | At least one requirement needs human interpretation.

### roleproof-blind-008 sympy/sympy#30015

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"problem_context":1,"external_reference":1,"author_claim":8}
- Top risks: Some requirements have only partial evidence.
- Limitations: GitHub Actions job-step metadata unavailable: request timed out after 2500 ms or network failed. | Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored.

### roleproof-blind-009 numpy/numpy#31771

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"external_reference":1,"author_claim":4}
- Top risks: Some requirements are too vague or weakly evidenced.
- Limitations: GitHub check-run evidence was capped at 60 checks. | Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored. | No original task text was provided; criteria were inferred from PR description. | At least one requirement needs human interpretation.

### roleproof-blind-010 ansible/ansible#86660

- Requirement extraction: looks_clean
- Role notes: No obvious template/environment heading in summarized requirements. Context signals were preserved in proofGraph.context.
- Context role counts: {"external_reference":1,"author_claim":2}
- Top risks: Some requirements are too vague or weakly evidenced. | Some changed files have broad test evidence, but no targeted test mapping.
- Limitations: GitHub check-run evidence was capped at 60 checks. | Public GitHub Actions metadata showed passing build/test jobs; raw log archives were not fetched or stored. | Raw CI logs were not fetched or stored. | No original task text was provided; criteria were inferred from PR description. | At least one requirement needs human interpretation.


## Failed Analyses

None

## Remaining Reviewer Questions

- Do summarized core requirements match the linked issue/task intent?
- Are missing targeted proof gaps useful, or too noisy for no-test implementation changes?
- Did any check/deploy/docs status distort testBuildStatus?
- Are visual/UI cases clearly separated from build pass/fail status?
