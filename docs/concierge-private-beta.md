# Concierge Private-Repo Beta

This is an operator-assisted private repository path, not self-serve SaaS and not Human A/B evidence. AgentProof remains a deterministic-first evidence report. The default product path remains deterministic-only.

## Golden path

```text
operator invite
  -> GitHub user-to-server OAuth (`state` + PKCE) and durable HttpOnly session
  -> active tenant-owned GitHub App installation
  -> explicit enabled repository grant
  -> manual request + durable idempotency reservation
  -> one explicit task or one accessible linked issue
  -> transient GitHub evidence snapshot
  -> deterministic report + runtime validation + head recheck
  -> 30-second Decision Card
  -> metadata-only feedback
  -> tenant suspension / repository disable / global kill switch
```

The repository grant fields have deliberately separate meanings:

- `enabled=true`: the repository is available for operator-assisted manual analysis.
- `analysisEnabled=true`: webhook/worker automation is separately opted in.

Existing GitHub onboarding keeps its established automation setting. Concierge registration is atomic: if no grant exists, it creates a manual-only grant with `analysisEnabled=false`, `saveReportsEnabled=false`, `commentEnabled=false`, and `slackNotificationsEnabled=false`; if an ordinary grant already exists, it returns that row without merging, patching, enabling, or disabling any setting. LLM, webhook automation, saved reports, public share, GitHub comments, Slack, billing, and full history stay off in the Concierge runtime regardless of the existing grant's automation settings.

All Concierge tables share foreign-key boundaries with durable tenant/session/installation/grant rows. The effective Concierge project uses `AGENTPROOF_CONCIERGE_SUPABASE_*` when explicitly provided, otherwise the existing `AGENTPROOF_CONTROL_PLANE_SUPABASE_*` or shared `SUPABASE_*` pair. That effective project must resolve to the same origin as every tenant store. A missing or cross-project configuration fails closed before session verification, installation-token issuance, feedback storage, or analysis reservation.

### Personal GitHub login boundary

The friendly Concierge UI no longer accepts a beta-space ID, tester ID, or session-start code. It starts the existing GitHub App's user-to-server OAuth web flow with a random one-time state and PKCE `S256` verifier. The callback is a fixed configured HTTPS URL; it does not accept a browser-provided return URL. Both cookies are `__Host-`, `HttpOnly`, `Secure`, and `SameSite=Lax`. Every callback outcome clears only the pending OAuth state cookie; a failed callback deliberately preserves an already valid Concierge session. A successful callback atomically revokes that user's former durable Concierge session before activating its replacement.

The first beta is personal-account and private-repository only. The authenticated GitHub numeric user ID must exactly equal the selected installation's numeric `account.id` and `target_id`; both types must be `User`, the App ID must match the configured App, and the durable installation row must be active with the same numeric account ID. Organization and collaborator installations are blocked. `/user/installations` and `/user/installations/{id}/repositories` each retain at most five pages of 100 rows; their sixth bounded sentinel page detects a 501st row and fails closed rather than silently omitting it. At most 500 private repository rows may enter a session; public-only access gets a separate private-repository recovery message. Login names and URLs are display metadata only, never authorization facts. An operator must pre-provision the exact `github-user-<numeric-id>` tenant member as active with the Concierge `member` role, one active personal installation, and exactly one enabled manual repository grant; OAuth never creates, enables, or changes that member. OAuth codes, access tokens, refresh tokens, and provider responses remain callback-local and are not put in the database, logs, browser storage, responses, or audit events. The durable rows contain only hashes, positive numeric IDs, bounded version/status, and timestamps.

The selected repository is re-authorized with the active tenant, pre-provisioned member, installation, manual-only grant, deletion tombstone, and expected PR head before and after analysis. The Concierge OAuth session is the sole session authority; it expires within one hour and is also revoked by a signed `github_app_authorization` revocation event. A linked issue outside that selected repository is never fetched on the Concierge path; it becomes bounded unavailable task evidence. Feedback derives both tenant and pseudonymous partner ID from the authenticated server session, not browser input. Store or network verification failure is reported as `auth_unavailable` (connection unavailable), never as a signed-out user or a verified access change.

Required external setup before this path can be used is: apply `202607210001_concierge_github_user_auth.sql` to the approved non-production Supabase project, pre-provision the exact active Concierge member, configure GitHub App Client ID/Client Secret, register the exact callback URL, provide two independent server-only state and feedback-pseudonym secrets of at least 32 bytes each, enable and verify signed `github_app_authorization` deliveries, and verify platform request logs do not retain callback query strings. Until those platform checks, callback-code log absence and webhook delivery are `unclear` rather than proven.

Concierge activation does not require a branch-scoped beta enable variable. It is available only on Vercel Preview when the existing durable tenant/account/session/installation/grant stores are completely configured in that same Supabase project and the existing global Concierge kill switch is explicitly released. Production, local/unknown deployment modes, missing stores, memory/env fallbacks, and cross-project configurations remain fail-closed.

`AGENTPROOF_CONCIERGE_EXTERNAL_REVIEWER_TENANTS` is an operator-controlled JSON array of isolated external-reviewer tenant IDs. Missing means every session is internal self-test evidence; malformed or duplicate entries fail feedback storage closed. The browser cannot choose or override this cohort. Each listed tenant must have exactly one enabled repository grant.

## Original-task boundary

An explicit task wins without fetching a linked issue. Otherwise, exactly one supported and accessible linked issue is authoritative. No issue, an inaccessible/empty issue, a PR reference, or multiple candidates produces `unavailable` or `ambiguous`. The PR description remains context only. Full runtime validation rejects `met` when the original task is unavailable or ambiguous.

`source.originalTask` is metadata-only: status, source type, bounded reason, and an optional linked-issue reference. Feedback, audit, idempotency, and durable analysis state never persist the issue/task body.

The owner-first and external-reviewer procedure is defined in `docs/human-beta-first-tester.md`. Owner sessions use `self_internal` and are internal, biased usability checks—not external human evidence. External reviewers use isolated single-grant tenants and `external_reviewer`.

## Privacy and storage

The manual response is `Cache-Control: private, no-store`. Bounded evidence excerpts, the evidence index, report, and re-prompt cross the authorized response boundary and exist transiently in browser memory so the reviewer can inspect them. They are not written to AgentProof durable storage, browser history, or `localStorage`. Provider tokens and unbounded raw diffs/logs are never returned. The durable analysis row contains only tenant/install/repository identifiers, a request hash, bounded state/reason, and timestamps. Feedback has an exact metadata allowlist with no free-text field, is atomically bound to a completed run for the same active tenant/install/grant, and stores one immutable event per tenant, operator-issued opaque partner ID, session ordinal, and case hash. A retry gets bounded `duplicate`, not a second row.

Feedback v3 separates `self_internal` from `external_reviewer`, distinguishes evidence collection failure from collected-but-insufficient proof, and represents zero-gap as `not_applicable_zero_gap`. The cohort is assigned from an operator-controlled isolated-tenant list, not by the browser. The completed analysis row stores only `has_top_gap` or `zero_gap` so the RPC rejects contradictory feedback. `human-beta-privacy.v1` has a 30-day beta retention target, but cleanup is operator-managed and not automatic; the operator may purge it earlier.

No private report is put in browser history or localStorage. The Concierge ReportView hides share, export, and comment controls. Each successful manual response carries an exact, response-only side-effect telemetry record bound to its request hash and PR head SHA. It contains only six counters (`llm`, `comment`, `slack`, `share`, `save`, `webhook`) and must be all zero; a missing, duplicate, mismatched, or nonzero record causes the non-production smoke gate to exit `2`. This is runtime instrumentation, not independent proof of provider/platform logs; external log inspection remains required.

## Kill switches and lifecycle

- Global: the kill switch is engaged unless `AGENTPROOF_CONCIERGE_GLOBAL_KILL_SWITCH` is explicitly `false`/`0`/`no`/`off`; any missing or malformed value blocks new manual analysis.
- Tenant: suspend/delete the durable tenant account; session revalidation blocks access.
- Repository: set the durable grant `enabled=false`.
- Installation: `suspended` or `deleted` status blocks access. Signed lifecycle events disable matching grants; unsuspend/re-add never auto-enables them.

The in-product **세션 종료** action clears the durable session cookie only after the revoke RPC confirms `revoked`, `already_revoked`, or `not_found`. Timeout, malformed, and 5xx replies retain that cookie so the same token hash can be retried; they appear as `auth_unavailable` and never begin a different-account login automatically.

The environment-level global switch may require a deployment configuration refresh; its operational propagation time is `unclear` until the deployment platform is tested. Tenant and repository controls are durable database state.

## Purge runbook

1. Turn on the global kill switch.
2. Suspend the tenant and disable all repository grants.
3. Confirm new calls fail before installation-token creation.
4. Using an audited database-owner maintenance session (there is intentionally no application delete/unlock RPC), delete metadata-only Concierge feedback first and analysis-run rows second for the tenant according to the approved retention request.
5. Keep the active deletion-state tombstone while grants and sessions are being disabled. For an approved non-production test cleanup only, remove that metadata-only row last through the same audited owner session and record a bounded completion check; application code cannot unlock it.
6. Revoke/disconnect the GitHub installation through the existing operator workflow.
7. Do not claim raw report deletion: this path does not durably store full reports or raw evidence.

## Local verification

Run `pnpm concierge:db:integration`. It uses only a locally cached `postgres:16-alpine` image and exits `2` with `PREREQUISITE_UNAVAILABLE` when Docker/PostgreSQL is unavailable; it never reports a skip as success. It checks 20 concurrent reservations, RLS/direct-DML boundaries, RPC authorization, and terminal transitions.

External checks still required before a person sees a real private repository:

- apply the migration to an isolated deployment database and verify RLS/RPC through Supabase;
- use one approved private test repository and GitHub App installation;
- confirm global/tenant/repository kill-switch propagation;
- run desktop/mobile browser and accessibility smoke with the deployed route;
- verify no platform logs contain request/response bodies.

This readiness work does not prove usefulness, accuracy, correctness, false-blocker rate, repeat usage, Human A/B results, or holdout performance.

## Approved non-production GitHub smoke runbook

Do not run this from a production deployment. After an operator approves one non-production GitHub App installation, one non-production durable tenant session, and three private test PRs, create a local case manifest outside the repository. It may contain only IDs, PR numbers, and expected bounded statuses — never task/PR bodies, diffs, logs, reports, or tokens.

If Vercel Preview deployment protection is enabled, keep it enabled. Provide its
short-lived bypass only in the local root `.env.local` as
`AGENTPROOF_CONCIERGE_SMOKE_VERCEL_PROTECTION_BYPASS`. The wrapper requires
exactly one non-empty value, forwards only approved smoke inputs to its child,
and sends the value only in `x-vercel-protection-bypass` after the exact HTTPS
approved-origin check. It exits before any request for a missing, duplicate,
malformed, or unapproved value; it never writes the value to the manifest,
bounded summary, durable storage, stdout, or stderr.

The three cases are: (1) exactly one accessible linked issue with passing checks, (2) no linked issue or multiple linked issues, and (3) a failed or unavailable check. The second case must expect `unavailable` or `ambiguous` and zero `met` requirements. The script prints only case IDs and bounded status counts.

```bash
AGENTPROOF_CONCIERGE_SMOKE_EXECUTE=1 \
AGENTPROOF_CONCIERGE_SMOKE_APPROVED_ORIGIN='https://nonproduction.example' \
AGENTPROOF_CONCIERGE_SMOKE_BASE_URL='https://nonproduction.example' \
AGENTPROOF_CONCIERGE_SMOKE_SESSION_COOKIE="$AGENTPROOF_CONCIERGE_SMOKE_SESSION_COOKIE" \
AGENTPROOF_CONCIERGE_SMOKE_CASES_PATH='/secure/local/concierge-smoke-cases.json' \
pnpm concierge:smoke:nonprod
```

Without the explicit execution flag the command exits `2` before any network request. A missing approval, credential, test repository, or deployed migration is `EXTERNALLY_BLOCKED`; do not replace it with mock success.

The case manifest has exactly three opaque rows, one for each scenario: `single_linked_issue_passing`, `task_unavailable_or_ambiguous`, and `failed_or_unavailable_check`. `caseId` must be an operator-generated `case_` plus 16–64 lowercase hex characters, never a repository or PR label. Each row must include an `expectedHeadSha`: the exact 40-character lowercase Git commit SHA captured by the separate installation-token preflight for that PR. Both external source identities—`(repositoryId, PR)` and case-insensitive `(repositoryFullName, PR)`—must be unique. Unknown row fields, missing or malformed head SHAs, and a report provenance head that differs from the manifest are rejected. The runner accepts only the explicitly approved HTTPS origin, rejects redirects, requires JSON plus `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`, bounds the in-memory response size, requires an exact response/capability/side-effect/telemetry allowlist, and invokes the full runtime report validator before emitting bounded status output. Positive cases alone are not a readiness decision: negative-smoke evidence and external log inspection remain required.

## External negative-smoke and rollback runbook

Run these only after the operator separately approves the named non-production tenant, installation, repository, and temporary state changes. For each check, record only a case hash, HTTP status, bounded response code, and provider-call count; do not persist cookies, task/PR text, report bodies, diffs, or logs.

1. Use a wrong tenant/repository and an expired session; confirm installation-token issuance count is zero.
2. Temporarily disable the repository grant, suspend the installation, and remove the repository; confirm each is rejected before token issuance. Restore the exact pre-test durable state after each case.
3. Start a deliberately delayed analysis, then revoke its grant and separately change the PR head; confirm no report is delivered and its metadata-only run is terminal `failed`.
4. Replay the same request; confirm one durable reservation and one duplicate response. Exercise the global, tenant, and repository kill switches independently, then verify bounded rejection after the platform's observed propagation time.
5. Inject GitHub 401/403/404/429/5xx/timeout through the approved test App/repository only; each response must contain no report body and only a bounded reason code.
6. Inspect the approved non-production Supabase rows, browser storage, and platform request/error/function logs for forbidden raw evidence. Then disable the temporary grant/session metadata and run the purge sequence above.
