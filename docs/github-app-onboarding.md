# GitHub App Onboarding

AgentProof GitHub App onboarding is an invite-only activation path for evidence-based PR verification. It is not a generic code-review bot setup flow and it does not grant auto-merge authority.

The flow creates only tenant/repository metadata needed to authorize future webhook analyses:

1. Start onboarding with a tenant-bound invite.
2. Send the reviewer/admin to GitHub's App installation page with an opaque state token.
3. Verify the callback with the opaque state plus an HttpOnly nonce cookie.
4. List repositories available to that installation with a GitHub App installation token.
5. Create one active tenant repository grant for `installation_id + repository_id`.

Raw state tokens, nonce values, installation tokens, webhook payloads, PR bodies, diffs, logs, claims, evidence indexes, and raw re-prompt text are not durable onboarding data.

## Endpoints

```text
POST /api/github/onboarding/start
GET  /api/github/onboarding/callback
GET  /api/github/onboarding/repositories?installationId=<id>
POST /api/github/onboarding/repositories
POST /api/tenants/session
DELETE /api/tenants/session
POST /api/tenants/auth/session
DELETE /api/tenants/auth/session
GET  /api/tenants/repositories?tenantId=<tenant>
PATCH /api/tenants/repositories
GET  /api/tenants/repositories/health?tenantId=<tenant>
```

`POST /start` accepts:

```json
{
  "tenantId": "tenant_demo"
}
```

Authorize read requests with a valid durable tenant auth session, legacy tenant admin session cookie, or the tenant-bound invite token as `x-agentproof-beta-invite-token`. Privileged setup writes require durable owner/admin auth or the current tenant-bound invite header. Do not send invite tokens in the JSON body.

`POST /api/tenants/session` accepts the same tenantId-only JSON body and requires `x-agentproof-beta-invite-token`. It returns bounded JSON plus `Set-Cookie: agentproof_tenant_admin_session=...; HttpOnly; Secure; SameSite=Lax`. `DELETE /api/tenants/session` clears that cookie. Neither response returns the invite token, session secret, repository grants, PR evidence, diffs, logs, claims, report bodies, or comment content.

`POST /api/tenants/auth/session` is the first durable tenant auth/session v1 boundary. It accepts `tenantId` and `memberId` in JSON, requires the member bootstrap credential in `x-agentproof-tenant-auth-token`, verifies the tenant account is active or trialing, verifies the member is active, stores only a hashed session token in the server-side session store, and returns an HttpOnly `agentproof_tenant_auth_session` cookie. `DELETE /api/tenants/auth/session` revokes the hashed session when the store is available and clears the cookie. Tenant-facing responses may include bounded `tenantId`, `memberId`, `role`, and `expiresAt`; they must not return bootstrap tokens, session tokens, session hashes, emails/contact details, OAuth tokens, provider ids, billing ids, repository grants, PR evidence, diffs, logs, claims, report bodies, or comment content.

`GET /callback` is called by GitHub with `installation_id`, `setup_action`, and `state`. API clients receive bounded JSON. Browser callbacks that request HTML are redirected to `/tenant?tenantId=<tenant>&installationId=<id>&githubApp=connected` with the activation cookie set; the opaque state token is not copied into the redirect URL.

`GET /repositories` returns bounded metadata only:

```json
{
  "ok": true,
  "tenantId": "tenant_demo",
  "installationId": 123,
  "repositories": [
    {
      "id": 456,
      "fullName": "owner/repo",
      "private": true,
      "defaultBranch": "main"
    }
  ],
  "next": "choose_one_repository"
}
```

`POST /repositories` accepts a repository id selected from the server-fetched installation repository list:

```json
{
  "installationId": 123,
  "repositoryId": 456,
  "saveReportsEnabled": false,
  "commentEnabled": false
}
```

Client-supplied repository names are ignored. The stored grant uses the GitHub `repository.id` and the full name fetched from GitHub.

`GET /api/tenants/repositories` lists grant metadata for one tenant:

```json
{
  "ok": true,
  "tenantId": "tenant_demo",
  "repositories": [
    {
      "installationId": 123,
      "repositoryId": 456,
      "repositoryFullName": "owner/repo",
      "enabled": true,
      "analysisEnabled": true,
      "saveReportsEnabled": false,
      "commentEnabled": false
    }
  ],
  "privacy": "grant-metadata-only"
}
```

`PATCH /api/tenants/repositories` updates repo verification settings only:

```json
{
  "tenantId": "tenant_demo",
  "installationId": 123,
  "repositoryId": 456,
  "settings": {
    "analysisEnabled": true,
    "saveReportsEnabled": false,
    "commentEnabled": false
  }
}
```

The settings API requires `AGENTPROOF_BETA_INVITES` tenant-bound invite records. It does not accept the legacy global `AGENTPROOF_BETA_INVITE_TOKEN`, client-supplied repository names, prompt text, diffs, logs, findings, evidence indexes, claims, report bodies, tokens, or comment bodies.

`GET /api/tenants/repositories/health` returns customer-facing setup health for one tenant. The default response is metadata-only and makes zero GitHub calls:

```json
{
  "ok": true,
  "tenantId": "tenant_demo",
  "repositories": [
    {
      "installationId": 123,
      "repositoryId": 456,
      "repositoryFullName": "owner/repo",
      "enabled": true,
      "analysisEnabled": true,
      "saveReportsEnabled": false,
      "commentEnabled": false,
      "status": "github-not-checked",
      "githubAccess": "not-checked",
      "checks": {
        "grantActive": true,
        "analysisEnabled": true,
        "appCredentialsReady": true,
        "githubAccess": "not-checked"
      },
      "nextAction": "Run a GitHub access probe when you need live installation verification."
    }
  ],
  "truncated": false,
  "probe": "metadata-only",
  "privacy": "grant-metadata-only"
}
```

Add `probe=github` to verify live GitHub repository metadata access through the stored installation id and repository id. This probe never fetches PR evidence, diffs, logs, reports, comments, Slack data, or LLM verification. It checks at most 10 repositories per request, or one repository when `repositoryId=<id>` is supplied:

```text
GET /api/tenants/repositories/health?tenantId=tenant_demo&probe=github&repositoryId=456
```

Health statuses are bounded and safe to show to customers:

- `disabled`: the tenant grant is disabled.
- `analysis-disabled`: evidence report analysis is disabled for the repo.
- `app-credentials-not-ready`: GitHub App credentials or installation token creation is not ready.
- `github-accessible`: the GitHub App can access repository metadata.
- `github-inaccessible`: the repository or permission is unavailable to the installation.
- `github-rate-limited`: GitHub returned a rate-limit signal.
- `github-unavailable`: GitHub access could not be checked.
- `github-not-checked`: no live GitHub probe was run for this repository.

The health API is allowlisted to tenant-owned grant metadata, coarse statuses, bounded next actions, `privacy`, `probe`, and `truncated`. It must not return prompts, diffs, logs, findings, evidence indexes, claims, report bodies, tokens, private keys, GitHub error bodies, or comment bodies.

## Tenant Dashboard

`GET /tenant` is the invite-only design-partner setup surface. It lets a reviewer/admin:

- Start a 12-hour tenant admin session from `tenantId` plus a tenant-bound invite token.
- Start a durable tenant auth session from an active member bootstrap credential when `AGENTPROOF_TENANT_AUTH_BOOTSTRAPS` and a session store are configured.
- Start GitHub App installation using a valid durable tenant auth session or tenant-bound invite header fallback with `owner` or `admin` role metadata.
- Load installed repositories after the GitHub callback sets the short-lived activation cookie.
- Create one repository grant from server-fetched installation metadata when the activation session is paired with durable owner/admin tenant auth or the current owner/admin tenant-bound invite header.
- Read repository settings through tenant-bound auth, and update only `enabled`, `analysisEnabled`, `saveReportsEnabled`, `commentEnabled`, and `slackNotificationsEnabled` when the durable session or current invite header carries `owner` or `admin` role metadata.
- Load metadata-only repository health, then run an explicit bounded GitHub access probe per repository.
- Load read-only monthly usage summaries without reserving quota.
- Load recent async analysis job summaries with public status filters and recent-sample rollups, without raw idempotency keys, delivery ids, webhook payloads, reports, diffs, logs, claims, raw re-prompt text, saved-report keys, comment bodies, or storage internals.
- Preview tenant deletion impact through `GET /api/tenants/deletion-preview?tenantId=<tenant>` as a policy-aware, count-only dry run. It returns the draft retention policy version/status, counted/uncounted category coverage, and counts for saved reports, repository grants, GitHub installations, tenant-mapped webhook deliveries, analysis jobs, audit events, and usage records. It marks env-backed grants and GitHub installation metadata for manual review and does not return backend store names, table names, repository names, PR numbers, account logins, installation ids, report bodies, evidence, claims, diffs, logs, raw re-prompt text, saved-report keys, idempotency hashes, delivery ids, or tokens.
- Load recent summary report metadata without report bodies, evidence indexes, claims, raw re-prompt text, access keys, diffs, or logs.
- Load recent verification activity summaries from the audit store without raw payloads, reports, diffs, logs, claims, re-prompt text, comment bodies, saved-report URLs, or storage internals.

The dashboard keeps invite and bootstrap credentials in React state only long enough to bootstrap a cookie session. It sends invite tokens in `x-agentproof-beta-invite-token` and durable auth bootstrap credentials in `x-agentproof-tenant-auth-token`, never in query strings, JSON request bodies, PATCH bodies, localStorage, or sessionStorage, then clears the input after a successful session start. Tenant APIs prefer the durable HttpOnly auth session when present, then fall back to the short-lived tenant admin session or tenant-bound invite header for design-partner read compatibility. Repository settings mutations, GitHub App install start, and repository grant creation require bounded `owner` or `admin` role metadata from durable tenant auth or the current tenant-bound invite header; the legacy stateless tenant admin session is not a privileged authorization source. `member` or role-less invites can still read selected tenant-bound setup metadata but cannot change repository settings or bind repositories. Durable auth sessions are server-side revocable and recheck tenant/member status. The legacy tenant admin session remains stateless and short-lived for controlled design partners, not a full account system. The dashboard does not render PR evidence, diffs, logs, findings, claims, evidence indexes, report bodies, raw re-prompt text, comment bodies, or merge decisions.

## Required Environment

```text
AGENTPROOF_GITHUB_APP_SLUG=
AGENTPROOF_ONBOARDING_STATE_SECRET=
AGENTPROOF_TENANT_SESSION_SECRET=
AGENTPROOF_BETA_INVITES=
AGENTPROOF_TENANT_AUTH_BOOTSTRAPS=
AGENTPROOF_TENANT_AUTH_SESSIONS_TABLE=agentproof_tenant_auth_sessions
AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED=true
AGENTPROOF_CONTROL_PLANE_SUPABASE_URL=
AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY=
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
```

Recommended invite format:

```json
[
  {
    "tenantId": "tenant_demo",
    "tokenHash": "sha256-hex-without-prefix",
    "role": "owner"
  }
]
```

For local smoke only, `AGENTPROOF_BETA_INVITES` may use raw `token` values. `role` is optional for read-only tenant setup metadata and must be one of `owner`, `admin`, or `member`; repository settings mutations require `owner` or `admin`. Malformed role values fail closed. `AGENTPROOF_BETA_INVITE_TOKEN` remains a legacy helper for older local paths, but tenant dashboard access, session bootstrap, and onboarding start require tenant-bound invite records. Do not use the global token as the only production tenant boundary.

Recommended durable auth bootstrap format:

```json
[
  {
    "tenantId": "tenant_demo",
    "memberId": "member_owner",
    "tokenHash": "sha256-hex-without-prefix"
  }
]
```

Bootstrap tokens are for session creation only. The durable session store keeps hashed opaque session tokens with tenant id, member id, created/expiry timestamps, and optional revocation timestamp. Tenant APIs re-read account/member metadata for durable sessions so suspended/deleted tenants, disabled members, and role changes fail closed or take effect without trusting stale cookie role data. Legacy invite/session fallback is also blocked when configured account metadata marks the tenant suspended or deleted.

Optional table overrides:

```text
AGENTPROOF_ONBOARDING_STATES_TABLE=agentproof_github_onboarding_states
AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE=agentproof_tenant_repository_grants
AGENTPROOF_GITHUB_INSTALLATIONS_TABLE=agentproof_github_installations
AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL=
AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL=
AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY=
```

Local/demo-only memory stores:

```text
AGENTPROOF_ONBOARDING_ALLOW_MEMORY=true
AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY=true
AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY=true
AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY=true
```

Do not set memory-store flags for beta or SaaS operation.

## Onboarding State Schema

Durable onboarding state stores HMAC hashes of opaque tokens. It must not store raw state tokens or raw nonce cookie values.

```sql
create table if not exists agentproof_github_onboarding_states (
  id text primary key,
  kind text not null check (kind in ('install', 'activation')),
  token_hash text not null,
  tenant_id text not null,
  nonce_hash text,
  installation_id bigint,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  used_at timestamptz
);

create unique index if not exists agentproof_github_onboarding_states_token_idx
  on agentproof_github_onboarding_states (kind, token_hash);

create index if not exists agentproof_github_onboarding_states_expiry_idx
  on agentproof_github_onboarding_states (expires_at);

alter table agentproof_github_onboarding_states enable row level security;
```

## Tenant Auth Session Schema

Durable tenant auth sessions store hashed opaque session tokens. They must not store raw session tokens, bootstrap tokens, invite tokens, OAuth access or refresh tokens, emails, contact details, provider ids, billing ids, reports, diffs, logs, claims, or raw re-prompt text.

```sql
create table if not exists agentproof_tenant_auth_sessions (
  id text primary key,
  token_hash text not null unique,
  tenant_id text not null,
  member_id text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists agentproof_tenant_auth_sessions_tenant_member_idx
  on agentproof_tenant_auth_sessions (tenant_id, member_id);

create index if not exists agentproof_tenant_auth_sessions_expiry_idx
  on agentproof_tenant_auth_sessions (expires_at);

alter table agentproof_tenant_auth_sessions enable row level security;
```

Recommended checks:

```sql
alter table agentproof_github_onboarding_states
  add constraint agentproof_onboarding_install_nonce_check
  check (kind <> 'install' or nonce_hash is not null);

alter table agentproof_github_onboarding_states
  add constraint agentproof_onboarding_activation_installation_check
  check (kind <> 'activation' or installation_id is not null);
```

No public client policies are required. AgentProof reads and writes through server-side service-role credentials only.

Operational cleanup:

```sql
delete from agentproof_github_onboarding_states
where expires_at < now() - interval '1 day';
```

## GitHub Installation Metadata Schema

Durable installation metadata maps one GitHub App installation to one tenant after the verified callback state and nonce pass. It stores bounded account metadata only. It must not store installation access tokens, private keys, raw webhook payloads, repository contents, diffs, logs, reports, or comments.

```sql
create table if not exists agentproof_github_installations (
  tenant_id text not null,
  installation_id bigint not null,
  account_id bigint,
  account_login text,
  account_type text,
  status text not null check (status in ('active', 'suspended', 'deleted')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  suspended_at timestamptz,
  deleted_at timestamptz,
  primary key (tenant_id, installation_id)
);

create unique index if not exists agentproof_github_installations_installation_idx
  on agentproof_github_installations (installation_id);

create index if not exists agentproof_github_installations_tenant_idx
  on agentproof_github_installations (tenant_id);

alter table agentproof_github_installations enable row level security;
```

The unique `installation_id` index is required for SaaS operation. AgentProof also checks for cross-tenant conflicts before upsert, but the database constraint is the authoritative guard against concurrent callbacks assigning the same installation to more than one tenant.

Operator diagnostics expose this store only as `installationMetadata: "disabled" | "memory-only" | "config-incomplete" | "durable-supabase"` from `GET /api/ops/github-app/status`. The response must not include table names, env var names, Supabase URLs, service-role keys, tenant ids, account logins, installation ids, repository names, tokens, or raw GitHub data.

## Tenant Repository Grant Schema

Durable repository grants authorize future webhook analysis. They store repository metadata only, not PR evidence.

```sql
create table if not exists agentproof_tenant_repository_grants (
  tenant_id text not null,
  installation_id bigint not null,
  repository_id bigint not null,
  repository_full_name text not null,
  enabled boolean not null default true,
  analysis_enabled boolean not null default true,
  comment_enabled boolean not null default false,
  save_reports_enabled boolean not null default false,
  slack_notifications_enabled boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, installation_id, repository_id)
);

create index if not exists agentproof_tenant_repository_grants_installation_repo_idx
  on agentproof_tenant_repository_grants (installation_id, repository_id);

alter table agentproof_tenant_repository_grants enable row level security;
```

The durable grant path requires `repository_id`. Env-seeded grants may still use full names for local/demo compatibility, but SaaS authorization should rely on `installation_id + repository_id` so repository renames do not break or misroute access.

## Failure Behavior

- Missing onboarding config: `501 github_onboarding_not_configured`.
- Invalid or wrong-tenant invite: `401 github_onboarding_invite_required`.
- Missing state store: `503 github_onboarding_state_store_unavailable`.
- Missing or unavailable installation metadata store: `503 github_installation_metadata_store_unavailable`.
- Invalid callback state, nonce mismatch, expiry, or replay: `401 github_onboarding_state_invalid`.
- Invalid activation session or replay: `401 github_onboarding_activation_invalid`.
- Repository not installed for the GitHub App installation: `422 github_onboarding_repository_not_installed`.
- Tenant grant store unavailable: `503 github_onboarding_grant_store_unavailable`.
- Tenant repo settings control plane disabled: `409 tenant_repository_settings_control_required`.
- Tenant repo settings unauthorized: `401 tenant_repository_settings_unauthorized`.
- Tenant repo settings payload includes unsupported fields: `422 tenant_repository_settings_payload_invalid`.
- Tenant repo settings target is not granted: `404 tenant_repository_grant_not_found`.
- Tenant repo settings store unavailable: `503 tenant_repository_grant_store_unavailable`.
- Tenant repo health control plane disabled: `409 tenant_repository_health_control_required`.
- Tenant repo health unauthorized: `401 tenant_repository_health_unauthorized`.
- Tenant repo health malformed repository id: `422 tenant_repository_health_repository_id_invalid`.
- Tenant repo health store unavailable: `503 tenant_repository_grant_store_unavailable`.
- Lifecycle installation metadata store unavailable: `503 github_app_installation_metadata_store_unavailable`.

Webhook analysis then fails closed if no active tenant repository grant matches the signed event's installation and repository id.

## GitHub App Lifecycle

Signed lifecycle webhooks keep repository grants aligned with GitHub App access:

- `installation` actions `deleted`, `suspend`, and `suspended` disable all stored grants for the signed installation id.
- When a disabled installation maps to exactly one tenant, AgentProof also marks first-class GitHub installation metadata as `deleted` or `suspended`.
- `installation_repositories` action `removed` disables only grants whose repository id appears in `repositories_removed`.
- Install, unsuspend, or repository-added events do not automatically re-enable grants. A tenant admin must explicitly re-enable repo verification settings.
- Lifecycle handling runs before PR automation and never fetches installation tokens, PR evidence, saved reports, comments, Slack notifications, or LLM verification.
- Lifecycle responses and audit events are metadata-only and do not include tenant ids, repository-name lists, raw payloads, tokens, URLs, PR data, report links, or comments.

## Launch Blockers

Before public self-serve launch, replace invite-bootstrap `/tenant` access with a full account system, authenticated tenant membership checks, durable session revocation, and role-based admin permissions. The current tenant admin session is suitable for controlled design-partner read compatibility, but it is not a full account system and is not accepted for privileged setup writes.

Also add destructive tenant deletion/tombstoning workflow, quota/customer audit views, and broader setup health for GitHub permissions, suspended installs, large PR caps, and unavailable checks before broad rollout.
