# Local Demo Validation

This checklist verifies AgentProof without GitHub tokens, OpenAI keys, Slack webhooks, or Supabase credentials.

## No-Secret Commands

```bash
CI=true corepack pnpm test
CI=true corepack pnpm typecheck
CI=true corepack pnpm eval:sentinels
CI=true corepack pnpm eval:summary:fixture:strict
CI=true corepack pnpm build
```

These commands prove local code quality, report schema stability, reviewer-signal sentinels, summary-only privacy, and the committed evaluation fixture. They do not prove live GitHub permissions, private repository access, Slack delivery, OpenAI output quality, or Supabase durability.

## Demo Scenarios

| Scenario | Expected signal | What it proves |
| --- | --- | --- |
| `clean` | Low/medium risk with mostly met requirements | Requirement evidence, changed files, and passing execution evidence can line up. |
| `scope-creep` | Out-of-scope auth/session files | Scope findings cite changed-file provenance instead of acting like generic review comments. |
| `missing-tests` | Behavior files without targeted test proof | Missing-test findings cite the file and supporting evidence gap. |
| `failed-ci` | Blocker priority | Failed test/build execution prevents overconfident requirement satisfaction. |
| `vague-task` | Unclear requirement coverage | Vague tasks stay low-confidence instead of being treated as verified. |

## Reviewer-Signal Sentinels

`pnpm eval:sentinels` is a deterministic sentinel suite, not a score. A sentinel is a guard test that fails when a documented reviewer handoff signal disappears.

It checks that the demo reports keep these 30-second reviewer signals visible:

- scope-creep paths appear in scope findings, review priority, provenance, and the re-prompt
- missing-test paths appear in missing-test findings, review priority, provenance, and the re-prompt
- failed execution stays blocker-level and prevents `met` requirement statuses
- vague tasks remain `unclear` and ask for explicit acceptance criteria
- visual/mobile UX requirements are not marked `met` without browser, screenshot, or visual QA proof
- summary-only reports omit raw evidence, claims, provenance, evidence refs, and raw re-prompt text

## Finding Provenance

Full reports now attach bounded provenance to scope-creep and missing-test findings:

- `evidenceRef`: the evidence ID used by the finding
- `sourceType`: task, PR description, diff, changed file, check, log, test, or inference
- `locator`: file path, check name, log source, or source label
- `confidence`: deterministic confidence score
- `evidenceText`: short redacted evidence text

Summary-only surfaces still omit provenance, raw evidence, claims, patch/log excerpts, and raw re-prompt text.

## What To Inspect Manually

- Open each demo scenario in the deployed app or local dev server.
- Confirm the top risk, weakest evidence, and next agent task are visible without deep scrolling.
- Open a share link and confirm it shows summary-only content.
- Export Markdown from a full report and confirm scope/missing-test findings include provenance lines.
