# Support, Status, And Feedback Boundary

Status: beta-ready draft
Audience: design partners, prospective team leads, and support reviewers

AgentProof support should help a team understand evidence-report setup, verification usefulness, privacy boundaries, and operational status without turning support into a raw evidence channel.

Use this process for invite-only beta and public-launch preparation. It is a customer-facing support boundary, not a promise of full self-serve account management, billing support automation, or security certification.

## Support Intake

Support intake should collect only the minimum metadata needed to route the request:

| Request type | Safe customer-provided context | First support action |
| --- | --- | --- |
| Setup blocker | Tenant label, repository owner/name, PR number if relevant, and the visible setup blocker code or status | Compare the customer-visible status with GitHub App setup, repository grant, first-report readiness, queue, quota, and billing beta summaries. |
| Report usefulness feedback | Report id or summary link, requirement that felt unclear, and whether the issue was missing proof, missing tests, scope creep, or confusing re-prompting | Check the summary-only report fields and ask for the intended acceptance criteria if the original request was vague. |
| Privacy or deletion request | Tenant label and whether the request concerns saved summaries, audit metadata, setup metadata, deletion preview, or deletion execution | Route to the retention policy and deletion workflow; do not request raw code, tokens, private keys, webhooks, or billing provider identifiers. |
| Billing beta question | Plan label shown in the dashboard and coarse billing status shown to the tenant | Check provider-backed billing beta status internally without sending provider customer ids, subscription ids, invoice ids, payment method data, or event identifiers to the customer. |
| Incident or outage question | The visible customer symptom and timestamp window | Compare public status notes with aggregate operator signals for GitHub, storage, queue, Slack, OpenAI fallback, and privacy scanner failures. |

Support must not ask customers to paste raw diffs, full logs, full webhook payloads, evidence indexes, report bodies, agent claims, raw re-prompt text, tokens, signatures, service-role keys, private keys, Slack webhook URLs, provider ids, payment data, table names, or environment variable names into support channels.

If stronger evidence is required, use a controlled reproduction or operator-only diagnostic path that returns bounded metadata. If the evidence is unavailable, say it is unavailable instead of inferring test results, repository permissions, billing status, Slack delivery, or deletion completion from unrelated signals.

## Feedback Loops

Feedback should be tagged by the product risk it can improve:

- `setup_blocker`: first-report setup, GitHub App installation, repository grant, private repository access, rate limit, large PR cap, unavailable checks, queue, quota, or billing beta status.
- `report_usefulness`: requirement coverage, weakest proof, missing tests, scope creep, review priority, and next re-prompt clarity.
- `false_positive_or_false_confidence`: a requirement marked stronger than the evidence supports, a missing-test signal that lacked provenance, or a scope signal that did not cite changed-file evidence.
- `privacy_or_retention`: summary-only report storage, audit export, deletion preview, guarded deletion execution, or retention-policy questions.
- `billing_or_plan`: plan label, quota summary, connected repository limit, Slack/comment/saved-link entitlement, or provider-backed billing beta state.
- `incident_or_status`: sustained GitHub, storage, queue, Slack, OpenAI fallback, privacy scanner, or production smoke failure.

Each feedback record should preserve provenance as bounded metadata: request type, customer-visible status code, affected product area, summary-only report id or documentation anchor when available, support outcome, and next action. Do not store raw evidence, raw support transcripts with secrets, raw provider payloads, screenshots containing secrets, or unredacted customer code.

## Status And Incident Communication

Public status updates should be conservative and evidence-based. They can describe:

- affected product area such as GitHub App setup, evidence report generation, summary links, Slack summaries, audit export, billing beta gate, or tenant dashboard
- coarse impact such as delayed reports, unavailable setup status, unavailable saved summaries, blocked Slack summaries, or degraded verifier fallback
- time window, current state, workaround if one exists, and next update time
- whether reports are delayed, unavailable, or generated with missing external evidence

Status updates must not expose tenant ids, repository names, PR titles, raw error bodies, raw logs, payloads, tokens, provider ids, table names, environment variable names, backup contents, or service internals. If the incident affects evidence quality, the customer-facing wording should say which evidence source is unavailable and that AgentProof will not treat unavailable evidence as verified.

Use incident severity only for operational routing:

| Severity | Customer-facing threshold | Internal next action |
| --- | --- | --- |
| `watch` | One product area has degraded metadata or delayed evidence collection, but reports can still complete with clear unavailable evidence labels. | Monitor aggregate operator signals and record bounded notes. |
| `degraded` | A design partner cannot reliably generate first reports, summary links, Slack summaries, or audit exports. | Review aggregate queue, storage, GitHub, Slack, OpenAI fallback, privacy scanner, and production smoke evidence. |
| `incident` | Multiple tenants or a launch-critical path is blocked, privacy scanner fails, production smoke fails repeatedly, or deletion/restore evidence contradicts launch readiness. | Start incident runbook review, freeze risky launch changes, and update the bounded status note until recovery evidence is clear. |

## Support Response Rules

- Ground every answer in a customer-visible status, summary-only report field, docs anchor, bounded operator status, or explicit unavailable evidence statement.
- Say `unclear` when setup, report usefulness, billing, deletion, or incident evidence is incomplete.
- Keep re-prompts tied to the original request and available evidence; do not suggest unrelated code review tasks.
- Do not promise full correctness, security certification, merge safety, or automatic approval.
- Do not ask customers to lower privacy boundaries to speed up support.
- Record follow-up work as product tickets when the support gap requires code, docs, tests, billing provider work, or operational automation.

## Pre-Public Checklist

Before this support path is treated as public launch material:

- Support intake has a summary-only form or process that avoids tokens, raw code, raw logs, payloads, provider ids, and payment data.
- Status updates have a place to be published and can be linked from setup docs.
- Incident runbook ownership and escalation windows are documented.
- Feedback tags can be counted without storing raw evidence.
- Public copy boundary tests include this document.
- Any market, pricing, service-level, or security claim is removed or backed by a public source URL before publication.
