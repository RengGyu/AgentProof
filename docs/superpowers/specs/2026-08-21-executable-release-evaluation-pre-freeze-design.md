# Executable Release Evaluation — Pre-freeze Design

## Purpose lock

AgentProof remains an evidence-report product. This release evaluation proves
only that a candidate preserves bounded, deterministic evidence-promotion
rules. It does not prove merge readiness, general code correctness, reviewer
usefulness, or market fit.

The evaluator must fail closed: missing, malformed, duplicate, extra, or
unmeasured data produces `UNKNOWN` and a non-zero gate exit. It must never
derive a passing result from a self-reported count.

## Scope of this pre-freeze phase

This phase defines and tests the executable interfaces only. It does **not**:

- create, rewrite, inspect, or score a frozen oracle;
- enable `receipt_v2` in production;
- commit, push, deploy, or contact GitHub;
- restore external pilot artifacts from guesses.

The existing `eval/evidence-release-holdout.v1.json` is not release evidence:
its schema is incompatible with the evaluator. It remains a failed development
artifact and must not be adapted in place or used to claim a holdout result.

## Boundary

```text
protected case payload (input only) -> candidate runner -> candidate result
protected oracle (expected only) -----------------------> evaluator
candidate result + oracle ------------------------------> aggregate gate
```

The runner must never receive oracle expectations. The evaluator must never
generate a report. The frozen oracle must live outside the implementation
worktree and be injected only by protected CI after the runner contract is
fixed.

## Contracts

### Candidate case payload v1

The independent holdout author will later create this input-only payload. It
contains opaque IDs and a sanitized replayable `PullRequestInput` fixture, but
no expected evidence state, outcome, receipt count, or hidden source binding.

```ts
interface ReleaseCandidateCaseV1 {
  version: 1;
  caseId: string;
  input: PullRequestInput;
  requirementOrdinals: number[];
}

interface ReleaseCandidateCorpusV1 {
  version: 1;
  cases: ReleaseCandidateCaseV1[];
}
```

`caseId` and `requirementOrdinals` are transport keys, not verification
outcomes. The runner rejects duplicate IDs, duplicate/out-of-range ordinals,
unbounded payloads, and extra unknown top-level fields.

### Candidate result v1

The runner produces this shape by invoking the same generated-private report
path used by production. It explicitly runs under the proposed release
promotion policy (`receipt_v2`) only inside the runner process; it does not
change production configuration.

```ts
interface ReleaseCandidateResultV1 {
  version: 1;
  caseId: string;
  actual: {
    sourceKind: string;
    authority: string;
    requirements: Array<{
      stableOracleId: string;
      ordinal: number;
      axisStates: Record<"implementation" | "targeted_test" | "execution", string>;
      testReceiptIds: string[];
      executionReceiptIds: string[];
      localCiAssociation: string;
      outcome: string;
    }>;
    projection: {
      privateReceiptLeakCount: number;
    };
  };
  metrics: {
    unexpectedFailure: boolean;
    durationMs: number;
    github: { requests: number; pages: number; retries: number };
    providerCallCount: number;
  };
}
```

The result schema is closed. Unknown fields, duplicate case IDs, absent cases,
and extra cases are gate failures. Receipt IDs are opaque per-run handles and
must not contain paths, symbols, source, logs, tokens, or GitHub tuple fields.

### Projection proof

The runner derives `privateReceiptLeakCount` from actual serialized public and
tenant projections, using an allowlist of public fields. It cannot accept a
caller-provided leak count. Any unrecognized projection field is a leak and a
gate failure.

## Runner behavior

For each case, the runner must:

1. validate the input-only payload and enforce a bounded case count;
2. generate a report through `generated_private_full` runtime validation;
3. require a valid private v2 receipt pair before preserving a local positive
   targeted-test or execution axis;
4. project the report through the production public and tenant serializers;
5. calculate opaque structural output and aggregate timings/request counters;
6. write a candidate-result artifact only to an explicit caller-provided path.

Any report-generation, validation, projection, or metric-collection gap emits
an incomplete candidate case. The evaluator then reports required safety
metrics as `UNKNOWN` and exits non-zero.

## Evaluator behavior

The evaluator compares only a protected oracle and a candidate artifact. It
must:

- require exact corpus version, case set, and ordered requirement set;
- reject duplicate, missing, and extra case IDs;
- reject unknown keys in oracle, candidate, requirement, receipt, and
  projection records;
- compare source/authority, axes, receipt cardinality and ownership, local CI,
  outcome, and projection result;
- emit aggregate metrics only; no case IDs, source text, paths, receipt IDs,
  logs, or raw evidence;
- exit non-zero for every safety metric that is non-zero or `UNKNOWN`.

## Required pre-freeze tests

- Runner invokes generated-private runtime validation, not a direct verifier
  shortcut.
- A receipt-less local axis is incomplete in runner output.
- A forged active-v2 report cannot be used as runner output.
- Public and tenant projections contain no private receipt material.
- Duplicate/missing/extra candidate cases fail closed.
- Unknown projection fields fail closed, even when their names are harmless.
- Evaluator receives an input-compatible synthetic development corpus and
  reports its full case count. This is plumbing coverage, not holdout evidence.

## Freeze handoff criteria

Only after all pre-freeze tests pass may an independent reviewer create the
protected oracle and candidate case payload. The reviewer receives the above
contracts but no development regressions or preferred outcomes. The reviewer
publishes only the case count, category balance, schema version, and hash.

## Post-freeze sequence

1. Fix production runtime authority and pasted-log provenance defects under
   ordinary RED/GREEN regression tests.
2. Run the candidate runner against the protected payload.
3. Run the evaluator with the protected oracle.
4. Keep any failing frozen case out of implementation prompts; classify it as
   a new regression only after an independent decision.
5. Restore authoritative external-pilot artifacts, complete P0 manual labels,
   run full engineering gates, then seek deployment approval.
