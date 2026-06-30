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
- Ignores unsupported signed events without taking action.
- Rejects malformed JSON for supported events.
- Keeps dry-run behavior unless `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true`.
- For enabled `pull_request` events, handles only `opened`, `reopened`, `synchronize`, and `ready_for_review`.
- In operator/demo mode, requires `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` before analyzing a PR.
- In tenant control mode, ignores the global allowlist and requires an active tenant repository grant matching `installation_id + repository`.
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
- In tenant control mode, set an active grant in `AGENTPROOF_TENANT_REPOSITORY_GRANTS` for the test repository's GitHub App installation id and repository full name. The global allowlist is ignored in this mode.
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
AGENTPROOF_TENANT_REPOSITORY_GRANTS=[{"tenantId":"tenant_demo","installationId":123,"repositoryFullName":"owner/repo","enabled":true,"analysisEnabled":true,"saveReportsEnabled":false,"commentEnabled":false}]
```

This JSON env is a temporary control-plane seed until self-serve GitHub App onboarding and database-backed tenant grants exist. When tenant control is enabled, `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` does not authorize analysis, including `*`.

For invite-only quota enforcement, add a server-only quota seed:

```text
AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED=true
AGENTPROOF_USAGE_QUOTA_LIMITS=[{"tenantId":"tenant_demo","monthlyAnalysisLimit":100,"enabled":true,"plan":"team"}]
```

Required durable usage records for SaaS/beta quota enforcement:

```text
AGENTPROOF_USAGE_SUPABASE_URL=
AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_USAGE_RECORDS_TABLE=agentproof_usage_records
AGENTPROOF_USAGE_RESERVATION_RPC=agentproof_reserve_usage_quota
```

When quota enforcement is enabled, tenant GitHub App analysis reserves quota before webhook idempotency, GitHub installation-token fetch, PR evidence fetch, saved reports, or marker comments. Quota-blocked webhooks return bounded metadata only and do not include tenant ids, repositories, head SHAs, diffs, logs, or usage counts. If durable usage storage is missing or unavailable, AgentProof fails closed with `usage_quota_unavailable`. `AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY=true` is only for local/demo quota tests and should not be set for SaaS/beta operation.

Optional automation settings:

```text
AGENTPROOF_GITHUB_APP_SAVE_REPORTS=true
AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=true
AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE=agentproof_github_webhook_deliveries
```

Keep comment automation disabled until the repository owner explicitly wants AgentProof comments on PRs.

Durable idempotency uses the same server-only Supabase URL and service-role env accepted by saved reports. Optional GitHub-webhook-specific names can override them:

```text
AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL
AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY
```

Do not expose service-role keys with a `NEXT_PUBLIC_` prefix.

Optional bounded audit event storage:

```text
AGENTPROOF_AUDIT_SUPABASE_URL=
AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_AUDIT_EVENTS_TABLE=agentproof_audit_events
```

Audit events are append-only operational metadata for tenant GitHub App automation. They pass a structural privacy scanner before storage. They must not include raw webhook payloads, signatures, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, comment bodies, saved-report URLs with `key`, tokens, private keys, service-role keys, Slack webhooks, or OpenAI keys.

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

Audit rows store only bounded metadata: actor, tenant, repository, installation, PR number, head SHA prefix, request id, action, result, status, and safe summary fields.

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
```

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
- Use tenant control mode for SaaS/beta operation so analysis requires an active `installation_id + repository` grant.
- Enable usage quota enforcement with the durable Supabase RPC before paid beta so overages stop before GitHub/OpenAI work or side effects.
- Use `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` only for operator/demo mode; avoid `*` outside controlled testing.
- Treat saved reports as summary-only. Do not store raw diffs, raw logs, webhook payloads, installation tokens, claims, or raw re-prompt text.
- Keep automatic comments off by default. When enabled, update one marker comment instead of creating comment storms.
- Use durable idempotency for production automation when Supabase is configured. The idempotency key is based on tenant when available, installation, repository, PR number, head SHA, and action, so different GitHub delivery ids for the same PR head/action do not trigger duplicate analysis.
- Retry durable `failed_retryable` rows with a conditional update, and allow stale `processing` rows to retry only after the processing lease expires.
- Tests proving raw payloads, raw diffs, logs, and tokens are not persisted.

When Supabase idempotency env is absent, AgentProof falls back to short-lived in-memory idempotency. That is acceptable for local demos and smoke testing, but production GitHub App automation should configure the durable table above.
