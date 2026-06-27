# Real PR Evaluation

Run date: 2026-06-28 KST.

This note evaluates AgentProof against its own merged PRs as real product-quality examples. It is not a generic code review. The question is whether AgentProof gives a reviewer enough grounded evidence to decide whether an agent-authored PR appears to satisfy its stated request.

Repeatable smoke command:

```bash
AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:real-prs
```

The command intentionally does not read `AGENTPROOF_SMOKE_GITHUB_TOKEN`. These public PR cases should run without forwarding a local GitHub token to production. If a private self-evaluation case is added later, pass `AGENTPROOF_REAL_PR_SMOKE_GITHUB_TOKEN` explicitly.

Saved-report deletion in this smoke is best-effort. The privacy gate is the save/get round trip proving summary-only data; deletion may report `false` on Vercel when short-lived in-memory data is served by a different serverless instance.

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
- Summary-only saved/shared surfaces must omit raw evidence, claims, raw re-prompt, and patch/log excerpts.

## PR Results

| PR | Proxy task | AgentProof result | Human evaluation |
| --- | --- | --- | --- |
| [#1](https://github.com/RengGyu/AgentProof/pull/1) | Broad hardening: evaluation pack, validation, GitHub fallback, execution proof, comment safety, CI, smoke tests, taxonomy docs. | `medium`, 25% coverage, `ciStatus: passed`, 8 extracted requirements, 4 `met`, 4 `partial`, scope suspected for docs. | Conservative and useful. The broad task makes partial findings reasonable. Scope warnings on docs are mostly false positives because taxonomy/docs were explicitly in the PR body. |
| [#2](https://github.com/RengGyu/AgentProof/pull/2) | Saved report durability disclosure and summary-only warning. | `medium`, 39% coverage, `ciStatus: passed`, 6 extracted requirements, 1 `met`, 5 `partial`, CSS scope warning. | Useful but overly conservative. It correctly highlights weak per-requirement execution proof, but misses that API route tests and smoke tests support durability metadata. CSS scope warning is a tolerable false positive. |
| [#3](https://github.com/RengGyu/AgentProof/pull/3) | Add Execution Evidence section and update CI actions. | `medium`, 77% coverage, `ciStatus: passed`, 5 extracted requirements, all `met`, missing-test warnings for workflow and UI file. | Strongest self-check. Requirement matching is good. Missing-test warnings are slightly noisy for workflow/UI display changes, but they are acceptable reviewer prompts rather than blockers. |

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

PR #1 and PR #2 show scope warnings for docs and CSS. These warnings are understandable from path/keyword matching, but a human reviewer would treat them as low-severity because the task explicitly included docs and UI disclosure.

Next improvement: lower scope severity for docs, styles, and copy files when the task text includes taxonomy, README, docs, UI notice, warning, disclosure, or product copy keywords.

### 4. Execution evidence classification needed one more shared boundary

The evaluation surfaced a classifier gap: some paths duplicated execution-signal logic. A check named like `Vercel Preview tests` or `Socket Security coverage tests report` could be treated as execution evidence if the code looked only for strong words such as `tests` or `coverage`.

This branch closes that gap by routing check/log decisions through a source-label-first execution evidence helper. Preview, security, code-owner, policy, deployment, and review gates are excluded before strong execution words are considered.

### 5. Current evidence is enough for MVP evaluation, not enough for full launch confidence

The reports are useful for portfolio/MVP review, but they are not yet a launch-grade verifier. The biggest remaining limitation is that GitHub Actions raw log archives are not ingested. AgentProof sees check names, summaries, statuses, and bounded job-step metadata, not full command output.

## Follow-Up Tickets

1. Add a real PR evaluation fixture format.
   - Store only PR URL, proxy task text, expected high-level outcomes, and bounded expected labels.
   - Do not store raw GitHub API payloads or logs.

2. Improve scope-creep calibration for docs/UI/style files.
   - Lower severity when task text explicitly names docs, README, UI notice, warning, disclosure, taxonomy, or copy.

3. Improve missing-test file matching.
   - Link API route files to route tests, smoke scripts, and report-share/server-store tests by symbol/path family rather than filename only.

4. Add post-deploy self-check for PR #1-#3.
   - Verify `/api/analyze` accepts each PR URL with proxy task text.
   - Assert `ciStatus` is never derived from preview/security/code-owner gates.
   - Assert summary-only saved report remains empty of evidence, claims, and re-prompt text.

5. Keep GitHub Actions raw log ingestion out of MVP unless privacy/cost controls are designed.
   - Raw logs can contain secrets and noisy output.
   - Prefer bounded job-step metadata until a retention/redaction policy exists.
