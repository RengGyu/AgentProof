# Public Launch Trust And Setup Boundary

Status: beta-ready draft
Audience: design partners, prospective team leads, and support reviewers

AgentProof produces evidence reports for AI-agent pull requests. The report helps a human reviewer decide whether the original request has enough proof, which requirements still need verification, where tests are missing, whether changed files suggest scope creep, and what to ask the coding agent to fix next.

AgentProof does not auto-merge pull requests, certify correctness, replace reviewer judgment, or claim broad security coverage. If the available evidence is incomplete, the report should say that the result is unclear instead of treating the PR as verified.

## Product Boundary

Use AgentProof when the review question is:

- Did this agent-authored PR satisfy the original request?
- Which acceptance criteria are met, partial, missing, or unclear?
- Which files, checks, logs, or summaries support each finding?
- Is there missing proof, missing targeted testing, or possible scope creep?
- What bounded re-prompt would help the coding agent close the evidence gap?

Keep these explicit limitations:

- AgentProof is not a replacement for human review.
- AgentProof is not a merge approval authority.
- AgentProof is not a broad bug-finding product.
- AgentProof is not a security certification product.
- AgentProof is not a source-code archive.
- AgentProof does not prove full correctness without supporting execution or review evidence.

## GitHub App Setup

The GitHub App should request only the permissions needed for evidence-report automation:

| Permission area | Why AgentProof needs it | Customer-facing boundary |
| --- | --- | --- |
| Pull requests | Identify PR number, branch/head SHA, changed files, and PR metadata needed to build requirement coverage. | Used to generate a verification report, not to approve or merge. |
| Repository contents metadata | Read changed-file metadata and file paths needed for evidence mapping. | Raw source and diffs are processed transiently and are not kept as durable report storage. |
| Checks/statuses | Read CI, test, lint, typecheck, and build signals. | Passing or failing checks are evidence inputs; unavailable checks stay unavailable. |
| Issues or pull request comments, when enabled | Update one AgentProof marker comment with a summary-only handoff. | Commenting is a separate repo-level opt-in and is off by default. |

Design-partner onboarding is still invite/bootstrap-gated. A tenant admin can install the App, select a repository, and configure repository settings through tenant-bound authorization. Cookie-mutating setup routes require same-origin mutation proof. Repository settings mutations require bounded `owner` or `admin` role metadata from a durable tenant auth session or the current tenant-bound invite header; member role/status lifecycle mutations require a durable owner/admin tenant auth session and a durable account store. The legacy stateless tenant admin session is kept as a short-lived read compatibility path. This is not full self-serve authentication, OAuth login, billing identity, or public customer account RBAC.

## Slack Summaries

Slack summaries are optional. They should be sent only when all of these are true:

- the tenant repository grant is active
- evidence report analysis is enabled for the repository
- the repository has Slack summaries opted in
- plan, quota, and billing beta gates allow the side effect
- Slack configuration is valid on the server
- durable side-effect audit requirements pass when enabled

Slack payloads must stay summary-only. They may include bounded status, priority, requirement coverage, missing-test count, scope signal, and safe source links. They must not include Slack webhook URLs, workspace IDs, channel IDs, raw report bodies, raw diffs, logs, evidence indexes, claims, raw re-prompt text, tokens, or provider identifiers.

## Retention And Deletion

AgentProof is not a long-term source-code archive. Raw PR evidence is processed only as needed to produce an evidence report. Durable storage should keep summary-only report metadata, bounded job/audit metadata, usage counters, and tenant setup metadata.

Current deletion support is deliberately staged:

- Customer-facing deletion preview is count-only and dry-run.
- Operator deletion execution is guarded and requires tenant deletion state before destructive saved-report or analysis-job purge work.
- Saved summary report and analysis job deletion boundaries are partially implemented.
- Public destructive deletion controls, full deletion drills, restore drills, backup expiry enforcement, billing/account deletion execution, and external GitHub installation revocation remain launch-gate work. The internal deletion execution plan must keep billing/account retention as manual review and must not imply legal billing deletion is complete.

The public promise should be conservative: AgentProof does not durably retain raw code evidence by design, and deletion workflows remain subject to the documented retention policy and operational readiness gates.

Operator launch review can use the ops drill evidence gate to track whether deletion drill, restore drill, incident runbook review, and production smoke evidence are fresh. The gate is metadata-only and must not include raw logs, tokens, repository or PR payloads, report contents, provider ids, table/env names, backup contents, screenshots, or secrets. It is not itself a deletion, restore, or incident-response workflow.

Failed invite/bootstrap session attempts may be audited as bounded system events. Audit rows should include only action, result, status code, normalized tenant id when valid, and a public reason code. They must not include invite tokens, bootstrap credentials, cookies, session hashes, request bodies, provider identifiers, table names, or raw storage errors.

## Billing Beta Boundary

Billing beta is a server-side launch gate. The public `/billing` page is a bounded billing beta surface that explains plan, quota, portal-boundary, and webhook-idempotency signals without creating subscriptions, collecting payment method data, opening provider portal sessions, or publishing pricing claims. Tenant-facing setup can show only summary fields: whether billing is configured, whether it is provider-backed, the coarse subscription status, the plan label, whether a server-side portal boundary is available, and webhook idempotency readiness. `POST /api/tenants/billing/portal` is a metadata-only portal session boundary: it requires same-origin mutation proof plus a durable owner/admin tenant session, reports whether a provider adapter redirect would be allowed, and does not return provider ids or portal URLs. `POST /api/billing/webhook` verifies signed provider webhooks before parsing them, extracts only bounded billing metadata, reserves webhook idempotency with hashed provider event ids, and can sync subscription lifecycle status as metadata-only server state. It must not show provider customer ids, subscription ids, price ids, invoice ids, payment method data, card fields, provider webhook event ids, service-role keys, table names, raw provider responses, raw webhook bodies, or webhook secrets.

When billing beta enforcement is enabled, GitHub App automation should stop before quota reservation, webhook idempotency, GitHub token fetch, PR evidence fetch, saved reports, marker comments, or Slack summaries if the tenant billing record is missing, manual-only, inactive, or mismatched with the quota plan. If billing evidence cannot be collected, say that billing status is unavailable or not configured; do not infer billing state from account plan labels, quota rows, repository grants, or usage records.

## Troubleshooting

Use setup language when explaining activation blockers:

| Symptom | Likely evidence to check | Safe customer response |
| --- | --- | --- |
| No report generated from a PR event | GitHub App mode, tenant grant, repo analysis setting, first-report readiness, queue status, quota status, billing beta status | The repository or PR is not ready for automated evidence reports yet. |
| Private repository cannot be analyzed | Installation access, repository grant, GitHub rate limit or unavailable metadata | The GitHub App cannot currently confirm repository access. |
| No CI or test evidence appears | First-report check/status availability and PR checks | The report cannot verify execution evidence that GitHub did not provide. |
| Slack summary not delivered | Repo Slack opt-in, plan/quota/billing gate, server Slack configuration, audit gate | Slack delivery is not ready for this repository. |
| Saved link unavailable | Saved-report setting, quota/plan/billing gate, storage status, TTL expiry | Summary links are unavailable or expired; raw evidence is not recovered from storage. |

When evidence cannot be collected, say what is unavailable. Do not infer test results, permissions, billing state, repository access, or Slack delivery from unrelated signals.

## Pricing And Support Language

Pricing language is product-owned until public launch. It can describe packaging shape without market claims:

- Free/demo: public PR analysis, demo scenarios, and limited saved summary links.
- Team: private repository verification, GitHub App installation, summary history, Slack summaries, marker comments, and monthly PR-analysis quota.
- Pro/Org: higher quota, more connected repositories, audit export, retention controls for summary-only reports, priority support, and stronger admin controls.

Do not publish market-size, willingness-to-pay, competitor, adoption, or ROI claims unless each claim has a verified public source URL. Internal market-validation notes are not publication-ready citations.

Support paths should be practical and evidence-based:

- setup help for GitHub App installation, repository access, and first-report blockers
- report usefulness feedback when requirement coverage, missing proof, scope signals, or re-prompts are confusing
- privacy and deletion requests tied to the retention policy
- incident updates for sustained GitHub, storage, queue, Slack, or OpenAI outages

Use `docs/support-status-feedback.md` as the beta support/status boundary. The public `/status` page is the first customer-facing support entry surface for setup blockers, report usefulness feedback, privacy questions, and incident/status communication. Support intake should collect only bounded setup, report, privacy, billing, and incident metadata; it must not become a channel for raw diffs, full logs, webhook payloads, report bodies, tokens, provider ids, payment data, table names, environment variable names, or service internals.

## Publication Checklist

Before treating a page or doc as public launch material, confirm that it:

- uses evidence report, verification, requirement coverage, missing proof, scope creep, and grounded findings language
- states that AgentProof does not auto-merge or prove full correctness
- states that durable storage excludes raw diffs, logs, webhook payloads, tokens, evidence indexes, claims, and raw re-prompt text
- keeps Slack, comments, saved links, OpenAI verifier calls, and destructive deletion as explicit opt-ins or guarded workflows
- keeps billing provider ids and payment data server-side and out of tenant-facing setup, audit export, Slack, comments, saved reports, and support screenshots
- avoids unsupported market claims and unsupported security claims
- has a source-level copy boundary test when it is part of the product surface
