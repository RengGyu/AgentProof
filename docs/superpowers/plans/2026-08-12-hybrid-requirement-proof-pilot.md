# Hybrid Requirement-Proof Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a private one-POST enhanced planner over punctuation/list/
sentence source spans while preserving exact BASE HEAD essential reports.

**Architecture:** A deterministic 12-span seed and SHA-256 binding are built
before the one call. A strict ID/enum-only plan is valid or discarded as a
whole; only a valid plan reaches the hybrid finalizer. Pilot provenance is
persisted compatibly, but plan/span text and narrative semantic output are not.

**Tech Stack:** TypeScript, Vitest, Next.js, OpenAI Responses API, Supabase,
existing signing/report storage/tenant control plane.

## Global constraints

- Revert the entire current uncommitted parser/context/vague implementation to
  BASE HEAD. Pilot finalizer behavior is new and never essential fallback.
- Exact source spans only: list item, punctuation sentence, or remaining line/
  paragraph. No clause NLP and no model rewriting.
- One POST maximum; no retry/subset/repair. One valid plan only; all invalid or
  stale post-call outcomes use exact BASE HEAD report plus one bounded limit.
- 12 spans, four axes/span, 12KB input, 3,200 output tokens, 16KB output bytes,
  30s sync timeout, 20s background timeout, 8m TTL. No evidence/code excerpts.
- Allowed axes: present for all seven subjects; absent only implementation; no
  duplicate subject/pair or both implementation polarities.
- New pilot authority is additive axis applicability only. Server owns every
  state/gap/evidence/status; planner classification is never model status.
- Private consent/version, enhanced mode, allowlist, and kill switch required
  per analysis. No default enablement, commit, stage, push, or deploy.

---

## Files

| Deliverable | Files |
| --- | --- |
| BASE/head + seed | `src/lib/extractors.ts`, tests, `src/lib/types.ts` |
| DTO/package/hash | new `src/lib/hybrid-planner.ts`, tests; `src/lib/llm-semantic-output.ts`, tests; `src/lib/llm-semantic-package.ts`, tests |
| finalization/provenance | `src/lib/verifier.ts`, tests; `src/lib/verifier-proof-expectations.ts`, tests; `src/lib/report-validation.ts`, tests; `src/lib/report-authenticity.ts`, tests; `src/lib/server-report-store.ts`, tests; `src/lib/dashboard-requirement-view-model.ts`, tests; `src/lib/markdown.ts`, `src/lib/slack.ts`, tests |
| consent/control plane | `src/lib/tenant-control-plane.ts`, tests; `src/app/api/tenants/repositories/route.ts`, tests; `src/components/PublicGitHubDashboard.tsx`, component tests; onboarding repository route/tests |
| transport/jobs | `src/lib/openai-semantic.ts`, tests; `src/lib/llm-semantic-runtime.ts`, tests; `src/lib/analysis-worker.ts`, tests; `src/lib/analysis-jobs.ts`, tests; webhook route/tests |
| migration/telemetry | create `supabase/migrations/202608120001_hybrid_planner_pilot.sql`; migration tests; existing audit/usage telemetry module/tests; synthetic evaluator |

### Task 1: Restore BASE HEAD and create deterministic spans

- [ ] Write RED extractor tests: terminal-punctuation/list/line spans only;
  conjunction-only prose remains one span; spans are disjoint/exact offsets;
  group resets; source parent remains original after exclusion; candidate 13
  returns overflow without a package.
- [ ] Run `pnpm vitest run src/lib/extractors.test.ts`; expect missing seed and
  failed current experimental parser assumptions.
- [ ] Revert all uncommitted contextual/token/vague changes to BASE HEAD. Add
  `extractRequirementSpanSeed` using only the three documented boundaries and
  stable source/group IDs. Do not change BASE HEAD `extractRequirementEvidence`.
- [ ] Run extractor and BASE HEAD regression suites green.

### Task 2: Strict plan/package/hash limits

- [ ] Write RED tests for complete span coverage, exact parent echo, authority
  disposition/classification combinations, `exclude` empty axes, allowed-pair
  matrix, duplicate/opposing implementation axes, four-axis cap, unknown/extra fields, hash/
  version mismatch, 12KB input cap, and 16KB output cap.
- [ ] Add a generated worst-case compact-JSON test building the seed-specific
  fixed-key `d_0 ... d_n` DTO with the longest allowed classification and four
  longest allowed axes; record the measured 2,884-byte maximum over valid Task 1 span/group layouts and
  assert serialized size `<= 4_608` bytes.
  Construct it through the production DTO constructor and assert its keys match
  the generated schema required keys so later fields cannot silently escape the bound.
- [ ] Run `pnpm vitest run src/lib/hybrid-planner.test.ts src/lib/llm-semantic-output.test.ts src/lib/llm-semantic-package.test.ts`; expect missing DTO/package.
- [ ] Implement `hybrid-planner.ts` canonical seed hash and seed-specific strict schema;
  package only spans/context/version/hash, `store:false`, `max_output_tokens:3200`.
  For GitHub pilot inputs, bind the transient SHA-256 identity of the selected
  Issue/PR-description/provided-task authority into the aggregate seed hash;
  never package or persist the raw authority reference or its digest.
  Encode valid expected-axis subsets as a canonical enum token and decode them
  server-side; define shared admitted-axis enums once with `$defs`/`$ref` and
  assert official schema aggregate/byte limits. Filter Task 1 seed contexts to
  the selected source before hashing; exclude evidence/code excerpts entirely.
- [ ] Run DTO/package tests green.

### Task 3: Valid-plan finalizer and one fallback matrix

- [ ] Write RED verifier/validator tests for all matrix rows: disabled/no spans
  exact BASE HEAD; overflow BASE HEAD+limit; malformed/stale/provider failure
  BASE HEAD+limit; valid authoritative admission is always materialized while
  deterministic vague/manual rules alone determine unclear; valid unlinked
  `mixed_or_uncertain`/`not_requirement` exclusion has no requirement+limit;
  contextual parent excluded blocks inheritance.
- [ ] Add RED multi-axis tests: planner axis creates deterministic gap,
  deterministic floor survives omitted axis, author claim stays partial,
  deterministic unclear never met, and floor/plan opposing polarity rejects the
  whole plan before finalization.
- [ ] Run `pnpm vitest run src/lib/verifier.test.ts src/lib/verifier-proof-expectations.test.ts src/lib/report-validation.test.ts`; expect no valid-plan finalizer.
- [ ] Implement finalizer only after strict validation. It unions floor, valid
  axes, companions, and direct admitted-parent context; server computes all
  proof/status evidence. Route every invalid post-call outcome through one BASE
  HEAD fallback constructor.
- [ ] Run finalizer suites green.

### Task 4: Persist neutral provenance and seed-bound job protocol

- [ ] Write RED tests: optional planner provenance affects signature; legacy
  signed reports still validate; sanitizer retains only versions/hash/basis;
  dashboard/comment/Slack say “Enhanced planning policy”; no plan/span text
  serializes; legacy null-hash job follows legacy handler; rebuilt hash mismatch
  falls back without POST.
- [ ] Run report/store/job/dashboard tests; expect absent provenance/hash fields.
- [ ] Add optional report/node/finding provenance and validators; copy fields
  through authenticity/sanitizer/UI output. Add migration fields
  `hybrid_planner_requested`, `planner_contract_version`,
  `planner_input_hash` and compatible constraints. The boolean is the
  enqueue-time discriminator that keeps migrated null/null legacy jobs from
  being reclassified as new pilot jobs.
  Persist before one background POST and exact-match on every retrieval.
- [ ] Run compatibility tests green.

### Task 5: Durable consent, shared transport, and manual rollback

- [ ] Write RED migration/control-plane/API/UI tests: grant accepts only
  `hybrid_planner_consent_version="2026-08-12.v1"`; create/update exposes the
  disclosure; revocation or enhanced->essential clears it; worker requires exact
  consent/allowlist/kill-switch every time; disabled gate makes zero POST.
- [ ] Write transport REDs: one sync POST; one background POST plus same-ID GETs;
  no retry after uncertain submission; an explicit privacy-safe enqueue intent
  distinguishes new pilot jobs from active old `false + null/null` jobs;
  telemetry aggregates only version/count/timing/outcome fields; operator kill
  switch makes subsequent analyses zero-POST.
- [ ] Run `pnpm vitest run src/lib/tenant-control-plane.test.ts src/app/api/tenants/repositories/route.test.ts src/app/api/github/onboarding/repositories/route.test.ts src/lib/openai-semantic.test.ts src/lib/llm-semantic-runtime.test.ts src/lib/analysis-worker.test.ts src/lib/analysis-jobs.test.ts`; expect missing consent/hash orchestration.
- [ ] Implement additive repository-grant migration in the same pilot migration,
  route/UI checkbox, revocation clear, per-analysis gates, shared sync/background
  package/finalizer, canonical enqueue/RPC+memory intent parity, bounded
  telemetry aggregate, and documented env+allowlist manual rollback. Retire
  pilot retry/subset/merge calls. Re-fetch and rebind the selected-authority
  identity before package creation and immediately before validation/finalization
  so identical-content Issue relinks fail closed without another POST.
- [ ] Run focused control-plane/transport tests green.

### Task 6: Blind evaluation and release checks

- [ ] Build a non-persisted synthetic blind set covering punctuation-only mixed
  limitation, authoritative uncertainty, unlinked uncertainty, axis matrix,
  adjacency blocking, stale seed, consent revoke, injection-shaped span text,
  overflow, output limits, one-call count, legacy reports/jobs, and privacy.
- [ ] Run focused suite, then `pnpm test`, `pnpm typecheck`, `pnpm lint`,
  `pnpm build`, and `git diff --check`.
- [ ] Verify no raw source/provider/decision content appears in report JSON, job
  rows, telemetry, test artifacts, or logs. Review aggregates and use the
  documented env/allowlist procedure to stop pilot traffic before any expansion.

## Plan self-review

- No clause NLP, semantic rewriting, open axis choice, automatic rollback, or
  essential-mode change remains.
- Each fallback is specified once in Task 3 and is exercised by transport tests.
- Consent has migration, grant model, API, UI, revocation, worker gate, and
  manual rollback ownership.
