# AgentProof SaaS Goal And Roadmap

## North Star

AgentProof should become an invite-only beta SaaS for evidence-based verification of AI-agent pull requests.

It answers one question:

> Is there enough evidence that this agent-authored PR satisfies the original request?

The product helps a human reviewer decide what to trust, what to inspect first, and what to ask the coding agent to fix next. It must not become a broad AI code reviewer, an auto-merge gate, a generic PR-comment generator, or an unsupported security scanner.

## Current State

Status as of 2026-06-30:

- The portfolio MVP is complete and deployed at `https://agentproof-pearl.vercel.app`.
- The deterministic verifier, report validation, summary-only share/save flows, GitHub comment safety, Slack summary payload, OpenAI structured-output adapter, GitHub App signed webhook boundary, operator diagnostics, invite-only onboarding skeleton, first-class GitHub installation metadata, repository grants/settings, repository setup health API, queue enqueue/worker/bounded-batch boundary, Vercel Cron-compatible scheduler route, aggregate queue summary metrics and alert signals, read-only dead-letter summary, operator-only summary Slack queue alert delivery, invite-only `/tenant` setup dashboard, summary-only plan access readiness, tenant audit export summary, count-only deletion preview tied to a draft retention policy, internal tenant deletion execution boundary, evaluation pack, production smoke workflow, and reviewer-signal sentinels are implemented.
- The current product is still beta/operator-configured. GitHub App automation, Supabase storage, Slack, OpenAI, and live smoke workflows depend on environment variables and runbooks. A bounded tenant account/member metadata read model exists for beta dashboards, and the durable tenant auth/session path can issue revocable server-side HttpOnly sessions for active tenant members from bootstrap credentials. Tenant cookie mutations now require same-origin proof, failed invite/bootstrap session attempts can be audited as bounded system events, and durable owner/admin sessions can mutate member role/status through a metadata-only account lifecycle endpoint that protects the last active owner. Tenant APIs prefer durable sessions, then fall back to the short-lived invite-derived session or tenant-bound invite header for design-partner read/setup compatibility. This is still not full OAuth login, billing identity, public customer account management, or customer self-serve. A public launch trust/setup draft now defines product-boundary, GitHub App permission, Slack summary, retention/deletion, troubleshooting, pricing-language, and support copy boundaries, with source-level tests guarding public surfaces against unsupported positioning drift.
- The product is not yet a self-serve SaaS because it does not have full tenant accounts, billing-grade quota pages, a full background worker system, operations dashboards, broad incident routing, retention cleanup jobs, deletion drills, restore drills, or destructive deletion workflows.

## Final SaaS Success Definition

AgentProof reaches SaaS readiness when these outcomes are true:

- **Product clarity:** every public surface describes AgentProof as an evidence report for AI-agent PR verification, not generic code review.
- **Self-serve activation:** a team lead can sign in, install the GitHub App, choose one repository, run a first real PR report, and understand setup failures without operator env edits.
- **Reviewer utility:** a reviewer can identify requirement coverage, weak proof, missing tests, scope creep, risky files, and the next agent prompt in about 30 seconds.
- **Tenant safety:** every analysis, saved report, webhook delivery, comment, Slack notification, and audit event is scoped to an active tenant and repository grant.
- **Privacy boundary:** durable storage keeps summary-only metadata and never stores raw diffs, raw logs, full webhook payloads, tokens, private keys, evidence indexes, agent claims, or raw re-prompt text.
- **Commercial viability:** teams can subscribe, manage seats, enforce quotas, and understand usage without support intervention.
- **Operational readiness:** production has queues, rate limits, retries, idempotency, observability, alerts, incident runbooks, deletion drills, and restore drills.

## Target User And Launch Model

Default target:

- Small-team CTO, tech lead, or senior reviewer who already receives agent-authored PRs and needs fast evidence-based handoff before merge.

Default launch model:

- Invite-only beta for 3-5 design partner teams before public self-serve.

Default pricing model:

- Team monthly subscription plus PR-analysis quota.
- Pricing should be based on verified PR workflow value, connected repositories, seats, and usage limits, not on generic "AI review comments."

Initial package shape:

- **Free/demo:** public PR analysis, demo scenarios, limited saved summary links.
- **Team:** private repo verification, GitHub App installation, summary history, Slack summary notifications, limited marker comments, monthly PR quota.
- **Pro/Org:** higher quota, more connected repositories, audit export, retention controls for summary-only reports, priority support, stricter admin controls.

## Milestone 1: Design Partner SaaS

Goal:

Let a small number of real teams use AgentProof without manual env editing by the product owner.

Required changes:

- Add authentication and tenant records.
- Add member roles for owner/admin/member.
- Add GitHub App installation onboarding.
- Add repository grants mapped to tenant, installation id, repository id, and full name.
- Replace the production SaaS path's global repository allowlist with tenant-owned repository grants.
- Add per-repository settings for analysis, saved summary links, marker comments, and Slack notification opt-in.
- Keep automatic comments disabled by default and require repo-level opt-in.
- Add an onboarding checklist: sign in, install GitHub App, select repo, run first PR report, choose share/comment settings.

Completion criteria:

- A new team can generate its first real PR evidence report within 15 minutes.
- Webhook analysis runs only when `installation_id + repository_id` maps to an active tenant grant.
- Suspended or deleted installations cannot fetch PR evidence, save reports, comment, or notify Slack.
- Private repo failures explain whether the issue is installation permission, repository grant, visibility, GitHub rate limit, or missing CI evidence.
- Existing no-secret demo mode still works without authentication.

Current implementation note:

- Tenant account/member metadata can now be read by authorized tenant admins through a summary-only endpoint and the `/tenant` dashboard. It exposes tenant display name, status, plan label, member ids, roles, and member statuses only. Durable tenant auth issues opaque HttpOnly cookies backed by hashed server-side session rows for active members, rechecks tenant/member status during authorization, supports server-side revocation, and preserves the existing invite-derived session/header path only as a design-partner fallback. Cookie-mutating tenant routes require same-origin proof, failed auth/session attempts write bounded audit events, and durable owner/admin sessions can patch member role/status through a metadata-only lifecycle route. Repository settings mutations, GitHub App onboarding start, and repository grant creation require `owner` or `admin`; member lifecycle requires durable `owner` or `admin`. This is not full OAuth login, billing identity, customer-managed seats, or public self-serve.
- Plan access readiness can now compose account status, usage quota state, and aggregate repository grant settings into a summary-only `/tenant` card. It intentionally does not expose billing provider ids, repository names, repository ids, installation ids, usage idempotency keys, raw evidence, or payment state, and it is not a billing provider integration.

## Milestone 2: Reviewer Workflow And Activation

Goal:

Turn first setup into a repeatable merge-review workflow.

Required changes:

- Add a tenant dashboard showing recent summary-only reports, failed analyses, repo status, quota usage, and setup warnings. The first `/tenant` setup dashboard exists for install, grants, settings, repo health, read-only monthly usage, recent summary report metadata with priority/status/query filters over a bounded recent summary sample, recent verification activity, async analysis status filters with recent-sample rollups, and a summary-only setup warning rollup from loaded account, plan access, repository health, usage, and job status signals.
- Add customer-facing GitHub App health checks for missing permissions, expired/suspended installations, inaccessible repos, rate limits, large PR caps, and unavailable checks. The metadata-only repository health API and explicit per-repo probe UI now surface suspended/deleted GitHub installation metadata as first-report blockers without fetching installation tokens. An opt-in single-PR readiness probe also reports PR access, changed-file count versus the evidence cap, and check-run/commit-status availability without returning PR titles/bodies, head SHAs, patches, logs, check names, or report evidence. Broader queue/quota/billing diagnostics remain separate launch work.
- Keep the report layout focused on top risk, weakest evidence, requirement coverage, missing tests, scope creep, review priority, and next action.
- Keep GitHub PR comments marker-based and summary-only.
- Add Slack summary notification settings per tenant or repo.
- Add report search/filter over summary-only fields only.

Completion criteria:

- A reviewer can find the top risk, weakest evidence, and next action without deep scrolling on desktop and mobile.
- Summary-only reports remain free of evidence indexes, raw diffs, raw logs, claims, raw re-prompt text, and failed annotation details.
- Slack messages neutralize mentions and contain summary-only fields.
- Comment automation updates one AgentProof marker comment per PR and cannot create comment storms.
- `pnpm eval:sentinels` remains the local regression guard for documented reviewer handoff signals.

## Milestone 3: Paid Team Beta

Goal:

Make AgentProof commercially testable with billing, quotas, and plan boundaries.

Required changes:

- Add billing customer records, plan records, subscription status, billing period, seat limits, and PR-analysis quotas.
- Integrate a billing provider and customer portal.
- Add usage records for analysis attempts, successful reports, saved summary links, comments, Slack sends, and OpenAI verifier calls.
- Gate private repo automation, saved history duration, Slack, comments, connected repositories, and quota by plan.
- Add quota-safe failure responses that do not trigger analysis, comments, or Slack when usage is blocked.
- Keep billing data separate from report evidence data.
- Keep provider customer/subscription identifiers server-side and internal-only; customer-facing surfaces should use plan/status labels and bounded quota summaries instead.

Completion criteria:

- Trial-to-paid conversion can be measured.
- Quota overages stop webhook-triggered analysis before expensive GitHub/OpenAI work starts.
- Plan downgrade disables gated features safely without deleting customer data unexpectedly.
- Billing webhooks are idempotent and tenant-scoped.
- No billing page or webhook prints tokens, reports, diffs, logs, or private repository payloads.

## Milestone 4: SaaS Operations And Trust

Goal:

Make the service reliable and auditable enough for paying teams.

Required changes:

- Implement cleanup jobs and provider retention controls from the concrete draft tenant data retention windows before adding customer saved history, audit exports, billing retention, backups, or restore procedures.
- Move webhook-triggered analysis off the request path into a durable job queue.
- Acknowledge valid webhooks quickly, then process analysis asynchronously with retries and dead-letter handling.
- Keep durable idempotency based on tenant, installation, repository, PR number, head SHA, and action.
- Add tenant, repo, IP, webhook delivery, and job concurrency rate limits.
- Add GitHub secondary-rate-limit backoff and retry policy.
- Add append-only audit events for install, uninstall, repo enable/disable, analysis run, saved report create/delete, comment create/update, Slack send, config change, billing event, failed auth, and admin access.
- Add structured logs, metrics, traces, and alerts for webhook acceptance, analysis success, GitHub API failures, storage errors, comment failures, Slack failures, OpenAI fallback, queue depth, latency, and privacy scanner failures.
- Add tenant deletion workflow for saved reports, repository grants, installations, webhook rows, queued work, and account metadata.
- Add backup and restore procedures for tenant metadata, summary-only reports, billing records, audit logs, and webhook/job state.

Current implementation note:

- A draft tenant data retention matrix now exists in `docs/tenant-data-retention.md` and `src/lib/tenant-retention-policy.ts` with concrete retention windows and deletion readiness markers. The tenant deletion preview remains count-only and reports the policy version/status plus counted/uncounted category coverage, deletion plan windows, GitHub installation metadata counts, and tenant-mapped webhook delivery counts. New tenant-control webhook idempotency rows store `tenant_id`; historical rows without `tenant_id` must not be inferred from repository metadata. Tenant repository grants now have a metadata-only tenant-wide disable primitive for deletion start. Operator-token-gated deletion execution can now block new work, run guarded saved summary report purge, run guarded analysis-job purge, and run one guarded deletion step at a time while exposing only metadata-only counts, phase, status, and next-action fields. Analysis-job purge is refused unless new work is blocked, deletion state is active, and queued/processing/retryable counts are zero. Deletion readiness remains intentionally incomplete until every remaining category purge, external GitHub installation revocation/disconnect, account/member and billing retention handling, backup expiry behavior, deletion drills, and restore drills are covered. Public customer destructive deletion controls remain separate launch-gate work.
- Tenant admins can now download a summary-only audit export through a distinct `/api/tenants/audit-export` route and `/tenant` dashboard control. The export requires tenant-bound invite/session auth, returns `tenant-audit-export-summary-only`, uses default limit 100 and max 250 with truncation metadata, and includes only bounded audit event fields such as actor, action, result, repository name, PR number, SHA/delivery prefixes, status, evidence coverage, saved-report privacy/durability, and comment action. It intentionally excludes installation ids, provider ids, raw metadata, payloads, diffs, logs, claims, re-prompts, report bodies, saved-report URLs/keys, comment bodies, tokens, signatures, table names, env names, and service-role secrets.

Completion criteria:

- The retention policy defines TTLs and deletion behavior for transient raw evidence, summary-only reports, webhook/job rows, audit logs, billing/account records, backups, and deleted tenants.
- Webhook acknowledgement p95 is under 1 second after queue adoption.
- Sustained 5xx, webhook signature spikes, GitHub auth failures, queue backlog, storage failures, and privacy scanner failures produce alerts.
- Tenant deletion removes or tombstones customer data according to the documented retention policy.
- Restore drill and deletion drill are tested before public launch.
- Audit export contains bounded metadata only: actor, tenant, repo, PR number, action, result, timestamp, delivery/request id prefix, and safe status fields.

## Milestone 5: Public SaaS Launch

Goal:

Open AgentProof beyond design partners without weakening the evidence-verifier position.

Required changes:

- Publish a public landing page focused on evidence-based verification, requirement coverage, missing proof, scope creep, and re-prompting.
- Publish setup docs for GitHub App permissions, private repo access, Slack, data retention, deletion, pricing, troubleshooting, and support.
- Replace internal market-validation notes with URL-backed public citations before making market claims.
- Add feedback loops for setup failures, report usefulness, cancellation reasons, false positives, missing evidence, and support issues.
- Add a lightweight customer support process and status/incident communication path.

Completion criteria:

- A new customer can sign up, install, analyze, share or comment, manage billing, and request deletion through self-serve flows.
- At least 5 teams use AgentProof weekly for 4 consecutive weeks.
- At least one paid team or written design partner commitment validates willingness to pay.
- Public docs state that AgentProof does not auto-merge, does not claim full correctness, and does not retain durable raw code evidence.

Current implementation note:

- `docs/public-launch-trust.md` is the first public-facing trust/setup boundary draft. It covers product positioning, GitHub App permissions, Slack summary gates, retention/deletion boundaries, troubleshooting language, pricing packaging language, support paths, and pre-publication checks without making unsupported market claims. Source-level copy boundary tests now monitor selected public docs and app surfaces so broad review, merge-authority, bug-finder, and unsupported security positioning does not slip into launch copy. This is documentation and regression coverage only; public self-serve signup, billing, durable customer support workflows, deletion/restore drills, and cited market claims remain separate launch work.

## Core Data Model For SaaS

The implementation should introduce these tenant-scoped entities before public SaaS launch:

- `tenants`: organization/team, plan, billing status, deletion state.
- `members`: user, tenant, role, invitation status.
- `github_installations`: installation id, account id, account login, status, tenant.
- `repositories`: GitHub repository id, full name, tenant grant, installation id, enabled settings.
- `analysis_runs`: tenant, repo, PR number, head SHA, action, status, priority, evidence coverage, bounded failure code.
- `saved_reports`: tenant, report id, summary-only report, expiration, privacy label.
- `audit_events`: tenant, actor, action, result, request id, bounded metadata.
- `usage_records`: tenant, period, feature, count, quota source.
- `billing_customers`: tenant, internal-only provider customer id, internal-only subscription id, plan, status.

Do not add durable tables for raw diffs, raw logs, full webhook payloads, evidence indexes, agent claims, or raw re-prompt text.
Do not expose billing provider identifiers in tenant-facing dashboards, customer-visible APIs, audit exports, comments, Slack notifications, saved reports, or support screenshots.

## Privacy And Security Boundaries

Keep these rules throughout implementation:

- Store summary-only reports by default.
- Keep raw PR evidence transient and bounded to the request/job execution.
- Redact secret-looking values before rendering, logging, storing, commenting, or notifying.
- Never expose service-role keys, private keys, webhook secrets, OpenAI keys, Slack webhooks, GitHub tokens, or ops tokens to the client.
- Do not use `NEXT_PUBLIC_` for server secrets.
- Treat LLM output as optional interpretation. It must use structured output, pass runtime validation, preserve deterministic evidence references, and fall back to deterministic reports when invalid.
- Keep automatic comments, Slack notifications, saved links, and OpenAI verifier calls separate opt-ins.
- Use least-privilege GitHub App permissions and document every permission in customer-facing setup docs.

## Success Metrics

Product metrics:

- Activation rate: new teams that connect GitHub and generate a first real PR report within 15 minutes.
- First value rate: first reports where the reviewer can identify a next action.
- Weekly active teams: teams with at least 3 agent-authored PRs verified per week.
- Report utility: reports that surface at least one useful requirement gap, missing test, scope issue, failed execution signal, or vague-task limitation.
- Trial-to-paid conversion.
- Paid connected repositories.
- Paid reports per active repository.
- Churn and cancellation reason.

Trust metrics:

- 100% report validation before render, store, comment, Slack, or LLM trust.
- 0 durable raw evidence leaks.
- 0 wrong-tenant report access.
- 0 unapproved automatic comments.
- 100% GitHub App analysis mapped to an active tenant repository grant.
- Production smoke passes on every release.
- Privacy scanner passes on every release.

Operational metrics:

- Webhook acknowledgement p95.
- Analysis completion p95.
- GitHub API failure rate.
- Storage failure rate.
- Queue backlog and dead-letter count.
- Comment failure rate.
- Slack failure rate.
- OpenAI fallback rate.
- Mean time to recover from provider or storage incidents.

## Launch Gates

Before each production launch or public beta expansion, these gates must pass:

- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm eval:sentinels`
- `pnpm eval:summary:fixture:strict`
- production smoke workflow
- tenant authorization tests
- documented retention policy review
- quota and billing-state tests
- privacy scanner tests for durable storage outputs
- GitHub App install/uninstall lifecycle tests
- webhook idempotency and queue retry tests
- deletion drill
- backup/restore drill
- incident runbook review

## Non-Goals

Do not implement these until the SaaS evidence-verifier workflow is proven:

- Auto-merge or merge-blocking enforcement.
- Generic style review comments.
- Broad bug finder behavior unrelated to original requirements.
- Security scanner claims without dedicated security tooling.
- Long-term raw source, diff, log, or full-report retention.
- Automatic comments without explicit repo-level opt-in.
- Jira integration, Slack OAuth marketplace app, org analytics suite, native mobile app, or policy enforcement dashboard.

## First Implementation Tickets

1. **Tenant control plane skeleton**
   - Add tenant/member/repository/installation types and persistence boundaries.
   - Acceptance: webhook analysis cannot run without an active tenant repository grant.
   - Current implementation note: tenant repository grants can now be stored through the server-only control-plane Supabase boundary, authorize webhook analysis by `installation_id + repository_id`, expose repo verification settings for `enabled`, `analysisEnabled`, `saveReportsEnabled`, `commentEnabled`, and repo-level Slack summary opt-in metadata, support revocable durable tenant auth sessions plus short-lived invite-derived sessions for design-partner fallback, require bounded `owner` or `admin` role metadata for repository settings mutations and GitHub App repository binding, store first-class GitHub installation metadata after verified onboarding callbacks, disable grants from signed GitHub App uninstall/suspend/repository-removal lifecycle events, and disable all tenant grants through a metadata-only deletion-start primitive that does not return repository names. Uninstall/suspend lifecycle events also mark installation metadata `deleted` or `suspended` when one tenant mapping is known. Env-seeded grants remain local/demo compatibility only and are marked manual-review for deletion. OAuth/customer login, durable role lifecycle management UI, Slack OAuth/marketplace installation, and destructive row deletion remain separate work.

2. **Self-serve GitHub App onboarding**
   - Add install callback, repository selection, installation health, and repo settings.
   - Acceptance: a user can connect one repository without editing environment variables.
   - Current implementation note: invite-only onboarding now supports tenant-bound beta invites, opaque hashed state/nonce storage, browser callback redirect to `/tenant`, activation cookies, bounded repository listing up to 500 installed repositories, server-fetched repository grant creation, metadata-only repo settings updates, explicit per-repo health probes, read-only usage summaries, recent summary report metadata, recent verification activity summaries, count-only tenant deletion preview, a 12-hour HttpOnly tenant admin session for controlled design partners, and a durable tenant auth/session v1 for active tenant members. It is still design-partner onboarding, not a full account system; OAuth login, customer audit export, destructive tenant deletion/tombstoning, member lifecycle UI, and broader GitHub permission/job health remain separate work.

3. **Tenant-scoped saved report store**
   - Add tenant id to saved report lifecycle while preserving summary-only projection and TTL.
   - Acceptance: wrong-tenant access returns not found or forbidden without exposing report metadata.
   - Current implementation note: saved reports can now carry tenant ownership plus a hashed report access key; tenant-owned reports are hidden from id-only lookups and can be listed or counted as bounded tenant summary metadata. Full authenticated tenant sessions, dashboard filtering, and destructive deletion workflows remain separate work.

4. **Analysis job queue**
   - Move GitHub App webhook analysis into durable jobs with idempotency, retry, and dead-letter state.
   - Acceptance: valid webhook acknowledgement is fast and analysis result is visible later.
   - Current implementation note: queue-backed mode can now fail closed when queue storage is missing and can enqueue bounded metadata-only analysis jobs after grant/quota/idempotency/side-effect gates but before GitHub installation-token fetch. Job rows hash idempotency keys and omit webhook bodies, PR bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, comments, saved-report keys, Slack webhooks, and tokens; completed jobs may store summary-only result metadata such as priority, evidence coverage, and saved-report/comment/Slack action status. The queue library also has metadata-only claim, retry-lease, completion, retryable-failure, and terminal-failure primitives plus operator-token-gated preflight/run/run-batch endpoints. The run endpoints re-authorize tenant repository grants before any token fetch, fetch GitHub evidence, generate validated reports, perform configured summary-only side effects, and complete due jobs within a small bounded batch. Repo-level Slack summary delivery now requires an active tenant grant, repo Slack opt-in, configured server-side Slack webhook, quota allowance, and durable audit when the side-effect gate is enabled; payloads use summary-only formatting and neutralize mentions. `vercel.json` schedules a token-gated cron route once daily for the conservative first rollout; the route no-ops when queue mode is disabled and returns aggregate-only metadata output. Operator diagnostics include aggregate queue summary metrics and alert signals, a read-only dead-letter summary exposes failed-terminal error-code distribution plus aggregate-only incident status and next-action codes without job internals, and an operator-only Slack route can deliver warning-level queue alerts using summary-only aggregate payloads. Design-partner tenants can read summary-only async job status in `/tenant`. Dead-letter requeue/ack workflows, broader incident routing, separate worker processes, concurrency controls, Slack OAuth routing, separate Slack usage billing records, and exactly-once operational guarantees remain separate work.

5. **Usage and quota layer**
   - Count analysis attempts, successful reports, comments, saved links, Slack sends, and OpenAI calls.
   - Acceptance: quota prevents expensive work and side effects before they start.
   - Current implementation note: tenant GitHub App analysis can reserve monthly analysis quota before webhook idempotency, GitHub token fetch, PR evidence fetch, saved reports, comments, or Slack summaries. The server-only quota seed now also carries bounded plan capability flags for connected repository limits, saved summary links, marker comments, Slack summaries, and structured verifier access; webhook and worker execution recheck those plan flags before Slack configuration checks, durable side-effect audit, GitHub token fetch, PR evidence fetch, saved-report creation, marker comments, or Slack delivery. `/api/llm/verify` also requires tenant plan context and `structuredLlmVerifierEnabled: true` before OpenAI calls when quota enforcement is enabled. `/api/tenants/usage` and the `/tenant` dashboard can show read-only monthly usage summaries without reserving quota or exposing raw rows/idempotency keys, while plan readiness exposes only plan labels, usage status, connected repository count/limit, and bounded feature states. Production quota enforcement requires the durable Supabase reservation RPC; memory quota is local/demo only. Stripe/customer-portal integration, provider subscription lifecycle, separate per-side-effect usage billing records, and seat billing remain separate work.

6. **Audit log and privacy scanner**
   - Add bounded audit events and automated checks that durable rows do not contain raw evidence fields or secret-like strings.
   - Acceptance: privacy scanner failure blocks release.
   - Current implementation note: GitHub App automation can now write bounded audit events for grant denial, grant lifecycle disables, quota blocks/unavailability, idempotency unavailability, duplicate skips, completed analysis, failed analysis, and side-effect preflight. When `AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS=true`, saved-report, marker-comment, and Slack summary automation fails closed before GitHub token fetch if durable audit storage is missing or unavailable. Audit events can include only bounded Slack side-effect action/privacy metadata, never Slack webhook URLs, channel/workspace/provider identifiers, or response bodies. Audit events run through a structural privacy scanner before memory or Supabase storage. Tenant admins can export bounded summary-only audit events from `/api/tenants/audit-export` without raw metadata, provider ids, table names, env names, or secrets. Admin access, billing, deletion execution, and always-required audit gates remain separate work.

7. **Billing beta**
   - Add plan records, subscription status, billing portal, and quota mapping.
   - Acceptance: team plan controls feature gates and monthly PR analysis quota without exposing provider customer or subscription ids.

8. **Public launch polish**
   - Add public setup docs, pricing page, support paths, and source-backed market validation citations.
   - Acceptance: a new user can understand the product boundary, setup path, privacy policy, and pricing without a private walkthrough.
