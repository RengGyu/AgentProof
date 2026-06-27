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
- Short-lived summary-only saved report API for local demos
- Optional GitHub PR comment posting with a one-time write token
- Env-gated GitHub App webhook, Slack notification, and OpenAI verifier adapters
- Runtime report validation before future LLM output is trusted

## Not In MVP

- Auto-merge decisions
- Generic style comments
- Security scanner claims without tools
- Native mobile app
- GitHub App installation
- Long-term raw source retention
- Durable server-side share/report persistence before auth and database are added

## First Demo Cases

1. Clean AI PR with task, implementation, tests, and passing checks.
2. PR that implements the task but changes unrelated auth or session files.
3. PR with implementation changes and no meaningful test evidence.
4. PR with plausible implementation but failed CI.
5. Vague task where criteria and conclusions stay low-confidence.

## Current Security Boundary

- GitHub tokens are accepted per request and are not stored.
- Recent history is local to the browser and stores only the summary-safe report projection.
- Share links contain only summary-level report data.
- Server saved reports are summary-only, short-lived, and currently in-memory.
- GitHub PR comments use a short marker comment and update the prior AgentProof comment when present.
- GitHub App webhook intake verifies `X-Hub-Signature-256` when `GITHUB_WEBHOOK_SECRET` is configured and returns dry-run metadata only. Automated App actions remain disabled until App credentials, installation-token handling, idempotency storage, and explicit opt-in exist.
- Slack notifications require a server webhook plus `AGENTPROOF_NOTIFY_TOKEN`, and send summary-only payloads.
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
