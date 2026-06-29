# MVP Completion Record

Date: 2026-06-29

This record describes what is complete enough to call AgentProof an MVP, and what remains for a later deployment or launch-readiness phase.

## MVP Definition

AgentProof is an evidence-based verification report for AI-agent pull requests. It answers:

> Is there enough evidence that this agent-authored PR satisfies the original request?

The MVP is complete when a reviewer can run a demo or public PR analysis, see requirement coverage and evidence gaps in about 30 seconds, create summary-only handoff links, and verify that optional integrations are fail-closed.

## Completed Scope

- PR URL, pasted evidence, and demo scenario analysis.
- Requirement extraction and agent-claim extraction.
- Evidence index generation with source type, locator, confidence, and concise evidence text.
- Requirement status classification: `met`, `partial`, `missing`, `unclear`.
- Scope-creep detection with finding-level provenance.
- Missing-test detection with finding-level provenance.
- Test/build, lint, and typecheck separation.
- Review priority map.
- Agent re-prompt generator.
- 30-second report card, detailed report, Markdown export, PR comment copy, and share links.
- Browser recent history as summary-only.
- Server saved reports as summary-only, with in-memory mode and optional Supabase durability.
- GitHub PR comment posting with a one-time token and PR provenance safety.
- GitHub App webhook signed dry-run boundary, with explicit allowlist automation, durable duplicate suppression, and separate comment/save opt-ins.
- Token-gated GitHub App operator diagnostics with bounded status categories and no secret or raw evidence exposure.
- Slack summary-only notification endpoint.
- OpenAI structured-output verifier adapter with runtime validation and deterministic fallback.
- SWE-bench Verified evaluation harness and committed fixtures.
- Production deployment and live integration smoke validation.

## Evidence Artifacts

- Example reports and screenshots: `docs/example-reports.md`
- Deployment smoke checklist and last live validation record: `docs/deployment-smoke.md`
- No-secret local validation: `docs/local-demo-validation.md`
- Real PR evaluation notes: `docs/real-pr-evaluation.md`
- Security and storage boundaries: `docs/saved-report-storage.md`, `docs/github-app-webhook.md`

## Last Verified Production State

Production alias:

https://agentproof-pearl.vercel.app

Last no-secret production gate: 2026-06-29, after the MVP readiness changes were merged to `main`.

Verified outcomes:

- `/` returned 200.
- `/integrations` returned 200.
- `/api/analyze` rejected GET with 405.
- Production regression smoke passed for six public AgentProof PRs.
- Saved reports used `summary-only-supabase`.
- Unauthenticated OpenAI verifier requests returned 401.
- Unauthenticated Slack notification requests returned 401.
- Unsigned GitHub webhook requests returned 401.
- Unauthenticated operator diagnostics returned 401 after `AGENTPROOF_OPS_TOKEN` was configured.

Most recent credentialed live integration pass:

- OpenAI verifier returned `source: openai`.
- Slack notification returned `{ "sent": true }`.
- GitHub signed webhook returned `dryRun: true`, `automationEnabled: false`, `willAnalyze: false`, `willComment: false`.
- Controlled GitHub App live automation persistence check recorded one completed PR analysis with summary-only durability and no comment/save side effects.
- GitHub PR comment smoke created an AgentProof marker comment on PR #18.

## Why This Is Not A Generic AI Code Reviewer

- The report starts from the original request and checks evidence sufficiency.
- Findings cite deterministic evidence IDs, paths, checks, logs, or explicit gaps.
- Weak or unavailable evidence becomes `partial`, `unclear`, `unknown`, or a limitation.
- It does not claim merge safety, security coverage, or code correctness without supporting evidence.
- It helps a human decide what to inspect or ask the coding agent to fix next.

## Deferred Until After MVP

- GitHub App installation UI and ongoing automation dashboard.
- Organization dashboards, analytics, Jira integration, or Slack OAuth.
- Durable raw diff or raw log storage.
- Auto-merge, merge-blocking checks, or policy enforcement.
- Dedicated security scanning claims without specialized tools.
- Native mobile app or PWA packaging.

## Next Launch-Readiness Work

- Add public source-backed market-validation citations.
- Add a short demo video or GIF after the UI stabilizes.
- Keep operator diagnostics and live smoke runbooks current as integration settings change.
- Improve GitHub private-repo guidance and token permission diagnostics.
- Continue calibration against larger real PR and SWE-bench samples.
