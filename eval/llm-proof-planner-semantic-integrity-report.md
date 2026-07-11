# AgentProof LLM Proof Planner Semantic Integrity Report

Generated: 2026-07-10T12:47:10.539Z
Status: llm_proof_planner_ab_needs_human_review
Mode: openai
Actual LLM attempted: true
Evaluation state: harness_complete / real_ab_attempted
Baseline set role: regression_dev_set_not_holdout
Prompt/schema: llm-proof-planner-v2-semantic-integrity / 2
Requested/resolved models: gpt-5-mini / gpt-5-mini-2025-08-07
Reasoning effort: low
Max output tokens: 2600
Git commit: 04ef1fdc8f9d91f3f72b0a6ac1df3213e27ef249
Dirty working tree: true (91 changed paths)

## Summary

- Candidate count: 30
- Unique candidates: 10
- Repeat count: 3
- Actual LLM completed: 30
- Actual LLM skipped: 0
- Failed: 0
- Fallback safety records: 0
- Harness guardrail accepted: 30
- First-pass accepted/rejected: 29 / 1
- Accepted after one retry: 30
- Harness false pass increase: 0
- Harness false blocker increase: 0
- Harness semantic false reassurance: 0
- Harness semantic false alarm: 0
- Harness critical gap downrank: 0
- Harness priority-may-be-too-narrow nudge: 3
- Incomplete/truncated sentence findings: 0
- Mixed-script findings: 0
- Execution contradiction findings: 0
- Raw log/stdout request findings: 0
- Invalid provenance findings: 0
- Retry/recovered count: 1 / 1
- Real performance metrics: available
- Consistency: semantic_instability_detected
- Truth/ID/category/priority/wording consistency: truth=stable, ids=stable, category=varied, priority=stable, wording=varied
- Completed latency p50/p95 ms: 9941 / 12898
- Operational latency p50/p95 ms: 9941 / 12898
- Token usage total: input 44426, output 27068, visible output 18748, reasoning 8320, total 71494
- Average tokens/run: input 1480.87, output 902.27, visible 624.93, reasoning 277.33, total 2383.13
- Estimated cost: unavailable
- Total-token change vs v2 token baseline: 3.08% increase
- Total latency ms: 292832
- Human labeling preflight ready: true
- Controlled Human A/B ready: false
- Product default ready: false
- Category variation requires human review: true

## Guardrails

- Deterministic test/build status is copied through unchanged.
- Failed execution evidence and deterministic gaps are copied from deterministic evidence, not model self-attestation.
- LLM suggestion uses semanticClarity and compact reviewer signals, not deterministic sourceQuality/sourceAuthority.
- Token/cost metrics come from API response usage, not model-authored JSON.
- Dry-run/mock output is not reported as real LLM quality, cost, or latency.

## Candidate Notes

### roleproof-blind-001 sveltejs/svelte#18388

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: missing_targeted_test] | Changed files lack targeted tests demonstrating the BigInt inference fix. [basis: missing_targeted_test]

### roleproof-blind-002 sveltejs/svelte#18425

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Some requirements are too vague or weakly evidenced. [basis: semantic_hypothesis]

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: missing_execution]

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Potential scope creep in changed files. [basis: semantic_hypothesis]

### roleproof-blind-005 microsoft/TypeScript#62923

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Changed files have broad test evidence but lack targeted test mapping. [basis: semantic_hypothesis]

### roleproof-blind-006 rust-lang/rust#150102

- Deterministic priority/test: blocker / failed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. [basis: failed_execution] | Some requirements are too vague or weakly evidenced. [basis: ambiguous_requirement]

### roleproof-blind-007 golang/go#54390

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Requirements are vague or lack concrete tests and implementation evidence. [basis: semantic_hypothesis]

### roleproof-blind-008 sympy/sympy#30015

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis]

### roleproof-blind-009 numpy/numpy#31771

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Requirement text is too vague to test or implement reliably. [basis: ambiguous_requirement]

### roleproof-blind-010 ansible/ansible#86660

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Some requirements are too vague or weakly evidenced. [basis: ambiguous_requirement] | Some changed files have broad test evidence, but no targeted test mapping. [basis: missing_implementation]

### roleproof-blind-001 sveltejs/svelte#18388

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: missing_targeted_test] | Changed files lack targeted tests for BigInt snapshot inference. [basis: missing_targeted_test]

### roleproof-blind-002 sveltejs/svelte#18425

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Some requirements are too vague or weakly evidenced. [basis: semantic_hypothesis]

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis]

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Potential scope creep in changed files. [basis: semantic_hypothesis]

### roleproof-blind-005 microsoft/TypeScript#62923

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Changed files have broad test evidence but lack targeted test mapping. [basis: semantic_hypothesis]

### roleproof-blind-006 rust-lang/rust#150102

- Deterministic priority/test: blocker / failed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. [basis: failed_execution] | Some requirements are too vague or weakly evidenced. [basis: ambiguous_requirement]

### roleproof-blind-007 golang/go#54390

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Requirements are vague and lack concrete tests. [basis: ambiguous_requirement]

### roleproof-blind-008 sympy/sympy#30015

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements only have partial evidence. [basis: semantic_hypothesis] | Tests may not fully cover symbolic-to-domain mapping edge cases. [basis: semantic_hypothesis]

### roleproof-blind-009 numpy/numpy#31771

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Requirement is vague, preventing automated verification. [basis: semantic_hypothesis]

### roleproof-blind-010 ansible/ansible#86660

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Some requirements are too vague or weakly evidenced. [basis: semantic_hypothesis] | Changed files lack targeted test mapping to the specific behavior change. [basis: semantic_hypothesis]

### roleproof-blind-001 sveltejs/svelte#18388

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Some changed files have broad test evidence, but no targeted test mapping. [basis: semantic_hypothesis]

### roleproof-blind-002 sveltejs/svelte#18425

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Requirement text is vague and cannot be verified from the PR alone. [basis: semantic_hypothesis]

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Behavior changed without strong test evidence. [basis: semantic_hypothesis]

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements only have implementation or snapshot evidence but lack execution proof. [basis: missing_execution] | Changed files may introduce scope creep beyond the stated preflight change. [basis: semantic_hypothesis]

### roleproof-blind-005 microsoft/TypeScript#62923

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis] | Changed files have broad test coverage but lack targeted mapping to the change. [basis: semantic_hypothesis]

### roleproof-blind-006 rust-lang/rust#150102

- Deterministic priority/test: blocker / failed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. [basis: failed_execution] | Requirement text is ambiguous and cannot be verified automatically. [basis: ambiguous_requirement]

### roleproof-blind-007 golang/go#54390

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Requirements are vague and lack test or implementation traces. [basis: semantic_hypothesis]

### roleproof-blind-008 sympy/sympy#30015

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements have only partial evidence. [basis: semantic_hypothesis]

### roleproof-blind-009 numpy/numpy#31771

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Requirement text is vague and lacks verifiable acceptance criteria. [basis: semantic_hypothesis]

### roleproof-blind-010 ansible/ansible#86660

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Some requirements are too vague or weakly evidenced. [basis: semantic_hypothesis] | Some changed files have broad test evidence but no targeted test mapping. [basis: semantic_hypothesis]

## Human Review Caveat

This report validates the A/B pathway and guardrails. It does not complete manual labels and does not prove PR correctness.
