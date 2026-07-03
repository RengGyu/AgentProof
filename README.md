# AgentProof

AgentProof creates evidence-based verification reports for AI-generated pull requests. It answers: "Is there enough evidence that this agent-authored PR satisfies the original request?"

It is deliberately not a generic diff-first review bot. AgentProof maps the original issue, task, or prompt to acceptance criteria, checks whether the PR has evidence for each criterion, highlights weak tests and scope creep, and produces a short re-prompt for the coding agent. It supports human merge decisions; it does not replace them.

## What Reviewers Get

- PR URL + optional GitHub token intake
- Optional issue/task text and CI/log snippets
- Criterion-by-criterion evidence report
- Missing-test and scope-creep detection
- Review priority map
- 30-second reviewer card and detailed report
- Demo mode with realistic sample data
- Summary-only recent report history in the browser
- Summary-only share links
- Summary-only saved report links for short handoff
- Optional GitHub PR comment posting with a one-time write token

## First Real PR Workflow

1. Open the deployed demo or run the app locally.
2. Paste a public GitHub PR URL.
3. Add the original task or issue text when the PR does not clearly link it.
4. Review the first screen for the evidence answer, requirement status counts, top risks, first files to inspect, missing-test count, execution evidence status, and next re-prompt.
5. Use summary-only share links for handoff, or export Markdown only when you intentionally want the full report.

For a guided 10-minute path, see `docs/first-real-pr-report.md`.

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Demo Path

The deployed demo works without secrets: `https://agentproof-pearl.vercel.app`.

Use the left demo selector to compare the intended verifier signals:

- `Clean PR`: password reset work with matching tests and passing checks. Expect low risk and mostly met requirements.
- `Scope creep`: password reset work plus unrelated auth/session files. Expect out-of-scope file warnings.
- `Missing tests`: invoice CSV export with lint/typecheck only. Expect missing targeted test evidence.
- `Failed CI`: workspace invite validation with a failing unit-test log. Expect a blocker from failed execution evidence.
- `Vague task`: dashboard polish without concrete acceptance criteria. Expect unclear coverage and low confidence.

The demo is a verification handoff, not an approval gate. Share links and Recent history are summary-only; full Markdown export and PR comment copy are explicit user actions.

For frozen portfolio artifacts, see `docs/example-reports.md`. For the MVP completion record and the latest deployment smoke checklist, see `docs/mvp-completion.md` and `docs/deployment-smoke.md`.

## Validate

```bash
pnpm test
pnpm typecheck
pnpm eval:sentinels
pnpm build
```

`pnpm eval:sentinels` is a deterministic reviewer-signal guard, not a product score. It checks that documented demo reports still expose scope creep, missing tests, failed execution, vague-task uncertainty, visual-proof gaps, summary-only privacy, and useful re-prompt leads.

## Privacy Boundary

AgentProof can run in demo mode without secrets. For live PR fetches, a fine-grained GitHub token may be pasted for that request only; it is not stored. Browser recent history, portable share links, Slack payloads, and saved reports are summary-only. They omit raw evidence, patch/log excerpts, claims, evidence references, and raw re-prompt text. Full Markdown export remains an explicit user action.

## Production Smoke

Use the manual GitHub Actions workflow `AgentProof Production Smoke` after a production deployment or integration change. It checks public pages, confirms `GET /api/analyze` still fails closed, and runs the real public PR regression set against the deployed app.

The smoke includes a deterministic `qualityGate` for report trust boundaries: requirement findings exist, `met` findings cite passing execution evidence, reviewer leads keep provenance, summary-only storage stays summary-only, and the report avoids merge-decision wording. This is not a product score; it is a regression guard for the evidence report contract.

The default workflow inputs enforce loose p95 (95th percentile) budgets: total response `3000ms`, evidence collection `2500ms`, and GitHub check/status/job phases `1500ms`. These budgets are guardrails, not product promises. If one manual run fails during a GitHub or Vercel blip, rerun once; repeated failures should be treated as an evidence-collection regression.

This workflow does not require secrets and should not receive tokens in the `base_url` input. For local or one-off terminal checks, use:

```bash
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app \
AGENTPROOF_SMOKE_MAX_TOTAL_P95_MS=3000 \
AGENTPROOF_SMOKE_MAX_EVIDENCE_P95_MS=2500 \
AGENTPROOF_SMOKE_MAX_GITHUB_CHECKS_P95_MS=1500 \
AGENTPROOF_SMOKE_MAX_GITHUB_STATUSES_P95_MS=1500 \
AGENTPROOF_SMOKE_MAX_GITHUB_JOBS_P95_MS=1500 \
pnpm smoke:production-regression
```

## Advanced Setup

Optional integrations are off by default. Keep automatic GitHub App comments disabled until a repository owner explicitly opts in, and keep billing, tenant, ops, and deletion controls out of the first demo path. Use these advanced docs when needed:

- `docs/deployment-smoke.md` for production smoke, live integration checks, and cron policy.
- `docs/github-app-webhook.md` and `docs/github-app-onboarding.md` for GitHub App automation and design-partner setup.
- `docs/saved-report-storage.md` for summary-only saved report durability.
- `docs/public-launch-trust.md` for product, privacy, billing beta, and support boundaries.
- `docs/tenant-data-retention.md` for retention/deletion planning.

Live smoke commands such as OpenAI, webhook, GitHub comment, or Slack checks should be run intentionally from their linked runbooks. They print bounded metadata only and must not print tokens, prompts, raw reports, diffs, or logs.

## Check Evidence Taxonomy

AgentProof separates test/build execution proof from other GitHub checks:

- `Test/Build` status is backed only by check or log names/summaries that look like test, spec, unit, integration, e2e, coverage, CI, or build execution.
- Passing security reports, code-owner checks, dependency scans, deploy previews, and AI review checks do not prove tests or builds ran.
- Generic `CI` or `build` checks are not promoted when their summaries only mention preview, deployment, security, policy, or report gates.
- Failing non-test/build checks are still surfaced as high-priority static or merge-gate risks.
- Lint and typecheck remain separate status fields, even when they come from GitHub checks.
- Requirement `met` status still requires passing execution evidence linked through evidence IDs.
- GitHub Actions fallback collects bounded job/step metadata when available, keeps only execution-like steps such as test/build commands, and never fetches or stores raw log archives in this MVP.
- Failed execution checks may include bounded Check Run annotation locations such as `path:line`; full annotation messages, raw annotation details, and raw log archives are not fetched or stored.
- Failed check locations appear only in full reports, Markdown exports, and intentional PR comments; summary share links and saved reports remain summary-only.

## Product Position

It avoids:

- Generic style review comments
- Auto-merge decisions
- Security scanning claims without evidence
- Long-term raw source, log, or full-report retention

## Why Not A Diff-First Review Bot?

Diff-first review tools usually start from the changed files and produce review comments. AgentProof starts from the original issue, task, or prompt and asks whether the agent-authored PR has enough evidence to satisfy it.

AgentProof does not decide whether to merge. It gives a human reviewer a compact evidence report: requirement coverage, missing proof, scope creep, risky files, test/build signals, and the next prompt to send back to the coding agent.

## Architecture

- `src/lib/github.ts`: GitHub URL parsing and REST fetch boundary
- `src/lib/extractors.ts`: deterministic requirement, claim, and evidence extraction
- `src/lib/verifier.ts`: evidence scoring and report generation
- `src/lib/structured-output.ts`: JSON schema contract for future LLM calls
- `src/lib/report-validation.ts`: runtime report validation and evidence-ref integrity checks
- `src/lib/report-share.ts`: summary-only portable share links
- `src/lib/server-report-store.ts`: summary-only saved report store with in-memory and optional Supabase backends
- `src/lib/audit-log.ts`: bounded audit event writer and privacy scanner for SaaS automation metadata
- `src/lib/analysis-jobs.ts`: metadata-only async analysis job queue, tenant summaries, and aggregate queue metrics
- `src/lib/analysis-worker.ts`: operator-gated queued analysis execution with single-job and bounded-batch flows
- `src/lib/report-history.ts`: browser-local summary-only recent report history
- `src/lib/llm-package.ts`: normalized package for future LLM verifier calls
- `src/lib/openai-verifier.ts`: optional OpenAI Responses API structured-output adapter
- `src/lib/evaluation-pack.ts`: real-dataset evaluation harness for benchmark-grounded verifier checks
- `src/lib/github-app.ts`: GitHub App webhook signature, installation-token, opt-in, and idempotency helpers
- `src/lib/github-onboarding.ts`: invite-only GitHub App onboarding state, activation session, and repository metadata helpers
- `src/lib/tenant-dashboard-client.ts`: client-side tenant dashboard request builders that keep invite tokens out of URLs and PATCH bodies
- `src/lib/tenant-retention-policy.ts`: draft tenant data retention policy matrix and deletion-preview coverage helper
- `src/lib/tenant-deletion-state.ts`: metadata-only tenant deletion-state guard for enqueue, grant authorization, and grant mutation boundaries
- `src/lib/tenant-deletion-execution.ts`: internal metadata-only deletion execution planner, grant-block phase, and guarded analysis-job purge boundary
- `src/lib/usage-quota.ts`: tenant analysis quota reservation and read-only status helpers
- `src/lib/slack.ts`: summary-only Slack notification formatter
- `src/components/*`: reviewer-focused UI and invite-only tenant setup panel
- `src/app/api/analyze/route.ts`: analysis API endpoint
- `src/app/api/github/comment/route.ts`: one-time GitHub PR comment posting endpoint
- `src/app/tenant/page.tsx`: invite-only tenant setup dashboard for GitHub App activation, repo grants, and setup health
- `src/app/api/tenants/repositories/route.ts`: invite-only tenant repo verification settings endpoint
- `src/app/api/tenants/repositories/health/route.ts`: metadata-only tenant repository setup health endpoint
- `src/app/api/tenants/usage/route.ts`: tenant-bound usage summary endpoint
- `src/app/api/tenants/analysis-jobs/route.ts`: tenant-bound async analysis job summary endpoint
- `src/app/api/tenants/reports/route.ts`: tenant-bound recent summary report list endpoint
- `src/app/api/tenants/audit-activity/route.ts`: tenant-bound recent verification activity endpoint with flattened summary-only output
- `src/app/api/tenants/deletion-preview/route.ts`: tenant-bound count-only deletion dry-run endpoint
- `src/app/api/github/webhook/route.ts`: env-gated signed webhook intake endpoint
- `src/app/api/ops/analysis-jobs/preflight/route.ts`: operator-gated queued worker preflight endpoint
- `src/app/api/ops/analysis-jobs/run/route.ts`: operator-gated single queued job execution endpoint
- `src/app/api/ops/analysis-jobs/run-batch/route.ts`: operator-gated bounded queued job batch execution endpoint
- `src/app/api/ops/analysis-jobs/dead-letter/route.ts`: operator-gated read-only terminal failure summary endpoint
- `src/app/api/ops/analysis-jobs/alerts/slack/route.ts`: operator-gated summary-only Slack queue alert endpoint
- `src/app/api/ops/drill-gate/route.ts`: operator-gated metadata-only launch drill evidence gate
- `src/app/api/ops/tenants/deletion/route.ts`: operator-gated metadata-only tenant deletion plan and block-new-work phase; destructive purge is not exposed
- `src/app/api/cron/analysis-jobs/run/route.ts`: token-gated scheduled bounded queued job batch endpoint
- `src/app/api/notifications/slack/route.ts`: env-gated Slack notification endpoint
- `src/app/api/llm/verify/route.ts`: env-gated OpenAI verifier endpoint

The current verifier is deterministic so the MVP can be tested without an LLM key. Future LLM calls should preserve the same JSON shape, pass runtime validation, and only cite known evidence IDs.

## Review Handoff Prompt

Use this prompt when asking another model to review the repository:

```text
Review this repository as AgentProof, an evidence-based verifier for AI-generated PRs.
It should not act like a generic diff-first review bot. Focus on requirement-to-evidence mapping,
scope creep detection, missing-test detection, GitHub PR ingestion, token/privacy handling,
mobile report UX, and whether every finding is traceable to evidence.
Prioritize bugs, false positives, security issues, missing tests, and workflow gaps.
```

For a fuller review prompt and mobile/manual test checklist, use `docs/review-handoff.md`. For no-secret local demo checks, use `docs/local-demo-validation.md`. For example report artifacts, use `docs/example-reports.md`. For deployment smoke checks, use `docs/deployment-smoke.md`. For saved-report storage setup, use `docs/saved-report-storage.md`. For tenant data retention and deletion planning, use `docs/tenant-data-retention.md`. For GitHub App webhook automation boundaries, use `docs/github-app-webhook.md`; for invite-only GitHub App onboarding, use `docs/github-app-onboarding.md`; for the controlled live smoke procedure, use `docs/github-app-live-smoke-runbook.md`. For the internal market-validation summary behind this positioning, use `docs/market-validation.md`. For the final SaaS goal, tenant/billing/operations gates, and next implementation tickets, use `docs/final-goals-and-roadmap.md`.

## Evaluation Pack

AgentProof evaluation starts from real benchmark data instead of invented labels. The MVP harness uses SWE-bench Verified rows for issue text, visible patch/test evidence, schema validity, provenance coverage, future-label leakage checks, and false-verified detection. Benchmark outcome labels are used only after report generation.

```bash
pnpm eval:pack
pnpm eval:summary
pnpm eval:summary:strict
pnpm eval:summary:fixture
pnpm eval:summary:fixture:strict
```

Fetch a larger local sample when network is available:

```bash
pnpm eval:fetch:swebench -- --length 10   # quick local smoke
pnpm eval:fetch:swebench -- --length 100  # broader local check
pnpm eval:pack
pnpm eval:summary
pnpm eval:summary:strict
```

Promote selected generated cases into committed fixtures only after reviewing case IDs and source metadata:

```bash
pnpm eval:promote:fixture -- \
  --input eval/generated/swebench-verified.cases.jsonl \
  --output eval/fixtures/swebench-verified.example.jsonl \
  --case astropy__astropy-12907 \
  --source-offset 0 \
  --source-length 100
pnpm eval:summary:fixture:strict
```

Committed normalized SWE-bench fixtures live under `eval/fixtures/` with manifest hashes so CI can run without network: one small smoke case, a representative four-case pack, and a diverse ten-repository pack. Raw hidden oracle labels are not committed. Larger generated normalized cases live under `eval/generated/` and are ignored by git because they may contain short patch excerpts and separated oracle labels. See `docs/evaluation-pack.md` for source caveats and the learning loop.

## Deployed Demo

Current demo deployment:

`https://agentproof-pearl.vercel.app`
