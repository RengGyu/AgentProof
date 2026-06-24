# AgentProof Market Validation Summary

This is an internal product-planning summary. Do not treat pasted research citation tokens as public sources. Re-verify source URLs before publishing external claims.

## Decision

Build AgentProof only as a narrow evidence verifier for AI-agent pull requests. Do not position it as a broad AI code reviewer.

The strongest product question is:

> Is there enough evidence that this agent-authored PR satisfies the original request?

## Why This Is Plausible

- AI coding tools increase PR throughput, but humans still own verification, merge risk, and requirement fit.
- The pain is strongest for CTOs, tech leads, senior reviewers, and small teams already using Codex, Cursor, Claude Code, Copilot, or similar agents.
- Existing code review products are crowded, so AgentProof must focus on requirement coverage, evidence gaps, scope creep, and re-prompting.

## Positioning Guardrails

- Prefer evidence report, verification, requirement coverage, grounded findings, and human decision support.
- Avoid generic AI code review language, auto-merge claims, and security scanner claims without tool-backed evidence.
- Treat Slack/mobile as delivery surfaces, not the core product thesis.
- Keep raw code and logs out of durable storage by default.

## MVP Implications

- Keep PR URL or pasted evidence intake.
- Keep criterion-by-criterion report rendering.
- Prioritize strict report validation, summary-only sharing, and trustworthy provenance before adding integrations.
- Add GitHub App, Jira, Slack OAuth, org analytics, or PWA features only after the core evidence report is reliable.
