# Linked Issue Ingestion

P0 linked issue ingestion strengthens original request evidence for the first real PR workflow without expanding SaaS infrastructure.

## Supported References

AgentProof only treats these patterns as supported issue references:

- `Fixes #123`
- `Closes #123`
- `Resolves #123`
- `owner/repo#123`

Bare local references such as `#123` without a supported closing keyword are not enough to become task evidence.

## Precedence

- If the reviewer provides explicit task text, that text remains the requirement source.
- If no task text is provided and exactly one supported issue reference exists, AgentProof fetches the linked issue title/body and uses it before the PR description.
- If multiple supported issue references exist, AgentProof records at most 3 references in a limitation and does not choose a single issue as the requirement source.
- If the issue fetch fails, is inaccessible, rate-limited, or points to a pull request, AgentProof records a limitation and falls back to PR description inference.

## Normalized Shape

The fetched issue becomes bounded task evidence:

- `taskSource: "issue"`
- `taskText: "Linked issue owner/repo#123: <title>\\n\\n<body>"`
- evidence label: `Linked issue`

The report must still use `unclear` or a limitation when evidence cannot be collected. Issue fetch failure is never a verified product claim.

## Privacy Boundary

Linked issue bodies can appear in the full report as task evidence for the active reviewer session. Summary-only share links and saved reports must not retain raw issue body evidence, raw evidence indexes, raw re-prompt text, tokens, provider ids, or private table/env names.
