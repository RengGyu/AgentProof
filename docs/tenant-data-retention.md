# Tenant Data Retention And Deletion Policy

Status: draft  
Version: 2026-06-30-concrete-windows-draft

AgentProof is an evidence-based verification report tool, not a long-term source-code archive. Tenant data retention follows one rule first: raw PR evidence is processed only as needed to produce a verification report, then retained only as bounded summaries or explicit user-triggered outputs.

The count-only deletion preview uses this policy version. It is a dry run and does not delete, mutate, or fetch raw evidence.

## Policy Matrix

| Category | Stored fields | Prohibited fields | Window | Readiness | Deletion behavior | Backup behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Transient PR evidence | In-request normalized GitHub evidence used to generate a verification report | Long-term raw diffs, logs, PR bodies, evidence indexes, claims, raw re-prompts, tokens | 0 days after request completion | Not applicable | No durable tenant deletion step because the data is not persisted by design | Not included in backups |
| Saved summary reports | Summary-only report projection, timestamps, tenant id, hashed report access key when tenant-scoped | Evidence index, claims, raw re-prompt, raw report key, raw patch excerpts, raw logs, annotations, secrets | 1 day from saved-report TTL | Ready | An operator-token-gated guarded execution wrapper can delete tenant-owned summary rows and hashed access keys only after explicit retention-policy review, new-work block verification, and active tenant deletion state | Restore summary-only rows only |
| Repository grants | Tenant id, installation id, repository id/full name, enabled settings, timestamps | Installation tokens, repository source, diffs, logs, reports, webhook payloads, private keys | 0 days after tenant deletion, repository removal, or installation disconnect | Manual review | Tenant-wide metadata-only grant disable exists for deletion start; durable row deletion and env-backed demo grant removal still require the deletion orchestrator/manual review | May exist in metadata backups until backup expiry |
| GitHub installations | Installation/account metadata needed to map a GitHub App installation to a tenant | Installation access tokens, private keys, webhook payloads, repository contents, diffs, logs | 0 days after tenant deletion and external revocation/disconnect review | Manual review | Revoke or disconnect installation where possible, then remove local metadata | Metadata can exist in backups until backup expiry |
| Onboarding states | Tenant id, hashed state, nonce metadata, expiration, bounded activation state | Invite tokens, raw OAuth secrets, private keys, repository source, diffs, logs, reports | 1 day after expiry cleanup grace | Ready | Delete expired or tenant-owned onboarding rows | Not needed for restore after expiry |
| Webhook deliveries | Hashed idempotency keys and bounded delivery metadata | Raw webhook bodies, signatures, installation tokens, PR bodies, diffs, logs, reports, secrets | 7 days from durable duplicate-suppression TTL | Ready | Delete tenant-mapped delivery metadata after retention or tenant deletion | Bounded operational metadata only |
| Analysis jobs | Tenant/job metadata, status, bounded error code/summary, planned side effects, result summary | Raw webhook bodies, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, re-prompts, URLs with keys, tokens | 30 days after terminal/completed update | Ready | An operator-token-gated guarded execution boundary plans deletion, can mark static/memory/Supabase deletion state, disables tenant grants first, rechecks deletion state and tenant grants before direct enqueue, rechecks deletion state in worker preflight before GitHub token fetch and again before side-effect calls, exact-counts queued/processing/retryable jobs before purge, and only purges terminal/completed tenant jobs through the protected path after explicit retention-policy review, new-work block verification, active deletion state, and zero active jobs. Public customer destructive deletion still needs every remaining category purge and broader deletion drills | Bounded metadata only when needed for recovery |
| Audit events | Bounded actor, tenant, repository, action, result, status, request prefix, safe summary fields | Raw payloads, reports, diffs, logs, evidence indexes, claims, re-prompts, comment bodies, saved-link keys, secrets | 365 days from event creation unless legal review requires tombstone | Manual review | Retain or tombstone according to legal/compliance policy | May be retained in backups until backup expiry |
| Usage records | Tenant id, period, feature, hashed idempotency key | Raw idempotency keys, delivery ids, PR data, repository payloads, reports, diffs, logs, tokens | 400 days after usage period end | Manual review | Delete tenant-owned non-billing usage rows; billing-linked records need manual review | May be retained in backups until backup expiry |
| Account, member, and auth session records | Tenant id, display name, status, plan label, member ids, roles, member statuses, hashed tenant auth session tokens, session timestamps, revocation timestamps | Raw invite tokens, raw bootstrap tokens, raw session tokens, OAuth tokens, contact details, billing provider ids, payment data, reports, diffs, logs, claims, re-prompts, secrets | 0 days after tenant deletion and access revocation review | Manual review | Revoke durable sessions first, then delete or tombstone account/member metadata after invites and sessions are revoked | May exist in metadata backups until backup expiry |
| Billing and account records | Tenant/account ids, plan, subscription status, internal-only provider customer id, internal-only invoice references, deletion state | Payment card data, raw provider webhook bodies, source code, reports, diffs, logs, tokens, customer-facing provider ids | 2555 days from invoice/subscription/tax event | Manual review | Internal deletion execution now includes a metadata-only billing retention review step, but billing/account deletion execution still requires legal retention and provider review before anonymizing or retaining minimum required records | May remain in backups until backup expiry |
| Backups | Snapshot copies of allowed metadata and summary-only records | Raw evidence categories that production storage is prohibited from keeping | 30 days from backup creation | Blocked | Do not surgically edit immutable backups; expire according to backup retention | This is the backup category |
| Deleted-tenant tombstones | Tenant id hash or minimal deletion marker, deletion timestamp, reason/status | Repository names, PR numbers, reports, diffs, logs, evidence, claims, re-prompts, billing details, tokens | 365 days after tenant deletion completes | Blocked | Create during destructive deletion after policy approval | May remain in backups until backup expiry |

## Current Implementation Boundary

Implemented count-only preview categories:

- saved summary reports
- repository grants
- GitHub installations
- webhook deliveries
- analysis jobs
- audit events
- usage records

Explicitly not counted yet:

- transient PR evidence, because it is not durably stored by design
- onboarding states
- account and member records
- billing and account records
- backups
- deleted-tenant tombstones

The preview and internal execution-plan responses must stay metadata-only. Tenant-facing deletion preview may echo the requested tenant id so the customer can verify scope; operator execution-plan and purge responses must not echo tenant ids. These responses may return policy version, policy status, counted category keys, uncounted category keys, category counts, concrete retention windows, deletion readiness, coarse unavailable/manual-review states, grant matched/disabled counts, saved-report deleted counts from a guarded purge result, aggregate active-job counts by public status, and a billing retention manual-review action. They must not return backend store names, table names, repository names, PR numbers, report bodies, evidence, claims, diffs, logs, raw re-prompt text, saved-report keys, job ids, delivery ids, idempotency hashes, webhook payloads, provider customer ids, provider subscription ids, invoice ids, payment data, tokens, or service-role secrets.

## Before Destructive Deletion

Do not add a destructive tenant deletion endpoint until these are true:

- Retention windows are implemented by cleanup jobs or documented provider retention controls, not only listed in policy. Saved summary reports already have the `GET /api/cron/reports/cleanup` cron path for expired rows.
- GitHub installation metadata has database-level uniqueness on `installation_id`, and historical webhook delivery rows without `tenant_id` have an expiry or manual-review plan.
- Analysis jobs have a deletion orchestrator that creates or verifies a durable tenant deletion state, blocks new enqueue and grant re-enable, calls tenant-wide grant disable, purges saved summary reports through the guarded execution wrapper, drains or cancels processing workers, executes the guarded tenant-scoped job purge, and proves no saved report, comment, or Slack side effect can be produced after deletion starts. The first operator workflow exists for block, saved-report purge, and analysis-job purge; full deletion drills and remaining category purges are still required before public destructive controls.
- Account/member and billing retention are reviewed separately from product metadata retention.
- Backup expiry behavior is documented and tested.
- A deletion drill proves that saved reports, repository grants, GitHub installations, tenant-mapped webhook deliveries, analysis jobs, audit events, and usage records follow this policy.
- A restore drill proves that summary-only data can be recovered without raw evidence.
