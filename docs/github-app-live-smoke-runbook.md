# GitHub App Live Smoke Runbook

This runbook is for one controlled production check of GitHub App PR analysis. It proves that AgentProof can receive a signed pull request webhook, refetch PR evidence with an installation token, generate an evidence report, and avoid unintended comments or saved reports by default.

Use it only on a maintainer-owned disposable PR in one allowlisted repository.

## What This Proves

- Signed webhook intake reaches enabled `pull_request` automation.
- Repository allowlist and GitHub App credentials are sufficient for PR evidence collection.
- The response contains bounded metadata only: repository, PR number, head SHA, priority, and evidence coverage.
- Automatic GitHub comments stay suppressed.
- Saved reports stay suppressed unless the smoke explicitly opts in.
- Secret-like probes, raw diff text, `evidenceIndex`, claims, and raw re-prompt text are not echoed.

## What This Does Not Prove

- It does not validate auto-merge behavior. AgentProof must not auto-merge.
- It does not validate broad repository access. Use one test repository.
- It does not validate Slack, OpenAI, or explicit user-token PR comments.
- It does not prove durable idempotency across serverless instance restarts; the current v1 idempotency store is short-lived and in memory.

## Inputs To Prepare

Do not paste secret values into tickets, screenshots, commit messages, or chat transcripts.

If the project owner is on mobile, ask only for this safe handoff set:

- maintainer-owned disposable PR URL;
- confirmation that the PR belongs to the intended test repository;
- GitHub App installation id;
- desired action, or use the default `synchronize`;
- whether summary-only saved report metadata should be tested.

Do not ask a mobile user to paste `GITHUB_WEBHOOK_SECRET`, `GITHUB_PRIVATE_KEY`, `GITHUB_APP_ID`, GitHub tokens, raw webhook payloads, diffs, logs, full reports, comment bodies, or saved report contents.

| Input | Where to get it | Notes |
| --- | --- | --- |
| `AGENTPROOF_WEBHOOK_SMOKE_SECRET` | Same value as deployed `GITHUB_WEBHOOK_SECRET` | Used locally to sign the synthetic webhook body. |
| `AGENTPROOF_WEBHOOK_LIVE_PR_URL` | A maintainer-owned disposable PR URL | The repo must be installed for the GitHub App and allowlisted in production env. |
| `AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID` | GitHub App installation settings URL, usually the numeric id in `/installations/<id>` | Use the installation for the target test repository. |
| `AGENTPROOF_WEBHOOK_LIVE_GITHUB_TOKEN` | Optional read-only metadata token | Needed only when the target PR is private and unauthenticated metadata fetches fail. Do not request it over chat; use a trusted operator shell path. |

## Production Env Preflight

In Vercel production env, confirm:

```text
GITHUB_WEBHOOK_SECRET=<set>
GITHUB_APP_ID=<set>
GITHUB_PRIVATE_KEY=<set>
AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true
AGENTPROOF_GITHUB_APP_ALLOWED_REPOS=owner/repo
AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=false
AGENTPROOF_GITHUB_APP_SAVE_REPORTS=false
```

Then confirm the public status endpoint returns `mode: "event-mode"`:

```bash
curl -sS https://agentproof-pearl.vercel.app/api/github/webhook/status
```

The status response must not expose env booleans, allowlists, private-key validity, secret names, or secret values.

## Run Command

Run from the repository root:

```bash
AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION=1 \
AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> \
AGENTPROOF_WEBHOOK_LIVE_PR_URL=https://github.com/owner/repo/pull/123 \
AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID=<github-app-installation-id> \
pnpm smoke:github-webhook-live
```

Optional:

```bash
AGENTPROOF_WEBHOOK_LIVE_ACTION=synchronize
AGENTPROOF_WEBHOOK_LIVE_GITHUB_TOKEN=<read-only metadata token for private PRs>
AGENTPROOF_WEBHOOK_LIVE_ALLOW_SAVE_REPORTS=1
```

Only set `AGENTPROOF_WEBHOOK_LIVE_ALLOW_SAVE_REPORTS=1` when intentionally validating summary-only saved report metadata.

## Expected Output

The command should report:

- `ok: true`
- `willAnalyze: true`
- `willComment: false`
- `commentSuppressed: true`
- `saveReportSuppressed: true`, unless saved-report validation was explicitly allowed
- valid `priority` and numeric `evidenceCoverage`
- optional saved report metadata with `privacy: "summary-only"` only when saved reports were explicitly allowed

The target PR must not receive a new or updated AgentProof marker comment.

Safe result template:

```text
date:
target_pr:
action:
public_status_mode:
dryRun:
willAnalyze:
willComment:
analysis_status:
priority:
evidenceCoverage:
head_sha_prefix:
saved_report_privacy: none | summary-only
```

## Failure Handling

- `status mode event-mode` failure: production env is still in manual or signed-intake mode. Do not send a live webhook yet.
- `github_app_not_ready`: app id or private key env is missing or malformed.
- `Repository is not in AGENTPROOF_GITHUB_APP_ALLOWED_REPOS`: narrow allowlist does not include the test repo.
- `GitHub PR metadata fetch failed`: use a public test PR or provide an optional read-only metadata token.
- `duplicate-delivery guard`: wait for idempotency TTL, push a new commit to the disposable PR, or change to another allowed action.

If the smoke fails after reaching automation, restore production env to the safe state before debugging.

## Rollback

After the check:

```text
AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=false
AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=false
AGENTPROOF_GITHUB_APP_SAVE_REPORTS=false
```

Keep `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, and `GITHUB_PRIVATE_KEY` configured only if the signed intake/status surface should remain ready.

Record only the date, target disposable PR, action, public status mode, and bounded result fields in `docs/deployment-smoke.md`. Do not record raw webhook payloads, tokens, diffs, logs, installation objects, full reports, comment bodies, or saved report contents.
