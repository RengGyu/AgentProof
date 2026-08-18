# Subject-Bound Test Binding Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept deterministic targeted-test evidence when exactly one binding
matches the resolved requirement subject, even if the same module exposes
unrelated imports.

**Architecture:** Keep subject identifiers transient. The verifier resolves one
subject from a closed relation, passes it to the binding parser, and the parser
filters static bindings by exported subject before counting added direct
assertions. The unchanged exact-head route uses the same selector before it
creates a private receipt.

**Tech Stack:** TypeScript, Vitest, AgentProof proof graph and full-report
validation.

**Spec:** `docs/superpowers/specs/2026-08-18-subject-bound-test-binding-correction-design.md`

## Global Constraints

- English deterministic evidence only; do not add PR-number, repository, or
  branch-specific production rules.
- A subject match is unique by exported binding identity; zero or multiple
  matches fail closed.
- Imports may be unchanged context, but a selected direct assertion must be a
  live added diff line.
- Preserve existing rejection of barrels, re-exports, mocks, dynamic imports,
  second relative targets, stale heads, and mismatched suites.
- Identifiers and assertion contents are transient; report schemas and public,
  tenant-summary, Markdown, telemetry, and error projections do not change.
- Contract outcomes, multilingual parsing, workflow identity collection, and
  semantic return-value proof remain out of scope.

---

### Task 1: Bind direct test evidence to the resolved subject

**Files:**

- Modify: `src/lib/evidence-relation.ts`
- Modify: `src/lib/verifier.ts`
- Modify: `src/lib/evidence-relation.test.ts`
- Modify: `src/lib/english-observation-evidence-regression.test.ts`
- Modify: `src/lib/requirement-relation-regression.test.ts` only if its
  existing direct-assertion fixtures need the subject-aware public API.

**Interfaces:**

- Consumes: a deterministic `test_subject_chain` subject requirement or an
  explicitly named unchanged-helper test requirement.
- Produces: a targeted-test evidence ref only when exactly one direct static
  binding matches that subject; existing report receipts remain unchanged.

- [x] **Step 1: Add RED regression tests for real mixed-binding behavior**

  Add shape-based fixtures that exercise the real proof graph, not a mocked
  parser result:

  ```ts
  // One selected binding plus an unrelated sibling binding: evidence is met.
  import { legacyLabel, formatLabel } from "../src/labels.js";
  assert.equal(legacyLabel({ name: "old" }), "old");
  assert.equal(formatLabel({ owner: "acme", name: "app" }), "acme/app");
  ```

  The requirement chain must name only `formatLabel`, have one identifier-free
  continuation, and end with a subjectless test objective. Assert satisfied
  `targeted_test` and exact-path `execution` axes.

  Add these negative cases with literal expected outcomes:

  ```ts
  // The named subject has no added assertion.
  // The selected subject exists only in hunk context; added code is unrelated.
  // Two direct static bindings both match the named subject.
  // A mixed-binding unchanged-helper test still resolves only its named export.
  ```

  Run:

  ```bash
  pnpm vitest run src/lib/evidence-relation.test.ts src/lib/english-observation-evidence-regression.test.ts src/lib/requirement-relation-regression.test.ts
  ```

  Expected: the new positive test fails because the current collector rejects
  module imports whose binding count is greater than one; existing tests remain
  green.

- [x] **Step 2: Add a transient subject-aware binding selector**

  In `src/lib/evidence-relation.ts`, replace local-name-only collection for the
  changed-target path with bounded descriptors containing `exportedName`,
  `localName`, and import kind. Extend these existing interfaces with an
  optional transient `subject` parameter:

  ```ts
  distinctDirectAssertionCallCount(testFile, implementationFile, subject?: string): number
  directTestTargetCandidate(testFile, subject?: string): DirectTestTargetCandidate | null
  resolveExactHeadTarget({ ..., subject?: string }): ExactHeadTargetResolution | null
  ```

  Add private helpers that retain line provenance while lexing:

  ```ts
  livePatchEntries(patch): Array<{ line: string; added: boolean }>
  countAddedDirectAssertionSignatures(entries, localName): Set<string>
  ```

  Existing callers without a subject keep the current single-binding behavior.
  Subject-aware callers filter by `binding.exportedName` before uniqueness.

  The selector must:

  ```ts
  const selected = bindings.filter((binding) => binding.exportedName === subject);
  if (selected.length !== 1) return noEvidence;
  return countAddedDirectAssertions(selected[0].localName);
  ```

  Parse imports from safe live lines, but count only safe added assertion lines.
  Preserve the current lexical comment/string/template, object-literal, and
  multiple-relative-import safeguards. Do not serialize `subject` or binding
  names.

- [x] **Step 3: Thread the subject through both verifier paths**

  In `src/lib/verifier.ts`, derive a single transient identifier from:

  ```ts
  test_subject_chain -> subjectRequirementId
  unchanged exact-head -> current explicitly named test requirement
  ```

  Add one private `uniqueExplicitCodeSubject(text): string | undefined` helper
  in `src/lib/verifier.ts`; it returns a subject only when current explicit-code
  parsing yields one identifier. Pass it to changed-target direct assertion
  selection and to exact-head target candidate/resolution selection. Retain
  legacy no-subject behavior for unrelated proof paths. Do not create a
  fallback based on filenames, generic relevance, or a passed Check.

- [x] **Step 4: Verify GREEN and regression boundaries**

  Run the focused command from Step 1. Confirm the mixed-binding positives now
  pass, the three negative parser/proof cases remain incomplete, the competing
  multi-behavior objective remains Partial, and the unchanged semantic claim
  remains Partial.

  Then run:

  ```bash
  pnpm vitest run src/lib/evidence-relation.test.ts src/lib/english-observation-evidence-regression.test.ts src/lib/requirement-relation-regression.test.ts src/lib/report-validation.test.ts src/lib/report-share.test.ts src/lib/external-regression-cases.test.ts
  pnpm test
  pnpm typecheck
  pnpm lint
  pnpm build
  git diff --check
  ```

- [x] **Step 5: Preserve handoff state**

  Leave the verified working-tree diff uncommitted unless the user separately
  authorizes a commit. Do not stage unrelated pre-existing untracked plan or
  spec files, and do not push or deploy.
