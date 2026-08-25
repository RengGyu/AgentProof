# Real-Data Verification Readiness

## Decision boundary

Status: `READY_FOR_CANDIDATE_DEPLOYMENT`.

The local frozen-toolchain gate and two independent reviews are fresh for the
current uncommitted worktree. A real-data check remains `NO_GO` until this
exact worktree becomes a candidate commit and a release operator confirms that
the deployed SHA is that commit. This document prepares a controlled live
check; it is not evidence that one has run.

AgentProof remains an evidence-report product. The live check must not enable
anonymous report viewing, auto-merge, LLM-only promotion, public comments, or
full-report persistence.

## What must be true before a live check

1. The exact candidate commit has passed the current local gate:
   - focused toolchain and release-assessment tests;
   - `pnpm test`, typecheck, lint, build, and `git diff --check`;
   - independent grammar/trust review with zero Critical or Important findings.
2. The production deployment has been matched to that exact candidate SHA by
   the release operator. A preview URL alone is not that proof.
3. A maintainer-owned, disposable pull request exists in one explicitly
   authorized repository. Its repository is installed for the GitHub App.
4. Production is in the safe automation state: intake is enabled only for that
   repository; comments and saved reports are disabled. The public webhook
   status endpoint reports the expected event mode without exposing secrets.
5. The operator has reviewed the rollback in
   [the live-smoke runbook](./github-app-live-smoke-runbook.md). Secrets stay
   in a trusted operator shell and never enter chat, commits, screenshots, or
   this document.

## Fresh local evidence for the candidate commit

Run these commands again after committing, and record the resulting commit
SHA next to their output. The current uncommitted worktree passed them on
2026-08-25; that result cannot be transferred to a different commit.

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
node --test scripts/tooling-source-scan.test.mjs
node --test scripts/evaluation-toolchain-production-closure.test.mjs
node --test scripts/build-evaluation-toolchain-manifest.test.mjs
node --test scripts/evaluate-production-authority-release.test.mjs
node --test scripts/evaluate-evidence-release-gate.test.mjs
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
git diff --check
```

Expected current results: 160 test files passed (2,185 tests, 2 skipped),
typecheck/lint/build passed, grammar scan passed (7), production closure passed
(1), manifest passed (13), authority assessment passed (16), evidence gate
passed (17), and boundary gate passed (6). These are local engineering checks,
not a live GitHub or production result.

## Safe handoff from the owner

Provide only these five values:

```text
target_disposable_pr_url:
repository_confirmed: yes
github_app_installation_id:
action: synchronize
test_summary_only_save: no
```

Do not provide tokens, private keys, webhook secrets, raw webhook payloads,
diffs, logs, full reports, comment bodies, or saved-report contents.

## Operator sequence

1. Confirm the five preconditions above and the exact candidate SHA.
2. Run the controlled signed-webhook command from the existing runbook in a
   trusted shell. Use the default no-comment/no-save mode.
3. Observe only bounded metadata until the analysis reaches `completed` or a
   bounded terminal failure.
4. Confirm that the target PR received no AgentProof marker comment and that no
   full report was saved.
5. Immediately restore safe intake settings if the run reaches automation but
   fails, or after the planned check is complete.

Append only this bounded receipt to `docs/deployment-smoke.md` after a real
run:

```text
date:
candidate_sha:
target_pr:
action:
public_status_mode:
dry_run:
will_analyze:
will_comment: false
comment_suppressed: true
save_report_suppressed: true
analysis_status:
priority:
evidence_coverage:
head_sha_prefix:
saved_report_privacy: none | summary-only
```

## What one live check proves—and does not prove

It proves one deployed configuration can receive a signed PR event, obtain
authorized GitHub evidence, create an evidence report, and suppress comments
and persistent full reports as configured.

It does **not** prove general requirement correctness, broad reviewer utility,
all GitHub permission/rerun/fork cases, privacy across every surface, or
release approval. Those remain separate gates in
[`production-authority-blind-evaluation-design.md`](./superpowers/specs/2026-08-22-production-authority-blind-evaluation-design.md),
including sealed independent evaluation artifacts, aggregate-only scoring, and
an exact-SHA independent approval.

## Guard against overfitting during live validation

`pnpm smoke:production-regression` is a legacy supplemental signal, not the
release decision. Its historical proxy tasks include semicolon-separated
clauses, while the approved requirement source policy intentionally recognizes
list items, terminal sentences, and a remaining line—not clause NLP. Do not
change source parsing or reduce smoke thresholds merely to make that legacy
batch pass. Classify any mismatch first as product defect, legacy-oracle
mismatch, collection limitation, or ambiguous case.
