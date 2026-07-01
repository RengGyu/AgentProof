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

Design-partner onboarding is still invite-only. A tenant admin can install the App, select a repository, and configure repository settings through tenant-bound invite/session access. Repository settings mutations require bounded `owner` or `admin` role metadata. This is not full self-serve authentication or durable account RBAC.

## Slack Summaries

Slack summaries are optional. They should be sent only when all of these are true:

- the tenant repository grant is active
- evidence report analysis is enabled for the repository
- the repository has Slack summaries opted in
- plan/quota gates allow the side effect
- Slack configuration is valid on the server
- durable side-effect audit requirements pass when enabled

Slack payloads must stay summary-only. They may include bounded status, priority, requirement coverage, missing-test count, scope signal, and safe source links. They must not include Slack webhook URLs, workspace IDs, channel IDs, raw report bodies, raw diffs, logs, evidence indexes, claims, raw re-prompt text, tokens, or provider identifiers.

## Retention And Deletion

AgentProof is not a long-term source-code archive. Raw PR evidence is processed only as needed to produce an evidence report. Durable storage should keep summary-only report metadata, bounded job/audit metadata, usage counters, and tenant setup metadata.

Current deletion support is deliberately staged:

- Customer-facing deletion preview is count-only and dry-run.
- Internal deletion execution is guarded and requires tenant deletion state before destructive work.
- Saved summary report and analysis job deletion boundaries are partially implemented.
- Public destructive deletion controls, full deletion drills, restore drills, backup expiry enforcement, and external GitHub installation revocation remain launch-gate work.

The public promise should be conservative: AgentProof does not durably retain raw code evidence by design, and deletion workflows remain subject to the documented retention policy and operational readiness gates.

## Troubleshooting

Use setup language when explaining activation blockers:

| Symptom | Likely evidence to check | Safe customer response |
| --- | --- | --- |
| No report generated from a PR event | GitHub App mode, tenant grant, repo analysis setting, queue status, quota status | The repository is not ready for automated evidence reports yet. |
| Private repository cannot be analyzed | Installation access, repository grant, GitHub rate limit or unavailable metadata | The GitHub App cannot currently confirm repository access. |
| No CI or test evidence appears | Check/status API availability and PR checks | The report cannot verify execution evidence that GitHub did not provide. |
| Slack summary not delivered | Repo Slack opt-in, plan/quota gate, server Slack configuration, audit gate | Slack delivery is not ready for this repository. |
| Saved link unavailable | Saved-report setting, quota/plan gate, storage status, TTL expiry | Summary links are unavailable or expired; raw evidence is not recovered from storage. |

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

## Publication Checklist

Before treating a page or doc as public launch material, confirm that it:

- uses evidence report, verification, requirement coverage, missing proof, scope creep, and grounded findings language
- states that AgentProof does not auto-merge or prove full correctness
- states that durable storage excludes raw diffs, logs, webhook payloads, tokens, evidence indexes, claims, and raw re-prompt text
- keeps Slack, comments, saved links, OpenAI verifier calls, and destructive deletion as explicit opt-ins or guarded workflows
- avoids unsupported market claims and unsupported security claims
- has a source-level copy boundary test when it is part of the product surface
