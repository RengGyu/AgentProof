# Agent Guidance

AgentProof is not a generic AI code review tool. Preserve the product position: it produces evidence reports for AI-generated pull requests, grounded in deterministic signals first and LLM interpretation second.

## Core Rules

- Prefer deterministic evidence before model judgment: PR metadata, diff, changed files, tests, typecheck, lint, build output, CI logs, and file references.
- Do not present an LLM-only observation as verified. Mark unsupported claims as `unclear` or `hypothesis`.
- Preserve structured JSON contracts. Add fields compatibly and avoid renaming existing fields without migration.
- Every finding should include provenance: source, file path or check name, confidence, and evidence text.
- Keep privacy boundaries tight. Do not persist tokens. Minimize raw code retention; prefer paths, symbols, hashes, summaries, and short excerpts.
- Avoid broad "AI code review" language in UI, docs, and prompts. Use "evidence report", "verification", "requirement coverage", and "grounded findings".
- Never invent command results, test outcomes, dependency status, file contents, or GitHub API responses.
- If evidence cannot be collected, report that explicitly instead of guessing.

## Implementation Preferences

- Keep report generation deterministic and reproducible where possible.
- Feed LLMs normalized evidence, not large raw source dumps.
- Validate schema boundaries before rendering or storing reports.
- Tests should cover schema stability, parsers, privacy redaction, and report rendering.
