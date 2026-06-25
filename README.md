# AgentProof

AgentProof creates evidence-based verification reports for AI-generated pull requests. It answers: "Is there enough evidence that this agent-authored PR satisfies the original request?"

It is deliberately not a generic AI code reviewer. AgentProof maps the original issue, task, or prompt to acceptance criteria, checks whether the PR has evidence for each criterion, highlights weak tests and scope creep, and produces a short re-prompt for the coding agent. It supports human merge decisions; it does not replace them.

## MVP

- PR URL + optional GitHub token intake
- Optional issue/task text and CI/log snippets
- Criterion-by-criterion evidence report
- Missing-test and scope-creep detection
- Review priority map
- 30-second reviewer card and detailed report
- Demo mode with realistic sample data
- Summary-only recent report history in the browser
- Summary-only share links
- Short-lived summary-only saved report API
- Optional GitHub PR comment posting with a one-time write token
- Env-gated GitHub App webhook, Slack notification, and OpenAI verifier adapters
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

Use `.env.example` as the local template. Do not commit `.env` or `.env.local`; both are ignored.

Optional server integrations are off by default:

- `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`: enables signed webhook intake only. `GITHUB_PRIVATE_KEY` must be a valid PEM private key; local env files may use escaped `\n` newlines. Automated App actions still need installation-token and idempotency storage.
- `SLACK_WEBHOOK_URL`, `AGENTPROOF_NOTIFY_TOKEN`: enables summary-only Slack notifications from trusted internal callers.
- `OPENAI_API_KEY`, `AGENTPROOF_LLM_TOKEN`, optional `OPENAI_MODEL`: enables the structured-output verifier adapter. Missing or invalid output falls back to the deterministic report.

After pulling trusted env into `.env.local`, run the live OpenAI smoke test explicitly:

```bash
pnpm smoke:openai
```

This command calls the configured deployment and prints only pass/fail metadata, not prompts, reports, or secret values.
If Vercel stores a secret as unreadable/sensitive, `vercel env pull` may create a blank placeholder; export the needed value in your shell for that smoke run instead.

Browser recent history, portable share links, Slack payloads, and short-lived saved reports are summary-only. They omit raw evidence, patch/log excerpts, claims, and raw re-prompt text. Full Markdown export remains an explicit user action.

Short-lived saved reports use in-memory storage. This is suitable for local demos, but not durable on serverless deployments. Production sharing needs Postgres/Supabase, ownership/auth, encryption, and retention policy.

## Product Position

It avoids:

- Generic style review comments
- Auto-merge decisions
- Security scanning claims without evidence
- Long-term raw source retention
- Durable server-side report persistence before auth and database are added

## Architecture

- `src/lib/github.ts`: GitHub URL parsing and REST fetch boundary
- `src/lib/extractors.ts`: deterministic requirement, claim, and evidence extraction
- `src/lib/verifier.ts`: evidence scoring and report generation
- `src/lib/structured-output.ts`: JSON schema contract for future LLM calls
- `src/lib/report-validation.ts`: runtime report validation and evidence-ref integrity checks
- `src/lib/report-share.ts`: summary-only portable share links
- `src/lib/server-report-store.ts`: short-lived summary-only saved report store
- `src/lib/report-history.ts`: browser-local summary-only recent report history
- `src/lib/llm-package.ts`: normalized package for future LLM verifier calls
- `src/lib/openai-verifier.ts`: optional OpenAI Responses API structured-output adapter
- `src/lib/evaluation-pack.ts`: real-dataset evaluation harness for benchmark-grounded verifier checks
- `src/lib/github-app.ts`: GitHub App webhook signature/config helpers
- `src/lib/slack.ts`: summary-only Slack notification formatter
- `src/components/*`: reviewer-focused UI
- `src/app/api/analyze/route.ts`: analysis API endpoint
- `src/app/api/github/comment/route.ts`: one-time GitHub PR comment posting endpoint
- `src/app/api/github/webhook/route.ts`: env-gated signed webhook intake endpoint
- `src/app/api/notifications/slack/route.ts`: env-gated Slack notification endpoint
- `src/app/api/llm/verify/route.ts`: env-gated OpenAI verifier endpoint

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

For a fuller review prompt and mobile/manual test checklist, use `docs/review-handoff.md`. For the internal market-validation summary behind this positioning, use `docs/market-validation.md`. For the product goal and next implementation phases, use `docs/final-goals-and-roadmap.md`.

## Evaluation Pack

AgentProof evaluation starts from real benchmark data instead of invented labels. The MVP harness uses SWE-bench Verified rows for issue text, visible patch/test evidence, schema validity, provenance coverage, future-label leakage checks, and false-verified detection. Benchmark outcome labels are used only after report generation.

```bash
pnpm eval:pack
pnpm eval:summary
pnpm eval:summary:fixture
```

Fetch a larger local sample when network is available:

```bash
pnpm eval:fetch:swebench -- --length 10
pnpm eval:pack
pnpm eval:summary
```

One small normalized SWE-bench fixture is committed under `eval/fixtures/` with manifest hashes so CI can run without network; raw hidden oracle labels are not committed. Larger generated normalized cases live under `eval/generated/` and are ignored by git because they may contain short patch excerpts and separated oracle labels. See `docs/evaluation-pack.md` for source caveats and the learning loop.

## Deployed Demo

Current demo deployment:

`https://agentproof-pearl.vercel.app`
