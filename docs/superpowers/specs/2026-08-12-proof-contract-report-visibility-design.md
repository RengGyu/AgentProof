# Proof Contract and Report Visibility Design

**Date:** 2026-08-12
**Status:** Approved direction; implementation pending
**Scope:** Deterministic proof-axis contracts, tenant report decoding, dashboard list/detail/copy consistency, and bounded diagnostics

## Problem

AgentProof added two valid deterministic proof values:

- proof subject `interaction`
- collection basis `passing_suite_execution`

The report generator and full-report validator understood these values, but the tenant-persisted-report validator used a separate hard-coded allowlist that did not. A report containing the new values was stored successfully and remained readable through some paths, but the repository-list projection rejected it and silently removed it.

This exposed a broader architectural fault:

1. proof contracts are duplicated across TypeScript types and runtime validators;
2. list, detail, and bundle/copy paths do not share one authoritative decode result;
3. a contract mismatch can make a saved report disappear without a safe user-visible state;
4. technical proof values have no single product-language projection.

The production PR #5 case demonstrated the failure: the row was current, its latest job was completed, its head and repository grant matched, and the report remained available to the bundle path, but the list path filtered it after tenant validation failed.

## Goals

- Make the proof contract a single runtime source of truth used by generation, persistence, validation, and rendering.
- Restore existing valid reports containing `interaction` and `passing_suite_execution` without re-analysis.
- Make list, detail, and copy agree on whether a report is valid and copyable.
- Never silently hide a tenant-owned saved-report row because its report payload cannot be decoded.
- Show product language rather than internal enum names.
- Preserve strict signature, privacy, reference, and bounded-output checks.
- Record only bounded reason codes and counts for contract failures.

## Non-goals

- Do not move proof axes into normalized database tables.
- Do not persist raw Issue text, PR text, patches, source files, logs, prompts, or provider output.
- Do not make deterministic evidence a correctness, safety, requirement-satisfaction, or merge verdict.
- Do not let an LLM create or modify deterministic proof axes.
- Do not automatically rewrite every existing database row.

## Decision

Adopt a shared proof-contract registry, a version-aware tenant report decoder, and one read projection used by repository list, report detail, and copy bundle.

Invalid or unsupported report payloads remain tenant-visible as safe metadata-only rows. Their content and copy actions remain unavailable until the report becomes decodable or is reprocessed.

## Architecture

### 1. Shared proof-contract registry

Create one server-safe module, expected at `src/lib/proof-contract.ts`, containing immutable runtime constants and type guards for:

- proof subjects;
- collection bases;
- allowed subject-to-basis relationships;
- user-facing proof labels;
- contract version support.

TypeScript unions in `src/lib/types.ts` must be derived from the registry's `as const` values rather than maintained separately.

The initial registry must include all values already generated or accepted by AgentProof:

| Proof subject | Compatible collection basis |
| --- | --- |
| `implementation` | changed-file inventory or matching artifact evidence |
| `documentation` | matching documentation artifact evidence |
| `ci_configuration` | matching workflow/configuration artifact evidence |
| `targeted_test` | matching test artifact evidence |
| `execution` | `passing_execution`, `passing_suite_execution`, or `failed_execution` |
| `visual` | `visual_verification` |
| `interaction` | `interaction_verification` |

An incomplete axis may omit a basis when no compatible evidence was collected. A satisfied or violated axis must satisfy the existing requirement-local evidence and collection-basis rules in `report-validation.ts`.

The generator, full validator, tenant persisted validator, and any semantic-package projection must import this registry. No consumer may maintain a second list of proof subjects or collection bases.

### 2. Version-aware tenant report decoding

Introduce one authoritative decoder:

```ts
type TenantReportDecodeResult =
  | { status: "valid"; report: VerificationReport; contractVersion: number }
  | { status: "invalid"; reasonCode: TenantReportDecodeReason };
```

The decoder performs, in order:

1. exact persisted-object shape validation;
2. HMAC signature verification;
3. proof-contract version and proof-axis validation;
4. evidence-reference validation;
5. semantic-output validation when semantic output exists;
6. hydration into the tenant-safe `VerificationReport` projection.

The decoder must not expose validation prose, report content, signatures, or provider metadata to dashboard clients.

### 3. Compatibility policy

Existing version-1 persisted reports remain readable. The version-1 reader must accept every proof value that AgentProof has already emitted under version 1, including `interaction`, `passing_suite_execution`, and `interaction_verification`.

New writes move to persisted report version 2 only after the version-2 reader is deployed. Version 2 references the centralized proof contract and does not duplicate proof allowlists.

Rollout is two-phase:

1. deploy shared registry, version-1 compatibility, common decoder, and read-path parity while continuing to write version 1;
2. after production verification, enable version-2 writes while continuing to read both versions.

No database migration is required because the persisted report is JSON. Existing rows are decoded in place and are not rewritten merely to change versions.

### 4. One read boundary for list, detail, and copy

All saved-report read paths must call the same decoder before using report content:

- repository report list;
- Inbox report link resolution;
- report detail;
- repository copy bundle;
- Markdown and JSON export preparation.

The paths may create different projections, but they must share the same decode disposition.

| Decode result | List | Detail | Copy bundle |
| --- | --- | --- | --- |
| valid and current | show normally | allow | include |
| valid and updating | show `UPDATING` | allow read-only | exclude |
| valid but superseded | keep in previous-result history | allow read-only | exclude |
| invalid/unsupported | show safe placeholder | block report content | exclude and mark bundle incomplete |

The copy bundle must fail closed when any candidate that should be current cannot be decoded. It must never silently produce a bundle whose count disagrees with the repository list.

### 5. Safe placeholder instead of disappearance

The saved-report row already contains tenant-scoped metadata outside the report JSON: report ID, repository ID, PR number, head SHA, creation time, stale time, and expiry time. When decoding fails, the dashboard may use only this bounded metadata to render a row.

User-facing state:

- label: `REPORT UNAVAILABLE`
- explanation: `This saved report cannot be opened right now. Run the analysis again if the state does not recover.`
- detail and copy actions: disabled

Do not expose internal validation errors or imply that the PR itself is defective.

### 6. Human-readable proof details

Internal enum values remain available only to trusted validation and machine JSON contracts. The dashboard maps them to concise language in the existing evidence disclosure:

| Internal value | User-facing meaning |
| --- | --- |
| `passing_suite_execution` | `The repository test suite ran successfully for this PR.` |
| `passing_execution` | `A requirement-linked Check completed successfully.` |
| `failed_execution` | `A relevant Check reported failure.` |
| `interaction_verification` | `Browser interaction evidence is available.` |
| incomplete `interaction` axis | `The user-facing behavior has not been exercised in a browser.` |

These lines describe evidence availability only. They must not say that implementation behavior is correct, safe, complete, or ready to merge.

## Error handling and observability

Use a fixed internal reason-code enum, initially:

- `unsupported_report_version`
- `invalid_report_signature`
- `invalid_report_shape`
- `invalid_proof_contract`
- `invalid_evidence_reference`
- `invalid_semantic_output`

Operational diagnostics may record:

- reason code;
- persisted contract version;
- bounded section counts;
- timestamp;
- existing hashed job/report correlation key where already supported.

Diagnostics must not record report prose, code, raw paths beyond the existing safe locator policy, signatures, secrets, prompts, or provider output.

The API response exposes only a generic availability state. Exact reason codes remain server-side.

## Data flow

```text
deterministic verifier
  -> shared proof contract
  -> tenant report projection + signature
  -> persisted JSON
  -> common version-aware decoder
       -> valid report projection
            -> list / detail / copy
       -> invalid metadata-only projection
            -> visible unavailable row / copy blocked
```

## Testing strategy

### Contract completeness

- Every registered proof subject and collection basis round-trips through projection, signing, JSON serialization, decoding, hydration, and full report validation.
- Types are derived from the registry so a new runtime value cannot be added to only one validator.
- Every subject-to-basis combination is tested as allowed or rejected.

### Regression coverage

- A version-1 report containing `interaction`, `passing_suite_execution`, and `interaction_verification` appears in list and detail and is copyable when current.
- The existing PR #5 report shape validates without re-analysis.
- A report with an unknown proof value renders one safe unavailable row instead of disappearing.

### Read-path parity

- List, detail, Inbox, and bundle use the same decoder disposition.
- A valid current repository with 14 reports exposes 14 list rows and 14 eligible bundle entries.
- An invalid current candidate remains visible but makes the copy bundle incomplete.
- Updating and superseded reports remain readable but are not copyable.

### Privacy and security

- Tampered signatures never expose report content.
- Unknown fields, raw logs, source text, patches, provider IDs, and secrets remain rejected.
- Placeholder and diagnostics contain only allowlisted metadata and reason codes.
- Markdown and JSON export cannot bypass the common decoder.

## Acceptance criteria

The implementation is complete only when all of the following hold:

1. PR #5 reappears in repository reports without re-analysis.
2. The displayed report count and copy-bundle eligible count agree for the same current set.
3. No proof subject or collection-basis allowlist exists outside the shared registry.
4. List, detail, Inbox, and copy use one decode result.
5. Unknown or invalid reports are visible as safe placeholders and never expose their content.
6. Existing version-1 reports remain readable; version-2 writes begin only after compatible readers are deployed.
7. Full unit, integration, type, lint, and production build verification passes.
8. Production verification checks one valid current report, one updating report, one previous result, and one synthetic invalid-contract fixture.

## Implementation boundaries

Expected implementation areas:

- `src/lib/proof-contract.ts`
- `src/lib/types.ts`
- `src/lib/report-validation.ts`
- `src/lib/tenant-report-validation.ts`
- `src/lib/server-report-store.ts`
- `src/app/api/dashboard/reports/route.ts`
- `src/components/PublicGitHubDashboard.tsx`
- focused tests for each module above

Do not change requirement extraction, LLM prompts, semantic generation, queue identity, GitHub permissions, or database schema as part of this work.

## Risks and controls

- **Compatibility risk:** version-1 rows contain values added after the original schema. Control: explicit version-1 historical-value fixture coverage.
- **Availability risk:** strict validation can hide content. Control: metadata-only placeholder and bounded internal reason code.
- **Privacy risk:** exposing validation details could reveal report structure. Control: generic client state and server-only reason codes.
- **Consistency risk:** one route may bypass decoding. Control: one decoder API and read-path parity tests.
- **Product-language risk:** machine evidence may look like a correctness verdict. Control: evidence-availability wording and existing human-review boundary.

## Rollout verification

After phase 1 deployment:

1. refresh the production dashboard;
2. select `RengGyu/agentproof-evaluation-fixtures`;
3. verify PR #5 appears without creating a new commit or rerunning analysis;
4. confirm list count and `Copy all reports` count agree;
5. open PR #5 and confirm proof details use human-readable evidence language;
6. confirm no report body, raw code, logs, secrets, or provider metadata appears in operational diagnostics.
