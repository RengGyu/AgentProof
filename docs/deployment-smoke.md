# Deployment Smoke Checklist

This checklist separates the no-secret production boundary check from signed-in PR analysis and connected-repository automation. A no-secret request must not generate a live PR report.

Production alias:

https://agentproof-pearl.vercel.app

Last no-secret production gate: 2026-09-25 (local replay of the workflow step)

Last credentialed live integration pass: 2026-06-29

## No-Secret Production Checks

Run these after every production deployment:

```bash
curl -sS -o /tmp/agentproof-home.html -w "home:%{http_code}\n" https://agentproof-pearl.vercel.app/
curl -sS -o /tmp/agentproof-integrations.html -w "integrations:%{http_code}\n" https://agentproof-pearl.vercel.app/integrations
curl -sS -o /tmp/agentproof-webhook-status.json -w "github_webhook_status:%{http_code}\n" https://agentproof-pearl.vercel.app/api/github/webhook/status
curl -sS -o /tmp/agentproof-ops-status.json -w "github_app_ops_no_token:%{http_code}\n" https://agentproof-pearl.vercel.app/api/ops/github-app/status
curl -sS -o /tmp/agentproof-api-analyze.txt -w "api_analyze_get:%{http_code}\n" https://agentproof-pearl.vercel.app/api/analyze
curl -sS -o /tmp/agentproof-unauth-analyze.json -w "api_analyze_no_login:%{http_code}\n" -X POST -H 'Content-Type: application/json' --data '{"prUrl":"https://github.com/RengGyu/AgentProof/pull/1"}' https://agentproof-pearl.vercel.app/api/analyze
```

Expected:

- `/` returns 200.
- `/integrations` returns 200.
- `/api/github/webhook/status` returns 200 with coarse status only; it must not expose env-specific booleans, repository allowlists, private-key validity, secret names, or secret values.
- `/api/ops/github-app/status` returns 401 without `x-agentproof-ops-token` when operator diagnostics are configured; 501 means the diagnostics token is not configured for that deployment.
- `/api/analyze` rejects GET with 405.
- An unauthenticated PR URL POST returns 401 with `github_login_required`; it must not fetch GitHub evidence or call a paid model.
- If cron auth is intentionally not configured for the public demo, `/api/cron/analysis-jobs/run` and `/api/cron/reports/cleanup` return metadata-only disabled no-ops instead of running work. Invalid configured cron tokens still return 401.
- Signed-in PR analysis and connected-repository automatic analysis are separate live checks. Use an authorized browser session and a dedicated test PR event; do not weaken login or add a reusable session cookie to this no-secret workflow.
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

Expected workflow proof:

- `/` and `/integrations` return 200.
- `GET /api/analyze` returns 405.
- Unauthenticated `POST /api/analyze` returns 401 with `github_login_required`.
- `/api/github/webhook/status` returns the public `githubApp` status object only.
- Unauthenticated `/api/ops/github-app/status` returns 401 when diagnostics are configured or 501 when they are not configured.
- The run output contains bounded metadata only. It must not include GitHub tokens, private task text, raw diffs, raw logs, full reports, or saved-report contents.

After this no-secret gate, verify a signed-in PR once in the browser and trigger one new head on a connected test PR. Confirm the dashboard shows a current report for that exact head, with comments remaining off unless separately enabled. The old `smoke:production-regression` command makes anonymous PR requests and is not a production gate under the login-required policy.

## P0 Cron Decision

Automatic one-report-per-head analysis requires `202609250001_automatic_analysis_once_per_head.sql` and a durable analysis queue. On Vercel, each accepted queued PR or completed-check webhook schedules one post-response wake after the 45-second CI discovery window. The worker keeps a known pending check queued until it settles; a completed-check webhook wakes it again. A PR without CI analyzes on the initial wake. The daily worker cron (`0 5 * * *` in `vercel.json`) is recovery if an event wake fails or a check settles without a delivered webhook. That fallback may wait until the next daily run. Queue-disabled inline webhook analysis retains its earlier immediate behavior and does not provide this guarantee.

The GitHub session credential cleanup runs daily at `/api/cron/github-sessions/cleanup` after session expiry. It requires the same `CRON_SECRET` or `AGENTPROOF_CRON_TOKEN` as the existing crons. Verify the deployed cron reports `status: "ran"`; `status: "disabled"` means credentials are not being purged automatically.

The public demo keeps the Vercel cron entries in `vercel.json`, but cron work only runs when `CRON_SECRET` or `AGENTPROOF_CRON_TOKEN` is configured and the request presents that token by `Authorization: Bearer ...` or `x-agentproof-cron-token`. Query-string tokens are rejected.

For design-partner beta readiness, token-unconfigured cron requests are harmless metadata-only no-ops. This avoids noisy scheduled failures on the public demo while preserving fail-closed behavior for invalid tokens and unavailable queue/storage dependencies. The no-op response must not return repository names, tenant ids, report ids, raw reports, evidence, claims, diffs, logs, re-prompt text, table/env names, or secrets.

## Live Integration Checks

Before enabling durable GitHub App onboarding, apply the checked-in installation
ownership and claim migrations in order: `202607120001_github_installation_single_tenant.sql`, then
`202607120002_github_installation_claims.sql`. Confirm the claim, onboarding,
and installation stores use the same Supabase project. Do not run the live
approval smoke until those migrations and server-only claim credentials are in
the deployed environment.

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

Current launch-readiness evidence: `docs/ops-drill-evidence-2026-07-01.md`.

Validate a candidate evidence record before setting production env:

```bash
pnpm ops:drill-gate --evidence-file docs/ops-drill-evidence-2026-07-01.md
```

After production `AGENTPROOF_OPS_DRILL_EVIDENCE` is set and the deployment has
picked it up, verify the operator endpoint with a trusted shell that already has
`AGENTPROOF_OPS_TOKEN` set:

```bash
pnpm ops:drill-gate --require-production --require-ready
```

This command prints only summary status, category states, counts, and next
action. It fails closed when evidence is not ready, the operator token is
missing, the endpoint returns non-metadata fields, or the response echoes
secret-like/raw fields.

Most recent no-secret production gate:

- `/` returned 200.
- `/integrations` returned 200.
- `/api/analyze` rejected GET with 405.
- Production regression smoke passed for six public AgentProof PRs on 2026-07-03, with `qualityGateSummary.ok: true`, saved reports `privacy: "summary-only"`, `durability: "summary-only-supabase"`, zero saved evidence items, zero saved claims, omitted raw re-prompt text, cleared evidence refs, and no production token forwarding.
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

## 2026-09-22 public analysis candidate — launch blocked on policy

This checkpoint supersedes no historical live-pass claim above. It concerns the
existing public `/analyze` flow on Vercel project `agentproof`, production alias
`https://agentproof-pearl.vercel.app`, worktree branch
`codex/recover-bounded-target-20260913`, base `dea35fb`. No deployment was performed.

### Verified locally

- Restored only the duplicate-inspection source/test changes from `50041e6`.
  The first recommended artifact appears once in its goal; other revisions and
  ranges remain separate. Exact selected links survive both Markdown exports.
- Reviewer questions are collapsed, optional supporting text. Reasons, uncertainty,
  source links and exact-commit navigation remain visible.
- A valid interpretation with no goal shows collected changes neutrally; an
  interpretation failure says it is unavailable. Ranking failure preserves the
  existing source/collected-change route without a fabricated recommendation.
- Analysis handles non-JSON 429/503/504 responses with safe manual retry guidance,
  retains entered evidence, clears the optional token, and allows switching to
  pasted evidence. An old report is identified when the latest request fails.
  No automatic paid retry is added.
- Focused tests: 18 files / 277 passed, including API diagnostics authorization,
  GitHub permission/rate-limit fallbacks, OAuth start/callback boundaries, quota
  fail-closed behavior, privacy/share, storage-backed projection and exact links.
  `pnpm typecheck` and `pnpm build` passed (exit 0).
- Logs: `/tmp/public-readiness-focused.log`, `/tmp/public-readiness-typecheck.log`,
  `/tmp/public-readiness-build.log`. Full suite and browser/live login/provider
  smoke were not run. Mocked provider tests are not live provider evidence.

### Verified operational gap (read-only inspection)

`/api/analyze` currently authenticates only requests for operator diagnostics.
Ordinary requests can reach server-paid navigation/semantic providers without a
usage reservation. The 80,000-byte body cap bounds input, not request frequency or
spend. Existing `reserveUsageQuota` is tenant GitHub App analysis infrastructure;
its monthly reservation is not called by this public route. Its enforcement
variables were not present in the inspected production env-name listing.

Vercel `firewall status --json` on the linked project reported firewall disabled,
zero active/inactive custom rules, and bot protection disabled. This establishes
no project-level custom request limiter here; it does not assess every platform
DDoS mechanism or provider account spending setting. No external setting changed.

The production env-name listing confirms presence of `AI_GATEWAY_API_KEY`,
`AGENTPROOF_LLM_MODEL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AGENTPROOF_OPS_TOKEN`,
`AGENTPROOF_GITHUB_APP_CLIENT_ID`, `AGENTPROOF_GITHUB_APP_CLIENT_SECRET`,
`AGENTPROOF_GITHUB_APP_OAUTH_CALLBACK_URL`, `AGENTPROOF_PUBLIC_AUTH_SECRET`,
`AGENTPROOF_TENANT_SESSION_SECRET`, control-plane/report signing and storage
credentials. Values, valid credentials, current callback registration, durable
session migrations, and actual service operation were not verified. The repository's
`vercel.json` supplies `AGENTPROOF_GENERAL_PR_OBSERVATION_MODE=advisory`.
No Jev code, key, flag or model change is included.

### Required owner decision before public model-backed launch

Choose either anonymous public analysis with an approved distributed request/spend
budget, or public self-service GitHub login using the existing OAuth/session path
with an approved durable per-user/tenant quota. Neither option implies invite-only
beta. Specify allowed request burst/period and a total paid-usage ceiling, including
what users see when exhausted. Existing Vercel firewall and Supabase atomic quota
infrastructure can then be reused with the approved identity/budget policy.
An IP-only limiter is insufficient as the sole spend ceiling. Do not substitute a
client button lock, Origin header, arbitrary tenant header or process-local map
for server-enforced distributed authorization/quota. No policy numbers were invented.

### Verification and rollback ownership

The main task owns any subsequent deployment after the above decision and its
implementation. Before promotion, verify the approved gate rejects over-budget,
missing/invalid identity (if required), and unavailable quota-store requests before
GitHub/model work; verify distributed concurrent requests cannot bypass the ceiling.
Run one authorized public PR and login (if required) smoke on the candidate, checking
source, recommendation/failure state, exact SHA links, and text-free operator
traces. No July smoke result counts as this evidence.

Record the actual immutable candidate and previous production deployment URLs
before promotion. Roll back by restoring that recorded previous deployment in
Vercel; Git revert alone does not change production. For a cost incident, the
existing observation mode can disable paid analysis only through an explicitly
approved setting/deployment change; no such change has been made here. Keep
operator diagnostics behind `x-agentproof-ops-token`; never send that token to
ordinary users or share links.


### Same-day browser stability follow-up

The preceding 277-test result is retained, not rerun wholesale. Additional
changed-flow checks passed: 9 files / 76 tests, plus typecheck and production build (exit 0). The local HTTP probe
also passed: actual summary save, API reread and saved page returned 200 using
`short-lived-in-memory`, with zero evidence items and claims. A full untrusted
report import returned 422; existing summary sanitization is required, and no
validation was weakened. The browser UI's Recent list uses localStorage rather
than this server-store endpoint.

Reproduced/fixed: localStorage getter rejection crashed initial load; history
save failure was labeled as a network/analysis failure; history clear failure
escaped; share-copy failure was overwritten by success. Handler-level failure
injection demonstrated all four before fixes. Browser testing also showed local
summaries reopened in full-report mode; they now use summary mode and an explicit
notice. Input validation errors now ask for correction rather than waiting.
A new report mounts its own export/action state. Existing clipboard fallback is
reused instead of a second copy implementation.

Actual browser observations (local server, paid model and remote storage disabled):

- Desktop 1280px and mobile viewport 390×844: demo analysis, invalid/empty input,
  previous-report notice, cleared test credential, pasted-evidence recovery,
  successful result focus, local history reopen. Mobile page width was 390px
  with no horizontal overflow; captured error console entries were empty.
- One live GitHub read: `psf/requests#7589` produced collected changes and the
  source link. Its `_internal_utils.py#L44` link opened at commit
  `1e2517e537eb5483771aefc72ca1aeb1f6b99962`. This is collection/navigation
  evidence, not a paid-model recommendation or correctness evaluation.
- The existing helper's portable demo summary and a locally saved demo summary
  opened in the browser with imported/unverified and summary-only notices.
  Temporary probe/test-link files were removed afterward.
- Local GitHub sign-in displayed its unavailable message and reenabled the
  button. Actual OAuth completion and durable tenant report access remain
  untested; use an approved callback-compatible deployment and user login.
- The browser automation virtual clipboard returned no data even after the UI
  reported copying, so OS copy/paste success is not claimed. Copy failure behavior
  is covered by injected rejection tests; user verification remains necessary.

Local user test: open `http://127.0.0.1:3100/analyze`, choose Demo and Generate,
then open the generated entry under Recent. Try an invalid PR URL, use pasted
context, and generate again. Try Copy Share Link and open the pasted URL in a new
tab in your regular browser. Recent and portable shares intentionally omit raw
code and recommendations; keep the original page or explicitly download it.
No credential is needed for these checks. Physical-phone or remote-user testing
requires an authorized preview deployment; localhost is only on this machine.

The local server is started with these process-only overrides (no env file edits):

```sh
AGENTPROOF_GENERAL_PR_OBSERVATION_MODE=disabled OPENAI_API_KEY= GEMINI_API_KEY= AI_GATEWAY_API_KEY= AGENTPROOF_REPORTS_SUPABASE_URL= AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY= SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= pnpm exec next start --hostname 127.0.0.1 --port 3100
```

Logs: `/tmp/usability-focused-final.log`, `/tmp/usability-typecheck-final.log`,
`/tmp/usability-build-final.log`, `/tmp/usability-local-http.log`. No production
settings, permissions, subscription, commit, push or deployment changed. Public
access and spend policy remain the launch blocker described above.

### 2026-09-22 authentication candidate (local only)

Public PR requests with an enabled/configured paid provider now require the
existing durable GitHub self-service session and same-origin mutation proof
before GitHub collection. Missing/forged/expired/revoked/inactive sessions are
rejected, and store errors fail closed. Operator tokens and submitted tenant
identifiers cannot replace the session. This supersedes the earlier pending
login-policy decision; quota and total-cost limits are still not implemented.
Demos, pasted evidence, saved summaries and model-disabled/unconfigured
PR collection remain public. Mixed demo/PR input never attaches a paid provider.

The analysis sign-in button reuses the existing OAuth start/callback. Its sealed
state permits only /analyze or /dashboard; arbitrary destinations fall back to
/dashboard. Returning to analysis requires entering the PR again; raw input and
GitHub tokens are not saved across login. Callback origin restrictions remain.

Local verification: 167 tests passed, 6 skipped, one existing static-type display
assertion failed; the same failure reproduced with the pre-auth API route.
The 15 auth-boundary tests passed after the final stronger demo assertion.
Typecheck and production build passed. OAuth/store/provider responses in these
checks were fixtures. Actual browser OAuth and deployed session durability still
need a callback-compatible deployment and user login; no paid execution occurred.
Do not treat these local results as deployed auth or cost-limit verification.

### Monthly paid-analysis budget candidate (2026-09-22, not deployed)

The approved policy is a **30,000 KRW soft stop for new analyses** and a
**50,000 KRW hard pause**. The new ledger is an estimate derived from provider
usage, configured prices and FX; it is not an invoice or a provider account cap.
Its calculation includes known estimated charges plus pending/unknown per-call
reservations. Reservations can stop admission before known charges reach 30,000.
Existing admitted runs may reserve follow-up calls after the soft stop. A call
whose reservation would reach the hard boundary is refused. A settlement reaching
50,000 latches that month paused; new calls and retries then fail closed.

Install `supabase/migrations/202609220001_paid_analysis_budget.sql` through the
normal approved deployment process. It creates a service-role-only RPC and
metadata-only ledger using the existing control-plane Supabase connection. All
reservations and settlements share a PostgreSQL transaction advisory lock across
tenants and workers. Duplicate run owners/call IDs and closed-run replay are
rejected; there is no process-memory quota fallback. Settlement is exactly once.
Missing usage, errors, timeouts, cancellation, failed settlement and abandoned
processes retain reservations; there is no automatic zero-cost refund or expiry.
No prompt, raw response, GitHub token or API key is written to these tables.

**Required owner configuration — intentionally unset:** the singleton
`agentproof_paid_budget_settings.config` must contain:

- `timeZone`: approved IANA calendar zone. The DB uses its own clock to assign the
  month at call reservation; changing the zone after ledger use fails closed.
  A run crossing a month must pass admission again. Pending calls remain in the
  month in which they were reserved, including late settlement. This is a ledger
  convention, not a claim about invoice month boundaries.
- `krwPerUsd`: positive decimal string, at most three decimal places. No live FX
  lookup, tax, card surcharge or assumed exchange rate is included.
- `validUntil`: explicit ISO timestamp limiting the price/FX snapshot's validity.
- `prices`: keys such as `google/gemini-3.8-flash` and each enabled OpenAI model.
  Each entry requires positive decimal strings `inputUsdPerMillion` and
  `outputUsdPerMillion` (up to six decimals), `callReserveKrw` (up to three), and
  an HTTPS `source`. The call reservation is an owner-approved conservative
  estimate, not a proven upper bound on provider billing. Unlisted models fail
  closed. Prices and FX are pinned to the admitted run until their expiry.

Missing/expired settings or an unavailable durable store block paid generation.
The migration intentionally provides no FX, calendar, reserve amount or model
price default. Gemini model selection remains unchanged. The official Gemini
standard text prices checked on 2026-09-22 were USD 0.75 input and USD 3.75 output
per million tokens through 2026-12-31, with output including thinking; verify the
applicable tier/date before configuring.
[Google pricing](https://ai.google.dev/gemini-api/docs/pricing).

Gemini accounting uses `totalTokenCount - promptTokenCount` for combined output
and verifies candidate/thought consistency when present; it never adds thoughts
a second time. Missing/inconsistent usage retains the reservation. Cached input
is conservatively priced as full input. OpenAI output tokens already include
reasoning; nested reasoning counts are not added again.
[Gemini usage fields](https://ai.google.dev/api/generate-content#UsageMetadata).

**Cancellation boundary:** active synchronous calls check the durable pause every
second (each store request has a five-second timeout) and abort locally on a
pause/store failure. Calls have a 60-second local timeout; SDK-internal Gemini
retries are disabled so every application retry needs another reservation.
Detection/abort has polling and network latency; it is not instantaneous across
processes. Google explicitly documents AbortSignal as client-only: service work
and applicable charges can continue after local cancellation.
[Google SDK cancellation](https://googleapis.github.io/js-genai/release_docs/interfaces/types.GenerateContentConfig.html#abortSignal).
No exact 50,000 KRW external bill ceiling or reversal of an already-sent call is
promised. Calls made outside these server paths or through a shared provider key
are not observed by this ledger.

**Server paid-path inventory:**

- Public `/api/analyze`: existing session/CSRF first; one budget scope covers
  navigation and semantic follow-ups. The browser sends an analysis attempt key;
  replay of that key cannot create a second paid run. Missing keys use a hashed
  request identity. A fresh user click is a new analysis.
- GitHub webhook: budget scope keyed by delivery identity after the existing
  signature/tenant gates; synchronous provider calls share the global ledger.
- Analysis worker: scope keyed by durable job ID. A process retry cannot reclaim
  an already-admitted paid run with a different owner.
- `/api/llm/verify`: existing operator authentication followed by the budget scope.
- All OpenAI semantic/navigation/verifier/proof-planner POST transports and the
  Gemini adapter enforce the boundary, including direct calls without a scope.
- **Legacy OpenAI background POSTs are blocked.** Existing background GETs remain
  retrieval-only. Durable background submission/cancellation/settlement is not
  integrated with this new ledger; any already-running provider jobs must be
  inspected/drained separately before rollout. OpenAI background cancellation is
  a distinct API operation; none was issued during this local task.
  [OpenAI background mode](https://developers.openai.com/api/docs/guides/background).

Demos, pasted deterministic evidence, saved report retrieval and summaries do not
reserve paid budget. No report is deleted and no existing read path is gated.
Migration installation, owner configuration, multi-process deployed DB contention,
real OAuth/store integration and provider billing reconciliation remain rollout
checks; no production setting, deployment or paid request was made here.

Local verification for this candidate: the final 154-test run includes 22 budget
runtime checks, eight PostgreSQL SQL-engine checks, three actual public-route
budget checks, and 121 worker/webhook regressions. Prices/FX used in tests are
synthetic fixtures, not configured production policy. PGlite was installed only
in `/private/tmp/agentproof-budget-pg`; rerun SQL tests with
`AGENTPROOF_TEST_PGLITE_MODULE` pointing to its `dist/index.js` and
`pnpm exec vitest run src/lib/paid-budget-sql.test.ts --maxWorkers=1`.
The embedded engine serializes queued calls; real multi-process contention remains
an external deployment check. Costs round upward per call to 0.001 KRW.
The one full-suite run exposed two remaining unrelated fixture/presentation
failures; details and exact results are in docs/work-log.md. Final typecheck,
production build and diff-check passed; no deployment or paid call occurred.

### 2026-09-23 operating preparation — external application blocked

**Verified target:** Vercel project `agentproof`
(`prj_76UNYkQGUBTc15kiYnOTCSYvRcIF`, team
`team_RgOQUIJZTU9MufwDOGzuJYA6`). Current production is READY at
`agentproof-qdtr1jbej-renggyus-projects.vercel.app`, deployment
`dpl_63DfGkRo8C7PcQ1okrD56mPpB7Mj`. The production environment's readable
control-plane URL identifies Supabase project `plfqpwuujbrqosijsvhg`.

The Vercel API returned empty values for sensitive variables even on its env-pull
endpoint. These are **not evidence that the running values are empty**. Runtime
model overrides, callback URL and service-role key could not be recovered; no
empty value was written back. Preview names exist, but its resolved store/secret
values remain unverified. No Vercel environment was changed and no deployment was
created/promoted. The retrievable production `vercel.json` selects advisory mode
and the existing two crons; source file retrieval did not expose the deployed
Gemini adapter, so it did not establish the exact production transport/model.

Local candidate transport is Google `@google/genai` directly, including when the
key is held in the legacy `AI_GATEWAY_API_KEY` variable; it is not a Vercel Gateway
request. The proposed Google standard rates remain $0.75 input / $3.75 output per
million tokens through 2026-12-31, as rechecked on the official pricing page.
[Google standard pricing](https://ai.google.dev/gemini-api/docs/pricing).
The open Google AI Studio spend page showed a selected project named “Gemini API”,
Tier 1, a 5,000 KRW provider cap and 1,121 KRW monthly displayed spend; its Gemini
3.8 Flash filter showed 971.30 KRW for August 27–September 23. The UI states up to
10 minutes of cap overshoot and a Pacific-time reset. These are observations of
that selected project, **not proof it owns the production key**. No provider cap,
billing tier or payment setting was modified; the model filter was restored.
If it is the production project, its 5,000 KRW cap can stop requests before the
app's 30,000/50,000 KRW policy. Confirm that mapping before considering any change.

**Prepared, unapplied draft** (nulls deliberately fail configuration validation):

```json
{
  "timeZone": "Asia/Seoul",
  "krwPerUsd": null,
  "validUntil": "2026-09-30T15:00:00Z",
  "prices": {
    "google/gemini-3.8-flash": {
      "inputUsdPerMillion": "0.75",
      "outputUsdPerMillion": "3.75",
      "callReserveKrw": null,
      "source": "https://ai.google.dev/gemini-api/docs/pricing"
    }
  }
}
```

Asia/Seoul is now owner-approved. The draft expiry is the next Seoul month
boundary, proposed for a monthly FX review. Minimum remaining monetary decisions:
use a confirmed Google billing/monthly conversion rate for `krwPerUsd`, and an
approved conservative amount per provider call for `callReserveKrw`. For this
standard text path the estimate is
`FX × (inputTokens × 0.75 + combinedOutputTokens × 3.75) / 1,000,000` KRW.
The existing 6,000 output-token setting alone does not bound input or unobserved
billing, so it does not justify inventing a numeric reserve. No OpenAI prices
were guessed; unlisted paid models remain blocked by the candidate ledger.

**Exact access step:** sign in to the existing
[Supabase SQL Editor](https://supabase.com/dashboard/project/plfqpwuujbrqosijsvhg/sql/new).
The browser redirected to sign-in; the CLI also has no management access token or
DB password. No remote SQL or migration was run. After sign-in, first inspect
`to_regclass('public.agentproof_paid_budget_settings')` and
`to_regprocedure('public.agentproof_paid_budget(text,text,uuid,uuid,bigint,bigint,jsonb)')`.
If objects already exist, inspect definitions and save existing `config, paused`
before replacing anything. Otherwise run only the named budget migration inside
`BEGIN`/`COMMIT`; do not push all historical migrations. Apply a complete approved
config only after confirming its target and the production key's provider/model.

**Rollback:** no external state changed in this preparation, so none needs
restoring. For a subsequent candidate rollout, retain the current immutable
production deployment above as the rollback target and preserve the budget
ledger tables; do not drop tables or delete reports. Before any future env write,
retain the actual previous value through authorized secret storage—not the blank
API representation. Restore prior `config, paused` if a later config update
must be undone. New code must not be promoted while its required config/store
access is unverified; the currently running deployment remains untouched.
