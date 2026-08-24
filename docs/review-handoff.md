# AgentProof Review Handoff

Use this when asking ChatGPT, Claude, Codex, or another reviewer to inspect the public repository.

Repository:

`https://github.com/RengGyu/AgentProof`

Deployed demo:

`https://agentproof-pearl.vercel.app`

## Review Prompt

```text
Audit this repository as an AgentProof product-quality verification tool.

Project context:
AgentProof is an evidence-based verifier for AI-generated PRs. It should not behave like a generic AI code reviewer. Its job is to map issue/task requirements to PR evidence, identify weak proof, detect scope creep, surface missing test evidence, and generate a concise re-prompt for a coding agent.

Please prioritize:
- false positives in requirement-to-evidence matching
- false negatives in missing-test and scope-creep detection
- GitHub PR ingestion edge cases
- token/privacy handling
- mobile report UX
- whether every finding is traceable to concrete evidence
- tests that are missing for high-risk behavior

Do not focus on cosmetic refactors unless they affect usability or correctness.
Return findings first, ordered by severity, with file paths and exact suggested fixes.
```

## Manual Test Checklist

- Open the deployed demo on mobile and desktop.
- Run each demo scenario: Clean PR, Scope creep, Missing tests, Failed CI, Vague task.
- Confirm the priority, evidence coverage, missing-test count, and re-prompt change between scenarios.
- Switch to manual mode and analyze a public GitHub PR URL without a token.
- For live PR smoke testing, run `AGENTPROOF_SMOKE_PR_URL=<public PR URL> AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:analyze-pr` and confirm it prints only report metadata plus summary-only saved-report privacy counts.
- For AgentProof self-evaluation smoke testing, run `AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:production-regression` and confirm PR #1-#3, PR #9, PR #12, and PR #15 all analyze successfully with summary-only saved-report boundaries.
- Do not forward a GitHub token to production smoke runs unless deliberately testing private PR access; set `AGENTPROOF_REAL_PR_SMOKE_GITHUB_TOKEN` plus `AGENTPROOF_ALLOW_PRODUCTION_GITHUB_TOKEN=1` only for that explicit private-token mode.
- For live GitHub comment smoke testing, run `AGENTPROOF_COMMENT_SMOKE_PR_URL=<target PR URL> AGENTPROOF_COMMENT_SMOKE_GITHUB_TOKEN=<fine-grained comment write token> pnpm smoke:github-comment` only when you intentionally want to create or update an AgentProof marker comment. Confirm output includes only action, URL, priority, and evidence metadata.
- Review `docs/github-app-webhook.md` and confirm GitHub App automation remains opt-in: default dry-run, repository allowlist required for analysis, separate comment opt-in, and no raw payload/token persistence.
- Review `docs/saved-report-storage.md` and confirm saved reports remain summary-only in both in-memory and optional Supabase modes.
- Confirm public PR URL analysis shows explicit limitations when test/build logs are unavailable and does not claim tests passed from security, code-owner, deploy-preview, or AI-review checks.
- Confirm failed execution check annotations, when present, are summarized only as bounded `path:line` locations and never include raw annotation messages or raw details.
- Confirm summary-only saved/share pages may still include PR URL/title, requirement text, missing-test paths, and review-priority paths, but never raw evidence, claims, raw re-prompt text, raw annotation details, or failed annotation `path:line` values copied from full execution evidence.
- Paste task text plus changed file names, then confirm the report still works without GitHub access.
- Use Copy Report, Copy PR Comment, Download, and Copy re-prompt.
- Use Copy Share Link and confirm the opened shared page omits raw evidence.
- Confirm Recent reports reload locally and Clear removes them.
- Preview a GitHub PR comment and verify it is short, marker-based, and does not include raw evidence.
- Check that long file paths and evidence summaries do not overflow on mobile.

## Receipt-Gated Promotion and Authority Boundary Checks

Use these checks when a candidate changes requirement-local proof, pasted
evidence, report import, or sharing behavior. They complement the general
demo checklist; they do not authorize protected evaluation or production
deployment.

### Automated checks

```bash
pnpm vitest run \
  src/lib/report-runtime-validation-authority.test.ts \
  src/lib/github-pasted-provenance.test.ts \
  src/lib/evidence-receipts.test.ts \
  src/lib/proof-promotion-policy.test.ts \
  src/lib/report-validation.test.ts
pnpm test
pnpm typecheck
pnpm build
```

Confirm all commands exit successfully. The focused suite proves these
boundaries:

- the default promotion mode remains `off`; a local test/execution claim is
  not promoted merely because evidence was collected;
- only a complete private receipt pair can support the opt-in `receipt_v2`
  path;
- pasted changed files, checks, or logs cannot retain GitHub-complete
  authority or a locally satisfied test/execution axis;
- an inbound untrusted full v2 report cannot carry an active contract outcome;
- share and tenant projections omit private receipt collections and execution
  bindings.

### Manual preview checks

- On desktop and mobile, run the five demo scenarios and confirm their
  priority, gap, and re-prompt signals remain distinct.
- In manual mode, paste changed-file/check/log evidence and confirm the report
  stays conservative: it must not present that pasted input as GitHub-complete
  proof or as a requirement-local `Supported` result.
- Analyze a public PR URL without a token. If GitHub evidence is unavailable,
  confirm the report says so instead of inferring a passing test result.
- Create and open a share link. Confirm it contains summary information only,
  never raw diffs, logs, assertion text, receipt IDs, or execution bindings.
- Confirm `GET /api/analyze` returns `405`; this endpoint must fail closed for
  a non-analysis request.

### Stop and report a blocker when

- a requirement-local test or execution result is shown as supported without
  a complete, source-bound receipt path;
- pasted input is described as live GitHub-complete evidence;
- an import/publication path accepts an active v2 contract from an untrusted
  full report;
- a share/tenant screen exposes raw evidence, private receipts, assertions,
  workflow identities, or secret-like data;
- a mobile layout hides the top risk, evidence gap, or next agent action.
