# PR-to-Evidence Review offline evaluation

## Boundary

- **VERIFIED:** The committed 10-case `swebench-verified.diverse.jsonl` bytes matched manifest SHA-256 `452c12d0e0a0ed4566b49c62ee406bae610a54167f29a2cf2831a39de6b30bcb` before evaluation.
- **VERIFIED:** Every case ran through the advisory no-provider pipeline, generated-private-full validation, PR-to-Evidence projection, and full `ReportView` server rendering. A rejecting `fetch` guard observed zero external calls.
- **VERIFIED:** The separate source-adapted profile changed only `taskSource` to `issue`. It did not rewrite issue text, patches, URLs, revisions, checks, or logs.
- **UNCLEAR:** The 10 cases are bounded development excerpts, not a holdout. Their hidden SWE-bench oracle is not PR-to-evidence relevance gold. Semantic relevance, human task-completion time, and real link-arrival success were not evaluated and remain `null`.

## Results

| Observation | As-is profile | Source-adapted profile |
|---|---:|---:|
| Pipeline/validation/SSR completed | 10/10 | 10/10 |
| Input changed files displayed | 33/33 | 33/33 |
| Cases producing objective mode | 0/10 | 0/10 |
| Strict report requirements generated | 26 | 26 |
| Observation-bundle objectives | 0 | 0 |
| Assessment targets | 0 | 0 |
| Collected review items | 33 | 33 |
| Direct code links produced | 0 | 0 |
| Execution invariant passed | 10/10 | 10/10 |
| External calls | 0 | 0 |

**VERIFIED:** As-is inputs had no `taskSource`, PR-number URL, full head SHA, or full base SHA. They produced 26 strict report requirements, but the observation bundle admitted 0 objectives and the assessment produced 0 targets with `no_assessable_claims`. Ambiguous source plus no assessable claim selected change-summary view for all 10 cases.

**VERIFIED:** Adding only the recorded Issue source changed all 10 source states to `linked_issue` and preserved the same 26 strict report requirements, but the no-provider observation bundle still admitted 0 objectives and the assessment produced 0 targets with `no_assessable_claims`. That condition alone selected change-summary mode for all 10. This is a functional limitation of this offline path, not a semantic-accuracy result.

**VERIFIED:** Both profiles preserved the complete input file inventory in the rendered review (33/33) and produced no unbacked execution item or passing-execution language without passing evidence. File-display coverage measures structural preservation only; it does not establish that a file is relevant to an objective.

**VERIFIED:** Actual-fixture direct links were unavailable in both the report evidence and the new projection because the fixtures contain repository URLs rather than PR URLs and do not contain exact head/base revisions. The synthetic cases kept those inputs explicit and produced six projection links where the report's evidence locators contained zero direct code URLs. Exact head/base selection, renamed/removed paths, and all six links survived signed tenant storage and hydration.

## Synthetic regression result

- The test runner passed all cases. Separately, 3/3 product scenarios completed and 17/18 independently declared product expectations matched.
- PR-author and missing-objective modes matched. Missing-objective rendering kept failed CI and the real collection limitation while suppressing the purpose-only warning.
- Exact head/base/rename navigation, persistence, portable-summary privacy, failed-CI visibility, and execution non-promotion checks passed.
- **FAILED:** The modal-free Issue fixture expected `linked_issue`, but the deterministic advisory classifier selected the PR-title author claim and projected `pr_author_claim`. The evaluator records this mismatch; product behavior and the fixture expectation were not changed to hide it.

## Local timing

Apple M1, macOS arm64, Node v22.22.0; one warm-up and three measured runs per case (30 samples/profile), nearest-rank percentiles. Persistence is excluded.

| Phase | As-is p50 / p95 | Source-adapted p50 / p95 |
|---|---:|---:|
| Advisory pipeline + validation | 40.82 / 103.00 ms | 42.45 / 108.24 ms |
| Projection + full SSR | 19.28 / 26.92 ms | 20.20 / 28.97 ms |

No measured sample failed. A separate invalid-input regression verifies that invalid samples are excluded and counted, never recorded as zero milliseconds.

## Artifacts

- Machine-readable result: `evaluation.json` (SHA-256 `cabeab2bdb81f9f37922517c50ba482885db8e1cdf91b1ae07ddd859aa279fd7`)
- Synthetic fixture: `../../../eval/fixtures/pr-evidence-review.synthetic.jsonl` (SHA-256 `1f8739055873a203a25caa872cf0723932427830ea3a4b354246c5e64fec9bc8`)
- Reproduction command: `AGENTPROOF_PR_EVIDENCE_EVAL_OUTPUT=<new-output-path> pnpm exec vitest run --config scripts/pr-evidence-review-evaluation-vitest.config.ts`
