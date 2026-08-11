# Grounded Requirement Presentation Design

## Goal

Make saved AgentProof reports concise and understandable without allowing model prose to create evidence gaps, remediation work, or source-detail requests that are absent from deterministic verification.

## Approved boundaries

- Deterministic requirement status and proof gaps remain authoritative.
- The semantic layer may explain a deterministic result, but it cannot add a new gap or remediation premise.
- A saved tenant report may keep one optional, validated objective label per requirement. It may not keep raw Issue/PR bodies, patches, logs, URLs, secrets, or multiline source text.
- Existing signed reports without the optional label remain readable.
- An unlinked PR with no explicit objective remains `unlinked_pr`; it is not reclassified as a provided requirement.
- Dashboard and Markdown output never manufacture a complete sentence by truncating model text.

## Data flow

```text
Issue/PR objective
  -> deterministic extraction and proof graph
  -> safe single-line objective-label admission
  -> signed tenant report
  -> dashboard/Markdown label

Deterministic gap kinds
  -> transient semantic proof catalog
  -> context-aware unit filter
  -> accepted explanation plus deterministic gap/action fallback
```

## Objective-label contract

`TenantPersistedReport.requirements[]` gains an optional `objectiveLabel`.
The label is admitted only when it is a single normalized line, within 160 characters, and contains no secret, URL, unsafe path, Markdown fence, model instruction, or raw-source marker. The original requirement text is not copied wholesale when it fails this contract. Hydration uses the label when present and the legacy `Requirement <id>` placeholder otherwise.

## Semantic gap and remediation contract

The transient server-only proof catalog includes the exact deterministic gap kinds for every requirement. A semantic gap survives only when its type maps to an existing deterministic gap kind. A remediation survives only when its request type is allowed by an existing deterministic gap kind. A requirement with no deterministic gap cannot receive a semantic gap or remediation. Neither section is promoted into the canonical tenant proof gaps or next action.

Raw or full source, file contents, patches, logs, outputs, artifacts, or job metadata are never valid requested evidence.

## Complete-text contract

The model may still return schema-valid text longer than the product surface can use. Fresh semantic validation rejects units whose display fields exceed the concise product limits or end in an incomplete marker. The dashboard never clips and adds punctuation; it omits unusable prose and falls back to bounded deterministic copy.

## Compatibility and verification

- Persisted report schema remains version 1 with an optional field covered by the existing HMAC.
- Old reports without `objectiveLabel` validate and hydrate.
- JSON machine export keeps accepted structured semantic sections.
- Markdown/dashboard use the same concise view model.
- Tests cover privacy rejection, backward compatibility, deterministic-gap mapping, raw-source demands, complete sentences, and zero-objective context.
