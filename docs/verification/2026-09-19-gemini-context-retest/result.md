# Context recovery retest — 2026-09-19

Preview: https://agentproof-gr8dslzh4-renggyus-projects.vercel.app
Deployment: dpl_Fx59M2G5e6uVHuj2P4gprtYynxrB. Current uncommitted worktree uploaded; no commit/push/production promotion. CLI 59.23.2 first returned Not authorized; account/project read checks passed, and deploy using 59.23.1 succeeded. Remote build/typecheck passed. Worker verification logs confirm 344 related tests passed and local build/typecheck passed.

Both existing PRs succeeded on their first request on this deployment. All requests used the authenticated operator diagnostics path. Full reports and trace metadata are saved in flask-5918.json and starlette-3552.json. No raw provider responses or credentials were saved.

## Comparison with previous Gemini run

Both head/base commits and navigation source hashes match the prior Gemini reports in ../2026-09-18-gemini-contract-retest (Starlette successful retry). Model identifier is gemini-3.8-flash in both runs. Goal outputs and supplied code differ, so this is an end-to-end regression observation rather than a fixed-packet model experiment.

| Observation | Before | After |
| --- | --- | --- |
| Flask core implementation | sansio/app.py:612–631, missing options decisions | sansio/app.py:604–671 supplied and selected first; includes 634–643 and 660–671 |
| Flask automatic reads | No snapshot expansion observed | 2 paths requested and supplied before ranking |
| Starlette independent tests | Missing-payload test selected; UTF-8 test absent | tests/test_endpoints.py:222–265 and 268–288 both supplied and selected |
| Starlette startup | First attempt stale_snapshot; retry succeeded | Initial/final freshness unchanged; first attempt succeeded |
| Reference errors | None in prior successful Gemini runs | None in either run |

Flask: one goal plus seven facets and optional deprecation question. Main routing, configuration override, CLI hiding, and static-view claims remain represented. Starlette: one goal plus four facets preserves missing payload, non-UTF-8 behavior and 1003 handling, with test success retained as an author claim.

## Remaining issues and costs

- Starlette implementation remains endpoints.py:104–118; JSONDecodeError handling at 119–121 is not included. Only the truncated test file triggered automatic supplementation. The model reported missing surrounding code but requested no further reads.
- Flask still lacks the actual options-view definition in supplied app.py excerpts. Complete reviewer context is not established.
- Same-file locations now survive, but the missing-payload test range begins at 222 and includes neighboring bytes-mode context; the precise test begins at 245. Better location precision is still possible.
- Flask ranking artifact payload increased from 5,105 to 23,346 bytes. Total provider input tokens increased from 6,351 to 10,258. Current output tokens 1,373 and recorded thought tokens 2,222. Improvement in context is not a token-cost reduction.
- Starlette current provider input 7,054, output 1,157, recorded thought 867. Prior successful retry lacked usage diagnostics, so no matched cost comparison is available.
- CLI roundtrip: Flask 22.322s, Starlette 12.898s. Single observations, not latency benchmarks.

This confirms recovery of the identified Flask branch and Starlette test locations on two regression cases. It does not establish overall accuracy, generalization, or that the earlier transient snapshot failure is fixed. No further implementation was started.
