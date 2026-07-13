# AgentProof Controlled Human A/B v2 execution contract

Status: fail-closed coordinator, runner, and importer foundation implemented; real experiment still blocked
Protocol: `agentproof-human-ab.v2`

This contract evaluates whether append-only semantic assistance helps a human use the same deterministic evidence report. It does not make the LLM a truth source and does not establish correctness, generalization, or product-default readiness.

## Why v2 exists

The v1 validator trusted the stored blocker array, accepted only syntactically shaped hashes, did not bind label rows to assignment IDs or packet bytes, and had no exact-set coordinator importer. A malformed NotScorable row could also bypass identity validation. v1 artifacts remain historical and are never accepted by the v2 execution path.

## Freeze gate

`buildFreezeManifestV2` and `validateFreezeManifestV2` use the same deterministic blocker derivation. The stored blocker array and status must exactly equal the recomputed values. A runnable manifest requires:

- a clean reproducible source commit;
- one dated resolved model identifier and the frozen planner/schema versions;
- all required source/prompt/schema/harness digests;
- a valid sealed holdout receipt v2 bound to source commit, experiment, case count, and sealed case-set digest;
- a passed assignment preflight whose actual canonical plan/preflight hashes match the manifest;
- an exact reviewer roster whose keys exactly match per-rater workbook hashes;
- coordinator workbook, ordered Labels header, and per-rater QA receipts that bind the distributed binary hash, serialized freeze pane, formula absence, macro absence, and external-link absence;
- unchanged deterministic product default and preserved historical evaluation artifacts.

The current real manifest does not satisfy these conditions and must not be relabeled as v2-ready.

## Artifact chain

The non-circular integrity chain is:

1. canonical sealed holdout receipt;
2. canonical assignment plan;
3. deterministic assignment preflight;
4. frozen canonical blinded-case artifact hash;
5. exact distributed rater workbook binary hash and per-rater QA receipt;
6. rater packet raw JSON hash and an isolated runner launch descriptor;
7. per-row logical hash and ordered row-hash digest;
8. completed label journal raw hash;
9. blinded summary and label-freeze receipt.

Every imported row carries the assignment ID, plan/preflight/packet/workbook hashes, opaque case and arm, reviewer pseudonym, index, and the separate reviewer decision `enough | not_enough | unclear`. NotScorable rows retain the full immutable identity but keep decision, scores, and decision time null.

## Prepare

Preparation is offline and no-clobber. The complete artifact set is written into a new hidden sibling directory, synced, and exposed through an atomic no-replace directory symlink so a concurrent run cannot replace an existing output. `blinded-cases.json` contains only opaque case IDs, one shared bounded source packet, and opaque A/B report text. Its canonical bytes are frozen in the manifest and reproduced again during import. It must not contain an arm key, model/prompt metadata, repository/PR identity, raw diff/log/prompt/reasoning, timestamped execution material, private addresses, or secrets.

```bash
node scripts/llm-proof-planner-human-ab-v2.mjs prepare \
  <ready-freeze-manifest-v2.json> \
  <assignment-plan-v2.json> \
  <blinded-cases.json> \
  <new-prepared-directory>
```

The command refuses v1 contracts, a blocked or forged manifest, plan/preflight hash drift, roster/workbook mismatch, case-set drift, unsafe packet text, duplicate exposure, and existing output directories.

## Label and resume

The runner verifies the exact packet bytes and distributed workbook binary before showing a report. Each journal update uses same-directory temporary file creation, file sync, atomic rename, and directory sync. Resume is explicit.

```bash
node scripts/llm-proof-planner-human-ab-v2-runner.mjs label \
  <expected-launch-sha256> <runner-launch.json> <rater-packet.json> <distributed-rater-workbook.xlsx> <label-journal.json>

node scripts/llm-proof-planner-human-ab-v2-runner.mjs resume \
  <same-expected-launch-sha256> <same-runner-launch.json> <same-rater-packet.json> <same-distributed-rater-workbook.xlsx> <label-journal.json>
```

The expected launch hash comes from the coordinator-only `launch-freeze-receipt.json` and must be delivered separately from the packet bundle. The journal records an active assignment before report display. If a crash occurs after reveal, resume marks that assignment `operational_failure` exactly once and never reveals it again. Completed journals cannot be resumed or overwritten. A crash may leave a fail-closed lock; an operator must confirm no runner is active before using the explicit `unlock` command and then `resume`.

## Import and label freeze

```bash
node scripts/llm-proof-planner-human-ab-v2.mjs import \
  <prepared-directory> <completed-label-journals-directory> <new-summary-directory>
```

Import rehashes the actual plan, preflight, packets, and journals. Packet and journal rater sets must exactly match the frozen roster, and every frozen assignment must appear exactly once with the same immutable identity and hashes. Missing, extra, duplicate, substituted, partial, formula-like, unsafe, or identity-free rows fail before output creation.

The blinded summary keeps the three ordinal axes, decision time, and reviewer-decision counts separate. NotScorable rows are counted but excluded from every score/time aggregate. The arm mapping is not stored before label freeze.

## Remaining real-world blockers

## Pre-recruitment coordinator gate

Before asking anyone to evaluate, use the offline `human-ab:v2:prerecruit` coordinator tool to derive a clean-source freeze fragment and to seal a policy-bound holdout receipt. It never discovers PRs, calls a model, creates cases, or accepts private holdout material inside this repository. The private manifest contains opaque identities and hashes only, must live outside the repository under evaluator-controlled access, and is checked against a pre-frozen exclusion registry. Its identity-free receipt remains compatible with the v2 freeze contract through `privateManifestSha256` and `sealedCaseSetSha256`.

The same command has a deterministic seeded assignment generator in its coordinator core (the seed itself remains private; only its commitment is retained) and a `workbook-qa` operation. The latter independently reads OOXML and reports the frozen Labels header hash plus pane/formula/macro/external-link checks. It does not treat a declared boolean as verification. A real rater workbook cannot be approved until this operation is run against its final distributed binary.

The policy and methodology templates are:

- `eval/llm-proof-planner-sealed-holdout-selection-policy.template.v1.json`
- `eval/llm-proof-planner-human-ab-preregistration.template.v1.json`

The preregistration must be completed and approved before recruitment. It distinguishes fixed-output human utility from correctness, records the case/rater-clustered analysis plan, MDE/sample-size rationale, ITT/missingness/stopping rules, independent-reference-label/adjudication roles, and reviewer independence/conflict attestations.

This implementation closes the synthetic contract path; it does not create a holdout or human roster. Before a real Human A/B, AgentProof still needs a new unseen holdout and private manifest, actual independent reviewers, assignment-prefilled per-rater workbooks whose binary hashes are frozen, exported OOXML verification of the Labels header pane, and an approved dated-model policy. Reference labels, adjudication, sample size/MDE, clustered analysis, and stopping rules remain methodology work rather than code-generated truth.
