# AgentProof Product Brief

## Decision

Build only the narrowed version: an evidence-based verifier for AI-generated PRs. Do not build a broad AI code reviewer.

AgentProof answers one question: "Is there enough evidence that this agent-authored PR satisfies the original request?" The product should support human review and re-prompting, not replace reviewer judgment or make auto-merge decisions.

## MVP Scope

- PR URL intake with optional fine-grained GitHub token
- Paste-mode fallback for task text, PR description, changed files, checks, and logs
- Acceptance criteria extraction from task or issue text
- Agent claim extraction from PR description
- Criterion-by-criterion evidence report
- Scope creep detector for changed files not connected to criteria
- Missing-test detector using changed file names and check status
- Review priority map
- Re-prompt generator for Codex, Claude Code, Cursor, or Copilot
- Browser-local summary-only recent report history
- Summary-only share links that omit raw evidence and re-prompt text
- Summary-only saved report API with in-memory demo mode and optional Supabase durability
- Optional GitHub PR comment posting with a one-time write token
- Env-gated GitHub App webhook automation, repo-opt-in Slack summaries, local/operator manual Slack smoke route, and OpenAI verifier adapters
- Runtime report validation before future LLM output is trusted

## Not In MVP

- Auto-merge decisions
- Generic style comments
- Security scanner claims without tools
- Native mobile app
- GitHub App installation UI and durable automation dashboard
- Long-term raw source retention
- Long-term raw evidence, claims, re-prompt, patch, or log retention

## First Demo Cases

1. Clean AI PR with task, implementation, tests, and passing checks.
2. PR that implements the task but changes unrelated auth or session files.
3. Invoice CSV export PR with implementation changes and no meaningful test evidence.
4. Workspace invite validation PR with plausible implementation but failed CI.
5. Dashboard polish PR where criteria and conclusions stay low-confidence.

## Current Security Boundary

- GitHub tokens are accepted per request and are not stored.
- Recent history is local to the browser and stores only the summary-safe report projection.
- Share links contain only summary-level report data.
- Server saved reports are summary-only. They use in-memory demo storage unless server-only Supabase credentials are configured.
- GitHub PR comments use a short marker comment and update the prior AgentProof comment when present.
- GitHub App webhook intake verifies `X-Hub-Signature-256` when `GITHUB_WEBHOOK_SECRET` is configured. PR analysis remains dry-run by default and requires App credentials, repository allowlist opt-in, installation-token handling, and duplicate suppression. Supabase-backed idempotency stores only hashed keys plus bounded metadata when configured. Automated comments require a separate opt-in and update one marker comment.
- Operator diagnostics require `AGENTPROOF_OPS_TOKEN` and return bounded readiness categories only, without env values, repository names, table names, tokens, payloads, diffs, or logs.
- GitHub App Slack summaries require an active tenant repository grant, repo-level Slack opt-in, a server-side Slack webhook, quota allowance, and side-effect audit gates when enabled. The manual `/api/notifications/slack` smoke route also requires `AGENTPROOF_NOTIFY_TOKEN` plus `AGENTPROOF_MANUAL_SLACK_NOTIFICATIONS_ENABLED=true`, and is disabled when the tenant control plane is enabled.
- LLM mode requires `OPENAI_API_KEY` plus `AGENTPROOF_LLM_TOKEN`; structured output must pass runtime report validation before it is trusted.

## Market Validation Summary

Internal research supports a conditional build: broad AI code review is crowded, but an evidence packet for AI-agent PR verification remains a useful narrow workflow. The strongest target user is a small-team CTO, tech lead, or senior reviewer who already receives agent-authored PRs and needs to quickly judge requirement coverage, weak proof, missing tests, and scope creep.

The differentiation stays narrow:

- Requirement-to-evidence traceability, not generic review comments.
- Test/build execution, lint, typecheck, static check, and diff evidence before model judgment.
- Scope creep and missing proof signals that help a human decide where to look first.
- Re-prompt output for the coding agent when evidence is weak.

Do not publish uncited market claims from internal notes until source URLs are re-verified.

## Execution Roadmap

Use `docs/final-goals-and-roadmap.md` as the implementation target for moving from the current hardened MVP toward the final evidence-verifier product goal.
