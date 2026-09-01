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
