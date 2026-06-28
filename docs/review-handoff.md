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
- Review `docs/github-app-webhook.md` and confirm the GitHub App webhook remains dry-run only: no automatic analysis, comments, installation tokens, or raw payload persistence.
- Confirm public PR URL analysis shows explicit limitations when test/build logs are unavailable and does not claim tests passed from security, code-owner, deploy-preview, or AI-review checks.
- Confirm failed execution check annotations, when present, are summarized only as bounded `path:line` locations and never include raw annotation messages or raw details.
- Confirm summary-only saved/share pages may still include PR URL/title, requirement text, missing-test paths, and review-priority paths, but never raw evidence, claims, raw re-prompt text, raw annotation details, or failed annotation `path:line` values copied from full execution evidence.
- Paste task text plus changed file names, then confirm the report still works without GitHub access.
- Use Copy Report, Copy PR Comment, Download, and Copy re-prompt.
- Use Copy Share Link and confirm the opened shared page omits raw evidence.
- Confirm Recent reports reload locally and Clear removes them.
- Preview a GitHub PR comment and verify it is short, marker-based, and does not include raw evidence.
- Check that long file paths and evidence summaries do not overflow on mobile.
