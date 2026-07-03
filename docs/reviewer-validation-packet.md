# Reviewer Validation Packet

Use this packet to move P0 validation from internal confidence to real reviewer evidence. It prepares three concrete outreach attempts and one bounded feedback form. Do not record personal contact details in the repository.

The machine-readable tracker is `eval/fixtures/reviewer-validation.v1.json`. It starts as `outreach_prepared_reviewer_usefulness_unclear`; do not change it to in-progress or ready-for-review until outreach/session evidence exists.

Use the recorder instead of editing the tracker by hand:

```bash
pnpm p0:beta-readiness
pnpm reviewer:validation summary
pnpm reviewer:validation outreach-pack
pnpm reviewer:validation message --slot reviewer-1
pnpm reviewer:validation mark-outreach --slot reviewer-1 --status outreach-sent --next-action "Wait for bounded reviewer response."
pnpm reviewer:validation add-feedback --slot reviewer-1 --session-status completed --reviewer-profile cto-or-tech-lead --pr-source public-oss-pr --report-path public-pr-url-only --time-to-top-risk 24 --top-risk-understood yes --missing-proof-understood yes --first-file-or-check-understood yes --next-reprompt-understood yes --report-usefulness useful --false-blocker-observed no --would-use-again yes --follow-up "Reviewer identified inspection priority from bounded report metadata."
```

The readiness gate prints only `p0-beta-readiness-summary-only`. The recorder prints only `reviewer-validation-summary-only`, `reviewer-validation-message-only`, or `reviewer-validation-outreach-pack-only` output and rejects private contact details, raw diffs, full logs, token-looking values, provider ids, table names, environment variable names, and multi-line free-form notes.

## Outreach Rule

Prepare at least three real reviewer sessions or concrete outreach attempts before claiming design-partner validation.

If real reviewers are unavailable, mark internal review as `biased and insufficient`. Internal review can identify obvious copy or setup problems, but it does not prove reviewer usefulness.

## Target Reviewer Slots

| Slot | Target profile | Why this profile | Outreach channel class | Status | Next action |
| --- | --- | --- | --- | --- | --- |
| reviewer-1 | Small-team CTO or tech lead | Owns merge risk and agent workflow quality | existing network | ready-to-send | Send message A and ask for one 10-minute public PR session. |
| reviewer-2 | Senior reviewer using coding agents | Feels missing-proof and false-blocker pain directly | existing network | ready-to-send | Send message B and ask for one public or shareable PR. |
| reviewer-3 | Staff engineer or engineering manager | Can judge whether the report helps inspection priority | design-partner candidate | ready-to-send | Send message C and offer live walkthrough or async report review. |

Do not store names, handles, email addresses, calendar links, repository secrets, private repository names, raw diffs, full logs, screenshots with secrets, tokens, provider ids, table names, or environment variable names in this file.

## Message A: CTO Or Tech Lead

Subject: 10-minute check on an AI-agent PR evidence report

I am testing AgentProof with a few reviewers before treating it as beta-ready. It creates an evidence report for an agent-authored pull request: requirement coverage, weak proof, missing tests, scope signals, first files to inspect, and the next re-prompt for the coding agent.

Could you spend 10 minutes on one public or shareable PR and tell me whether the report helps you decide what to inspect first before merge?

What I need from you:

- Open the deployed demo.
- Paste one public GitHub PR URL, or use a demo PR if you cannot share one.
- In the first 30 seconds, say the top risk, missing proof, first files, and next re-prompt.
- Tell me whether the report is useful, partially useful, not useful, or unclear.

Please do not send raw diffs, full logs, private tokens, screenshots with secrets, or private customer data.

## Message B: Senior Reviewer Using Coding Agents

Subject: Quick feedback on agent PR verification

I am validating whether AgentProof helps reviewers of AI-agent pull requests find weak evidence faster. The report is not a merge decision. It should help a human reviewer decide what to inspect first and what to ask the coding agent to fix next.

Could you try it on one public or shareable PR where the original task or linked issue is visible?

I am measuring:

- Can you find the top risk within 30 seconds?
- Did it catch missing proof or missing targeted tests?
- Did it overstate any blocker?
- Was the next re-prompt useful enough to send back to an agent?
- Would you use it again on another real PR this week?

Feedback should stay summary-only. Please avoid raw code, logs, tokens, private repository names, or provider identifiers.

## Message C: Staff Engineer Or Engineering Manager

Subject: Design-partner feedback on PR evidence handoff

I am looking for a practical reviewer check, not product praise. AgentProof maps a PR back to the original issue, task, or prompt and produces a grounded evidence report for human review.

Could you review one generated report and tell me whether it changes your inspection priority?

The useful signal is narrow:

- requirement coverage
- missing proof
- scope creep
- risky files to inspect first
- test/build evidence status
- next re-prompt to the coding agent

If the report is noisy, unclear, or not useful, that is the most important feedback. Please keep feedback bounded to outcome labels and short notes; do not send raw diffs, full logs, secrets, or private customer data.

## Session Script

Before the session:

1. Choose a public PR or confirm the reviewer will use the deployed demo.
2. Confirm the reviewer understands AgentProof is an evidence report, not an approval gate.
3. Remind the reviewer not to send raw code, logs, tokens, private provider ids, table names, or environment variable names.

During the first 30 seconds after the report appears, ask:

1. What is the top risk?
2. What proof is missing or weak?
3. Which file or check would you inspect first?
4. What would you ask the coding agent to do next?

After the session, capture only the bounded feedback fields below.

## Feedback Form

| Field | Allowed values |
| --- | --- |
| Reviewer slot | `reviewer-1`, `reviewer-2`, `reviewer-3` |
| Session status | `completed`, `scheduled`, `outreach-sent`, `declined`, `no-response`, `internal-only-biased-and-insufficient` |
| Reviewer profile | `cto-or-tech-lead`, `senior-reviewer`, `staff-engineer`, `engineering-manager`, `unclear` |
| PR source | `public-oss-pr`, `shareable-team-pr`, `demo-pr`, `unclear` |
| Report path | `public-pr-url-only`, `public-pr-plus-task-text`, `private-beta-assisted`, `demo` |
| Time to top risk | integer seconds, or `not-found` |
| Top risk understood | `yes`, `no`, `unclear` |
| Missing proof understood | `yes`, `no`, `unclear` |
| First file or check understood | `yes`, `no`, `unclear` |
| Next re-prompt understood | `yes`, `no`, `unclear` |
| Report usefulness | `useful`, `partially-useful`, `not-useful`, `unclear` |
| False blocker observed | `yes`, `no`, `unclear` |
| Would use again | `yes`, `no`, `maybe`, `unclear` |
| Follow-up | One bounded sentence without raw code, logs, secrets, private identifiers, or customer data. |

## Completion Evidence

P0 real-user validation is not complete until at least one of these is true:

- three reviewer sessions are completed with bounded feedback records, or
- three concrete target-reviewer outreach attempts are sent and recorded as `outreach-sent`, `scheduled`, `declined`, or `no-response`.

Even after three outreach attempts, product usefulness remains unproven until at least one real reviewer uses AgentProof on a real PR. Mark that state as `outreach prepared, reviewer usefulness still unclear`.

Do not count AgentProof self PRs as P0 quality proof.

Do not scale the external PR pilot from five cases to twenty until reviewer feedback has been recorded, manual labels are filled after report generation, and summary-only privacy checks still pass.
