# AgentProof

AgentProof creates evidence-based verification reports for AI-generated pull requests. It answers: "Is there enough evidence that this agent-authored PR satisfies the original request?"

It is deliberately not a generic AI code reviewer. AgentProof maps the original issue, task, or prompt to acceptance criteria, checks whether the PR has evidence for each criterion, highlights weak tests and scope creep, and produces a short re-prompt for the coding agent. It supports human merge decisions; it does not replace them.

## MVP

- PR URL + optional GitHub token intake
- Optional issue/task text and CI/log snippets
- Criterion-by-criterion evidence report
- Missing-test and scope-creep detection
- Review priority map
- 30-second reviewer card and detailed report
- Demo mode with realistic sample data
- Summary-only recent report history in the browser
- Summary-only share links
- Summary-only saved report API with in-memory demo mode and optional Supabase durability
- Optional GitHub PR comment posting with a one-time write token
- Env-gated GitHub App webhook automation, Slack notification, and OpenAI verifier adapters
- LLM structured-output boundary and runtime report validation

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Demo Path

The deployed demo works without secrets: `https://agentproof-pearl.vercel.app`.

Use the left demo selector to compare the intended verifier signals:

- `Clean PR`: password reset work with matching tests and passing checks. Expect low risk and mostly met requirements.
- `Scope creep`: password reset work plus unrelated auth/session files. Expect out-of-scope file warnings.
- `Missing tests`: invoice CSV export with lint/typecheck only. Expect missing targeted test evidence.
- `Failed CI`: workspace invite validation with a failing unit-test log. Expect a blocker from failed execution evidence.
- `Vague task`: dashboard polish without concrete acceptance criteria. Expect unclear coverage and low confidence.

The demo is a verification handoff, not an approval gate. Share links and Recent history are summary-only; full Markdown export and PR comment copy are explicit user actions.

For frozen portfolio artifacts, see `docs/example-reports.md`. For the MVP completion record and the latest deployment smoke checklist, see `docs/mvp-completion.md` and `docs/deployment-smoke.md`.

## Validate

```bash
pnpm test
pnpm typecheck
pnpm eval:sentinels
pnpm build
```

`pnpm eval:sentinels` is a deterministic reviewer-signal guard, not a product score. It checks that documented demo reports still expose scope creep, missing tests, failed execution, vague-task uncertainty, visual-proof gaps, summary-only privacy, and useful re-prompt leads.

## Production Smoke

Use the manual GitHub Actions workflow `AgentProof Production Smoke` after a production deployment or integration change. It checks public pages, confirms `GET /api/analyze` still fails closed, and runs the real public PR regression set against the deployed app.

The smoke includes a deterministic `qualityGate` for report trust boundaries: requirement findings exist, `met` findings cite passing execution evidence, reviewer leads keep provenance, summary-only storage stays summary-only, and the report avoids merge-decision wording. This is not a product score; it is a regression guard for the evidence report contract.

The default workflow inputs enforce loose p95 (95th percentile) budgets: total response `3000ms`, evidence collection `2500ms`, and GitHub check/status/job phases `1500ms`. These budgets are guardrails, not product promises. If one manual run fails during a GitHub or Vercel blip, rerun once; repeated failures should be treated as an evidence-collection regression.

This workflow does not require secrets and should not receive tokens in the `base_url` input. For local or one-off terminal checks, use:

```bash
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app \
AGENTPROOF_SMOKE_MAX_TOTAL_P95_MS=3000 \
AGENTPROOF_SMOKE_MAX_EVIDENCE_P95_MS=2500 \
AGENTPROOF_SMOKE_MAX_GITHUB_CHECKS_P95_MS=1500 \
AGENTPROOF_SMOKE_MAX_GITHUB_STATUSES_P95_MS=1500 \
AGENTPROOF_SMOKE_MAX_GITHUB_JOBS_P95_MS=1500 \
pnpm smoke:production-regression
```

## Environment

The app can run in demo mode without environment variables. For live GitHub PR fetches, paste a fine-grained GitHub token in the form. The token is used only for that request and is not stored by this MVP.

Posting a PR comment requires a separate fine-grained token with comment write permission for the target repository. The exact comment preview is shown before posting, and the token is cleared after the request.

Use `.env.example` as the local template. Do not commit `.env` or `.env.local`; both are ignored.

Optional server integrations are off by default:

- `GITHUB_WEBHOOK_SECRET`: enables signed GitHub webhook intake. Without automation opt-in, the endpoint stays dry-run.
- `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`: enables GitHub App installation-token analysis when automation is explicitly enabled. `GITHUB_PRIVATE_KEY` must be a valid PEM private key; local env files may use escaped `\n` newlines.
- `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED`: opts in to PR webhook-triggered analysis after a repository authorization source approves the event.
- `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS`: legacy operator/demo allowlist used only when tenant control is disabled. Use `owner/repo` comma-separated values; `*` allows all installed repos and should be avoided outside controlled testing.
- `AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED`, `AGENTPROOF_CONTROL_PLANE_SUPABASE_URL`, `AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_TENANT_REPOSITORY_GRANTS_TABLE`, `AGENTPROOF_GITHUB_INSTALLATIONS_TABLE`, `AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_URL`, `AGENTPROOF_GITHUB_INSTALLATIONS_SUPABASE_SERVICE_ROLE_KEY`: invite-only SaaS authorization skeleton. When tenant control is enabled, webhook analysis ignores the global allowlist and requires an active server-only grant matching `installationId + repositoryId`. Durable grants store metadata only and require GitHub repository ids. GitHub installation metadata is stored separately from repository grants and should enforce one `installation_id` owner tenant at the database level.
- `AGENTPROOF_GITHUB_APP_SLUG`, `AGENTPROOF_ONBOARDING_STATE_SECRET`, `AGENTPROOF_TENANT_SESSION_SECRET`, `AGENTPROOF_BETA_INVITES`, optional `AGENTPROOF_ONBOARDING_STATES_TABLE`: invite-only GitHub App onboarding, repo verification settings, customer-facing repository health, and the `/tenant` design-partner dashboard. The onboarding flow stores only hashed opaque state/nonce values, first-class GitHub installation metadata, and tenant/repo grant metadata. `/tenant` can bootstrap a 12-hour HttpOnly tenant admin session from a tenant-bound invite header, then use that session cookie for tenant APIs without putting invite tokens in URLs, request bodies, localStorage, or sessionStorage. Cookie-mutating tenant routes require same-origin proof. Durable tenant auth can issue revocable HttpOnly member sessions from bootstrap credentials, records failed auth/session attempts as bounded audit events, and lets durable owner/admin sessions patch member role/status when a durable account store is configured. Repo settings require tenant-bound invite records or a valid durable owner/admin session and update only `enabled`, `analysisEnabled`, `saveReportsEnabled`, `commentEnabled`, and `slackNotificationsEnabled`. Repository health is metadata-only by default; optional `probe=github` checks bounded GitHub repository metadata access without fetching PR evidence, diffs, logs, reports, comments, Slack data, or LLM verification. The dashboard can also read usage summaries, recent async analysis job summaries with public status filters and recent-sample rollups, recent summary reports, recent verification activity, and a count-only tenant deletion preview through summary-only tenant APIs. `AGENTPROOF_BETA_INVITE_TOKEN` and `AGENTPROOF_TENANT_REPOSITORY_GRANTS` remain local/demo compatibility paths; do not use them as the only production tenant boundary.
- `AGENTPROOF_TENANT_DELETION_TOMBSTONES`, optional `AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL`, `AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY`, `AGENTPROOF_TENANT_DELETION_STATE_TABLE`, local-only `AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY`: server-only deletion-state guards. Static or durable tombstones block grant authorization, grant mutation, and direct analysis-job enqueue, but public SaaS deletion still needs a full destructive deletion workflow and deletion drill.
- Signed GitHub App lifecycle webhooks disable matching tenant grants on app deletion/suspension or repository access removal. They return metadata only and never trigger PR analysis, saved reports, comments, Slack notifications, or LLM calls.
- `AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED`, `AGENTPROOF_USAGE_QUOTA_LIMITS`, `AGENTPROOF_USAGE_SUPABASE_URL`, `AGENTPROOF_USAGE_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_USAGE_RECORDS_TABLE`, optional `AGENTPROOF_USAGE_RESERVATION_RPC`: invite-only quota skeleton. When enabled, tenant GitHub App analysis must atomically reserve quota before idempotency, GitHub token fetch, PR evidence fetch, saved reports, or comments. `/api/tenants/usage` and `/tenant` expose read-only usage summaries without reserving quota or returning raw usage records, idempotency keys, repository names, PR payloads, reports, diffs, logs, claims, tokens, table names, or Supabase internals. `AGENTPROOF_USAGE_QUOTA_ALLOW_MEMORY=true` is local/demo only.
- `AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED`, `AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS`, `AGENTPROOF_BILLING_WEBHOOK_SUPABASE_URL`, `AGENTPROOF_BILLING_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_BILLING_WEBHOOK_EVENTS_TABLE`: provider-backed billing beta boundary. Subscription records can contain internal provider customer/subscription/price ids server-side, but tenant-facing plan access returns only `billing-beta-summary-only` fields: configured/provider-backed booleans, coarse subscription status, plan label, portal boundary mode, and webhook idempotency readiness. When enforcement is enabled, signed GitHub App automation and the analysis worker fail closed for missing, manual-only, inactive, or quota-plan-mismatched billing records before quota reservation, webhook idempotency, GitHub token fetch, PR evidence fetch, saved reports, comments, or Slack. Billing webhook idempotency stores hashed provider event ids only. `AGENTPROOF_BILLING_WEBHOOK_IDEMPOTENCY_ALLOW_MEMORY=true` is local/demo only; customer portal session creation and payment data storage remain separate provider-integration work.
- `AGENTPROOF_GITHUB_APP_SAVE_REPORTS`: when true, webhook-triggered analyses create summary-only saved report links.
- `AGENTPROOF_GITHUB_APP_COMMENT_ENABLED`: when true, webhook-triggered analyses create or update one GitHub App marker comment. Keep this false until the repository owner explicitly wants automatic comments.
- `AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS`: when true, webhook-triggered saved report and marker-comment side effects require durable audit storage to be configured and writable before AgentProof fetches a GitHub installation token. If audit storage is missing or down, the webhook fails closed with bounded metadata and does not create saved links or comments.
- `AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_URL`, `AGENTPROOF_GITHUB_WEBHOOK_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_GITHUB_WEBHOOK_DELIVERIES_TABLE`: enables durable duplicate suppression for GitHub App webhook automation. When webhook-specific Supabase env is absent, AgentProof reuses the saved-report Supabase URL and service-role key.
- `AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED`, `AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL`, `AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_ANALYSIS_JOBS_TABLE`: when enabled, signed GitHub App PR webhooks enqueue bounded analysis jobs after grant/quota/idempotency checks and before GitHub installation-token fetch. Queue insertion also rechecks tenant repository grants when tenant control is enabled, so disabled deletion-start grants cannot be bypassed by direct enqueue callers. Job rows store only tenant/repo/PR/head SHA/status metadata, hashed idempotency keys, planned summary-only side-effect flags, and optional completed result summaries; they do not store webhook bodies, PR titles/bodies, diffs, logs, full reports, evidence indexes, claims, raw re-prompt text, comments, saved-report keys, or tokens. `AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY=true` is local/demo only. Worker claim, retry lease, completion, terminal-failure primitives, operator-token-gated preflight/run/run-batch endpoints, Vercel Cron-compatible scheduler route, aggregate queue summary metrics, aggregate queue alert signals, read-only dead-letter summary, operator-only summary Slack queue alert delivery, and tenant-visible summary job status exist for the queue row lifecycle. The run endpoints can fetch GitHub evidence, generate validated reports, perform configured summary-only side effects, and complete due jobs within a small bounded batch. Dead-letter requeue/ack workflows, broader incident routing, and exactly-once operational guarantees remain separate SaaS work.
- `CRON_SECRET` or `AGENTPROOF_CRON_TOKEN`, optional `AGENTPROOF_CRON_ANALYSIS_JOB_BATCH_LIMIT`: protects Vercel-compatible cron routes. `/api/cron/analysis-jobs/run` is scheduled in `vercel.json` once daily for the conservative queue rollout; it returns a no-op metadata response when queue mode is disabled, fails closed when queue storage is incomplete, and never returns repository names, tenant ids, URLs, reports, diffs, logs, claims, raw re-prompt text, per-job items, or secrets. `/api/cron/reports/cleanup` deletes expired summary-only saved reports and returns only deleted count plus coarse count basis; it never returns report ids, tenant ids, access keys, report bodies, storage internals, evidence, claims, raw re-prompt text, diffs, logs, or secrets. The analysis batch limit defaults to one and is hard-capped at five.
- `AGENTPROOF_AUDIT_SUPABASE_URL`, `AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_AUDIT_EVENTS_TABLE`: enables bounded audit events for tenant GitHub App automation. Audit rows pass a structural privacy scanner and store only tenant/repo/action/result/request/status metadata, not raw payloads, reports, diffs, logs, claims, re-prompt text, comment bodies, tokens, saved-link keys, provider customer/subscription ids, invoice ids, or payment/card fields. `/api/tenants/audit-activity` exposes only flattened recent activity summaries with `privacy: "audit-activity-summary-only"`.
- `AGENTPROOF_OPS_TOKEN`: enables token-gated operator diagnostics, queue run endpoints, and the operator-only summary queue alert route. Ops endpoints authenticate only the `x-agentproof-ops-token` header, never query-string tokens. These endpoints return status categories or aggregate counters only, including coarse GitHub installation metadata storage mode, not env values, repository names, table names, tokens, payloads, diffs, or logs.
- `AGENTPROOF_OPS_TOKEN`: also enables `GET /api/ops/analysis-jobs/dead-letter`, a read-only failed-terminal summary with sampled error-code counts and oldest failure age. It does not return tenant ids, repository names, PR numbers, job ids, raw error summaries, URLs, reports, evidence, claims, diffs, logs, raw re-prompt text, table names, or secrets.
- `AGENTPROOF_OPS_DRILL_EVIDENCE`, optional `AGENTPROOF_OPS_DRILL_MAX_AGE_DAYS`: enables `GET /api/ops/drill-gate`, an operator-only launch-readiness evidence gate for deletion drill, restore drill, incident runbook review, and production smoke evidence. The env value is a JSON array of bounded records with `key`, `status`, `completedAt`, and `evidenceRef`; evidence refs are limited to docs anchors, GitHub Actions run ids, Vercel deployment ids, or manual record ids. The endpoint returns only `ops-drill-gate-summary-only` statuses/counts/next action, and never executes deletion or restore work or returns raw logs, tokens, repo/PR payloads, table names, provider ids, backup contents, or env values.
- `SLACK_WEBHOOK_URL`, `AGENTPROOF_NOTIFY_TOKEN`: enables summary-only Slack notifications from trusted internal callers.
- `SLACK_WEBHOOK_URL` plus `AGENTPROOF_OPS_TOKEN`: enables `POST /api/ops/analysis-jobs/alerts/slack`, which sends warning-level analysis queue alerts to Slack from server-derived aggregate metrics only. It ignores request bodies, defaults to warning-only delivery, and never sends tenant ids, repository names, PR URLs, raw reports, evidence, claims, diffs, logs, raw re-prompt text, job ids, error summaries, table names, or secrets.
- `AGENTPROOF_REPORTS_SUPABASE_URL`, `AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY`, optional `AGENTPROOF_REPORTS_TABLE`: enables durable summary-only saved reports through Supabase REST. Generic `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also accepted. `/api/tenants/reports` exposes tenant-bound recent report summaries only; it does not return report bodies, access keys, claims, evidence indexes, raw re-prompt text, diffs, or logs. Never expose the service-role key with a `NEXT_PUBLIC_` prefix.
- `GET /api/tenants/deletion-preview?tenantId=<id>` is a tenant-admin, count-only dry run tied to the draft tenant data retention policy. It reports policy version/status, counted/uncounted category coverage, and category counts for saved reports, repository grants, GitHub installations, tenant-mapped webhook deliveries, analysis jobs, audit events, and usage records without returning backend store names, table names, repository names, account logins, installation ids, PR numbers, report bodies, evidence, claims, diffs, logs, raw re-prompt text, saved-report keys, idempotency hashes, delivery ids, or tokens. It does not delete or mutate data; env-backed repository grants and GitHub installation metadata are marked for manual review.
- `OPENAI_API_KEY`, `AGENTPROOF_LLM_TOKEN`, optional `OPENAI_MODEL`: enables the structured-output verifier adapter. Missing or invalid output falls back to the deterministic report.

After pulling trusted env into `.env.local`, run the live OpenAI smoke test explicitly:

```bash
pnpm smoke:openai
```

This command calls the configured deployment and prints only pass/fail metadata, not prompts, reports, or secret values.
If Vercel stores a secret as unreadable/sensitive, `vercel env pull` may create a blank placeholder; export the needed value in your shell for that smoke run instead.

Run the signed GitHub webhook smoke when you want to verify production webhook intake without triggering live PR analysis or comments:

```bash
AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> \
pnpm smoke:github-webhook
```

The webhook smoke checks public coarse status, invalid-signature rejection, a signed `ping`, and a signed `pull_request` `closed` event that must not plan analysis or comments. It prints only bounded metadata and fails if secret-like probe values are echoed.

For the controlled live automation smoke, use `pnpm smoke:github-webhook-live` only on a maintainer-owned test PR in one explicitly authorized repository. It requires `AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION=1`, suppresses comments by default, and refuses to run unless public status is `event-mode`. See `docs/github-app-live-smoke-runbook.md` before running it.

Run the live GitHub comment smoke only when you intentionally want to create or update an AgentProof marker comment on a target PR:

```bash
AGENTPROOF_COMMENT_SMOKE_PR_URL=https://github.com/org/repo/pull/123 \
AGENTPROOF_COMMENT_SMOKE_GITHUB_TOKEN=<fine-grained comment write token> \
pnpm smoke:github-comment
```

The comment smoke first analyzes the PR, then posts through `/api/github/comment`. It prints only metadata such as action, URL, priority, and evidence coverage. It does not print the token or full report. For private PR analysis, set `AGENTPROOF_COMMENT_SMOKE_ANALYZE_TOKEN` separately.

Browser recent history, portable share links, Slack payloads, and saved reports are summary-only. They omit raw evidence, patch/log excerpts, claims, and raw re-prompt text. Retained summary fields are redacted before sharing or storage. Full Markdown export remains an explicit user action.

Saved reports use in-memory storage when durable env is absent. This is suitable for local demos, but may disappear on serverless deployments. Optional Supabase storage is durable for the same summary-only projection; it still does not store raw evidence, claims, raw re-prompt text, patch excerpts, raw logs, or raw report access keys. Tenant-scoped saved reports are not readable by id alone; they require trusted tenant context or the generated saved-link key. GitHub App webhook duplicate suppression also uses Supabase when configured and stores only hashed keys plus bounded metadata. See `docs/saved-report-storage.md`, `docs/github-app-webhook.md`, and `docs/github-app-onboarding.md` for schema and env setup.

## Check Evidence Taxonomy

AgentProof separates test/build execution proof from other GitHub checks:

- `Test/Build` status is backed only by check or log names/summaries that look like test, spec, unit, integration, e2e, coverage, CI, or build execution.
- Passing security reports, code-owner checks, dependency scans, deploy previews, and AI review checks do not prove tests or builds ran.
- Generic `CI` or `build` checks are not promoted when their summaries only mention preview, deployment, security, policy, or report gates.
- Failing non-test/build checks are still surfaced as high-priority static or merge-gate risks.
- Lint and typecheck remain separate status fields, even when they come from GitHub checks.
- Requirement `met` status still requires passing execution evidence linked through evidence IDs.
- GitHub Actions fallback collects bounded job/step metadata when available, keeps only execution-like steps such as test/build commands, and never fetches or stores raw log archives in this MVP.
- Failed execution checks may include bounded Check Run annotation locations such as `path:line`; full annotation messages, raw annotation details, and raw log archives are not fetched or stored.
- Failed check locations appear only in full reports, Markdown exports, and intentional PR comments; summary share links and saved reports remain summary-only.

## Product Position

It avoids:

- Generic style review comments
- Auto-merge decisions
- Security scanning claims without evidence
- Long-term raw source, log, or full-report retention

## Why Not An AI Code Reviewer?

Generic AI code reviewers usually start from the diff and produce review comments. AgentProof starts from the original issue, task, or prompt and asks whether the agent-authored PR has enough evidence to satisfy it.

AgentProof does not decide whether to merge. It gives a human reviewer a compact evidence report: requirement coverage, missing proof, scope creep, risky files, test/build signals, and the next prompt to send back to the coding agent.

## Architecture

- `src/lib/github.ts`: GitHub URL parsing and REST fetch boundary
- `src/lib/extractors.ts`: deterministic requirement, claim, and evidence extraction
- `src/lib/verifier.ts`: evidence scoring and report generation
- `src/lib/structured-output.ts`: JSON schema contract for future LLM calls
- `src/lib/report-validation.ts`: runtime report validation and evidence-ref integrity checks
- `src/lib/report-share.ts`: summary-only portable share links
- `src/lib/server-report-store.ts`: summary-only saved report store with in-memory and optional Supabase backends
- `src/lib/audit-log.ts`: bounded audit event writer and privacy scanner for SaaS automation metadata
- `src/lib/analysis-jobs.ts`: metadata-only async analysis job queue, tenant summaries, and aggregate queue metrics
- `src/lib/analysis-worker.ts`: operator-gated queued analysis execution with single-job and bounded-batch flows
- `src/lib/report-history.ts`: browser-local summary-only recent report history
- `src/lib/llm-package.ts`: normalized package for future LLM verifier calls
- `src/lib/openai-verifier.ts`: optional OpenAI Responses API structured-output adapter
- `src/lib/evaluation-pack.ts`: real-dataset evaluation harness for benchmark-grounded verifier checks
- `src/lib/github-app.ts`: GitHub App webhook signature, installation-token, opt-in, and idempotency helpers
- `src/lib/github-onboarding.ts`: invite-only GitHub App onboarding state, activation session, and repository metadata helpers
- `src/lib/tenant-dashboard-client.ts`: client-side tenant dashboard request builders that keep invite tokens out of URLs and PATCH bodies
- `src/lib/tenant-retention-policy.ts`: draft tenant data retention policy matrix and deletion-preview coverage helper
- `src/lib/tenant-deletion-state.ts`: metadata-only tenant deletion-state guard for enqueue, grant authorization, and grant mutation boundaries
- `src/lib/tenant-deletion-execution.ts`: internal metadata-only deletion execution planner, grant-block phase, and guarded analysis-job purge boundary
- `src/lib/usage-quota.ts`: tenant analysis quota reservation and read-only status helpers
- `src/lib/slack.ts`: summary-only Slack notification formatter
- `src/components/*`: reviewer-focused UI and invite-only tenant setup panel
- `src/app/api/analyze/route.ts`: analysis API endpoint
- `src/app/api/github/comment/route.ts`: one-time GitHub PR comment posting endpoint
- `src/app/tenant/page.tsx`: invite-only tenant setup dashboard for GitHub App activation, repo grants, and setup health
- `src/app/api/tenants/repositories/route.ts`: invite-only tenant repo verification settings endpoint
- `src/app/api/tenants/repositories/health/route.ts`: metadata-only tenant repository setup health endpoint
- `src/app/api/tenants/usage/route.ts`: tenant-bound usage summary endpoint
- `src/app/api/tenants/analysis-jobs/route.ts`: tenant-bound async analysis job summary endpoint
- `src/app/api/tenants/reports/route.ts`: tenant-bound recent summary report list endpoint
- `src/app/api/tenants/audit-activity/route.ts`: tenant-bound recent verification activity endpoint with flattened summary-only output
- `src/app/api/tenants/deletion-preview/route.ts`: tenant-bound count-only deletion dry-run endpoint
- `src/app/api/github/webhook/route.ts`: env-gated signed webhook intake endpoint
- `src/app/api/ops/analysis-jobs/preflight/route.ts`: operator-gated queued worker preflight endpoint
- `src/app/api/ops/analysis-jobs/run/route.ts`: operator-gated single queued job execution endpoint
- `src/app/api/ops/analysis-jobs/run-batch/route.ts`: operator-gated bounded queued job batch execution endpoint
- `src/app/api/ops/analysis-jobs/dead-letter/route.ts`: operator-gated read-only terminal failure summary endpoint
- `src/app/api/ops/analysis-jobs/alerts/slack/route.ts`: operator-gated summary-only Slack queue alert endpoint
- `src/app/api/ops/drill-gate/route.ts`: operator-gated metadata-only launch drill evidence gate
- `src/app/api/ops/tenants/deletion/route.ts`: operator-gated metadata-only tenant deletion plan and block-new-work phase; destructive purge is not exposed
- `src/app/api/cron/analysis-jobs/run/route.ts`: token-gated scheduled bounded queued job batch endpoint
- `src/app/api/notifications/slack/route.ts`: env-gated Slack notification endpoint
- `src/app/api/llm/verify/route.ts`: env-gated OpenAI verifier endpoint

The current verifier is deterministic so the MVP can be tested without an LLM key. Future LLM calls should preserve the same JSON shape, pass runtime validation, and only cite known evidence IDs.

## Review Handoff Prompt

Use this prompt when asking another model to review the repository:

```text
Review this repository as AgentProof, an evidence-based verifier for AI-generated PRs.
It should not act like a generic AI code reviewer. Focus on requirement-to-evidence mapping,
scope creep detection, missing-test detection, GitHub PR ingestion, token/privacy handling,
mobile report UX, and whether every finding is traceable to evidence.
Prioritize bugs, false positives, security issues, missing tests, and workflow gaps.
```

For a fuller review prompt and mobile/manual test checklist, use `docs/review-handoff.md`. For no-secret local demo checks, use `docs/local-demo-validation.md`. For example report artifacts, use `docs/example-reports.md`. For deployment smoke checks, use `docs/deployment-smoke.md`. For saved-report storage setup, use `docs/saved-report-storage.md`. For tenant data retention and deletion planning, use `docs/tenant-data-retention.md`. For GitHub App webhook automation boundaries, use `docs/github-app-webhook.md`; for invite-only GitHub App onboarding, use `docs/github-app-onboarding.md`; for the controlled live smoke procedure, use `docs/github-app-live-smoke-runbook.md`. For the internal market-validation summary behind this positioning, use `docs/market-validation.md`. For the final SaaS goal, tenant/billing/operations gates, and next implementation tickets, use `docs/final-goals-and-roadmap.md`.

## Evaluation Pack

AgentProof evaluation starts from real benchmark data instead of invented labels. The MVP harness uses SWE-bench Verified rows for issue text, visible patch/test evidence, schema validity, provenance coverage, future-label leakage checks, and false-verified detection. Benchmark outcome labels are used only after report generation.

```bash
pnpm eval:pack
pnpm eval:summary
pnpm eval:summary:strict
pnpm eval:summary:fixture
pnpm eval:summary:fixture:strict
```

Fetch a larger local sample when network is available:

```bash
pnpm eval:fetch:swebench -- --length 10   # quick local smoke
pnpm eval:fetch:swebench -- --length 100  # broader local check
pnpm eval:pack
pnpm eval:summary
pnpm eval:summary:strict
```

Promote selected generated cases into committed fixtures only after reviewing case IDs and source metadata:

```bash
pnpm eval:promote:fixture -- \
  --input eval/generated/swebench-verified.cases.jsonl \
  --output eval/fixtures/swebench-verified.example.jsonl \
  --case astropy__astropy-12907 \
  --source-offset 0 \
  --source-length 100
pnpm eval:summary:fixture:strict
```

Committed normalized SWE-bench fixtures live under `eval/fixtures/` with manifest hashes so CI can run without network: one small smoke case, a representative four-case pack, and a diverse ten-repository pack. Raw hidden oracle labels are not committed. Larger generated normalized cases live under `eval/generated/` and are ignored by git because they may contain short patch excerpts and separated oracle labels. See `docs/evaluation-pack.md` for source caveats and the learning loop.

## Deployed Demo

Current demo deployment:

`https://agentproof-pearl.vercel.app`
