# AgentProof SaaS Goal And Roadmap

## North Star

AgentProof should become an invite-only beta SaaS for evidence-based verification of AI-agent pull requests.

It answers one question:

> Is there enough evidence that this agent-authored PR satisfies the original request?

The product helps a human reviewer decide what to trust, what to inspect first, and what to ask the coding agent to fix next. It must not become a broad AI code reviewer, an auto-merge gate, a generic PR-comment generator, or an unsupported security scanner.

## Current State

Status as of 2026-06-30:

- The portfolio MVP is complete and deployed at `https://agentproof-pearl.vercel.app`.
- The deterministic verifier, report validation, summary-only share/save flows, GitHub comment safety, Slack summary payload, OpenAI structured-output adapter, GitHub App signed webhook boundary, operator diagnostics, evaluation pack, production smoke workflow, and reviewer-signal sentinels are implemented.
- The current product is still operator-configured. GitHub App automation, Supabase storage, Slack, OpenAI, and live smoke workflows depend on environment variables and runbooks.
- The product is not yet a self-serve SaaS because it does not have tenant accounts, self-serve GitHub App onboarding, billing, quotas, customer audit logs, queue-backed analysis, customer-facing operations dashboards, or deletion workflows.

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
- Webhook analysis runs only when `installation_id + repository` maps to an active tenant grant.
- Suspended or deleted installations cannot fetch PR evidence, save reports, comment, or notify Slack.
- Private repo failures explain whether the issue is installation permission, repository grant, visibility, GitHub rate limit, or missing CI evidence.
- Existing no-secret demo mode still works without authentication.

## Milestone 2: Reviewer Workflow And Activation

Goal:

Turn first setup into a repeatable merge-review workflow.

Required changes:

- Add a tenant dashboard showing recent summary-only reports, failed analyses, repo status, quota usage, and setup warnings.
- Add customer-facing GitHub App health checks for missing permissions, expired/suspended installations, inaccessible repos, rate limits, large PR caps, and unavailable checks.
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

- Define the tenant data retention policy before adding customer saved history, audit exports, billing retention, backups, or restore procedures.
- Move webhook-triggered analysis off the request path into a durable job queue.
- Acknowledge valid webhooks quickly, then process analysis asynchronously with retries and dead-letter handling.
- Keep durable idempotency based on tenant, installation, repository, PR number, head SHA, and action.
- Add tenant, repo, IP, webhook delivery, and job concurrency rate limits.
- Add GitHub secondary-rate-limit backoff and retry policy.
- Add append-only audit events for install, uninstall, repo enable/disable, analysis run, saved report create/delete, comment create/update, Slack send, config change, billing event, failed auth, and admin access.
- Add structured logs, metrics, traces, and alerts for webhook acceptance, analysis success, GitHub API failures, storage errors, comment failures, Slack failures, OpenAI fallback, queue depth, latency, and privacy scanner failures.
- Add tenant deletion workflow for saved reports, repository grants, installations, webhook rows, queued work, and account metadata.
- Add backup and restore procedures for tenant metadata, summary-only reports, billing records, audit logs, and webhook/job state.

Completion criteria:

- The retention policy defines TTLs and deletion behavior for transient raw evidence, summary-only reports, webhook/job rows, audit logs, billing/account records, backups, and deleted tenants.
- Webhook acknowledgement p95 is under 1 second after queue adoption.
- Sustained 5xx, webhook signature spikes, GitHub auth failures, queue backlog, storage failures, and privacy scanner failures produce alerts.
- Tenant deletion removes or tombstones customer data according to the documented retention policy.
- Restore drill and deletion drill are tested before public launch.
- Audit export contains bounded metadata only: actor, tenant, repo, PR number, action, result, timestamp, request id, and safe status fields.

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
- `billing_customers`: tenant, provider customer id, subscription id, plan, status.

Do not add durable tables for raw diffs, raw logs, full webhook payloads, evidence indexes, agent claims, or raw re-prompt text.

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
   - Current implementation note: an env-seeded tenant repository grant skeleton can fail closed before webhook idempotency, token fetch, PR fetch, saved reports, or comments. Database-backed tenants, members, installations, and self-serve repository selection remain separate work.

2. **Self-serve GitHub App onboarding**
   - Add install callback, repository selection, installation health, and repo settings.
   - Acceptance: a user can connect one repository without editing environment variables.

3. **Tenant-scoped saved report store**
   - Add tenant id to saved report lifecycle while preserving summary-only projection and TTL.
   - Acceptance: wrong-tenant access returns not found or forbidden without exposing report metadata.
   - Current implementation note: saved reports can now carry tenant ownership plus a hashed report access key; tenant-owned reports are hidden from id-only lookups. Full authenticated tenant sessions, dashboard filtering, and deletion workflows remain separate work.

4. **Analysis job queue**
   - Move GitHub App webhook analysis into durable jobs with idempotency, retry, and dead-letter state.
   - Acceptance: valid webhook acknowledgement is fast and analysis result is visible later.

5. **Usage and quota layer**
   - Count analysis attempts, successful reports, comments, saved links, Slack sends, and OpenAI calls.
   - Acceptance: quota prevents expensive work and side effects before they start.
   - Current implementation note: tenant GitHub App analysis can reserve monthly analysis quota before webhook idempotency, GitHub token fetch, PR evidence fetch, saved reports, or comments. Production quota enforcement requires the durable Supabase reservation RPC; memory quota is local/demo only. Full billing plans, seat limits, connected-repo limits, dashboard usage, and Stripe/customer-portal integration remain separate work.

6. **Audit log and privacy scanner**
   - Add bounded audit events and automated checks that durable rows do not contain raw evidence fields or secret-like strings.
   - Acceptance: privacy scanner failure blocks release.

7. **Billing beta**
   - Add plan records, subscription status, billing portal, and quota mapping.
   - Acceptance: team plan controls feature gates and monthly PR analysis quota.

8. **Public launch polish**
   - Add public setup docs, pricing page, support paths, and source-backed market validation citations.
   - Acceptance: a new user can understand the product boundary, setup path, privacy policy, and pricing without a private walkthrough.
