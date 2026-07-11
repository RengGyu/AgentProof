# AgentProof LLM Proof Planner Token Optimization Report

Generated: 2026-07-10T08:10:34.255Z
Status: llm_proof_planner_ab_needs_human_review
Mode: openai
Actual LLM attempted: true
Evaluation state: harness_complete / real_ab_attempted
Baseline set role: regression_dev_set_not_holdout
Prompt/schema: llm-proof-planner-v2-token-optimized / 2
Requested/resolved model: gpt-5-mini / per-run only
Reasoning effort: low
Max output tokens: 2600

## Summary

- Candidate count: 30
- Unique candidates: 10
- Repeat count: 3
- Actual LLM completed: 30
- Actual LLM skipped: 0
- Failed: 0
- Fallback safety records: 0
- Harness guardrail accepted: 30
- Harness false pass increase: 0
- Harness false blocker increase: 0
- Harness semantic false reassurance: 0
- Harness semantic false alarm: 0
- Harness critical gap downrank: 0
- Harness priority-may-be-too-narrow nudge: 0
- Real performance metrics: available
- Consistency: unstable
- Completed latency p50/p95 ms: 10234 / 16927
- Operational latency p50/p95 ms: 10234 / 16927
- Token usage total: input 43341, output 26017, visible output 21665, reasoning 4352, total 69358
- Average tokens/run: input 1444.7, output 867.23, visible 722.17, reasoning 145.07
- Estimated cost: unavailable
- Token reduction vs v1 baseline: 31.9% total per run, 51.06% output per run
- Token reduction vs previous A/B: 45.21% total per run, 66.66% output per run
- Total latency ms: 347117

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
- Top semantic risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements have only partial evidence. | Behavior changed without strong test evidence.

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
- Top semantic risks: Some requirements have only partial evidence. | Potential scope creep in changed files.

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
- Top semantic risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced.

### roleproof-blind-007 golang/go#54390

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements are too vague or weakly evidenced. | No public test/build workflow run, check, or raw CI log was available.

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
- Top semantic risks: Some requirements have only partial evidence.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements have only partial evidence. | Behavior changed without strong test evidence.

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
- Top semantic risks: Some requirements have only partial evidence. | Potential scope creep in changed files.

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
- Top semantic risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced.

### roleproof-blind-007 golang/go#54390

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements have only partial evidence.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements have only partial evidence. | Behavior changed without strong test evidence.

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
- Top semantic risks: Some requirements have only partial evidence. | Potential scope creep in changed files.

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
- Top semantic risks: Some requirements have only partial evidence. | Some changed files have broad test evidence, but no targeted test mapping.

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
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced.

### roleproof-blind-007 golang/go#54390

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: no_change
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements have only partial evidence.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced.

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
- Top semantic risks: Some requirements are too vague or weakly evidenced. | Some changed files have broad test evidence, but no targeted test mapping.

## Human Review Caveat

This report validates the A/B pathway and guardrails. It does not complete manual labels and does not prove PR correctness.
