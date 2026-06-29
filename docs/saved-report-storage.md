# Saved Report Storage

AgentProof saved reports are summary-only. They are meant for short-lived reviewer handoff, not long-term raw evidence retention.

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
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists agentproof_saved_reports_expires_at_idx
  on agentproof_saved_reports (expires_at);
```

Recommended boundary:

```sql
alter table agentproof_saved_reports enable row level security;
```

No public client policies are required because AgentProof reads and writes through server-side service-role credentials.

## Privacy Boundary

Saved reports keep:

- PR title and normalized PR URL
- summary line, priority, confidence, and evidence coverage
- requirement text and reviewer notes
- missing-test paths and review-priority paths
- limitations, including the summary-only warning

Saved reports omit:

- `evidenceIndex`
- agent claims
- raw re-prompt text
- raw patch excerpts
- raw logs and annotation details
- failed annotation `path:line` locations copied from full execution evidence
- token-like secrets after redaction

Full Markdown export and intentional GitHub PR comments remain explicit user actions.
