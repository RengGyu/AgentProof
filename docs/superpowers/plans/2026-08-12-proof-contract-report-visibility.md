# Proof Contract and Report Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every tenant-owned saved report visible and consistently decodable when proof evidence evolves, while preserving strict privacy and signature boundaries.

**Architecture:** Define proof-axis subjects, collection bases, compatibility, and human-readable evidence copy once in a server-safe registry. Route every saved-report read through a version-aware decoder that returns either a hydrated tenant-safe report or a metadata-only unavailable disposition; list, detail, Inbox, and copy derive their own projections from that same result.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, Supabase JSON report persistence, HMAC-SHA256 report signatures.

## Global Constraints

- Preserve AgentProof as deterministic evidence reporting, never a correctness, safety, or merge verdict.
- Do not persist or return raw Issue/PR prose, patches, source, logs, prompts, provider output, tokens, signatures, or secrets.
- Keep version-1 persisted reports readable, including `interaction`, `passing_suite_execution`, and `interaction_verification`.
- Continue writing persisted report version 1 during this deployment; only enable version-2 writes after production reader verification.
- Do not change requirement extraction, LLM prompts, queue identity, GitHub permissions, Supabase schema, or database rows.
- Invalid tenant report content must never reach dashboard detail, Markdown, JSON, or copy output; only bounded row metadata and generic availability may be shown.

---

## File Map

- Create: `src/lib/proof-contract.ts` — immutable proof-axis registry, runtime guards, compatibility checks, and product-language labels.
- Create: `src/lib/proof-contract.test.ts` — complete registry/compatibility and label coverage.
- Modify: `src/lib/types.ts` — derive proof-axis unions from the shared registry.
- Modify: `src/lib/report-validation.ts` — replace local proof enum allowlists with the registry.
- Modify: `src/lib/tenant-report-validation.ts` — validate signed v1 persisted axes through the registry; expose bounded decode result and reason code.
- Modify: `src/lib/server-report-store.ts` — use one decoder for persisted report hydration and retain invalid rows as metadata-only records.
- Modify: `src/lib/github-dashboard-view-model.ts`, `src/app/api/dashboard/reports/route.ts`, `src/app/api/dashboard/activity/route.ts`, `src/components/PublicGitHubDashboard.tsx` — consume one safe read disposition.
- Modify: focused tests adjacent to the modules above.

### Task 1: Introduce the shared proof contract

**Files:**
- Create: `src/lib/proof-contract.ts`
- Create: `src/lib/proof-contract.test.ts`
- Modify: `src/lib/types.ts:215-255`
- Modify: `src/lib/report-validation.ts:1-20,390-425`
- Test: `src/lib/proof-contract.test.ts`, `src/lib/report-validation.test.ts`

**Interfaces:**
- Produces `PROOF_AXIS_SUBJECTS`, `PROOF_AXIS_COLLECTION_BASES`, `isProofAxisSubject(value)`, `isProofAxisCollectionBasis(value)`, `isProofAxisCollectionBasisAllowed(subject, basis)`, and `proofAxisEvidenceLabel(axis)`.
- `RequirementProofAxis` consumes registry-derived `RequirementProofSubject` and `RequirementProofCollectionBasis` types.

- [ ] **Step 1: Write the failing test**

```ts
it("contains every persisted v1 proof value and only permits compatible pairs", () => {
  expect(PROOF_AXIS_SUBJECTS).toContain("interaction");
  expect(PROOF_AXIS_COLLECTION_BASES).toContain("passing_suite_execution");
  expect(isProofAxisCollectionBasisAllowed("interaction", "interaction_verification")).toBe(true);
  expect(isProofAxisCollectionBasisAllowed("interaction", "passing_execution")).toBe(false);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/lib/proof-contract.test.ts`

Expected: FAIL because the registry does not exist.

- [ ] **Step 3: Implement the minimal registry**

```ts
export const PROOF_AXIS_SUBJECTS = [
  "implementation", "documentation", "ci_configuration", "targeted_test",
  "execution", "visual", "interaction"
] as const;
export const PROOF_AXIS_COLLECTION_BASES = [
  "complete_changed_file_inventory", "incomplete_changed_file_inventory",
  "matching_artifact_evidence", "passing_execution", "passing_suite_execution",
  "failed_execution", "visual_verification", "interaction_verification"
] as const;
```

Add an explicit subject-to-basis table and evidence-availability labels. Derive types in `types.ts`; import registry guards in the full validator and remove local subject/basis allowlists.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run src/lib/proof-contract.test.ts src/lib/report-validation.test.ts`

Expected: PASS; compatible pairs pass and incompatible pairs fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/proof-contract.ts src/lib/proof-contract.test.ts src/lib/types.ts src/lib/report-validation.ts src/lib/report-validation.test.ts
git commit -m "feat: centralize proof axis contract"
```

### Task 2: Make persisted v1 reports decode through the shared contract

**Files:**
- Modify: `src/lib/tenant-report-validation.ts:1-320`
- Modify: `src/lib/tenant-report-validation.test.ts`
- Modify: `src/lib/server-report-store.ts:140-250,900-1120`
- Modify: `src/lib/server-report-store.test.ts`

**Interfaces:**

```ts
export type TenantReportDecodeReason =
  | "unsupported_report_version"
  | "invalid_report_signature"
  | "invalid_report_shape"
  | "invalid_proof_contract"
  | "invalid_evidence_reference"
  | "invalid_semantic_output";

export type TenantReportDecodeResult =
  | { status: "valid"; report: VerificationReport; contractVersion: number }
  | { status: "invalid"; reasonCode: TenantReportDecodeReason };
```

- `decodeTenantPersistedReport(value, { signingSecret, createdAt })` validates exact persisted shape, HMAC, proof contract, refs, semantic output, then hydrates.
- Store reads carry a valid/invalid disposition. Invalid tenant JSON may retain row metadata but may never be cast into a `VerificationReport`.

- [ ] **Step 1: Write failing compatibility and safe-disposition tests**

```ts
it("decodes a signed v1 interaction and suite-execution report after JSON round-trip", () => {
  const persisted = JSON.parse(JSON.stringify(projectTenantPersistedReport(reportWithInteractionAxis, secret)));
  expect(decodeTenantPersistedReport(persisted, { signingSecret: secret, createdAt }))
    .toMatchObject({ status: "valid", contractVersion: 1 });
});

it("returns a bounded invalid reason without hydrating tampered content", () => {
  expect(decodeTenantPersistedReport(signedReportWithUnknownAxis(), { signingSecret: secret, createdAt }))
    .toEqual({ status: "invalid", reasonCode: "invalid_proof_contract" });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/lib/tenant-report-validation.test.ts src/lib/server-report-store.test.ts`

Expected: FAIL: v1 validation has a separate enum list and invalid persisted JSON is fallback-cast as a full report.

- [ ] **Step 3: Implement decoder and storage boundary**

Use shared guards in `validatePersistedProofAxes`. Translate errors to a fixed reason code without returning error prose. Make `rowToStoredReport` hydrate only from a valid decoder result; preserve id, tenant, repository, PR, head, timestamps, and stale metadata for an invalid result.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run src/lib/tenant-report-validation.test.ts src/lib/server-report-store.test.ts`

Expected: PASS; PR #5-shaped v1 reports list without re-analysis, invalid rows are metadata-only, and tampered signatures expose no content.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant-report-validation.ts src/lib/tenant-report-validation.test.ts src/lib/server-report-store.ts src/lib/server-report-store.test.ts
git commit -m "fix: decode persisted reports through proof contract"
```

### Task 3: Enforce one dashboard read disposition

**Files:**
- Modify: `src/lib/github-dashboard-view-model.ts`, `src/lib/dashboard-report-list.ts`
- Modify: `src/app/api/dashboard/reports/route.ts`, `src/app/api/dashboard/activity/route.ts`
- Test: matching route/view-model/list tests

**Interfaces:**
- `DashboardSavedReport` gains `availability?: "available" | "unavailable"`; unavailable rows retain safe metadata and set `copyEligible: false`.
- Detail returns either an available report or `{ availability: "unavailable" }`, never invalid report JSON.
- Bundle returns `complete: false` and no partial report set if a current candidate is unavailable.

- [ ] **Step 1: Write failing parity tests**

```ts
it("keeps an invalid current row visible but blocks detail and copy", async () => {
  seedInvalidCurrentTenantReport();
  await expect(fetchList()).resolves.toContainEqual(expect.objectContaining({
    availability: "unavailable", copyEligible: false
  }));
  await expect(fetchCurrentBundle(repositoryId)).resolves.toMatchObject({
    bundle: { complete: false }, reports: []
  });
});

it("returns the same fourteen valid current reports from list and bundle eligibility", async () => {
  seedFourteenCurrentReports();
  expect((await fetchList()).reports).toHaveLength(14);
  expect((await fetchCurrentBundle(repositoryId)).reports).toHaveLength(14);
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/app/api/dashboard/reports/route.test.ts src/app/api/dashboard/activity/route.test.ts src/lib/github-dashboard-view-model.test.ts src/lib/dashboard-report-list.test.ts`

Expected: FAIL: the paths independently validate/filter and silently hide the invalid row.

- [ ] **Step 3: Implement safe availability projections**

List always emits unavailable metadata rows. Detail returns generic unavailable state without `report`; Inbox/activity uses the same summary. Bundle validates every current candidate before filtering and fails closed when any is unavailable. Preserve existing updating/superseded rules.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run src/app/api/dashboard/reports/route.test.ts src/app/api/dashboard/activity/route.test.ts src/lib/github-dashboard-view-model.test.ts src/lib/dashboard-report-list.test.ts`

Expected: PASS; valid list and bundle counts agree, unavailable current rows remain visible and block copy.

- [ ] **Step 5: Commit**

```bash
git add src/lib/github-dashboard-view-model.ts src/lib/dashboard-report-list.ts src/app/api/dashboard/reports/route.ts src/app/api/dashboard/activity/route.ts
git add src/lib/github-dashboard-view-model.test.ts src/lib/dashboard-report-list.test.ts src/app/api/dashboard/reports/route.test.ts src/app/api/dashboard/activity/route.test.ts
git commit -m "fix: keep unavailable reports visible"
```

### Task 4: Render concise proof evidence and safe unavailable rows

**Files:**
- Modify: `src/components/PublicGitHubDashboard.tsx`
- Modify: `src/app/globals.css`
- Test: `src/components/PublicGitHubDashboard.test.ts`, `src/components/RequirementEvidenceList.test.ts`

**Interfaces:**
- Unavailable report rows show `REPORT UNAVAILABLE`, a generic recovery sentence, and disabled open/copy controls.
- Existing evidence disclosure consumes the registry label; no raw enum, provider wording, or correctness claim is added.

- [ ] **Step 1: Write failing UI tests**

```tsx
it("renders an unavailable report as metadata only and disables opening it", () => {
  render(<PublicGitHubDashboard reports={[unavailableReport]} />);
  expect(screen.getByText("REPORT UNAVAILABLE")).toBeVisible();
  expect(screen.queryByText(/Requirement req_/)).not.toBeInTheDocument();
});

it("uses an evidence-availability label for a passed suite", () => {
  render(<RequirementEvidenceList cards={[suiteExecutionCard]} />);
  expect(screen.getByText("The repository test suite ran successfully for this PR.")).toBeVisible();
  expect(screen.queryByText(/ready to merge|correct/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run src/components/PublicGitHubDashboard.test.ts src/components/RequirementEvidenceList.test.ts`

Expected: FAIL because the view model has no unavailable state or shared proof labels.

- [ ] **Step 3: Implement accessible safe rendering**

Render only allowlisted metadata plus: `This saved report cannot be opened right now. Run the analysis again if the state does not recover.` Disable report open/copy actions. Keep proof labels inside existing evidence detail disclosure and retain requirement IDs there for traceability.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run src/components/PublicGitHubDashboard.test.ts src/components/RequirementEvidenceList.test.ts src/lib/dashboard-report-export.test.ts`

Expected: PASS; unavailable content cannot render/copy and valid export contracts remain tenant-safe.

- [ ] **Step 5: Commit**

```bash
git add src/components/PublicGitHubDashboard.tsx src/components/PublicGitHubDashboard.test.ts src/app/globals.css
git commit -m "feat: show safe unavailable report state"
```

### Task 5: Verify phase-one release readiness

**Files:**
- Modify: `docs/superpowers/specs/2026-08-12-proof-contract-report-visibility-design.md` only if automated validation exposes a required clarification.

**Interfaces:**
- Version-2 writing remains disabled. The deployed reader supports v1 now and is the prerequisite for a later v2-write change.

- [ ] **Step 1: Run complete automated verification**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && git diff --check`

Expected: all pass; no user-owned untracked eval, docs, or Supabase files change.

- [ ] **Step 2: Commit only an actual documentation clarification**

```bash
git add docs/superpowers/specs/2026-08-12-proof-contract-report-visibility-design.md
git commit -m "docs: record proof contract rollout verification"
```

Do not create an empty commit.

- [ ] **Step 3: Push phase one and verify production**

Run: `git push origin HEAD:main`

Expected: production build succeeds. Verify one valid current report, one updating report, one previous result, and one synthetic invalid-contract fixture before enabling version-2 writes.

## Self-Review

- **Spec coverage:** Tasks 1–2 centralize the contract and secure v1 decoding; Task 3 creates list/detail/Inbox/copy parity; Task 4 exposes only safe evidence language; Task 5 prevents v2 writes until production reader verification.
- **Placeholder scan:** Every task specifies files, interfaces, a RED command, a GREEN command, and a scoped commit.
- **Type consistency:** `decodeTenantPersistedReport` produces `TenantReportDecodeResult`; storage converts it into a safe internal disposition; routes expose only `availability`, never decode reason codes.

