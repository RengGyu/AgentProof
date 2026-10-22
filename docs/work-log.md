# Work log

## 2026-09-15 — displayed-source fix and first-inspection evaluation

- Scope: fix PR-to-Evidence source presentation and extend the existing offline evaluator. Allowed product change was limited to `pr-evidence-review` projection and dashboard parity; classifiers, prompts, authority/status contracts, card visibility, input text and prior `evaluation.json` remained frozen. No provider/network/paid call, comment, dependency, commit, push or deployment.
- Root cause/fix: card source previously came from the advisory assessment's separately selected source, so a PR-title selection could relabel displayed canonical Issue requirements as PR-author claims. Source now derives from each displayed requirement's `sourceAuthority` plus report `analysisContext`; mixed labels distinguish linked-Issue+PR, provided+PR and unknown mixed provenance without authority promotion. Full and signed saved-dashboard paths share the rule.
- Source checks: the prior synthetic Issue source mismatch is fixed; runner status and product expectations are now independently 3/3 and 18/18. Issue, PR-author, provided, missing, three mixed contexts and tenant save/hydrate are covered. Product classification and card exposure are unchanged.
- Reference/scorer: added a supervisor AI-reviewed provisional 10-case reference fixed before ranked output inspection. It is not human gold/holdout. The strict scorer separates hit@1, precision when presented, coverage and missing output; rejects unknown/duplicate/oracle-bearing inputs; ignores hidden global recommendations in objective mode; and verifies generation is invariant to changed oracle/expected metadata.
- Result: baseline first-changed-file, current as-is and current source-adapted each scored hit@1 9/10, precision 9/10 and coverage 10/10. Pylint was the sole miss. Source-label coverage remained 0/10 in both profiles, so accuracy when presented is null (0 denominator), not 0%; all cases remained change summaries with 0 cards/targets despite 26 strict requirements. File coverage is not objective accuracy.
- Evidence: `docs/verification/2026-09-15-pr-evidence-review/evaluation-source-and-first-inspection.json` (SHA-256 `d9b54333593ab3537d77adc8db2cb92e2674db7294e1ff543dc8ad5a84a5bdef`) and `source-and-first-inspection-summary.md`; reference SHA-256 `33f9671de044f467ed41ad0d38a4ccc06983ef5f44f35359d24e267b24089fb2`. Rejecting fetch guard observed 0 external calls.

## 2026-09-15 — PR-to-Evidence Review offline evaluation

- Authorized: add and run a bounded offline evaluation for the existing PR-to-Evidence Review. Evaluation/test files, synthetic fixtures, result artifacts, and this log only; product code frozen. No provider, network, paid call, real comment, dependency, commit, push, or deployment.
- Profiles: the committed 10-case diverse fixture was evaluated byte-for-byte as-is, then separately with only `taskSource: "issue"` added based on the recorded source. No issue text, patch, URL, revision, CI evidence, or per-case content was rewritten. The SWE-bench oracle was not provided to report generation or scoring and is not relevance gold.
- Path: every case used the actual advisory no-provider pipeline, generated-private-full validation, PR-to-Evidence projection, and full ReportView SSR. Synthetic cases additionally verified Issue/PR-author/missing-objective behavior, exact head/base/rename links, signed tenant save/hydrate, failed CI/collection limits, portable-summary privacy, and source/link expectations.
- Result: both 10-case profiles completed and displayed all 33 input changed files, with no unbacked execution items or passing-execution language without passing evidence. Both generated 26 strict report requirements but 0 observation-bundle objectives, 0 assessment targets, 0 objective cards and 0 direct code links. As-is selected change summary from ambiguous source plus `no_assessable_claims`; source adaptation made the source linked-Issue but still selected change summary from `no_assessable_claims`. Structural file coverage is not objective linking or semantic correctness.
- Synthetic result: the runner passed; separately, 3/3 product scenarios completed and 17/18 product expectations matched. The one recorded product failure is a modal-free Issue fixture projecting the PR-title author claim instead of linked-Issue authority. Six exact projection links survived storage/hydration; missing-objective UI kept failed CI and the real collection limit without a purpose-only warning.
- Performance: Apple M1/Node v22.22.0, one warm-up plus 30 measured samples/profile. Pipeline+validation p50/p95 was 40.82/103.00 ms as-is and 42.45/108.24 ms source-adapted; projection+SSR was 19.28/26.92 ms and 20.20/28.97 ms. Zero measured failures; invalid samples are tested as excluded/countable rather than 0 ms.
- Evidence: `docs/verification/2026-09-15-pr-evidence-review/evaluation.json` and `summary.md`; fixture hash matched its manifest; rejecting fetch guard observed 0 external calls. Semantic relevance, human review time, and real link arrival remain `not_evaluated`/null.

## 2026-09-15 — PR-to-Evidence Review implementation

- Authorized: user approved PR-first review flow and active Astra supervision of existing Sol/high in this worktree. Issue requirements and PR-author objectives remain distinct. Missing description needs only a change summary, not an unknown-purpose badge or missing-description warning. No automatic satisfaction claim.
- Implementation plan: (1) reuse existing report/evidence inputs for a client-safe review projection; (2) integrate direct ReportView and authenticated saved-PR dashboard with code/test/execution/next-inspection sections; (3) open code through GitHub exact-commit links, with no new raw-code storage/proxy; (4) verify actual report producers, summary privacy, source/path/revision validation, and the three input modes. Preserve strict report semantics and prior experiments.
- Allowed area: report review presentation/view-models, relevant safe source-location plumbing only if required, adjacent tests, this log. No classifier experimentation, new dependencies/services, model API calls, commit/push/deployment, or permission changes. All code edits by Sol; supervisor performs read-only review and avoids duplicate checks.
- Completion evidence: issue/PR-author/change-summary flows rendered; related evidence opens only safe revision-bound code locations; test presence and check success never imply exact test execution; summary-only exposure unchanged. Sol runs focused Vitest, typecheck, build if UI integration warrants, and diff check. Live GitHub/user-time benefit remains unmeasured unless separately demonstrated.
- Projection checkpoint: RED first failed because `pr-evidence-review` did not exist; GREEN passed 7 projection cases after correcting two supervision findings: a linked issue is a source, not maintainer approval, and collected/matching evidence is observed rather than a verified relation. Only bounded deterministic receipts can mark an individual link verified.
- Status: implementation complete in the approved worktree. Ordinary full reports and authenticated saved-PR details now use PR-to-Evidence Review (source, code, tests, execution, next inspection); strict typed-contract companion and summary/share presentation remain unchanged. No assessable objective produces a neutral collected-change view without the task/description warning, re-prompt, or automatic coverage panel; actual failed CI remains visible.
- Code navigation: new reports derive a bounded `codeLocation` only from canonical changed-file status/source revisions, preserve it through signed tenant projection/hydration, and exclude it from portable summaries. Added/modified/renamed files use exact head; removed files use exact base; the first valid patch hunk yields a clearly labelled first-changed-line link. Missing, unsafe, mismatched, cross-repository, credentialed, or non-exact inputs never produce a link.
- Verification: focused production/projection/persistence/render checks passed (226 tests); `/api/analyze` passed 31 tests after rejecting non-exact fixture revisions instead of storing them; dashboard/auth/export/privacy regressions passed 52 tests. `pnpm typecheck`, final `pnpm build` (56 pages), and `git diff --check` exited 0. No model/API call, dependency, raw-code persistence, commit, push, or deployment occurred.
- Final UI review: the empty-objective flow keeps the existing GitHub Post Comment panel and now uses one shared `reportToGitHubComment` change-summary branch for both preview and server-side posting. That branch shows collected changes, review priorities, execution failures and actual collection limits while omitting purpose/contract absence, synthetic requirement coverage/proof-gap messaging and the purpose-dependent re-prompt; it does not mutate the report or expose new raw/code-location fields. Formatter, mocked outbound-route and full-render regressions passed 35 tests; final typecheck and diff-check remained clean. No comment was posted.

## 2026-09-15 — objective/claim separation: first offline implementation package

- Authorized outcome: implement the first research milestone through existing 구현솔: a runnable, shadow-only objective/claim comparison with a versioned, annotation-ready evaluation contract. This package prepares honest evaluation; it does not supply human judgments or establish semantic performance. Reuse the existing recovery worktree and TypeScript/Vitest tooling.
- Allowed files: new `scripts/requirement-role-experiment-objectives*.ts` and `scripts/run-requirement-role-experiment-objectives.mjs`; minimal reusable-helper exports in `scripts/requirement-role-experiment.ts` and test registration in `scripts/requirement-role-experiment-vitest.config.ts`; new sanitized offline artifacts under `docs/verification/2026-09-15-objective-contract/`; this entry. Existing production source, V0–V4 definitions/outputs, live transport, old labels/corpora/results and research report stay unchanged. Do not duplicate the parser, redactor or batch planner.
- [x] Contract first: version/hash the input, rubric, fixed source-unit boundaries, label provenance and denominator/matching policy. Separate objective presence (`yes`/`no`/`unresolved`) from the existing semantic role; a current-PR explicit target can coexist with an implementation claim. Target presence does not imply an executable criterion or proof. Keep source ID/hash/ranges and authority immutable; reject unknown, duplicate, missing, stale or cross-source decisions. No source-authority decisions in model output.
- [x] Annotation round-trip: export/import a source-bound review template with two independent annotator slots, disagreement/unresolved state, optional human-specified subspans and PR-local goal identity links. Export empty judgments; do not seed them from existing AI labels/results or claim the slots verify human identity. Validate references and conditional-context links. No automatic semantic segmentation, paraphrase generation, deduplication or human adjudication in this milestone; do not treat every implementation claim as a target.
- [x] Runnable comparison: add a separately named experiment/CLI using the V0 source selection, structural units, batching, model profile and no-extra-context input policy for both arms. The new prompt/schema/validator permits the independent target axis; schema/semantic differences are recorded. Reuse injected-provider/offline patterns; no network adapter, credentials, live flag, additional context or retry. Default execution makes zero model calls. Preserve per-unit decided/abstained/unreviewed/invalid accounting and privacy limits. New outputs must be no-clobber and contain safe references/metadata, not raw provider text.
- [x] Honest scoring: use the same explicit unit labels and denominators for both arms; legacy `objective_candidate` is its candidate output, not a retrospective reconstruction of missing target judgments. Require compatible, explicitly supplied adjudicated labels to calculate semantic metrics; otherwise return `not_evaluated`/null with counts and reasons, never zero or 100% accuracy. Compute fixed-unit target confusion/counts and per-PR summaries, separating unresolved and unreviewed cases. Goal-level semantic recall, subspan fidelity, 11-role F1 and generalization remain unavailable unless their required labels/matches actually exist; character overlap is not semantic correctness. Keep duplicate source occurrences distinct from declared goal identities without double-credit claims.
- Acceptance: RED→GREEN tests on independent synthetic fixtures exercise goal+claim coexistence, target absence/unresolved, unchanged authority, source-binding rejection, annotation export/import/hash mismatch, missing-label no-score behavior, empty denominators, pending/ambiguous/unreviewed accounting, and actual CLI no-clobber/offline behavior. Fixture-provider tests validate plumbing/contracts, not the prompt's linguistic accuracy. Verify baseline V0–V4 outputs remain equivalent on controlled inputs; preserve existing evidence hashes. Run the dedicated role-experiment Vitest config (including new tests), `pnpm typecheck`, and `git diff --check`; no duplicate full product suite or build.
- Stop/escalate: if reusable preparation cannot be exposed without changing baseline behavior, if genuine human interpretation is needed, or if scope needs production code, new dependency, semantic matching policy or paid execution. No commits, push, deployment, new tasks/subagents or permission changes. Defer automatic proposition splitting, broader selection/context, heldout collection and live comparison until the relevant evidence/authority exists.
- Status: first offline package complete. Added the independent target/role contract, strict source-bound review import/export, injected-provider comparison runner, offline no-clobber CLI and sanitized artifacts under `docs/verification/2026-09-15-objective-contract/`; no production caller, network adapter, key access, paid call, dependency, commit or deployment.
- RED/GREEN evidence: tests first failed on the absent objective module and CLI, then on label-hash omissions; the implementation made all new contract/runner/CLI cases pass. The final dedicated config passed 161 tests with two intentional skips; `pnpm typecheck` and `git diff --check` exited 0.
- Offline evidence: four fixed cases produced 34 registry units and the same 23 V0-selected units as the frozen live result. Both arms planned four calls, actual calls/retries were 0/0, all exported judgments remain empty, and scoring is explicitly `not_evaluated` (`adjudicated_labels_not_supplied`, denominator 0). No source text or raw provider output is persisted.
- Integrity: contract `4a35ffcd44a49aae0566ec882e2af5ca43d5854244da0bdbb95be686404ffac7`; review-template contract hash `fad05aacc6849ecace2163cce79f65869ef8999c7d74a509e2ea997a77eb8e30`; offline result/review file SHA-256 `0cd4db569c768c1f00e3a7917efb7c373f062f5843d80f1b7c8dc47389e8ff2d` / `145f2ab0b6e85b333bafa9c845c2601077c15008ced2991e2e4c05b1e6bfd072`. The four previously frozen pilot artifacts still match their recorded hashes. Human labels and semantic performance remain deliberately unavailable.

## 2026-09-14 — research on product-aligned remedies without case overfitting

- Request/scope: research remedies for the diagnosed causes; no product, prompt, label, scorer, frozen-result or runtime-model change, new PR collection, paid model call or implementation dispatch.
- Clarification superseding the older pending question: an explicit author-intended PR outcome remains a candidate even in implementation-shaped prose; author authority and implementation proof remain separate. This does not promote every implementation report into a target or resolve every semantic label.
- Result: `docs/verification/2026-09-14-role-pilot/research-solutions.md` covers ten causes, thirteen primary research/official sources, representation/annotation/identity/coverage/scope/sampling/variation/evidence/utility remedies, behavior tests, a minimal staged comparison and adoption/stop conditions. Research findings, local observations and unimplemented design proposals are separated; no generalization or improvement claim.
- Verification: all five local evidence-link targets exist; six inspected input/result/code hashes match before and after writing the research artifact. Existing machine-label scores and product behavior are preserved. Research is complete; no implementation or further evaluation has started.

## 2026-09-14 — evaluation-criteria diagnosis; human decision pending

- Authorized: inspect the existing four-PR comparison and clarify evaluation criteria before more code/model tuning. No production, prompt, source-label or frozen-result changes; no paid calls or new PR collection. Supervisor reviewed all four original title/body inputs, 27 machine labels and 34 registry units against the five output ledgers. This is post-result AI review, not blind human adjudication or a new gold set.
- Deterministic finding: the original pilot has only four positive label spans (138 non-whitespace UTF-16 characters). FastAPI #16205 repeats the same positive text in title and body, so these are three distinct positive texts across three PRs, not four independent requirements. Neither the 100% preservation figure nor one pilot run establishes generalization.
- Label-version conflict: Django #21900 title `label-1` is ambiguous in `public-60/corpus.json`, but requirement in the already-existing `public-60-bc/reviewed-corpus.json`. Every live arm called it `implementation_claim`. Independently recomputing only preservation with that prior reviewed corpus gives 138/193 = 71.50% for every arm, rather than 138/138 = 100%. Original scores remain unchanged; this is diagnostic sensitivity to a previously available AI-reviewed label version, not human accuracy or a new preferred score.
- Granularity mismatch: Flask #5917 body `gpsp_2_1` covers offsets [0,207), joining original ambiguous `label-2` [0,73) with historical non-requirement `label-3` [74,207). The one-role-per-paragraph output cannot simultaneously reproduce both original sentence labels. Diagnose unit boundary and role ambiguity separately from model error; do not improve the score by silently merging labels or splitting only known failures.
- Scope-confusion examples for human review: Django #21900 `gpsp_2_15` (target branch), `_16` (commit-message format), `_17` (review process), `_19` (ticket flag), `_21`/`_22` (conditional generic docs/screenshots checklist); FastAPI #16205 `gpsp_2_4` (suggestions to improve a different prompt-file PR). Supervisor interpretation: these are process, metadata, conditional template instructions or work outside this PR's declared translation scope, not automatically this PR's desired product behavior. Inclusion of a sentence in a checklist is not by itself an exclusion rule; a specifically stated test/docs deliverable may still be an objective. Existing labels remain untouched.
- Ambiguity requiring policy: Flask #5917 `label-2` describes the resulting OPTIONS behavior; Django title/body describe the fix in past/present-tense PR prose. These can express the author's intended outcome while also reporting implementation. Grammatical tense alone should not settle objective-vs-claim. Svelte #18752 body names dependency-change reasons but does not independently specify an externally verifiable behavioral acceptance condition. Proposed readings remain hypotheses until the target concept is agreed.
- Proposed annotation rubric (not implemented/frozen): record (1) exact smallest coherent proposition and necessary neighboring context, (2) target scope: this PR's behavior/deliverable, contribution process, background/history, another task, or unresolved, (3) semantic role or an explicit allowed-role set for unresolved overlap, and (4) immutable source authority separately. Author-stated objectives stay `author_claim`; neither classification nor checked boxes prove implementation, tests or Supported/met. Preserve links and conditional wording without importing linked-page contents that were not collected.
- Proposed evaluation safeguards (not a new scoring implementation): name and hash the label version; freeze it before future outputs; keep ambiguous/allowed-label outcomes separate from clear-label errors and selective coverage; use PR/group-equal summaries alongside pooled character scores; disclose title/body duplicates; report selection recall and unit-boundary losses separately; never score policy-unreviewed regions as correct exclusions. Fine-grained roles require fine-grained labels: current three-class labels cannot establish 11-role macro-F1. The four viewed PRs and any reviewed portion of the old 60 remain development data, not a fresh holdout.
- V4 limitation: initial input/prompt/schema request hashes match V3, expansion calls = 0. The observed one-unit output difference is a separate-execution variation, not evidence for context expansion. All versions used author-claim title/body sources with empty task text; this pilot does not exercise authoritative-issue adoption or establish safety hard gates.
- Delegation: existing 구현솔 Sol/high was assigned only a new `diagnostic-audit.json` with source-bound unit/label intersections, PR-level and common-selection summaries, mechanically attainable agreement ceilings, duplicate counts and original-vs-prior-reviewed-label sensitivity. No semantic decisions or code edits delegated; final artifact not yet reviewed by supervisor. No polling/automatic waits started.
- Decision needed: should an explicitly described author-intended outcome in PR prose be retained as an author-claim objective candidate even when phrased as an already-made change, while implementation proof remains separate? Supervisor recommends retaining the candidate with explicit authority/uncertainty, not silently promoting every implementation report. Human scope choice and then independent human labels are needed before freezing the rubric or changing model behavior.

## 2026-09-14 — source-role research experiment implementation

- Request: implement the user's research design through existing 구현솔; avoid case-specific patches and premature adoption. Astra owns design/integration; Sol/high implements. Reuse this recovery worktree. Existing production behavior, original 60-PR artifacts and B/C evidence remain frozen.
- Scope: a separately invoked, shadow-only source-role V0–V4 experiment under `scripts/requirement-role-experiment*` and `scripts/run-requirement-role-experiment.mjs`, plus this log. Reuse existing source parser/redaction/selection/package/schema helpers read-only. No new dependencies, production callers, runtime flags, trained classifier, deployment, commits, source fetching, live calls or secret access.
- Approved-design interpretation: implement the comparison mechanism, not adopt B. V0 preserves the existing source-ablation B behavior. V1 changes candidate coverage only (stable bounded batches of all registered source units; retain V0 semantic constraints). V2 changes only lexical/semantic hard constraints into hints; IDs, source binding, schema, privacy and source authority remain enforced. V3 changes only bounded structural-neighbor context. V4 permits only still-ambiguous units one same-section context expansion; no provider-error retry. Role definitions, model profile, output schema and basic abstention meaning remain fixed across adjacent versions; required constraint-policy instruction differences are recorded explicitly, not attributed to context.
- Ledger contract: every source structural unit is represented with exact source ID/kind/hash and UTF-16 offsets, immutable authority, selected/attempted flags, model role vs validated outcome, and decided/abstained/unreviewed/invalid status plus reason. Record non-whitespace gaps or unsupported source regions explicitly as unreviewed; do not equate omitted/budget-limited/private/invalid/ambiguous with background or correct exclusions. All-unit coverage never overrides request/token/privacy limits. No source text, raw provider response, credentials, Supported/met or authoritative-upgrade claim in persisted results.
- Bounded transport: injected provider for tests and offline by default; all requests preflighted, maximum 12 candidates and 12,000 input bytes per packet, explicit total-call budget bounded by existing 30-call ceiling. Oversize/remaining units become unreviewed with reason rather than truncation. Context uses exact same-source structural ranges, no diff/CI; V4 only once per ambiguous unit with global budget respected. Network adapter, if provided, must require explicit live acknowledgement and no-clobber output; no live execution authorized now.
- Evaluation boundary: report selection/decision/abstention/unreviewed rates, validator failures, per-call tokens/latency and paired version changes separately from semantic accuracy. Accept source-bound labels only as an optional explicit input; no human-gold claim from old AI labels. New 12/24 split and independent human labels cannot be fabricated. A minimal group-disjoint manifest check and human-label-ready export/scoring may be included if needed for a usable experiment, but do not build annotation UI, automatic clustering or a release gate with unsupported guarantees.
- Task 1 (red then green): add unit/integration tests for full unit accounting, unchanged V0 equivalence, single-variable V1→V4 changes, no-case-specific behavior, bounded batching/oversize handling, explicit unreviewed state, source-role vs authority separation, V4 one-expansion limit, failure/no-retry, stale/duplicate/unknown IDs, source context isolation and redaction.
- Task 2: implement the minimal reusable experiment runner and offline CLI against those contracts. Existing production validators must not be weakened and seed authority must not be forged. The existing validator may run for isolated diagnostics, but its branded result is never exported/reused downstream; experimental outcomes cannot enter product assessment or produce proof.
- Task 3: run the new targeted tests and existing source-ablation/observer/selection/proposal checks, then typecheck. Supervisor independently reviews the diff, executes only additional acceptance probes not already evidenced, verifies frozen source/evidence hashes, and records exact limitations. Full suite only if shared production code changes become necessary (requires scope escalation).
- Status: first-stage offline experiment tooling completed through existing 구현솔 (`gpt-5.6-sol` / high), reviewed by supervisor. Added six files: `scripts/requirement-role-experiment.ts`, its `.test.ts`, `-cli.test.ts`, `-run.test.ts`, `-vitest.config.ts`, and `scripts/run-requirement-role-experiment.mjs`. No production caller, dependency, live adapter, commit or deployment added.
- Verification: worker's final dedicated Vitest config ran eight files: 148 passed, one existing live test skipped (exit 0); `pnpm typecheck` exited 0. Supervisor inspected actual RED/GREEN outputs and independently reproduced malformed-output rejection and oversize-only zero-call accounting. Offline CLI on the original 60 PRs passed: 640 registry units = 623 structural units + 17 gap regions; all 95,390 non-whitespace UTF-16 characters covered exactly once, including 550 gap characters, with matching range hashes. All five ledgers contain identical registry IDs; V1/V2/V3 candidate batches match; V3/V4 initial packet hashes match; actual calls = 0. Temporary detailed output: `/private/tmp/agentproof-role-check.RgYRkr/offline-60.json` (not durable evidence).
- Integrity: all 35 frozen public-60 and B/C manifest artifacts match. The original 485 source/config files retain SHA-256 `007d878504213357845f999792badc886796bbd3c81b3ca3ad67d7f647067469` when excluding the six new experiment files. Full product suite was not repeated because shared product code/config remained unchanged.
- Interpretation limits: the registry accounts for all source, but code/HTML/policy-only units and unsupported gap regions remain explicitly unreviewed rather than being forced into model selection. V0/V1 retain legacy product-validator outcomes, with stricter research-schema diagnostics separate; V2+ enforce that stricter schema, recorded as `outputValidationPolicy`. Therefore V1→V2 is a semantic-constraint-only comparison only on originally schema-valid outputs; malformed-output effects must be reported separately. V4 expansion cannot run without new in-budget same-section context; failed expansion retains the initial abstention.
- Remaining: this is runnable offline comparison infrastructure, not the full empirical study or evidence of improved generalization. Real API transport, observed model/cost accounting, version-selected heldout execution, human-label scoring and group-disjoint split validation are not implemented. The new 36 PRs, two independent human annotations, actual paid comparison and adoption decision still require separate inputs/authorization. Existing AI labels were not treated as human gold; no performance claim or automatic adoption made.
- Follow-up review/pilot: a four-case, four-repository fixed-order sample and input hashes were frozen before experiment results under `docs/verification/2026-09-14-role-pilot/`; the run corpus removes all labels. The original public-60 hash remains `9e2c7eb7cd679f44d4ede3b316fc98890d2d6cd18ad667ae0464b26c8865b78f`.
- Review fix (RED/GREEN): early-case V4 expansion could consume the global budget before later-case initial comparisons. Added a regression test and changed only the experiment runner to execute all initial V0–V4 packets before any expansion. The sample plans 24 initial calls, reserving at most six of the 30-call budget for expansion.
- Live follow-up: added an opt-in adapter/CLI that reuses the existing OpenAI Responses transport, loads only `OPENAI_API_KEY` from an explicit `--key-file` through the installed Next dotenv parser, keeps offline as default, preserves no-clobber output and records only sanitized model/status/token/latency metadata. The selected parent `.env.local` was locally verified to contain exactly one nonempty key assignment without printing or persisting its value.
- Live execution blocker: `live-plan.json` froze the existing four-case sample, 24 initial request hashes, model profile and result-independent character mapping before results. The external-execution reviewer rejected the single requested run before process start because it treated the trusted two-task no-model-evaluation-call instruction as controlling. No workaround or second attempt occurred; calls/retries/responses/charges are zero and all semantic metrics remain unmeasured. See `live-blocker.json`.
- Follow-up verification: dedicated Vitest passed 152 tests with one existing live test skipped; `pnpm typecheck` passed. Post-fix sample and full-60 offline runs exited 0; the 60-case run accounted for 640 units in 4.52 wall seconds with zero calls. No new 36 cases, two-human review, product source change, commit, push, deployment, superiority claim or adoption occurred.
- Reapproval outcome: a later delegated task reported explicit user acceptance of the public-source transfer and maximum-30 paid-call risk. The new external approval request stated that risk, destination and ceiling, but the reviewer did not accept relayed transcript/tool content as trusted direct authorization and again rejected the command before process start. No live artifact, call, retry, response, token, latency or charge exists; no workaround or further request was attempted. Evidence: `docs/verification/2026-09-14-role-pilot/live-reapproval-blocker.json`.
- Direct-approval run: the user then approved directly in the implementation thread; external execution was authorized and started. The local Vitest artifact runner retained its default 5,000 ms timeout and terminated before the experiment returned or wrote its sanitized result (exit 2; 5.85 wall seconds). The opened output was zero bytes and renamed `live-result-approved.incomplete-zero-byte`. Between zero and 30 external requests may have been sent; the exact count/cost is unavailable because no durable per-call journal existed. No retry or budget reset was attempted because a second run could exceed the single-run 30-call authorization. No live performance or superiority claim is supported; evidence: `live-runtime-timeout-blocker.json`.
- Timeout/journal hardening (corrected; supersedes the earlier 60,000/65,000 ms overall settings): live comparison now has an explicit 2,100,000 ms (35-minute) total deadline, while the artifact-test wrapper is exactly 2,105,000 ms so only five seconds are reserved for abort handling and result flush. Normal completion clears the timer and returns immediately. At the total deadline the active fetch is aborted through the combined signal, remaining packets are marked `total_timeout`, and no later provider call starts. The per-API-call packet limit remains 60,000 ms; initial comparisons still run before expansion, with the frozen pilot's 24 initial calls leaving at most six expansions under the unchanged 30-call ceiling and zero-retry policy.
- Durable cycle evidence: live mode creates `<output>.calls.jsonl` with no-clobber semantics. Each API cycle fsyncs a sanitized `started` record immediately before transport and a `finished` provider-success/failure record afterward, containing call/case/version/pass/request hash, timestamp, status and safe status/model/token/latency/error-category metadata only. A start without a finish remains explicitly in-flight/unknown; keys, source text and response bodies are never journaled.
- Completion evidence: `comparisonCompletion` reports the observed execution state separately from semantic accuracy, including planned/attempted/valid/invalid/unavailable/unexecuted counts and per-case/version `not_planned`, `not_run`, `partial`, `complete`, or `complete_with_failures` status. Overall status separately identifies offline non-execution, total-timeout partial results, other partial execution, completed failures, and complete execution; omissions are never converted into low accuracy or success.
- Hardening verification: RED reproduced rejection of the approved 35-minute limit. Fake timers then verified continued execution beyond 60 seconds, immediate early completion, abort at exactly 35 minutes, zero later calls, unchanged 60-second request packets, and preserved unexecuted records. Final dedicated config: 9 files passed, 155 tests passed and one existing live test skipped; `pnpm typecheck` passed. No network experiment, key access, product source change, dependency, commit or deployment occurred.
- Approved 35-minute live run: after direct authorization in the implementation task for a separate one-time maximum-30 paid run and public-source transfer, the frozen four-PR sample and pre-result hashes were revalidated and executed once with `gpt-5.6-luna`. It completed in 129.75 seconds with 24/30 calls, 24 validated outputs, no provider/validator failure, no timeout, no retry and no V4 expansion. The durable journal has exactly one `started` and one `finished` record for every result call; the maximum observed call latency was 14,229 ms. Raw source text was absent from both persisted artifacts. Result: `live-result-35m.json`; call evidence: `live-result-35m.json.calls.jsonl`; comparison: `live-result-35m-summary.json`.
- Live comparison boundary: measured agreement uses 27 pre-existing machine-proposed labels over 2,377 labeled non-whitespace UTF-16 characters, not human gold. V0/V1/V2/V3/V4 agreement was 62.05%/49.60%/58.77%/41.06%/45.65%; all preserved the machine-labeled requirement characters, while non-requirement-to-requirement misclassification was 0%/29.74%/27.52%/40.74%/34.83%. V0 had lower selected coverage (23/34 units versus 29/34), and one four-PR run cannot support a superiority, generalization or adoption claim. The prior attempt's unknown 0–30 calls/cost remains separate and unresolved.

## 2026-09-14 — supervisor label review and live B/C comparison

- Authorized: Astra/high owns semantic review and conclusions; existing 구현솔 Sol/high may implement only minimal evaluation artifact tooling. No product changes, commits, deployment or runtime-model switch. Preserve the original public-60 package unchanged; new outputs go under `docs/verification/2026-09-14-public-60-bc/`.
- Plan: inspect every original source/label; freeze an explicit supervisor review (not human gold) before seeing new B/C outputs; mechanically apply reviewed labels and split the same 60 cases into four 15-case batches; validate all batches offline; run unchanged B/C harness with `gpt-5.6-luna`, max 30 calls/batch and 120 total, no retries; independently verify rows/input hashes and report paired coverage, noise promotion, exclusions, failures, usage and latency.
- Predeclared interpretation: B/C differ in contextual input, not model identity. Report overall and selection-conditioned requirement preservation separately, with title/body separation; omitted negative labels are not successful exclusions. Report ambiguous-label promotions separately. Context C is not recommended for adoption unless paired requirement coverage improves without increased non-requirement/ambiguous promotion or invalid outputs; even then disclose extra tokens and single-run uncertainty. No automatic product change.
- Review scope: all original 511 spans retained; semantic decisions are supervisor-authored from original title/body, not evaluated-model output. Explicit PR target titles are judged for intended scope, not grammatical tense alone. Body implementation reports stay ambiguous when their normative intent is unresolved; process/templates, upstream release history and execution claims are not requested product behavior.
- Pre-live freeze: all 60 cases / 511 labels reviewed; nine classification changes yield 92 requirement, 385 non_requirement, 34 ambiguous. Independently verified unchanged inputs, case order, label text/boundaries and exact four-way partition. Original corpus SHA-256 `9e2c7eb7cd679f44d4ede3b316fc98890d2d6cd18ad667ae0464b26c8865b78f`; review file `3f28b6c097237effecd3ec731d333b31791caea12c881784f5d2c178b06043b1`; reviewed corpus `f2c58a4afb8bfdcd0b5fe7e848af0e319b50b275e550ad9f8c77fb7f0d569c7f`. Machine-reviewed annotations, not human gold. This freeze preceded all live calls.
- Completed: Sol/high implemented three evaluation-only helpers; self-check passed. All four offline preflights passed with zero calls. Four live batches exited 0, 30 requests each, 120 total, no retries; batches partly overlapped, B precedes C within each case. B responses valid 59/60 (Flask #5945 role_ceiling_violation), C 60/60. CLI success is not a claim that all model outputs passed validation.
- Supervisor result: B/C preservation 66/92 vs 73/92; fully-selected 66/89 vs 73/89; non-requirement promotion 10/385 vs 13/385; ambiguous promotion 3/34 each. Paired requirement gains/losses 8/1. Total tokens 98,320 vs 239,056 (2.43x), 337,376 combined. C fails the predeclared no-added-noise criterion; no adoption or runtime change.
- Evidence: dry/live inputs and request hashes match, observed model identical; supervisor independently recomputed all 1,022 B/C row coverages from original text positions and role intervals. Original 15 artifacts and 485-file source/config freeze remain unchanged. Detailed report, summary and row audit saved under `docs/verification/2026-09-14-public-60-bc/`. Only that directory and this log changed in this task; pre-existing policy/sample edits preserved. No product tests rerun because product source is unchanged; evaluation checks were run directly.
- Remaining recommendation, not started: narrow intent-versus-implementation and process/reference/background boundaries, distinguish selection omissions, then use a separate untouched evaluation set and human label confirmation before adoption. Additional implementation/calls require a new scoped approval. All current outputs remain local and uncommitted.

## 2026-09-14 — Astra/Sol two-task setup

- Request/scope: Astra high plans/reviews; existing 구현솔 uses Sol high for implementation. Policy-only edits to parent and recovery `AGENTS.md`; existing worktree reused, no product changes, dependency install, test rerun, Git state move, commit, or new task.
- Both policy files match and record the two task IDs, recovery execution directory, single code writer, handoffs normally <=8 short lines and results <=5 short lines. Default is user-requested result retrieval; explicit result forwarding is one-shot with no reply loop or polling.
- Verified: stored models are Astra/high and Sol/high; implementation setup message delivered with explicit Sol/high. Sol's completed confirmation reports the shared recovery path, branch `codex/recover-bounded-target-20260913`, and HEAD `1efeca67adafd6b5d07bef0961c480ca9824e9b2`. Policy assertions and `git diff --check` pass. App task cwd remains the parent project; commands explicitly target the recovery worktree, not relocated task metadata.
- Next: await a concrete implementation request. No implementation or automatic result-forwarding loop started. Policy/log edits remain uncommitted.

## 2026-09-14 — restored baseline checkpoint and larger public source sample

- Request: preserve the restored, verified baseline with a local commit, then prepare a larger public PR sample before further B/C model evaluation.
- Authorized scope: this recovery worktree; recovered source/config/tests and their evidence; new public source corpus under `docs/verification/2026-09-14-public-60/`. No new product behavior, dependency/model changes, push, deployment, or new paid model calls.
- Baseline verification: `pnpm test --maxWorkers=1` exited 0: 204 test files passed, 3 skipped; 2,760 tests passed, 66 skipped; duration 69.63 s. `git diff --check` exited 0. The 485-file source/config hash remains `007d878504213357845f999792badc886796bbd3c81b3ca3ad67d7f647067469`, identical to the prior typecheck/build/model-comparison source freeze. Typecheck and build are prior verified results, not rerun in this step.
- Recovery evidence: all 82 manifest file hashes match. The pre-existing `src/lib/ordinary-requirement-outcomes.test.ts` is outside that manifest but inside the verified 485-file freeze (SHA-256 `24b4c3dd89e97740f4b3b1a0572f7dc9ace26a0265f47ecf9787366ed5822351`); it is preserved unchanged. Seventeen canonical prior evidence files copied byte-for-byte into this worktree for the checkpoint. Superseded preliminary freezes/dry runs remain in the original directory.
- Recovery limits remain: some declarations/imports and four compatibility strings were reconstructed; original added tests in two locations were unavailable. This is not a byte-identical recovery claim. See `recovery-manifest.json` and historical `docs/verification/2026-09-13-recovery/completion.json`; its pre-fix whole-suite failures are historical and superseded by the whole-suite result above.
- Sampling plan: 60 public merged PRs, six per fixed repository stratum, non-overlapping known prior cases. Freeze candidate frame and deterministic selection rules before source reading; retain template/empty/negative examples. Record title/body snapshots, source hashes, exact span labels and review status. Label proposals are not human-approved gold, and this selected sample is not population-representative.
- Delegation: one bounded implementation worker, `gpt-6-astra` / low; new corpus directory only. Supervisor owns baseline commit, integration and evidence verification.
- Baseline checkpoint complete: `1efeca67adafd6b5d07bef0961c480ca9824e9b2` (`codex/recover-bounded-target-20260913`), 102 files, including the restored source and 17 byte-identical canonical evidence files. No push or merge. Original main-worktree edits preserved.
- Public sample preparation complete: 60 unique public merged PRs, six each from ten repositories; zero overlap with 69 frozen historical URLs. The original `golang/go` search had zero eligible results; a supervisor-approved, pre-fetch amendment substituted `gofiber/fiber`, preserving date window/ranking/quota and the empty original frame. No label-driven sampling or privacy replacement.
- Preliminary labels: 511 total (85 requirement, 385 non_requirement, 41 ambiguous), all pending human acceptance; seven cases naturally have no positive requirement label. Supervisor independently checked frame/hash rankings, final selected source identities, public/merged metadata and dates, exact non-overlapping spans, and complete coverage of all 95,390 non-whitespace UTF16 positions. One source was re-fetched from GitHub and matched exactly after LF normalization, including title/body/head/base SHAs. These checks do not validate every semantic label.
- Offline preparation: worker ran existing source-ablation CLI once, exit 0 (one test passed, one live test skipped). Supervisor inspected its result: 60 cases, 511 labels, A valid for all 60, B/C not_run for all 60, actualRequestCount 0 and liveRequested false. Supervisor verified all 15 final artifact hashes and all 511 self-contained review-pack label entries. Product source/config freeze remains unchanged.
- Handoff: `docs/verification/2026-09-14-public-60/README.md` explains sampling and limits; `REVIEW.md` and `review-pack.json` provide original sources and provisional labels/rationales; `validation-receipt.json` and `manifest.json` preserve validation and integrity. New sample artifacts and this post-checkpoint log update are saved locally but not committed. The approved restored-baseline checkpoint is committed.
- Remaining work (not started): human semantic/boundary review and label freeze, then separately authorized B/C model evaluation. Title/body-only sampling excludes linked-issue authority and is not directly interchangeable with prior mixed-source cohorts or a population-representative estimate. Existing 30-call live guard is unchanged; up to 120 requests across four 15-case batches would require a separate approved run. No new runtime model setting, product feature, paid model call, or deployment.
- 2026-09-15 one-time fixed-four V0–V4 live rerun: after direct user authorization to transmit the public source text and spend up to 30 new OpenAI calls independently of earlier unknown charges, ran the existing bounded harness once with `gpt-5.6-luna` (60-second request timeout, 35-minute total timeout, zero retries). Completed in 124.82 seconds with 24/30 calls; all 24 provider outputs validated, with no provider failure, invalid output, timeout, retry, or V4 expansion. Saved the full comparison, the 48-event metadata-only call journal, and a derived comparison summary under `docs/verification/2026-09-15-role-pilot/`; verified 24 matched start/finish pairs and no persisted raw source text.

## 2026-09-15 — three-role operating transition

- Verified the shared recovery worktree (`codex/recover-bounded-target-20260913`) and task routing: Sol/main `019ffd47-bb30-7dc1-a3ae-2218a50da4dd` (high), Astra/implementation `01a0a3be-9ed5-72b2-9a64-3d501484997e` (medium), and Terra/utility `01a0a3be-becb-7092-aab0-508d972ca461` (high). Main sends one self-contained, bounded task card; a worker reports only on completion or a genuine blocker, prefixed `결과 보고만; 추가 작업 시작 금지`.
- Coordination boundary: only one mutating worker at a time; Terra may run concurrent read-only work only. The previous 구현솔 task is retired from default routing. No commit, push, deployment, external call, or policy/product change is authorized by this transition.

## 2026-09-15 — assessment-independent review candidate display

- Request/scope: separate candidate display from strict assessment and sentence-classification results; only PR evidence projection, ReportView, Markdown, related tests/evaluation, and this recovery entry changed. Existing dirty state retained; no schema/verifier/classifier/observer/admission/policy changes.
- VERIFIED: Full/Dashboard/Markdown/comment candidate cards, exact links, and requirement-provenance source remain invariant across six assessment variants. Zero requirements stay neutral; typed-contract presentation, base/head/rename links, test-versus-execution language, and redaction checks pass.
- Checks: 74 focused tests + 9 offline evaluation tests passed; typecheck and diff-check exit 0; own incremental diff reviewed. Synthetic 3/3 with 18 expectation checks; fixed 10-case as-is/source-adapted profiles each show 26 cards in 10/10 cases (baseline 0), source match 10/10 (baseline 0), external calls 0.
- Known limit: first-inspection hit@1 regressed 9/10→0/10 with 10 missing explicit file recommendations in each profile; no ranking/scoring tuning performed. Exact SHA/PR URL remain missing in fixed fixtures; source match is a provisional metadata metric, not semantic/human gold. Details: `docs/verification/2026-09-15-pr-evidence-review/assessment-independent-summary.md` and `evaluation-assessment-independent.json`. No blocker, commit, push, deployment, paid call, or follow-up started.

## 2026-09-22 — Public analysis readiness candidate

- Request/scope: existing public PR flow, browser stability and user-test preparation;
  preserve prior changes; no Jev, model change, paid evaluation, production deploy,
  credentials, permission or quota-policy changes.
- Implemented: archived first-inspection deduplication and exact export links;
  supporting questions and neutral no-goal state; non-JSON error recovery. Follow-up
  fixes isolate history access/save/clear failures from analysis, prevent false
  share-copy success, reuse the clipboard fallback, render reopened history as an
  explicit summary, and give input errors correction rather than waiting advice.
- Verification: prior 277 tests retained as evidence; changed-flow run 9 files /
  76 passed; typecheck and final production build passed. Four handler failures and one input-guidance failure
  were reproduced before repair. Local HTTP summary store/read probe passed.
  Browser: desktop and 390px mobile viewport, demo/manual/error recovery/history,
  portable/saved summaries, one real public GitHub PR and exact commit link.
  No paid model was called. Full suite not repeated; final build result and limits
  are in `docs/deployment-smoke.md` under the 2026-09-22 checkpoint.
- User testing: `http://127.0.0.1:3100/analyze`, model-disabled local server;
  demo → generate → Recent → reopen; invalid URL → pasted evidence → generate.
  Public URLs can exercise GitHub collection but do not generate model navigation.
- Remaining: public access identity plus distributed request/total paid-use limits
  require owner decision. Production firewall previously read as disabled with zero
  custom rules. Real OAuth login/tenant durable save need approved callback/service
  access and user login; cross-device preview needs an authorized deployment.
  Browser automation clipboard could not expose/paste copied data; OS clipboard
  verification remains a user check. No retention or auth boundary was relaxed.

- Approved UI follow-up (2026-09-22): applied the accepted warm-neutral dashboard
  layout to PublicGitHubDashboard, PrEvidenceReview and globals.css; ordinary PR
  objective, first code link and reason now open immediately, while reviewer
  questions and supporting details use native disclosures. Added two focused flow
  regressions; no report schema, ranking, API, privacy or auth changes.
- UI validation: 13 focused files / 111 tests: 110 passed, one existing
  ordinary-documentation-presentation assertion failed (same failure reproduced
  against pre-task component snapshots). After the final picker adjustment,
  3 affected files / 37 tests passed. Typecheck, diff-check and final production
  build passed. Initial build/output contention resolved by stopping the worker's
  dev server; final production server is local port 3111.
- Browser UI evidence: actual React production build with isolated fixture APIs
  on port 3112; desktop 1440px, mobile 390px, 320px long path; selection/focus,
  native question keyboard toggle, copy feedback, loading/empty/error/refresh
  states, retained inputs/report after analysis error, Recent reopen and portable
  summary checked. Exact commit/line href preserved. Screenshots and baseline
  failure/build logs: /private/tmp/agentproof-ui-implementation-20260922/.
  Fixture API success is not live OAuth/tenant persistence/model evidence; OS
  clipboard payload remains unverified. Cross-device use still requires an
  authorized Preview deployment. No commit, push, paid call or deployment.

- Approved copy simplification follow-up: removed only exact repeated next-step
  text, kept distinct/missing-link guidance, and moved search scope plus head/date/
  priority metadata into disclosures. Candidate/source/execution uncertainty and
  exact links remain visible; the review heading remains available to screen readers.
- Resolved the prior documentation test failure as a real presentation omission:
  ordinary-review branches bypassed the existing report UI and three Markdown
  summary sections. Restored the same fixed-vocabulary presenter (no schema or
  inference change), with report UI in a closed Documentation evidence disclosure.
  Split the existing test by surface, preserving all privacy/scope assertions;
  before repair, four affected surfaces failed independently.
- Verification: 14 affected files / 133 tests passed, typecheck and final build
  passed, diff-check clean. Actual production UI with isolated local fixture APIs
  checked at 1440px/390px; source/search and full SHA disclosures open correctly,
  documentation findings are readable with no horizontal overflow. PNGs and logs:
  /private/tmp/agentproof-ui-copy-20260922/. Local 3111/3112 remain available; live
  OAuth/store/model and OS clipboard limitations are unchanged. No deployment.

- Approved authentication follow-up: public PR requests that can invoke a paid
  provider now resolve the existing opaque durable tenant session before GitHub
  collection, then enforce the existing same-origin CSRF check. Missing, forged,
  expired, revoked and inactive-member sessions fail closed; identity headers,
  supplied GitHub tokens and operator diagnostics do not substitute for a session.
  Auth-store failure is bounded. Demos, pasted evidence, saved summaries, and
  deterministic-only PR collection remain public; a demo mixed with a URL cannot
  attach either paid provider. Repository privacy is unknown at the entry gate,
  so configured model-capable PR URL requests require login before collection.
- Existing OAuth now carries only an allowlisted, sealed return destination;
  analysis sign-in returns to /analyze, existing entry defaults to /dashboard.
  PR text/tokens are not persisted for redirect recovery; the UI asks users to
  enter the PR again. Gemini default/model selection and quota values unchanged.
- VERIFIED: focused run 17 files: 167 passed, 6 skipped, 1 pre-existing failure;
  authentication boundary 15/15 passed again after strengthening mixed-demo
  provider assertions. OAuth start/callback return, unsafe destination fallback,
  login handler failures, valid sessions and public summary routes covered with
  fake network responses. Typecheck, production build and diff-check passed.
  Logs: /tmp/public-auth-{final,boundary-final,typecheck-final,build}.log.
- Existing failure: ordinary-static-types.test.ts requires “direct union
  membership” in ReportView output. Reproduced identically using the pre-auth
  HEAD API route (5 passed/1 failed); restored the working route afterward.
  This display defect is outside the authentication package, not repaired.
  Comparison: /tmp/public-auth-preexisting-static.log. Full suite not run.
- Remaining: actual browser GitHub OAuth, deployed durable session/store and
  paid provider execution were not exercised. Login does not impose usage or
  cost ceilings; quota/budget policy and deployment remain separate decisions.
  No new external configuration, paid call, commit, push or deployment.

- Approved monthly budget package: added the global estimated-KRW ledger and
  service-role-only `202609220001_paid_analysis_budget.sql` RPC. Atomic reservation
  and exactly-once settlement enforce 30,000 KRW new-run soft stop and 50,000 KRW
  hard pause; active-run follow-ups are distinguished from new admissions.
  Pending/unknown usage retains reservations, including timeout/crash/store error;
  duplicate owners/calls/closed runs cannot submit again. No in-memory fallback.
- Wired public analyze, webhook, job worker, operator verifier and all source
  OpenAI/Gemini POST adapters. Gemini automatic retries disabled; each application
  call is separately admitted/reserved. Active calls poll the durable pause and
  abort locally on pause/store failure. Budget failures survive adapter/fallback
  wrapping and stop new save/publication. Existing read/demo/summary paths stay
  available. Prior UI/auth/presentation edits preserved; Gemini selection unchanged.
- Accounting: decimal integer arithmetic, per-call upward rounding to 0.001 KRW;
  Gemini total-minus-prompt output avoids double-adding thoughts. Prices, FX,
  validity and IANA month zone must be explicitly configured; none were invented
  or set. Calendar comes from the DB clock; cross-month follow-ups re-admit.
  Verified official Google price/usage/cancellation sources and configuration
  instructions are in docs/deployment-smoke.md, monthly budget candidate section.
- VERIFIED: final affected run 5 files/154 passed (22 runtime budget, 8 actual SQL
  engine, 3 public route budget, 60 worker and 61 webhook tests). SQL ran locally
  in PGlite installed only under /private/tmp/agentproof-budget-pg; queued concurrent
  admissions passed, but this is not deployed multi-connection contention proof.
  Other affected regression runs: 109 provider/evidence tests, 110 navigation,
  89 observer and 12 operator tests passed; existing auth/read/share checks passed.
  Final typecheck/build and diff-check passed. Logs: /tmp/budget-final-checks.log,
  /tmp/budget-typecheck-final.log, /tmp/budget-build-final.log.
- Full suite ran once: 2,984 passed / 43 failed / 74 skipped, with four worker-test
  unhandled errors. Forty-one failures came from legacy unmetered provider fixtures;
  explicit test-only budget isolation restored the 332 affected tests (worker
  unhandled errors absent on rerun). The actual budget tests do not use that mock.
  Remaining out-of-scope failures: missing pr-evidence-review.synthetic.manifest.json
  in evaluation-pack.test.ts, and ordinary-requirement-outcomes.test.ts expecting
  Markdown text “Fulfilled — explicit source requirement”. Neither file/behavior
  was changed by this package; not repaired. Full suite not rerun.
  Initial suite log: /tmp/budget-full-suite.log; affected rerun logs:
  /tmp/budget-affected-final.log and /tmp/budget-route-navigation-final.log (the
  latter's new budget-route failures were subsequently fixed and are covered by
  the final 154-pass result).
- NO_GO for paid rollout until migration and owner monetary/calendar settings are
  approved/applied and durable deployment integration is verified. Legacy OpenAI
  background POSTs fail closed; already-running external background work has no
  budget/cancellation linkage and needs separate inspection/draining. Gemini abort
  is client-only and can still incur charges; polling/network latency and unknown
  external/shared-key charges prevent an exact external 50,000 KRW invoice cap.
  No production settings, user quotas, external permissions, paid calls, commit,
  push or deployment changed. Package stopped after the bounded verification.

- 2026-09-23 operating-preparation package: confirmed Vercel project/team and
  current READY production deployment `dpl_63DfGkRo8C7PcQ1okrD56mPpB7Mj`;
  readable production store URL maps to Supabase `plfqpwuujbrqosijsvhg`.
  Vercel list/env-pull responses hide sensitive values as empty strings; did not
  treat them as missing configuration or overwrite them. Production adapter
  source was not exposed by deployment files; local candidate is direct Google
  SDK, and deployed vercel.json confirms advisory mode. Official Google standard
  3.8 Flash prices rechecked; exact operating key/model/account mapping remains
  unverified. Selected AI Studio project shows Tier 1/5,000 KRW provider cap and
  3.8 Flash spend; mapping to the production key is not established. No cap changed.
- DB blocked: Supabase CLI lacks a management token/DB password; Chrome project
  SQL Editor redirects to sign-in. No remote SQL, migration, env change, preview
  deployment or production promotion ran. Kept the login page for user handoff.
  Existing docs/deployment-smoke.md now contains target, unapplied Seoul-calendar
  config draft, explicit FX/reserve decisions, exact login/migration steps and
  rollback. Draft has null monetary values and must not be applied as-is.
- VERIFIED: read-only Vercel API project/env/source metadata and authenticated
  Google spend UI observations; no secrets printed or saved. Only these two docs
  changed in this package; diff-check passes. Prior budget verification retained,
  no test/build rerun or duplicate investigation of the utility task's two tests.
  Remaining blockers are user Supabase sign-in, verified provider/key mapping,
  and approved FX/call reserve; no new permission, price, paid call, commit or push.

- 2026-09-23 rollout checkpoint: user authorized DB/budget configuration,
  modified-code deployment and one real PR call. The target remains Supabase
  `plfqpwuujbrqosijsvhg`; Chrome's signed-in account lists different project
  `fxokbsifilnkimodxgyl`, and the target SQL page redirects to that account's
  organization list. Direct DB link rejected the stored password; a read-only
  Management API query with the available key returned 401. No SQL or budget
  config was changed. Owner needs to sign in to the target Supabase account or
  provide target DB access via a secure channel; existing FX/reserve config
  still needs read-back before use.
- VERIFIED: local typecheck/build and 188 focused tests (including eight SQL
  engine checks) passed. One whole-suite run: 3,037 passed, 2 known unrelated
  failures, 74 skipped. Vercel Preview `dpl_2LiX2MSrT2zAppEbR8euMkkHhjXC`
  is READY; `/analyze` returned 200, session route returned unsigned 200, and
  unauthenticated Flask #5917 analysis returned `github_login_required` before
  a paid call. Production remains untouched; no authenticated paid PR call was
  made. Next: verify target DB objects/config, apply only missing budget SQL and
  approved values, validate Preview paid flow/ledger, then decide Production
  promotion and run the same smoke there.

- 2026-09-23 production smoke: owner reported the target Supabase migration and
  Luna price/FX configuration applied; `agentproof_paid_budget('config')`
  returned `allowed=true` in the owner's SQL Editor. Deployed current worktree
  to Production `dpl_9zmDLLcYzgPv1W8HzDPpn6dJTxZa` (READY, alias
  `agentproof-pearl.vercel.app`); previous READY deployment was
  `dpl_6TbR3CrqX2BXdrZ3mGPKt6NmNE8o`. Preview OAuth start returned 409
  because callback origin is Production-only. Production `/analyze` returned
  200, OAuth start succeeded, browser GitHub sign-in reached dashboard, and an
  unauthenticated analyze POST returned `github_login_required`.
- One authenticated Production analysis of public Flask #5917 returned HTTP
  200 with source/changed-file/check fallback, but goal interpretation was
  unavailable and no first inspection was ranked. This is not a successful
  navigation smoke. Vercel request log showed 200 and no internal error log;
  exact model failure remains unknown. Awaiting owner's metadata-only budget
  ledger query to determine whether paid calls were reserved/settled. Do not
  repeat the paid PR call or claim the 30k/50k behavior is production-verified.

- 2026-09-23 full-launch readiness check: owner supplied a ledger aggregate
  (`calls=2`, `milli_krw=1658`, `states=known`) and approved launch work. One
  additional authenticated Production analysis, Svelte #18752, returned a
  source and exact-head changed/check evidence but no interpreted goal or
  ranked first location. Flask #5917 and Svelte #18752 are therefore failed
  navigation smokes; their precise failure categories remain unobserved.
  Production public pages returned 200 and unauthenticated analyze/operator
  requests were rejected. No new deployment, commit, push, DB change, or
  production setting change occurred during this check.
- Local typecheck and build passed; whole Vitest run had 3,037 passed, 2
  failed, 74 skipped. Failures: missing synthetic evaluation manifest and a
  stale/different ordinary-requirement Markdown expectation. The existing
  production regression script stopped at the first PR because it sends an
  anonymous analysis request while the deployed paid path requires GitHub
  login. The local ops drill gate reports all four evidence categories stale.
  Current Production deployment is READY but comes from a dirty worktree,
  not an identifiable commit. Production model-routing values were not read:
  pulling all Production environment values would also access secret keys
  and was denied. Full public launch remains NO_GO pending a successful
  goal-to-first-location live analysis, an authenticated regression gate,
  fresh ops evidence, and a reproducible release revision.

- 2026-09-24 PR credential routing (local only): `/api/analyze` now requires a
  durable session for any PR URL, selects a tenant-bound active installation
  token for a connected repository, or uses the transient GitHub App user
  token only after public ownership/access classification. Client PAT input
  was removed; install, reconnect, and reauthorization actions were added.
  Focused auth, routing, UI, replay, and typecheck checks passed. The one full
  Vitest run had 3,048 passed, 4 failed, 74 skipped; two new stale tests were
  updated and passed in focused reruns. The remaining two failures match the
  pre-existing missing evaluation manifest and Markdown expectation. A GitHub
  App user token cannot reliably reveal an uninstalled private repository
  administered only through collaborator rights, because the App lacks access
  to that repository; GitHub may return 404. That case remains denied pending
  a product decision on whether to exclude it or change the login authority.
  Supervisor review additionally bound each connected grant to GitHub's live
  numeric repository ID before returning its installation token, preventing a
  stale name from selecting a different repository. The external-public path
  now accepts verified public visibility when GitHub omits the optional
  permissions object, but still requires installation for explicit admin
  access. Focused routing/UI tests: 198 passed, 6 skipped; typecheck and diff
  check passed. Full Vitest before that last small public-classification change:
  3,053 passed, 2 failed, 74 skipped; only the two pre-existing fixture and
  Markdown expectation failures remain. No live GitHub analysis, commit,
  push, or deployment was performed for this change.

- 2026-09-24 persistent GitHub login (local only): GitHub App user access and
  refresh credentials are encrypted into the revocable server-side GitHub
  session after OAuth callback. Sessions renew for 30 days of activity;
  expired access tokens refresh under a conditional database lease so concurrent
  requests use one rotation. Logout revokes the session and clears credential
  ciphertext, and reports a retryable error if revocation storage fails.
  External public PR analysis reads the session credential after the temporary
  OAuth cookie expires; repository 403/404 responses give a bounded access or
  connection hint. Added migration `202609240001_github_session_credentials.sql`;
  it must be applied before this code is deployed. Focused auth/analysis tests:
  90 passed; focused logout tests: 14 passed; typecheck and diff check passed.
  One whole Vitest run had 3,065 passed, 2 failed, 74 skipped; failures match
  the pre-existing missing evaluation manifest and Markdown expectation. No
  live GitHub credential refresh, database migration, commit, push, or
  deployment occurred.
  Supervisor review corrected refresh error classification: GitHub App client
  configuration errors now remain retryable service failures rather than
  clearing the user's refresh credential. The OAuth callback's privacy label
  now accurately discloses encrypted session-bound storage. Both regressions
  were observed red then green; final typecheck, build, and diff check passed.
  Final full Vitest: 3,067 passed, 2 pre-existing failures, 74 skipped.
  Follow-up: added authenticated daily cron cleanup for expired/revoked GitHub
  credential ciphertext; focused tests 14 passed, typecheck/build/diff check
  passed. Final full Vitest: 3,073 passed, 2 unchanged failures, 74 skipped.
  Rollout: the user reported successful application of the migration in the
  intended Supabase project; this session did not independently inspect that
  project's schema. Production deployment `dpl_4fkRtckRipFGX3XHfwHNMRCPcqvq`
  is READY at `https://agentproof-pearl.vercel.app`. The signed-in dashboard
  loaded `RengGyu/AgentProof`, and a browser-run public Flask #5917 analysis
  completed with three PR-to-Evidence Review goals and exact-commit code/test
  links. The new GitHub-session cleanup route returned 401 without its cron
  credential; its first scheduled execution has not yet been observed. Corrected
  stale "temporary GitHub authorization" UI copy, then reran 8 focused tests,
  build, and diff check (all passed) before the final deployment. Full Vitest
  before that copy change: 3,073 passed, 2 unchanged pre-existing failures,
  74 skipped. No commit or push was performed; production currently includes
  the shared worktree's uncommitted implementation state.

- 2026-09-24 private-analysis rollout continuation: corrected two stale test
  contracts (SWE-bench-only fixture manifest check and review-first Markdown
  assertion) without changing product code. Full Vitest: 3,095 passed, 74
  skipped; standalone typecheck, build, and diff check passed. After explicit
  approval, applied `202609240002_private_analysis_consent.sql` in production
  Supabase project `plfqpwuujbrqosijsvhg`. Read-only postcheck returned
  `migration_ok=true`: consent column and 11-argument RPC exist, old RPC is
  absent, and no private grant remains ON. Added an exact non-wildcard GitHub
  App OAuth callback for the stable Preview alias, retaining existing URLs.
  Preview deployment `dpl_4QVbBtXCpsqiv9kgmGkES2Abx2x8` is Ready with that
  callback set at runtime; alias
  `agentproof-git-codex-recover-bounded-t-ecc674-renggyus-projects.vercel.app`
  points to it. Browser login completed and the dashboard loaded
  `RengGyu/AgentProof`. Live public Flask #5917 analysis produced three
  PR-to-Evidence Review goals with exact-commit code/test links. Private fixture
  `RengGyu/agentproof-evaluation-fixtures` remains analysis OFF, the new
  consent notice is visible, and a private #10 analysis attempt was rejected
  before report generation with a generic connection-required message. A
  clearer consent-required message is a small pending UX correction. No
  private PR model call, commit, push, or production code deployment occurred.

- 2026-09-25 private PR verification preparation: Vercel marks Preview model
  variables Secret, so their prior values could not be independently read.
  Deployed Preview `dpl_6gvCtEgdzcR3ToUDq2fGGg2KPxLf` with explicit runtime
  overrides `AGENTPROOF_NAVIGATION_PROVIDER=openai`,
  `OPENAI_MODEL=gpt-6-luna`, and the stable GitHub callback; build was Ready.
  Repointed the stable Preview alias to this deployment. Browser-run public
  Flask #5917 analysis completed, showing three goals and exact-commit code
  and test links. The private fixture remains analysis OFF; its consent notice
  explicitly describes bounded private goal/code transmission and retained
  summaries/paths/commit references. Await action-time user confirmation of
  private-data transmission and whether the repository should return to OFF
  after the single test. No private model request or production code deploy.

- 2026-09-25 private PR #10 live test: owner confirmed that private analysis
  should remain ON. Preview Settings PATCH failed with HTTP 401 because its
  request omitted `tenantId`, while the settings route requires it for session
  verification; no product code was changed to bypass this. Using the owner's
  authorized Supabase SQL editor, called the existing exact-target grant RPC
  for `RengGyu/agentproof-evaluation-fixtures` only. It returned
  `analysis_enabled=true`, consent `2026-09-24.v1`, saved reports true, comments
  false; refreshed Preview dashboard displayed Analysis on. A signed-in
  browser request for private PR #10 returned HTTP 200 and rendered three
  review cards. The main code and test files were found, and the code link at
  exact head `529990be3b158e16afbdca0fcc44f9579216aea3` opened. However,
  the introductory PR text became a spurious `Review goal at source offset 34`
  card with README as first inspection; the explicit `unknown/repository`
  fallback was not visible in the main goal heading (only condition offsets);
  code/test links start at line 1 rather than the relevant changed lines.
  The report separates generic suite success from individual-test execution,
  but describes private check metadata as `Public`. Manual analysis appeared
  in local Recent, while the dashboard showed no saved event report, so event
  persistence was not verified. Private analysis remains ON as requested.
  No PR comment, new commit, push, production code deployment, or product-code
  change was made. Remaining work: fix the settings PATCH session mismatch and
  investigate the goal presentation/first-location quality without tuning to
  this one fixture.

- 2026-09-25 private PR live-defect package (local only): Settings PATCH now
  resolves an omitted tenant id from the opaque durable session; explicit tenant
  binding, owner/admin role, same-origin checks and action-time private consent
  remain enforced. Introductory graph spans without a bound requirement no
  longer create offset-only goal cards; grouped requirement text retains the
  conditions/fallback in canonical order. Diff navigation tracks actual side
  line coordinates and picks a goal-term/identifier candidate line, including
  inside added files; evidence grades remain unchanged. The optional edge line
  is metadata only, validated against chunk bounds and the generated graph;
  signed persistence and dashboard projection retain the location. Existing
  graph shapes remain accepted. First-change links now skip leading context.
  GitHub/verifier collection wording is visibility-neutral; related test fixture
  copy was updated without changing expected evidence outcomes.
  VERIFIED: initial focused regressions 5 failed/104 passed, plus added-file
  location regression red; final full suite 3,101 passed/74 skipped (225 files
  passed/4 skipped), typecheck, build and diff check passed. Tests cover consent,
  member denial/cross-tenant rejection, goal conditions, code/test line anchors,
  signed roundtrip, raw-source exclusion and forged location rejection.
  Manual Analyze stores sanitized browser Recent history; dashboard reads
  server saved reports/jobs from the event flow. No broken persistence contract
  found, so no new manual persistence was added. Candidate locations remain
  lexical navigation hints; usefulness on the actual private PR needs Preview
  retesting. Remaining live checks: deploy authorized Preview candidate, save
  settings through the owner UI, and rerun/review the private report. This task
  performed no consent change, private content collection, paid API call,
  commit, push or deployment. Logs: /private/tmp/private-pr-full-final.log and
  /private/tmp/private-pr-build.log. Earlier full run found 16 stale wording
  assertions, corrected before the final full run.

- 2026-09-25 Preview navigation follow-up (local only): test-writing goals
  prefer an available test as Inspect first; implementation goals retain code
  first. Equal goal-word/identifier matches prefer body lines over import or
  comment lines, while stronger import-specific matches retain their priority.
  Default first-change anchors skip added/deleted blank lines. First inspections
  are excluded from duplicate test/other-change lists. Existing exact-commit,
  line-boundary and evidence-grade rules remain in place. Analyze guidance now
  accepts GitHub PR URLs and explains connected private repositories, Analysis
  ON and consent. Card count is grouped goals; the priority count is individual
  unclear requirements, so 2 cards versus 3 requirements is not a counting error.
  VERIFIED: first-selection/import-tie and blank-anchor/duplicate regressions
  observed red then green; 10 focused files/162 tests passed, typecheck and diff
  check passed. Coverage includes implementation-first non-regression, a lone
  test goal, signed dashboard roundtrip, exact revision/line validation, and
  Markdown exports. Log: /private/tmp/private-pr-goal-final.log. Full suite/build
  not repeated for this bounded follow-up. Remaining: Preview validation of the
  new first link and copy; no external call, deploy, commit or push performed.

- 2026-09-25 test-goal line acceptance rework (local only): previous regression
  used an explicit function identifier shared by import and assertion, covering
  only a tied lexical score. It missed import-only matches and the projection's
  fallback to the evidence item's first-change line when no goal-specific line
  existed. Live routing between those paths was not inspected in this local-only
  package. A synthetic import-only match now reproduces the wrong precise link.
  Test-focused goals retain a line only with a goal-word/identifier match in a
  recognized test declaration/call/assertion. Optional text-free lineBasis
  metadata records that navigation basis; generated-boundary validation rejects
  forged basis/line pairs. Without it, test-goal items open the analyzed commit's
  file without a fragment and explicitly state that no goal-specific test body
  line was established. Old graph shapes remain readable but lack that basis,
  so they also avoid a precise test-goal line. Evidence grades are unchanged.
  VERIFIED: import-only regression red then green; focused 9 files/105 tests,
  typecheck and diff check passed. Checks include real body matching, first
  implementation goal, exact revision/line, signed dashboard roundtrip,
  old-shape handling, forged metadata rejection and no raw source in the graph.
  Log: /private/tmp/private-pr-line-final.log. Remaining: Preview acceptance
  check; no external calls, private collection, deployment, commit or push.

- 2026-09-25 Preview private-PR acceptance: deployed the local candidate to
  Preview `dpl_8djka9uZg81TMQicvNCqtgucXfCa` (READY) and repointed only the
  stable Preview alias; Production was unchanged. In the signed-in owner UI,
  fixture Settings saved an OFF→ON roundtrip for Saved reports without the
  previous 401, and a reload confirmed Saved reports and Automatic analysis ON,
  comments OFF. Manual private PR #10 analysis completed and remained in local
  Recent after reload. The report had two bounded PR-author goal cards, no
  introductory offset-only goal, the `unknown/repository` fallback, a first
  implementation link at exact head L5, and its fallback test link at L19.
  The test-writing goal now opens the exact-commit test file without a misleading
  L4 import anchor and says that no goal-specific test-body line was established.
  Private check metadata uses visibility-neutral wording and distinguishes
  suite success from individual-test execution. Dashboard event reports stayed
  empty: manual Recent and automatic event persistence are separate flows, and
  no new Preview-targeted PR event occurred, so live automatic persistence is
  **unverified**. No PR comment, commit, push, Production deploy, or webhook
  reconfiguration was performed.

- 2026-09-25 automatic-analysis timing (local only): queued PR and completed-
  check events now coalesce by PR head; an in-progress/completed head is not
  re-enqueued by another event. The worker waits at least 45 seconds for CI
  registration, keeps known pending checks queued, and permits no-CI analysis
  after the initial wait. New heads remain separate; existing exact-head and
  consent boundaries remain. VERIFIED: focused webhook/queue/worker tests
  218/218, full suite 3,111 passed/74 skipped, typecheck, build, and diff
  check passed. New durable queue migration
  `202609250001_automatic_analysis_once_per_head.sql` is local and unapplied.
  The GitHub App webhook currently points to Production, not Preview; the
  worker cron is daily, so prompt automatic report availability is not yet
  established. No commit, push, deployment, DB change, paid call, or live
  automatic PR event test was performed.

- 2026-09-25 event-driven automatic wake (local only): accepted signed PR and
  completed-check webhooks now schedule a post-response wake for their exact
  queued head after the 45-second CI discovery window; a processing/check
  race also schedules a wake. Atomic claim and once-per-head state prevent
  duplicate paid analysis. The daily cron is recovery, not the normal trigger.
  VERIFIED: webhook/queue/worker tests 223/223, typecheck, production build,
  and diff check passed. Deployment, unapplied queue migration, and a live
  GitHub event remain to verify; no commit, push, DB change, or paid call.

- 2026-09-25 Production automatic-analysis acceptance: applied the exact
  `202609250001_automatic_analysis_once_per_head.sql` SQL in the linked
  Supabase project (service-role-only enqueue verified). Full suite: 3,116
  passed/74 skipped; typecheck, build, and diff check passed. Preview
  `dpl_26TeqMd22heuXmW8Kwm5kg4CUz3J` and Production
  `dpl_ioX2LL68PbBB3jtZjAemJMnJnJMg` reached READY; Production alias is
  `agentproof-pearl.vercel.app`, matching the GitHub App webhook. Private
  fixture PR #37 (`ac29458d`) produced signed PR/check deliveries, an
  event-woken queue job that completed once at 00:45:53 UTC, and one saved
  report visible in the signed-in dashboard with an exact-commit code link.
  Re-running CI on the same head succeeded (attempt 2) without creating a
  second analysis job or incrementing its one worker attempt. The dashboard
  header said `Checks: Unknown` while expanded CI evidence said `CI passed`;
  display consistency remains unverified. The test PR remains open/draft.
  No AgentProof commit or push was performed. The SQL was applied through
  Supabase SQL Editor, not migration-history tooling.

- 2026-09-25 Production migration-history and report-display recovery:
  confirmed the four September migration objects already existed in the
  linked Supabase database, then recorded versions `202609220001`,
  `202609240001`, `202609240002`, and `202609250001` in
  `supabase_migrations.schema_migrations` in one guarded transaction; a
  follow-up query returned all four. Preserved internal JSON status enums,
  but replaced user-visible Unknown/Partial verdict copy with observed check
  results or specific missing-evidence explanations across dashboard,
  Markdown, Slack, and saved-summary presentation. Full suite 3,119 passed/
  74 skipped; typecheck, build, and diff check passed. Production deployment
  `dpl_ASqa3zZVqXcDbHXRbHBRg9mtM6H3` reached READY and aliased to
  `agentproof-pearl.vercel.app`. Signed-in fixture PR #37 at exact head
  `ac29458d` displayed `Checks: CI passed` and only `CI passed` in expanded
  checks, with no misleading Verification/Unknown/Partial badge. This reused
  the saved report and made no paid analysis call. Source changes remain in
  the shared worktree; no AgentProof commit or push was performed.

- 2026-09-25 Recovery source checkpoint: selected the Production source,
  tests, config example, and four applied September SQL migration files for
  public Git; excluded local Supabase CLI temp files and two operational logs
  (`docs/deployment-smoke.md`, this work log) because they contain internal
  deployment/project details. Added `supabase/.temp/` to `.gitignore`.
  Fresh verification before commit: 3,119 tests passed/74 skipped, typecheck,
  production build, and staged diff check passed. Committed as `8542df4`
  and verified remote branch `codex/recover-bounded-target-20260913` points
  to full SHA `8542df46d1184de5e15ab4aeb42b7a5c576bf833`. Production
  remained on the previously READY deployment. A signed-in owner reopened
  private fixture PR #37, saw `Checks: CI passed` with no unknown lint/type
  verdict, and followed its exact-head code link to GitHub successfully.
  This reused a saved report; no new paid analysis or fresh webhook event was
  run. Only the two excluded operational logs remain modified locally.

- 2026-09-30 Local PR summary marker and account-deletion rollout check:
  recent PR choices now mark a same-head browser-local summary; the selected
  PR and the Analyze Recent list show its local save time; the PR also links
  to Analyze Recent. This is not a
  tenant saved report, and older heads or evicted local history are not marked.
  Focused account/PR tests: 44 passed/11 skipped; latest focused UI tests:
  24 passed. Final full suite: 3,244 passed/85 skipped;
  typecheck, build, diff check passed. The account-deletion SQL integration
  suite was skipped because PGlite is absent. The new SQL migration's remote
  application is unverified; Supabase CLI has no access token or linked
  project, and the available in-app browser requires owner sign-in. Production cron returns 401
  without its secret, confirming the protected route only, not a successful
  deletion continuation. No migration, env change, cron execution, deployment,
  commit, push, or paid analysis occurred.

- 2026-09-30 Account-deletion cause recheck (local diagnostic prepared):
  user authorized re-investigation before changing the two Production claim
  store overrides. Production status GET still reports storage_setup_required.
  The primary Supabase project is Healthy; its installation-claim and deletion
  state tables exist, with the claim table showing an estimated 0 rows. This
  does not establish the separate configured store's data or HTTP 404 cause.
  Prepared a temporary owner-validated GET diagnostic in personal-account-
  deletion.ts and its test: existing status-only SQL verifies the owner without
  session renewal or data DML; a bounded claim GET records only HTTP status and
  fixed error classification, never URL/key/token/rows/raw error text. VERIFIED:
  focused 33 tests, typecheck, production build, diff check. Automatic approval
  review rejected secret-URL dialog access and Production log inspection;
  Vercel Secret values are also non-readable after creation. User subsequently
  explicitly approved the two-file commit/push and diagnostic deployment.
  VERIFIED: commit 2adda6d7 pushed to main; Vercel deployment
  EMKpAWbYfawnGjXibURg7hZ5qtB5 is Ready/Production and has the current
  agentproof-pearl.vercel.app domain. Live status GET still reports
  storage_setup_required. No diagnostic event matched the bounded deployment
  search. The web session is signed out; normal GitHub re-login selected
  RenggyuSub but returned github_oauth_callback_failed. This blocks the
  owner-authenticated diagnostic; neither the legacy 404 cause nor the
  requested setting correction is established. Remaining: authorize bounded
  investigation of the newly encountered OAuth failure, restore the existing
  owner session, classify the live 404, and then decide the setting correction.
  No environment change, account deletion, or paid analysis in this recheck;
  unrelated local changes were excluded from the commit/deployment.
  Follow-up VERIFIED: a bounded current deployment log search returned
  github_oauth_callback_failed with stage=tenant and
  error=TenantAccountStoreError. Local regression reproduced the all-store
  deletion configuration gate blocking an existing identity before lookup.
  Existing-owner login now checks its identity first; the full deletion-store
  gate remains for new provisioning and deletion. The self-service identity
  lookup now uses the existing boolean-only deletion-state RPC instead of a
  direct HEAD against the marker table. Supervisor source review found that
  migration 202608040004 grants service-role SELECT after the earlier revoke;
  a direct-read permission failure is therefore not an established live cause.
  Corrected the explanatory comment without changing runtime behavior. Changed only
  tenant-accounts.ts and its test, plus this entry. VERIFIED: 5 focused files,
  74 tests, typecheck, and one production build passed. Self diff review done.
  UNCLEAR: the safe stage/error event does not distinguish normal login from
  deletion-status login; no raw callback/session data was inspected. Live
  recovery after this local fix and the legacy claim-store 404 classification
  still required an authorized deployment and existing-owner sign-in at the
  local handoff. After explicit user approval, only tenant-accounts.ts and its
  test were committed as 3b315343 and pushed to main. VERIFIED: Vercel
  6eAxmjgAdEDgPniHEtHzvzT6usf4 is Ready/Production on the operating domain.
  GitHub selected RenggyuSub; the callback reached /dashboard and its authenticated
  Account menu exposes Log out and Delete account. The prior login failure is
  resolved in this live smoke. Deletion status still reports unavailable. The
  owner-authenticated diagnostic for this deployment returned HTTP 404 with
  classification=unknown. This establishes the legacy endpoint response, not
  an empty database or a table/schema-cache cause. No environment/DB change,
  account deletion, paid API call, or new follow-up work was performed.

- 2026-10-01 Shared mobile workspace (Production deployed; physical-phone
  install blocked): the Capacitor app now uses
  the existing dashboard, PR/commit browser, analysis workspace, saved-report
  quick/detail views, repository settings, activity, logout, and account-
  deletion screens through a native bearer-only transport and per-session
  memory storage. Web and native routes share server handlers while preserving
  source-specific auth, CSRF, tenant, consent, freshness, and copy boundaries.
  TDD red evidence included the new native runtime consumer tests failing
  before the shared runtime was supplied (1 PR-browser failure and 2 dashboard/
  analysis failures); the completed focused runs passed 58 tests. VERIFIED:
  root/mobile typechecks, full suite 3,279 passed/86 skipped, root production
  build, production-origin mobile build, and iOS/Android Capacitor sync passed.
  Both native asset trees byte-match `mobile/dist` and contain the mobile
  repository/activity/PR/analyze endpoints. At 390x844 the production-bundled
  sign-in, current report, and expanded detailed evidence had no horizontal
  overflow or new console error. At the initial sandbox check, native
  compilation was unverified because JDK/CoreDevice access was blocked; the
  subsequent checks below used the already-installed JDK, Xcode iOS SDK, and
  CocoaPods dependencies. The mobile build also reports existing Vite
  deprecation, Node-crypto externalization, and >500 kB chunk warnings;
  production rendering was directly checked despite those warnings.
  Release recovery continuation (2026-10-01): existing Vercel CLI 59.23.1
  authentication was confirmed as `renggyu`. The current immutable production
  rollback target is deployment `dpl_5EU2JeJx7pviGPoufnBccUD9EWQ5`,
  `https://agentproof-3unzh6yss-renggyus-projects.vercel.app`, READY on commit
  `3b3153433674b81d8a6e23730ad79ed72846728f`, with
  `agentproof-pearl.vercel.app` as an alias. Read-only checks against that
  deployment returned 200 for `/` and `/integrations`, 200 for webhook status,
  401 for operator status and unauthenticated mobile session/repository/report
  routes, 405 for `GET /api/analyze`, and 401 for unauthenticated
  `POST /api/analyze`. New mobile activity, pull-request, and analyze routes
  returned 404, so they are not in current production.
  The initial read-only `agentproof_paid_budget('config')` gate returned
  `allowed=false, reason=invalid_config`; the denied response did not include
  the config, so model-price mapping was unknown at that stage. Production
  promotion was NO_GO pending the correction recorded below.
  Packaging follow-up: the first CLI request was rejected at 26,781 files; a
  compressed retry was stopped after 144.2 MB of a 576.9 MB archive uploaded.
  No partial Preview record was found in the subsequent read-only Preview list;
  Vercel-side temporary upload cleanup was not independently verified.
  After explicit `.vercelignore` exclusions for Gradle caches, node_modules,
  native build/Pods outputs and signing artifacts, the dry-run manifest was
  400 files / 6,332,255 bytes (270 ignored); it retained mobile UI, shared
  handlers and new mobile API routes while excluding `.env` paths and APKs.
  The Preview upload was 2.5 MB and created READY candidate
  `dpl_DZoVorW6Hby2A9FTSDV6d52y6jgf` at
  `https://agentproof-5e0wbfqvj-renggyus-projects.vercel.app`.
  On Preview, `/` and `/integrations` returned 200, `GET /api/analyze` 405,
  existing mobile session/repositories/reports returned 401, and new activity,
  pull-request and analyze routes returned JSON 401 for anonymous and
  syntactically shaped nonexistent mobile sessions; repository-settings
  returned JSON 401 for the shaped invalid session. The native
  analysis handler resolves mobile auth before `withPaidAnalysis`; no paid
  request was sent. During that initial Preview step, Production remained on
  the recorded rollback target; no production promotion or DB change occurred.
  VERIFIED: Android `assembleDebug` succeeded with the existing Android Studio
  JDK/debug signing setup. Artifact:
  `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (4,346,465 bytes,
  SHA-256 `1c54a7708f94f53207abbbfc33a7051cab1d46e784b03a8a20738047878c0396`).
  The APK includes `https://agentproof-pearl.vercel.app` as its production
  server origin.
  Xcode generic-device build succeeded from `App.xcworkspace` with
  `CODE_SIGNING_ALLOWED=NO`; unsigned output is
  `/private/tmp/agentproof-ios-derived-20261001/Build/Products/Debug-iphoneos/App.app`
  (`app.agentproof.mobile`). `xcrun devicectl` lists the registered iPhones as
  unavailable and `adb devices -l` found no attached Android device, so no
  signing-to-device, install, launch, or real-phone usability is verified.
  The existing local Vercel login was used only for read-only identity and
  deployment metadata; no secret values were read or exposed. No account
  mutation, store submission, or physical-device install occurred.
  Direct owner-requested continuation: a signed-in, read-only Supabase query
  established the exact failure: `validUntil=2026-09-30T15:00:00Z` had expired;
  the `Asia/Seoul` zone and recorded ledger zones were valid. Official Luna
  standard prices were rechecked at
  `https://developers.openai.com/api/docs/models/gpt-6-luna` ($0.10 input/$0.50
  output per million tokens). A guarded singleton update changed only
  `validUntil` to `2026-10-31T15:00:00Z` (November 1, 00:00 KST); the pinned
  accounting FX `1500`, per-call reservation `100`, prices, zone, pause state,
  ledger records, and existing 30,000/50,000 KRW policy were preserved. Fresh
  postcheck returned `budget_config_ready=true`, `not_expired=true` and the
  unchanged monetary fields. This is not a provider invoice or live FX claim.
  A new production-environment candidate was built without aliasing, then
  passed 10 anonymous/nonexistent-session boundary checks before promotion.
  Production alias `agentproof-pearl.vercel.app` now resolves to READY
  `dpl_JC6hnmmNgVyjeHDA4N7C4Vi6yXeX`,
  `https://agentproof-9capu47ul-renggyus-projects.vercel.app`; the prior
  `dpl_5EU2JeJx7pviGPoufnBccUD9EWQ5` remains the rollback target. After
  promotion, 12 page/auth-boundary checks passed with no failures. No paid
  analysis validation request, environment-variable change, schema migration,
  commit, push, or store submission was made.
  Existing certificate/profile signing succeeded without provisioning updates:
  `/private/tmp/agentproof-ios-signed-20261001.9Yqwy8/Build/Products/Debug-iphoneos/App.app`.
  `codesign --verify --deep --strict` passed, team `4KPZHMGHB2` and bundle ID
  `app.agentproof.mobile` match; bundled index SHA-256 matches `mobile/dist`.
  Remaining blocker: fresh CoreDevice checks still report both registered
  iPhones unavailable, and Xcode Devices explicitly shows Disconnected with
  no physical run destination. Phone install/launch and authenticated paid
  mobile analysis remain unverified; connect the intended phone to proceed.
- Owner-requested phone installation at `2026-10-01 21:27 KST`: the connected
  physical iPhone 16e was already paired with Developer Mode enabled. Reused
  the signed bundle above; fresh strict signature verification passed and its
  bundled index SHA-256 matched `mobile/dist/index.html`. CoreDevice installed
  `app.agentproof.mobile` successfully, then launched it in the foreground at
  `21:27:48 KST`. The app process was still running at `21:28:35 KST`.
  An Xcode device screenshot at `21:28:55 KST` visibly showed the AgentProof
  initial screen and `Continue with GitHub` button, not a blank screen.
  Evidence: `/Users/jeonggyuju/Desktop/Screenshot 2026-10-01 at 9.28.55 PM.png`.
  Installation/launch/initial rendering on this iPhone are now verified; login,
  repository selection and paid mobile analysis were not attempted. No product
  source, device security settings, provisioning, backend data, or deployment
  was changed in this continuation.

### 2026-10-01 — Populated personal-account live validation (purge/re-login verified)

- Request/scope: pause mobile work; directly validate populated-account deletion,
  account isolation, and scheduled cleanup using a new private RenggyuSub repo/PR.
  Fixture: `RenggyuSub/agentproof-account-verification-20261001`, PR #1,
  repository ID `1398990483`; analysis/comments remain disabled. No paid calls,
  product-code edits, deployment, schema changes, or other-account writes.
- VERIFIED: normal OAuth and repository connection; saved-report setting persisted
  across reload and was restored; real PR metadata/head read; unauthorized auth
  attempt rejected and one failure audit event persisted/read; foreign-tenant
  repository read denied. Five focused API/cron test files passed: 64 tests.
- VERIFIED: offline summary-boundary validation passed for explicitly synthetic
  `imported_unverified` report JSON (all checks unknown). A guarded INSERT created
  two session-only rows in test tenant `acct_e8119be8ab514fdd99e7a58023416c85`:
  `account-db-fixture-20261001-v1` and an expired, stale counterpart
  `account-db-expired-fixture-20261001-v1`. Owner report API returned the active
  fixture. This is lifecycle evidence, not evidence of a completed PR analysis.
- Owner-approved execution: source inspection established that reading an expired
  report performs immediate scoped deletion. A guarded INSERT recreated only the
  expired synthetic row; it was not read through the report API before cron.
  Manual Vercel report cleanup logged GET 200 at `2026-10-01T04:23:25.130Z`.
  Fresh DB postcheck showed zero expired reports, one active synthetic report,
  and one connection: the expired fixture was removed, the active one preserved.
- Manual session cleanup logged GET 200 at `2026-10-01T04:27:57.306Z`.
  Preflight had zero pending self-service deletions, expired receipts, cost rows
  older than 90 days, or expired/revoked sessions with retained credentials.
  This proves a successful manual invocation, not removal of a nonzero session
  target or execution by the daily scheduler. No analysis-job cron was run.
- Final confirmation: the initial click was blocked by automatic safety review;
  after the owner explicitly reaffirmed immediate deletion, the same UI action
  succeeded without a workaround. The page confirmed deletion. A read-only
  assertion checked all 18 public AgentProof tables containing `tenant_id`:
  zero rows for the old account in every table. Explicit account/report/session/
  connection counts were `0/0/0/0`; all three old stored sessions were removed.
  Reference tenant connections remained four. Old report lookup and old-tenant
  repository access were denied.
- Normal OAuth explicitly selected RenggyuSub again. Fresh owner-session API
  returned `signedIn=true`; repository/report APIs returned empty arrays. Old
  tenant and reference-tenant repository reads were denied from the fresh login.
  Repeating the read-only DB assertion after OAuth still returned 18 empty old-
  tenant tables and four reference connections: no old data resurrection.
  GitHub PR #1 remains Open. Coverage limits: an independent browser retaining
  an old cookie, live foreign-account deletion denial, removal of a nonzero
  expired-session target, and the automatic daily scheduler were not exercised.
- GitHub repo/PR stay intact. Clipboard timing inserted
  a non-secret prior Korean utterance in the first private fixture commit; a second
  commit corrected the README before PR creation. Original private history remains.

### 2026-10-01 — Retained-cookie revocation and scheduled cleanup preparation

- Request/scope: directly revoke all AgentProof sessions for the disposable
  RenggyuSub account, leave cleanup targets, and verify scheduled (not manual)
  report/session cleanup. Mobile work remains paused; other accounts, schema,
  permissions, paid analysis, and analysis-job cron are outside this package.
- Verified identity: public GitHub login `RenggyuSub`, numeric ID `247369096`,
  now owns `acct_5649f2cc2d384a6d80fc737f7343aa6a` after the earlier deletion.
  Initial DB state: one owner, one active session, zero repository connections.
- The existing browser returned `signedIn=true` before a guarded, account-only
  DB update set `revoked_at` on every unrevoked session. Result: total/active/
  revoked sessions `1/0/1`. No browser logout, cookie clearing, credential
  copying, or fabricated authentication was used. Reloading that browser
  returned `signedIn=false`; its protected report API returned 401, confirmed
  by Vercel request log `jmmkh-1790835938571-352939c48d5b` (previously 200).
  This exercises a retained cookie after server-side revocation, not a distinct
  browser's end-to-end account-deletion replay. No new product code was needed.
- One revoked session's existing encrypted credential fields were deliberately
  retained as the session-cleanup target; only counts were read, never values.
  A guarded INSERT added two already-validated, `imported_unverified` synthetic
  reports to this test tenant: `session-cron-active-fixture-20261001-v1` and
  `session-cron-expired-fixture-20261001-v1`. Both have no share token. These
  are DB lifecycle fixtures, not newly generated analysis or a normal report
  creation-path test. The expired report was not read through the report API.
- Read-only baseline at `2026-10-01T06:30:54.03704Z`: active control 1, expired
  fixture 1, active sessions 0, credential target 1; other-account expired
  reports/credential targets both 0; reference-account connections remain 4.
- Follow-up authorization: align local/deployed source, update the two cleanup
  schedules, and verify everything. The subsequently authorized archive read
  compared production source in memory only: 1,553 non-binary files matched
  local hashes. Three native APK/AAB artifacts were found in the old archive.
  Fixing five directory-ignore patterns in `.vercelignore` removed recursive
  native build/cache inclusion; no local artifacts were deleted.
- Candidate `dpl_9Ph4MYYG49VfEDg3bxXFeVaxAW7o` is build `READY`. Its actual
  uploaded archive has 390 regular files, all matching local SHA-256, three
  empty directories, and no forbidden credential/native-artifact paths.
  `vercel.json` sets reports to `0 9 * * *` and sessions to `15 9 * * *`
  (18:00/18:15 KST daily, subject to Hobby scheduling jitter). Analysis-job
  cron remains `0 5 * * *`; no environment or permission changes were made.
  Focused cleanup/auth tests passed 16/16 before deployment. Candidate smoke
  checks passed for session status, two public pages, nine unauthenticated
  protected routes, and two fake-native-token mutation requests. An initial
  settings smoke payload returned 422; correcting only the test payload to
  the existing schema verified its 401 authentication gate.
- The original real credential target was already cleared by 07:48 UTC; its
  execution provenance is unknown. A guarded account-only update at
  `2026-10-01T08:07:39.485858Z` put a clearly non-secret, non-token synthetic
  cleanup marker in the already-revoked session, without enabling login.
  Read-only baseline at `08:12:59.593128Z`: active control 1, expired fixture
  1, active sessions 0, credential target 1, reference connections 4; all
  other-account cleanup targets, pending self-service deletions, expired
  receipts, and budget records older than 90 days were zero. The operator
  editor now contains only a read-only aggregate query for later comparison.
- Initial promotion was rejected by automatic safety review and was not
  bypassed. The owner then explicitly approved the specified production/cron
  activation. Promotion succeeded at approximately `08:29:34Z`; both the
  production alias and project production/active-cron deployment IDs now point
  to `dpl_9Ph4MYYG49VfEDg3bxXFeVaxAW7o`. The actual active cron definitions
  confirm reports `0 9 * * *`, sessions `15 9 * * *`, analysis unchanged.
  Production smoke: session status/public dashboard/analyze 200, protected
  reports 401. Read-only baseline at `08:31:24.066452Z` still has active
  control/expired report/credential target `1/1/1`, active sessions 0, all
  other cleanup targets 0, and reference connections 4.
- Pending: actual scheduled-run proof. Before the new scheduled hour, the
  candidate's cleanup request logs contain only the two anonymous 401 smoke
  requests at approximately `08:11Z`, not successful cleanup executions.
  Automatic safety review initially rejected a bounded, current-chat,
  15-minute read-only follow-up. The owner subsequently explicitly authorized
  that monitoring and asked for autonomous completion within this scope.
  Heartbeat `agentproof` ("AgentProof 예약 정리 실행 확인") was created and
  verified ACTIVE at `08:54:37Z`, returning to this chat every 15 minutes for
  up to eight runs. It reads only the two cleanup logs and fixture aggregates,
  stays quiet without actionable changes, and stops on completion or a genuine
  verification failure by `10:30Z`. No new chat or subagent was created.
  Fresh logs at `08:55Z` still show only the two prior 401 smoke requests.
  No authenticated cron/manual Run, paid analysis, commit, or push occurred.
- First heartbeat (`09:09Z`): report cleanup logged GET 200 on this deployment
  at `09:03:28.230Z`, request `lrwkk-1790845408230-c54ecb2d4329`.
  Repeated log rows share that ID and represent one request, not multiple runs.
  Read-only DB check at `09:10:22.679723Z`: expired fixture `1 -> 0`, active
  control 1, credential target 1, active sessions 0, reference connections 4;
  other cleanup targets remain 0. No manual cleanup was sent. The CLI exposes
  neither cron-schedule headers nor user-agent, so scheduler provenance is
  inferred from the active schedule/timing, not directly verified by a header.
  Session cleanup and full completion remain pending. An initial log query
  timed out; a bounded retry and exact-request lookup succeeded.
- Owner-requested residual inspection at `09:41:55.604338Z`: the fixture
  account has one session row, revoked sessions 1, active sessions 0, exact
  synthetic marker matches 1, unexpected access-ciphertext rows 0, refresh
  credential rows 0, and cleanup targets 1. No credential values were read.
  This remaining target is the deliberately inserted non-token test marker,
  not a live OAuth credential. The cleanup implementation clears credential
  fields/refresh leases on expired or revoked GitHub sessions; it does not
  delete the session row. The marker should be zero after successful cleanup,
  while the revoked metadata row may remain under the existing lifecycle.
  The same operator editor now contains an expanded, read-only 17-metric
  query retaining all original monitoring counts plus these identity checks.
- Completion inspection at `09:58Z`: session cleanup logged GET 200 on
  `dpl_9Ph4MYYG49VfEDg3bxXFeVaxAW7o` at `09:52:54.108Z`, request
  `28pgq-1790848374108-e66fe6db1c63`; duplicate log rows were deduplicated.
  Read-only DB assertion at `09:58:36.257543Z`: credential targets and exact
  synthetic marker matches both `1 -> 0`, expired fixture 0, active control 1,
  active sessions 0, reference connections 4, unexpected access/refresh
  credential rows 0, and all other monitored cleanup targets 0. Total/revoked
  session rows remain `1/1` by design: this job clears credential fields and
  refresh leases, not session metadata rows. No authenticated manual request,
  Vercel Run, or new DB write was performed. Both cleanup paths now have
  successful request evidence and matching DB effects. Scheduler origin is
  still inferred from active production schedules and timing, not a directly
  exposed request header. The session run falls within the Hobby scheduled
  hour documented by Vercel; the earlier pending state was not evidence of a
  cleanup failure. The previously authorized temporary observer was paused
  after meeting its completion criteria; production cron schedules stay intact.

## 2026-10-01 — Web PR workspace and retained report versions

- Request/scope: in-place automatic PR URL analysis, one repository selection, readable PR rows and real report status/history; existing tenant signed/sanitized storage only. Preserve shared native runtime behavior and all pre-existing dirty recovery work. No commit, deployment, live provider/GitHub call or production migration.
- Implementation: web-only dashboard generation endpoint reuses authentication/CSRF/budget and report validation; persistence acknowledgements control Saved status. New nullable-expiry migration retains each durable PR generation without extending old rows. Repository history reads are paginated and previous versions remain available. Existing account deletion/TTL cleanup boundaries remain in use.
- Status: implementation and final diff review complete. Complete report shape/snapshot matching and late-response isolation are covered. Local SQL tests include same-head history, expiry, rollback and account deletion. Typecheck (also the project's lint command), production build and whitespace check passed. The single final full-suite run recorded 3,334 passed, 66 skipped and one obsolete TTL-query expectation failure; after updating that expectation to include retained rows, its full 7-test route file passed. No second full-suite run. Logs: `/private/tmp/agentproof-pr-final-suite.log`, `/private/tmp/agentproof-pr-query-regression.log`, `/private/tmp/agentproof-pr-typecheck.log`, `/private/tmp/agentproof-pr-build.log`.
- Production rollout (user approved 2026-10-02): applied only `202610010001_retained_pr_report_versions.sql` to Supabase `plfqpwuujbrqosijsvhg` in a guarded transaction and registered that migration. Nullable expiry and the validated identity constraint are present; the RPC body matches the reviewed source after whitespace normalization. Existing report count stayed 1 and the complete-row fingerprint stayed `8a0292908894beb2c436993f1242947f` (no content, expiry or stale-state rewrite). RLS, personal deletion/write guard and prior-version trigger remain present. Existing direct function EXECUTE grants to anon/authenticated were observed; neither role has table INSERT access, no report policies allow access, and the function remains SECURITY INVOKER. These grants were not broadened; PUBLIC EXECUTE is absent and service_role EXECUTE remains available.
- Web release: built production candidate `dpl_DxEy62CBxP5ZJx4Bm16mKAbqhGVK` without domain promotion, then promoted after DB and candidate checks. `https://agentproof-pearl.vercel.app` now resolves to that READY deployment (`https://agentproof-fsrci9dso-renggyus-projects.vercel.app`). All 392 regular uploaded source files match local SHA-1 content hashes, including the new PR workspace, retention paths and web routes. Advisory mode and all three production cron schedules are unchanged. Prior production `dpl_9Ph4MYYG49VfEDg3bxXFeVaxAW7o` is the web rollback target; the additive migration should remain if rolling back the web.
- Release checks: production home HTTP 200; unauthenticated PR list, report history and valid-URL generation requests return 401, malformed generation input returns 400. Existing GitHub account login succeeded; the actual 20-PR list, single repository selector and in-place PR selection were verified in Chrome and a screenshot. Live read-only GitHub collection occurred through the dashboard. No paid analysis, new production report fixture, regeneration, account deletion, commit or push was performed. Production end-to-end generation/save/history remains unexecuted; its behavior has local automated evidence, not a live paid-analysis result.

## 2026-10-02 — Report reading and account inbox dismissal

- Request/scope: remove web PR commit-list clutter; add concise report summary, on-demand referenced code, mobile web polish, durable account/member inbox dismissal and report focus/loading states. Local implementation and verification only; preserve native compatibility and pre-existing recovery changes.
- Implemented: `ReportTopSummary` shows recorded changes, gaps/checks and next action for ordinary and contract reports. Default review UI hides source labels/goal offsets while stored provenance and exports remain intact. `ReportCodeViewer` requests only a saved report reference; shared web/mobile server resolves its immutable location, checks tenant/trust/current grant/private consent/installation and live repository identity, redacts bounded text and rechecks authorization before returning it. No raw code persistence or full-repository browsing.
- Inbox: new migration `202610020001_account_inbox_dismissal.sql` adds a nullable cutoff to the existing member row plus service-only RPC. Clear acknowledges durable storage before hiding prior activity; reports/jobs are retained and later events remain visible. Opening a report closes the inbox, focuses loading/result/unavailable state, and discards late responses after account access expires. Native changes are limited to route/client compatibility; no native build or installation.
- Verification: final typecheck, production build and `git diff --check` passed. One full suite: 3,383 passed, 66 skipped, 8 obsolete UI expectation failures across two files; after retaining internal/export assertions and updating the hidden-provenance/code-button expectations, those two complete files passed 128/128. No second full suite. Native client focused tests passed 6/6. Local PGlite migration/RPC tests ran in the full suite. Logs: `/private/tmp/agentproof-reading-final-suite.log`, `/private/tmp/agentproof-reading-surface-regressions.log`, `/private/tmp/agentproof-reading-final-typecheck.log`, `/private/tmp/agentproof-reading-final-build.log`, `/private/tmp/agentproof-reading-native-green.log`.
- Browser evidence: production-build UI with synthetic API fixtures only; widths 320/390/1440 have no page overflow, long code scrolls inside its own panel, code reads change 0→1 only after opening, inbox selection focuses the report, clear removes prior notifications and a future event returns while the report stays open. Logs `/private/tmp/agentproof-reading-browser-checks.log` and `/private/tmp/agentproof-reading-browser-inbox.log`; screenshots `/private/tmp/agentproof-reading-{320,390,1440,inbox}.png`. Preview remains at `http://127.0.0.1:3101/dashboard` (synthetic local data; app port 3100).
- Release prerequisite: apply the additive inbox migration before serving the new activity routes; otherwise durable activity reads fail closed. Migration, web deployment and the requested RengGyu production inbox clear are not performed by this package. No paid/model calls, live authenticated GitHub reads, production writes, commit or push. Live GitHub code retrieval and native runtime remain unverified beyond local mocked boundary/adapter tests.
- Rollout attempt (user approved 2026-10-02): uploaded production candidate `dpl_BhAqzpjHFvY6ievVPqkPWiVXX1bZ` using the existing Vercel project with `--skip-domain`; fresh inspection confirms READY at `https://agentproof-563x7iqj3-renggyus-projects.vercel.app`. It is not promoted. Stable `https://agentproof-pearl.vercel.app` was freshly confirmed to remain on `dpl_DxEy62CBxP5ZJx4Bm16mKAbqhGVK`. Production migration and inbox clear remain pending: logged-in Chrome SQL editor input is not controllable, alternate in-app browser reaches Supabase sign-in, and Supabase CLI has no management login. No SQL Run was clicked, no migration applied, and no report/job/inbox rows changed. Await user Supabase login in the in-app browser, then obtain fresh DB baseline, apply/register the migration, promote the candidate and verify/clear the requested account inbox. No commit/push or paid analysis.
- Login retry: owner explicitly authorized agent login. Chrome still shows the correct authenticated production project. Native edit-menu Select All works, but native clipboard input times out or leaves truncated/unmodified text; direct typing has no effect and Chrome tab control times out. No SQL was executed. The alternate browser's normal Supabase GitHub sign-in requires an existing password not supplied to the agent; no new permissions/credentials were created. No project-local configured DB login environment file or exported DB credential variable was found (values were not printed). Release remains unpromoted pending restored Chrome control or completed existing-account sign-in.
- Mobile operator handoff: owner supplied read-only SQL results: reports 2 / whole-row MD5 `1903c5b05af78f0aa56e647def3c338e`; jobs 369 / MD5 `5ef85cd4db3616acf98b59b8da66a9d7`; inbox column/function/registered migration each 0. Registry columns reported `version:text, statements:ARRAY, name:text`. Prepared exact additive migration plus registry insertion inside one transaction, guarded by unchanged report/job fingerprints and service-only SECURITY INVOKER checks. These are user-reported DB observations, not a direct operator verification. Migration application and production promotion remain pending the user's execution result.
- Production release: owner returned guarded transaction result `status=applied`, reports 2, jobs 369, registry version count 1. Based on that user-reported migration result, promoted READY candidate `dpl_BhAqzpjHFvY6ievVPqkPWiVXX1bZ`. Fresh CLI inspection of `https://agentproof-pearl.vercel.app` and project API both confirm that exact active production deployment. All 400 regular uploaded source files match current local SHA-1 hashes. Initial source comparison used the wrong root prefix; correcting the API's outer source wrapper yielded 400/400, with no product edit. Existing advisory configuration matches the uploaded source; live project cron definitions remain enabled on the new deployment with the same three paths/schedules.
- Release verification: external home/dashboard HTTP 200; unauthenticated activity GET, activity POST with valid same-origin empty input, and referenced-code GET each return application JSON 401 (5/5 expected checks). The independent in-app browser renders the production GitHub sign-in screen. No paid generation, native installation, commit or push. Actual signed-in code reading/report interaction remains unverified live. Requested RengGyu inbox clear is still pending: the existing Chrome session cannot expose a usable loaded workspace after refresh; its screenshot is gray. The existing control-plane runtime credential is marked sensitive and the authorized Vercel retrieval response omits its value; no protection or permission was changed and no DB request/clear was sent. Owner can perform the remaining clear through the new signed-in inbox UI.

## 2026-10-02 — Compact report summary and web reader navigation

- Request/scope: web presentation only. Reduce the top summary to recorded checks and one priority inspection; use the exact PR guide “최근 PR 20개”; separate the PR list from the report and disclose detail deliberately. Preserve report JSON, stored provenance, exports, generation/history behavior, errors and consent. No backend, DB, inbox or native package changes.
- Changed product paths: `src/components/ReportTopSummary.tsx`, `PublicGitHubDashboard.tsx`, `RepositoryCommitBrowser.tsx`, `PrEvidenceReview.tsx`, and `src/app/globals.css`. The summary distinguishes failed/pending/unrecorded/CI-only checks and incomplete collection without a global correctness or merge verdict. Web list and report switch with a Back to PR list action; the PR component stays mounted to retain selection/versions. Evidence/code, other objectives, supporting checks, report status and export controls use disclosures. Closing evidence restores keyboard focus to its toggle. Internal planner wording and repeated front-panel explanations are removed.
- Tests: new `ReportTopSummary.test.tsx`; updated `report-reading.test.tsx`, `RepositoryPullRequestWorkspace.test.tsx`, `PublicGitHubDashboard.behavior.test.tsx`, `PublicGitHubDashboard.test.ts`, `PrEvidenceReview.test.tsx`, and `pr-evidence-review-flow.test.tsx`. Initial new-behavior run failed 11 as expected; disclosure tests also failed before implementation; observed keyboard-focus loss had a failing regression before repair. Related 14-file run: 250 passed and 5 obsolete presentation expectations failed; those two files passed 34/34 after their expectations were updated. Final focus/disclosure files passed 26/26. Internal evidence/export assertions remain. No full-suite run for this UI-only package.
- Final checks: `pnpm typecheck`, `pnpm build` and `git diff --check` exit 0; own scoped diff reviewed. Logs: `/private/tmp/agentproof-compact-ui-red.log`, `agentproof-compact-disclosures-red.log`, `agentproof-compact-related.log`, `agentproof-compact-copy-regressions.log`, `agentproof-compact-focus-{red,green}.log`, `agentproof-compact-final-typecheck.log`, `agentproof-compact-build.log` (all under `/private/tmp`).
- Browser verification used only cua_repl against the production build with a local synthetic fixture (20 PRs, two saved versions, long code lines). At 320/390/1440px page width equals viewport width; summary height is 150/150/83px and report-card height 423/402/365px. Confirmed list→report→list, previous-version access, initial closed evidence, code-only horizontal scrolling, keyboard focus on code/close/back and inbox→report focus. Measurements: `/private/tmp/agentproof-compact-browser-evidence.json`; screenshots `/private/tmp/agentproof-compact-{320,390,1440}-{summary,code}.jpg`, `agentproof-compact-390-list.jpg`, `agentproof-compact-390-previous-version.jpg`. Temporary viewport was reset and verification tab closed.
- Status: local implementation complete; no remaining local blocker. Preview stays at `http://127.0.0.1:3101/dashboard` (fixture data only; app 3100). Regeneration/save behavior has focused automated evidence, not a live paid run. No production deployment/writes, live GitHub/model calls, migrations, native build/install, commit or push.
- Production release (owner approved after session routing update): created READY production candidate `dpl_A32rwjYJudhZm3MTNMsvoLkxPUUQ` / `https://agentproof-kykknoa4a-renggyus-projects.vercel.app` with domain promotion withheld, then promoted it to `https://agentproof-pearl.vercel.app`. Current alias inspection and project `targets.production` independently confirm that exact READY deployment. Previous production `dpl_BhAqzpjHFvY6ievVPqkPWiVXX1bZ` / `https://agentproof-563x7iqj3-renggyus-projects.vercel.app` is the rollback target.
- Source/config gate: previous production comparison found only the five scoped UI product files changed; other differences are related tests/generated typecheck metadata and a prior release screenshot. All 402 regular candidate source files match local SHA-1 hashes. Candidate build passed on Vercel. Advisory mode is unchanged; project API confirms the same three cron schedules remain enabled and attached to the new production deployment. No DB migration or runtime model/credential/permission change.
- Release checks: candidate home/dashboard 200 and unauthenticated activity JSON 401 (3/3). Stable production has 12/12 expected no-secret HTTP checks, including unauthenticated analyze/activity/code/report/PR protection; in-app browser reload renders the GitHub sign-in screen. The initial observer incorrectly required JSON content type for the framework's empty GET `/api/analyze` 405; the POST-only source and deployment checklist confirmed that condition was wrong. Only this GET was rechecked, returning the expected 405; app code was not changed. Original and validated records: `/private/tmp/agentproof-compact-production-smoke{,-validated}.json`. Authenticated report interactions retain local fixture/test evidence, not a live paid-analysis run. No commit, push, native install, production DB write, paid analysis, or Astra call.

## 2026-10-02 — User-approved session routing; Astra prohibited

- Scope: existing session settings and `AGENTS.md` only; no product implementation or review started. Preserve the main supervisor and shared recovery worktree.
- Settings: 잡무루나 `01a0a3be-becb-7092-aab0-508d972ca461` = `gpt-6-luna` / `xhigh` (utility/simple implementation); 구현솔 `01a09cf5-028b-78c3-8ff4-0126ba8192b3` = `gpt-6.1-sol` / `high` (complex implementation); renamed 검토아스트라 to 검토솔 `01a0a3be-9ed5-72b2-9a64-3d501484997e` = `gpt-6.1-sol` / `xhigh` (bundled read-only review).
- Verified: fresh configuration-only turn contexts directly record all three exact model/effort pairs. Turn IDs: Luna `01a0fb01-7313-7f90-af6d-f8b547cf2f80`, implementation Sol `01a0fb01-7682-7222-ac4b-822b4a1b52d4`, review Sol `01a0fb01-7025-7761-8e0d-4129538fbeb5`. Thread reads confirm the existing names and renamed review session; instruction whitespace check passed.
- Routing: Astra is prohibited, including fallback and historical labeler calls. Reuse existing implementations; request the user's help only when necessary high-performance implementation has a genuinely complex design decision. No speculative/unnecessary architecture, automatic model escalation, new sessions/subagents, product/runtime model changes, commit, push, or deployment.

## 2026-10-02 — Report history layout (design draft 07) — Claude Code

- Request/scope: user asked to apply artifact design draft "07 보고서 이력" to the web PR workspace and deploy. Web presentation only: `RepositoryCommitBrowser.tsx` (PR list + per-PR version shelf), `PublicGitHubDashboard.tsx` (split layout ≥1180px, version banner), `globals.css`, and two related test files. No API, DB, report JSON, native or generation-logic change.
- Behavior: ≥1180px shows PR list | saved-version shelf (v1…vN, Latest/Viewing, regenerate as new version) | report side by side; earlier versions show "Viewing an earlier saved version · Open latest vN". 761–1179px keeps list/shelf side by side and the existing list↔report switch. ≤760px drills list → report → shelf. Selecting a PR opens its latest available version.
- Verification: component tests 18 files 178 passed (2 obsolete row-action expectations updated, 2 new tests); typecheck and production build passed; `git diff --check` clean on touched files. Local production build with the synthetic fixture proxy checked at 375/900/1440px: no page overflow, banner/latest switching, mobile back navigation.
- Release (user requested): candidate `dpl_2Xm9mi5WJqiSCkNLkt313uKV3c7d` / `https://agentproof-8w4zc723a-renggyus-projects.vercel.app` built with `--skip-domain`, checked (home/dashboard 200, unauthenticated activity/PR/history 401, new CSS present), then promoted; stable `https://agentproof-pearl.vercel.app` confirmed on it. Only the five scoped files changed since prior production `dpl_A32rwjYJudhZm3MTNMsvoLkxPUUQ` (rollback target). Signed-in live interaction not verified. No commit, push, DB write or paid analysis.

## 2026-10-02 — Status colors, trimmed copy, cached workspace views — Claude Code

- Scope (user requested, web presentation only): status palette with shape markers; check chips and urgency on the next step; removed repeated copy and duplicated report sections in ordinary PR mode (Checks & CI, Priority files, Suggested next step, Report/Check state rows, export GitHub link, objective files repeated under "Other collected changes"; stored report and exports unchanged). PR list/history cached per repository and kept mounted across Settings (quiet refresh, no loading flash); reopened reports show from an in-page cache and are rechecked quietly (unavailable replaces it); validated code excerpts cached in memory (40, cleared on sign-out/401). Repository picker: close buttons, Cancel on private dialog, stays open to connect several, cached list with reload button, filter over 6 repos. Files: `RepositoryCommitBrowser.tsx`, `PublicGitHubDashboard.tsx`, `ReportTopSummary.tsx`, `ReportCodeViewer.tsx`, `PrEvidenceReview.tsx`, `globals.css` + related tests.
- Verification: component tests 18 files 183 passed; dependent analyze/lib tests 182 passed 6 skipped; mobile tests 14 passed and mobile typecheck; typecheck and production build passed; fixture browser checks at 1440/375 (no overflow, 0 PR requests after Settings round trip, 0 code requests on reopen, 1 repository list request across two connects).
- Release (user requested): candidate `dpl_6HLaZoiRxS3s65oLNq9X5nLaQM5X` / `https://agentproof-l7hgyd6lu-renggyus-projects.vercel.app` checked (home/dashboard 200; unauthenticated activity/PR/report/code 401; new CSS present) and promoted; stable domain confirmed. Rollback target `dpl_2Xm9mi5WJqiSCkNLkt313uKV3c7d`. Signed-in live interaction not verified. No commit, push, DB write or paid analysis.

## 2026-10-02 — Scroll panes, label scale, PR #120 evidence check — Claude Code

- Scope (user requested, web presentation only, not deployed yet): ≥761px PR list and version shelf scroll inside panels of one standard height (`--pane-height`), ≥1180px the report reader also scrolls in its own panel; visible scrollbars; mobile keeps page scroll. One label scale for repository lists (name 14/600, chips 12) via shared `RepositoryMeta` in repository strip, Settings and picker; fixed at source in `reading-workspace.css` (`.repository-tab span` 15px rule hit chips) and toggle rows 14/12. Report actions kept under the summary (reading-workspace order rule had moved them below opened evidence, producing two adjacent "Hide evidence" buttons).
- Verification: typecheck, build, component tests 183 passed, mobile tests 14 passed; fixture browser at 1440: PR list scrolled 500px with page at 0, reader scrolls independently; computed label sizes uniform; 375px no overflow.
- PR #120 (RengGyu/AgentProof) read-only GitHub API check: 135 changed files exceed `GITHUB_MAX_CHANGED_FILES` 120; GitHub returned no patch for 9 files; 108 patches exceed the 1000-char compaction; no linked issue; one CI check. Saved production report itself was not inspected.
- Release (user requested): candidate `dpl_BhM7NLRZpS3QxgdrJNBhcutQfmQu` / `https://agentproof-ngr9d9xkp-renggyus-projects.vercel.app` checked (home/dashboard 200; unauthenticated activity/PR/report/code 401; new CSS present) and promoted to `https://agentproof-pearl.vercel.app`. Rollback target `dpl_6HLaZoiRxS3s65oLNq9X5nLaQM5X`. Signed-in live interaction not verified. No commit, push, DB write or paid analysis.


### 2026-10-03 PR120 bounded evidence collection implementation
- Authorized scope: metadata pagination, requirement-linked exact-revision code/test context, truthful partial reports and UI inspection guidance; no paid/model API, production writes, commit/push/deploy or additional agents.
- Branch: safely switched the existing dirty worktree to `codex/fix-pr120-analysis-20261003`; HEAD remains `3b3153433674b81d8a6e23730ad79ed72846728f`. Original 44 tracked/43 untracked/staged0 retained; current 52/43/0. Baseline hashes confirm no out-of-scope edits or deleted dirty files.
- Implementation: metadata-only collection uses at most three 100-file pages, reconciles known counts and retains partial inventory on malformed/API/timeout responses. Missing patches no longer invalidate a complete filename inventory. Existing patch summaries and eight-file exact-head read/payload budgets remain bounded; source-linked implementation/tests are prioritized and snapshot context slots reserved. Unresolved requirements remain unclear; verified exact-head items survive unrelated gaps. UI presents human inspection without volume-limit explanations or generic collection retries; original JSON/diagnostics/exports remain intact.
- Owned paths: `src/lib/github.ts`, `src/lib/github.test.ts`, `src/lib/review-intent.ts`, `src/lib/review-navigation.test.ts`, `src/lib/ordinary-requirement-outcomes.test.ts`, `src/lib/tenant-report-language.ts`, `src/lib/pr-evidence-review.ts`, `src/components/ReportTopSummary.tsx`, `src/components/ReportTopSummary.test.tsx`, `src/components/report-reading.test.tsx`, `src/components/ReportView.tsx`, `src/components/TenantSetupPanel.tsx`, `src/app/api/analyze/route.test.ts`, `src/app/api/tenants/repositories/health/route.test.ts`, this recovery entry. Prior edits in these paths were preserved.
- VERIFIED red: four primary regressions failed before fixes (135-file inventory, late code/test recovery, blocked summary, UI diagnostics); expanded UI diagnostic regression also failed before its fix. Logs: `/private/tmp/agentproof-pr120-red.log`, `/private/tmp/agentproof-pr120-ui-red.log`.
- VERIFIED focused checks: 450 distinct tests passed across 14 files. Initial 10-file run: 305 pass/4 fail; four health-fixture expectations still used the previous metadata budget, corrected and all 23 health tests passed. Remaining boundary run: 141/141 pass. Typecheck `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed; scoped diff reviewed and `git diff --check` passed. Logs: `/private/tmp/agentproof-pr120-focused-final.log`, `/private/tmp/agentproof-pr120-health-final.log`, `/private/tmp/agentproof-pr120-boundaries-final.log`, `/private/tmp/agentproof-pr120-typecheck-final.log`.
- Focused commands: `node node_modules/vitest/vitest.mjs run src/lib/github.test.ts src/lib/review-navigation.test.ts src/lib/ordinary-requirement-outcomes.test.ts src/components/ReportTopSummary.test.tsx src/components/report-reading.test.tsx src/app/api/analyze/route.test.ts src/components/TenantSetupPanel.test.ts src/app/api/tenants/repositories/health/route.test.ts src/lib/tenant-report-language.test.ts src/lib/pr-evidence-review.test.ts --reporter=verbose`; then corrected health fixtures verified with `node node_modules/vitest/vitest.mjs run src/app/api/tenants/repositories/health/route.test.ts --reporter=verbose`; boundaries: `node node_modules/vitest/vitest.mjs run src/lib/general-pr-observation-source.test.ts src/lib/general-pr-assessment.test.ts src/lib/review-snippets.test.ts src/lib/report-validation.test.ts --reporter=verbose`.
- VERIFIED real public PR120 read-only diagnostic: 1/1 pass, head `946bf17b1b200017e6763ec7ba3cbc8615958399`, 135 files, 9 absent/108 compacted patches, 3 checks, complete metadata inventory, no failed GitHub reads. Deterministic/advisory runtime boundaries valid; no-provider advisory conclusion `no_assessable_claims`, not `collection_blocked`. Local mock ranking plus actual exact-head reads: 8 reads, 3 snapshot artifacts, 12 code/4 test artifacts, all revisions pinned, ranking ready/coverage partial. Model/API calls and report saves: zero. Command: `node node_modules/vitest/vitest.mjs run --config /private/tmp/agentproof-pr120-diagnostic-20261003.config.mjs --reporter=verbose --silent=false`; log `/private/tmp/agentproof-pr120-real-final.log`. Sandbox blocked credentials/network; approved read-only execution succeeded using existing access without new login.
- Handling: fixed collection/read gaps keep unknown items and direct source/code inspection; transient GitHub/API/network/timeouts keep safe partial evidence or unavailable status, with retry only after the external problem clears. Provider failures retain safe deterministic evidence and mark interpretation unavailable. Production provider behavior, newly generated/saved paid reports, and live UI remain unverified; no deployment performed. Package complete; no follow-up started.
- 2026-10-03 user-authorized production release: deployed existing worktree via Vercel CLI and promoted READY `dpl_FuLvxyerrw6xW2guk3ugB2t8FVfW` (`https://agentproof-j0mfm77k6-renggyus-projects.vercel.app`) to `https://agentproof-pearl.vercel.app`. Production build/types passed; alias API confirms exact READY deployment. Candidate HTTP checks 3/3; production home/dashboard 200 and activity/reports/report-code/valid-parameter PR-list unauthenticated 401. Initial PR-list check omitted required repositoryId and correctly returned 400; corrected check passed, no code change. Previous READY `dpl_BhM7NLRZpS3QxgdrJNBhcutQfmQu` retained as rollback target. Existing uncommitted source retained; no commit/push, DB migration or manual paid generation/save. Authenticated report interactions and regeneration remain unverified.

### 2026-10-03 Dashboard polling and cached-report revalidation
- Scope/status: complete; only `PublicGitHubDashboard.tsx`, its behavior test, and this entry changed from the task baseline. Existing recovery worktree safely switched to `codex/fix-dashboard-refresh-20261003`; HEAD `3b3153433674b81d8a6e23730ad79ed72846728f`, index and all 83 existing dirty entries preserved. Baseline manifest: `/private/tmp/agentproof-dashboard-refresh-baseline.json`; task-only diff: `/private/tmp/agentproof-dashboard-refresh-task.diff`.
- Fix: selected-repository report metadata, sorted by ID, provides a stable refresh key; unchanged polling, list reorder and other-repository changes do not trigger PR/full-history requests. New versions/status changes and explicit PR refresh still reload. Changed cached-detail revalidation updates the reader without resetting evidence expansion or requesting focus/scroll; unchanged detail stays on screen and existing request guards ignore late responses.
- VERIFIED: five primary regression cases failed before the fix (polling + four freshness/copy states); six new cases pass after the fix, including copy-button state, two-page history/new-version shelf, expansion/focus preservation and late-response handling. Related component tests: 4 files, 78/78 passed; `node node_modules/typescript/bin/tsc --noEmit --incremental false` and scoped `git diff --check` passed. Focused command: `node node_modules/vitest/vitest.mjs run src/components/PublicGitHubDashboard.behavior.test.tsx src/components/PublicGitHubDashboard.test.ts src/components/RepositoryPullRequestWorkspace.test.tsx src/components/RepositoryCommitBrowser.test.tsx --reporter=verbose`. Logs: `/private/tmp/agentproof-dashboard-refresh-red.log`, `/private/tmp/agentproof-dashboard-refresh-focused.log`, `/private/tmp/agentproof-dashboard-refresh-types.log`.
- Remaining: no blocker; live authenticated browser behavior/build/full suite not run. No commit, push, deployment, paid analysis or production writes; no follow-up started.

### 2026-10-03 Evidence links, PR lookup and same-head regeneration (Claude)
- Scope: branch `codex/fix-evidence-links-20261003` from the existing dirty worktree (HEAD `3b315343`, index empty); 95-entry baseline status/hashes in `/private/tmp/agentproof-evidence-links-20261003/baseline-*.txt`. No commit/push/deploy/DB/paid call. 구현솔2's stable refreshKey and cached-detail revalidation in `PublicGitHubDashboard.tsx` untouched.
- Fixed: (1) evidence index bounded at 200 dropped risk-sensitive file evidence that reviewPriority still named, making large-PR reports invalid; when the index must drop items it now keeps risk file evidence first (`extractors.ts`), and any changed file still named without evidence gets an explicit unavailable/inspect note (`verifier.ts`). (2) Intent graph built chunks alphabetically up to 128; files now ranked by source relevance and code→tests→fixtures/generated→docs (`rankReviewFiles`, `review-intent.ts`), path terms sharing rare goal terms count as lexical candidates, behavior goals reserve up to 8 of 12 edges for code/tests, rows keep that order (`review-candidates.ts`); exact-read ordering shares the ranking with per-directory interleave and lock files as generated. (3) PR number/URL lookup outside the recent 20 via the existing single-PR endpoint (`pullRequest` field added, same access checks), stale/late lookup ignored. (4) Same-head regenerate opens the saved report; paid generation starts only from explicit "Regenerate anyway" (paid run keys stay per-click because closed keys are permanently rejected as duplicate in `202609220001_paid_analysis_budget.sql`).
- Not a defect: Vercel project `fluid: true`, default function timeout 300s (`vercel api /v9/projects/agentproof`); no duration change.
- VERIFIED: red→green for each item; typecheck exit 0; full suite 3411 passed/93 skipped exit 0 (one earlier failure from reordering under the bound was fixed by limiting reorder to truncation); `next build` exit 0; external20 no-model rerun (isolated copy) 23/23, runtime-valid 20/20 (was 19), 0 network/provider calls; scoped `git diff --check` clean. Logs under `/private/tmp/agentproof-evidence-links-20261003/`.
- UNCLEAR/remaining: no gold labels or live LLM; candidate swaps in 4 external cases unproven better/worse; TS#64372 checker.go and PR120 req1 service/test still not deterministic candidates (content beyond 1000-char compaction); PR120 offline check is a mechanism diagnostic with synthetic checks/fingerprint and no exact-revision reads (only observer.ts entered read order top 8). Same-head confirmation is per page, not cross-tab server idempotency. Git reproducibility of production still needs an authorized commit.

### 2026-10-03 PR120 exact-read evidence continuation (구현솔)
- Authorized continuation completed on `codex/fix-evidence-links-20261003`. Cancellation left only two regression files changed; no product mutation had run. Baseline `/private/tmp/agentproof-evidence-links-20261003/sol-continuation/baseline.json` hashes 1071 files; task changes are only `review-intent.ts`, `review-snippets.ts`, their navigation/snippet regression tests, and this appended entry. Existing Claude/UI/구현솔2 changes, all other hashes and empty index preserved; no branch switch, new agent, paid call, production write, commit/push/deploy.
- VERIFIED causes/fix: aggregate verification wording mixed concern-specific read ordering; clipped import anchors outweighed actual behavior; first 256 matching lines excluded later camelCase checks; alphabetical packet filling discarded selected ranges; statement/callback dedup lost test-title hints and a matching leading comment returned only the function signature. Retrieval now interleaves each concern's module, paired test and changed relative-import hints; shared source spans stay provenance rather than every goal's query. Specific whole-file matches, bounded symbol/comment and oversized-function context, test-title hints and transient per-goal scores preserve relevant excerpts through the packet. No PR/path/line special cases or JSON field changes. Existing eight-file, 256KB/file, 16-snippet/48KB packet and redaction/grant/revision guards remain.
- VERIFIED red→green: seven general regressions failed before their fixes. `node node_modules/vitest/vitest.mjs run src/lib/review-navigation.test.ts src/lib/review-snippets.test.ts src/lib/review-snippets.regression.test.ts --reporter=verbose`: 135/135. Full suite once after the changes (`node node_modules/vitest/vitest.mjs run --reporter=dot`): 3418 passed, 93 skipped, 247 files passed/7 skipped. `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit 0; scoped `git diff --check` clean. Build not repeated: source retrieval changes, no UI/toolchain changes.
- VERIFIED actual read-only diagnostic: `node node_modules/vitest/vitest.mjs run real-path.test.ts --config /private/tmp/agentproof-evidence-links-20261003/sol-continuation/vitest.config.mjs --reporter=verbose` passed 1/1. Real collector and exact-head GitHub GETs: 18 requests, 0 failures; head `946bf17b1b200017e6763ec7ba3cbc8615958399`, 135 files/9 missing/108 compacted patches. Eight reads include service, service test and observer; ranking packet 16 artifacts/44601 bytes includes service 119–192 (generation/validation/disabled guard), service test 156–162 (shadow preserves exact report), observer 349–400 (before/after provider source refresh). All snapshots pinned and runtime schema valid; partial/unknown limitations retained. Disabled-mode test 147–154 remains omitted; the selected shadow test provides direct report-identity evidence. Provider is mocked: this proves delivery, not live model ranking, behavior correctness or newly saved report quality.
- External20 no-provider fixture/schema/reference diagnostic: `node node_modules/vitest/vitest.mjs run --config /private/tmp/agentproof-evidence-links-20261003/external20-rerun/vitest.config.mjs --reporter=verbose` ran 25: main diagnostic 23 passed (20/20 runtime-valid, no network/provider); two historical `overflow-investigation.test.ts` assertions failed because they expected the already-fixed invalid report to remain invalid. Those investigation expectations and unrelated product files were left unchanged. Temporary artifact secret-pattern check passed 1/1; one fixture field redacted, no recognized secret pattern remains. Evidence/logs and bounded metadata/excerpts only under `.../sol-continuation/`; no full source or credentials retained. UNCLEAR: live LLM candidate decisions and production regeneration; no follow-up started.

### 2026-10-03 Minimal timing and evidence-delivery measurements (구현솔)
- Complete, local A1 only. Changed: `review-navigation-diagnostics.ts`, `review-intent.ts`, `review-snippets.ts`, `gemini-navigation.ts`, `openai-semantic.ts`, `paid-budget.ts`, `pr-evidence-review.ts`, `server-report-store.ts`, `workspace-server/analyze.ts`; tests `review-measurements.test.ts` (new), `paid-budget.test.ts`, `workspace-server/retained-analysis.test.ts`, plus this entry. Baseline HEAD `c57f00c7607a48c710faffd62af3bd2b345b07ab`, branch `codex/fix-evidence-links-20261003`, clean status; 1071-file manifest, HEAD/branch/index unchanged and no outside-scope changes: `/private/tmp/agentproof-minimal-instrumentation-20261003/baseline.json`, `baseline-check.json`.
- Existing timing headers/report fields unchanged. Request-relative monotonic inclusive intervals carry parent IDs: initial collection, report orchestration, model adapter, additional artifact/source/visibility reads, snippet extraction, packet packing, local/runtime validation, session recheck, response/shared navigation projection and storage. Model children distinguish config/price/admission reservation, guarded provider invocation (OpenAI includes response body; Gemini includes SDK await), settlement; run close is a report child. Storage children distinguish repeated validation when required, projection, HTTP/body decoding/write acknowledgement. Parent/overlapping durations must not be summed; successful span completion does not establish semantic acceptance.
- Stable existing artifact IDs and hashed file IDs connect read candidates/snippets, merge lineage, packet hash, model call span, selection, local acceptance/refusal and shared display projection. Transient WeakMap/request context only; 256 spans, 1024 events/220KB event budget, capped metadata/closed reasons and explicit dropped counters. No raw paths/code/prompts/provider text/credentials in the new trace; existing operator transport metadata stays bounded. Existing opt-in + ops authentication + public-repository restriction gates detailed response diagnostics; both dashboard save success and failure recover them before request completion. No trace fields enter packets, report schema or stored rows; private and ordinary dashboard responses stay excluded.
- VERIFIED red: seven new failures/32 existing passes before implementation (`red.log`). Final focused: 9 files/285 tests passed, including result/order identity, overlapping clocks, OpenAI body boundary, reservation denial, failed reads, budget exclusions, merge IDs, local/projection refusal, saved/failed recovery, unauthorized/private exclusion and stored privacy (`focused-final.log`). Full suite once: 248 files passed/7 skipped, 3434 tests passed/93 skipped, exit 0 (`full-final.log`). Typecheck `node node_modules/typescript/bin/tsc --noEmit --incremental false` exit 0 (`typecheck-final.log`); `git diff --check` exit 0. Sixteen new tests total. Logs and condensed fixture example: `/private/tmp/agentproof-minimal-instrumentation-20261003/`.
- UNCLEAR/unmeasured: no production or paid execution; traces cannot establish relevance/correctness or omitted-evidence causes by themselves. Detailed trace starts after ops authentication and ends before response encoding/network/browser paint; provider server processing/TTFT, pause-poll work overlapping transport, alternate/background flows and remaining report orchestration are not individually decomposed. Truncation counters require treating omitted diagnostic events as unknown. No blocker, model/settings change, new agent, commit/push/deploy, migration or operational write; no follow-up started.

### 2026-10-04 First five independent offline interventions (구현솔)
- A1 local implementation/comparison complete; no model/settings change, agents, paid/live runs, operational generation, commit/push/deploy. B0 is the existing uncommitted measurement package: HEAD `c57f00c7607a48c710faffd62af3bd2b345b07ab`, branch `codex/fix-evidence-links-20261003`, patch SHA256 `4bb303ae2c18e58ec627535f6ed4aa6b6523630fbac5e90dd36276eb52ac5f14`. Fixed manifests, per-variant source fingerprints, harness/gold/results: `/private/tmp/agentproof-comparison-20261004/`. 1072 baseline-file hashes, original dirty changes, branch/index and outside-scope files preserved; task edits reverse exactly to B0; this entry only appends.
- Changed only `github.ts`, `types.ts`, `review-intent.ts`, `review-snippets.ts`, `openai-semantic.ts`, `review-navigation-diagnostics.ts`, new `review-interventions.test.ts`, and this entry. I retains at most 128 original hunk coordinates/completeness as immutable non-enumerable request hints (no extra raw patch/serialized field). A re-searches bounded exact-head blobs already read in the same request using validated questions; authorization, 8 unique reads, existing candidate retention and 2 ranking rounds remain. B reserves code/test snippets per locally validated source-bound condition/exception/acceptance/constraint facet; no new condition/model call/schema. C uses the existing TS parser for bounded guard-to-return/throw/assertion prefixes with explicit partial-context limitation. E1 shortens instructions while keeping schema, source authority, uncertainty, privacy and provider limits.
- Offline inputs: four controlled regressions, three other natural patch-only PRs for development, three known natural PRs for regression only; no independent holdout. Complete changed-hunk/core reachability labels were frozen before variant output, not semantic correctness labels. B0/I/A/B/C/E1 packet ranges: 27/34/28/28/27/27 of 45; core lines 48/54/49/49/48/48 of 80. Controlled condition/context omissions 4/3/3/3/3/4 of 4; C gains guard/consequence co-location despite unchanged individually present core count. I+B is the only measured combination: 35/45 ranges,55/80 cores,2/4 omissions. All variants read 11 files/402447 bytes; every request stays at 16 snippets/48000 packet bytes. Baseline gold losses 0; unlabeled baseline context displacement I174/B10/I+B184 lines is a tradeoff with UNKNOWN semantic impact. Development structural ranges stay 6/6; natural semantic condition coverage UNKNOWN. Natural mock emits no condition facets/readPaths, so A/B natural model effects are unmeasured; natural full blobs are Python/Go, outside C’s TS parser intervention. A adds one mocked ranking call, not a proven latency saving. E1 instruction bytes 2555→1983; actual provider effect UNKNOWN.
- VERIFIED: seven regressions observed red→green (six initial + serialized-input compatibility). Final focused14 files:368 passed/1 skipped, exit0; mock benchmark7 variants with stable outcomes across3 retained samples, exit0; typecheck `tsc --noEmit --incremental false`, exit0; diffcheck exit0. Full suite ran once:3444 passed/1 failed/93 skipped, exit1. Failure was the strict evaluation input contract rejecting enumerated coordinates; fixed by non-serialization without expanding corpus schema. Failed runner plus new privacy regression:44 passed, exit0; final focused suite includes both. Full suite was not repeated after correction.
- Recommendation: A/C are local adoption candidates for their controlled gains without observed baseline context loss; I is promising for regression delivery but conditional on its context displacement; B/I+B held for broader condition labels/context tradeoffs. E1 only contract/conciseness validated. No semantic precision, real model selection, provider latency, end-to-end/p95 or production measurement; local timing samples are noisy. Operational final adoption/paid pilot need separate approval. No blocker; no follow-up started.


### 2026-10-04 Claude findings + isolated real-evaluation recovery
- Authorized scope: six navigation/diagnostic fixes, related offline checks, one final full suite, existing budgeted provider evaluation only; existing dirty/staged contents/branch preserved (raw index byte hash changed without staging operations; possible stat refresh), no commit/deploy/saved report.
- Independently reproduced seven initial regression failures; fixed facet comparator precomputation, generic hunk discovery, selected branch-prefix coverage, closed12-limit overflow+count, shared provider failure reasons/stage, per-packet/lazy capped hashes in review-intent/review-snippets/review-navigation-diagnostics; regression tests in review-fixes.test.ts. Focused113 and final14 passed; typecheck passed. Same16-goal×12-facet×8-file input three CPU samples3.42–3.60s→78–114ms with identical selection fingerprints.
- Evaluation: existing Vercel CLI login/pull/env run investigated; production47 secrets withheld, required model/provider/control-plane values unavailable. Further official API read command execution approval rejected. No paid/provider/report run or budget mutation; actual quality/tokens/cost/latency UNKNOWN. Secret temporary files deleted. Frozen B0 and corrected standalone snapshots/input manifest under /private/tmp/agentproof-fixes-real-eval-20261004. Final full suite3460 passed/93 skipped/exit0 (once), typecheck/diff-check exit0; baseline-preservation proof recorded in tmp; blocker is readable existing runtime authentication+active budget config or existing isolated authenticated runner, not withdrawn30/$5 caps.


### 2026-10-05 Deterministic allocation offline comparison
- Authorized bounded snippet/packet changes; task-start dirty/index/HEAD/branch frozen in `/private/tmp/agentproof-allocation-20261005/baseline.json`. Product retains only content-agreeing covering overlap and exact UTF-8 array/comma/incremental merge costs; prior selection policy restored. No paid/model/deploy/operational calls.
- Held prototype (tmp only): source-bound condition/implementation/test/context reservations, bounded equal-source union, duplicate suppression and protected replacement query atoms. Six frozen natural/development PRs, same16 slots/48000 bytes,5 alternating local samples: diagnostic packet points baseline54/60,prototype49/60,retained product54/60. Pytest definition+1 coexists with identity/traceback; FastAPI forwarding-1 and new pytest implementation-5 lost (4 at snippet selection,1 at packet). Roles/query atoms cannot establish independent implementation coverage; do not adopt. Independent holdout/semantic final selection/real model speed and cost UNKNOWN.
- VERIFIED: two retained regressions red→green; focused4 files40 passed, prototype10 passed, natural/cap/source-hash comparison1 and high-facet CPU comparison1 passed; typecheck and diffcheck exit0. Final full suite once3466 passed/93 skipped/exit0. Fixed16 goals×12 facets×8 files CPU medians baseline434ms,prototype934ms,retained415ms (5 samples, no performance generalization). Results/losses/fingerprints/preservation in tmp; no follow-up.


### 2026-10-05 Adopted GitHub research baseline
- Final adopted scope: bounded request-local operator measurements and stable evidence IDs, closed12-limit overflow/count and shared failure reasons/stages, per-packet/lazy capped hashes, content-agreeing same-revision overlap union and exact UTF-8 array/incremental byte costs. Existing source ranking, code/test reservations, whole bounded file search, SHA/privacy/schema/budget controls retained. I/A/B/C/E1/D novelty/condition-role policies are removed; B comparator, I coordinate contamination and C false-prefix trigger paths disappear with those experiments. Historical experiment entries above are recovery records, not current defaults; tmp evaluation artifacts retained.
- Final checks: retirement regressions4 red→green; focused10 files122 passed; typecheck/diffcheck exit0; final full suite once3457 passed/93 skipped,exit0. Self diff review confirms no coordinate collector/field, same-file re-search, facet/novelty reservation, branch-prefix generator or short-instruction policy; original long instructions restored.
- Authorized commit/normal push target `RengGyu/AgentProof`, `codex/fix-evidence-links-20261003` for the adopted research baseline only. No deployment/model/paid run/new research agent. Branch commit/readback evidence and exclusions under `/private/tmp/agentproof-adopted-research-20261005`; private/raw evaluation inputs and tmp artifacts are not published.


### 2026-10-06 Opt-in Jev connection preparation
- Authorized public-only selector preparation and one protected Preview contract pilot; product defaults and final runtime model unchanged. Added bounded pre-budget candidate collection, maximum one add/replacement with protected references and goal/kind presence checks, source/revision/hash/redaction and16slots/48000 UTF-8 checks. TypeSafe transport uses paidProviderCall, pinned jev-1.13.0 input-only pricing,64k conservative reservation, cancellation and no automatic retry. Schema regression red→green routes supplementary artifacts through the existing factory; no raw source in navigation metadata.
- Checks: focused73 passed/8 skipped; final schema/reference change37 passed; new contracts11 passed, tmp public-input/auth4 passed, typecheck/diffcheck0; no full suite. Official metadata and isolated Preview confirmed server key presence/unauth401, but active prices lack typesafe/jev-1.13.0: paid calls0, usage/settlement/real quality UNKNOWN. FX1500 implies minimum4.032KRW reservation at published0.042USD/M input/output-free rate; registry/settings untouched.
- Preview controller path error briefly deployed the previous protected runner; no model call, deleted. Current protected pilot deployment also deleted; both token files absent, current user production ID/32 aliases unchanged. Older creation/status tmp metadata explicitly marked recovery/UNKNOWN; result/provenance data retained. Evidence and30-call repeated comparison proposal (not executed; supervisor cost review required) in /private/tmp/agentproof-jev-preparation-20261006. No commit/push/Production change or follow-up.


### 2026-10-06 Opt-in A/B/C evidence selection comparison
- Authorized bounded local experiment and protected Preview evaluation; added jev-evidence-experiment.ts/test.ts and exported the existing textTerms tokenizer. A unchanged; B rare-goal-term gain minus deleted coverage with exact bytes/stable-ID ties; C same proposals with independent gain/preservation questions and fixed0.8 gates. Maximum4 proposals/8 questions/40000 empirical JSON bytes; existing source/privacy/revision/protected/one-edit/16slots48000 bytes and paidProviderCall controls retained; no default wiring.
- Frozen metadata-only seed selected6 previously unused public PRs. Completed3/6 (9 cells,5 unique final responses): intent3/Jev3/final5=11 new calls, all model/usage/reserve/settle/close confirmed, retries0. C no-op3/3; B swaps2/3. Frozen representative packet delivery4/9 and final utilization3/9 units are unchanged; direct source review found B discards the unique TypeScript LengthDown/Foo circular-diagnostic regression while adding partial base/head cache-key context. Core-loss stop applied before cases4–6; no holdout replacement/tuning. Semantic efficacy/global speed unproven; B not recommended, C held.
- Related tests22 pass, typecheck exit0, scoped diffcheck and baseline preservation recorded in /private/tmp/agentproof-abc-20261006. Source audit260 artifacts and9 sent packets matches frozen revisions/hashes and exact bytes. New usage-priced costUSD0.010700088; ledger16.054KRW, no new unknown usage. Previous10 attempts/4 UNKNOWN reservations remain separate. Evaluation deployment deleted/readback404/endpoint404; token removed; current user production ID/URL/32 aliases and pre-existing dirty/index/HEAD/branch preserved. No full suite, commit/push, Production/shared-setting changes or additional work.


### 2026-10-07 Default-off complete small snapshot
- Authorized recommendation2 only: `completeSmallSnapshot` defaults off, excludes other selection experiments, and expands at most one B0 snapshot before first ranking from an already-read exact-head complete file (<=80 lines, masked UTF-8<=8000 bytes). Same-source registered missing interval required; all B0 content/provenance/goal links, registry64/96 and conservative/actual16slots48000-byte budgets retained. Atomic ID/alias registration and parent hash lineage; only actual sent IDs returned. Masked cache<=8x8000 bytes cleared after first attempt/finish; ordinary refinement, privacy/freshness guards and product defaults unchanged.
- Regression red2 failures -> green13 new checks; related4 files144 passed, typecheck/diffcheck exit0. One fixed TypeScript/actual-goal offline two-arm comparison: 1-54 -> full1-62, assertions59-60 delivered,16 slots unchanged,21040 ->21374 JSON bytes, B0 interval/content/provenance/goal loss0. No holdout, semantic utilization/real-model quality/latency UNKNOWN; no network/paid/deploy/commit/push/full-suite. Existing dirty/index/HEAD/branch preserved; evidence and bounded Claude review diff in /private/tmp/agentproof-small-file-20261007.


### 2026-10-07 Default-off purpose assessment P1–P4 preparation
- Authorized local P1 source closure/authority, P2 bounded exact-revision source windows/import locators, P3 static/CI/normalized reported signals separated from checked source-owned criteria, P4 reducer/validation/signed summary/purpose presentation and counted uncached budget adapter. Explicit fixed/adaptive options only; no production flag or runtime model substitution. Semantic support remains partial/unclear without required checked execution; whole-source deterministic aliases only.
- New path34 checks; final10 files148 passed; type/diff exit0. Full suite once3525 passed93 skipped, exit0 before the final new-path count-scope guard/original-source checker input changes; these final bounded changes have focused/type verification, no unchanged full-suite repeat. HEAD/branch/index and unrelated prior dirty preserved; paid-budget adds only optional counted-input/output reservation admission. Evidence/review diff and frozen24 public PR/8-repository proposed manifest: /private/tmp/agentproof-purpose-implementation-20261007.
- No paid/deploy/commit/push/registry change. Before comparison: one supervisor-managed Claude review, separate source-backed gold/blob manifests, authenticated Sol/count billing/uncached usage and active registry/reserve confirmation, then isolated Preview contract pilot. Normalized artifact downloader and general checked execution are intentionally not added; existing narrow execution authority only.


### 2026-10-07 Purpose checker dispute and authoritative paid gate
- Single Claude blocker reproduced: unresolved semantic checker dispute now downgrades partial to unclear, suppresses positive semantic assurance, and reaches the closed persisted summary/UI limitations; no-dispute B equivalence and source-owned deterministic authority preserved. Wire schemas retain duplicate/string-length checks locally, omit undocumented keywords in count/generate, and reject unknown wire keywords.
- Focused3 files36 passed; type/diff exit0, no full-suite repeat. Protected read-only Preview: unauth401, authenticated Sol model GET200; authoritative registry has only Luna/Jev, missing openai/gpt-6.1-sol. No count/generation/reserve/settle calls; requested24-case A/B/C comparison NOT RUN. Pilot source hashes/static labels frozen before model answers; remaining23 labels incomplete. Minimum proposed uncached Sol item at FX1500: input2/output10 USD/M,282KRW reserve for64k+6k; shared mutation NOT authorized/applied.
- Evaluation Preview deleted/API404/endpoint404, token absent, current user production ID/URL/32 aliases and prior unrelated dirty/HEAD/branch/index preserved. Review diff, tests, price evidence and exact blocker: /private/tmp/agentproof-purpose-live-20261007. No model substitution, registry/Production changes, commit/push or additional agent.

### 2026-10-07 Luna purpose pilot and source-contract stop
- User-selected product Luna only; explicit purpose adapter model type/mock coverage added (default off). Fixed24 public PR source hashes and independent representative labels frozen before answers (38/45 known clauses,17/24 known overall). Provider8 checks/type exit0; tmp auth/privacy/cache-field checks only, no full-suite repeat.
- Actual7 generations+4 count requests, all Luna usage/reserve/settle/close confirmed. Case1 A navigation/B fixed/C adaptive complete; B=C unclear, evidence gain/loss0, checker0. Case2 P1 rejected `purpose_source_closure`; no B/C or cases3–24 calls and no retry. Actual usage-pricedUSD0.009889375 vs ledger14.2KRW: legacy A cache-write premium omitted by existing ledger; tmp cache-off compatibility correction offline verified but no subsequent A runtime validation. Count billing/account invoice UNKNOWN; no new unknown held usage released.
- All4 evaluation Previews deleted/readback404, tokens absent; current user production ID/URL/32 aliases and unrelated dirty/HEAD/branch/index preserved. Source-backed judgments, bounded diff, frozen manifests and failures: /private/tmp/agentproof-purpose-luna-20261007. Comparison24-case acceptance incomplete; C quality/time improvement unproven. No shared registry/Production changes, commit/push, additional agent or production activation.


### 2026-10-07 — B/C 확장·목적 누락 shadow 실평가
- 승인 범위: 기존 dirty 보존, Luna B/C 공개 PR 비교 및 기본 비활성/public-only 누락 경고; 임시 Preview·정식 budget만.
- 결과: B/C 10시도/7유효쌍, 내용 거절3; 최종판정 이득0. 누락 비교 dev29구간+natural42구간(12PR 중8유효), Jev 양성1/5·Luna2/5; 임계값 경고는 양성0/5여서 기본 채택 보류. 신규2파일 및 이 항목만 변경.
- 검증: 집중10 tests/type/diff exit0, full suite0. 총 generation81/count62, ledger68.176KRW; invoice/count 청구 UNKNOWN. 4 평가배포/토큰 삭제, 운영ID·32alias·HEAD/index/branch 보존.
- 근거/한계: /private/tmp/agentproof-purpose-extended-20261007/result.md, /private/tmp/agentproof-purpose-omission-20261007/result.md. natural 누락 양성0·예외 삭제 양성0으로 recall 미측정; 수정/최종 성능 개선 주장 없음. 후속 작업 없음.


### 2026-10-07 — Default-off bounded purpose localization, review handoff
- Authorized public-only local implementation: exact-SHA/tree/blob request-local store; bounded browse/inspect/literal search and loaded-relative JS/TS definitions/references; independent AI source IDs bypass lexical admission. Hunk/lexical/structural controls share the store; roles remain hypotheses, execution/source-owned reducer authority unchanged. Python/Go binding unsupported; parser deadline cooperative only. No production flag, source persistence or semantic index.
- New26 regression/contract checks; final focused5 files63 passed, type exit0. Full suite exactly once before final requested-range preservation fix:3563 passed93 skipped1 existing omission size-check timeout, exit1; that unchanged test individually passed(exit0), no timeout change or full-suite repetition. Final range fix has focused/type checks; strict packet bytes/role refs and whole-small-file/multi-unit context red→green evidence retained.
- Prior HEAD/index/branch and unrelated dirty preserved. Review diff, frozen sampling/budget protocol and private bounded failure-capture mock in /private/tmp/agentproof-localization-implementation-20261007. No paid/network-source evaluation/deploy/commit/push/registry changes. Supervisor sends one Claude review before new-path calls; fresh24PR source hashes/independent gold and account/price/count pilot gates still pending, real accuracy/time/cost UNKNOWN.


### 2026-10-07 — Localization retained-source fix and matched live comparison
- Claude context-loss blocker: stateless selection requests retain whole earlier code fragments within16slots/48k JSON bytes; omitted IDs explicit/unselectable. Red2→green, focused3files59 passed/type exit0; no full-suite/reviewer repeat. Default off, deterministic/source authority unchanged.
- Frozen24 public PR/8repos:189 Luna generations+189 count, ledger307.390KRW, all usage/reserve/settle/close known; invoice/count billing UNKNOWN. P1closure3fail, AI20 invalid-action fallback+1 provider text-piece rejection, valid AI selection0; no planner gain proven. Corrected witness recall R0/D50/76,K47/76,AI0/76; one preexisting-occurrence gold witness excluded without replacing frozen gold. Source assertions never executed.
- All evaluation Previews/tokens removed, current user production ID/URL/32aliases and HEAD/index/branch/unrelated dirty preserved. tmp-only nonUTF8 backend correction resumes only unexecuted cells; failed cells not retried. Source-backed labels, individual timing/cost/failures, bounded raw diagnostics and minimal diff: /private/tmp/agentproof-localization-live-20261007/result.md. Sol same-evidence arm unavailable: existing authoritative price absent; no registry/Production/commit/push or follow-up work.


- 2026-10-08 explore_final_v1 (local/default off): exploration retains bounded cumulative source/results and existing SHA cache; one strict final interpretation without tools/refinement/checker. Private facts distinguish quotations/model interpretation and execution authority; storage/share retain summary only. Focused source/privacy/off/cancellation/packet/schema/UI regressions and typecheck; no live calls/deployment. Evidence: /private/tmp/agentproof-explore-final-implementation-20261008/result.md.

- 2026-10-08 restrictions P0/P1/P2 (local only): final request-specific evidence/clause ID wire enums with unchanged local closure; complete-blob EOF clamp after80-line validation + lineCount; explore_final-only selected-first acquired-source fill inside existing16/48000 budget, explicit omissions. Focused54 tests/type/diff pass; no paid/deploy/runtime change. Live effect and selection quality unmeasured; unacquired chi base cannot be recovered. Evidence: /private/tmp/agentproof-restrictions-fix-20261008/result.md.

### 2026-10-10 — purpose final contract / exact source recovery
- Authorized purpose fixes: single-ID wire quotes with unchanged internal refs, exact ranges/EOF/explicit occurrence unit, partial-blob reread, server collection facts. Follow-up separates browser-safe Jev selection/summary validation from paid/source modules; transient source-bound authority unchanged. Default off; no model/cap/registry change, commit or push.
- Regression red6→green67 in original package; follow-up focused125/type/build/diff pass, final whole suite3598 passed93 skipped(exit0). Previous size-test timeout reproduced at3.53s; unbroken15k token costs430ms per redaction vs same-byte spaced text0.14ms. Only size-test fixture changed, no timeout increase/redaction-policy change.
- Actual frozen3 Gemini3.8Flash HIGH: express7442 final MAX_TOKENS(98.95s), express7425 report complete(93.27s; core implementation/assertion grounded, Content-Type preservation assertion omitted from narrative), chi1166 localization90s timeout(98.02s; final not called).12 generation/count, retry/checker0, usage-known estimate$0.2293005/$1; direct/unledgered, invoice UNKNOWN, target tests not run. Previous loose-cap3/3 run is not matched performance evidence.
- App Preview READY: https://agentproof-jasyvbnqz-renggyus-projects.vercel.app (dpl_Et1QhYyY3iMtB4HkzioqinzZrzPy);6 endpoint/demo-report smoke checks pass, purpose default off. Evaluation relay/token removed and404 verified; production/32aliases and prior dirty/HEAD/index preserved. Full actual reports/failures, hashes, minimal diff and checks: /private/tmp/agentproof-purpose-deploy-live-20261010/. Production promotion not performed; model-quality improvement not established.

### 2026-10-11 — diff-first bounded purpose evidence
- Authorized: diff-first source binding and question-linked additional reads, minimum new numeric limits; fresh Gemini HIGH live evaluation aggregate $1, isolated relay cleanup. Existing purpose extraction/source authority and strict final/checker0/retry0 preserved; no production/commit/push/model change.
- Implemented original opt-in patch/hunk input, verified merge-base coordinates, full hunk locator tail, changed-directory scopes, read question/known-ID/report-impact linkage, root-search prior-scope receipt, additive final coverage. Recent quote/cache/exact-source fixes retained.
- Full suite3607 passed93 skipped; subsequent integration/merge-base tests and focused77 pass; type and final build pass. Live1 source-parent closure failure(146.96s), live2 streamed BOM byte loss→blob hash failure(164.80s). BOM regression red→green; all3 original source actions replay correctly with model calls0. Existing parent-clause sourceRefs rule made explicit in purpose prompt.
- Final live record:2 failures retained +1 new README report complete(111.05s,$0.10251975). Bound source36lines/4416B,4 intervals, root search0, quotes8/8; no target execution. Total7 generations+7 count,$0.365409/$1, all settled; failed cases not retried. Both relays removed/404; production/32aliases unchanged. No matched quality/speed gain claim; complex code-case final remains unmeasured. Result/actual reports/minimal diff: /private/tmp/agentproof-diff-first-20261011/result.md.

### 2026-10-11 단계별 purpose provider 분담
- 요청/범위: 목적·diff 탐색은 저비용 모델, 최종 해석은 명시적 provider로 분리하고 오동작 수정·실평가. 기존 product/dirty state 및 보호 유지.
- 변경: purpose-provider/assessment에 opt-in stageProviders 및 공통 schema; purpose/context·전후 근거·unknown 지침 보완. provider/diff-first 테스트2파일. 운영 기본 provider·feature flag·가격설정은 그대로.
- 검증: 전체3613 pass93skip1회; 보완 후 관련68 pass; 최종 type/build/diff 통과. 공개3PR 전체완료, 같은 코드 packet Haiku final비교와 README 전체 보완검증.
- 비용/정리: 추가$0.261498(23생성), 이전포함$0.626907/$1,30예약 모두정산. Preview3개 삭제·404,production/32aliases불변. 원문·정확한 한계: /private/tmp/agentproof-staged-20261011/result.md.
- 한계: 코드2건은 마지막지침 최종만 검증; 운영 Haiku/Gemini adapter/가격설정 rollout과 새PR holdout은 미실행.

### 2026-10-11 purpose 과해석·불필요 unknown·핵심근거 누락 보정
- 관찰(VERIFIED, 최신 staged 산출물): 작성자의 과거 검증/negative-control과 release 시점이 요구 clause/condition으로 추출됨; head에서 요청 문구가 보이는 현재상태 clause가 base 미읽음·heading 미확인으로 unknown; 핵심 동작 실행/갱신 지점이 미읽음인 채 탐색이 1 action round 후 종료.
- 원인 해석(INFERRED, 가설): 기존 지침의 전후 transition 규칙 과적용과 diff-first 종료 문구가 이 결과에 기여했을 가능성. 저장 출력은 누락만 입증하며 특정 문장의 인과는 입증하지 않음.
- 변경: purpose-provider.ts 공통 지침(목적=snapshot에서 확인 가능한 요구, 작성자 과정·시점은 context이며 condition 아님; final=현재상태 지지와 미확인 transition 분리; diff-first locate=clause가 의존하는 도달 가능 source만 추가 읽기). purpose-provider.test.ts 계약 테스트1개(지침 전달만 고정, 의미 개선 증거 아님). 숫자 한도·모델·thinking·checker/retry/fallback 불변.
- 검증: 관련3파일43 pass, typecheck pass, 신규 테스트는 이전 지침에서 실패(red). 유료 재평가 미승인·미실행 — 의미 정확도 개선 미확인. 증분 diff: /private/tmp/agentproof-purpose-correction-claude-20261011/incremental.diff.

### 2026-10-11 purpose 보고 범위 단순화 (목적→핵심 diff→적합 판단)
- 사용자 정정 목표: 명시 목적 추출, 핵심 diff hunk 선택·원문 확인(관련 변경 테스트 포함), 변경 내용의 목적 적합 판단만. 하류 호출부/예외경로/소비처 추적과 미확인 목록 표시는 제외.
- 변경: purpose-provider.ts 지침(최종=변경 내용 목적 적합 정의, remainingQuestions 빈 배열, 하류 미독으로 unknown 금지; diff-first=변경 파일 source 읽기만; legacy 지침의 caller/definition 추적 문구 제거). purpose-localization.ts diff-first 전송 스키마를 inspect/source/lf_로 축소하고 서버에서 변경 파일 외 대상 거절, 문서 span·clause ID를 knownRefs 근거로 허용; 도달 불가가 된 검색 가드 제거. PrEvidenceReview.tsx Remaining questions/Collection limits 표시 제거, clause별 적합 문구와 범위 한 줄 추가. 인용/ID/SHA/권한/실행 미추정 계약 유지.
- 검증: Claude 관련7파일123 pass·type/build pass. 실평가 중 merge-base reader 허용 revision 보완; 마지막 source-only 0행 wire 모순을 minimum1/지시로 수정. 후속 관련3파일44 pass·reader 테스트·type pass. 최신0행 수정 후 Claude 재검토는 세션 한도로 미실행.
- 실평가: 동일5PR×Sol/Gemini/Haiku/Luna, 수정 평가 포함 형식 완료5/3/5/3. 핵심 hunk 누락·context 과추출·과잉 판정과 Gemini 시간제한 실패가 남음; 형식 완료를 정확도로 주장하지 않음. usage 확인 추정$1.414390+미확인 timeout/count 비용. Preview3개 삭제404·production/32aliases 불변. 결과 /private/tmp/agentproof-core-4model-20261011/result.md.

### 2026-10-12 — common explore_final_v1 simplification (local only)
- Authorized slim purpose/action/selection/final wire: server derives parent source union and unused spans, changed-file source-only reads reuse existing SHA/blob/evidence cache, no model read-question/search-state bookkeeping or test-sufficiency/remaining-question output. Strict IDs/quotes/phase/source authority and legacy stored/internal fields remain; facts UI shows only supplied tests and server-owned execution receipts.
- New regressions red5→green5; related7files123pass, final type/build/diff exit0. Cross-contract risk justified whole suite once:3622pass93skip(exit0). Default-off, final1/checker0 mock flow, privacy/provenance/cancellation/counterevidence and old report compatibility verified. No product repository/cache change, model/limits change, paid/deploy/commit/push.
- Existing dirty/HEAD/branch/index preserved. Incremental diff, check logs and preservation evidence: /private/tmp/agentproof-purpose-simplification-20261012/. Actual model accuracy/time/cost effects not measured; omitted purpose remains unprocessed/unclear, never fulfilled.

### 2026-10-12 — minimal purpose finish (local only)
- Explicitly authorized phase decoding and short common purpose/final instructions only: one completed final_answer, commentary never returned as a proposal, unphased compatibility, ambiguous/refused/incomplete/invalid responses rejected. Preserve stated changes and essential conditions without inventing universal guarantees; retain actual counterevidence and scoped explanations.
- Red:9 parser regressions +1 instruction-delivery check failed before the fix. Green:8 related files143 passed;2 retained failed-response replays rejected by the original adapter and decoded by a new tmp adapter copy; typecheck/build exit0. No full-suite repeat or paid semantic evaluation; these checks do not establish model accuracy improvement.
- Original dirty state and342 prior evaluation artifacts preserved; runtime model/effort/limits/prices, schema/source/quote/authority/ledger/storage/UI unchanged. Snapshot, incremental diff and results: /private/tmp/agentproof-minimum-finish-implementation-20261012/. No deploy/commit/push/new worker; no follow-up implementation started.

### 2026-10-13 — Luna purpose analysis / tenant persistence recovery
- Authorized: existing advisory web/mobile/worker connection to pinned Luna (purpose medium; locate/final high), reviewer-safe purposeReview persistence/API and PrEvidenceReview; no deploy/commit/push.
- Done: capture original PR diff index at entry; final1/checker0; reject unavailable/invalid/empty purpose before save and stop unknown-usage worker retry; HMAC-bound tenant-only model explanations + exact source refs survive reopen, raw quotations/collection traces remain transient and portable shares omit reviewer prose. Existing off/shadow and older summaries stay compatible; public-only purpose backend rejects private completion.
- Validation: 379 distinct related tests in 12 files pass by latest per-file observations (failed legacy hash fixture corrected and retested); typecheck/build/diff pass. Shared validation lock owned/released; other UI files, HEAD/branch/index and unrelated dirty hashes preserved. Real paid integration not run: local OpenAI credential absent. Evidence/diff: /private/tmp/agentproof-purpose-live-link-20261013/.

### 2026-10-13 로그인·홈·저장소 추가·알림 UI 정리
- 변경: 대시보드 브랜드→/dashboard, `/`는 로그인 상태면 /dashboard로 이동. 로그인 화면을 공유 WorkspaceSignIn 하나로 통일하고 비로그인 PR 분석 링크 제거, /analyze는 비로그인 시 `/`로(로그인 상태 저장소 launch 흐름 유지). 설치 권한 cookie(15분) 만료 401을 앱 로그아웃처럼 처리하지 않고 세션 유지 + "Confirm with GitHub" 안내(기존 OAuth, auth route 무변경). 알림은 패널 열기로 읽음 처리하지 않고 개별 알림 열기 시 해당 id만 읽음·badge 감소, 브라우저 localStorage에 유지, unread/read 스타일. 중복 Connect 문구 정리. ReportTopSummary는 purposeReview가 있으면 목적별 적합 상태와 첫 인용 범위를 먼저 표시.
- 검증: 관련 UI 5파일 68 pass(신규 동작 테스트 6, 갱신 2), typecheck·build pass. 로컬 headless Chrome으로 desktop/mobile 데모 화면에서 브랜드·badge 유지/감소/새로고침 유지·가로 넘침 없음 확인. demo 모드의 기존 날짜 locale hydration 경고는 별개 기존 이슈.

### 2026-10-14 — purpose common contract A/B/C (local only)
- A: preserve safe change/test interpretations and exact selected/counter locations; quote/location-only results stay unknown, no raw quotations stored. Optional source/condition fields retain old signed DTO compatibility. Empty purpose/evidence and purpose-free runtime fallback fail before saving.
- B/C: shared partial-diff reasons, source-kind metadata, static-source freshness independent of CI-only changes, closed numeric projection diagnostics; same safe purpose reaches signed tenant API/UI/text/JSON export with exact-SHA encoded links. No extra model output requirements, authority/model/budget/read caps changes or private/share expansion.
- Validation: 111 distinct related tests/7 files pass by latest per-file observations; final type/build/diff pass. Full suite ran once: 3659 pass/30 fail/93 skip; two compact-final fixture expectations corrected and passed, other 28 failures reproduced with task-start product snapshots (8 files). No full-suite repeat, paid/deploy/commit/push. Original HEAD/branch/index and unrelated dirty preserved; incremental evidence: /private/tmp/agentproof-purpose-contract-fix-20261014/. Real model quality and PR122-specific historical cause remain unmeasured/unknown.

### 2026-10-14 홈 전환·보고서 첫 화면·색상 역할·390px
- 변경: 대시보드 브랜드 일반 클릭은 페이지 로드 없이 홈 상태(패널/선택 보고서 닫고 PR 목록)로 전환, 수식키/새 탭은 기존 href 유지. ReportTopSummary는 purposeReview 목적마다 핵심 변경/테스트 설명 한 줄과 인용 위치를 직접 표시(기존 visible/interpretation 규칙과 "Selected changes" 유지). 적합 판정은 모델 해석이므로 성공색 대신 중립 강조(Fits), 충돌만 경고색(Conflicts); 안 읽은 알림은 브랜드색 대신 중립 표시. 390px 브랜드 터치 영역 44px.
- 참고 지침(읽기만): Impeccable@2f98774f distill/clarify/adapt/polish/colorize, Anthropic frontend-design@8d392c81 SKILL.md.
- 검증: 관련 5파일 114 pass, typecheck·build pass. 로컬 데모 1280/390에서 브랜드 클릭 후 페이지 유지·inbox 닫힘·넘침/작은 터치영역 0, purposeReview 화면은 fixture 렌더로만 확인(실제 인증 운영 데이터 미확인). 대비 Fits 12.9/Conflicts 6.0/Selected 7.2/설명 5.1:1.

### 2026-10-14 보고서 읽기 중복 정리(모바일 스크린샷 기준, 미배포)
- 변경: 요약은 목적(보통 굵기)·대표 해석 1줄·클릭 가능한 path:range 1회만, 목적 위치와 같은 "Inspect first" 행은 생략, 상세에 남은 조건/추가 해석/추가 참조 개수 안내. 대시보드 상세(`leadInSummary`)는 요약에 보인 목적·대표 해석·첫 참조를 반복하지 않고 Fit/Source/Conditions/Exceptions/추가 해석·Test meaning/기타 참조만 표시. 긴 경계 문구는 한 줄+"About this boundary", full SHA는 "Full revisions"로 이동(짧은 SHA는 참조 옆). 버튼은 primary(Evidence & code)→Copy→GitHub(중립 버튼), 390px에서 2열·44px. 테스트 기반 대표 해석은 "Test meaning:" 표시. 단독 렌더(ReportView/share)는 전체 내용 유지.
- 검증: 직접 테스트 33 중 신규/갱신 포함 31 pass, 실패 2는 시작 스냅샷 코드에서도 동일(report-reading in-app reader 순서), reading-workspace 로그인 경계 문구 1건도 이번 변경 무관 기존 실패. typecheck·build pass. PR122 안전 fixture 390/360/1280: 목적 2→1, 해석 2→1, README 범위 4→1, 첫 화면 full SHA 2→0, 모바일 44px 미만 0, 가로 넘침 0. 실제 인증 운영 데이터 미확인.


### 2026-10-14 — model prose contract (local only)
- Explicitly authorized removal of code-looking/source-line echo and execution-claim prose classifiers. Preserve model purpose/change/test wording without normalization; no new raw-source fields. Text length/control/secret/DTO/ref/SHA/quote, signed tenant/share, admission and server-owned execution protections remain. Supports/contradicts stays model interpretation; deterministic source-owned criteria unchanged.
- New regressions red10→green10; related8files236pass, final author-source regression1pass, type/build/diff exit0 (initial test-helper type error corrected). Mock POST→compiler→signed store→authenticated GET→UI preserves prose without execution promotion; legacy signed DTO compatibility retained. No full-suite repeat, paid/deploy/commit/push. Vite rejected sentence unavailable; actual model effect unmeasured.
- Original HEAD/branch/index and unrelated dirty preserved. Incremental diff/check/preservation evidence: /private/tmp/agentproof-purpose-prose-contract-20261014/.

- 2026-10-14 private purpose 연결(로컬): 기존 서버 private grant v1/설치·repo 결속과 현재 권한 재검사를 purpose 읽기·count/generate·final·저장에 연결. 미공급 retention boolean 제거, legacy observer private 차단 유지. 최초 동의/설정 OFF→ON은 기존 persist 흐름 재사용하며 목적 적합 설명 전송 용도 문구 명시. tenant 요약 DTO/HMAC·원문 비저장·public share 제외 유지. 회귀 red→green 및 관련/type/build 검증 기록: /private/tmp/agentproof-private-purpose-implementation-20261014/ (최종 결과 참조). 이번 배포/유료 호출 없음; 운영 PR44의 실제 성공·사용량은 미확인.

- 2026-10-15 — 보고서 언어 backend: 기존 repository grant/settings GET·PATCH에 `reportLanguage: en|ko`와 atomic RPC/기존 테이블 `report_language` migration을 연결. web/mobile/queued/private 목적→최종 요청은 시작 시 언어를 고정하고 reviewer-safe `purposeReview.locale`에 저장(legacy 없음=en, 원문 인용·기존 보고서·공유 보호 유지). 관련 301개 통과, type/build/diff 검사; UI·paid·배포·원격 migration 실행 0. UI handoff/ko mock fixture·증분 diff: `/private/tmp/agentproof-report-language-20261015/`; 배포 전 migration 적용 필요.

### 2026-10-15 보고서 채택안 A + 보고서 언어(en/ko) UI (미배포)
- 변경: ReportTopSummary를 목적마다 결론(목적+중립 판정)→이유→근거(모든 인용 범위 1회, 디렉터리는 흐리게)로 재구성. 조건·예외·추가 해석·테스트 의미(공통이 아닐 때 출처)는 목적별 펼침 하나, 4번째 이후 목적은 "N개 더 보기", 보호 문구·범위·전체 리비전은 목록 아래 1회, CI는 서버 기록 줄로 분리. 판정 라벨 en "Consistent with stated intent / Differs from stated intent / Not enough evidence to judge / Selected changes", ko "변경 의도와 맞음 / 의도와 다른 변경 / 판단 근거 부족 / 선택한 변경 위치". 라벨은 저장된 `purposeReview.locale`(없으면 en)로만 고르고 모델 문장은 그대로 표시(`components/report-copy.ts`). 대시보드 상세(`leadInSummary`)는 목적 근거를 반복하지 않음, 단독 PurposeFacts는 locale 라벨. 설정에 "Report language" English/한국어(44px, "Applies to newly generated reports.")를 기존 settings PATCH `reportLanguage`로 연결.
- 검증: 관련 11파일 328 pass / 3 fail(시작 코드에서도 같은 기존 실패: in-app reader 순서 2, 로그인 경계 문구 1). typecheck·build pass. 로컬 fixture 390/360/1280 en/ko·legacy·위치만·테스트만·4개 목적: 가로 넘침 0, 44px 미만 0, 키보드 펼침 정상. 운영 migration 미적용이라 실제 언어 생성은 확인하지 않음.

- 2026-10-15 — en/ko+A UI+PR별 분석 배포 준비: 언어 migration의 동일 signature 재실행 실패를 PostgreSQL 호환 회귀로 확인하여 `CREATE OR REPLACE`로 수정, 구버전 11인자 호출/consent/RLS/service-only 보호 검증. UI의 저장 locale 고정 라벨을 copy/Markdown에도 재사용하고 signed auth GET→A UI/export 통합 검사 보강. 독립 요약 복사와 근거 export를 구분해 기존 reader 순서 검사 2개를 범위 맞게 유지; 로그인 경계문구 기존 1실패는 무관하여 미수정. 관련227/type/build/diff 통과, full/paid/deploy0. 운영 DB는 공식 CLI 인증 미제공·정상 SQL Editor sign-in 필요로 적용 BLOCKED(사용자 설정 변경0); guarded 단일 migration SQL/근거 `/private/tmp/agentproof-enko-release-readiness-20261015/`. 기존 dirty/HEAD/index/branch 보존.


### 2026-10-15 — 개발 전용 analysis 단계 진단 (기본 OFF)
- 승인 범위: 기존 manual analysis/provider/source/compiler/projection/store와 로컬 client 수신 단계에 allowlisted hash/count/closed 상태만 연결. request correlation 재사용, 보고서/언어/UI/권한/예산 의미 불변; 원문·예외 메시지·비밀 미기록.
- 서버 `AGENTPROOF_ANALYSIS_DIAGNOSTICS=1`, client 개발 빌드 `NEXT_PUBLIC_AGENTPROOF_ANALYSIS_DIAGNOSTICS=1`만 opt-in. 새 endpoint/DB/영구 원문/서비스 UI 없음. 서버 response return은 client 수신 증명이 아님.
- 증분/검사/2실행 비교 안내: `/private/tmp/agentproof-analysis-diagnostics-20261015/`. 로컬 관련 회귀·type/build 검증 기록 포함. 이번 paid/배포 없음; PR48 과거 원인 및 의미 정확도는 미확정.

### 2026-10-15 — PR별 미수신 오류와 새 저장본 대조
- 승인 범위: RepositoryCommitBrowser의 기존 PR별 요청/이력 상태만 수정. 요청 ID·시작시각·head·기존 report IDs를 고정하고 새 이력의 저장본과 대조해 이전 transport 오류만 정리; 새 요청/권한·HTTP 실패/기존 보고서/동시 미수신 출처 모호성은 유지. 저장본 확인은 GET만 사용하며 분석 재호출 없음.
- 검증: 직접 회귀 red→green, 관련3파일91pass(신규19), type/diff pass. 전체 suite/build/배포/paid 재실행 없음. 기존 dirty/HEAD/index/branch 보존.
- 근거/회복: `/private/tmp/agentproof-stale-network-fix-20261015/`에 증분diff·검사·PR46 단계 시간표. 기존 실제 진단 기준 server166.162s/provider37.378s, 원 최초 client Load failed 원인은 미확정. 운영에는 아직 미반영.

### 2026-10-15 — PR46 두 실행 차이와 모바일 수신 진단 보완(미배포)
- 새 실행 안전 이벤트 68개를 기한 내 회수. 같은 source bundle/목적 요청 hash·설정인데 P1부터 조건1/예외3→조건2/예외1로 달라짐; 양쪽 같은 원문5개 전달, before 인용 추가는 획득 증가 아님. 각 저장→후속 GET의 report/DTO hash 일치. 원 최초 client Load failed 원인은 기록 부재로 미확정.
- 기존 default-OFF 진단에 정상 tenant auth/CSRF·닫힌 enum/시간/수량만 받는 bounded POST, client 수신/본문/abort/visibility/offline 관측, 서버 소유 tenant hash와 응답 직렬화 bytes를 연결. 진단 실패는 분석/응답 결과를 바꾸지 않으며 raw본문/URL/예외/비밀 미전송. 기존 stale 오류 복구 패치 보존; 이번 paid/배포/commit/push 없음.
- 직접 회귀 red→green, 관련6파일164pass/type/build 통과. 증분diff·두 실행 비교·수집/한계 안내: `/private/tmp/agentproof-pr46-rerun-diagnostics-20261015/`. 실제 모바일 수신 원인 분류는 향후 배포 후 수집 필요; 과거 원인·모델 의미 정확도 개선으로 주장하지 않음.

### 2026-10-16 — Saved reports OFF 수동 저장 경계(미배포)
- Dashboard retained 요청만 기존 credential/grant 검사에 requireSave를 전달해 public/private 저장 OFF를 count/model 전에409로 거절. 저장 직전에도 기존 session/private 동의 검사 후 같은 uncached credential/grant·설치/repo 결속을 재확인. 비저장 분석과 analysisEnabled 의미는 유지.
- 신규8회귀 중4개 기존결함 red 확인 후 모두 pass, 핵심2파일74pass. 추가 auth/budget20개는14pass/6fail이며 변경 전 코드 overlay에서도 같은6실패(기존 GitHub collector mock 경계) 확인·미수정. type/diff pass; 서버 경계만의 작은 변경으로 build/fullsuite 반복 생략. 기존 dirty/HEAD/index/branch 보존, paid/운영설정/배포/commit/push0.
- 증분diff·검사·baseline 실패 대조: `/private/tmp/agentproof-saved-reports-off-fix-20261016/`. 실제 운영/모델 검증은 미실행.

### 2026-10-16 대시보드·보고서 시각 정리(4개 UI 스킬 참고, 미배포)
- 변경: `reading-workspace.css` 끝에 "quiet document workspace" 블록 추가(보고서만 테두리 표면, 저장소 줄·보고서 목록·inbox·설정 저장소 행은 구분선 목록, 선택 상태는 중립 배경+얇은 초록 선, 행 높이/모바일 간격 축소, 버튼 hover/active/reduced-motion, text-wrap, tabular-nums, Delete account 44px). ReportTopSummary 인용 범위를 디렉터리(모바일 별도 흐린 줄)/파일명/줄 범위(줄바꿈 금지)로 분리, 경로·SHA에 `translate="no"`. 로딩 문구 "…". 모델 문장·locale 계약·기능 변경 없음.
- 검증: 관련 11파일 262 pass / 1 fail(기존 로그인 경계 문구). typecheck·build pass. 로컬 demo(360/390/1280) 넘침 0, 44px 미만 0(전: Delete account 24px), fixture en/ko·긴 경로·목적 4개·위치만·테스트만 넘침 0·대비 5.16 이상·키보드 펼침 정상. 실제 로그인 화면은 확인하지 않음.

### 2026-10-16 색상 역할 정리(Impeccable colorize·Taste palette, 미배포)
- 변경: 초록 틴트 중립색(배경·본문·보조·구분선)을 중립 graphite/warm paper로 교체, 브랜드 초록은 로고·주 버튼·focus·선택 선·이동 링크에만 유지. CURRENT/Analysis ready를 중립(아이콘+문구 유지), hover를 초록 글자→중립 sunken 배경, 컨트롤 경계 3:1(`--workspace-control`), 체크박스 경계 2.87→3.48:1, inspect-first·목록 아이콘 녹색 틴트 제거, 상태색(ok/wait/fail/none) 미세 조정. 선언 위치(`reading-workspace.css` 토큰·하드코딩, `globals.css` st 토큰·status-token)에서 수정, 배치·문구·동작 변경 없음.
- 검증: 관련 8파일 158 pass / 1 fail(기존 로그인 경계 문구). typecheck·build pass. demo 390/1280 본문 저대비 0, 컨트롤 경계 ≥3.21, focus ring 7.85, fixture en/ko·긴 경로 넘침 0·44px 유지·최소 대비 5.16→5.72.

### 2026-10-16 — Dashboard read/error presentation recovery
- Authorized local fix only: distinguish failed/loading reads from successful empty data, retain prior data except access denial, retry all three reads with latest-request guards, and keep action/read errors separate. Project job failures through fixed user messages without exposing internal codes/arbitrary summaries; private job diagnostics unchanged. Related 185 tests (8 files), typecheck and build passed. No deploy/paid/regen/commit/push. Original mobile transport/parsing failure remains UNKNOWN. Recovery: `/private/tmp/agentproof-dashboard-error-fix-20261016/result.md`.

### 2026-10-16 팔레트 재설계(쿨 뉴트럴 + ink 주 버튼, 미배포)
- 변경: warm cream 배경·포레스트 그린 주 버튼·갈색 대기 문구 조합을 쿨 그레이 canvas(#f3f4f6)+흰 표면, 거의 검정 본문(#111418)·보조(#555c67), ink 주 버튼, 더 맑은 브랜드 초록(#17614c, 로고·focus·선택·링크만)으로 재설계. CI 통과·대기 칩은 중립 바탕+색 아이콘(문구 유지), 실패만 붉은 채움 유지, Inspect first 대기 문장은 ink+앰버 막대. 선언 위치(`reading-workspace.css` 토큰·주 버튼, `globals.css` st 토큰·tone 규칙)에서 수정, 배치·문구·동작 변경 없음.
- 검증: 관련 4파일 71 pass / 1 fail(기존 로그인 경계 문구), build pass. demo 390/1280 AA 미달 0·컨트롤 경계 ≥3.34·focus 7.37, fixture en/ko·긴 경로 넘침 0·44px 유지·최소 대비 5.71.

### 2026-10-16 — AgentProof source-focus mark and approved release
- Authorized one native SVG mark shared by home/dashboard/sign-in; home behavior/name retained. Logo-focused7 tests, type/build passed; local24/32/44 monochrome and390/1280 header/focus/contrast checked. Release includes previously validated read/error messaging + cool-neutral palette only. No paid/regen/DB/permission/commit/push. Snapshot/deployment evidence: `/private/tmp/agentproof-logo-release-20261016/result.md`.

### 2026-10-16 DiffEvidence 리브랜딩(사용자 제공 로고, 미배포)
- 변경: 사용자 표시 제품명을 DiffEvidence로(대시보드·로그인/entry 헤더, 페이지 title, 보고서 copy/export 머리말, 공유/상세 보고서·계정 삭제·legacy analyze 헤더, ReportView export 안내). 제공 PNG(투명 배경 확인)를 모양·색 그대로 crop·resize해 `public/brand/diffevidence-mark.png`(253x192)와 `src/app/icon.png`(256 favicon)로 사용, 공유 `DiffEvidenceMark` 컴포넌트로 교체. 초록 브랜드 제거: 주 버튼·focus·링크·체크는 graphite(#1d1c1a), 선택 행 가장자리만 로고 taupe(#7b7168), 중립 canvas #f4f4f3. GitHub App명·설정 주소 안내·버전 동의문·marker comment·내부 ID·저장 데이터는 유지.
- 검증: 관련 12파일 159 pass / 1 fail(기존 로그인 경계 문구), typecheck·build pass. demo/sign-in 360/390/1280 넘침 0·44px 미만 0·AA 미달 0·컨트롤 경계 ≥3.53·focus 17:1, fixture en/ko·긴 경로 정상.

- 2026-10-16: DiffEvidence report hierarchy backend/output: added optional cited per-clause changeSummary/scopeNotes, preserved legacy signed reads and source/authority guards, and shared tenant Copy/Markdown formatting with independent claim refs. Local source/store/authGET/export regressions and type/build verification recorded in /private/tmp/diffevidence-report-hierarchy-backend-20261016/. UI handoff only; no deployment or paid evaluation.

- 2026-10-16: Took over Claude's report hierarchy UI; preserved its en/ko labels and before fixtures, completed one shared overview/claim-evidence/details renderer for dashboard and ReportView, retained receipt/source/freshness boundaries. Local regression/browser/type/build evidence: /private/tmp/diffevidence-report-hierarchy-ui-sol-20261016/. No deployment or paid calls.

- 2026-10-16: DiffEvidence concise report/nav/settings UI (Claude, not deployed). Removed developer-facing report text from the screen (freshness help, intent-origin label, receipt sentence, model note/boundary, intent details, author-claim source, revisions disclosure, full head SHA, evidence-only footer); short verdicts (Fits/적합 · Conflicts/불일치 · Insufficient evidence/근거 부족), single model-interpretation label, CI records kept. Icon-only brand/settings/report nav with aria-label/title/44px, settings back button, settings copy en/ko from repository reportLanguage (same-meaning consent translation; version/grant unchanged). Copy/Markdown export unchanged (still contains disclaimers). Related tests 201/202 (1 pre-existing sign-in boundary failure), tsc/build pass. Evidence: /private/tmp/diffevidence-concise-ui-claude-20261016/.

- 2026-10-17: Core review-information selection + common output guidance (Claude, not deployed). Compared fixture PRs 46/47/48 (config / docs-text / behavior) at head: importance = what changes the purpose-fit judgment (behavior/value/config, qualifiers, stated constraints, conflicts); accompanying provenance/notice/location items stay brief and after the lead change but are core when they are the PR's subject or a requirement; PR-wide scope stated once. Applied to purpose-provider.ts common purpose sentence and final editing tail only (en/ko identical; no schema/renderer/store/limit change). Tests: 7 related files pass after fixing one stale UI heading assertion; tsc/build pass. No real model call, so generation effect is unverified. Evidence: /private/tmp/diffevidence-core-selection-claude-20261017/.

## 2026-10-18 mobile return recovery
- Authorized local-only fix: unconfirmed analysis transport/body delivery checks existing saved history once, defers while hidden, and rechecks on the dashboard visibility-return signal. Matching new PR/head/version only confirms saved availability; known HTTP/auth failures and unrelated/newer attempts remain separate. No paid POST retry, polling engine, server/diagnostic flag changes or deployment. Focused 138 cases and typecheck pass; browser event simulation recorded separately; real iOS background transport cause remains unconfirmed. Recovery artifacts: `/private/tmp/diffevidence-mobile-return-fix-20261018/`.

## 2026-10-18 native report and remote push connection
- Authorized local-only sequential package after mobile-return recovery: reuse current dashboard/report/enko settings and retained native PR routes; refresh on native resume; DiffEvidence native assets/name; explicit OS push opt-in, encrypted session/member-bound registry, tenant-authorized report taps, after-save/terminal-job delivery via APNs/FCM with durable dedup and bounded retry. Existing private consent, source/quote/SHA and budget contracts unchanged. Source migration/API added, no operating SQL/deploy/paid/device install. Mobile type/build + both Capacitor sync and Android debug/iOS unsigned compilation recorded. Final checks/remaining provider setup: `/private/tmp/diffevidence-native-push-20261018/result.md`; first package evidence remains separate.

- 2026-10-18: Authorized production release of verified mobile-return fix + native retained/push support: `dpl_G9Hoc7AxntiwqBJ6xXphU1zwVD2P`, canonical READY; snapshot `73da1f0e…a2356`, uploaded hashes/auth/login/diagnostic-OFF/guest390 smoke passed. Provider keys absent (names-only metadata); optional push leaves saved ACK intact. Operating migration success REPORTED by user, independent schema read unavailable; no SQL rerun/paid/device install. Existing Android debug APK/iOS unsigned artifacts preserved; APNs/FCM/provisioning/device verification remain. Evidence: `/private/tmp/diffevidence-native-server-production-20261018/result.md`.

- 2026-10-18: Desktop/mobile UI interaction check (Claude, not deployed). Reproduced in a local split-mode fixture harness: with evidence open, a text-selection drag scrolled the whole page 246–346px because the visually hidden report heading (absolute) escaped the split report pane; fixed with `position: relative` on the pane. Aligned split panes (reading-workspace override left a 4/16px offset). Mobile PR lookup to 44px and baseline-aligned wrapped PR numbers. Icon off-centre not reproduced (≤1px). Related tests 300/300, build pass. Evidence: /private/tmp/diffevidence-ui-interaction-claude-20261018/.

- 2026-10-19: "Evidence & code" now opens a cited-code reader (Claude, not deployed). Cause: purpose reports hid PurposeFacts under leadInSummary, leaving a closed collected-changes list; claim refs only linked to GitHub. New PurposeCodeEvidence lists cited locations once, opens the first readable one through the existing authenticated report-code reader with the cited range marked, and offers summary "Read code" buttons; base/non-collected locations stay GitHub-only (server unchanged). Fixture harness 1280/390/360 checks, related tests pass, tsc/build pass. Evidence: /private/tmp/diffevidence-evidence-code-claude-20261019/.

- 2026-10-19: Sol took over cancelled concise-output task (backup bytes match; completed cited-code reader preserved). Common en/ko purpose/final instructions now favor plain behavior/effect with material qualifiers retained; shared human copy/Markdown matches the existing short UI verdict/claim refs without generated stock repetition or revision dumps. Stored/model prose and JSON/schema/signature contracts unchanged. Local related161/11files, type/build and10 synthetic browser cases360/390/1280 pass; six manual editorial examples are not model-quality evidence. No deploy/paid. Recovery: `/private/tmp/diffevidence-concise-output-sol-20261019/result.md`.

### 2026-10-20 — purpose timeout cancellation and closed provenance
- Authorized: fix dropped localization/source cancellation, retain original timer reasons in private failure logs; unchanged limits/profile/privacy/budget. Added tenant-bound repository hash + PR anchor; diagnostics flags remain OFF.
- Validation: signal regression red→green; related235 pass/13 independently reproduced pre-existing failures, typecheck/build pass; no paid analysis. Production deployment and safe smoke recorded in /private/tmp/diffevidence-timeout-fix-20261020/. Historical PR48 timeout origin remains unknown.

### 2026-10-20 — core changes first in report reading
- Authorized local prompt/UI/export adjustment: primary cited behavior and explicit conflicts before separate execution receipts; scope/intent background, extra purposes and supplementary tests remain in Details. No schema/storage rewrite or semantic filtering; exact refs/code reader and timeout package preserved.
- Validation:4 red regressions→131 related pass/type/build;10 synthetic browser fixtures390/1280, same-input before/after samples, code reader/clipboard/JSON preserved. No deployment/paid generation; real model ordering remains unmeasured. Evidence /private/tmp/diffevidence-core-first-20261020/.

- 2026-10-20 core-first 표시 감사 후속: 정상 인증 PR48(05:28:49Z) DTO/운영 DOM으로 기존 동작우선·scope 상세가 이미 정상임을 확인. 모든 선택 목적/불일치 정적테스트 본문 보존, Copy 판정 후순서, 저장 locale 보고서 버튼/native back 표식, 공통 평이한 지침 수정. 관련191+mobile6/type/build 및 실저장형태 포함10화면 검증. 유료0; production 배포/실모델 표현 효과는 별도 확인 기록.

- 2026-10-20: Reading-workspace design pass (Claude, not deployed, CSS only). Lists narrower (25–30rem) and flat (version rows, neutral selection edge, neutral "Latest"), report on one white surface (grey overview box removed, PR number as meta, 23/16/14/12 type, 70ch prose), quiet topbar icons, mobile full-width report sheet with primary + shared secondary action rows, Sentry-style code header+lines, settings/inbox rows, 160ms reveal (reduced-motion off). Fixed settings first-section styling lost after the back button. Fixture harness 360/390/1280/1440 before/after, content/links identical, desktop lock kept; tests 373/375 (2 pre-existing source-text failures from another worker's label change), typecheck/build pass. Evidence: /private/tmp/diffevidence-ui-design-claude-20261020/.

- 2026-10-21: Front door and first-connection presentation (Claude, not deployed, no Figma). Home explains the report with a labelled sample and the 3 GitHub steps (sign in → install app/choose repositories, owner approval → PR report) with one sign-in action; signed-in redirect/OAuth start unchanged; no anonymous analysis. Signed-in users without repositories get a "Connect a repository" guide whose current step carries the real action (install, confirm access while still signed in, choose installation/repository); private consent dialog takes focus; wording/consent versions unchanged. Product-name copy → DiffEvidence (GitHub App name kept). Mock-harness checks 1440/1280/390/360, tests (2 pre-existing literal failures), mobile 6/6, typecheck/build pass. Evidence: /private/tmp/diffevidence-frontdoor-claude-20261021/.

- 2026-10-21: Concise copy and neutral colors (Claude, not deployed). Removed legacy Priority/Evidence from report status and list, sign-in boilerplate, home CTA extras, report-language helper; private setting now "Allow private PR analysis"/"비공개 PR 분석 허용" with the unchanged notice in one disclosure open only while consent is needed (version/grant unchanged); automatic analysis copy matches real triggers (opened or new commits). Blue accent → soft charcoal, cream surfaces → cool gray; computed-color scan shows no blue/warm surfaces (semantic STALE amber kept). Tests 212/214 (2 pre-existing literal failures), mobile 6/6, typecheck/build pass. Evidence: /private/tmp/diffevidence-concise-neutral-claude-20261021/.

- 2026-10-21: Home visual design (Claude, not deployed; Figma unavailable in session, code-native). Astra EN copy; value + CTA → one fictional sample window (report claims with refs beside a neutral dark code pane, ref buttons switch the sample excerpt) → three start steps; removed long steps and Shows/Does not. Neutral cool gray/white, soft charcoal, no blue/green/cream (computed scan clean); motion only on sample switch, reduced-motion off. Harness 1440/1280/390/360 overflow 0/44px/focus; tests 87/89 (2 pre-existing literal), mobile 6/6, typecheck/build pass. Evidence: /private/tmp/diffevidence-home-visual-claude-20261021/.

- 2026-10-21: Regenerate now confirms inline below its button without changing the selected version/list; explicit confirmation alone starts analysis. Unknown-delivery history GET shows en/ko checking status/spinner and synchronously locks same-PR generation/duplicate checks; settle/repo cleanup preserves other PRs and request identity. 64 focused regressions/type/build, real dashboard mock 360/390 position/44px/GET-state checks; PR45 production read found 2 saved versions and a recent PR45 assess/validation/purpose_final_quote HTTP503 (exact tenant/repo anchor attribution not independently matched). No paid analysis or deployment. Evidence /private/tmp/diffevidence-regenerate-inline-20261021/.


### 2026-10-21 — 수동 저장 분석의 기존 durable queue 연결
- 승인 범위: Dashboard/native 접수·상태 조회와 기존 worker/서명 저장 연결. 202는 접수만 뜻하며 client 종료/조회 취소는 서버 job을 취소하지 않는다. 같은 head 활성 job/동일 요청은 재사용하고 종료 후 명시적 새 요청만 새 revision으로 접수한다.
- 기존 inline Regenerate/확인 spinner·PR별 선택 보호, source/quote·동의·tenant/설치·저장 ON·예산/정산 경계를 유지했다. `/analyze` 일시 분석은 변경하지 않았다.
- 로컬 mock 통합/직접 UI·웹/모바일 검증 기록: `/private/tmp/diffevidence-manual-analysis-queue-20261021/result.md`. 운영 RPC migration `202610210001_workspace_analysis_queue.sql`은 소스만 준비, 미적용/미배포/실모델·실 worker dispatch 0. 기존 UI 문구 기대 5건과 모바일 기존 테스트 타입 오류는 별도 기록한다.

- 2026-10-21: 큐 저장 결과 재조회 연결 수정(미배포). 상세 GET의 누락된 opaque report ID를 반환하고, 원문 provenance 없는 서명 tenant DTO는 purposeReview의 정확한 head로도 결속 검증(존재하는 모든 SHA 일치 필요). 실제 route→worker→signed store→GET→UI 모의 통합 및 ID/repo/PR/head/revision/권한/서명 음성 사례 포함 121 pass, type/build 확인. 사용자 PR45 22:38:27 KST 저장은 REPORTED; 운영 POST202/GET200은 확보했으나 실행 귀속/사용자 JS 버전은 미확정. paid/배포0. /private/tmp/diffevidence-pr45-result-match-fix-20261021/.

- 2026-10-21: DeepSeek 테스트 오프라인 준비. 공식 현행 모델/Responses JSON Schema 문서를 확인하고 공통 prompt/schema/final parser 재사용 어댑터와 mock 63 pass/type를 준비했다. 운영 Luna/예산/동의 설정 불변; 정확 사전 count 및 DeepSeek 가격·정산 연결은 미확인/미구현으로 live admission BLOCKED. 키 읽기·실모델·배포0. /private/tmp/diffevidence-deepseek-test-prep-20261021/.

- 2026-10-21: DeepSeek Flash1017/high 합성 단회 smoke 코드 준비(미배포). 실제 provider 이름과 공식1M 문맥의 보수적 상한·peak cache-miss 가격을 기존 budget reserve/settle에 연결, 2048 output/기존60s/자동retry0. 107 mock/type pass. production dpl_Ds6Q7BwAueykjuN3WF7PNmC54SUt 키 존재는 metadata 확인했으나 현 process 키 없음/기존 원격 실행 경로 없음으로 실제호출0; 운영 DeepSeek 가격설정 미확인, DB/키이동/배포0. /private/tmp/diffevidence-deepseek-1017-smoke-20261021/.

- 2026-10-21: 서비스 공통 purpose를 DeepSeek Flash1017/high로 로컬 연결. 목적/전체탐색/final은 동일 provider, 기존 private권한·원문비저장·quote/SHA·정산/timeout 보호 및 PR45 ID/SHAfix 보존. 실제entry→durableworker→signedstore→authGET/UI 모의 회귀 포함405pass/기존5문구fail, 최종직접48pass(중복)/type/build pass. 운영가격·예약설정 미확인으로 전환배포 보류, 읽기/최소가격추가 SQL은 tmp에만 준비; DB/paid0. /private/tmp/diffevidence-deepseek-runtime-20261021/.


### 2026-10-22 — Locate deadline timing diagnostics (local only)
- Authorized closed private round timings: request/job+PR/hash anchor, grant/visibility, source, reservation/settlement, provider headers/body/parsing; one summary or abort snapshot, no content logging or behavior/timeout/profile change.
- Complete locally:139 related pass (including14 new cases), final type/build pass; fake-clock pending90s, source8s, nested/parallel accounting and privacy checked. Evidence `/private/tmp/diffevidence-locate-timings-20261022/`. No deploy/paid/worker trigger; actual production90s bottleneck remains unmeasured.


### 2026-10-22 — DeepSeek incomplete-response closed diagnostics
- Authorized: existing private failure log gains allowlisted completion status/reason and safe input/output/cache/reasoning token counts; no response text or success/limit/profile change.
- Local86 related pass/type/build pass; actual provider mock→wrapped private logger red→green, malformed canaries rejected. Release artifacts `/private/tmp/diffevidence-incomplete-diagnostic-production-20261022/`; paid/regen/DB/worker triggers0; actual cause awaits a future user run.

### 2026-10-22 DeepSeek output allowance (local only)
- Approved32768 combined reasoning/output for all common purpose stages; request/usage/admission use the same ceiling. Preserved model/high, timeouts, privacy, quote validation and budget caps.
- Regression122pass (red9→green), type/buildpass; manual reserve-only SQL prepared at /private/tmp/diffevidence-deepseek-output-limit-20261022/update-deepseek-reserve.sql (FX1500:796.263KRW with50% headroom). DB not applied, no paid calls/deployment; actual completion remains unverified.
