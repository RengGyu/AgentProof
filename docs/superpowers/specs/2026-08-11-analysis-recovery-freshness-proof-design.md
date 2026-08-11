# AgentProof Analysis Recovery, Freshness, and Proof Design

## Goal

Make one PR-head analysis converge to one publishable current result, recover abandoned provider work within minutes, prevent stale saved reports from being presented or copied as current, and validate negative or mixed requirements from deterministic proof axes.

## Global constraints

- Keep deterministic evidence authoritative; semantic output may explain but never promote a requirement.
- Never persist raw webhook bodies, source patches, provider output, tokens, or secrets in queue/freshness metadata.
- Preserve the existing verification-report JSON contract compatibly. New proof metadata is additive.
- Do not special-case fixture repositories, PR numbers, paths, or exact scenario wording.
- GitHub and OpenAI webhooks remain fast ingestion/completion signals. Supabase Cron is only a bounded recovery/drain trigger.
- Public and tenant dashboard responses must not expose job IDs, provider IDs/status, scheduler secrets, or a newer full SHA.

## 1. Canonical PR-head analysis state

The canonical identity is the SHA-256 hash of tenant/operator, installation, repository, PR number, and full head SHA. GitHub delivery deduplication remains delivery-specific, while quota reservation and analysis enqueue use the canonical PR-head identity.

The queue stores one canonical row per identity. A database RPC atomically inserts or refreshes that row:

- a queued/retryable row is refreshed and debounced;
- a processing row increments a desired revision;
- a completed/terminal row is re-queued only when a later eligible event requests a refresh;
- a new head creates a new row.

Claims capture the desired revision as the running revision. Before report save, comment, or Slack, the worker fences finalization. If a newer revision exists, the stale computation performs no side effects and re-queues the canonical row.

GitHub webhook handling only enqueues. It no longer immediately claims every incoming event, which previously defeated the queue and created a concurrency burst. A short `run_after` debounce lets nearby PR and Check events coalesce before the worker fetches the latest GitHub snapshot.

## 2. Recovery and provider expiry

OpenAI completion webhooks continue to claim the matching provider continuation immediately. A one-minute Supabase Cron job calls the existing authenticated, metadata-only analysis-worker endpoint using a token stored in Supabase Vault. This is a recovery/drain trigger, not a second analysis engine.

The worker treats provider expiry or an abandoned submission marker as bounded semantic unavailability and completes the deterministic report where safe. It clears all provider continuation fields and never re-submits an uncertain request. Stale processing claims are recovered through the existing lease/CAS path.

The recovery call is bounded, privacy-safe, and idempotent. Its response contains counts only.

## 3. Dashboard freshness

Saved-report `staleAt` alone is not freshness. The server resolves each report against the latest exact tenant/repository/PR analysis job:

- `current`: latest job completed and its head matches the report;
- `refreshing`: latest job is queued or processing;
- `refresh_failed`: latest job is retryable or terminal failure;
- `superseded`: latest completed job belongs to a different head;
- `stale`: legacy storage marked stale and no job supersedes that decision;
- `unknown`: job lookup is unavailable or incomplete.

Only `current` reports are copy eligible. Bulk copy fetches and revalidates on every click, excludes non-current reports with bounded counts, and refuses an incomplete/truncated bundle. The envelope exposes no internal job identifiers or newer SHA.

## 4. Requirement proof axes

Each requirement may require multiple independent proof axes. The additive model records:

- subject: implementation, documentation, CI configuration, targeted test, execution, or visual;
- polarity: present or absent;
- state: satisfied, violated, or incomplete;
- deterministic evidence references and an optional collection basis.

A requirement is `met` only when every required axis is satisfied and none is violated or incomplete. Positive behavior/test/CI claims still require relevant passing execution. Static documentation or implementation-absence constraints may be met without execution only when the changed-file/diff inventory is complete and head-anchored. A capped or unavailable inventory makes absence incomplete, never met.

The full report validator checks axes rather than applying a universal passing-execution requirement. Legacy reports without axes retain the conservative legacy rule.

## Acceptance

- Same-head PR and Check events converge on one canonical row and one final revision.
- New head creates a separate canonical analysis.
- Stale or expired provider work reaches completed deterministic fallback or bounded terminal state; no job remains processing beyond the recovery bound.
- Stale saved reports are never shown/exported as current while newer work is active or failed.
- Absence-only and mixed requirements validate according to all required axes; incomplete inventories cannot prove absence.
- Focused tests, full suite, typecheck, lint, build, diff check, migration application, production deployment, and 14-head live evaluation all pass.
