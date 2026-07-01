# GitHub App Webhook Automation

AgentProof's GitHub App webhook endpoint is a signed intake boundary for evidence reports, not an automated reviewer or merge gate. Default behavior remains dry-run unless automation is explicitly enabled and the repository is authorized for analysis.

Endpoint:

```text
POST /api/github/webhook
```

Public coarse status endpoint:

```text
GET /api/github/webhook/status
```

The status endpoint is for UI and smoke probes only. It returns a coarse mode, label, capabilities, and cautions. It must not expose per-env booleans, repository allowlists, private-key validity, secret names, or secret values.

## Current Behavior

- Fails closed when `GITHUB_WEBHOOK_SECRET` is missing.
- Verifies `X-Hub-Signature-256` against the raw request body before trusting event data.
- Rejects oversized `Content-Length` before reading the body when the header is present.
- Accepts bounded metadata for `pull_request`, `check_run`, `check_suite`, `status`, and `ping`.
- Accepts signed `installation` and `installation_repositories` lifecycle events so deleted/suspended installations or removed repository access can disable matching tenant repository grants.
- Ignores unsupported signed events without taking action.
- Rejects malformed JSON for supported events.
- Keeps dry-run behavior unless `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true`.
- For enabled `pull_request` events, handles only `opened`, `reopened`, `synchronize`, and `ready_for_review`.
- In operator/demo mode, requires `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` before analyzing a PR.
- In tenant control mode, ignores the global allowlist and requires an active tenant repository grant matching `installation_id + repository_id`.
- Lifecycle events run before PR automation and do not require `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED`.
- Uses a GitHub App installation token to refetch PR evidence from GitHub; it does not trust PR title/body/diff fields from the webhook payload.
- Creates summary-only saved report links only when `AGENTPROOF_GITHUB_APP_SAVE_REPORTS=true`.
- Posts or updates one GitHub App marker comment only when `AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=true`.
- Uses durable Supabase idempotency when server-only Supabase env is configured; otherwise falls back to short-lived in-memory idempotency for duplicate PR head/action deliveries.
- Does not return raw payloads, patch text, logs, installation objects, tokens, titles, or arbitrary payload fields.
- Redacts secret-looking values from returned metadata fields.

The route reads the request body in memory to verify GitHub's HMAC signature. It does not persist that body, and oversized requests are rejected by `Content-Length` when available plus a post-read byte cap. Deployment platform body-size limits should remain enabled.

## Smoke Test

Use the webhook smoke when validating production without creating comments or triggering live PR analysis:

```bash
AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> \
pnpm smoke:github-webhook
```

The smoke checks:

- public coarse status from `/api/github/webhook/status`;
- invalid-signature rejection;
- signed `ping` acceptance;
- signed `pull_request` with action `closed`, which must report `willAnalyze: false` and `willComment: false`;
- no echo of secret-like probe values sent in the smoke payload.

## Controlled Live Automation Smoke

Use this only for a maintainer-owned test PR in a single explicitly authorized repository. This is not the dry-run webhook smoke above: it exercises GitHub App installation-token PR analysis. The smoke payload suppresses automatic comments by default and suppresses saved-report creation unless explicitly allowed. Follow `docs/github-app-live-smoke-runbook.md` before running it against production.

Preflight:

- Set `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true`.
- In operator/demo mode, set `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS=owner/repo` for one test repository; do not use `*` outside controlled testing.
- In tenant control mode, set an active grant for the test repository's GitHub App installation id and repository id. The global allowlist is ignored in this mode.
- Leave `AGENTPROOF_GITHUB_APP_COMMENT_ENABLED` unset or `false`. The live smoke also sends a signed smoke-only `suppressComment` control so comments stay off even if the deployment flag is accidentally enabled.
- Leave `AGENTPROOF_GITHUB_APP_SAVE_REPORTS` unset or `false` unless validating summary-only saved report links. The live smoke sends `suppressSavedReport` by default; set `AGENTPROOF_WEBHOOK_LIVE_ALLOW_SAVE_REPORTS=1` only when validating saved-link metadata.
- Confirm `/api/github/webhook/status` returns public mode `event-mode`. The smoke refuses to send a PR webhook when public status is `manual` or `signed-intake`.

Command:

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

Expected proof:

- `dryRun: false`
- `automationEnabled: true`
- `willAnalyze: true`
- `willComment: false`
- `analysis.status: "completed"`
- bounded metadata only: repository, PR number, head SHA prefix, priority, evidence coverage, and optional summary-only saved-report metadata

The target PR must not receive a new or updated AgentProof marker comment. The command fails if a response echoes the webhook secret, signature, token-like probes, raw diff text, `evidenceIndex`, `claims`, or `reprompt`.

Afterward:

- Restore automation env to its normal state.
- Record only date, target test PR, action, and bounded response fields in the deployment smoke checklist.
- Do not paste raw webhook payloads, tokens, diffs, logs, installation objects, full reports, comment bodies, or saved report contents.

## Required Environment

For signed intake:

```text
GITHUB_WEBHOOK_SECRET
```

For GitHub App PR analysis in operator/demo mode:

```text
GITHUB_APP_ID
GITHUB_PRIVATE_KEY
AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true
AGENTPROOF_GITHUB_APP_ALLOWED_REPOS=owner/repo
```

`GITHUB_PRIVATE_KEY` must be a valid PEM private key. Local env files may use escaped `\n` newlines.

For invite-only SaaS tenant control mode, add a server-only repository grant source:

```text
AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED=true
AGENTPROOF_CONTROL_PLANE_SUPABASE_URL=
AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE=agentproof_tenant_repository_grants
```

Durable tenant grants are created by the invite-only onboarding flow and authorize on `installation_id + repository_id`. When tenant control is enabled, `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` does not authorize analysis, including `*`.

Repo verification settings can be read or changed through the invite-only metadata endpoint:

```text
GET /api/tenants/repositories?tenantId=<tenant>
PATCH /api/tenants/repositories
GET /api/tenants/repositories/health?tenantId=<tenant>
```

The settings endpoint updates only `enabled`, `analysisEnabled`, `saveReportsEnabled`, `commentEnabled`, and `slackNotificationsEnabled`. It requires tenant-bound `AGENTPROOF_BETA_INVITES`; the legacy global invite token is not accepted for settings changes.

The health endpoint is customer-facing setup status for the same tenant grants. It is metadata-only by default and performs no GitHub calls unless `probe=github` is supplied. A live probe checks bounded repository metadata access only, with at most 10 repositories per request or one repository when `repositoryId=<id>` is supplied. Health responses are allowlisted to grant metadata, coarse statuses, bounded next actions, `privacy`, `probe`, and `truncated`.

These endpoints must not receive or return prompts, diffs, logs, findings, evidence indexes, claims, report bodies, raw GitHub error bodies, tokens, private keys, or comment bodies.

The invite-only `/tenant` dashboard is the design-partner UI for these endpoints. It keeps tenant invite tokens in the current browser form only long enough to bootstrap an HttpOnly tenant admin session, sends them in `x-agentproof-beta-invite-token`, and does not place them in query strings, JSON request bodies, PATCH bodies, localStorage, or sessionStorage. Tenant APIs accept the session cookie or the tenant-bound invite header fallback. The dashboard can also load a policy-aware tenant deletion preview that stays count-only, reports the draft retention policy version/status plus category coverage, and does not perform destructive deletion.

Lifecycle behavior:

- `installation` actions `deleted`, `suspend`, and `suspended` disable all stored grants for the signed `installation.id`.
- `installation_repositories` action `removed` disables only grants matching the signed `installation.id` and repository ids from `repositories_removed`.
- AgentProof does not automatically re-enable grants on install/unsuspend or repository-added events; a tenant admin must use onboarding or repo verification settings to re-enable analysis.
- Lifecycle responses are bounded metadata only: event, delivery, action, `willAnalyze:false`, `willComment:false`, installation id, and disabled grant count. They do not include tenant ids, repository-name lists, raw payloads, tokens, URLs, PR data, reports, or comments.
- If the tenant grant store is unavailable or partially configured, lifecycle handling fails closed with `github_app_tenant_grant_store_unavailable` and does not fetch GitHub tokens, analyze PRs, create saved reports, comment, or notify Slack.

For local/demo compatibility only, an env-seeded grant is still accepted:

```text
AGENTPROOF_TENANT_REPOSITORY_GRANTS=[{"tenantId":"tenant_demo","installationId":123,"repositoryId":456,"repositoryFullName":"owner/repo","enabled":true,"analysisEnabled":true,"saveReportsEnabled":false,"commentEnabled":false,"slackNotificationsEnabled":false}]
```

Do not use env-seeded grants as the primary production tenant boundary.

For invite-only GitHub App onboarding:

```text
AGENTPROOF_GITHUB_APP_SLUG=
AGENTPROOF_ONBOARDING_STATE_SECRET=
AGENTPROOF_BETA_INVITES=[{"tenantId":"tenant_demo","tokenHash":"sha256-hex-without-prefix"}]
AGENTPROOF_ONBOARDING_STATES_TABLE=agentproof_github_onboarding_states
```

See `docs/github-app-onboarding.md` for endpoint behavior, cookies, and Supabase schemas.

For invite-only tenant account/member metadata:

```text
AGENTPROOF_TENANT_ACCOUNTS=
AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL=
AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_TENANTS_TABLE=agentproof_tenants
AGENTPROOF_TENANT_MEMBERS_TABLE=agentproof_tenant_members
```

This is a summary-only account readiness layer for beta dashboards, not full user authentication or billing. It may expose tenant display name, status, plan label, member ids, roles, and member statuses to authorized tenant admins. It must not store or return raw invite tokens, session hashes, OAuth access or refresh tokens, GitHub installation tokens, service-role keys, private keys, webhook secrets, billing provider ids, payment data, contact details, reports, diffs, logs, claims, or raw re-prompt text.

For invite-only quota enforcement, add a server-only quota seed:

```text
AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED=true
AGENTPROOF_USAGE_QUOTA_LIMITS=[{"tenantId":"tenant_demo","monthlyAnalysisLimit":100,"enabled":true,"plan":"team","connectedRepositoryLimit":10,"savedSummaryLinksEnabled":true,"markerCommentsEnabled":true,"slackSummariesEnabled":true,"structuredLlmVerifierEnabled":false}]
```

Required durable usage records for SaaS/beta quota enforcement:

```text
AGENTPROOF_USAGE_SUPABASE_URL=
AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_USAGE_RECORDS_TABLE=agentproof_usage_records
AGENTPROOF_USAGE_RESERVATION_RPC=agentproof_reserve_usage_quota
```

When quota enforcement is enabled, tenant GitHub App analysis reserves quota before webhook idempotency, GitHub installation-token fetch, PR evidence fetch, saved reports, marker comments, or Slack summaries. Quota-blocked webhooks return bounded metadata only and do not include tenant ids, repositories, head SHAs, diffs, logs, or usage counts. If durable usage storage is missing or unavailable, AgentProof fails closed with `usage_quota_unavailable`. `AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY=true` is only for local/demo quota tests and should not be set for SaaS/beta operation.

The quota seed also carries server-only plan capability flags for connected repository limits, saved summary links, marker comments, Slack summaries, and structured verifier access. These flags are not a billing provider integration and must not contain provider customer ids, subscription ids, contact details, payment state, or payment method data. Tenant-facing readiness surfaces may show plan labels, quota status, connected repository count/limit, and bounded feature states such as `plan_feature_disabled`; they must not echo raw plan config.

When quota enforcement is enabled, `/api/llm/verify` also requires tenant plan context through `x-agentproof-tenant-id` or `tenantId=<tenant>` and `structuredLlmVerifierEnabled: true` before it calls OpenAI. Missing tenant context, malformed quota seed config, or a disabled verifier plan returns a bounded fallback response and does not call the model. The route still requires `AGENTPROOF_LLM_TOKEN`; the tenant id is a plan gate, not customer authentication.

Customer-visible usage status is read-only:

```text
GET /api/tenants/usage?tenantId=<tenant>
```

It requires the same tenant-bound invite header as repo settings. The response is `privacy: "usage-summary-only"` and includes only period, feature label, enforcement/configuration state, plan, limit, used, remaining, and a bounded state such as `available`, `exhausted`, `not-configured`, or `not-enforced`. It never reserves quota and must not return raw usage rows, idempotency keys or hashes, delivery ids, PR numbers, repository names, reports, diffs, logs, claims, tokens, service-role keys, table names, Supabase/RPC internals, or private repository payloads.

Optional automation settings:

```text
AGENTPROOF_GITHUB_APP_SAVE_REPORTS=true
AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=true
AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS=true
AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE=agentproof_github_webhook_deliveries
```

Keep comment automation disabled until the repository owner explicitly wants AgentProof comments on PRs. Keep Slack summaries disabled until both the server-side plan seed and repository-level `slackNotificationsEnabled` grant explicitly allow Slack and a server-side `SLACK_WEBHOOK_URL` is configured. In beta/SaaS operation, enable `AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS=true` before enabling saved links, marker comments, or Slack summaries. With that gate enabled, AgentProof writes a bounded `github_app_side_effects_ready` audit event before fetching a GitHub installation token for side-effecting automation. If durable audit storage is missing or unavailable, the webhook returns `github_app_durable_audit_required` and does not create saved reports, comments, or Slack notifications.

Durable idempotency uses the same server-only Supabase URL and service-role env accepted by saved reports. Optional GitHub-webhook-specific names can override them:

```text
AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL
AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY
```

Do not expose service-role keys with a `NEXT_PUBLIC_` prefix.

## Analysis Job Queue

By default, GitHub App PR automation still runs analysis inline after grant, quota, idempotency, and side-effect preflight gates pass. Set `AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED=true` to move the expensive GitHub token/evidence fetch and report generation off the webhook request path. In queue mode, a valid webhook returns `202` with `analysis.status: "queued"` after storing bounded job metadata.

Queue readiness is checked before quota reservation, durable webhook idempotency, GitHub installation-token fetch, saved reports, or marker comments. If the queue is enabled but not configured, AgentProof fails closed with `github_app_analysis_queue_unavailable`, `willAnalyze:false`, and `willComment:false`.

```text
AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED=true
AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL=
AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_ANALYSIS_JOBS_TABLE=agentproof_analysis_jobs
```

Local smoke tests may set `AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY=true`, but SaaS/beta operation should use durable storage.

```sql
create table if not exists agentproof_analysis_jobs (
  id text primary key,
  status text not null check (status in ('queued', 'processing', 'completed', 'failed_retryable', 'failed_terminal')),
  tenant_id text,
  idempotency_key_hash text not null,
  delivery_id text,
  event text not null,
  action text,
  installation_id bigint not null,
  repository_id bigint,
  repository_full_name text not null,
  pull_request_number integer not null,
  pull_request_url text not null,
  head_sha text not null,
  save_report boolean not null default false,
  comment boolean not null default false,
  slack_summary boolean not null default false,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_summary text,
  result_summary jsonb
);

create index if not exists agentproof_analysis_jobs_status_run_after_idx
  on agentproof_analysis_jobs (status, run_after);

create index if not exists agentproof_analysis_jobs_tenant_created_idx
  on agentproof_analysis_jobs (tenant_id, created_at desc);

create index if not exists agentproof_analysis_jobs_status_updated_idx
  on agentproof_analysis_jobs (status, updated_at);
```

Job rows are metadata-only. They may store tenant id, installation id, repository id/name, PR number, canonical PR URL, head SHA, action, delivery id, hashed idempotency key, status, attempt timestamps, bounded error code/summary, planned side-effect booleans, and completed `result_summary` fields such as priority, evidence coverage, saved-report/comment/Slack action metadata. They must not store raw webhook bodies, signatures, installation tokens, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, saved-report URLs with keys, comment bodies, Slack webhooks, Slack channel/workspace/provider identifiers, Slack response bodies, OpenAI keys, or service-role keys.

Tenant deletion readiness is not implied by the queue table alone. Queue insertion and worker side effects recheck static/memory/Supabase deletion state and tenant grants, tenant repository grants have a metadata-only tenant-wide disable primitive for deletion start, and the guarded internal execution boundary refuses saved-report purge unless new work is explicitly blocked and tenant deletion state is active. It also refuses analysis-job purge unless new work is explicitly blocked, tenant deletion state is active, and exact queued/processing/retryable counts are zero. A public destructive deletion flow still needs an operator workflow that calls the tenant-wide grant disable, executes the guarded saved-report purge, drains or cancels active workers, executes every remaining category purge, handles external GitHub installation access, and is covered by a deletion drill.

`GET /api/ops/tenants/deletion?tenantId=<id>` returns the metadata-only internal deletion execution plan behind `AGENTPROOF_OPS_TOKEN`. `POST /api/ops/tenants/deletion` accepts only `{ "tenantId": "...", "action": "block_new_work" }`; it can mark deletion state and disable tenant repository grants, but it deliberately does not expose analysis-job purge or any full destructive deletion action. Responses must not return tenant ids, repository names, installation ids, PR metadata, job ids, table names, store names, evidence, claims, diffs, logs, re-prompt text, or secrets.

The saved-report purge primitive is internal-only and runs through `src/lib/tenant-deletion-execution.ts`, not the public ops route. Its public projection is limited to deleted count and a coarse count basis. It must not expose report ids, report bodies, access-token hashes, storage mode, table names, Supabase URLs, service-role keys, evidence indexes, claims, raw re-prompt text, diffs, logs, patch excerpts, saved-link keys, or tenant ids.

The queue library now supports metadata-only worker state transitions: due jobs can be claimed into `processing`, stale `processing` jobs can be reclaimed after a bounded lease, successful jobs can be marked `completed`, and failures can become `failed_retryable` with a future `run_after` or `failed_terminal` after the retry budget is exhausted. Failure summaries are redacted and length-bounded before storage.

`POST /api/ops/analysis-jobs/preflight` is an operator-token-gated worker preflight endpoint. It claims at most one due job, re-authorizes the active tenant repository grant before any GitHub token fetch, clamps queued side-effect flags to the current grant settings, and records retryable or terminal job state when credentials or grants are unavailable. Its response is `analysis-worker-preflight-metadata-only` and omits tenant ids, repository names, raw webhook payloads, PR evidence, diffs, logs, reports, claims, raw re-prompt text, comment bodies, saved-report keys, table names, and secrets.

`POST /api/ops/analysis-jobs/run` is an operator-token-gated worker execution endpoint. It runs the same preflight first, then fetches a GitHub installation token, refetches PR evidence from GitHub, generates and runtime-validates a verification report, performs configured summary-only saved-report/comment/Slack side effects, and marks the job completed with `result_summary`. If GitHub evidence fetch, saved-report storage, comment posting, Slack delivery, or validation fails, the worker records retryable or terminal job state with a redacted bounded `error_summary`. The run response is `analysis-worker-run-metadata-only` and returns only job id, PR number, head SHA prefix, attempts, priority, evidence coverage, and side-effect action metadata. It does not return repository names, tenant ids, saved-report URLs or keys, comment URLs or bodies, Slack webhook URLs, Slack channel/workspace/provider identifiers, Slack response bodies, full reports, evidence indexes, claims, diffs, logs, raw re-prompt text, table names, or secrets.

`POST /api/ops/analysis-jobs/run-batch?limit=<n>` is the bounded batch variant for cron or operator-driven drains. It defaults to one job and hard-caps at five jobs per request. The batch stops early when the queue is idle or after the first retryable failure, so a systemic GitHub/API/storage outage does not drain every due job into failure state. The response is `analysis-worker-batch-metadata-only` and contains only aggregate counters plus per-item run metadata using the same public projection as the single-run endpoint. It does not return repository names, tenant ids, installation ids, PR URLs, saved-report URLs/keys, comment URLs/bodies, raw reports, evidence, claims, diffs, logs, raw re-prompt text, table names, or secrets.

`GET /api/cron/analysis-jobs/run` is the Vercel Cron-compatible scheduler route. It accepts `Authorization: Bearer <token>` or `x-agentproof-cron-token` where the token is `CRON_SECRET` or `AGENTPROOF_CRON_TOKEN`. If both are configured, either matching token is accepted so native Vercel Cron still works. If no cron token is configured it returns `501`; if the token is wrong it returns `401`; if the analysis queue is disabled it returns a `200` no-op metadata response; if the queue is enabled but storage is incomplete it returns `503`. Successful runs call the same bounded batch worker and return only aggregate counters with `privacy: "analysis-worker-cron-metadata-only"`. The route never returns repository names, tenant ids, installation ids, PR URLs, saved-report URLs/keys, comment URLs/bodies, per-job items, raw reports, evidence, claims, diffs, logs, raw re-prompt text, table names, or secrets. `vercel.json` schedules it once daily for the conservative first rollout; `AGENTPROOF_CRON_ANALYSIS_JOB_BATCH_LIMIT` can request a smaller/larger batch, but the worker still hard-caps at five jobs.

`GET /api/ops/github-app/status` includes coarse GitHub installation metadata storage mode plus optional `analysisQueueSummary`, `analysisQueueAlertBasis: "sampled_rows"`, and `analysisQueueAlerts` when queue storage is configured. The summary is aggregate-only: sampled row count, truncation flag, status counts, due count, delayed retry count, stale processing count, and oldest queued/retry age in seconds. Alerts are code/count/threshold pairs such as `analysis_queue_failed_terminal`, `analysis_queue_stale_processing`, `analysis_queue_due_jobs`, `analysis_queue_backlog`, and `analysis_queue_summary_truncated`; they are an operator signal, not customer-facing incident notifications. They do not expose job rows, tenant ids, repository names, installation ids, delivery ids, idempotency hashes, PR URLs, error summaries, Supabase table names, missing env names, or service-role keys.

`POST /api/ops/analysis-jobs/alerts/slack` is an operator-token-gated Slack delivery route for the same aggregate queue alert signals. It requires `AGENTPROOF_OPS_TOKEN` and a server-side `SLACK_WEBHOOK_URL`; it does not accept webhook URLs or report content from the request body. By default it sends warning-level alerts only; `includeInfo=true` can send info alerts after operator authentication. Responses use `privacy: "analysis-queue-alert-summary-only"` and include only send status, delivered alert counts, sampled row count, and truncation status. The Slack payload is summary-only: alert code, severity, metric, count, threshold, and aggregate queue counts. It must not include job rows, tenant ids, repository names, installation ids, delivery ids, idempotency hashes, PR URLs, PR numbers, head SHAs, job ids, event/action names, per-job timestamps, error codes/summaries, webhook payloads, signatures, tokens, private keys, Slack webhook URLs, Supabase URLs/keys/table names, PR titles/bodies, diffs, patches, logs, full reports, evidence indexes, claims, requirements, review priority, missing tests, raw re-prompt text, saved-report URLs/keys, comment URLs/bodies, or Slack response bodies.

`GET /api/ops/analysis-jobs/dead-letter` is an operator-token-gated read-only summary for `failed_terminal` jobs. It returns top-level `privacy: "analysis-job-dead-letter-summary-only"`, `basis: "failed_terminal_recent_sample"` inside the summary, sampled/truncated counts, sampled terminal count, top bounded error-code counts, and the oldest terminal failure age in seconds. Error-code values are sanitized slugs; malformed or provider-looking values such as customer, subscription, price, product, invoice, or payment identifiers are reported as `unknown`. It also returns an aggregate-only `opsStatus` object with `privacy: "analysis-job-dead-letter-ops-status-summary-only"`, `state: "clear" | "needs_attention" | "incident"`, alert code/count/threshold tuples, and bounded next-action codes. Incident thresholds are intentionally simple for beta operations: one or more sampled terminal jobs creates `analysis_dead_letter_terminal_failures` with next action `review_top_error_codes`; five or more sampled terminal jobs creates `analysis_dead_letter_terminal_spike` with next action `pause_batch_drains_and_check_provider_or_storage`; an oldest terminal failure age of 3600 seconds creates `analysis_dead_letter_stale_terminal` with next action `triage_or_record_follow_up`; a truncated recent sample creates `analysis_dead_letter_summary_truncated` with next action `increase_sample_or_check_durable_store`. The status is `incident` when any warning-level dead-letter alert is present, `needs_attention` for non-warning terminal failures, and `clear` when no alert is present. It deliberately does not return individual job rows, tenant ids, repository names, installation ids, delivery ids, idempotency hashes, PR URLs, PR numbers, head SHAs, job ids, event/action names, per-job timestamps, raw error summaries, webhook payloads, signatures, tokens, private keys, Supabase URLs/keys/table names, PR titles/bodies, diffs, patches, logs, full reports, evidence indexes, claims, raw re-prompt text, saved-report URLs/keys, or comment URLs/bodies. It is not a requeue or acknowledgement workflow.

Design-partner tenants can read recent async analysis job status through `GET /api/tenants/analysis-jobs?tenantId=<tenant>&limit=10&status=failed|active|completed` with a tenant-bound invite token or tenant admin session cookie. Omitting `status` returns all recent jobs; explicit invalid values return `400 invalid_status_filter` instead of falling back to all data. The response uses `privacy: "analysis-job-summary-only"` and returns only an allowlisted projection plus a recent-sample rollup with `privacy: "analysis-job-tenant-rollup-summary-only"`. The tenant UI labels statuses as public states such as queued, active, retrying, needs attention, and completed. The endpoint must not return raw idempotency keys or hashes, full delivery ids, webhook payloads, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, saved-report URLs/keys, comment URLs/bodies, tokens, service-role keys, table names, or Supabase internals.

This is still not a full background worker system. The Vercel Cron route is a small serverless scheduler for bounded batches, the dead-letter endpoint is read-only aggregate visibility, and the Slack queue alert route is an operator-only summary delivery path rather than a complete incident-management system. A separate worker process, customer-visible async status rollups beyond the `/tenant` design-partner view, dead-letter requeue/ack workflows, broader alert routing, concurrency controls, and exactly-once operational guarantees remain separate SaaS work.

Optional bounded audit event storage:

```text
AGENTPROOF_AUDIT_SUPABASE_URL=
AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_AUDIT_EVENTS_TABLE=agentproof_audit_events
```

Audit events are append-only operational metadata for tenant GitHub App automation and lifecycle handling. They pass a structural privacy scanner before storage. Lifecycle audit actions include `github_app_installation_disabled`, `github_app_repository_access_removed`, and `github_app_lifecycle_store_unavailable`. Side-effect preflight audit actions include `github_app_side_effects_ready`; they include only planned saved-report privacy, comment action status, and Slack summary action/privacy status, never saved-report URLs/keys, comment bodies, Slack webhook URLs, Slack channel/workspace/provider identifiers, or Slack response bodies. Audit rows must not include raw webhook payloads, signatures, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, comment bodies, saved-report URLs with `key`, tokens, private keys, service-role keys, Slack webhooks, or OpenAI keys.

Design-partner tenants can read a best-effort recent verification activity projection through `GET /api/tenants/audit-activity?tenantId=<tenant>&limit=10` with a tenant-bound invite token. The response uses `privacy: "audit-activity-summary-only"` and returns an `activity` array with flattened fields only: timestamp, actor, action, result, repository full name, PR number, head SHA prefix, delivery ID prefix, status code, priority, evidence coverage, saved-report privacy/durability, and comment action. It must not expose audit table names, Supabase env names, raw payloads, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, saved report keys or URLs, comment bodies, tokens, signatures, or service-role keys. It is not a complete compliance export.

## Usage Quota Schema

Durable usage records store only bounded usage metadata and hashed idempotency keys. They do not store webhook payloads, PR descriptions, diffs, logs, reports, comments, tokens, or private repository payloads.

```sql
create table if not exists agentproof_usage_records (
  id text primary key,
  tenant_id text not null,
  period text not null,
  feature text not null check (feature in ('github_app_analysis')),
  idempotency_key_hash text not null,
  created_at timestamptz not null
);

create index if not exists agentproof_usage_records_tenant_period_feature_idx
  on agentproof_usage_records (tenant_id, period, feature);

create unique index if not exists agentproof_usage_records_unique_delivery_idx
  on agentproof_usage_records (tenant_id, period, feature, idempotency_key_hash);
```

Recommended boundary:

```sql
alter table agentproof_usage_records enable row level security;
```

No public client policies are required because AgentProof reads and writes through server-side service-role credentials.

Quota reservation must be atomic. Create the RPC used by `AGENTPROOF_USAGE_RESERVATION_RPC` so concurrent webhooks cannot both pass a `count -> insert` race:

```sql
create or replace function agentproof_reserve_usage_quota(
  p_id text,
  p_tenant_id text,
  p_period text,
  p_feature text,
  p_idempotency_key_hash text,
  p_limit integer,
  p_created_at timestamptz,
  p_records_table text default 'agentproof_usage_records'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_used integer;
begin
  if p_limit < 0 or p_limit > 1000000 then
    raise exception 'invalid quota limit';
  end if;

  if p_records_table !~ '^[a-zA-Z_][a-zA-Z0-9_]{0,62}$' then
    raise exception 'invalid records table';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id || ':' || p_period || ':' || p_feature, 0));

  execute format('select exists (select 1 from %I where id = $1)', p_records_table)
    into v_exists
    using p_id;

  execute format(
    'select count(*)::integer from %I where tenant_id = $1 and period = $2 and feature = $3',
    p_records_table
  )
    into v_used
    using p_tenant_id, p_period, p_feature;

  if v_exists then
    return jsonb_build_object('allowed', true, 'duplicate', true, 'used', v_used);
  end if;

  if v_used >= p_limit then
    return jsonb_build_object('allowed', false, 'reason', 'quota-exceeded', 'used', v_used);
  end if;

  execute format(
    'insert into %I (id, tenant_id, period, feature, idempotency_key_hash, created_at) values ($1, $2, $3, $4, $5, $6)',
    p_records_table
  )
    using p_id, p_tenant_id, p_period, p_feature, p_idempotency_key_hash, p_created_at;

  return jsonb_build_object('allowed', true, 'duplicate', false, 'used', v_used + 1);
end;
$$;
```

## Audit Event Schema

Audit rows store only bounded metadata: actor, tenant, repository, installation, PR number, head SHA prefix, request id, action, result, status, and safe summary fields. Customer-facing activity responses shorten request ids to delivery id prefixes.

```sql
create table if not exists agentproof_audit_events (
  id text primary key,
  created_at timestamptz not null,
  actor text not null check (actor in ('github_app', 'system')),
  action text not null,
  result text not null check (result in ('blocked', 'completed', 'failed', 'skipped')),
  tenant_id text,
  repository_full_name text,
  installation_id bigint,
  pull_request_number integer,
  head_sha_prefix text,
  request_id text,
  status_code integer,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists agentproof_audit_events_tenant_created_idx
  on agentproof_audit_events (tenant_id, created_at desc);
```

Recommended boundary:

```sql
alter table agentproof_audit_events enable row level security;
```

No public client policies are required because AgentProof writes audit events through server-side service-role credentials. Audit export should include bounded metadata only; do not add raw report or source-code columns.

## Durable Idempotency Schema

Durable webhook idempotency stores only normalized metadata and a hashed primary key. It does not store raw webhook bodies, signatures, PR titles/bodies, diffs, logs, installation tokens, full reports, claims, or raw re-prompt text.

Rows start as `processing`, move to `completed` after a successful evidence report, and move to `failed_retryable` after retryable automation failures. A retryable takeover uses a conditional Supabase update on `id`, `status`, and `updated_at` so only one worker can re-open a failed row. `processing` rows older than 30 minutes can also be retried, which prevents a transient failure during status persistence from blocking a PR for the full row TTL.

```sql
create table if not exists agentproof_github_webhook_deliveries (
  id text primary key,
  tenant_id text,
  status text not null check (status in ('processing', 'completed', 'failed_retryable')),
  event text not null,
  delivery_id text not null,
  installation_id bigint not null,
  repository_full_name text not null,
  pull_request_number integer not null,
  head_sha text not null,
  action text not null,
  result_summary jsonb,
  error_code text,
  error_summary text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists agentproof_github_webhook_deliveries_expires_at_idx
  on agentproof_github_webhook_deliveries (expires_at);

create index if not exists agentproof_github_webhook_deliveries_tenant_expires_idx
  on agentproof_github_webhook_deliveries (tenant_id, expires_at);
```

New tenant-control webhook rows store `tenant_id` from the authorized tenant repository grant. Historical rows without `tenant_id` must not be inferred from repository names or PR metadata during tenant deletion; they are handled only by normal expiry or a separate manual migration review.

Recommended boundary:

```sql
alter table agentproof_github_webhook_deliveries enable row level security;
```

No public client policies are required because AgentProof reads and writes through server-side service-role credentials.

## Expected Responses

Not configured:

```json
{
  "error": "GitHub App webhook is not configured.",
  "code": "github_webhook_not_configured"
}
```

Verified dry-run:

```json
{
  "ok": true,
  "accepted": true,
  "dryRun": true,
  "event": "pull_request",
  "delivery": "delivery-id",
  "automationEnabled": false,
  "willAnalyze": false,
  "willComment": false,
  "summary": {
    "repository": "owner/repo",
    "pullRequestNumber": 123,
    "pullRequestUrl": "https://github.com/owner/repo/pull/123"
  }
}
```

Verified automated analysis:

```json
{
  "ok": true,
  "accepted": true,
  "dryRun": false,
  "event": "pull_request",
  "delivery": "delivery-id",
  "action": "synchronize",
  "automationEnabled": true,
  "willAnalyze": true,
  "willComment": false,
  "analysis": {
    "status": "completed",
    "repository": "owner/repo",
    "pullRequestNumber": 123,
    "headSha": "abc123",
    "priority": "medium",
    "evidenceCoverage": 61,
    "savedReport": {
      "privacy": "summary-only"
    }
  }
}
```

Tenant grant required:

```json
{
  "ok": true,
  "ignored": true,
  "dryRun": false,
  "event": "pull_request",
  "delivery": "delivery-id",
  "automationEnabled": true,
  "willAnalyze": false,
  "willComment": false,
  "code": "github_app_tenant_grant_required",
  "note": "No active tenant repository grant matches this GitHub App installation and repository."
}
```

Invalid tenant grant configuration:

```json
{
  "ok": false,
  "dryRun": false,
  "event": "pull_request",
  "delivery": "delivery-id",
  "automationEnabled": true,
  "willAnalyze": false,
  "willComment": false,
  "code": "github_app_tenant_grants_invalid",
  "note": "Tenant repository grants are misconfigured."
}
```

Ignored signed event:

```json
{
  "ok": true,
  "ignored": true,
  "dryRun": true,
  "event": "issues",
  "delivery": "delivery-id",
  "automationEnabled": false
}
```

Quota blocked:

```json
{
  "ok": true,
  "ignored": true,
  "dryRun": false,
  "event": "pull_request",
  "delivery": "delivery-id",
  "automationEnabled": true,
  "willAnalyze": false,
  "willComment": false,
  "code": "github_app_tenant_quota_blocked",
  "note": "Tenant monthly PR analysis quota has been reached."
}
```

## Safety Boundary

Keep these boundaries in place:

- Install the GitHub App with least-privilege permissions for pull requests, checks/statuses, metadata, and Actions job metadata. Add issue comment write only when comment opt-in is intended.
- Use tenant control mode for SaaS/beta operation so analysis requires an active `installation_id + repository_id` grant.
- Enable usage quota enforcement with the durable Supabase RPC before paid beta so overages stop before GitHub/OpenAI work or side effects.
- Enable `AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS=true` before enabling saved report links or marker comments in SaaS/beta operation.
- Use `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` only for operator/demo mode; avoid `*` outside controlled testing.
- Treat saved reports as summary-only. Do not store raw diffs, raw logs, webhook payloads, installation tokens, claims, or raw re-prompt text.
- Keep automatic comments off by default. When enabled, update one marker comment instead of creating comment storms.
- Use durable idempotency for production automation when Supabase is configured. The idempotency key is based on tenant when available, installation, repository, PR number, head SHA, and action, so different GitHub delivery ids for the same PR head/action do not trigger duplicate analysis.
- Retry durable `failed_retryable` rows with a conditional update, and allow stale `processing` rows to retry only after the processing lease expires.
- Tests proving raw payloads, raw diffs, logs, and tokens are not persisted.

When Supabase idempotency env is absent, AgentProof falls back to short-lived in-memory idempotency. That is acceptable for local demos and smoke testing, but production GitHub App automation should configure the durable table above.
