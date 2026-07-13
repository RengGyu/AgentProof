# Saved Report Storage

AgentProof saved reports are summary-only. They are meant for short-lived reviewer handoff, not long-term raw evidence retention. See `docs/tenant-data-retention.md` for the draft SaaS retention and deletion matrix.

Tenant deletion preview counts saved reports and other tenant-mapped categories as totals only, including GitHub installations and tenant-mapped webhook deliveries, and returns the retention policy version/status, counted/uncounted category coverage, and a bounded deletion plan with retention windows and readiness states. It must not fetch or return report bodies, access keys, claims, evidence indexes, diffs, logs, raw re-prompt text, account logins, installation ids, delivery ids, idempotency hashes, or backend storage internals, and it must not clean up expired memory reports while counting.

Expired saved-report cleanup is wired through `GET /api/cron/reports/cleanup` and the Vercel cron entry in `vercel.json`. The route accepts only `CRON_SECRET` bearer auth or `x-agentproof-cron-token` from `AGENTPROOF_CRON_TOKEN`; query-string tokens are rejected. The cleanup result is metadata-only: deleted count plus a coarse count basis. It must not expose report ids, tenant ids, report bodies, access hashes, table names, Supabase URLs, service-role keys, evidence, claims, raw re-prompt text, diffs, or logs.

Tenant-scoped saved reports add an access boundary around the same summary-only projection. A tenant-owned saved report is not readable or deletable by id alone; it requires either trusted tenant context from the server or the short-lived report `key` embedded in the generated saved-report URL. The raw key is returned only at creation time and is stored as a SHA-256 hash.

Tenant deletion uses a guarded execution wrapper for saved reports. It can delete tenant-owned summary rows only after the operator route receives explicit retention-policy review acknowledgement, new work has been explicitly blocked, and tenant deletion state is active. The purge result returns metadata only: deleted count plus a coarse count basis. It must not read or return report bodies, report ids, tenant ids, access-token hashes, storage mode, table names, Supabase URLs, service-role keys, evidence indexes, claims, raw re-prompt text, diffs, logs, patch excerpts, or saved-link keys. `POST /api/ops/tenants/deletion` exposes this purge only behind `AGENTPROOF_OPS_TOKEN`; it re-runs the new-work block guard before purge and remains separate from any customer-facing destructive deletion UI.

Design-partner tenant dashboards can list recent saved reports through `GET /api/tenants/reports?tenantId=<tenant>&limit=10` with a tenant-bound invite token. The list response is `privacy: "saved-report-summary-only"` and includes only bounded summary metadata: report id, created/expiry timestamps, source title, source URL without query/hash, priority, evidence coverage, requirement status counts, coarse testing statuses, missing-test count, review-priority count, and scope flag. It must not return the report body, access key, access-token hash, evidence index, claims, raw re-prompt text, diffs, logs, patch excerpts, comment bodies, tokens, or storage internals.

## Modes

- Default: `short-lived-in-memory`
  - No environment variables required.
  - Good for local demos and portfolio walkthroughs.
  - Reports may disappear after serverless instance changes.
- Optional: `summary-only-supabase`
  - Uses Supabase REST from server code only.
  - Stores the same summary-only projection used by share links.
  - Fails closed with a `503` response if Supabase is configured but unavailable.

The same server-only Supabase URL and service-role key can also back GitHub App webhook idempotency. That table stores hashed duplicate-suppression keys plus bounded metadata only; see `docs/github-app-webhook.md`.

## Environment

Preferred AgentProof-specific names:

```bash
AGENTPROOF_REPORTS_SUPABASE_URL=
AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY=
AGENTPROOF_REPORTS_TABLE=agentproof_saved_reports
AGENTPROOF_REPORT_SIGNING_SECRET=
AGENTPROOF_REPORT_SIGNING_KEY_ID=agentproof-report-hmac-v1
```

Generic Supabase names are also accepted:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Do not use `NEXT_PUBLIC_` for service-role keys. These values must stay server-only.

## Supabase Schema

```sql
create table if not exists agentproof_saved_reports (
  id text primary key,
  report jsonb not null,
  tenant_id text,
  access_token_hash text,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists agentproof_saved_reports_expires_at_idx
  on agentproof_saved_reports (expires_at);

create index if not exists agentproof_saved_reports_tenant_id_idx
  on agentproof_saved_reports (tenant_id);

create index if not exists agentproof_saved_reports_access_token_hash_idx
  on agentproof_saved_reports (access_token_hash);
```

Recommended boundary:

```sql
alter table agentproof_saved_reports enable row level security;
```

No public client policies are required because AgentProof reads and writes through server-side service-role credentials.

For the current invite-only SaaS skeleton:

- no-auth demo saved reports keep `tenant_id` and `access_token_hash` empty and remain readable by id;
- GitHub App automation saved reports created from tenant grants include `tenant_id` and a hashed report access key;
- wrong-tenant or missing-key lookups return the same unavailable response as missing or expired reports;
- API responses do not expose `tenant_id` or `access_token_hash`.

## Privacy Boundary

Saved reports keep:

- PR title and normalized PR URL
- summary line, priority, confidence, and evidence coverage
- requirement text and reviewer notes
- missing-test paths and review-priority paths
- limitations, including the summary-only warning
- optional hashed report access key for tenant-scoped saved links

Saved reports omit:

- `evidenceIndex`
- agent claims
- raw re-prompt text
- raw report access keys
- raw patch excerpts
- raw logs and annotation details
- failed annotation `path:line` locations copied from full execution evidence
- token-like secrets after redaction

Full Markdown export and intentional GitHub PR comments remain explicit user actions.
