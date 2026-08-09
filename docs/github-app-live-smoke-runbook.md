# GitHub App Live Smoke Runbook

This runbook is for one controlled production check of GitHub App PR analysis. It proves that AgentProof can receive a signed pull request webhook, refetch PR evidence with an installation token, generate an evidence report, and avoid unintended comments or saved reports by default.

Use it only on a maintainer-owned disposable PR in one explicitly authorized repository.

## What This Proves

- Signed webhook intake reaches enabled `pull_request` automation.
- Repository authorization and GitHub App credentials are sufficient for PR evidence collection.
- The response contains bounded metadata only: repository, PR number, head SHA, priority, and evidence coverage.
- Automatic GitHub comments stay suppressed.
- Saved reports stay suppressed unless the smoke explicitly opts in.
- Secret-like probes, raw diff text, `evidenceIndex`, claims, and raw re-prompt text are not echoed.
- When the background queue is enabled, the webhook returns a bounded queued result and the cron worker advances the same job through provider polling to a terminal result without exposing provider continuation metadata.

## What This Does Not Prove

- It does not validate auto-merge behavior. AgentProof must not auto-merge.
- It does not validate broad repository access. Use one test repository.
- It does not validate Slack or explicit user-token PR comments.
- The inline smoke command alone does not validate OpenAI. Background OpenAI validation additionally requires the queue observation steps below.
- It does not fully prove durable idempotency across serverless instance restarts unless the Supabase webhook-delivery table is configured and inspected separately.

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
| `AGENTPROOF_WEBHOOK_LIVE_PR_URL` | A maintainer-owned disposable PR URL | The repo must be installed for the GitHub App and authorized by operator/demo allowlist or tenant grant. |
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
AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE=agentproof_github_webhook_deliveries
```

For background semantic analysis, first apply the queue migration and then confirm these server-only settings before enabling intake:

```text
AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED=true
AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL=<set, or use the existing Supabase server URL>
AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY=<set, or use the existing service-role key>
AGENTPROOF_ANALYSIS_JOBS_TABLE=agentproof_analysis_jobs
AGENTPROOF_LLM_SEMANTIC_ENABLED=true
OPENAI_API_KEY=<set>
CRON_SECRET=<set by Vercel, or configure AGENTPROOF_CRON_TOKEN>
```

Verify the Vercel plan accepts a one-minute schedule before enabling the queue. The checked-in Hobby-safe schedule is daily and is not sufficient for background provider polling. On a supported plan, change the analysis-job cron schedule to `* * * * *`, deploy code with the queue disabled, apply `202608090002_analysis_jobs_openai_background.sql`, verify the new columns and service-role-only table access, then enable the queue.

For tenant control mode, replace the global repo authorization with an active server-only grant:

```text
AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED=true
AGENTPROOF_TENANT_REPOSITORY_GRANTS=[{"tenantId":"tenant_demo","installationId":123,"repositoryId":456,"repositoryFullName":"owner/repo","enabled":true,"analysisEnabled":true,"saveReportsEnabled":false,"commentEnabled":false}]
```

When tenant control mode is enabled, `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` is ignored for authorization, including `*`.

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

With the background queue enabled, the initial webhook result is expected to return HTTP `202` with `analysis.status: "queued"`, not inline `completed`. Observe only metadata-safe operator projections until the job reaches `completed` or a bounded terminal failure. At least one cron run should report the job as waiting for the provider before a later run completes it. Confirm the terminal row has cleared `provider_response_id`, `provider_status`, provider timestamps, provider poll count, and `claim_generation`; tenant, audit, dead-letter, and public worker responses must never contain those fields.

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
- `github_app_tenant_grant_required`: tenant control mode is enabled but no active grant matches the test installation id and repository.
- `github_app_tenant_grants_invalid`: the tenant grant JSON env is malformed; fix it before retrying.
- `GitHub PR metadata fetch failed`: use a public test PR or provide an optional read-only metadata token.
- `duplicate-delivery guard`: wait for idempotency TTL, push a new commit to the disposable PR, or change to another allowed action.
- `openai_submission_uncertain`: do not automatically resubmit. Keep new intake paused and reconcile the provider request manually so one PR head cannot be charged or analyzed twice.
- provider `queued` or `in_progress`: keep cron enabled and allow the same opaque response id to be polled; do not create a replacement job.
- provider terminal failure or strict semantic validation rejection: confirm the job becomes terminal with a bounded error code and all provider continuation fields are scrubbed.

If the smoke fails after reaching automation, restore production env to the safe state before debugging.

## Rollback

After a successful check, or when rolling back before any job is queued:

```text
AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=false
AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=false
AGENTPROOF_GITHUB_APP_SAVE_REPORTS=false
```

If queued, processing, retryable, or provider-pending jobs already exist, rollback in this order:

1. Disable new GitHub automation intake while leaving the queue and cron enabled.
2. Let existing jobs complete, or use the protected operator batch route to drain or terminalize them.
3. Confirm active queue counts are zero and provider continuation fields are absent from terminal rows.
4. Only then set `AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED=false`.

If cron is unavailable, keep intake disabled and use the authenticated operator batch route as the manual-drain fallback. Do not disable the queue first, because that would strand provider-pending rows before their terminal privacy scrub.

Keep `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_ID`, and `GITHUB_PRIVATE_KEY` configured only if the signed intake/status surface should remain ready.

Record only the date, target disposable PR, action, public status mode, and bounded result fields in `docs/deployment-smoke.md`. Do not record raw webhook payloads, tokens, diffs, logs, installation objects, full reports, comment bodies, or saved report contents.
