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

## Product Position

AgentProof answers: "Is there enough evidence that this agent-authored PR satisfies the original request?"

It avoids:

- Generic style review comments
- Auto-merge decisions
- Security scanning claims without evidence
- Long-term raw source retention

## Architecture

- `src/lib/github.ts`: GitHub URL parsing and REST fetch boundary
- `src/lib/extractors.ts`: deterministic requirement, claim, and evidence extraction
- `src/lib/verifier.ts`: evidence scoring and report generation
- `src/lib/structured-output.ts`: JSON schema contract for future LLM calls
- `src/components/*`: reviewer-focused UI
- `src/app/api/analyze/route.ts`: analysis API endpoint

The current verifier is deterministic so the MVP can be tested without an LLM key. Future LLM calls should preserve the same JSON shape and only fill fields that have evidence.

## Review Handoff Prompt

Use this prompt when asking another model to review the repository:

```text
Review this repository as AgentProof, an evidence-based verifier for AI-generated PRs.
It should not act like a generic AI code reviewer. Focus on requirement-to-evidence mapping,
scope creep detection, missing-test detection, GitHub PR ingestion, token/privacy handling,
mobile report UX, and whether every finding is traceable to evidence.
Prioritize bugs, false positives, security issues, missing tests, and workflow gaps.
```

## Deployed Demo

Current demo deployment:

`https://agentproof-pearl.vercel.app`
