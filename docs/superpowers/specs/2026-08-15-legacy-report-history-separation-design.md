# Legacy saved-report history separation

## Goal

Keep current, openable evidence reports as the primary repository workspace. Place historical reports that cannot be decoded under a separate, collapsed history area so they do not imply that a current report failed.

## Scope

- Partition the existing repository report list by `availability === "unavailable"`.
- Keep current and other actionable report states in the primary list and its copy eligibility flow.
- Render unavailable historical rows only in an explicit collapsed section, with their existing recovery guidance.
- Do not alter saved-report data, report validation, retention, or verification outcomes.

## Expected behavior

- If a repository has current saved reports plus old unavailable reports, the primary list contains only the current reports and has no global unavailable warning.
- The collapsed history control states the number of unavailable historical reports. Expanding it exposes disabled, non-copyable rows and the recovery guidance.
- If only unavailable rows exist, the primary workspace still makes their state discoverable through the history control.

## Verification

- Add a regression test for partitioning: unavailable history must not disable copying or contaminate the current list.
- Add a UI regression test for the collapsed history control and scoped warning.
- Run focused tests, typecheck, lint, and the full test suite.
