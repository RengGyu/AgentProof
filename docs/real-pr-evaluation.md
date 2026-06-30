# Real PR Evaluation

Run date: 2026-06-28 KST.

This note evaluates AgentProof against its own merged PRs as real product-quality examples. It is not a generic code review. The question is whether AgentProof gives a reviewer enough grounded evidence to decide whether an agent-authored PR appears to satisfy its stated request.

Repeatable smoke command:

```bash
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:real-prs
```

`pnpm smoke:production-regression` is an alias for the same self-evaluation batch.

The command intentionally does not read `AGENTPROOF_SMOKE_GITHUB_TOKEN`. These public PR cases should run without forwarding a local GitHub token to production. If a private self-evaluation case is added later, pass `AGENTPROOF_REAL_PR_SMOKE_GITHUB_TOKEN` plus `AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN=1` explicitly.

Optional production performance budgets can fail the same smoke when p95 timing evidence exceeds configured thresholds:

```bash
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app \
AGENTPROOF_SMOKE_MAX_TOTAL_P95_MS=3000 \
AGENTPROOF_SMOKE_MAX_EVIDENCE_P95_MS=2500 \
AGENTPROOF_SMOKE_MAX_GITHUB_CHECKS_P95_MS=1500 \
AGENTPROOF_SMOKE_MAX_GITHUB_STATUSES_P95_MS=1500 \
AGENTPROOF_SMOKE_MAX_GITHUB_JOBS_P95_MS=1500 \
pnpm smoke:production-regression
```

These budgets are regression guardrails, not an availability or latency SLA. A single failure can reflect temporary GitHub or Vercel latency; repeated failures in the same phase should be investigated before reducing evidence collection.

Saved-report deletion in this smoke is best-effort. The privacy gate is the save/get round trip proving summary-only data. In in-memory mode, deletion may report `false` on Vercel when a different serverless instance handles the request. With Supabase-backed summary storage, deletion should be durable and API-visible unless the backend is unavailable.

Summary-only saved/share reports still may include PR URL/title, requirement text, missing-test paths, and review-priority paths. They must not include raw evidence, claims, raw re-prompt text, patch/log excerpts, raw annotation details, or failed annotation `path:line` values copied from full execution evidence.

## Method

Original issue or prompt text was not available for these PRs, so each evaluation uses the merged PR body as a proxy task. That is a limitation: PR bodies can describe the implementation after the fact, so they are easier than a true issue-to-PR verification task.

For each PR, the evaluation checked:

- Requirement extraction from the proxy task.
- Whether `met` findings had implementation evidence and passing execution evidence.
- Missing-test and scope-creep findings.
- Execution evidence from GitHub checks and job-step metadata.
- Privacy boundaries: no durable raw diff/log/claims/re-prompt in summary-only surfaces.
- Product-position drift: no auto-merge, broad security scanner, or generic AI code-review framing.

Strict gate:

- Full reports must pass `validateVerificationReport(report, { mode: "full" })`.
- Evidence references must point to existing evidence IDs or the report must state the gap.
- Passing CI must come from test/build/CI execution evidence, not preview, security, code-owner, policy, deployment, or AI-review gates.
- The real PR smoke also emits a deterministic `qualityGate`: requirement findings must exist, every `met` requirement must cite passing execution evidence, reviewer leads must keep evidence references and full-report provenance, and reports must avoid merge-decision wording.
- Summary-only saved/shared surfaces must omit raw evidence, claims, raw re-prompt, and patch/log excerpts.

The `qualityGate` is not a product score. It is a regression guard for report trust boundaries.

`pnpm eval:sentinels` covers a separate reviewer-signal sentinel suite. Sentinel means a guard test that fails when a documented reviewer handoff signal disappears. The suite checks expected top risks, missing-test paths, scope paths, failed execution handling, vague-task uncertainty, visual-proof gaps, summary-only privacy, and deterministic re-prompt usefulness.

## PR Results

| PR | Proxy task | AgentProof result | Human evaluation |
| --- | --- | --- | --- |
| [#1](https://github.com/RengGyu/AgentProof/pull/1) | Broad hardening: evaluation pack, validation, GitHub fallback, execution proof, comment safety, CI, smoke tests, taxonomy docs. | `medium`, 25% coverage, `ciStatus: passed`, 8 extracted requirements, 4 `met`, 4 `partial`, scope suspected for docs. | Conservative and useful. The broad task makes partial findings reasonable. Scope warnings on docs are mostly false positives because taxonomy/docs were explicitly in the PR body. |
| [#2](https://github.com/RengGyu/AgentProof/pull/2) | Saved report durability disclosure and summary-only warning. | `medium`, 39% coverage, `ciStatus: passed`, 6 extracted requirements, 1 `met`, 5 `partial`, CSS scope warning. | Useful but overly conservative. It correctly highlights weak per-requirement execution proof, but misses that API route tests and smoke tests support durability metadata. CSS scope warning is a tolerable false positive. |
| [#3](https://github.com/RengGyu/AgentProof/pull/3) | Add Execution Evidence section and update CI actions. | `medium`, 77% coverage, `ciStatus: passed`, 5 extracted requirements, all `met`, missing-test warnings for workflow and UI file. | Strongest self-check. Requirement matching is good. Missing-test warnings are slightly noisy for workflow/UI display changes, but they are acceptable reviewer prompts rather than blockers. |
| [#9](https://github.com/RengGyu/AgentProof/pull/9) | Refresh AgentProof UI/UX for mobile and portfolio readiness while preserving evidence-verifier positioning and summary-only privacy. | Pre-fix production run: `medium`, 29% coverage, `ciStatus: passed`, 1 `met`, 5 `partial`, scope warnings on UI/docs/report files. Local post-fix run: `medium`, 42% coverage, `ciStatus: passed`, no scope warnings, visual requirements remain `partial` without browser/screenshot evidence. | Useful and now better calibrated. The report correctly refuses to treat CI as visual proof, but no longer over-flags in-scope UI/docs/report files. Missing-test warnings remain conservative for UI/API files with only broad test evidence. |
| [#12](https://github.com/RengGyu/AgentProof/pull/12) | Improve GitHub execution evidence matching and false-positive guards for CI/job-step metadata. | Production dogfood run: `medium`, 61% coverage, `ciStatus: passed`, 4 extracted requirements, summary-only save round trip passed. | Good regression case for the current evidence boundary. It checks that GitHub job-step metadata can support execution proof while broad or non-execution gates stay reviewer leads. |
| [#15](https://github.com/RengGyu/AgentProof/pull/15) | Surface failed check locations safely while keeping summary-only surfaces free of annotation path/details leakage. | Production dogfood run: `medium`, 54% coverage, `ciStatus: passed`, 4 extracted requirements, summary-only save round trip passed. | Useful privacy regression case. It confirms the feature remains framed as bounded execution-evidence provenance, while full UI rendering still needs separate browser QA for visual confidence. |

## Findings

### 1. Requirement scoring is appropriately conservative on broad tasks

PR #1 and PR #2 show that AgentProof does not eagerly mark every broad hardening requirement as satisfied. This is aligned with the product: a reviewer should see weak proof rather than a false "all good" signal.

Residual risk: broad PR bodies that list implementation details can inflate requirement extraction quality compared with true issue prompts.

### 2. Missing-test detection catches weak execution proof, but file-level mapping is still blunt

AgentProof flags behavior-affecting files when no clearly matching executed test evidence is attached. That is useful for a 30-second reviewer handoff.

False-positive risk remains for:

- UI-only display components with existing indirect test coverage.
- Workflow changes where CI itself is the execution evidence.
- Server store or API route changes when tests are present but file-name matching is indirect.

### 3. Scope-creep detection is useful but over-flags docs/CSS in explicitly broad product tasks

PR #1, PR #2, and the pre-fix PR #9 run show scope warnings for docs, CSS, and report UI files. These warnings are understandable from path/keyword matching, but a human reviewer would treat many of them as low-severity because the task explicitly included docs, UI disclosure, or portfolio copy.

Current improvement target: lower scope severity for docs, styles, report, share, export, and copy files when the task text explicitly names those surfaces. Do not use patch text alone to clear scope risk, because an unrelated risky file can mention requirement words incidentally.

### 4. Execution evidence classification needed one more shared boundary

The evaluation surfaced a classifier gap: some paths duplicated execution-signal logic. A check named like `Vercel Preview tests` or `Socket Security coverage tests report` could be treated as execution evidence if the code looked only for strong words such as `tests` or `coverage`.

This branch closes that gap by routing check/log decisions through a source-label-first execution evidence helper. Preview, security, code-owner, policy, deployment, and review gates are excluded before strong execution words are considered.

### 5. Current evidence is enough for MVP evaluation, not enough for full launch confidence

The reports are useful for portfolio/MVP review, but they are not yet a launch-grade verifier. The biggest remaining limitation is that GitHub Actions raw log archives are not ingested. AgentProof sees check names, summaries, statuses, bounded job-step metadata, and bounded failed-check annotation locations, not full command output or raw annotation messages.

### 6. Visual UX criteria need browser or screenshot evidence

PR #9 surfaced a separate evidence class: mobile layout, overlap, readability, and responsive behavior cannot be proven by unit tests or build success alone. AgentProof should keep these requirements partial unless browser QA, Playwright, screenshot, viewport, or equivalent visual evidence is present.

## Follow-Up Tickets

1. Add a real PR evaluation fixture format.
   - Store only PR URL, proxy task text, expected high-level outcomes, and bounded expected labels.
   - Do not store raw GitHub API payloads or logs.

2. Improve scope-creep calibration for docs/UI/style files.
   - Lower severity when task text explicitly names docs, README, UI notice, warning, disclosure, taxonomy, report, share, export, or copy.
   - Keep unrelated risky files flagged when only patch text mentions requirement words.

3. Improve missing-test file matching.
   - Current v3 links API route files to smoke tests that exercise the same endpoint, generic test files that name the changed component symbol, and passing CI/check metadata that names an unchanged test path, endpoint, or component symbol.
   - Broad test evidence such as `pnpm test` remains a reviewer lead, not proof, when no endpoint, path, or symbol match exists.
   - Generic CI/build summaries and job steps that only describe preview, deployment, security, policy, or report gates stay outside execution proof.

4. Keep post-deploy self-check current for PR #1-#3, PR #9, PR #12, and PR #15.
   - Verify `/api/analyze` accepts each PR URL with proxy task text.
   - Assert `ciStatus` is never derived from preview/security/code-owner gates.
   - Assert summary-only saved report remains empty of evidence, claims, and re-prompt text.
   - Assert saved reports do not retain failed annotation `path:line` values from full execution evidence.
   - Assert visual/mobile requirements stay partial unless visual QA evidence is present.

5. Keep GitHub Actions raw log ingestion out of MVP unless privacy/cost controls are designed.
   - Raw logs can contain secrets and noisy output.
   - Prefer bounded job-step metadata until a retention/redaction policy exists; keep filtering setup, artifact, preview, deploy, and report steps out of execution evidence.
   - Failed execution check annotations can localize failures by `path:line` in full reports, exports, and intentional comments, but raw annotation messages/details and summary-share surfaces should stay omitted.
