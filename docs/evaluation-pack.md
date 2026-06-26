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

The repository includes committed SWE-bench Verified fixtures under `eval/fixtures/` so CI can run without network access: a small smoke case, a representative four-case pack, and a diverse ten-repository pack. Each manifest pins the fixture file hash and records the dataset/source metadata.

Fetch a larger real SWE-bench Verified sample into a git-ignored local directory. The fetcher writes normalized evaluation cases by default, not raw dataset rows:

```bash
pnpm eval:fetch:swebench -- --length 10   # quick local smoke
pnpm eval:fetch:swebench -- --length 100  # broader local check
```

Run the evaluation harness tests:

```bash
pnpm eval:pack
```

Promote reviewed generated cases into committed fixtures:

```bash
pnpm eval:promote:fixture -- \
  --input eval/generated/swebench-verified.cases.jsonl \
  --output eval/fixtures/swebench-verified.example.jsonl \
  --case astropy__astropy-12907 \
  --source-offset 0 \
  --source-length 100 \
  --selection "Representative requirement/evidence coverage case."
pnpm eval:summary:fixture:strict
```

The promotion tool only accepts normalized JSONL input under `eval/generated/` and writes paired `.jsonl` plus `.manifest.json` files under `eval/fixtures/`. It strips raw hidden oracle labels from committed fixtures and keeps only manifest counts/hashes.
The current diverse fixture intentionally uses ten non-`astropy`/`django` repositories and includes one implementation-only case so missing-test calibration is exercised without relying on tidy visible test patches in every sample.

Print a learning summary. In a clean checkout this uses all committed fixtures; if local generated cases exist, they are preferred:

```bash
pnpm eval:summary
pnpm eval:summary:strict
```

The summary harness accepts only normalized `EvaluationCase` JSONL. It intentionally refuses raw dataset rows so hidden oracle labels and raw benchmark fields cannot be converted or printed by accident.
Strict mode additionally fails on warning or unknown metrics, which is useful before promoting generated samples into committed fixtures.

Force the committed fixture path even when `eval/generated/` exists. This reads every committed `.jsonl` fixture under `eval/fixtures/`:

```bash
pnpm eval:summary:fixture
pnpm eval:summary:fixture:strict
```

Generated benchmark cases are written to `eval/generated/` and must not be committed because they still contain short patch excerpts and separated oracle labels.

## Committed Fixture Contract

- Fixtures must be normalized `EvaluationCase` records, not raw benchmark rows.
- `input` must not contain dataset names, benchmark URLs, gold-patch wording, `FAIL_TO_PASS`, `PASS_TO_PASS`, hidden labels, or hidden values.
- Generated local cases may contain source-provided raw oracle labels under `oracle`; committed fixtures must strip raw hidden oracle labels and keep only manifest counts/hashes.
- Patch excerpts must stay bounded; committed cases should keep each patch at or below 80 lines and each case's total patch text below 1,500 bytes.
- The manifest must record dataset revision, row API URL, source offset/length, source row hash, oracle label count/hash, fixture hash, normalizer version, and privacy notes.
- Do not add invented pass/fail labels, quality scores, expected prose reviews, or LLM judgments to fixtures.

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
