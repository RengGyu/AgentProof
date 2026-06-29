# GitHub App Webhook Automation

AgentProof's GitHub App webhook endpoint is a signed intake boundary for evidence reports, not an automated reviewer or merge gate. Default behavior remains dry-run unless automation is explicitly enabled for allowed repositories.

Endpoint:

```text
POST /api/github/webhook
```

Public coarse status endpoint:

```text
GET /api/github/webhook/status
```

The status endpoint is for UI and smoke probes only. It returns a coarse mode, label, capabilities, and cautions. It must not expose per-env booleans, repository allowlists, private-key validity, secret names, or secret values.

## Current Behavior

- Fails closed when `GITHUB_WEBHOOK_SECRET` is missing.
- Verifies `X-Hub-Signature-256` against the raw request body before trusting event data.
- Rejects oversized `Content-Length` before reading the body when the header is present.
- Accepts bounded metadata for `pull_request`, `check_run`, `check_suite`, `status`, and `ping`.
- Ignores unsupported signed events without taking action.
- Rejects malformed JSON for supported events.
- Keeps dry-run behavior unless `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true`.
- For enabled `pull_request` events, handles only `opened`, `reopened`, `synchronize`, and `ready_for_review`.
- Requires `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS` before analyzing a PR.
- Uses a GitHub App installation token to refetch PR evidence from GitHub; it does not trust PR title/body/diff fields from the webhook payload.
- Creates summary-only saved report links only when `AGENTPROOF_GITHUB_APP_SAVE_REPORTS=true`.
- Posts or updates one GitHub App marker comment only when `AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=true`.
- Uses short-lived in-memory idempotency for duplicate PR head/action deliveries in this v1 implementation.
- Does not return raw payloads, patch text, logs, installation objects, tokens, titles, or arbitrary payload fields.
- Redacts secret-looking values from returned metadata fields.

The route reads the request body in memory to verify GitHub's HMAC signature. It does not persist that body, and oversized requests are rejected by `Content-Length` when available plus a post-read byte cap. Deployment platform body-size limits should remain enabled.

## Smoke Test

Use the webhook smoke when validating production without creating comments or triggering live PR analysis:

```bash
AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> \
pnpm smoke:github-webhook
```

The smoke checks:

- public coarse status from `/api/github/webhook/status`;
- invalid-signature rejection;
- signed `ping` acceptance;
- signed `pull_request` with action `closed`, which must report `willAnalyze: false` and `willComment: false`;
- no echo of secret-like probe values sent in the smoke payload.

## Controlled Live Automation Smoke

Use this only for a maintainer-owned test PR in a single allowlisted repository. This is not the dry-run webhook smoke above: it exercises GitHub App installation-token PR analysis. The smoke payload suppresses automatic comments by default and suppresses saved-report creation unless explicitly allowed. Follow `docs/github-app-live-smoke-runbook.md` before running it against production.

Preflight:

- Set `AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true`.
- Set `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS=owner/repo` for one test repository; do not use `*` outside controlled testing.
- Leave `AGENTPROOF_GITHUB_APP_COMMENT_ENABLED` unset or `false`. The live smoke also sends a signed smoke-only `suppressComment` control so comments stay off even if the deployment flag is accidentally enabled.
- Leave `AGENTPROOF_GITHUB_APP_SAVE_REPORTS` unset or `false` unless validating summary-only saved report links. The live smoke sends `suppressSavedReport` by default; set `AGENTPROOF_WEBHOOK_LIVE_ALLOW_SAVE_REPORTS=1` only when validating saved-link metadata.
- Confirm `/api/github/webhook/status` returns public mode `event-mode`. The smoke refuses to send a PR webhook when public status is `manual` or `signed-intake`.

Command:

```bash
AGENTPROOF_ALLOW_LIVE_WEBHOOK_AUTOMATION=1 \
AGENTPROOF_WEBHOOK_SMOKE_SECRET=<same value as deployed GITHUB_WEBHOOK_SECRET> \
AGENTPROOF_WEBHOOK_LIVE_PR_URL=https://github.com/owner/repo/pull/123 \
AGENTPROOF_WEBHOOK_LIVE_INSTALLATION_ID=<github-app-installation-id> \
pnpm smoke:github-webhook-live
```

Optional:

```bash
AGENTPROOF_WEBHOOK_LIVE_ACTION=synchronize
AGENTPROOF_WEBHOOK_LIVE_GITHUB_TOKEN=<read-only metadata token for private PRs>
AGENTPROOF_WEBHOOK_LIVE_ALLOW_SAVE_REPORTS=1
```

Expected proof:

- `dryRun: false`
- `automationEnabled: true`
- `willAnalyze: true`
- `willComment: false`
- `analysis.status: "completed"`
- bounded metadata only: repository, PR number, head SHA prefix, priority, evidence coverage, and optional summary-only saved-report metadata

The target PR must not receive a new or updated AgentProof marker comment. The command fails if a response echoes the webhook secret, signature, token-like probes, raw diff text, `evidenceIndex`, `claims`, or `reprompt`.

Afterward:

- Restore automation env to its normal state.
- Record only date, target test PR, action, and bounded response fields in the deployment smoke checklist.
- Do not paste raw webhook payloads, tokens, diffs, logs, installation objects, full reports, comment bodies, or saved report contents.

## Required Environment

For signed intake:

```text
GITHUB_WEBHOOK_SECRET
```

For GitHub App PR analysis:

```text
GITHUB_APP_ID
GITHUB_PRIVATE_KEY
AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED=true
AGENTPROOF_GITHUB_APP_ALLOWED_REPOS=owner/repo
```

`GITHUB_PRIVATE_KEY` must be a valid PEM private key. Local env files may use escaped `\n` newlines.

Optional automation settings:

```text
AGENTPROOF_GITHUB_APP_SAVE_REPORTS=true
AGENTPROOF_GITHUB_APP_COMMENT_ENABLED=true
```

Keep comment automation disabled until the repository owner explicitly wants AgentProof comments on PRs.

## Expected Responses

Not configured:

```json
{
  "error": "GitHub App webhook is not configured.",
  "code": "github_webhook_not_configured"
}
```

Verified dry-run:

```json
{
  "ok": true,
  "accepted": true,
  "dryRun": true,
  "event": "pull_request",
  "delivery": "delivery-id",
  "automationEnabled": false,
  "willAnalyze": false,
  "willComment": false,
  "summary": {
    "repository": "owner/repo",
    "pullRequestNumber": 123,
    "pullRequestUrl": "https://github.com/owner/repo/pull/123"
  }
}
```

Verified automated analysis:

```json
{
  "ok": true,
  "accepted": true,
  "dryRun": false,
  "event": "pull_request",
  "delivery": "delivery-id",
  "action": "synchronize",
  "automationEnabled": true,
  "willAnalyze": true,
  "willComment": false,
  "analysis": {
    "status": "completed",
    "repository": "owner/repo",
    "pullRequestNumber": 123,
    "headSha": "abc123",
    "priority": "medium",
    "evidenceCoverage": 61,
    "savedReport": {
      "privacy": "summary-only"
    }
  }
}
```

Ignored signed event:

```json
{
  "ok": true,
  "ignored": true,
  "dryRun": true,
  "event": "issues",
  "delivery": "delivery-id",
  "automationEnabled": false
}
```

## Safety Boundary

Keep these boundaries in place:

- Install the GitHub App with least-privilege permissions for pull requests, checks/statuses, metadata, and Actions job metadata. Add issue comment write only when comment opt-in is intended.
- Use `AGENTPROOF_GITHUB_APP_ALLOWED_REPOS`; avoid `*` outside controlled testing.
- Treat saved reports as summary-only. Do not store raw diffs, raw logs, webhook payloads, installation tokens, claims, or raw re-prompt text.
- Keep automatic comments off by default. When enabled, update one marker comment instead of creating comment storms.
- Rate-limit and retry policy.
- Tests proving raw payloads, raw diffs, logs, and tokens are not persisted.

The current idempotency store is in-memory and short-lived. That is acceptable for v1 smoke testing, but durable automation should move to a dedicated store keyed by installation, repository, PR number, head SHA, event action, and delivery metadata.
