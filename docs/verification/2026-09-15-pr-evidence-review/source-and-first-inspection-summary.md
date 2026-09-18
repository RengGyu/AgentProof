# Displayed-source fix and first-inspection evaluation

## Source display fix

- **VERIFIED:** The defect was in presentation projection: `buildPrEvidenceReview` used the advisory assessment's selected source state for the whole card even when the displayed canonical requirement came from a different source.
- **VERIFIED:** Full and saved-dashboard projections now derive the source from displayed requirements: explicit `sourceAuthority: pr_description` marks PR-author material; otherwise `analysisContext` distinguishes linked Issue from provided requirement. Mixed labels distinguish linked-Issue + PR, provided + PR, and unknown mixed provenance without upgrading authority.
- **VERIFIED:** The previous modal-free Issue synthetic failure is now green. Issue, PR-author, provided, missing, linked mixed, provided mixed, unknown mixed, and signed tenant save/hydrate cases are covered. Classification, authority contracts, report status, and card visibility were not changed.

## Ten-case evaluation

The previous `evaluation.json` is preserved. A new run used the same committed 10 cases in separate as-is and source-adapted profiles. The source-adapted profile changed only `taskSource` to `issue`.

| Metric | Baseline: first changed file | Current as-is | Current source-adapted |
|---|---:|---:|---:|
| First-inspection hit@1 | 9/10 | 9/10 | 9/10 |
| Precision when presented | 9/10 | 9/10 | 9/10 |
| Recommendation coverage | 10/10 | 10/10 | 10/10 |

- **VERIFIED:** The only miss in all three arms was `pylint-dev__pylint-6386`: `pylint/config/argument.py` was first, while the provisional reference allows `pylint/config/utils.py` or `tests/config/test_config.py`.
- **VERIFIED:** First-inspection scoring counts only the first file explicitly recommended by the active rendered review mode and present in that review's evidence. A hidden global recommendation in objective mode is not scored.
- **VERIFIED:** Source-label coverage was 0/10 for both profiles because every case still rendered change-summary mode with no source badge. Accuracy when presented is therefore `null` with denominator 0, not 0% accuracy. The source fix is exercised by the independent synthetic/card tests, not promoted into an unsupported corpus accuracy claim.
- **FAILED:** Both profiles still produced 0 objective cards from 26 strict requirements because the observation bundle admitted 0 objectives and the assessment had 0 targets. The source-adapted internal state was linked-Issue in 10/10, but `no_assessable_claims` kept every view in change-summary mode.
- **VERIFIED:** File-inventory preservation, execution non-promotion, card count, and safe-link behavior were unchanged. Semantic relevance, actual link arrival, line/function accuracy, requirement fulfillment, and human review time remain unmeasured.

## Reference and scoring boundary

- Reference provenance: supervisor AI-reviewed provisional, fixed before ranked output was read; not human gold or a holdout.
- Reference SHA-256: `33f9671de044f467ed41ad0d38a4ccc06983ef5f44f35359d24e267b24089fb2`.
- Result SHA-256: `d9b54333593ab3537d77adc8db2cb92e2674db7294e1ff543dc8ad5a84a5bdef`.
- Scorer rejects unknown/duplicate cases and unsupported oracle/task fields. A separate regression changes oracle/expected metadata while holding generation input fixed and confirms identical evaluation output.
- External calls: 0, enforced by the rejecting evaluation guard.

## Local timing

Apple M1, macOS arm64, Node v22.22.0; one warm-up and 30 samples per profile. As-is pipeline/validation p50/p95 was 23.38/60.39 ms and projection/SSR was 13.03/18.91 ms. Source-adapted values were 20.58/52.97 ms and 12.17/22.69 ms. Persistence was excluded.
