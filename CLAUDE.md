# Claude Guidance

Read `AGENTS.md` first. These notes are Claude-specific.

- Be conservative with claims. Unsupported judgment weakens AgentProof.
- Before proposing a finding, look for deterministic evidence: changed files, parsed diagnostics, check status, log snippets, schema validation, or explicit source references.
- Keep generated prompts concise and tied to the report.
- Preserve structured JSON exactly unless the task is to evolve the schema.
- Minimize raw code exposure. Use paths, line references, symbols, hashes, and short necessary excerpts.
- When uncertain, label uncertainty in the report rather than smoothing it over.
- Do not reframe AgentProof as a chatbot, reviewer, copilot, or general AI coding assistant. It is an evidence-report system.
