# AgentProof Controlled Human A/B Protocol

Status: protocol and worksheet ready; controlled experiment not yet runnable  
Protocol version: `agentproof-human-ab.v1`  
Planner input/output policy: `v1` / `v2.1`

## Product and truth boundary

This study asks whether append-only LLM semantic assistance helps a human reviewer use an AgentProof evidence report. It does not evaluate a generic code reviewer and it does not allow a model to alter deterministic test/build status, priority, deterministic gaps, or a correctness decision.

Arm D contains the deterministic report only. Arm L contains the same deterministic report plus a guardrail-accepted LLM proof-planner suggestion. A rejected or unavailable suggestion falls back to Arm D and is recorded as an operational failure under the preregistered rule; it is never repaired by hand.

The study is not evidence that either arm is correct, safe to merge, or ready to become the product default.

## Working-tree classification

The takeover inspection was performed before this protocol's first edits at commit `04ef1fdc8f9d91f3f72b0a6ac1df3213e27ef249` on `main`. `HEAD` matched `origin/main`. There were no staged changes and there were 91 dirty paths: 48 modified tracked files and 43 untracked files. This task began with 97 dirty paths: 50 modified tracked files and 47 untracked files. After adding the preflight, runner, split workbooks, smoke plan, and prepared manifest without deleting or staging anything, the tree has 103 dirty paths: 50 modified tracked files and 53 untracked files. The existing semantic-integrity artifact records the earlier commit and 91-path dirty count, but it does not fingerprint the exact dirty contents, so the evaluated source state remains `unclear` and is not reproducible from that commit.

| Classification | Evidence-backed scope | Isolation decision |
| --- | --- | --- |
| Semantic-integrity planner slice | `src/lib/llm-proof-planner.ts`, its focused test, `scripts/llm-proof-planner-ab.mjs`, the semantic-integrity JSON/report, and only the planner script entry inside `package.json` | Keep together as the current planner implementation/evaluation slice. These files are untracked or mixed with other edits, so line-level phase ownership is not provable. |
| Earlier planner evaluation history | Initial A/B and token-optimization JSON/reports | Preserve as immutable historical records. Do not relabel or rewrite them as v2.1. |
| Deterministic evidence/proofGraph foundation | Changes centered on `types.ts`, extractors, verifier, report validation, structured output, evidence-status, external regression cases, deterministic baseline, and proofGraph/role-proof artifacts | Treat as an upstream foundation and isolate separately from semantic-integrity work when commits are eventually requested. The planner consumes this foundation but does not own it. |
| Existing product, SaaS, UI, docs, and coordination work | Remaining dashboard/report UI, report storage/share, beta docs/tests, `AGENT_MEMORY.md`, handoff files, and older pilot/holdout artifacts | Preserve untouched. They are not safely attributable to the planner task. |
| Mixed tracked files | At minimum `package.json`; other broad files may contain both proofGraph and earlier product edits | Split by hunk only after a separate review. Never replace the whole file from another branch or artifact. |

After adding the sealed-holdout receipt template and the remaining preflight/workbook hardening, the current tree has 104 dirty paths: 50 modified tracked files and 54 untracked files. They remain classified without deletion as: 18 current planner/Human A/B paths, 4 immutable earlier planner-history artifacts, 39 deterministic proofGraph/evidence-foundation paths, 17 product/UI/report-sharing beta paths, and 26 older pilot/readiness/docs/coordination/config paths. Mixed `.env.example`, `package.json`, and `vitest.config.ts` require hunk review before any future commit.

`rg` found no product-runtime import of the LLM proof planner. The product default therefore remains deterministic.

## Schema compatibility decision

1. `CompactEvidencePackage.version = 1` remains the supported deterministic input contract.
2. The current semantic-integrity planner envelope is `version = "2.1"`. It is an exact-version contract because its required provenance fields materially differ from historical schema 2.
3. Legacy planner output v1 is measurement-only. Historical output v2 is historical-only. Neither is adapted, merged, or accepted as current output.
4. Unknown versions fail closed and fall back to the deterministic report.
5. Existing v1/v2 evaluation artifacts are immutable records. New metadata is applied only to future evaluations.
6. Compatibility is add-only at the evaluation-artifact boundary: existing `gitCommit`, `gitDirty`, and `schemaVersion` fields remain available while new explicit provenance fields are added.

## Reproducibility contract for a future run

Every newly generated evaluation artifact must record:

- requested model and the resolved model snapshot returned by the API;
- snapshot status: `single`, `mixed`, or `unavailable` (never infer a snapshot from the requested alias);
- prompt version, planner input schema v1, planner output schema v2.1, and evaluation-artifact schema version;
- source commit, `workingTreeDirty`, and dirty-path count;
- SHA-256 digests of the prompt, planner schema, evaluation harness, normalized baseline source, and prior comparison artifact when used;
- the existing privacy declarations and a statement that no raw prompt, raw reasoning, raw diff, full log, token, or private data was stored.

The split workbook templates are generated by the repo-local offline builder at `scripts/build-llm-proof-planner-human-ab-workbooks.mjs`, pinned to artifact-tool `2.8.6`. Its default output root is the stable repo-relative `outputs/controlled-human-ab-v1`; `AGENTPROOF_HUMAN_AB_OUTPUT_ROOT` may point to an isolated directory for no-overwrite reproducibility checks. The builder does not read API keys, call the network, or run an LLM evaluation. Its source SHA-256 and artifact-tool version are frozen in the coordinator manifest before workbook hashes are accepted. In the bundled workspace runtime, execute a temporary copy beside the loader-provided `node_modules` symlink and set the isolated output-root variable; do not install or vendor an alternate spreadsheet library into this repository.

Artifact-tool `2.8.6` assigns fresh OOXML relationship IDs on export, so a source-identical rebuild is not byte-for-byte deterministic. The isolated verification rebuild matched the current rater and coordinator workbooks after normalizing only those relationship IDs, while the raw xlsx SHA-256 values differed. The manifest therefore freezes the exact distributed binary hashes for integrity, records that binary rebuild hashes are not expected to match, and treats normalized OOXML plus workbook QA as regeneration evidence rather than substituting a new hash for a distributed artifact.

The builder still calls the documented freeze-pane API, but artifact-tool `2.8.6` does not serialize the expected worksheet `<pane>` into the exported xlsx. `labelsHeaderFreezeVerified` therefore remains false and distribution remains blocked until an independently verified supported export records the frozen Labels header. Excel table headers are not treated as equivalent evidence.

The controlled A/B remains blocked unless the source commit is present, `workingTreeDirty` is false, the resolved snapshot status is `single`, required digests are present, the protocol version is bound to the run, and a sealed holdout receipt is bound to the run. A commit plus `workingTreeDirty: true` is not reproducible.

## Blinding and assignment

- The coordinator creates opaque case IDs and opaque arm IDs. Raters do not see D/L mapping, model name or snapshot, prompt/schema version, token/latency data, candidate selection reason, expected stressors, or oracle/reference labels.
- Rater and coordinator artifacts are physically separate. A rater workbook contains only instructions and that rater's opaque assigned label rows. It must never contain Summary, roster, manifest, arm key, model/prompt/schema metadata, or another rater's results.
- The coordinator workbook contains assignment preflight, scalar-only imported labels, and Summary. It is never distributed to raters and must not contain the D/L arm key until labels are frozen.
- Both arms use the same layout, deterministic truth, field order, and bounded source packet. Repository identity is hidden when it is not needed for judgment.
- One rater sees only one arm for a given case. This prevents the first exposure from training the second exposure and invalidating decision time.
- Each case-arm receives at least two independent raters. Assignment balances D/L counts and presentation order per rater.
- Raters do not discuss cases or inspect other labels until submissions are frozen. Arm mapping is revealed only after the immutable label freeze.
- The packet contains the bounded original task and the same normalized deterministic evidence for both arms. It never contains raw/full logs, raw diffs, raw prompts/reasoning, secrets, private data, selection strata, or model-authored truth labels.

Before any rater workbook is exported, `agentproof-human-ab-preflight.v1` must pass. It canonicalizes IDs with NFKC, trimming, and case folding; rejects missing or invalid opaque IDs; rejects duplicate assignment IDs/indexes; requires contiguous per-rater assignment indexes; rejects both A/B and same-arm duplicate exposure for a reviewer/case key; requires both opaque arms and at least two independent reviewers per case-arm; verifies per-rater arm balance within one assignment; and rejects coordinator-only/unblinding fields in rater packets. Each rater packet must also bind the experiment ID, sealed-receipt hash, assignment-plan hash, successful global-preflight hash, and unique assignment IDs before report content can be revealed.

## The four evaluation items

No composite or overall-preference score is produced. Readability, style, trust, confidence, cost, schema validity, priority quality, and generic correctness are not additional rating axes.

| Item | Allowed value | Rubric |
| --- | --- | --- |
| Requirement accuracy | Integer 1–5 | `1`: material requirements are invented, distorted, or omitted. `3`: broadly accurate with a material omission or excess. `5`: all material requirements are faithfully represented with no invention. |
| proofPlan usefulness | Integer 1–5 | `1`: absent, irrelevant, infeasible, or asks for prohibited raw material. `3`: partly actionable but generic, redundant, or weakly tied to the gap. `5`: minimal, concrete, feasible next proof steps tied to the same requirement and deterministic gap. An absent plan scores 1 rather than becoming a fifth `availability` axis. |
| Warning accuracy | Integer 1–5 | `1`: material false alarm, false reassurance, execution contradiction, or critical warning omission. `3`: supported warnings mixed with a material over/under-warning. `5`: material warnings are evidence-grounded and calibrated, with no important contradiction or omission. |
| Review decision time | Non-negative seconds | Monotonic elapsed time from report reveal until the reviewer reaches a decision about whether the original task has enough evidence. The decision itself is not a scored item. |

Each ordinal score may carry a bounded note and packet/output anchor references solely to explain that score. `notScorableReason` is limited to insufficient source evidence or an operational failure and does not create another evaluation axis.

## Labeling procedure

1. The rater opens the assigned source packet without the report and confirms the task/evidence packet is readable.
2. The runner reveals one blinded report and starts a monotonic timer exactly once.
3. The rater stops the timer when a review decision is reached; the runner records elapsed seconds plus wall-clock start/submission timestamps and `runner_monotonic_complete` timing provenance. Excel `NOW()` and manual time repair are not sources of truth.
4. The rater independently scores requirement accuracy, proofPlan usefulness, and warning accuracy using the fixed anchors above.
5. The rater records only bounded evidence notes and opaque anchors. No raw source material is copied into the sheet.
6. The coordinator validates range/completeness, freezes submissions, then reveals the arm key.

The runner reserves a new no-clobber label journal before the first reveal, persists each completed row immediately, and marks the journal complete only after all assignments finish. A crash therefore leaves an auditable `in_progress` partial journal rather than silently losing completed rows. Duplicate start, restart, negative/non-finite elapsed time, or timer failure is an `operational_failure`; that row is excluded instead of receiving a hand-edited time.

## Summary eligibility

Coordinator Summary metrics use only rows whose helper state is `ScorableComplete`: every required protocol/experiment/receipt/rater/case/arm/assignment field is present, all three ordinal scores are integers from 1 through 5, runner decision time is finite and non-negative, `NotScorableReason` is blank, both audit timestamps exist, and timing provenance is exactly `runner_monotonic_complete`. Notes remain optional.

Rows marked `insufficient_source_evidence` or `operational_failure` require `runner_monotonic_not_scorable`; they, partially entered rows, pending rows, formula-bearing imports, and invalid scalar rows are excluded from counts, medians, and p75. The coordinator import accepts an explicit scalar allowlist only. Every aggregate filters on the same helper state; there is no separate permissive sample for time or any score.

## Dev-10 model smoke plan

`gpt-5.6-luna` is prepared only for one smoke pass over the existing 10 regression/dev cases. It is not a holdout run and cannot support a generalization claim.

- Exact source: ordered `roleproof-blind-001` through `roleproof-blind-010`.
- Exact run count: 10 candidates × 1 run.
- Required before network or output write: `AGENTPROOF_LLM_PROOF_PLANNER_DEV10_SMOKE=1`, a separately approved `AGENTPROOF_LLM_PROOF_PLANNER_EXECUTION_AUTHORIZED=1`, openai mode, exact `OPENAI_MODEL=gpt-5.6-luna`, non-empty `OPENAI_API_KEY`, candidate limit 10, run count 1, isolated output paths, existing output absence, and no-clobber enabled.
- Smoke output must stay under `outputs/controlled-human-ab-v1/dev10-smoke/`; the existing semantic-integrity JSON/Markdown paths are forbidden.
- The plan remains `planned_not_run` until a separate explicit execution request. The API key value is never printed or stored.

At this inspection, the locally supplied key used a different variable name. The prefix was corrected without reading or printing the value, and the exact `OPENAI_API_KEY` variable is now configured. This clears only the key-presence preflight; smoke execution remains unauthorized and `planned_not_run`.

Analysis reports the four items separately. Ordinal items use arm distributions, medians, and case-stratified win/tie/loss counts. Decision time uses median, p75, and the arm ratio. Small samples are described as a controlled pilot, not proof of semantic quality or generalization.

## New sealed holdout selection criteria

This section designs the holdout only. No candidate is selected, generated, or executed by this task.

### Inclusion

- Public PR with public evidence that it was AI-agent-authored.
- Original task or linked issue is available and can be pinned to a source timestamp.
- PR head SHA can be pinned.
- The case is judgeable from bounded normalized deterministic evidence without retaining raw diffs or full logs.
- Selection strata are preregistered before discovery: single/multi requirement, clear/ambiguous task, passed/failed/unknown execution, targeted-test present/missing, visual/manual-proof need, language/ecosystem, repository, and bounded change-size band.

The strata are selection controls only; they are not Human A/B rating axes.

### Exclusion

- All current `roleproof-blind-001` through `roleproof-blind-010` cases.
- Any PR or linked issue already present in an AgentProof dev, regression, pilot, blind, holdout, prompt-tuning, debugging, or manually inspected set.
- AgentProof's own PRs, private repositories/data, cases whose task is reconstructed only after seeing the PR body, and cases that require raw diffs or full logs to judge.
- Duplicate repository/PR/head SHA or materially duplicate task/input hashes.

The selector must not inspect planner output during selection. The exclusion registry is checked before sealing.

## Sealing rules

1. Freeze the selection policy/version, strata quotas, inclusion/exclusion rules, and replacement rule before candidate discovery.
2. Freeze the planner prompt/schema/guardrails and clean source commit before selecting cases.
3. Canonicalize each normalized input once; record opaque case ID, pinned PR head SHA, source `fetchedAt`, normalizer version, and input SHA-256 in the private manifest.
4. Store the private manifest, actual case identities, arm key, and randomization seed outside the repository under evaluator-controlled access. `.gitignore` alone is not a security boundary.
5. Commit only an identity-free receipt containing holdout ID, policy version, case count, sealed timestamp, manifest SHA-256, normalizer version, and source commit.
6. Generate D and L once from sealed inputs and hash each canonical output. The one-retry planner rule is pinned. Failures follow the preregistered operational-failure rule; cases are not silently replaced after outputs are seen.
7. After seal, any prompt/schema/guardrail change, case replacement, or evidence refresh creates a new experiment version and requires a new unseen holdout.
8. Freeze human labels and time records before revealing the arm key. Reference/adjudication labels stay separate and are never model input.
9. Published results remain summary-only and exclude tokens, raw prompts/reasoning, raw diffs/full logs, private data, rater identity mappings, arm seed, and holdout identities when disclosure would break future blinding.

## Next execution decision

The split workbook templates, assignment preflight, scalar completion rule, runner timer, dev-10 smoke plan, and prepared manifest shape are ready for review. The controlled Human A/B is **not executable yet** because the intended source changes are not isolated in clean commits, the resolved model snapshot is unavailable, actual reviewer assignments/per-rater workbook hashes do not exist, the existing 10 cases are dev/regression data, no new holdout has been selected and sealed, and no identity-free receipt is bound. The artifact-tool export also requires an independently verified frozen-header pane before distribution. Product-default LLM integration remains out of scope.
