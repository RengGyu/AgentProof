# AgentProof Product Brief

## Decision

Build only the narrowed version: an evidence-based verifier for AI-generated PRs. Do not build a broad AI code reviewer.

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
- Browser-local recent report history
- Summary-only share links that omit raw evidence and re-prompt text
- Optional GitHub PR comment posting with a one-time write token
- Runtime report validation before future LLM output is trusted

## Not In MVP

- Auto-merge decisions
- Generic style comments
- Security scanner claims without tools
- Native mobile app
- GitHub App installation
- Long-term raw source retention
- Server-side share/report persistence

## First Demo Cases

1. Clean AI PR with task, implementation, tests, and passing checks.
2. PR that implements the task but changes unrelated auth or session files.
3. PR with implementation changes and no meaningful test evidence.
4. PR with plausible implementation but failed CI.
5. Vague task where criteria and conclusions stay low-confidence.

## Current Security Boundary

- GitHub tokens are accepted per request and are not stored.
- Recent history is local to the browser.
- Share links contain only summary-level report data.
- GitHub PR comments use a short marker comment and update the prior AgentProof comment when present.
- LLM mode is not enabled yet; the code only prepares a structured package and validation boundary.
