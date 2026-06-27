# AgentProof Review Handoff

Use this when asking ChatGPT, Claude, Codex, or another reviewer to inspect the public repository.

Repository:

`https://github.com/RengGyu/AgentProof`

Deployed demo:

`https://agentproof-pearl.vercel.app`

## Review Prompt

```text
Review this repository as a product-quality code review.

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
- For AgentProof self-evaluation smoke testing, run `AGENTPROOF_SMOKE_BASE_URL=https://agentproof-pearl.vercel.app pnpm smoke:real-prs` and confirm PR #1-#3 all analyze successfully with summary-only saved-report boundaries.
- Review `docs/github-app-webhook.md` and confirm the GitHub App webhook remains dry-run only: no automatic analysis, comments, installation tokens, or raw payload persistence.
- Confirm public PR URL analysis shows explicit limitations when test/build logs are unavailable and does not claim tests passed from security, code-owner, deploy-preview, or AI-review checks.
- Paste task text plus changed file names, then confirm the report still works without GitHub access.
- Use Copy Report, Copy PR Comment, Download, and Copy re-prompt.
- Use Copy Share Link and confirm the opened shared page omits raw evidence.
- Confirm Recent reports reload locally and Clear removes them.
- Preview a GitHub PR comment and verify it is short, marker-based, and does not include raw evidence.
- Check that long file paths and evidence summaries do not overflow on mobile.
