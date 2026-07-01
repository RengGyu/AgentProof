# Deployment Smoke Checklist

This checklist is the MVP deployment gate for AgentProof. It proves the deployed app can run the no-secret demo path, preserve summary-only saved reports, and keep optional integrations behind explicit trust boundaries.

Production alias:

https://agentproof-pearl.vercel.app

Last no-secret production gate: 2026-06-29

Last credentialed live integration pass: 2026-06-29

## No-Secret Production Checks

Run these after every production deployment:

```bash
curl -sS -o /tmp/agentproof-home.html -w "home:%{http_code}\n" https://agentproof-pearl.vercel.app/
curl -sS -o /tmp/agentproof-integrations.html -w "integrations:%{http_code}\n" https://agentproof-pearl.vercel.app/integrations
curl -sS -o /tmp/agentproof-webhook-status.json -w "github_webhook_status:%{http_code}\n" https://agentproof-pearl.vercel.app/api/github/webhook/status
curl -sS -o /tmp/agentproof-ops-status.json -w "github_app_ops_no_token:%{http_code}\n" https://agentproof-pearl.vercel.app/api/ops/github-app/status
curl -sS -o /tmp/agentproof-api-analyze.txt -w "api_analyze_get:%{http_code}\n" https://agentproof-pearl.vercel.app/api/analyze
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app CI=true corepack pnpm smoke:production-regression
```

Expected:

- `/` returns 200.
- `/integrations` returns 200.
- `/api/github/webhook/status` returns 200 with coarse status only; it must not expose env-specific booleans, repository allowlists, private-key validity, secret names, or secret values.
- `/api/ops/github-app/status` returns 401 without `x-agentproof-ops-token` when operator diagnostics are configured; 501 means the diagnostics token is not configured for that deployment.
- `/api/analyze` rejects GET with 405.
- Production regression smoke passes for the public AgentProof PR set.
- Saved reports return `privacy: "summary-only"` and `durability: "summary-only-supabase"` when Supabase env is configured.
- Saved reports retain zero evidence items, zero claims, no raw re-prompt text, and cleared evidence references.
- Tenant-scoped saved reports require the generated report key or trusted tenant context; id-only lookup returns the same unavailable response as missing or expired reports.
- Quota-blocked tenant webhook analysis returns bounded metadata only and stops before idempotency, GitHub token fetch, PR evidence fetch, saved reports, or comments.
- Audit events, when configured, contain only bounded tenant/repo/action/result/request/status metadata and pass privacy scanner tests for raw payloads, diffs, logs, reports, claims, re-prompt text, comment bodies, tokens, and saved-link keys.

## Manual GitHub Actions Gate

Use the `AgentProof Production Smoke` workflow in GitHub Actions after a production deployment or when GitHub evidence collection changes. The workflow is `workflow_dispatch` only: it does not run on every push, and it does not require any repository secret.

Default inputs:

| Input | Default | Meaning |
| --- | --- | --- |
| `base_url` | `https://agentproof-pearl.vercel.app` | Deployment URL to test. Do not include tokens, usernames, passwords, or secret query strings. |
| `enforce_performance_budget` | `true` | Whether to fail the run when configured p95 budgets are exceeded. |
| `max_total_p95_ms` | `3000` | Maximum `X-AgentProof-Timing.total` p95. |
| `max_evidence_p95_ms` | `2500` | Maximum `X-AgentProof-Timing.evidence` p95. |
| `max_github_checks_p95_ms` | `1500` | Maximum `X-AgentProof-Evidence-Timing.github_checks` p95. |
| `max_github_statuses_p95_ms` | `1500` | Maximum `X-AgentProof-Evidence-Timing.github_statuses` p95. |
| `max_github_jobs_p95_ms` | `1500` | Maximum `X-AgentProof-Evidence-Timing.github_jobs` p95. |

The budgets are loose operational guardrails. They are meant to catch repeated regressions, not to prove a public latency SLA. If one run fails during an external GitHub or Vercel slowdown, rerun once before changing code. If the same phase fails repeatedly, investigate the named timing phase before lowering evidence collection quality.

Expected workflow proof:

- `/` and `/integrations` return 200.
- `GET /api/analyze` returns 405.
- `/api/github/webhook/status` returns the public `githubApp` status object only.
- Unauthenticated `/api/ops/github-app/status` returns 401 when diagnostics are configured or 501 when they are not configured.
- `pnpm smoke:production-regression` passes for the public AgentProof PR set.
- The smoke output includes `qualityGateSummary.ok: true` for deterministic report trust checks; this is a guardrail, not a verifier quality score.
- When budgets are enforced, the smoke output includes `performanceBudget.ok: true`.
- The run output contains bounded metadata only. It must not include GitHub tokens, private task text, raw diffs, raw logs, full reports, or saved-report contents.

## Live Integration Checks

These checks use server-side env and caller tokens. They should never print secret values.

| Integration | Command or request | Expected proof | Side effect |
| --- | --- | --- | --- |
| Supabase saved reports | POST demo report to `/api/reports`, GET `/api/reports/{id}`, DELETE `/api/reports/{id}` | 200 for save/get/delete, `summary-only-supabase`, zero evidence items and claims | Creates then deletes one public demo summary-only row |
| OpenAI verifier | `AGENTPROOF_LLM_TOKEN=<caller token> AGENTPROOF_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:openai` | `Source: openai`, priority metadata only | Calls OpenAI Responses with `store: false` |
| GitHub webhook | `AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> pnpm smoke:github-webhook` | Coarse status, invalid signature rejected, signed `ping` accepted, signed `pull_request` `closed` does not plan analysis/comments | No GitHub write; uses a PR action that must be ignored |
| Controlled GitHub App live automation | Follow `docs/github-app-live-smoke-runbook.md`, then run `AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION=1 AGENTPROOF_WEBHOOK_LIVE_PR_URL=https://github.com/owner/repo/pull/123 AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID=<id> pnpm smoke:github-webhook-live` | Public status is `event-mode`, `dryRun: false`, `willAnalyze: true`, `willComment: false`, `analysis.status: "completed"` | Analysis-only on a maintainer-owned test PR; comments and saved reports are suppressed by default |
| GitHub App operator diagnostics | GET `/api/ops/github-app/status` and `/api/ops/analysis-jobs/dead-letter` with `x-agentproof-ops-token` | Bounded readiness enums, aggregate queue alerts, and dead-letter `opsStatus` with code/count/threshold/next-action tuples only | No GitHub write; no env values, repository names, table names, tokens, payloads, diffs, raw errors, or logs |
| Manual Slack notification | With tenant control disabled and `AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED=true`, POST a demo report to `/api/notifications/slack` with `x-agentproof-notify-token` | `{ "sent": true }` | Sends one summary-only local/operator smoke message; not a SaaS tenant automation path |
| Explicit token PR comment endpoint | `pnpm smoke:github-comment` with an intentional target PR and write token | `action: "created"` or `"updated"`, comment URL, priority metadata only | Creates or updates one AgentProof marker comment |

Most recent live pass:

- Supabase saved report round trip: passed, `summary-only-supabase`.
- OpenAI verifier smoke: passed, `source: openai`.
- GitHub signed webhook ping: passed, dry-run default verified.
- Controlled GitHub App live automation persistence check: Supabase safe query observed one completed `pull_request` / `synchronize` analysis row for `RengGyu/AgentProof#27` at head SHA prefix `3e3703f63a07`, with `priority: medium`, `evidence_coverage: 18`, `has_saved_report: false`, `has_comment: false`, and `error_code: null`; privacy query checked 1 row and found 0 suspicious rows.
- Manual Slack notification smoke: passed, sent one summary-only message with the local/operator smoke gate enabled.
- GitHub PR comment smoke: passed on PR #18, created an AgentProof marker comment.

## Ops Drill Gate Evidence

Before public launch review, the operator-only `GET /api/ops/drill-gate` endpoint should report `status: "ready"` from fresh bounded evidence for:

- `deletion_drill`
- `restore_drill`
- `incident_runbook_review`
- `production_smoke`

The evidence source is `AGENTPROOF_OPS_DRILL_EVIDENCE`, a JSON array of records:

```json
[
  {
    "key": "deletion_drill",
    "status": "passed",
    "completedAt": "2026-07-01T00:00:00Z",
    "evidenceRef": "docs/tenant-data-retention.md#before-destructive-deletion"
  }
]
```

Allowed `evidenceRef` values are bounded references only: `docs/...#anchor`, `github-actions:<run_id>`, `vercel-deploy:<deployment_id>`, or `manual-record:<id>`. Do not put raw logs, webhook payloads, tokens, repository names, PR numbers, installation objects, full reports, report keys, diffs, claims, raw re-prompt text, provider ids, table names, env names, backup contents, or screenshots into this env value or endpoint output.

The drill gate is an evidence gate only. It does not execute deletion, restore, incident response, or smoke workflows. If evidence is missing, stale, failed, unclear, or malformed, launch review stays blocked.

Current partial launch-readiness evidence: `docs/ops-drill-evidence-2026-07-01.md`.

Most recent no-secret production gate:

- `/` returned 200.
- `/integrations` returned 200.
- `/api/analyze` rejected GET with 405.
- Production regression smoke passed for six public AgentProof PRs.
- `/api/llm/verify`, `/api/notifications/slack`, `/api/github/webhook`, and `/api/ops/github-app/status` returned 401 without trusted caller credentials, signatures, or the operator diagnostics token.

## Manual Demo Checks

- Open the deployed app on desktop and mobile.
- Run the five demo scenarios: Clean PR, Scope creep, Missing tests, Failed CI, Vague task.
- Confirm the priority, evidence coverage, missing-test count, scope signal, and re-prompt change between scenarios.
- Copy a share link and confirm the shared page omits raw evidence, claims, evidence references, patch/log excerpts, and raw re-prompt text.
- Use the Markdown export only as an explicit full-report action.
- Confirm GitHub PR comments are explicit user actions and marker-based.

## Fail-Closed Expectations

- Missing or invalid OpenAI caller token returns 401 or deterministic fallback metadata.
- Missing or invalid Slack caller token returns 401.
- Missing or invalid GitHub webhook signature returns 401.
- Missing operator diagnostics token returns 401 when `AGENTPROOF_OPS_TOKEN` is configured.
- Missing saved-report Supabase env falls back to `short-lived-in-memory` with a warning.
- Missing usage-quota Supabase RPC env fails closed when quota enforcement is enabled.
- Audit privacy scanner failures block the audit write before durable storage.
- Misconfigured Supabase env returns 503 instead of silently using unsafe storage.
- Dead-letter incident readiness is aggregate-only: one terminal failure means review top error codes, five sampled terminal failures or one terminal failure older than 3600 seconds means treat as an operator incident, and truncated samples require a broader store check.

## Non-Goals

- GitHub App PR analysis is opt-in by env and repository allowlist.
- GitHub App comments are a separate opt-in and update one marker comment only.
- No auto-merge or merge-blocking decision.
- No durable raw diff, raw log, raw annotation detail, token, claim, or raw re-prompt storage.
