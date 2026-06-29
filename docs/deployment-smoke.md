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
curl -sS -o /tmp/agentproof-api-analyze.txt -w "api_analyze_get:%{http_code}\n" https://agentproof-pearl.vercel.app/api/analyze
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app CI=true corepack pnpm smoke:production-regression
```

Expected:

- `/` returns 200.
- `/integrations` returns 200.
- `/api/github/webhook/status` returns 200 with coarse status only; it must not expose env-specific booleans, repository allowlists, private-key validity, secret names, or secret values.
- `/api/analyze` rejects GET with 405.
- Production regression smoke passes for the public AgentProof PR set.
- Saved reports return `privacy: "summary-only"` and `durability: "summary-only-supabase"` when Supabase env is configured.
- Saved reports retain zero evidence items, zero claims, no raw re-prompt text, and cleared evidence references.

## Live Integration Checks

These checks use server-side env and caller tokens. They should never print secret values.

| Integration | Command or request | Expected proof | Side effect |
| --- | --- | --- | --- |
| Supabase saved reports | POST demo report to `/api/reports`, GET `/api/reports/{id}`, DELETE `/api/reports/{id}` | 200 for save/get/delete, `summary-only-supabase`, zero evidence items and claims | Creates then deletes one summary-only row |
| OpenAI verifier | `AGENTPROOF_LLM_TOKEN=<caller token> AGENTPROOF_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:openai` | `Source: openai`, priority metadata only | Calls OpenAI Responses with `store: false` |
| GitHub webhook | `AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> pnpm smoke:github-webhook` | Coarse status, invalid signature rejected, signed `ping` accepted, signed `pull_request` `closed` does not plan analysis/comments | No GitHub write; uses a PR action that must be ignored |
| Controlled GitHub App live automation | Follow `docs/github-app-live-smoke-runbook.md`, then run `AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION=1 AGENTPROOF_WEBHOOK_LIVE_PR_URL=https://github.com/owner/repo/pull/123 AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID=<id> pnpm smoke:github-webhook-live` | Public status is `event-mode`, `dryRun: false`, `willAnalyze: true`, `willComment: false`, `analysis.status: "completed"` | Analysis-only on a maintainer-owned test PR; comments and saved reports are suppressed by default |
| Slack notification | POST a demo report to `/api/notifications/slack` with `x-agentproof-notify-token` | `{ "sent": true }` | Sends one summary-only Slack message |
| Explicit token PR comment endpoint | `pnpm smoke:github-comment` with an intentional target PR and write token | `action: "created"` or `"updated"`, comment URL, priority metadata only | Creates or updates one AgentProof marker comment |

Most recent live pass:

- Supabase saved report round trip: passed, `summary-only-supabase`.
- OpenAI verifier smoke: passed, `source: openai`.
- GitHub signed webhook ping: passed, dry-run default verified.
- Controlled GitHub App live automation smoke: not yet run after the safety wrapper was added.
- Slack notification smoke: passed, sent one summary-only message.
- GitHub PR comment smoke: passed on PR #18, created an AgentProof marker comment.

Most recent no-secret production gate:

- `/` returned 200.
- `/integrations` returned 200.
- `/api/analyze` rejected GET with 405.
- Production regression smoke passed for six public AgentProof PRs.
- `/api/llm/verify`, `/api/notifications/slack`, and `/api/github/webhook` returned 401 without trusted caller credentials or signatures.

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
- Missing Supabase env falls back to `short-lived-in-memory` with a warning.
- Misconfigured Supabase env returns 503 instead of silently using unsafe storage.

## Non-Goals

- GitHub App PR analysis is opt-in by env and repository allowlist.
- GitHub App comments are a separate opt-in and update one marker comment only.
- No auto-merge or merge-blocking decision.
- No durable raw diff, raw log, raw annotation detail, token, claim, or raw re-prompt storage.
