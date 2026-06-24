# AgentProof

AgentProof is an evidence-based verifier for AI-generated pull requests. It is deliberately not a generic AI code reviewer: it maps the original task to acceptance criteria, checks whether a PR has evidence for each criterion, highlights weak tests and scope creep, and produces a short re-prompt for the coding agent.

## MVP

- PR URL + optional GitHub token intake
- Optional issue/task text and CI/log snippets
- Criterion-by-criterion evidence report
- Missing-test and scope-creep detection
- Review priority map
- 30-second reviewer card and detailed report
- Demo mode with realistic sample data
- Local-only recent report history
- Summary-only share links
- Optional GitHub PR comment posting with a one-time write token
- LLM structured-output boundary and runtime report validation

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Validate

```bash
pnpm test
pnpm typecheck
pnpm build
```

## Environment

The app can run in demo mode without environment variables. For live GitHub PR fetches, paste a fine-grained GitHub token in the form. The token is used only for that request and is not stored by this MVP.

Posting a PR comment requires a separate fine-grained token with comment write permission for the target repository. The exact comment preview is shown before posting, and the token is cleared after the request.

## Product Position

AgentProof answers: "Is there enough evidence that this agent-authored PR satisfies the original request?"

It avoids:

- Generic style review comments
- Auto-merge decisions
- Security scanning claims without evidence
- Long-term raw source retention
- Server-side report persistence

## Architecture

- `src/lib/github.ts`: GitHub URL parsing and REST fetch boundary
- `src/lib/extractors.ts`: deterministic requirement, claim, and evidence extraction
- `src/lib/verifier.ts`: evidence scoring and report generation
- `src/lib/structured-output.ts`: JSON schema contract for future LLM calls
- `src/lib/report-validation.ts`: runtime report validation and evidence-ref integrity checks
- `src/lib/report-share.ts`: summary-only portable share links
- `src/lib/report-history.ts`: browser-local recent report history
- `src/lib/llm-package.ts`: normalized package for future LLM verifier calls
- `src/components/*`: reviewer-focused UI
- `src/app/api/analyze/route.ts`: analysis API endpoint
- `src/app/api/github/comment/route.ts`: one-time GitHub PR comment posting endpoint

The current verifier is deterministic so the MVP can be tested without an LLM key. Future LLM calls should preserve the same JSON shape, pass runtime validation, and only cite known evidence IDs.

## Review Handoff Prompt

Use this prompt when asking another model to review the repository:

```text
Review this repository as AgentProof, an evidence-based verifier for AI-generated PRs.
It should not act like a generic AI code reviewer. Focus on requirement-to-evidence mapping,
scope creep detection, missing-test detection, GitHub PR ingestion, token/privacy handling,
mobile report UX, and whether every finding is traceable to evidence.
Prioritize bugs, false positives, security issues, missing tests, and workflow gaps.
```

For a fuller review prompt and mobile/manual test checklist, use `docs/review-handoff.md`.

## Deployed Demo

Current demo deployment:

`https://agentproof-pearl.vercel.app`
