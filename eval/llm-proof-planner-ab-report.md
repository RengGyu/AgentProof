# AgentProof LLM Proof Planner A/B Report

Generated: 2026-07-10T02:46:54.801Z
Status: llm_proof_planner_ab_needs_human_review
Mode: openai
Actual LLM attempted: true
Evaluation state: harness_complete / real_ab_attempted
Baseline set role: regression_dev_set_not_holdout

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
- Harness semantic false alarm: 6
- Harness critical gap downrank: 0
- Harness priority-may-be-too-narrow nudge: 3
- Real performance metrics: available
- Consistency: unstable
- Completed latency p50/p95 ms: 28848 / 45568
- Operational latency p50/p95 ms: 28848 / 45568
- Token usage total: input 48561, output 78033, total 126594
- Estimated cost: $0
- Total latency ms: 955648

## Guardrails

- Deterministic test/build status is copied through unchanged.
- Failed execution evidence must be acknowledged by the LLM suggestion.
- Deterministic gap kinds must remain visible.
- LLM suggestion uses semanticClarity, sourceFidelity, and suggestionConfidence, not deterministic sourceQuality/sourceAuthority.
- Dry-run/mock output is not reported as real LLM quality, cost, or latency.

## Candidate Notes

### roleproof-blind-001 sveltejs/svelte#18388

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Adding bigint to Primitive could unintentionally widen snapshot types if other conditional branches assume narrower semantics. | Insufficient targeted tests may allow a fix to regress in other scenarios (symbols, null/undefined). | Changes limited to ambient/type files might have ripple effects across public API types; downstream typings consumers could be affected.

### roleproof-blind-002 sveltejs/svelte#18425

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Ambiguous core requirement prevents mapping to code/tests. | Insufficient implementation or test evidence to assert behavioral change. | Multiple related issue references increase source-selection ambiguity.

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: No execution evidence: claimed behavior changes lack run artifacts or logs demonstrating the issue or its fix. | Partial evidence only: implementation and tests are present but not executed, leaving the real-world behavior unverified. | Keying ambiguity: it's unclear whether the cache key includes only opts.from or also content-derived inputs, which is central to correctness.

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: No execution evidence: changes are asserted via snapshots/implementation files but not validated by recorded test runs or CI logs. | Snapshots might have been updated without explicit test run output, making it unclear whether the change was intentional or an accidental snapshot drift. | Environment differences (Vite, Node) could cause reproduced behavior to diverge; environment claims are present but not validated.

### roleproof-blind-005 microsoft/TypeScript#62923

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: true
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Partial evidence only: targeted tests and implementation are present but no execution outputs to confirm behavior. | A core compiler file (src/compiler/checker.ts) was modified — high blast radius for crashes. | Changed files reference baseline artifacts, but mapping between changes and targeted tests is incomplete.

### roleproof-blind-006 rust-lang/rust#150102

- Deterministic priority/test: blocker / failed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. | Core requirement text is too vague to verify automatically. | Behavior changed without targeted test evidence to prove correctness.

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
- Top semantic risks: Core requirements are high-level problem statements without a concrete spec or testable acceptance criteria. | Security claim (directory traversal) is asserted but lacks a minimal reproducible example or threat model to support severity. | No implementation nor tests were provided, so behavior-change claims cannot be verified from deterministic evidence.

### roleproof-blind-008 sympy/sympy#30015

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: true
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: The exact exception or contract for 'rejecting' zoo is unspecified; different choices affect downstream callers. | Partial evidence: tests/implementation exist but no execution logs captured; cannot confirm runtime behavior. | Ambiguity whether 'pseudo polynomial ring' vs 'EX' selection is always safe for all downstream algorithms.

### roleproof-blind-009 numpy/numpy#31771

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Ambiguous requirement text prevents mapping to implementation or tests. | No targeted tests or implementation evidence present in deterministic package. | Important raw CI/log artifacts are absent (capped/fetching not performed), limiting automated verification.

### roleproof-blind-010 ansible/ansible#86660

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: manual_review
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Ambiguous/underspecified requirement makes automated verification impossible. | No targeted tests mapped to changed implementation files; proof is brittle. | Deterministic evidence coverage is low (17%) and confidence is low (0.2).

### roleproof-blind-001 sveltejs/svelte#18388

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: No targeted types-only tests: the PR changes typing logic but lacks focused tests proving BigInt behavior is fixed. | Partial evidence: implementation files changed, but mapping of the change to the stated requirement isn't validated by assertions. | Ambiguity in Primitive definition: if adjusted incorrectly, other primitives could be misclassified, causing regressions.

### roleproof-blind-002 sveltejs/svelte#18425

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Core requirement is underspecified and cannot be automatically validated. | No implementation or targeted test evidence present in the deterministic package. | Multiple external issue references exist; the requirement origin is ambiguous.

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: All core requirements currently lack execution evidence (missing_execution). | Some requirements rely on environment-specific filesystem behavior (mtime semantics) that may vary across platforms/CI. | Existing tests were changed but no recorded test run or CI logs were provided to show behavioral regression or fix verification.

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Missing execution evidence: snapshots and file changes alone do not prove tests/builds were executed successfully. | Environment ambiguity: informal mentions of Vite and Node versions are present but not tied to executed reproductions. | Potential scope creep: CHANGELOG changes and multiple files touched increase review burden without execution proof.

### roleproof-blind-005 microsoft/TypeScript#62923

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: true
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Absence of execution evidence (no runs/logs) leaves the 'no crash' claim unproven. | Only partial evidence: tests and baselines exist, but we cannot confirm they were executed after the change. | Changed implementation (src/compiler/checker.ts) lacks source excerpts, so reviewers cannot inspect exact edits to assess crash risk. | Public CI metadata indicates passing, but raw logs were not captured—possible masking of transient issues.

### roleproof-blind-006 rust-lang/rust#150102

- Deterministic priority/test: blocker / failed
- LLM status: completed
- Priority nudge: manual_review
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced. | Behavior changed without strong test evidence.

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
- Top semantic risks: Core requirements are underspecified (ambiguous semantics for normalization and host-root boundaries). | No unit tests or CI execution evidence present to demonstrate current behavior or regression coverage. | Security claim (directory traversal) is unproven without PoC or threat modeling; may be speculative. | Behavioral differences tied to trailing slash are not documented and require a policy decision.

### roleproof-blind-008 sympy/sympy#30015

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: true
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: No execution evidence: tests were modified but not run, so behavior at runtime is unverified. | Ambiguity about intended fail-mode: tests must assert whether construct_domain should raise an error or return EX. | Partial evidence only: implementation change present but raw diffs and logs are not available to confirm exact edits.

### roleproof-blind-009 numpy/numpy#31771

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: manual_review
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Core requirement text is ambiguous and cannot be machine-checked. | No implementation evidence was captured for the requirement. | No targeted tests were found for validating the requirement. | CI/log evidence is incomplete (raw logs not fetched; check-run cap).

### roleproof-blind-010 ansible/ansible#86660

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Requirement text is too vague to map to implementation or tests. | Changed implementation files are not clearly linked to the requirement. | No targeted tests were added or mapped to validate the claimed behavior.

### roleproof-blind-001 sveltejs/svelte#18388

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: No targeted type-level tests exist to reproduce or guard against the BigInt inference bug. | Changes touch only .d.ts/ambient types where runtime tests won't detect regressions. | Public CI metadata is limited (raw logs not fetched) so runtime test coverage claims are less actionable. | Partial evidence only (implementation files changed) without verification leaves regression risk.

### roleproof-blind-002 sveltejs/svelte#18425

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: manual_review
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Core requirement ambiguous and too high-level to map to tests. | Multiple linked issues referenced — unclear which is the target for this PR. | No implementation/test artifacts captured in the deterministic evidence package.

### roleproof-blind-003 tailwindlabs/tailwindcss#20310

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: All core requirements currently lack execution evidence (missing_execution). | Some requirements only have partial evidence in the diff and tests; the PR may change runtime behavior without captured CI evidence. | Ambiguity about which preprocessor outputs or dependency lists must be included (implementation-specific detail).

### roleproof-blind-004 tailwindlabs/tailwindcss#20292

- Deterministic priority/test: medium / unknown
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: missing_execution: absence of CI or local test run artifacts means reviewers cannot confirm tests pass/fail or that the built CSS contains the claimed rule. | partial evidence only: snapshots / test files exist but without execution logs their relevance to current behavior is ambiguous. | scope creep: changes listed in changed files (including CHANGELOG.md) might indicate broader intent than the single-line requirement; reviewers should verify scope.

### roleproof-blind-005 microsoft/TypeScript#62923

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: true
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Only partial evidence is present for the core requirement; no runtime traces were retained. | Changed files have broad test evidence but lack a clear targeted test mapping demonstrating the absence of a crash. | Public CI metadata indicates passing status but raw logs were not archived—this can hide intermittent crashes or environment-specific behavior.

### roleproof-blind-006 rust-lang/rust#150102

- Deterministic priority/test: blocker / failed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Test/build execution failed, so the PR is not proven ready. | Some requirements are too vague or weakly evidenced. | Behavior changed without strong test evidence.

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
- Top semantic risks: Core requirements are underspecified — tests and implementation intent are missing, enabling divergent fixes. | Potential security impact is claimed but unproven; prioritization may be incorrect without exploit reproducer. | Behavioral invariants (trailing-slash independence, removal of ..) are not codified; change may break callers if implemented without compatibility discussion.

### roleproof-blind-008 sympy/sympy#30015

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: consider_higher
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: true
- Critical gap downrank: false
- Requirement noise assessment: no_obvious_noise_in_summary
- Top semantic risks: Requirement text 'reject zoo' is ambiguous about whether to raise an error or map to EX — leads to inconsistent implementations. | No execution evidence (no logs/raw CI logs) to confirm tests actually run or pass against the change. | Partial evidence: files are modified and tests added, but absence of run logs leaves behavioral/compatibility regressions unverified.

### roleproof-blind-009 numpy/numpy#31771

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: manual_review
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Core requirement is underspecified — acceptance criteria are not explicit. | No stored file contents for the claimed release-note; only the path is present. | No targeted tests or execution evidence to validate the release-note content. | Low confidence in inferred mapping from PR body to requirement due to missing raw data.

### roleproof-blind-010 ansible/ansible#86660

- Deterministic priority/test: medium / passed
- LLM status: completed
- Priority nudge: manual_review
- False pass increase: false
- False blocker increase: false
- Semantic false reassurance: false
- Semantic false alarm: false
- Critical gap downrank: false
- Requirement noise assessment: semantic_planner_can_flag_noise_but_not_replace_source_of_truth
- Top semantic risks: Core requirement is ambiguous and cannot be mapped deterministically to tests. | No targeted tests identified that validate the changed strategy code. | Changed files are implementation-level but lack explicit behavioral assertions.

## Human Review Caveat

This report validates the A/B pathway and guardrails. It does not complete manual labels and does not prove PR correctness.
