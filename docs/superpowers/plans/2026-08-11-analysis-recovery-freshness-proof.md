# Analysis Recovery, Freshness, and Proof Implementation Plan

**Goal:** Converge each PR head to one recoverable current report and make evidence coverage valid for positive, negative, and mixed requirements.

**Architecture:** Use an atomic canonical queue row with revision fencing, a Supabase Cron recovery trigger, a server-only job/report freshness join, and additive deterministic proof axes. Preserve the existing report and privacy contracts.

**Tech stack:** Next.js route handlers, TypeScript, Vitest, Supabase Postgres/RPC/Cron/Vault, Vercel.

## Global Constraints

- Deterministic evidence remains authoritative; LLM output cannot create proof axes or promote status.
- No raw webhook, source, log, provider, token, or secret persistence.
- No fixture-specific identifiers, text, paths, or prompt tuning.
- Existing public JSON fields remain compatible; new metadata is additive and bounded.
- Side effects occur only after a canonical revision fence.
- Scheduler output and dashboard freshness metadata are summary-only.

### Task 1: Canonical queue and recovery

**Files:** `src/lib/analysis-jobs.ts`, `src/lib/analysis-jobs.test.ts`, `src/app/api/github/webhook/route.ts`, `src/app/api/github/webhook/route.test.ts`, `src/app/api/openai/webhook/route.ts`, `src/app/api/openai/webhook/route.test.ts`, `src/lib/analysis-worker.ts`, `src/lib/analysis-worker.test.ts`, `src/app/api/cron/analysis-jobs/run/*`, `supabase/migrations/202608110001_analysis_jobs_canonical_recovery.sql`, `vercel.json` if needed.

1. Add RED tests for same-head event coalescing, head separation, refresh revisions, stale-claim fencing, provider expiry fallback, and recovery batches.
2. Add the canonical queue identity, atomic enqueue/refresh RPC, desired/running revision fields, and privacy validation.
3. Remove immediate GitHub job claims; debounce canonical work and rely on the bounded worker trigger.
4. Fence stale revisions before all side effects.
5. Add the Vault-backed Supabase Cron recovery migration and safe operational setup instructions.
6. Run focused queue, webhook, worker, cron, privacy, and migration tests.

### Task 2: Freshness-aware dashboard and copy

**Files:** `src/lib/analysis-jobs.ts`, `src/app/api/dashboard/reports/route.ts`, `src/app/api/dashboard/reports/route.test.ts`, `src/lib/github-dashboard-view-model.ts`, `src/lib/github-dashboard-view-model.test.ts`, `src/components/PublicGitHubDashboard.tsx`, `src/components/PublicGitHubDashboard.test.ts`, `src/lib/dashboard-report-export.ts`, relevant component tests.

1. Add RED tests for refreshing, refresh-failed, superseded, out-of-order completed, legacy, lookup-failure, and truncated bundle cases.
2. Add an internal exact latest-job lookup without exposing job/provider metadata.
3. Return bounded freshness envelopes and only copy-eligible current details.
4. Remove cached bulk-copy payload reuse; re-fetch and fail closed on every attempt.
5. Make list, Quick Summary, detail copy, and bulk copy use the resolved freshness state.
6. Run focused route, view-model, component, export, and privacy tests.

### Task 3: Multi-axis deterministic proof

**Files:** `src/lib/types.ts`, `src/lib/verifier-proof-expectations.ts`, `src/lib/verifier.ts`, `src/lib/verifier.test.ts`, `src/lib/report-validation.ts`, `src/lib/report-validation.test.ts`, `src/lib/llm-semantic-package.ts`, relevant tenant/report validation tests.

1. Add RED tests for absence-only, violated absence, incomplete inventory, mixed test+absence, docs+absence, CI+absence, and legacy report compatibility.
2. Add compatible proof-axis types and complete-inventory basis.
3. Replace the negative-constraint early return with clause-aware independent axes.
4. Aggregate requirement status from every required axis and emit deterministic violation/unavailability gaps.
5. Validate `met` from proof axes; retain conservative legacy validation when axes are absent.
6. Ensure semantic input reads axes but cannot mutate them; run focused verifier/schema/privacy tests.

### Task 4: Integration, production, and live evidence

1. Run the full Vitest suite, typecheck, lint, build, and `git diff --check`.
2. Run an independent whole-branch review and resolve all P0/P1 findings.
3. Commit and push the implementation branch, apply migrations, provision the Vault scheduler secret without printing it, and deploy production.
4. Verify the scheduler and queue with metadata-only queries.
5. Push one fresh commit to each of the 14 evaluation PR branches.
6. Verify every expected head has one canonical completed result, zero stranded processing jobs, correct freshness, and no invalid negative-constraint terminal failures.
7. Export the 14 reports and compare structural outcomes against the scenario oracle.
