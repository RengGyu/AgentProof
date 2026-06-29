# AgentProof Final Goals And Roadmap

## North Star

AgentProof should become an evidence-based verification report tool for AI-agent pull requests.

It answers one question:

> Is there enough evidence that this agent-authored PR satisfies the original request?

The product should help a human reviewer decide what to trust, what to inspect first, and what to ask the coding agent to fix next. It should not become a broad AI code reviewer, an auto-merge gate, or an unsupported security scanner.

## Success Definition

AgentProof reaches the intended report goal when these three outcomes are true:

- **Product clarity:** the app and docs clearly say that AgentProof verifies requirement coverage and evidence sufficiency, not generic code quality.
- **Reviewer utility:** a reviewer can understand requirement coverage, weak proof, missing tests, scope creep, review priority, and re-prompt guidance in about 30 seconds.
- **Trust boundary:** every report path preserves provenance, validates structured report data, avoids unsupported claims, and keeps raw evidence out of durable summary surfaces.

## Phase 0: Trust Boundary Hardening

Status: implemented in the current hardening batch.

Goal:

Make the existing MVP safe enough to describe as an evidence verifier.

Completion criteria:

- External report input fails closed through strict runtime validation.
- Browser history, share links, server saved reports, and Slack payloads are summary-only.
- GitHub PR comments cannot be posted to a different PR than the report source.
- Redaction covers common GitHub, OpenAI, Slack, bearer, AWS, and private-key secrets.
- `pnpm test`, `pnpm typecheck`, and `pnpm build` pass.

## Phase 1: Verification Quality MVP

Goal:

Improve the quality of the evidence report so each finding is grounded, explainable, and useful to a reviewer.

Priority work:

- Strengthen requirement extraction from task text and PR descriptions.
- Strengthen agent claim extraction from PR descriptions and agent-written summaries.
- Add clearer provenance to evidence items, including source type, locator, confidence, and short evidence text.
- Add a real-dataset evaluation pack using SWE-bench Verified first, with benchmark outcome labels withheld from report inputs.
- Improve requirement findings so `met`, `partial`, `missing`, and `unclear` are easier to justify from evidence.
- Improve missing-test detection beyond simple test-file presence.
- Reduce scope-creep false positives by comparing changed file clusters with requirement keywords and risk-sensitive paths.

Completion criteria:

- Every requirement finding has evidence references or an explicit gap.
- Every missing-test and scope-creep finding includes file path, source, confidence, and evidence text.
- Demo scenarios produce visibly different and explainable reports.
- `pnpm eval:pack` validates schema, provenance, visible file/test evidence, leakage controls, and false-verified behavior against the evaluation harness.
- Unsupported or weak claims are marked `unclear`, `partial`, or `unproven`, never verified.

## Phase 2: 30-Second Reviewer Experience

Goal:

Turn the report into a fast reviewer handoff card, not a long review transcript.

Priority work:

- Put requirement coverage and top evidence gaps before secondary detail.
- Make missing tests, scope creep, and high-priority files visually scannable.
- Keep GitHub PR comment output short, marker-based, and summary-only.
- Make shared reports clearly label their summary-only privacy boundary.
- Verify desktop and mobile layouts with long file paths and long requirement text.

Completion criteria:

- A new reviewer can identify the top risk, weakest evidence, and next action in 30 seconds.
- Mobile report UI has no overlapping controls or unreadable long text.
- PR comment output reads like a reviewer handoff note, not a generic code review.

## Phase 3: Real GitHub Evidence Ingestion

Goal:

Make live GitHub PR analysis reliable enough for real public or token-authorized private PRs.

Priority work:

- Improve GitHub file/check/status ingestion and limitations when evidence is capped.
- Add better fallback messages for private repos, missing permissions, rate limits, and large PRs.
- Treat missing CI logs as `unknown` evidence, not as a model-inferred pass or fail.
- Consider workflow-job/log ingestion only after the current PR evidence path is stable.

Completion criteria:

- Public PR URL analysis works without a token when GitHub allows access.
- Private PR failures explain whether the issue is token, repo visibility, or permission.
- Large PR reports clearly state caps and avoid overconfident conclusions.

## Phase 4: Portfolio And Launch Readiness

Goal:

Make the repository demonstrate product judgment, engineering judgment, and AI-era review awareness.

Status: MVP portfolio readiness is implemented as of 2026-06-29. Remaining work is launch polish, not MVP scope.

Completed MVP work:

- Added example reports for clean, missing-test, failed-CI, scope-creep, and vague-task scenarios in `docs/example-reports.md`.
- Added desktop and mobile screenshots under `docs/assets/`.
- Expanded README with a concise "Why not an AI code reviewer?" section.
- Kept market validation as an internal summary until public source URLs are re-verified.
- Added a deployment smoke-test checklist for `/`, `/integrations`, demo analysis, saved reports, live integrations, and GitHub comment smoke in `docs/deployment-smoke.md`.
- Added token-gated GitHub App operator diagnostics with bounded readiness categories and no exposure of env values, repository names, table names, tokens, payloads, diffs, or logs.
- Added durable GitHub App webhook duplicate suppression and a bounded production persistence check for controlled automation.

Launch polish still available:

- Add a short demo GIF or video after final UI copy stabilizes.
- Add public URL-backed market validation citations.
- Improve private-repo and token-permission guidance when live GitHub PR evidence cannot be collected.
- Keep operator diagnostics and live-smoke runbooks current as integration settings change.

Completion criteria:

- A portfolio reader understands the problem, target user, product boundary, architecture, and demo path from the README.
- The deployed demo shows the intended verifier workflow without requiring secrets.
- Security and privacy boundaries are explicit and tested.

## First Work Tickets

1. **Commit Phase 0 hardening**
   - Acceptance: current hardening changes are grouped in one clean commit after tests pass.

2. **Evidence provenance upgrade**
   - Acceptance: evidence items and findings show source type, locator, confidence, and concise evidence text consistently.

3. **Requirement finding calibration**
   - Acceptance: demo scenarios have expected `met`, `partial`, `missing`, and `unclear` outcomes with tests.

4. **Real-dataset evaluation harness**
   - Acceptance: SWE-bench Verified rows can be fetched into git-ignored local data and evaluated without leaking `FAIL_TO_PASS` or `PASS_TO_PASS` into report inputs.

5. **Missing-test finder v2**
   - Acceptance: behavior-affecting files without matching test evidence are flagged with fewer false positives.

6. **Reviewer card UI pass**
   - Acceptance: requirement coverage, gaps, scope creep, and next action are visible without scrolling deeply on desktop.

## Non-Goals Until After MVP

- Auto-merge or blocking merge decisions.
- Broad style or generic bug review comments.
- Security scanner claims without dedicated tools.
- Durable raw diff or log storage.
- GitHub App installation UI, org dashboard, or automatic comments without explicit opt-in.
- Jira integration, Slack OAuth, org analytics, or native mobile app.
