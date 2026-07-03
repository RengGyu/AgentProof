# First Real PR Report In 10 Minutes

Use this guide to test whether AgentProof helps a real reviewer decide what to inspect before merge. This is a design-partner beta workflow, not a public SaaS signup path.

## Who Should Run This

- A CTO, tech lead, or senior reviewer who already reviews AI-agent-authored PRs.
- A reviewer who can compare the report against their normal PR review workflow.
- A design partner willing to say when the report is noisy, unclear, or not useful.

Internal-only review is allowed only as a fallback. Mark it `biased and insufficient` until at least three real reviewers or concrete target-reviewer outreach attempts are recorded.

## 10-Minute Public PR Path

1. Open `https://agentproof-pearl.vercel.app`.
2. Paste a public GitHub PR URL.
3. Add issue/task text only when the PR description does not clearly include or link the original request.
4. Generate the report.
5. In the first 30 seconds, check:
   - evidence answer
   - requirement status counts
   - top 2-3 risks
   - first files to inspect
   - missing targeted-test count
   - execution evidence status
   - next re-prompt action
6. Decide whether the report changed what you would inspect before merge.

## Private PR Path

For private repositories, use one of these controlled beta paths:

- Paste a fine-grained GitHub token for the request only. AgentProof uses it only for that analysis request and does not store it.
- Use GitHub App onboarding only for an invited design partner repository with explicit repo-level opt-in.

Do not paste raw diffs, full logs, webhook payloads, service keys, or private tokens into feedback forms or docs. If GitHub evidence cannot be fetched, the report should say the evidence is unavailable or unclear.

## Reviewer Session Script

Prepare at least three real reviewer sessions or outreach targets before claiming beta validation.

For each session, capture only bounded notes:

| Field | Allowed values |
| --- | --- |
| Reviewer slot | `reviewer-1`, `reviewer-2`, `reviewer-3` |
| Reviewer profile | CTO, tech lead, senior reviewer, staff engineer, engineering manager |
| PR type | public OSS PR, private team PR, AI-agent-authored PR, demo PR |
| Time to top risk | seconds, or `not-found` |
| Report usefulness | useful, partially-useful, not-useful, unclear |
| False blocker observed | yes, no, unclear |
| Missing proof caught | yes, no, unclear |
| Re-prompt usefulness | useful, partially-useful, not-useful, unclear |
| Would use again | yes, no, maybe |
| Follow-up | one bounded sentence without raw code/logs |

Ask these questions:

1. What did you inspect first after reading the report?
2. Did the report surface a risk you would otherwise have missed?
3. Did any blocker look false or overstated?
4. Was the next re-prompt useful enough to send back to an agent?
5. Would you use this on another real PR this week?

## Outreach Tracker

Use concrete target-reviewer outreach instead of vague intent. Do not commit personal contact details.

| Slot | Target profile | Target source | Status | Next action |
| --- | --- | --- | --- | --- |
| reviewer-1 | Small-team CTO or tech lead | existing network | to-schedule | send 10-minute public PR path |
| reviewer-2 | Senior reviewer using AI coding agents | existing network | to-schedule | ask for one public or shareable PR |
| reviewer-3 | Engineering manager or staff engineer | design-partner candidate | to-schedule | run report live and capture feedback |

If these sessions cannot be scheduled, record the result as `biased and insufficient` and do not treat internal feedback as product validation.

## Success And Pause Criteria

Success signals:

- At least three reviewer sessions or concrete outreach attempts are recorded.
- At least one real reviewer uses AgentProof on a real PR.
- Reviewers judge at least 70% of sampled reports useful or partially useful.
- The reviewer can identify the top risk within 30 seconds in most sessions.
- False blocker rate stays below 20% by default.

Pause signals:

- Reviewers do not find the report useful for inspection priority.
- False blockers repeatedly distract from the actual review.
- Linked issue/task evidence is too weak to judge the original request.
- Setup or demo complexity prevents use after a short walkthrough.

## Privacy Boundary

Feedback and share links must stay summary-only. Do not collect raw diffs, full logs, webhook payloads, report bodies, tokens, provider ids, table/env names, or private customer data. If evidence is missing, mark it unavailable or unclear instead of guessing.
