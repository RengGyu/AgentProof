# GitHub App Webhook Dry-Run

AgentProof's GitHub App webhook endpoint is a signed intake boundary, not an automated reviewer.

Endpoint:

```text
POST /api/github/webhook
```

## Current Behavior

- Fails closed when `GITHUB_WEBHOOK_SECRET` is missing.
- Verifies `X-Hub-Signature-256` against the raw request body before trusting event data.
- Rejects oversized `Content-Length` before reading the body when the header is present.
- Accepts only bounded dry-run metadata for `pull_request`, `check_run`, `check_suite`, `status`, and `ping`.
- Ignores unsupported signed events without taking action.
- Rejects malformed JSON for supported events.
- Returns `automationEnabled: false`, `willAnalyze: false`, and `willComment: false`.
- Does not fetch installation tokens, post comments, trigger analysis, or store idempotency records.
- Does not return raw payloads, patch text, logs, installation objects, tokens, titles, or arbitrary payload fields.
- Redacts secret-looking values from returned metadata fields.

The route reads the request body in memory to verify GitHub's HMAC signature. It does not persist that body, and oversized requests are rejected by `Content-Length` when available plus a post-read byte cap. Deployment platform body-size limits should remain enabled.

## Required Environment

For signed dry-run intake:

```text
GITHUB_WEBHOOK_SECRET
```

For future GitHub App automation readiness, also configure:

```text
GITHUB_APP_ID
GITHUB_PRIVATE_KEY
```

`GITHUB_PRIVATE_KEY` must be a valid PEM private key. Local env files may use escaped `\n` newlines.

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

Do not enable automated GitHub App actions until these exist:

- Installation-token handling with least-privilege permissions.
- Idempotency storage keyed by delivery ID and PR head SHA.
- Summary-only durable storage policy.
- Explicit opt-in for posting AgentProof comments.
- Rate-limit and retry policy.
- Tests proving raw payloads, raw diffs, logs, and tokens are not persisted.

Until then, the webhook endpoint is a readiness check for signed metadata only.
