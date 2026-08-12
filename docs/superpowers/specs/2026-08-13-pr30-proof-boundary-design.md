# PR #30 Proof-Boundary Design

## Goal

Prevent enhanced planning from turning a deterministic test-only requirement into
an implementation-evidence failure, and distinguish unavailable GitHub patch
content from absent implementation evidence.

## Decisions

1. The deterministic server contract is the only source of blocking proof
   axes and final requirement status. The enhanced planner may still admit PR
   candidates and return its bounded axis suggestions, but a suggested axis
   must not add a required proof axis, proof gap, or downgrade to the report.
2. Implementation proof is complete only when a requirement-relevant source
   diff is collected. A changed-file record without a patch is an evidence
   collection limitation, not proof that implementation is absent.
3. The report must carry a bounded, privacy-safe patch-collection status for
   changed files: collected or unavailable. No raw patch text is persisted.

## Expected PR #30 Result

- The two behavior requirements have satisfied implementation proof from
  `src/repositories/repository-visibility.js`.
- The test-only requirement has satisfied targeted-test proof from
  `test/repository-visibility.test.js` and never gains an implementation
  requirement from planner output.
- A generic `unit-tests` check remains insufficient to prove that this exact
  test file executed; that yields an execution gap, not an implementation gap.

## Acceptance

- A planner response that suggests `implementation:present` for a test-only
  span cannot create an implementation proof axis or gap.
- A collected source patch can satisfy a matching implementation requirement.
- A missing source patch produces an evidence-unavailable collection gap and
  cannot produce `missing_implementation`.
- The PR #30 fixture passes in both deterministic and enhanced-finalization
  paths, with only a possible execution gap.
- Existing report validation, tenant projection, and privacy tests remain
  compatible; no raw patch is added to persisted reports.
