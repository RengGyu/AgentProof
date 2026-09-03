# SDD ledger — plan: docs/superpowers/plans/2026-09-02-general-pr-claim-conditioned-semantic-packaging.md

## Preflight

| Tasks / surface | Producer -> consumer relationship | Check / ruling |
|---|---|---|
| 1 -> 2 -> 3 -> 4 | Claim selector produces stable whole-span IDs and `claimSelectionHash`; descriptor selector, claim validator, then observer consume them. | Consistent. Claim validation uses only `claimSelectionHash`. |
| 2 -> 3 -> 4 | Evidence selector produces objective-scoped allowlists and `evidenceSelectionHash`; evidence validator and observer consume them. | Ruling: if there are no legal evidence candidates, selector returns `status: "empty"` and the observer does not construct Stage B; `evidenceSelectionHash` is null in the manifest/receipt. Cost if wrong: callers could mistake no second packet for a failed packet. |
| 3 -> 4 -> 5 | Stage schemas/validators produce V3 packages; observer calls provider; OpenAI adapter serializes either stage. | Consistent. The transport stays one function over a discriminated union. |
| 4 -> 6 -> 8 | Observer produces transient stage state and aggregate counts; service/route/worker project only closed aggregates; smoke parses only that boundary. | Consistent. No selection IDs, hashes, descriptors, or output cross this boundary. |
| 6 -> 7 -> 9 -> 10 | Service preserves strict report; privacy and authority tests protect projections; evaluators score frozen labels; final gate runs all checks. | Consistent. `unclear` rate alone remains non-gating. |
| Task 1 | Test creates new selector before production code. | Consistent with RED -> GREEN. |
| Task 2 | Tests require safe sketch, RRF, diversity, and exact budgets before descriptor code. | Consistent with privacy and deterministic-first constraints. |
| Task 3 | Tests require strict schemas and mutation rejection before V2 merge. | Consistent with independent validation requirement. |
| Task 4 | Tests require exact state/call table before two-stage orchestration. | Consistent with no-retry and freshness rules. |
| Task 5 | Transport tests precede union transport change. | Consistent. |
| Task 6 | Route/worker parity tests precede integration. | Consistent. |
| Task 7 | Sentinel tests precede any projection change. | Consistent. |
| Task 8 | Parser/release guards precede smoke changes. | Consistent. |
| Task 9 | Evaluation tests precede metric additions. | Consistent. |
| Task 10 | Verification only; defects return to their owning task. | Consistent. |

Ruling: use the existing isolated worktree at `/private/tmp/agentproof-general-pr-hybrid-observation-impl` on `codex/general-pr-hybrid-observation-impl`; no new worktree is needed. Cost if wrong: only this feature branch is affected, not the user’s main checkout.

Ruling: claim selection is source-driven, but its hash remains bound to the full seed. Therefore tests for unrelated changed-file/check reorder compare selected span IDs and payload rather than the complete selection JSON. Cost if wrong: the test would demand a weaker provenance binding merely to make an order-invariance assertion pass.

## Task status

| Task | State | Base commit | Evidence / ruling |
|---|---|---|---|
| 1 — deterministic claim selector | complete | `780b14762c6b4e50b87537e56586509187946f01` | Commits `8e606ba`, `ea96850`, `9448535`; independent review approved after three P1 fixes. Supervisor re-ran focused selection/source/observer tests (25 passed), typecheck, and diff check. |
| 2 — evidence descriptor selector | complete | `9448535726c41803c26d494981c64a292ab25aad` | Commits `d3fbe21`, `969c986`, `8a19413`; independent review approved after three binding/privacy fixes and supervisor recheck remains pending. The released static/build branch is deliberately unit-only because the current canonical seed cannot produce it. |
| 3 — split stage contracts | complete | `8a194139192715318dcbc4b315985aa9f6d2a150` | Commits `b9a4eee`, `4520ec3`, `25b2064`, `ca58483`, `1ad9679`; independent review approved after provider-byte, forged-object, mutation, and claim-to-evidence provenance fixes. Supervisor recheck remains pending. |
| 4 — staged observer and receipt | complete | `1ad9679a726423870938233b31ef349ae4ff4ab8` | Commits `8829fca`, `d5cd51f`, `2b3eda1`; independent review approved after malformed-output and hostile getter/proxy closure fixes. Supervisor recheck remains pending. |
| 5 — staged OpenAI transport | complete | `2b3eda1` | Commit `7acf466`; independent review approved. Route/worker package pass-through was already type-compatible, so no unrelated adapter edit was needed. Supervisor recheck remains pending. |
| 6 — service, worker, route, telemetry integration | complete | `7acf466` | Commit `b6b184f`; independent review approved. The service/route/worker use closed aggregates only; strict finalizer and one-attempt queue behavior were directly covered. Supervisor recheck remains pending. |
| 7 — privacy and authority gates | complete | `b6b184f` | Commits `d13d005`, `c156bfb`; independent review approved after concrete sentinel injection and metamorphic-comparison fixes. No production leak was demonstrated. Supervisor recheck remains pending. |
| 8 — 25-PR packaging-health smoke | complete | `c156bfb` | Commits `390f754`, `a96e4be`; independent review approved after adding a reachable closed `3_plus` call bucket and nested exact-key guard. No live corpus run was authorized. |
| 9 — labelled selection evaluation | deferred | `a96e4be` | Restored to the pre-Task-9 state after independent review showed the candidate execution limits were self-attested rather than independently bound. This feature branch makes no labelled calibration/holdout release claim. |

## Post-implementation correction package

- Correction 1: complete — retained privacy-safe descriptors after redaction/tokenization and capped caller budgets at approved maxima; RED 3 expected failures, GREEN 26 tests, independent review approved.
- Correction 2: complete — made sampled zero-objective results coverage-aware and changed the 25-PR smoke to measure legal sampling while rejecting closed legacy package failures; GREEN 80 focused tests after one route-contract fix, independent re-review approved.
- Ruling: retain WeakMap validation provenance — removing it weakened an integrity boundary and was not necessary to solve the overfitting problem. Cost if wrong: some same-process defensive complexity remains, but external provider validation is not weakened.
- Correction 3: complete — removed repository-search-verified dead V2 provider/schema/receipt/package entry points and migrated bounded-package/output-limit coverage to the staged runtime; GREEN 100 focused tests (1 skipped), independent re-review approved.
- Ruling: defer Task 9 selection scoring — the release artifact accepted caller-declared policy limits without proving execution used them. Cost if wrong: labelled selection release scoring is delayed, while runtime Tasks 1–8 remain testable in shadow mode.
- Correction 4: complete — restored the 11 evaluation/seal files to `a96e4be` and deleted the Task-9-only anchor; 4 Vitest + 12 Node tests passed, independent review approved.
- Final review fix wave: complete — sampled/incomplete Stage B unresolved relations now stay `collection_unavailable`; the smoke rejects span/change-cluster/evidence-atom legacy count-limit failures; two unused schema helpers were deleted. Independent re-review changed the local-package verdict from NO_GO to GO.
- Minor (deferred): persist authenticated operator aggregate distributions in a durable aggregate-only artifact before claiming production release evidence. Ruling: defer because adding or changing the artifact schema is not required for runtime correctness, authority, privacy, or this correction package. Cost if wrong: operational diagnosis remains console-only for the next production-shaped smoke.
- Final local verification: `pnpm test` 188 files / 2,477 passed / 2 skipped; `pnpm build`, post-build `pnpm typecheck`, `pnpm lint`, and `git diff --check` all passed.
