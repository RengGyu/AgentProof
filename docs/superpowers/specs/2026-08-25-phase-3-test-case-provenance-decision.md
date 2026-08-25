# Phase 3A — Test-Case Producer Provenance Decision

**Depends on:**
`2026-08-25-phase-3-capability-evaluators-design.md` and
`2026-08-25-phase-3-vitest-json-test-case-design.md`

**Status:** Decision recorded; no implementation authorized

**Decision:** AgentProof will not promote an `artifact.test_case` criterion
from an ordinary GitHub Actions artifact, a generic passed Check, a job/step
name, pasted Vitest JSON, or a caller-supplied tuple. Those inputs remain
observations and the strict criterion result stays `unavailable` or
`incomplete`.

## 1. Product question

The product needs to say one narrow thing truthfully:

> The contract-declared test ID was executed and passed for the analyzed PR
> head in the declared execution.

It must not say that from a test result which merely *claims* which job made
it. The claim must be independently bound to the exact head, workflow run,
attempt, and producer job before it can satisfy a strict contract criterion.

This does not change ordinary AgentProof observations. Static test relations,
changed files, and CI checks remain useful reviewer evidence, but they are not
strict execution proof.

## 2. Verified platform boundary

GitHub's Actions artifact metadata supplies an artifact ID, archive digest,
workflow-run ID, and head SHA. The workflow-jobs API separately supplies a
job ID and run attempt. The documented artifact shape contains no authoritative
artifact-to-producer-job or artifact-to-run-attempt field. Therefore this join
cannot be rebuilt by matching strings, timestamps, an artifact name, or JSON
inside the artifact.

GitHub Artifact Attestations improve the source-integrity side: they are
cryptographically signed and can carry workflow, repository, commit, event,
run, and attempt provenance for an artifact digest. They still do not turn a
Vitest JSON payload into independent proof that a particular job ran that
test. Verification also requires Sigstore/GitHub attestation verification,
not `JSON.parse` alone.

Sources checked on 2026-08-25:

- GitHub Actions artifacts REST API: artifact digest and `workflow_run`, but
  no producer-job field.
- GitHub OIDC claims: `check_run_id`, `run_id`, `run_attempt`, workflow data,
  and reusable-workflow identity are available for a job-issued token.
- GitHub artifact attestation documentation: attestation verification must
  validate signer identity and cryptographic material.

## 3. Approaches considered

| Approach | What it would establish | Why it is not this capability now |
| --- | --- | --- |
| Parse downloaded Vitest JSON | The JSON has a passed ID | JSON may declare any job/run; it has no independent producer binding. |
| Match artifact name to workflow YAML | A configured job expects that name | A name is not an artifact-to-job receipt. It cannot exclude another job or script producing the same artifact. |
| GitHub Artifact Attestation only | A signed artifact digest came from a workflow/run provenance | Better integrity, but not the required exact test-producer-job semantics. It adds Sigstore verification and GitHub-plan/permission constraints. |
| AgentProof callback signed with an ordinary Actions OIDC token | A GitHub job issued a token in a run/attempt | A new external control plane, OIDC verification, replay store, consent, and key/availability operations would be required. It is not a collector extension. |
| Pinned AgentProof reusable workflow plus attestation | A trusted workflow may generate a signed result | It is AgentProof-controlled execution of PR code/test setup, not passive evidence collection. It needs separate repository execution consent and an isolated-executor product design. |

## 4. Chosen boundary

Do not add any of the above mechanisms in Phase 3A. The smallest correct
change is an explicit no-promotion boundary:

```text
GitHub artifact / check / test relation
  -> useful observation
  -> missing independent producer proof
  -> test_case: unavailable
```

This preserves the product purpose: deterministic evidence reports can report
what was observed without overstating it as a contract outcome. It avoids
turning AgentProof into a generic CI runner, a workflow parser, or a remote
code-execution service merely to create one positive status.

## 5. Future entry criteria (separate product decision)

A future `test_case` promotion design may start only if all items below are
explicitly approved together:

1. **Trust protocol:** an independently verifiable producer-job identity and
   artifact digest binding, with immutable issuer identity. An artifact's own
   JSON and ordinary artifact metadata are not acceptable issuers.
2. **Execution authority:** explicit, versioned repository consent if
   AgentProof or an AgentProof-pinned reusable workflow executes any repository
   code, test command, setup, or dependency installation.
3. **Verifier control plane:** a bounded verifier for the native attestation
   format, signer/issuer allowlist, clock and replay handling, trusted-root
   lifecycle, artifact and JSON size limits, and a strict privacy projection.
4. **Criterion closure:** test-ID parser, exact static declaration/test binding,
   criterion-owned private receipt, and independent `v2_full` recomputation.
5. **Release evidence:** production-shaped replay, forged/missing/replayed
   attestation tests, privacy tests, protected holdout with zero false
   `satisfied`, and an independent reviewer of the exact candidate SHA.

Until every item is delivered in a separately approved design and plan,
`AGENTPROOF_VERIFICATION_CAPABILITIES_V2` must not enable `test_case`.

## 6. Regression and evaluation record

The focused evaluator regression supplies a caller-like exact-test record that
contains a passed ID and a job tuple. The current correct result is
`unavailable`; no evidence references are emitted. This protects the boundary
against a future convenience implementation that starts trusting its own input.

Required command:

```bash
pnpm vitest run src/lib/verification-criterion-evaluator-v2.test.ts
```

Expected result: all focused evaluator tests pass. This proves only that the
unsafe positive path remains disabled; it does not prove that a future
attestation implementation exists or is release-ready.

## 7. Explicitly out of scope

- adding a ZIP library or parsing GitHub artifact archives;
- enabling `test_case` capability;
- treating tests, checks, workflow names, or static test relations as a strict
  passed execution;
- collecting, storing, or projecting raw test results, job tuples, OIDC
  tokens, signatures, or attestation bundles;
- workflow-job promotion and return-value execution; and
- commit, push, deployment, GitHub workflow edits, or external side effects.
