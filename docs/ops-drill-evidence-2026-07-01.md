# Ops Drill Evidence - 2026-07-01

Status: ready launch-readiness evidence

This record is summary-only. It must not contain tokens, raw webhook bodies,
repository allowlists, private keys, raw logs, raw diffs, report bodies,
saved-report keys, provider ids, table names, env values, backup contents, or
screenshots.

## Production Smoke

Status: passed

Completed at: 2026-07-01T13:37:08Z

Evidence checked:

- `https://agentproof-pearl.vercel.app/` returned 200.
- `https://agentproof-pearl.vercel.app/integrations` returned 200.
- `https://agentproof-pearl.vercel.app/api/github/webhook/status` returned 200
  with only the public `githubApp` status object.
- `https://agentproof-pearl.vercel.app/api/ops/github-app/status` returned 401
  without an operator token.
- `https://agentproof-pearl.vercel.app/api/ops/drill-gate` returned 401 without
  an operator token.
- `https://agentproof-pearl.vercel.app/api/analyze` rejected GET with 405.
- `AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app CI=true
  corepack pnpm smoke:production-regression` passed for 6 public PR cases with
  `qualityGateSummary.ok: true`.
- The production regression smoke reported summary-only saved reports,
  `summary-only-supabase` durability, zero saved evidence items, zero saved
  claims, omitted raw re-prompt text, cleared evidence references, deleted smoke
  saved reports, and no forwarded production token.

Bounded evidence ref candidate:

```text
docs/ops-drill-evidence-2026-07-01.md#production-smoke
```

## Incident Runbook Review

Status: passed for documented launch review boundary

Completed at: 2026-07-01T13:37:08Z

Evidence checked:

- `docs/github-app-webhook.md` documents signed intake, live automation smoke,
  queue readiness, worker endpoints, dead-letter summary, Slack queue alerts,
  and bounded incident next-action codes.
- `docs/deployment-smoke.md` documents no-secret production checks, manual
  GitHub Actions production smoke expectations, live integration checks, and the
  ops drill evidence gate.
- `src/lib/ops-runbook-boundary.test.ts` asserts dead-letter next actions are
  documented and that ops drill/runbook artifacts forbid raw evidence, secrets,
  provider internals, table/env names, and backup contents.

Limit:

- This review did not simulate a live incident or send Slack incident alerts.
  It only verifies that the launch review runbook boundary is documented and
  regression-tested.

Bounded evidence ref candidate:

```text
docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review
```

## Deletion Drill

Status: passed

Completed at: 2026-07-01T16:50:35Z

Evidence checked:

- Production `GET /api/ops/drill-gate` reported `deletion_drill` as `passed`.
- The evidence reference was `manual-record:deletion-summary-only-2026-07-02`.
- The drill-gate output remained `ops-drill-gate-summary-only` and did not
  include raw logs, tokens, provider ids, table names, env values, repository
  payloads, report bodies, saved-report keys, backup contents, or screenshots.

Bounded evidence ref:

```text
manual-record:deletion-summary-only-2026-07-02
```

## Restore Drill

Status: passed

Completed at: 2026-07-01T16:50:35Z

Evidence checked:

- Production `GET /api/ops/drill-gate` reported `restore_drill` as `passed`.
- The evidence reference was `manual-record:restore-summary-only-2026-07-02`.
- The drill-gate output remained `ops-drill-gate-summary-only` and did not
  include raw logs, tokens, provider ids, table names, env values, repository
  payloads, report bodies, saved-report keys, backup contents, or screenshots.

Bounded evidence ref:

```text
manual-record:restore-summary-only-2026-07-02
```

## Production Gate Verification

Status: ready

Completed at: 2026-07-01T16:50:35Z

Evidence checked:

- `pnpm ops:drill-gate --require-production --require-ready` completed
  successfully from a trusted shell.
- Production `GET /api/ops/drill-gate` returned
  `privacy: "ops-drill-gate-summary-only"`.
- Required categories: 4.
- Passed categories: 4.
- Blocked categories: 0.
- Missing, stale, failed, and unclear categories: 0.
- Next action: `ready_for_launch_review`.
- Category statuses:
  - `deletion_drill`: `passed`,
    `manual-record:deletion-summary-only-2026-07-02`
  - `restore_drill`: `passed`,
    `manual-record:restore-summary-only-2026-07-02`
  - `incident_runbook_review`: `passed`,
    `docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review`
  - `production_smoke`: `passed`,
    `docs/ops-drill-evidence-2026-07-01.md#production-smoke`

## Env Value Summary

Production is configured with a launch-ready bounded evidence record:

```json
[
  {
    "key": "deletion_drill",
    "status": "passed",
    "completedAt": "2026-07-01T16:50:35Z",
    "evidenceRef": "manual-record:deletion-summary-only-2026-07-02"
  },
  {
    "key": "restore_drill",
    "status": "passed",
    "completedAt": "2026-07-01T16:50:35Z",
    "evidenceRef": "manual-record:restore-summary-only-2026-07-02"
  },
  {
    "key": "incident_runbook_review",
    "status": "passed",
    "completedAt": "2026-07-01T13:37:08Z",
    "evidenceRef": "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"
  },
  {
    "key": "production_smoke",
    "status": "passed",
    "completedAt": "2026-07-01T13:37:08Z",
    "evidenceRef": "docs/ops-drill-evidence-2026-07-01.md#production-smoke"
  }
]
```
