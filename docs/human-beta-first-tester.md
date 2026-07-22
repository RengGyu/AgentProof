# Human Beta First-Tester Runbook

Status: internal self-test first; external reviewer sessions only after the exit gate below.

This is a usability check of an operator-assisted deterministic evidence report. It is not Human A/B, correctness evidence, a merge decision, or an accuracy claim. The owner's first session is recorded as `self_internal` and must never be counted as external reviewer evidence.

## Before the first session

1. Use a non-production deployment, an isolated tenant, and exactly one approved test-repository grant. Do not place a tester in an existing multi-repository tenant: tenant members can use every enabled grant in that tenant.
2. Apply migrations through `202607200001_human_beta_feedback_clarity.sql` and run the local DB, browser, privacy, sentinel, strict-fixture, typecheck, build, and full-test gates.
3. Keep LLM, webhook automation, save, share, GitHub comment, Slack, billing, and full history off. Confirm the global kill switch before and after the session.
4. Use a fresh browser profile. Do not paste names, contact details, repository names, PR numbers, task/code/report/log/re-prompt text, or secrets into feedback.
5. Do not issue or enter a participant ID. The server derives a pseudonymous partner ID from the authenticated GitHub session. Do not put the self-test tenant in `AGENTPROOF_CONCIERGE_EXTERNAL_REVIEWER_TENANTS`; the server assigns it to `self_internal`.

## Ten-minute self-test

Before revealing AgentProof, look at the original task, PR, and checks and record only one bounded pre-report category: no gap, implementation proof, targeted-test proof, execution proof, requirement clarity, evidence collection unavailable, or collected evidence insufficient.

Then open the Decision Card and time the first 30 seconds:

- What is the top evidence gap? If the card is zero-gap, say that no priority gap was found within collected evidence; do not translate that into “correct” or “safe.”
- Which file or check would you open first?
- What would you ask the agent to do next? A zero-gap card must not invent a re-prompt.
- Did any headline feel like a blocker without enough evidence?

Show the `human-beta-privacy.v1` notice before analysis. Save only the bounded feedback form. It stores opaque IDs, an operator-assigned cohort, selected categories, timing, actions, and rating. The beta retention target is 30 days, but deletion is currently operator-managed and not automatic. It does not accept free text or private evidence.

## End the session

1. Use **세션 종료**. A `503 auth_unavailable` means durable OAuth-session revocation was not proven and the browser cookie is retained for a same-session retry; stop and verify `revoked_at` before reusing the environment.
2. Close the browser profile and confirm local/session storage, Cache Storage, and IndexedDB are empty.
3. Inspect approved deployment logs for tokens, task/code/diff/log/report/re-prompt content.
4. Disable the temporary member or bootstrap credential. Disable the single repository grant when the session series is over.
5. Purge feedback first and analysis-run metadata second after the beta retention need ends. Review the 30-day target manually; do not claim automatic expiry.

## Exit gate to the first external reviewer

Proceed only when the owner completes at least two cases—one real top-gap case and one separate real zero-gap case—with:

- no P0 security/privacy failure;
- collection-unavailable and evidence-insufficient shown as different states;
- zero-gap showing no fabricated gap or re-prompt;
- bounded feedback stored as `self_internal` and excluded from external counts;
- session revocation confirmed; and
- no forbidden browser, database, or inspected platform-log retention.

For every external reviewer, create an isolated tenant with one repository grant, provision that person's exact active `github-user-<numeric-id>` member, then add only that tenant ID to `AGENTPROOF_CONCIERGE_EXTERNAL_REVIEWER_TENANTS`. A task-unavailable case is useful extra coverage but does not replace the zero-gap case. Show the privacy notice before analysis. Do not use the legacy reviewer tracker free-text field for private-repository sessions. Expand from one external reviewer to the next only after cleanup and session revocation are confirmed.
