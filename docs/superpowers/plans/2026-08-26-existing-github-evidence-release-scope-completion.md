# Existing GitHub Evidence Release Scope Completion Record

**SCOPE:**

- Applied the approved current release boundary on top of the Phase 0–2
  evidence-outcome backbone worktree.
- Kept v2 contract compatibility while limiting production-positive
  capabilities to `documentation_literal` and `path_change_absence`.
- Added regressions proving that GitHub-looking observations do not promote
  `test_case`, `workflow_job`, or `return_value`.

**FILES:**

- Current-scope design and execution records:
  `docs/superpowers/specs/2026-08-26-existing-github-evidence-release-scope-design.md`,
  `docs/superpowers/plans/2026-08-26-existing-github-evidence-release-scope.md`,
  this completion record, and the aligned program, Phase 3, and Phase 4 specs.
- Candidate handoff status:
  `docs/real-data-verification-readiness.md`; it now requires a candidate
  commit and prohibits reusing local-worktree counts, review, or deployment
  claims for another SHA.
- Production boundary:
  `src/lib/verification-capability-policy-v2.ts`.
- Current-scope regressions:
  `src/lib/verification-capability-policy-v2.test.ts`,
  `src/lib/verification-criterion-evaluator-v2.test.ts`, and
  `src/lib/verification-contract-v2-evaluation.test.ts`.
- The remaining modified and untracked files in `git status` are the preserved
  Phase 0–2 implementation and tests from the same worktree; they were included
  in the full local verification gate and were not discarded or overwritten.

**REUSED:**

- Existing GitHub PR/files/checks/statuses/Actions job collector in
  `src/lib/github.ts`.
- Existing v2 contract parser, materializer, criterion evaluator, runtime/full
  validators, storage boundary, and common output projections.
- Existing Vitest suite, production build, production-boundary evaluator,
  evidence release gate, and production-authority release tests.

**EXCLUDED:**

- No Actions artifact download or ZIP/per-test parser was added.
- No workflow YAML parser or display-name-to-command inference was added.
- No code executor, execution consent, producer attestation, OIDC, Sigstore,
  signing lifecycle, service, database migration, schema v3, or dependency was
  added.
- Existing dormant compatibility modules were not expanded or connected to the
  active production path.

**TESTS:**

- Baseline before the current-scope code edit: `pnpm test` — exit 0; 163 files,
  2,206 passed, 2 skipped.
- TDD RED: capability-policy focused test — exit 1 because `test_case` was
  accepted before the fix.
- TDD GREEN: capability-policy focused test — exit 0; 3 passed.
- Deferred evaluator and integrated-contract regressions — exit 0; 28 passed.
- Static positive runtime-context and contract-boundary pack — exit 0; 31
  passed.
- GitHub/provenance/runtime/privacy/output focused pack — exit 0; 7 files,
  168 passed.
- Final `pnpm test` — exit 0; 163 files, 2,214 passed, 2 skipped.
- Final `pnpm typecheck` — exit 0.
- Final `pnpm lint` — exit 0.
- Final `pnpm build` — exit 0; production build and 56 static pages generated.
- Final `git diff --check` — exit 0.
- Candidate-preflight toolchain checks — exit 0: source scan 7 passed,
  production closure 1 passed, and toolchain-manifest 13 passed.
- `evaluate-evidence-release-gate.test.mjs` — exit 0; 17 passed.
- `evaluate-production-boundary-release-gate.test.mjs` — exit 0; 6 passed.
- `evaluate-production-authority-release.test.mjs` — exit 0; 16 passed.

**BEHAVIOR:**

- Empty, malformed, duplicate, unknown, deferred-only, and mixed
  static/deferred capability configuration fails closed to an empty set.
- The exact static pair remains accepted when explicitly configured.
- Each static positive passes the production runtime boundary only after the
  server independently rebuilds its transient criterion plan; a context-free
  low-level validation remains invalid.
- Matching changed files, a passing-looking suite, a successful workflow
  identity, or global passing CI leaves all three deferred criteria
  `unavailable` with no criterion evidence refs.
- Existing GitHub observations remain available to reviewers and are not
  relabeled as behavioral proof.

**PRIVACY:**

- Existing share, storage, Markdown, Slack, runtime-authority, and mixed
  pasted/live provenance regressions passed in the 168-test focused pack and
  the full suite.
- No new raw source, artifact payload, log, token, receipt, or workflow tuple is
  persisted or added to a reduced projection by this change.
- Fresh live production leakage evidence remains `UNKNOWN` until deployment
  smoke is authorized and run.

**RELEASE:**

- Local implementation binary gates: 4/4 passed.
- Local implementation self-evaluation against the approved rubric: 100/100
  (scope 35, safety 30, regression evidence 25, handoff clarity 10). This score
  is not release evidence.
- Release decision: `NO_GO`.
- Candidate status: `CANDIDATE_COMMIT_REQUIRED`; the current worktree has no
  immutable SHA, so its local results cannot be release evidence for a later
  commit.
- Still `UNKNOWN`: protected holdout result for the exact candidate SHA,
  exact-head GitHub CI, independent review, deployment state, credentialed
  production smoke, and live latency/failure metrics.
- No commit, push, deployment, or production configuration change was made.
