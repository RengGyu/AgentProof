# AgentProof Evaluation Pack

This document defines the MVP evaluation approach for AgentProof. The goal is not to invent a subjective reviewer score. The goal is to measure whether AgentProof produces grounded evidence reports from real benchmark data without leaking future outcome labels into report inputs.

## Data Sources

| Source | MVP use | Oracle strength | Caveat |
| --- | --- | --- | --- |
| [SWE-bench Verified](https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified) | Scored MVP core for issue text, visible patch/test evidence, and false-verified checks | Strong | Treat as benchmark-resolved, not full semantic correctness. |
| [BugSwarm](https://www.bugswarm.org/) | Later CI/log evidence pack | Strong | Fail/pass CI is build evidence, not full requirement satisfaction. |
| [Defects4J](https://github.com/rjust/defects4j) | Later regression-test-backed bug/fix pack | Strong | Java-only and not PR-review shaped. |
| [BugsInPy](https://github.com/soarsmu/BugsInPy) | Later Python bug/fix pack | Strong | License and redistribution need a separate check. |
| [AIDev](https://huggingface.co/datasets/hao-li/AIDev) | Exploratory only | Weak | Merge/reject/review states are proxy labels, not correctness. |

## Scoring Rules

- Score only deterministic or dataset-provided signals: schema validity, evidence IDs, changed file evidence, visible test file evidence, unsupported verified requirements, future-label leakage, and secret-looking payloads.
- Do not use an LLM judge as ground truth.
- Do not feed `FAIL_TO_PASS`, `PASS_TO_PASS`, hidden tests, post-fix outcomes, dataset names, benchmark URLs, or gold-patch metadata into the report input.
- Use benchmark labels only after report generation to evaluate calibration.
- Prefer `unknown` or `unclear` when evidence is not visible at PR review time.

## Commands

Fetch a small real SWE-bench Verified sample into a git-ignored local directory. The fetcher writes normalized evaluation cases by default, not raw dataset rows:

```bash
pnpm eval:fetch:swebench -- --length 10
```

Run the evaluation harness tests:

```bash
pnpm eval:pack
```

Print a learning summary for the generated cases:

```bash
pnpm eval:summary
```

Generated benchmark cases are written to `eval/generated/` and must not be committed because they still contain short patch excerpts and separated oracle labels.

## Learning Loop

Evaluation failures become a learning backlog for the verifier rather than a model-training label by default.

- Schema failures mean the report contract or validation boundary needs work.
- Missing changed-file evidence means diff indexing needs work.
- Missing test-file evidence means test path detection needs work.
- Oracle leakage means benchmark labels entered the report input and the harness is invalid.
- Unsupported verified requirements mean requirement scoring is too optimistic.
- Privacy failures mean redaction or generated-artifact filtering needs work before storing outputs.
- Warning metrics should be reviewed before treating a benchmark run as calibrated.
- Requirement calibration failures mean `met` was used without requirement-linked passing execution evidence.
- Missing-test calibration failures mean implementation changes lost either test-artifact or test-execution gaps.

Fine-tuning is explicitly out of scope for this MVP. Improve deterministic extraction, prompts, schema validation, and tests first.
