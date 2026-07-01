# Ops Drill Evidence - 2026-07-01

Status: partial launch-readiness evidence

This record is summary-only. It must not contain tokens, webhook payloads,
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

Status: blocked

Reason:

- Production operator credentials are not available in this session.
- Production Vercel env write access is not available in this session.
- A real deletion drill must not be marked passed until an operator verifies the
  guarded tenant deletion workflow against a designated test tenant and confirms
  no saved-report, comment, Slack, or worker side effect can occur after deletion
  starts.

Required bounded proof before setting `deletion_drill` to `passed`:

- operator-only deletion plan checked for the designated test tenant;
- `block_new_work` executed or verified active for that test tenant;
- repository grants disabled or verified blocked for that test tenant;
- saved-report purge and analysis-job purge guards exercised without returning
  raw reports, job ids, repository names, table names, diffs, logs, tokens, or
  saved-report keys;
- manual-review categories remain manual-review and are not reported as complete.

## Restore Drill

Status: blocked

Reason:

- Production backup/restore operator access is not available in this session.
- The current product boundary allows only summary-only restore proof; raw
  evidence restore must remain prohibited.

Required bounded proof before setting `restore_drill` to `passed`:

- a summary-only saved report or metadata backup restore path is exercised;
- restored data is verified to omit raw evidence, claims, raw re-prompt text,
  diffs, logs, tokens, saved-report keys, provider ids, table names, and backup
  internals;
- the result is recorded as a bounded manual record or docs anchor only.

## Env Value Draft

Do not apply this draft as a launch-ready value yet. It intentionally keeps the
unperformed drills blocked:

```json
[
  {
    "key": "production_smoke",
    "status": "passed",
    "completedAt": "2026-07-01T13:37:08Z",
    "evidenceRef": "docs/ops-drill-evidence-2026-07-01.md#production-smoke"
  },
  {
    "key": "incident_runbook_review",
    "status": "passed",
    "completedAt": "2026-07-01T13:37:08Z",
    "evidenceRef": "docs/ops-drill-evidence-2026-07-01.md#incident-runbook-review"
  },
  {
    "key": "deletion_drill",
    "status": "unclear",
    "completedAt": "2026-07-01T13:37:08Z",
    "evidenceRef": "docs/ops-drill-evidence-2026-07-01.md#deletion-drill"
  },
  {
    "key": "restore_drill",
    "status": "unclear",
    "completedAt": "2026-07-01T13:37:08Z",
    "evidenceRef": "docs/ops-drill-evidence-2026-07-01.md#restore-drill"
  }
]
```

