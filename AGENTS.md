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

## Collaboration Workflow

- For each non-trivial AgentProof work item, start a fresh Codex thread with the concrete objective, roadmap phase, acceptance criteria, expected files, and privacy/security boundaries.
- Use sub-agents to reduce confirmation bias. Assign distinct roles such as implementation driver, skeptical reviewer, evidence/provenance auditor, UX/docs reviewer, or test-gap finder.
- Keep sub-agent scopes disjoint when they edit code. Make each role state what evidence it checked and what remains uncertain.
- The main thread owns integration. Resolve disagreements by deterministic evidence first: file contents, tests, typecheck, build output, GitHub/API responses, and explicit report provenance.
- Do not accept a sub-agent conclusion as verified unless it cites concrete evidence. If agents disagree or evidence is weak, mark the result as `unclear` or create a follow-up ticket.
