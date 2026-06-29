# GitHub App Webhook Automation

AgentProof's GitHub App webhook endpoint is a signed intake boundary for evidence reports, not an automated reviewer or merge gate. Default behavior remains dry-run unless automation is explicitly enabled for allowed repositories.

Endpoint:

```text
POST /api/github/webhook
```

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
