---
name: agentproof-verifier
description: Work on AgentProof verification logic, evidence reports, schemas, prompts, privacy handling, or UI language for AI-generated PR requirement validation. Use when editing report generation, GitHub evidence ingestion, missing-test or scope-creep detection, structured output contracts, or reviewer-card copy.
---

# AgentProof Verifier

Maintain AgentProof as an evidence-report product: deterministic verification first, LLM interpretation second.

## Workflow

1. Inspect the current report schema and verifier behavior before changing outputs.
2. Identify deterministic inputs for each claim: task text, PR description, diff metadata, changed files, checks, logs, tests, and explicit user context.
3. Ensure every finding traces to evidence. If evidence is weak or unavailable, use `unclear`, `unknown`, or `hypothesis`.
4. Validate JSON shape after changes.
5. Check privacy impact: do not persist tokens, avoid unnecessary raw code storage, and redact likely secrets in logs.
6. Keep product language focused on evidence, verification, grounded findings, and human decision support.

## Collaboration Workflow

For non-trivial AgentProof work, use a fresh Codex thread and sub-agents with distinct responsibilities before final integration. Useful roles include:

- Implementation driver: make the scoped code or document change.
- Skeptical reviewer: look for false positives, unsupported claims, and product-position drift.
- Evidence auditor: check provenance, schema boundaries, privacy, redaction, and raw evidence retention.
- Test-gap finder: verify parser, validation, rendering, and regression coverage.

The integrating agent must resolve disagreements with deterministic evidence first. Do not treat a sub-agent opinion as verified unless it cites concrete files, command output, report evidence IDs, or API/check results.

## Output Rules

- Prefer structured JSON over free text.
- Include evidence references for requirement findings, scope creep, missing tests, and review priority.
- Never claim tests passed, logs failed, or files changed unless the data source says so.
- Generate re-prompts only from evidence-backed gaps.
